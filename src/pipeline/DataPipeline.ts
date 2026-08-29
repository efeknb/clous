// ============================================
// Clous — DataPipeline (Chainable Processing)
// ============================================

import { Transformer } from './Transformer';
import { Validator } from './Validator';
import { BatchProcessor } from './BatchProcessor';
import { Checksum } from '../utils/Checksum';
import { EventBus } from '../utils/EventBus';
import type { ModuleLogger } from '../utils/Logger';
import type {
  TransformFn,
  ValidationRule,
  ValidatorFn,
  BatchOptions,
  PipelineResult,
  PipelineConfig,
} from '../types';

interface PipelineStep {
  type: 'transform' | 'filter' | 'validate' | 'batch' | 'custom';
  name: string;
  fn: (...args: any[]) => any;
  options?: any;
}

/**
 * Chainable data processing pipeline with built-in checksum verification,
 * validation, batch processing, and automatic error rollback.
 *
 * @example
 * ```typescript
 * const result = await pipeline.from(data)
 *   .transform(item => normalize(item))
 *   .validate([{ field: 'name', rules: [{ type: 'required' }] }])
 *   .batch({ chunkSize: 100, concurrency: 5 })
 *   .execute();
 * ```
 */
export class DataPipeline {
  private steps: PipelineStep[] = [];
  private inputData: any = null;
  private pipelineId: string;

  constructor(
    private events: EventBus,
    private logger: ModuleLogger,
    private config: PipelineConfig = {},
  ) {
    this.pipelineId = Checksum.generateId();
  }

  /**
   * Set the input data for the pipeline.
   */
  from<T>(data: T): DataPipeline {
    this.inputData = data;
    this.steps = [];
    this.pipelineId = Checksum.generateId();
    return this;
  }

  /**
   * Add a transformation step.
   * For arrays: applies the function to each item.
   * For single values: applies the function directly.
   */
  transform<TIn = any, TOut = any>(fn: TransformFn<TIn, TOut>): DataPipeline {
    this.steps.push({
      type: 'transform',
      name: `transform-${this.steps.length}`,
      fn: async (data: any) => {
        if (Array.isArray(data)) {
          return Transformer.map(data, fn);
        }
        return fn(data);
      },
    });
    return this;
  }

  /**
   * Add a filter step (array data only).
   */
  filter(predicate: TransformFn<any, boolean>): DataPipeline {
    this.steps.push({
      type: 'filter',
      name: `filter-${this.steps.length}`,
      fn: async (data: any) => {
        if (!Array.isArray(data)) {
          throw new Error('Filter step requires array data');
        }
        return Transformer.filter(data, predicate);
      },
    });
    return this;
  }

  /**
   * Add a validation step.
   * Accepts validation rules or a custom validator function.
   */
  validate(rulesOrFn: ValidationRule[] | ValidatorFn): DataPipeline {
    this.steps.push({
      type: 'validate',
      name: `validate-${this.steps.length}`,
      fn: async (data: any) => {
        const validatorFn = Array.isArray(rulesOrFn)
          ? Validator.createValidator(rulesOrFn)
          : rulesOrFn;

        if (Array.isArray(data)) {
          const result = Validator.validateArray(data, rulesOrFn as ValidationRule[]);
          if (!result.valid) {
            const errorMessages = result.errors
              .slice(0, 10)
              .map((e) => `${e.field}: ${e.message}`)
              .join('; ');
            throw new Error(`Validation failed with ${result.errors.length} error(s): ${errorMessages}`);
          }
        } else {
          const result = validatorFn(data);
          if (!result.valid) {
            const errorMessages = result.errors
              .slice(0, 10)
              .map((e) => `${e.field}: ${e.message}`)
              .join('; ');
            throw new Error(`Validation failed: ${errorMessages}`);
          }
        }
        return data;
      },
    });
    return this;
  }

  /**
   * Add a batch processing step.
   * Splits array data into chunks and processes them concurrently.
   */
  batch(options?: BatchOptions): DataPipeline {
    const batchOpts: BatchOptions = {
      chunkSize: options?.chunkSize || this.config.batchSize || 500,
      concurrency: options?.concurrency || this.config.concurrency || 3,
      onProgress: options?.onProgress,
    };

    this.steps.push({
      type: 'batch',
      name: `batch-${this.steps.length}`,
      fn: async (data: any) => {
        if (!Array.isArray(data)) {
          throw new Error('Batch step requires array data');
        }
        const result = await BatchProcessor.process(
          data,
          async (chunk) => chunk, // Identity — actual processing in earlier steps
          batchOpts,
        );
        if (result.errors.length > 0) {
          this.logger.warn(`Batch processing had ${result.errors.length} chunk error(s)`);
        }
        return result.results;
      },
      options: batchOpts,
    });
    return this;
  }

  /**
   * Add a custom processing step.
   */
  pipe(name: string, fn: TransformFn): DataPipeline {
    this.steps.push({
      type: 'custom',
      name,
      fn,
    });
    return this;
  }

  /**
   * Execute the entire pipeline.
   */
  async execute<T = any>(): Promise<PipelineResult<T>> {
    if (this.inputData === null || this.inputData === undefined) {
      throw new Error('No input data. Call .from(data) before .execute()');
    }

    const startTime = Date.now();
    const warnings: string[] = [];
    let currentData = this.inputData;
    let stepsExecuted = 0;

    this.events.emit('pipeline:start', this.pipelineId);
    this.logger.info(`Pipeline started (${this.steps.length} steps)`, {
      pipelineId: this.pipelineId,
    });

    // Store original data for potential rollback
    const originalData = JSON.parse(JSON.stringify(this.inputData));

    try {
      for (let i = 0; i < this.steps.length; i++) {
        const step = this.steps[i];
        const stepStart = Date.now();

        this.events.emit('pipeline:step', this.pipelineId, step.name, i);
        this.logger.debug(`Executing step ${i + 1}/${this.steps.length}: ${step.name}`);

        try {
          currentData = await step.fn(currentData);
          stepsExecuted++;

          const stepDuration = Date.now() - stepStart;
          this.logger.debug(`Step "${step.name}" completed in ${stepDuration}ms`);
        } catch (stepError) {
          this.logger.error(`Step "${step.name}" failed`, {
            error: (stepError as Error).message,
          });
          throw stepError;
        }
      }

      // Compute output checksum
      const serialized = JSON.stringify(currentData);
      const checksum = Checksum.sha256(serialized);
      const itemsProcessed = Array.isArray(currentData) ? currentData.length : 1;

      const result: PipelineResult<T> = {
        success: true,
        data: currentData as T,
        metadata: {
          duration: Date.now() - startTime,
          stepsExecuted,
          itemsProcessed,
          checksum,
        },
        warnings,
      };

      this.events.emit('pipeline:complete', this.pipelineId, result);
      this.logger.info(`Pipeline completed in ${result.metadata.duration}ms`, {
        pipelineId: this.pipelineId,
        items: itemsProcessed,
      });

      return result;
    } catch (error) {
      const pipelineError = error as Error;
      this.events.emit('pipeline:error', this.pipelineId, pipelineError);
      this.logger.error(`Pipeline failed at step ${stepsExecuted + 1}`, {
        pipelineId: this.pipelineId,
        error: pipelineError.message,
      });

      return {
        success: false,
        data: originalData as T,
        metadata: {
          duration: Date.now() - startTime,
          stepsExecuted,
          itemsProcessed: 0,
          checksum: '',
        },
        warnings: [...warnings, `Pipeline failed: ${pipelineError.message}`],
      };
    }
  }
}
