/**
 * RED Phase Tests for Weighted Branch Assignment
 *
 * These tests define the expected behavior of weighted branch assignment in feature flags.
 * They will FAIL until the implementation is created.
 *
 * Weighted branch assignment allows splitting traffic into multiple variants
 * with configurable weights (e.g., 70/20/10 split for A/B/C testing).
 *
 * The evaluateFlag function should:
 * 1. Use deterministic hashing based on stickiness field (e.g., user_id)
 * 2. Assign users to branches based on weight distribution
 * 3. Include payload data when a branch has a payload
 * 4. Respect traffic allocation (some users may get no variant)
 */

import { describe, it, expect } from 'vitest'

// Import evaluateFlag from workflows/flags.ts (doesn't exist yet - RED phase)
import { evaluateFlag } from '../../workflows/flags'

/**
 * Flag configuration type for tests
 */
interface Branch {
  key: string
  weight: number
  payload?: Record<string, unknown>
}

interface FlagConfig {
  id: string
  traffic: number // 0-1, percentage of users in the experiment
  branches: Branch[]
  stickiness: string // field to use for deterministic assignment (e.g., 'user_id')
  status: 'active' | 'inactive'
}

/**
 * Expected result from evaluateFlag
 */
interface EvaluationResult {
  enabled: boolean
  variant: string | null
  payload?: Record<string, unknown>
}

describe('Weighted Branch Assignment', () => {
  /**
   * Test: assigns to branches based on weight distribution
   *
   * Given a flag with multiple weighted branches, users should be assigned
   * to branches based on the weight distribution.
   */
  describe('assigns to branches based on weight distribution', () => {
    it('assigns users to branches deterministically', () => {
      const flag: FlagConfig = {
        id: 'multi-branch-test',
        traffic: 1, // 100% in experiment
        branches: [
          { key: 'control', weight: 50 },
          { key: 'variant-a', weight: 50 },
        ],
        stickiness: 'user_id',
        status: 'active',
      }

      // Same user should always get same branch
      const result1 = evaluateFlag(flag, { userId: 'user-123' })
      const result2 = evaluateFlag(flag, { userId: 'user-123' })
      const result3 = evaluateFlag(flag, { userId: 'user-123' })

      expect(result1.variant).toBe(result2.variant)
      expect(result2.variant).toBe(result3.variant)
      expect(result1.enabled).toBe(true)
    })

    it('assigns different users to different branches', () => {
      const flag: FlagConfig = {
        id: 'distribution-test',
        traffic: 1,
        branches: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
        stickiness: 'user_id',
        status: 'active',
      }

      // With enough users, we should see both branches
      const variants = new Set<string>()
      for (let i = 0; i < 100; i++) {
        const result = evaluateFlag(flag, { userId: `user-${i}` })
        if (result.variant) {
          variants.add(result.variant)
        }
      }

      expect(variants.has('control')).toBe(true)
      expect(variants.has('treatment')).toBe(true)
    })
  })

  /**
   * Test: 70/20/10 weights produce approximately 70%/20%/10% distribution
   *
   * Statistical verification that weights are respected within tolerance.
   * Uses 10000 iterations for statistical significance.
   */
  describe('70/20/10 weights produce approximately 70%/20%/10% distribution', () => {
    it('distributes users according to weights within 5% tolerance', () => {
      const flag: FlagConfig = {
        id: 'weighted-distribution',
        traffic: 1, // 100% in experiment
        branches: [
          { key: 'control', weight: 70 },
          { key: 'variant-a', weight: 20 },
          { key: 'variant-b', weight: 10 },
        ],
        stickiness: 'user_id',
        status: 'active',
      }

      const counts: Record<string, number> = {
        control: 0,
        'variant-a': 0,
        'variant-b': 0,
      }

      const iterations = 10000
      for (let i = 0; i < iterations; i++) {
        const result = evaluateFlag(flag, { userId: `user-${i}` })
        if (result.variant && result.variant in counts) {
          counts[result.variant]++
        }
      }

      // Calculate percentages
      const controlPct = (counts.control / iterations) * 100
      const variantAPct = (counts['variant-a'] / iterations) * 100
      const variantBPct = (counts['variant-b'] / iterations) * 100

      // Verify distribution within 5% tolerance
      // Control: expected 70%, acceptable range 65-75%
      expect(controlPct).toBeGreaterThanOrEqual(65)
      expect(controlPct).toBeLessThanOrEqual(75)

      // Variant A: expected 20%, acceptable range 15-25%
      expect(variantAPct).toBeGreaterThanOrEqual(15)
      expect(variantAPct).toBeLessThanOrEqual(25)

      // Variant B: expected 10%, acceptable range 5-15%
      expect(variantBPct).toBeGreaterThanOrEqual(5)
      expect(variantBPct).toBeLessThanOrEqual(15)
    })

    it('maintains distribution consistency across multiple runs', () => {
      const flag: FlagConfig = {
        id: 'consistency-check',
        traffic: 1,
        branches: [
          { key: 'a', weight: 70 },
          { key: 'b', weight: 20 },
          { key: 'c', weight: 10 },
        ],
        stickiness: 'user_id',
        status: 'active',
      }

      // Run twice with same users
      const run1Counts: Record<string, number> = { a: 0, b: 0, c: 0 }
      const run2Counts: Record<string, number> = { a: 0, b: 0, c: 0 }

      for (let i = 0; i < 1000; i++) {
        const userId = `stable-user-${i}`
        const result1 = evaluateFlag(flag, { userId })
        const result2 = evaluateFlag(flag, { userId })

        // Same user should get same result
        expect(result1.variant).toBe(result2.variant)

        if (result1.variant && result1.variant in run1Counts) {
          run1Counts[result1.variant]++
        }
        if (result2.variant && result2.variant in run2Counts) {
          run2Counts[result2.variant]++
        }
      }

      // Both runs should have identical counts (deterministic)
      expect(run1Counts).toEqual(run2Counts)
    })
  })

  /**
   * Test: includes payload in result when branch has payload
   *
   * Branches can include arbitrary payload data that should be returned
   * in the evaluation result.
   */
  describe('includes payload in result when branch has payload', () => {
    it('returns payload for branch with payload', () => {
      const flag: FlagConfig = {
        id: 'payload-test',
        traffic: 1,
        branches: [
          {
            key: 'control',
            weight: 0, // Force user to variant
            payload: { buttonColor: 'blue' },
          },
          {
            key: 'variant',
            weight: 100,
            payload: { buttonColor: 'green', fontSize: 16 },
          },
        ],
        stickiness: 'user_id',
        status: 'active',
      }

      const result = evaluateFlag(flag, { userId: 'test-user' })

      expect(result.enabled).toBe(true)
      expect(result.variant).toBe('variant')
      expect(result.payload).toEqual({ buttonColor: 'green', fontSize: 16 })
    })

    it('returns undefined payload when branch has no payload', () => {
      const flag: FlagConfig = {
        id: 'no-payload-test',
        traffic: 1,
        branches: [{ key: 'control', weight: 100 }],
        stickiness: 'user_id',
        status: 'active',
      }

      const result = evaluateFlag(flag, { userId: 'test-user' })

      expect(result.enabled).toBe(true)
      expect(result.variant).toBe('control')
      expect(result.payload).toBeUndefined()
    })

    it('returns correct payload for specific branch assignment', () => {
      const flag: FlagConfig = {
        id: 'specific-payload',
        traffic: 1,
        branches: [
          { key: 'a', weight: 33, payload: { value: 'payload-a' } },
          { key: 'b', weight: 33, payload: { value: 'payload-b' } },
          { key: 'c', weight: 34, payload: { value: 'payload-c' } },
        ],
        stickiness: 'user_id',
        status: 'active',
      }

      // Test multiple users to find one in each branch
      const payloads = new Set<string>()
      for (let i = 0; i < 100; i++) {
        const result = evaluateFlag(flag, { userId: `payload-user-${i}` })
        if (result.payload && typeof result.payload.value === 'string') {
          payloads.add(result.payload.value)
        }
      }

      // Should see all three payloads
      expect(payloads.has('payload-a')).toBe(true)
      expect(payloads.has('payload-b')).toBe(true)
      expect(payloads.has('payload-c')).toBe(true)
    })
  })

  /**
   * Test: handles single branch case (100% to that branch)
   *
   * When there's only one branch, all users should be assigned to it.
   */
  describe('handles single branch case (100% to that branch)', () => {
    it('assigns all users to single branch', () => {
      const flag: FlagConfig = {
        id: 'single-branch',
        traffic: 1,
        branches: [{ key: 'only-branch', weight: 100 }],
        stickiness: 'user_id',
        status: 'active',
      }

      // All users should get the same branch
      for (let i = 0; i < 100; i++) {
        const result = evaluateFlag(flag, { userId: `user-${i}` })
        expect(result.enabled).toBe(true)
        expect(result.variant).toBe('only-branch')
      }
    })

    it('works with any weight value for single branch', () => {
      const flag: FlagConfig = {
        id: 'single-branch-weight',
        traffic: 1,
        branches: [{ key: 'the-branch', weight: 1 }], // Weight doesn't matter with single branch
        stickiness: 'user_id',
        status: 'active',
      }

      const result = evaluateFlag(flag, { userId: 'test-user' })

      expect(result.enabled).toBe(true)
      expect(result.variant).toBe('the-branch')
    })

    it('returns payload from single branch', () => {
      const flag: FlagConfig = {
        id: 'single-with-payload',
        traffic: 1,
        branches: [
          {
            key: 'feature',
            weight: 100,
            payload: { config: { enabled: true, limit: 100 } },
          },
        ],
        stickiness: 'user_id',
        status: 'active',
      }

      const result = evaluateFlag(flag, { userId: 'any-user' })

      expect(result.payload).toEqual({ config: { enabled: true, limit: 100 } })
    })
  })

  /**
   * Test: handles equal weights correctly (50/50 split)
   *
   * With equal weights, distribution should be approximately even.
   */
  describe('handles equal weights correctly (50/50 split)', () => {
    it('distributes approximately 50/50 with two equal weight branches', () => {
      const flag: FlagConfig = {
        id: 'fifty-fifty',
        traffic: 1,
        branches: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
        stickiness: 'user_id',
        status: 'active',
      }

      const counts = { control: 0, treatment: 0 }
      const iterations = 10000

      for (let i = 0; i < iterations; i++) {
        const result = evaluateFlag(flag, { userId: `fifty-user-${i}` })
        if (result.variant === 'control') counts.control++
        if (result.variant === 'treatment') counts.treatment++
      }

      const controlPct = (counts.control / iterations) * 100
      const treatmentPct = (counts.treatment / iterations) * 100

      // Both should be approximately 50% (within 5%)
      expect(controlPct).toBeGreaterThanOrEqual(45)
      expect(controlPct).toBeLessThanOrEqual(55)
      expect(treatmentPct).toBeGreaterThanOrEqual(45)
      expect(treatmentPct).toBeLessThanOrEqual(55)
    })

    it('distributes approximately equal with three equal weight branches', () => {
      const flag: FlagConfig = {
        id: 'three-way-split',
        traffic: 1,
        branches: [
          { key: 'a', weight: 33 },
          { key: 'b', weight: 33 },
          { key: 'c', weight: 34 }, // 34 to make 100
        ],
        stickiness: 'user_id',
        status: 'active',
      }

      const counts: Record<string, number> = { a: 0, b: 0, c: 0 }
      const iterations = 10000

      for (let i = 0; i < iterations; i++) {
        const result = evaluateFlag(flag, { userId: `three-way-${i}` })
        if (result.variant && result.variant in counts) {
          counts[result.variant]++
        }
      }

      // Each should be approximately 33% (within 5%)
      const aPct = (counts.a / iterations) * 100
      const bPct = (counts.b / iterations) * 100
      const cPct = (counts.c / iterations) * 100

      expect(aPct).toBeGreaterThanOrEqual(28)
      expect(aPct).toBeLessThanOrEqual(38)
      expect(bPct).toBeGreaterThanOrEqual(28)
      expect(bPct).toBeLessThanOrEqual(38)
      expect(cPct).toBeGreaterThanOrEqual(29) // Slightly higher expected for 34%
      expect(cPct).toBeLessThanOrEqual(39)
    })

    it('handles equal weights with weight value of 1 each', () => {
      const flag: FlagConfig = {
        id: 'unit-weights',
        traffic: 1,
        branches: [
          { key: 'x', weight: 1 },
          { key: 'y', weight: 1 },
        ],
        stickiness: 'user_id',
        status: 'active',
      }

      const counts = { x: 0, y: 0 }
      const iterations = 10000

      for (let i = 0; i < iterations; i++) {
        const result = evaluateFlag(flag, { userId: `unit-${i}` })
        if (result.variant === 'x') counts.x++
        if (result.variant === 'y') counts.y++
      }

      // Should be approximately 50/50
      const xPct = (counts.x / iterations) * 100
      const yPct = (counts.y / iterations) * 100

      expect(xPct).toBeGreaterThanOrEqual(45)
      expect(xPct).toBeLessThanOrEqual(55)
      expect(yPct).toBeGreaterThanOrEqual(45)
      expect(yPct).toBeLessThanOrEqual(55)
    })
  })

  /**
   * Additional edge cases and behavior tests
   */
  describe('edge cases', () => {
    it('returns disabled when flag status is inactive', () => {
      const flag: FlagConfig = {
        id: 'inactive-flag',
        traffic: 1,
        branches: [{ key: 'control', weight: 100 }],
        stickiness: 'user_id',
        status: 'inactive',
      }

      const result = evaluateFlag(flag, { userId: 'test-user' })

      expect(result.enabled).toBe(false)
      expect(result.variant).toBeNull()
    })

    it('returns disabled when traffic is 0', () => {
      const flag: FlagConfig = {
        id: 'zero-traffic',
        traffic: 0,
        branches: [{ key: 'control', weight: 100 }],
        stickiness: 'user_id',
        status: 'active',
      }

      const result = evaluateFlag(flag, { userId: 'test-user' })

      expect(result.enabled).toBe(false)
      expect(result.variant).toBeNull()
    })

    it('respects partial traffic allocation', () => {
      const flag: FlagConfig = {
        id: 'partial-traffic',
        traffic: 0.5, // 50% in experiment
        branches: [{ key: 'variant', weight: 100 }],
        stickiness: 'user_id',
        status: 'active',
      }

      let enabledCount = 0
      const iterations = 10000

      for (let i = 0; i < iterations; i++) {
        const result = evaluateFlag(flag, { userId: `partial-${i}` })
        if (result.enabled) enabledCount++
      }

      // Approximately 50% should be enabled
      const enabledPct = (enabledCount / iterations) * 100
      expect(enabledPct).toBeGreaterThanOrEqual(45)
      expect(enabledPct).toBeLessThanOrEqual(55)
    })

    it('handles zero-weight branches correctly', () => {
      const flag: FlagConfig = {
        id: 'zero-weight-branch',
        traffic: 1,
        branches: [
          { key: 'active', weight: 100 },
          { key: 'disabled', weight: 0 },
        ],
        stickiness: 'user_id',
        status: 'active',
      }

      // No user should ever get the zero-weight branch
      for (let i = 0; i < 1000; i++) {
        const result = evaluateFlag(flag, { userId: `zero-weight-${i}` })
        expect(result.variant).toBe('active')
        expect(result.variant).not.toBe('disabled')
      }
    })

    it('uses different stickiness fields correctly', () => {
      const flag: FlagConfig = {
        id: 'stickiness-test',
        traffic: 1,
        branches: [
          { key: 'a', weight: 50 },
          { key: 'b', weight: 50 },
        ],
        stickiness: 'session_id',
        status: 'active',
      }

      // Same sessionId should give consistent results
      const result1 = evaluateFlag(flag, { sessionId: 'session-abc' })
      const result2 = evaluateFlag(flag, { sessionId: 'session-abc' })

      expect(result1.variant).toBe(result2.variant)
    })
  })
})
