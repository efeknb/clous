// ============================================
// Clous — CheckpointManager
// ============================================

import * as fs from 'fs';
import * as path from 'path';
import { Checksum } from '../utils/Checksum';
import type { ModuleLogger } from '../utils/Logger';
import type { Checkpoint } from '../types';

const CHECKPOINT_DIR = 'checkpoints';
const CHECKPOINT_INDEX = 'checkpoint-index.json';

/**
 * Manages periodic and manual data checkpoints for SafeStore.
 * Snapshots are saved to disk and can be used to restore state.
 */
export class CheckpointManager {
  private checkpoints: Checkpoint[] = [];
  private checkpointDir: string;
  private indexPath: string;
  private autoTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private directory: string,
    private logger: ModuleLogger,
  ) {
    this.checkpointDir = path.join(directory, CHECKPOINT_DIR);
    this.indexPath = path.join(this.checkpointDir, CHECKPOINT_INDEX);
  }

  /**
   * Initialize — create directory and load existing checkpoints.
   */
  async init(): Promise<void> {
    if (!fs.existsSync(this.checkpointDir)) {
      fs.mkdirSync(this.checkpointDir, { recursive: true });
    }

    // Load checkpoint index
    if (fs.existsSync(this.indexPath)) {
      try {
        const indexData = fs.readFileSync(this.indexPath, 'utf8');
        this.checkpoints = JSON.parse(indexData);
        this.logger.info(`Loaded ${this.checkpoints.length} checkpoint(s)`);
      } catch (error) {
        this.logger.warn('Failed to load checkpoint index, starting fresh');
        this.checkpoints = [];
      }
    }
  }

  /**
   * Start auto-checkpoint at the given interval.
   */
  startAutoCheckpoint(
    intervalMs: number,
    snapshotProvider: () => Record<string, Record<string, any>>,
    walPosition: number,
  ): void {
    this.stopAutoCheckpoint();
    this.autoTimer = setInterval(async () => {
      try {
        await this.create(snapshotProvider(), walPosition);
      } catch (error) {
        this.logger.error('Auto-checkpoint failed', {
          error: (error as Error).message,
        });
      }
    }, intervalMs);
    this.logger.info(`Auto-checkpoint started (interval: ${intervalMs}ms)`);
  }

  /**
   * Stop auto-checkpoint.
   */
  stopAutoCheckpoint(): void {
    if (this.autoTimer) {
      clearInterval(this.autoTimer);
      this.autoTimer = null;
      this.logger.debug('Auto-checkpoint stopped');
    }
  }

  /**
   * Create a new checkpoint from the current data snapshot.
   */
  async create(
    snapshot: Record<string, Record<string, any>>,
    walPosition: number,
  ): Promise<Checkpoint> {
    const serialized = JSON.stringify(snapshot);

    const checkpoint: Checkpoint = {
      id: Checksum.generateId(),
      timestamp: Date.now(),
      snapshot,
      walPosition,
      checksum: Checksum.sha256(serialized),
    };

    // Save checkpoint data to disk
    const checkpointFile = path.join(this.checkpointDir, `${checkpoint.id}.json`);
    fs.writeFileSync(checkpointFile, serialized, 'utf8');

    // Add to index (keep summary without snapshot)
    this.checkpoints.push({
      ...checkpoint,
      snapshot: {}, // Don't store full snapshot in index
    });

    // Save index
    this.saveIndex();

    this.logger.info(`Checkpoint created: ${checkpoint.id}`, {
      walPosition,
      collections: Object.keys(snapshot).length,
    });

    return checkpoint;
  }

  /**
   * Restore data from a checkpoint.
   * Returns the full snapshot data.
   */
  async restore(checkpointId: string): Promise<Record<string, Record<string, any>>> {
    const checkpointMeta = this.checkpoints.find((c) => c.id === checkpointId);
    if (!checkpointMeta) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    const checkpointFile = path.join(this.checkpointDir, `${checkpointId}.json`);
    if (!fs.existsSync(checkpointFile)) {
      throw new Error(`Checkpoint file missing: ${checkpointFile}`);
    }

    const data = fs.readFileSync(checkpointFile, 'utf8');

    // Verify integrity
    const checksum = Checksum.sha256(data);
    if (checksum !== checkpointMeta.checksum) {
      throw new Error(`Checkpoint integrity check failed: ${checkpointId}`);
    }

    const snapshot = JSON.parse(data);
    this.logger.info(`Checkpoint restored: ${checkpointId}`);

    return snapshot;
  }

  /**
   * Get the latest checkpoint metadata.
   */
  getLatest(): Checkpoint | null {
    if (this.checkpoints.length === 0) return null;
    return this.checkpoints[this.checkpoints.length - 1];
  }

  /**
   * List all checkpoint metadata.
   */
  list(): Checkpoint[] {
    return [...this.checkpoints];
  }

  /**
   * Delete a checkpoint.
   */
  async delete(checkpointId: string): Promise<void> {
    const idx = this.checkpoints.findIndex((c) => c.id === checkpointId);
    if (idx === -1) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    // Remove file
    const checkpointFile = path.join(this.checkpointDir, `${checkpointId}.json`);
    if (fs.existsSync(checkpointFile)) {
      fs.unlinkSync(checkpointFile);
    }

    // Remove from index
    this.checkpoints.splice(idx, 1);
    this.saveIndex();

    this.logger.info(`Checkpoint deleted: ${checkpointId}`);
  }

  /**
   * Delete all checkpoints older than a given age in milliseconds.
   */
  async prune(maxAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
    const toDelete = this.checkpoints.filter((c) => c.timestamp < cutoff);

    for (const cp of toDelete) {
      const file = path.join(this.checkpointDir, `${cp.id}.json`);
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }

    this.checkpoints = this.checkpoints.filter((c) => c.timestamp >= cutoff);
    this.saveIndex();

    this.logger.info(`Pruned ${toDelete.length} old checkpoint(s)`);
    return toDelete.length;
  }

  /**
   * Get the number of checkpoints.
   */
  get count(): number {
    return this.checkpoints.length;
  }

  /**
   * Shutdown — stop auto-checkpoint.
   */
  async close(): Promise<void> {
    this.stopAutoCheckpoint();
  }

  // ── Private ──────────────────────────────────

  private saveIndex(): void {
    try {
      fs.writeFileSync(this.indexPath, JSON.stringify(this.checkpoints, null, 2), 'utf8');
    } catch (error) {
      this.logger.error('Failed to save checkpoint index', {
        error: (error as Error).message,
      });
    }
  }
}
