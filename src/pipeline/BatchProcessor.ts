// ============================================
// Clous — BatchProcessor (Chunked Processing)
// ============================================

import type { BatchOptions, BatchProgress, TransformFn } from '../types';

/**
 * Processes large datasets in configurable chunks with concurrency control.
 * Provides progress callbacks and error isolation per chunk.
 */
export class BatchProcessor {
  /**
   * Process an array of items in batches.
   * Each chunk is processed concurrently up to the concurrency limit.
   */
  static async process<TIn, TOut>(
    data: TIn[],
    processor: TransformFn<TIn[], TOut[]>,
    options: BatchOptions = {},
  ): Promise<{ results: TOut[]; errors: Array<{ chunkIndex: number; error: Error }> }> {
    const chunkSize = options.chunkSize || 500;
    const concurrency = options.concurrency || 3;
    const onProgress = options.onProgress;

    // Split data into chunks
    const chunks: TIn[][] = [];
    for (let i = 0; i < data.length; i += chunkSize) {
      chunks.push(data.slice(i, i + chunkSize));
    }

    const allResults: TOut[] = [];
    const errors: Array<{ chunkIndex: number; error: Error }> = [];
    let processedCount = 0;

    // Process chunks with concurrency limit
    for (let i = 0; i < chunks.length; i += concurrency) {
      const batch = chunks.slice(i, i + concurrency);
      const batchPromises = batch.map(async (chunk, batchIdx) => {
        const chunkIndex = i + batchIdx;
        try {
          const result = await processor(chunk);
          return { chunkIndex, result, error: null };
        } catch (error) {
          return { chunkIndex, result: null, error: error as Error };
        }
      });

      const batchResults = await Promise.all(batchPromises);

      for (const batchResult of batchResults) {
        if (batchResult.error) {
          errors.push({ chunkIndex: batchResult.chunkIndex, error: batchResult.error });
        } else if (batchResult.result) {
          allResults.push(...batchResult.result);
        }
        processedCount += chunks[batchResult.chunkIndex]?.length || 0;

        // Report progress
        if (onProgress) {
          const progress: BatchProgress = {
            total: data.length,
            processed: processedCount,
            failed: errors.reduce((acc, e) => acc + (chunks[e.chunkIndex]?.length || 0), 0),
            percentage: Math.round((processedCount / data.length) * 100),
            currentChunk: batchResult.chunkIndex + 1,
            totalChunks: chunks.length,
          };
          onProgress(progress);
        }
      }
    }

    return { results: allResults, errors };
  }

  /**
   * Process items one by one with concurrency control (pool pattern).
   */
  static async processPool<TIn, TOut>(
    data: TIn[],
    processor: TransformFn<TIn, TOut>,
    concurrency: number = 3,
    onProgress?: (progress: BatchProgress) => void,
  ): Promise<{ results: TOut[]; errors: Array<{ index: number; error: Error }> }> {
    const results: Array<{ index: number; result: TOut | null; error: Error | null }> = [];
    let processedCount = 0;
    let failedCount = 0;

    // Worker pool
    const queue = data.map((item, index) => ({ item, index }));
    const workers: Promise<void>[] = [];

    const runWorker = async (): Promise<void> => {
      while (queue.length > 0) {
        const entry = queue.shift();
        if (!entry) break;

        try {
          const result = await processor(entry.item);
          results.push({ index: entry.index, result, error: null });
        } catch (error) {
          results.push({ index: entry.index, result: null, error: error as Error });
          failedCount++;
        }

        processedCount++;

        if (onProgress) {
          onProgress({
            total: data.length,
            processed: processedCount,
            failed: failedCount,
            percentage: Math.round((processedCount / data.length) * 100),
            currentChunk: processedCount,
            totalChunks: data.length,
          });
        }
      }
    };

    // Spin up workers
    for (let i = 0; i < Math.min(concurrency, data.length); i++) {
      workers.push(runWorker());
    }

    await Promise.all(workers);

    // Sort by original index
    results.sort((a, b) => a.index - b.index);

    return {
      results: results.filter((r) => r.result !== null).map((r) => r.result as TOut),
      errors: results
        .filter((r) => r.error !== null)
        .map((r) => ({ index: r.index, error: r.error as Error })),
    };
  }
}
