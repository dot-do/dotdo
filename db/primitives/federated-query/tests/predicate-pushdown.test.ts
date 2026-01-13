/**
 * Predicate Pushdown Tests
 *
 * TDD tests for predicate pushdown optimization rules that:
 * - Push filters down to source systems
 * - Determine which predicates each source can handle
 * - Minimize data transfer across sources
 * - Handle source-specific predicate translations
 *
 * @see dotdo-43oni
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  PredicateAnalyzer,
  ConjunctionSplitter,
  PredicatePushdownOptimizer,
  PredicateRewriter,
  type SourceProfile,
  type PushdownRule,
  type PredicateTranslation,
} from '../predicate-pushdown'
import type { QueryPredicate, TableRef, PushdownCapabilities } from '../index'

// =============================================================================
// Test Fixtures
// =============================================================================

const createFullCapabilities = (): PushdownCapabilities => ({
  predicatePushdown: true,
  projectionPushdown: true,
  limitPushdown: true,
  aggregationPushdown: true,
  joinPushdown: true,
})

const createLimitedCapabilities = (): PushdownCapabilities => ({
  predicatePushdown: true,
  projectionPushdown: false,
  limitPushdown: true,
  aggregationPushdown: false,
  joinPushdown: false,
  supportedOperators: ['=', '!=', '>', '<', '>=', '<='],
})

const createNoFilterCapabilities = (): PushdownCapabilities => ({
  predicatePushdown: false,
  projectionPushdown: false,
  limitPushdown: false,
  aggregationPushdown: false,
  joinPushdown: false,
})

// =============================================================================
// PredicateAnalyzer Tests
// =============================================================================

describe('PredicateAnalyzer', () => {
  let analyzer: PredicateAnalyzer

  beforeEach(() => {
    analyzer = new PredicateAnalyzer()
  })

  describe('simple predicate pushdown', () => {
    it('should push equality predicates to source that supports filtering', () => {
      const predicates: QueryPredicate[] = [
        { column: 'users.status', op: '=', value: 'active' },
      ]

      const sources: SourceProfile[] = [
        {
          name: 'users_db',
          type: 'postgres',
          capabilities: createFullCapabilities(),
          tables: ['users'],
        },
      ]

      const tables: TableRef[] = [{ source: 'users_db', table: 'users' }]

      const result = analyzer.analyze(predicates, sources, tables)

      expect(result.pushable.get('users_db')).toHaveLength(1)
      expect(result.residual).toHaveLength(0)
    })

    it('should push inequality predicates', () => {
      const predicates: QueryPredicate[] = [
        { column: 'orders.total', op: '>', value: 100 },
        { column: 'orders.status', op: '!=', value: 'cancelled' },
      ]

      const sources: SourceProfile[] = [
        {
          name: 'orders_db',
          type: 'postgres',
          capabilities: createFullCapabilities(),
          tables: ['orders'],
        },
      ]

      const tables: TableRef[] = [{ source: 'orders_db', table: 'orders' }]

      const result = analyzer.analyze(predicates, sources, tables)

      expect(result.pushable.get('orders_db')).toHaveLength(2)
      expect(result.residual).toHaveLength(0)
    })

    it('should NOT push predicates to source without filter support', () => {
      const predicates: QueryPredicate[] = [
        { column: 'data.status', op: '=', value: 'active' },
      ]

      const sources: SourceProfile[] = [
        {
          name: 'api_source',
          type: 'rest',
          capabilities: createNoFilterCapabilities(),
          tables: ['data'],
        },
      ]

      const tables: TableRef[] = [{ source: 'api_source', table: 'data' }]

      const result = analyzer.analyze(predicates, sources, tables)

      expect(result.pushable.get('api_source')).toHaveLength(0)
      expect(result.residual).toHaveLength(1)
    })
  })

  describe('conjunction splitting across sources', () => {
    it('should split AND predicates to their respective sources', () => {
      const predicates: QueryPredicate[] = [
        { column: 'users.status', op: '=', value: 'active' },
        { column: 'orders.total', op: '>', value: 100 },
      ]

      const sources: SourceProfile[] = [
        {
          name: 'users_db',
          type: 'postgres',
          capabilities: createFullCapabilities(),
          tables: ['users'],
        },
        {
          name: 'orders_db',
          type: 'postgres',
          capabilities: createFullCapabilities(),
          tables: ['orders'],
        },
      ]

      const tables: TableRef[] = [
        { source: 'users_db', table: 'users' },
        { source: 'orders_db', table: 'orders' },
      ]

      const result = analyzer.analyze(predicates, sources, tables)

      expect(result.pushable.get('users_db')).toHaveLength(1)
      expect(result.pushable.get('orders_db')).toHaveLength(1)
      expect(result.stats.pushedPredicates).toBe(2)
    })

    it('should push multiple predicates for same source', () => {
      const predicates: QueryPredicate[] = [
        { column: 'users.status', op: '=', value: 'active' },
        { column: 'users.age', op: '>=', value: 18 },
        { column: 'users.country', op: '=', value: 'US' },
      ]

      const sources: SourceProfile[] = [
        {
          name: 'users_db',
          type: 'postgres',
          capabilities: createFullCapabilities(),
          tables: ['users'],
        },
      ]

      const tables: TableRef[] = [{ source: 'users_db', table: 'users' }]

      const result = analyzer.analyze(predicates, sources, tables)

      expect(result.pushable.get('users_db')).toHaveLength(3)
    })
  })

  describe('predicate type compatibility', () => {
    it('should respect source operator support', () => {
      const predicates: QueryPredicate[] = [
        { column: 'items.status', op: '=', value: 'active' },
        { column: 'items.name', op: 'LIKE', value: '%test%' },
        { column: 'items.id', op: 'IN', value: [1, 2, 3] },
      ]

      const sources: SourceProfile[] = [
        {
          name: 'items_db',
          type: 'rest',
          capabilities: createLimitedCapabilities(), // No LIKE, IN support
          tables: ['items'],
        },
      ]

      const tables: TableRef[] = [{ source: 'items_db', table: 'items' }]

      const result = analyzer.analyze(predicates, sources, tables)

      // Only equality is supported
      expect(result.pushable.get('items_db')).toHaveLength(1)
      expect(result.pushable.get('items_db')![0]!.op).toBe('=')
      expect(result.residual).toHaveLength(2)
    })

    it('should push IN predicates when supported', () => {
      const predicates: QueryPredicate[] = [
        { column: 'users.id', op: 'IN', value: [1, 2, 3, 4, 5] },
      ]

      const sources: SourceProfile[] = [
        {
          name: 'users_db',
          type: 'postgres',
          capabilities: createFullCapabilities(),
          tables: ['users'],
        },
      ]

      const tables: TableRef[] = [{ source: 'users_db', table: 'users' }]

      const result = analyzer.analyze(predicates, sources, tables)

      expect(result.pushable.get('users_db')).toHaveLength(1)
      expect(result.residual).toHaveLength(0)
    })

    it('should handle LIKE predicates', () => {
      const predicates: QueryPredicate[] = [
        { column: 'products.name', op: 'LIKE', value: '%widget%' },
      ]

      const sources: SourceProfile[] = [
        {
          name: 'products_db',
          type: 'postgres',
          capabilities: createFullCapabilities(),
          tables: ['products'],
        },
      ]

      const tables: TableRef[] = [{ source: 'products_db', table: 'products' }]

      const result = analyzer.analyze(predicates, sources, tables)

      expect(result.pushable.get('products_db')).toHaveLength(1)
    })
  })

  describe('cross-source predicate handling', () => {
    it('should identify cross-source join predicates', () => {
      const predicates: QueryPredicate[] = [
        { column: 'users.status', op: '=', value: 'active' },
        { column: 'users.id', op: '=', ref: 'orders.user_id' }, // Join predicate
      ]

      const sources: SourceProfile[] = [
        {
          name: 'users_db',
          type: 'postgres',
          capabilities: createFullCapabilities(),
          tables: ['users'],
        },
        {
          name: 'orders_db',
          type: 'postgres',
          capabilities: createFullCapabilities(),
          tables: ['orders'],
        },
      ]

      const tables: TableRef[] = [
        { source: 'users_db', table: 'users' },
        { source: 'orders_db', table: 'orders' },
      ]

      const result = analyzer.analyze(predicates, sources, tables)

      expect(result.crossSource).toHaveLength(1)
      expect(result.crossSource[0]!.ref).toBe('orders.user_id')
      expect(result.pushable.get('users_db')).toHaveLength(1)
      expect(result.stats.crossSourcePredicates).toBe(1)
    })

    it('should keep cross-source predicates at federation layer', () => {
      const predicates: QueryPredicate[] = [
        { column: 'a.x', op: '=', ref: 'b.y' },
        { column: 'b.z', op: '=', ref: 'c.w' },
      ]

      const sources: SourceProfile[] = [
        { name: 'a_db', type: 'postgres', capabilities: createFullCapabilities(), tables: ['a'] },
        { name: 'b_db', type: 'postgres', capabilities: createFullCapabilities(), tables: ['b'] },
        { name: 'c_db', type: 'postgres', capabilities: createFullCapabilities(), tables: ['c'] },
      ]

      const tables: TableRef[] = [
        { source: 'a_db', table: 'a' },
        { source: 'b_db', table: 'b' },
        { source: 'c_db', table: 'c' },
      ]

      const result = analyzer.analyze(predicates, sources, tables)

      expect(result.crossSource).toHaveLength(2)
      expect(result.stats.pushedPredicates).toBe(0)
    })
  })

  describe('custom pushdown rules', () => {
    it('should allow registering custom rules', () => {
      const customRule: PushdownRule = {
        name: 'custom_contains',
        priority: 200, // High priority
        matches: (pred, caps) =>
          pred.op === 'LIKE' &&
          String(pred.value).startsWith('%') &&
          caps.predicatePushdown,
        translate: (pred) => ({
          original: pred,
          translated: pred,
          native: { custom: true },
        }),
      }

      analyzer.registerRule(customRule)

      const rules = analyzer.getRules()
      expect(rules[0]!.name).toBe('custom_contains')
    })

    it('should apply custom rules in priority order', () => {
      analyzer.clearRules()

      analyzer.registerRule({
        name: 'low_priority',
        priority: 10,
        matches: () => true,
      })

      analyzer.registerRule({
        name: 'high_priority',
        priority: 100,
        matches: () => true,
      })

      const rules = analyzer.getRules()
      expect(rules[0]!.name).toBe('high_priority')
      expect(rules[1]!.name).toBe('low_priority')
    })
  })
})

// =============================================================================
// ConjunctionSplitter Tests
// =============================================================================

describe('ConjunctionSplitter', () => {
  let splitter: ConjunctionSplitter

  beforeEach(() => {
    splitter = new ConjunctionSplitter()
  })

  it('should split predicates by source', () => {
    const predicates: QueryPredicate[] = [
      { column: 'users.name', op: '=', value: 'Alice' },
      { column: 'orders.total', op: '>', value: 50 },
    ]

    const sources: SourceProfile[] = [
      { name: 'users_db', type: 'postgres', capabilities: createFullCapabilities(), tables: ['users'] },
      { name: 'orders_db', type: 'postgres', capabilities: createFullCapabilities(), tables: ['orders'] },
    ]

    const tables: TableRef[] = [
      { source: 'users_db', table: 'users' },
      { source: 'orders_db', table: 'orders' },
    ]

    const result = splitter.splitConjunction(predicates, sources, tables)

    expect(result.get('users_db')).toHaveLength(1)
    expect(result.get('orders_db')).toHaveLength(1)
  })

  it('should put cross-source predicates in residual', () => {
    const predicates: QueryPredicate[] = [
      { column: 'users.id', op: '=', ref: 'orders.user_id' },
    ]

    const sources: SourceProfile[] = [
      { name: 'users_db', type: 'postgres', capabilities: createFullCapabilities(), tables: ['users'] },
      { name: 'orders_db', type: 'postgres', capabilities: createFullCapabilities(), tables: ['orders'] },
    ]

    const tables: TableRef[] = [
      { source: 'users_db', table: 'users' },
      { source: 'orders_db', table: 'orders' },
    ]

    const result = splitter.splitConjunction(predicates, sources, tables)

    expect(result.get('_residual')).toHaveLength(1)
  })

  it('should handle table aliases', () => {
    const predicates: QueryPredicate[] = [
      { column: 'u.name', op: '=', value: 'Bob' },
    ]

    const sources: SourceProfile[] = [
      { name: 'users_db', type: 'postgres', capabilities: createFullCapabilities(), tables: ['users'] },
    ]

    const tables: TableRef[] = [
      { source: 'users_db', table: 'users', alias: 'u' },
    ]

    const result = splitter.splitConjunction(predicates, sources, tables)

    expect(result.get('users_db')).toHaveLength(1)
  })
})

// =============================================================================
// PredicatePushdownOptimizer Tests
// =============================================================================

describe('PredicatePushdownOptimizer', () => {
  let optimizer: PredicatePushdownOptimizer

  beforeEach(() => {
    optimizer = new PredicatePushdownOptimizer()
  })

  describe('pushdown plan creation', () => {
    it('should create a complete pushdown plan', () => {
      const predicates: QueryPredicate[] = [
        { column: 'users.status', op: '=', value: 'active' },
        { column: 'users.age', op: '>=', value: 18 },
      ]

      const sources: SourceProfile[] = [
        {
          name: 'users_db',
          type: 'postgres',
          capabilities: createFullCapabilities(),
          tables: ['users'],
        },
      ]

      const tables: TableRef[] = [{ source: 'users_db', table: 'users' }]

      const plan = optimizer.createPushdownPlan(predicates, sources, tables)

      expect(plan.sources).toHaveLength(1)
      expect(plan.sources[0]!.predicates).toHaveLength(2)
      expect(plan.residualPredicates).toHaveLength(0)
    })

    it('should estimate selectivity when requested', () => {
      const predicates: QueryPredicate[] = [
        { column: 'users.id', op: '=', value: 123 }, // Highly selective
        { column: 'users.status', op: '!=', value: 'deleted' }, // Low selectivity
      ]

      const sources: SourceProfile[] = [
        {
          name: 'users_db',
          type: 'postgres',
          capabilities: createFullCapabilities(),
          tables: ['users'],
        },
      ]

      const tables: TableRef[] = [{ source: 'users_db', table: 'users' }]

      const plan = optimizer.createPushdownPlan(predicates, sources, tables, {
        estimateSelectivity: true,
      })

      expect(plan.sources[0]!.estimatedSelectivity).toBeLessThan(1)
      expect(plan.sources[0]!.estimatedSelectivity).toBeGreaterThan(0)
    })

    it('should estimate data transfer reduction', () => {
      const predicates: QueryPredicate[] = [
        { column: 'data.id', op: '=', value: 1 },
      ]

      const sources: SourceProfile[] = [
        {
          name: 'data_db',
          type: 'postgres',
          capabilities: createFullCapabilities(),
          tables: ['data'],
        },
      ]

      const tables: TableRef[] = [{ source: 'data_db', table: 'data' }]

      const plan = optimizer.createPushdownPlan(predicates, sources, tables, {
        estimateSelectivity: true,
      })

      expect(plan.dataTransferEstimate.reduction).toBeGreaterThan(0)
      expect(plan.dataTransferEstimate.withPushdown).toBeLessThan(
        plan.dataTransferEstimate.withoutPushdown
      )
    })
  })

  describe('predicate translation', () => {
    it('should translate predicates for MongoDB', () => {
      const predicates: QueryPredicate[] = [
        { column: 'users.status', op: '=', value: 'active' },
        { column: 'users.age', op: '>', value: 21 },
      ]

      const sources: SourceProfile[] = [
        {
          name: 'users_db',
          type: 'mongodb',
          capabilities: createFullCapabilities(),
          tables: ['users'],
        },
      ]

      const tables: TableRef[] = [{ source: 'users_db', table: 'users' }]

      const plan = optimizer.createPushdownPlan(predicates, sources, tables, {
        translatePredicates: true,
      })

      expect(plan.sources[0]!.translations).toHaveLength(2)
      expect(plan.sources[0]!.translations[0]!.native).toEqual({ status: 'active' })
      expect(plan.sources[0]!.translations[1]!.native).toEqual({ age: { $gt: 21 } })
    })

    it('should translate predicates for Elasticsearch', () => {
      const predicates: QueryPredicate[] = [
        { column: 'docs.status', op: '=', value: 'published' },
      ]

      const sources: SourceProfile[] = [
        {
          name: 'docs_db',
          type: 'elasticsearch',
          capabilities: createFullCapabilities(),
          tables: ['docs'],
        },
      ]

      const tables: TableRef[] = [{ source: 'docs_db', table: 'docs' }]

      const plan = optimizer.createPushdownPlan(predicates, sources, tables, {
        translatePredicates: true,
      })

      expect(plan.sources[0]!.translations[0]!.native).toEqual({
        term: { status: 'published' },
      })
    })

    it('should translate predicates for SQL', () => {
      const predicates: QueryPredicate[] = [
        { column: 'users.name', op: '=', value: 'Alice' },
        { column: 'users.age', op: 'IN', value: [18, 21, 25] },
      ]

      const sources: SourceProfile[] = [
        {
          name: 'users_db',
          type: 'postgres',
          capabilities: createFullCapabilities(),
          tables: ['users'],
        },
      ]

      const tables: TableRef[] = [{ source: 'users_db', table: 'users' }]

      const plan = optimizer.createPushdownPlan(predicates, sources, tables, {
        translatePredicates: true,
      })

      expect(plan.sources[0]!.translations[0]!.sql).toBe("users.name = 'Alice'")
      expect(plan.sources[0]!.translations[1]!.sql).toBe('users.age IN (18, 21, 25)')
    })

    it('should translate LIKE to MongoDB regex', () => {
      const predicates: QueryPredicate[] = [
        { column: 'products.name', op: 'LIKE', value: '%widget%' },
      ]

      const sources: SourceProfile[] = [
        {
          name: 'products_db',
          type: 'mongodb',
          capabilities: createFullCapabilities(),
          tables: ['products'],
        },
      ]

      const tables: TableRef[] = [{ source: 'products_db', table: 'products' }]

      const plan = optimizer.createPushdownPlan(predicates, sources, tables, {
        translatePredicates: true,
      })

      expect(plan.sources[0]!.translations[0]!.native).toEqual({
        name: { $regex: '.*widget.*', $options: 'i' },
      })
    })
  })

  describe('data transfer minimization', () => {
    it('should prefer pushing selective predicates', () => {
      const predicates: QueryPredicate[] = [
        { column: 'logs.id', op: '=', value: 'specific-id' }, // Very selective
        { column: 'logs.level', op: '!=', value: 'debug' }, // Not selective
      ]

      const sources: SourceProfile[] = [
        {
          name: 'logs_db',
          type: 'postgres',
          capabilities: createFullCapabilities(),
          tables: ['logs'],
        },
      ]

      const tables: TableRef[] = [{ source: 'logs_db', table: 'logs' }]

      const plan = optimizer.createPushdownPlan(predicates, sources, tables, {
        estimateSelectivity: true,
      })

      // Both should be pushed, but equality is more selective
      expect(plan.sources[0]!.predicates).toHaveLength(2)
      expect(plan.dataTransferEstimate.reduction).toBeGreaterThan(0)
    })

    it('should calculate correct reduction percentage', () => {
      const predicates: QueryPredicate[] = [
        { column: 'data.status', op: '=', value: 'active' },
      ]

      const sources: SourceProfile[] = [
        {
          name: 'data_db',
          type: 'postgres',
          capabilities: createFullCapabilities(),
          tables: ['data'],
        },
      ]

      const tables: TableRef[] = [{ source: 'data_db', table: 'data' }]

      const plan = optimizer.createPushdownPlan(predicates, sources, tables, {
        estimateSelectivity: true,
      })

      expect(plan.dataTransferEstimate.reduction).toBeGreaterThanOrEqual(0)
      expect(plan.dataTransferEstimate.reduction).toBeLessThanOrEqual(1)
    })
  })
})

// =============================================================================
// PredicateRewriter Tests
// =============================================================================

describe('PredicateRewriter', () => {
  let rewriter: PredicateRewriter

  beforeEach(() => {
    rewriter = new PredicateRewriter()
  })

  describe('BETWEEN rewriting', () => {
    it('should rewrite BETWEEN as two range predicates', () => {
      const result = rewriter.rewriteBetween('price', 10, 100)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ column: 'price', op: '>=', value: 10 })
      expect(result[1]).toEqual({ column: 'price', op: '<=', value: 100 })
    })
  })

  describe('NOT IN rewriting', () => {
    it('should rewrite NOT IN as multiple != predicates', () => {
      const result = rewriter.rewriteNotIn('status', ['a', 'b', 'c'])

      expect(result).toHaveLength(3)
      expect(result[0]).toEqual({ column: 'status', op: '!=', value: 'a' })
      expect(result[1]).toEqual({ column: 'status', op: '!=', value: 'b' })
      expect(result[2]).toEqual({ column: 'status', op: '!=', value: 'c' })
    })
  })

  describe('LIKE prefix optimization', () => {
    it('should rewrite prefix LIKE as range scan', () => {
      const result = rewriter.rewriteLikePrefix('name', 'abc%')

      expect(result).not.toBeNull()
      expect(result).toHaveLength(2)
      expect(result![0]!.op).toBe('>=')
      expect(result![0]!.value).toBe('abc')
      expect(result![1]!.op).toBe('<')
    })

    it('should not rewrite non-prefix patterns', () => {
      const result = rewriter.rewriteLikePrefix('name', '%abc%')
      expect(result).toBeNull()
    })

    it('should not rewrite patterns with wildcards in prefix', () => {
      const result = rewriter.rewriteLikePrefix('name', 'a_c%')
      expect(result).toBeNull()
    })
  })

  describe('tautology simplification', () => {
    it('should identify tautologies', () => {
      // This is a simplified test - real tautology would be 1 = 1
      const pred: QueryPredicate = { column: 'x', op: '=', value: 'x' }
      const result = rewriter.simplifyTautology(pred)
      expect(result).toBeNull()
    })

    it('should preserve non-tautologies', () => {
      const pred: QueryPredicate = { column: 'status', op: '=', value: 'active' }
      const result = rewriter.simplifyTautology(pred)
      expect(result).toEqual(pred)
    })
  })

  describe('contradiction detection', () => {
    it('should detect contradictions', () => {
      const predicates: QueryPredicate[] = [
        { column: 'status', op: '=', value: 'active' },
        { column: 'status', op: '=', value: 'inactive' },
      ]

      expect(rewriter.isContradiction(predicates)).toBe(true)
    })

    it('should not flag valid predicate sets', () => {
      const predicates: QueryPredicate[] = [
        { column: 'status', op: '=', value: 'active' },
        { column: 'age', op: '=', value: 25 },
      ]

      expect(rewriter.isContradiction(predicates)).toBe(false)
    })
  })

  describe('range merging', () => {
    it('should merge overlapping ranges', () => {
      const predicates: QueryPredicate[] = [
        { column: 'age', op: '>', value: 10 },
        { column: 'age', op: '>', value: 20 }, // More restrictive
        { column: 'age', op: '<', value: 100 },
        { column: 'age', op: '<', value: 50 }, // More restrictive
      ]

      const result = rewriter.mergeRanges(predicates)

      // Should keep the most restrictive bounds
      const lowerBound = result.find((p) => p.op === '>')
      const upperBound = result.find((p) => p.op === '<')

      expect(lowerBound?.value).toBe(20)
      expect(upperBound?.value).toBe(50)
    })

    it('should preserve non-range predicates', () => {
      const predicates: QueryPredicate[] = [
        { column: 'age', op: '>', value: 18 },
        { column: 'status', op: '=', value: 'active' },
      ]

      const result = rewriter.mergeRanges(predicates)

      expect(result).toHaveLength(2)
      expect(result.find((p) => p.op === '=')).toBeDefined()
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Predicate Pushdown Integration', () => {
  it('should handle complete multi-source query optimization', () => {
    const optimizer = new PredicatePushdownOptimizer()

    const predicates: QueryPredicate[] = [
      { column: 'users.status', op: '=', value: 'active' },
      { column: 'users.age', op: '>=', value: 21 },
      { column: 'orders.total', op: '>', value: 100 },
      { column: 'orders.status', op: 'IN', value: ['completed', 'shipped'] },
      { column: 'users.id', op: '=', ref: 'orders.user_id' }, // Join predicate
    ]

    const sources: SourceProfile[] = [
      {
        name: 'users_db',
        type: 'postgres',
        capabilities: createFullCapabilities(),
        tables: ['users'],
      },
      {
        name: 'orders_db',
        type: 'postgres',
        capabilities: createFullCapabilities(),
        tables: ['orders'],
      },
    ]

    const tables: TableRef[] = [
      { source: 'users_db', table: 'users' },
      { source: 'orders_db', table: 'orders' },
    ]

    const plan = optimizer.createPushdownPlan(predicates, sources, tables, {
      estimateSelectivity: true,
      translatePredicates: true,
    })

    // Verify users_db got its predicates
    expect(plan.sources.find((s) => s.source === 'users_db')!.predicates).toHaveLength(2)

    // Verify orders_db got its predicates
    expect(plan.sources.find((s) => s.source === 'orders_db')!.predicates).toHaveLength(2)

    // Verify join predicate is handled separately
    expect(plan.joinPredicates).toHaveLength(1)
    expect(plan.joinPredicates[0]!.ref).toBe('orders.user_id')

    // Verify no residual predicates (all were handled)
    expect(plan.residualPredicates).toHaveLength(0)

    // Verify data transfer reduction
    expect(plan.dataTransferEstimate.reduction).toBeGreaterThan(0)
  })

  it('should handle mixed capability sources', () => {
    const optimizer = new PredicatePushdownOptimizer()

    const predicates: QueryPredicate[] = [
      { column: 'sql_table.id', op: '=', value: 1 },
      { column: 'sql_table.name', op: 'LIKE', value: '%test%' },
      { column: 'api_table.status', op: '=', value: 'active' },
      { column: 'api_table.name', op: 'LIKE', value: '%api%' }, // API doesn't support LIKE
    ]

    const sources: SourceProfile[] = [
      {
        name: 'sql_db',
        type: 'postgres',
        capabilities: createFullCapabilities(),
        tables: ['sql_table'],
      },
      {
        name: 'api_db',
        type: 'rest',
        capabilities: createLimitedCapabilities(), // No LIKE support
        tables: ['api_table'],
      },
    ]

    const tables: TableRef[] = [
      { source: 'sql_db', table: 'sql_table' },
      { source: 'api_db', table: 'api_table' },
    ]

    const plan = optimizer.createPushdownPlan(predicates, sources, tables)

    // SQL source gets both predicates
    expect(plan.sources.find((s) => s.source === 'sql_db')!.predicates).toHaveLength(2)

    // API source only gets equality predicate
    expect(plan.sources.find((s) => s.source === 'api_db')!.predicates).toHaveLength(1)

    // LIKE on API source becomes residual
    expect(plan.residualPredicates).toHaveLength(1)
    expect(plan.residualPredicates[0]!.op).toBe('LIKE')
  })
})
