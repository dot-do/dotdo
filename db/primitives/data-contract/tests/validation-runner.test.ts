/**
 * Validation Runner tests
 *
 * Tests the ValidationRunner implementation with:
 * - Batch validation of datasets
 * - Streaming validation for async data sources
 * - Row-level validation for real-time use
 * - Parallel execution for independent expectations
 * - Short-circuit option on first failure
 * - Progress reporting for long-running validations
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ValidationRunner,
  createRunner,
  runValidation,
  validateSingleRow,
  type ValidationReport,
  type RowValidationResult,
  type StreamRowResult,
  type StreamValidationSummary,
  type ValidationProgress,
  type ValidationRunnerOptions,
} from '../validation-runner'
import { expect as exp } from '../expectation-dsl'

// ============================================================================
// TEST FIXTURES
// ============================================================================

function createBasicSuite() {
  return [
    exp('id').toBeNotNull().build(),
    exp('email').toBeNotNull().and().toMatch(/^.+@.+\..+$/).build(),
    exp('age').toBeNumber().and().toBeBetween(0, 150).build(),
  ]
}

function createAggregateSuite() {
  return [
    exp('id').toBeUnique().build(),
    exp('amount').toHaveSum({ min: 0, max: 10000 }).build(),
    exp('score').toHaveAvg(50, { tolerance: 5 }).build(),
  ]
}

function createValidData() {
  return [
    { id: '1', email: 'alice@example.com', age: 30, amount: 100, score: 50 },
    { id: '2', email: 'bob@example.com', age: 25, amount: 200, score: 55 },
    { id: '3', email: 'carol@example.com', age: 35, amount: 150, score: 45 },
  ]
}

function createInvalidData() {
  return [
    { id: null, email: 'alice@example.com', age: 30 },
    { id: '2', email: 'invalid', age: 25 },
    { id: '3', email: 'carol@example.com', age: 200 },
  ]
}

// ============================================================================
// ROW-LEVEL VALIDATION
// ============================================================================

describe('ValidationRunner', () => {
  describe('row-level validation', () => {
    let suite: ReturnType<typeof createBasicSuite>

    beforeEach(() => {
      suite = createBasicSuite()
    })

    it('should validate a single valid row', () => {
      const runner = new ValidationRunner(suite)
      const result = runner.validateRow({
        id: '1',
        email: 'alice@example.com',
        age: 30,
      })

      expect(result.passed).toBe(true)
      expect(result.failures).toHaveLength(0)
      expect(result.timing.totalMs).toBeGreaterThanOrEqual(0)
    })

    it('should validate a single invalid row', () => {
      const runner = new ValidationRunner(suite)
      const result = runner.validateRow({
        id: null,
        email: 'invalid',
        age: 200,
      })

      expect(result.passed).toBe(false)
      expect(result.failures.length).toBeGreaterThan(0)
    })

    it('should include row data in result', () => {
      const runner = new ValidationRunner(suite)
      const inputRow = { id: '1', email: 'test@example.com', age: 25 }
      const result = runner.validateRow(inputRow)

      expect(result.data).toEqual(inputRow)
    })

    it('should use default index of -1 for single row validation', () => {
      const runner = new ValidationRunner(suite)
      const result = runner.validateRow({ id: '1', email: 'test@example.com', age: 25 })

      expect(result.index).toBe(-1)
    })

    it('should use provided index', () => {
      const runner = new ValidationRunner(suite)
      const result = runner.validateRow({ id: '1', email: 'test@example.com', age: 25 }, 42)

      expect(result.index).toBe(42)
    })

    it('should capture all failures for a row', () => {
      const runner = new ValidationRunner(suite)
      const result = runner.validateRow({
        id: null,
        email: 'invalid',
        age: -5,
      })

      expect(result.failures.length).toBeGreaterThan(1)
      expect(result.failures.some((f) => f.column === 'id')).toBe(true)
      expect(result.failures.some((f) => f.column === 'email')).toBe(true)
    })
  })

  // ============================================================================
  // BATCH VALIDATION
  // ============================================================================

  describe('batch validation', () => {
    let suite: ReturnType<typeof createBasicSuite>

    beforeEach(() => {
      suite = createBasicSuite()
    })

    it('should validate all records in a batch', () => {
      const runner = new ValidationRunner(suite)
      const data = createValidData()
      const result = runner.validate(data)

      expect(result.totalRecords).toBe(3)
      expect(result.passedRecords).toBe(3)
      expect(result.failedRecords).toBe(0)
      expect(result.passed).toBe(true)
    })

    it('should track failures separately', () => {
      const runner = new ValidationRunner(suite)
      const data = createInvalidData()
      const result = runner.validate(data)

      expect(result.passed).toBe(false)
      expect(result.failedRecords).toBeGreaterThan(0)
      expect(result.failures.length).toBeGreaterThan(0)
    })

    it('should provide per-row results', () => {
      const runner = new ValidationRunner(suite)
      const data = createValidData()
      const result = runner.validate(data)

      expect(result.rowResults).toHaveLength(3)
      expect(result.rowResults[0].index).toBe(0)
      expect(result.rowResults[1].index).toBe(1)
      expect(result.rowResults[2].index).toBe(2)
    })

    it('should include timing information', () => {
      const runner = new ValidationRunner(suite)
      const data = createValidData()
      const result = runner.validate(data)

      expect(result.timing.totalMs).toBeGreaterThanOrEqual(0)
      expect(result.timing.avgPerRecordMs).toBeGreaterThanOrEqual(0)
    })

    it('should report expectations checked', () => {
      const runner = new ValidationRunner(suite)
      const data = createValidData()
      const result = runner.validate(data)

      expect(result.expectationsChecked).toBe(3)
    })

    it('should handle empty data array', () => {
      const runner = new ValidationRunner(suite)
      const result = runner.validate([])

      expect(result.totalRecords).toBe(0)
      expect(result.passedRecords).toBe(0)
      expect(result.failedRecords).toBe(0)
      expect(result.passed).toBe(true)
    })
  })

  // ============================================================================
  // SHORT-CIRCUIT OPTION
  // ============================================================================

  describe('short-circuit option', () => {
    it('should stop on first failure when shortCircuit is true', () => {
      const suite = createBasicSuite()
      const runner = new ValidationRunner(suite, { shortCircuit: true })

      const data = [
        { id: null, email: 'invalid', age: -5 }, // should stop here
        { id: '2', email: 'test@example.com', age: 25 },
        { id: '3', email: 'test2@example.com', age: 30 },
      ]

      const result = runner.validate(data)

      expect(result.earlyTerminated).toBe(true)
      // Should have processed at most the first row
      expect(result.rowResults.length).toBeLessThanOrEqual(1)
    })

    it('should continue on failures when shortCircuit is false', () => {
      const suite = createBasicSuite()
      const runner = new ValidationRunner(suite, { shortCircuit: false })

      const data = createInvalidData()
      const result = runner.validate(data)

      expect(result.earlyTerminated).toBe(false)
      expect(result.rowResults.length).toBe(3)
    })
  })

  // ============================================================================
  // MAX FAILURES OPTION
  // ============================================================================

  describe('max failures option', () => {
    it('should stop after reaching maxFailures', () => {
      const suite = createBasicSuite()
      const runner = new ValidationRunner(suite, { maxFailures: 2 })

      const data = [
        { id: null, email: 'test@example.com', age: 25 }, // 1 failure
        { id: null, email: 'test2@example.com', age: 30 }, // 2 failures - stop here
        { id: null, email: 'test3@example.com', age: 35 },
      ]

      const result = runner.validate(data)

      expect(result.earlyTerminated).toBe(true)
      expect(result.failures.length).toBeLessThanOrEqual(2)
    })
  })

  // ============================================================================
  // SAMPLE RATE OPTION
  // ============================================================================

  describe('sample rate option', () => {
    it('should skip records based on sample rate', () => {
      const suite = createBasicSuite()
      const runner = new ValidationRunner(suite, { sampleRate: 0.3 })

      const data = Array.from({ length: 100 }, (_, i) => ({
        id: `${i}`,
        email: `user${i}@example.com`,
        age: 25,
      }))

      const result = runner.validate(data)

      expect(result.skippedRecords).toBeGreaterThan(50)
      expect(result.skippedRecords).toBeLessThan(90)
    })

    it('should validate all records when sampleRate is 1.0', () => {
      const suite = createBasicSuite()
      const runner = new ValidationRunner(suite, { sampleRate: 1.0 })

      const data = createValidData()
      const result = runner.validate(data)

      expect(result.skippedRecords).toBe(0)
      expect(result.passedRecords).toBe(3)
    })
  })

  // ============================================================================
  // PROGRESS REPORTING
  // ============================================================================

  describe('progress reporting', () => {
    it('should call progress callback during validation', () => {
      const suite = createBasicSuite()
      const progressCallback = vi.fn()
      const runner = new ValidationRunner(suite, {
        onProgress: progressCallback,
        progressInterval: 10,
      })

      const data = Array.from({ length: 50 }, (_, i) => ({
        id: `${i}`,
        email: `user${i}@example.com`,
        age: 25,
      }))

      runner.validate(data)

      expect(progressCallback).toHaveBeenCalled()
    })

    it('should include correct progress information', () => {
      const suite = createBasicSuite()
      const progressUpdates: ValidationProgress[] = []
      const runner = new ValidationRunner(suite, {
        onProgress: (p) => progressUpdates.push(p),
        progressInterval: 10,
      })

      const data = Array.from({ length: 25 }, (_, i) => ({
        id: `${i}`,
        email: `user${i}@example.com`,
        age: 25,
      }))

      runner.validate(data)

      expect(progressUpdates.length).toBeGreaterThan(0)
      const lastProgress = progressUpdates[progressUpdates.length - 1]!
      expect(lastProgress.processedRecords).toBeGreaterThan(0)
      expect(lastProgress.elapsedMs).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // AGGREGATE EXPECTATIONS
  // ============================================================================

  describe('aggregate expectations', () => {
    it('should validate uniqueness across dataset', () => {
      const suite = [exp('id').toBeUnique().build()]
      const runner = new ValidationRunner(suite)

      const dataWithDuplicates = [
        { id: '1' },
        { id: '2' },
        { id: '1' }, // duplicate
      ]

      const result = runner.validate(dataWithDuplicates)

      expect(result.passed).toBe(false)
      expect(result.failures.some((f) => f.expectationType === 'unique')).toBe(true)
    })

    it('should validate sum constraints', () => {
      const suite = [exp('amount').toHaveSum({ min: 100, max: 500 }).build()]
      const runner = new ValidationRunner(suite)

      const data = [{ amount: 100 }, { amount: 200 }, { amount: 150 }]

      const result = runner.validate(data)

      expect(result.passed).toBe(true)
    })

    it('should fail on sum out of range', () => {
      const suite = [exp('amount').toHaveSum({ max: 100 }).build()]
      const runner = new ValidationRunner(suite)

      const data = [{ amount: 100 }, { amount: 200 }]

      const result = runner.validate(data)

      expect(result.passed).toBe(false)
      expect(result.failures.some((f) => f.expectationType === 'aggregate_sum')).toBe(true)
    })

    it('should validate average constraints', () => {
      const suite = [exp('score').toHaveAvg(50, { tolerance: 5 }).build()]
      const runner = new ValidationRunner(suite)

      const data = [{ score: 48 }, { score: 52 }, { score: 50 }]

      const result = runner.validate(data)

      expect(result.passed).toBe(true)
    })

    it('should validate row count', () => {
      const suite = [exp('*').toHaveCount({ min: 2, max: 10 }).build()]
      const runner = new ValidationRunner(suite)

      const data = [{ id: '1' }, { id: '2' }, { id: '3' }]

      const result = runner.validate(data)

      expect(result.passed).toBe(true)
    })

    it('should fail on row count out of range', () => {
      const suite = [exp('*').toHaveCount({ max: 2 }).build()]
      const runner = new ValidationRunner(suite)

      const data = [{ id: '1' }, { id: '2' }, { id: '3' }]

      const result = runner.validate(data)

      expect(result.passed).toBe(false)
      expect(result.failures.some((f) => f.expectationType === 'aggregate_count')).toBe(true)
    })
  })

  // ============================================================================
  // STREAMING VALIDATION
  // ============================================================================

  describe('streaming validation', () => {
    /**
     * Helper to create an async generator from an array
     */
    async function* asyncGenerator<T>(items: T[]): AsyncGenerator<T> {
      for (const item of items) {
        yield item
      }
    }

    /**
     * Helper to collect all results from an async generator
     */
    async function collectStreamResults(
      generator: AsyncGenerator<StreamRowResult, StreamValidationSummary, undefined>
    ): Promise<{ results: StreamRowResult[]; summary: StreamValidationSummary }> {
      const results: StreamRowResult[] = []
      let iterResult = await generator.next()
      while (!iterResult.done) {
        results.push(iterResult.value)
        iterResult = await generator.next()
      }
      return { results, summary: iterResult.value }
    }

    it('should validate records from an async iterable', async () => {
      const suite = createBasicSuite()
      const runner = new ValidationRunner(suite)

      const stream = asyncGenerator(createValidData())
      const { results, summary } = await collectStreamResults(runner.validateStream(stream))

      expect(results).toHaveLength(3)
      expect(results.every((r) => r.passed)).toBe(true)
      expect(summary.totalRecords).toBe(3)
      expect(summary.passedRecords).toBe(3)
    })

    it('should validate records from a sync iterable', async () => {
      const suite = createBasicSuite()
      const runner = new ValidationRunner(suite)

      const data = createValidData()
      const { results, summary } = await collectStreamResults(runner.validateStream(data))

      expect(results).toHaveLength(3)
      expect(summary.passedRecords).toBe(3)
    })

    it('should include cumulative counts', async () => {
      const suite = createBasicSuite()
      const runner = new ValidationRunner(suite)

      const data = [
        { id: '1', email: 'a@test.com', age: 25 },
        { id: null, email: 'b@test.com', age: 30 }, // invalid
        { id: '3', email: 'c@test.com', age: 35 },
      ]

      const { results } = await collectStreamResults(runner.validateStream(asyncGenerator(data)))

      expect(results[0].cumulativePassedCount).toBe(1)
      expect(results[0].cumulativeFailedCount).toBe(0)
      expect(results[1].cumulativePassedCount).toBe(1)
      expect(results[1].cumulativeFailedCount).toBe(1)
      expect(results[2].cumulativePassedCount).toBe(2)
      expect(results[2].cumulativeFailedCount).toBe(1)
    })

    it('should support abort signal', async () => {
      const suite = createBasicSuite()
      const abortController = new AbortController()
      const runner = new ValidationRunner(suite, { signal: abortController.signal })

      let count = 0
      async function* infiniteGenerator() {
        while (true) {
          count++
          yield { id: `${count}`, email: `user${count}@test.com`, age: 25 }
          if (count >= 5) {
            abortController.abort()
          }
        }
      }

      const { results } = await collectStreamResults(runner.validateStream(infiniteGenerator()))

      expect(results.length).toBeLessThanOrEqual(6)
      expect(results.length).toBeGreaterThanOrEqual(5)
    })

    it('should support sample rate in streaming', async () => {
      const suite = createBasicSuite()
      const runner = new ValidationRunner(suite, { sampleRate: 0.3 })

      const data = Array.from({ length: 100 }, (_, i) => ({
        id: `${i}`,
        email: `user${i}@test.com`,
        age: 25,
      }))

      const { summary } = await collectStreamResults(runner.validateStream(asyncGenerator(data)))

      expect(summary.skippedRecords).toBeGreaterThan(50)
      expect(summary.skippedRecords).toBeLessThan(90)
    })

    it('should support factory function as source', async () => {
      const suite = createBasicSuite()
      const runner = new ValidationRunner(suite)

      const factory = () => asyncGenerator(createValidData())
      const { results } = await collectStreamResults(runner.validateStream(factory))

      expect(results).toHaveLength(3)
    })
  })

  // ============================================================================
  // STREAM TO BATCH
  // ============================================================================

  describe('stream to batch', () => {
    async function* asyncGenerator<T>(items: T[]): AsyncGenerator<T> {
      for (const item of items) {
        yield item
      }
    }

    it('should collect streaming results into a batch report', async () => {
      const suite = createBasicSuite()
      const runner = new ValidationRunner(suite)

      const data = createValidData()
      const result = await runner.validateStreamToBatch(asyncGenerator(data))

      expect(result.totalRecords).toBe(3)
      expect(result.passedRecords).toBe(3)
      expect(result.rowResults).toHaveLength(3)
      expect(result.passed).toBe(true)
    })

    it('should track failures in batch report', async () => {
      const suite = createBasicSuite()
      const runner = new ValidationRunner(suite)

      const data = createInvalidData()
      const result = await runner.validateStreamToBatch(asyncGenerator(data))

      expect(result.passed).toBe(false)
      expect(result.failures.length).toBeGreaterThan(0)
      expect(result.failedRecords).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // PARALLEL EXECUTION
  // ============================================================================

  describe('parallel execution', () => {
    it('should validate in parallel', async () => {
      const suite = createBasicSuite()
      const runner = new ValidationRunner(suite, { parallelExecution: true })

      const data = createValidData()
      const result = await runner.validateParallel(data)

      expect(result.totalRecords).toBe(3)
      expect(result.passedRecords).toBe(3)
      expect(result.passed).toBe(true)
    })

    it('should handle failures in parallel mode', async () => {
      const suite = createBasicSuite()
      const runner = new ValidationRunner(suite, { parallelExecution: true })

      const data = createInvalidData()
      const result = await runner.validateParallel(data)

      expect(result.passed).toBe(false)
      expect(result.failedRecords).toBeGreaterThan(0)
    })

    it('should respect shortCircuit in parallel mode', async () => {
      const suite = createBasicSuite()
      const runner = new ValidationRunner(suite, {
        parallelExecution: true,
        shortCircuit: true,
      })

      const data = createInvalidData()
      const result = await runner.validateParallel(data)

      expect(result.earlyTerminated).toBe(true)
    })

    it('should support sample rate in parallel mode', async () => {
      const suite = createBasicSuite()
      const runner = new ValidationRunner(suite, {
        parallelExecution: true,
        sampleRate: 0.5,
      })

      const data = Array.from({ length: 100 }, (_, i) => ({
        id: `${i}`,
        email: `user${i}@test.com`,
        age: 25,
      }))

      const result = await runner.validateParallel(data)

      expect(result.skippedRecords).toBeGreaterThan(30)
      expect(result.skippedRecords).toBeLessThan(70)
    })
  })

  // ============================================================================
  // ASYNC VALIDATION
  // ============================================================================

  describe('async validation', () => {
    it('should validate asynchronously', async () => {
      const suite = createBasicSuite()
      const runner = new ValidationRunner(suite)

      const data = createValidData()
      const result = await runner.validateAsync(data)

      expect(result.totalRecords).toBe(3)
      expect(result.passedRecords).toBe(3)
    })
  })

  // ============================================================================
  // FACTORY FUNCTIONS
  // ============================================================================

  describe('factory functions', () => {
    it('should create runner with createRunner', () => {
      const suite = createBasicSuite()
      const runner = createRunner(suite)

      expect(runner).toBeInstanceOf(ValidationRunner)
    })

    it('should validate with runValidation helper', () => {
      const suite = createBasicSuite()
      const data = createValidData()
      const result = runValidation(suite, data)

      expect(result.totalRecords).toBe(3)
      expect(result.passedRecords).toBe(3)
    })

    it('should validate single row with validateSingleRow helper', () => {
      const suite = createBasicSuite()
      const result = validateSingleRow(suite, {
        id: '1',
        email: 'test@example.com',
        age: 25,
      })

      expect(result.passed).toBe(true)
    })

    it('should pass options to runValidation', () => {
      const suite = createBasicSuite()
      const data = createInvalidData()
      const result = runValidation(suite, data, { shortCircuit: true })

      expect(result.earlyTerminated).toBe(true)
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('should handle empty expectation suite', () => {
      const runner = new ValidationRunner([])
      const data = createValidData()
      const result = runner.validate(data)

      expect(result.passed).toBe(true)
      expect(result.totalRecords).toBe(3)
      expect(result.failures).toHaveLength(0)
    })

    it('should handle nested field paths', () => {
      const suite = [exp('address.city').toBeNotNull().build()]
      const runner = new ValidationRunner(suite)

      const data = [
        { id: '1', address: { city: 'NYC' } },
        { id: '2', address: { city: null } },
      ]

      const result = runner.validate(data)

      expect(result.passedRecords).toBe(1)
      expect(result.failedRecords).toBe(1)
    })

    it('should handle array index paths', () => {
      const suite = [exp('tags[0]').toBeNotNull().build()]
      const runner = new ValidationRunner(suite)

      const data = [{ tags: ['first', 'second'] }, { tags: [] }]

      const result = runner.validate(data)

      expect(result.passedRecords).toBe(1)
      expect(result.failedRecords).toBe(1)
    })

    it('should handle OR logic in expectations', () => {
      const suite = [exp('status').toBeIn(['active', 'pending']).or().toBeIn(['inactive']).build()]
      const runner = new ValidationRunner(suite)

      const data = [
        { status: 'active' },
        { status: 'inactive' },
        { status: 'unknown' }, // should fail
      ]

      const result = runner.validate(data)

      expect(result.passedRecords).toBe(2)
      expect(result.failedRecords).toBe(1)
    })

    it('should handle mixed aggregate and row expectations', () => {
      const suite = [
        exp('id').toBeUnique().build(), // aggregate
        exp('email').toBeNotNull().build(), // row-level
        exp('amount').toHaveSum({ min: 0 }).build(), // aggregate
      ]
      const runner = new ValidationRunner(suite)

      const data = [
        { id: '1', email: 'a@test.com', amount: 100 },
        { id: '2', email: 'b@test.com', amount: 200 },
      ]

      const result = runner.validate(data)

      expect(result.passed).toBe(true)
    })

    it('should handle null values correctly', () => {
      const suite = [exp('value').toBeNumber().build()]
      const runner = new ValidationRunner(suite)

      const data = [{ value: null }, { value: 10 }]

      const result = runner.validate(data)

      // null should be skipped for non-null checks
      expect(result.passedRecords).toBe(2)
    })

    it('should handle undefined values correctly', () => {
      const suite = [exp('value').toBeNumber().build()]
      const runner = new ValidationRunner(suite)

      const data = [{ value: undefined }, { value: 10 }]

      const result = runner.validate(data)

      // undefined should be skipped for non-null checks
      expect(result.passedRecords).toBe(2)
    })
  })

  // ============================================================================
  // PERFORMANCE
  // ============================================================================

  describe('performance', () => {
    it('should validate 1000 records efficiently', () => {
      const suite = createBasicSuite()
      const runner = new ValidationRunner(suite)

      const data = Array.from({ length: 1000 }, (_, i) => ({
        id: `${i}`,
        email: `user${i}@test.com`,
        age: 25,
      }))

      const result = runner.validate(data)

      expect(result.totalRecords).toBe(1000)
      expect(result.timing.avgPerRecordMs).toBeLessThan(1)
    })

    it('should handle large dataset with aggregates', () => {
      const suite = [
        exp('id').toBeUnique().build(),
        exp('amount').toHaveSum({ min: 0 }).build(),
      ]
      const runner = new ValidationRunner(suite)

      const data = Array.from({ length: 1000 }, (_, i) => ({
        id: `${i}`,
        amount: i * 10,
      }))

      const result = runner.validate(data)

      expect(result.passed).toBe(true)
      expect(result.timing.totalMs).toBeLessThan(1000)
    })
  })

  // ============================================================================
  // TYPE CHECKS
  // ============================================================================

  describe('type checks', () => {
    it('should validate string type', () => {
      const suite = [exp('name').toBeString().build()]
      const runner = new ValidationRunner(suite)

      const result = runner.validate([{ name: 'Alice' }, { name: 123 }])

      expect(result.passedRecords).toBe(1)
      expect(result.failedRecords).toBe(1)
    })

    it('should validate integer type', () => {
      const suite = [exp('count').toBeInteger().build()]
      const runner = new ValidationRunner(suite)

      const result = runner.validate([{ count: 5 }, { count: 5.5 }])

      expect(result.passedRecords).toBe(1)
      expect(result.failedRecords).toBe(1)
    })

    it('should validate boolean type', () => {
      const suite = [exp('active').toBeBoolean().build()]
      const runner = new ValidationRunner(suite)

      const result = runner.validate([{ active: true }, { active: 'yes' }])

      expect(result.passedRecords).toBe(1)
      expect(result.failedRecords).toBe(1)
    })

    it('should validate date type', () => {
      const suite = [exp('created').toBeDate().build()]
      const runner = new ValidationRunner(suite)

      const result = runner.validate([
        { created: '2024-01-01' },
        { created: new Date() },
        { created: 'not-a-date' },
      ])

      expect(result.passedRecords).toBe(2)
      expect(result.failedRecords).toBe(1)
    })
  })

  // ============================================================================
  // STRING LENGTH CHECKS
  // ============================================================================

  describe('string length checks', () => {
    it('should validate min length', () => {
      const suite = [exp('name').toHaveMinLength(3).build()]
      const runner = new ValidationRunner(suite)

      const result = runner.validate([{ name: 'Alice' }, { name: 'Al' }])

      expect(result.passedRecords).toBe(1)
      expect(result.failedRecords).toBe(1)
    })

    it('should validate max length', () => {
      const suite = [exp('code').toHaveMaxLength(5).build()]
      const runner = new ValidationRunner(suite)

      const result = runner.validate([{ code: 'ABC' }, { code: 'ABCDEFGH' }])

      expect(result.passedRecords).toBe(1)
      expect(result.failedRecords).toBe(1)
    })
  })

  // ============================================================================
  // COMPARISON CHECKS
  // ============================================================================

  describe('comparison checks', () => {
    it('should validate greater than', () => {
      const suite = [exp('price').toBeGreaterThan(0).build()]
      const runner = new ValidationRunner(suite)

      const result = runner.validate([{ price: 10 }, { price: 0 }, { price: -5 }])

      expect(result.passedRecords).toBe(1)
      expect(result.failedRecords).toBe(2)
    })

    it('should validate greater than or equal', () => {
      const suite = [exp('price').toBeGreaterThanOrEqual(0).build()]
      const runner = new ValidationRunner(suite)

      const result = runner.validate([{ price: 10 }, { price: 0 }, { price: -5 }])

      expect(result.passedRecords).toBe(2)
      expect(result.failedRecords).toBe(1)
    })

    it('should validate less than', () => {
      const suite = [exp('age').toBeLessThan(100).build()]
      const runner = new ValidationRunner(suite)

      const result = runner.validate([{ age: 50 }, { age: 100 }, { age: 150 }])

      expect(result.passedRecords).toBe(1)
      expect(result.failedRecords).toBe(2)
    })

    it('should validate less than or equal', () => {
      const suite = [exp('age').toBeLessThanOrEqual(100).build()]
      const runner = new ValidationRunner(suite)

      const result = runner.validate([{ age: 50 }, { age: 100 }, { age: 150 }])

      expect(result.passedRecords).toBe(2)
      expect(result.failedRecords).toBe(1)
    })

    it('should validate between inclusive', () => {
      const suite = [exp('score').toBeBetween(0, 100).build()]
      const runner = new ValidationRunner(suite)

      const result = runner.validate([
        { score: 0 },
        { score: 50 },
        { score: 100 },
        { score: -1 },
        { score: 101 },
      ])

      expect(result.passedRecords).toBe(3)
      expect(result.failedRecords).toBe(2)
    })

    it('should validate between exclusive', () => {
      const suite = [exp('score').toBeBetween(0, 100, { exclusive: true }).build()]
      const runner = new ValidationRunner(suite)

      const result = runner.validate([
        { score: 0 },
        { score: 50 },
        { score: 100 },
      ])

      expect(result.passedRecords).toBe(1)
      expect(result.failedRecords).toBe(2)
    })
  })
})
