/**
 * Unified Experiment Tracking API Tests
 *
 * Tests for the simplified ExperimentTracking interface that wraps
 * the lower-level components into a cohesive API:
 *
 * - trackAssignment(experimentId, userId, variant)
 * - trackConversion(experimentId, userId, metric, value?)
 * - getExperimentStats(experimentId)
 * - getVariant(experimentId, userId)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createExperimentTracking,
  type ExperimentTracking,
  type ExperimentStats,
  type CreateExperimentInput,
} from '../experiment-tracking'

describe('Unified Experiment Tracking API', () => {
  let tracking: ExperimentTracking

  beforeEach(() => {
    tracking = createExperimentTracking({
      minSampleSize: 10, // Lower for testing
      alpha: 0.05,
      power: 0.8,
    })
  })

  afterEach(() => {
    tracking.destroy()
  })

  // ===========================================================================
  // EXPERIMENT MANAGEMENT
  // ===========================================================================

  describe('Experiment Management', () => {
    it('creates an A/B experiment', async () => {
      const experiment = await tracking.createExperiment({
        id: 'pricing-test',
        name: 'Pricing Page Test',
        variants: [
          { key: 'control', name: 'Original', isControl: true },
          { key: 'treatment', name: 'New Design' },
        ],
        metrics: [
          { id: 'signup', name: 'Sign Up', type: 'conversion', isPrimary: true },
        ],
      })

      expect(experiment.id).toBe('pricing-test')
      expect(experiment.status).toBe('draft')
      expect(experiment.variants).toHaveLength(2)
    })

    it('creates a multi-variant experiment (A/B/C/D)', async () => {
      const experiment = await tracking.createExperiment({
        id: 'multi-variant',
        name: 'Multi Variant Test',
        variants: [
          { key: 'control', name: 'Control', isControl: true },
          { key: 'variant-a', name: 'Variant A' },
          { key: 'variant-b', name: 'Variant B' },
          { key: 'variant-c', name: 'Variant C' },
        ],
        metrics: [
          { id: 'conversion', name: 'Conversion', type: 'conversion' },
        ],
      })

      expect(experiment.variants).toHaveLength(4)
      // Weights should be equal when not specified
      const totalWeight = experiment.variants.reduce((sum, v) => sum + v.weight, 0)
      expect(totalWeight).toBeCloseTo(100, 1)
    })

    it('starts and manages experiment lifecycle', async () => {
      await tracking.createExperiment({
        id: 'lifecycle-test',
        name: 'Lifecycle Test',
        variants: [
          { key: 'control', name: 'Control' },
          { key: 'treatment', name: 'Treatment' },
        ],
        metrics: [{ id: 'goal', name: 'Goal' }],
      })

      // Start
      let exp = await tracking.startExperiment('lifecycle-test')
      expect(exp.status).toBe('running')
      expect(exp.startedAt).toBeInstanceOf(Date)

      // Pause
      exp = await tracking.pauseExperiment('lifecycle-test')
      expect(exp.status).toBe('paused')

      // Resume
      exp = await tracking.resumeExperiment('lifecycle-test')
      expect(exp.status).toBe('running')

      // Complete
      exp = await tracking.completeExperiment('lifecycle-test', 'treatment')
      expect(exp.status).toBe('completed')
      expect(exp.winner).toBe('treatment')
      expect(exp.endedAt).toBeInstanceOf(Date)
    })

    it('lists experiments by status', async () => {
      await tracking.createExperiment({
        id: 'exp-1',
        name: 'Experiment 1',
        variants: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }],
        metrics: [{ id: 'goal', name: 'Goal' }],
      })
      await tracking.createExperiment({
        id: 'exp-2',
        name: 'Experiment 2',
        variants: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }],
        metrics: [{ id: 'goal', name: 'Goal' }],
      })
      await tracking.startExperiment('exp-1')

      const drafts = await tracking.listExperiments({ status: 'draft' })
      const running = await tracking.listExperiments({ status: 'running' })

      expect(drafts).toHaveLength(1)
      expect(drafts[0].id).toBe('exp-2')
      expect(running).toHaveLength(1)
      expect(running[0].id).toBe('exp-1')
    })
  })

  // ===========================================================================
  // CORE TRACKING API
  // ===========================================================================

  describe('trackAssignment()', () => {
    beforeEach(async () => {
      await tracking.createExperiment({
        id: 'assignment-test',
        name: 'Assignment Test',
        variants: [
          { key: 'control', name: 'Control', isControl: true },
          { key: 'treatment', name: 'Treatment' },
        ],
        metrics: [{ id: 'conversion', name: 'Conversion' }],
      })
      await tracking.startExperiment('assignment-test')
    })

    it('tracks user assignment to experiment', async () => {
      await tracking.trackAssignment('assignment-test', 'user-123')

      const assignment = await tracking.getAssignment('assignment-test', 'user-123')
      expect(assignment).not.toBeNull()
      expect(assignment!.userId).toBe('user-123')
      expect(['control', 'treatment']).toContain(assignment!.variant)
    })

    it('maintains consistent assignment for same user', async () => {
      await tracking.trackAssignment('assignment-test', 'user-456')
      await tracking.trackAssignment('assignment-test', 'user-456')

      const assignments = await tracking.getUserAssignments('user-456')
      expect(assignments).toHaveLength(1)
    })

    it('tracks multiple users', async () => {
      for (let i = 0; i < 100; i++) {
        await tracking.trackAssignment('assignment-test', `user-${i}`)
      }

      const stats = await tracking.getExperimentStats('assignment-test')
      expect(stats!.totalSampleSize).toBe(100)
    })
  })

  describe('trackConversion()', () => {
    beforeEach(async () => {
      await tracking.createExperiment({
        id: 'conversion-test',
        name: 'Conversion Test',
        variants: [
          { key: 'control', name: 'Control', isControl: true },
          { key: 'treatment', name: 'Treatment' },
        ],
        metrics: [
          { id: 'signup', name: 'Sign Up', type: 'conversion', isPrimary: true },
          { id: 'revenue', name: 'Revenue', type: 'revenue' },
        ],
      })
      await tracking.startExperiment('conversion-test')

      // Assign some users first
      for (let i = 0; i < 20; i++) {
        await tracking.trackAssignment('conversion-test', `user-${i}`)
      }
    })

    it('tracks conversion event', async () => {
      await tracking.trackConversion('conversion-test', 'user-0', 'signup')

      const hasConverted = await tracking.hasConverted('conversion-test', 'user-0', 'signup')
      expect(hasConverted).toBe(true)
    })

    it('tracks conversion with value', async () => {
      await tracking.trackConversion('conversion-test', 'user-1', 'revenue', 99.99)

      const count = await tracking.getConversionCount('conversion-test', 'user-1')
      expect(count).toBe(1)
    })

    it('auto-assigns user if not already assigned', async () => {
      // Track conversion for user not yet assigned
      await tracking.trackConversion('conversion-test', 'new-user', 'signup')

      const assignment = await tracking.getAssignment('conversion-test', 'new-user')
      expect(assignment).not.toBeNull()
    })

    it('tracks multiple metrics', async () => {
      await tracking.trackConversion('conversion-test', 'user-0', 'signup')
      await tracking.trackConversion('conversion-test', 'user-0', 'revenue', 50)

      const count = await tracking.getConversionCount('conversion-test', 'user-0')
      expect(count).toBe(2)
    })
  })

  describe('getExperimentStats()', () => {
    beforeEach(async () => {
      await tracking.createExperiment({
        id: 'stats-test',
        name: 'Stats Test',
        variants: [
          { key: 'control', name: 'Control', weight: 50, isControl: true },
          { key: 'treatment', name: 'Treatment', weight: 50 },
        ],
        metrics: [
          { id: 'conversion', name: 'Conversion', type: 'conversion', isPrimary: true },
        ],
      })
      await tracking.startExperiment('stats-test')
    })

    it('returns null for non-existent experiment', async () => {
      const stats = await tracking.getExperimentStats('non-existent')
      expect(stats).toBeNull()
    })

    it('returns empty stats for experiment with no data', async () => {
      const stats = await tracking.getExperimentStats('stats-test')

      expect(stats).not.toBeNull()
      expect(stats!.totalSampleSize).toBe(0)
      expect(stats!.recommendation).toBe('need_more_data')
    })

    it('calculates variant statistics', async () => {
      // Assign users
      for (let i = 0; i < 50; i++) {
        await tracking.trackAssignment('stats-test', `user-${i}`)
      }

      // Track some conversions
      for (let i = 0; i < 15; i++) {
        await tracking.trackConversion('stats-test', `user-${i}`, 'conversion')
      }

      const stats = await tracking.getExperimentStats('stats-test')

      expect(stats!.totalSampleSize).toBe(50)
      expect(stats!.totalConversions).toBeGreaterThan(0)
      expect(Object.keys(stats!.variants)).toHaveLength(2)
    })

    it('includes statistical significance', async () => {
      // Create clear difference between control and treatment
      // Simulate: control 10%, treatment 30%
      const users: Array<{ id: string; variant: string }> = []

      for (let i = 0; i < 100; i++) {
        const userId = `user-${i}`
        await tracking.trackAssignment('stats-test', userId)
        const variant = await tracking.getVariant('stats-test', userId)
        users.push({ id: userId, variant: variant! })
      }

      // Simulate conversions based on variant
      for (const user of users) {
        const convertChance = user.variant === 'treatment' ? 0.30 : 0.10
        if (Math.random() < convertChance) {
          await tracking.trackConversion('stats-test', user.id, 'conversion')
        }
      }

      const stats = await tracking.getExperimentStats('stats-test')

      expect(stats!.comparisons).toHaveLength(1)
      expect(stats!.comparisons[0].control).toBe('control')
      expect(stats!.comparisons[0].treatment).toBe('treatment')
      expect(stats!.comparisons[0]).toHaveProperty('pValue')
      expect(stats!.comparisons[0]).toHaveProperty('isSignificant')
      expect(stats!.comparisons[0]).toHaveProperty('probabilityToBeatControl')
    })

    it('provides recommendation based on data', async () => {
      // With minimal data
      await tracking.trackAssignment('stats-test', 'user-1')
      await tracking.trackConversion('stats-test', 'user-1', 'conversion')

      let stats = await tracking.getExperimentStats('stats-test')
      expect(stats!.recommendation).toBe('need_more_data')
      expect(stats!.hasMinimumSample).toBe(false)
    })
  })

  describe('getVariant()', () => {
    beforeEach(async () => {
      await tracking.createExperiment({
        id: 'variant-test',
        name: 'Variant Test',
        variants: [
          { key: 'control', name: 'Control', weight: 50 },
          { key: 'treatment', name: 'Treatment', weight: 50 },
        ],
        metrics: [{ id: 'goal', name: 'Goal' }],
      })
      await tracking.startExperiment('variant-test')
    })

    it('returns consistent variant for same user', async () => {
      const variant1 = await tracking.getVariant('variant-test', 'user-123')
      const variant2 = await tracking.getVariant('variant-test', 'user-123')

      expect(variant1).toBe(variant2)
      expect(['control', 'treatment']).toContain(variant1)
    })

    it('distributes users across variants', async () => {
      const variantCounts: Record<string, number> = { control: 0, treatment: 0 }

      for (let i = 0; i < 1000; i++) {
        const variant = await tracking.getVariant('variant-test', `user-${i}`)
        variantCounts[variant!]++
      }

      // Should be roughly 50/50 (within reasonable variance)
      const controlPct = variantCounts.control / 1000
      expect(controlPct).toBeGreaterThan(0.40)
      expect(controlPct).toBeLessThan(0.60)
    })

    it('returns null for non-running experiment', async () => {
      await tracking.createExperiment({
        id: 'draft-exp',
        name: 'Draft',
        variants: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }],
        metrics: [{ id: 'goal', name: 'Goal' }],
      })
      // Don't start it

      const variant = await tracking.getVariant('draft-exp', 'user-123')
      expect(variant).toBeNull()
    })
  })

  // ===========================================================================
  // MULTI-VARIANT EXPERIMENTS (A/B/C/D+)
  // ===========================================================================

  describe('Multi-Variant Experiments', () => {
    beforeEach(async () => {
      await tracking.createExperiment({
        id: 'abcd-test',
        name: 'ABCD Test',
        variants: [
          { key: 'control', name: 'Control', weight: 25, isControl: true },
          { key: 'variant-a', name: 'Variant A', weight: 25 },
          { key: 'variant-b', name: 'Variant B', weight: 25 },
          { key: 'variant-c', name: 'Variant C', weight: 25 },
        ],
        metrics: [{ id: 'conversion', name: 'Conversion' }],
      })
      await tracking.startExperiment('abcd-test')
    })

    it('distributes users across all variants', async () => {
      const variantCounts: Record<string, number> = {}

      for (let i = 0; i < 1000; i++) {
        const variant = await tracking.getVariant('abcd-test', `user-${i}`)
        variantCounts[variant!] = (variantCounts[variant!] ?? 0) + 1
      }

      // Each variant should have roughly 25%
      expect(Object.keys(variantCounts)).toHaveLength(4)
      for (const count of Object.values(variantCounts)) {
        expect(count).toBeGreaterThan(150) // At least 15%
        expect(count).toBeLessThan(350)    // At most 35%
      }
    })

    it('tracks conversions per variant', async () => {
      // Assign users and track conversions
      for (let i = 0; i < 100; i++) {
        const userId = `user-${i}`
        await tracking.trackAssignment('abcd-test', userId)

        // Random conversion
        if (Math.random() < 0.2) {
          await tracking.trackConversion('abcd-test', userId, 'conversion')
        }
      }

      const stats = await tracking.getExperimentStats('abcd-test')

      expect(Object.keys(stats!.variants)).toHaveLength(4)
      expect(stats!.comparisons.length).toBe(3) // 3 treatments vs 1 control
    })

    it('compares all treatments to control', async () => {
      // Generate data with clear winner (variant-c performs best)
      for (let i = 0; i < 200; i++) {
        const userId = `user-${i}`
        const variant = await tracking.getVariant('abcd-test', userId)

        // Different conversion rates per variant
        let convertChance = 0.1 // control
        if (variant === 'variant-a') convertChance = 0.12
        if (variant === 'variant-b') convertChance = 0.15
        if (variant === 'variant-c') convertChance = 0.25

        if (Math.random() < convertChance) {
          await tracking.trackConversion('abcd-test', userId, 'conversion')
        }
      }

      const stats = await tracking.getExperimentStats('abcd-test')

      // Should have comparison for each treatment
      const comparisons = stats!.comparisons
      expect(comparisons.some(c => c.treatment === 'variant-a')).toBe(true)
      expect(comparisons.some(c => c.treatment === 'variant-b')).toBe(true)
      expect(comparisons.some(c => c.treatment === 'variant-c')).toBe(true)

      // All comparisons should be against control
      for (const comparison of comparisons) {
        expect(comparison.control).toBe('control')
      }
    })
  })

  // ===========================================================================
  // INTEGRATION SCENARIOS
  // ===========================================================================

  describe('Integration Scenarios', () => {
    it('runs complete experiment workflow', async () => {
      // 1. Create experiment
      await tracking.createExperiment({
        id: 'full-workflow',
        name: 'Full Workflow Test',
        description: 'Testing the complete experiment workflow',
        variants: [
          { key: 'control', name: 'Control', weight: 50 },
          { key: 'treatment', name: 'Treatment', weight: 50 },
        ],
        metrics: [
          { id: 'signup', name: 'Sign Up', type: 'conversion', isPrimary: true },
          { id: 'purchase', name: 'Purchase', type: 'revenue' },
        ],
        hypothesis: 'New design will increase signups by 20%',
        owner: 'test@example.com',
      })

      // 2. Start experiment
      await tracking.startExperiment('full-workflow')

      // 3. Simulate user traffic
      const users: Array<{ id: string; variant: string | null }> = []
      for (let i = 0; i < 100; i++) {
        const userId = `user-${i}`
        const variant = await tracking.getVariant('full-workflow', userId)
        users.push({ id: userId, variant })
      }

      // 4. Track conversions (treatment converts better)
      for (const user of users) {
        if (!user.variant) continue

        const signupChance = user.variant === 'treatment' ? 0.25 : 0.15
        if (Math.random() < signupChance) {
          await tracking.trackConversion('full-workflow', user.id, 'signup')

          // Some signups lead to purchases
          if (Math.random() < 0.3) {
            const purchaseValue = 20 + Math.random() * 80
            await tracking.trackConversion('full-workflow', user.id, 'purchase', purchaseValue)
          }
        }
      }

      // 5. Check stats
      const stats = await tracking.getExperimentStats('full-workflow')
      expect(stats!.totalSampleSize).toBe(100)
      expect(stats!.totalConversions).toBeGreaterThan(0)

      // 6. Complete if we have a winner
      if (stats!.winner) {
        const completed = await tracking.completeExperiment('full-workflow', stats!.winner)
        expect(completed.status).toBe('completed')
      }
    })

    it('handles traffic allocation', async () => {
      await tracking.createExperiment({
        id: 'traffic-test',
        name: 'Traffic Allocation Test',
        variants: [
          { key: 'control', name: 'Control' },
          { key: 'treatment', name: 'Treatment' },
        ],
        metrics: [{ id: 'goal', name: 'Goal' }],
        trafficAllocation: 10, // Only 10% of users
      })
      await tracking.startExperiment('traffic-test')

      let inExperiment = 0
      for (let i = 0; i < 1000; i++) {
        const variant = await tracking.getVariant('traffic-test', `user-${i}`)
        if (variant) inExperiment++
      }

      // Should be roughly 10% (with some variance)
      const rate = inExperiment / 1000
      expect(rate).toBeGreaterThan(0.05)
      expect(rate).toBeLessThan(0.20)
    })

    it('supports batch callbacks', async () => {
      const assignmentBatches: any[][] = []
      const conversionBatches: any[][] = []

      const batchTracking = createExperimentTracking({
        batchSize: 10,
        onAssignmentFlush: (assignments) => { assignmentBatches.push(assignments) },
        onConversionFlush: (conversions) => { conversionBatches.push(conversions) },
      })

      try {
        await batchTracking.createExperiment({
          id: 'batch-test',
          name: 'Batch Test',
          variants: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }],
          metrics: [{ id: 'goal', name: 'Goal' }],
        })
        await batchTracking.startExperiment('batch-test')

        // Track enough to trigger flush
        for (let i = 0; i < 15; i++) {
          await batchTracking.trackAssignment('batch-test', `user-${i}`)
        }
        await batchTracking.flush()

        // Track conversions
        for (let i = 0; i < 8; i++) {
          await batchTracking.trackConversion('batch-test', `user-${i}`, 'goal')
        }
        await batchTracking.flush()

        expect(assignmentBatches.length).toBeGreaterThan(0)
      } finally {
        batchTracking.destroy()
      }
    })
  })
})
