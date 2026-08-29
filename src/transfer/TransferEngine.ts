// ============================================
// Clous — TransferEngine (Reliable Data Transfer)
// ============================================

import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import { RetryManager } from './RetryManager';
import { CircuitBreaker } from './CircuitBreaker';
import { RateLimiter } from './RateLimiter';
import { Checksum } from '../utils/Checksum';
import { EventBus } from '../utils/EventBus';
import type { ModuleLogger } from '../utils/Logger';
import type {
  TransferConfig,
  TransferRequest,
  TransferResult,
} from '../types';

/**
 * Reliable data transfer engine with built-in retry (exponential backoff),
 * circuit breaker, rate limiting, and checksum verification.
 *
 * Supports custom transfer handlers for non-HTTP destinations.
 */
export class TransferEngine {
  private retryManager: RetryManager;
  private circuitBreaker: CircuitBreaker;
  private rateLimiter: RateLimiter;

  constructor(
    private events: EventBus,
    private logger: ModuleLogger,
    config: TransferConfig = {},
  ) {
    this.retryManager = new RetryManager(logger, {
      maxAttempts: config.retryAttempts ?? 5,
      baseDelay: config.retryDelay ?? 1000,
    });

    this.circuitBreaker = new CircuitBreaker(
      logger,
      config.circuitBreaker || {},
      (from, to) => {
        this.events.emit(`transfer:circuit:${to.toLowerCase().replace('_', '-')}`);
      },
    );

    this.rateLimiter = new RateLimiter(logger, config.rateLimit || {});
  }

  /**
   * Send data to a destination with full reliability features.
   */
  async send(request: TransferRequest): Promise<TransferResult> {
    const startTime = Date.now();

    this.events.emit('transfer:start', request);
    this.logger.info(`Transfer started: ${request.method || 'POST'} ${request.destination}`);

    try {
      // Rate limiting — wait for token
      const waitTime = this.rateLimiter.getEstimatedWaitTime();
      if (waitTime > 0) {
        this.events.emit('transfer:rate-limited', waitTime);
        this.logger.debug(`Rate limited, waiting ${waitTime}ms`);
      }
      await this.rateLimiter.acquire();

      // Circuit breaker + retry
      const { result: transferResult, attempts } = await this.retryManager.execute(
        async () => {
          return this.circuitBreaker.execute(async () => {
            if (request.handler) {
              // Custom transfer handler
              return request.handler(request);
            }
            // Default HTTP transfer
            return this.httpTransfer(request);
          });
        },
        (attempt, error, delayMs) => {
          this.events.emit('transfer:retry', request, attempt, error);
          this.logger.warn(`Transfer retry ${attempt}: ${(error as Error).message}, waiting ${delayMs}ms`);
        },
      );

      const result: TransferResult = {
        ...transferResult,
        duration: Date.now() - startTime,
        attempts,
      };

      // Verify checksum if requested
      if (request.verifyChecksum !== false && result.checksum) {
        const dataChecksum = Checksum.sha256(JSON.stringify(request.data));
        if (dataChecksum !== result.checksum) {
          this.logger.warn('Transfer checksum mismatch — data may be corrupted');
        }
      }

      this.events.emit('transfer:complete', result);
      this.logger.info(`Transfer completed in ${result.duration}ms (${result.attempts} attempt(s))`);

      return result;
    } catch (error) {
      const transferError = error as Error;
      const result: TransferResult = {
        success: false,
        duration: Date.now() - startTime,
        attempts: 0,
        error: transferError.message,
      };

      this.events.emit('transfer:error', request, transferError);
      this.logger.error(`Transfer failed: ${transferError.message}`);

      return result;
    }
  }

  /**
   * Send multiple transfers concurrently with a concurrency limit.
   */
  async sendBatch(
    requests: TransferRequest[],
    concurrency: number = 3,
  ): Promise<TransferResult[]> {
    const results: TransferResult[] = [];
    const queue = [...requests];
    const workers: Promise<void>[] = [];

    const runWorker = async (): Promise<void> => {
      while (queue.length > 0) {
        const request = queue.shift();
        if (!request) break;
        const result = await this.send(request);
        results.push(result);
      }
    };

    for (let i = 0; i < Math.min(concurrency, requests.length); i++) {
      workers.push(runWorker());
    }

    await Promise.all(workers);
    return results;
  }

  /**
   * Get the circuit breaker stats.
   */
  getCircuitBreakerStats() {
    return this.circuitBreaker.getStats();
  }

  /**
   * Reset the circuit breaker.
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
  }

  /**
   * Get rate limiter info.
   */
  getRateLimiterInfo() {
    return {
      availableTokens: this.rateLimiter.getAvailableTokens(),
      queueSize: this.rateLimiter.getQueueSize(),
      estimatedWaitTime: this.rateLimiter.getEstimatedWaitTime(),
    };
  }

  /**
   * Shutdown the transfer engine.
   */
  close(): void {
    this.rateLimiter.close();
    this.logger.info('TransferEngine closed');
  }

  // ── Private ──────────────────────────────────

  private async httpTransfer(request: TransferRequest): Promise<TransferResult> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const method = request.method || 'POST';
      const serializedData = JSON.stringify(request.data);
      const dataChecksum = Checksum.sha256(serializedData);

      const parsedUrl = new URL(request.destination);
      const isHttps = parsedUrl.protocol === 'https:';
      const transport = isHttps ? https : http;

      const options: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(serializedData),
          'X-Clous-Checksum': dataChecksum,
          ...request.headers,
        },
        timeout: request.timeout || 30000,
      };

      const req = transport.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          const statusCode = res.statusCode || 0;
          const success = statusCode >= 200 && statusCode < 300;

          let responseData: any;
          try {
            responseData = JSON.parse(body);
          } catch {
            responseData = body;
          }

          if (!success) {
            reject(
              new Error(
                `HTTP ${statusCode}: ${typeof responseData === 'string' ? responseData : JSON.stringify(responseData)}`,
              ),
            );
            return;
          }

          resolve({
            success: true,
            statusCode,
            data: responseData,
            checksum: dataChecksum,
            duration: Date.now() - startTime,
            attempts: 1,
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Transfer timeout (${request.timeout || 30000}ms)`));
      });

      req.on('error', (error) => {
        reject(error);
      });

      // Send data for methods that have a body
      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        req.write(serializedData);
      }

      req.end();
    });
  }
}
