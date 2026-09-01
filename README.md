# Clous

Advanced Data Processing Automation and Data Loss Prevention System

A comprehensive TypeScript library designed for reliable data processing with enterprise-grade safeguards. Clous provides a complete solution for building robust data pipelines, ETL systems, and critical data processing applications where data integrity and reliability are paramount.

Clous implements industry-standard patterns and mechanisms to ensure that your data processing workflows are not only efficient but also resilient to failures and capable of recovery from errors. The library combines multiple techniques including write-ahead logging, checkpoint management, circuit breaker patterns, automatic retry mechanisms, and rate limiting to create a comprehensive framework for data processing.

## Installation and Setup

The Clous library is available on npm and can be installed using your preferred package manager. The library requires Node.js version 16 or higher to run properly.

```bash
npm install clous
```

For development installations or contributing to the project, clone the repository and install dependencies:

```bash
git clone https://github.com/efeknb/clous.git
cd clous
npm install
npm run build
npm test
```

## Core System Architecture

Clous is organized into several interconnected modules, each responsible for specific aspects of data processing and reliability. Understanding the architecture helps you leverage all the features effectively.

The system is built around a central ClousClient that orchestrates all subsystems. This client manages configuration, provides pipeline creation, maintains persistent storage, handles data transfers, and emits events throughout the processing lifecycle. The architecture follows a modular design where each component can be used independently but works optimally when integrated.

## Component Overview

### Configuration Management System

The configuration management system is responsible for loading, validating, and managing application settings throughout the runtime lifecycle of your application. This system integrates directly with environment files and supports dynamic configuration updates without requiring application restarts.

The ConfigManager reads configuration from .env files located in your project directory. This file format allows you to store sensitive information and environment-specific settings outside of your source code. The system supports typed configuration access where you can specify whether a value should be a string, number, or boolean, and it will automatically perform type conversion and validation.

A powerful feature of the configuration system is support for encryption. Sensitive values such as API keys, database passwords, and authentication tokens can be encrypted using AES-256-GCM encryption. The encryption process generates a random initialization vector for each encryption operation, ensuring that the same plaintext produces different ciphertexts on each encryption. This encrypted data is stored with a prefix "ENC:" making it easy to identify encrypted values in your configuration files.

Configuration validation ensures that all required values are present and correctly typed before your application begins processing. You can define a schema that specifies which configuration keys are required, what their types should be, and what default values to use if they are not provided. This validation happens early in the application lifecycle, preventing runtime errors from invalid configuration states.

Example of using the configuration system:

```typescript
import { ConfigManager } from 'clous';

const config = new ConfigManager({
  envPath: './.env',
  encryptionKey: process.env.ENCRYPTION_KEY || 'default-key'
});

// Access configuration values with type safety
const apiUrl = config.get('API_URL');
const port = config.get('PORT', { type: 'number', default: 3000 });
const debugMode = config.get('DEBUG_MODE', { type: 'boolean', default: false });

// Check if a key exists
if (config.has('OPTIONAL_SETTING')) {
  const value = config.get('OPTIONAL_SETTING');
}

// Set values at runtime
config.set('CURRENT_STATUS', 'running');

// Work with encrypted values
const apiKey = config.get('API_KEY', { encrypted: true });

// Validate configuration against a schema
const schema = {
  API_URL: { type: 'string', required: true },
  API_KEY: { type: 'string', required: true },
  PORT: { type: 'number', required: false, default: 3000 }
};

try {
  config.validate(schema);
  console.log('Configuration is valid');
} catch (error) {
  console.error('Configuration validation failed:', error.message);
}

// Listen to configuration changes
config.on('config:changed', (event) => {
  console.log(`Configuration key "${event.key}" changed`);
});
```

### Data Pipeline System

The data pipeline system provides a fluent, chainable API for transforming, filtering, validating, and processing data. Pipelines are designed to handle complex data transformations while maintaining readable and maintainable code through method chaining.

The pipeline system consists of several interconnected components. The Transformer handles data transformations and provides standard functional operations like map, filter, reduce, flatMap, groupBy, and unique. These operations can be chained together to build complex transformation sequences. The system supports both synchronous and asynchronous transformations, automatically handling promises in your transformation functions.

The Validator component ensures data quality by checking that processed data conforms to specified rules and constraints. Validation rules can check for required fields, enforce specific types, validate numeric ranges, match regular expression patterns, and execute custom validation logic. Validation errors are collected and reported with detailed information about which fields failed and why.

The BatchProcessor handles large datasets by breaking them into configurable batch sizes and processing them with configurable concurrency levels. This approach prevents memory exhaustion when working with massive datasets and allows for controlled resource utilization. Progress tracking provides visibility into batch processing status.

The DataPipeline orchestrates all these components, accepting input data and allowing you to chain transformation, filtering, and validation operations before executing the pipeline and receiving the results.

Example of using the data pipeline:

```typescript
import { ClousClient } from 'clous';

const clous = new ClousClient();
await clous.init();

// Simple transformation pipeline
const numbers = [1, 2, 3, 4, 5];
const result = await clous.pipeline(numbers)
  .transform(n => n * 2)
  .filter(n => n > 4)
  .execute();

console.log(result); // { data: [6, 8, 10], errors: [] }

// Complex pipeline with validation
const users = [
  { name: 'John Doe', age: 30, email: 'john@example.com' },
  { name: 'Jane Smith', age: 28, email: 'jane@example.com' },
  { name: '', age: 25, email: 'bob@example.com' } // Invalid - no name
];

const validationRules = [
  { 
    field: 'name', 
    rules: [{ type: 'required', message: 'Name is required' }] 
  },
  { 
    field: 'age', 
    rules: [
      { type: 'required' },
      { type: 'type', value: 'number' },
      { type: 'min', value: 18 }
    ] 
  },
  { 
    field: 'email', 
    rules: [
      { type: 'required' },
      { type: 'pattern', value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ }
    ] 
  }
];

const processResult = await clous.pipeline(users)
  .transform(user => ({
    ...user,
    normalized_name: user.name.toUpperCase(),
    is_adult: user.age >= 18
  }))
  .validate(validationRules)
  .execute();

console.log(processResult.data); // Valid users only
console.log(processResult.errors); // Validation errors

// Batch processing for large datasets
const largeDataset = Array.from({ length: 100000 }, (_, i) => ({
  id: i,
  value: Math.random()
}));

const batchResult = await clous.pipeline(largeDataset)
  .transform(item => ({
    ...item,
    processed: true,
    timestamp: new Date().toISOString()
  }))
  .execute();
```

### Data Storage and Persistence

The storage system provides durable data persistence with automatic recovery capabilities. It implements the Write-Ahead Log pattern, which ensures that data modifications are recorded in a permanent log before they are applied to the main data store. This mechanism guarantees that even if the application crashes during a write operation, the system can recover to a consistent state.

The Write-Ahead Log works by appending every modification operation to a log file before applying it to the in-memory data structures. If the application crashes, the log can be replayed to recover the exact state before the crash. The log supports compression through a compaction process that consolidates committed entries, reducing disk space usage while maintaining full recovery capability.

The Checkpoint system allows you to create named snapshots of the entire data store at specific points in time. These checkpoints can be used to restore the system to any previous state. This is particularly useful when you need to undo problematic operations or experiment with different data modifications. Each checkpoint stores complete data snapshots along with integrity verification information to detect data corruption.

The SafeStore provides a key-value storage interface organized into collections, similar to database tables. Collections are logical namespaces where related data is stored together. Within each collection, data is stored as key-value pairs. The SafeStore supports atomic batch operations where multiple writes are guaranteed to succeed together or fail together, maintaining data consistency.

Example of using the storage system:

```typescript
import { ClousClient } from 'clous';

const clous = new ClousClient({
  store: {
    directory: './data',
    walEnabled: true,
    checkpointInterval: 30000 // Create checkpoints every 30 seconds
  }
});

await clous.init();

// Save single items to a collection
await clous.store.save('users', 'user-123', {
  id: 'user-123',
  name: 'John Doe',
  email: 'john@example.com',
  created_at: new Date().toISOString()
});

// Batch save with atomicity guarantees
const userBatch = [
  ['user-124', { name: 'Jane Smith', email: 'jane@example.com' }],
  ['user-125', { name: 'Bob Wilson', email: 'bob@example.com' }]
];

await clous.store.saveBatch('users', userBatch);

// Retrieve data from storage
const user = await clous.store.get('users', 'user-123');
console.log(user);

// Check if data exists
const exists = await clous.store.has('users', 'user-123');
console.log('User exists:', exists);

// Create a named checkpoint for recovery
const checkpoint = await clous.store.createCheckpoint('before-major-update');

// Modify data
await clous.store.save('users', 'user-123', {
  id: 'user-123',
  name: 'John Doe Updated',
  email: 'john.new@example.com'
});

// If something goes wrong, rollback to checkpoint
if (someErrorOccurred) {
  await clous.store.rollbackToCheckpoint(checkpoint.id);
  // The user is back to the original state
}

// List all checkpoints
const checkpoints = await clous.store.listCheckpoints();
console.log('Available checkpoints:', checkpoints);

// Delete old checkpoints to save disk space
await clous.store.deleteCheckpoint(checkpoints[0].id);

// Get storage statistics
const stats = clous.store.getStats();
console.log(`Total collections: ${stats.totalCollections}`);
console.log(`Total items: ${stats.totalItems}`);
console.log(`Disk usage: ${stats.diskUsage} bytes`);

// List all keys in a collection
const keys = await clous.store.listKeys('users');
console.log('All user keys:', keys);

// Clear an entire collection
await clous.store.clearCollection('users');

// Delete specific data
const deleted = await clous.store.delete('users', 'user-123');
console.log('Deleted:', deleted);
```

### Transfer and Resilience System

The transfer system handles data transmission to external systems with built-in resilience mechanisms. These mechanisms protect against transient failures, cascading failures, and resource exhaustion.

The Retry Manager implements exponential backoff, a strategy where retry delays increase exponentially after each failed attempt. The first retry happens after a short delay, the second after a longer delay, and so on. This approach prevents overwhelming a struggling service with rapid retry attempts. The retry manager is configurable to support custom retry conditions where you specify which types of errors should trigger retries versus which should fail immediately.

The Circuit Breaker implements a state machine with three states: CLOSED for normal operation, OPEN when failures exceed a threshold, and HALF_OPEN for testing if the service has recovered. When the circuit is OPEN, all requests fail immediately without attempting to contact the service, protecting it from overload. After a timeout, the circuit transitions to HALF_OPEN where a limited number of requests are allowed to test recovery. If these requests succeed, the circuit closes and normal operation resumes.

The Rate Limiter uses a token bucket algorithm to control request rates. Tokens accumulate over time based on a configured rate. Each request consumes tokens, and if insufficient tokens are available, the request is queued until tokens become available. This prevents overwhelming downstream services and ensures fair resource distribution.

The TransferEngine orchestrates all these resilience mechanisms, combining retry logic, circuit breaking, and rate limiting into a unified interface for reliable data transfer.

Example of using the transfer system:

```typescript
import { ClousClient } from 'clous';

const clous = new ClousClient({
  transfer: {
    retryAttempts: 3,
    initialDelay: 100,
    backoffMultiplier: 2,
    circuitBreakerThreshold: 5,
    circuitBreakerTimeout: 60000,
    rateLimitTokensPerSecond: 100
  }
});

await clous.init();

// Simple transfer with automatic retry and circuit breaking
const result = await clous.transfer.send({
  destination: 'https://api.example.com/data/process',
  data: {
    items: [
      { id: 1, value: 'data1' },
      { id: 2, value: 'data2' }
    ]
  },
  handler: async (request) => {
    const response = await fetch(request.destination, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.data)
    });
    return response.ok;
  }
});

if (result.success) {
  console.log('Data transferred successfully');
} else {
  console.log('Transfer failed:', result.error);
  console.log('Attempted retries:', result.attempts);
}

// Batch transfers to multiple endpoints
const batchResults = await clous.transfer.sendBatch([
  {
    destination: 'https://api.example.com/endpoint1',
    data: { batch: 1 }
  },
  {
    destination: 'https://api.example.com/endpoint2',
    data: { batch: 2 }
  },
  {
    destination: 'https://api.example.com/endpoint3',
    data: { batch: 3 }
  }
]);

// Check circuit breaker status
const cbStats = clous.transfer.getCircuitBreakerStats();
console.log(`Circuit state: ${cbStats.state}`);
console.log(`Failures: ${cbStats.failureCount}`);
console.log(`Successes: ${cbStats.successCount}`);

// Check rate limiter info
const rlInfo = clous.transfer.getRateLimiterInfo();
console.log(`Available tokens: ${rlInfo.availableTokens}`);
console.log(`Queued requests: ${rlInfo.queuedRequests}`);
```

### Event System and Observability

Events are emitted throughout the Clous system lifecycle, allowing you to monitor and react to important occurrences. The event system provides complete visibility into pipeline execution, storage operations, and transfer activities.

The event system is built using an event emitter pattern where you can subscribe to specific event types and define handler functions. Handlers are called whenever the corresponding event occurs, passing relevant data about what happened. This allows you to implement monitoring, logging, alerting, and reactive workflows based on system activities.

Events are hierarchically organized with specific events for individual operations and broader events for operation categories. For example, when a pipeline completes, both a specific "pipeline:completed" event and a general "pipeline:*" event are emitted, allowing you to listen at whatever level of granularity you need.

Example of using the event system:

```typescript
import { ClousClient } from 'clous';

const clous = new ClousClient();
await clous.init();

// Listen for pipeline events
clous.events.on('pipeline:started', (event) => {
  console.log('Pipeline started processing', event.itemCount, 'items');
});

clous.events.on('pipeline:completed', (event) => {
  console.log('Pipeline completed. Success:', event.success);
  console.log('Processing time:', event.duration, 'ms');
  if (event.errors.length > 0) {
    console.log('Validation errors:', event.errors);
  }
});

clous.events.on('pipeline:failed', (event) => {
  console.error('Pipeline failed:', event.error);
});

// Listen for storage events
clous.events.on('store:checkpoint-created', (event) => {
  console.log('Checkpoint created:', event.checkpointId);
  console.log('Timestamp:', event.timestamp);
});

clous.events.on('store:data-saved', (event) => {
  console.log(`Saved to collection: ${event.collection}, key: ${event.key}`);
});

clous.events.on('store:rollback-completed', (event) => {
  console.log('Rolled back to checkpoint:', event.checkpointId);
});

// Listen for transfer events
clous.events.on('transfer:started', (event) => {
  console.log('Transfer starting to', event.destination);
});

clous.events.on('transfer:retry', (event) => {
  console.log(`Retry attempt ${event.attempt} of ${event.maxAttempts}`);
  console.log('Error:', event.error);
});

clous.events.on('transfer:success', (event) => {
  console.log('Transfer successful after', event.attempts, 'attempts');
});

clous.events.on('transfer:failed', (event) => {
  console.log('Transfer failed permanently:', event.error);
});

// Listen for circuit breaker state changes
clous.events.on('circuit-breaker:state-changed', (event) => {
  console.log(
    `Circuit breaker transitioned from ${event.previousState} to ${event.newState}`
  );
});

// Listen for rate limiter events
clous.events.on('rate-limiter:tokens-exhausted', (event) => {
  console.log('Rate limit exhausted, waiting for token refill');
});
```

## Complete Application Example

Here is a complete example demonstrating how to build a real-world data processing application using Clous. This example loads user data from a CSV-like source, processes and validates it, stores it durably, and transfers it to a remote service with resilience.

```typescript
import { ClousClient } from 'clous';
import * as fs from 'fs/promises';

async function processUserDataPipeline() {
  // Initialize Clous with all subsystems
  const clous = new ClousClient({
    envPath: './.env',
    logLevel: 'info',
    store: {
      directory: './data',
      walEnabled: true,
      checkpointInterval: 30000
    },
    transfer: {
      retryAttempts: 3,
      circuitBreakerThreshold: 5
    }
  });

  await clous.init();

  // Setup event listeners for monitoring
  clous.events.on('pipeline:completed', (event) => {
    console.log(`Processed ${event.itemCount} items in ${event.duration}ms`);
  });

  clous.events.on('store:checkpoint-created', (event) => {
    console.log(`Checkpoint created: ${event.checkpointId}`);
  });

  clous.events.on('transfer:retry', (event) => {
    console.log(`Transfer retry attempt ${event.attempt}`);
  });

  try {
    // Load raw data from source
    const rawData = JSON.parse(
      await fs.readFile('./users-raw.json', 'utf-8')
    );

    // Define validation rules
    const validationRules = [
      {
        field: 'id',
        rules: [{ type: 'required' }, { type: 'type', value: 'string' }]
      },
      {
        field: 'name',
        rules: [{ type: 'required' }, { type: 'type', value: 'string' }]
      },
      {
        field: 'email',
        rules: [
          { type: 'required' },
          {
            type: 'pattern',
            value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
            message: 'Invalid email format'
          }
        ]
      },
      {
        field: 'age',
        rules: [
          { type: 'type', value: 'number' },
          { type: 'min', value: 0 },
          { type: 'max', value: 150 }
        ]
      }
    ];

    // Process data through pipeline
    const result = await clous.pipeline(rawData)
      .transform(user => ({
        ...user,
        created_at: new Date().toISOString(),
        normalized_name: user.name.trim().toLowerCase(),
        is_verified: false
      }))
      .filter(user => user.age >= 18)
      .validate(validationRules)
      .execute();

    if (result.errors.length > 0) {
      console.error('Validation errors found:', result.errors);
      return;
    }

    // Create checkpoint before storage
    const checkpoint = await clous.store.createCheckpoint('before-user-import');

    console.log(`Storing ${result.data.length} valid users...`);

    // Store processed data with atomicity
    const storeBatch = result.data.map(user => [user.id, user]);
    await clous.store.saveBatch('users', storeBatch);

    console.log(`Stored ${result.data.length} users successfully`);

    // Transfer to remote API with resilience
    const transferResult = await clous.transfer.send({
      destination: 'https://api.example.com/users/import',
      data: {
        users: result.data,
        timestamp: new Date().toISOString(),
        count: result.data.length
      },
      handler: async (request) => {
        const response = await fetch(request.destination, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${clous.config.get('API_KEY', { encrypted: true })}`
          },
          body: JSON.stringify(request.data),
          timeout: 30000
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return true;
      }
    });

    if (transferResult.success) {
      console.log('Data successfully transferred to remote API');
    } else {
      console.error('Transfer failed after retries, rolling back');
      await clous.store.rollbackToCheckpoint(checkpoint.id);
      throw new Error('Transfer failed and data was rolled back');
    }

    // Get final statistics
    const stats = clous.store.getStats();
    console.log('Storage statistics:', {
      collections: stats.totalCollections,
      items: stats.totalItems,
      diskUsage: `${(stats.diskUsage / 1024 / 1024).toFixed(2)} MB`
    });

  } catch (error) {
    console.error('Pipeline error:', error);
    process.exit(1);
  } finally {
    await clous.shutdown();
  }
}

// Run the pipeline
processUserDataPipeline().catch(console.error);
```

## Configuration Reference

The following section provides detailed configuration examples for different scenarios.

### Minimal Configuration

For simple use cases, Clous works with minimal configuration:

```typescript
const clous = new ClousClient();
await clous.init();
```

### Production Configuration

For production systems where reliability is critical:

```typescript
const clous = new ClousClient({
  envPath: process.env.ENV_FILE || './.env.production',
  logLevel: process.env.LOG_LEVEL || 'info',
  encryptionKey: process.env.ENCRYPTION_KEY,
  store: {
    directory: process.env.DATA_DIR || './data',
    walEnabled: true,
    checkpointInterval: 30000
  },
  transfer: {
    retryAttempts: parseInt(process.env.TRANSFER_RETRIES || '5', 10),
    initialDelay: 100,
    backoffMultiplier: 2,
    circuitBreakerThreshold: 10,
    circuitBreakerTimeout: 60000,
    rateLimitTokensPerSecond: 1000
  },
  pipeline: {
    batchSize: 1000,
    concurrency: 10
  }
});
```

### High-Volume Data Processing

For processing large volumes of data:

```typescript
const clous = new ClousClient({
  store: {
    directory: './high-volume-data',
    walEnabled: true,
    checkpointInterval: 60000
  },
  pipeline: {
    batchSize: 10000,
    concurrency: 20
  },
  transfer: {
    rateLimitTokensPerSecond: 5000
  }
});
```

## Best Practices and Patterns

Understanding common patterns helps you use Clous more effectively in production environments.

### Error Handling

Always wrap Clous operations in try-catch blocks and handle errors gracefully. Different error types may require different recovery strategies:

```typescript
try {
  const result = await clous.pipeline(data)
    .transform(item => processItem(item))
    .validate(rules)
    .execute();
} catch (error) {
  if (error.message.includes('validation')) {
    // Handle validation errors
    console.error('Data validation failed');
  } else if (error.message.includes('storage')) {
    // Handle storage errors
    console.error('Storage operation failed');
  } else {
    // Handle unexpected errors
    console.error('Unexpected error:', error);
  }
}
```

### Checkpoint-Based Recovery

Create checkpoints at logical boundaries in your data processing workflow. This allows you to recover from errors without reprocessing data:

```typescript
const checkpoint = await clous.store.createCheckpoint('phase-1-complete');

try {
  // Phase 2 processing
  const phase2Result = await clous.pipeline(data)
    .transform(processPhase2)
    .execute();
  
  await clous.store.saveBatch('results', 
    phase2Result.data.map(item => [item.id, item])
  );
} catch (error) {
  // Rollback to phase 1 if phase 2 fails
  await clous.store.rollbackToCheckpoint(checkpoint.id);
  throw error;
}
```

### Event-Driven Monitoring

Use the event system to monitor critical operations and implement alerting:

```typescript
clous.events.on('transfer:failed', async (event) => {
  await notifyAdministrators(`Data transfer failed: ${event.error}`);
});

clous.events.on('circuit-breaker:state-changed', async (event) => {
  if (event.newState === 'OPEN') {
    await notifyAdministrators('Circuit breaker opened - service unavailable');
  }
});

clous.events.on('pipeline:completed', (event) => {
  logMetrics({
    processedItems: event.itemCount,
    duration: event.duration,
    errors: event.errors.length
  });
});
```

## Development and Testing

Running tests and building the project:

```bash
npm install
npm run build
npm test
npm run test:watch
npm run lint
npm run format
```

The test suite includes 116 comprehensive tests covering all modules with 78.46% code coverage. Tests are organized by module and include unit tests, integration tests, and edge case scenarios.

## Performance Considerations

Clous is optimized for production use with the following characteristics:

Input data size is limited by available memory when using in-memory pipelines. For extremely large datasets, process data in smaller batches. Network operations respect configured rate limits and timeout gracefully. Storage operations are optimized with write-ahead logging and checkpoint compression. Event handlers should not perform expensive operations as they run synchronously.

The system can process thousands of items per batch and handle high-concurrency scenarios. Batch sizes and concurrency levels should be tuned based on your specific hardware and workload characteristics.

## Support and Contributing

For issues, questions, or contributions, visit the GitHub repository at https://github.com/efeknb/clous

Contributing guidelines and development procedures are documented in CONTRIBUTING.md

## License

MIT License. See LICENSE file for details.

## Version Information

Current Version: 1.0.0
Test Suites: 5 passed, 5 total
Tests: 116 passed, 116 total
Code Coverage: 78.46%
