// ============================================
// Clous — RetryManager (Exponential Backoff)
// ============================================

import type { ModuleLogger } from '../utils/Logger';
import type { RetryOptions } from '../types';

/**
 * Retry manager with exponential backoff, configurable jitter,
 * and retry condition support.
 */
export class RetryManager {
  private options: Required<RetryOptions>;

  constructor(
    private logger: ModuleLogger,
    options: Partial<RetryOptions> = {},
  ) {
    this.options = {
      maxAttempts: options.maxAttempts ?? 5,
      baseDelay: options.baseDelay ?? 1000,
      maxDelay: options.maxDelay ?? 30000,
      jitter: options.jitter ?? 0.2,
      backoffMultiplier: options.backoffMultiplier ?? 2,
      retryCondition: options.retryCondition ?? (() => true),
    };
  }

  /**
   * Execute a function with retry logic.
   * Retries on failure with exponential backoff until maxAttempts is reached.
   */
  async execute<T>(
    fn: () => Promise<T>,
    onRetry?: (attempt: number, error: any, delayMs: number) => void,
  ): Promise<{ result: T; attempts: number }> {
    let lastError: any;

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
      try {
        const result = await fn();
        return { result, attempts: attempt };
      } catch (error) {
        lastError = error;

        // Check if we should retry
        if (attempt >= this.options.maxAttempts) {
          break;
        }

        if (!this.options.retryCondition(error, attempt)) {
          this.logger.debug(`Retry condition not met at attempt ${attempt}, giving up`);
          break;
        }

        // Calculate delay with exponential backoff + jitter
        const delay = this.calculateDelay(attempt);

        this.logger.debug(
          `Attempt ${attempt}/${this.options.maxAttempts} failed, retrying in ${delay}ms`,
          { error: (error as Error).message },
        );

        if (onRetry) {
          onRetry(attempt, error, delay);
        }

        // Wait before retrying
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Calculate the delay for a given attempt using exponential backoff + jitter.
   */
  calculateDelay(attempt: number): number {
    // Exponential backoff: baseDelay * multiplier^(attempt-1)
    const exponentialDelay =
      this.options.baseDelay * Math.pow(this.options.backoffMultiplier, attempt - 1);

    // Cap at maxDelay
    const cappedDelay = Math.min(exponentialDelay, this.options.maxDelay);

    // Add jitter
    const jitterRange = cappedDelay * this.options.jitter;
    const jitter = Math.random() * jitterRange * 2 - jitterRange;

    return Math.max(0, Math.round(cappedDelay + jitter));
  }

  /**
   * Update retry options at runtime.
   */
  updateOptions(options: Partial<RetryOptions>): void {
    Object.assign(this.options, options);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
