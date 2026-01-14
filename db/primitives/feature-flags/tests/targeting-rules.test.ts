/**
 * Feature Flags Targeting Rules Tests - TDD RED Phase
 *
 * Comprehensive tests for targeting rules that determine which users/contexts
 * see which feature flag variants. Tests cover:
 *
 * 1. User attribute matching (email, userId, role)
 * 2. Segment membership (user in segment)
 * 3. Multiple segment checks (user in ANY of segments)
 * 4. Segment exclusion (user NOT in segment)
 * 5. Attribute conditions (numeric comparisons, IN lists)
 * 6. Custom attributes (any key/value pair)
 * 7. Rule ordering (first matching rule wins)
 * 8. Default rule (fallback when no rules match)
 * 9. Rule priority/weight
 * 10. Complex nested rules
 * 11. Date-based targeting (createdAt before/after)
 * 12. Device/platform targeting
 *
 * These tests should FAIL until implementation is complete.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  // Rule evaluation
  createTargetingEngine,
  evaluateTargetingRules,

  // Rule builders
  createRule,
  createSegment,

  // Types
  type TargetingEngine,
  type TargetingRule,
  type Segment,
  type UserContext,
  type RuleCondition,
  type EvaluationResult,
  type SegmentDefinition,
} from '../targeting-rules'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestEngine(): TargetingEngine {
  return createTargetingEngine()
}

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
    let engine: TargetingEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    it('should match user by email address', async () => {
      await engine.createRule({
        id: 'rule-1',
        flagKey: 'test-flag',
        conditions: [
          { attribute: 'email', operator: 'equals', value: 'vip@example.com' },
        ],
        variation: 1,
      })

      const vipUser = createTestUser({ email: 'vip@example.com' })
      const regularUser = createTestUser({ email: 'regular@example.com' })

      const vipResult = await engine.evaluate('test-flag', vipUser)
      const regularResult = await engine.evaluate('test-flag', regularUser)

      expect(vipResult.matched).toBe(true)
      expect(vipResult.variation).toBe(1)
      expect(regularResult.matched).toBe(false)
    })

    it('should match user by userId', async () => {
      await engine.createRule({
        id: 'rule-1',
        flagKey: 'beta-feature',
        conditions: [
          { attribute: 'userId', operator: 'in', value: ['user-1', 'user-2', 'user-3'] },
        ],
        variation: 1,
      })

      const betaUser = createTestUser({ userId: 'user-2' })
      const nonBetaUser = createTestUser({ userId: 'user-999' })

      const betaResult = await engine.evaluate('beta-feature', betaUser)
      const nonBetaResult = await engine.evaluate('beta-feature', nonBetaUser)

      expect(betaResult.matched).toBe(true)
      expect(nonBetaResult.matched).toBe(false)
    })

    it('should match user by role', async () => {
      await engine.createRule({
        id: 'admin-rule',
        flagKey: 'admin-feature',
        conditions: [
          { attribute: 'role', operator: 'equals', value: 'admin' },
        ],
        variation: 1,
      })

      const adminUser = createTestUser({ role: 'admin' })
      const regularUser = createTestUser({ role: 'user' })

      const adminResult = await engine.evaluate('admin-feature', adminUser)
      const regularResult = await engine.evaluate('admin-feature', regularUser)

      expect(adminResult.matched).toBe(true)
      expect(regularResult.matched).toBe(false)
    })

    it('should match email domain with endsWith', async () => {
      await engine.createRule({
        id: 'company-rule',
        flagKey: 'internal-feature',
        conditions: [
          { attribute: 'email', operator: 'endsWith', value: '@company.com' },
        ],
        variation: 1,
      })

      const internalUser = createTestUser({ email: 'alice@company.com' })
      const externalUser = createTestUser({ email: 'bob@gmail.com' })

      const internalResult = await engine.evaluate('internal-feature', internalUser)
      const externalResult = await engine.evaluate('internal-feature', externalUser)

      expect(internalResult.matched).toBe(true)
      expect(externalResult.matched).toBe(false)
    })

    it('should match email pattern with regex', async () => {
      await engine.createRule({
        id: 'partner-rule',
        flagKey: 'partner-feature',
        conditions: [
          { attribute: 'email', operator: 'matches', value: '^.*@(partner1|partner2)\\.com$' },
        ],
        variation: 1,
      })

      const partner1User = createTestUser({ email: 'user@partner1.com' })
      const partner2User = createTestUser({ email: 'user@partner2.com' })
      const nonPartner = createTestUser({ email: 'user@other.com' })

      expect((await engine.evaluate('partner-feature', partner1User)).matched).toBe(true)
      expect((await engine.evaluate('partner-feature', partner2User)).matched).toBe(true)
      expect((await engine.evaluate('partner-feature', nonPartner)).matched).toBe(false)
    })
  })

  // =============================================================================
  // 2. Segment Membership Tests
  // =============================================================================

  describe('segment membership', () => {
    let engine: TargetingEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    it('should match user in a segment', async () => {
      await engine.createSegment({
        key: 'beta-users',
        name: 'Beta Users',
        included: ['user-1', 'user-2', 'user-3'],
      })

      await engine.createRule({
        id: 'beta-rule',
        flagKey: 'beta-feature',
        conditions: [
          { attribute: 'segment', operator: 'in', value: 'beta-users' },
        ],
        variation: 1,
      })

      const betaUser = createTestUser({ userId: 'user-2' })
      const nonBetaUser = createTestUser({ userId: 'user-999' })

      const betaResult = await engine.evaluate('beta-feature', betaUser)
      const nonBetaResult = await engine.evaluate('beta-feature', nonBetaUser)

      expect(betaResult.matched).toBe(true)
      expect(betaResult.reason?.kind).toBe('RULE_MATCH')
      expect(nonBetaResult.matched).toBe(false)
    })

    it('should support segment with rule-based membership', async () => {
      await engine.createSegment({
        key: 'enterprise-customers',
        name: 'Enterprise Customers',
        rules: [
          {
            clauses: [
              { attribute: 'plan', operator: 'equals', value: 'enterprise' },
            ],
          },
        ],
      })

      await engine.createRule({
        id: 'enterprise-rule',
        flagKey: 'enterprise-feature',
        conditions: [
          { attribute: 'segment', operator: 'in', value: 'enterprise-customers' },
        ],
        variation: 1,
      })

      const enterpriseUser = createTestUser({ plan: 'enterprise' })
      const freeUser = createTestUser({ plan: 'free' })

      expect((await engine.evaluate('enterprise-feature', enterpriseUser)).matched).toBe(true)
      expect((await engine.evaluate('enterprise-feature', freeUser)).matched).toBe(false)
    })

    it('should match segment by email domain rule', async () => {
      await engine.createSegment({
        key: 'internal-team',
        name: 'Internal Team',
        rules: [
          {
            clauses: [
              { attribute: 'email', operator: 'endsWith', value: '@company.com' },
            ],
          },
        ],
      })

      await engine.createRule({
        id: 'internal-rule',
        flagKey: 'internal-tool',
        conditions: [
          { attribute: 'segment', operator: 'in', value: 'internal-team' },
        ],
        variation: 1,
      })

      const internalUser = createTestUser({ email: 'alice@company.com' })
      const externalUser = createTestUser({ email: 'bob@external.com' })

      expect((await engine.evaluate('internal-tool', internalUser)).matched).toBe(true)
      expect((await engine.evaluate('internal-tool', externalUser)).matched).toBe(false)
    })
  })

  // =============================================================================
  // 3. Multiple Segment Check Tests
  // =============================================================================

  describe('multiple segment check', () => {
    let engine: TargetingEngine

    beforeEach(async () => {
      engine = createTestEngine()

      // Create multiple segments
      await engine.createSegment({
        key: 'segment-a',
        name: 'Segment A',
        included: ['user-a1', 'user-a2'],
      })

      await engine.createSegment({
        key: 'segment-b',
        name: 'Segment B',
        included: ['user-b1', 'user-b2'],
      })

      await engine.createSegment({
        key: 'segment-c',
        name: 'Segment C',
        included: ['user-c1', 'user-c2'],
      })
    })

    it('should match user in ANY of multiple segments', async () => {
      await engine.createRule({
        id: 'multi-segment-rule',
        flagKey: 'multi-segment-feature',
        conditions: [
          {
            attribute: 'segment',
            operator: 'inAny',
            value: ['segment-a', 'segment-b', 'segment-c'],
          },
        ],
        variation: 1,
      })

      const userA = createTestUser({ userId: 'user-a1' })
      const userB = createTestUser({ userId: 'user-b2' })
      const userC = createTestUser({ userId: 'user-c1' })
      const userNone = createTestUser({ userId: 'user-none' })

      expect((await engine.evaluate('multi-segment-feature', userA)).matched).toBe(true)
      expect((await engine.evaluate('multi-segment-feature', userB)).matched).toBe(true)
      expect((await engine.evaluate('multi-segment-feature', userC)).matched).toBe(true)
      expect((await engine.evaluate('multi-segment-feature', userNone)).matched).toBe(false)
    })

    it('should match user in ALL of multiple segments', async () => {
      // Create overlapping segments
      await engine.createSegment({
        key: 'premium-users',
        name: 'Premium Users',
        rules: [{ clauses: [{ attribute: 'plan', operator: 'equals', value: 'premium' }] }],
      })

      await engine.createSegment({
        key: 'active-users',
        name: 'Active Users',
        rules: [{ clauses: [{ attribute: 'lastActive', operator: 'after', value: Date.now() - 7 * 24 * 60 * 60 * 1000 }] }],
      })

      await engine.createRule({
        id: 'all-segments-rule',
        flagKey: 'premium-active-feature',
        conditions: [
          {
            attribute: 'segment',
            operator: 'inAll',
            value: ['premium-users', 'active-users'],
          },
        ],
        variation: 1,
      })

      const premiumActive = createTestUser({
        plan: 'premium',
        lastActive: Date.now(), // active now
      })
      const premiumInactive = createTestUser({
        plan: 'premium',
        lastActive: Date.now() - 30 * 24 * 60 * 60 * 1000, // inactive
      })

      expect((await engine.evaluate('premium-active-feature', premiumActive)).matched).toBe(true)
      expect((await engine.evaluate('premium-active-feature', premiumInactive)).matched).toBe(false)
    })
  })

  // =============================================================================
  // 4. Segment Exclusion Tests
  // =============================================================================

  describe('segment exclusion', () => {
    let engine: TargetingEngine

    beforeEach(async () => {
      engine = createTestEngine()

      await engine.createSegment({
        key: 'blocked-users',
        name: 'Blocked Users',
        included: ['spammer-1', 'abuser-1'],
      })

      await engine.createSegment({
        key: 'free-trial',
        name: 'Free Trial Users',
        rules: [{ clauses: [{ attribute: 'plan', operator: 'equals', value: 'trial' }] }],
      })
    })

    it('should match user NOT in a segment', async () => {
      await engine.createRule({
        id: 'non-blocked-rule',
        flagKey: 'main-feature',
        conditions: [
          { attribute: 'segment', operator: 'notIn', value: 'blocked-users' },
        ],
        variation: 1,
      })

      const normalUser = createTestUser({ userId: 'normal-user' })
      const blockedUser = createTestUser({ userId: 'spammer-1' })

      expect((await engine.evaluate('main-feature', normalUser)).matched).toBe(true)
      expect((await engine.evaluate('main-feature', blockedUser)).matched).toBe(false)
    })

    it('should support segment with excluded users', async () => {
      await engine.createSegment({
        key: 'vip-users',
        name: 'VIP Users',
        included: ['vip-1', 'vip-2', 'vip-3'],
        excluded: ['vip-2'], // Explicit exclusion overrides inclusion
      })

      await engine.createRule({
        id: 'vip-rule',
        flagKey: 'vip-feature',
        conditions: [
          { attribute: 'segment', operator: 'in', value: 'vip-users' },
        ],
        variation: 1,
      })

      const vip1 = createTestUser({ userId: 'vip-1' })
      const vip2Excluded = createTestUser({ userId: 'vip-2' })

      expect((await engine.evaluate('vip-feature', vip1)).matched).toBe(true)
      expect((await engine.evaluate('vip-feature', vip2Excluded)).matched).toBe(false)
    })

    it('should exclude premium features from trial users', async () => {
      await engine.createRule({
        id: 'paid-only-rule',
        flagKey: 'premium-feature',
        conditions: [
          { attribute: 'segment', operator: 'notIn', value: 'free-trial' },
        ],
        variation: 1,
      })

      const paidUser = createTestUser({ plan: 'pro' })
      const trialUser = createTestUser({ plan: 'trial' })

      expect((await engine.evaluate('premium-feature', paidUser)).matched).toBe(true)
      expect((await engine.evaluate('premium-feature', trialUser)).matched).toBe(false)
    })
  })

  // =============================================================================
  // 5. Attribute Conditions Tests
  // =============================================================================

  describe('attribute conditions', () => {
    let engine: TargetingEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    it('should match numeric greater than condition', async () => {
      await engine.createRule({
        id: 'adult-rule',
        flagKey: 'adult-content',
        conditions: [
          { attribute: 'age', operator: 'greaterThan', value: 18 },
        ],
        variation: 1,
      })

      const adult = createTestUser({ age: 25 })
      const minor = createTestUser({ age: 16 })
      const exactly18 = createTestUser({ age: 18 })

      expect((await engine.evaluate('adult-content', adult)).matched).toBe(true)
      expect((await engine.evaluate('adult-content', minor)).matched).toBe(false)
      expect((await engine.evaluate('adult-content', exactly18)).matched).toBe(false)
    })

    it('should match numeric greater than or equal condition', async () => {
      await engine.createRule({
        id: 'adult-rule',
        flagKey: 'adult-content',
        conditions: [
          { attribute: 'age', operator: 'greaterThanOrEqual', value: 18 },
        ],
        variation: 1,
      })

      const exactly18 = createTestUser({ age: 18 })
      const adult = createTestUser({ age: 25 })
      const minor = createTestUser({ age: 17 })

      expect((await engine.evaluate('adult-content', exactly18)).matched).toBe(true)
      expect((await engine.evaluate('adult-content', adult)).matched).toBe(true)
      expect((await engine.evaluate('adult-content', minor)).matched).toBe(false)
    })

    it('should match numeric less than condition', async () => {
      await engine.createRule({
        id: 'junior-rule',
        flagKey: 'junior-pricing',
        conditions: [
          { attribute: 'age', operator: 'lessThan', value: 26 },
        ],
        variation: 1,
      })

      const young = createTestUser({ age: 22 })
      const old = createTestUser({ age: 30 })

      expect((await engine.evaluate('junior-pricing', young)).matched).toBe(true)
      expect((await engine.evaluate('junior-pricing', old)).matched).toBe(false)
    })

    it('should match country IN list condition', async () => {
      await engine.createRule({
        id: 'north-america-rule',
        flagKey: 'na-feature',
        conditions: [
          { attribute: 'country', operator: 'in', value: ['US', 'CA', 'MX'] },
        ],
        variation: 1,
      })

      const usUser = createTestUser({ country: 'US' })
      const caUser = createTestUser({ country: 'CA' })
      const ukUser = createTestUser({ country: 'UK' })

      expect((await engine.evaluate('na-feature', usUser)).matched).toBe(true)
      expect((await engine.evaluate('na-feature', caUser)).matched).toBe(true)
      expect((await engine.evaluate('na-feature', ukUser)).matched).toBe(false)
    })

    it('should match country NOT IN list condition', async () => {
      await engine.createRule({
        id: 'gdpr-rule',
        flagKey: 'tracking-feature',
        conditions: [
          {
            attribute: 'country',
            operator: 'notIn',
            value: ['DE', 'FR', 'IT', 'ES', 'NL'], // EU countries
          },
        ],
        variation: 1,
      })

      const usUser = createTestUser({ country: 'US' })
      const deUser = createTestUser({ country: 'DE' })

      expect((await engine.evaluate('tracking-feature', usUser)).matched).toBe(true)
      expect((await engine.evaluate('tracking-feature', deUser)).matched).toBe(false)
    })

    it('should match numeric between range', async () => {
      await engine.createRule({
        id: 'loyalty-rule',
        flagKey: 'loyalty-discount',
        conditions: [
          { attribute: 'purchaseCount', operator: 'greaterThanOrEqual', value: 5 },
          { attribute: 'purchaseCount', operator: 'lessThan', value: 20 },
        ],
        variation: 1, // 10% discount
      })

      const newUser = createTestUser({ purchaseCount: 2 })
      const loyalUser = createTestUser({ purchaseCount: 10 })
      const vipUser = createTestUser({ purchaseCount: 25 })

      expect((await engine.evaluate('loyalty-discount', newUser)).matched).toBe(false)
      expect((await engine.evaluate('loyalty-discount', loyalUser)).matched).toBe(true)
      expect((await engine.evaluate('loyalty-discount', vipUser)).matched).toBe(false)
    })
  })

  // =============================================================================
  // 6. Custom Attributes Tests
  // =============================================================================

  describe('custom attributes', () => {
    let engine: TargetingEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    it('should match on custom string attribute', async () => {
      await engine.createRule({
        id: 'team-rule',
        flagKey: 'team-feature',
        conditions: [
          { attribute: 'custom.team', operator: 'equals', value: 'engineering' },
        ],
        variation: 1,
      })

      const engUser = createTestUser({
        custom: { team: 'engineering' },
      })
      const salesUser = createTestUser({
        custom: { team: 'sales' },
      })

      expect((await engine.evaluate('team-feature', engUser)).matched).toBe(true)
      expect((await engine.evaluate('team-feature', salesUser)).matched).toBe(false)
    })

    it('should match on custom numeric attribute', async () => {
      await engine.createRule({
        id: 'power-user-rule',
        flagKey: 'power-feature',
        conditions: [
          { attribute: 'custom.loginCount', operator: 'greaterThan', value: 100 },
        ],
        variation: 1,
      })

      const powerUser = createTestUser({
        custom: { loginCount: 500 },
      })
      const newUser = createTestUser({
        custom: { loginCount: 5 },
      })

      expect((await engine.evaluate('power-feature', powerUser)).matched).toBe(true)
      expect((await engine.evaluate('power-feature', newUser)).matched).toBe(false)
    })

    it('should match on custom boolean attribute', async () => {
      await engine.createRule({
        id: 'verified-rule',
        flagKey: 'verified-feature',
        conditions: [
          { attribute: 'custom.emailVerified', operator: 'equals', value: true },
        ],
        variation: 1,
      })

      const verifiedUser = createTestUser({
        custom: { emailVerified: true },
      })
      const unverifiedUser = createTestUser({
        custom: { emailVerified: false },
      })

      expect((await engine.evaluate('verified-feature', verifiedUser)).matched).toBe(true)
      expect((await engine.evaluate('verified-feature', unverifiedUser)).matched).toBe(false)
    })

    it('should match on nested custom attributes', async () => {
      await engine.createRule({
        id: 'nested-rule',
        flagKey: 'nested-feature',
        conditions: [
          { attribute: 'custom.settings.theme', operator: 'equals', value: 'dark' },
        ],
        variation: 1,
      })

      const darkThemeUser = createTestUser({
        custom: { settings: { theme: 'dark', language: 'en' } },
      })
      const lightThemeUser = createTestUser({
        custom: { settings: { theme: 'light', language: 'en' } },
      })

      expect((await engine.evaluate('nested-feature', darkThemeUser)).matched).toBe(true)
      expect((await engine.evaluate('nested-feature', lightThemeUser)).matched).toBe(false)
    })

    it('should handle missing custom attributes gracefully', async () => {
      await engine.createRule({
        id: 'optional-attr-rule',
        flagKey: 'optional-feature',
        conditions: [
          { attribute: 'custom.optionalField', operator: 'equals', value: 'expected' },
        ],
        variation: 1,
      })

      const userWithAttr = createTestUser({
        custom: { optionalField: 'expected' },
      })
      const userWithoutAttr = createTestUser({
        custom: {},
      })
      const userNoCustom = createTestUser()

      expect((await engine.evaluate('optional-feature', userWithAttr)).matched).toBe(true)
      expect((await engine.evaluate('optional-feature', userWithoutAttr)).matched).toBe(false)
      expect((await engine.evaluate('optional-feature', userNoCustom)).matched).toBe(false)
    })

    it('should match custom array attribute with contains', async () => {
      await engine.createRule({
        id: 'tag-rule',
        flagKey: 'tagged-feature',
        conditions: [
          { attribute: 'custom.tags', operator: 'contains', value: 'beta-tester' },
        ],
        variation: 1,
      })

      const betaUser = createTestUser({
        custom: { tags: ['beta-tester', 'early-adopter'] },
      })
      const regularUser = createTestUser({
        custom: { tags: ['customer'] },
      })

      expect((await engine.evaluate('tagged-feature', betaUser)).matched).toBe(true)
      expect((await engine.evaluate('tagged-feature', regularUser)).matched).toBe(false)
    })
  })

  // =============================================================================
  // 7. Rule Ordering Tests
  // =============================================================================

  describe('rule ordering', () => {
    let engine: TargetingEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    it('should apply first matching rule', async () => {
      // Rule 1: VIP users get variation 1
      await engine.createRule({
        id: 'vip-rule',
        flagKey: 'pricing-tier',
        order: 0,
        conditions: [
          { attribute: 'custom.tier', operator: 'equals', value: 'vip' },
        ],
        variation: 1, // VIP pricing
      })

      // Rule 2: Premium users get variation 2
      await engine.createRule({
        id: 'premium-rule',
        flagKey: 'pricing-tier',
        order: 1,
        conditions: [
          { attribute: 'custom.tier', operator: 'in', value: ['vip', 'premium'] },
        ],
        variation: 2, // Premium pricing
      })

      // VIP matches both rules but should get rule 1 (first match)
      const vipUser = createTestUser({ custom: { tier: 'vip' } })
      const result = await engine.evaluate('pricing-tier', vipUser)

      expect(result.matched).toBe(true)
      expect(result.variation).toBe(1)
      expect(result.reason?.ruleId).toBe('vip-rule')
    })

    it('should fall through to later rules if earlier rules do not match', async () => {
      await engine.createRule({
        id: 'admin-rule',
        flagKey: 'feature-access',
        order: 0,
        conditions: [
          { attribute: 'role', operator: 'equals', value: 'admin' },
        ],
        variation: 1, // Full access
      })

      await engine.createRule({
        id: 'moderator-rule',
        flagKey: 'feature-access',
        order: 1,
        conditions: [
          { attribute: 'role', operator: 'equals', value: 'moderator' },
        ],
        variation: 2, // Partial access
      })

      const moderator = createTestUser({ role: 'moderator' })
      const result = await engine.evaluate('feature-access', moderator)

      expect(result.matched).toBe(true)
      expect(result.variation).toBe(2)
      expect(result.reason?.ruleId).toBe('moderator-rule')
    })

    it('should respect explicit order property over creation order', async () => {
      // Create rules out of order
      await engine.createRule({
        id: 'second-rule',
        flagKey: 'ordered-feature',
        order: 10,
        conditions: [
          { attribute: 'email', operator: 'contains', value: '@' },
        ],
        variation: 2,
      })

      await engine.createRule({
        id: 'first-rule',
        flagKey: 'ordered-feature',
        order: 5,
        conditions: [
          { attribute: 'email', operator: 'contains', value: '@' },
        ],
        variation: 1,
      })

      const user = createTestUser({ email: 'test@example.com' })
      const result = await engine.evaluate('ordered-feature', user)

      // First rule (order 5) should match first
      expect(result.variation).toBe(1)
      expect(result.reason?.ruleId).toBe('first-rule')
    })
  })

  // =============================================================================
  // 8. Default Rule Tests
  // =============================================================================

  describe('default rule', () => {
    let engine: TargetingEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    it('should return default variation when no rules match', async () => {
      await engine.createRule({
        id: 'beta-rule',
        flagKey: 'test-feature',
        conditions: [
          { attribute: 'segment', operator: 'in', value: 'beta-users' },
        ],
        variation: 1,
      })

      await engine.setDefaultVariation('test-feature', 0)

      const nonBetaUser = createTestUser({ userId: 'non-beta' })
      const result = await engine.evaluate('test-feature', nonBetaUser)

      expect(result.matched).toBe(false)
      expect(result.variation).toBe(0)
      expect(result.reason?.kind).toBe('FALLTHROUGH')
    })

    it('should return fallthrough for flag with no rules', async () => {
      await engine.setDefaultVariation('empty-flag', 0)

      const user = createTestUser()
      const result = await engine.evaluate('empty-flag', user)

      expect(result.matched).toBe(false)
      expect(result.variation).toBe(0)
      expect(result.reason?.kind).toBe('FALLTHROUGH')
    })

    it('should support default rollout percentages', async () => {
      await engine.setDefaultRollout('rollout-flag', {
        variations: [
          { variation: 0, weight: 50000 }, // 50%
          { variation: 1, weight: 50000 }, // 50%
        ],
      })

      // Run multiple evaluations and verify distribution
      const results = new Map<number, number>()
      for (let i = 0; i < 1000; i++) {
        const user = createTestUser({ userId: `user-${i}` })
        const result = await engine.evaluate('rollout-flag', user)
        results.set(result.variation!, (results.get(result.variation!) || 0) + 1)
      }

      // Expect roughly 50/50 split (with some variance)
      const variation0Count = results.get(0) || 0
      const variation1Count = results.get(1) || 0

      expect(variation0Count).toBeGreaterThan(400)
      expect(variation0Count).toBeLessThan(600)
      expect(variation1Count).toBeGreaterThan(400)
      expect(variation1Count).toBeLessThan(600)
    })
  })

  // =============================================================================
  // 9. Rule Priority/Weight Tests
  // =============================================================================

  describe('rule priority/weight', () => {
    let engine: TargetingEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    it('should support weighted rollout within a rule', async () => {
      await engine.createRule({
        id: 'ab-test-rule',
        flagKey: 'ab-test',
        conditions: [
          { attribute: 'userId', operator: 'exists', value: true },
        ],
        rollout: {
          variations: [
            { variation: 0, weight: 80000 }, // 80% control
            { variation: 1, weight: 20000 }, // 20% treatment
          ],
        },
      })

      // Run multiple evaluations
      const results = new Map<number, number>()
      for (let i = 0; i < 1000; i++) {
        const user = createTestUser({ userId: `user-${i}` })
        const result = await engine.evaluate('ab-test', user)
        results.set(result.variation!, (results.get(result.variation!) || 0) + 1)
      }

      // Expect roughly 80/20 split
      const controlCount = results.get(0) || 0
      const treatmentCount = results.get(1) || 0

      expect(controlCount).toBeGreaterThan(700)
      expect(treatmentCount).toBeGreaterThan(100)
      expect(treatmentCount).toBeLessThan(300)
    })

    it('should maintain consistent variation for same user', async () => {
      await engine.createRule({
        id: 'consistent-rule',
        flagKey: 'consistent-flag',
        conditions: [
          { attribute: 'userId', operator: 'exists', value: true },
        ],
        rollout: {
          variations: [
            { variation: 0, weight: 50000 },
            { variation: 1, weight: 50000 },
          ],
        },
      })

      const user = createTestUser({ userId: 'stable-user-123' })

      // Evaluate multiple times - should always get same result
      const results = await Promise.all([
        engine.evaluate('consistent-flag', user),
        engine.evaluate('consistent-flag', user),
        engine.evaluate('consistent-flag', user),
      ])

      expect(results[0].variation).toBe(results[1].variation)
      expect(results[1].variation).toBe(results[2].variation)
    })

    it('should support custom bucket key for rollouts', async () => {
      await engine.createRule({
        id: 'bucket-rule',
        flagKey: 'bucket-flag',
        conditions: [
          { attribute: 'userId', operator: 'exists', value: true },
        ],
        rollout: {
          variations: [
            { variation: 0, weight: 50000 },
            { variation: 1, weight: 50000 },
          ],
          bucketBy: 'organizationId',
        },
      })

      // Users in same org should get same variation
      const user1 = createTestUser({ userId: 'user-1', organizationId: 'org-123' })
      const user2 = createTestUser({ userId: 'user-2', organizationId: 'org-123' })
      const user3 = createTestUser({ userId: 'user-3', organizationId: 'org-456' })

      const result1 = await engine.evaluate('bucket-flag', user1)
      const result2 = await engine.evaluate('bucket-flag', user2)

      // Same org = same variation
      expect(result1.variation).toBe(result2.variation)
    })
  })

  // =============================================================================
  // 10. Complex Nested Rules Tests
  // =============================================================================

  describe('complex nested rules', () => {
    let engine: TargetingEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    it('should evaluate AND conditions (all must match)', async () => {
      await engine.createRule({
        id: 'and-rule',
        flagKey: 'and-feature',
        conditions: [
          { attribute: 'country', operator: 'equals', value: 'US' },
          { attribute: 'age', operator: 'greaterThanOrEqual', value: 21 },
          { attribute: 'custom.verified', operator: 'equals', value: true },
        ],
        conditionLogic: 'AND',
        variation: 1,
      })

      const qualifiedUser = createTestUser({
        country: 'US',
        age: 25,
        custom: { verified: true },
      })
      const wrongCountry = createTestUser({
        country: 'UK',
        age: 25,
        custom: { verified: true },
      })
      const tooYoung = createTestUser({
        country: 'US',
        age: 18,
        custom: { verified: true },
      })

      expect((await engine.evaluate('and-feature', qualifiedUser)).matched).toBe(true)
      expect((await engine.evaluate('and-feature', wrongCountry)).matched).toBe(false)
      expect((await engine.evaluate('and-feature', tooYoung)).matched).toBe(false)
    })

    it('should evaluate OR conditions (any can match)', async () => {
      await engine.createRule({
        id: 'or-rule',
        flagKey: 'or-feature',
        conditions: [
          { attribute: 'role', operator: 'equals', value: 'admin' },
          { attribute: 'role', operator: 'equals', value: 'superuser' },
          { attribute: 'custom.isOwner', operator: 'equals', value: true },
        ],
        conditionLogic: 'OR',
        variation: 1,
      })

      const admin = createTestUser({ role: 'admin' })
      const superuser = createTestUser({ role: 'superuser' })
      const owner = createTestUser({ role: 'user', custom: { isOwner: true } })
      const regular = createTestUser({ role: 'user', custom: { isOwner: false } })

      expect((await engine.evaluate('or-feature', admin)).matched).toBe(true)
      expect((await engine.evaluate('or-feature', superuser)).matched).toBe(true)
      expect((await engine.evaluate('or-feature', owner)).matched).toBe(true)
      expect((await engine.evaluate('or-feature', regular)).matched).toBe(false)
    })

    it('should evaluate complex nested condition groups', async () => {
      // (country IN [US, CA]) AND (age >= 18 OR parentalConsent = true)
      await engine.createRule({
        id: 'nested-rule',
        flagKey: 'nested-feature',
        conditionGroups: [
          {
            logic: 'AND',
            conditions: [
              { attribute: 'country', operator: 'in', value: ['US', 'CA'] },
            ],
            groups: [
              {
                logic: 'OR',
                conditions: [
                  { attribute: 'age', operator: 'greaterThanOrEqual', value: 18 },
                  { attribute: 'custom.parentalConsent', operator: 'equals', value: true },
                ],
              },
            ],
          },
        ],
        variation: 1,
      })

      const usAdult = createTestUser({ country: 'US', age: 25 })
      const usMinorConsent = createTestUser({
        country: 'US',
        age: 15,
        custom: { parentalConsent: true },
      })
      const usMinorNoConsent = createTestUser({
        country: 'US',
        age: 15,
        custom: { parentalConsent: false },
      })
      const ukAdult = createTestUser({ country: 'UK', age: 25 })

      expect((await engine.evaluate('nested-feature', usAdult)).matched).toBe(true)
      expect((await engine.evaluate('nested-feature', usMinorConsent)).matched).toBe(true)
      expect((await engine.evaluate('nested-feature', usMinorNoConsent)).matched).toBe(false)
      expect((await engine.evaluate('nested-feature', ukAdult)).matched).toBe(false)
    })

    it('should support negated condition groups', async () => {
      // NOT (country IN [restricted countries])
      await engine.createRule({
        id: 'negated-rule',
        flagKey: 'negated-feature',
        conditions: [
          {
            attribute: 'country',
            operator: 'in',
            value: ['CN', 'RU', 'IR'],
            negate: true,
          },
        ],
        variation: 1,
      })

      const usUser = createTestUser({ country: 'US' })
      const cnUser = createTestUser({ country: 'CN' })

      expect((await engine.evaluate('negated-feature', usUser)).matched).toBe(true)
      expect((await engine.evaluate('negated-feature', cnUser)).matched).toBe(false)
    })
  })

  // =============================================================================
  // 11. Date-Based Targeting Tests
  // =============================================================================

  describe('date-based targeting', () => {
    let engine: TargetingEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should match users created before a date', async () => {
      await engine.createRule({
        id: 'early-adopter-rule',
        flagKey: 'early-adopter-feature',
        conditions: [
          {
            attribute: 'createdAt',
            operator: 'before',
            value: '2024-01-01T00:00:00Z',
          },
        ],
        variation: 1,
      })

      const earlyUser = createTestUser({ createdAt: '2023-06-15T00:00:00Z' })
      const lateUser = createTestUser({ createdAt: '2024-06-15T00:00:00Z' })

      expect((await engine.evaluate('early-adopter-feature', earlyUser)).matched).toBe(true)
      expect((await engine.evaluate('early-adopter-feature', lateUser)).matched).toBe(false)
    })

    it('should match users created after a date', async () => {
      await engine.createRule({
        id: 'new-user-rule',
        flagKey: 'new-user-onboarding',
        conditions: [
          {
            attribute: 'createdAt',
            operator: 'after',
            value: '2024-01-01T00:00:00Z',
          },
        ],
        variation: 1,
      })

      const newUser = createTestUser({ createdAt: '2024-06-15T00:00:00Z' })
      const oldUser = createTestUser({ createdAt: '2023-06-15T00:00:00Z' })

      expect((await engine.evaluate('new-user-onboarding', newUser)).matched).toBe(true)
      expect((await engine.evaluate('new-user-onboarding', oldUser)).matched).toBe(false)
    })

    it('should match users active within time window', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-06-15T12:00:00Z'))

      await engine.createRule({
        id: 'active-rule',
        flagKey: 'active-user-feature',
        conditions: [
          {
            attribute: 'lastActiveAt',
            operator: 'after',
            value: { relative: '-7d' }, // Within last 7 days
          },
        ],
        variation: 1,
      })

      const activeUser = createTestUser({ lastActiveAt: '2024-06-14T00:00:00Z' })
      const inactiveUser = createTestUser({ lastActiveAt: '2024-05-01T00:00:00Z' })

      expect((await engine.evaluate('active-user-feature', activeUser)).matched).toBe(true)
      expect((await engine.evaluate('active-user-feature', inactiveUser)).matched).toBe(false)
    })

    it('should match subscription expiry dates', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-06-15T12:00:00Z'))

      await engine.createRule({
        id: 'expiring-rule',
        flagKey: 'renewal-prompt',
        conditions: [
          {
            attribute: 'custom.subscriptionEndsAt',
            operator: 'before',
            value: { relative: '+30d' }, // Expires within 30 days
          },
          {
            attribute: 'custom.subscriptionEndsAt',
            operator: 'after',
            value: { relative: '0d' }, // Not already expired
          },
        ],
        variation: 1,
      })

      const expiringUser = createTestUser({
        custom: { subscriptionEndsAt: '2024-07-01T00:00:00Z' }, // 16 days out
      })
      const safeUser = createTestUser({
        custom: { subscriptionEndsAt: '2024-12-01T00:00:00Z' }, // 6 months out
      })
      const expiredUser = createTestUser({
        custom: { subscriptionEndsAt: '2024-06-01T00:00:00Z' }, // Already expired
      })

      expect((await engine.evaluate('renewal-prompt', expiringUser)).matched).toBe(true)
      expect((await engine.evaluate('renewal-prompt', safeUser)).matched).toBe(false)
      expect((await engine.evaluate('renewal-prompt', expiredUser)).matched).toBe(false)
    })

    it('should support Unix timestamp values', async () => {
      await engine.createRule({
        id: 'timestamp-rule',
        flagKey: 'timestamp-feature',
        conditions: [
          {
            attribute: 'createdAt',
            operator: 'after',
            value: 1704067200000, // 2024-01-01 as Unix ms
          },
        ],
        variation: 1,
      })

      const newUser = createTestUser({ createdAt: 1718409600000 }) // 2024-06-15
      const oldUser = createTestUser({ createdAt: 1687017600000 }) // 2023-06-18

      expect((await engine.evaluate('timestamp-feature', newUser)).matched).toBe(true)
      expect((await engine.evaluate('timestamp-feature', oldUser)).matched).toBe(false)
    })
  })

  // =============================================================================
  // 12. Device/Platform Targeting Tests
  // =============================================================================

  describe('device/platform targeting', () => {
    let engine: TargetingEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    it('should target mobile devices', async () => {
      await engine.createRule({
        id: 'mobile-rule',
        flagKey: 'mobile-feature',
        conditions: [
          { attribute: 'device.type', operator: 'equals', value: 'mobile' },
        ],
        variation: 1,
      })

      const mobileUser = createTestUser({
        device: { type: 'mobile', os: 'ios', version: '17.0' },
      })
      const desktopUser = createTestUser({
        device: { type: 'desktop', os: 'macos', version: '14.0' },
      })

      expect((await engine.evaluate('mobile-feature', mobileUser)).matched).toBe(true)
      expect((await engine.evaluate('mobile-feature', desktopUser)).matched).toBe(false)
    })

    it('should target specific operating systems', async () => {
      await engine.createRule({
        id: 'ios-rule',
        flagKey: 'ios-feature',
        conditions: [
          { attribute: 'device.os', operator: 'in', value: ['ios', 'ipados'] },
        ],
        variation: 1,
      })

      const iphoneUser = createTestUser({
        device: { type: 'mobile', os: 'ios', version: '17.0' },
      })
      const ipadUser = createTestUser({
        device: { type: 'tablet', os: 'ipados', version: '17.0' },
      })
      const androidUser = createTestUser({
        device: { type: 'mobile', os: 'android', version: '14' },
      })

      expect((await engine.evaluate('ios-feature', iphoneUser)).matched).toBe(true)
      expect((await engine.evaluate('ios-feature', ipadUser)).matched).toBe(true)
      expect((await engine.evaluate('ios-feature', androidUser)).matched).toBe(false)
    })

    it('should target OS version ranges', async () => {
      await engine.createRule({
        id: 'os-version-rule',
        flagKey: 'new-ios-feature',
        conditions: [
          { attribute: 'device.os', operator: 'equals', value: 'ios' },
          { attribute: 'device.version', operator: 'semVerGreaterThanOrEqual', value: '16.0.0' },
        ],
        variation: 1,
      })

      const newIosUser = createTestUser({
        device: { type: 'mobile', os: 'ios', version: '17.2.1' },
      })
      const oldIosUser = createTestUser({
        device: { type: 'mobile', os: 'ios', version: '15.8' },
      })

      expect((await engine.evaluate('new-ios-feature', newIosUser)).matched).toBe(true)
      expect((await engine.evaluate('new-ios-feature', oldIosUser)).matched).toBe(false)
    })

    it('should target browser types', async () => {
      await engine.createRule({
        id: 'chrome-rule',
        flagKey: 'chrome-feature',
        conditions: [
          { attribute: 'browser.name', operator: 'in', value: ['chrome', 'chromium'] },
        ],
        variation: 1,
      })

      const chromeUser = createTestUser({
        browser: { name: 'chrome', version: '120.0' },
      })
      const firefoxUser = createTestUser({
        browser: { name: 'firefox', version: '121.0' },
      })

      expect((await engine.evaluate('chrome-feature', chromeUser)).matched).toBe(true)
      expect((await engine.evaluate('chrome-feature', firefoxUser)).matched).toBe(false)
    })

    it('should target browser versions', async () => {
      await engine.createRule({
        id: 'modern-browser-rule',
        flagKey: 'webgl2-feature',
        conditions: [
          { attribute: 'browser.name', operator: 'equals', value: 'chrome' },
          { attribute: 'browser.version', operator: 'semVerGreaterThanOrEqual', value: '90.0.0' },
        ],
        variation: 1,
      })

      const modernChrome = createTestUser({
        browser: { name: 'chrome', version: '120.0.0' },
      })
      const oldChrome = createTestUser({
        browser: { name: 'chrome', version: '80.0.0' },
      })

      expect((await engine.evaluate('webgl2-feature', modernChrome)).matched).toBe(true)
      expect((await engine.evaluate('webgl2-feature', oldChrome)).matched).toBe(false)
    })

    it('should target screen size/viewport', async () => {
      await engine.createRule({
        id: 'large-screen-rule',
        flagKey: 'large-screen-feature',
        conditions: [
          { attribute: 'device.screenWidth', operator: 'greaterThanOrEqual', value: 1920 },
        ],
        variation: 1,
      })

      const largeScreen = createTestUser({
        device: { type: 'desktop', screenWidth: 2560, screenHeight: 1440 },
      })
      const smallScreen = createTestUser({
        device: { type: 'mobile', screenWidth: 390, screenHeight: 844 },
      })

      expect((await engine.evaluate('large-screen-feature', largeScreen)).matched).toBe(true)
      expect((await engine.evaluate('large-screen-feature', smallScreen)).matched).toBe(false)
    })

    it('should target by connection type', async () => {
      await engine.createRule({
        id: 'slow-connection-rule',
        flagKey: 'lite-mode',
        conditions: [
          { attribute: 'connection.effectiveType', operator: 'in', value: ['slow-2g', '2g', '3g'] },
        ],
        variation: 1,
      })

      const slowUser = createTestUser({
        connection: { effectiveType: '2g', downlink: 0.25 },
      })
      const fastUser = createTestUser({
        connection: { effectiveType: '4g', downlink: 10 },
      })

      expect((await engine.evaluate('lite-mode', slowUser)).matched).toBe(true)
      expect((await engine.evaluate('lite-mode', fastUser)).matched).toBe(false)
    })

    it('should target by locale/language', async () => {
      await engine.createRule({
        id: 'spanish-rule',
        flagKey: 'spanish-content',
        conditions: [
          { attribute: 'locale', operator: 'startsWith', value: 'es' },
        ],
        variation: 1,
      })

      const spanishUser = createTestUser({ locale: 'es-MX' })
      const spainUser = createTestUser({ locale: 'es-ES' })
      const englishUser = createTestUser({ locale: 'en-US' })

      expect((await engine.evaluate('spanish-content', spanishUser)).matched).toBe(true)
      expect((await engine.evaluate('spanish-content', spainUser)).matched).toBe(true)
      expect((await engine.evaluate('spanish-content', englishUser)).matched).toBe(false)
    })

    it('should target by timezone', async () => {
      await engine.createRule({
        id: 'timezone-rule',
        flagKey: 'apac-feature',
        conditions: [
          {
            attribute: 'timezone',
            operator: 'in',
            value: [
              'Asia/Tokyo',
              'Asia/Singapore',
              'Asia/Hong_Kong',
              'Australia/Sydney',
            ],
          },
        ],
        variation: 1,
      })

      const tokyoUser = createTestUser({ timezone: 'Asia/Tokyo' })
      const nyUser = createTestUser({ timezone: 'America/New_York' })

      expect((await engine.evaluate('apac-feature', tokyoUser)).matched).toBe(true)
      expect((await engine.evaluate('apac-feature', nyUser)).matched).toBe(false)
    })
  })

  // =============================================================================
  // Additional Edge Cases
  // =============================================================================

  describe('edge cases', () => {
    let engine: TargetingEngine

    beforeEach(() => {
      engine = createTestEngine()
    })

    it('should handle missing attributes gracefully', async () => {
      await engine.createRule({
        id: 'optional-rule',
        flagKey: 'optional-feature',
        conditions: [
          { attribute: 'nonExistentField', operator: 'equals', value: 'anything' },
        ],
        variation: 1,
      })

      const user = createTestUser()
      const result = await engine.evaluate('optional-feature', user)

      expect(result.matched).toBe(false)
    })

    it('should handle null and undefined values', async () => {
      await engine.createRule({
        id: 'null-check-rule',
        flagKey: 'null-feature',
        conditions: [
          { attribute: 'custom.field', operator: 'exists', value: true },
        ],
        variation: 1,
      })

      const userWithValue = createTestUser({ custom: { field: 'value' } })
      const userWithNull = createTestUser({ custom: { field: null } })
      const userWithUndefined = createTestUser({ custom: { field: undefined } })
      const userWithoutField = createTestUser({ custom: {} })

      expect((await engine.evaluate('null-feature', userWithValue)).matched).toBe(true)
      expect((await engine.evaluate('null-feature', userWithNull)).matched).toBe(false)
      expect((await engine.evaluate('null-feature', userWithUndefined)).matched).toBe(false)
      expect((await engine.evaluate('null-feature', userWithoutField)).matched).toBe(false)
    })

    it('should handle empty conditions array', async () => {
      await engine.createRule({
        id: 'empty-conditions-rule',
        flagKey: 'empty-feature',
        conditions: [],
        variation: 1,
      })

      const user = createTestUser()
      const result = await engine.evaluate('empty-feature', user)

      // Empty conditions = always match (or never match, depending on design)
      expect(result.matched).toBe(true)
    })

    it('should handle case-insensitive string matching', async () => {
      await engine.createRule({
        id: 'case-insensitive-rule',
        flagKey: 'case-feature',
        conditions: [
          {
            attribute: 'email',
            operator: 'equals',
            value: 'Test@Example.COM',
            caseInsensitive: true,
          },
        ],
        variation: 1,
      })

      const lowerUser = createTestUser({ email: 'test@example.com' })
      const upperUser = createTestUser({ email: 'TEST@EXAMPLE.COM' })
      const mixedUser = createTestUser({ email: 'Test@Example.Com' })

      expect((await engine.evaluate('case-feature', lowerUser)).matched).toBe(true)
      expect((await engine.evaluate('case-feature', upperUser)).matched).toBe(true)
      expect((await engine.evaluate('case-feature', mixedUser)).matched).toBe(true)
    })

    it('should provide detailed evaluation reason', async () => {
      await engine.createSegment({
        key: 'test-segment',
        name: 'Test Segment',
        included: ['user-123'],
      })

      await engine.createRule({
        id: 'detailed-rule',
        flagKey: 'detailed-feature',
        conditions: [
          { attribute: 'segment', operator: 'in', value: 'test-segment' },
        ],
        variation: 1,
      })

      const user = createTestUser({ userId: 'user-123' })
      const result = await engine.evaluate('detailed-feature', user)

      expect(result.reason).toBeDefined()
      expect(result.reason?.kind).toBe('RULE_MATCH')
      expect(result.reason?.ruleId).toBe('detailed-rule')
      expect(result.reason?.ruleIndex).toBe(0)
    })

    it('should track evaluation metadata', async () => {
      await engine.createRule({
        id: 'tracked-rule',
        flagKey: 'tracked-feature',
        conditions: [
          { attribute: 'userId', operator: 'exists', value: true },
        ],
        variation: 1,
        trackEvents: true,
      })

      const user = createTestUser()
      const result = await engine.evaluate('tracked-feature', user)

      expect(result.trackEvents).toBe(true)
      expect(result.evaluatedAt).toBeDefined()
      expect(typeof result.evaluatedAt).toBe('number')
    })
  })
})
