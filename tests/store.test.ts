// ============================================
// Clous — SafeStore, WAL & Checkpoint Tests
// ============================================

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SafeStore } from '../src/store/SafeStore';
import { WriteAheadLog } from '../src/store/WriteAheadLog';
import { CheckpointManager } from '../src/store/CheckpointManager';
import { EventBus } from '../src/utils/EventBus';
import { Logger } from '../src/utils/Logger';

const logger = new Logger('error');

describe('WriteAheadLog', () => {
  let wal: WriteAheadLog;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clous-wal-test-'));
    wal = new WriteAheadLog(tempDir, logger.child('WAL'));
    await wal.init();
  });

  afterEach(async () => {
    await wal.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('should append entries', async () => {
    const entry = await wal.append('SET', 'users', 'user-1', { name: 'John' });

    expect(entry.id).toBeTruthy();
    expect(entry.operation).toBe('SET');
    expect(entry.collection).toBe('users');
    expect(entry.key).toBe('user-1');
    expect(entry.committed).toBe(false);
    expect(entry.checksum).toBeTruthy();
    expect(wal.size).toBe(1);
  });

  test('should commit entries', async () => {
    const entry = await wal.append('SET', 'users', 'user-1', { name: 'John' });
    await wal.commit(entry.id);

    const uncommitted = wal.getUncommitted();
    expect(uncommitted).toHaveLength(0);
  });

  test('should track uncommitted entries', async () => {
    await wal.append('SET', 'users', 'user-1', { name: 'A' });
    const entry2 = await wal.append('SET', 'users', 'user-2', { name: 'B' });
    await wal.commit(entry2.id);

    const uncommitted = wal.getUncommitted();
    expect(uncommitted).toHaveLength(1);
    expect(uncommitted[0].key).toBe('user-1');
  });

  test('should persist to disk and reload', async () => {
    const entry = await wal.append('SET', 'test', 'key-1', { value: 42 });
    await wal.commit(entry.id);
    await wal.close();

    // Reload
    const wal2 = new WriteAheadLog(tempDir, logger.child('WAL'));
    await wal2.init();

    expect(wal2.size).toBe(1);
    const entries = wal2.getEntries();
    expect(entries[0].key).toBe('key-1');

    await wal2.close();
  });

  test('should compact committed entries', async () => {
    const e1 = await wal.append('SET', 'a', '1', {});
    const e2 = await wal.append('SET', 'a', '2', {});
    await wal.append('SET', 'a', '3', {});

    await wal.commit(e1.id);
    await wal.commit(e2.id);

    const removed = await wal.compact();

    expect(removed).toBe(2);
    expect(wal.size).toBe(1);
  });

  test('should clear all entries', async () => {
    await wal.append('SET', 'a', '1', {});
    await wal.append('SET', 'a', '2', {});

    await wal.clear();

    expect(wal.size).toBe(0);
  });

  test('should get entries since position', async () => {
    await wal.append('SET', 'a', '1', {});
    await wal.append('SET', 'a', '2', {});
    await wal.append('SET', 'a', '3', {});

    const since = wal.getEntriesSince(1);
    expect(since).toHaveLength(2);
  });
});

describe('CheckpointManager', () => {
  let cpMgr: CheckpointManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clous-cp-test-'));
    cpMgr = new CheckpointManager(tempDir, logger.child('Checkpoint'));
    await cpMgr.init();
  });

  afterEach(async () => {
    await cpMgr.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('should create checkpoint', async () => {
    const snapshot = { users: { 'u1': { name: 'John' } } };
    const cp = await cpMgr.create(snapshot, 5);

    expect(cp.id).toBeTruthy();
    expect(cp.walPosition).toBe(5);
    expect(cp.checksum).toBeTruthy();
    expect(cpMgr.count).toBe(1);
  });

  test('should restore from checkpoint', async () => {
    const snapshot = { 
      users: { 'u1': { name: 'John' }, 'u2': { name: 'Jane' } },
      settings: { 'theme': { value: 'dark' } },
    };
    const cp = await cpMgr.create(snapshot, 0);
    const restored = await cpMgr.restore(cp.id);

    expect(restored).toEqual(snapshot);
  });

  test('should get latest checkpoint', async () => {
    await cpMgr.create({ a: {} }, 1);
    await cpMgr.create({ b: {} }, 2);
    const cp3 = await cpMgr.create({ c: {} }, 3);

    const latest = cpMgr.getLatest();
    expect(latest?.id).toBe(cp3.id);
  });

  test('should list checkpoints', async () => {
    await cpMgr.create({ a: {} }, 1);
    await cpMgr.create({ b: {} }, 2);

    const list = cpMgr.list();
    expect(list).toHaveLength(2);
  });

  test('should delete checkpoint', async () => {
    const cp = await cpMgr.create({ a: {} }, 1);
    await cpMgr.delete(cp.id);

    expect(cpMgr.count).toBe(0);
    await expect(cpMgr.restore(cp.id)).rejects.toThrow('Checkpoint not found');
  });

  test('should throw on non-existent checkpoint restore', async () => {
    await expect(cpMgr.restore('non-existent-id')).rejects.toThrow('not found');
  });

  test('should detect integrity corruption', async () => {
    const cp = await cpMgr.create({ a: { k: 'v' } }, 0);

    // Corrupt the file
    const cpFile = path.join(tempDir, 'checkpoints', `${cp.id}.json`);
    fs.writeFileSync(cpFile, '{"corrupted": true}', 'utf8');

    await expect(cpMgr.restore(cp.id)).rejects.toThrow('integrity');
  });
});

describe('SafeStore', () => {
  let store: SafeStore;
  let events: EventBus;
  let tempDir: string;

  beforeEach(async () => {
    events = new EventBus();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clous-store-test-'));
    store = new SafeStore(events, logger.child('Store'), {
      directory: tempDir,
      walEnabled: true,
      autoCheckpoint: false,
    });
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('should save and get data', async () => {
    await store.save('users', 'u1', { name: 'John', age: 30 });

    const user = store.get('users', 'u1');
    expect(user).toEqual({ name: 'John', age: 30 });
  });

  test('should check existence', async () => {
    await store.save('users', 'u1', { name: 'John' });

    expect(store.has('users', 'u1')).toBe(true);
    expect(store.has('users', 'u2')).toBe(false);
    expect(store.has('other', 'u1')).toBe(false);
  });

  test('should delete data', async () => {
    await store.save('users', 'u1', { name: 'John' });
    const deleted = await store.delete('users', 'u1');

    expect(deleted).toBe(true);
    expect(store.has('users', 'u1')).toBe(false);
  });

  test('should return false when deleting non-existent key', async () => {
    const deleted = await store.delete('users', 'non-existent');
    expect(deleted).toBe(false);
  });

  test('should list keys and values', async () => {
    await store.save('items', 'a', { v: 1 });
    await store.save('items', 'b', { v: 2 });
    await store.save('items', 'c', { v: 3 });

    expect(store.keys('items')).toEqual(['a', 'b', 'c']);
    expect(store.values('items')).toEqual([{ v: 1 }, { v: 2 }, { v: 3 }]);
    expect(store.size('items')).toBe(3);
  });

  test('should list collections', async () => {
    await store.save('users', 'u1', {});
    await store.save('orders', 'o1', {});
    await store.save('products', 'p1', {});

    const cols = store.collections();
    expect(cols.sort()).toEqual(['orders', 'products', 'users']);
  });

  test('should save batch atomically', async () => {
    await store.saveBatch('users', [
      { key: 'u1', value: { name: 'A' } },
      { key: 'u2', value: { name: 'B' } },
      { key: 'u3', value: { name: 'C' } },
    ]);

    expect(store.size('users')).toBe(3);
    expect(store.get('users', 'u2')).toEqual({ name: 'B' });
  });

  test('should create and rollback checkpoint', async () => {
    await store.save('data', 'k1', { v: 'original' });
    const cp = await store.checkpoint();

    // Modify data
    await store.save('data', 'k1', { v: 'modified' });
    await store.save('data', 'k2', { v: 'new' });

    expect(store.get('data', 'k1')).toEqual({ v: 'modified' });

    // Rollback
    await store.rollback(cp.id);

    expect(store.get('data', 'k1')).toEqual({ v: 'original' });
    expect(store.has('data', 'k2')).toBe(false);
  });

  test('should list checkpoints', async () => {
    await store.checkpoint();
    await store.checkpoint();

    const checkpoints = store.listCheckpoints();
    expect(checkpoints).toHaveLength(2);
  });

  test('should emit store events', async () => {
    const emitted: string[] = [];
    events.on('store:write', () => emitted.push('write'));
    events.on('store:delete', () => emitted.push('delete'));
    events.on('store:checkpoint', () => emitted.push('checkpoint'));

    await store.save('a', 'k', {});
    await store.delete('a', 'k');
    await store.checkpoint();

    expect(emitted).toContain('write');
    expect(emitted).toContain('delete');
    expect(emitted).toContain('checkpoint');
  });

  test('should get stats', async () => {
    await store.save('users', 'u1', {});
    await store.save('users', 'u2', {});
    await store.save('orders', 'o1', {});

    const stats = store.stats();
    expect(stats.collections).toBe(2);
    expect(stats.totalItems).toBe(3);
    expect(stats.sizeBytes).toBeGreaterThan(0);
  });

  test('should clear collection', async () => {
    await store.save('temp', 'a', {});
    await store.save('temp', 'b', {});

    await store.clearCollection('temp');

    expect(store.size('temp')).toBe(0);
    expect(store.collections()).not.toContain('temp');
  });

  test('should persist and recover data', async () => {
    await store.save('persist', 'k1', { important: 'data' });
    await store.checkpoint();
    await store.close();

    // Create new store pointing to same directory
    const store2 = new SafeStore(events, logger.child('Store'), {
      directory: tempDir,
      walEnabled: true,
      autoCheckpoint: false,
    });
    await store2.init();

    expect(store2.get('persist', 'k1')).toEqual({ important: 'data' });

    await store2.close();
  });

  test('should throw if not initialized', async () => {
    const uninitStore = new SafeStore(events, logger.child('Store'), {
      directory: tempDir,
    });

    expect(() => uninitStore.get('a', 'b')).not.toThrow(); // get doesn't require init
    await expect(uninitStore.save('a', 'b', {})).rejects.toThrow('not initialized');
  });
});
