/**
 * RED Phase Tests for $.experiment A/B Testing API
 *
 * These tests define the expected behavior of the $.experiment A/B testing system
 * as specified in docs/plans/2026-01-11-data-api-design.md.
 *
 * ALL TESTS SHOULD FAIL - this is the TDD RED phase.
 * Implementation will be created after these tests are reviewed.
 *
 * Key features tested:
 * - Define experiments with variants, weights, goals, and audiences
 * - Deterministic user assignment using MurmurHash
 * - Experiment lifecycle (start, pause, stop, graduate)
 * - Results calculation with statistical significance
 * - Integration with $.track for attribution
 *
 * @see docs/plans/2026-01-11-data-api-design.md#3-experiment---is-this-working
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Import the experiment API (will fail - module doesn't exist yet)
import {
  createExperimentDataContext,
  createTrackContext,
  type ExperimentDataContext,
  type ExperimentDefinition,
  type ExperimentResults,
  type VariantAssignment,
  type ExperimentStatus,
  type TrackContext,
} from '..'

// ============================================================================
// Test Fixtures and Helpers
// ============================================================================

/**
 * Generate sequential user IDs for testing
 */
function generateUserIds(count: number, prefix = 'user'): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}-${i}`)
}

/**
 * Calculate chi-squared for distribution uniformity test
 */
function calculateChiSquared(observed: number[], expected: number): number {
  return observed.reduce((sum, o) => sum + Math.pow(o - expected, 2) / expected, 0)
}

/**
 * Chi-squared critical value for alpha=0.05, df=2 (3 variants - 1)
 */
const CHI_SQUARED_CRITICAL_DF2 = 5.991

// ============================================================================
// DEFINE: $.experiment.define() Tests
// ============================================================================

describe('$.experiment.define() - Experiment Definition', () => {
  let $: ExperimentDataContext

  beforeEach(() => {
    $ = createExperimentDataContext()
  })

  describe('basic experiment definition', () => {
    it('defines an experiment with minimal configuration', async () => {
      $.experiment.define('pricing-page-v2', {
        variants: ['control', 'value-based', 'usage-based'],
        goal: $.track.ratio('Purchase', 'PageView:/pricing'),
      })

      const experiment = await $.experiment('pricing-page-v2').get()

      expect(experiment).toBeDefined()
      expect(experiment?.name).toBe('pricing-page-v2')
      expect(experiment?.variants).toEqual(['control', 'value-based', 'usage-based'])
      expect(experiment?.status).toBe('draft')
    })

    it('defines an experiment with custom weights', async () => {
      $.experiment.define('checkout-test', {
        variants: ['control', 'variant-a', 'variant-b'],
        weights: [0.5, 0.25, 0.25],
        goal: $.track.ratio('Purchase', 'Checkout'),
      })

      const experiment = await $.experiment('checkout-test').get()

      expect(experiment?.weights).toEqual([0.5, 0.25, 0.25])
    })

    it('defaults to equal weights when not specified', async () => {
      $.experiment.define('equal-weights', {
        variants: ['a', 'b', 'c'],
        goal: $.track.ratio('Convert', 'View'),
      })

      const experiment = await $.experiment('equal-weights').get()

      // With 3 variants, each should get ~0.333
      expect(experiment?.weights).toHaveLength(3)
      expect(experiment?.weights?.[0]).toBeCloseTo(0.333, 2)
      expect(experiment?.weights?.[1]).toBeCloseTo(0.333, 2)
      expect(experiment?.weights?.[2]).toBeCloseTo(0.333, 2)
    })

    it('validates weights sum to 1.0', async () => {
      expect(() => {
        $.experiment.define('invalid-weights', {
          variants: ['a', 'b'],
          weights: [0.6, 0.6], // Sum > 1
          goal: $.track.ratio('X', 'Y'),
        })
      }).toThrow(/weights.*sum.*1/i)
    })

    it('validates weights array length matches variants', async () => {
      expect(() => {
        $.experiment.define('mismatched', {
          variants: ['a', 'b', 'c'],
          weights: [0.5, 0.5], // Only 2 weights for 3 variants
          goal: $.track.ratio('X', 'Y'),
        })
      }).toThrow(/weights.*variants/i)
    })

    it('requires at least 2 variants', async () => {
      expect(() => {
        $.experiment.define('single-variant', {
          variants: ['only-one'],
          goal: $.track.ratio('X', 'Y'),
        })
      }).toThrow(/at least.*2.*variants/i)
    })

    it('prevents duplicate experiment names', async () => {
      $.experiment.define('duplicate', {
        variants: ['a', 'b'],
        goal: $.track.ratio('X', 'Y'),
      })

      expect(() => {
        $.experiment.define('duplicate', {
          variants: ['c', 'd'],
          goal: $.track.ratio('Z', 'W'),
        })
      }).toThrow(/already exists/i)
    })
  })

  describe('experiment with audience filtering', () => {
    it('defines experiment with audience filter', async () => {
      $.experiment.define('new-users-only', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('Activate', 'Signup'),
        audience: (user) => user.createdAt > '2024-01-01',
      })

      const experiment = await $.experiment('new-users-only').get()

      expect(experiment?.audience).toBeDefined()
      expect(typeof experiment?.audience).toBe('function')
    })

    it('defines experiment with plan-based audience', async () => {
      $.experiment.define('free-tier-test', {
        variants: ['wizard', 'video', 'self-serve'],
        goal: $.track.ratio('Activate', 'Signup'),
        audience: (user) => user.plan === 'free',
      })

      const experiment = await $.experiment('free-tier-test').get()
      expect(experiment?.audience).toBeDefined()
    })

    it('audience filter excludes non-matching users from assignment', async () => {
      $.experiment.define('premium-only', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('Upgrade', 'View'),
        audience: (user) => user.plan === 'premium',
      })

      await $.experiment('premium-only').start()

      // Free user should not be assigned
      const freeUser = { id: 'user-1', plan: 'free' }
      const freeAssignment = await $.experiment('premium-only').assign(freeUser.id, freeUser)
      expect(freeAssignment.inExperiment).toBe(false)
      expect(freeAssignment.variant).toBeNull()

      // Premium user should be assigned
      const premiumUser = { id: 'user-2', plan: 'premium' }
      const premiumAssignment = await $.experiment('premium-only').assign(premiumUser.id, premiumUser)
      expect(premiumAssignment.inExperiment).toBe(true)
      expect(premiumAssignment.variant).toBeDefined()
    })
  })

  describe('experiment with duration and sample size', () => {
    it('defines experiment with duration', async () => {
      $.experiment.define('timed-experiment', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('Convert', 'Visit'),
        duration: '14d',
      })

      const experiment = await $.experiment('timed-experiment').get()

      expect(experiment?.duration).toBe('14d')
    })

    it('defines experiment with minimum sample size', async () => {
      $.experiment.define('sample-size-test', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('Purchase', 'Visit'),
        minSampleSize: 1000,
      })

      const experiment = await $.experiment('sample-size-test').get()

      expect(experiment?.minSampleSize).toBe(1000)
    })

    it('defines experiment with both duration and sample size', async () => {
      $.experiment.define('full-config', {
        variants: ['control', 'value-based', 'usage-based'],
        weights: [0.34, 0.33, 0.33],
        goal: $.track.ratio('Purchase', 'PageView:/pricing'),
        audience: (user) => user.createdAt > '2024-01-01',
        duration: '14d',
        minSampleSize: 1000,
      })

      const experiment = await $.experiment('full-config').get()

      expect(experiment?.variants).toHaveLength(3)
      expect(experiment?.duration).toBe('14d')
      expect(experiment?.minSampleSize).toBe(1000)
    })
  })

  describe('goal configuration', () => {
    it('supports ratio goal (conversion rate)', async () => {
      $.experiment.define('ratio-goal', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('Purchase', 'Signup'),
      })

      const experiment = await $.experiment('ratio-goal').get()
      expect(experiment?.goal).toBeDefined()
      expect(experiment?.goal?.type).toBe('ratio')
    })

    it('supports count goal', async () => {
      $.experiment.define('count-goal', {
        variants: ['control', 'treatment'],
        goal: $.track.count('Purchase'),
      })

      const experiment = await $.experiment('count-goal').get()
      expect(experiment?.goal?.type).toBe('count')
    })

    it('supports measure goal (revenue, latency, etc.)', async () => {
      $.experiment.define('measure-goal', {
        variants: ['control', 'treatment'],
        goal: $.measure.revenue.sum(),
      })

      const experiment = await $.experiment('measure-goal').get()
      expect(experiment?.goal?.type).toBe('measure')
    })
  })
})

// ============================================================================
// ASSIGN: $.experiment(name).assign(userId) Tests
// ============================================================================

describe('$.experiment(name).assign(userId) - Variant Assignment', () => {
  let $: ExperimentDataContext

  beforeEach(() => {
    $ = createExperimentDataContext()
  })

  describe('basic assignment', () => {
    it('assigns user to a variant', async () => {
      $.experiment.define('assignment-test', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('Convert', 'View'),
      })
      await $.experiment('assignment-test').start()

      const assignment = await $.experiment('assignment-test').assign('user-123')

      expect(assignment).toBeDefined()
      expect(assignment.inExperiment).toBe(true)
      expect(['control', 'treatment']).toContain(assignment.variant)
    })

    it('returns consistent assignment for same user', async () => {
      $.experiment.define('consistency-test', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('Convert', 'View'),
      })
      await $.experiment('consistency-test').start()

      const assignment1 = await $.experiment('consistency-test').assign('user-abc')
      const assignment2 = await $.experiment('consistency-test').assign('user-abc')
      const assignment3 = await $.experiment('consistency-test').assign('user-abc')

      expect(assignment1.variant).toBe(assignment2.variant)
      expect(assignment2.variant).toBe(assignment3.variant)
    })

    it('returns inExperiment: false for non-running experiment', async () => {
      $.experiment.define('draft-experiment', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('Convert', 'View'),
      })
      // Note: not started

      const assignment = await $.experiment('draft-experiment').assign('user-123')

      expect(assignment.inExperiment).toBe(false)
      expect(assignment.variant).toBeNull()
    })

    it('returns inExperiment: false for nonexistent experiment', async () => {
      const assignment = await $.experiment('nonexistent').assign('user-123')

      expect(assignment.inExperiment).toBe(false)
      expect(assignment.variant).toBeNull()
    })
  })

  describe('deterministic assignment using MurmurHash', () => {
    it('same user gets same variant across multiple context instances', async () => {
      $.experiment.define('determinism-test', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('Convert', 'View'),
      })
      await $.experiment('determinism-test').start()

      const assignment1 = await $.experiment('determinism-test').assign('stable-user')

      // Create new context (simulating server restart)
      const $new = createExperimentDataContext($._storage)
      const assignment2 = await $new.experiment('determinism-test').assign('stable-user')

      expect(assignment1.variant).toBe(assignment2.variant)
    })

    it('different experiments assign same user independently', async () => {
      $.experiment.define('exp-a', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('A', 'B'),
      })
      $.experiment.define('exp-b', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('C', 'D'),
      })
      await $.experiment('exp-a').start()
      await $.experiment('exp-b').start()

      // Test many users - assignments should be independent
      const userIds = generateUserIds(100)
      let sameCount = 0

      for (const userId of userIds) {
        const assignmentA = await $.experiment('exp-a').assign(userId)
        const assignmentB = await $.experiment('exp-b').assign(userId)
        if (assignmentA.variant === assignmentB.variant) {
          sameCount++
        }
      }

      // With independent assignment, roughly 50% should match
      expect(sameCount).toBeGreaterThan(30)
      expect(sameCount).toBeLessThan(70)
    })

    it('hash is consistent regardless of call order', async () => {
      $.experiment.define('order-test', {
        variants: ['a', 'b', 'c'],
        goal: $.track.ratio('X', 'Y'),
      })
      await $.experiment('order-test').start()

      const users = ['user-1', 'user-2', 'user-3', 'user-4', 'user-5']

      // Assign in one order
      const forward: Record<string, string | null> = {}
      for (const user of users) {
        const a = await $.experiment('order-test').assign(user)
        forward[user] = a.variant
      }

      // Assign in reverse order
      const reverse: Record<string, string | null> = {}
      for (const user of [...users].reverse()) {
        const a = await $.experiment('order-test').assign(user)
        reverse[user] = a.variant
      }

      for (const user of users) {
        expect(forward[user]).toBe(reverse[user])
      }
    })
  })

  describe('weight distribution', () => {
    it('distributes users according to equal weights', async () => {
      $.experiment.define('equal-dist', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('Convert', 'View'),
      })
      await $.experiment('equal-dist').start()

      const userIds = generateUserIds(10000)
      const counts: Record<string, number> = { control: 0, treatment: 0 }

      for (const userId of userIds) {
        const assignment = await $.experiment('equal-dist').assign(userId)
        if (assignment.variant) {
          counts[assignment.variant]++
        }
      }

      // With 50/50 split, expect roughly 5000 each
      expect(counts.control).toBeGreaterThan(4500)
      expect(counts.control).toBeLessThan(5500)
      expect(counts.treatment).toBeGreaterThan(4500)
      expect(counts.treatment).toBeLessThan(5500)
    })

    it('distributes users according to custom weights', async () => {
      $.experiment.define('custom-weights', {
        variants: ['control', 'variant-a', 'variant-b'],
        weights: [0.5, 0.3, 0.2],
        goal: $.track.ratio('Convert', 'View'),
      })
      await $.experiment('custom-weights').start()

      const userIds = generateUserIds(10000)
      const counts: Record<string, number> = { control: 0, 'variant-a': 0, 'variant-b': 0 }

      for (const userId of userIds) {
        const assignment = await $.experiment('custom-weights').assign(userId)
        if (assignment.variant) {
          counts[assignment.variant]++
        }
      }

      // 50/30/20 split
      expect(counts.control).toBeGreaterThan(4500)
      expect(counts.control).toBeLessThan(5500)
      expect(counts['variant-a']).toBeGreaterThan(2500)
      expect(counts['variant-a']).toBeLessThan(3500)
      expect(counts['variant-b']).toBeGreaterThan(1500)
      expect(counts['variant-b']).toBeLessThan(2500)
    })

    it('passes chi-squared test for uniform distribution', async () => {
      $.experiment.define('chi-test', {
        variants: ['a', 'b', 'c'],
        goal: $.track.ratio('X', 'Y'),
      })
      await $.experiment('chi-test').start()

      const userIds = generateUserIds(30000)
      const counts: Record<string, number> = { a: 0, b: 0, c: 0 }

      for (const userId of userIds) {
        const assignment = await $.experiment('chi-test').assign(userId)
        if (assignment.variant) {
          counts[assignment.variant]++
        }
      }

      const observed = [counts.a, counts.b, counts.c]
      const expected = 10000 // 30000 / 3
      const chiSquared = calculateChiSquared(observed, expected)

      expect(chiSquared).toBeLessThan(CHI_SQUARED_CRITICAL_DF2)
    })
  })
})

// ============================================================================
// RESULTS: $.experiment(name).results() Tests
// ============================================================================

describe('$.experiment(name).results() - Results and Statistical Significance', () => {
  let $: ExperimentDataContext
  let track: TrackContext

  beforeEach(() => {
    $ = createExperimentDataContext()
    track = createTrackContext($._storage)
  })

  describe('basic results', () => {
    it('returns results for running experiment', async () => {
      $.experiment.define('results-test', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('Purchase', 'Visit'),
      })
      await $.experiment('results-test').start()

      const results = await $.experiment('results-test').results()

      expect(results).toBeDefined()
      expect(results.status).toBe('running')
      expect(results.variants).toBeDefined()
    })

    it('results include user counts per variant', async () => {
      $.experiment.define('user-counts', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('Purchase', 'Visit'),
      })
      await $.experiment('user-counts').start()

      // Simulate user assignments and tracking
      for (let i = 0; i < 100; i++) {
        const userId = `user-${i}`
        const assignment = await $.experiment('user-counts').assign(userId)
        // Track visit for all users
        await track.Visit({ userId }, { experiment: 'user-counts' })
        // Track purchase for some users (simulate ~10% conversion)
        if (i % 10 === 0) {
          await track.Purchase({ userId }, { experiment: 'user-counts' })
        }
      }

      const results = await $.experiment('user-counts').results()

      expect(results.variants.control.users).toBeGreaterThan(0)
      expect(results.variants.treatment.users).toBeGreaterThan(0)
      expect(results.variants.control.users + results.variants.treatment.users).toBe(100)
    })

    it('results include conversion counts and rates', async () => {
      $.experiment.define('conversion-test', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('Purchase', 'Visit'),
      })
      await $.experiment('conversion-test').start()

      // Assign users and track events
      for (let i = 0; i < 1000; i++) {
        const userId = `user-${i}`
        await $.experiment('conversion-test').assign(userId)
        await track.Visit({ userId }, { experiment: 'conversion-test' })
        if (Math.random() < 0.1) {
          await track.Purchase({ userId }, { experiment: 'conversion-test' })
        }
      }

      const results = await $.experiment('conversion-test').results()

      expect(results.variants.control.conversions).toBeDefined()
      expect(results.variants.control.rate).toBeDefined()
      expect(results.variants.treatment.conversions).toBeDefined()
      expect(results.variants.treatment.rate).toBeDefined()
    })
  })

  describe('statistical significance', () => {
    it('calculates lift between variants', async () => {
      $.experiment.define('lift-test', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('Convert', 'Visit'),
      })
      await $.experiment('lift-test').start()

      // Simulate: control ~10% conversion, treatment ~12% conversion
      for (let i = 0; i < 500; i++) {
        const userId = `control-${i}`
        await $.experiment('lift-test')._forceAssign(userId, 'control')
        await track.Visit({ userId }, { experiment: 'lift-test' })
        if (i < 50) {
          await track.Convert({ userId }, { experiment: 'lift-test' })
        }
      }
      for (let i = 0; i < 500; i++) {
        const userId = `treatment-${i}`
        await $.experiment('lift-test')._forceAssign(userId, 'treatment')
        await track.Visit({ userId }, { experiment: 'lift-test' })
        if (i < 60) {
          await track.Convert({ userId }, { experiment: 'lift-test' })
        }
      }

      const results = await $.experiment('lift-test').results()

      expect(results.variants.treatment.lift).toBeDefined()
      expect(results.variants.treatment.lift).toMatch(/^\+?\d+%$/)
    })

    it('calculates p-value for statistical significance', async () => {
      $.experiment.define('pvalue-test', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('Convert', 'Visit'),
      })
      await $.experiment('pvalue-test').start()

      // Simulate significant difference
      for (let i = 0; i < 1000; i++) {
        const userId = `control-${i}`
        await $.experiment('pvalue-test')._forceAssign(userId, 'control')
        await track.Visit({ userId }, { experiment: 'pvalue-test' })
        if (i < 80) {
          await track.Convert({ userId }, { experiment: 'pvalue-test' })
        }
      }
      for (let i = 0; i < 1000; i++) {
        const userId = `treatment-${i}`
        await $.experiment('pvalue-test')._forceAssign(userId, 'treatment')
        await track.Visit({ userId }, { experiment: 'pvalue-test' })
        if (i < 120) {
          await track.Convert({ userId }, { experiment: 'pvalue-test' })
        }
      }

      const results = await $.experiment('pvalue-test').results()

      expect(results.variants.treatment.pValue).toBeDefined()
      expect(typeof results.variants.treatment.pValue).toBe('number')
      expect(results.variants.treatment.pValue).toBeGreaterThanOrEqual(0)
      expect(results.variants.treatment.pValue).toBeLessThanOrEqual(1)
    })

    it('identifies winner when statistically significant', async () => {
      $.experiment.define('winner-test', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('Convert', 'Visit'),
      })
      await $.experiment('winner-test').start()

      // Create clear winner with large sample
      for (let i = 0; i < 5000; i++) {
        await $.experiment('winner-test')._forceAssign(`control-${i}`, 'control')
        await track.Visit({ userId: `control-${i}` }, { experiment: 'winner-test' })
        if (i < 400) {
          await track.Convert({ userId: `control-${i}` }, { experiment: 'winner-test' })
        }
      }
      for (let i = 0; i < 5000; i++) {
        await $.experiment('winner-test')._forceAssign(`treatment-${i}`, 'treatment')
        await track.Visit({ userId: `treatment-${i}` }, { experiment: 'winner-test' })
        if (i < 600) {
          await track.Convert({ userId: `treatment-${i}` }, { experiment: 'winner-test' })
        }
      }

      const results = await $.experiment('winner-test').results()

      expect(results.winner).toBe('treatment')
      expect(results.confidence).toBeGreaterThan(0.95)
      expect(results.canCall).toBe(true)
    })

    it('canCall is false when not statistically significant', async () => {
      $.experiment.define('insufficient-data', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('Convert', 'Visit'),
      })
      await $.experiment('insufficient-data').start()

      // Small sample - not enough for significance
      for (let i = 0; i < 10; i++) {
        await $.experiment('insufficient-data')._forceAssign(`user-${i}`, i % 2 === 0 ? 'control' : 'treatment')
        await track.Visit({ userId: `user-${i}` }, { experiment: 'insufficient-data' })
        if (i < 2) {
          await track.Convert({ userId: `user-${i}` }, { experiment: 'insufficient-data' })
        }
      }

      const results = await $.experiment('insufficient-data').results()

      expect(results.canCall).toBe(false)
    })
  })

  describe('results with multiple variants', () => {
    it('calculates results for 3+ variants', async () => {
      $.experiment.define('multi-variant', {
        variants: ['control', 'variant-a', 'variant-b'],
        goal: $.track.ratio('Convert', 'Visit'),
      })
      await $.experiment('multi-variant').start()

      // Assign users to each variant
      for (let i = 0; i < 300; i++) {
        const userId = `user-${i}`
        await $.experiment('multi-variant').assign(userId)
        await track.Visit({ userId }, { experiment: 'multi-variant' })
        if (i % 10 === 0) {
          await track.Convert({ userId }, { experiment: 'multi-variant' })
        }
      }

      const results = await $.experiment('multi-variant').results()

      expect(results.variants.control).toBeDefined()
      expect(results.variants['variant-a']).toBeDefined()
      expect(results.variants['variant-b']).toBeDefined()
    })

    it('compares each variant against control', async () => {
      $.experiment.define('vs-control', {
        variants: ['control', 'variant-a', 'variant-b'],
        goal: $.track.ratio('Convert', 'Visit'),
      })
      await $.experiment('vs-control').start()

      const results = await $.experiment('vs-control').results()

      // Control shouldn't have lift (it's the baseline)
      expect(results.variants.control.lift).toBeUndefined()
      // Other variants should have lift compared to control
      expect(results.variants['variant-a'].lift).toBeDefined()
      expect(results.variants['variant-b'].lift).toBeDefined()
    })
  })
})

// ============================================================================
// LIFECYCLE: start(), pause(), stop(), graduate() Tests
// ============================================================================

describe('$.experiment() lifecycle - start, pause, stop, graduate', () => {
  let $: ExperimentDataContext

  beforeEach(() => {
    $ = createExperimentDataContext()
  })

  describe('start()', () => {
    it('starts a draft experiment', async () => {
      $.experiment.define('startable', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('X', 'Y'),
      })

      await $.experiment('startable').start()

      const experiment = await $.experiment('startable').get()
      expect(experiment?.status).toBe('running')
    })

    it('records startedAt timestamp', async () => {
      $.experiment.define('timed-start', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('X', 'Y'),
      })

      const before = Date.now()
      await $.experiment('timed-start').start()
      const after = Date.now()

      const experiment = await $.experiment('timed-start').get()
      expect(experiment?.startedAt).toBeGreaterThanOrEqual(before)
      expect(experiment?.startedAt).toBeLessThanOrEqual(after)
    })

    it('throws when starting already running experiment', async () => {
      $.experiment.define('already-running', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('X', 'Y'),
      })
      await $.experiment('already-running').start()

      await expect($.experiment('already-running').start()).rejects.toThrow(/already running/i)
    })

    it('throws when starting nonexistent experiment', async () => {
      await expect($.experiment('nonexistent').start()).rejects.toThrow(/not found/i)
    })
  })

  describe('pause()', () => {
    it('pauses a running experiment', async () => {
      $.experiment.define('pausable', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('X', 'Y'),
      })
      await $.experiment('pausable').start()

      await $.experiment('pausable').pause()

      const experiment = await $.experiment('pausable').get()
      expect(experiment?.status).toBe('paused')
    })

    it('paused experiment does not assign new users', async () => {
      $.experiment.define('paused-test', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('X', 'Y'),
      })
      await $.experiment('paused-test').start()
      await $.experiment('paused-test').pause()

      const assignment = await $.experiment('paused-test').assign('new-user')

      expect(assignment.inExperiment).toBe(false)
    })

    it('paused experiment still returns existing assignments', async () => {
      $.experiment.define('sticky-paused', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('X', 'Y'),
      })
      await $.experiment('sticky-paused').start()

      // Assign while running
      const runningAssignment = await $.experiment('sticky-paused').assign('existing-user')

      await $.experiment('sticky-paused').pause()

      // Should still get same assignment
      const pausedAssignment = await $.experiment('sticky-paused').assign('existing-user')
      expect(pausedAssignment.variant).toBe(runningAssignment.variant)
    })

    it('throws when pausing non-running experiment', async () => {
      $.experiment.define('not-running', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('X', 'Y'),
      })

      await expect($.experiment('not-running').pause()).rejects.toThrow(/not running/i)
    })
  })

  describe('stop()', () => {
    it('stops a running experiment', async () => {
      $.experiment.define('stoppable', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('X', 'Y'),
      })
      await $.experiment('stoppable').start()

      await $.experiment('stoppable').stop()

      const experiment = await $.experiment('stoppable').get()
      expect(experiment?.status).toBe('stopped')
    })

    it('records stoppedAt timestamp', async () => {
      $.experiment.define('timed-stop', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('X', 'Y'),
      })
      await $.experiment('timed-stop').start()

      const before = Date.now()
      await $.experiment('timed-stop').stop()
      const after = Date.now()

      const experiment = await $.experiment('timed-stop').get()
      expect(experiment?.stoppedAt).toBeGreaterThanOrEqual(before)
      expect(experiment?.stoppedAt).toBeLessThanOrEqual(after)
    })

    it('stopped experiment does not assign users', async () => {
      $.experiment.define('stopped-test', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('X', 'Y'),
      })
      await $.experiment('stopped-test').start()
      await $.experiment('stopped-test').stop()

      const assignment = await $.experiment('stopped-test').assign('user')

      expect(assignment.inExperiment).toBe(false)
    })

    it('can stop paused experiment', async () => {
      $.experiment.define('paused-then-stopped', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('X', 'Y'),
      })
      await $.experiment('paused-then-stopped').start()
      await $.experiment('paused-then-stopped').pause()

      await $.experiment('paused-then-stopped').stop()

      const experiment = await $.experiment('paused-then-stopped').get()
      expect(experiment?.status).toBe('stopped')
    })
  })

  describe('graduate()', () => {
    it('graduates winning variant to 100%', async () => {
      $.experiment.define('graduatable', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('X', 'Y'),
      })
      await $.experiment('graduatable').start()

      await $.experiment('graduatable').graduate('treatment')

      const experiment = await $.experiment('graduatable').get()
      expect(experiment?.status).toBe('graduated')
      expect(experiment?.graduatedVariant).toBe('treatment')
    })

    it('all users get graduated variant after graduation', async () => {
      $.experiment.define('all-treatment', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('X', 'Y'),
      })
      await $.experiment('all-treatment').start()
      await $.experiment('all-treatment').graduate('treatment')

      const userIds = generateUserIds(100)
      for (const userId of userIds) {
        const assignment = await $.experiment('all-treatment').assign(userId)
        expect(assignment.variant).toBe('treatment')
        expect(assignment.inExperiment).toBe(true) // Still "in experiment" but deterministic
      }
    })

    it('throws when graduating with invalid variant', async () => {
      $.experiment.define('invalid-graduate', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('X', 'Y'),
      })
      await $.experiment('invalid-graduate').start()

      await expect($.experiment('invalid-graduate').graduate('nonexistent')).rejects.toThrow(
        /invalid variant/i
      )
    })

    it('throws when graduating non-running experiment', async () => {
      $.experiment.define('not-started', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('X', 'Y'),
      })

      await expect($.experiment('not-started').graduate('treatment')).rejects.toThrow()
    })
  })

  describe('resume from pause', () => {
    it('can resume paused experiment', async () => {
      $.experiment.define('resumable', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('X', 'Y'),
      })
      await $.experiment('resumable').start()
      await $.experiment('resumable').pause()

      await $.experiment('resumable').start() // Resume

      const experiment = await $.experiment('resumable').get()
      expect(experiment?.status).toBe('running')
    })

    it('cannot resume stopped experiment', async () => {
      $.experiment.define('not-resumable', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('X', 'Y'),
      })
      await $.experiment('not-resumable').start()
      await $.experiment('not-resumable').stop()

      await expect($.experiment('not-resumable').start()).rejects.toThrow(/stopped/i)
    })
  })
})

// ============================================================================
// LIST: $.experiment.list() Tests
// ============================================================================

describe('$.experiment.list() - List and Filter Experiments', () => {
  let $: ExperimentDataContext

  beforeEach(() => {
    $ = createExperimentDataContext()
  })

  it('lists all experiments', async () => {
    $.experiment.define('exp-1', {
      variants: ['a', 'b'],
      goal: $.track.ratio('X', 'Y'),
    })
    $.experiment.define('exp-2', {
      variants: ['c', 'd'],
      goal: $.track.ratio('X', 'Y'),
    })

    const experiments = await $.experiment.list()

    expect(experiments).toHaveLength(2)
    expect(experiments.map((e) => e.name)).toContain('exp-1')
    expect(experiments.map((e) => e.name)).toContain('exp-2')
  })

  it('filters by status', async () => {
    $.experiment.define('running-exp', {
      variants: ['a', 'b'],
      goal: $.track.ratio('X', 'Y'),
    })
    $.experiment.define('draft-exp', {
      variants: ['c', 'd'],
      goal: $.track.ratio('X', 'Y'),
    })
    await $.experiment('running-exp').start()

    const running = await $.experiment.list({ status: 'running' })
    const draft = await $.experiment.list({ status: 'draft' })

    expect(running).toHaveLength(1)
    expect(running[0].name).toBe('running-exp')
    expect(draft).toHaveLength(1)
    expect(draft[0].name).toBe('draft-exp')
  })

  it('returns empty array when no experiments', async () => {
    const experiments = await $.experiment.list()
    expect(experiments).toEqual([])
  })

  it('includes experiment metadata', async () => {
    $.experiment.define('with-metadata', {
      variants: ['control', 'treatment'],
      goal: $.track.ratio('Convert', 'Visit'),
      duration: '14d',
      minSampleSize: 1000,
    })

    const experiments = await $.experiment.list()

    expect(experiments[0].duration).toBe('14d')
    expect(experiments[0].minSampleSize).toBe(1000)
  })
})

// ============================================================================
// ACTIVATE: $.experiment(name).activate(userId) Tests
// ============================================================================

describe('$.experiment(name).activate(userId) - Session Context', () => {
  let $: ExperimentDataContext
  let track: TrackContext

  beforeEach(() => {
    $ = createExperimentDataContext()
    track = createTrackContext($._storage)
  })

  it('activates experiment context for a user session', async () => {
    $.experiment.define('session-test', {
      variants: ['control', 'treatment'],
      goal: $.track.ratio('Convert', 'Visit'),
    })
    await $.experiment('session-test').start()

    await $.experiment('session-test').activate('user-123')

    // Subsequent tracks should auto-include experiment
    await track.Visit({ userId: 'user-123' })
    await track.Convert({ userId: 'user-123' })

    const results = await $.experiment('session-test').results()
    expect(results.variants.control.users + results.variants.treatment.users).toBeGreaterThan(0)
  })

  it('activate returns the assigned variant', async () => {
    $.experiment.define('activate-return', {
      variants: ['control', 'treatment'],
      goal: $.track.ratio('X', 'Y'),
    })
    await $.experiment('activate-return').start()

    const variant = await $.experiment('activate-return').activate('user-123')

    expect(['control', 'treatment']).toContain(variant)
  })
})

// ============================================================================
// TRACK INTEGRATION: Event Attribution Tests
// ============================================================================

describe('$.track integration - Event Attribution', () => {
  let $: ExperimentDataContext
  let track: TrackContext

  beforeEach(() => {
    $ = createExperimentDataContext()
    track = createTrackContext($._storage)
  })

  it('tracks events with explicit experiment attribution', async () => {
    $.experiment.define('explicit-attr', {
      variants: ['control', 'treatment'],
      goal: $.track.ratio('Purchase', 'Visit'),
    })
    await $.experiment('explicit-attr').start()

    await $.experiment('explicit-attr').assign('user-1')

    // Track with explicit experiment context
    await track.Visit({ userId: 'user-1' }, { experiment: 'explicit-attr' })
    await track.Purchase({ userId: 'user-1', amount: 99 }, { experiment: 'explicit-attr' })

    const results = await $.experiment('explicit-attr').results()
    expect(results.variants.control.users + results.variants.treatment.users).toBe(1)
  })

  it('attributes events to correct variant', async () => {
    $.experiment.define('variant-attr', {
      variants: ['control', 'treatment'],
      goal: $.track.ratio('Convert', 'Visit'),
    })
    await $.experiment('variant-attr').start()

    // Force specific assignments for testing
    await $.experiment('variant-attr')._forceAssign('control-user', 'control')
    await $.experiment('variant-attr')._forceAssign('treatment-user', 'treatment')

    await track.Visit({ userId: 'control-user' }, { experiment: 'variant-attr' })
    await track.Convert({ userId: 'control-user' }, { experiment: 'variant-attr' })

    await track.Visit({ userId: 'treatment-user' }, { experiment: 'variant-attr' })
    // treatment-user does not convert

    const results = await $.experiment('variant-attr').results()

    expect(results.variants.control.conversions).toBe(1)
    expect(results.variants.control.users).toBe(1)
    expect(results.variants.treatment.conversions).toBe(0)
    expect(results.variants.treatment.users).toBe(1)
  })

  it('ignores events for users not in experiment', async () => {
    $.experiment.define('audience-limited', {
      variants: ['control', 'treatment'],
      goal: $.track.ratio('Convert', 'Visit'),
      audience: (user) => user.plan === 'premium',
    })
    await $.experiment('audience-limited').start()

    // Free user - not in experiment
    await track.Visit({ userId: 'free-user', plan: 'free' }, { experiment: 'audience-limited' })
    await track.Convert({ userId: 'free-user', plan: 'free' }, { experiment: 'audience-limited' })

    const results = await $.experiment('audience-limited').results()
    expect(results.variants.control.users + results.variants.treatment.users).toBe(0)
  })
})

// ============================================================================
// EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('$.experiment edge cases and error handling', () => {
  let $: ExperimentDataContext

  beforeEach(() => {
    $ = createExperimentDataContext()
  })

  describe('experiment naming', () => {
    it('handles experiments with special characters in name', async () => {
      $.experiment.define('my-experiment_v2.0', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('X', 'Y'),
      })

      const experiment = await $.experiment('my-experiment_v2.0').get()
      expect(experiment?.name).toBe('my-experiment_v2.0')
    })

    it('rejects empty experiment name', () => {
      expect(() => {
        $.experiment.define('', {
          variants: ['control', 'treatment'],
          goal: $.track.ratio('X', 'Y'),
        })
      }).toThrow(/name.*required/i)
    })

    it('rejects experiment name with only whitespace', () => {
      expect(() => {
        $.experiment.define('   ', {
          variants: ['control', 'treatment'],
          goal: $.track.ratio('X', 'Y'),
        })
      }).toThrow(/name.*required/i)
    })
  })

  describe('variant naming', () => {
    it('handles variants with special characters', async () => {
      $.experiment.define('special-variants', {
        variants: ['variant-a', 'variant_b', 'variant.c'],
        goal: $.track.ratio('X', 'Y'),
      })

      const experiment = await $.experiment('special-variants').get()
      expect(experiment?.variants).toContain('variant-a')
      expect(experiment?.variants).toContain('variant_b')
      expect(experiment?.variants).toContain('variant.c')
    })

    it('rejects duplicate variant names', () => {
      expect(() => {
        $.experiment.define('dup-variants', {
          variants: ['control', 'control', 'treatment'],
          goal: $.track.ratio('X', 'Y'),
        })
      }).toThrow(/duplicate.*variant/i)
    })

    it('rejects empty variant names', () => {
      expect(() => {
        $.experiment.define('empty-variant', {
          variants: ['control', '', 'treatment'],
          goal: $.track.ratio('X', 'Y'),
        })
      }).toThrow(/variant.*empty/i)
    })
  })

  describe('weight validation', () => {
    it('rejects negative weights', () => {
      expect(() => {
        $.experiment.define('negative-weight', {
          variants: ['control', 'treatment'],
          weights: [-0.5, 1.5],
          goal: $.track.ratio('X', 'Y'),
        })
      }).toThrow(/weight.*negative/i)
    })

    it('rejects zero weight for any variant', () => {
      expect(() => {
        $.experiment.define('zero-weight', {
          variants: ['control', 'treatment'],
          weights: [1.0, 0.0],
          goal: $.track.ratio('X', 'Y'),
        })
      }).toThrow(/weight.*zero/i)
    })

    it('handles floating point precision in weights', async () => {
      // 0.1 + 0.2 + 0.7 should be ~1.0 despite floating point issues
      $.experiment.define('float-weights', {
        variants: ['a', 'b', 'c'],
        weights: [0.1, 0.2, 0.7],
        goal: $.track.ratio('X', 'Y'),
      })

      const experiment = await $.experiment('float-weights').get()
      expect(experiment).toBeDefined()
    })
  })

  describe('concurrent operations', () => {
    it('handles concurrent assignments safely', async () => {
      $.experiment.define('concurrent-assign', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('X', 'Y'),
      })
      await $.experiment('concurrent-assign').start()

      const userIds = generateUserIds(100)
      const assignments = await Promise.all(
        userIds.map((id) => $.experiment('concurrent-assign').assign(id))
      )

      // All should complete successfully
      expect(assignments).toHaveLength(100)
      for (const assignment of assignments) {
        expect(assignment.inExperiment).toBe(true)
        expect(['control', 'treatment']).toContain(assignment.variant)
      }
    })

    it('handles concurrent lifecycle operations gracefully', async () => {
      $.experiment.define('concurrent-lifecycle', {
        variants: ['control', 'treatment'],
        goal: $.track.ratio('X', 'Y'),
      })
      await $.experiment('concurrent-lifecycle').start()

      // Concurrent pause attempts - only first should succeed, rest should fail gracefully
      const results = await Promise.allSettled([
        $.experiment('concurrent-lifecycle').pause(),
        $.experiment('concurrent-lifecycle').pause(),
        $.experiment('concurrent-lifecycle').pause(),
      ])

      // At least one should succeed
      const successes = results.filter((r) => r.status === 'fulfilled')
      expect(successes.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('experiment get()', () => {
    it('returns undefined for nonexistent experiment', async () => {
      const experiment = await $.experiment('nonexistent').get()
      expect(experiment).toBeUndefined()
    })

    it('returns full experiment details', async () => {
      $.experiment.define('full-details', {
        variants: ['control', 'variant-a', 'variant-b'],
        weights: [0.5, 0.25, 0.25],
        goal: $.track.ratio('Purchase', 'Visit'),
        audience: (user) => user.plan === 'pro',
        duration: '7d',
        minSampleSize: 500,
      })
      await $.experiment('full-details').start()

      const experiment = await $.experiment('full-details').get()

      expect(experiment?.name).toBe('full-details')
      expect(experiment?.variants).toEqual(['control', 'variant-a', 'variant-b'])
      expect(experiment?.weights).toEqual([0.5, 0.25, 0.25])
      expect(experiment?.status).toBe('running')
      expect(experiment?.duration).toBe('7d')
      expect(experiment?.minSampleSize).toBe(500)
      expect(experiment?.startedAt).toBeDefined()
    })
  })
})

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe('$.experiment performance', () => {
  let $: ExperimentDataContext

  beforeEach(() => {
    $ = createExperimentDataContext()
  })

  it('assigns 10K users in under 1 second', async () => {
    $.experiment.define('perf-test', {
      variants: ['control', 'treatment'],
      goal: $.track.ratio('X', 'Y'),
    })
    await $.experiment('perf-test').start()

    const userIds = generateUserIds(10000)

    const start = performance.now()
    for (const userId of userIds) {
      await $.experiment('perf-test').assign(userId)
    }
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(1000)
  })

  it('batch assignment is efficient', async () => {
    $.experiment.define('batch-perf', {
      variants: ['control', 'treatment'],
      goal: $.track.ratio('X', 'Y'),
    })
    await $.experiment('batch-perf').start()

    const userIds = generateUserIds(10000)

    const start = performance.now()
    await $.experiment('batch-perf').assignBatch(userIds)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(500)
  })

  it('results calculation scales with sample size', async () => {
    $.experiment.define('results-perf', {
      variants: ['control', 'treatment'],
      goal: $.track.ratio('X', 'Y'),
    })
    await $.experiment('results-perf').start()

    // Simulate 10K users with events
    for (let i = 0; i < 10000; i++) {
      await $.experiment('results-perf')._forceAssign(`user-${i}`, i % 2 === 0 ? 'control' : 'treatment')
    }

    const start = performance.now()
    await $.experiment('results-perf').results()
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(500)
  })
})

// ============================================================================
// INTEGRATION: Full Experiment Lifecycle Test
// ============================================================================

describe('$.experiment full lifecycle integration', () => {
  let $: ExperimentDataContext
  let track: TrackContext

  beforeEach(() => {
    $ = createExperimentDataContext()
    track = createTrackContext($._storage)
  })

  it('runs complete experiment lifecycle from definition to graduation', async () => {
    // 1. Define experiment
    $.experiment.define('pricing-page-v2', {
      variants: ['control', 'value-based', 'usage-based'],
      weights: [0.34, 0.33, 0.33],
      goal: $.track.ratio('Purchase', 'PageView:/pricing'),
      audience: (user) => user.createdAt > '2024-01-01',
      duration: '14d',
      minSampleSize: 1000,
    })

    // 2. Verify draft state
    let experiment = await $.experiment('pricing-page-v2').get()
    expect(experiment?.status).toBe('draft')

    // 3. Start experiment
    await $.experiment('pricing-page-v2').start()
    experiment = await $.experiment('pricing-page-v2').get()
    expect(experiment?.status).toBe('running')

    // 4. Assign users and track events
    const userIds = generateUserIds(3000)
    const conversionRates = { control: 0.08, 'value-based': 0.12, 'usage-based': 0.09 }

    for (const userId of userIds) {
      const user = { id: userId, createdAt: '2024-02-01' }
      const assignment = await $.experiment('pricing-page-v2').assign(userId, user)

      if (assignment.inExperiment && assignment.variant) {
        // Track page view
        await track['PageView:/pricing']({ userId }, { experiment: 'pricing-page-v2' })

        // Track purchase based on variant conversion rate
        const rate = conversionRates[assignment.variant as keyof typeof conversionRates]
        if (Math.random() < rate) {
          await track.Purchase({ userId }, { experiment: 'pricing-page-v2' })
        }
      }
    }

    // 5. Check results
    let results = await $.experiment('pricing-page-v2').results()
    expect(results.status).toBe('running')
    expect(results.variants.control).toBeDefined()
    expect(results.variants['value-based']).toBeDefined()
    expect(results.variants['usage-based']).toBeDefined()

    // 6. Pause experiment
    await $.experiment('pricing-page-v2').pause()
    experiment = await $.experiment('pricing-page-v2').get()
    expect(experiment?.status).toBe('paused')

    // 7. Resume experiment
    await $.experiment('pricing-page-v2').start()
    experiment = await $.experiment('pricing-page-v2').get()
    expect(experiment?.status).toBe('running')

    // 8. Graduate winner
    await $.experiment('pricing-page-v2').graduate('value-based')
    experiment = await $.experiment('pricing-page-v2').get()
    expect(experiment?.status).toBe('graduated')
    expect(experiment?.graduatedVariant).toBe('value-based')

    // 9. Verify all new users get graduated variant
    const newAssignment = await $.experiment('pricing-page-v2').assign('new-user-after-graduation')
    expect(newAssignment.variant).toBe('value-based')
  })
})
