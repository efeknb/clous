// ============================================
// Clous — SafeStore (Data Loss Prevention)
// ============================================

import * as fs from 'fs';
import * as path from 'path';
import { WriteAheadLog } from './WriteAheadLog';
import { CheckpointManager } from './CheckpointManager';
import { EventBus } from '../utils/EventBus';
import type { ModuleLogger } from '../utils/Logger';
import type { StoreConfig, Checkpoint, StoreStats } from '../types';

/**
 * SafeStore — Durable key-value store with WAL, checkpoint/rollback,
 * and atomic write operations to prevent data loss.
 *
 * Data is organized into collections (namespaces).
 * All mutations go through the WAL before being applied.
 */
export class SafeStore {
  private data: Map<string, Map<string, any>> = new Map();
  private wal: WriteAheadLog;
  private checkpointMgr: CheckpointManager;
  private directory: string;
  private walEnabled: boolean;
  private initialized: boolean = false;

  constructor(
    private events: EventBus,
    private logger: ModuleLogger,
    private config: StoreConfig = {},
  ) {
    this.directory = config.directory || './clous-data';
    this.walEnabled = config.walEnabled !== false; // Default: true

    this.wal = new WriteAheadLog(
      this.directory,
      logger,
      config.maxWalEntries || 10000,
    );

    this.checkpointMgr = new CheckpointManager(this.directory, logger);
  }

  /**
   * Initialize the store — load WAL, recover uncommitted operations,
   * restore from latest checkpoint if available.
   */
  async init(): Promise<void> {
    // Ensure directory exists
    if (!fs.existsSync(this.directory)) {
      fs.mkdirSync(this.directory, { recursive: true });
    }

    // Initialize WAL
    if (this.walEnabled) {
      await this.wal.init();
    }

    // Initialize checkpoint manager
    await this.checkpointMgr.init();

    // Try to restore from latest checkpoint
    const latestCheckpoint = this.checkpointMgr.getLatest();
    if (latestCheckpoint) {
      try {
        const snapshot = await this.checkpointMgr.restore(latestCheckpoint.id);
        this.loadSnapshot(snapshot);
        this.logger.info(`Restored from checkpoint: ${latestCheckpoint.id}`);
      } catch (error) {
        this.logger.warn('Failed to restore from checkpoint, starting with empty store');
      }
    }

    // Replay uncommitted WAL entries (crash recovery)
    if (this.walEnabled) {
      const uncommitted = this.wal.getUncommitted();
      if (uncommitted.length > 0) {
        this.logger.info(`Recovering ${uncommitted.length} uncommitted WAL entries`);
        for (const entry of uncommitted) {
          this.replayWalEntry(entry);
          await this.wal.commit(entry.id);
        }
      }
    }

    // Start auto-checkpoint if configured
    if (this.config.autoCheckpoint !== false && this.config.checkpointInterval) {
      this.checkpointMgr.startAutoCheckpoint(
        this.config.checkpointInterval,
        () => this.getSnapshot(),
        this.wal.getPosition(),
      );
    }

    this.initialized = true;
    this.logger.info('SafeStore initialized');
  }

  /**
   * Save a value to a collection.
   * The operation is first logged to the WAL, then applied.
   */
  async save(collection: string, key: string, value: any): Promise<void> {
    this.ensureInitialized();

    const existing = this.get(collection, key);

    // WAL: log the operation first
    if (this.walEnabled) {
      const entry = await this.wal.append('SET', collection, key, value, existing);
      // Apply the change
      this.setInternal(collection, key, value);
      // Mark as committed
      await this.wal.commit(entry.id);
      this.events.emit('store:wal:write', entry);
    } else {
      this.setInternal(collection, key, value);
    }

    // Persist to disk atomically
    await this.persistCollection(collection);

    this.events.emit('store:write', collection, key);
    this.logger.debug(`Saved: ${collection}/${key}`);
  }

  /**
   * Save multiple key-value pairs atomically.
   */
  async saveBatch(
    collection: string,
    items: Array<{ key: string; value: any }>,
  ): Promise<void> {
    this.ensureInitialized();

    const previousItems = items.map((item) => ({
      key: item.key,
      previousValue: this.get(collection, item.key),
    }));

    if (this.walEnabled) {
      const entry = await this.wal.append(
        'BATCH',
        collection,
        `batch-${items.length}`,
        items,
        previousItems,
      );

      for (const item of items) {
        this.setInternal(collection, item.key, item.value);
      }

      await this.wal.commit(entry.id);
      this.events.emit('store:wal:write', entry);
    } else {
      for (const item of items) {
        this.setInternal(collection, item.key, item.value);
      }
    }

    await this.persistCollection(collection);

    for (const item of items) {
      this.events.emit('store:write', collection, item.key);
    }

    this.logger.debug(`Batch saved: ${collection} (${items.length} items)`);
  }

  /**
   * Get a value from a collection.
   */
  get(collection: string, key: string): any | undefined {
    const col = this.data.get(collection);
    if (!col) return undefined;
    return col.get(key);
  }

  /**
   * Check if a key exists in a collection.
   */
  has(collection: string, key: string): boolean {
    const col = this.data.get(collection);
    if (!col) return false;
    return col.has(key);
  }

  /**
   * Delete a key from a collection.
   */
  async delete(collection: string, key: string): Promise<boolean> {
    this.ensureInitialized();

    const existing = this.get(collection, key);
    if (existing === undefined) return false;

    if (this.walEnabled) {
      const entry = await this.wal.append('DELETE', collection, key, undefined, existing);
      this.deleteInternal(collection, key);
      await this.wal.commit(entry.id);
      this.events.emit('store:wal:write', entry);
    } else {
      this.deleteInternal(collection, key);
    }

    await this.persistCollection(collection);

    this.events.emit('store:delete', collection, key);
    this.logger.debug(`Deleted: ${collection}/${key}`);
    return true;
  }

  /**
   * Get all keys in a collection.
   */
  keys(collection: string): string[] {
    const col = this.data.get(collection);
    if (!col) return [];
    return Array.from(col.keys());
  }

  /**
   * Get all values in a collection.
   */
  values(collection: string): any[] {
    const col = this.data.get(collection);
    if (!col) return [];
    return Array.from(col.values());
  }

  /**
   * Get all entries in a collection as key-value pairs.
   */
  entries(collection: string): Array<[string, any]> {
    const col = this.data.get(collection);
    if (!col) return [];
    return Array.from(col.entries());
  }

  /**
   * Get a list of all collection names.
   */
  collections(): string[] {
    return Array.from(this.data.keys());
  }

  /**
   * Get the number of items in a collection.
   */
  size(collection: string): number {
    const col = this.data.get(collection);
    return col ? col.size : 0;
  }

  /**
   * Create a manual checkpoint.
   */
  async checkpoint(): Promise<Checkpoint> {
    this.ensureInitialized();
    const snapshot = this.getSnapshot();
    const cp = await this.checkpointMgr.create(snapshot, this.wal.getPosition());
    this.events.emit('store:checkpoint', cp);
    return cp;
  }

  /**
   * Rollback to a specific checkpoint.
   */
  async rollback(checkpointId: string): Promise<void> {
    this.ensureInitialized();

    const snapshot = await this.checkpointMgr.restore(checkpointId);
    this.data.clear();
    this.loadSnapshot(snapshot);

    // Clear WAL entries after rollback
    if (this.walEnabled) {
      await this.wal.clear();
    }

    // Persist all collections
    for (const collection of this.data.keys()) {
      await this.persistCollection(collection);
    }

    this.events.emit('store:rollback', checkpointId);
    this.logger.info(`Rolled back to checkpoint: ${checkpointId}`);
  }

  /**
   * List all available checkpoints.
   */
  listCheckpoints(): Checkpoint[] {
    return this.checkpointMgr.list();
  }

  /**
   * Get store statistics.
   */
  stats(): StoreStats {
    let totalItems = 0;
    for (const col of this.data.values()) {
      totalItems += col.size;
    }

    const latestCp = this.checkpointMgr.getLatest();
    const sizeBytes = Buffer.byteLength(JSON.stringify(this.getSnapshot()), 'utf8');

    return {
      collections: this.data.size,
      totalItems,
      walEntries: this.wal.size,
      checkpoints: this.checkpointMgr.count,
      sizeBytes,
      lastCheckpoint: latestCp ? latestCp.timestamp : null,
    };
  }

  /**
   * Clear all data in a collection.
   */
  async clearCollection(collection: string): Promise<void> {
    this.ensureInitialized();
    this.data.delete(collection);

    const collectionFile = path.join(this.directory, `${collection}.json`);
    if (fs.existsSync(collectionFile)) {
      fs.unlinkSync(collectionFile);
    }

    this.logger.info(`Collection cleared: ${collection}`);
  }

  /**
   * Clear all store data.
   */
  async clearAll(): Promise<void> {
    this.ensureInitialized();

    for (const collection of this.data.keys()) {
      await this.clearCollection(collection);
    }

    if (this.walEnabled) {
      await this.wal.clear();
    }

    this.data.clear();
    this.logger.info('All store data cleared');
  }

  /**
   * Shutdown the store gracefully.
   * Creates a final checkpoint and closes WAL.
   */
  async close(): Promise<void> {
    if (!this.initialized) return;

    // Create final checkpoint
    try {
      await this.checkpoint();
    } catch (error) {
      this.logger.warn('Failed to create final checkpoint on close');
    }

    await this.checkpointMgr.close();

    if (this.walEnabled) {
      await this.wal.close();
    }

    this.initialized = false;
    this.logger.info('SafeStore closed');
  }

  // ── Private ──────────────────────────────────

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('SafeStore is not initialized. Call init() first.');
    }
  }

  private setInternal(collection: string, key: string, value: any): void {
    if (!this.data.has(collection)) {
      this.data.set(collection, new Map());
    }
    this.data.get(collection)!.set(key, value);
  }

  private deleteInternal(collection: string, key: string): void {
    const col = this.data.get(collection);
    if (col) {
      col.delete(key);
      if (col.size === 0) {
        this.data.delete(collection);
      }
    }
  }

  private getSnapshot(): Record<string, Record<string, any>> {
    const snapshot: Record<string, Record<string, any>> = {};
    for (const [collection, items] of this.data) {
      snapshot[collection] = {};
      for (const [key, value] of items) {
        snapshot[collection][key] = value;
      }
    }
    return snapshot;
  }

  private loadSnapshot(snapshot: Record<string, Record<string, any>>): void {
    for (const [collection, items] of Object.entries(snapshot)) {
      const map = new Map<string, any>();
      for (const [key, value] of Object.entries(items)) {
        map.set(key, value);
      }
      this.data.set(collection, map);
    }
  }

  private replayWalEntry(entry: any): void {
    switch (entry.operation) {
      case 'SET':
      case 'UPDATE':
        if (entry.data) {
          this.setInternal(entry.collection, entry.key, JSON.parse(entry.data));
        }
        break;
      case 'DELETE':
        this.deleteInternal(entry.collection, entry.key);
        break;
      case 'BATCH':
        if (entry.data) {
          const items = JSON.parse(entry.data);
          for (const item of items) {
            this.setInternal(entry.collection, item.key, item.value);
          }
        }
        break;
    }
  }

  /**
   * Persist a collection to disk using atomic write (temp file → rename).
   */
  private async persistCollection(collection: string): Promise<void> {
    const col = this.data.get(collection);
    if (!col) return;

    const data: Record<string, any> = {};
    for (const [key, value] of col) {
      data[key] = value;
    }

    const filePath = path.join(this.directory, `${collection}.json`);
    const tempPath = `${filePath}.${process.pid}.tmp`;

    try {
      // Write to temp file first (atomic write pattern)
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
      // Rename temp → final (atomic on most filesystems)
      fs.renameSync(tempPath, filePath);
    } catch (error) {
      // Clean up temp file on failure
      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // Ignore cleanup errors
        }
      }
      this.logger.error(`Failed to persist collection: ${collection}`, {
        error: (error as Error).message,
      });
      throw error;
    }
  }
}
