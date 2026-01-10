import { describe, it, expect, beforeEach } from 'vitest'

/**
 * RED Phase Tests for Experiment API ($.experiment)
 *
 * These tests define the expected behavior of the $.experiment A/B testing system.
 * They will FAIL until the implementation is created.
 *
 * Experiments build on top of feature flags to provide:
 * - Variant allocation (control vs treatment groups)
 * - Deterministic user assignment using hash
 * - Metrics/goals tracking integration
 *
 * Usage:
 *   const variant = await $.experiment('checkout_v2').allocate(userId)
 *   const isEnabled = await $.experiment('checkout_v2').isEnabled()
 *   const result = await $.experiment('checkout_v2').variant('control')
 */

// Import the experiment API (will fail - module doesn't exist yet)
import {
  createExperimentContext,
  type Experiment,
  type ExperimentContext,
  type Variant,
  type AllocationResult,
} from '../context/experiment'

describe('Experiment API ($.experiment)', () => {
  let $: ExperimentContext

  beforeEach(() => {
    // Create a fresh experiment context for each test
    $ = createExperimentContext()
  })

  // ============================================================================
  // EXPERIMENT CREATION
  // ============================================================================

  describe('Experiment.create API', () => {
    it('creates an experiment with default 50/50 split', async () => {
      await $.Experiment.create({
        id: 'checkout_v2',
        variants: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
      })

      const experiment = await $._storage.experiments.get('checkout_v2')

      expect(experiment).toBeDefined()
      expect(experiment?.id).toBe('checkout_v2')
      expect(experiment?.variants).toHaveLength(2)
      expect(experiment?.variants[0].key).toBe('control')
      expect(experiment?.variants[1].key).toBe('treatment')
    })

    it('creates an experiment with custom variant weights', async () => {
      await $.Experiment.create({
        id: 'pricing_test',
        variants: [
          { key: 'control', weight: 80 },
          { key: 'discount_10', weight: 10 },
          { key: 'discount_20', weight: 10 },
        ],
      })

      const experiment = await $._storage.experiments.get('pricing_test')

      expect(experiment?.variants).toHaveLength(3)
      expect(experiment?.variants[0].weight).toBe(80)
      expect(experiment?.variants[1].weight).toBe(10)
      expect(experiment?.variants[2].weight).toBe(10)
    })

    it('creates an experiment with traffic allocation', async () => {
      await $.Experiment.create({
        id: 'limited_rollout',
        traffic: 0.1, // Only 10% of users participate
        variants: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
      })

      const experiment = await $._storage.experiments.get('limited_rollout')

      expect(experiment?.traffic).toBe(0.1)
    })

    it('defaults traffic to 1.0 (100%) if not specified', async () => {
      await $.Experiment.create({
        id: 'full_rollout',
        variants: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
      })

      const experiment = await $._storage.experiments.get('full_rollout')

      expect(experiment?.traffic).toBe(1.0)
    })

    it('validates that weights are positive', async () => {
      await expect(
        $.Experiment.create({
          id: 'invalid_weights',
          variants: [
            { key: 'control', weight: -10 },
            { key: 'treatment', weight: 50 },
          ],
        })
      ).rejects.toThrow()
    })

    it('validates that at least 2 variants are provided', async () => {
      await expect(
        $.Experiment.create({
          id: 'single_variant',
          variants: [{ key: 'only_one', weight: 100 }],
        })
      ).rejects.toThrow()
    })

    it('prevents duplicate experiment creation', async () => {
      await $.Experiment.create({
        id: 'duplicate_test',
        variants: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
      })

      await expect(
        $.Experiment.create({
          id: 'duplicate_test',
          variants: [
            { key: 'a', weight: 50 },
            { key: 'b', weight: 50 },
          ],
        })
      ).rejects.toThrow()
    })

    it('validates traffic is between 0 and 1', async () => {
      await expect(
        $.Experiment.create({
          id: 'invalid_traffic_high',
          traffic: 1.5,
          variants: [
            { key: 'control', weight: 50 },
            { key: 'treatment', weight: 50 },
          ],
        })
      ).rejects.toThrow()

      await expect(
        $.Experiment.create({
          id: 'invalid_traffic_low',
          traffic: -0.1,
          variants: [
            { key: 'control', weight: 50 },
            { key: 'treatment', weight: 50 },
          ],
        })
      ).rejects.toThrow()
    })
  })

  // ============================================================================
  // USER ALLOCATION - $.experiment(id).allocate(userId)
  // ============================================================================

  describe('$.experiment(id).allocate(userId)', () => {
    it('allocates user to a variant deterministically', async () => {
      await $.Experiment.create({
        id: 'checkout_v2',
        variants: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
      })

      const result = await $.experiment('checkout_v2').allocate('user-123')

      expect(result).toBeDefined()
      expect(result.variant).toBeDefined()
      expect(['control', 'treatment']).toContain(result.variant)
      expect(result.inExperiment).toBe(true)
    })

    it('returns same variant for same user consistently', async () => {
      await $.Experiment.create({
        id: 'consistency_test',
        variants: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
      })

      const result1 = await $.experiment('consistency_test').allocate('user-abc')
      const result2 = await $.experiment('consistency_test').allocate('user-abc')
      const result3 = await $.experiment('consistency_test').allocate('user-abc')

      expect(result1.variant).toBe(result2.variant)
      expect(result2.variant).toBe(result3.variant)
    })

    it('returns inExperiment: false when user not in traffic allocation', async () => {
      await $.Experiment.create({
        id: 'limited_experiment',
        traffic: 0.0, // No users in experiment
        variants: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
      })

      const result = await $.experiment('limited_experiment').allocate('user-123')

      expect(result.inExperiment).toBe(false)
      expect(result.variant).toBeNull()
    })

    it('returns inExperiment: false for nonexistent experiment', async () => {
      const result = await $.experiment('nonexistent').allocate('user-123')

      expect(result.inExperiment).toBe(false)
      expect(result.variant).toBeNull()
    })

    it('respects traffic allocation percentage', async () => {
      await $.Experiment.create({
        id: 'half_traffic',
        traffic: 0.5,
        variants: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
      })

      // Test many users
      const userIds = Array.from({ length: 1000 }, (_, i) => `traffic-user-${i}`)
      const results = await Promise.all(
        userIds.map((id) => $.experiment('half_traffic').allocate(id))
      )

      const inExperimentCount = results.filter((r) => r.inExperiment).length

      // With 50% traffic, expect roughly 500 users in experiment
      expect(inExperimentCount).toBeGreaterThan(350)
      expect(inExperimentCount).toBeLessThan(650)
    })

    it('distributes variants according to weights', async () => {
      await $.Experiment.create({
        id: 'weighted_experiment',
        traffic: 1.0,
        variants: [
          { key: 'control', weight: 80 },
          { key: 'treatment', weight: 20 },
        ],
      })

      const userIds = Array.from({ length: 1000 }, (_, i) => `weight-user-${i}`)
      const results = await Promise.all(
        userIds.map((id) => $.experiment('weighted_experiment').allocate(id))
      )

      const controlCount = results.filter((r) => r.variant === 'control').length
      const treatmentCount = results.filter((r) => r.variant === 'treatment').length

      // With 80/20 split, expect roughly 800 control and 200 treatment
      expect(controlCount).toBeGreaterThan(650)
      expect(controlCount).toBeLessThan(950)
      expect(treatmentCount).toBeGreaterThan(50)
      expect(treatmentCount).toBeLessThan(350)
    })

    it('includes variant payload in allocation result', async () => {
      await $.Experiment.create({
        id: 'payload_experiment',
        variants: [
          { key: 'control', weight: 50, payload: { buttonColor: 'blue' } },
          { key: 'treatment', weight: 50, payload: { buttonColor: 'green' } },
        ],
      })

      const result = await $.experiment('payload_experiment').allocate('user-123')

      expect(result.payload).toBeDefined()
      expect(['blue', 'green']).toContain(result.payload?.buttonColor)
    })
  })

  // ============================================================================
  // IS ENABLED - $.experiment(id).isEnabled()
  // ============================================================================

  describe('$.experiment(id).isEnabled()', () => {
    it('returns true for active experiment', async () => {
      await $.Experiment.create({
        id: 'active_experiment',
        status: 'running',
        variants: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
      })

      const enabled = await $.experiment('active_experiment').isEnabled()

      expect(enabled).toBe(true)
    })

    it('returns false for paused experiment', async () => {
      await $.Experiment.create({
        id: 'paused_experiment',
        status: 'paused',
        variants: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
      })

      const enabled = await $.experiment('paused_experiment').isEnabled()

      expect(enabled).toBe(false)
    })

    it('returns false for completed experiment', async () => {
      await $.Experiment.create({
        id: 'completed_experiment',
        status: 'completed',
        variants: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
      })

      const enabled = await $.experiment('completed_experiment').isEnabled()

      expect(enabled).toBe(false)
    })

    it('returns false for nonexistent experiment', async () => {
      const enabled = await $.experiment('nonexistent').isEnabled()

      expect(enabled).toBe(false)
    })

    it('defaults to running status when not specified', async () => {
      await $.Experiment.create({
        id: 'default_status',
        variants: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
      })

      const enabled = await $.experiment('default_status').isEnabled()

      expect(enabled).toBe(true)
    })
  })

  // ============================================================================
  // VARIANT CHECK - $.experiment(id).variant(name)
  // ============================================================================

  describe('$.experiment(id).variant(name)', () => {
    it('returns variant configuration when it exists', async () => {
      await $.Experiment.create({
        id: 'variant_lookup',
        variants: [
          { key: 'control', weight: 50, payload: { discount: 0 } },
          { key: 'treatment', weight: 50, payload: { discount: 10 } },
        ],
      })

      const variant = await $.experiment('variant_lookup').variant('control')

      expect(variant).toBeDefined()
      expect(variant?.key).toBe('control')
      expect(variant?.weight).toBe(50)
      expect(variant?.payload?.discount).toBe(0)
    })

    it('returns undefined for nonexistent variant', async () => {
      await $.Experiment.create({
        id: 'missing_variant',
        variants: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
      })

      const variant = await $.experiment('missing_variant').variant('nonexistent')

      expect(variant).toBeUndefined()
    })

    it('returns undefined for nonexistent experiment', async () => {
      const variant = await $.experiment('nonexistent').variant('control')

      expect(variant).toBeUndefined()
    })
  })

  // ============================================================================
  // EXPERIMENT LIFECYCLE
  // ============================================================================

  describe('Experiment lifecycle', () => {
    it('can pause an experiment', async () => {
      await $.Experiment.create({
        id: 'pausable',
        variants: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
      })

      await $.experiment('pausable').pause()

      const enabled = await $.experiment('pausable').isEnabled()
      expect(enabled).toBe(false)

      const experiment = await $._storage.experiments.get('pausable')
      expect(experiment?.status).toBe('paused')
    })

    it('can resume a paused experiment', async () => {
      await $.Experiment.create({
        id: 'resumable',
        status: 'paused',
        variants: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
      })

      await $.experiment('resumable').resume()

      const enabled = await $.experiment('resumable').isEnabled()
      expect(enabled).toBe(true)

      const experiment = await $._storage.experiments.get('resumable')
      expect(experiment?.status).toBe('running')
    })

    it('can complete an experiment', async () => {
      await $.Experiment.create({
        id: 'completable',
        variants: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
      })

      await $.experiment('completable').complete()

      const enabled = await $.experiment('completable').isEnabled()
      expect(enabled).toBe(false)

      const experiment = await $._storage.experiments.get('completable')
      expect(experiment?.status).toBe('completed')
    })

    it('throws when pausing nonexistent experiment', async () => {
      await expect($.experiment('nonexistent').pause()).rejects.toThrow()
    })

    it('can update traffic allocation', async () => {
      await $.Experiment.create({
        id: 'traffic_update',
        traffic: 0.1,
        variants: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
      })

      await $.experiment('traffic_update').setTraffic(0.5)

      const experiment = await $._storage.experiments.get('traffic_update')
      expect(experiment?.traffic).toBe(0.5)
    })

    it('validates traffic when updating', async () => {
      await $.Experiment.create({
        id: 'traffic_validate',
        variants: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
      })

      await expect($.experiment('traffic_validate').setTraffic(2.0)).rejects.toThrow()
      await expect($.experiment('traffic_validate').setTraffic(-0.1)).rejects.toThrow()
    })
  })

  // ============================================================================
  // EXPERIMENT LISTING AND MANAGEMENT
  // ============================================================================

  describe('Experiment listing', () => {
    it('can list all experiments', async () => {
      await $.Experiment.create({
        id: 'exp1',
        variants: [
          { key: 'a', weight: 50 },
          { key: 'b', weight: 50 },
        ],
      })
      await $.Experiment.create({
        id: 'exp2',
        variants: [
          { key: 'a', weight: 50 },
          { key: 'b', weight: 50 },
        ],
      })

      const experiments = await $.Experiment.list()

      expect(experiments).toHaveLength(2)
      expect(experiments.map((e: Experiment) => e.id)).toContain('exp1')
      expect(experiments.map((e: Experiment) => e.id)).toContain('exp2')
    })

    it('can get experiment by id', async () => {
      await $.Experiment.create({
        id: 'get_test',
        traffic: 0.75,
        variants: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
      })

      const experiment = await $.experiment('get_test').get()

      expect(experiment).toBeDefined()
      expect(experiment?.id).toBe('get_test')
      expect(experiment?.traffic).toBe(0.75)
    })

    it('returns undefined for nonexistent experiment get', async () => {
      const experiment = await $.experiment('nonexistent').get()

      expect(experiment).toBeUndefined()
    })

    it('can delete an experiment', async () => {
      await $.Experiment.create({
        id: 'deletable',
        variants: [
          { key: 'a', weight: 50 },
          { key: 'b', weight: 50 },
        ],
      })

      await $.experiment('deletable').delete()

      const experiment = await $._storage.experiments.get('deletable')
      expect(experiment).toBeUndefined()
    })
  })

  // ============================================================================
  // DETERMINISTIC HASHING
  // ============================================================================

  describe('Deterministic hashing', () => {
    it('different experiments produce independent allocations for same user', async () => {
      await $.Experiment.create({
        id: 'exp_a',
        variants: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
      })
      await $.Experiment.create({
        id: 'exp_b',
        variants: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
      })

      // With many users, allocations should be independent
      const userIds = Array.from({ length: 100 }, (_, i) => `independence-user-${i}`)

      const resultsA = await Promise.all(
        userIds.map((id) => $.experiment('exp_a').allocate(id))
      )
      const resultsB = await Promise.all(
        userIds.map((id) => $.experiment('exp_b').allocate(id))
      )

      // Count how many users have different assignments between experiments
      let differentCount = 0
      for (let i = 0; i < userIds.length; i++) {
        if (resultsA[i].variant !== resultsB[i].variant) {
          differentCount++
        }
      }

      // With independent assignment, roughly 50% should differ
      expect(differentCount).toBeGreaterThan(20)
    })

    it('allocation is stable across multiple context instances', async () => {
      await $.Experiment.create({
        id: 'stable_allocation',
        variants: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
      })

      const result1 = await $.experiment('stable_allocation').allocate('user-stable')

      // Create new context with same storage
      const $new = createExperimentContext($._storage)
      const result2 = await $new.experiment('stable_allocation').allocate('user-stable')

      expect(result1.variant).toBe(result2.variant)
    })
  })
})
