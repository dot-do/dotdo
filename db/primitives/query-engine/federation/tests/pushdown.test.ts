/**
 * RED Phase: Predicate Pushdown Tests
 *
 * Tests for predicate pushdown rules in the query federation optimizer.
 * Pushdown allows pushing WHERE clauses to data sources that support them.
 *
 * @see dotdo-43oni
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  PredicatePushdown,
  type PushdownRule,
  type DataSourceCapabilities,
  type PushdownResult,
} from '../pushdown'
import {
  eq,
  gt,
  gte,
  lt,
  lte,
  neq,
  inSet,
  notInSet,
  like,
  between,
  isNull,
  isNotNull,
  and,
  or,
  not,
  type PredicateNode,
  type LogicalNode,
  type QueryNode,
} from '../../ast'

describe('PredicatePushdown', () => {
  let pushdown: PredicatePushdown

  beforeEach(() => {
    pushdown = new PredicatePushdown()
  })

  describe('analyzePredicates', () => {
    it('should identify a single equality predicate', () => {
      const predicate = eq('name', 'Alice')
      const analysis = pushdown.analyzePredicates(predicate)

      expect(analysis.predicates).toHaveLength(1)
      expect(analysis.predicates[0].column).toBe('name')
      expect(analysis.predicates[0].op).toBe('=')
    })

    it('should extract all predicates from AND clauses', () => {
      const predicate = and(
        eq('status', 'active'),
        gt('age', 18),
        lt('score', 100)
      )
      const analysis = pushdown.analyzePredicates(predicate)

      expect(analysis.predicates).toHaveLength(3)
      expect(analysis.predicates.map(p => p.column)).toEqual(['status', 'age', 'score'])
    })

    it('should handle nested AND clauses', () => {
      const predicate = and(
        and(eq('a', 1), eq('b', 2)),
        eq('c', 3)
      )
      const analysis = pushdown.analyzePredicates(predicate)

      expect(analysis.predicates).toHaveLength(3)
    })

    it('should mark OR clauses as non-decomposable', () => {
      const predicate = or(
        eq('status', 'active'),
        eq('status', 'pending')
      )
      const analysis = pushdown.analyzePredicates(predicate)

      expect(analysis.isDecomposable).toBe(false)
      // The whole OR predicate is treated as a single unit
      expect(analysis.logicalNode).toBeDefined()
    })

    it('should identify columns referenced in predicates', () => {
      const predicate = and(
        eq('users.name', 'Alice'),
        gt('users.age', 21),
        eq('orders.status', 'shipped')
      )
      const analysis = pushdown.analyzePredicates(predicate)

      expect(analysis.columns).toContain('users.name')
      expect(analysis.columns).toContain('users.age')
      expect(analysis.columns).toContain('orders.status')
    })

    it('should handle comparison operators', () => {
      const predicate = and(
        gt('price', 10),
        gte('quantity', 1),
        lt('discount', 50),
        lte('age', 100),
        neq('status', 'deleted')
      )
      const analysis = pushdown.analyzePredicates(predicate)

      expect(analysis.predicates).toHaveLength(5)
      expect(analysis.predicates.map(p => p.op)).toEqual(['>', '>=', '<', '<=', '!='])
    })

    it('should handle special predicates (IN, LIKE, BETWEEN, NULL)', () => {
      const predicate = and(
        inSet('category', ['A', 'B', 'C']),
        like('name', '%Smith%'),
        between('price', 10, 100),
        isNull('deleted_at')
      )
      const analysis = pushdown.analyzePredicates(predicate)

      expect(analysis.predicates).toHaveLength(4)
      expect(analysis.predicates.map(p => p.op)).toEqual(['IN', 'LIKE', 'BETWEEN', 'IS NULL'])
    })
  })

  describe('canPushToSource', () => {
    it('should allow equality pushdown for sources supporting equality', () => {
      const predicate = eq('name', 'Alice')
      const capabilities: DataSourceCapabilities = {
        supportedOperators: ['=', '!=', '>', '<', '>=', '<='],
        supportedTypes: ['string', 'number', 'boolean'],
      }

      expect(pushdown.canPushToSource(predicate, capabilities)).toBe(true)
    })

    it('should reject operators not supported by source', () => {
      const predicate = like('name', '%Alice%')
      const capabilities: DataSourceCapabilities = {
        supportedOperators: ['=', '!='],
        supportedTypes: ['string'],
      }

      expect(pushdown.canPushToSource(predicate, capabilities)).toBe(false)
    })

    it('should reject pushdown for unsupported value types', () => {
      const predicate = eq('data', { nested: 'object' })
      const capabilities: DataSourceCapabilities = {
        supportedOperators: ['='],
        supportedTypes: ['string', 'number'],
      }

      expect(pushdown.canPushToSource(predicate, capabilities)).toBe(false)
    })

    it('should handle IN with array values', () => {
      const predicate = inSet('status', ['active', 'pending'])
      const capabilities: DataSourceCapabilities = {
        supportedOperators: ['=', 'IN'],
        supportedTypes: ['string', 'array'],
      }

      expect(pushdown.canPushToSource(predicate, capabilities)).toBe(true)
    })

    it('should reject IN when source does not support arrays', () => {
      const predicate = inSet('status', ['active', 'pending'])
      const capabilities: DataSourceCapabilities = {
        supportedOperators: ['=', 'IN'],
        supportedTypes: ['string'], // No array support
      }

      expect(pushdown.canPushToSource(predicate, capabilities)).toBe(false)
    })

    it('should check column availability in source schema', () => {
      const predicate = eq('non_existent_column', 'value')
      const capabilities: DataSourceCapabilities = {
        supportedOperators: ['='],
        supportedTypes: ['string'],
        availableColumns: ['name', 'age', 'status'],
      }

      expect(pushdown.canPushToSource(predicate, capabilities)).toBe(false)
    })

    it('should allow pushdown when column is available', () => {
      const predicate = eq('name', 'Alice')
      const capabilities: DataSourceCapabilities = {
        supportedOperators: ['='],
        supportedTypes: ['string'],
        availableColumns: ['name', 'age', 'status'],
      }

      expect(pushdown.canPushToSource(predicate, capabilities)).toBe(true)
    })

    it('should handle logical AND with mixed support', () => {
      const predicate = and(
        eq('name', 'Alice'),
        like('bio', '%developer%')
      )
      const capabilities: DataSourceCapabilities = {
        supportedOperators: ['='], // No LIKE support
        supportedTypes: ['string'],
        supportsLogical: ['AND'],
      }

      // AND as a whole can't be pushed, but individual predicates can be evaluated
      const result = pushdown.canPushToSource(predicate, capabilities)
      expect(result).toBe(false) // Whole AND can't be pushed
    })

    it('should allow OR pushdown when source supports it', () => {
      const predicate = or(
        eq('status', 'active'),
        eq('status', 'pending')
      )
      const capabilities: DataSourceCapabilities = {
        supportedOperators: ['='],
        supportedTypes: ['string'],
        supportsLogical: ['OR', 'AND'],
      }

      expect(pushdown.canPushToSource(predicate, capabilities)).toBe(true)
    })

    it('should reject OR pushdown when source does not support it', () => {
      const predicate = or(
        eq('status', 'active'),
        eq('status', 'pending')
      )
      const capabilities: DataSourceCapabilities = {
        supportedOperators: ['='],
        supportedTypes: ['string'],
        supportsLogical: ['AND'], // No OR support
      }

      expect(pushdown.canPushToSource(predicate, capabilities)).toBe(false)
    })
  })

  describe('splitPredicates', () => {
    it('should split predicates into pushable and non-pushable', () => {
      const predicate = and(
        eq('name', 'Alice'),       // pushable
        like('bio', '%dev%'),      // not pushable
        gt('age', 18)              // pushable
      )
      const capabilities: DataSourceCapabilities = {
        supportedOperators: ['=', '>', '<', '>=', '<='],
        supportedTypes: ['string', 'number'],
      }

      const result = pushdown.splitPredicates(predicate, capabilities)

      expect(result.pushable).toHaveLength(2)
      expect(result.remaining).toHaveLength(1)
      expect(result.pushable.map(p => p.column)).toEqual(['name', 'age'])
      expect(result.remaining.map(p => p.column)).toEqual(['bio'])
    })

    it('should return all predicates as pushable when all are supported', () => {
      const predicate = and(
        eq('name', 'Alice'),
        gt('age', 18)
      )
      const capabilities: DataSourceCapabilities = {
        supportedOperators: ['=', '>'],
        supportedTypes: ['string', 'number'],
      }

      const result = pushdown.splitPredicates(predicate, capabilities)

      expect(result.pushable).toHaveLength(2)
      expect(result.remaining).toHaveLength(0)
    })

    it('should return all predicates as remaining when none are supported', () => {
      const predicate = and(
        like('name', '%Alice%'),
        between('price', 10, 100)
      )
      const capabilities: DataSourceCapabilities = {
        supportedOperators: ['='],
        supportedTypes: ['string'],
      }

      const result = pushdown.splitPredicates(predicate, capabilities)

      expect(result.pushable).toHaveLength(0)
      expect(result.remaining).toHaveLength(2)
    })

    it('should handle OR as a single unit', () => {
      const predicate = and(
        eq('status', 'active'),
        or(
          eq('role', 'admin'),
          eq('role', 'moderator')
        )
      )
      const capabilities: DataSourceCapabilities = {
        supportedOperators: ['='],
        supportedTypes: ['string'],
        supportsLogical: ['AND'], // No OR
      }

      const result = pushdown.splitPredicates(predicate, capabilities)

      // equality can be pushed, OR cannot
      expect(result.pushable).toHaveLength(1)
      expect(result.pushable[0].column).toBe('status')
      expect(result.remainingLogical).toBeDefined()
    })

    it('should preserve original predicate structure for complex queries', () => {
      const predicate = and(
        eq('a', 1),
        eq('b', 2),
        not(eq('c', 3))
      )
      const capabilities: DataSourceCapabilities = {
        supportedOperators: ['='],
        supportedTypes: ['number'],
        supportsLogical: ['AND'], // No NOT
      }

      const result = pushdown.splitPredicates(predicate, capabilities)

      expect(result.pushable).toHaveLength(2)
      expect(result.remainingLogical).toBeDefined()
    })
  })

  describe('optimizeQuery', () => {
    it('should rewrite query with pushed predicates', () => {
      const query = {
        type: 'select' as const,
        from: 'users',
        where: eq('status', 'active'),
      }
      const capabilities: DataSourceCapabilities = {
        supportedOperators: ['='],
        supportedTypes: ['string'],
      }

      const result = pushdown.optimizeQuery(query as unknown as QueryNode, 'users', capabilities)

      expect(result.pushedPredicates).toHaveLength(1)
      expect(result.localPredicates).toHaveLength(0)
      expect(result.optimizedQuery).toBeDefined()
    })

    it('should keep non-pushable predicates for local filtering', () => {
      const query = {
        type: 'select' as const,
        from: 'users',
        where: and(
          eq('status', 'active'),
          like('name', '%Alice%')
        ),
      }
      const capabilities: DataSourceCapabilities = {
        supportedOperators: ['='],
        supportedTypes: ['string'],
      }

      const result = pushdown.optimizeQuery(query as unknown as QueryNode, 'users', capabilities)

      expect(result.pushedPredicates).toHaveLength(1)
      expect(result.localPredicates).toHaveLength(1)
      expect(result.localPredicates[0].column).toBe('name')
    })

    it('should handle multi-source queries with table-specific predicates', () => {
      const query = {
        type: 'select' as const,
        from: 'orders',
        join: {
          table: 'users',
          on: eq('orders.user_id', 'users.id'),
        },
        where: and(
          eq('orders.status', 'shipped'),
          eq('users.country', 'US')
        ),
      }
      const ordersCapabilities: DataSourceCapabilities = {
        supportedOperators: ['='],
        supportedTypes: ['string'],
        availableColumns: ['status', 'user_id', 'amount'],
      }

      const result = pushdown.optimizeQuery(
        query as unknown as QueryNode,
        'orders',
        ordersCapabilities
      )

      // Only orders predicates should be pushed to orders source
      expect(result.pushedPredicates.some(p => p.column === 'orders.status')).toBe(true)
      expect(result.pushedPredicates.some(p => p.column === 'users.country')).toBe(false)
    })

    it('should compute cost savings estimate', () => {
      const query = {
        type: 'select' as const,
        from: 'large_table',
        where: eq('indexed_column', 'specific_value'),
      }
      const capabilities: DataSourceCapabilities = {
        supportedOperators: ['='],
        supportedTypes: ['string'],
        estimatedSelectivity: 0.01, // 1% of rows match
      }

      const result = pushdown.optimizeQuery(
        query as unknown as QueryNode,
        'large_table',
        capabilities
      )

      expect(result.estimatedSavings).toBeGreaterThan(0)
    })
  })

  describe('built-in rules', () => {
    it('should have equality rule that handles = and != operators', () => {
      const rules = pushdown.getBuiltInRules()
      const equalityRule = rules.find(r => r.name === 'equality')

      expect(equalityRule).toBeDefined()
      expect(equalityRule!.operators).toContain('=')
      expect(equalityRule!.operators).toContain('!=')
    })

    it('should have comparison rule that handles >, <, >=, <= operators', () => {
      const rules = pushdown.getBuiltInRules()
      const comparisonRule = rules.find(r => r.name === 'comparison')

      expect(comparisonRule).toBeDefined()
      expect(comparisonRule!.operators).toContain('>')
      expect(comparisonRule!.operators).toContain('<')
      expect(comparisonRule!.operators).toContain('>=')
      expect(comparisonRule!.operators).toContain('<=')
    })

    it('should have IN rule that handles IN and NOT IN operators', () => {
      const rules = pushdown.getBuiltInRules()
      const inRule = rules.find(r => r.name === 'in')

      expect(inRule).toBeDefined()
      expect(inRule!.operators).toContain('IN')
      expect(inRule!.operators).toContain('NOT IN')
    })

    it('should have LIKE rule that handles pattern matching', () => {
      const rules = pushdown.getBuiltInRules()
      const likeRule = rules.find(r => r.name === 'like')

      expect(likeRule).toBeDefined()
      expect(likeRule!.operators).toContain('LIKE')
    })

    it('should have NULL rule that handles IS NULL and IS NOT NULL', () => {
      const rules = pushdown.getBuiltInRules()
      const nullRule = rules.find(r => r.name === 'null')

      expect(nullRule).toBeDefined()
      expect(nullRule!.operators).toContain('IS NULL')
      expect(nullRule!.operators).toContain('IS NOT NULL')
    })

    it('should have BETWEEN rule', () => {
      const rules = pushdown.getBuiltInRules()
      const betweenRule = rules.find(r => r.name === 'between')

      expect(betweenRule).toBeDefined()
      expect(betweenRule!.operators).toContain('BETWEEN')
    })
  })

  describe('custom rules', () => {
    it('should allow registering custom pushdown rules', () => {
      const customRule: PushdownRule = {
        name: 'geo',
        operators: ['NEAR'],
        canPush: (pred, caps) => caps.supportedOperators.includes('NEAR'),
        transform: (pred) => pred,
      }

      pushdown.registerRule(customRule)
      const rules = pushdown.getBuiltInRules()

      expect(rules.some(r => r.name === 'geo')).toBe(true)
    })

    it('should use custom rule for predicate evaluation', () => {
      const customRule: PushdownRule = {
        name: 'custom',
        operators: ['CUSTOM_OP'],
        canPush: () => true,
        transform: (pred) => ({
          ...pred,
          op: '=' as const, // Transform to equality
        }),
      }

      pushdown.registerRule(customRule)

      const predicate: PredicateNode = {
        type: 'predicate',
        column: 'field',
        op: 'CUSTOM_OP' as any,
        value: 'test',
      }
      const capabilities: DataSourceCapabilities = {
        supportedOperators: ['=', 'CUSTOM_OP'],
        supportedTypes: ['string'],
      }

      expect(pushdown.canPushToSource(predicate, capabilities)).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('should handle empty predicates', () => {
      const analysis = pushdown.analyzePredicates(null as unknown as QueryNode)

      expect(analysis.predicates).toHaveLength(0)
    })

    it('should handle deeply nested logical expressions', () => {
      const predicate = and(
        or(
          and(eq('a', 1), eq('b', 2)),
          and(eq('c', 3), eq('d', 4))
        ),
        eq('e', 5)
      )
      const analysis = pushdown.analyzePredicates(predicate)

      expect(analysis.predicates.length).toBeGreaterThan(0)
    })

    it('should handle predicates with null values', () => {
      const predicate = isNull('deleted_at')
      const capabilities: DataSourceCapabilities = {
        supportedOperators: ['IS NULL'],
        supportedTypes: ['null'],
      }

      expect(pushdown.canPushToSource(predicate, capabilities)).toBe(true)
    })

    it('should handle predicates with date values', () => {
      const predicate = gt('created_at', new Date('2024-01-01'))
      const capabilities: DataSourceCapabilities = {
        supportedOperators: ['>'],
        supportedTypes: ['date', 'number'],
      }

      expect(pushdown.canPushToSource(predicate, capabilities)).toBe(true)
    })

    it('should handle empty capabilities', () => {
      const predicate = eq('name', 'Alice')
      const capabilities: DataSourceCapabilities = {
        supportedOperators: [],
        supportedTypes: [],
      }

      expect(pushdown.canPushToSource(predicate, capabilities)).toBe(false)
    })
  })
})
