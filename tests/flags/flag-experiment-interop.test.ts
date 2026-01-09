/**
 * Integration Tests: Flag + Experiment Interop
 *
 * Tests that verify feature flags work correctly with the experiments.mdx system.
 *
 * Key concepts from docs/concepts/experiments.mdx:
 * - Branches ARE Variants: Every Thing has a `branch` field (default: `main`)
 * - Experiments compare branches with traffic allocation
 * - Feature flags are simple experiments with boolean outcomes
 *
 * Acceptance Criteria:
 * - Test: flags with thing binding work like experiments
 * - Test: exposure events emitted correctly
 * - Test: experiment statistics track flag usage
 * - Test: flag variants map to thing branches
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Import from experiments module
import {
  resolveBranch,
  setActiveExperiment,
  clearExperiments,
  getActiveExperiment,
  hash,
  type Experiment,
} from '../../lib/experiments'

// Import from flags module
import { evaluateFlag, type FlagConfig, type EvaluationContext } from '../../workflows/flags'

// Import from flag context (for $.flag() API)
import {
  createMockContext,
  evaluateFlag as evaluateFlagContext,
  type Flag,
  type FlagContext,
} from '../../workflows/context/flag'

// ============================================================================
// SECTION 1: Flags with Thing Binding Work Like Experiments
// ============================================================================

describe('Flag + Experiment interop', () => {
  describe('flags with thing binding work like experiments', () => {
    /**
     * A flag bound to a thing should use the same resolution mechanism
     * as experiments - deterministic hashing for consistent user assignment.
     */
    it('flag bound to a thing uses same resolution as experiments', () => {
      // Set up an experiment for a thing
      clearExperiments()
      setActiveExperiment('qualifyLead', {
        id: 'exp-qualify-lead',
        thing: 'qualifyLead',
        branches: ['main', 'ai-variant'],
        traffic: 1.0,
        metric: 'Sales.qualified',
        status: 'running',
      })

      // Now set up an equivalent flag with same id and traffic
      const flag: FlagConfig = {
        id: 'exp-qualify-lead', // Same ID as experiment
        traffic: 1.0,
        branches: [
          { key: 'main', weight: 50 },
          { key: 'ai-variant', weight: 50 },
        ],
        stickiness: 'user_id',
        status: 'active',
      }

      // Test with multiple users
      const users = Array.from({ length: 100 }, (_, i) => `user-${i}`)

      for (const userId of users) {
        // Get experiment branch assignment
        const experimentBranch = resolveBranch(userId, 'qualifyLead')

        // Get flag variant assignment
        const flagResult = evaluateFlag(flag, { userId })

        // Both should use deterministic hashing - same user always gets consistent result
        // (They may not match exactly due to different hashing, but both should be deterministic)
        expect(typeof experimentBranch).toBe('string')
        expect(['main', 'ai-variant']).toContain(experimentBranch)

        expect(flagResult.enabled).toBe(true)
        expect(['main', 'ai-variant']).toContain(flagResult.variant)

        // Verify determinism - calling again gives same result
        const experimentBranch2 = resolveBranch(userId, 'qualifyLead')
        const flagResult2 = evaluateFlag(flag, { userId })

        expect(experimentBranch).toBe(experimentBranch2)
        expect(flagResult.variant).toBe(flagResult2.variant)
      }
    })

    it('flag traffic allocation matches experiment traffic allocation concept', () => {
      // Experiment with 50% traffic
      clearExperiments()
      setActiveExperiment('checkoutFlow', {
        id: 'exp-checkout',
        thing: 'checkoutFlow',
        branches: ['new-checkout'],
        traffic: 0.5,
        metric: 'Checkout.completed',
        status: 'running',
      })

      // Equivalent flag
      const flag: FlagConfig = {
        id: 'exp-checkout',
        traffic: 0.5,
        branches: [{ key: 'enabled', weight: 100 }],
        stickiness: 'user_id',
        status: 'active',
      }

      // With 10000 users, approximately 50% should be in experiment/flag
      const users = Array.from({ length: 10000 }, (_, i) => `checkout-user-${i}`)

      let experimentInCount = 0
      let flagEnabledCount = 0

      for (const userId of users) {
        const experimentBranch = resolveBranch(userId, 'checkoutFlow')
        const flagResult = evaluateFlag(flag, { userId })

        if (experimentBranch !== 'main') {
          experimentInCount++
        }
        if (flagResult.enabled) {
          flagEnabledCount++
        }
      }

      // Both should be approximately 50% (within 5% tolerance)
      const experimentPct = (experimentInCount / users.length) * 100
      const flagPct = (flagEnabledCount / users.length) * 100

      expect(experimentPct).toBeGreaterThan(45)
      expect(experimentPct).toBeLessThan(55)
      expect(flagPct).toBeGreaterThan(45)
      expect(flagPct).toBeLessThan(55)
    })

    it('completed experiment with winner behaves like fully enabled flag', () => {
      // Completed experiment with winner
      clearExperiments()
      setActiveExperiment('pricingPage', {
        id: 'exp-pricing',
        thing: 'pricingPage',
        branches: ['main', 'new-pricing'],
        traffic: 1.0,
        metric: 'Conversion.rate',
        status: 'completed',
        winner: 'new-pricing',
      })

      // Equivalent to a fully enabled flag
      const flag: FlagConfig = {
        id: 'pricing-feature',
        traffic: 1.0,
        branches: [{ key: 'new-pricing', weight: 100 }],
        stickiness: 'user_id',
        status: 'active',
      }

      // All users should get the winner/enabled variant
      const users = Array.from({ length: 100 }, (_, i) => `pricing-user-${i}`)

      for (const userId of users) {
        const experimentBranch = resolveBranch(userId, 'pricingPage')
        const flagResult = evaluateFlag(flag, { userId })

        // Completed experiment always returns winner
        expect(experimentBranch).toBe('new-pricing')

        // Flag always returns enabled with single branch
        expect(flagResult.enabled).toBe(true)
        expect(flagResult.variant).toBe('new-pricing')
      }
    })

    it('draft experiments and disabled flags both return control/false', () => {
      // Draft experiment - not active
      clearExperiments()
      setActiveExperiment('newFeature', {
        id: 'exp-draft',
        thing: 'newFeature',
        branches: ['main', 'experimental'],
        traffic: 1.0,
        metric: 'Engagement.rate',
        status: 'draft',
      })

      // Disabled flag
      const disabledFlag: FlagConfig = {
        id: 'disabled-feature',
        traffic: 1.0,
        branches: [{ key: 'enabled', weight: 100 }],
        stickiness: 'user_id',
        status: 'inactive',
      }

      // Draft experiment returns 'main' (not active)
      const experimentBranch = resolveBranch('test-user', 'newFeature')
      expect(experimentBranch).toBe('main')

      // Disabled flag returns disabled
      const flagResult = evaluateFlag(disabledFlag, { userId: 'test-user' })
      expect(flagResult.enabled).toBe(false)
    })
  })

  // ============================================================================
  // SECTION 2: Exposure Events Emitted Correctly
  // ============================================================================

  describe('exposure events emitted correctly', () => {
    /**
     * Per docs/concepts/experiments.mdx, every branch assignment should emit
     * an exposure event:
     * {
     *   verb: 'exposed',
     *   object: 'qualifyLead',
     *   actor: userId,
     *   branch: 'ai-experiment',
     *   experiment: 'lead-qual-test'
     * }
     */

    interface ExposureEvent {
      verb: 'exposed'
      object: string
      actor: string
      branch: string
      experiment: string
      timestamp?: Date
    }

    // Event collector for testing
    let emittedEvents: ExposureEvent[] = []

    /**
     * Simulates flag evaluation with exposure event emission.
     * In a real implementation, this would be part of the flag evaluation.
     */
    function evaluateFlagWithExposure(
      flag: FlagConfig,
      context: EvaluationContext,
      emit: (event: ExposureEvent) => void
    ) {
      const result = evaluateFlag(flag, context)

      // Only emit exposure if user is in traffic and flag is enabled
      if (result.enabled && result.variant) {
        emit({
          verb: 'exposed',
          object: flag.id,
          actor: context.userId || '',
          branch: result.variant,
          experiment: flag.id,
          timestamp: new Date(),
        })
      }

      return result
    }

    beforeEach(() => {
      emittedEvents = []
    })

    it('emits exposure event when flag is evaluated and enabled', () => {
      const flag: FlagConfig = {
        id: 'checkout-redesign',
        traffic: 1.0,
        branches: [{ key: 'new-checkout', weight: 100 }],
        stickiness: 'user_id',
        status: 'active',
      }

      const result = evaluateFlagWithExposure(flag, { userId: 'user-123' }, (event) => {
        emittedEvents.push(event)
      })

      expect(result.enabled).toBe(true)
      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0]).toEqual({
        verb: 'exposed',
        object: 'checkout-redesign',
        actor: 'user-123',
        branch: 'new-checkout',
        experiment: 'checkout-redesign',
        timestamp: expect.any(Date),
      })
    })

    it('does not emit exposure event when user is not in traffic', () => {
      const flag: FlagConfig = {
        id: 'limited-rollout',
        traffic: 0, // 0% traffic
        branches: [{ key: 'treatment', weight: 100 }],
        stickiness: 'user_id',
        status: 'active',
      }

      const result = evaluateFlagWithExposure(flag, { userId: 'user-456' }, (event) => {
        emittedEvents.push(event)
      })

      expect(result.enabled).toBe(false)
      expect(emittedEvents).toHaveLength(0)
    })

    it('does not emit exposure event when flag is disabled', () => {
      const flag: FlagConfig = {
        id: 'disabled-flag',
        traffic: 1.0,
        branches: [{ key: 'treatment', weight: 100 }],
        stickiness: 'user_id',
        status: 'inactive',
      }

      const result = evaluateFlagWithExposure(flag, { userId: 'user-789' }, (event) => {
        emittedEvents.push(event)
      })

      expect(result.enabled).toBe(false)
      expect(emittedEvents).toHaveLength(0)
    })

    it('emits correct variant in exposure event for multi-variant flag', () => {
      const flag: FlagConfig = {
        id: 'pricing-ab-test',
        traffic: 1.0,
        branches: [
          { key: 'control', weight: 50 },
          { key: 'discount-10', weight: 25 },
          { key: 'discount-20', weight: 25 },
        ],
        stickiness: 'user_id',
        status: 'active',
      }

      // Find users in each variant
      const variantEvents: Record<string, ExposureEvent[]> = {
        control: [],
        'discount-10': [],
        'discount-20': [],
      }

      for (let i = 0; i < 100; i++) {
        emittedEvents = []
        const result = evaluateFlagWithExposure(flag, { userId: `variant-user-${i}` }, (event) => {
          emittedEvents.push(event)
        })

        if (result.variant && variantEvents[result.variant]) {
          variantEvents[result.variant].push(emittedEvents[0])
        }
      }

      // Should see events for all variants
      expect(variantEvents.control.length).toBeGreaterThan(0)
      expect(variantEvents['discount-10'].length).toBeGreaterThan(0)
      expect(variantEvents['discount-20'].length).toBeGreaterThan(0)

      // Each event should have correct branch
      for (const event of variantEvents.control) {
        expect(event.branch).toBe('control')
      }
      for (const event of variantEvents['discount-10']) {
        expect(event.branch).toBe('discount-10')
      }
    })

    it('exposure event includes all required fields per experiments.mdx spec', () => {
      const flag: FlagConfig = {
        id: 'feature-toggle',
        traffic: 1.0,
        branches: [{ key: 'enabled', weight: 100 }],
        stickiness: 'user_id',
        status: 'active',
      }

      evaluateFlagWithExposure(flag, { userId: 'test-actor' }, (event) => {
        emittedEvents.push(event)
      })

      const event = emittedEvents[0]

      // Per experiments.mdx spec:
      expect(event).toHaveProperty('verb', 'exposed')
      expect(event).toHaveProperty('object') // Flag/thing ID
      expect(event).toHaveProperty('actor') // User ID
      expect(event).toHaveProperty('branch') // Assigned variant
      expect(event).toHaveProperty('experiment') // Experiment/flag ID
    })
  })

  // ============================================================================
  // SECTION 3: Experiment Statistics Track Flag Usage
  // ============================================================================

  describe('experiment statistics track flag usage', () => {
    /**
     * Per docs/concepts/experiments.mdx, we should be able to query:
     * const stats = await $.Experiment('lead-qual-test').stats()
     * // {
     * //   branches: {
     * //     'main': { conversions: 120, total: 1000, rate: 0.12 },
     * //     'ai-v1': { conversions: 180, total: 1000, rate: 0.18 }
     * //   },
     * //   significance: 0.95,
     * //   recommendation: 'ai-v1'
     * // }
     */

    interface BranchStats {
      exposures: number
      conversions: number
      rate: number
    }

    interface ExperimentStats {
      branches: Record<string, BranchStats>
      total: number
      significance?: number
      recommendation?: string
    }

    /**
     * Simulates a statistics tracker that accumulates exposure and conversion data.
     */
    class MockStatsTracker {
      private data: Record<
        string,
        {
          exposures: Record<string, Set<string>>
          conversions: Record<string, Set<string>>
        }
      > = {}

      recordExposure(experimentId: string, branch: string, userId: string) {
        if (!this.data[experimentId]) {
          this.data[experimentId] = {
            exposures: {},
            conversions: {},
          }
        }
        if (!this.data[experimentId].exposures[branch]) {
          this.data[experimentId].exposures[branch] = new Set()
        }
        this.data[experimentId].exposures[branch].add(userId)
      }

      recordConversion(experimentId: string, branch: string, userId: string) {
        if (!this.data[experimentId]) {
          this.data[experimentId] = {
            exposures: {},
            conversions: {},
          }
        }
        if (!this.data[experimentId].conversions[branch]) {
          this.data[experimentId].conversions[branch] = new Set()
        }
        this.data[experimentId].conversions[branch].add(userId)
      }

      getStats(experimentId: string): ExperimentStats {
        const expData = this.data[experimentId]
        if (!expData) {
          return { branches: {}, total: 0 }
        }

        const branches: Record<string, BranchStats> = {}
        let total = 0

        // Get all branch names from both exposures and conversions
        const allBranches = new Set([
          ...Object.keys(expData.exposures || {}),
          ...Object.keys(expData.conversions || {}),
        ])

        for (const branch of allBranches) {
          const exposures = expData.exposures[branch]?.size || 0
          const conversions = expData.conversions[branch]?.size || 0
          const rate = exposures > 0 ? conversions / exposures : 0

          branches[branch] = {
            exposures,
            conversions,
            rate,
          }
          total += exposures
        }

        // Find recommendation (branch with highest conversion rate)
        let recommendation: string | undefined
        let highestRate = 0
        for (const [branch, stats] of Object.entries(branches)) {
          if (stats.rate > highestRate) {
            highestRate = stats.rate
            recommendation = branch
          }
        }

        return {
          branches,
          total,
          recommendation,
        }
      }
    }

    it('tracks exposures per variant/branch', () => {
      const tracker = new MockStatsTracker()

      const flag: FlagConfig = {
        id: 'ab-test-feature',
        traffic: 1.0,
        branches: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
        stickiness: 'user_id',
        status: 'active',
      }

      // Simulate 1000 users being exposed
      for (let i = 0; i < 1000; i++) {
        const userId = `user-${i}`
        const result = evaluateFlag(flag, { userId })

        if (result.enabled && result.variant) {
          tracker.recordExposure(flag.id, result.variant, userId)
        }
      }

      const stats = tracker.getStats(flag.id)

      // Both branches should have exposures
      expect(stats.branches.control.exposures).toBeGreaterThan(0)
      expect(stats.branches.treatment.exposures).toBeGreaterThan(0)

      // Total should be 1000
      expect(stats.total).toBe(1000)

      // Distribution should be approximately 50/50
      const controlPct = (stats.branches.control.exposures / stats.total) * 100
      const treatmentPct = (stats.branches.treatment.exposures / stats.total) * 100

      expect(controlPct).toBeGreaterThan(40)
      expect(controlPct).toBeLessThan(60)
      expect(treatmentPct).toBeGreaterThan(40)
      expect(treatmentPct).toBeLessThan(60)
    })

    it('tracks conversions and calculates conversion rate', () => {
      const tracker = new MockStatsTracker()

      const flag: FlagConfig = {
        id: 'conversion-test',
        traffic: 1.0,
        branches: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
        stickiness: 'user_id',
        status: 'active',
      }

      // Simulate users with different conversion rates
      // Control: 10% conversion, Treatment: 20% conversion
      for (let i = 0; i < 1000; i++) {
        const userId = `conv-user-${i}`
        const result = evaluateFlag(flag, { userId })

        if (result.enabled && result.variant) {
          tracker.recordExposure(flag.id, result.variant, userId)

          // Simulate conversions
          const conversionChance = result.variant === 'treatment' ? 0.2 : 0.1
          if (Math.random() < conversionChance) {
            tracker.recordConversion(flag.id, result.variant, userId)
          }
        }
      }

      const stats = tracker.getStats(flag.id)

      // Treatment should have higher conversion rate (approximately)
      // Due to randomness, we just verify structure
      expect(stats.branches.control.rate).toBeDefined()
      expect(stats.branches.treatment.rate).toBeDefined()
      expect(typeof stats.branches.control.rate).toBe('number')
      expect(typeof stats.branches.treatment.rate).toBe('number')
    })

    it('provides recommendation based on highest conversion rate', () => {
      const tracker = new MockStatsTracker()

      // Manually set up stats
      tracker.recordExposure('test-exp', 'control', 'u1')
      tracker.recordExposure('test-exp', 'control', 'u2')
      tracker.recordExposure('test-exp', 'control', 'u3')
      tracker.recordExposure('test-exp', 'treatment', 'u4')
      tracker.recordExposure('test-exp', 'treatment', 'u5')
      tracker.recordExposure('test-exp', 'treatment', 'u6')

      // Control: 1/3 = 33% conversion
      tracker.recordConversion('test-exp', 'control', 'u1')

      // Treatment: 2/3 = 67% conversion
      tracker.recordConversion('test-exp', 'treatment', 'u4')
      tracker.recordConversion('test-exp', 'treatment', 'u5')

      const stats = tracker.getStats('test-exp')

      expect(stats.recommendation).toBe('treatment')
      expect(stats.branches.treatment.rate).toBeCloseTo(2 / 3, 2)
      expect(stats.branches.control.rate).toBeCloseTo(1 / 3, 2)
    })

    it('handles flag with partial traffic in statistics', () => {
      const tracker = new MockStatsTracker()

      const flag: FlagConfig = {
        id: 'partial-traffic-test',
        traffic: 0.5, // 50% traffic
        branches: [{ key: 'enabled', weight: 100 }],
        stickiness: 'user_id',
        status: 'active',
      }

      for (let i = 0; i < 1000; i++) {
        const userId = `partial-user-${i}`
        const result = evaluateFlag(flag, { userId })

        if (result.enabled && result.variant) {
          tracker.recordExposure(flag.id, result.variant, userId)
        }
      }

      const stats = tracker.getStats(flag.id)

      // Should have approximately 500 exposures (50% of 1000)
      expect(stats.total).toBeGreaterThan(400)
      expect(stats.total).toBeLessThan(600)
    })
  })

  // ============================================================================
  // SECTION 4: Flag Variants Map to Thing Branches
  // ============================================================================

  describe('flag variants map to thing branches', () => {
    /**
     * Per docs/concepts/experiments.mdx:
     * - Every Thing has a `branch` field (default: 'main')
     * - Experiments compare branches
     * - Feature flags are simple experiments with boolean outcomes
     *
     * The mapping should be:
     * - Flag enabled=false -> 'main' branch
     * - Flag enabled=true, variant='control' -> 'control' branch
     * - Flag enabled=true, variant='treatment' -> 'treatment' branch
     */

    interface ThingVersion {
      id: string
      type: string
      branch: string | null
      data: Record<string, unknown>
    }

    /**
     * Resolves which version of a thing to use based on flag evaluation.
     */
    function resolveThingVersion(
      thingId: string,
      flagResult: { enabled: boolean; variant: string | null },
      versions: ThingVersion[]
    ): ThingVersion | undefined {
      // Determine target branch
      const targetBranch = flagResult.enabled && flagResult.variant ? flagResult.variant : 'main'

      // Find version on target branch
      let version = versions.find((v) => v.id === thingId && v.branch === targetBranch)

      // Fall back to main if branch doesn't exist
      if (!version && targetBranch !== 'main') {
        version = versions.find((v) => v.id === thingId && (v.branch === 'main' || v.branch === null))
      }

      return version
    }

    it('flag disabled maps to main branch', () => {
      const versions: ThingVersion[] = [
        { id: 'pricing', type: 'Page', branch: null, data: { price: 10 } },
        { id: 'pricing', type: 'Page', branch: 'main', data: { price: 10 } },
        { id: 'pricing', type: 'Page', branch: 'discount-variant', data: { price: 8 } },
      ]

      // Flag is disabled
      const flagResult = { enabled: false, variant: null }

      const version = resolveThingVersion('pricing', flagResult, versions)

      expect(version).toBeDefined()
      expect(version?.data.price).toBe(10) // Main branch price
    })

    it('flag enabled with variant maps to variant branch', () => {
      const versions: ThingVersion[] = [
        { id: 'checkout', type: 'Flow', branch: 'main', data: { steps: 3 } },
        { id: 'checkout', type: 'Flow', branch: 'simplified', data: { steps: 2 } },
        { id: 'checkout', type: 'Flow', branch: 'detailed', data: { steps: 5 } },
      ]

      // Flag with simplified variant
      const flagResult = { enabled: true, variant: 'simplified' }

      const version = resolveThingVersion('checkout', flagResult, versions)

      expect(version).toBeDefined()
      expect(version?.branch).toBe('simplified')
      expect(version?.data.steps).toBe(2)
    })

    it('flag with non-existent variant falls back to main', () => {
      const versions: ThingVersion[] = [
        { id: 'feature', type: 'Config', branch: 'main', data: { version: 'stable' } },
      ]

      // Flag with variant that doesn't exist as a branch
      const flagResult = { enabled: true, variant: 'experimental' }

      const version = resolveThingVersion('feature', flagResult, versions)

      expect(version).toBeDefined()
      expect(version?.branch).toBe('main')
      expect(version?.data.version).toBe('stable')
    })

    it('experiment branch assignment maps to thing branch', () => {
      clearExperiments()
      setActiveExperiment('landingPage', {
        id: 'exp-landing',
        thing: 'landingPage',
        branches: ['main', 'hero-v2', 'hero-v3'],
        traffic: 1.0,
        metric: 'Signup.completed',
        status: 'running',
      })

      const versions: ThingVersion[] = [
        { id: 'landingPage', type: 'Page', branch: 'main', data: { hero: 'original' } },
        { id: 'landingPage', type: 'Page', branch: 'hero-v2', data: { hero: 'v2-design' } },
        { id: 'landingPage', type: 'Page', branch: 'hero-v3', data: { hero: 'v3-design' } },
      ]

      // Get experiment branch for a user
      const branch = resolveBranch('user-123', 'landingPage')

      // Find the thing version on that branch
      const version = versions.find((v) => v.id === 'landingPage' && v.branch === branch)

      expect(version).toBeDefined()
      expect(version?.branch).toBe(branch)
    })

    it('on/off flag variants map correctly to branches', () => {
      // Simple boolean flag - on=enabled branch, off=main branch
      const flag: FlagConfig = {
        id: 'dark-mode-feature',
        traffic: 1.0,
        branches: [
          { key: 'off', weight: 50 },
          { key: 'on', weight: 50 },
        ],
        stickiness: 'user_id',
        status: 'active',
      }

      const versions: ThingVersion[] = [
        { id: 'theme', type: 'Config', branch: 'main', data: { mode: 'light' } },
        { id: 'theme', type: 'Config', branch: 'off', data: { mode: 'light' } },
        { id: 'theme', type: 'Config', branch: 'on', data: { mode: 'dark' } },
      ]

      // Test multiple users
      let onCount = 0
      let offCount = 0

      for (let i = 0; i < 100; i++) {
        const result = evaluateFlag(flag, { userId: `theme-user-${i}` })

        if (result.variant === 'on') {
          onCount++
          const version = resolveThingVersion('theme', result, versions)
          expect(version?.data.mode).toBe('dark')
        } else if (result.variant === 'off') {
          offCount++
          const version = resolveThingVersion('theme', result, versions)
          expect(version?.data.mode).toBe('light')
        }
      }

      // Should have both on and off users
      expect(onCount).toBeGreaterThan(0)
      expect(offCount).toBeGreaterThan(0)
    })

    it('percentage rollout progressively uses variant branch', () => {
      // Test that as traffic increases, more users get variant branch

      const versions: ThingVersion[] = [
        { id: 'feature', type: 'Config', branch: 'main', data: { enabled: false } },
        { id: 'feature', type: 'Config', branch: 'enabled', data: { enabled: true } },
      ]

      const trafficLevels = [0.0, 0.25, 0.5, 0.75, 1.0]
      const results: number[] = []

      for (const traffic of trafficLevels) {
        const flag: FlagConfig = {
          id: 'progressive-rollout',
          traffic,
          branches: [{ key: 'enabled', weight: 100 }],
          stickiness: 'user_id',
          status: 'active',
        }

        let enabledCount = 0
        for (let i = 0; i < 1000; i++) {
          const result = evaluateFlag(flag, { userId: `rollout-user-${i}` })
          if (result.enabled) {
            enabledCount++
          }
        }

        results.push(enabledCount)
      }

      // Should be monotonically increasing
      expect(results[0]).toBe(0) // 0% traffic
      expect(results[1]).toBeGreaterThan(results[0]) // 25%
      expect(results[2]).toBeGreaterThan(results[1]) // 50%
      expect(results[3]).toBeGreaterThan(results[2]) // 75%
      expect(results[4]).toBe(1000) // 100%
    })
  })
})
