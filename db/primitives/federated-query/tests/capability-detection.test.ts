/**
 * Source Capability Detection Tests
 *
 * TDD tests for capability detection that enables the query planner
 * to make smart routing decisions based on what operations each source supports.
 *
 * @see dotdo-wwnz3
 * @module db/primitives/federated-query/capability-detection
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  type SourceCapability,
  type PredicateCapability,
  type JoinCapability,
  type AggregationCapability,
  type CapabilityProfile,
  type CapabilityNegotiationResult,
  CapabilityDetector,
  createCapabilityDetector,
  PredicateOperator,
  AggregationFunction,
  JoinType,
  DataTypeSupport,
} from '../capability-detection'

// =============================================================================
// 1. SourceCapability Interface Tests
// =============================================================================

describe('SourceCapability Interface', () => {
  it('exports SourceCapability type', async () => {
    const module = await import('../capability-detection')
    expect(module).toHaveProperty('CapabilityDetector')
  })

  it('exports PredicateOperator enum', async () => {
    const module = await import('../capability-detection')
    expect(module.PredicateOperator).toBeDefined()
    expect(module.PredicateOperator.EQUALS).toBe('=')
    expect(module.PredicateOperator.NOT_EQUALS).toBe('!=')
    expect(module.PredicateOperator.GREATER_THAN).toBe('>')
    expect(module.PredicateOperator.LESS_THAN).toBe('<')
    expect(module.PredicateOperator.LIKE).toBe('LIKE')
    expect(module.PredicateOperator.IN).toBe('IN')
    expect(module.PredicateOperator.BETWEEN).toBe('BETWEEN')
    expect(module.PredicateOperator.IS_NULL).toBe('IS NULL')
    expect(module.PredicateOperator.REGEX).toBe('REGEX')
  })

  it('exports AggregationFunction enum', async () => {
    const module = await import('../capability-detection')
    expect(module.AggregationFunction).toBeDefined()
    expect(module.AggregationFunction.COUNT).toBe('count')
    expect(module.AggregationFunction.SUM).toBe('sum')
    expect(module.AggregationFunction.AVG).toBe('avg')
    expect(module.AggregationFunction.MIN).toBe('min')
    expect(module.AggregationFunction.MAX).toBe('max')
    expect(module.AggregationFunction.COUNT_DISTINCT).toBe('count_distinct')
    expect(module.AggregationFunction.STDDEV).toBe('stddev')
    expect(module.AggregationFunction.VARIANCE).toBe('variance')
  })

  it('exports JoinType enum', async () => {
    const module = await import('../capability-detection')
    expect(module.JoinType).toBeDefined()
    expect(module.JoinType.INNER).toBe('INNER')
    expect(module.JoinType.LEFT).toBe('LEFT')
    expect(module.JoinType.RIGHT).toBe('RIGHT')
    expect(module.JoinType.FULL).toBe('FULL')
    expect(module.JoinType.CROSS).toBe('CROSS')
    expect(module.JoinType.SEMI).toBe('SEMI')
    expect(module.JoinType.ANTI).toBe('ANTI')
  })
})

// =============================================================================
// 2. PredicateCapability Tests
// =============================================================================

describe('PredicateCapability Detection', () => {
  let detector: CapabilityDetector

  beforeEach(() => {
    detector = createCapabilityDetector()
  })

  describe('operator support', () => {
    it('detects supported comparison operators', () => {
      const profile: CapabilityProfile = {
        sourceName: 'sqlite-source',
        sourceType: 'sqlite',
        predicates: {
          supportedOperators: [
            PredicateOperator.EQUALS,
            PredicateOperator.NOT_EQUALS,
            PredicateOperator.GREATER_THAN,
            PredicateOperator.LESS_THAN,
            PredicateOperator.GREATER_THAN_OR_EQUALS,
            PredicateOperator.LESS_THAN_OR_EQUALS,
          ],
          supportsCompoundPredicates: true,
          supportsNestedPredicates: true,
          maxPredicateDepth: 10,
        },
        projections: { supported: true },
        aggregations: { supportedFunctions: [], supportsGroupBy: false },
        joins: { supportedTypes: [], supportsMultiWayJoin: false },
        sorting: { supported: true, maxSortColumns: 10 },
        pagination: { supportsLimit: true, supportsOffset: true },
      }

      detector.registerProfile(profile)

      expect(detector.supportsOperator('sqlite-source', PredicateOperator.EQUALS)).toBe(true)
      expect(detector.supportsOperator('sqlite-source', PredicateOperator.GREATER_THAN)).toBe(true)
      expect(detector.supportsOperator('sqlite-source', PredicateOperator.REGEX)).toBe(false)
    })

    it('detects LIKE pattern support', () => {
      const profile: CapabilityProfile = {
        sourceName: 'postgres-source',
        sourceType: 'postgres',
        predicates: {
          supportedOperators: [
            PredicateOperator.LIKE,
            PredicateOperator.ILIKE,
          ],
          supportsCompoundPredicates: true,
          supportsNestedPredicates: true,
          maxPredicateDepth: 20,
        },
        projections: { supported: true },
        aggregations: { supportedFunctions: [], supportsGroupBy: false },
        joins: { supportedTypes: [], supportsMultiWayJoin: false },
        sorting: { supported: true, maxSortColumns: 10 },
        pagination: { supportsLimit: true, supportsOffset: true },
      }

      detector.registerProfile(profile)

      expect(detector.supportsOperator('postgres-source', PredicateOperator.LIKE)).toBe(true)
      expect(detector.supportsOperator('postgres-source', PredicateOperator.ILIKE)).toBe(true)
    })

    it('detects IN operator support with max list size', () => {
      const profile: CapabilityProfile = {
        sourceName: 'memory-source',
        sourceType: 'memory',
        predicates: {
          supportedOperators: [PredicateOperator.IN, PredicateOperator.NOT_IN],
          supportsCompoundPredicates: true,
          supportsNestedPredicates: false,
          maxPredicateDepth: 1,
          maxInListSize: 1000,
        },
        projections: { supported: true },
        aggregations: { supportedFunctions: [], supportsGroupBy: false },
        joins: { supportedTypes: [], supportsMultiWayJoin: false },
        sorting: { supported: false },
        pagination: { supportsLimit: true, supportsOffset: false },
      }

      detector.registerProfile(profile)

      expect(detector.supportsOperator('memory-source', PredicateOperator.IN)).toBe(true)
      expect(detector.getMaxInListSize('memory-source')).toBe(1000)
    })

    it('detects BETWEEN operator support', () => {
      const profile: CapabilityProfile = {
        sourceName: 'sql-source',
        sourceType: 'sqlite',
        predicates: {
          supportedOperators: [PredicateOperator.BETWEEN],
          supportsCompoundPredicates: true,
          supportsNestedPredicates: true,
          maxPredicateDepth: 5,
        },
        projections: { supported: true },
        aggregations: { supportedFunctions: [], supportsGroupBy: false },
        joins: { supportedTypes: [], supportsMultiWayJoin: false },
        sorting: { supported: true, maxSortColumns: 5 },
        pagination: { supportsLimit: true, supportsOffset: true },
      }

      detector.registerProfile(profile)

      expect(detector.supportsOperator('sql-source', PredicateOperator.BETWEEN)).toBe(true)
    })

    it('detects regex support', () => {
      const profile: CapabilityProfile = {
        sourceName: 'mongo-source',
        sourceType: 'rest',
        predicates: {
          supportedOperators: [PredicateOperator.REGEX],
          supportsCompoundPredicates: true,
          supportsNestedPredicates: true,
          maxPredicateDepth: 100,
          regexFlavor: 'PCRE',
        },
        projections: { supported: true },
        aggregations: { supportedFunctions: [], supportsGroupBy: false },
        joins: { supportedTypes: [], supportsMultiWayJoin: false },
        sorting: { supported: true, maxSortColumns: 10 },
        pagination: { supportsLimit: true, supportsOffset: true },
      }

      detector.registerProfile(profile)

      expect(detector.supportsOperator('mongo-source', PredicateOperator.REGEX)).toBe(true)
      expect(detector.getRegexFlavor('mongo-source')).toBe('PCRE')
    })
  })

  describe('compound predicates', () => {
    it('detects AND/OR support', () => {
      const profile: CapabilityProfile = {
        sourceName: 'full-sql',
        sourceType: 'postgres',
        predicates: {
          supportedOperators: [PredicateOperator.EQUALS],
          supportsCompoundPredicates: true,
          supportedCompoundOperators: ['AND', 'OR', 'NOT'],
          supportsNestedPredicates: true,
          maxPredicateDepth: 10,
        },
        projections: { supported: true },
        aggregations: { supportedFunctions: [], supportsGroupBy: false },
        joins: { supportedTypes: [], supportsMultiWayJoin: false },
        sorting: { supported: true, maxSortColumns: 10 },
        pagination: { supportsLimit: true, supportsOffset: true },
      }

      detector.registerProfile(profile)

      expect(detector.supportsCompoundPredicates('full-sql')).toBe(true)
      expect(detector.supportsCompoundOperator('full-sql', 'AND')).toBe(true)
      expect(detector.supportsCompoundOperator('full-sql', 'OR')).toBe(true)
      expect(detector.supportsCompoundOperator('full-sql', 'NOT')).toBe(true)
    })

    it('detects nested predicate support with depth limit', () => {
      const profile: CapabilityProfile = {
        sourceName: 'limited-source',
        sourceType: 'memory',
        predicates: {
          supportedOperators: [PredicateOperator.EQUALS],
          supportsCompoundPredicates: true,
          supportsNestedPredicates: true,
          maxPredicateDepth: 3,
        },
        projections: { supported: true },
        aggregations: { supportedFunctions: [], supportsGroupBy: false },
        joins: { supportedTypes: [], supportsMultiWayJoin: false },
        sorting: { supported: false },
        pagination: { supportsLimit: true, supportsOffset: false },
      }

      detector.registerProfile(profile)

      expect(detector.supportsNestedPredicates('limited-source')).toBe(true)
      expect(detector.getMaxPredicateDepth('limited-source')).toBe(3)
    })
  })

  describe('data type handling', () => {
    it('detects type-specific predicate support', () => {
      const profile: CapabilityProfile = {
        sourceName: 'typed-source',
        sourceType: 'postgres',
        predicates: {
          supportedOperators: [PredicateOperator.EQUALS],
          supportsCompoundPredicates: true,
          supportsNestedPredicates: true,
          maxPredicateDepth: 10,
          dataTypeSupport: {
            string: { operators: [PredicateOperator.EQUALS, PredicateOperator.LIKE] },
            integer: { operators: [PredicateOperator.EQUALS, PredicateOperator.GREATER_THAN, PredicateOperator.BETWEEN] },
            timestamp: { operators: [PredicateOperator.EQUALS, PredicateOperator.BETWEEN] },
            json: { operators: [PredicateOperator.EQUALS], supportsJsonPath: true },
          },
        },
        projections: { supported: true },
        aggregations: { supportedFunctions: [], supportsGroupBy: false },
        joins: { supportedTypes: [], supportsMultiWayJoin: false },
        sorting: { supported: true, maxSortColumns: 10 },
        pagination: { supportsLimit: true, supportsOffset: true },
      }

      detector.registerProfile(profile)

      expect(detector.supportsOperatorForType('typed-source', PredicateOperator.LIKE, 'string')).toBe(true)
      expect(detector.supportsOperatorForType('typed-source', PredicateOperator.LIKE, 'integer')).toBe(false)
      expect(detector.supportsOperatorForType('typed-source', PredicateOperator.BETWEEN, 'timestamp')).toBe(true)
      expect(detector.supportsJsonPath('typed-source')).toBe(true)
    })
  })
})

// =============================================================================
// 3. JoinCapability Tests
// =============================================================================

describe('JoinCapability Detection', () => {
  let detector: CapabilityDetector

  beforeEach(() => {
    detector = createCapabilityDetector()
  })

  describe('join type support', () => {
    it('detects supported join types', () => {
      const profile: CapabilityProfile = {
        sourceName: 'sql-source',
        sourceType: 'postgres',
        predicates: {
          supportedOperators: [PredicateOperator.EQUALS],
          supportsCompoundPredicates: true,
          supportsNestedPredicates: true,
          maxPredicateDepth: 10,
        },
        projections: { supported: true },
        aggregations: { supportedFunctions: [], supportsGroupBy: false },
        joins: {
          supportedTypes: [JoinType.INNER, JoinType.LEFT, JoinType.RIGHT, JoinType.FULL],
          supportsMultiWayJoin: true,
          maxJoinTables: 16,
          supportsNonEquiJoin: true,
          supportsCrossJoin: true,
        },
        sorting: { supported: true, maxSortColumns: 10 },
        pagination: { supportsLimit: true, supportsOffset: true },
      }

      detector.registerProfile(profile)

      expect(detector.supportsJoinType('sql-source', JoinType.INNER)).toBe(true)
      expect(detector.supportsJoinType('sql-source', JoinType.LEFT)).toBe(true)
      expect(detector.supportsJoinType('sql-source', JoinType.SEMI)).toBe(false)
    })

    it('detects semi and anti join support', () => {
      const profile: CapabilityProfile = {
        sourceName: 'advanced-source',
        sourceType: 'postgres',
        predicates: {
          supportedOperators: [PredicateOperator.EQUALS],
          supportsCompoundPredicates: true,
          supportsNestedPredicates: true,
          maxPredicateDepth: 10,
        },
        projections: { supported: true },
        aggregations: { supportedFunctions: [], supportsGroupBy: false },
        joins: {
          supportedTypes: [JoinType.INNER, JoinType.SEMI, JoinType.ANTI],
          supportsMultiWayJoin: true,
          maxJoinTables: 20,
        },
        sorting: { supported: true, maxSortColumns: 10 },
        pagination: { supportsLimit: true, supportsOffset: true },
      }

      detector.registerProfile(profile)

      expect(detector.supportsJoinType('advanced-source', JoinType.SEMI)).toBe(true)
      expect(detector.supportsJoinType('advanced-source', JoinType.ANTI)).toBe(true)
    })
  })

  describe('join limitations', () => {
    it('detects max join table limit', () => {
      const profile: CapabilityProfile = {
        sourceName: 'limited-join-source',
        sourceType: 'sqlite',
        predicates: {
          supportedOperators: [PredicateOperator.EQUALS],
          supportsCompoundPredicates: true,
          supportsNestedPredicates: true,
          maxPredicateDepth: 10,
        },
        projections: { supported: true },
        aggregations: { supportedFunctions: [], supportsGroupBy: false },
        joins: {
          supportedTypes: [JoinType.INNER, JoinType.LEFT],
          supportsMultiWayJoin: true,
          maxJoinTables: 8,
        },
        sorting: { supported: true, maxSortColumns: 10 },
        pagination: { supportsLimit: true, supportsOffset: true },
      }

      detector.registerProfile(profile)

      expect(detector.getMaxJoinTables('limited-join-source')).toBe(8)
      expect(detector.canJoinTables('limited-join-source', 5)).toBe(true)
      expect(detector.canJoinTables('limited-join-source', 10)).toBe(false)
    })

    it('detects non-equi join support', () => {
      const profile: CapabilityProfile = {
        sourceName: 'equi-only',
        sourceType: 'memory',
        predicates: {
          supportedOperators: [PredicateOperator.EQUALS],
          supportsCompoundPredicates: false,
          supportsNestedPredicates: false,
          maxPredicateDepth: 1,
        },
        projections: { supported: true },
        aggregations: { supportedFunctions: [], supportsGroupBy: false },
        joins: {
          supportedTypes: [JoinType.INNER],
          supportsMultiWayJoin: false,
          maxJoinTables: 2,
          supportsNonEquiJoin: false,
        },
        sorting: { supported: false },
        pagination: { supportsLimit: true, supportsOffset: false },
      }

      detector.registerProfile(profile)

      expect(detector.supportsNonEquiJoin('equi-only')).toBe(false)
    })

    it('detects cross join support', () => {
      const profile: CapabilityProfile = {
        sourceName: 'cross-join-source',
        sourceType: 'postgres',
        predicates: {
          supportedOperators: [PredicateOperator.EQUALS],
          supportsCompoundPredicates: true,
          supportsNestedPredicates: true,
          maxPredicateDepth: 10,
        },
        projections: { supported: true },
        aggregations: { supportedFunctions: [], supportsGroupBy: false },
        joins: {
          supportedTypes: [JoinType.INNER, JoinType.CROSS],
          supportsMultiWayJoin: true,
          maxJoinTables: 10,
          supportsCrossJoin: true,
        },
        sorting: { supported: true, maxSortColumns: 10 },
        pagination: { supportsLimit: true, supportsOffset: true },
      }

      detector.registerProfile(profile)

      expect(detector.supportsJoinType('cross-join-source', JoinType.CROSS)).toBe(true)
      expect(detector.supportsCrossJoin('cross-join-source')).toBe(true)
    })
  })

  describe('join pushdown detection', () => {
    it('detects if source supports join pushdown', () => {
      const profile: CapabilityProfile = {
        sourceName: 'join-pushdown-source',
        sourceType: 'postgres',
        predicates: {
          supportedOperators: [PredicateOperator.EQUALS],
          supportsCompoundPredicates: true,
          supportsNestedPredicates: true,
          maxPredicateDepth: 10,
        },
        projections: { supported: true },
        aggregations: { supportedFunctions: [], supportsGroupBy: false },
        joins: {
          supportedTypes: [JoinType.INNER, JoinType.LEFT],
          supportsMultiWayJoin: true,
          maxJoinTables: 10,
          supportsPushdown: true,
        },
        sorting: { supported: true, maxSortColumns: 10 },
        pagination: { supportsLimit: true, supportsOffset: true },
      }

      detector.registerProfile(profile)

      expect(detector.supportsJoinPushdown('join-pushdown-source')).toBe(true)
    })
  })
})

// =============================================================================
// 4. AggregationCapability Tests
// =============================================================================

describe('AggregationCapability Detection', () => {
  let detector: CapabilityDetector

  beforeEach(() => {
    detector = createCapabilityDetector()
  })

  describe('basic aggregation functions', () => {
    it('detects COUNT, SUM, AVG, MIN, MAX support', () => {
      const profile: CapabilityProfile = {
        sourceName: 'agg-source',
        sourceType: 'sqlite',
        predicates: {
          supportedOperators: [PredicateOperator.EQUALS],
          supportsCompoundPredicates: true,
          supportsNestedPredicates: true,
          maxPredicateDepth: 10,
        },
        projections: { supported: true },
        aggregations: {
          supportedFunctions: [
            AggregationFunction.COUNT,
            AggregationFunction.SUM,
            AggregationFunction.AVG,
            AggregationFunction.MIN,
            AggregationFunction.MAX,
          ],
          supportsGroupBy: true,
          supportsHaving: true,
        },
        joins: { supportedTypes: [], supportsMultiWayJoin: false },
        sorting: { supported: true, maxSortColumns: 10 },
        pagination: { supportsLimit: true, supportsOffset: true },
      }

      detector.registerProfile(profile)

      expect(detector.supportsAggregation('agg-source', AggregationFunction.COUNT)).toBe(true)
      expect(detector.supportsAggregation('agg-source', AggregationFunction.SUM)).toBe(true)
      expect(detector.supportsAggregation('agg-source', AggregationFunction.AVG)).toBe(true)
      expect(detector.supportsAggregation('agg-source', AggregationFunction.MIN)).toBe(true)
      expect(detector.supportsAggregation('agg-source', AggregationFunction.MAX)).toBe(true)
    })

    it('detects COUNT DISTINCT support', () => {
      const profile: CapabilityProfile = {
        sourceName: 'distinct-source',
        sourceType: 'postgres',
        predicates: {
          supportedOperators: [PredicateOperator.EQUALS],
          supportsCompoundPredicates: true,
          supportsNestedPredicates: true,
          maxPredicateDepth: 10,
        },
        projections: { supported: true },
        aggregations: {
          supportedFunctions: [
            AggregationFunction.COUNT,
            AggregationFunction.COUNT_DISTINCT,
          ],
          supportsGroupBy: true,
          supportsHaving: true,
          supportsDistinct: true,
        },
        joins: { supportedTypes: [], supportsMultiWayJoin: false },
        sorting: { supported: true, maxSortColumns: 10 },
        pagination: { supportsLimit: true, supportsOffset: true },
      }

      detector.registerProfile(profile)

      expect(detector.supportsAggregation('distinct-source', AggregationFunction.COUNT_DISTINCT)).toBe(true)
      expect(detector.supportsDistinct('distinct-source')).toBe(true)
    })
  })

  describe('advanced aggregation functions', () => {
    it('detects STDDEV and VARIANCE support', () => {
      const profile: CapabilityProfile = {
        sourceName: 'stats-source',
        sourceType: 'postgres',
        predicates: {
          supportedOperators: [PredicateOperator.EQUALS],
          supportsCompoundPredicates: true,
          supportsNestedPredicates: true,
          maxPredicateDepth: 10,
        },
        projections: { supported: true },
        aggregations: {
          supportedFunctions: [
            AggregationFunction.STDDEV,
            AggregationFunction.VARIANCE,
            AggregationFunction.PERCENTILE,
          ],
          supportsGroupBy: true,
          supportsHaving: true,
        },
        joins: { supportedTypes: [], supportsMultiWayJoin: false },
        sorting: { supported: true, maxSortColumns: 10 },
        pagination: { supportsLimit: true, supportsOffset: true },
      }

      detector.registerProfile(profile)

      expect(detector.supportsAggregation('stats-source', AggregationFunction.STDDEV)).toBe(true)
      expect(detector.supportsAggregation('stats-source', AggregationFunction.VARIANCE)).toBe(true)
      expect(detector.supportsAggregation('stats-source', AggregationFunction.PERCENTILE)).toBe(true)
    })

    it('detects window function support', () => {
      const profile: CapabilityProfile = {
        sourceName: 'window-source',
        sourceType: 'postgres',
        predicates: {
          supportedOperators: [PredicateOperator.EQUALS],
          supportsCompoundPredicates: true,
          supportsNestedPredicates: true,
          maxPredicateDepth: 10,
        },
        projections: { supported: true },
        aggregations: {
          supportedFunctions: [AggregationFunction.COUNT],
          supportsGroupBy: true,
          supportsHaving: true,
          supportsWindowFunctions: true,
          supportedWindowFunctions: ['ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD'],
        },
        joins: { supportedTypes: [], supportsMultiWayJoin: false },
        sorting: { supported: true, maxSortColumns: 10 },
        pagination: { supportsLimit: true, supportsOffset: true },
      }

      detector.registerProfile(profile)

      expect(detector.supportsWindowFunctions('window-source')).toBe(true)
      expect(detector.supportsWindowFunction('window-source', 'ROW_NUMBER')).toBe(true)
      expect(detector.supportsWindowFunction('window-source', 'RANK')).toBe(true)
    })
  })

  describe('GROUP BY support', () => {
    it('detects GROUP BY with multiple columns', () => {
      const profile: CapabilityProfile = {
        sourceName: 'groupby-source',
        sourceType: 'sqlite',
        predicates: {
          supportedOperators: [PredicateOperator.EQUALS],
          supportsCompoundPredicates: true,
          supportsNestedPredicates: true,
          maxPredicateDepth: 10,
        },
        projections: { supported: true },
        aggregations: {
          supportedFunctions: [AggregationFunction.COUNT],
          supportsGroupBy: true,
          maxGroupByColumns: 10,
          supportsHaving: true,
        },
        joins: { supportedTypes: [], supportsMultiWayJoin: false },
        sorting: { supported: true, maxSortColumns: 10 },
        pagination: { supportsLimit: true, supportsOffset: true },
      }

      detector.registerProfile(profile)

      expect(detector.supportsGroupBy('groupby-source')).toBe(true)
      expect(detector.getMaxGroupByColumns('groupby-source')).toBe(10)
      expect(detector.canGroupBy('groupby-source', 5)).toBe(true)
      expect(detector.canGroupBy('groupby-source', 15)).toBe(false)
    })

    it('detects HAVING clause support', () => {
      const profile: CapabilityProfile = {
        sourceName: 'having-source',
        sourceType: 'postgres',
        predicates: {
          supportedOperators: [PredicateOperator.EQUALS],
          supportsCompoundPredicates: true,
          supportsNestedPredicates: true,
          maxPredicateDepth: 10,
        },
        projections: { supported: true },
        aggregations: {
          supportedFunctions: [AggregationFunction.COUNT],
          supportsGroupBy: true,
          supportsHaving: true,
        },
        joins: { supportedTypes: [], supportsMultiWayJoin: false },
        sorting: { supported: true, maxSortColumns: 10 },
        pagination: { supportsLimit: true, supportsOffset: true },
      }

      detector.registerProfile(profile)

      expect(detector.supportsHaving('having-source')).toBe(true)
    })

    it('detects rollup and cube support', () => {
      const profile: CapabilityProfile = {
        sourceName: 'olap-source',
        sourceType: 'postgres',
        predicates: {
          supportedOperators: [PredicateOperator.EQUALS],
          supportsCompoundPredicates: true,
          supportsNestedPredicates: true,
          maxPredicateDepth: 10,
        },
        projections: { supported: true },
        aggregations: {
          supportedFunctions: [AggregationFunction.COUNT, AggregationFunction.SUM],
          supportsGroupBy: true,
          supportsHaving: true,
          supportsRollup: true,
          supportsCube: true,
          supportsGroupingSets: true,
        },
        joins: { supportedTypes: [], supportsMultiWayJoin: false },
        sorting: { supported: true, maxSortColumns: 10 },
        pagination: { supportsLimit: true, supportsOffset: true },
      }

      detector.registerProfile(profile)

      expect(detector.supportsRollup('olap-source')).toBe(true)
      expect(detector.supportsCube('olap-source')).toBe(true)
      expect(detector.supportsGroupingSets('olap-source')).toBe(true)
    })
  })

  describe('aggregation pushdown', () => {
    it('detects aggregation pushdown support', () => {
      const profile: CapabilityProfile = {
        sourceName: 'pushdown-source',
        sourceType: 'postgres',
        predicates: {
          supportedOperators: [PredicateOperator.EQUALS],
          supportsCompoundPredicates: true,
          supportsNestedPredicates: true,
          maxPredicateDepth: 10,
        },
        projections: { supported: true },
        aggregations: {
          supportedFunctions: [AggregationFunction.COUNT, AggregationFunction.SUM],
          supportsGroupBy: true,
          supportsHaving: true,
          supportsPushdown: true,
        },
        joins: { supportedTypes: [], supportsMultiWayJoin: false },
        sorting: { supported: true, maxSortColumns: 10 },
        pagination: { supportsLimit: true, supportsOffset: true },
      }

      detector.registerProfile(profile)

      expect(detector.supportsAggregationPushdown('pushdown-source')).toBe(true)
    })
  })
})

// =============================================================================
// 5. CapabilityProfile Management Tests
// =============================================================================

describe('CapabilityProfile Management', () => {
  let detector: CapabilityDetector

  beforeEach(() => {
    detector = createCapabilityDetector()
  })

  describe('profile registration', () => {
    it('registers a capability profile', () => {
      const profile: CapabilityProfile = {
        sourceName: 'test-source',
        sourceType: 'sqlite',
        predicates: {
          supportedOperators: [PredicateOperator.EQUALS],
          supportsCompoundPredicates: true,
          supportsNestedPredicates: true,
          maxPredicateDepth: 10,
        },
        projections: { supported: true },
        aggregations: { supportedFunctions: [], supportsGroupBy: false },
        joins: { supportedTypes: [], supportsMultiWayJoin: false },
        sorting: { supported: true, maxSortColumns: 10 },
        pagination: { supportsLimit: true, supportsOffset: true },
      }

      detector.registerProfile(profile)

      expect(detector.hasProfile('test-source')).toBe(true)
      expect(detector.getProfile('test-source')).toEqual(profile)
    })

    it('updates existing profile', () => {
      const profile1: CapabilityProfile = {
        sourceName: 'test-source',
        sourceType: 'sqlite',
        predicates: {
          supportedOperators: [PredicateOperator.EQUALS],
          supportsCompoundPredicates: true,
          supportsNestedPredicates: true,
          maxPredicateDepth: 10,
        },
        projections: { supported: true },
        aggregations: { supportedFunctions: [], supportsGroupBy: false },
        joins: { supportedTypes: [], supportsMultiWayJoin: false },
        sorting: { supported: true, maxSortColumns: 10 },
        pagination: { supportsLimit: true, supportsOffset: true },
      }

      const profile2: CapabilityProfile = {
        ...profile1,
        predicates: {
          ...profile1.predicates,
          supportedOperators: [PredicateOperator.EQUALS, PredicateOperator.LIKE],
        },
      }

      detector.registerProfile(profile1)
      detector.registerProfile(profile2)

      const retrieved = detector.getProfile('test-source')
      expect(retrieved?.predicates.supportedOperators).toContain(PredicateOperator.LIKE)
    })

    it('removes a profile', () => {
      const profile: CapabilityProfile = {
        sourceName: 'removable',
        sourceType: 'memory',
        predicates: {
          supportedOperators: [],
          supportsCompoundPredicates: false,
          supportsNestedPredicates: false,
          maxPredicateDepth: 1,
        },
        projections: { supported: true },
        aggregations: { supportedFunctions: [], supportsGroupBy: false },
        joins: { supportedTypes: [], supportsMultiWayJoin: false },
        sorting: { supported: false },
        pagination: { supportsLimit: true, supportsOffset: false },
      }

      detector.registerProfile(profile)
      expect(detector.hasProfile('removable')).toBe(true)

      detector.removeProfile('removable')
      expect(detector.hasProfile('removable')).toBe(false)
    })

    it('lists all registered profiles', () => {
      detector.registerProfile({
        sourceName: 'source-1',
        sourceType: 'sqlite',
        predicates: { supportedOperators: [], supportsCompoundPredicates: false, supportsNestedPredicates: false, maxPredicateDepth: 1 },
        projections: { supported: true },
        aggregations: { supportedFunctions: [], supportsGroupBy: false },
        joins: { supportedTypes: [], supportsMultiWayJoin: false },
        sorting: { supported: false },
        pagination: { supportsLimit: true, supportsOffset: false },
      })
      detector.registerProfile({
        sourceName: 'source-2',
        sourceType: 'postgres',
        predicates: { supportedOperators: [], supportsCompoundPredicates: false, supportsNestedPredicates: false, maxPredicateDepth: 1 },
        projections: { supported: true },
        aggregations: { supportedFunctions: [], supportsGroupBy: false },
        joins: { supportedTypes: [], supportsMultiWayJoin: false },
        sorting: { supported: false },
        pagination: { supportsLimit: true, supportsOffset: false },
      })

      const profiles = detector.listProfiles()
      expect(profiles).toHaveLength(2)
      expect(profiles.map(p => p.sourceName)).toContain('source-1')
      expect(profiles.map(p => p.sourceName)).toContain('source-2')
    })
  })

  describe('default profiles', () => {
    it('provides SQLite default profile', () => {
      const profile = detector.getDefaultProfile('sqlite')

      expect(profile.sourceType).toBe('sqlite')
      expect(profile.predicates.supportedOperators).toContain(PredicateOperator.EQUALS)
      expect(profile.aggregations.supportedFunctions).toContain(AggregationFunction.COUNT)
      expect(profile.joins.supportedTypes).toContain(JoinType.INNER)
    })

    it('provides PostgreSQL default profile', () => {
      const profile = detector.getDefaultProfile('postgres')

      expect(profile.sourceType).toBe('postgres')
      expect(profile.predicates.supportedOperators).toContain(PredicateOperator.ILIKE)
      expect(profile.aggregations.supportsWindowFunctions).toBe(true)
      expect(profile.aggregations.supportsRollup).toBe(true)
    })

    it('provides Memory default profile', () => {
      const profile = detector.getDefaultProfile('memory')

      expect(profile.sourceType).toBe('memory')
      expect(profile.joins.supportsMultiWayJoin).toBe(false)
      expect(profile.aggregations.supportsPushdown).toBe(false)
    })

    it('provides REST API default profile', () => {
      const profile = detector.getDefaultProfile('rest')

      expect(profile.sourceType).toBe('rest')
      // REST typically has limited query capabilities
      expect(profile.joins.supportedTypes).toHaveLength(0)
    })

    it('provides Durable Object default profile', () => {
      const profile = detector.getDefaultProfile('durable-object')

      expect(profile.sourceType).toBe('durable-object')
    })
  })
})

// =============================================================================
// 6. Capability Negotiation Tests
// =============================================================================

describe('Capability Negotiation', () => {
  let detector: CapabilityDetector

  beforeEach(() => {
    detector = createCapabilityDetector()

    // Register a few test profiles
    detector.registerProfile({
      sourceName: 'full-sql',
      sourceType: 'postgres',
      predicates: {
        supportedOperators: [
          PredicateOperator.EQUALS,
          PredicateOperator.LIKE,
          PredicateOperator.IN,
          PredicateOperator.BETWEEN,
        ],
        supportsCompoundPredicates: true,
        supportsNestedPredicates: true,
        maxPredicateDepth: 20,
      },
      projections: { supported: true },
      aggregations: {
        supportedFunctions: [
          AggregationFunction.COUNT,
          AggregationFunction.SUM,
          AggregationFunction.AVG,
        ],
        supportsGroupBy: true,
        supportsHaving: true,
        supportsPushdown: true,
      },
      joins: {
        supportedTypes: [JoinType.INNER, JoinType.LEFT, JoinType.RIGHT],
        supportsMultiWayJoin: true,
        maxJoinTables: 10,
        supportsPushdown: true,
      },
      sorting: { supported: true, maxSortColumns: 10 },
      pagination: { supportsLimit: true, supportsOffset: true },
    })

    detector.registerProfile({
      sourceName: 'limited-memory',
      sourceType: 'memory',
      predicates: {
        supportedOperators: [PredicateOperator.EQUALS, PredicateOperator.IN],
        supportsCompoundPredicates: true,
        supportsNestedPredicates: false,
        maxPredicateDepth: 1,
        maxInListSize: 100,
      },
      projections: { supported: true },
      aggregations: {
        supportedFunctions: [],
        supportsGroupBy: false,
      },
      joins: {
        supportedTypes: [],
        supportsMultiWayJoin: false,
      },
      sorting: { supported: false },
      pagination: { supportsLimit: true, supportsOffset: false },
    })
  })

  describe('query requirements matching', () => {
    it('negotiates predicate requirements', () => {
      const requirements = {
        predicates: [
          { operator: PredicateOperator.EQUALS },
          { operator: PredicateOperator.LIKE },
        ],
      }

      const result = detector.negotiate('full-sql', requirements)

      expect(result.supported).toBe(true)
      expect(result.unsupportedFeatures).toHaveLength(0)
    })

    it('identifies unsupported predicates', () => {
      const requirements = {
        predicates: [
          { operator: PredicateOperator.EQUALS },
          { operator: PredicateOperator.REGEX },
        ],
      }

      const result = detector.negotiate('full-sql', requirements)

      expect(result.supported).toBe(false)
      expect(result.unsupportedFeatures).toContain('predicate:REGEX')
    })

    it('negotiates aggregation requirements', () => {
      const requirements = {
        aggregations: [
          { function: AggregationFunction.COUNT },
          { function: AggregationFunction.SUM },
        ],
        groupBy: ['column1', 'column2'],
      }

      const result = detector.negotiate('full-sql', requirements)

      expect(result.supported).toBe(true)
    })

    it('identifies unsupported aggregations', () => {
      const requirements = {
        aggregations: [{ function: AggregationFunction.COUNT }],
        groupBy: ['column1'],
      }

      const result = detector.negotiate('limited-memory', requirements)

      expect(result.supported).toBe(false)
      expect(result.unsupportedFeatures).toContain('groupBy')
    })

    it('negotiates join requirements', () => {
      const requirements = {
        joins: [{ type: JoinType.INNER }, { type: JoinType.LEFT }],
      }

      const result = detector.negotiate('full-sql', requirements)

      expect(result.supported).toBe(true)
    })

    it('identifies unsupported join types', () => {
      const requirements = {
        joins: [{ type: JoinType.INNER }],
      }

      const result = detector.negotiate('limited-memory', requirements)

      expect(result.supported).toBe(false)
      expect(result.unsupportedFeatures).toContain('join:INNER')
    })
  })

  describe('pushdown recommendations', () => {
    it('returns pushdown recommendation for full capability', () => {
      const requirements = {
        predicates: [{ operator: PredicateOperator.EQUALS }],
        aggregations: [{ function: AggregationFunction.COUNT }],
        groupBy: ['column1'],
      }

      const result = detector.negotiate('full-sql', requirements)

      expect(result.canPushdown).toBe(true)
      expect(result.pushdownCapabilities?.predicates).toBe(true)
      expect(result.pushdownCapabilities?.aggregations).toBe(true)
    })

    it('returns partial pushdown recommendation', () => {
      const requirements = {
        predicates: [{ operator: PredicateOperator.EQUALS }],
        limit: 100,
      }

      const result = detector.negotiate('limited-memory', requirements)

      expect(result.supported).toBe(true)
      expect(result.pushdownCapabilities?.predicates).toBe(true)
      expect(result.pushdownCapabilities?.limit).toBe(true)
      expect(result.pushdownCapabilities?.offset).toBe(false)
    })

    it('identifies residual operations', () => {
      const requirements = {
        predicates: [
          { operator: PredicateOperator.EQUALS },
          { operator: PredicateOperator.LIKE },
        ],
      }

      const result = detector.negotiate('limited-memory', requirements)

      expect(result.supported).toBe(false)
      expect(result.residualOperations).toContain('predicate:LIKE')
    })
  })

  describe('multi-source negotiation', () => {
    it('finds common capabilities across sources', () => {
      const commonCaps = detector.findCommonCapabilities(['full-sql', 'limited-memory'])

      expect(commonCaps.predicates.supportedOperators).toContain(PredicateOperator.EQUALS)
      expect(commonCaps.predicates.supportedOperators).toContain(PredicateOperator.IN)
      expect(commonCaps.predicates.supportedOperators).not.toContain(PredicateOperator.LIKE)
    })

    it('returns best source for a query', () => {
      const requirements = {
        predicates: [{ operator: PredicateOperator.EQUALS }],
        aggregations: [{ function: AggregationFunction.COUNT }],
        groupBy: ['column1'],
      }

      const bestSource = detector.findBestSource(['full-sql', 'limited-memory'], requirements)

      expect(bestSource).toBe('full-sql')
    })

    it('ranks sources by capability match', () => {
      const requirements = {
        predicates: [{ operator: PredicateOperator.EQUALS }],
      }

      const ranked = detector.rankSources(['full-sql', 'limited-memory'], requirements)

      expect(ranked).toHaveLength(2)
      expect(ranked[0]?.sourceName).toBe('full-sql')
      expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0)
    })
  })
})

// =============================================================================
// 7. Query Planner Integration Tests
// =============================================================================

describe('Query Planner Integration', () => {
  let detector: CapabilityDetector

  beforeEach(() => {
    detector = createCapabilityDetector()

    detector.registerProfile({
      sourceName: 'orders-db',
      sourceType: 'postgres',
      predicates: {
        supportedOperators: [
          PredicateOperator.EQUALS,
          PredicateOperator.GREATER_THAN,
          PredicateOperator.LESS_THAN,
          PredicateOperator.IN,
          PredicateOperator.BETWEEN,
        ],
        supportsCompoundPredicates: true,
        supportsNestedPredicates: true,
        maxPredicateDepth: 10,
      },
      projections: { supported: true },
      aggregations: {
        supportedFunctions: [
          AggregationFunction.COUNT,
          AggregationFunction.SUM,
          AggregationFunction.AVG,
        ],
        supportsGroupBy: true,
        supportsHaving: true,
        supportsPushdown: true,
      },
      joins: {
        supportedTypes: [JoinType.INNER, JoinType.LEFT],
        supportsMultiWayJoin: true,
        maxJoinTables: 5,
        supportsPushdown: true,
      },
      sorting: { supported: true, maxSortColumns: 5 },
      pagination: { supportsLimit: true, supportsOffset: true },
    })

    detector.registerProfile({
      sourceName: 'users-cache',
      sourceType: 'memory',
      predicates: {
        supportedOperators: [PredicateOperator.EQUALS],
        supportsCompoundPredicates: false,
        supportsNestedPredicates: false,
        maxPredicateDepth: 1,
      },
      projections: { supported: true },
      aggregations: {
        supportedFunctions: [],
        supportsGroupBy: false,
      },
      joins: {
        supportedTypes: [],
        supportsMultiWayJoin: false,
      },
      sorting: { supported: false },
      pagination: { supportsLimit: true, supportsOffset: false },
    })
  })

  describe('smart routing decisions', () => {
    it('routes complex aggregation queries to capable sources', () => {
      const query = {
        from: [{ source: 'orders-db', table: 'orders' }],
        aggregations: [{ function: AggregationFunction.SUM, column: 'amount', alias: 'total' }],
        groupBy: ['customer_id'],
      }

      const routingDecision = detector.getRoutingDecision(query)

      expect(routingDecision.primarySource).toBe('orders-db')
      expect(routingDecision.canPushdownAggregation).toBe(true)
    })

    it('routes simple lookups to fast sources', () => {
      const query = {
        from: [{ source: 'users-cache', table: 'users' }],
        predicates: [{ column: 'id', op: '=' as const, value: '123' }],
        limit: 1,
      }

      const routingDecision = detector.getRoutingDecision(query)

      expect(routingDecision.primarySource).toBe('users-cache')
      expect(routingDecision.canPushdownPredicate).toBe(true)
    })

    it('suggests join strategy based on capabilities', () => {
      const query = {
        from: [
          { source: 'orders-db', table: 'orders' },
          { source: 'users-cache', table: 'users' },
        ],
        join: { type: 'INNER' as const, on: { left: 'orders.user_id', right: 'users.id' } },
      }

      const routingDecision = detector.getRoutingDecision(query)

      // Since users-cache doesn't support joins, should suggest coordinator join
      expect(routingDecision.joinStrategy).toBe('coordinator')
      expect(routingDecision.joinExecutionPlan).toBeDefined()
    })

    it('identifies when predicate pushdown is partial', () => {
      const query = {
        from: [{ source: 'users-cache', table: 'users' }],
        predicates: [
          { column: 'id', op: '=' as const, value: '123' },
          { column: 'name', op: 'LIKE' as const, value: '%john%' },
        ],
      }

      const routingDecision = detector.getRoutingDecision(query)

      expect(routingDecision.canPushdownPredicate).toBe(false) // Partial
      expect(routingDecision.pushdownPredicates).toHaveLength(1)
      expect(routingDecision.residualPredicates).toHaveLength(1)
    })
  })

  describe('execution plan generation', () => {
    it('generates execution plan with capability-aware pushdown', () => {
      const query = {
        from: [{ source: 'orders-db', table: 'orders' }],
        predicates: [{ column: 'status', op: '=' as const, value: 'completed' }],
        aggregations: [{ function: AggregationFunction.COUNT, alias: 'count' }],
        groupBy: ['customer_id'],
        orderBy: [{ column: 'count', direction: 'DESC' as const }],
        limit: 10,
      }

      const plan = detector.generateExecutionPlan(query)

      expect(plan.fragments).toHaveLength(1)
      expect(plan.fragments[0]?.pushdown.predicates).toHaveLength(1)
      expect(plan.fragments[0]?.pushdown.aggregations).toHaveLength(1)
      expect(plan.fragments[0]?.pushdown.groupBy).toEqual(['customer_id'])
    })

    it('splits query when source cannot handle all operations', () => {
      const query = {
        from: [{ source: 'users-cache', table: 'users' }],
        predicates: [{ column: 'id', op: '=' as const, value: '123' }],
        orderBy: [{ column: 'name', direction: 'ASC' as const }],
        limit: 10,
      }

      const plan = detector.generateExecutionPlan(query)

      expect(plan.fragments[0]?.pushdown.predicates).toHaveLength(1)
      expect(plan.postProcessing?.sort).toBe(true)
      expect(plan.postProcessing?.limit).toBe(10)
    })
  })
})

// =============================================================================
// 8. Dynamic Capability Discovery Tests
// =============================================================================

describe('Dynamic Capability Discovery', () => {
  let detector: CapabilityDetector

  beforeEach(() => {
    detector = createCapabilityDetector()
  })

  describe('capability probing', () => {
    it('probes source for capability by testing operations', async () => {
      // Mock a source adapter that we can probe
      const mockAdapter = {
        capabilities: () => ({
          predicatePushdown: true,
          projectionPushdown: true,
          limitPushdown: true,
          aggregationPushdown: true,
          joinPushdown: true,
          supportedOperators: ['=', '!=', '>', '<', 'LIKE'],
        }),
        execute: async () => ({ rows: [] }),
        stream: async function* () {
          yield []
        },
      }

      const discovered = await detector.discoverCapabilities('test-source', mockAdapter)

      expect(discovered.predicates.supportedOperators).toContain(PredicateOperator.EQUALS)
      expect(discovered.predicates.supportedOperators).toContain(PredicateOperator.LIKE)
    })

    it('handles capability probe failures gracefully', async () => {
      const failingAdapter = {
        capabilities: () => {
          throw new Error('Capability query not supported')
        },
        execute: async () => ({ rows: [] }),
        stream: async function* () {
          yield []
        },
      }

      const discovered = await detector.discoverCapabilities('failing-source', failingAdapter)

      // Should return minimal safe defaults
      expect(discovered.predicates.supportedOperators).toContain(PredicateOperator.EQUALS)
      expect(discovered.aggregations.supportedFunctions).toHaveLength(0)
    })
  })

  describe('capability caching', () => {
    it('caches discovered capabilities', async () => {
      let probeCount = 0
      const trackingAdapter = {
        capabilities: () => {
          probeCount++
          return { predicatePushdown: true }
        },
        execute: async () => ({ rows: [] }),
        stream: async function* () {
          yield []
        },
      }

      await detector.discoverCapabilities('cached-source', trackingAdapter)
      await detector.discoverCapabilities('cached-source', trackingAdapter)

      expect(probeCount).toBe(1) // Should only probe once
    })

    it('invalidates cache on request', async () => {
      let probeCount = 0
      const trackingAdapter = {
        capabilities: () => {
          probeCount++
          return { predicatePushdown: true }
        },
        execute: async () => ({ rows: [] }),
        stream: async function* () {
          yield []
        },
      }

      await detector.discoverCapabilities('cached-source', trackingAdapter)
      detector.invalidateCache('cached-source')
      await detector.discoverCapabilities('cached-source', trackingAdapter)

      expect(probeCount).toBe(2)
    })

    it('refreshes capabilities after TTL', async () => {
      const shortTtlDetector = createCapabilityDetector({ cacheTtlMs: 100 })

      let probeCount = 0
      const trackingAdapter = {
        capabilities: () => {
          probeCount++
          return { predicatePushdown: true }
        },
        execute: async () => ({ rows: [] }),
        stream: async function* () {
          yield []
        },
      }

      await shortTtlDetector.discoverCapabilities('ttl-source', trackingAdapter)
      await new Promise((r) => setTimeout(r, 150))
      await shortTtlDetector.discoverCapabilities('ttl-source', trackingAdapter)

      expect(probeCount).toBe(2)
    })
  })
})

// =============================================================================
// 9. Factory Function Tests
// =============================================================================

describe('Factory Function', () => {
  it('createCapabilityDetector creates instance with defaults', () => {
    const detector = createCapabilityDetector()

    expect(detector).toBeDefined()
    expect(detector.registerProfile).toBeInstanceOf(Function)
    expect(detector.negotiate).toBeInstanceOf(Function)
  })

  it('createCapabilityDetector accepts custom options', () => {
    const detector = createCapabilityDetector({
      cacheTtlMs: 60000,
      defaultSourceType: 'postgres',
    })

    expect(detector).toBeDefined()
  })

  it('multiple detector instances are independent', () => {
    const detector1 = createCapabilityDetector()
    const detector2 = createCapabilityDetector()

    detector1.registerProfile({
      sourceName: 'only-in-d1',
      sourceType: 'memory',
      predicates: { supportedOperators: [], supportsCompoundPredicates: false, supportsNestedPredicates: false, maxPredicateDepth: 1 },
      projections: { supported: true },
      aggregations: { supportedFunctions: [], supportsGroupBy: false },
      joins: { supportedTypes: [], supportsMultiWayJoin: false },
      sorting: { supported: false },
      pagination: { supportsLimit: true, supportsOffset: false },
    })

    expect(detector1.hasProfile('only-in-d1')).toBe(true)
    expect(detector2.hasProfile('only-in-d1')).toBe(false)
  })
})

// =============================================================================
// 10. Edge Cases and Error Handling
// =============================================================================

describe('Edge Cases and Error Handling', () => {
  let detector: CapabilityDetector

  beforeEach(() => {
    detector = createCapabilityDetector()
  })

  it('handles unknown source gracefully', () => {
    expect(detector.hasProfile('nonexistent')).toBe(false)
    expect(detector.getProfile('nonexistent')).toBeUndefined()
  })

  it('handles empty requirements in negotiation', () => {
    detector.registerProfile({
      sourceName: 'test',
      sourceType: 'memory',
      predicates: { supportedOperators: [], supportsCompoundPredicates: false, supportsNestedPredicates: false, maxPredicateDepth: 1 },
      projections: { supported: true },
      aggregations: { supportedFunctions: [], supportsGroupBy: false },
      joins: { supportedTypes: [], supportsMultiWayJoin: false },
      sorting: { supported: false },
      pagination: { supportsLimit: true, supportsOffset: false },
    })

    const result = detector.negotiate('test', {})

    expect(result.supported).toBe(true)
    expect(result.unsupportedFeatures).toHaveLength(0)
  })

  it('handles null/undefined values in profile', () => {
    const profile: CapabilityProfile = {
      sourceName: 'partial',
      sourceType: 'memory',
      predicates: {
        supportedOperators: [],
        supportsCompoundPredicates: false,
        supportsNestedPredicates: false,
        maxPredicateDepth: 1,
      },
      projections: { supported: true },
      aggregations: { supportedFunctions: [], supportsGroupBy: false },
      joins: { supportedTypes: [], supportsMultiWayJoin: false },
      sorting: { supported: false },
      pagination: { supportsLimit: true, supportsOffset: false },
    }

    expect(() => detector.registerProfile(profile)).not.toThrow()
  })

  it('handles very large IN list size requirements', () => {
    detector.registerProfile({
      sourceName: 'limited',
      sourceType: 'memory',
      predicates: {
        supportedOperators: [PredicateOperator.IN],
        supportsCompoundPredicates: false,
        supportsNestedPredicates: false,
        maxPredicateDepth: 1,
        maxInListSize: 100,
      },
      projections: { supported: true },
      aggregations: { supportedFunctions: [], supportsGroupBy: false },
      joins: { supportedTypes: [], supportsMultiWayJoin: false },
      sorting: { supported: false },
      pagination: { supportsLimit: true, supportsOffset: false },
    })

    const result = detector.negotiate('limited', {
      predicates: [{ operator: PredicateOperator.IN, inListSize: 10000 }],
    })

    expect(result.supported).toBe(false)
    expect(result.unsupportedFeatures).toContain('inListSize:10000')
  })

  it('handles deeply nested predicate requirements', () => {
    detector.registerProfile({
      sourceName: 'shallow',
      sourceType: 'memory',
      predicates: {
        supportedOperators: [PredicateOperator.EQUALS],
        supportsCompoundPredicates: true,
        supportsNestedPredicates: true,
        maxPredicateDepth: 3,
      },
      projections: { supported: true },
      aggregations: { supportedFunctions: [], supportsGroupBy: false },
      joins: { supportedTypes: [], supportsMultiWayJoin: false },
      sorting: { supported: false },
      pagination: { supportsLimit: true, supportsOffset: false },
    })

    const result = detector.negotiate('shallow', {
      predicateDepth: 10,
    })

    expect(result.supported).toBe(false)
    expect(result.unsupportedFeatures).toContain('predicateDepth:10')
  })
})
