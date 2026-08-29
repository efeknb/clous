// ============================================
// Clous — CircuitBreaker
// ============================================

import type { ModuleLogger } from '../utils/Logger';
import type { CircuitBreakerConfig, CircuitState, CircuitBreakerStats } from '../types';

/**
 * Circuit breaker pattern implementation.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through.
 * - OPEN: Too many failures, requests are rejected immediately.
 * - HALF_OPEN: After timeout, allows a limited number of test requests.
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private totalRequests: number = 0;
  private totalFailures: number = 0;
  private halfOpenAttempts: number = 0;

  private threshold: number;
  private timeout: number;
  private successThreshold: number;

  private onStateChange?: (from: CircuitState, to: CircuitState) => void;

  constructor(
    private logger: ModuleLogger,
    config: CircuitBreakerConfig = {},
    onStateChange?: (from: CircuitState, to: CircuitState) => void,
  ) {
    this.threshold = config.threshold ?? 3;
    this.timeout = config.timeout ?? 60000;
    this.successThreshold = config.successThreshold ?? 2;
    this.onStateChange = onStateChange;
  }

  /**
   * Execute a function through the circuit breaker.
   * Rejects immediately if the circuit is OPEN.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalRequests++;

    // Check if circuit should transition from OPEN to HALF_OPEN
    if (this.state === 'OPEN') {
      if (this.shouldAttemptRecovery()) {
        this.transitionTo('HALF_OPEN');
      } else {
        throw new CircuitBreakerError(
          `Circuit breaker is OPEN. Retry after ${this.getRemainingTimeout()}ms`,
          this.state,
        );
      }
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Check if a request is allowed through the circuit.
   */
  isAllowed(): boolean {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'HALF_OPEN') return true;
    if (this.state === 'OPEN') return this.shouldAttemptRecovery();
    return false;
  }

  /**
   * Manually reset the circuit breaker to CLOSED state.
   */
  reset(): void {
    this.transitionTo('CLOSED');
    this.failures = 0;
    this.successes = 0;
    this.halfOpenAttempts = 0;
    this.logger.info('Circuit breaker manually reset');
  }

  /**
   * Get the current circuit breaker stats.
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailureTime,
      lastSuccess: this.lastSuccessTime,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
    };
  }

  /**
   * Get the current state.
   */
  getState(): CircuitState {
    return this.state;
  }

  // ── Private ──────────────────────────────────

  private recordSuccess(): void {
    this.successes++;
    this.lastSuccessTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.halfOpenAttempts++;
      if (this.halfOpenAttempts >= this.successThreshold) {
        this.transitionTo('CLOSED');
        this.failures = 0;
        this.halfOpenAttempts = 0;
      }
    } else if (this.state === 'CLOSED') {
      // Reset failure count on success
      this.failures = 0;
    }
  }

  private recordFailure(): void {
    this.failures++;
    this.totalFailures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      // Any failure in half-open goes back to open
      this.transitionTo('OPEN');
      this.halfOpenAttempts = 0;
    } else if (this.state === 'CLOSED' && this.failures >= this.threshold) {
      this.transitionTo('OPEN');
    }
  }

  private shouldAttemptRecovery(): boolean {
    if (this.lastFailureTime === null) return true;
    return Date.now() - this.lastFailureTime >= this.timeout;
  }

  private getRemainingTimeout(): number {
    if (this.lastFailureTime === null) return 0;
    const elapsed = Date.now() - this.lastFailureTime;
    return Math.max(0, this.timeout - elapsed);
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    if (oldState === newState) return;

    this.state = newState;
    this.logger.info(`Circuit breaker: ${oldState} → ${newState}`);

    if (this.onStateChange) {
      this.onStateChange(oldState, newState);
    }
  }
}

/**
 * Custom error thrown when the circuit breaker is open.
 */
export class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public readonly circuitState: CircuitState,
  ) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}
