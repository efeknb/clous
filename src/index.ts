// ============================================
// Clous — Public API Exports
// ============================================

// Main client
export { ClousClient } from './ClousClient';

// Config
export { ConfigManager } from './config/ConfigManager';
export { EncryptionHelper } from './config/EncryptionHelper';

// Pipeline
export { DataPipeline } from './pipeline/DataPipeline';
export { Transformer } from './pipeline/Transformer';
export { Validator } from './pipeline/Validator';
export { BatchProcessor } from './pipeline/BatchProcessor';

// Store
export { SafeStore } from './store/SafeStore';
export { WriteAheadLog } from './store/WriteAheadLog';
export { CheckpointManager } from './store/CheckpointManager';

// Transfer
export { TransferEngine } from './transfer/TransferEngine';
export { RetryManager } from './transfer/RetryManager';
export { CircuitBreaker, CircuitBreakerError } from './transfer/CircuitBreaker';
export { RateLimiter } from './transfer/RateLimiter';

// Utilities
export { EventBus } from './utils/EventBus';
export { Logger } from './utils/Logger';
export { Checksum } from './utils/Checksum';

// Types
export type {
  ClousConfig,
  LogLevel,
  ConfigManagerOptions,
  ConfigSchema,
  TransformFn,
  ValidatorFn,
  ValidationResult,
  ValidationError,
  ValidationRule,
  PipelineConfig,
  BatchOptions,
  BatchProgress,
  PipelineResult,
  StoreConfig,
  WALEntry,
  Checkpoint,
  StoreStats,
  TransferConfig,
  TransferRequest,
  TransferResult,
  RetryOptions,
  CircuitBreakerConfig,
  CircuitState,
  CircuitBreakerStats,
  RateLimitConfig,
  ClousEvents,
} from './types';
