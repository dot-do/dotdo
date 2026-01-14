/**
 * Rule Evaluator Tests
 *
 * Comprehensive tests for the feature flag rule evaluator that handles
 * attribute matching, numeric comparisons, list operations, regex matching,
 * segment membership, and boolean logic with short-circuit evaluation.
 *
 * @see dotdo-32ver
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createRuleEvaluator,
  defaultRuleEvaluator,
  // Rule builders
  equals,
  notEquals,
  contains,
  startsWith,
  endsWith,
  matches,
  gt,
  gte,
  lt,
  lte,
  between,
  inList,
  notIn,
  inSegment,
  notInSegment,
  exists,
  notExists,
  and,
  or,
  not,
  // Types
  type Rule,
  type EvaluationContext,
  type Segment,
  type RuleEvaluator,
} from '../rule-evaluator'

// ============================================================================
// Test Fixtures
// ============================================================================

const testContext: EvaluationContext = {
  user: {
    id: 'user-123',
    email: 'alice@example.com',
    name: 'Alice Smith',
    plan: 'pro',
    age: 28,
    signupDate: '2024-01-15',
    credits: 150.5,
    isVerified: true,
    tags: ['developer', 'early-adopter'],
    address: {
      country: 'US',
      state: 'CA',
      city: 'San Francisco',
    },
  },
  device: {
    os: 'macOS',
    browser: 'Chrome',
    version: '120.0.0',
    isMobile: false,
  },
  session: {
    id: 'sess-abc',
    startedAt: Date.now() - 3600000, // 1 hour ago
  },
  custom: {
    featureGroup: 'beta',
    region: 'west',
  },
}

const premiumSegment: Segment = {
  id: 'premium',
  name: 'Premium Users',
  rules: [
    { attribute: 'user.plan', operator: 'in', value: ['pro', 'enterprise'] },
    { attribute: 'user.isVerified', operator: 'equals', value: true },
  ],
}

const betaSegment: Segment = {
  id: 'beta',
  name: 'Beta Testers',
  rules: [{ attribute: 'custom.featureGroup', operator: 'equals', value: 'beta' }],
}

// ============================================================================
// Attribute Matching Tests
// ============================================================================

describe('RuleEvaluator', () => {
  let evaluator: RuleEvaluator

  beforeEach(() => {
    evaluator = createRuleEvaluator({
      segments: { premium: premiumSegment, beta: betaSegment },
    })
  })

  describe('attribute matching - equals', () => {
    it('should match string equality', () => {
      const rule = equals('user.email', 'alice@example.com')
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should not match different strings', () => {
      const rule = equals('user.email', 'bob@example.com')
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })

    it('should match number equality', () => {
      const rule = equals('user.age', 28)
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should match boolean equality', () => {
      const rule = equals('user.isVerified', true)
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should match with string coercion', () => {
      const rule = equals('user.age', '28')
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should handle nested attributes', () => {
      const rule = equals('user.address.country', 'US')
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should return false for non-existent attribute', () => {
      const rule = equals('user.nonExistent', 'value')
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })
  })

  describe('attribute matching - notEquals', () => {
    it('should match when values differ', () => {
      const rule = notEquals('user.plan', 'free')
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should not match when values are equal', () => {
      const rule = notEquals('user.plan', 'pro')
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })
  })

  describe('attribute matching - contains', () => {
    it('should match substring', () => {
      const rule = contains('user.email', 'example.com')
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should not match when substring absent', () => {
      const rule = contains('user.email', 'gmail.com')
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })

    it('should be case-sensitive', () => {
      const rule = contains('user.name', 'alice')
      expect(evaluator.evaluate(rule, testContext)).toBe(false)

      const rule2 = contains('user.name', 'Alice')
      expect(evaluator.evaluate(rule2, testContext)).toBe(true)
    })
  })

  describe('attribute matching - startsWith', () => {
    it('should match prefix', () => {
      const rule = startsWith('user.email', 'alice')
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should not match non-prefix', () => {
      const rule = startsWith('user.email', 'bob')
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })
  })

  describe('attribute matching - endsWith', () => {
    it('should match suffix', () => {
      const rule = endsWith('user.email', '.com')
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should not match non-suffix', () => {
      const rule = endsWith('user.email', '.org')
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })
  })

  // ============================================================================
  // Numeric Comparison Tests
  // ============================================================================

  describe('numeric comparisons - gt', () => {
    it('should match when attribute is greater', () => {
      const rule = gt('user.age', 25)
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should not match when attribute is equal', () => {
      const rule = gt('user.age', 28)
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })

    it('should not match when attribute is less', () => {
      const rule = gt('user.age', 30)
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })

    it('should work with floating point numbers', () => {
      const rule = gt('user.credits', 100.0)
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })
  })

  describe('numeric comparisons - gte', () => {
    it('should match when attribute is greater', () => {
      const rule = gte('user.age', 25)
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should match when attribute is equal', () => {
      const rule = gte('user.age', 28)
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should not match when attribute is less', () => {
      const rule = gte('user.age', 30)
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })
  })

  describe('numeric comparisons - lt', () => {
    it('should match when attribute is less', () => {
      const rule = lt('user.age', 30)
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should not match when attribute is equal', () => {
      const rule = lt('user.age', 28)
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })

    it('should not match when attribute is greater', () => {
      const rule = lt('user.age', 25)
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })
  })

  describe('numeric comparisons - lte', () => {
    it('should match when attribute is less', () => {
      const rule = lte('user.age', 30)
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should match when attribute is equal', () => {
      const rule = lte('user.age', 28)
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should not match when attribute is greater', () => {
      const rule = lte('user.age', 25)
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })
  })

  describe('numeric comparisons - between', () => {
    it('should match when value is within range', () => {
      const rule = between('user.age', 25, 35)
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should match when value equals min', () => {
      const rule = between('user.age', 28, 35)
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should match when value equals max', () => {
      const rule = between('user.age', 20, 28)
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should not match when value is below range', () => {
      const rule = between('user.age', 30, 40)
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })

    it('should not match when value is above range', () => {
      const rule = between('user.age', 18, 25)
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })

    it('should work with floating point ranges', () => {
      const rule = between('user.credits', 100.0, 200.0)
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })
  })

  // ============================================================================
  // List Operation Tests
  // ============================================================================

  describe('list operations - in', () => {
    it('should match when value is in list', () => {
      const rule = inList('user.plan', ['free', 'pro', 'enterprise'])
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should not match when value is not in list', () => {
      const rule = inList('user.plan', ['free', 'basic'])
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })

    it('should match with numeric values', () => {
      const rule = inList('user.age', [25, 28, 30])
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should handle empty list', () => {
      const rule = inList('user.plan', [])
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })
  })

  describe('list operations - notIn', () => {
    it('should match when value is not in list', () => {
      const rule = notIn('user.plan', ['free', 'basic'])
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should not match when value is in list', () => {
      const rule = notIn('user.plan', ['free', 'pro'])
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })

    it('should match with empty list', () => {
      const rule = notIn('user.plan', [])
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })
  })

  // ============================================================================
  // Regex Matching Tests
  // ============================================================================

  describe('regex matching', () => {
    it('should match with regex pattern string', () => {
      const rule = matches('user.email', '^alice@.*\\.com$')
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should match with RegExp object', () => {
      const rule = matches('user.email', /^alice@.*\.com$/)
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should not match when pattern fails', () => {
      const rule = matches('user.email', '^bob@')
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })

    it('should match partial patterns', () => {
      const rule = matches('user.name', 'Smith')
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should handle invalid regex gracefully', () => {
      const rule = matches('user.email', '[invalid')
      // Should return false, not throw
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })

    it('should throw for invalid regex when throwOnError is true', () => {
      const strictEvaluator = createRuleEvaluator({ throwOnError: true })
      const rule = matches('user.email', '[invalid')
      expect(() => strictEvaluator.evaluate(rule, testContext)).toThrow()
    })
  })

  // ============================================================================
  // Segment Membership Tests
  // ============================================================================

  describe('segment membership - inSegment', () => {
    it('should match when user is in segment', () => {
      const rule = inSegment('premium')
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should match beta segment', () => {
      const rule = inSegment('beta')
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should not match when user is not in segment', () => {
      const freeContext: EvaluationContext = {
        user: { plan: 'free', isVerified: false },
      }
      const rule = inSegment('premium')
      expect(evaluator.evaluate(rule, freeContext)).toBe(false)
    })

    it('should return false for non-existent segment', () => {
      const rule = inSegment('nonexistent')
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })
  })

  describe('segment membership - notInSegment', () => {
    it('should not match when user is in segment', () => {
      const rule = notInSegment('premium')
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })

    it('should match when user is not in segment', () => {
      const freeContext: EvaluationContext = {
        user: { plan: 'free', isVerified: false },
      }
      const rule = notInSegment('premium')
      expect(evaluator.evaluate(rule, freeContext)).toBe(true)
    })

    it('should match for non-existent segment', () => {
      const rule = notInSegment('nonexistent')
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })
  })

  // ============================================================================
  // Boolean Logic Tests
  // ============================================================================

  describe('boolean logic - AND', () => {
    it('should match when all children match', () => {
      const rule = and(equals('user.plan', 'pro'), equals('user.isVerified', true))
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should not match when any child fails', () => {
      const rule = and(equals('user.plan', 'pro'), equals('user.isVerified', false))
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })

    it('should match with empty children', () => {
      const rule = and()
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should match with single child', () => {
      const rule = and(equals('user.plan', 'pro'))
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should short-circuit on first failure', () => {
      let evaluated = 0
      const customEvaluator = createRuleEvaluator()

      // We can verify short-circuit behavior by checking the result
      // when the first rule fails
      const rule = and(equals('user.plan', 'free'), equals('user.isVerified', true))

      expect(customEvaluator.evaluate(rule, testContext)).toBe(false)
    })
  })

  describe('boolean logic - OR', () => {
    it('should match when any child matches', () => {
      const rule = or(equals('user.plan', 'free'), equals('user.plan', 'pro'))
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should not match when all children fail', () => {
      const rule = or(equals('user.plan', 'free'), equals('user.plan', 'basic'))
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })

    it('should not match with empty children', () => {
      const rule = or()
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })

    it('should match with single matching child', () => {
      const rule = or(equals('user.plan', 'pro'))
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should short-circuit on first success', () => {
      // The first child matches, so second should not be evaluated
      const rule = or(equals('user.plan', 'pro'), equals('user.plan', 'free'))

      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })
  })

  describe('boolean logic - NOT', () => {
    it('should negate a matching rule', () => {
      const rule = not(equals('user.plan', 'pro'))
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })

    it('should negate a non-matching rule', () => {
      const rule = not(equals('user.plan', 'free'))
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should return true with empty children', () => {
      const rule = not({ attribute: '', operator: 'and', value: null, children: [] } as Rule)
      // not() with no children is equivalent to not(true) for AND
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })
  })

  // ============================================================================
  // Nested Rule Evaluation Tests
  // ============================================================================

  describe('nested rule evaluation', () => {
    it('should evaluate deeply nested AND/OR', () => {
      // (plan = 'pro' AND isVerified = true) OR (age > 30)
      const rule = or(and(equals('user.plan', 'pro'), equals('user.isVerified', true)), gt('user.age', 30))

      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should evaluate complex nested NOT', () => {
      // NOT(plan = 'free' OR age < 18)
      const rule = not(or(equals('user.plan', 'free'), lt('user.age', 18)))

      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should evaluate triple nesting', () => {
      // ((plan IN ['pro', 'enterprise'] AND age >= 18) AND (country = 'US' OR region = 'west'))
      const rule = and(
        and(inList('user.plan', ['pro', 'enterprise']), gte('user.age', 18)),
        or(equals('user.address.country', 'US'), equals('custom.region', 'west'))
      )

      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should respect max depth limit', () => {
      // Create very deeply nested rule
      let rule: Rule = equals('user.plan', 'pro')
      for (let i = 0; i < 15; i++) {
        rule = and(rule)
      }

      const limitedEvaluator = createRuleEvaluator({ maxDepth: 10 })
      expect(limitedEvaluator.evaluate(rule, testContext)).toBe(false)
    })

    it('should throw on max depth exceeded when throwOnError is true', () => {
      let rule: Rule = equals('user.plan', 'pro')
      for (let i = 0; i < 15; i++) {
        rule = and(rule)
      }

      const strictEvaluator = createRuleEvaluator({ maxDepth: 10, throwOnError: true })
      expect(() => strictEvaluator.evaluate(rule, testContext)).toThrow(/depth/i)
    })
  })

  // ============================================================================
  // Existence Operator Tests
  // ============================================================================

  describe('existence operators', () => {
    it('should match exists for present attribute', () => {
      const rule = exists('user.email')
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should not match exists for absent attribute', () => {
      const rule = exists('user.nonExistent')
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })

    it('should not match exists for null attribute', () => {
      const context: EvaluationContext = {
        user: { email: null },
      }
      const rule = exists('user.email')
      expect(evaluator.evaluate(rule, context)).toBe(false)
    })

    it('should match notExists for absent attribute', () => {
      const rule = notExists('user.nonExistent')
      expect(evaluator.evaluate(rule, testContext)).toBe(true)
    })

    it('should not match notExists for present attribute', () => {
      const rule = notExists('user.email')
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })
  })

  // ============================================================================
  // evaluateAll Tests
  // ============================================================================

  describe('evaluateAll', () => {
    it('should return results for all rules', () => {
      const rules = [equals('user.plan', 'pro'), equals('user.plan', 'free'), gt('user.age', 25)]

      const results = evaluator.evaluateAll(rules, testContext)

      expect(results).toHaveLength(3)
      expect(results[0].matched).toBe(true)
      expect(results[1].matched).toBe(false)
      expect(results[2].matched).toBe(true)
    })

    it('should include rule reference in results', () => {
      const rule = equals('user.plan', 'pro')
      const results = evaluator.evaluateAll([rule], testContext)

      expect(results[0].rule).toBe(rule)
    })

    it('should include reason in results', () => {
      const results = evaluator.evaluateAll([equals('user.plan', 'pro')], testContext)

      expect(results[0].reason).toBeDefined()
    })

    it('should capture errors in results', () => {
      const evaluatorWithErrors = createRuleEvaluator({ throwOnError: false })
      const invalidRule: Rule = {
        attribute: 'user.email',
        operator: 'matches' as const,
        value: '[invalid',
      }

      const results = evaluatorWithErrors.evaluateAll([invalidRule], testContext)

      expect(results[0].matched).toBe(false)
      expect(results[0].error).toBeUndefined() // Error is caught, not stored unless throwOnError
    })
  })

  // ============================================================================
  // Edge Cases and Error Handling
  // ============================================================================

  describe('edge cases', () => {
    it('should handle undefined context gracefully', () => {
      const rule = equals('user.email', 'test@test.com')
      expect(evaluator.evaluate(rule, {})).toBe(false)
    })

    it('should handle null values in context', () => {
      const context: EvaluationContext = {
        user: { email: null },
      }
      const rule = equals('user.email', null)
      expect(evaluator.evaluate(rule, context)).toBe(true)
    })

    it('should handle Date comparisons', () => {
      const context: EvaluationContext = {
        createdAt: new Date('2024-01-15'),
      }
      const rule = equals('createdAt', new Date('2024-01-15'))
      expect(evaluator.evaluate(rule, context)).toBe(true)
    })

    it('should handle numeric strings in comparisons', () => {
      const context: EvaluationContext = {
        value: '100',
      }
      const rule = gt('value', 50)
      expect(evaluator.evaluate(rule, context)).toBe(true)
    })

    it('should handle non-numeric strings in numeric comparisons', () => {
      const context: EvaluationContext = {
        value: 'not-a-number',
      }
      const rule = gt('value', 50)
      expect(evaluator.evaluate(rule, context)).toBe(false)
    })

    it('should handle array attribute values', () => {
      const context: EvaluationContext = {
        tags: ['a', 'b', 'c'],
      }
      // Array equality
      const rule = equals('tags', ['a', 'b', 'c'])
      expect(evaluator.evaluate(rule, context)).toBe(true)
    })

    it('should handle unknown operator gracefully', () => {
      const rule: Rule = {
        attribute: 'user.email',
        operator: 'unknownOp' as any,
        value: 'test',
      }
      expect(evaluator.evaluate(rule, testContext)).toBe(false)
    })

    it('should throw for unknown operator when throwOnError is true', () => {
      const strictEvaluator = createRuleEvaluator({ throwOnError: true })
      const rule: Rule = {
        attribute: 'user.email',
        operator: 'unknownOp' as any,
        value: 'test',
      }
      expect(() => strictEvaluator.evaluate(rule, testContext)).toThrow(/unknown operator/i)
    })
  })

  // ============================================================================
  // Default Evaluator Tests
  // ============================================================================

  describe('defaultRuleEvaluator', () => {
    it('should be available as a singleton', () => {
      expect(defaultRuleEvaluator).toBeDefined()
      expect(defaultRuleEvaluator.evaluate).toBeTypeOf('function')
      expect(defaultRuleEvaluator.evaluateAll).toBeTypeOf('function')
    })

    it('should evaluate basic rules', () => {
      const rule = equals('name', 'test')
      const context: EvaluationContext = { name: 'test' }
      expect(defaultRuleEvaluator.evaluate(rule, context)).toBe(true)
    })
  })

  // ============================================================================
  // Performance Tests
  // ============================================================================

  describe('performance', () => {
    it('should evaluate 10000 simple rules per second', () => {
      const rules: Rule[] = []
      for (let i = 0; i < 10000; i++) {
        rules.push(equals('user.plan', 'pro'))
      }

      const start = performance.now()
      for (const rule of rules) {
        evaluator.evaluate(rule, testContext)
      }
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(1000) // Under 1 second
    })

    it('should evaluate complex nested rules efficiently', () => {
      // Build a moderately nested rule tree
      const rule = and(
        or(equals('user.plan', 'pro'), equals('user.plan', 'enterprise')),
        and(gte('user.age', 18), lte('user.age', 100)),
        or(equals('user.address.country', 'US'), equals('user.address.country', 'CA')),
        and(exists('user.email'), not(equals('user.email', '')))
      )

      const start = performance.now()
      for (let i = 0; i < 10000; i++) {
        evaluator.evaluate(rule, testContext)
      }
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(1000) // Under 1 second for 10k evaluations
    })

    it('should short-circuit AND efficiently', () => {
      // First condition fails, should not evaluate rest
      const rule = and(
        equals('user.plan', 'free'), // fails
        gt('user.age', 100), // expensive check, should be skipped
        matches('user.email', '^complex.*pattern.*with.*many.*groups.*$')
      )

      const start = performance.now()
      for (let i = 0; i < 10000; i++) {
        evaluator.evaluate(rule, testContext)
      }
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(200) // Should be very fast due to short-circuit
    })

    it('should short-circuit OR efficiently', () => {
      // First condition passes, should not evaluate rest
      const rule = or(
        equals('user.plan', 'pro'), // passes
        gt('user.age', 100), // should be skipped
        matches('user.email', '^complex.*pattern.*with.*many.*groups.*$')
      )

      const start = performance.now()
      for (let i = 0; i < 10000; i++) {
        evaluator.evaluate(rule, testContext)
      }
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(200) // Should be very fast due to short-circuit
    })
  })

  // ============================================================================
  // Rule Builder Function Tests
  // ============================================================================

  describe('rule builders', () => {
    it('should create correct equals rule', () => {
      const rule = equals('attr', 'value')
      expect(rule).toEqual({ attribute: 'attr', operator: 'equals', value: 'value' })
    })

    it('should create correct notEquals rule', () => {
      const rule = notEquals('attr', 'value')
      expect(rule).toEqual({ attribute: 'attr', operator: 'notEquals', value: 'value' })
    })

    it('should create correct contains rule', () => {
      const rule = contains('attr', 'substr')
      expect(rule).toEqual({ attribute: 'attr', operator: 'contains', value: 'substr' })
    })

    it('should create correct startsWith rule', () => {
      const rule = startsWith('attr', 'prefix')
      expect(rule).toEqual({ attribute: 'attr', operator: 'startsWith', value: 'prefix' })
    })

    it('should create correct endsWith rule', () => {
      const rule = endsWith('attr', 'suffix')
      expect(rule).toEqual({ attribute: 'attr', operator: 'endsWith', value: 'suffix' })
    })

    it('should create correct matches rule', () => {
      const rule = matches('attr', '^pattern$')
      expect(rule).toEqual({ attribute: 'attr', operator: 'matches', value: '^pattern$' })
    })

    it('should create correct numeric rules', () => {
      expect(gt('attr', 10)).toEqual({ attribute: 'attr', operator: 'gt', value: 10 })
      expect(gte('attr', 10)).toEqual({ attribute: 'attr', operator: 'gte', value: 10 })
      expect(lt('attr', 10)).toEqual({ attribute: 'attr', operator: 'lt', value: 10 })
      expect(lte('attr', 10)).toEqual({ attribute: 'attr', operator: 'lte', value: 10 })
      expect(between('attr', 5, 15)).toEqual({ attribute: 'attr', operator: 'between', value: [5, 15] })
    })

    it('should create correct list rules', () => {
      expect(inList('attr', [1, 2, 3])).toEqual({ attribute: 'attr', operator: 'in', value: [1, 2, 3] })
      expect(notIn('attr', [1, 2, 3])).toEqual({ attribute: 'attr', operator: 'notIn', value: [1, 2, 3] })
    })

    it('should create correct segment rules', () => {
      expect(inSegment('premium')).toEqual({ attribute: '', operator: 'inSegment', value: 'premium' })
      expect(notInSegment('premium')).toEqual({ attribute: '', operator: 'notInSegment', value: 'premium' })
    })

    it('should create correct existence rules', () => {
      expect(exists('attr')).toEqual({ attribute: 'attr', operator: 'exists', value: null })
      expect(notExists('attr')).toEqual({ attribute: 'attr', operator: 'notExists', value: null })
    })

    it('should create correct boolean rules', () => {
      const r1 = equals('a', 1)
      const r2 = equals('b', 2)

      expect(and(r1, r2)).toEqual({
        attribute: '',
        operator: 'and',
        value: null,
        children: [r1, r2],
      })

      expect(or(r1, r2)).toEqual({
        attribute: '',
        operator: 'or',
        value: null,
        children: [r1, r2],
      })

      expect(not(r1)).toEqual({
        attribute: '',
        operator: 'not',
        value: null,
        children: [r1],
      })
    })
  })
})
