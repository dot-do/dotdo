/**
 * Pipeline Stage Interface Tests (RED Phase)
 *
 * Tests for the core Stage<TInput, TOutput> interface with:
 * - process() method for transforming data
 * - name property for identification
 * - validation for stage inputs
 * - Stage composition and chaining
 * - Type inference across pipeline stages
 *
 * @see dotdo-l222d
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  Stage,
  Pipeline,
  PipelineBuilder,
  StageValidationError,
  PipelineExecutionError,
  createPipeline,
} from '../index'

// Test data types
interface SalesRecord {
  id: string
  product: string
  category: string
  amount: number
  quantity: number
  date: Date
  region: string
}

interface AggregatedSale {
  category: string
  totalAmount: number
  count: number
}

describe('Stage Interface', () => {
  describe('Stage<TInput, TOutput> contract', () => {
    it('should define a process method that transforms input to output', () => {
      const stage: Stage<SalesRecord, AggregatedSale> = {
        name: 'test-stage',
        process: (input: SalesRecord[]) => {
          const byCategory = new Map<string, { total: number; count: number }>()
          for (const record of input) {
            const existing = byCategory.get(record.category) ?? { total: 0, count: 0 }
            existing.total += record.amount
            existing.count++
            byCategory.set(record.category, existing)
          }
          return Array.from(byCategory.entries()).map(([category, { total, count }]) => ({
            category,
            totalAmount: total,
            count,
          }))
        },
      }

      expect(stage.name).toBe('test-stage')
      expect(typeof stage.process).toBe('function')
    })

    it('should require a name property for stage identification', () => {
      const stage: Stage<number, string> = {
        name: 'number-to-string',
        process: (input) => input.map(String),
      }

      expect(stage.name).toBeDefined()
      expect(stage.name.length).toBeGreaterThan(0)
    })

    it('should support optional validate method for input validation', () => {
      const stage: Stage<SalesRecord, SalesRecord> = {
        name: 'validate-sales',
        process: (input) => input,
        validate: (input) => {
          for (const record of input) {
            if (record.amount < 0) {
              throw new StageValidationError('Amount cannot be negative')
            }
          }
        },
      }

      expect(stage.validate).toBeDefined()
    })

    it('should support optional description for documentation', () => {
      const stage: Stage<number[], number> = {
        name: 'sum',
        description: 'Calculates the sum of all input numbers',
        process: (input) => [input.flat().reduce((a, b) => a + b, 0)],
      }

      expect(stage.description).toBe('Calculates the sum of all input numbers')
    })

    it('should expose stage metadata through properties', () => {
      const stage: Stage<unknown, unknown> = {
        name: 'metadata-stage',
        description: 'A stage with metadata',
        version: '1.0.0',
        tags: ['transform', 'batch'],
        process: (input) => input,
      }

      expect(stage.version).toBe('1.0.0')
      expect(stage.tags).toContain('transform')
    })
  })

  describe('Stage.process() behavior', () => {
    it('should accept an array of input elements', () => {
      const stage: Stage<number, number> = {
        name: 'double',
        process: (input) => input.map((n) => n * 2),
      }

      const result = stage.process([1, 2, 3])
      expect(result).toEqual([2, 4, 6])
    })

    it('should return an array of output elements', () => {
      const stage: Stage<string, number> = {
        name: 'length',
        process: (input) => input.map((s) => s.length),
      }

      const result = stage.process(['a', 'bb', 'ccc'])
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle empty input arrays', () => {
      const stage: Stage<number, number> = {
        name: 'identity',
        process: (input) => input,
      }

      const result = stage.process([])
      expect(result).toEqual([])
    })

    it('should support one-to-many transformations (flatMap)', () => {
      const stage: Stage<string, string> = {
        name: 'split-words',
        process: (input) => input.flatMap((s) => s.split(' ')),
      }

      const result = stage.process(['hello world', 'foo bar baz'])
      expect(result).toEqual(['hello', 'world', 'foo', 'bar', 'baz'])
    })

    it('should support many-to-one transformations (reduce)', () => {
      const stage: Stage<number, number> = {
        name: 'sum-all',
        process: (input) => [input.reduce((a, b) => a + b, 0)],
      }

      const result = stage.process([1, 2, 3, 4, 5])
      expect(result).toEqual([15])
    })

    it('should support filtering transformations', () => {
      const stage: Stage<number, number> = {
        name: 'even-only',
        process: (input) => input.filter((n) => n % 2 === 0),
      }

      const result = stage.process([1, 2, 3, 4, 5, 6])
      expect(result).toEqual([2, 4, 6])
    })
  })

  describe('Stage validation', () => {
    it('should call validate before process when defined', () => {
      let validateCalled = false
      const stage: Stage<number, number> = {
        name: 'validated',
        validate: () => {
          validateCalled = true
        },
        process: (input) => input,
      }

      // Using pipeline to ensure validate is called
      const pipeline = createPipeline<number, number>().addStage(stage)
      pipeline.execute([1, 2, 3])

      expect(validateCalled).toBe(true)
    })

    it('should throw StageValidationError for invalid input', () => {
      const stage: Stage<number, number> = {
        name: 'positive-only',
        validate: (input) => {
          if (input.some((n) => n < 0)) {
            throw new StageValidationError('All numbers must be positive')
          }
        },
        process: (input) => input,
      }

      const pipeline = createPipeline<number, number>().addStage(stage)
      expect(() => pipeline.execute([1, -2, 3])).toThrow(StageValidationError)
    })

    it('should include stage name in validation error', () => {
      const stage: Stage<number, number> = {
        name: 'my-special-stage',
        validate: () => {
          throw new StageValidationError('Invalid input')
        },
        process: (input) => input,
      }

      const pipeline = createPipeline<number, number>().addStage(stage)

      try {
        pipeline.execute([1])
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(StageValidationError)
        expect((e as StageValidationError).stageName).toBe('my-special-stage')
      }
    })

    it('should validate schema types at runtime', () => {
      const stage: Stage<SalesRecord, SalesRecord> = {
        name: 'type-check',
        validate: (input) => {
          for (const record of input) {
            if (typeof record.amount !== 'number') {
              throw new StageValidationError(`Expected number for amount, got ${typeof record.amount}`)
            }
          }
        },
        process: (input) => input,
      }

      expect(stage.validate).toBeDefined()
    })
  })
})

describe('Pipeline', () => {
  describe('Pipeline creation', () => {
    it('should create an empty pipeline', () => {
      const pipeline = createPipeline<number, number>()
      expect(pipeline).toBeDefined()
      expect(pipeline.stages).toHaveLength(0)
    })

    it('should create a pipeline with initial stages', () => {
      const stage1: Stage<number, number> = { name: 's1', process: (i) => i }
      const stage2: Stage<number, number> = { name: 's2', process: (i) => i }

      const pipeline = createPipeline<number, number>([stage1, stage2])
      expect(pipeline.stages).toHaveLength(2)
    })

    it('should expose pipeline name', () => {
      const pipeline = createPipeline<number, number>({ name: 'my-pipeline' })
      expect(pipeline.name).toBe('my-pipeline')
    })
  })

  describe('Pipeline.addStage()', () => {
    it('should add a stage to the pipeline', () => {
      const stage: Stage<number, number> = { name: 'double', process: (i) => i.map((n) => n * 2) }

      const pipeline = createPipeline<number, number>().addStage(stage)
      expect(pipeline.stages).toHaveLength(1)
    })

    it('should return a new pipeline for immutability', () => {
      const stage: Stage<number, number> = { name: 'double', process: (i) => i.map((n) => n * 2) }

      const pipeline1 = createPipeline<number, number>()
      const pipeline2 = pipeline1.addStage(stage)

      expect(pipeline1.stages).toHaveLength(0)
      expect(pipeline2.stages).toHaveLength(1)
    })

    it('should preserve stage order', () => {
      const s1: Stage<number, number> = { name: 'first', process: (i) => i }
      const s2: Stage<number, number> = { name: 'second', process: (i) => i }
      const s3: Stage<number, number> = { name: 'third', process: (i) => i }

      const pipeline = createPipeline<number, number>().addStage(s1).addStage(s2).addStage(s3)

      expect(pipeline.stages.map((s) => s.name)).toEqual(['first', 'second', 'third'])
    })

    it('should reject duplicate stage names', () => {
      const s1: Stage<number, number> = { name: 'same-name', process: (i) => i }
      const s2: Stage<number, number> = { name: 'same-name', process: (i) => i }

      expect(() => createPipeline<number, number>().addStage(s1).addStage(s2)).toThrow()
    })
  })

  describe('Pipeline.execute()', () => {
    it('should execute stages in order', () => {
      const order: string[] = []

      const s1: Stage<number, number> = {
        name: 'first',
        process: (i) => {
          order.push('first')
          return i
        },
      }
      const s2: Stage<number, number> = {
        name: 'second',
        process: (i) => {
          order.push('second')
          return i
        },
      }

      createPipeline<number, number>().addStage(s1).addStage(s2).execute([1])

      expect(order).toEqual(['first', 'second'])
    })

    it('should pass output of one stage as input to next', () => {
      const double: Stage<number, number> = { name: 'double', process: (i) => i.map((n) => n * 2) }
      const addOne: Stage<number, number> = { name: 'add-one', process: (i) => i.map((n) => n + 1) }

      const result = createPipeline<number, number>().addStage(double).addStage(addOne).execute([1, 2, 3])

      expect(result).toEqual([3, 5, 7]) // (1*2)+1, (2*2)+1, (3*2)+1
    })

    it('should return final stage output', () => {
      const toString: Stage<number, string> = { name: 'to-string', process: (i) => i.map(String) }

      const result = createPipeline<number, string>().addStage(toString).execute([1, 2, 3])

      expect(result).toEqual(['1', '2', '3'])
    })

    it('should handle empty pipeline gracefully', () => {
      const result = createPipeline<number, number>().execute([1, 2, 3])
      expect(result).toEqual([1, 2, 3])
    })

    it('should propagate stage errors with context', () => {
      const failing: Stage<number, number> = {
        name: 'failing-stage',
        process: () => {
          throw new Error('Stage failed')
        },
      }

      const pipeline = createPipeline<number, number>().addStage(failing)

      try {
        pipeline.execute([1])
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(PipelineExecutionError)
        expect((e as PipelineExecutionError).stageName).toBe('failing-stage')
      }
    })
  })

  describe('Pipeline composition', () => {
    it('should compose two pipelines into one', () => {
      const p1 = createPipeline<number, number>().addStage({
        name: 'double',
        process: (i) => i.map((n) => n * 2),
      })

      const p2 = createPipeline<number, string>().addStage({
        name: 'to-string',
        process: (i) => i.map(String),
      })

      const composed = p1.compose(p2)
      const result = composed.execute([1, 2, 3])

      expect(result).toEqual(['2', '4', '6'])
    })

    it('should preserve all stages from both pipelines', () => {
      const p1 = createPipeline<number, number>()
        .addStage({ name: 'a', process: (i) => i })
        .addStage({ name: 'b', process: (i) => i })

      const p2 = createPipeline<number, number>()
        .addStage({ name: 'c', process: (i) => i })
        .addStage({ name: 'd', process: (i) => i })

      const composed = p1.compose(p2)
      expect(composed.stages.map((s) => s.name)).toEqual(['a', 'b', 'c', 'd'])
    })
  })
})

describe('PipelineBuilder', () => {
  describe('Fluent API', () => {
    it('should provide fluent stage building', () => {
      const pipeline = new PipelineBuilder<SalesRecord>()
        .match({ category: 'Electronics' })
        .group({ _id: '$region', total: { $sum: '$amount' } })
        .sort({ total: -1 })
        .limit(10)
        .build()

      expect(pipeline.stages).toHaveLength(4)
    })

    it('should support MongoDB-style $match', () => {
      const builder = new PipelineBuilder<SalesRecord>()
      const pipeline = builder.match({ amount: { $gt: 100 } }).build()

      expect(pipeline.stages[0].name).toBe('$match')
    })

    it('should support MongoDB-style $group', () => {
      const builder = new PipelineBuilder<SalesRecord>()
      const pipeline = builder
        .group({
          _id: '$category',
          totalAmount: { $sum: '$amount' },
          avgAmount: { $avg: '$amount' },
          count: { $count: {} },
        })
        .build()

      expect(pipeline.stages[0].name).toBe('$group')
    })

    it('should support MongoDB-style $project', () => {
      const builder = new PipelineBuilder<SalesRecord>()
      const pipeline = builder
        .project({
          _id: 0,
          product: 1,
          total: { $multiply: ['$amount', '$quantity'] },
        })
        .build()

      expect(pipeline.stages[0].name).toBe('$project')
    })

    it('should support MongoDB-style $sort', () => {
      const builder = new PipelineBuilder<SalesRecord>()
      const pipeline = builder.sort({ amount: -1, date: 1 }).build()

      expect(pipeline.stages[0].name).toBe('$sort')
    })

    it('should support MongoDB-style $limit and $skip', () => {
      const builder = new PipelineBuilder<SalesRecord>()
      const pipeline = builder.skip(10).limit(5).build()

      expect(pipeline.stages).toHaveLength(2)
      expect(pipeline.stages[0].name).toBe('$skip')
      expect(pipeline.stages[1].name).toBe('$limit')
    })
  })

  describe('Type inference', () => {
    it('should infer output type from final stage', () => {
      const pipeline = new PipelineBuilder<SalesRecord>()
        .group({
          _id: '$category',
          total: { $sum: '$amount' },
        })
        .build()

      // TypeScript should infer output type
      const result = pipeline.execute([])
      // result should be Array<{ _id: string; total: number }>
      expect(Array.isArray(result)).toBe(true)
    })

    it('should preserve type safety through pipeline', () => {
      // This should compile and maintain type safety
      const pipeline = new PipelineBuilder<{ x: number }>()
        .project({ y: '$x' }) // { x: number } -> { y: number }
        .match({ y: { $gt: 0 } }) // filter { y: number }
        .build()

      expect(pipeline).toBeDefined()
    })
  })

  describe('Custom stages', () => {
    it('should allow adding custom stages', () => {
      const customStage: Stage<SalesRecord, SalesRecord> = {
        name: 'custom-transform',
        process: (input) => input.map((r) => ({ ...r, amount: r.amount * 1.1 })),
      }

      const pipeline = new PipelineBuilder<SalesRecord>().addStage(customStage).build()

      expect(pipeline.stages[0].name).toBe('custom-transform')
    })

    it('should integrate custom stages with built-in stages', () => {
      const customStage: Stage<SalesRecord, SalesRecord> = {
        name: 'apply-discount',
        process: (input) => input.map((r) => ({ ...r, amount: r.amount * 0.9 })),
      }

      const pipeline = new PipelineBuilder<SalesRecord>()
        .match({ category: 'Electronics' })
        .addStage(customStage)
        .group({ _id: null, total: { $sum: '$amount' } })
        .build()

      expect(pipeline.stages).toHaveLength(3)
    })
  })
})

describe('Stage type transformations', () => {
  it('should support identity transformation', () => {
    const stage: Stage<number, number> = {
      name: 'identity',
      process: (input) => input,
    }

    expect(stage.process([1, 2, 3])).toEqual([1, 2, 3])
  })

  it('should support type-changing transformation', () => {
    const stage: Stage<number, string> = {
      name: 'number-to-string',
      process: (input) => input.map((n) => `Value: ${n}`),
    }

    expect(stage.process([1, 2])).toEqual(['Value: 1', 'Value: 2'])
  })

  it('should support shape-changing transformation', () => {
    interface Input {
      firstName: string
      lastName: string
    }
    interface Output {
      fullName: string
    }

    const stage: Stage<Input, Output> = {
      name: 'combine-names',
      process: (input) => input.map((r) => ({ fullName: `${r.firstName} ${r.lastName}` })),
    }

    expect(stage.process([{ firstName: 'John', lastName: 'Doe' }])).toEqual([{ fullName: 'John Doe' }])
  })

  it('should support aggregation (many-to-one) transformation', () => {
    interface Stats {
      sum: number
      count: number
      avg: number
    }

    const stage: Stage<number, Stats> = {
      name: 'compute-stats',
      process: (input) => {
        const sum = input.reduce((a, b) => a + b, 0)
        const count = input.length
        return [{ sum, count, avg: count > 0 ? sum / count : 0 }]
      },
    }

    expect(stage.process([1, 2, 3, 4, 5])).toEqual([{ sum: 15, count: 5, avg: 3 }])
  })

  it('should support expansion (one-to-many) transformation', () => {
    const stage: Stage<number, number> = {
      name: 'duplicate',
      process: (input) => input.flatMap((n) => [n, n]),
    }

    expect(stage.process([1, 2])).toEqual([1, 1, 2, 2])
  })
})

describe('Error handling', () => {
  it('should wrap stage errors in PipelineExecutionError', () => {
    const stage: Stage<number, number> = {
      name: 'error-stage',
      process: () => {
        throw new Error('Original error')
      },
    }

    const pipeline = createPipeline<number, number>().addStage(stage)

    expect(() => pipeline.execute([1])).toThrow(PipelineExecutionError)
  })

  it('should include stage index in error', () => {
    const good: Stage<number, number> = { name: 'good', process: (i) => i }
    const bad: Stage<number, number> = {
      name: 'bad',
      process: () => {
        throw new Error('fail')
      },
    }

    const pipeline = createPipeline<number, number>().addStage(good).addStage(bad)

    try {
      pipeline.execute([1])
      expect.fail('Should have thrown')
    } catch (e) {
      expect((e as PipelineExecutionError).stageIndex).toBe(1)
    }
  })

  it('should include input snapshot in error for debugging', () => {
    const stage: Stage<number, number> = {
      name: 'error-stage',
      process: () => {
        throw new Error('fail')
      },
    }

    const pipeline = createPipeline<number, number>().addStage(stage)

    try {
      pipeline.execute([1, 2, 3])
      expect.fail('Should have thrown')
    } catch (e) {
      expect((e as PipelineExecutionError).inputSnapshot).toBeDefined()
    }
  })
})
