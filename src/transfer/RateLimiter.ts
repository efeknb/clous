// ============================================
// Clous — RateLimiter (Token Bucket)
// ============================================

import type { ModuleLogger } from '../utils/Logger';
import type { RateLimitConfig } from '../types';

interface QueueEntry {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * Token bucket rate limiter with queuing support.
 *
 * Tokens are refilled at a constant rate. Requests consume tokens,
 * and when tokens are exhausted, requests are queued until tokens
 * become available.
 */
export class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number; // Tokens per millisecond
  private lastRefill: number;
  private queue: QueueEntry[] = [];
  private refillTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private logger: ModuleLogger,
    config: RateLimitConfig = {},
  ) {
    const maxRequests = config.maxRequests ?? 100;
    const windowMs = config.windowMs ?? 60000;
    this.maxTokens = config.burstSize ?? maxRequests;
    this.tokens = this.maxTokens;
    this.refillRate = maxRequests / windowMs;
    this.lastRefill = Date.now();

    // Start periodic token refill
    this.startRefill();
  }

  /**
   * Acquire a token. If no tokens are available, waits in the queue.
   * Resolves when a token is acquired, rejects on timeout.
   */
  async acquire(timeoutMs: number = 30000): Promise<void> {
    this.refillTokens();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // No tokens available, wait in queue
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        // Remove from queue on timeout
        const idx = this.queue.findIndex((e) => e.resolve === resolve);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(new Error(`Rate limit timeout: waited ${timeoutMs}ms`));
      }, timeoutMs);

      this.queue.push({ resolve, reject, timeout });
      this.logger.debug(`Request queued (queue size: ${this.queue.length})`);
    });
  }

  /**
   * Try to acquire a token without waiting.
   * Returns true if a token was acquired, false otherwise.
   */
  tryAcquire(): boolean {
    this.refillTokens();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /**
   * Get the number of available tokens.
   */
  getAvailableTokens(): number {
    this.refillTokens();
    return Math.floor(this.tokens);
  }

  /**
   * Get the current queue size.
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Get estimated wait time in ms for the next token.
   */
  getEstimatedWaitTime(): number {
    this.refillTokens();
    if (this.tokens >= 1) return 0;
    const tokensNeeded = 1 - this.tokens;
    return Math.ceil(tokensNeeded / this.refillRate);
  }

  /**
   * Reset the rate limiter (refill all tokens, clear queue).
   */
  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();

    // Resolve all queued requests
    while (this.queue.length > 0) {
      const entry = this.queue.shift()!;
      clearTimeout(entry.timeout);
      entry.resolve();
    }

    this.logger.debug('Rate limiter reset');
  }

  /**
   * Shutdown the rate limiter.
   */
  close(): void {
    if (this.refillTimer) {
      clearInterval(this.refillTimer);
      this.refillTimer = null;
    }

    // Reject all queued requests
    while (this.queue.length > 0) {
      const entry = this.queue.shift()!;
      clearTimeout(entry.timeout);
      entry.reject(new Error('Rate limiter closed'));
    }
  }

  // ── Private ──────────────────────────────────

  private refillTokens(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const newTokens = elapsed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
    this.lastRefill = now;
  }

  private startRefill(): void {
    // Check queue periodically and process entries when tokens are available
    this.refillTimer = setInterval(() => {
      this.refillTokens();
      this.processQueue();
    }, 100); // Check every 100ms

    // Prevent the timer from keeping the process alive
    if (this.refillTimer.unref) {
      this.refillTimer.unref();
    }
  }

  private processQueue(): void {
    while (this.queue.length > 0 && this.tokens >= 1) {
      const entry = this.queue.shift()!;
      this.tokens -= 1;
      clearTimeout(entry.timeout);
      entry.resolve();
    }
  }
}
