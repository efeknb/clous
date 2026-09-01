# Clous 🚀

> Advanced Data Processing Automation and Data Loss Prevention System


**Clous** is a comprehensive TypeScript library for reliable data processing with built-in safeguards:

- **Write-Ahead Log (WAL)** - Durable data writes with recovery
-  **Checkpoint & Rollback** - Data recovery and versioning
-  **Circuit Breaker** - Fault tolerance and resilience
- **Retry Mechanism** - Exponential backoff and automatic retries
-  **Rate Limiting** - Token bucket algorithm for request throttling
-  **AES-256-GCM Encryption** - Secure configuration management
-  **Event System** - Observable data transformations
-  **Winston Logging** - Comprehensive logging with multiple levels

Perfect for building robust data pipelines, ETL systems, and critical data processing applications.

## Installation

```bash
npm install clous
```

### Requirements
- Node.js >= 16.0.0

## Quick Start

```typescript
import { ClousClient } from 'clous';

// Initialize client
const clous = new ClousClient({
  envPath: './.env',
  logLevel: 'info',
  store: { walEnabled: true, checkpointInterval: 30000 },
  transfer: { retryAttempts: 5 },
});

await clous.init();

// Use data pipeline
const result = await clous.pipeline([
  { name: 'John', age: 30 },
  { name: 'Jane', age: 25 }
])
  .transform(item => ({ ...item, adult: item.age >= 18 }))
  .validate([{ field: 'name', rules: [{ type: 'required' }] }])
  .execute();

// Use safe store with WAL & checkpoints
await clous.store.save('users', 'user-1', { name: 'John' });
const checkpoint = await clous.store.createCheckpoint('v1');

// Make modifications
await clous.store.save('users', 'user-1', { name: 'Johnny' });

// Rollback if needed
await clous.store.rollbackToCheckpoint(checkpoint.id);

// Shutdown gracefully
await clous.shutdown();
```

## Core Modules

### 🔧 Configuration Management
```typescript
const config = new ConfigManager({ envPath: './.env' });

// Get and set values
const apiUrl = config.get('API_URL');
config.set('DEBUG_MODE', 'true');

// Encrypt sensitive values
const encrypted = config.get('API_KEY', { encrypted: true });
```

### 📊 Data Pipeline
```typescript
// Transform data
const numbers = [1, 2, 3, 4, 5];
const doubled = await pipeline(numbers)
  .transform(n => n * 2)
  .filter(n => n > 4)
  .execute();

// Validate data
const validator = new Validator();
const result = validator.validate([
  { name: 'Alice', age: 30 },
  { name: '', age: 25 } // Will fail
], [
  { field: 'name', rules: [{ type: 'required' }] }
]);

// Batch processing
const processor = new BatchProcessor({ batchSize: 100, concurrency: 3 });
processor.process(largeArray, item => processItem(item));
```

### 💾 Safe Store
```typescript
const store = new SafeStore({ directory: './data', walEnabled: true });
await store.init();

// ACID-like operations
await store.save('users', 'user-1', { name: 'John' });
await store.saveBatch('users', [
  ['user-2', { name: 'Jane' }],
  ['user-3', { name: 'Bob' }]
]);

// Checkpoint & Rollback
const checkpoint = await store.createCheckpoint('backup-1');
await store.rollbackToCheckpoint(checkpoint.id);

// Persistence
const stats = store.getStats();
console.log(`Total collections: ${stats.totalCollections}`);
```

### 🚀 Transfer Engine
```typescript
const engine = new TransferEngine({
  retryAttempts: 3,
  circuitBreakerThreshold: 5
});

// Send data with automatic retry & circuit breaker
const result = await engine.send({
  destination: 'https://api.example.com/data',
  data: processedData,
  handler: async (req) => {
    const response = await fetch(req.destination, {
      method: 'POST',
      body: JSON.stringify(req.data)
    });
    return response.ok;
  }
});

if (result.success) {
  console.log('Transfer successful');
} else {
  console.log('Transfer failed after retries');
}
```

### 🔄 Resilience Patterns

#### Retry with Exponential Backoff
```typescript
const retryManager = new RetryManager({
  maxAttempts: 5,
  initialDelay: 100,
  backoffMultiplier: 2
});

const result = await retryManager.retry(
  async () => {
    return await fetchData();
  },
  (error) => error.code !== 'FATAL' // Retry condition
);
```

#### Circuit Breaker
```typescript
const breaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 60000,
  halfOpenRequests: 2
});

// Automatically opens after 5 failures, half-opens after 60s
const result = await breaker.execute(async () => {
  return await unstableService();
});
```

#### Rate Limiting
```typescript
const limiter = new RateLimiter({
  tokensPerInterval: 10,
  interval: 1000 // 1 second
});

// Queue requests, execute when tokens available
await limiter.tryConsume(1); // Blocks if no tokens
const data = await fetchData();
```

## API Documentation

### ClousClient
Main entry point for all Clous functionality.

```typescript
new ClousClient(options: ClousConfig)
```

**Methods:**
- `init()` - Initialize all subsystems
- `pipeline<T>(data: T[])` - Create a data pipeline
- `shutdown()` - Gracefully shutdown

**Properties:**
- `store` - SafeStore instance
- `config` - ConfigManager instance
- `transfer` - TransferEngine instance
- `events` - EventBus instance

## Types

```typescript
interface ClousConfig {
  envPath?: string;           // Path to .env file
  logLevel?: LogLevel;        // 'error' | 'warn' | 'info' | 'debug' | 'verbose'
  store?: StoreConfig;        // Store configuration
  transfer?: TransferConfig;  // Transfer configuration
  pipeline?: PipelineConfig;  // Pipeline configuration
  encryptionKey?: string;     // Encryption key for config
}

type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'verbose';
```

## Events

Clous emits typed events for all major operations:

```typescript
clous.events.on('pipeline:completed', (result) => {
  console.log('Pipeline completed:', result);
});

clous.events.on('store:checkpoint-created', (checkpoint) => {
  console.log('Checkpoint created:', checkpoint.id);
});

clous.events.on('transfer:success', (result) => {
  console.log('Transfer successful');
});
```

## Error Handling

```typescript
import { CircuitBreakerError } from 'clous';

try {
  await engine.send(request);
} catch (error) {
  if (error instanceof CircuitBreakerError) {
    console.log('Circuit breaker is open');
  } else {
    console.log('Transfer failed:', error.message);
  }
}
```

## Testing

Run tests with:

```bash
npm test              # Run all tests with coverage
npm run test:watch   # Watch mode
npm run lint         # Run ESLint
npm run format       # Format code with Prettier
```

## Performance

Clous is designed for high-throughput scenarios:
- Handles 10k+ items per batch
- Concurrent processing with configurable concurrency
- Memory-efficient streaming for large datasets
- Efficient WAL with log rotation

## Security

- ✅ AES-256-GCM encryption for sensitive config values
- ✅ No sensitive data in logs by default
- ✅ Input validation and sanitization
- ✅ Safe serialization/deserialization

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Roadmap

See our [Development Plan](https://github.com/efeknb/clous/issues/4) for planned features and improvements.

### Planned Features
- Distributed tracing support
- Database adapters (PostgreSQL, MongoDB)
- gRPC endpoints
- Webhook system
- Performance profiling tools


---

**Made with ❤️ for reliable data processing**
