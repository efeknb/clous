// ============================================
// Clous — Type Definitions
// ============================================

// ── General ──────────────────────────────────

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'verbose';

export interface ClousConfig {
  /** Path to .env file (default: './.env') */
  envPath?: string;
  /** Log level (default: 'info') */
  logLevel?: LogLevel;
  /** Store configuration */
  store?: StoreConfig;
  /** Transfer engine configuration */
  transfer?: TransferConfig;
  /** Pipeline configuration */
  pipeline?: PipelineConfig;
  /** Encryption key for encrypted .env values */
  encryptionKey?: string;
  /** Environment profile override */
  env?: string;
}

// ── ConfigManager ────────────────────────────

export interface ConfigManagerOptions {
  envPath?: string;
  encryptionKey?: string;
  env?: string;
}

export interface ConfigSchema {
  [key: string]: {
    type: 'string' | 'number' | 'boolean';
    required?: boolean;
    default?: string | number | boolean;
    description?: string;
  };
}

// ── DataPipeline ─────────────────────────────

export type TransformFn<TIn = any, TOut = any> = (data: TIn) => TOut | Promise<TOut>;

export type ValidatorFn<T = any> = (data: T) => ValidationResult;

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  field: string;
  message: string;
  value?: any;
  rule?: string;
}

export interface ValidationRule {
  field: string;
  rules: Array<{
    type: 'required' | 'type' | 'min' | 'max' | 'pattern' | 'custom';
    value?: any;
    message?: string;
    validator?: (value: any) => boolean;
  }>;
}

export interface PipelineConfig {
  /** Default batch size (default: 500) */
  batchSize?: number;
  /** Default concurrency (default: 3) */
  concurrency?: number;
}

export interface BatchOptions {
  /** Number of items per chunk */
  chunkSize?: number;
  /** Number of concurrent chunk processing */
  concurrency?: number;
  /** Progress callback */
  onProgress?: (progress: BatchProgress) => void;
}

export interface BatchProgress {
  /** Total items */
  total: number;
  /** Processed items */
  processed: number;
  /** Failed items */
  failed: number;
  /** Percentage (0-100) */
  percentage: number;
  /** Currently processing chunk index */
  currentChunk: number;
  /** Total chunks */
  totalChunks: number;
}

export interface PipelineResult<T = any> {
  /** Whether the pipeline completed successfully */
  success: boolean;
  /** Resulting data */
  data: T;
  /** Execution metadata */
  metadata: {
    /** Total execution time in ms */
    duration: number;
    /** Number of steps executed */
    stepsExecuted: number;
    /** Items processed */
    itemsProcessed: number;
    /** Checksum of output data */
    checksum: string;
  };
  /** Errors encountered (non-fatal) */
  warnings: string[];
}

// ── SafeStore ────────────────────────────────

export interface StoreConfig {
  /** Directory for store data (default: './clous-data') */
  directory?: string;
  /** Enable WAL (default: true) */
  walEnabled?: boolean;
  /** Checkpoint interval in ms (default: 30000) */
  checkpointInterval?: number;
  /** Maximum WAL entries before compaction */
  maxWalEntries?: number;
  /** Enable auto-checkpoint (default: true) */
  autoCheckpoint?: boolean;
}

export interface WALEntry {
  /** Unique entry ID */
  id: string;
  /** Timestamp of the entry */
  timestamp: number;
  /** Operation type */
  operation: 'SET' | 'DELETE' | 'UPDATE' | 'BATCH';
  /** Data collection/namespace */
  collection: string;
  /** Item key */
  key: string;
  /** Data payload (serialized) */
  data?: string;
  /** Previous data (for rollback) */
  previousData?: string;
  /** Checksum of the data */
  checksum: string;
  /** Whether this entry has been committed */
  committed: boolean;
}

export interface Checkpoint {
  /** Unique checkpoint ID */
  id: string;
  /** Timestamp of creation */
  timestamp: number;
  /** Snapshot of all data at this point */
  snapshot: Record<string, Record<string, any>>;
  /** WAL position at checkpoint time */
  walPosition: number;
  /** Checksum of the snapshot */
  checksum: string;
}

export interface StoreStats {
  /** Number of collections */
  collections: number;
  /** Total items across all collections */
  totalItems: number;
  /** WAL entries count */
  walEntries: number;
  /** Number of checkpoints */
  checkpoints: number;
  /** Store data size in bytes (approximate) */
  sizeBytes: number;
  /** Last checkpoint timestamp */
  lastCheckpoint: number | null;
}

// ── TransferEngine ───────────────────────────

export interface TransferConfig {
  /** Max retry attempts (default: 5) */
  retryAttempts?: number;
  /** Base retry delay in ms (default: 1000) */
  retryDelay?: number;
  /** Circuit breaker configuration */
  circuitBreaker?: CircuitBreakerConfig;
  /** Rate limiter configuration */
  rateLimit?: RateLimitConfig;
}

export interface TransferRequest {
  /** Destination URL or identifier */
  destination: string;
  /** Data to transfer */
  data: any;
  /** HTTP method (default: 'POST') */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Custom headers */
  headers?: Record<string, string>;
  /** Verify data checksum on transfer (default: true) */
  verifyChecksum?: boolean;
  /** Transfer timeout in ms */
  timeout?: number;
  /** Custom transfer handler (overrides default HTTP) */
  handler?: (request: TransferRequest) => Promise<TransferResult>;
}

export interface TransferResult {
  /** Whether the transfer succeeded */
  success: boolean;
  /** Response status code */
  statusCode?: number;
  /** Response data */
  data?: any;
  /** Data checksum */
  checksum?: string;
  /** Transfer duration in ms */
  duration: number;
  /** Number of attempts */
  attempts: number;
  /** Error message if failed */
  error?: string;
}

export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Base delay between retries in ms */
  baseDelay: number;
  /** Maximum delay between retries in ms */
  maxDelay?: number;
  /** Jitter factor (0-1) for randomization */
  jitter?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Retry condition — return true to retry */
  retryCondition?: (error: any, attempt: number) => boolean;
}

export interface CircuitBreakerConfig {
  /** Failure threshold before opening circuit (default: 3) */
  threshold?: number;
  /** Time in ms before attempting recovery (default: 60000) */
  timeout?: number;
  /** Number of success in half-open before closing */
  successThreshold?: number;
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: number | null;
  lastSuccess: number | null;
  totalRequests: number;
  totalFailures: number;
}

export interface RateLimitConfig {
  /** Maximum requests per window (default: 100) */
  maxRequests?: number;
  /** Time window in ms (default: 60000) */
  windowMs?: number;
  /** Maximum burst size (default: same as maxRequests) */
  burstSize?: number;
}

// ── Events ───────────────────────────────────

export interface ClousEvents {
  // Pipeline events
  'pipeline:start': (pipelineId: string) => void;
  'pipeline:step': (pipelineId: string, step: string, index: number) => void;
  'pipeline:complete': (pipelineId: string, result: PipelineResult) => void;
  'pipeline:error': (pipelineId: string, error: Error) => void;

  // Store events
  'store:write': (collection: string, key: string) => void;
  'store:delete': (collection: string, key: string) => void;
  'store:checkpoint': (checkpoint: Checkpoint) => void;
  'store:rollback': (checkpointId: string) => void;
  'store:wal:write': (entry: WALEntry) => void;
  'store:wal:compact': (removedEntries: number) => void;

  // Transfer events
  'transfer:start': (request: TransferRequest) => void;
  'transfer:retry': (request: TransferRequest, attempt: number, error: any) => void;
  'transfer:complete': (result: TransferResult) => void;
  'transfer:error': (request: TransferRequest, error: Error) => void;
  'transfer:circuit:open': () => void;
  'transfer:circuit:close': () => void;
  'transfer:circuit:half-open': () => void;
  'transfer:rate-limited': (waitMs: number) => void;

  // Config events
  'config:loaded': (env: string) => void;
  'config:changed': (key: string, value: any) => void;

  // General events
  'error': (error: Error) => void;
  'warn': (message: string) => void;
}
