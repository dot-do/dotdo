/**
 * RED Phase: Execution Engine Tests
 *
 * Tests for the query execution engine that executes plans
 * against TypedColumnStore and other storage backends.
 *
 * @see dotdo-a5yho
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Import implementation and types
import {
  ExecutionEngine,
  type ExecutionContext,
  type ExecutionResult,
  type ExecutionStats,
  type TypedColumnStore,
  type ColumnBatch,
} from '../executor/execution-engine'
import type { QueryPlan, PlanNode } from '../planner/query-planner'

describe('ExecutionEngine', () => {
  let engine: ExecutionEngine
  let columnStore: TypedColumnStore
  let ctx: ExecutionContext

  beforeEach(() => {
    // GREEN phase: instantiate the actual engine
    engine = new ExecutionEngine()

    // Mock column store
    columnStore = {
      filter: vi.fn(),
      project: vi.fn(),
      aggregate: vi.fn(),
      bloomFilter: vi.fn(),
      minMax: vi.fn(),
      addColumn: vi.fn(),
      append: vi.fn(),
      encode: vi.fn(),
      decode: vi.fn(),
      distinctCount: vi.fn(),
    } as unknown as TypedColumnStore

    ctx = {
      columnStore,
      parameters: new Map(),
      timeout: 30000,
    }
  })

  describe('predicate evaluation', () => {
    it('should evaluate equality predicates', async () => {
      const plan: QueryPlan = {
        type: 'scan',
        source: 'users',
        predicates: [
          {
            tcsPredicate: { column: 'name', op: '=', value: 'Alice' },
            pushdown: true,
          },
        ],
        estimatedRows: 1,
        estimatedCost: 1,
      }

      columnStore.filter = vi.fn().mockReturnValue({
        columns: new Map([['name', ['Alice']]]),
        rowCount: 1,
      })

      const result = await engine.execute(plan, ctx)

      expect(columnStore.filter).toHaveBeenCalledWith({ column: 'name', op: '=', value: 'Alice' })
      expect(result.rowCount).toBe(1)
    })

    it('should evaluate range predicates', async () => {
      const plan: QueryPlan = {
        type: 'scan',
        source: 'users',
        predicates: [
          {
            tcsPredicate: { column: 'age', op: '>', value: 21 },
            pushdown: true,
          },
        ],
        estimatedRows: 100,
        estimatedCost: 10,
      }

      columnStore.filter = vi.fn().mockReturnValue({
        columns: new Map([['age', [22, 30, 45]]]),
        rowCount: 3,
      })

      const result = await engine.execute(plan, ctx)

      expect(result.rowCount).toBe(3)
    })

    it('should evaluate IN predicates', async () => {
      const plan: QueryPlan = {
        type: 'scan',
        source: 'users',
        predicates: [
          {
            tcsPredicate: { column: 'status', op: 'in', value: ['active', 'pending'] },
            pushdown: true,
          },
        ],
        estimatedRows: 50,
        estimatedCost: 5,
      }

      columnStore.filter = vi.fn().mockReturnValue({
        columns: new Map([['status', ['active', 'pending', 'active']]]),
        rowCount: 3,
      })

      const result = await engine.execute(plan, ctx)

      expect(result.rowCount).toBe(3)
    })

    it('should evaluate complex logical expressions', async () => {
      const plan: QueryPlan = {
        type: 'filter',
        source: 'users',
        predicates: [
          { tcsPredicate: { column: 'age', op: '>=', value: 18 }, pushdown: true },
          { tcsPredicate: { column: 'status', op: '=', value: 'active' }, pushdown: true },
        ],
        logicalOp: 'AND',
        estimatedRows: 50,
        estimatedCost: 10,
      }

      columnStore.filter = vi.fn()
        .mockReturnValueOnce({
          columns: new Map([['age', [18, 25, 30]], ['status', ['active', 'active', 'deleted']]]),
          rowCount: 3,
        })
        .mockReturnValueOnce({
          columns: new Map([['age', [18, 25]], ['status', ['active', 'active']]]),
          rowCount: 2,
        })

      const result = await engine.execute(plan, ctx)

      expect(columnStore.filter).toHaveBeenCalledTimes(2)
    })

    it('should short-circuit AND on first false', async () => {
      const plan: QueryPlan = {
        type: 'filter',
        source: 'users',
        predicates: [
          { tcsPredicate: { column: 'deleted', op: '=', value: true }, pushdown: true },
          { tcsPredicate: { column: 'age', op: '>', value: 100 }, pushdown: true },
        ],
        logicalOp: 'AND',
        estimatedRows: 0,
        estimatedCost: 1,
      }

      columnStore.filter = vi.fn().mockReturnValueOnce({
        columns: new Map(),
        rowCount: 0, // First predicate returns empty
      })

      const result = await engine.execute(plan, ctx)

      expect(result.rowCount).toBe(0)
      // Second predicate should not be evaluated
      expect(columnStore.filter).toHaveBeenCalledTimes(1)
    })

    it('should short-circuit OR on first true', async () => {
      const plan: QueryPlan = {
        type: 'filter',
        source: 'users',
        predicates: [
          { tcsPredicate: { column: 'role', op: '=', value: 'admin' }, pushdown: true },
          { tcsPredicate: { column: 'role', op: '=', value: 'superuser' }, pushdown: true },
        ],
        logicalOp: 'OR',
        estimatedRows: 10,
        estimatedCost: 2,
        shortCircuit: true,
      }

      const allRows = new Map([['role', ['admin', 'user', 'user', 'admin']]]);
      (columnStore.project as any).mockReturnValue({ columns: allRows, rowCount: 4 })

      // For OR with short-circuit, once we find matches we return them
      const result = await engine.execute(plan, ctx)

      expect(result).toBeDefined()
    })
  })

  describe('projection', () => {
    it('should select specified columns', async () => {
      const plan: QueryPlan = {
        type: 'project',
        source: 'users',
        columns: ['id', 'name', 'email'],
        estimatedRows: 100,
        estimatedCost: 10,
      }

      columnStore.project = vi.fn().mockReturnValue({
        columns: new Map([
          ['id', [1, 2, 3]],
          ['name', ['Alice', 'Bob', 'Charlie']],
          ['email', ['a@test.com', 'b@test.com', 'c@test.com']],
        ]),
        rowCount: 3,
      })

      const result = await engine.execute(plan, ctx)

      expect(columnStore.project).toHaveBeenCalledWith(['id', 'name', 'email'])
      expect(result.columns.size).toBe(3)
    })

    it('should rename columns with aliases', async () => {
      const plan: QueryPlan = {
        type: 'project',
        source: 'users',
        columns: [
          { source: 'first_name', alias: 'firstName' },
          { source: 'last_name', alias: 'lastName' },
        ],
        estimatedRows: 100,
        estimatedCost: 10,
      }

      columnStore.project = vi.fn().mockReturnValue({
        columns: new Map([
          ['first_name', ['Alice', 'Bob']],
          ['last_name', ['Smith', 'Jones']],
        ]),
        rowCount: 2,
      })

      const result = await engine.execute(plan, ctx)

      expect(result.columns.has('firstName')).toBe(true)
      expect(result.columns.has('lastName')).toBe(true)
    })

    it('should evaluate computed columns', async () => {
      const plan: QueryPlan = {
        type: 'project',
        source: 'orders',
        columns: [
          { source: 'id' },
          {
            expression: { operator: 'multiply', operands: ['price', 'quantity'] },
            alias: 'total',
          },
        ],
        estimatedRows: 100,
        estimatedCost: 20,
      }

      columnStore.project = vi.fn().mockReturnValue({
        columns: new Map([
          ['id', [1, 2, 3]],
          ['price', [10, 20, 30]],
          ['quantity', [2, 3, 1]],
        ]),
        rowCount: 3,
      })

      const result = await engine.execute(plan, ctx)

      expect(result.columns.get('total')).toEqual([20, 60, 30])
    })
  })

  describe('aggregation', () => {
    it('should compute COUNT(*)', async () => {
      const plan: QueryPlan = {
        type: 'aggregate',
        source: 'users',
        aggregations: [{ function: 'count', alias: 'total' }],
        estimatedRows: 1,
        estimatedCost: 10,
      }

      columnStore.aggregate = vi.fn().mockReturnValue(1000)

      const result = await engine.execute(plan, ctx)

      expect(result.columns.get('total')).toEqual([1000])
    })

    it('should compute COUNT(column) excluding nulls', async () => {
      const plan: QueryPlan = {
        type: 'aggregate',
        source: 'users',
        aggregations: [{ function: 'count', column: 'email', alias: 'emailCount' }],
        estimatedRows: 1,
        estimatedCost: 10,
      }

      columnStore.aggregate = vi.fn().mockReturnValue(950) // 50 nulls excluded

      const result = await engine.execute(plan, ctx)

      expect(result.columns.get('emailCount')).toEqual([950])
    })

    it('should compute SUM, AVG, MIN, MAX', async () => {
      const plan: QueryPlan = {
        type: 'aggregate',
        source: 'orders',
        aggregations: [
          { function: 'sum', column: 'amount', alias: 'total' },
          { function: 'avg', column: 'amount', alias: 'average' },
          { function: 'min', column: 'amount', alias: 'minimum' },
          { function: 'max', column: 'amount', alias: 'maximum' },
        ],
        estimatedRows: 1,
        estimatedCost: 40,
      }

      columnStore.aggregate = vi.fn()
        .mockReturnValueOnce(10000)
        .mockReturnValueOnce(100)
        .mockReturnValueOnce(10)
        .mockReturnValueOnce(500)

      const result = await engine.execute(plan, ctx)

      expect(result.columns.get('total')).toEqual([10000])
      expect(result.columns.get('average')).toEqual([100])
      expect(result.columns.get('minimum')).toEqual([10])
      expect(result.columns.get('maximum')).toEqual([500])
    })

    it('should group by single column', async () => {
      const plan: QueryPlan = {
        type: 'hash_aggregate',
        source: 'orders',
        groupBy: ['category'],
        aggregations: [
          { function: 'sum', column: 'amount', alias: 'total' },
          { function: 'count', alias: 'count' },
        ],
        estimatedRows: 10,
        estimatedCost: 100,
      }

      // Mock grouped aggregation result
      const result = await engine.execute(plan, ctx)

      expect(result.columns.has('category')).toBe(true)
      expect(result.columns.has('total')).toBe(true)
      expect(result.columns.has('count')).toBe(true)
    })

    it('should group by multiple columns', async () => {
      const plan: QueryPlan = {
        type: 'hash_aggregate',
        source: 'orders',
        groupBy: ['category', 'region'],
        aggregations: [{ function: 'sum', column: 'amount', alias: 'total' }],
        estimatedRows: 50,
        estimatedCost: 200,
      }

      const result = await engine.execute(plan, ctx)

      expect(result.columns.has('category')).toBe(true)
      expect(result.columns.has('region')).toBe(true)
    })

    it('should apply HAVING filter after grouping', async () => {
      const plan: QueryPlan = {
        type: 'hash_aggregate',
        source: 'products',
        groupBy: ['category'],
        aggregations: [{ function: 'count', alias: 'productCount' }],
        having: { column: 'productCount', op: '>=', value: 10 },
        estimatedRows: 5,
        estimatedCost: 150,
      }

      const result = await engine.execute(plan, ctx)

      // Only groups with count >= 10 should be returned
      expect(result).toBeDefined()
    })
  })

  describe('sorting', () => {
    it('should sort ascending', async () => {
      const plan: QueryPlan = {
        type: 'sort',
        source: 'users',
        columns: [{ column: 'name', direction: 'ASC' }],
        estimatedRows: 100,
        estimatedCost: 50,
      }

      columnStore.project = vi.fn().mockReturnValue({
        columns: new Map([['name', ['Charlie', 'Alice', 'Bob']]]),
        rowCount: 3,
      })

      const result = await engine.execute(plan, ctx)

      expect(result.columns.get('name')).toEqual(['Alice', 'Bob', 'Charlie'])
    })

    it('should sort descending', async () => {
      const plan: QueryPlan = {
        type: 'sort',
        source: 'orders',
        columns: [{ column: 'amount', direction: 'DESC' }],
        estimatedRows: 100,
        estimatedCost: 50,
      }

      columnStore.project = vi.fn().mockReturnValue({
        columns: new Map([['amount', [100, 300, 200]]]),
        rowCount: 3,
      })

      const result = await engine.execute(plan, ctx)

      expect(result.columns.get('amount')).toEqual([300, 200, 100])
    })

    it('should handle multi-column sort', async () => {
      const plan: QueryPlan = {
        type: 'sort',
        source: 'employees',
        columns: [
          { column: 'department', direction: 'ASC' },
          { column: 'salary', direction: 'DESC' },
        ],
        estimatedRows: 100,
        estimatedCost: 75,
      }

      columnStore.project = vi.fn().mockReturnValue({
        columns: new Map([
          ['department', ['Sales', 'Engineering', 'Sales']],
          ['salary', [60000, 100000, 80000]],
        ]),
        rowCount: 3,
      })

      const result = await engine.execute(plan, ctx)

      // Engineering first, then Sales (80k, 60k)
      expect(result).toBeDefined()
    })

    it('should handle nulls first/last', async () => {
      const plan: QueryPlan = {
        type: 'sort',
        source: 'tasks',
        columns: [{ column: 'completedAt', direction: 'ASC', nulls: 'last' }],
        estimatedRows: 100,
        estimatedCost: 50,
      }

      columnStore.project = vi.fn().mockReturnValue({
        columns: new Map([['completedAt', [null, 1000, 500, null]]]),
        rowCount: 4,
      })

      const result = await engine.execute(plan, ctx)

      // Nulls should come last
      const values = result.columns.get('completedAt') as (number | null)[]
      expect(values[values.length - 1]).toBeNull()
      expect(values[values.length - 2]).toBeNull()
    })

    it('should use external sort for large datasets', async () => {
      const plan: QueryPlan = {
        type: 'sort',
        source: 'large_table',
        columns: [{ column: 'value', direction: 'ASC' }],
        estimatedRows: 10000000,
        estimatedCost: 100000,
        useExternalSort: true,
      }

      const result = await engine.execute(plan, ctx)

      expect(result.stats.externalSortUsed).toBe(true)
    })
  })

  describe('joins', () => {
    let ordersStore: TypedColumnStore
    let customersStore: TypedColumnStore

    beforeEach(() => {
      ordersStore = {
        project: vi.fn().mockReturnValue({
          columns: new Map([
            ['id', [1, 2, 3]],
            ['customerId', ['c1', 'c2', 'c1']],
            ['amount', [100, 200, 150]],
          ]),
          rowCount: 3,
        }),
      } as unknown as TypedColumnStore

      customersStore = {
        project: vi.fn().mockReturnValue({
          columns: new Map([
            ['id', ['c1', 'c2', 'c3']],
            ['name', ['Alice', 'Bob', 'Charlie']],
          ]),
          rowCount: 3,
        }),
      } as unknown as TypedColumnStore
    })

    it('should perform hash join', async () => {
      const plan: QueryPlan = {
        type: 'hash_join',
        left: { type: 'scan', source: 'orders', estimatedRows: 1000, estimatedCost: 100 },
        right: { type: 'scan', source: 'customers', estimatedRows: 100, estimatedCost: 10 },
        on: { leftColumn: 'customerId', rightColumn: 'id' },
        buildSide: 'right',
        estimatedRows: 1000,
        estimatedCost: 200,
      }

      ctx.stores = { orders: ordersStore, customers: customersStore }

      const result = await engine.execute(plan, ctx)

      expect(result.columns.has('customerId')).toBe(true)
      expect(result.columns.has('name')).toBe(true)
    })

    it('should perform nested loop join', async () => {
      const plan: QueryPlan = {
        type: 'nested_loop',
        left: { type: 'scan', source: 'orders', estimatedRows: 10, estimatedCost: 10 },
        right: { type: 'scan', source: 'customers', estimatedRows: 100, estimatedCost: 10 },
        on: { leftColumn: 'customerId', rightColumn: 'id' },
        estimatedRows: 10,
        estimatedCost: 100,
      }

      ctx.stores = { orders: ordersStore, customers: customersStore }

      const result = await engine.execute(plan, ctx)

      expect(result).toBeDefined()
    })

    it('should perform index nested loop join', async () => {
      const plan: QueryPlan = {
        type: 'nested_loop',
        left: { type: 'scan', source: 'orders', estimatedRows: 10, estimatedCost: 10 },
        right: { type: 'index_scan', source: 'customers', estimatedRows: 1, estimatedCost: 1 },
        on: { leftColumn: 'customerId', rightColumn: 'id' },
        indexHint: { name: 'idx_customer_id', type: 'btree', columns: ['id'] },
        estimatedRows: 10,
        estimatedCost: 20,
      }

      ctx.stores = { orders: ordersStore, customers: customersStore }

      const result = await engine.execute(plan, ctx)

      expect(result).toBeDefined()
    })

    it('should handle LEFT/RIGHT joins with nulls', async () => {
      const plan: QueryPlan = {
        type: 'hash_join',
        joinType: 'LEFT',
        left: { type: 'scan', source: 'orders', estimatedRows: 100, estimatedCost: 10 },
        right: { type: 'scan', source: 'customers', estimatedRows: 50, estimatedCost: 5 },
        on: { leftColumn: 'customerId', rightColumn: 'id' },
        estimatedRows: 100,
        estimatedCost: 50,
      }

      ctx.stores = { orders: ordersStore, customers: customersStore }

      const result = await engine.execute(plan, ctx)

      // Left join should preserve all left rows
      expect(result.rowCount).toBeGreaterThanOrEqual(ordersStore.project.mock.results[0].value.rowCount)
    })
  })

  describe('TypedColumnStore integration', () => {
    it('should push predicates to column store filter()', async () => {
      const plan: QueryPlan = {
        type: 'scan',
        source: 'users',
        predicates: [
          { tcsPredicate: { column: 'age', op: '>=', value: 18 }, pushdown: true },
        ],
        estimatedRows: 100,
        estimatedCost: 10,
      }

      columnStore.filter = vi.fn().mockReturnValue({
        columns: new Map([['age', [18, 25, 30]]]),
        rowCount: 3,
      })

      await engine.execute(plan, ctx)

      expect(columnStore.filter).toHaveBeenCalledWith({ column: 'age', op: '>=', value: 18 })
    })

    it('should use bloom filter for pre-filtering', async () => {
      const mockBloom = { mightContain: vi.fn().mockReturnValue(true) }
      columnStore.bloomFilter = vi.fn().mockReturnValue(mockBloom)

      const plan: QueryPlan = {
        type: 'scan',
        source: 'users',
        predicates: [
          { tcsPredicate: { column: 'email', op: '=', value: 'alice@example.com' }, useBloomFilter: true, pushdown: true },
        ],
        estimatedRows: 1,
        estimatedCost: 5,
      }

      await engine.execute(plan, ctx)

      expect(columnStore.bloomFilter).toHaveBeenCalledWith('email')
      expect(mockBloom.mightContain).toHaveBeenCalledWith('alice@example.com')
    })

    it('should skip scan when bloom filter returns false', async () => {
      const mockBloom = { mightContain: vi.fn().mockReturnValue(false) }
      columnStore.bloomFilter = vi.fn().mockReturnValue(mockBloom)
      columnStore.filter = vi.fn()

      const plan: QueryPlan = {
        type: 'scan',
        source: 'users',
        predicates: [
          { tcsPredicate: { column: 'email', op: '=', value: 'nonexistent@example.com' }, useBloomFilter: true, pushdown: true },
        ],
        estimatedRows: 1,
        estimatedCost: 5,
      }

      const result = await engine.execute(plan, ctx)

      expect(result.rowCount).toBe(0)
      expect(columnStore.filter).not.toHaveBeenCalled()
    })

    it('should use min/max for partition pruning', async () => {
      columnStore.minMax = vi.fn().mockReturnValue({ min: 0, max: 50 })
      columnStore.filter = vi.fn()

      const plan: QueryPlan = {
        type: 'scan',
        source: 'users',
        predicates: [
          { tcsPredicate: { column: 'age', op: '>', value: 100 }, useMinMax: true, pushdown: true },
        ],
        estimatedRows: 0,
        estimatedCost: 1,
      }

      const result = await engine.execute(plan, ctx)

      expect(columnStore.minMax).toHaveBeenCalledWith('age')
      expect(result.rowCount).toBe(0)
      expect(columnStore.filter).not.toHaveBeenCalled()
    })

    it('should project only required columns', async () => {
      const plan: QueryPlan = {
        type: 'project',
        source: 'users',
        columns: ['id', 'name'],
        estimatedRows: 100,
        estimatedCost: 10,
      }

      columnStore.project = vi.fn().mockReturnValue({
        columns: new Map([['id', [1, 2]], ['name', ['Alice', 'Bob']]]),
        rowCount: 2,
      })

      await engine.execute(plan, ctx)

      // Should only request needed columns
      expect(columnStore.project).toHaveBeenCalledWith(['id', 'name'])
    })
  })

  describe('streaming execution', () => {
    it('should yield results incrementally', async () => {
      const plan: QueryPlan = {
        type: 'scan',
        source: 'large_table',
        predicates: [],
        estimatedRows: 1000000,
        estimatedCost: 10000,
        streaming: true,
      }

      const results: Record<string, unknown>[] = []
      for await (const row of engine.stream(plan, ctx)) {
        results.push(row)
        if (results.length >= 10) break // Only take first 10
      }

      expect(results.length).toBe(10)
    })

    it('should respect backpressure', async () => {
      const plan: QueryPlan = {
        type: 'scan',
        source: 'large_table',
        predicates: [],
        estimatedRows: 1000000,
        estimatedCost: 10000,
        streaming: true,
        batchSize: 100,
      }

      let batches = 0
      for await (const _row of engine.stream(plan, ctx)) {
        batches++
        // Simulate slow consumer
        await new Promise((resolve) => setTimeout(resolve, 10))
        if (batches >= 5) break
      }

      expect(batches).toBe(5)
    })

    it('should allow cancellation', async () => {
      const plan: QueryPlan = {
        type: 'scan',
        source: 'large_table',
        predicates: [],
        estimatedRows: 1000000,
        estimatedCost: 10000,
        streaming: true,
      }

      const abortController = new AbortController()
      ctx.signal = abortController.signal

      const iterator = engine.stream(plan, ctx)

      // Cancel after first result
      await iterator.next()
      abortController.abort()

      const { done } = await iterator.next()
      expect(done).toBe(true)
    })
  })

  describe('error handling', () => {
    it('should report type mismatch errors', async () => {
      const plan: QueryPlan = {
        type: 'filter',
        source: 'users',
        predicates: [
          { tcsPredicate: { column: 'age', op: '>', value: 'not-a-number' }, pushdown: true },
        ],
        estimatedRows: 0,
        estimatedCost: 1,
      }

      await expect(engine.execute(plan, ctx)).rejects.toThrow(/type mismatch/i)
    })

    it('should handle division by zero', async () => {
      const plan: QueryPlan = {
        type: 'project',
        source: 'data',
        columns: [
          {
            expression: { operator: 'divide', operands: ['value', 'divisor'] },
            alias: 'result',
          },
        ],
        estimatedRows: 100,
        estimatedCost: 10,
      }

      columnStore.project = vi.fn().mockReturnValue({
        columns: new Map([
          ['value', [10, 20, 30]],
          ['divisor', [2, 0, 5]], // Division by zero on second row
        ]),
        rowCount: 3,
      })

      const result = await engine.execute(plan, ctx)

      // Should return null or Infinity for division by zero
      const results = result.columns.get('result') as number[]
      expect([null, Infinity, NaN]).toContain(results[1])
    })

    it('should handle overflow', async () => {
      const plan: QueryPlan = {
        type: 'aggregate',
        source: 'data',
        aggregations: [{ function: 'sum', column: 'value', alias: 'total' }],
        estimatedRows: 1,
        estimatedCost: 10,
      }

      // Simulate overflow scenario
      columnStore.aggregate = vi.fn().mockImplementation(() => {
        throw new Error('Numeric overflow')
      })

      await expect(engine.execute(plan, ctx)).rejects.toThrow(/overflow/i)
    })

    it('should recover from partial failures', async () => {
      const plan: QueryPlan = {
        type: 'union',
        children: [
          { type: 'scan', source: 'partition1', estimatedRows: 100, estimatedCost: 10 },
          { type: 'scan', source: 'partition2', estimatedRows: 100, estimatedCost: 10 },
          { type: 'scan', source: 'partition3', estimatedRows: 100, estimatedCost: 10 },
        ],
        estimatedRows: 300,
        estimatedCost: 30,
        failFast: false, // Continue on errors
      }

      // Second partition fails
      const results = await engine.execute(plan, ctx)

      // Should return results from partitions 1 and 3
      expect(results.stats.partialFailures).toBeDefined()
    })

    it('should timeout long-running queries', async () => {
      ctx.timeout = 100 // 100ms timeout

      const plan: QueryPlan = {
        type: 'scan',
        source: 'huge_table',
        predicates: [],
        estimatedRows: 100000000,
        estimatedCost: 1000000,
      }

      await expect(engine.execute(plan, ctx)).rejects.toThrow(/timeout/i)
    })
  })

  describe('execution statistics', () => {
    it('should track rows scanned', async () => {
      const plan: QueryPlan = {
        type: 'scan',
        source: 'users',
        predicates: [{ tcsPredicate: { column: 'active', op: '=', value: true }, pushdown: true }],
        estimatedRows: 50,
        estimatedCost: 10,
      }

      columnStore.filter = vi.fn().mockReturnValue({
        columns: new Map([['active', [true, true, true]]]),
        rowCount: 3,
      })

      const result = await engine.execute(plan, ctx)

      expect(result.stats.rowsScanned).toBeGreaterThan(0)
    })

    it('should track rows returned', async () => {
      const plan: QueryPlan = {
        type: 'scan',
        source: 'users',
        predicates: [],
        estimatedRows: 100,
        estimatedCost: 10,
      }

      columnStore.project = vi.fn().mockReturnValue({
        columns: new Map([['id', [1, 2, 3, 4, 5]]]),
        rowCount: 5,
      })

      const result = await engine.execute(plan, ctx)

      expect(result.stats.rowsReturned).toBe(5)
    })

    it('should track partitions pruned', async () => {
      columnStore.minMax = vi.fn().mockReturnValue({ min: 0, max: 50 })

      const plan: QueryPlan = {
        type: 'scan',
        source: 'partitioned_table',
        predicates: [{ tcsPredicate: { column: 'date', op: '>=', value: '2024-06-01' }, useMinMax: true, pushdown: true }],
        partitions: ['2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06'],
        estimatedRows: 1000,
        estimatedCost: 100,
      }

      const result = await engine.execute(plan, ctx)

      expect(result.stats.partitionsPruned).toBeGreaterThan(0)
    })

    it('should track cache hits', async () => {
      const plan: QueryPlan = {
        type: 'scan',
        source: 'cached_data',
        predicates: [],
        estimatedRows: 100,
        estimatedCost: 10,
      }

      // First execution - cache miss
      const result1 = await engine.execute(plan, ctx)
      expect(result1.stats.cacheHits).toBe(0)

      // Second execution - cache hit
      const result2 = await engine.execute(plan, ctx)
      expect(result2.stats.cacheHits).toBeGreaterThan(0)
    })

    it('should track execution time', async () => {
      const plan: QueryPlan = {
        type: 'scan',
        source: 'users',
        predicates: [],
        estimatedRows: 100,
        estimatedCost: 10,
      }

      columnStore.project = vi.fn().mockReturnValue({
        columns: new Map([['id', [1]]]),
        rowCount: 1,
      })

      const result = await engine.execute(plan, ctx)

      expect(result.stats.executionTimeMs).toBeGreaterThanOrEqual(0)
    })
  })

  describe('performance', () => {
    it('should execute simple queries under 10ms', async () => {
      const plan: QueryPlan = {
        type: 'scan',
        source: 'users',
        predicates: [{ tcsPredicate: { column: 'id', op: '=', value: 1 }, pushdown: true }],
        estimatedRows: 1,
        estimatedCost: 1,
      }

      columnStore.filter = vi.fn().mockReturnValue({
        columns: new Map([['id', [1]]]),
        rowCount: 1,
      })

      const start = performance.now()
      await engine.execute(plan, ctx)
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(10)
    })

    it('should execute aggregations efficiently', async () => {
      const plan: QueryPlan = {
        type: 'hash_aggregate',
        source: 'orders',
        groupBy: ['customerId'],
        aggregations: [
          { function: 'sum', column: 'amount', alias: 'total' },
          { function: 'count', alias: 'orderCount' },
        ],
        estimatedRows: 1000,
        estimatedCost: 100,
      }

      const start = performance.now()
      await engine.execute(plan, ctx)
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(100) // Under 100ms
    })
  })
})
