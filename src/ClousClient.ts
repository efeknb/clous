// ============================================
// Clous — Main Client
// ============================================

import { ConfigManager } from './config/ConfigManager';
import { DataPipeline } from './pipeline/DataPipeline';
import { SafeStore } from './store/SafeStore';
import { TransferEngine } from './transfer/TransferEngine';
import { EventBus } from './utils/EventBus';
import { Logger } from './utils/Logger';
import type { ClousConfig } from './types';

/**
 * ClousClient — Main entry point for the Clous module.
 *
 * Orchestrates all subsystems: ConfigManager, DataPipeline,
 * SafeStore, and TransferEngine.
 *
 * @example
 * ```typescript
 * import { ClousClient } from 'clous';
 *
 * const clous = new ClousClient({
 *   envPath: './.env',
 *   logLevel: 'info',
 *   store: { walEnabled: true, checkpointInterval: 30000 },
 *   transfer: { retryAttempts: 5 },
 * });
 *
 * await clous.init();
 *
 * // Use pipeline
 * const result = await clous.pipeline(data)
 *   .transform(item => normalize(item))
 *   .validate([{ field: 'name', rules: [{ type: 'required' }] }])
 *   .execute();
 *
 * // Use store
 * await clous.store.save('users', 'user-1', { name: 'John' });
 *
 * // Use transfer
 * await clous.transfer.send({ destination: 'https://api.example.com', data: result.data });
 *
 * await clous.shutdown();
 * ```
 */
export class ClousClient {
  /** Event bus for subscribing to all Clous events */
  public readonly events: EventBus;

  /** Configuration manager with .env support */
  public readonly config: ConfigManager;

  /** Safe data store with WAL, checkpoint, and rollback */
  public readonly store: SafeStore;

  /** Reliable data transfer engine */
  public readonly transfer: TransferEngine;

  private readonly logger: Logger;
  private readonly clousConfig: ClousConfig;
  private initialized: boolean = false;

  constructor(config: ClousConfig = {}) {
    this.clousConfig = config;

    // Initialize core utilities
    this.events = new EventBus();
    this.logger = new Logger(config.logLevel || 'info');

    // Initialize subsystems
    this.config = new ConfigManager(
      this.events,
      this.logger.child('Config'),
      {
        envPath: config.envPath,
        encryptionKey: config.encryptionKey,
        env: config.env,
      },
    );

    this.store = new SafeStore(
      this.events,
      this.logger.child('Store'),
      config.store || {},
    );

    this.transfer = new TransferEngine(
      this.events,
      this.logger.child('Transfer'),
      config.transfer || {},
    );
  }

  /**
   * Initialize all subsystems.
   * Loads configuration, initializes the store, and prepares the transfer engine.
   */
  async init(): Promise<void> {
    if (this.initialized) {
      throw new Error('ClousClient is already initialized');
    }

    const startTime = Date.now();
    this.logger.info('Clous initializing...');

    try {
      // Load configuration
      await this.config.load();

      // Apply config defaults from .env
      this.applyEnvDefaults();

      // Initialize safe store
      await this.store.init();

      this.initialized = true;
      const duration = Date.now() - startTime;
      this.logger.info(`Clous initialized in ${duration}ms`);
    } catch (error) {
      this.logger.error('Failed to initialize Clous', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Create a new data pipeline with the given input data.
   *
   * @example
   * ```typescript
   * const result = await clous.pipeline(myData)
   *   .transform(normalizeItem)
   *   .filter(item => item.active)
   *   .validate([{ field: 'email', rules: [{ type: 'required' }] }])
   *   .execute();
   * ```
   */
  pipeline<T>(data: T): DataPipeline {
    this.ensureInitialized();
    const pl = new DataPipeline(
      this.events,
      this.logger.child('Pipeline'),
      this.clousConfig.pipeline || {},
    );
    return pl.from(data);
  }

  /**
   * Create a standalone data pipeline (without initial data).
   * Call `.from(data)` to set input data later.
   */
  createPipeline(): DataPipeline {
    this.ensureInitialized();
    return new DataPipeline(
      this.events,
      this.logger.child('Pipeline'),
      this.clousConfig.pipeline || {},
    );
  }

  /**
   * Check if the client is initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Set log level at runtime.
   */
  setLogLevel(level: 'error' | 'warn' | 'info' | 'debug' | 'verbose'): void {
    this.logger.setLevel(level);
  }

  /**
   * Gracefully shutdown all subsystems.
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    this.logger.info('Clous shutting down...');

    try {
      // Close store (creates final checkpoint)
      await this.store.close();

      // Close transfer engine
      this.transfer.close();

      // Clean up events
      this.events.removeAllListeners();

      this.initialized = false;
      this.logger.info('Clous shutdown complete');
    } catch (error) {
      this.logger.error('Error during shutdown', {
        error: (error as Error).message,
      });
    }
  }

  // ── Private ──────────────────────────────────

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('ClousClient is not initialized. Call init() first.');
    }
  }

  /**
   * Apply .env values to the subsystem configs (for values set via env only).
   */
  private applyEnvDefaults(): void {
    this.config.setDefaults({
      CLOUS_ENV: 'development',
      CLOUS_LOG_LEVEL: 'info',
      CLOUS_STORE_DIR: './clous-data',
      CLOUS_WAL_ENABLED: 'true',
      CLOUS_CHECKPOINT_INTERVAL: '30000',
      CLOUS_TRANSFER_RETRY_ATTEMPTS: '5',
      CLOUS_TRANSFER_RETRY_DELAY: '1000',
      CLOUS_TRANSFER_CIRCUIT_THRESHOLD: '3',
      CLOUS_TRANSFER_CIRCUIT_TIMEOUT: '60000',
      CLOUS_TRANSFER_RATE_MAX: '100',
      CLOUS_TRANSFER_RATE_WINDOW: '60000',
      CLOUS_PIPELINE_BATCH_SIZE: '500',
      CLOUS_PIPELINE_CONCURRENCY: '3',
    });
  }
}
