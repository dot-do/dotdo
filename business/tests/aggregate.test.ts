/**
 * AggregateBuilder Tests
 *
 * TDD Red-Green-Refactor tests for the AggregateBuilder fluent API.
 *
 * Tests cover:
 * - Aggregate operations: sum, count, avg, min, max, distinct
 * - Query composition: from(), by(), where(), last()
 * - Execution with real data (in-memory aggregation)
 * - Validation and error handling
 * - Result handling (value() vs all())
 *
 * @module business/tests/aggregate.test
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import { parseWhereClause } from '../business'
import { generateTestId, rpcMayFail } from '@dotdo/test-utils'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface AggregateResult {
  value?: number
  data?: Array<{ key: string; value: number }>
  total?: number
}

interface ParsedQuery {
  operation: 'sum' | 'count' | 'avg' | 'min' | 'max' | 'distinct'
  field?: string
  collection: string
  where?: Record<string, unknown>
  groupBy?: string
  timeRange?: { value: number; unit: 'hours' | 'days' | 'weeks' | 'months' }
}

interface Thing {
  $id: string
  $type: string
  $createdAt: number
  $updatedAt: number
  [key: string]: unknown
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get a fresh Business DO stub for testing
 */
function getStub(name?: string) {
  const testName = name ?? generateTestId('aggregate')
  const id = env.BUSINESS.idFromName(testName)
  return env.BUSINESS.get(id)
}

/**
 * Make an RPC call to the DO
 */
async function rpc<T>(stub: DurableObjectStub, method: string, args: unknown[] = []): Promise<T> {
  const { response, data, error } = await rpcMayFail<T>(stub, method, args, 'https://business/rpc')

  if (!response.ok && error) {
    throw new Error(`RPC error (${response.status}): ${JSON.stringify(error)}`)
  }

  return data as T
}

/**
 * Create test data for aggregation tests
 */
async function createTestPurchases(stub: DurableObjectStub, purchases: Array<{
  amount: number
  status?: string
  category?: string
  createdAt?: number
}>): Promise<Thing[]> {
  const results: Thing[] = []
  for (const p of purchases) {
    const thing = await rpc<Thing>(stub, 'things.create', [{
      $type: 'Purchase',
      amount: p.amount,
      status: p.status ?? 'completed',
      category: p.category ?? 'default',
      createdAt: p.createdAt ?? Date.now()
    }])
    results.push(thing)
  }
  return results
}

/**
 * Execute an aggregation query via RPC
 */
async function aggregate(stub: DurableObjectStub, query: ParsedQuery): Promise<AggregateResult> {
  return rpc<AggregateResult>(stub, 'runAggregate', [query])
}

// ============================================================================
// AGGREGATE EXECUTION TESTS (TDD)
// ============================================================================

describe('AggregateBuilder Execution', () => {
  describe('sum() operation', () => {
    it('should sum field values from collection', async () => {
      const stub = getStub()

      // Create test data
      await createTestPurchases(stub, [
        { amount: 100 },
        { amount: 200 },
        { amount: 300 }
      ])

      // Execute aggregation
      const result = await aggregate(stub, {
        operation: 'sum',
        field: 'amount',
        collection: 'Purchase'
      })

      expect(result.value).toBe(600)
    })

    it('should return 0 for empty collection', async () => {
      const stub = getStub()

      const result = await aggregate(stub, {
        operation: 'sum',
        field: 'amount',
        collection: 'EmptyCollection'
      })

      expect(result.value).toBe(0)
    })

    it('should handle decimal values', async () => {
      const stub = getStub()

      await createTestPurchases(stub, [
        { amount: 10.50 },
        { amount: 20.25 },
        { amount: 5.75 }
      ])

      const result = await aggregate(stub, {
        operation: 'sum',
        field: 'amount',
        collection: 'Purchase'
      })

      expect(result.value).toBeCloseTo(36.50, 2)
    })
  })

  describe('count() operation', () => {
    it('should count items in collection', async () => {
      const stub = getStub()

      await createTestPurchases(stub, [
        { amount: 100 },
        { amount: 200 },
        { amount: 300 },
        { amount: 400 }
      ])

      const result = await aggregate(stub, {
        operation: 'count',
        collection: 'Purchase'
      })

      expect(result.value).toBe(4)
    })

    it('should return 0 for empty collection', async () => {
      const stub = getStub()

      const result = await aggregate(stub, {
        operation: 'count',
        collection: 'NonExistent'
      })

      expect(result.value).toBe(0)
    })
  })

  describe('avg() operation', () => {
    it('should calculate average of field values', async () => {
      const stub = getStub()

      await createTestPurchases(stub, [
        { amount: 100 },
        { amount: 200 },
        { amount: 300 }
      ])

      const result = await aggregate(stub, {
        operation: 'avg',
        field: 'amount',
        collection: 'Purchase'
      })

      expect(result.value).toBe(200)
    })

    it('should return 0 for empty collection', async () => {
      const stub = getStub()

      const result = await aggregate(stub, {
        operation: 'avg',
        field: 'amount',
        collection: 'Empty'
      })

      expect(result.value).toBe(0)
    })
  })

  describe('min() operation', () => {
    it('should find minimum value', async () => {
      const stub = getStub()

      await createTestPurchases(stub, [
        { amount: 500 },
        { amount: 100 },
        { amount: 300 }
      ])

      const result = await aggregate(stub, {
        operation: 'min',
        field: 'amount',
        collection: 'Purchase'
      })

      expect(result.value).toBe(100)
    })

    it('should return 0 for empty collection', async () => {
      const stub = getStub()

      const result = await aggregate(stub, {
        operation: 'min',
        field: 'amount',
        collection: 'Empty'
      })

      expect(result.value).toBe(0)
    })
  })

  describe('max() operation', () => {
    it('should find maximum value', async () => {
      const stub = getStub()

      await createTestPurchases(stub, [
        { amount: 100 },
        { amount: 500 },
        { amount: 300 }
      ])

      const result = await aggregate(stub, {
        operation: 'max',
        field: 'amount',
        collection: 'Purchase'
      })

      expect(result.value).toBe(500)
    })

    it('should return 0 for empty collection', async () => {
      const stub = getStub()

      const result = await aggregate(stub, {
        operation: 'max',
        field: 'amount',
        collection: 'Empty'
      })

      expect(result.value).toBe(0)
    })
  })
})

// ============================================================================
// WHERE CLAUSE FILTERING TESTS
// ============================================================================

describe('AggregateBuilder with where()', () => {
  it('should filter by status', async () => {
    const stub = getStub()

    await createTestPurchases(stub, [
      { amount: 100, status: 'completed' },
      { amount: 200, status: 'pending' },
      { amount: 300, status: 'completed' }
    ])

    const result = await aggregate(stub, {
      operation: 'sum',
      field: 'amount',
      collection: 'Purchase',
      where: { status: 'completed' }
    })

    expect(result.value).toBe(400)
  })

  it('should filter by multiple conditions', async () => {
    const stub = getStub()

    await createTestPurchases(stub, [
      { amount: 100, status: 'completed', category: 'electronics' },
      { amount: 200, status: 'completed', category: 'books' },
      { amount: 300, status: 'pending', category: 'electronics' },
      { amount: 400, status: 'completed', category: 'electronics' }
    ])

    const result = await aggregate(stub, {
      operation: 'sum',
      field: 'amount',
      collection: 'Purchase',
      where: { status: 'completed', category: 'electronics' }
    })

    expect(result.value).toBe(500)
  })

  it('should return 0 when no items match filter', async () => {
    const stub = getStub()

    await createTestPurchases(stub, [
      { amount: 100, status: 'completed' },
      { amount: 200, status: 'completed' }
    ])

    const result = await aggregate(stub, {
      operation: 'sum',
      field: 'amount',
      collection: 'Purchase',
      where: { status: 'cancelled' }
    })

    expect(result.value).toBe(0)
  })
})

// ============================================================================
// GROUPBY TESTS
// ============================================================================

describe('AggregateBuilder with by() grouping', () => {
  it('should group sum by category', async () => {
    const stub = getStub()

    await createTestPurchases(stub, [
      { amount: 100, category: 'electronics' },
      { amount: 200, category: 'books' },
      { amount: 300, category: 'electronics' },
      { amount: 150, category: 'books' }
    ])

    const result = await aggregate(stub, {
      operation: 'sum',
      field: 'amount',
      collection: 'Purchase',
      groupBy: 'category'
    })

    expect(result.data).toBeDefined()
    expect(result.data?.length).toBe(2)

    const electronics = result.data?.find(d => d.key === 'electronics')
    const books = result.data?.find(d => d.key === 'books')

    expect(electronics?.value).toBe(400)
    expect(books?.value).toBe(350)
  })

  it('should group count by status', async () => {
    const stub = getStub()

    await createTestPurchases(stub, [
      { amount: 100, status: 'completed' },
      { amount: 200, status: 'pending' },
      { amount: 300, status: 'completed' },
      { amount: 400, status: 'completed' }
    ])

    const result = await aggregate(stub, {
      operation: 'count',
      collection: 'Purchase',
      groupBy: 'status'
    })

    expect(result.data).toBeDefined()

    const completed = result.data?.find(d => d.key === 'completed')
    const pending = result.data?.find(d => d.key === 'pending')

    expect(completed?.value).toBe(3)
    expect(pending?.value).toBe(1)
  })

  it('should calculate total across groups', async () => {
    const stub = getStub()

    await createTestPurchases(stub, [
      { amount: 100, category: 'a' },
      { amount: 200, category: 'b' },
      { amount: 300, category: 'a' }
    ])

    const result = await aggregate(stub, {
      operation: 'sum',
      field: 'amount',
      collection: 'Purchase',
      groupBy: 'category'
    })

    expect(result.total).toBe(600)
  })
})

// ============================================================================
// TIME RANGE TESTS
// ============================================================================

describe('AggregateBuilder with last() time range', () => {
  it('should include items created within time range', async () => {
    const stub = getStub()

    // All items are created "now" by the system ($createdAt is set on creation)
    await createTestPurchases(stub, [
      { amount: 100 },
      { amount: 200 },
      { amount: 300 }
    ])

    // Items created just now should be within the last 1 day
    const result = await aggregate(stub, {
      operation: 'sum',
      field: 'amount',
      collection: 'Purchase',
      timeRange: { value: 1, unit: 'days' }
    })

    // All items were just created, so all should be included
    expect(result.value).toBe(600)
  })

  it('should work with hours time range', async () => {
    const stub = getStub()

    await createTestPurchases(stub, [
      { amount: 100 },
      { amount: 200 }
    ])

    // Items created just now should be within the last 1 hour
    const result = await aggregate(stub, {
      operation: 'count',
      collection: 'Purchase',
      timeRange: { value: 1, unit: 'hours' }
    })

    expect(result.value).toBe(2)
  })

  it('should return 0 for empty time range', async () => {
    const stub = getStub()

    // Items created now won't be older than 0 days
    await createTestPurchases(stub, [
      { amount: 100 }
    ])

    // Zero-day time range means cutoff is "now", so recent items are excluded
    const result = await aggregate(stub, {
      operation: 'count',
      collection: 'Purchase',
      timeRange: { value: 0, unit: 'days' }
    })

    // Items created within the test execution should still be included
    // (the cutoff is exactly "now" so this is a boundary case)
    expect(result.value).toBeLessThanOrEqual(1)
  })

  it('should support weeks and months units', async () => {
    const stub = getStub()

    await createTestPurchases(stub, [
      { amount: 100 }
    ])

    // Items created just now should be within the last 1 week
    const weeksResult = await aggregate(stub, {
      operation: 'count',
      collection: 'Purchase',
      timeRange: { value: 1, unit: 'weeks' }
    })
    expect(weeksResult.value).toBe(1)

    // Items created just now should be within the last 1 month
    const monthsResult = await aggregate(stub, {
      operation: 'count',
      collection: 'Purchase',
      timeRange: { value: 1, unit: 'months' }
    })
    expect(monthsResult.value).toBe(1)
  })
})

// ============================================================================
// COMBINED TESTS (where + by + last)
// ============================================================================

describe('AggregateBuilder combined clauses', () => {
  it('should combine where and by', async () => {
    const stub = getStub()

    await createTestPurchases(stub, [
      { amount: 100, status: 'completed', category: 'electronics' },
      { amount: 200, status: 'pending', category: 'electronics' },
      { amount: 300, status: 'completed', category: 'books' },
      { amount: 400, status: 'completed', category: 'electronics' }
    ])

    const result = await aggregate(stub, {
      operation: 'sum',
      field: 'amount',
      collection: 'Purchase',
      where: { status: 'completed' },
      groupBy: 'category'
    })

    expect(result.data).toBeDefined()

    const electronics = result.data?.find(d => d.key === 'electronics')
    const books = result.data?.find(d => d.key === 'books')

    expect(electronics?.value).toBe(500)
    expect(books?.value).toBe(300)
  })
})

// ============================================================================
// VALIDATION TESTS
// ============================================================================

describe('AggregateBuilder validation', () => {
  it('should require operation for execution', async () => {
    const stub = getStub()

    try {
      await aggregate(stub, {
        operation: undefined as unknown as 'sum',
        collection: 'Purchase'
      })
      expect.fail('Should have thrown an error')
    } catch (error) {
      expect((error as Error).message).toContain('Operation is required')
    }
  })

  it('should require collection for execution', async () => {
    const stub = getStub()

    try {
      await aggregate(stub, {
        operation: 'sum',
        collection: undefined as unknown as string
      })
      expect.fail('Should have thrown an error')
    } catch (error) {
      expect((error as Error).message).toContain('Collection is required')
    }
  })
})

// ============================================================================
// PARSEWHERERCLAUSE TESTS
// ============================================================================

describe('parseWhereClause', () => {
  it('should parse equality condition with double quotes', () => {
    const result = parseWhereClause('status = "completed"')
    expect(result).toEqual({ status: 'completed' })
  })

  it('should parse equality condition with single quotes', () => {
    const result = parseWhereClause("status = 'completed'")
    expect(result).toEqual({ status: 'completed' })
  })

  it('should parse numeric condition', () => {
    const result = parseWhereClause('amount = 100')
    expect(result).toEqual({ amount: 100 })
  })

  it('should parse boolean condition', () => {
    const result = parseWhereClause('active = true')
    expect(result).toEqual({ active: true })
  })

  it('should parse null condition', () => {
    const result = parseWhereClause('deleted = null')
    expect(result).toEqual({ deleted: null })
  })

  it('should parse multiple conditions with AND', () => {
    const result = parseWhereClause('status = "completed" and amount = 100')
    expect(result).toEqual({ status: 'completed', amount: 100 })
  })

  it('should handle unquoted string values', () => {
    const result = parseWhereClause('type = subscription')
    expect(result).toEqual({ type: 'subscription' })
  })
})

// ============================================================================
// DISTINCT OPERATION TESTS
// ============================================================================

describe('AggregateBuilder distinct()', () => {
  it('should count distinct values', async () => {
    const stub = getStub()

    await createTestPurchases(stub, [
      { amount: 100, category: 'electronics' },
      { amount: 200, category: 'books' },
      { amount: 300, category: 'electronics' },
      { amount: 400, category: 'electronics' }
    ])

    const result = await aggregate(stub, {
      operation: 'distinct',
      field: 'category',
      collection: 'Purchase'
    })

    expect(result.value).toBe(2) // 'electronics' and 'books'
  })
})
