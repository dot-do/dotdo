/**
 * Custom Operators Tests
 *
 * Tests for the custom operator plugin system, including registration,
 * evaluation, and documentation features.
 *
 * @module @dotdo/compat/flags/operators-custom.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  OperatorRegistry,
  registerOperator,
  unregisterOperator,
  getOperatorRegistry,
  setOperatorRegistry,
  getOperatorDocumentation,
  TypeCoercion,
  type CustomOperatorDefinition,
  type OperatorFunction,
} from './operators'
import type { TargetingClause, EvaluationContext } from './types'

describe('Custom Operators System', () => {
  let originalRegistry: OperatorRegistry

  beforeEach(() => {
    // Save original registry
    originalRegistry = getOperatorRegistry()
    // Create fresh registry for each test
    setOperatorRegistry(new OperatorRegistry())
  })

  afterEach(() => {
    // Restore original registry
    setOperatorRegistry(originalRegistry)
  })

  // ==========================================================================
  // OPERATOR REGISTRY
  // ==========================================================================

  describe('OperatorRegistry', () => {
    describe('registration', () => {
      it('should register a custom operator', () => {
        const registry = new OperatorRegistry()

        const isEven: CustomOperatorDefinition = {
          name: 'isEven',
          description: 'Matches when value is even',
          evaluate: (value) => typeof value === 'number' && value % 2 === 0,
          category: 'numeric',
        }

        registry.register(isEven)
        expect(registry.has('isEven')).toBe(true)
      })

      it('should evaluate custom operator correctly', () => {
        const registry = new OperatorRegistry()

        registry.register({
          name: 'isEven',
          evaluate: (value) => typeof value === 'number' && value % 2 === 0,
        })

        const clause: TargetingClause = {
          attribute: 'count',
          operator: 'isEven' as any,
          values: [],
        }

        expect(registry.evaluate(clause, { count: 2 })).toBe(true)
        expect(registry.evaluate(clause, { count: 3 })).toBe(false)
        expect(registry.evaluate(clause, { count: 0 })).toBe(true)
      })

      it('should allow custom operator to use clause values', () => {
        const registry = new OperatorRegistry()

        registry.register({
          name: 'divisibleBy',
          description: 'Matches when value is divisible by clause values',
          evaluate: (value, clauseValues) => {
            if (typeof value !== 'number') return false
            return clauseValues.some(v => typeof v === 'number' && value % v === 0)
          },
          category: 'numeric',
        })

        const clause: TargetingClause = {
          attribute: 'score',
          operator: 'divisibleBy' as any,
          values: [5, 7],
        }

        expect(registry.evaluate(clause, { score: 10 })).toBe(true) // divisible by 5
        expect(registry.evaluate(clause, { score: 14 })).toBe(true) // divisible by 7
        expect(registry.evaluate(clause, { score: 11 })).toBe(false) // not divisible
      })

      it('should allow custom operator to access full context', () => {
        const registry = new OperatorRegistry()

        registry.register({
          name: 'hasAllTags',
          description: 'Matches when context has all specified tags',
          evaluate: (_value, clauseValues, context) => {
            const tags = context.tags as string[] | undefined
            if (!Array.isArray(tags)) return false
            return clauseValues.every(v => tags.includes(String(v)))
          },
          category: 'custom',
        })

        const clause: TargetingClause = {
          attribute: 'tags', // use actual attribute that exists
          operator: 'hasAllTags' as any,
          values: ['premium', 'verified'],
        }

        expect(registry.evaluate(clause, {
          tags: ['premium', 'verified', 'active'],
        })).toBe(true)

        expect(registry.evaluate(clause, {
          tags: ['premium'],
        })).toBe(false) // missing 'verified'
      })

      it('should unregister custom operator', () => {
        const registry = new OperatorRegistry()

        registry.register({
          name: 'custom',
          evaluate: () => true,
        })

        expect(registry.has('custom')).toBe(true)
        expect(registry.unregister('custom')).toBe(true)
        expect(registry.has('custom')).toBe(false)
      })

      it('should return false for unknown operators', () => {
        const registry = new OperatorRegistry()

        const clause: TargetingClause = {
          attribute: 'value',
          operator: 'unknownOperator' as any,
          values: [],
        }

        expect(registry.evaluate(clause, { value: 'test' })).toBe(false)
      })

      it('should throw in strict mode for unknown operators', () => {
        const registry = new OperatorRegistry({ strictMode: true })

        const clause: TargetingClause = {
          attribute: 'value',
          operator: 'unknownOperator' as any,
          values: [],
        }

        expect(() => registry.evaluate(clause, { value: 'test' }))
          .toThrow('Unknown operator: unknownOperator')
      })
    })

    describe('built-in operators', () => {
      it('should have all built-in operators registered', () => {
        const registry = new OperatorRegistry()

        const builtInOperators = [
          'in', 'notIn',
          'startsWith', 'endsWith', 'contains', 'matches',
          'lessThan', 'lessThanOrEqual', 'greaterThan', 'greaterThanOrEqual',
          'before', 'after',
          'semVerEqual', 'semVerLessThan', 'semVerGreaterThan',
          'segmentMatch',
        ]

        for (const op of builtInOperators) {
          expect(registry.has(op)).toBe(true)
        }
      })

      it('should list all operator names', () => {
        const registry = new OperatorRegistry()
        const names = registry.getOperatorNames()

        expect(names).toContain('in')
        expect(names).toContain('matches')
        expect(names).toContain('semVerGreaterThan')
      })

      it('should group operators by category', () => {
        const registry = new OperatorRegistry()
        const categories = registry.getOperatorsByCategory()

        expect(categories.membership).toContain('in')
        expect(categories.membership).toContain('notIn')
        expect(categories.string).toContain('matches')
        expect(categories.numeric).toContain('lessThan')
        expect(categories.date).toContain('before')
        expect(categories.semver).toContain('semVerEqual')
      })
    })

    describe('negation', () => {
      it('should negate custom operator result', () => {
        const registry = new OperatorRegistry()

        registry.register({
          name: 'isPositive',
          evaluate: (value) => typeof value === 'number' && value > 0,
        })

        const clause: TargetingClause = {
          attribute: 'balance',
          operator: 'isPositive' as any,
          values: [],
          negate: true,
        }

        expect(registry.evaluate(clause, { balance: 100 })).toBe(false)
        expect(registry.evaluate(clause, { balance: -50 })).toBe(true)
        expect(registry.evaluate(clause, { balance: 0 })).toBe(true)
      })
    })

    describe('caching', () => {
      it('should cache regex patterns', () => {
        const registry = new OperatorRegistry()

        const clause: TargetingClause = {
          attribute: 'email',
          operator: 'matches',
          values: ['^[a-z]+@test\\.com$'],
        }

        // First evaluation compiles the regex
        expect(registry.evaluate(clause, { email: 'user@test.com' })).toBe(true)

        // Second evaluation should use cache
        expect(registry.evaluate(clause, { email: 'admin@test.com' })).toBe(true)

        const stats = registry.getCacheStats()
        expect(stats.regexCache.size).toBeGreaterThan(0)
      })

      it('should clear regex cache', () => {
        const registry = new OperatorRegistry()

        const clause: TargetingClause = {
          attribute: 'text',
          operator: 'matches',
          values: ['^test'],
        }

        registry.evaluate(clause, { text: 'test123' })
        expect(registry.getCacheStats().regexCache.size).toBe(1)

        registry.clearRegexCache()
        expect(registry.getCacheStats().regexCache.size).toBe(0)
      })
    })
  })

  // ==========================================================================
  // GLOBAL REGISTRY
  // ==========================================================================

  describe('Global Registry', () => {
    it('should register operator on global registry', () => {
      registerOperator({
        name: 'globalCustomOp',
        evaluate: () => true,
      })

      const registry = getOperatorRegistry()
      expect(registry.has('globalCustomOp')).toBe(true)
    })

    it('should unregister operator from global registry', () => {
      registerOperator({
        name: 'tempOp',
        evaluate: () => true,
      })

      expect(unregisterOperator('tempOp')).toBe(true)
      expect(getOperatorRegistry().has('tempOp')).toBe(false)
    })
  })

  // ==========================================================================
  // TYPE COERCION
  // ==========================================================================

  describe('TypeCoercion', () => {
    describe('toNumber', () => {
      it('should convert number to number', () => {
        expect(TypeCoercion.toNumber(42)).toBe(42)
        expect(TypeCoercion.toNumber(3.14)).toBe(3.14)
        expect(TypeCoercion.toNumber(-10)).toBe(-10)
      })

      it('should convert string to number', () => {
        expect(TypeCoercion.toNumber('42')).toBe(42)
        expect(TypeCoercion.toNumber('3.14')).toBe(3.14)
        expect(TypeCoercion.toNumber('-10')).toBe(-10)
      })

      it('should convert boolean to number', () => {
        expect(TypeCoercion.toNumber(true)).toBe(1)
        expect(TypeCoercion.toNumber(false)).toBe(0)
      })

      it('should return null for non-numeric values', () => {
        expect(TypeCoercion.toNumber('hello')).toBeNull()
        expect(TypeCoercion.toNumber(null)).toBeNull()
        expect(TypeCoercion.toNumber(undefined)).toBeNull()
        expect(TypeCoercion.toNumber({})).toBeNull()
        expect(TypeCoercion.toNumber(NaN)).toBeNull()
      })
    })

    describe('toString', () => {
      it('should return string as-is', () => {
        expect(TypeCoercion.toString('hello')).toBe('hello')
      })

      it('should convert number to string', () => {
        expect(TypeCoercion.toString(42)).toBe('42')
        expect(TypeCoercion.toString(3.14)).toBe('3.14')
      })

      it('should convert boolean to string', () => {
        expect(TypeCoercion.toString(true)).toBe('true')
        expect(TypeCoercion.toString(false)).toBe('false')
      })

      it('should convert null to "null"', () => {
        expect(TypeCoercion.toString(null)).toBe('null')
      })

      it('should return null for undefined', () => {
        expect(TypeCoercion.toString(undefined)).toBeNull()
      })
    })

    describe('toDate', () => {
      it('should return Date as-is', () => {
        const date = new Date('2024-01-01')
        expect(TypeCoercion.toDate(date)).toBe(date)
      })

      it('should parse ISO string to Date', () => {
        const date = TypeCoercion.toDate('2024-01-01T00:00:00Z')
        expect(date).toBeInstanceOf(Date)
        expect(date?.toISOString()).toBe('2024-01-01T00:00:00.000Z')
      })

      it('should parse timestamp to Date', () => {
        const date = TypeCoercion.toDate(1704067200000)
        expect(date).toBeInstanceOf(Date)
      })

      it('should return null for invalid dates', () => {
        expect(TypeCoercion.toDate('invalid')).toBeNull()
        expect(TypeCoercion.toDate({})).toBeNull()
        expect(TypeCoercion.toDate(null)).toBeNull()
      })
    })

    describe('toArray', () => {
      it('should return array as-is', () => {
        const arr = [1, 2, 3]
        expect(TypeCoercion.toArray(arr)).toBe(arr)
      })

      it('should wrap single value in array', () => {
        expect(TypeCoercion.toArray(42)).toEqual([42])
        expect(TypeCoercion.toArray('hello')).toEqual(['hello'])
      })

      it('should return empty array for null/undefined', () => {
        expect(TypeCoercion.toArray(null)).toEqual([])
        expect(TypeCoercion.toArray(undefined)).toEqual([])
      })
    })

    describe('equals', () => {
      it('should compare identical values', () => {
        expect(TypeCoercion.equals(42, 42)).toBe(true)
        expect(TypeCoercion.equals('hello', 'hello')).toBe(true)
      })

      it('should compare with numeric coercion', () => {
        expect(TypeCoercion.equals(42, '42')).toBe(true)
        expect(TypeCoercion.equals('3.14', 3.14)).toBe(true)
      })

      it('should compare with string coercion', () => {
        expect(TypeCoercion.equals('true', true)).toBe(true)
      })

      it('should distinguish null and undefined', () => {
        expect(TypeCoercion.equals(null, undefined)).toBe(false)
        expect(TypeCoercion.equals(null, null)).toBe(true)
        expect(TypeCoercion.equals(undefined, undefined)).toBe(true)
      })
    })
  })

  // ==========================================================================
  // OPERATOR DOCUMENTATION
  // ==========================================================================

  describe('Operator Documentation', () => {
    it('should generate documentation for all built-in operators', () => {
      const docs = getOperatorDocumentation()

      const operatorNames = docs.map(d => d.name)
      expect(operatorNames).toContain('in')
      expect(operatorNames).toContain('matches')
      expect(operatorNames).toContain('semVerEqual')
      expect(operatorNames).toContain('segmentMatch')
    })

    it('should include examples for operators', () => {
      const docs = getOperatorDocumentation()
      const inOp = docs.find(d => d.name === 'in')

      expect(inOp).toBeDefined()
      expect(inOp?.examples.length).toBeGreaterThan(0)
      expect(inOp?.examples[0]).toHaveProperty('clause')
      expect(inOp?.examples[0]).toHaveProperty('context')
      expect(inOp?.examples[0]).toHaveProperty('expected')
    })

    it('should include custom operators in documentation', () => {
      registerOperator({
        name: 'customDocOp',
        description: 'A custom operator for testing',
        evaluate: () => true,
        category: 'custom',
        examples: [
          { value: 'test', clauseValues: [], expected: true, description: 'Always matches' },
        ],
      })

      const docs = getOperatorDocumentation()
      const customOp = docs.find(d => d.name === 'customDocOp')

      expect(customOp).toBeDefined()
      expect(customOp?.description).toBe('A custom operator for testing')
      expect(customOp?.category).toBe('custom')
    })

    it('should have category for each operator', () => {
      const docs = getOperatorDocumentation()

      for (const doc of docs) {
        expect(doc.category).toBeDefined()
        expect(typeof doc.category).toBe('string')
      }
    })
  })

  // ==========================================================================
  // PRACTICAL EXAMPLES
  // ==========================================================================

  describe('Practical Custom Operators', () => {
    it('should support isWeekend operator', () => {
      registerOperator({
        name: 'isWeekend',
        description: 'Matches if date is Saturday or Sunday',
        evaluate: (value) => {
          const date = TypeCoercion.toDate(value)
          if (!date) return false
          const day = date.getDay()
          return day === 0 || day === 6
        },
        category: 'date',
      })

      const clause: TargetingClause = {
        attribute: 'lastLogin',
        operator: 'isWeekend' as any,
        values: [],
      }

      const registry = getOperatorRegistry()
      // Saturday
      expect(registry.evaluate(clause, { lastLogin: '2024-01-06T12:00:00Z' })).toBe(true)
      // Sunday
      expect(registry.evaluate(clause, { lastLogin: '2024-01-07T12:00:00Z' })).toBe(true)
      // Monday
      expect(registry.evaluate(clause, { lastLogin: '2024-01-08T12:00:00Z' })).toBe(false)
    })

    it('should support isPowerOfTwo operator', () => {
      registerOperator({
        name: 'isPowerOfTwo',
        description: 'Matches if value is a power of 2',
        evaluate: (value) => {
          if (typeof value !== 'number' || value <= 0) return false
          return (value & (value - 1)) === 0
        },
        category: 'numeric',
      })

      const clause: TargetingClause = {
        attribute: 'count',
        operator: 'isPowerOfTwo' as any,
        values: [],
      }

      const registry = getOperatorRegistry()
      expect(registry.evaluate(clause, { count: 1 })).toBe(true)
      expect(registry.evaluate(clause, { count: 2 })).toBe(true)
      expect(registry.evaluate(clause, { count: 4 })).toBe(true)
      expect(registry.evaluate(clause, { count: 8 })).toBe(true)
      expect(registry.evaluate(clause, { count: 3 })).toBe(false)
      expect(registry.evaluate(clause, { count: 5 })).toBe(false)
    })

    it('should support jsonPathExists operator', () => {
      registerOperator({
        name: 'jsonPathExists',
        description: 'Matches if specified paths exist in object',
        evaluate: (value, clauseValues) => {
          if (!value || typeof value !== 'object') return false
          const obj = value as Record<string, unknown>

          return clauseValues.every(path => {
            const parts = String(path).split('.')
            let current: unknown = obj
            for (const part of parts) {
              if (current === null || current === undefined) return false
              if (typeof current !== 'object') return false
              current = (current as Record<string, unknown>)[part]
            }
            return current !== undefined
          })
        },
        category: 'custom',
      })

      const clause: TargetingClause = {
        attribute: 'metadata',
        operator: 'jsonPathExists' as any,
        values: ['user.name', 'user.email'],
      }

      const registry = getOperatorRegistry()
      expect(registry.evaluate(clause, {
        metadata: { user: { name: 'John', email: 'john@test.com' } }
      })).toBe(true)

      expect(registry.evaluate(clause, {
        metadata: { user: { name: 'John' } }
      })).toBe(false) // missing email
    })
  })
})
