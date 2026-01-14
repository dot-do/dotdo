/**
 * Local Feature Flag Evaluation Tests
 *
 * Tests for Phase 1: Feature Flags (Local Evaluation) - dotdo-o3bv
 *
 * These tests verify PostHog-style local evaluation with:
 * - Branch-based variants with deterministic hashing
 * - Traffic allocation for gradual rollouts
 * - Cohort targeting for user segments
 * - $.flag() API integration
 * - Performance target: <50ms local eval vs 500ms remote
 *
 * TDD RED Phase: These tests define expected behavior.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockContext, Flag, FlagEvaluation } from '../context/flag'
import { evaluateFlag, FlagConfig, EvaluationContext, EvaluationResult } from '../flags'

describe('Local Feature Flag Evaluation', () => {
  /**
   * LOCAL EVALUATION PATTERN
   *
   * The key pattern is:
   * 1. $.flags.fetch() - Fetch all flags once (can be cached)
   * 2. $.flags.evaluate(id, userId, flags) - Evaluate locally (synchronous, fast)
   *
   * This allows for <50ms evaluation by avoiding network calls after initial fetch.
   */
  describe('$.flags.fetch() + $.flags.evaluate() pattern', () => {
    it('fetches all flags from storage', async () => {
      const $ = createMockContext()

      // Set up flags in storage
      const flag1: Flag = {
        id: 'feature-a',
        traffic: 1.0,
        status: 'active',
        branches: [{ key: 'control', weight: 50 }, { key: 'treatment', weight: 50 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const flag2: Flag = {
        id: 'feature-b',
        traffic: 0.5,
        status: 'active',
        branches: [{ key: 'v1', weight: 33 }, { key: 'v2', weight: 33 }, { key: 'v3', weight: 34 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      $._storage.flags.set('feature-a', flag1)
      $._storage.flags.set('feature-b', flag2)

      const flags = await $.flags.fetch()

      expect(Object.keys(flags)).toHaveLength(2)
      expect(flags['feature-a']).toBeDefined()
      expect(flags['feature-b']).toBeDefined()
    })

    it('evaluates flag locally without async call', async () => {
      const $ = createMockContext()

      const flag: Flag = {
        id: 'local-eval-test',
        traffic: 1.0,
        status: 'active',
        branches: [{ key: 'control', weight: 50 }, { key: 'treatment', weight: 50 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      $._storage.flags.set('local-eval-test', flag)

      // First fetch flags (this would be cached in production)
      const flags = await $.flags.fetch()

      // Then evaluate synchronously
      const result = $.flags.evaluate('local-eval-test', 'user-123', flags)

      expect(result.enabled).toBe(true)
      expect(result.variant).toBeDefined()
      expect(['control', 'treatment']).toContain(result.variant)
    })

    it('returns disabled for non-existent flag in local evaluation', async () => {
      const $ = createMockContext()

      const flags = await $.flags.fetch()
      const result = $.flags.evaluate('non-existent', 'user-123', flags)

      expect(result.enabled).toBe(false)
      expect(result.variant).toBeNull()
    })

    it('local evaluation is deterministic across multiple calls', async () => {
      const $ = createMockContext()

      const flag: Flag = {
        id: 'deterministic-test',
        traffic: 0.5,
        status: 'active',
        branches: [{ key: 'a', weight: 50 }, { key: 'b', weight: 50 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      $._storage.flags.set('deterministic-test', flag)

      const flags = await $.flags.fetch()

      // Same user should get same result every time
      const results = Array.from({ length: 100 }, () =>
        $.flags.evaluate('deterministic-test', 'consistent-user', flags)
      )

      const firstResult = results[0]
      expect(results.every(r => r.enabled === firstResult!.enabled)).toBe(true)
      expect(results.every(r => r.variant === firstResult!.variant)).toBe(true)
    })
  })

  /**
   * BRANCH-BASED VARIANTS
   *
   * Feature flags support A/B/n testing with weighted variants.
   * Each branch has:
   * - key: variant identifier
   * - weight: relative weight for distribution
   * - payload: optional data to return with the variant
   */
  describe('Branch-based variants', () => {
    it('assigns users to branches based on weights', async () => {
      const $ = createMockContext()

      const flag: Flag = {
        id: 'weighted-branches',
        traffic: 1.0,
        status: 'active',
        branches: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      $._storage.flags.set('weighted-branches', flag)

      const flags = await $.flags.fetch()

      // Test distribution with many users
      const results = Array.from({ length: 1000 }, (_, i) =>
        $.flags.evaluate('weighted-branches', `user-${i}`, flags)
      )

      const controlCount = results.filter(r => r.variant === 'control').length
      const treatmentCount = results.filter(r => r.variant === 'treatment').length

      // With 50/50 split, expect roughly equal distribution
      expect(controlCount).toBeGreaterThan(400)
      expect(controlCount).toBeLessThan(600)
      expect(treatmentCount).toBeGreaterThan(400)
      expect(treatmentCount).toBeLessThan(600)
    })

    it('supports A/B/n testing with multiple variants', async () => {
      const $ = createMockContext()

      const flag: Flag = {
        id: 'multi-variant',
        traffic: 1.0,
        status: 'active',
        branches: [
          { key: 'control', weight: 34 },
          { key: 'variant-a', weight: 33 },
          { key: 'variant-b', weight: 33 },
        ],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      $._storage.flags.set('multi-variant', flag)

      const flags = await $.flags.fetch()

      const results = Array.from({ length: 1000 }, (_, i) =>
        $.flags.evaluate('multi-variant', `user-${i}`, flags)
      )

      const distribution = {
        control: results.filter(r => r.variant === 'control').length,
        'variant-a': results.filter(r => r.variant === 'variant-a').length,
        'variant-b': results.filter(r => r.variant === 'variant-b').length,
      }

      // Each variant should get roughly 33%
      expect(distribution.control).toBeGreaterThan(250)
      expect(distribution.control).toBeLessThan(450)
      expect(distribution['variant-a']).toBeGreaterThan(250)
      expect(distribution['variant-a']).toBeLessThan(450)
      expect(distribution['variant-b']).toBeGreaterThan(250)
      expect(distribution['variant-b']).toBeLessThan(450)
    })

    it('returns payload with variant assignment', async () => {
      const $ = createMockContext()

      const flag: Flag = {
        id: 'payload-test',
        traffic: 1.0,
        status: 'active',
        branches: [
          { key: 'control', weight: 0, payload: { buttonColor: 'blue' } },
          { key: 'treatment', weight: 100, payload: { buttonColor: 'green' } },
        ],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      $._storage.flags.set('payload-test', flag)

      const flags = await $.flags.fetch()
      const result = $.flags.evaluate('payload-test', 'user-123', flags)

      expect(result.enabled).toBe(true)
      expect(result.variant).toBe('treatment')
      expect(result.payload).toEqual({ buttonColor: 'green' })
    })
  })

  /**
   * TRAFFIC ALLOCATION
   *
   * Traffic allocation controls what percentage of users are eligible
   * for the flag. Users outside traffic allocation get disabled.
   */
  describe('Traffic allocation', () => {
    it('respects 0% traffic allocation', async () => {
      const $ = createMockContext()

      const flag: Flag = {
        id: 'zero-traffic',
        traffic: 0,
        status: 'active',
        branches: [{ key: 'treatment', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      $._storage.flags.set('zero-traffic', flag)

      const flags = await $.flags.fetch()

      // All users should be disabled
      const results = Array.from({ length: 100 }, (_, i) =>
        $.flags.evaluate('zero-traffic', `user-${i}`, flags)
      )

      expect(results.every(r => r.enabled === false)).toBe(true)
    })

    it('respects 100% traffic allocation', async () => {
      const $ = createMockContext()

      const flag: Flag = {
        id: 'full-traffic',
        traffic: 1.0,
        status: 'active',
        branches: [{ key: 'treatment', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      $._storage.flags.set('full-traffic', flag)

      const flags = await $.flags.fetch()

      // All users should be enabled
      const results = Array.from({ length: 100 }, (_, i) =>
        $.flags.evaluate('full-traffic', `user-${i}`, flags)
      )

      expect(results.every(r => r.enabled === true)).toBe(true)
    })

    it('respects partial traffic allocation', async () => {
      const $ = createMockContext()

      const flag: Flag = {
        id: 'partial-traffic',
        traffic: 0.5,
        status: 'active',
        branches: [{ key: 'treatment', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      $._storage.flags.set('partial-traffic', flag)

      const flags = await $.flags.fetch()

      const results = Array.from({ length: 1000 }, (_, i) =>
        $.flags.evaluate('partial-traffic', `user-${i}`, flags)
      )

      const enabledCount = results.filter(r => r.enabled).length

      // With 50% traffic, expect roughly 500 enabled
      expect(enabledCount).toBeGreaterThan(400)
      expect(enabledCount).toBeLessThan(600)
    })
  })

  /**
   * FLAG STATUS
   *
   * Flags can be active, disabled, or archived.
   * Only active flags can be enabled for users.
   */
  describe('Flag status', () => {
    it('disabled flag returns false for all users', async () => {
      const $ = createMockContext()

      const flag: Flag = {
        id: 'disabled-flag',
        traffic: 1.0,
        status: 'disabled',
        branches: [{ key: 'treatment', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      $._storage.flags.set('disabled-flag', flag)

      const flags = await $.flags.fetch()
      const result = $.flags.evaluate('disabled-flag', 'user-123', flags)

      expect(result.enabled).toBe(false)
    })

    it('archived flag returns false for all users', async () => {
      const $ = createMockContext()

      const flag: Flag = {
        id: 'archived-flag',
        traffic: 1.0,
        status: 'archived',
        branches: [{ key: 'treatment', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      $._storage.flags.set('archived-flag', flag)

      const flags = await $.flags.fetch()
      const result = $.flags.evaluate('archived-flag', 'user-123', flags)

      expect(result.enabled).toBe(false)
    })
  })
})

/**
 * COHORT TARGETING (using flags.ts evaluateFlag)
 *
 * Cohort targeting allows flags to be enabled only for users
 * who belong to specific cohorts or match property filters.
 */
describe('Cohort Targeting', () => {
  describe('Property filters', () => {
    it('evaluates property filter with eq operator', () => {
      const flag: FlagConfig = {
        id: 'property-eq',
        traffic: 1.0,
        filters: [
          { type: 'property', property: 'plan', operator: 'eq', value: 'pro' },
        ],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { plan: 'pro' },
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(true)
    })

    it('excludes users not matching property filter', () => {
      const flag: FlagConfig = {
        id: 'property-eq-exclude',
        traffic: 1.0,
        filters: [
          { type: 'property', property: 'plan', operator: 'eq', value: 'pro' },
        ],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { plan: 'free' },
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(false)
    })

    it('evaluates property filter with neq operator', () => {
      const flag: FlagConfig = {
        id: 'property-neq',
        traffic: 1.0,
        filters: [
          { type: 'property', property: 'plan', operator: 'neq', value: 'free' },
        ],
      }

      const result1 = evaluateFlag(flag, { userId: 'user-1', properties: { plan: 'pro' } })
      const result2 = evaluateFlag(flag, { userId: 'user-2', properties: { plan: 'free' } })

      expect(result1.enabled).toBe(true)
      expect(result2.enabled).toBe(false)
    })

    it('evaluates numeric comparison operators', () => {
      const flag: FlagConfig = {
        id: 'numeric-filter',
        traffic: 1.0,
        filters: [
          { type: 'property', property: 'age', operator: 'gte', value: 18 },
        ],
      }

      const adult = evaluateFlag(flag, { userId: 'adult', properties: { age: 21 } })
      const minor = evaluateFlag(flag, { userId: 'minor', properties: { age: 16 } })
      const exactAge = evaluateFlag(flag, { userId: 'exact', properties: { age: 18 } })

      expect(adult.enabled).toBe(true)
      expect(minor.enabled).toBe(false)
      expect(exactAge.enabled).toBe(true)
    })

    it('evaluates in operator for list matching', () => {
      const flag: FlagConfig = {
        id: 'in-filter',
        traffic: 1.0,
        filters: [
          { type: 'property', property: 'country', operator: 'in', value: ['US', 'CA', 'UK'] },
        ],
      }

      const us = evaluateFlag(flag, { userId: 'us-user', properties: { country: 'US' } })
      const fr = evaluateFlag(flag, { userId: 'fr-user', properties: { country: 'FR' } })

      expect(us.enabled).toBe(true)
      expect(fr.enabled).toBe(false)
    })

    it('evaluates contains operator for string matching', () => {
      const flag: FlagConfig = {
        id: 'contains-filter',
        traffic: 1.0,
        filters: [
          { type: 'property', property: 'email', operator: 'contains', value: '@company.com' },
        ],
      }

      const internal = evaluateFlag(flag, { userId: 'internal', properties: { email: 'alice@company.com' } })
      const external = evaluateFlag(flag, { userId: 'external', properties: { email: 'bob@gmail.com' } })

      expect(internal.enabled).toBe(true)
      expect(external.enabled).toBe(false)
    })

    it('applies multiple filters with AND logic', () => {
      const flag: FlagConfig = {
        id: 'multi-filter',
        traffic: 1.0,
        filters: [
          { type: 'property', property: 'plan', operator: 'eq', value: 'pro' },
          { type: 'property', property: 'country', operator: 'in', value: ['US', 'CA'] },
        ],
      }

      const proUS = evaluateFlag(flag, { userId: 'pro-us', properties: { plan: 'pro', country: 'US' } })
      const proFR = evaluateFlag(flag, { userId: 'pro-fr', properties: { plan: 'pro', country: 'FR' } })
      const freeUS = evaluateFlag(flag, { userId: 'free-us', properties: { plan: 'free', country: 'US' } })

      expect(proUS.enabled).toBe(true)
      expect(proFR.enabled).toBe(false) // Matches plan but not country
      expect(freeUS.enabled).toBe(false) // Matches country but not plan
    })
  })

  describe('Cohort filters', () => {
    it('evaluates cohort membership', () => {
      const flag: FlagConfig = {
        id: 'cohort-filter',
        traffic: 1.0,
        filters: [
          { type: 'cohort', cohortId: 'beta-testers' },
        ],
      }

      const betaUser = evaluateFlag(flag, { userId: 'beta', cohorts: ['beta-testers'] })
      const regularUser = evaluateFlag(flag, { userId: 'regular', cohorts: [] })

      expect(betaUser.enabled).toBe(true)
      expect(regularUser.enabled).toBe(false)
    })

    it('combines cohort and property filters', () => {
      const flag: FlagConfig = {
        id: 'combined-filter',
        traffic: 1.0,
        filters: [
          { type: 'cohort', cohortId: 'early-adopters' },
          { type: 'property', property: 'plan', operator: 'eq', value: 'pro' },
        ],
      }

      const earlyPro = evaluateFlag(flag, {
        userId: 'early-pro',
        cohorts: ['early-adopters'],
        properties: { plan: 'pro' },
      })
      const earlyFree = evaluateFlag(flag, {
        userId: 'early-free',
        cohorts: ['early-adopters'],
        properties: { plan: 'free' },
      })
      const latePro = evaluateFlag(flag, {
        userId: 'late-pro',
        cohorts: [],
        properties: { plan: 'pro' },
      })

      expect(earlyPro.enabled).toBe(true)
      expect(earlyFree.enabled).toBe(false)
      expect(latePro.enabled).toBe(false)
    })
  })
})

/**
 * PERFORMANCE TESTS
 *
 * Target: <50ms local evaluation vs 500ms remote
 *
 * Note: These tests verify that local evaluation is significantly faster
 * than remote evaluation (500ms). The actual times will vary based on
 * system load, so we use generous bounds that still prove the point.
 */
describe('Performance', () => {
  it('local evaluation is significantly faster than remote target (50ms vs 500ms)', async () => {
    const $ = createMockContext()

    const flag: Flag = {
      id: 'perf-test',
      traffic: 0.5,
      status: 'active',
      branches: [
        { key: 'control', weight: 50 },
        { key: 'treatment', weight: 50 },
      ],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    $._storage.flags.set('perf-test', flag)

    const flags = await $.flags.fetch()

    // Warm-up to avoid JIT compilation overhead
    for (let i = 0; i < 100; i++) {
      $.flags.evaluate('perf-test', `warmup-${i}`, flags)
    }

    // Measure evaluation time for 100 calls
    const start = performance.now()
    for (let i = 0; i < 100; i++) {
      $.flags.evaluate('perf-test', `user-${i}`, flags)
    }
    const elapsed = performance.now() - start

    // 100 evaluations should complete in under 50ms total
    // This proves local eval is at least 10x faster than remote (500ms * 100 = 50000ms)
    // Even with generous bounds, local is clearly orders of magnitude faster
    expect(elapsed).toBeLessThan(50)
  })

  it('evaluateFlag is fast for complex filters', () => {
    const flag: FlagConfig = {
      id: 'complex-perf',
      traffic: 0.5,
      filters: [
        { type: 'property', property: 'plan', operator: 'eq', value: 'pro' },
        { type: 'property', property: 'age', operator: 'gte', value: 18 },
        { type: 'property', property: 'country', operator: 'in', value: ['US', 'CA', 'UK', 'DE', 'FR'] },
        { type: 'cohort', cohortId: 'beta-testers' },
      ],
      branches: [
        { key: 'control', weight: 33, payload: { feature: 'off' } },
        { key: 'variant-a', weight: 33, payload: { feature: 'v1' } },
        { key: 'variant-b', weight: 34, payload: { feature: 'v2' } },
      ],
    }

    const context: EvaluationContext = {
      userId: 'perf-user',
      properties: { plan: 'pro', age: 25, country: 'US' },
      cohorts: ['beta-testers'],
    }

    // Warm-up run to avoid JIT compilation affecting measurements
    for (let i = 0; i < 100; i++) {
      evaluateFlag(flag, { ...context, userId: `warmup-${i}` })
    }

    const start = performance.now()
    for (let i = 0; i < 1000; i++) {
      evaluateFlag(flag, { ...context, userId: `user-${i}` })
    }
    const elapsed = performance.now() - start

    // 1000 complex evaluations should complete in <200ms
    // This accounts for CI variance while still ensuring reasonable performance
    // Target: <0.2ms per evaluation - well under 50ms target
    expect(elapsed).toBeLessThan(200)
  })
})

/**
 * $.flag() CONTEXT API INTEGRATION
 *
 * Tests for the $ workflow context integration.
 */
describe('$.flag() API Integration', () => {
  it('$.flag(id).isEnabled(userId) returns boolean', async () => {
    const $ = createMockContext()

    const flag: Flag = {
      id: 'api-test',
      traffic: 1.0,
      status: 'active',
      branches: [{ key: 'enabled', weight: 100 }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    $._storage.flags.set('api-test', flag)

    const enabled = await $.flag('api-test').isEnabled('user-123')
    expect(typeof enabled).toBe('boolean')
    expect(enabled).toBe(true)
  })

  it('$.flag(id).get(userId) returns full evaluation result', async () => {
    const $ = createMockContext()

    const flag: Flag = {
      id: 'full-result',
      traffic: 1.0,
      status: 'active',
      branches: [
        { key: 'control', weight: 0 },
        { key: 'treatment', weight: 100, payload: { discount: 20 } },
      ],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    $._storage.flags.set('full-result', flag)

    const result = await $.flag('full-result').get('user-123')

    expect(result.enabled).toBe(true)
    expect(result.variant).toBe('treatment')
    expect(result.payload).toEqual({ discount: 20 })
  })

  it('$.flag(id).getVariant(userId) returns variant key', async () => {
    const $ = createMockContext()

    const flag: Flag = {
      id: 'variant-api',
      traffic: 1.0,
      status: 'active',
      branches: [
        { key: 'dark-mode', weight: 100 },
      ],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    $._storage.flags.set('variant-api', flag)

    const variant = await $.flag('variant-api').getVariant('user-123')
    expect(variant).toBe('dark-mode')
  })

  it('$.flag(id).getValue(userId) returns payload', async () => {
    const $ = createMockContext()

    const flag: Flag = {
      id: 'value-api',
      traffic: 1.0,
      status: 'active',
      branches: [
        { key: 'special', weight: 100, payload: { maxItems: 50, features: ['a', 'b'] } },
      ],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    $._storage.flags.set('value-api', flag)

    const value = await $.flag('value-api').getValue('user-123')
    expect(value).toEqual({ maxItems: 50, features: ['a', 'b'] })
  })

  it('$.flag(id).enable() sets traffic to 100%', async () => {
    const $ = createMockContext()

    const flag: Flag = {
      id: 'enable-api',
      traffic: 0.1,
      status: 'active',
      branches: [{ key: 'enabled', weight: 100 }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    $._storage.flags.set('enable-api', flag)

    await $.flag('enable-api').enable()

    const storedFlag = $._storage.flags.get('enable-api')
    expect(storedFlag?.traffic).toBe(1.0)
    expect(storedFlag?.status).toBe('active')
  })

  it('$.flag(id).disable() sets status to disabled', async () => {
    const $ = createMockContext()

    const flag: Flag = {
      id: 'disable-api',
      traffic: 1.0,
      status: 'active',
      branches: [{ key: 'enabled', weight: 100 }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    $._storage.flags.set('disable-api', flag)

    await $.flag('disable-api').disable()

    const storedFlag = $._storage.flags.get('disable-api')
    expect(storedFlag?.status).toBe('disabled')
  })

  it('$.flag(id).setTraffic(n) updates traffic allocation', async () => {
    const $ = createMockContext()

    const flag: Flag = {
      id: 'traffic-api',
      traffic: 0.1,
      status: 'active',
      branches: [{ key: 'enabled', weight: 100 }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    $._storage.flags.set('traffic-api', flag)

    await $.flag('traffic-api').setTraffic(0.5)

    const storedFlag = $._storage.flags.get('traffic-api')
    expect(storedFlag?.traffic).toBe(0.5)
  })
})
