// ============================================
// Clous — Integration Tests
// ============================================

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ClousClient } from '../src/ClousClient';

describe('ClousClient — Integration', () => {
  let clous: ClousClient;
  let tempDir: string;
  let envPath: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clous-integration-'));
    envPath = path.join(tempDir, '.env');

    fs.writeFileSync(envPath, [
      'CLOUS_ENV=test',
      'CLOUS_LOG_LEVEL=error',
      `CLOUS_STORE_DIR=${path.join(tempDir, 'store')}`,
      'CLOUS_WAL_ENABLED=true',
    ].join('\n'));

    clous = new ClousClient({
      envPath,
      logLevel: 'error',
      store: {
        directory: path.join(tempDir, 'store'),
        walEnabled: true,
        autoCheckpoint: false,
      },
      transfer: {
        retryAttempts: 2,
        retryDelay: 10,
      },
      pipeline: {
        batchSize: 10,
        concurrency: 2,
      },
    });

    await clous.init();
  });

  afterEach(async () => {
    await clous.shutdown();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('should initialize and shutdown correctly', () => {
    expect(clous.isInitialized()).toBe(true);
  });

  test('should throw if initialized twice', async () => {
    await expect(clous.init()).rejects.toThrow('already initialized');
  });

  test('should read config from .env', () => {
    expect(clous.config.get('CLOUS_ENV')).toBe('test');
    expect(clous.config.getBoolean('CLOUS_WAL_ENABLED')).toBe(true);
  });

  test('full pipeline workflow: transform → filter → validate → execute', async () => {
    const users = [
      { name: 'Alice', age: 28, email: 'alice@test.com' },
      { name: 'Bob', age: 17, email: 'bob@test.com' },
      { name: 'Charlie', age: 35, email: 'charlie@test.com' },
      { name: '', age: 22, email: 'invalid' },
    ];

    const result = await clous.pipeline(users)
      .transform((user: any) => ({
        ...user,
        name: user.name.trim().toUpperCase(),
      }))
      .filter((user: any) => user.age >= 18)
      .filter((user: any) => user.name.length > 0)
      .execute();

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data[0].name).toBe('ALICE');
    expect(result.data[1].name).toBe('CHARLIE');
    expect(result.metadata.checksum).toBeTruthy();
  });

  test('full store workflow: save → checkpoint → modify → rollback', async () => {
    // Save initial data
    await clous.store.save('products', 'p1', { name: 'Widget', price: 9.99 });
    await clous.store.save('products', 'p2', { name: 'Gadget', price: 19.99 });

    // Checkpoint
    const cp = await clous.store.checkpoint();

    // Modify data
    await clous.store.save('products', 'p1', { name: 'Widget Pro', price: 14.99 });
    await clous.store.delete('products', 'p2');
    await clous.store.save('products', 'p3', { name: 'New Item', price: 29.99 });

    // Verify modifications
    expect(clous.store.get('products', 'p1').price).toBe(14.99);
    expect(clous.store.has('products', 'p2')).toBe(false);
    expect(clous.store.has('products', 'p3')).toBe(true);

    // Rollback
    await clous.store.rollback(cp.id);

    // Verify rollback
    expect(clous.store.get('products', 'p1').price).toBe(9.99);
    expect(clous.store.has('products', 'p2')).toBe(true);
    expect(clous.store.has('products', 'p3')).toBe(false);
  });

  test('full transfer workflow with custom handler', async () => {
    const received: any[] = [];

    const result = await clous.transfer.send({
      destination: 'mock://my-api',
      data: { users: ['Alice', 'Bob'] },
      handler: async (req) => {
        received.push(req.data);
        return {
          success: true,
          statusCode: 200,
          data: { stored: true },
          checksum: '',
          duration: 1,
          attempts: 1,
        };
      },
    });

    expect(result.success).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0].users).toEqual(['Alice', 'Bob']);
  });

  test('pipeline + store integration', async () => {
    // Process data through pipeline
    const rawOrders = [
      { id: 1, amount: 100, status: 'pending' },
      { id: 2, amount: 250, status: 'pending' },
      { id: 3, amount: 50, status: 'cancelled' },
    ];

    const result = await clous.pipeline(rawOrders)
      .filter((order: any) => order.status !== 'cancelled')
      .transform((order: any) => ({
        ...order,
        status: 'processed',
        processedAt: Date.now(),
      }))
      .execute();

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);

    // Store processed data
    for (const order of result.data) {
      await clous.store.save('orders', `order-${order.id}`, order);
    }

    expect(clous.store.size('orders')).toBe(2);
    expect(clous.store.get('orders', 'order-1').status).toBe('processed');
  });

  test('event system integration', async () => {
    const events: string[] = [];

    clous.events.on('pipeline:start', () => events.push('pipeline:start'));
    clous.events.on('pipeline:complete', () => events.push('pipeline:complete'));
    clous.events.on('store:write', () => events.push('store:write'));
    clous.events.on('store:checkpoint', () => events.push('store:checkpoint'));

    // Pipeline
    await clous.pipeline([1, 2, 3])
      .transform((x: number) => x * 2)
      .execute();

    // Store
    await clous.store.save('test', 'k1', {});
    await clous.store.checkpoint();

    expect(events).toContain('pipeline:start');
    expect(events).toContain('pipeline:complete');
    expect(events).toContain('store:write');
    expect(events).toContain('store:checkpoint');
  });

  test('store stats', async () => {
    await clous.store.save('a', '1', { data: true });
    await clous.store.save('a', '2', { data: true });
    await clous.store.save('b', '1', { data: true });

    const stats = clous.store.stats();

    expect(stats.collections).toBe(2);
    expect(stats.totalItems).toBe(3);
    expect(stats.walEntries).toBeGreaterThanOrEqual(0);
    expect(stats.sizeBytes).toBeGreaterThan(0);
  });

  test('should set log level at runtime', () => {
    clous.setLogLevel('debug');
    clous.setLogLevel('error');
    // No assertion needed — just verifying it doesn't throw
  });
});
