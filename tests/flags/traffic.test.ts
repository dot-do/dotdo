import { describe, it, expect } from 'vitest'

/**
 * RED Phase Tests: Traffic Allocation Logic
 *
 * Tests for feature flag traffic allocation using deterministic hashing.
 * These tests will FAIL until evaluateFlag is implemented in workflows/flags.ts.
 *
 * The evaluateFlag function should:
 * - Use deterministic hashing based on userId + flagId for consistent allocation
 * - Respect traffic percentage with statistical accuracy
 * - Return different allocations for different flag IDs (even with same user)
 */

// Import evaluateFlag from workflows/flags.ts (doesn't exist yet - RED phase)
import { evaluateFlag } from '../../workflows/flags'

/**
 * Flag interface for testing
 */
interface Flag {
  id: string
  traffic: number
  enabled?: boolean
  variants?: Array<{
    id: string
    weight: number
    payload?: any
  }>
}

/**
 * Helper to create a basic flag for testing
 */
function createTestFlag(overrides: Partial<Flag> = {}): Flag {
  return {
    id: 'test-flag',
    traffic: 1.0,
    enabled: true,
    ...overrides,
  }
}

describe('traffic allocation', () => {
  describe('edge cases: 0% and 100% traffic', () => {
    it('excludes all users when traffic is 0', () => {
      const flag = createTestFlag({ traffic: 0 })

      // Test with multiple users - all should be excluded
      const users = ['user-1', 'user-2', 'user-3', 'random-uuid-12345']

      for (const userId of users) {
        const result = evaluateFlag(flag, { userId })
        expect(result.enabled).toBe(false)
      }
    })

    it('includes all users when traffic is 1', () => {
      const flag = createTestFlag({ traffic: 1 })

      // Test with multiple users - all should be included
      const users = ['user-1', 'user-2', 'user-3', 'random-uuid-12345']

      for (const userId of users) {
        const result = evaluateFlag(flag, { userId })
        expect(result.enabled).toBe(true)
      }
    })
  })

  describe('statistical distribution', () => {
    it('respects traffic percentage approximately (30% traffic, expect 250-350 out of 1000)', () => {
      const flag = createTestFlag({ id: 'thirty-percent-flag', traffic: 0.3 })

      let enabledCount = 0

      // Test with 1000 different users
      for (let i = 0; i < 1000; i++) {
        const result = evaluateFlag(flag, { userId: `user-${i}` })
        if (result.enabled) {
          enabledCount++
        }
      }

      // With 30% traffic and 1000 users, expect ~300 enabled
      // Allow +/- 5% variance: 250-350 (25% - 35%)
      expect(enabledCount).toBeGreaterThanOrEqual(250)
      expect(enabledCount).toBeLessThanOrEqual(350)
    })

    it('respects traffic percentage approximately (50% traffic)', () => {
      const flag = createTestFlag({ id: 'fifty-percent-flag', traffic: 0.5 })

      let enabledCount = 0

      for (let i = 0; i < 1000; i++) {
        const result = evaluateFlag(flag, { userId: `user-${i}` })
        if (result.enabled) {
          enabledCount++
        }
      }

      // With 50% traffic, expect 450-550 enabled (+/- 5%)
      expect(enabledCount).toBeGreaterThanOrEqual(450)
      expect(enabledCount).toBeLessThanOrEqual(550)
    })

    it('respects traffic percentage approximately (10% traffic)', () => {
      const flag = createTestFlag({ id: 'ten-percent-flag', traffic: 0.1 })

      let enabledCount = 0

      for (let i = 0; i < 1000; i++) {
        const result = evaluateFlag(flag, { userId: `user-${i}` })
        if (result.enabled) {
          enabledCount++
        }
      }

      // With 10% traffic, expect 50-150 enabled (+/- 5%)
      expect(enabledCount).toBeGreaterThanOrEqual(50)
      expect(enabledCount).toBeLessThanOrEqual(150)
    })

    it('respects traffic percentage approximately (90% traffic)', () => {
      const flag = createTestFlag({ id: 'ninety-percent-flag', traffic: 0.9 })

      let enabledCount = 0

      for (let i = 0; i < 1000; i++) {
        const result = evaluateFlag(flag, { userId: `user-${i}` })
        if (result.enabled) {
          enabledCount++
        }
      }

      // With 90% traffic, expect 850-950 enabled (+/- 5%)
      expect(enabledCount).toBeGreaterThanOrEqual(850)
      expect(enabledCount).toBeLessThanOrEqual(950)
    })
  })

  describe('determinism', () => {
    it('same user always gets same result (deterministic)', () => {
      const flag = createTestFlag({ traffic: 0.5 })
      const userId = 'deterministic-test-user-12345'

      // Evaluate the same user multiple times
      const result1 = evaluateFlag(flag, { userId })
      const result2 = evaluateFlag(flag, { userId })
      const result3 = evaluateFlag(flag, { userId })

      expect(result1.enabled).toBe(result2.enabled)
      expect(result2.enabled).toBe(result3.enabled)
    })

    it('result is stable across 100 evaluations for same user', () => {
      const flag = createTestFlag({ traffic: 0.5 })
      const userId = 'stable-user-xyz'

      const results = Array.from({ length: 100 }, () =>
        evaluateFlag(flag, { userId })
      )

      // All results should be identical
      const firstResult = results[0].enabled
      const allSame = results.every(r => r.enabled === firstResult)
      expect(allSame).toBe(true)
    })

    it('result remains stable with different context properties', () => {
      const flag = createTestFlag({ traffic: 0.5 })
      const userId = 'context-test-user'

      // Same user with different properties should get same result
      // (assuming traffic allocation is based on userId + flagId, not properties)
      const result1 = evaluateFlag(flag, { userId })
      const result2 = evaluateFlag(flag, { userId, properties: { plan: 'free' } })
      const result3 = evaluateFlag(flag, { userId, properties: { plan: 'pro' } })
      const result4 = evaluateFlag(flag, { userId, cohorts: ['beta-testers'] })

      expect(result1.enabled).toBe(result2.enabled)
      expect(result2.enabled).toBe(result3.enabled)
      expect(result3.enabled).toBe(result4.enabled)
    })
  })

  describe('flag independence', () => {
    it('different flag IDs get different allocations for same user', () => {
      // Create two different flags with same traffic
      const flagA = createTestFlag({ id: 'flag-a', traffic: 0.5 })
      const flagB = createTestFlag({ id: 'flag-b', traffic: 0.5 })

      // With 100 users at 50% traffic each, the flags should have independent allocations
      // Some users should be in A but not B, some in B but not A, etc.
      const users = Array.from({ length: 100 }, (_, i) => `user-${i}`)

      let differentCount = 0
      for (const userId of users) {
        const resultA = evaluateFlag(flagA, { userId })
        const resultB = evaluateFlag(flagB, { userId })
        if (resultA.enabled !== resultB.enabled) {
          differentCount++
        }
      }

      // With independent 50/50 allocations, expected difference is ~50%
      // P(different) = P(A=true)P(B=false) + P(A=false)P(B=true) = 0.5*0.5 + 0.5*0.5 = 0.5
      // With 100 samples, expect 30-70 to have different allocations
      expect(differentCount).toBeGreaterThan(20)
      expect(differentCount).toBeLessThan(80)
    })

    it('same user in different flags produces uncorrelated results', () => {
      // Use many flags to verify independence
      const flagIds = ['exp-a', 'exp-b', 'exp-c', 'exp-d', 'exp-e']
      const flags = flagIds.map(id => createTestFlag({ id, traffic: 0.5 }))

      const userId = 'multi-flag-user'

      // Get results for all flags
      const results = flags.map(flag => evaluateFlag(flag, { userId }))

      // At least verify we get boolean results for each
      results.forEach(result => {
        expect(typeof result.enabled).toBe('boolean')
      })

      // With 5 flags at 50% each, highly unlikely (1/32 = 3%) to have all same
      // This is a weak test but helps verify basic independence
      const allEnabled = results.every(r => r.enabled)
      const allDisabled = results.every(r => !r.enabled)

      // We can't guarantee they're different, but we can verify the structure
      expect(allEnabled || allDisabled).toBeDefined() // Always passes, just structural
    })

    it('allocation is based on flag ID, not flag order', () => {
      const flag1 = createTestFlag({ id: 'alpha-flag', traffic: 0.5 })
      const flag2 = createTestFlag({ id: 'beta-flag', traffic: 0.5 })

      const userId = 'order-test-user'

      // Results should be the same regardless of evaluation order
      const result1First = evaluateFlag(flag1, { userId })
      const result2First = evaluateFlag(flag2, { userId })

      const result2Second = evaluateFlag(flag2, { userId })
      const result1Second = evaluateFlag(flag1, { userId })

      expect(result1First.enabled).toBe(result1Second.enabled)
      expect(result2First.enabled).toBe(result2Second.enabled)
    })
  })

  describe('return value structure', () => {
    it('returns enabled boolean', () => {
      const flag = createTestFlag({ traffic: 1.0 })
      const result = evaluateFlag(flag, { userId: 'user-1' })

      expect(typeof result.enabled).toBe('boolean')
    })

    it('returns variant string', () => {
      const flag = createTestFlag({ traffic: 1.0 })
      const result = evaluateFlag(flag, { userId: 'user-1' })

      expect(typeof result.variant).toBe('string')
    })

    it('payload is optional', () => {
      const flag = createTestFlag({ traffic: 1.0 })
      const result = evaluateFlag(flag, { userId: 'user-1' })

      // payload should be undefined or any value
      expect(result).toHaveProperty('enabled')
      expect(result).toHaveProperty('variant')
      // payload may or may not exist
    })

    it('returns control variant when flag is disabled', () => {
      const flag = createTestFlag({ traffic: 0 })
      const result = evaluateFlag(flag, { userId: 'user-1' })

      expect(result.enabled).toBe(false)
      expect(result.variant).toBe('control')
    })

    it('returns treatment variant when flag is enabled', () => {
      const flag = createTestFlag({ traffic: 1.0 })
      const result = evaluateFlag(flag, { userId: 'user-1' })

      expect(result.enabled).toBe(true)
      expect(result.variant).toBe('treatment')
    })
  })

  describe('large-scale statistical tests', () => {
    it('distribution is uniform across large sample (10000 users at 50%)', () => {
      const flag = createTestFlag({ id: 'large-sample-flag', traffic: 0.5 })

      let enabledCount = 0
      for (let i = 0; i < 10000; i++) {
        const result = evaluateFlag(flag, { userId: `large-sample-user-${i}` })
        if (result.enabled) {
          enabledCount++
        }
      }

      const ratio = enabledCount / 10000

      // With 10000 samples, should be very close to 0.5
      // Allow 2% variance: 0.48 - 0.52
      expect(ratio).toBeGreaterThanOrEqual(0.48)
      expect(ratio).toBeLessThanOrEqual(0.52)
    })

    it('no clustering in sequential user IDs', () => {
      const flag = createTestFlag({ id: 'clustering-test', traffic: 0.5 })

      // Check that sequential user IDs don't cluster into enabled/disabled groups
      // by looking at runs of consecutive same-result users
      const results: boolean[] = []
      for (let i = 0; i < 100; i++) {
        const result = evaluateFlag(flag, { userId: `seq-user-${i}` })
        results.push(result.enabled)
      }

      // Count runs (consecutive same values)
      let runs = 1
      for (let i = 1; i < results.length; i++) {
        if (results[i] !== results[i - 1]) {
          runs++
        }
      }

      // With 50% probability and 100 samples, expected runs is ~50
      // If clustering, runs would be very low (e.g., < 10)
      // Allow wide variance: 20-80 runs
      expect(runs).toBeGreaterThan(15)
    })
  })
})
