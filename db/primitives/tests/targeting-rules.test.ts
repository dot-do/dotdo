/**
 * Targeting Rules Tests - TDD RED Phase
 *
 * Tests for targeting rule evaluation covering:
 * 1. User attribute matching (basic attribute comparisons)
 * 2. Segment membership (static and dynamic segments)
 * 3. Complex rule combinations (AND/OR/NOT logic)
 * 4. Edge cases (missing attributes, type coercion, etc.)
 *
 * These tests should FAIL until implementation is complete.
 *
 * @see dotdo-5vjps
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Core evaluation functions
  createRuleEvaluator,
  evaluateRule,
  evaluateRules,

  // Segment functions
  createSegmentStore,
  checkSegmentMembership,

  // Rule builder helpers
  rule,
  segment,

  // Types
  type RuleEvaluator,
  type TargetingRule,
  type UserContext,
  type Segment,
  type SegmentStore,
  type EvaluationResult,
  type RuleOperator,
} from '../targeting-rules'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestUser(overrides: Partial<UserContext> = {}): UserContext {
  return {
    userId: 'user-123',
    email: 'test@example.com',
    ...overrides,
  }
}

// =============================================================================
// 1. User Attribute Matching Tests
// =============================================================================

describe('TargetingRules', () => {
  describe('user attribute matching', () => {
    let evaluator: RuleEvaluator

    beforeEach(() => {
      evaluator = createRuleEvaluator()
    })

    describe('string operators', () => {
      it('should match string equality', () => {
        const r: TargetingRule = {
          attribute: 'email',
          operator: 'equals',
          value: 'alice@example.com',
        }

        expect(evaluateRule(r, createTestUser({ email: 'alice@example.com' }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ email: 'bob@example.com' }))).toBe(false)
      })

      it('should match string inequality', () => {
        const r: TargetingRule = {
          attribute: 'email',
          operator: 'notEquals',
          value: 'banned@example.com',
        }

        expect(evaluateRule(r, createTestUser({ email: 'alice@example.com' }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ email: 'banned@example.com' }))).toBe(false)
      })

      it('should match string contains', () => {
        const r: TargetingRule = {
          attribute: 'email',
          operator: 'contains',
          value: '@company.com',
        }

        expect(evaluateRule(r, createTestUser({ email: 'alice@company.com' }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ email: 'alice@gmail.com' }))).toBe(false)
      })

      it('should match string notContains', () => {
        const r: TargetingRule = {
          attribute: 'email',
          operator: 'notContains',
          value: 'spam',
        }

        expect(evaluateRule(r, createTestUser({ email: 'alice@example.com' }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ email: 'spam@example.com' }))).toBe(false)
      })

      it('should match string startsWith', () => {
        const r: TargetingRule = {
          attribute: 'email',
          operator: 'startsWith',
          value: 'admin',
        }

        expect(evaluateRule(r, createTestUser({ email: 'admin@example.com' }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ email: 'user@example.com' }))).toBe(false)
      })

      it('should match string endsWith', () => {
        const r: TargetingRule = {
          attribute: 'email',
          operator: 'endsWith',
          value: '@company.com',
        }

        expect(evaluateRule(r, createTestUser({ email: 'alice@company.com' }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ email: 'alice@gmail.com' }))).toBe(false)
      })

      it('should match regex pattern', () => {
        const r: TargetingRule = {
          attribute: 'email',
          operator: 'matches',
          value: '^[a-z]+@example\\.com$',
        }

        expect(evaluateRule(r, createTestUser({ email: 'alice@example.com' }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ email: 'Alice@example.com' }))).toBe(false)
        expect(evaluateRule(r, createTestUser({ email: 'alice@other.com' }))).toBe(false)
      })

      it('should support case-insensitive string matching', () => {
        const r: TargetingRule = {
          attribute: 'country',
          operator: 'equals',
          value: 'USA',
          options: { caseInsensitive: true },
        }

        expect(evaluateRule(r, createTestUser({ country: 'usa' }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ country: 'USA' }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ country: 'Usa' }))).toBe(true)
      })
    })

    describe('numeric operators', () => {
      it('should match greater than', () => {
        const r: TargetingRule = {
          attribute: 'age',
          operator: 'gt',
          value: 18,
        }

        expect(evaluateRule(r, createTestUser({ age: 25 }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ age: 18 }))).toBe(false)
        expect(evaluateRule(r, createTestUser({ age: 15 }))).toBe(false)
      })

      it('should match greater than or equal', () => {
        const r: TargetingRule = {
          attribute: 'age',
          operator: 'gte',
          value: 18,
        }

        expect(evaluateRule(r, createTestUser({ age: 25 }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ age: 18 }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ age: 17 }))).toBe(false)
      })

      it('should match less than', () => {
        const r: TargetingRule = {
          attribute: 'age',
          operator: 'lt',
          value: 65,
        }

        expect(evaluateRule(r, createTestUser({ age: 30 }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ age: 65 }))).toBe(false)
        expect(evaluateRule(r, createTestUser({ age: 70 }))).toBe(false)
      })

      it('should match less than or equal', () => {
        const r: TargetingRule = {
          attribute: 'age',
          operator: 'lte',
          value: 65,
        }

        expect(evaluateRule(r, createTestUser({ age: 30 }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ age: 65 }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ age: 70 }))).toBe(false)
      })

      it('should match between range (inclusive)', () => {
        const r: TargetingRule = {
          attribute: 'age',
          operator: 'between',
          value: [18, 65],
        }

        expect(evaluateRule(r, createTestUser({ age: 18 }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ age: 40 }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ age: 65 }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ age: 17 }))).toBe(false)
        expect(evaluateRule(r, createTestUser({ age: 66 }))).toBe(false)
      })

      it('should handle string-to-number coercion', () => {
        const r: TargetingRule = {
          attribute: 'purchaseCount',
          operator: 'gte',
          value: 10,
        }

        expect(evaluateRule(r, createTestUser({ purchaseCount: '15' }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ purchaseCount: '5' }))).toBe(false)
      })
    })

    describe('list operators', () => {
      it('should match value in list', () => {
        const r: TargetingRule = {
          attribute: 'country',
          operator: 'in',
          value: ['US', 'CA', 'MX'],
        }

        expect(evaluateRule(r, createTestUser({ country: 'US' }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ country: 'CA' }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ country: 'UK' }))).toBe(false)
      })

      it('should match value not in list', () => {
        const r: TargetingRule = {
          attribute: 'country',
          operator: 'notIn',
          value: ['CN', 'RU', 'KP'],
        }

        expect(evaluateRule(r, createTestUser({ country: 'US' }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ country: 'CN' }))).toBe(false)
      })
    })

    describe('existence operators', () => {
      it('should match attribute exists', () => {
        const r: TargetingRule = {
          attribute: 'email',
          operator: 'exists',
          value: true,
        }

        expect(evaluateRule(r, createTestUser({ email: 'alice@example.com' }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ email: undefined }))).toBe(false)
        expect(evaluateRule(r, createTestUser({}))).toBe(false)
      })

      it('should match attribute does not exist', () => {
        const r: TargetingRule = {
          attribute: 'optionalField',
          operator: 'notExists',
          value: true,
        }

        expect(evaluateRule(r, createTestUser({}))).toBe(true)
        expect(evaluateRule(r, createTestUser({ optionalField: 'value' }))).toBe(false)
      })
    })

    describe('nested attribute access', () => {
      it('should access nested object properties', () => {
        const r: TargetingRule = {
          attribute: 'address.country',
          operator: 'equals',
          value: 'US',
        }

        expect(evaluateRule(r, createTestUser({ address: { country: 'US', city: 'NYC' } }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ address: { country: 'UK', city: 'London' } }))).toBe(false)
      })

      it('should access deeply nested properties', () => {
        const r: TargetingRule = {
          attribute: 'custom.settings.notifications.email',
          operator: 'equals',
          value: true,
        }

        expect(
          evaluateRule(r, createTestUser({ custom: { settings: { notifications: { email: true } } } }))
        ).toBe(true)
        expect(
          evaluateRule(r, createTestUser({ custom: { settings: { notifications: { email: false } } } }))
        ).toBe(false)
      })

      it('should return false for missing nested path', () => {
        const r: TargetingRule = {
          attribute: 'address.country',
          operator: 'equals',
          value: 'US',
        }

        expect(evaluateRule(r, createTestUser({}))).toBe(false)
        expect(evaluateRule(r, createTestUser({ address: {} }))).toBe(false)
      })
    })

    describe('array attribute access', () => {
      it('should check if array contains value', () => {
        const r: TargetingRule = {
          attribute: 'tags',
          operator: 'arrayContains',
          value: 'premium',
        }

        expect(evaluateRule(r, createTestUser({ tags: ['premium', 'active'] }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ tags: ['free', 'active'] }))).toBe(false)
        expect(evaluateRule(r, createTestUser({ tags: [] }))).toBe(false)
      })

      it('should check if array contains all values', () => {
        const r: TargetingRule = {
          attribute: 'tags',
          operator: 'arrayContainsAll',
          value: ['premium', 'verified'],
        }

        expect(evaluateRule(r, createTestUser({ tags: ['premium', 'verified', 'active'] }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ tags: ['premium', 'active'] }))).toBe(false)
      })

      it('should check if array contains any value', () => {
        const r: TargetingRule = {
          attribute: 'roles',
          operator: 'arrayContainsAny',
          value: ['admin', 'moderator'],
        }

        expect(evaluateRule(r, createTestUser({ roles: ['admin', 'user'] }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ roles: ['moderator'] }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ roles: ['user', 'guest'] }))).toBe(false)
      })
    })
  })

  // =============================================================================
  // 2. Segment Membership Tests
  // =============================================================================

  describe('segment membership', () => {
    let segmentStore: SegmentStore
    let evaluator: RuleEvaluator

    beforeEach(() => {
      segmentStore = createSegmentStore()
      evaluator = createRuleEvaluator({ segments: segmentStore })
    })

    describe('static segment (included users list)', () => {
      it('should match user in included list', async () => {
        const betaSegment: Segment = {
          key: 'beta-users',
          name: 'Beta Users',
          included: ['user-1', 'user-2', 'user-3'],
        }

        await segmentStore.create(betaSegment)

        const r: TargetingRule = {
          attribute: '',
          operator: 'inSegment',
          value: 'beta-users',
        }

        expect(evaluateRule(r, createTestUser({ userId: 'user-2' }), evaluator)).toBe(true)
        expect(evaluateRule(r, createTestUser({ userId: 'user-999' }), evaluator)).toBe(false)
      })

      it('should exclude user in excluded list even if in included', async () => {
        const segment: Segment = {
          key: 'special-users',
          name: 'Special Users',
          included: ['user-1', 'user-2', 'user-3'],
          excluded: ['user-2'],
        }

        await segmentStore.create(segment)

        const r: TargetingRule = {
          attribute: '',
          operator: 'inSegment',
          value: 'special-users',
        }

        expect(evaluateRule(r, createTestUser({ userId: 'user-1' }), evaluator)).toBe(true)
        expect(evaluateRule(r, createTestUser({ userId: 'user-2' }), evaluator)).toBe(false)
        expect(evaluateRule(r, createTestUser({ userId: 'user-3' }), evaluator)).toBe(true)
      })
    })

    describe('dynamic segment (rule-based)', () => {
      it('should match user based on segment rules', async () => {
        const enterpriseSegment: Segment = {
          key: 'enterprise-customers',
          name: 'Enterprise Customers',
          rules: [
            {
              attribute: 'plan',
              operator: 'equals',
              value: 'enterprise',
            },
          ],
        }

        await segmentStore.create(enterpriseSegment)

        const r: TargetingRule = {
          attribute: '',
          operator: 'inSegment',
          value: 'enterprise-customers',
        }

        expect(evaluateRule(r, createTestUser({ plan: 'enterprise' }), evaluator)).toBe(true)
        expect(evaluateRule(r, createTestUser({ plan: 'free' }), evaluator)).toBe(false)
      })

      it('should match segment with multiple rule clauses (AND logic)', async () => {
        const segment: Segment = {
          key: 'premium-active',
          name: 'Premium Active Users',
          rules: [
            { attribute: 'plan', operator: 'in', value: ['premium', 'enterprise'] },
            { attribute: 'lastActiveAt', operator: 'gte', value: Date.now() - 7 * 24 * 60 * 60 * 1000 },
          ],
        }

        await segmentStore.create(segment)

        const r: TargetingRule = {
          attribute: '',
          operator: 'inSegment',
          value: 'premium-active',
        }

        const premiumActive = createTestUser({ plan: 'premium', lastActiveAt: Date.now() })
        const premiumInactive = createTestUser({
          plan: 'premium',
          lastActiveAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
        })
        const freeActive = createTestUser({ plan: 'free', lastActiveAt: Date.now() })

        expect(evaluateRule(r, premiumActive, evaluator)).toBe(true)
        expect(evaluateRule(r, premiumInactive, evaluator)).toBe(false)
        expect(evaluateRule(r, freeActive, evaluator)).toBe(false)
      })

      it('should match segment by email domain', async () => {
        const segment: Segment = {
          key: 'internal-team',
          name: 'Internal Team',
          rules: [
            { attribute: 'email', operator: 'endsWith', value: '@company.com' },
          ],
        }

        await segmentStore.create(segment)

        const r: TargetingRule = {
          attribute: '',
          operator: 'inSegment',
          value: 'internal-team',
        }

        expect(evaluateRule(r, createTestUser({ email: 'alice@company.com' }), evaluator)).toBe(true)
        expect(evaluateRule(r, createTestUser({ email: 'bob@gmail.com' }), evaluator)).toBe(false)
      })
    })

    describe('segment exclusion', () => {
      it('should match user NOT in segment', async () => {
        const blockedSegment: Segment = {
          key: 'blocked-users',
          name: 'Blocked Users',
          included: ['spammer-1', 'abuser-1'],
        }

        await segmentStore.create(blockedSegment)

        const r: TargetingRule = {
          attribute: '',
          operator: 'notInSegment',
          value: 'blocked-users',
        }

        expect(evaluateRule(r, createTestUser({ userId: 'normal-user' }), evaluator)).toBe(true)
        expect(evaluateRule(r, createTestUser({ userId: 'spammer-1' }), evaluator)).toBe(false)
      })

      it('should return true for non-existent segment with notInSegment', async () => {
        const r: TargetingRule = {
          attribute: '',
          operator: 'notInSegment',
          value: 'non-existent-segment',
        }

        expect(evaluateRule(r, createTestUser(), evaluator)).toBe(true)
      })
    })

    describe('multiple segment checks', () => {
      beforeEach(async () => {
        await segmentStore.create({
          key: 'segment-a',
          name: 'Segment A',
          included: ['user-a1', 'user-a2'],
        })

        await segmentStore.create({
          key: 'segment-b',
          name: 'Segment B',
          included: ['user-b1', 'user-b2'],
        })

        await segmentStore.create({
          key: 'segment-c',
          name: 'Segment C',
          included: ['user-c1', 'user-c2'],
        })
      })

      it('should match user in any of multiple segments', async () => {
        const r: TargetingRule = {
          attribute: '',
          operator: 'inAnySegment',
          value: ['segment-a', 'segment-b', 'segment-c'],
        }

        expect(evaluateRule(r, createTestUser({ userId: 'user-a1' }), evaluator)).toBe(true)
        expect(evaluateRule(r, createTestUser({ userId: 'user-b2' }), evaluator)).toBe(true)
        expect(evaluateRule(r, createTestUser({ userId: 'user-c1' }), evaluator)).toBe(true)
        expect(evaluateRule(r, createTestUser({ userId: 'user-other' }), evaluator)).toBe(false)
      })

      it('should match user in all of multiple segments', async () => {
        // Create overlapping segments
        await segmentStore.create({
          key: 'premium',
          name: 'Premium',
          rules: [{ attribute: 'plan', operator: 'equals', value: 'premium' }],
        })

        await segmentStore.create({
          key: 'verified',
          name: 'Verified',
          rules: [{ attribute: 'verified', operator: 'equals', value: true }],
        })

        const r: TargetingRule = {
          attribute: '',
          operator: 'inAllSegments',
          value: ['premium', 'verified'],
        }

        const premiumVerified = createTestUser({ plan: 'premium', verified: true })
        const premiumUnverified = createTestUser({ plan: 'premium', verified: false })
        const freeVerified = createTestUser({ plan: 'free', verified: true })

        expect(evaluateRule(r, premiumVerified, evaluator)).toBe(true)
        expect(evaluateRule(r, premiumUnverified, evaluator)).toBe(false)
        expect(evaluateRule(r, freeVerified, evaluator)).toBe(false)
      })
    })
  })

  // =============================================================================
  // 3. Complex Rule Combinations Tests
  // =============================================================================

  describe('complex rule combinations', () => {
    let evaluator: RuleEvaluator

    beforeEach(() => {
      evaluator = createRuleEvaluator()
    })

    describe('AND logic', () => {
      it('should match when all rules pass (AND)', () => {
        const rules: TargetingRule[] = [
          { attribute: 'country', operator: 'equals', value: 'US' },
          { attribute: 'age', operator: 'gte', value: 18 },
          { attribute: 'verified', operator: 'equals', value: true },
        ]

        const qualifiedUser = createTestUser({ country: 'US', age: 25, verified: true })
        const wrongCountry = createTestUser({ country: 'UK', age: 25, verified: true })
        const tooYoung = createTestUser({ country: 'US', age: 16, verified: true })
        const unverified = createTestUser({ country: 'US', age: 25, verified: false })

        expect(evaluateRules(rules, qualifiedUser, { logic: 'AND' })).toBe(true)
        expect(evaluateRules(rules, wrongCountry, { logic: 'AND' })).toBe(false)
        expect(evaluateRules(rules, tooYoung, { logic: 'AND' })).toBe(false)
        expect(evaluateRules(rules, unverified, { logic: 'AND' })).toBe(false)
      })

      it('should short-circuit AND on first failure', () => {
        const evaluationCount = { count: 0 }
        const trackingEvaluator = createRuleEvaluator({
          onEvaluate: () => evaluationCount.count++,
        })

        const rules: TargetingRule[] = [
          { attribute: 'a', operator: 'equals', value: false }, // Will fail
          { attribute: 'b', operator: 'equals', value: true }, // Should not be evaluated
          { attribute: 'c', operator: 'equals', value: true }, // Should not be evaluated
        ]

        evaluateRules(rules, createTestUser({ a: true, b: true, c: true }), {
          logic: 'AND',
          evaluator: trackingEvaluator,
        })

        expect(evaluationCount.count).toBe(1) // Only first rule evaluated
      })
    })

    describe('OR logic', () => {
      it('should match when any rule passes (OR)', () => {
        const rules: TargetingRule[] = [
          { attribute: 'role', operator: 'equals', value: 'admin' },
          { attribute: 'role', operator: 'equals', value: 'moderator' },
          { attribute: 'isOwner', operator: 'equals', value: true },
        ]

        const admin = createTestUser({ role: 'admin' })
        const moderator = createTestUser({ role: 'moderator' })
        const owner = createTestUser({ role: 'user', isOwner: true })
        const regular = createTestUser({ role: 'user', isOwner: false })

        expect(evaluateRules(rules, admin, { logic: 'OR' })).toBe(true)
        expect(evaluateRules(rules, moderator, { logic: 'OR' })).toBe(true)
        expect(evaluateRules(rules, owner, { logic: 'OR' })).toBe(true)
        expect(evaluateRules(rules, regular, { logic: 'OR' })).toBe(false)
      })

      it('should short-circuit OR on first success', () => {
        const evaluationCount = { count: 0 }
        const trackingEvaluator = createRuleEvaluator({
          onEvaluate: () => evaluationCount.count++,
        })

        const rules: TargetingRule[] = [
          { attribute: 'a', operator: 'equals', value: true }, // Will pass
          { attribute: 'b', operator: 'equals', value: true }, // Should not be evaluated
          { attribute: 'c', operator: 'equals', value: true }, // Should not be evaluated
        ]

        evaluateRules(rules, createTestUser({ a: true, b: false, c: false }), {
          logic: 'OR',
          evaluator: trackingEvaluator,
        })

        expect(evaluationCount.count).toBe(1) // Only first rule evaluated
      })
    })

    describe('NOT logic', () => {
      it('should negate rule result', () => {
        const r: TargetingRule = {
          attribute: 'country',
          operator: 'in',
          value: ['CN', 'RU', 'IR'],
          negate: true,
        }

        expect(evaluateRule(r, createTestUser({ country: 'US' }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ country: 'CN' }))).toBe(false)
      })
    })

    describe('nested rule groups', () => {
      it('should evaluate nested AND within OR', () => {
        // (country=US AND age>=18) OR (country=CA AND age>=19)
        const complexRule: TargetingRule = {
          operator: 'or',
          children: [
            {
              operator: 'and',
              children: [
                { attribute: 'country', operator: 'equals', value: 'US' },
                { attribute: 'age', operator: 'gte', value: 18 },
              ],
            },
            {
              operator: 'and',
              children: [
                { attribute: 'country', operator: 'equals', value: 'CA' },
                { attribute: 'age', operator: 'gte', value: 19 },
              ],
            },
          ],
        }

        expect(evaluateRule(complexRule, createTestUser({ country: 'US', age: 18 }))).toBe(true)
        expect(evaluateRule(complexRule, createTestUser({ country: 'CA', age: 19 }))).toBe(true)
        expect(evaluateRule(complexRule, createTestUser({ country: 'CA', age: 18 }))).toBe(false) // CA requires 19
        expect(evaluateRule(complexRule, createTestUser({ country: 'UK', age: 25 }))).toBe(false)
      })

      it('should evaluate nested OR within AND', () => {
        // country IN [US,CA] AND (role=admin OR role=moderator)
        const complexRule: TargetingRule = {
          operator: 'and',
          children: [
            { attribute: 'country', operator: 'in', value: ['US', 'CA'] },
            {
              operator: 'or',
              children: [
                { attribute: 'role', operator: 'equals', value: 'admin' },
                { attribute: 'role', operator: 'equals', value: 'moderator' },
              ],
            },
          ],
        }

        expect(evaluateRule(complexRule, createTestUser({ country: 'US', role: 'admin' }))).toBe(true)
        expect(evaluateRule(complexRule, createTestUser({ country: 'CA', role: 'moderator' }))).toBe(true)
        expect(evaluateRule(complexRule, createTestUser({ country: 'US', role: 'user' }))).toBe(false)
        expect(evaluateRule(complexRule, createTestUser({ country: 'UK', role: 'admin' }))).toBe(false)
      })

      it('should evaluate deeply nested rules', () => {
        // ((A AND B) OR (C AND D)) AND E
        const deepRule: TargetingRule = {
          operator: 'and',
          children: [
            {
              operator: 'or',
              children: [
                {
                  operator: 'and',
                  children: [
                    { attribute: 'a', operator: 'equals', value: true },
                    { attribute: 'b', operator: 'equals', value: true },
                  ],
                },
                {
                  operator: 'and',
                  children: [
                    { attribute: 'c', operator: 'equals', value: true },
                    { attribute: 'd', operator: 'equals', value: true },
                  ],
                },
              ],
            },
            { attribute: 'e', operator: 'equals', value: true },
          ],
        }

        expect(evaluateRule(deepRule, createTestUser({ a: true, b: true, e: true }))).toBe(true)
        expect(evaluateRule(deepRule, createTestUser({ c: true, d: true, e: true }))).toBe(true)
        expect(evaluateRule(deepRule, createTestUser({ a: true, b: true, e: false }))).toBe(false)
        expect(evaluateRule(deepRule, createTestUser({ a: true, c: true, e: true }))).toBe(false)
      })
    })

    describe('NOT with nested rules', () => {
      it('should negate nested rule group', () => {
        // NOT (country IN [CN, RU, IR])
        const negatedRule: TargetingRule = {
          operator: 'not',
          children: [{ attribute: 'country', operator: 'in', value: ['CN', 'RU', 'IR'] }],
        }

        expect(evaluateRule(negatedRule, createTestUser({ country: 'US' }))).toBe(true)
        expect(evaluateRule(negatedRule, createTestUser({ country: 'CN' }))).toBe(false)
      })

      it('should negate complex nested rule', () => {
        // NOT (role=guest AND verified=false)
        const negatedRule: TargetingRule = {
          operator: 'not',
          children: [
            {
              operator: 'and',
              children: [
                { attribute: 'role', operator: 'equals', value: 'guest' },
                { attribute: 'verified', operator: 'equals', value: false },
              ],
            },
          ],
        }

        expect(evaluateRule(negatedRule, createTestUser({ role: 'guest', verified: false }))).toBe(false)
        expect(evaluateRule(negatedRule, createTestUser({ role: 'guest', verified: true }))).toBe(true)
        expect(evaluateRule(negatedRule, createTestUser({ role: 'user', verified: false }))).toBe(true)
      })
    })
  })

  // =============================================================================
  // 4. Edge Cases Tests
  // =============================================================================

  describe('edge cases', () => {
    let evaluator: RuleEvaluator

    beforeEach(() => {
      evaluator = createRuleEvaluator()
    })

    describe('missing attributes', () => {
      it('should return false when attribute is missing', () => {
        const r: TargetingRule = {
          attribute: 'nonExistent',
          operator: 'equals',
          value: 'anything',
        }

        expect(evaluateRule(r, createTestUser())).toBe(false)
      })

      it('should return false for missing nested attribute', () => {
        const r: TargetingRule = {
          attribute: 'deeply.nested.path',
          operator: 'equals',
          value: 'value',
        }

        expect(evaluateRule(r, createTestUser({}))).toBe(false)
        expect(evaluateRule(r, createTestUser({ deeply: {} }))).toBe(false)
        expect(evaluateRule(r, createTestUser({ deeply: { nested: {} } }))).toBe(false)
      })

      it('should handle exists operator for missing attribute', () => {
        const r: TargetingRule = {
          attribute: 'optionalField',
          operator: 'exists',
          value: true,
        }

        expect(evaluateRule(r, createTestUser({}))).toBe(false)
        expect(evaluateRule(r, createTestUser({ optionalField: undefined }))).toBe(false)
        expect(evaluateRule(r, createTestUser({ optionalField: null }))).toBe(false)
        expect(evaluateRule(r, createTestUser({ optionalField: '' }))).toBe(true) // Empty string exists
      })
    })

    describe('null and undefined values', () => {
      it('should handle null attribute value', () => {
        const r: TargetingRule = {
          attribute: 'field',
          operator: 'equals',
          value: null,
        }

        expect(evaluateRule(r, createTestUser({ field: null }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ field: undefined }))).toBe(false)
        expect(evaluateRule(r, createTestUser({ field: '' }))).toBe(false)
      })

      it('should treat null as not existing for exists operator', () => {
        const r: TargetingRule = {
          attribute: 'field',
          operator: 'exists',
          value: true,
        }

        expect(evaluateRule(r, createTestUser({ field: null }))).toBe(false)
      })

      it('should handle undefined rule value gracefully', () => {
        const r: TargetingRule = {
          attribute: 'field',
          operator: 'equals',
          value: undefined,
        }

        expect(evaluateRule(r, createTestUser({ field: undefined }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ field: null }))).toBe(false)
      })
    })

    describe('type coercion', () => {
      it('should coerce string numbers for numeric comparisons', () => {
        const r: TargetingRule = {
          attribute: 'age',
          operator: 'gte',
          value: 18,
        }

        expect(evaluateRule(r, createTestUser({ age: '25' }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ age: '15' }))).toBe(false)
      })

      it('should coerce boolean strings', () => {
        const r: TargetingRule = {
          attribute: 'active',
          operator: 'equals',
          value: true,
        }

        expect(evaluateRule(r, createTestUser({ active: true }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ active: 'true' }))).toBe(true) // String coercion
        expect(evaluateRule(r, createTestUser({ active: 1 }))).toBe(true) // Number coercion
      })

      it('should handle date comparisons', () => {
        const r: TargetingRule = {
          attribute: 'createdAt',
          operator: 'gt',
          value: '2024-01-01T00:00:00Z',
        }

        expect(evaluateRule(r, createTestUser({ createdAt: '2024-06-15T00:00:00Z' }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ createdAt: '2023-06-15T00:00:00Z' }))).toBe(false)
        expect(evaluateRule(r, createTestUser({ createdAt: new Date('2024-06-15') }))).toBe(true)
      })
    })

    describe('empty values', () => {
      it('should handle empty string', () => {
        const r: TargetingRule = {
          attribute: 'name',
          operator: 'equals',
          value: '',
        }

        expect(evaluateRule(r, createTestUser({ name: '' }))).toBe(true)
        expect(evaluateRule(r, createTestUser({ name: 'Alice' }))).toBe(false)
      })

      it('should handle empty array for in operator', () => {
        const r: TargetingRule = {
          attribute: 'country',
          operator: 'in',
          value: [],
        }

        expect(evaluateRule(r, createTestUser({ country: 'US' }))).toBe(false)
      })

      it('should handle empty children for logical operators', () => {
        const andRule: TargetingRule = {
          operator: 'and',
          children: [],
        }

        const orRule: TargetingRule = {
          operator: 'or',
          children: [],
        }

        // Empty AND = true (vacuous truth)
        expect(evaluateRule(andRule, createTestUser())).toBe(true)
        // Empty OR = false
        expect(evaluateRule(orRule, createTestUser())).toBe(false)
      })
    })

    describe('invalid inputs', () => {
      it('should return false for unknown operator', () => {
        const r: TargetingRule = {
          attribute: 'field',
          operator: 'unknownOperator' as RuleOperator,
          value: 'value',
        }

        expect(evaluateRule(r, createTestUser({ field: 'value' }))).toBe(false)
      })

      it('should handle invalid regex pattern', () => {
        const r: TargetingRule = {
          attribute: 'email',
          operator: 'matches',
          value: '[invalid(regex',
        }

        expect(evaluateRule(r, createTestUser({ email: 'test@example.com' }))).toBe(false)
      })

      it('should handle between with invalid array', () => {
        const r: TargetingRule = {
          attribute: 'age',
          operator: 'between',
          value: [18], // Should be [min, max]
        }

        expect(evaluateRule(r, createTestUser({ age: 25 }))).toBe(false)
      })

      it('should handle non-array value for in operator', () => {
        const r: TargetingRule = {
          attribute: 'country',
          operator: 'in',
          value: 'US', // Should be array
        }

        expect(evaluateRule(r, createTestUser({ country: 'US' }))).toBe(false)
      })
    })

    describe('max depth protection', () => {
      it('should limit recursion depth', () => {
        // Create deeply nested rule (beyond max depth)
        let deepRule: TargetingRule = { attribute: 'x', operator: 'equals', value: true }
        for (let i = 0; i < 20; i++) {
          deepRule = { operator: 'and', children: [deepRule] }
        }

        const limitedEvaluator = createRuleEvaluator({ maxDepth: 10 })

        expect(evaluateRule(deepRule, createTestUser({ x: true }), limitedEvaluator)).toBe(false)
      })
    })

    describe('special characters', () => {
      it('should handle special characters in attribute names', () => {
        const r: TargetingRule = {
          attribute: 'custom.my-field',
          operator: 'equals',
          value: 'value',
        }

        expect(evaluateRule(r, createTestUser({ custom: { 'my-field': 'value' } }))).toBe(true)
      })

      it('should handle special characters in values', () => {
        const r: TargetingRule = {
          attribute: 'name',
          operator: 'equals',
          value: "O'Brien",
        }

        expect(evaluateRule(r, createTestUser({ name: "O'Brien" }))).toBe(true)
      })

      it('should handle unicode in values', () => {
        const r: TargetingRule = {
          attribute: 'name',
          operator: 'equals',
          value: '\u0430\u0431\u0432', // Cyrillic
        }

        expect(evaluateRule(r, createTestUser({ name: '\u0430\u0431\u0432' }))).toBe(true)
      })
    })

    describe('consistency', () => {
      it('should return consistent results for same input', () => {
        const r: TargetingRule = {
          attribute: 'userId',
          operator: 'equals',
          value: 'user-123',
        }

        const user = createTestUser({ userId: 'user-123' })

        // Run multiple times
        const results = [
          evaluateRule(r, user),
          evaluateRule(r, user),
          evaluateRule(r, user),
        ]

        expect(results.every((r) => r === true)).toBe(true)
      })
    })

    describe('performance', () => {
      it('should handle large list efficiently', () => {
        const largeList = Array.from({ length: 10000 }, (_, i) => `user-${i}`)
        const r: TargetingRule = {
          attribute: 'userId',
          operator: 'in',
          value: largeList,
        }

        const start = performance.now()
        evaluateRule(r, createTestUser({ userId: 'user-5000' }))
        const duration = performance.now() - start

        expect(duration).toBeLessThan(100) // Should be fast
      })

      it('should handle many rules efficiently', () => {
        const rules: TargetingRule[] = Array.from({ length: 100 }, (_, i) => ({
          attribute: `field${i}`,
          operator: 'equals' as const,
          value: `value${i}`,
        }))

        const user = createTestUser({ field50: 'value50' })

        const start = performance.now()
        evaluateRules(rules, user, { logic: 'OR' })
        const duration = performance.now() - start

        expect(duration).toBeLessThan(100) // Should be fast
      })
    })
  })

  // =============================================================================
  // Rule Builder Helper Tests
  // =============================================================================

  describe('rule builder helpers', () => {
    it('should create rule with rule() helper', () => {
      const r = rule('email', 'endsWith', '@company.com')

      expect(r).toEqual({
        attribute: 'email',
        operator: 'endsWith',
        value: '@company.com',
      })
    })

    it('should create segment with segment() helper', () => {
      const s = segment('beta-users', {
        included: ['user-1', 'user-2'],
        rules: [{ attribute: 'plan', operator: 'equals', value: 'beta' }],
      })

      expect(s.key).toBe('beta-users')
      expect(s.included).toEqual(['user-1', 'user-2'])
      expect(s.rules).toHaveLength(1)
    })
  })

  // =============================================================================
  // Evaluation Result Tests
  // =============================================================================

  describe('evaluation results', () => {
    it('should return detailed evaluation result', () => {
      const r: TargetingRule = {
        attribute: 'email',
        operator: 'equals',
        value: 'alice@example.com',
      }

      const evaluator = createRuleEvaluator({ returnDetails: true })
      const result: EvaluationResult = evaluator.evaluateWithDetails(
        r,
        createTestUser({ email: 'alice@example.com' })
      )

      expect(result.matched).toBe(true)
      expect(result.rule).toEqual(r)
      expect(result.reason).toBe('Rule matched')
      expect(result.evaluatedAt).toBeDefined()
    })

    it('should include reason for non-match', () => {
      const r: TargetingRule = {
        attribute: 'age',
        operator: 'gte',
        value: 21,
      }

      const evaluator = createRuleEvaluator({ returnDetails: true })
      const result: EvaluationResult = evaluator.evaluateWithDetails(
        r,
        createTestUser({ age: 18 })
      )

      expect(result.matched).toBe(false)
      expect(result.reason).toContain('did not match')
    })

    it('should include error for invalid rule', () => {
      const r: TargetingRule = {
        attribute: 'email',
        operator: 'matches',
        value: '[invalid(regex',
      }

      const evaluator = createRuleEvaluator({ returnDetails: true })
      const result: EvaluationResult = evaluator.evaluateWithDetails(
        r,
        createTestUser({ email: 'test@example.com' })
      )

      expect(result.matched).toBe(false)
      expect(result.error).toBeDefined()
    })
  })
})
