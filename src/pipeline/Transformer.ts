// ============================================
// Clous — Transformer (Data Transformation)
// ============================================

import type { TransformFn } from '../types';

/**
 * Data transformer supporting synchronous and asynchronous
 * map, filter, reduce, flatMap, and custom transformation operations.
 */
export class Transformer {
  /**
   * Apply a transform function to each item in an array.
   */
  static async map<TIn, TOut>(data: TIn[], fn: TransformFn<TIn, TOut>): Promise<TOut[]> {
    const results: TOut[] = [];
    for (const item of data) {
      results.push(await fn(item));
    }
    return results;
  }

  /**
   * Filter items using a predicate function.
   */
  static async filter<T>(data: T[], predicate: TransformFn<T, boolean>): Promise<T[]> {
    const results: T[] = [];
    for (const item of data) {
      if (await predicate(item)) {
        results.push(item);
      }
    }
    return results;
  }

  /**
   * Reduce an array to a single value.
   */
  static async reduce<T, TAcc>(
    data: T[],
    reducer: (accumulator: TAcc, current: T, index: number) => TAcc | Promise<TAcc>,
    initialValue: TAcc,
  ): Promise<TAcc> {
    let accumulator = initialValue;
    for (let i = 0; i < data.length; i++) {
      accumulator = await reducer(accumulator, data[i], i);
    }
    return accumulator;
  }

  /**
   * FlatMap: map each item to an array, then flatten.
   */
  static async flatMap<TIn, TOut>(data: TIn[], fn: TransformFn<TIn, TOut[]>): Promise<TOut[]> {
    const results: TOut[] = [];
    for (const item of data) {
      const mapped = await fn(item);
      results.push(...mapped);
    }
    return results;
  }

  /**
   * Group items by a key function.
   */
  static async groupBy<T>(data: T[], keyFn: TransformFn<T, string>): Promise<Record<string, T[]>> {
    const groups: Record<string, T[]> = {};
    for (const item of data) {
      const key = await keyFn(item);
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    return groups;
  }

  /**
   * Sort items using a comparator.
   */
  static sort<T>(data: T[], compareFn?: (a: T, b: T) => number): T[] {
    return [...data].sort(compareFn);
  }

  /**
   * Remove duplicate items. Uses a key function for object comparison.
   */
  static async unique<T>(data: T[], keyFn?: TransformFn<T, string>): Promise<T[]> {
    if (!keyFn) {
      return [...new Set(data)];
    }
    const seen = new Set<string>();
    const results: T[] = [];
    for (const item of data) {
      const key = await keyFn(item);
      if (!seen.has(key)) {
        seen.add(key);
        results.push(item);
      }
    }
    return results;
  }

  /**
   * Apply a chain of transform functions sequentially.
   */
  static async chain<T>(data: T, transforms: TransformFn[]): Promise<any> {
    let result: any = data;
    for (const transform of transforms) {
      result = await transform(result);
    }
    return result;
  }
}
