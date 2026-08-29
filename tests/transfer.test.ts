// ============================================
// Clous — TransferEngine Tests
// ============================================

import { RetryManager } from '../src/transfer/RetryManager';
import { CircuitBreaker, CircuitBreakerError } from '../src/transfer/CircuitBreaker';
import { RateLimiter } from '../src/transfer/RateLimiter';
import { TransferEngine } from '../src/transfer/TransferEngine';
import { EventBus } from '../src/utils/EventBus';
import { Logger } from '../src/utils/Logger';

const logger = new Logger('error');

describe('RetryManager', () => {
  let retryManager: RetryManager;

  beforeEach(() => {
    retryManager = new RetryManager(logger.child('Retry'), {
      maxAttempts: 3,
      baseDelay: 10,  // Short delays for tests
      maxDelay: 100,
      jitter: 0,
    });
  });

  test('should succeed on first attempt', async () => {
    const { result, attempts } = await retryManager.execute(
      async () => 'success',
    );

    expect(result).toBe('success');
    expect(attempts).toBe(1);
  });

  test('should retry on failure', async () => {
    let callCount = 0;
    const { result, attempts } = await retryManager.execute(async () => {
      callCount++;
      if (callCount < 3) throw new Error('temporary failure');
      return 'recovered';
    });

    expect(result).toBe('recovered');
    expect(attempts).toBe(3);
  });

  test('should throw after max attempts', async () => {
    await expect(
      retryManager.execute(async () => {
        throw new Error('permanent failure');
      }),
    ).rejects.toThrow('permanent failure');
  });

  test('should call onRetry callback', async () => {
    const retries: number[] = [];
    let callCount = 0;

    await retryManager.execute(
      async () => {
        callCount++;
        if (callCount < 2) throw new Error('fail');
        return 'ok';
      },
      (attempt) => retries.push(attempt),
    );

    expect(retries).toEqual([1]);
  });

  test('should respect retry condition', async () => {
    const manager = new RetryManager(logger.child('Retry'), {
      maxAttempts: 5,
      baseDelay: 10,
      retryCondition: (_error, attempt) => attempt < 2, // Only retry once
    });

    let callCount = 0;
    await expect(
      manager.execute(async () => {
        callCount++;
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');

    expect(callCount).toBe(2); // Initial + 1 retry
  });

  test('should calculate exponential delay', () => {
    const manager = new RetryManager(logger.child('Retry'), {
      maxAttempts: 5,
      baseDelay: 100,
      backoffMultiplier: 2,
      jitter: 0,
    });

    expect(manager.calculateDelay(1)).toBe(100);
    expect(manager.calculateDelay(2)).toBe(200);
    expect(manager.calculateDelay(3)).toBe(400);
  });
});

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker(logger.child('CB'), {
      threshold: 3,
      timeout: 100,
      successThreshold: 2,
    });
  });

  test('should start in CLOSED state', () => {
    expect(cb.getState()).toBe('CLOSED');
  });

  test('should stay CLOSED on success', async () => {
    await cb.execute(async () => 'ok');
    expect(cb.getState()).toBe('CLOSED');
  });

  test('should open after threshold failures', async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await cb.execute(async () => { throw new Error('fail'); });
      } catch {}
    }

    expect(cb.getState()).toBe('OPEN');
  });

  test('should reject when OPEN', async () => {
    // Force open
    for (let i = 0; i < 3; i++) {
      try {
        await cb.execute(async () => { throw new Error('fail'); });
      } catch {}
    }

    await expect(
      cb.execute(async () => 'should not run'),
    ).rejects.toThrow('Circuit breaker is OPEN');
  });

  test('should transition to HALF_OPEN after timeout', async () => {
    // Force open
    for (let i = 0; i < 3; i++) {
      try {
        await cb.execute(async () => { throw new Error('fail'); });
      } catch {}
    }

    expect(cb.getState()).toBe('OPEN');

    // Wait for timeout
    await new Promise((r) => setTimeout(r, 150));

    // Next call should transition to HALF_OPEN
    await cb.execute(async () => 'ok');
    // After success in HALF_OPEN, needs successThreshold (2), so still HALF_OPEN
    expect(cb.getState()).toBe('HALF_OPEN');
  });

  test('should close after success threshold in HALF_OPEN', async () => {
    // Force open
    for (let i = 0; i < 3; i++) {
      try {
        await cb.execute(async () => { throw new Error('fail'); });
      } catch {}
    }

    // Wait for timeout
    await new Promise((r) => setTimeout(r, 150));

    // Succeed enough times
    await cb.execute(async () => 'ok');
    await cb.execute(async () => 'ok');

    expect(cb.getState()).toBe('CLOSED');
  });

  test('should re-open on failure in HALF_OPEN', async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await cb.execute(async () => { throw new Error('fail'); });
      } catch {}
    }

    await new Promise((r) => setTimeout(r, 150));

    try {
      await cb.execute(async () => { throw new Error('still failing'); });
    } catch {}

    expect(cb.getState()).toBe('OPEN');
  });

  test('should reset manually', async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await cb.execute(async () => { throw new Error('fail'); });
      } catch {}
    }

    cb.reset();
    expect(cb.getState()).toBe('CLOSED');
  });

  test('should track stats', async () => {
    await cb.execute(async () => 'ok');
    try {
      await cb.execute(async () => { throw new Error('fail'); });
    } catch {}

    const stats = cb.getStats();
    expect(stats.totalRequests).toBe(2);
    expect(stats.totalFailures).toBe(1);
    expect(stats.lastSuccess).toBeTruthy();
    expect(stats.lastFailure).toBeTruthy();
  });

  test('should notify on state change', async () => {
    const transitions: string[] = [];
    const cbWithCallback = new CircuitBreaker(
      logger.child('CB'),
      { threshold: 2, timeout: 50 },
      (from, to) => transitions.push(`${from}->${to}`),
    );

    for (let i = 0; i < 2; i++) {
      try {
        await cbWithCallback.execute(async () => { throw new Error('fail'); });
      } catch {}
    }

    expect(transitions).toContain('CLOSED->OPEN');
  });
});

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  afterEach(() => {
    if (limiter) limiter.close();
  });

  test('should allow requests within limit', () => {
    limiter = new RateLimiter(logger.child('RL'), {
      maxRequests: 5,
      windowMs: 1000,
    });

    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
  });

  test('should block when tokens exhausted', () => {
    limiter = new RateLimiter(logger.child('RL'), {
      maxRequests: 2,
      windowMs: 1000,
      burstSize: 2,
    });

    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  test('should report available tokens', () => {
    limiter = new RateLimiter(logger.child('RL'), {
      maxRequests: 10,
      windowMs: 1000,
      burstSize: 10,
    });

    expect(limiter.getAvailableTokens()).toBe(10);
    limiter.tryAcquire();
    expect(limiter.getAvailableTokens()).toBe(9);
  });

  test('should reset and refill tokens', () => {
    limiter = new RateLimiter(logger.child('RL'), {
      maxRequests: 3,
      windowMs: 1000,
      burstSize: 3,
    });

    limiter.tryAcquire();
    limiter.tryAcquire();
    limiter.tryAcquire();

    expect(limiter.getAvailableTokens()).toBe(0);

    limiter.reset();
    expect(limiter.getAvailableTokens()).toBe(3);
  });

  test('should refill tokens over time', async () => {
    limiter = new RateLimiter(logger.child('RL'), {
      maxRequests: 100,
      windowMs: 1000,
      burstSize: 100,
    });

    // Consume all tokens
    for (let i = 0; i < 100; i++) {
      limiter.tryAcquire();
    }

    expect(limiter.getAvailableTokens()).toBe(0);

    // Wait for some refill
    await new Promise((r) => setTimeout(r, 200));

    expect(limiter.getAvailableTokens()).toBeGreaterThan(0);
  });

  test('should queue and resolve when tokens available', async () => {
    limiter = new RateLimiter(logger.child('RL'), {
      maxRequests: 100,
      windowMs: 100,
      burstSize: 1,
    });

    limiter.tryAcquire(); // Consume the 1 burst token

    // Should wait and resolve when token refills
    await limiter.acquire(5000);
    // If we reach here, it means the acquire resolved
    expect(true).toBe(true);
  });
});

describe('TransferEngine', () => {
  let engine: TransferEngine;
  let events: EventBus;

  beforeEach(() => {
    events = new EventBus();
    engine = new TransferEngine(events, logger.child('Transfer'), {
      retryAttempts: 2,
      retryDelay: 10,
      circuitBreaker: { threshold: 5, timeout: 100 },
      rateLimit: { maxRequests: 100, windowMs: 1000 },
    });
  });

  afterEach(() => {
    engine.close();
    events.removeAllListeners();
  });

  test('should use custom handler for transfer', async () => {
    const result = await engine.send({
      destination: 'custom://my-service',
      data: { message: 'hello' },
      handler: async (req) => ({
        success: true,
        statusCode: 200,
        data: { received: true },
        checksum: '',
        duration: 5,
        attempts: 1,
      }),
    });

    expect(result.success).toBe(true);
    expect(result.data.received).toBe(true);
  });

  test('should retry failed transfers', async () => {
    let attempts = 0;
    const result = await engine.send({
      destination: 'custom://retry-test',
      data: {},
      handler: async () => {
        attempts++;
        if (attempts < 2) throw new Error('temporary error');
        return {
          success: true,
          statusCode: 200,
          data: {},
          checksum: '',
          duration: 1,
          attempts,
        };
      },
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  });

  test('should return failure result after exhausted retries', async () => {
    const result = await engine.send({
      destination: 'custom://fail',
      data: {},
      handler: async () => {
        throw new Error('permanent error');
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('permanent error');
  });

  test('should emit transfer events', async () => {
    const emittedEvents: string[] = [];
    events.on('transfer:start', () => emittedEvents.push('start'));
    events.on('transfer:complete', () => emittedEvents.push('complete'));

    await engine.send({
      destination: 'test',
      data: {},
      handler: async () => ({
        success: true, statusCode: 200, data: {}, checksum: '', duration: 1, attempts: 1,
      }),
    });

    expect(emittedEvents).toContain('start');
    expect(emittedEvents).toContain('complete');
  });

  test('should send batch transfers', async () => {
    const results = await engine.sendBatch([
      {
        destination: 'test-1',
        data: { id: 1 },
        handler: async () => ({
          success: true, statusCode: 200, data: { id: 1 }, checksum: '', duration: 1, attempts: 1,
        }),
      },
      {
        destination: 'test-2',
        data: { id: 2 },
        handler: async () => ({
          success: true, statusCode: 200, data: { id: 2 }, checksum: '', duration: 1, attempts: 1,
        }),
      },
    ], 2);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });

  test('should get circuit breaker stats', () => {
    const stats = engine.getCircuitBreakerStats();
    expect(stats.state).toBe('CLOSED');
    expect(stats.totalRequests).toBe(0);
  });

  test('should get rate limiter info', () => {
    const info = engine.getRateLimiterInfo();
    expect(info.availableTokens).toBeGreaterThan(0);
    expect(info.queueSize).toBe(0);
  });
});
