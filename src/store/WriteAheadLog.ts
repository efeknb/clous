// ============================================
// Clous — WriteAheadLog (WAL)
// ============================================

import * as fs from 'fs';
import * as path from 'path';
import { Checksum } from '../utils/Checksum';
import type { ModuleLogger } from '../utils/Logger';
import type { WALEntry } from '../types';

const WAL_FILE = 'clous.wal';
const WAL_SEPARATOR = '\n';

/**
 * Write-Ahead Log (WAL) for crash recovery and data durability.
 * All operations are first written to the WAL before being applied,
 * ensuring data can be recovered after unexpected failures.
 */
export class WriteAheadLog {
  private walPath: string;
  private entries: WALEntry[] = [];
  private position: number = 0;
  private maxEntries: number;
  private writeStream: fs.WriteStream | null = null;

  constructor(
    private directory: string,
    private logger: ModuleLogger,
    maxEntries: number = 10000,
  ) {
    this.walPath = path.join(directory, WAL_FILE);
    this.maxEntries = maxEntries;
  }

  /**
   * Initialize the WAL — load existing entries from disk.
   */
  async init(): Promise<void> {
    // Ensure directory exists
    if (!fs.existsSync(this.directory)) {
      fs.mkdirSync(this.directory, { recursive: true });
    }

    // Load existing WAL file
    if (fs.existsSync(this.walPath)) {
      await this.loadFromDisk();
      this.logger.info(`WAL loaded with ${this.entries.length} entries`);
    } else {
      this.logger.info('WAL initialized (new)');
    }

    // Open write stream for appending
    this.writeStream = fs.createWriteStream(this.walPath, { flags: 'a' });
  }

  /**
   * Append an operation to the WAL.
   * Returns the WAL entry with assigned ID and checksum.
   */
  async append(
    operation: WALEntry['operation'],
    collection: string,
    key: string,
    data?: any,
    previousData?: any,
  ): Promise<WALEntry> {
    const serializedData = data !== undefined ? JSON.stringify(data) : undefined;
    const serializedPrev = previousData !== undefined ? JSON.stringify(previousData) : undefined;

    const entry: WALEntry = {
      id: Checksum.generateId(),
      timestamp: Date.now(),
      operation,
      collection,
      key,
      data: serializedData,
      previousData: serializedPrev,
      checksum: Checksum.sha256(
        `${operation}:${collection}:${key}:${serializedData || ''}`,
      ),
      committed: false,
    };

    this.entries.push(entry);
    this.position++;

    // Write to disk
    await this.writeToDisk(entry);

    this.logger.debug(`WAL append: ${operation} ${collection}/${key}`, { walId: entry.id });

    // Auto-compact if needed
    if (this.entries.length > this.maxEntries) {
      await this.compact();
    }

    return entry;
  }

  /**
   * Mark a WAL entry as committed.
   */
  async commit(entryId: string): Promise<void> {
    const entry = this.entries.find((e) => e.id === entryId);
    if (entry) {
      entry.committed = true;
      this.logger.debug(`WAL commit: ${entryId}`);
    }
  }

  /**
   * Get uncommitted entries (for crash recovery).
   */
  getUncommitted(): WALEntry[] {
    return this.entries.filter((e) => !e.committed);
  }

  /**
   * Get all entries since a given WAL position.
   */
  getEntriesSince(position: number): WALEntry[] {
    return this.entries.slice(position);
  }

  /**
   * Get the current WAL position.
   */
  getPosition(): number {
    return this.position;
  }

  /**
   * Get all entries.
   */
  getEntries(): WALEntry[] {
    return [...this.entries];
  }

  /**
   * Compact the WAL by removing committed entries.
   * Rewrites the WAL file with only uncommitted entries.
   */
  async compact(): Promise<number> {
    const beforeCount = this.entries.length;
    const uncommitted = this.entries.filter((e) => !e.committed);
    const removed = beforeCount - uncommitted.length;

    if (removed === 0) return 0;

    this.entries = uncommitted;

    // Close current stream
    await this.closeStream();

    // Rewrite WAL file
    const walContent = this.entries
      .map((e) => JSON.stringify(e))
      .join(WAL_SEPARATOR);
    fs.writeFileSync(this.walPath, walContent + (walContent ? WAL_SEPARATOR : ''), 'utf8');

    // Reopen stream
    this.writeStream = fs.createWriteStream(this.walPath, { flags: 'a' });

    this.logger.info(`WAL compacted: removed ${removed} committed entries`);

    return removed;
  }

  /**
   * Clear all WAL entries and the WAL file.
   */
  async clear(): Promise<void> {
    this.entries = [];
    this.position = 0;
    await this.closeStream();
    if (fs.existsSync(this.walPath)) {
      fs.writeFileSync(this.walPath, '', 'utf8');
    }
    this.writeStream = fs.createWriteStream(this.walPath, { flags: 'a' });
    this.logger.info('WAL cleared');
  }

  /**
   * Close the WAL and release resources.
   */
  async close(): Promise<void> {
    await this.closeStream();
    this.logger.debug('WAL closed');
  }

  /**
   * Get the WAL entry count.
   */
  get size(): number {
    return this.entries.length;
  }

  // ── Private ──────────────────────────────────

  private async loadFromDisk(): Promise<void> {
    try {
      const content = fs.readFileSync(this.walPath, 'utf8').trim();
      if (!content) return;

      const lines = content.split(WAL_SEPARATOR);
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry: WALEntry = JSON.parse(line);
          // Verify checksum integrity
          const expectedChecksum = Checksum.sha256(
            `${entry.operation}:${entry.collection}:${entry.key}:${entry.data || ''}`,
          );
          if (entry.checksum !== expectedChecksum) {
            this.logger.warn(`WAL entry ${entry.id} has corrupted checksum, skipping`);
            continue;
          }
          this.entries.push(entry);
          this.position++;
        } catch (parseError) {
          this.logger.warn(`Skipping invalid WAL line: ${(parseError as Error).message}`);
        }
      }
    } catch (error) {
      this.logger.error('Failed to load WAL from disk', {
        error: (error as Error).message,
      });
    }
  }

  private async writeToDisk(entry: WALEntry): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.writeStream) {
        reject(new Error('WAL write stream is not open'));
        return;
      }
      const line = JSON.stringify(entry) + WAL_SEPARATOR;
      this.writeStream.write(line, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async closeStream(): Promise<void> {
    return new Promise((resolve) => {
      if (this.writeStream) {
        this.writeStream.end(() => {
          this.writeStream = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
