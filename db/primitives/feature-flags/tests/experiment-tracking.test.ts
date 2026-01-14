/**
 * A/B Experiment Tracking Tests
 *
 * Comprehensive tests for:
 * - Experiment definition (variants, allocation)
 * - Conversion event tracking
 * - Statistical significance helpers
 * - Experiment results querying
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createExperimentStore,
  type ExperimentStore,
  type ExperimentDefinition,
  type CreateExperimentOptions,
} from '../experiment'
import {
  createExperimentTracker,
  type ExperimentTracker,
  type Assignment,
} from '../experiment-tracker'
import {
  createConversionTracker,
  type ConversionTracker,
  type ConversionEvent,
  type GoalMetrics,
} from '../conversion-tracker'
import {
  zTestProportions,
  chiSquaredTest,
  tTest,
  proportionConfidenceInterval,
  proportionDifferenceCI,
  relativeLiftCI,
  calculateSampleSize,
  calculatePower,
  probabilityToBeat,
  analyzeExperiment,
  estimateDaysToSignificance,
  type SignificanceResult,
  type ConfidenceInterval,
  type ExperimentAnalysis,
} from '../statistics'

describe('A/B Experiment Tracking', () => {
  // ==========================================================================
  // EXPERIMENT DEFINITION
  // ==========================================================================

  describe('Experiment Definition', () => {
    let store: ExperimentStore

    beforeEach(() => {
      store = createExperimentStore()
    })

    describe('createExperimentStore', () => {
      it('creates experiments with basic configuration', async () => {
        const experiment = await store.create({
          id: 'pricing-test',
          name: 'Pricing Page Test',
          variants: [
            { key: 'control', name: 'Original', isControl: true },
            { key: 'variant-a', name: 'New Design' },
          ],
          goals: [
            { id: 'signup', name: 'Sign Up', eventName: 'user_signed_up' },
          ],
        })

        expect(experiment.id).toBe('pricing-test')
        expect(experiment.name).toBe('Pricing Page Test')
        expect(experiment.status).toBe('draft')
        expect(experiment.variants).toHaveLength(2)
        expect(experiment.goals).toHaveLength(1)
      })

      it('assigns equal weights when not specified', async () => {
        const experiment = await store.create({
          id: 'weight-test',
          name: 'Weight Test',
          variants: [
            { key: 'control', name: 'Control' },
            { key: 'variant-a', name: 'Variant A' },
            { key: 'variant-b', name: 'Variant B' },
          ],
          goals: [{ id: 'goal1', name: 'Goal', eventName: 'event' }],
        })

        // Each variant should have ~33.33% weight
        const totalWeight = experiment.variants.reduce((sum, v) => sum + v.weight, 0)
        expect(totalWeight).toBeCloseTo(100, 1)
        expect(experiment.variants[0].weight).toBeCloseTo(33.33, 1)
      })

      it('marks first variant as control if none specified', async () => {
        const experiment = await store.create({
          id: 'control-test',
          name: 'Control Test',
          variants: [
            { key: 'a', name: 'A' },
            { key: 'b', name: 'B' },
          ],
          goals: [{ id: 'goal1', name: 'Goal', eventName: 'event' }],
        })

        expect(experiment.variants[0].isControl).toBe(true)
        expect(experiment.variants[1].isControl).toBe(false)
      })

      it('validates minimum variant count', async () => {
        await expect(
          store.create({
            id: 'single-variant',
            name: 'Single Variant',
            variants: [{ key: 'only', name: 'Only One' }],
            goals: [{ id: 'goal1', name: 'Goal', eventName: 'event' }],
          })
        ).rejects.toThrow('at least 2 variants')
      })

      it('validates goal requirement', async () => {
        await expect(
          store.create({
            id: 'no-goals',
            name: 'No Goals',
            variants: [
              { key: 'a', name: 'A' },
              { key: 'b', name: 'B' },
            ],
            goals: [],
          })
        ).rejects.toThrow('at least 1 goal')
      })

      it('prevents duplicate experiment IDs', async () => {
        await store.create({
          id: 'duplicate-test',
          name: 'First',
          variants: [
            { key: 'a', name: 'A' },
            { key: 'b', name: 'B' },
          ],
          goals: [{ id: 'goal1', name: 'Goal', eventName: 'event' }],
        })

        await expect(
          store.create({
            id: 'duplicate-test',
            name: 'Second',
            variants: [
              { key: 'c', name: 'C' },
              { key: 'd', name: 'D' },
            ],
            goals: [{ id: 'goal2', name: 'Goal', eventName: 'event' }],
          })
        ).rejects.toThrow("already exists")
      })
    })

    describe('Experiment Lifecycle', () => {
      let experimentId: string

      beforeEach(async () => {
        const experiment = await store.create({
          id: 'lifecycle-test',
          name: 'Lifecycle Test',
          variants: [
            { key: 'control', name: 'Control', isControl: true },
            { key: 'treatment', name: 'Treatment' },
          ],
          goals: [{ id: 'conversion', name: 'Conversion', eventName: 'converted' }],
        })
        experimentId = experiment.id
      })

      it('starts experiment', async () => {
        const experiment = await store.start(experimentId)
        expect(experiment.status).toBe('running')
        expect(experiment.startedAt).toBeInstanceOf(Date)
      })

      it('pauses running experiment', async () => {
        await store.start(experimentId)
        const experiment = await store.pause(experimentId)
        expect(experiment.status).toBe('paused')
      })

      it('resumes paused experiment', async () => {
        await store.start(experimentId)
        await store.pause(experimentId)
        const experiment = await store.resume(experimentId)
        expect(experiment.status).toBe('running')
      })

      it('completes experiment with winner', async () => {
        await store.start(experimentId)
        const experiment = await store.complete(experimentId, 'treatment')
        expect(experiment.status).toBe('completed')
        expect(experiment.winner).toBe('treatment')
        expect(experiment.endedAt).toBeInstanceOf(Date)
      })

      it('prevents invalid state transitions', async () => {
        // Cannot start a running experiment
        await store.start(experimentId)
        await expect(store.start(experimentId)).rejects.toThrow()

        // Cannot pause a paused experiment
        await store.pause(experimentId)
        await expect(store.pause(experimentId)).rejects.toThrow()

        // Cannot resume a non-paused experiment
        await store.resume(experimentId)
        await expect(store.resume(experimentId)).rejects.toThrow()
      })
    })

    describe('Variant Allocation', () => {
      it('allocates users to variants consistently', async () => {
        await store.create({
          id: 'allocation-test',
          name: 'Allocation Test',
          variants: [
            { key: 'control', name: 'Control', weight: 50 },
            { key: 'treatment', name: 'Treatment', weight: 50 },
          ],
          goals: [{ id: 'goal', name: 'Goal', eventName: 'event' }],
        })
        await store.start('allocation-test')

        // Same user should always get same variant
        const result1 = await store.allocate('allocation-test', 'user-123')
        const result2 = await store.allocate('allocation-test', 'user-123')

        expect(result1.variant).toBe(result2.variant)
        expect(result1.inExperiment).toBe(true)
      })

      it('respects traffic allocation', async () => {
        await store.create({
          id: 'traffic-test',
          name: 'Traffic Test',
          trafficAllocation: 10, // Only 10% of users
          variants: [
            { key: 'control', name: 'Control', weight: 50 },
            { key: 'treatment', name: 'Treatment', weight: 50 },
          ],
          goals: [{ id: 'goal', name: 'Goal', eventName: 'event' }],
        })
        await store.start('traffic-test')

        // Allocate many users and count how many are in experiment
        let inExperiment = 0
        const totalUsers = 1000
        for (let i = 0; i < totalUsers; i++) {
          const result = await store.allocate('traffic-test', `user-${i}`)
          if (result.inExperiment) inExperiment++
        }

        // Should be approximately 10% (with some variance)
        const rate = inExperiment / totalUsers
        expect(rate).toBeGreaterThan(0.05)
        expect(rate).toBeLessThan(0.20)
      })

      it('returns not_in_experiment for non-running experiments', async () => {
        await store.create({
          id: 'draft-test',
          name: 'Draft Test',
          variants: [
            { key: 'a', name: 'A' },
            { key: 'b', name: 'B' },
          ],
          goals: [{ id: 'goal', name: 'Goal', eventName: 'event' }],
        })

        const result = await store.allocate('draft-test', 'user-123')
        expect(result.inExperiment).toBe(false)
        expect(result.reason).toBe('experiment_not_running')
      })
    })
  })

  // ==========================================================================
  // VARIANT ASSIGNMENT LOGGING
  // ==========================================================================

  describe('Variant Assignment Logging', () => {
    let store: ExperimentStore
    let tracker: ExperimentTracker & { destroy: () => void }

    beforeEach(async () => {
      store = createExperimentStore()
      tracker = createExperimentTracker({ store })

      await store.create({
        id: 'assignment-test',
        name: 'Assignment Test',
        variants: [
          { key: 'control', name: 'Control', weight: 50, isControl: true },
          { key: 'treatment', name: 'Treatment', weight: 50 },
        ],
        goals: [{ id: 'goal', name: 'Goal', eventName: 'event' }],
      })
      await store.start('assignment-test')
    })

    afterEach(() => {
      tracker.destroy()
    })

    it('tracks user assignments', async () => {
      const assignment = await tracker.track('assignment-test', 'user-123')

      expect(assignment).not.toBeNull()
      expect(assignment!.userId).toBe('user-123')
      expect(assignment!.experimentId).toBe('assignment-test')
      expect(['control', 'treatment']).toContain(assignment!.variant)
      expect(assignment!.assignedAt).toBeInstanceOf(Date)
    })

    it('deduplicates assignments by default', async () => {
      const first = await tracker.track('assignment-test', 'user-123')
      const second = await tracker.track('assignment-test', 'user-123')

      expect(first!.id).toBe(second!.id)
      expect(first!.variant).toBe(second!.variant)
    })

    it('supports sticky assignments', async () => {
      const result1 = await tracker.allocateAndTrack('assignment-test', 'user-456')
      const result2 = await tracker.allocateAndTrack('assignment-test', 'user-456')

      expect(result1.variant).toBe(result2.variant)
      expect(result1.assignment?.id).toBe(result2.assignment?.id)
    })

    it('retrieves user assignments', async () => {
      await tracker.track('assignment-test', 'user-789')

      const assignments = await tracker.getUserAssignments('user-789')
      expect(assignments).toHaveLength(1)
      expect(assignments[0].experimentId).toBe('assignment-test')
    })

    it('provides assignment summary', async () => {
      // Track multiple users
      for (let i = 0; i < 100; i++) {
        await tracker.track('assignment-test', `user-${i}`)
      }

      const summary = await tracker.getSummary('assignment-test')
      expect(summary.totalAssignments).toBe(100)
      expect(summary.uniqueUsers).toBe(100)
      expect(Object.keys(summary.variantCounts)).toHaveLength(2)
    })

    it('includes context in assignments', async () => {
      const assignment = await tracker.track('assignment-test', 'user-context', {
        context: {
          ip: '192.168.1.1',
          userAgent: 'Test Browser',
          country: 'US',
          deviceType: 'desktop',
        },
      })

      expect(assignment!.context?.ip).toBe('192.168.1.1')
      expect(assignment!.context?.country).toBe('US')
    })

    it('clears assignments for testing', async () => {
      await tracker.track('assignment-test', 'user-clear')
      await tracker.clearAssignment('assignment-test', 'user-clear')

      const assignment = await tracker.getAssignment('assignment-test', 'user-clear')
      expect(assignment).toBeNull()
    })
  })

  // ==========================================================================
  // CONVERSION EVENT TRACKING
  // ==========================================================================

  describe('Conversion Event Tracking', () => {
    let store: ExperimentStore
    let tracker: ExperimentTracker & { destroy: () => void }
    let conversions: ConversionTracker & { destroy: () => void }

    beforeEach(async () => {
      store = createExperimentStore()
      tracker = createExperimentTracker({ store })

      await store.create({
        id: 'conversion-test',
        name: 'Conversion Test',
        variants: [
          { key: 'control', name: 'Control', weight: 50, isControl: true },
          { key: 'treatment', name: 'Treatment', weight: 50 },
        ],
        goals: [
          { id: 'signup', name: 'Sign Up', eventName: 'user_signed_up', isPrimary: true },
          { id: 'purchase', name: 'Purchase', eventName: 'purchase_completed', type: 'revenue', valueProperty: 'amount' },
        ],
      })
      await store.start('conversion-test')

      conversions = createConversionTracker({
        tracker,
        goals: new Map([
          ['conversion-test', [
            { id: 'signup', name: 'Sign Up', eventName: 'user_signed_up', type: 'conversion', aggregation: 'count', isPrimary: true },
            { id: 'purchase', name: 'Purchase', eventName: 'purchase_completed', type: 'revenue', aggregation: 'sum', valueProperty: 'amount' },
          ]],
        ]),
      })

      // Assign users first
      await tracker.track('conversion-test', 'user-1')
      await tracker.track('conversion-test', 'user-2')
      await tracker.track('conversion-test', 'user-3')
    })

    afterEach(() => {
      tracker.destroy()
      conversions.destroy()
    })

    it('tracks conversion events', async () => {
      const event = await conversions.track('conversion-test', 'signup', 'user-1')

      expect(event).not.toBeNull()
      expect(event!.goalId).toBe('signup')
      expect(event!.userId).toBe('user-1')
      expect(event!.timestamp).toBeInstanceOf(Date)
    })

    it('tracks revenue values', async () => {
      const event = await conversions.track('conversion-test', 'purchase', 'user-1', {
        value: 99.99,
      })

      expect(event!.value).toBe(99.99)
    })

    it('tracks by event name', async () => {
      const events = await conversions.trackEvent('user_signed_up', 'user-2')

      expect(events).toHaveLength(1)
      expect(events[0].goalId).toBe('signup')
    })

    it('deduplicates conversions with key', async () => {
      const first = await conversions.track('conversion-test', 'purchase', 'user-1', {
        value: 100,
        deduplicationKey: 'order-123',
      })
      const second = await conversions.track('conversion-test', 'purchase', 'user-1', {
        value: 100,
        deduplicationKey: 'order-123',
      })

      expect(first).not.toBeNull()
      expect(second).toBeNull() // Deduplicated
    })

    it('returns null for non-assigned users', async () => {
      const event = await conversions.track('conversion-test', 'signup', 'user-not-assigned')
      expect(event).toBeNull()
    })

    it('queries conversions with filters', async () => {
      await conversions.track('conversion-test', 'signup', 'user-1')
      await conversions.track('conversion-test', 'signup', 'user-2')
      await conversions.track('conversion-test', 'purchase', 'user-1', { value: 50 })

      const signups = await conversions.getConversions({
        experimentId: 'conversion-test',
        goalId: 'signup',
      })

      expect(signups).toHaveLength(2)
    })

    it('calculates goal metrics', async () => {
      // Track conversions
      await conversions.track('conversion-test', 'signup', 'user-1')
      await conversions.track('conversion-test', 'signup', 'user-2')

      const metrics = await conversions.getGoalMetrics('conversion-test', 'signup')

      expect(metrics).not.toBeNull()
      expect(metrics!.totalConversions).toBe(2)
      expect(metrics!.totalSampleSize).toBe(3) // 3 users assigned
    })

    it('checks if user has converted', async () => {
      await conversions.track('conversion-test', 'signup', 'user-1')

      const hasConverted = await conversions.hasConverted('conversion-test', 'signup', 'user-1')
      const hasNotConverted = await conversions.hasConverted('conversion-test', 'signup', 'user-3')

      expect(hasConverted).toBe(true)
      expect(hasNotConverted).toBe(false)
    })
  })

  // ==========================================================================
  // STATISTICAL SIGNIFICANCE HELPERS
  // ==========================================================================

  describe('Statistical Significance Helpers', () => {
    describe('Z-Test for Proportions', () => {
      it('detects significant difference', () => {
        // Control: 100/1000 = 10% conversion
        // Treatment: 150/1000 = 15% conversion
        const result = zTestProportions(1000, 150, 1000, 100)

        expect(result.isSignificant).toBe(true)
        expect(result.pValue).toBeLessThan(0.05)
        expect(result.testType).toBe('z-test')
      })

      it('detects non-significant difference', () => {
        // Control: 100/1000 = 10% conversion
        // Treatment: 102/1000 = 10.2% conversion
        const result = zTestProportions(1000, 102, 1000, 100)

        expect(result.isSignificant).toBe(false)
        expect(result.pValue).toBeGreaterThan(0.05)
      })

      it('calculates effect size', () => {
        const result = zTestProportions(1000, 200, 1000, 100)

        expect(result.effectSize).toBeDefined()
        expect(result.effectSizeInterpretation).toBeDefined()
      })
    })

    describe('Chi-Squared Test', () => {
      it('tests independence of variants and outcomes', () => {
        // Observed counts: [control_no_convert, control_convert], [treatment_no_convert, treatment_convert]
        const observed = [
          [900, 100],  // Control: 10% conversion
          [850, 150],  // Treatment: 15% conversion
        ]

        const result = chiSquaredTest(observed)

        expect(result.testType).toBe('chi-squared')
        expect(result.degreesOfFreedom).toBe(1)
        expect(result.isSignificant).toBe(true)
      })
    })

    describe('T-Test', () => {
      it('compares means of two groups', () => {
        // Control values (lower mean)
        const control = Array.from({ length: 100 }, () => 10 + Math.random() * 5)
        // Treatment values (higher mean)
        const treatment = Array.from({ length: 100 }, () => 15 + Math.random() * 5)

        const result = tTest(treatment, control)

        expect(result.testType).toBe('t-test')
        expect(result.isSignificant).toBe(true)
      })

      it('handles small samples', () => {
        const result = tTest([1], [2])

        expect(result.isSignificant).toBe(false)
        expect(result.pValue).toBe(1)
      })
    })

    describe('Confidence Intervals', () => {
      it('calculates proportion confidence interval', () => {
        const ci = proportionConfidenceInterval(1000, 100, 0.95)

        expect(ci.estimate).toBe(0.1)
        expect(ci.lower).toBeLessThan(0.1)
        expect(ci.upper).toBeGreaterThan(0.1)
        expect(ci.confidenceLevel).toBe(0.95)
      })

      it('calculates difference confidence interval', () => {
        const ci = proportionDifferenceCI(1000, 150, 1000, 100, 0.95)

        expect(ci.estimate).toBeCloseTo(0.05, 5) // 15% - 10%
        expect(ci.lower).toBeLessThan(0.05)
        expect(ci.upper).toBeGreaterThan(0.05)
      })

      it('calculates relative lift confidence interval', () => {
        const ci = relativeLiftCI(1000, 150, 1000, 100, 0.95)

        expect(ci.estimate).toBeCloseTo(0.5, 1) // 50% lift
      })
    })

    describe('Sample Size Calculation', () => {
      it('calculates required sample size', () => {
        const result = calculateSampleSize(
          0.1,    // 10% baseline
          0.1,    // 10% MDE (relative)
          0.05,   // alpha
          0.8     // power
        )

        expect(result.sampleSizePerVariant).toBeGreaterThan(0)
        expect(result.totalSampleSize).toBe(result.sampleSizePerVariant * 2)
        expect(result.power).toBe(0.8)
        expect(result.alpha).toBe(0.05)
      })

      it('larger MDE requires smaller sample', () => {
        const small = calculateSampleSize(0.1, 0.05) // 5% MDE
        const large = calculateSampleSize(0.1, 0.2)  // 20% MDE

        expect(large.sampleSizePerVariant).toBeLessThan(small.sampleSizePerVariant)
      })
    })

    describe('Power Analysis', () => {
      it('calculates statistical power', () => {
        const power = calculatePower(
          1000,  // n1
          1000,  // n2
          0.1,   // p1 (10%)
          0.15,  // p2 (15%)
          0.05   // alpha
        )

        expect(power).toBeGreaterThan(0)
        expect(power).toBeLessThanOrEqual(1)
      })

      it('more samples increases power', () => {
        const powerSmall = calculatePower(100, 100, 0.1, 0.15)
        const powerLarge = calculatePower(1000, 1000, 0.1, 0.15)

        expect(powerLarge).toBeGreaterThan(powerSmall)
      })
    })

    describe('Bayesian Probability', () => {
      it('calculates probability to beat control', () => {
        // Treatment clearly better
        const prob = probabilityToBeat(
          100,   // control conversions
          1000,  // control sample
          150,   // treatment conversions
          1000,  // treatment sample
          [1, 1] // uniform prior
        )

        expect(prob).toBeGreaterThan(0.9)
      })

      it('returns ~50% for equivalent results', () => {
        const prob = probabilityToBeat(
          100,   // control conversions
          1000,  // control sample
          100,   // treatment conversions
          1000,  // treatment sample
        )

        expect(prob).toBeGreaterThan(0.4)
        expect(prob).toBeLessThan(0.6)
      })
    })
  })

  // ==========================================================================
  // EXPERIMENT RESULTS QUERYING
  // ==========================================================================

  describe('Experiment Results Querying', () => {
    describe('analyzeExperiment', () => {
      it('analyzes experiment with significant winner', () => {
        const metrics: GoalMetrics = {
          experimentId: 'test-exp',
          goalId: 'conversion',
          goalName: 'Conversion',
          totalSampleSize: 2000,
          totalConversions: 250,
          overallConversionRate: 0.125,
          controlVariant: 'control',
          variants: {
            control: {
              variant: 'control',
              sampleSize: 1000,
              conversions: 100,
              conversionRate: 0.1,
              totalValue: 100,
              meanValue: 1,
              meanValuePerUser: 0.1,
              values: [],
              standardDeviation: 0,
              medianValue: 1,
              p95Value: 1,
            },
            treatment: {
              variant: 'treatment',
              sampleSize: 1000,
              conversions: 150,
              conversionRate: 0.15,
              totalValue: 150,
              meanValue: 1,
              meanValuePerUser: 0.15,
              values: [],
              standardDeviation: 0,
              medianValue: 1,
              p95Value: 1,
            },
          },
        }

        const analysis = analyzeExperiment(metrics)

        expect(analysis.experimentId).toBe('test-exp')
        expect(analysis.hasMinimumSample).toBe(true)
        expect(analysis.bestVariant).toBe('treatment')
        expect(analysis.overallRecommendation).toBe('significant_winner')
        expect(analysis.comparisons).toHaveLength(1)
        expect(analysis.comparisons[0].significance.isSignificant).toBe(true)
      })

      it('recommends more data when sample is small', () => {
        const metrics: GoalMetrics = {
          experimentId: 'small-exp',
          goalId: 'conversion',
          goalName: 'Conversion',
          totalSampleSize: 40,
          totalConversions: 6,
          overallConversionRate: 0.15,
          controlVariant: 'control',
          variants: {
            control: {
              variant: 'control',
              sampleSize: 20,
              conversions: 2,
              conversionRate: 0.1,
              totalValue: 2,
              meanValue: 1,
              meanValuePerUser: 0.1,
              values: [],
              standardDeviation: 0,
              medianValue: 1,
              p95Value: 1,
            },
            treatment: {
              variant: 'treatment',
              sampleSize: 20,
              conversions: 4,
              conversionRate: 0.2,
              totalValue: 4,
              meanValue: 1,
              meanValuePerUser: 0.2,
              values: [],
              standardDeviation: 0,
              medianValue: 1,
              p95Value: 1,
            },
          },
        }

        const analysis = analyzeExperiment(metrics)

        expect(analysis.hasMinimumSample).toBe(false)
        expect(analysis.overallRecommendation).toBe('need_more_data')
      })

      it('includes lift calculations', () => {
        const metrics: GoalMetrics = {
          experimentId: 'lift-exp',
          goalId: 'conversion',
          goalName: 'Conversion',
          totalSampleSize: 2000,
          totalConversions: 250,
          overallConversionRate: 0.125,
          controlVariant: 'control',
          variants: {
            control: {
              variant: 'control',
              sampleSize: 1000,
              conversions: 100,
              conversionRate: 0.1,
              totalValue: 100,
              meanValue: 1,
              meanValuePerUser: 0.1,
              values: [],
              standardDeviation: 0,
              medianValue: 1,
              p95Value: 1,
            },
            treatment: {
              variant: 'treatment',
              sampleSize: 1000,
              conversions: 150,
              conversionRate: 0.15,
              totalValue: 150,
              meanValue: 1,
              meanValuePerUser: 0.15,
              values: [],
              standardDeviation: 0,
              medianValue: 1,
              p95Value: 1,
            },
          },
        }

        const analysis = analyzeExperiment(metrics)
        const comparison = analysis.comparisons[0]

        expect(comparison.relativeLift).toBeCloseTo(0.5, 2) // 50% lift
        expect(comparison.absoluteLift).toBeCloseTo(0.05, 2) // 5% absolute
        expect(comparison.liftConfidenceInterval).toBeDefined()
      })
    })

    describe('estimateDaysToSignificance', () => {
      it('estimates days based on traffic', () => {
        const days = estimateDaysToSignificance(
          500,    // current sample
          100,    // daily traffic
          0.1,    // baseline rate
          0.1,    // MDE
          0.05,   // alpha
          0.8     // power
        )

        expect(days).toBeGreaterThan(0)
        expect(days).toBeLessThan(Infinity)
      })

      it('returns low estimate when large sample exists', () => {
        const days = estimateDaysToSignificance(
          100000, // large current sample
          10000,  // high daily traffic
          0.1,    // baseline rate
          0.05,   // lower MDE to make sample more sufficient
        )

        // Should return low estimate (close to 0) for already-sufficient samples
        expect(days).toBeLessThanOrEqual(50)
      })
    })
  })

  // ==========================================================================
  // INTEGRATION TESTS
  // ==========================================================================

  describe('End-to-End Integration', () => {
    let store: ExperimentStore
    let tracker: ExperimentTracker & { destroy: () => void }
    let conversions: ConversionTracker & { destroy: () => void }

    beforeEach(async () => {
      store = createExperimentStore()
      tracker = createExperimentTracker({ store })

      await store.create({
        id: 'e2e-test',
        name: 'E2E Test',
        variants: [
          { key: 'control', name: 'Control', weight: 50, isControl: true },
          { key: 'treatment', name: 'Treatment', weight: 50 },
        ],
        goals: [
          { id: 'signup', name: 'Sign Up', eventName: 'signup', isPrimary: true },
        ],
        minSampleSize: 10,
        significanceThreshold: 0.95,
      })
      await store.start('e2e-test')

      conversions = createConversionTracker({
        tracker,
        goals: new Map([
          ['e2e-test', [
            { id: 'signup', name: 'Sign Up', eventName: 'signup', type: 'conversion', aggregation: 'count', isPrimary: true },
          ]],
        ]),
      })
    })

    afterEach(() => {
      tracker.destroy()
      conversions.destroy()
    })

    it('runs complete experiment workflow', async () => {
      // 1. Allocate users to variants
      const users = Array.from({ length: 100 }, (_, i) => `user-${i}`)
      const assignments: Assignment[] = []

      for (const userId of users) {
        const result = await tracker.allocateAndTrack('e2e-test', userId)
        if (result.assignment) {
          assignments.push(result.assignment)
        }
      }

      expect(assignments.length).toBe(100)

      // 2. Simulate conversions (treatment converts better)
      for (const assignment of assignments) {
        const convertChance = assignment.variant === 'treatment' ? 0.15 : 0.10
        if (Math.random() < convertChance) {
          await conversions.track('e2e-test', 'signup', assignment.userId)
        }
      }

      // 3. Get experiment metrics
      const metrics = await conversions.getGoalMetrics('e2e-test', 'signup')
      expect(metrics).not.toBeNull()
      expect(metrics!.totalSampleSize).toBe(100)

      // 4. Analyze results
      const analysis = analyzeExperiment(metrics!, { minSampleSize: 10 })
      expect(analysis.hasMinimumSample).toBe(true)
      expect(analysis.comparisons.length).toBeGreaterThan(0)

      // 5. Complete experiment if we have a winner
      if (analysis.bestVariant) {
        const completed = await store.complete('e2e-test', analysis.bestVariant)
        expect(completed.status).toBe('completed')
      }
    })

    it('handles batch callbacks', async () => {
      const assignmentBatches: any[][] = []
      const conversionBatches: any[][] = []

      const batchTracker = createExperimentTracker({
        store,
        batchSize: 10,
        onBatchFlush: (entries) => { assignmentBatches.push(entries) },
      })

      const batchConversions = createConversionTracker({
        tracker: batchTracker,
        batchSize: 5,
        onBatchFlush: (events) => { conversionBatches.push(events) },
        goals: new Map([
          ['e2e-test', [
            { id: 'signup', name: 'Sign Up', eventName: 'signup', type: 'conversion', aggregation: 'count' },
          ]],
        ]),
      })

      try {
        // Track enough to trigger batch flush
        for (let i = 0; i < 15; i++) {
          await batchTracker.track('e2e-test', `batch-user-${i}`)
        }
        await batchTracker.flush()

        // Track conversions
        for (let i = 0; i < 8; i++) {
          await batchConversions.track('e2e-test', 'signup', `batch-user-${i}`)
        }
        await batchConversions.flush()

        expect(assignmentBatches.length).toBeGreaterThan(0)
        expect(conversionBatches.length).toBeGreaterThan(0)
      } finally {
        batchTracker.destroy()
        batchConversions.destroy()
      }
    })
  })
})
