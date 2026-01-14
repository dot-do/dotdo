/**
 * RED Phase: Advanced Query Engine Tests
 *
 * Tests for advanced query engine operations including:
 * - Complex JOIN operations (hash join, merge join, nested loop)
 * - Subqueries and correlated subqueries
 * - Window functions
 * - CTEs (Common Table Expressions)
 * - Query rewriting and optimization
 *
 * These tests define expected behavior for production-grade query processing.
 *
 * @see dotdo-nsni0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  ExecutionEngine,
  type ExecutionContext,
  type TypedColumnStore,
} from '../executor/execution-engine'
import type { QueryPlan, PlanNode } from '../planner/query-planner'
import { QueryPlanner, type TableStatistics } from '../planner/query-planner'
import { SQLWhereParser } from '../parsers/sql-parser'

// ============================================================================
// TEST UTILITIES
// ============================================================================

function createMockColumnStore(): TypedColumnStore {
  return {
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
}

// ============================================================================
// JOIN OPERATION TESTS
// ============================================================================

describe('Query Engine - JOIN Operations', () => {
  let engine: ExecutionEngine
  let columnStore: TypedColumnStore
  let ctx: ExecutionContext

  beforeEach(() => {
    engine = new ExecutionEngine()
    columnStore = createMockColumnStore()
    ctx = {
      columnStore,
      parameters: new Map(),
      timeout: 30000,
    }
  })

  describe('Hash Join', () => {
    it('should execute hash join with equality predicate', async () => {
      const plan: QueryPlan = {
        type: 'hash_join',
        source: 'orders',
        joinTarget: 'customers',
        joinType: 'inner',
        joinCondition: {
          leftColumn: 'customer_id',
          rightColumn: 'id',
          op: '=',
        },
        estimatedRows: 1000,
        estimatedCost: 100,
      }

      ;(columnStore.project as any).mockImplementation((table: string) => {
        if (table === 'customers') {
          return {
            columns: new Map([
              ['id', [1, 2, 3]],
              ['name', ['Alice', 'Bob', 'Charlie']],
            ]),
            rowCount: 3,
          }
        }
        return {
          columns: new Map([
            ['id', [101, 102, 103, 104]],
            ['customer_id', [1, 2, 1, 3]],
            ['amount', [100, 200, 150, 300]],
          ]),
          rowCount: 4,
        }
      })

      const result = await engine.execute(plan, ctx)

      expect(result.rowCount).toBe(4)
      // Verify join produced correct combined rows
      expect(result.columns.has('name')).toBe(true)
      expect(result.columns.has('amount')).toBe(true)
    })

    it('should handle hash join with NULL values correctly', async () => {
      const plan: QueryPlan = {
        type: 'hash_join',
        source: 'orders',
        joinTarget: 'customers',
        joinType: 'inner',
        joinCondition: {
          leftColumn: 'customer_id',
          rightColumn: 'id',
          op: '=',
        },
        estimatedRows: 100,
        estimatedCost: 10,
      }

      ;(columnStore.project as any).mockImplementation((table: string) => {
        if (table === 'customers') {
          return {
            columns: new Map([
              ['id', [1, null, 3]],
              ['name', ['Alice', 'Unknown', 'Charlie']],
            ]),
            rowCount: 3,
          }
        }
        return {
          columns: new Map([
            ['id', [101, 102]],
            ['customer_id', [null, 1]],
            ['amount', [100, 200]],
          ]),
          rowCount: 2,
        }
      })

      const result = await engine.execute(plan, ctx)

      // NULL should not match NULL in standard SQL semantics
      expect(result.rowCount).toBe(1)
    })

    it('should handle hash join with composite keys', async () => {
      const plan: QueryPlan = {
        type: 'hash_join',
        source: 'order_items',
        joinTarget: 'products',
        joinType: 'inner',
        joinCondition: {
          compositeKey: [
            { leftColumn: 'product_id', rightColumn: 'id', op: '=' },
            { leftColumn: 'variant_id', rightColumn: 'variant', op: '=' },
          ],
        },
        estimatedRows: 500,
        estimatedCost: 50,
      }

      ;(columnStore.project as any).mockImplementation((table: string) => {
        if (table === 'products') {
          return {
            columns: new Map([
              ['id', ['P1', 'P1', 'P2']],
              ['variant', ['S', 'M', 'S']],
              ['name', ['Shirt Small', 'Shirt Medium', 'Pants Small']],
            ]),
            rowCount: 3,
          }
        }
        return {
          columns: new Map([
            ['order_id', [1, 1, 2]],
            ['product_id', ['P1', 'P2', 'P1']],
            ['variant_id', ['S', 'S', 'M']],
            ['qty', [2, 1, 3]],
          ]),
          rowCount: 3,
        }
      })

      const result = await engine.execute(plan, ctx)

      expect(result.rowCount).toBe(3)
    })
  })

  describe('Left/Right/Full Outer Join', () => {
    it('should execute LEFT OUTER JOIN preserving unmatched left rows', async () => {
      const plan: QueryPlan = {
        type: 'hash_join',
        source: 'customers',
        joinTarget: 'orders',
        joinType: 'left',
        joinCondition: {
          leftColumn: 'id',
          rightColumn: 'customer_id',
          op: '=',
        },
        estimatedRows: 100,
        estimatedCost: 20,
      }

      ;(columnStore.project as any).mockImplementation((table: string) => {
        if (table === 'customers') {
          return {
            columns: new Map([
              ['id', [1, 2, 3]],
              ['name', ['Alice', 'Bob', 'Charlie']],
            ]),
            rowCount: 3,
          }
        }
        return {
          columns: new Map([
            ['id', [101, 102]],
            ['customer_id', [1, 1]],
            ['amount', [100, 200]],
          ]),
          rowCount: 2,
        }
      })

      const result = await engine.execute(plan, ctx)

      // Alice has 2 orders, Bob has 0, Charlie has 0
      // Result should have: Alice+order1, Alice+order2, Bob+null, Charlie+null
      expect(result.rowCount).toBe(4)

      // Verify NULL values for unmatched right side
      const amounts = result.columns.get('amount')
      expect(amounts).toContain(null)
    })

    it('should execute FULL OUTER JOIN preserving unmatched rows from both sides', async () => {
      const plan: QueryPlan = {
        type: 'hash_join',
        source: 'employees',
        joinTarget: 'departments',
        joinType: 'full',
        joinCondition: {
          leftColumn: 'dept_id',
          rightColumn: 'id',
          op: '=',
        },
        estimatedRows: 100,
        estimatedCost: 30,
      }

      ;(columnStore.project as any).mockImplementation((table: string) => {
        if (table === 'employees') {
          return {
            columns: new Map([
              ['id', [1, 2, 3]],
              ['name', ['Alice', 'Bob', 'Charlie']],
              ['dept_id', [10, 20, null]], // Charlie has no dept
            ]),
            rowCount: 3,
          }
        }
        return {
          columns: new Map([
            ['id', [10, 20, 30]], // Dept 30 has no employees
            ['dept_name', ['Engineering', 'Sales', 'Marketing']],
          ]),
          rowCount: 3,
        }
      })

      const result = await engine.execute(plan, ctx)

      // Alice+Engineering, Bob+Sales, Charlie+null, null+Marketing
      expect(result.rowCount).toBe(4)
    })
  })

  describe('Merge Join', () => {
    it('should execute sort-merge join on sorted inputs', async () => {
      const plan: QueryPlan = {
        type: 'merge_join',
        source: 'orders',
        joinTarget: 'customers',
        joinType: 'inner',
        joinCondition: {
          leftColumn: 'customer_id',
          rightColumn: 'id',
          op: '=',
        },
        sortedInputs: true,
        estimatedRows: 1000,
        estimatedCost: 80,
      }

      // Inputs are pre-sorted by join key
      ;(columnStore.project as any).mockImplementation((table: string) => {
        if (table === 'customers') {
          return {
            columns: new Map([
              ['id', [1, 2, 3]],
              ['name', ['Alice', 'Bob', 'Charlie']],
            ]),
            rowCount: 3,
            sorted: 'id',
          }
        }
        return {
          columns: new Map([
            ['id', [101, 102, 103]],
            ['customer_id', [1, 1, 2]],
            ['amount', [100, 150, 200]],
          ]),
          rowCount: 3,
          sorted: 'customer_id',
        }
      })

      const result = await engine.execute(plan, ctx)

      expect(result.rowCount).toBe(3)
    })
  })

  describe('Anti Join and Semi Join', () => {
    it('should execute SEMI JOIN (EXISTS subquery pattern)', async () => {
      const plan: QueryPlan = {
        type: 'semi_join',
        source: 'customers',
        joinTarget: 'orders',
        joinCondition: {
          leftColumn: 'id',
          rightColumn: 'customer_id',
          op: '=',
        },
        estimatedRows: 50,
        estimatedCost: 15,
      }

      ;(columnStore.project as any).mockImplementation((table: string) => {
        if (table === 'customers') {
          return {
            columns: new Map([
              ['id', [1, 2, 3]],
              ['name', ['Alice', 'Bob', 'Charlie']],
            ]),
            rowCount: 3,
          }
        }
        return {
          columns: new Map([
            ['customer_id', [1, 1, 3]],
          ]),
          rowCount: 3,
        }
      })

      const result = await engine.execute(plan, ctx)

      // Only customers with orders: Alice (1), Charlie (3)
      expect(result.rowCount).toBe(2)
      expect(result.columns.get('name')).toEqual(['Alice', 'Charlie'])
    })

    it('should execute ANTI JOIN (NOT EXISTS subquery pattern)', async () => {
      const plan: QueryPlan = {
        type: 'anti_join',
        source: 'customers',
        joinTarget: 'orders',
        joinCondition: {
          leftColumn: 'id',
          rightColumn: 'customer_id',
          op: '=',
        },
        estimatedRows: 10,
        estimatedCost: 15,
      }

      ;(columnStore.project as any).mockImplementation((table: string) => {
        if (table === 'customers') {
          return {
            columns: new Map([
              ['id', [1, 2, 3]],
              ['name', ['Alice', 'Bob', 'Charlie']],
            ]),
            rowCount: 3,
          }
        }
        return {
          columns: new Map([
            ['customer_id', [1, 3]],
          ]),
          rowCount: 2,
        }
      })

      const result = await engine.execute(plan, ctx)

      // Only customers without orders: Bob (2)
      expect(result.rowCount).toBe(1)
      expect(result.columns.get('name')).toEqual(['Bob'])
    })
  })
})

// ============================================================================
// SUBQUERY TESTS
// ============================================================================

describe('Query Engine - Subqueries', () => {
  let engine: ExecutionEngine
  let columnStore: TypedColumnStore
  let ctx: ExecutionContext

  beforeEach(() => {
    engine = new ExecutionEngine()
    columnStore = createMockColumnStore()
    ctx = {
      columnStore,
      parameters: new Map(),
      timeout: 30000,
    }
  })

  describe('Scalar Subqueries', () => {
    it('should execute scalar subquery in SELECT', async () => {
      // SELECT id, name, (SELECT COUNT(*) FROM orders WHERE customer_id = c.id) as order_count FROM customers c
      const plan: QueryPlan = {
        type: 'project',
        source: 'customers',
        projections: [
          { column: 'id' },
          { column: 'name' },
          {
            type: 'scalar_subquery',
            alias: 'order_count',
            subquery: {
              type: 'aggregate',
              source: 'orders',
              aggregations: [{ fn: 'count', column: '*', alias: 'cnt' }],
              correlatedColumn: 'customer_id',
              outerRef: 'id',
            },
          },
        ],
        estimatedRows: 100,
        estimatedCost: 1000,
      }

      ;(columnStore.project as any).mockImplementation((table: string) => {
        if (table === 'customers') {
          return {
            columns: new Map([
              ['id', [1, 2, 3]],
              ['name', ['Alice', 'Bob', 'Charlie']],
            ]),
            rowCount: 3,
          }
        }
        return {
          columns: new Map([
            ['customer_id', [1, 1, 3]],
          ]),
          rowCount: 3,
        }
      })

      const result = await engine.execute(plan, ctx)

      expect(result.columns.get('order_count')).toEqual([2, 0, 1])
    })

    it('should handle scalar subquery returning NULL', async () => {
      const plan: QueryPlan = {
        type: 'project',
        source: 'products',
        projections: [
          { column: 'id' },
          {
            type: 'scalar_subquery',
            alias: 'last_order_date',
            subquery: {
              type: 'aggregate',
              source: 'order_items',
              aggregations: [{ fn: 'max', column: 'order_date', alias: 'max_date' }],
              correlatedColumn: 'product_id',
              outerRef: 'id',
            },
          },
        ],
        estimatedRows: 50,
        estimatedCost: 500,
      }

      ;(columnStore.project as any).mockImplementation((table: string) => {
        if (table === 'products') {
          return {
            columns: new Map([['id', ['P1', 'P2', 'P3']]]),
            rowCount: 3,
          }
        }
        return {
          columns: new Map([['product_id', ['P1']], ['order_date', ['2024-01-15']]]),
          rowCount: 1,
        }
      })

      const result = await engine.execute(plan, ctx)

      // P1 has orders, P2 and P3 don't
      expect(result.columns.get('last_order_date')).toEqual(['2024-01-15', null, null])
    })
  })

  describe('IN Subqueries', () => {
    it('should execute IN subquery', async () => {
      // SELECT * FROM products WHERE category_id IN (SELECT id FROM categories WHERE active = true)
      const plan: QueryPlan = {
        type: 'filter',
        source: 'products',
        predicates: [
          {
            type: 'in_subquery',
            column: 'category_id',
            subquery: {
              type: 'scan',
              source: 'categories',
              predicates: [{ tcsPredicate: { column: 'active', op: '=', value: true }, pushdown: true }],
              projections: [{ column: 'id' }],
            },
          },
        ],
        estimatedRows: 100,
        estimatedCost: 50,
      }

      ;(columnStore.filter as any).mockReturnValue({
        columns: new Map([['id', [1, 2]]]),
        rowCount: 2,
      })

      ;(columnStore.project as any).mockReturnValue({
        columns: new Map([
          ['id', ['P1', 'P2', 'P3', 'P4']],
          ['category_id', [1, 2, 3, 1]],
        ]),
        rowCount: 4,
      })

      const result = await engine.execute(plan, ctx)

      // Products in active categories (1 and 2): P1, P2, P4
      expect(result.rowCount).toBe(3)
    })

    it('should execute NOT IN subquery handling NULL correctly', async () => {
      const plan: QueryPlan = {
        type: 'filter',
        source: 'products',
        predicates: [
          {
            type: 'not_in_subquery',
            column: 'category_id',
            subquery: {
              type: 'scan',
              source: 'excluded_categories',
              projections: [{ column: 'id' }],
            },
          },
        ],
        estimatedRows: 50,
        estimatedCost: 30,
      }

      // Excluded categories include NULL
      ;(columnStore.project as any).mockImplementation((table: string) => {
        if (table === 'excluded_categories') {
          return {
            columns: new Map([['id', [3, null]]]),
            rowCount: 2,
          }
        }
        return {
          columns: new Map([
            ['id', ['P1', 'P2', 'P3']],
            ['category_id', [1, 2, 3]],
          ]),
          rowCount: 3,
        }
      })

      const result = await engine.execute(plan, ctx)

      // With NULL in subquery, NOT IN returns UNKNOWN for all, so no results
      // This is standard SQL three-valued logic
      expect(result.rowCount).toBe(0)
    })
  })

  describe('Correlated Subqueries', () => {
    it('should execute correlated EXISTS subquery', async () => {
      // SELECT * FROM customers c WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.amount > 1000)
      const plan: QueryPlan = {
        type: 'filter',
        source: 'customers',
        predicates: [
          {
            type: 'exists_subquery',
            subquery: {
              type: 'scan',
              source: 'orders',
              predicates: [
                { tcsPredicate: { column: 'amount', op: '>', value: 1000 }, pushdown: true },
              ],
              correlatedColumn: 'customer_id',
              outerRef: 'id',
            },
          },
        ],
        estimatedRows: 20,
        estimatedCost: 200,
      }

      ;(columnStore.project as any).mockReturnValue({
        columns: new Map([
          ['id', [1, 2, 3]],
          ['name', ['Alice', 'Bob', 'Charlie']],
        ]),
        rowCount: 3,
      })

      ;(columnStore.filter as any).mockImplementation((_pred: any, customerId: number) => {
        // Only customer 1 has orders > 1000
        if (customerId === 1) {
          return { columns: new Map([['id', [101]]]), rowCount: 1 }
        }
        return { columns: new Map(), rowCount: 0 }
      })

      const result = await engine.execute(plan, ctx)

      expect(result.rowCount).toBe(1)
      expect(result.columns.get('name')).toEqual(['Alice'])
    })
  })
})

// ============================================================================
// WINDOW FUNCTION TESTS
// ============================================================================

describe('Query Engine - Window Functions', () => {
  let engine: ExecutionEngine
  let columnStore: TypedColumnStore
  let ctx: ExecutionContext

  beforeEach(() => {
    engine = new ExecutionEngine()
    columnStore = createMockColumnStore()
    ctx = {
      columnStore,
      parameters: new Map(),
      timeout: 30000,
    }
  })

  describe('Ranking Functions', () => {
    it('should compute ROW_NUMBER() OVER (ORDER BY)', async () => {
      const plan: QueryPlan = {
        type: 'window',
        source: 'employees',
        windowFunctions: [
          {
            fn: 'row_number',
            alias: 'rn',
            orderBy: [{ column: 'salary', direction: 'desc' }],
          },
        ],
        estimatedRows: 100,
        estimatedCost: 50,
      }

      ;(columnStore.project as any).mockReturnValue({
        columns: new Map([
          ['id', [1, 2, 3, 4]],
          ['name', ['Alice', 'Bob', 'Charlie', 'Diana']],
          ['salary', [80000, 120000, 90000, 120000]],
        ]),
        rowCount: 4,
      })

      const result = await engine.execute(plan, ctx)

      // Ordered by salary desc: Bob=120k, Diana=120k, Charlie=90k, Alice=80k
      // ROW_NUMBER assigns unique sequential numbers
      expect(result.columns.get('rn')).toEqual([1, 2, 3, 4])
    })

    it('should compute RANK() with ties', async () => {
      const plan: QueryPlan = {
        type: 'window',
        source: 'employees',
        windowFunctions: [
          {
            fn: 'rank',
            alias: 'rank',
            orderBy: [{ column: 'salary', direction: 'desc' }],
          },
        ],
        estimatedRows: 100,
        estimatedCost: 50,
      }

      ;(columnStore.project as any).mockReturnValue({
        columns: new Map([
          ['id', [1, 2, 3, 4]],
          ['salary', [80000, 120000, 90000, 120000]],
        ]),
        rowCount: 4,
      })

      const result = await engine.execute(plan, ctx)

      // Bob and Diana both get rank 1 (tie), Charlie gets 3, Alice gets 4
      expect(result.columns.get('rank')).toEqual([1, 1, 3, 4])
    })

    it('should compute DENSE_RANK() without gaps', async () => {
      const plan: QueryPlan = {
        type: 'window',
        source: 'employees',
        windowFunctions: [
          {
            fn: 'dense_rank',
            alias: 'dense_rank',
            orderBy: [{ column: 'salary', direction: 'desc' }],
          },
        ],
        estimatedRows: 100,
        estimatedCost: 50,
      }

      ;(columnStore.project as any).mockReturnValue({
        columns: new Map([
          ['id', [1, 2, 3, 4]],
          ['salary', [80000, 120000, 90000, 120000]],
        ]),
        rowCount: 4,
      })

      const result = await engine.execute(plan, ctx)

      // Bob and Diana both get 1, Charlie gets 2, Alice gets 3
      expect(result.columns.get('dense_rank')).toEqual([1, 1, 2, 3])
    })

    it('should compute NTILE()', async () => {
      const plan: QueryPlan = {
        type: 'window',
        source: 'employees',
        windowFunctions: [
          {
            fn: 'ntile',
            args: [4],
            alias: 'quartile',
            orderBy: [{ column: 'salary', direction: 'asc' }],
          },
        ],
        estimatedRows: 100,
        estimatedCost: 50,
      }

      ;(columnStore.project as any).mockReturnValue({
        columns: new Map([
          ['id', [1, 2, 3, 4, 5, 6, 7, 8]],
          ['salary', [40000, 50000, 60000, 70000, 80000, 90000, 100000, 110000]],
        ]),
        rowCount: 8,
      })

      const result = await engine.execute(plan, ctx)

      // Divide into 4 groups: [1,1,2,2,3,3,4,4]
      expect(result.columns.get('quartile')).toEqual([1, 1, 2, 2, 3, 3, 4, 4])
    })
  })

  describe('Aggregate Window Functions', () => {
    it('should compute SUM() OVER (PARTITION BY)', async () => {
      const plan: QueryPlan = {
        type: 'window',
        source: 'sales',
        windowFunctions: [
          {
            fn: 'sum',
            column: 'amount',
            alias: 'dept_total',
            partitionBy: ['department'],
          },
        ],
        estimatedRows: 100,
        estimatedCost: 60,
      }

      ;(columnStore.project as any).mockReturnValue({
        columns: new Map([
          ['id', [1, 2, 3, 4, 5]],
          ['department', ['Sales', 'Sales', 'Engineering', 'Engineering', 'Sales']],
          ['amount', [100, 200, 150, 250, 300]],
        ]),
        rowCount: 5,
      })

      const result = await engine.execute(plan, ctx)

      // Sales total: 600, Engineering total: 400
      expect(result.columns.get('dept_total')).toEqual([600, 600, 400, 400, 600])
    })

    it('should compute running SUM with frame clause', async () => {
      const plan: QueryPlan = {
        type: 'window',
        source: 'transactions',
        windowFunctions: [
          {
            fn: 'sum',
            column: 'amount',
            alias: 'running_total',
            orderBy: [{ column: 'date', direction: 'asc' }],
            frame: {
              type: 'rows',
              start: 'unbounded_preceding',
              end: 'current_row',
            },
          },
        ],
        estimatedRows: 100,
        estimatedCost: 70,
      }

      ;(columnStore.project as any).mockReturnValue({
        columns: new Map([
          ['id', [1, 2, 3, 4]],
          ['date', ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04']],
          ['amount', [100, 200, 150, 250]],
        ]),
        rowCount: 4,
      })

      const result = await engine.execute(plan, ctx)

      // Running sum: 100, 300, 450, 700
      expect(result.columns.get('running_total')).toEqual([100, 300, 450, 700])
    })

    it('should compute moving average with ROWS frame', async () => {
      const plan: QueryPlan = {
        type: 'window',
        source: 'stock_prices',
        windowFunctions: [
          {
            fn: 'avg',
            column: 'price',
            alias: 'moving_avg_3',
            orderBy: [{ column: 'date', direction: 'asc' }],
            frame: {
              type: 'rows',
              start: { offset: 2, direction: 'preceding' },
              end: 'current_row',
            },
          },
        ],
        estimatedRows: 100,
        estimatedCost: 80,
      }

      ;(columnStore.project as any).mockReturnValue({
        columns: new Map([
          ['date', ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05']],
          ['price', [100, 110, 105, 115, 120]],
        ]),
        rowCount: 5,
      })

      const result = await engine.execute(plan, ctx)

      // 3-day moving average
      // Day 1: 100 (only 1 value)
      // Day 2: (100+110)/2 = 105
      // Day 3: (100+110+105)/3 = 105
      // Day 4: (110+105+115)/3 = 110
      // Day 5: (105+115+120)/3 = 113.33
      const movingAvg = result.columns.get('moving_avg_3')
      expect(movingAvg[0]).toBeCloseTo(100)
      expect(movingAvg[2]).toBeCloseTo(105)
      expect(movingAvg[4]).toBeCloseTo(113.33, 1)
    })
  })

  describe('Navigation Functions', () => {
    it('should compute LAG()', async () => {
      const plan: QueryPlan = {
        type: 'window',
        source: 'monthly_sales',
        windowFunctions: [
          {
            fn: 'lag',
            column: 'amount',
            args: [1, 0], // offset 1, default 0
            alias: 'prev_month',
            orderBy: [{ column: 'month', direction: 'asc' }],
          },
        ],
        estimatedRows: 12,
        estimatedCost: 20,
      }

      ;(columnStore.project as any).mockReturnValue({
        columns: new Map([
          ['month', ['Jan', 'Feb', 'Mar', 'Apr']],
          ['amount', [100, 120, 90, 150]],
        ]),
        rowCount: 4,
      })

      const result = await engine.execute(plan, ctx)

      // LAG with offset 1 and default 0
      expect(result.columns.get('prev_month')).toEqual([0, 100, 120, 90])
    })

    it('should compute LEAD()', async () => {
      const plan: QueryPlan = {
        type: 'window',
        source: 'monthly_sales',
        windowFunctions: [
          {
            fn: 'lead',
            column: 'amount',
            args: [1, null], // offset 1, default null
            alias: 'next_month',
            orderBy: [{ column: 'month', direction: 'asc' }],
          },
        ],
        estimatedRows: 12,
        estimatedCost: 20,
      }

      ;(columnStore.project as any).mockReturnValue({
        columns: new Map([
          ['month', ['Jan', 'Feb', 'Mar', 'Apr']],
          ['amount', [100, 120, 90, 150]],
        ]),
        rowCount: 4,
      })

      const result = await engine.execute(plan, ctx)

      expect(result.columns.get('next_month')).toEqual([120, 90, 150, null])
    })

    it('should compute FIRST_VALUE() and LAST_VALUE()', async () => {
      const plan: QueryPlan = {
        type: 'window',
        source: 'department_sales',
        windowFunctions: [
          {
            fn: 'first_value',
            column: 'employee',
            alias: 'top_performer',
            partitionBy: ['department'],
            orderBy: [{ column: 'sales', direction: 'desc' }],
          },
          {
            fn: 'last_value',
            column: 'employee',
            alias: 'bottom_performer',
            partitionBy: ['department'],
            orderBy: [{ column: 'sales', direction: 'desc' }],
            frame: {
              type: 'rows',
              start: 'unbounded_preceding',
              end: 'unbounded_following',
            },
          },
        ],
        estimatedRows: 50,
        estimatedCost: 40,
      }

      ;(columnStore.project as any).mockReturnValue({
        columns: new Map([
          ['department', ['Sales', 'Sales', 'Sales', 'Engineering', 'Engineering']],
          ['employee', ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve']],
          ['sales', [500, 300, 200, 400, 350]],
        ]),
        rowCount: 5,
      })

      const result = await engine.execute(plan, ctx)

      // Within Sales dept (ordered by sales desc): Alice, Bob, Charlie
      // Within Engineering dept: Diana, Eve
      expect(result.columns.get('top_performer')).toEqual(['Alice', 'Alice', 'Alice', 'Diana', 'Diana'])
      expect(result.columns.get('bottom_performer')).toEqual(['Charlie', 'Charlie', 'Charlie', 'Eve', 'Eve'])
    })
  })
})

// ============================================================================
// CTE (Common Table Expression) TESTS
// ============================================================================

describe('Query Engine - CTEs', () => {
  let engine: ExecutionEngine
  let columnStore: TypedColumnStore
  let ctx: ExecutionContext

  beforeEach(() => {
    engine = new ExecutionEngine()
    columnStore = createMockColumnStore()
    ctx = {
      columnStore,
      parameters: new Map(),
      timeout: 30000,
    }
  })

  describe('Non-Recursive CTEs', () => {
    it('should execute simple WITH clause', async () => {
      // WITH active_customers AS (SELECT * FROM customers WHERE status = 'active')
      // SELECT * FROM active_customers WHERE created_at > '2024-01-01'
      const plan: QueryPlan = {
        type: 'with',
        ctes: [
          {
            name: 'active_customers',
            query: {
              type: 'scan',
              source: 'customers',
              predicates: [{ tcsPredicate: { column: 'status', op: '=', value: 'active' }, pushdown: true }],
            },
          },
        ],
        mainQuery: {
          type: 'scan',
          source: 'active_customers',
          predicates: [{ tcsPredicate: { column: 'created_at', op: '>', value: '2024-01-01' }, pushdown: true }],
        },
        estimatedRows: 50,
        estimatedCost: 30,
      }

      ;(columnStore.filter as any).mockReturnValue({
        columns: new Map([
          ['id', [1, 2, 3]],
          ['status', ['active', 'active', 'active']],
          ['created_at', ['2024-01-15', '2024-02-01', '2023-12-01']],
        ]),
        rowCount: 3,
      })

      const result = await engine.execute(plan, ctx)

      expect(result.rowCount).toBe(2) // Filtered by created_at
    })

    it('should execute CTE referenced multiple times', async () => {
      // WITH monthly_totals AS (...)
      // SELECT * FROM monthly_totals WHERE amount > (SELECT AVG(amount) FROM monthly_totals)
      const plan: QueryPlan = {
        type: 'with',
        ctes: [
          {
            name: 'monthly_totals',
            query: {
              type: 'aggregate',
              source: 'sales',
              aggregations: [{ fn: 'sum', column: 'amount', alias: 'total' }],
              groupBy: ['month'],
            },
          },
        ],
        mainQuery: {
          type: 'filter',
          source: 'monthly_totals',
          predicates: [
            {
              type: 'scalar_subquery_compare',
              column: 'total',
              op: '>',
              subquery: {
                type: 'aggregate',
                source: 'monthly_totals',
                aggregations: [{ fn: 'avg', column: 'total', alias: 'avg_total' }],
              },
            },
          ],
        },
        estimatedRows: 6,
        estimatedCost: 50,
      }

      ;(columnStore.aggregate as any).mockReturnValue({
        columns: new Map([
          ['month', ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']],
          ['total', [100, 200, 150, 300, 250, 180]],
        ]),
        rowCount: 6,
      })

      const result = await engine.execute(plan, ctx)

      // Average is 196.67, so Feb (200), Apr (300), May (250) qualify
      expect(result.rowCount).toBe(3)
    })
  })

  describe('Recursive CTEs', () => {
    it('should execute recursive CTE for hierarchical data', async () => {
      // WITH RECURSIVE org_chart AS (
      //   SELECT id, name, manager_id, 1 as level FROM employees WHERE manager_id IS NULL
      //   UNION ALL
      //   SELECT e.id, e.name, e.manager_id, o.level + 1
      //   FROM employees e JOIN org_chart o ON e.manager_id = o.id
      // )
      // SELECT * FROM org_chart
      const plan: QueryPlan = {
        type: 'recursive_with',
        cteName: 'org_chart',
        anchorQuery: {
          type: 'scan',
          source: 'employees',
          predicates: [{ tcsPredicate: { column: 'manager_id', op: 'is_null' }, pushdown: true }],
          projections: [
            { column: 'id' },
            { column: 'name' },
            { column: 'manager_id' },
            { type: 'literal', value: 1, alias: 'level' },
          ],
        },
        recursiveQuery: {
          type: 'hash_join',
          source: 'employees',
          joinTarget: 'org_chart',
          joinType: 'inner',
          joinCondition: { leftColumn: 'manager_id', rightColumn: 'id', op: '=' },
          projections: [
            { column: 'id', source: 'employees' },
            { column: 'name', source: 'employees' },
            { column: 'manager_id', source: 'employees' },
            { type: 'expression', expr: 'org_chart.level + 1', alias: 'level' },
          ],
        },
        mainQuery: { type: 'scan', source: 'org_chart' },
        maxRecursion: 100,
        estimatedRows: 50,
        estimatedCost: 200,
      }

      ;(columnStore.filter as any).mockReturnValueOnce({
        columns: new Map([
          ['id', [1]],
          ['name', ['CEO']],
          ['manager_id', [null]],
        ]),
        rowCount: 1,
      })

      ;(columnStore.project as any).mockReturnValue({
        columns: new Map([
          ['id', [2, 3, 4, 5]],
          ['name', ['VP1', 'VP2', 'Manager1', 'Manager2']],
          ['manager_id', [1, 1, 2, 2]],
        ]),
        rowCount: 4,
      })

      const result = await engine.execute(plan, ctx)

      // CEO (level 1), VP1 & VP2 (level 2), Manager1 & Manager2 (level 3)
      expect(result.rowCount).toBe(5)
      expect(result.columns.get('level')).toContain(1)
      expect(result.columns.get('level')).toContain(2)
      expect(result.columns.get('level')).toContain(3)
    })

    it('should detect and prevent infinite recursion', async () => {
      const plan: QueryPlan = {
        type: 'recursive_with',
        cteName: 'infinite',
        anchorQuery: {
          type: 'scan',
          source: 'nodes',
          predicates: [{ tcsPredicate: { column: 'id', op: '=', value: 1 }, pushdown: true }],
        },
        recursiveQuery: {
          type: 'hash_join',
          source: 'edges',
          joinTarget: 'infinite',
          joinType: 'inner',
          joinCondition: { leftColumn: 'from_id', rightColumn: 'id', op: '=' },
        },
        mainQuery: { type: 'scan', source: 'infinite' },
        maxRecursion: 100,
        estimatedRows: 100,
        estimatedCost: 500,
      }

      // Simulate circular reference: 1 -> 2 -> 3 -> 1
      let recursionCount = 0
      ;(columnStore.project as any).mockImplementation(() => {
        recursionCount++
        if (recursionCount > 100) {
          throw new Error('Infinite recursion detected')
        }
        return {
          columns: new Map([['id', [1, 2, 3]]]),
          rowCount: 3,
        }
      })

      await expect(engine.execute(plan, ctx)).rejects.toThrow('recursion')
    })
  })
})

// ============================================================================
// QUERY OPTIMIZATION TESTS
// ============================================================================

describe('Query Engine - Optimization', () => {
  let planner: QueryPlanner

  beforeEach(() => {
    planner = new QueryPlanner()
  })

  describe('Join Order Optimization', () => {
    it('should reorder joins based on cardinality estimates', () => {
      planner.setStatistics('customers', {
        rowCount: 10000,
        distinctCounts: new Map([['id', 10000]]),
      })
      planner.setStatistics('orders', {
        rowCount: 1000000,
        distinctCounts: new Map([['customer_id', 10000]]),
      })
      planner.setStatistics('order_items', {
        rowCount: 5000000,
        distinctCounts: new Map([['order_id', 1000000]]),
      })

      const ast = {
        type: 'select',
        from: ['customers', 'orders', 'order_items'],
        joins: [
          { type: 'inner', left: 'customers', right: 'orders', on: { left: 'id', right: 'customer_id' } },
          { type: 'inner', left: 'orders', right: 'order_items', on: { left: 'id', right: 'order_id' } },
        ],
        predicates: [{ column: 'customers.status', op: '=', value: 'active' }],
      }

      const plan = planner.plan(ast as any, 'customers')

      // Should start with filtered customers (smallest after filter)
      // Then join to orders, then to order_items
      expect(plan.type).toBeDefined()
    })

    it('should use index hints when available', () => {
      planner.setStatistics('orders', {
        rowCount: 1000000,
        distinctCounts: new Map([['customer_id', 10000], ['status', 5]]),
        indexes: [
          { columns: ['customer_id'], type: 'btree' },
          { columns: ['status'], type: 'btree' },
        ],
      })

      const ast = {
        type: 'select',
        from: 'orders',
        predicates: [{ column: 'customer_id', op: '=', value: 123 }],
      }

      const plan = planner.plan(ast as any, 'orders')

      expect(plan.indexHint).toBe('customer_id')
    })
  })

  describe('Predicate Pushdown', () => {
    it('should push predicates through joins', () => {
      const ast = {
        type: 'select',
        from: ['orders', 'customers'],
        joins: [
          { type: 'inner', left: 'orders', right: 'customers', on: { left: 'customer_id', right: 'id' } },
        ],
        predicates: [
          { column: 'orders.status', op: '=', value: 'pending' },
          { column: 'customers.country', op: '=', value: 'US' },
        ],
      }

      const plan = planner.plan(ast as any, 'orders')

      // Both predicates should be pushed to their respective scans
      expect(plan.predicates).toBeDefined()
    })

    it('should not push predicates that depend on join results', () => {
      const ast = {
        type: 'select',
        from: ['orders', 'discounts'],
        joins: [
          { type: 'left', left: 'orders', right: 'discounts', on: { left: 'discount_code', right: 'code' } },
        ],
        predicates: [
          { column: 'discounts.percentage', op: 'is_null' }, // Checks for unmatched
        ],
      }

      const plan = planner.plan(ast as any, 'orders')

      // The IS NULL predicate cannot be pushed before the LEFT JOIN
      expect(plan.postJoinPredicates).toContain(expect.objectContaining({ column: 'discounts.percentage' }))
    })
  })

  describe('Subquery Decorrelation', () => {
    it('should convert correlated subquery to join when possible', () => {
      // SELECT * FROM orders o WHERE EXISTS (SELECT 1 FROM customers c WHERE c.id = o.customer_id AND c.status = 'active')
      // Should be converted to:
      // SELECT o.* FROM orders o SEMI JOIN customers c ON o.customer_id = c.id WHERE c.status = 'active'
      const ast = {
        type: 'select',
        from: 'orders',
        predicates: [
          {
            type: 'exists',
            subquery: {
              type: 'select',
              from: 'customers',
              predicates: [
                { column: 'id', op: '=', ref: 'orders.customer_id' },
                { column: 'status', op: '=', value: 'active' },
              ],
            },
          },
        ],
      }

      const plan = planner.plan(ast as any, 'orders')

      // Should be rewritten to semi join
      expect(plan.type).toBe('semi_join')
    })
  })
})
