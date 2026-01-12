import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  DataPipeline,
  PipelineBuilder,
  BatchProcessor,
  StreamProcessor,
  ErrorCollector,
  MetricsCollector,
  RetryHandler,
} from './index'
import type { PipelineError, PipelineMetrics, Stage } from './types'

// ============================================================================
// Single Item Processing
// ============================================================================

describe('DataPipeline - Single Item Processing', () => {
  it('processes a single item through a transform stage', async () => {
    const pipeline = new DataPipeline()
    pipeline.addStage({
      name: 'double',
      type: 'transform',
      transform: (x: number) => x * 2,
    })

    const result = await pipeline.process(5)

    expect(result.success).toBe(true)
    expect(result.data).toBe(10)
    expect(result.filtered).toBe(false)
  })

  it('returns null data when item is filtered out', async () => {
    const pipeline = new DataPipeline()
    pipeline.addStage({
      name: 'filter-even',
      type: 'filter',
      filter: (x: number) => x % 2 === 0,
    })

    const result = await pipeline.process(5)

    expect(result.success).toBe(true)
    expect(result.data).toBe(null)
    expect(result.filtered).toBe(true)
  })

  it('passes item through when filter matches', async () => {
    const pipeline = new DataPipeline()
    pipeline.addStage({
      name: 'filter-even',
      type: 'filter',
      filter: (x: number) => x % 2 === 0,
    })

    const result = await pipeline.process(4)

    expect(result.success).toBe(true)
    expect(result.data).toBe(4)
    expect(result.filtered).toBe(false)
  })

  it('fails validation and returns error', async () => {
    const pipeline = new DataPipeline()
    pipeline.addStage({
      name: 'validate-positive',
      type: 'validate',
      validate: (x: number) => x > 0,
    })

    const result = await pipeline.process(-5)

    expect(result.success).toBe(false)
    expect(result.data).toBe(null)
    expect(result.error).not.toBe(null)
    expect(result.error?.stage).toBe('validate-positive')
  })

  it('passes validation and returns data', async () => {
    const pipeline = new DataPipeline()
    pipeline.addStage({
      name: 'validate-positive',
      type: 'validate',
      validate: (x: number) => x > 0,
    })

    const result = await pipeline.process(5)

    expect(result.success).toBe(true)
    expect(result.data).toBe(5)
  })
})

// ============================================================================
// Multiple Stages
// ============================================================================

describe('DataPipeline - Multiple Stages', () => {
  it('processes item through multiple transform stages', async () => {
    const pipeline = new DataPipeline()
    pipeline.addStage({
      name: 'double',
      type: 'transform',
      transform: (x: number) => x * 2,
    })
    pipeline.addStage({
      name: 'add-ten',
      type: 'transform',
      transform: (x: number) => x + 10,
    })

    const result = await pipeline.process(5)

    expect(result.data).toBe(20) // (5 * 2) + 10
  })

  it('stops processing when filter stage filters out item', async () => {
    const thirdStageFn = vi.fn((x: number) => x + 100)

    const pipeline = new DataPipeline()
    pipeline.addStage({
      name: 'double',
      type: 'transform',
      transform: (x: number) => x * 2,
    })
    pipeline.addStage({
      name: 'filter-large',
      type: 'filter',
      filter: (x: number) => x > 100,
    })
    pipeline.addStage({
      name: 'add-hundred',
      type: 'transform',
      transform: thirdStageFn,
    })

    const result = await pipeline.process(5)

    expect(result.filtered).toBe(true)
    expect(thirdStageFn).not.toHaveBeenCalled()
  })

  it('stops processing when validation fails', async () => {
    const thirdStageFn = vi.fn((x: number) => x + 100)

    const pipeline = new DataPipeline()
    pipeline.addStage({
      name: 'double',
      type: 'transform',
      transform: (x: number) => x * 2,
    })
    pipeline.addStage({
      name: 'validate-small',
      type: 'validate',
      validate: (x: number) => x < 5,
    })
    pipeline.addStage({
      name: 'add-hundred',
      type: 'transform',
      transform: thirdStageFn,
    })

    const result = await pipeline.process(5)

    expect(result.success).toBe(false)
    expect(thirdStageFn).not.toHaveBeenCalled()
  })

  it('processes through mixed stage types in order', async () => {
    const pipeline = new DataPipeline()
    pipeline.addStage({
      name: 'validate-positive',
      type: 'validate',
      validate: (x: number) => x > 0,
    })
    pipeline.addStage({
      name: 'double',
      type: 'transform',
      transform: (x: number) => x * 2,
    })
    pipeline.addStage({
      name: 'filter-large',
      type: 'filter',
      filter: (x: number) => x > 5,
    })
    pipeline.addStage({
      name: 'to-string',
      type: 'transform',
      transform: (x: number) => `Result: ${x}`,
    })

    const result = await pipeline.process(10)

    expect(result.data).toBe('Result: 20')
  })
})

// ============================================================================
// Batch Processing
// ============================================================================

describe('DataPipeline - Batch Processing', () => {
  it('processes multiple items in a batch', async () => {
    const pipeline = new DataPipeline()
    pipeline.addStage({
      name: 'double',
      type: 'transform',
      transform: (x: number) => x * 2,
    })

    const result = await pipeline.batch([1, 2, 3, 4, 5])

    expect(result.success).toBe(true)
    expect(result.data).toEqual([2, 4, 6, 8, 10])
    expect(result.metrics.totalProcessed).toBe(5)
    expect(result.metrics.totalPassed).toBe(5)
  })

  it('excludes filtered items from results', async () => {
    const pipeline = new DataPipeline()
    pipeline.addStage({
      name: 'filter-even',
      type: 'filter',
      filter: (x: number) => x % 2 === 0,
    })

    const result = await pipeline.batch([1, 2, 3, 4, 5])

    expect(result.data).toEqual([2, 4])
    expect(result.metrics.totalFiltered).toBe(3)
  })

  it('collects errors for failed items', async () => {
    const pipeline = new DataPipeline()
    pipeline.addStage({
      name: 'validate-positive',
      type: 'validate',
      validate: (x: number) => x > 0,
    })

    const result = await pipeline.batch([1, -2, 3, -4, 5])

    expect(result.data).toEqual([1, 3, 5])
    expect(result.errors.length).toBe(2)
    expect(result.metrics.totalFailed).toBe(2)
  })

  it('tracks metrics for each stage', async () => {
    const pipeline = new DataPipeline()
    pipeline.addStage({
      name: 'filter-even',
      type: 'filter',
      filter: (x: number) => x % 2 === 0,
    })
    pipeline.addStage({
      name: 'double',
      type: 'transform',
      transform: (x: number) => x * 2,
    })

    const result = await pipeline.batch([1, 2, 3, 4, 5])

    expect(result.metrics.stages.length).toBe(2)
    expect(result.metrics.stages[0].name).toBe('filter-even')
    expect(result.metrics.stages[0].filtered).toBe(3)
  })
})

// ============================================================================
// Parallel Execution
// ============================================================================

describe('DataPipeline - Parallel Execution', () => {
  it('processes batch items in parallel', async () => {
    const callOrder: number[] = []

    const pipeline = new DataPipeline({
      batch: { size: 10, parallel: 3 },
    })
    pipeline.addStage({
      name: 'slow-transform',
      type: 'transform',
      transform: async (x: number) => {
        callOrder.push(x)
        await new Promise((r) => setTimeout(r, 10))
        return x * 2
      },
    })

    const result = await pipeline.batch([1, 2, 3, 4, 5, 6])

    expect(result.data).toEqual([2, 4, 6, 8, 10, 12])
    // With parallel=3, items should start processing before previous finish
  })

  it('respects parallel limit', async () => {
    let concurrentCount = 0
    let maxConcurrent = 0

    const pipeline = new DataPipeline({
      batch: { size: 10, parallel: 2 },
    })
    pipeline.addStage({
      name: 'track-concurrent',
      type: 'transform',
      transform: async (x: number) => {
        concurrentCount++
        maxConcurrent = Math.max(maxConcurrent, concurrentCount)
        await new Promise((r) => setTimeout(r, 50))
        concurrentCount--
        return x
      },
    })

    await pipeline.batch([1, 2, 3, 4, 5])

    expect(maxConcurrent).toBeLessThanOrEqual(2)
  })
})

// ============================================================================
// Stream Processing
// ============================================================================

describe('DataPipeline - Stream Processing', () => {
  it('processes items from an async iterable', async () => {
    async function* generateNumbers() {
      for (let i = 1; i <= 5; i++) {
        yield i
      }
    }

    const pipeline = new DataPipeline()
    pipeline.addStage({
      name: 'double',
      type: 'transform',
      transform: (x: number) => x * 2,
    })

    const results: number[] = []
    for await (const item of pipeline.stream(generateNumbers())) {
      results.push(item)
    }

    expect(results).toEqual([2, 4, 6, 8, 10])
  })

  it('processes items from a sync iterable', async () => {
    const pipeline = new DataPipeline()
    pipeline.addStage({
      name: 'double',
      type: 'transform',
      transform: (x: number) => x * 2,
    })

    const results: number[] = []
    for await (const item of pipeline.stream([1, 2, 3])) {
      results.push(item)
    }

    expect(results).toEqual([2, 4, 6])
  })

  it('filters items during streaming', async () => {
    async function* generateNumbers() {
      for (let i = 1; i <= 6; i++) {
        yield i
      }
    }

    const pipeline = new DataPipeline()
    pipeline.addStage({
      name: 'filter-even',
      type: 'filter',
      filter: (x: number) => x % 2 === 0,
    })

    const results: number[] = []
    for await (const item of pipeline.stream(generateNumbers())) {
      results.push(item)
    }

    expect(results).toEqual([2, 4, 6])
  })

  it('collects stream metrics after completion', async () => {
    const pipeline = new DataPipeline()
    pipeline.addStage({
      name: 'double',
      type: 'transform',
      transform: (x: number) => x * 2,
    })

    for await (const _ of pipeline.stream([1, 2, 3, 4, 5])) {
      // consume
    }

    const metrics = pipeline.getMetrics()
    expect(metrics.totalProcessed).toBe(5)
  })
})

// ============================================================================
// Error Handling
// ============================================================================

describe('DataPipeline - Error Handling', () => {
  describe('fail strategy', () => {
    it('stops batch processing on first error with fail strategy', async () => {
      const pipeline = new DataPipeline({
        errorHandler: { strategy: 'fail' },
      })
      pipeline.addStage({
        name: 'throw-on-three',
        type: 'transform',
        transform: (x: number) => {
          if (x === 3) throw new Error('Three is not allowed')
          return x
        },
      })

      const result = await pipeline.batch([1, 2, 3, 4, 5])

      expect(result.success).toBe(false)
      expect(result.errors.length).toBe(1)
      expect(result.data.length).toBeLessThan(5)
    })
  })

  describe('skip strategy', () => {
    it('skips failed items and continues with skip strategy', async () => {
      const pipeline = new DataPipeline({
        errorHandler: { strategy: 'skip' },
      })
      pipeline.addStage({
        name: 'throw-on-three',
        type: 'transform',
        transform: (x: number) => {
          if (x === 3) throw new Error('Three is not allowed')
          return x * 2
        },
      })

      const result = await pipeline.batch([1, 2, 3, 4, 5])

      expect(result.success).toBe(true)
      expect(result.data).toEqual([2, 4, 8, 10])
      expect(result.errors.length).toBe(1)
    })

    it('calls onError callback for skipped items', async () => {
      const onError = vi.fn()
      const pipeline = new DataPipeline({
        errorHandler: { strategy: 'skip', onError },
      })
      pipeline.addStage({
        name: 'throw-on-three',
        type: 'transform',
        transform: (x: number) => {
          if (x === 3) throw new Error('Three is not allowed')
          return x
        },
      })

      await pipeline.batch([1, 2, 3, 4, 5])

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        3,
        'throw-on-three'
      )
    })
  })

  describe('retry strategy', () => {
    it('retries failed items up to maxRetries', async () => {
      let attempts = 0

      const pipeline = new DataPipeline({
        errorHandler: { strategy: 'retry', maxRetries: 3 },
      })
      pipeline.addStage({
        name: 'flaky',
        type: 'transform',
        transform: (x: number) => {
          attempts++
          if (attempts < 3) throw new Error('Flaky error')
          return x * 2
        },
      })

      const result = await pipeline.process(5)

      expect(result.success).toBe(true)
      expect(result.data).toBe(10)
      expect(attempts).toBe(3)
    })

    it('fails after exhausting retries', async () => {
      let attempts = 0

      const pipeline = new DataPipeline({
        errorHandler: { strategy: 'retry', maxRetries: 3 },
      })
      pipeline.addStage({
        name: 'always-fail',
        type: 'transform',
        transform: () => {
          attempts++
          throw new Error('Always fails')
        },
      })

      const result = await pipeline.process(5)

      expect(result.success).toBe(false)
      expect(attempts).toBe(3)
      expect(result.error?.retryCount).toBe(3)
    })

    it('applies retry delay between attempts', async () => {
      let attempts = 0
      const timestamps: number[] = []

      const pipeline = new DataPipeline({
        errorHandler: { strategy: 'retry', maxRetries: 3, retryDelay: 50 },
      })
      pipeline.addStage({
        name: 'track-timing',
        type: 'transform',
        transform: () => {
          attempts++
          timestamps.push(Date.now())
          if (attempts < 3) throw new Error('Retry needed')
          return 'success'
        },
      })

      await pipeline.process(1)

      // Check delays between attempts (allowing some tolerance)
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i] - timestamps[i - 1]).toBeGreaterThanOrEqual(40)
      }
    })
  })
})

// ============================================================================
// Filtering
// ============================================================================

describe('DataPipeline - Filtering', () => {
  it('adds filter stage via filter method', async () => {
    const pipeline = new DataPipeline()
    pipeline.filter((x: number) => x > 3)

    const result = await pipeline.batch([1, 2, 3, 4, 5])

    expect(result.data).toEqual([4, 5])
  })

  it('chains multiple filters', async () => {
    const pipeline = new DataPipeline()
    pipeline.filter((x: number) => x > 2)
    pipeline.filter((x: number) => x < 5)

    const result = await pipeline.batch([1, 2, 3, 4, 5])

    expect(result.data).toEqual([3, 4])
  })

  it('supports async filter predicates', async () => {
    const pipeline = new DataPipeline()
    pipeline.filter(async (x: number) => {
      await new Promise((r) => setTimeout(r, 1))
      return x % 2 === 0
    })

    const result = await pipeline.batch([1, 2, 3, 4, 5])

    expect(result.data).toEqual([2, 4])
  })
})

// ============================================================================
// Validation
// ============================================================================

describe('DataPipeline - Validation', () => {
  it('adds validation stage via validate method with schema', async () => {
    const schema = {
      parse: (data: unknown) => {
        const d = data as { name: string }
        if (typeof d.name !== 'string') throw new Error('Invalid name')
        return d
      },
      safeParse: (data: unknown) => {
        try {
          return { success: true as const, data: schema.parse(data) }
        } catch (e) {
          return { success: false as const, error: e as Error }
        }
      },
    }

    const pipeline = new DataPipeline()
    pipeline.validate(schema)

    const validResult = await pipeline.process({ name: 'test' })
    expect(validResult.success).toBe(true)
    expect(validResult.data).toEqual({ name: 'test' })

    const invalidResult = await pipeline.process({ name: 123 })
    expect(invalidResult.success).toBe(false)
  })

  it('adds validation stage via validate method with predicate', async () => {
    const pipeline = new DataPipeline()
    pipeline.validate((x: number) => x > 0 && x < 100)

    const validResult = await pipeline.process(50)
    expect(validResult.success).toBe(true)

    const invalidResult = await pipeline.process(150)
    expect(invalidResult.success).toBe(false)
  })
})

// ============================================================================
// Metrics Collection
// ============================================================================

describe('DataPipeline - Metrics Collection', () => {
  it('tracks total duration', async () => {
    const pipeline = new DataPipeline()
    pipeline.addStage({
      name: 'slow',
      type: 'transform',
      transform: async (x: number) => {
        await new Promise((r) => setTimeout(r, 50))
        return x
      },
    })

    const result = await pipeline.batch([1, 2, 3])

    expect(result.metrics.totalDuration).toBeGreaterThanOrEqual(50)
  })

  it('tracks per-stage metrics', async () => {
    const pipeline = new DataPipeline()
    pipeline.addStage({
      name: 'stage1',
      type: 'transform',
      transform: (x: number) => x * 2,
    })
    pipeline.addStage({
      name: 'stage2',
      type: 'filter',
      filter: (x: number) => x > 5,
    })

    const result = await pipeline.batch([1, 2, 3, 4, 5])

    expect(result.metrics.stages[0].name).toBe('stage1')
    expect(result.metrics.stages[0].processed).toBe(5)
    expect(result.metrics.stages[1].name).toBe('stage2')
    // [1,2,3,4,5] * 2 = [2,4,6,8,10], filter > 5 = [6,8,10], filtered = [2,4]
    expect(result.metrics.stages[1].filtered).toBe(2)
  })

  it('tracks start and end time', async () => {
    const pipeline = new DataPipeline()
    pipeline.addStage({
      name: 'pass',
      type: 'transform',
      transform: (x: number) => x,
    })

    const before = Date.now()
    const result = await pipeline.batch([1, 2, 3])
    const after = Date.now()

    expect(result.metrics.startTime).toBeGreaterThanOrEqual(before)
    expect(result.metrics.endTime).toBeLessThanOrEqual(after)
  })

  it('resets metrics between batch runs', async () => {
    const pipeline = new DataPipeline()
    pipeline.addStage({
      name: 'double',
      type: 'transform',
      transform: (x: number) => x * 2,
    })

    await pipeline.batch([1, 2, 3])
    const result = await pipeline.batch([4, 5])

    expect(result.metrics.totalProcessed).toBe(2)
  })
})

// ============================================================================
// Pipeline Composition
// ============================================================================

describe('DataPipeline - Pipeline Composition', () => {
  it('composes two pipelines into one', async () => {
    const pipeline1 = new DataPipeline()
    pipeline1.addStage({
      name: 'double',
      type: 'transform',
      transform: (x: number) => x * 2,
    })

    const pipeline2 = new DataPipeline()
    pipeline2.addStage({
      name: 'add-ten',
      type: 'transform',
      transform: (x: number) => x + 10,
    })

    const composed = pipeline1.compose(pipeline2)
    const result = await composed.process(5)

    expect(result.data).toBe(20) // (5 * 2) + 10
  })

  it('preserves error handling from first pipeline', async () => {
    const pipeline1 = new DataPipeline({
      errorHandler: { strategy: 'skip' },
    })
    pipeline1.addStage({
      name: 'throw',
      type: 'transform',
      transform: () => {
        throw new Error('fail')
      },
    })

    const pipeline2 = new DataPipeline()
    pipeline2.addStage({
      name: 'double',
      type: 'transform',
      transform: (x: number) => x * 2,
    })

    const composed = pipeline1.compose(pipeline2)
    const result = await composed.batch([1, 2, 3])

    expect(result.errors.length).toBe(3)
    expect(result.data).toEqual([])
  })
})

// ============================================================================
// Backpressure Handling
// ============================================================================

describe('DataPipeline - Backpressure Handling', () => {
  it('buffers items when consumer is slow', async () => {
    const pipeline = new DataPipeline({
      stream: { bufferSize: 3, backpressure: true },
    })
    pipeline.addStage({
      name: 'fast-producer',
      type: 'transform',
      transform: (x: number) => x * 2,
    })

    async function* fastProducer() {
      for (let i = 1; i <= 10; i++) {
        yield i
      }
    }

    const results: number[] = []
    for await (const item of pipeline.stream(fastProducer())) {
      await new Promise((r) => setTimeout(r, 10)) // Slow consumer
      results.push(item)
    }

    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20])
  })

  it('respects highWaterMark for buffering', async () => {
    let producedCount = 0
    let consumedCount = 0

    const pipeline = new DataPipeline({
      stream: { highWaterMark: 2, backpressure: true },
    })
    pipeline.addStage({
      name: 'track',
      type: 'transform',
      transform: (x: number) => {
        producedCount++
        return x
      },
    })

    async function* producer() {
      for (let i = 1; i <= 5; i++) {
        yield i
      }
    }

    for await (const item of pipeline.stream(producer())) {
      consumedCount++
      // Allow some processing
      await new Promise((r) => setTimeout(r, 1))
    }

    expect(consumedCount).toBe(5)
  })
})

// ============================================================================
// Conditional Stages
// ============================================================================

describe('DataPipeline - Conditional Stages', () => {
  it('executes stage only when condition is true', async () => {
    const conditionalFn = vi.fn((x: number) => x * 2)

    const pipeline = new DataPipeline()
    pipeline.addStage({
      name: 'conditional-double',
      type: 'transform',
      transform: conditionalFn,
      condition: (x: number) => x > 3,
    })

    const result = await pipeline.batch([1, 2, 3, 4, 5])

    expect(result.data).toEqual([1, 2, 3, 8, 10])
    expect(conditionalFn).toHaveBeenCalledTimes(2)
  })

  it('supports async conditions', async () => {
    const pipeline = new DataPipeline()
    pipeline.addStage({
      name: 'async-conditional',
      type: 'transform',
      transform: (x: number) => x * 10,
      condition: async (x: number) => {
        await new Promise((r) => setTimeout(r, 1))
        return x % 2 === 0
      },
    })

    const result = await pipeline.batch([1, 2, 3, 4])

    expect(result.data).toEqual([1, 20, 3, 40])
  })
})

// ============================================================================
// Map Helper
// ============================================================================

describe('DataPipeline - Map Helper', () => {
  it('adds transform stage via map method', async () => {
    const pipeline = new DataPipeline()
    pipeline.map((x: number) => x * 2)
    pipeline.map((x: number) => x + 1)

    const result = await pipeline.batch([1, 2, 3])

    expect(result.data).toEqual([3, 5, 7]) // (x * 2) + 1
  })

  it('supports async transforms via map', async () => {
    const pipeline = new DataPipeline()
    pipeline.map(async (x: number) => {
      await new Promise((r) => setTimeout(r, 1))
      return x * 2
    })

    const result = await pipeline.batch([1, 2, 3])

    expect(result.data).toEqual([2, 4, 6])
  })
})

// ============================================================================
// Tap (Side Effects)
// ============================================================================

describe('DataPipeline - Tap (Side Effects)', () => {
  it('executes tap without modifying data', async () => {
    const tapped: number[] = []

    const pipeline = new DataPipeline()
    pipeline.addStage({
      name: 'tap-collect',
      type: 'tap',
      tap: (x: number) => {
        tapped.push(x)
      },
    })
    pipeline.addStage({
      name: 'double',
      type: 'transform',
      transform: (x: number) => x * 2,
    })

    const result = await pipeline.batch([1, 2, 3])

    expect(result.data).toEqual([2, 4, 6])
    expect(tapped).toEqual([1, 2, 3])
  })

  it('supports async tap', async () => {
    const tapped: number[] = []

    const pipeline = new DataPipeline()
    pipeline.addStage({
      name: 'async-tap',
      type: 'tap',
      tap: async (x: number) => {
        await new Promise((r) => setTimeout(r, 1))
        tapped.push(x)
      },
    })

    await pipeline.batch([1, 2, 3])

    expect(tapped).toEqual([1, 2, 3])
  })
})

// ============================================================================
// PipelineBuilder
// ============================================================================

describe('PipelineBuilder', () => {
  it('builds pipeline with fluent API', async () => {
    const pipeline = new PipelineBuilder()
      .map((x: number) => x * 2)
      .filter((x: number) => x > 5)
      .map((x: number) => `Result: ${x}`)
      .build()

    const result = await pipeline.batch([1, 2, 3, 4, 5])

    expect(result.data).toEqual(['Result: 6', 'Result: 8', 'Result: 10'])
  })

  it('configures error handling in builder', async () => {
    const pipeline = new PipelineBuilder({ errorHandler: { strategy: 'skip' } })
      .map((x: number) => {
        if (x === 2) throw new Error('skip this')
        return x * 2
      })
      .build()

    const result = await pipeline.batch([1, 2, 3])

    expect(result.data).toEqual([2, 6])
  })

  it('allows named pipeline', async () => {
    const pipeline = new PipelineBuilder({ name: 'my-pipeline' })
      .map((x: number) => x)
      .build()

    expect(pipeline.name).toBe('my-pipeline')
  })
})

// ============================================================================
// BatchProcessor
// ============================================================================

describe('BatchProcessor', () => {
  it('processes items in chunks', async () => {
    const processor = new BatchProcessor({ size: 2, parallel: 1 })
    const processed: number[][] = []

    await processor.process(
      [1, 2, 3, 4, 5],
      async (batch) => {
        processed.push([...batch])
        return batch.map((x) => x * 2)
      }
    )

    expect(processed).toEqual([[1, 2], [3, 4], [5]])
  })

  it('processes chunks in parallel', async () => {
    const processor = new BatchProcessor({ size: 2, parallel: 2 })
    let maxConcurrent = 0
    let concurrent = 0

    await processor.process(
      [1, 2, 3, 4, 5, 6],
      async (batch) => {
        concurrent++
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await new Promise((r) => setTimeout(r, 50))
        concurrent--
        return batch
      }
    )

    expect(maxConcurrent).toBe(2)
  })
})

// ============================================================================
// StreamProcessor
// ============================================================================

describe('StreamProcessor', () => {
  it('creates async iterable from source', async () => {
    const processor = new StreamProcessor()

    async function* source() {
      yield 1
      yield 2
      yield 3
    }

    const results: number[] = []
    for await (const item of processor.process(source(), (x) => x * 2)) {
      results.push(item)
    }

    expect(results).toEqual([2, 4, 6])
  })

  it('handles backpressure with high water mark', async () => {
    const processor = new StreamProcessor({ highWaterMark: 2 })
    let activeItems = 0
    let maxActive = 0

    async function* source() {
      for (let i = 1; i <= 10; i++) {
        yield i
      }
    }

    for await (const item of processor.process(source(), async (x) => {
      activeItems++
      maxActive = Math.max(maxActive, activeItems)
      await new Promise((r) => setTimeout(r, 10))
      activeItems--
      return x
    })) {
      // Consume slowly
      await new Promise((r) => setTimeout(r, 5))
    }

    // High water mark should limit buffering
    expect(maxActive).toBeLessThanOrEqual(3)
  })
})

// ============================================================================
// ErrorCollector
// ============================================================================

describe('ErrorCollector', () => {
  it('collects errors with item and stage info', () => {
    const collector = new ErrorCollector()

    collector.add(new Error('First error'), { id: 1 }, 'stage1')
    collector.add(new Error('Second error'), { id: 2 }, 'stage2')

    const errors = collector.getErrors()

    expect(errors.length).toBe(2)
    expect(errors[0].stage).toBe('stage1')
    expect(errors[0].item).toEqual({ id: 1 })
    expect(errors[1].stage).toBe('stage2')
  })

  it('tracks error count', () => {
    const collector = new ErrorCollector()

    collector.add(new Error('Error 1'), 1, 'stage')
    collector.add(new Error('Error 2'), 2, 'stage')
    collector.add(new Error('Error 3'), 3, 'stage')

    expect(collector.count).toBe(3)
  })

  it('clears collected errors', () => {
    const collector = new ErrorCollector()

    collector.add(new Error('Error'), 1, 'stage')
    collector.clear()

    expect(collector.count).toBe(0)
    expect(collector.getErrors()).toEqual([])
  })
})

// ============================================================================
// MetricsCollector
// ============================================================================

describe('MetricsCollector', () => {
  it('tracks stage metrics', () => {
    const collector = new MetricsCollector()

    collector.startStage('stage1')
    collector.recordProcessed('stage1')
    collector.recordProcessed('stage1')
    collector.recordFiltered('stage1')
    collector.endStage('stage1')

    const metrics = collector.getMetrics()

    expect(metrics.stages[0].name).toBe('stage1')
    expect(metrics.stages[0].processed).toBe(2)
    expect(metrics.stages[0].filtered).toBe(1)
  })

  it('calculates totals', () => {
    const collector = new MetricsCollector()

    collector.startStage('stage1')
    collector.recordProcessed('stage1')
    collector.recordProcessed('stage1')
    collector.endStage('stage1')

    collector.startStage('stage2')
    collector.recordProcessed('stage2')
    collector.recordFailed('stage2')
    collector.endStage('stage2')

    const metrics = collector.getMetrics()

    expect(metrics.totalProcessed).toBe(3)
    expect(metrics.totalFailed).toBe(1)
  })

  it('tracks duration', async () => {
    const collector = new MetricsCollector()

    collector.start()
    collector.startStage('stage1')
    await new Promise((r) => setTimeout(r, 50))
    collector.endStage('stage1')
    collector.end()

    const metrics = collector.getMetrics()

    expect(metrics.totalDuration).toBeGreaterThanOrEqual(40)
    expect(metrics.stages[0].duration).toBeGreaterThanOrEqual(40)
  })

  it('resets metrics', () => {
    const collector = new MetricsCollector()

    collector.startStage('stage1')
    collector.recordProcessed('stage1')
    collector.endStage('stage1')
    collector.reset()

    const metrics = collector.getMetrics()

    expect(metrics.totalProcessed).toBe(0)
    expect(metrics.stages).toEqual([])
  })
})

// ============================================================================
// RetryHandler
// ============================================================================

describe('RetryHandler', () => {
  it('retries operation until success', async () => {
    const handler = new RetryHandler({ maxRetries: 3 })
    let attempts = 0

    const result = await handler.execute(async () => {
      attempts++
      if (attempts < 3) throw new Error('Not yet')
      return 'success'
    })

    expect(result).toBe('success')
    expect(attempts).toBe(3)
  })

  it('throws after max retries exceeded', async () => {
    const handler = new RetryHandler({ maxRetries: 2 })

    await expect(
      handler.execute(async () => {
        throw new Error('Always fails')
      })
    ).rejects.toThrow('Always fails')
  })

  it('applies delay between retries', async () => {
    const handler = new RetryHandler({ maxRetries: 3, delay: 50 })
    const timestamps: number[] = []

    try {
      await handler.execute(async () => {
        timestamps.push(Date.now())
        throw new Error('Fail')
      })
    } catch {
      // Expected
    }

    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i] - timestamps[i - 1]).toBeGreaterThanOrEqual(40)
    }
  })

  it('tracks retry count', async () => {
    const handler = new RetryHandler({ maxRetries: 5 })
    let attempts = 0

    await handler.execute(async () => {
      attempts++
      if (attempts < 4) throw new Error('Retry')
      return 'done'
    })

    expect(handler.lastRetryCount).toBe(4)
  })
})
