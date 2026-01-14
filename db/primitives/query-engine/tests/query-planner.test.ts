/**
 * RED Phase: Cost-Based Query Planner Tests
 *
 * Tests for the cost-based query planner that generates
 * optimal execution plans based on statistics and indexes.
 *
 * @see dotdo-59pr7
 */

import { describe, it, expect, beforeEach } from 'vitest'

// Import implementation and types
import {
  QueryPlanner,
  type QueryPlan,
  type TableStatistics,
  type IndexInfo,
  type CostModel,
  type PlanNode,
} from '../planner/query-planner'
import type { PredicateNode, LogicalNode, QueryNode, GroupByNode, JoinNode } from '../ast'
import type { CompiledPredicate } from '../compiler/predicate-compiler'

describe('QueryPlanner', () => {
  let planner: QueryPlanner

  beforeEach(() => {
    // GREEN phase: instantiate the actual planner
    planner = new QueryPlanner()
  })

  describe('statistics collection', () => {
    it('should track row count per partition', () => {
      const stats = planner.getTableStatistics('users')

      expect(stats.rowCount).toBeGreaterThan(0)
    })

    it('should track min/max per column', () => {
      const stats = planner.getTableStatistics('orders')

      expect(stats.minMax.get('price')).toBeDefined()
      expect(stats.minMax.get('price')!.min).toBeDefined()
      expect(stats.minMax.get('price')!.max).toBeDefined()
    })

    it('should track distinct count (HyperLogLog)', () => {
      const stats = planner.getTableStatistics('users')

      expect(stats.distinctCounts.get('email')).toBeDefined()
      // HyperLogLog provides approximate count
      expect(stats.distinctCounts.get('email')).toBeGreaterThan(0)
    })

    it('should track null count', () => {
      const stats = planner.getTableStatistics('users')

      expect(stats.nullCounts.get('deletedAt')).toBeDefined()
    })

    it('should estimate selectivity for predicates', () => {
      const predicate: PredicateNode = {
        type: 'predicate',
        column: 'status',
        op: '=',
        value: 'active',
      }

      const selectivity = planner.estimateSelectivity(predicate, 'users')

      expect(selectivity).toBeGreaterThan(0)
      expect(selectivity).toBeLessThanOrEqual(1)
    })

    it('should estimate selectivity for range predicates using histograms', () => {
      const predicate: PredicateNode = {
        type: 'predicate',
        column: 'age',
        op: '>',
        value: 50,
      }

      const selectivity = planner.estimateSelectivity(predicate, 'users')

      // With uniform distribution 0-100, >50 should be ~0.5
      expect(selectivity).toBeCloseTo(0.5, 1)
    })

    it('should estimate selectivity for IN predicates', () => {
      const predicate: PredicateNode = {
        type: 'predicate',
        column: 'category',
        op: 'IN',
        value: ['A', 'B', 'C'],
      }

      const selectivity = planner.estimateSelectivity(predicate, 'products')

      expect(selectivity).toBeGreaterThan(0)
    })

    it('should combine selectivity for AND predicates', () => {
      const ast: LogicalNode = {
        type: 'logical',
        op: 'AND',
        children: [
          { type: 'predicate', column: 'age', op: '>', value: 30 },
          { type: 'predicate', column: 'status', op: '=', value: 'active' },
        ],
      }

      const selectivity = planner.estimateSelectivity(ast, 'users')

      // Combined selectivity should be product of individual (assuming independence)
      expect(selectivity).toBeGreaterThan(0)
    })

    it('should combine selectivity for OR predicates', () => {
      const ast: LogicalNode = {
        type: 'logical',
        op: 'OR',
        children: [
          { type: 'predicate', column: 'role', op: '=', value: 'admin' },
          { type: 'predicate', column: 'role', op: '=', value: 'moderator' },
        ],
      }

      const selectivity = planner.estimateSelectivity(ast, 'users')

      // Combined selectivity should be sum minus overlap
      expect(selectivity).toBeGreaterThan(0)
    })
  })

  describe('index selection', () => {
    beforeEach(() => {
      // Register available indexes
      planner.registerIndex('users', {
        name: 'idx_email_bloom',
        type: 'bloom',
        columns: ['email'],
      })
      planner.registerIndex('users', {
        name: 'idx_created_minmax',
        type: 'minmax',
        columns: ['createdAt'],
      })
      planner.registerIndex('products', {
        name: 'idx_description_fts',
        type: 'fts',
        columns: ['description'],
      })
      planner.registerIndex('products', {
        name: 'idx_embedding_vector',
        type: 'vector',
        columns: ['embedding'],
      })
    })

    it('should select bloom filter for equality on high-cardinality column', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'email',
        op: '=',
        value: 'alice@example.com',
      }

      const plan = planner.plan(ast, 'users')

      expect(plan.indexHint?.type).toBe('bloom')
    })

    it('should select min/max index for range predicates', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'createdAt',
        op: '>=',
        value: Date.now() - 86400000,
      }

      const plan = planner.plan(ast, 'users')

      expect(plan.indexHint?.type).toBe('minmax')
    })

    it('should select full-text index for text search', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'description',
        op: 'CONTAINS',
        value: 'wireless headphones',
      }

      const plan = planner.plan(ast, 'products')

      expect(plan.indexHint?.type).toBe('fts')
    })

    it('should select vector index for similarity search', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'embedding',
        op: 'NEAR',
        value: [0.1, 0.2, 0.3],
        k: 10,
      }

      const plan = planner.plan(ast, 'products')

      expect(plan.indexHint?.type).toBe('vector')
    })

    it('should skip index when selectivity is too low', () => {
      // Index on low-cardinality column (e.g., boolean)
      planner.registerIndex('users', {
        name: 'idx_active',
        type: 'btree',
        columns: ['active'],
        selectivity: 0.5, // 50% of rows match
      })

      const ast: PredicateNode = {
        type: 'predicate',
        column: 'active',
        op: '=',
        value: true,
      }

      const plan = planner.plan(ast, 'users')

      // Full scan may be cheaper than index when selectivity > 0.3
      expect(plan.type).toBe('scan')
    })

    it('should prefer most selective index when multiple available', () => {
      planner.registerIndex('orders', {
        name: 'idx_status',
        type: 'btree',
        columns: ['status'],
        selectivity: 0.2,
      })
      planner.registerIndex('orders', {
        name: 'idx_customer',
        type: 'btree',
        columns: ['customerId'],
        selectivity: 0.01,
      })

      const ast: LogicalNode = {
        type: 'logical',
        op: 'AND',
        children: [
          { type: 'predicate', column: 'status', op: '=', value: 'active' },
          { type: 'predicate', column: 'customerId', op: '=', value: 'cust-123' },
        ],
      }

      const plan = planner.plan(ast, 'orders')

      // Should use customer index (more selective)
      expect(plan.indexHint?.name).toBe('idx_customer')
    })
  })

  describe('predicate pushdown', () => {
    it('should push simple predicates to storage layer', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'age',
        op: '>',
        value: 21,
      }

      const plan = planner.plan(ast, 'users')

      expect(plan.predicates).toHaveLength(1)
      expect(plan.predicates[0].pushdown).toBe(true)
    })

    it('should push conjunctive (AND) predicates', () => {
      const ast: LogicalNode = {
        type: 'logical',
        op: 'AND',
        children: [
          { type: 'predicate', column: 'age', op: '>=', value: 18 },
          { type: 'predicate', column: 'status', op: '=', value: 'active' },
        ],
      }

      const plan = planner.plan(ast, 'users')

      expect(plan.predicates.every((p) => p.pushdown)).toBe(true)
    })

    it('should NOT push disjunctive (OR) predicates (requires separate scans)', () => {
      const ast: LogicalNode = {
        type: 'logical',
        op: 'OR',
        children: [
          { type: 'predicate', column: 'role', op: '=', value: 'admin' },
          { type: 'predicate', column: 'role', op: '=', value: 'moderator' },
        ],
      }

      const plan = planner.plan(ast, 'users')

      // OR requires union of separate scans or full scan + filter
      expect(plan.type === 'scan' || plan.type === 'union').toBe(true)
    })

    it('should push predicates through projections', () => {
      const ast: QueryNode = {
        type: 'query',
        from: 'users',
        where: { type: 'predicate', column: 'age', op: '>', value: 21 },
        projection: { type: 'projection', columns: [{ source: 'name', include: true }] },
      } as unknown as QueryNode

      const plan = planner.plan(ast, 'users')

      // Filter should be applied before projection
      expect(plan.children?.[0]?.type === 'filter').toBe(true)
    })

    it('should push predicates through joins when applicable', () => {
      const ast: QueryNode = {
        type: 'query',
        from: 'orders',
        join: {
          type: 'join',
          joinType: 'INNER',
          left: 'orders',
          right: 'customers',
          on: { type: 'predicate', column: 'orders.customerId', op: '=', value: { $ref: 'customers.id' } },
        },
        where: {
          type: 'logical',
          op: 'AND',
          children: [
            { type: 'predicate', column: 'orders.status', op: '=', value: 'active' },
            { type: 'predicate', column: 'customers.region', op: '=', value: 'US' },
          ],
        },
      } as unknown as QueryNode

      const plan = planner.plan(ast, 'orders')

      // Predicates should be pushed to respective tables before join
      expect(plan).toBeDefined()
    })

    it('should not push non-deterministic expressions', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'random_value',
        op: '<',
        value: { $function: 'random' },
      } as unknown as PredicateNode

      const plan = planner.plan(ast, 'users')

      // Random must be evaluated at execution, not pushed
      expect(plan.predicates[0].pushdown).toBe(false)
    })
  })

  describe('join ordering', () => {
    beforeEach(() => {
      planner.updateStatistics('orders', { rowCount: 100000 })
      planner.updateStatistics('customers', { rowCount: 10000 })
      planner.updateStatistics('products', { rowCount: 1000 })
    })

    it('should estimate join cardinality', () => {
      const join: JoinNode = {
        type: 'join',
        joinType: 'INNER',
        left: 'orders',
        right: 'customers',
        on: { type: 'predicate', column: 'orders.customerId', op: '=', value: { $ref: 'customers.id' } },
      }

      const cardinality = planner.estimateJoinCardinality(join)

      expect(cardinality).toBeGreaterThan(0)
    })

    it('should prefer smaller table on build side of hash join', () => {
      const join: JoinNode = {
        type: 'join',
        joinType: 'INNER',
        left: 'orders',    // 100k rows
        right: 'products', // 1k rows
        on: { type: 'predicate', column: 'orders.productId', op: '=', value: { $ref: 'products.id' } },
      }

      const plan = planner.planJoin(join)

      // Products should be on build side (smaller)
      expect(plan.type).toBe('hash_join')
      expect(plan.buildSide).toBe('products')
    })

    it('should use index nested loop when index available', () => {
      planner.registerIndex('customers', {
        name: 'idx_customer_id',
        type: 'btree',
        columns: ['id'],
      })

      const join: JoinNode = {
        type: 'join',
        joinType: 'INNER',
        left: 'orders',
        right: 'customers',
        on: { type: 'predicate', column: 'orders.customerId', op: '=', value: { $ref: 'customers.id' } },
      }

      const plan = planner.planJoin(join)

      expect(plan.type).toBe('nested_loop') // Index nested loop
      expect(plan.indexHint?.name).toBe('idx_customer_id')
    })

    it('should consider sort-merge for pre-sorted inputs', () => {
      // Both tables ordered by join key
      planner.updateStatistics('orders', { rowCount: 100000, sortedBy: 'customerId' })
      planner.updateStatistics('customers', { rowCount: 10000, sortedBy: 'id' })

      const join: JoinNode = {
        type: 'join',
        joinType: 'INNER',
        left: 'orders',
        right: 'customers',
        on: { type: 'predicate', column: 'orders.customerId', op: '=', value: { $ref: 'customers.id' } },
      }

      const plan = planner.planJoin(join)

      expect(plan.type).toBe('sort_merge')
    })

    it('should optimize multi-way join order', () => {
      // Join orders, customers, products
      const query: QueryNode = {
        type: 'query',
        from: 'orders',
        joins: [
          {
            type: 'join',
            joinType: 'INNER',
            left: 'orders',
            right: 'customers',
            on: { type: 'predicate', column: 'orders.customerId', op: '=', value: { $ref: 'customers.id' } },
          },
          {
            type: 'join',
            joinType: 'INNER',
            left: 'orders',
            right: 'products',
            on: { type: 'predicate', column: 'orders.productId', op: '=', value: { $ref: 'products.id' } },
          },
        ],
      } as unknown as QueryNode

      const plan = planner.plan(query, 'orders')

      // Should join smallest tables first
      expect(plan).toBeDefined()
    })
  })

  describe('plan comparison', () => {
    it('should generate multiple candidate plans', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'email',
        op: '=',
        value: 'alice@example.com',
      }

      const candidates = planner.generateCandidatePlans(ast, 'users')

      // Should have at least full scan and index scan options
      expect(candidates.length).toBeGreaterThanOrEqual(2)
    })

    it('should estimate cost for each plan', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'age',
        op: '>',
        value: 21,
      }

      const candidates = planner.generateCandidatePlans(ast, 'users')

      for (const plan of candidates) {
        expect(plan.estimatedCost).toBeDefined()
        expect(plan.estimatedCost).toBeGreaterThan(0)
      }
    })

    it('should select plan with lowest estimated cost', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'email',
        op: '=',
        value: 'alice@example.com',
      }

      const plan = planner.plan(ast, 'users')

      const candidates = planner.generateCandidatePlans(ast, 'users')
      const minCost = Math.min(...candidates.map((c) => c.estimatedCost))

      expect(plan.estimatedCost).toBe(minCost)
    })

    it('should explain plan with cost breakdown', () => {
      const ast: LogicalNode = {
        type: 'logical',
        op: 'AND',
        children: [
          { type: 'predicate', column: 'age', op: '>=', value: 18 },
          { type: 'predicate', column: 'status', op: '=', value: 'active' },
        ],
      }

      const plan = planner.plan(ast, 'users')
      const explanation = planner.explain(plan)

      expect(explanation).toContain('cost')
      expect(explanation).toContain('rows')
    })

    it('should include cost model parameters in explanation', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'id',
        op: '=',
        value: 123,
      }

      const plan = planner.plan(ast, 'users')
      const explanation = planner.explain(plan, { verbose: true })

      expect(explanation).toContain('scan_cost')
      expect(explanation).toContain('index_cost')
    })
  })

  describe('caching', () => {
    it('should cache compiled plans by query hash', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'age',
        op: '>',
        value: 21,
      }

      const plan1 = planner.plan(ast, 'users')
      const plan2 = planner.plan(ast, 'users')

      // Same object reference (cached)
      expect(plan1).toBe(plan2)
    })

    it('should cache plans with different parameter values', () => {
      const ast1: PredicateNode = {
        type: 'predicate',
        column: 'age',
        op: '>',
        value: 21,
      }
      const ast2: PredicateNode = {
        type: 'predicate',
        column: 'age',
        op: '>',
        value: 30,
      }

      const plan1 = planner.plan(ast1, 'users')
      const plan2 = planner.plan(ast2, 'users')

      // Same plan structure, different parameter
      expect(plan1.type).toBe(plan2.type)
    })

    it('should invalidate cache when schema changes', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'age',
        op: '>',
        value: 21,
      }

      const plan1 = planner.plan(ast, 'users')

      // Add a new index
      planner.registerIndex('users', {
        name: 'idx_age',
        type: 'btree',
        columns: ['age'],
      })

      const plan2 = planner.plan(ast, 'users')

      // Plan should be re-evaluated (different object)
      expect(plan1).not.toBe(plan2)
    })

    it('should use cached statistics', () => {
      // First call computes statistics
      const stats1 = planner.getTableStatistics('users')

      // Second call uses cache
      const start = performance.now()
      const stats2 = planner.getTableStatistics('users')
      const elapsed = performance.now() - start

      expect(stats1).toBe(stats2)
      expect(elapsed).toBeLessThan(1) // Cache hit is fast
    })

    it('should invalidate statistics cache after data changes', () => {
      const stats1 = planner.getTableStatistics('users')

      planner.invalidateStatistics('users')

      const stats2 = planner.getTableStatistics('users')

      expect(stats1).not.toBe(stats2)
    })
  })

  describe('cost model', () => {
    it('should calculate scan cost based on row count', () => {
      const plan: QueryPlan = {
        type: 'scan',
        source: 'users',
        predicates: [],
        estimatedRows: 10000,
        estimatedCost: 0,
      }

      const cost = planner.calculateCost(plan)

      // Cost = rows * SCAN_COST
      expect(cost).toBeGreaterThan(0)
    })

    it('should calculate index cost', () => {
      const plan: QueryPlan = {
        type: 'index_scan',
        source: 'users',
        predicates: [],
        indexHint: { name: 'idx_email', type: 'btree', columns: ['email'] },
        estimatedRows: 1,
        estimatedCost: 0,
      }

      const cost = planner.calculateCost(plan)

      // Index scan should be cheaper than full scan
      const fullScanCost = planner.calculateCost({ ...plan, type: 'scan', estimatedRows: 10000 })
      expect(cost).toBeLessThan(fullScanCost)
    })

    it('should calculate partition cost', () => {
      const plan: QueryPlan = {
        type: 'scan',
        source: 'orders',
        predicates: [],
        estimatedRows: 1000,
        partitions: ['2024-01', '2024-02'],
        estimatedCost: 0,
      }

      const cost = planner.calculateCost(plan)

      // Each partition adds overhead
      expect(cost).toBeGreaterThan(0)
    })

    it('should calculate network cost for distributed queries', () => {
      const plan: QueryPlan = {
        type: 'scan',
        source: 'global_users',
        predicates: [],
        estimatedRows: 100,
        networkHops: 3,
        estimatedCost: 0,
      }

      const cost = planner.calculateCost(plan)

      // Network cost dominates for distributed queries
      expect(cost).toBeGreaterThan(100 * planner.costModel.SCAN_COST)
    })

    it('should allow cost model customization', () => {
      const customCostModel: CostModel = {
        SCAN_COST: 2,
        INDEX_COST: 0.5,
        PARTITION_COST: 20,
        NETWORK_COST: 200,
      }

      planner.setCostModel(customCostModel)

      expect(planner.costModel.SCAN_COST).toBe(2)
    })
  })

  describe('aggregation planning', () => {
    it('should plan count-only queries to use statistics', () => {
      const ast: QueryNode = {
        type: 'query',
        from: 'users',
        groupBy: { type: 'groupBy', columns: [], aggregations: [{ alias: 'count', aggregation: { type: 'aggregation', function: 'count' } }] },
      } as unknown as QueryNode

      const plan = planner.plan(ast, 'users')

      // Should use statistics, not scan
      expect(plan.type).toBe('stats_lookup')
    })

    it('should plan grouped aggregation efficiently', () => {
      const ast: QueryNode = {
        type: 'query',
        from: 'orders',
        groupBy: {
          type: 'groupBy',
          columns: ['customerId'],
          aggregations: [
            { alias: 'total', aggregation: { type: 'aggregation', function: 'sum', column: 'amount' } },
          ],
        },
      } as unknown as QueryNode

      const plan = planner.plan(ast, 'orders')

      // Should use hash aggregate
      expect(plan.type).toBe('hash_aggregate')
    })

    it('should use sort-based aggregation when input is sorted', () => {
      planner.updateStatistics('orders', { rowCount: 100000, sortedBy: 'customerId' })

      const ast: QueryNode = {
        type: 'query',
        from: 'orders',
        groupBy: {
          type: 'groupBy',
          columns: ['customerId'],
          aggregations: [{ alias: 'count', aggregation: { type: 'aggregation', function: 'count' } }],
        },
      } as unknown as QueryNode

      const plan = planner.plan(ast, 'orders')

      // Sorted input enables stream aggregation
      expect(plan.type).toBe('stream_aggregate')
    })
  })

  describe('performance', () => {
    it('should plan simple queries under 1ms', () => {
      const ast: PredicateNode = {
        type: 'predicate',
        column: 'id',
        op: '=',
        value: 123,
      }

      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        planner.plan(ast, 'users')
      }
      const elapsed = performance.now() - start

      expect(elapsed / 1000).toBeLessThan(1) // Average under 1ms
    })

    it('should handle complex queries with many predicates', () => {
      const children: PredicateNode[] = []
      for (let i = 0; i < 100; i++) {
        children.push({
          type: 'predicate',
          column: `col${i}`,
          op: '=',
          value: i,
        })
      }

      const ast: LogicalNode = {
        type: 'logical',
        op: 'AND',
        children,
      }

      const start = performance.now()
      const plan = planner.plan(ast, 'wide_table')
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(100) // Under 100ms
      expect(plan).toBeDefined()
    })
  })
})
