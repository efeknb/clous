// ============================================
// Clous — DataPipeline Tests
// ============================================

import { DataPipeline } from '../src/pipeline/DataPipeline';
import { Transformer } from '../src/pipeline/Transformer';
import { Validator } from '../src/pipeline/Validator';
import { BatchProcessor } from '../src/pipeline/BatchProcessor';
import { EventBus } from '../src/utils/EventBus';
import { Logger } from '../src/utils/Logger';

const events = new EventBus();
const logger = new Logger('error').child('Pipeline');

describe('Transformer', () => {
  test('should map items', async () => {
    const result = await Transformer.map([1, 2, 3], (x) => x * 2);
    expect(result).toEqual([2, 4, 6]);
  });

  test('should filter items', async () => {
    const result = await Transformer.filter([1, 2, 3, 4, 5], (x) => x > 3);
    expect(result).toEqual([4, 5]);
  });

  test('should reduce items', async () => {
    const result = await Transformer.reduce([1, 2, 3, 4], (acc, x) => acc + x, 0);
    expect(result).toBe(10);
  });

  test('should flatMap items', async () => {
    const result = await Transformer.flatMap([1, 2, 3], (x) => [x, x * 10]);
    expect(result).toEqual([1, 10, 2, 20, 3, 30]);
  });

  test('should groupBy items', async () => {
    const items = [
      { type: 'a', value: 1 },
      { type: 'b', value: 2 },
      { type: 'a', value: 3 },
    ];
    const result = await Transformer.groupBy(items, (i) => i.type);
    expect(result['a']).toHaveLength(2);
    expect(result['b']).toHaveLength(1);
  });

  test('should unique items', async () => {
    const result = await Transformer.unique([1, 2, 2, 3, 3, 3]);
    expect(result).toEqual([1, 2, 3]);
  });

  test('should unique objects with key function', async () => {
    const items = [
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
      { id: 1, name: 'A duplicate' },
    ];
    const result = await Transformer.unique(items, (i) => String(i.id));
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('A');
  });

  test('should chain transforms', async () => {
    const result = await Transformer.chain(5, [
      (x: number) => x * 2,
      (x: number) => x + 1,
      (x: number) => `Result: ${x}`,
    ]);
    expect(result).toBe('Result: 11');
  });

  test('should handle async transforms', async () => {
    const result = await Transformer.map([1, 2, 3], async (x) => {
      return x * 3;
    });
    expect(result).toEqual([3, 6, 9]);
  });
});

describe('Validator', () => {
  test('should validate required fields', () => {
    const result = Validator.validate(
      { name: '', email: 'test@test.com' },
      [
        { field: 'name', rules: [{ type: 'required' }] },
        { field: 'email', rules: [{ type: 'required' }] },
      ],
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('name');
  });

  test('should validate types', () => {
    const result = Validator.validate(
      { age: 'not-a-number', name: 'John' },
      [
        { field: 'age', rules: [{ type: 'type', value: 'number' }] },
        { field: 'name', rules: [{ type: 'type', value: 'string' }] },
      ],
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  test('should validate min/max for numbers', () => {
    const result = Validator.validate(
      { age: 15, score: 150 },
      [
        { field: 'age', rules: [{ type: 'min', value: 18 }] },
        { field: 'score', rules: [{ type: 'max', value: 100 }] },
      ],
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  test('should validate patterns', () => {
    const result = Validator.validate(
      { email: 'invalid-email' },
      [{ field: 'email', rules: [{ type: 'pattern', value: /^.+@.+\..+$/ }] }],
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0].rule).toBe('pattern');
  });

  test('should validate custom rules', () => {
    const result = Validator.validate(
      { value: 7 },
      [{
        field: 'value',
        rules: [{
          type: 'custom',
          validator: (v) => v % 2 === 0,
          message: 'Must be even',
        }],
      }],
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toBe('Must be even');
  });

  test('should validate nested fields', () => {
    const result = Validator.validate(
      { user: { profile: { name: '' } } },
      [{ field: 'user.profile.name', rules: [{ type: 'required' }] }],
    );

    expect(result.valid).toBe(false);
  });

  test('should validate arrays', () => {
    const data = [
      { name: 'John', age: 25 },
      { name: '', age: 17 },
    ];
    const result = Validator.validateArray(data, [
      { field: 'name', rules: [{ type: 'required' }] },
      { field: 'age', rules: [{ type: 'min', value: 18 }] },
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2); // name required + age min
  });

  test('should validate schema types', () => {
    const result = Validator.validateSchema(
      { name: 'John', age: 25, tags: ['a'] },
      { name: 'string', age: 'number', tags: 'array' },
    );

    expect(result.valid).toBe(true);
  });

  test('should create reusable validator', () => {
    const validate = Validator.createValidator([
      { field: 'name', rules: [{ type: 'required' }] },
    ]);

    expect(validate({ name: 'John' }).valid).toBe(true);
    expect(validate({ name: '' }).valid).toBe(false);
  });
});

describe('BatchProcessor', () => {
  test('should process items in batches', async () => {
    const data = Array.from({ length: 100 }, (_, i) => i);
    const result = await BatchProcessor.process(
      data,
      async (chunk) => chunk.map((x) => x * 2),
      { chunkSize: 25 },
    );

    expect(result.results).toHaveLength(100);
    expect(result.results[0]).toBe(0);
    expect(result.results[99]).toBe(198);
    expect(result.errors).toHaveLength(0);
  });

  test('should report progress', async () => {
    const progresses: any[] = [];
    const data = Array.from({ length: 50 }, (_, i) => i);

    await BatchProcessor.process(
      data,
      async (chunk) => chunk,
      {
        chunkSize: 10,
        concurrency: 2,
        onProgress: (p) => progresses.push({ ...p }),
      },
    );

    expect(progresses.length).toBeGreaterThan(0);
    expect(progresses[progresses.length - 1].percentage).toBe(100);
  });

  test('should isolate chunk errors', async () => {
    const data = [1, 2, 3, 4, 5];
    const result = await BatchProcessor.process(
      data,
      async (chunk) => {
        if (chunk.includes(3)) throw new Error('Chunk error');
        return chunk;
      },
      { chunkSize: 1 },
    );

    expect(result.results).toHaveLength(4); // 4 successful
    expect(result.errors).toHaveLength(1);
  });

  test('should process pool with concurrency', async () => {
    const data = Array.from({ length: 10 }, (_, i) => i);
    const result = await BatchProcessor.processPool(
      data,
      async (item) => item * 3,
      3,
    );

    expect(result.results).toHaveLength(10);
    expect(result.results).toEqual(data.map((x) => x * 3));
  });
});

describe('DataPipeline', () => {
  test('should execute a simple transform pipeline', async () => {
    const pipeline = new DataPipeline(events, logger);
    const result = await pipeline
      .from([1, 2, 3, 4, 5])
      .transform((x: number) => x * 2)
      .execute<number[]>();

    expect(result.success).toBe(true);
    expect(result.data).toEqual([2, 4, 6, 8, 10]);
    expect(result.metadata.stepsExecuted).toBe(1);
    expect(result.metadata.checksum).toBeTruthy();
  });

  test('should execute transform + filter pipeline', async () => {
    const pipeline = new DataPipeline(events, logger);
    const result = await pipeline
      .from([1, 2, 3, 4, 5, 6])
      .transform((x: number) => x * 2)
      .filter((x: number) => x > 6)
      .execute<number[]>();

    expect(result.success).toBe(true);
    expect(result.data).toEqual([8, 10, 12]);
  });

  test('should validate data in pipeline', async () => {
    const pipeline = new DataPipeline(events, logger);
    const result = await pipeline
      .from([
        { name: 'John', age: 25 },
        { name: 'Jane', age: 30 },
      ])
      .validate([{ field: 'name', rules: [{ type: 'required' }] }])
      .execute();

    expect(result.success).toBe(true);
  });

  test('should fail validation in pipeline', async () => {
    const pipeline = new DataPipeline(events, logger);
    const result = await pipeline
      .from([
        { name: '', age: 25 },
      ])
      .validate([{ field: 'name', rules: [{ type: 'required' }] }])
      .execute();

    expect(result.success).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test('should use custom pipe step', async () => {
    const pipeline = new DataPipeline(events, logger);
    const result = await pipeline
      .from([3, 1, 4, 1, 5])
      .pipe('sort', (data: number[]) => [...data].sort((a, b) => a - b))
      .execute<number[]>();

    expect(result.success).toBe(true);
    expect(result.data).toEqual([1, 1, 3, 4, 5]);
  });

  test('should emit pipeline events', async () => {
    const emittedEvents: string[] = [];
    events.on('pipeline:start', () => emittedEvents.push('start'));
    events.on('pipeline:complete', () => emittedEvents.push('complete'));

    const pipeline = new DataPipeline(events, logger);
    await pipeline.from([1]).transform((x: number) => x).execute();

    expect(emittedEvents).toContain('start');
    expect(emittedEvents).toContain('complete');

    events.removeAllListeners();
  });

  test('should throw when no input data', async () => {
    const pipeline = new DataPipeline(events, logger);
    await expect(pipeline.execute()).rejects.toThrow('No input data');
  });

  test('should record execution duration', async () => {
    const pipeline = new DataPipeline(events, logger);
    const result = await pipeline
      .from([1, 2, 3])
      .transform((x: number) => x)
      .execute<number[]>();

    expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
  });
});
