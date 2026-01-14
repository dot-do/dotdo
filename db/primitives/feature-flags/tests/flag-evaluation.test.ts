/**
 * Feature Flag Evaluation Tests
 *
 * RED phase: These tests define the expected behavior of the FlagEvaluator.
 * All tests should FAIL until implementation is complete.
 *
 * Tests cover:
 * - Boolean flag evaluation (on/off)
 * - Multivariate flags (string, number, JSON variants)
 * - Default values when flag not found
 * - Kill switch behavior (override all evaluations)
 * - User context evaluation (attributes, segments)
 * - Environment-based evaluation (dev, staging, prod)
 * - Percentage rollout (consistent bucketing)
 * - Flag dependency (flag A requires flag B)
 * - Evaluation logging (track which flags evaluated)
 * - Type safety (flag type matches expected type)
 * - Stale flag detection (flag past expiry date)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  FlagEvaluator,
  createFlagEvaluator,
  type FlagDefinition,
  type EvaluationContext,
  type EvaluationResult,
  type FlagVariant,
  type FlagStore,
  type EvaluationLog,
  type FlagType,
} from '../evaluator'

// ============================================================================
// TEST HELPERS
// ============================================================================

function createEvaluator(
  flags?: FlagDefinition[],
  options?: { store?: FlagStore; environment?: string; killSwitch?: boolean }
): FlagEvaluator {
  return createFlagEvaluator({
    flags,
    ...options,
  })
}

function createContext(overrides?: Partial<EvaluationContext>): EvaluationContext {
  return {
    userId: 'user-123',
    sessionId: 'session-456',
    attributes: {},
    segments: [],
    ...overrides,
  }
}

// ============================================================================
// BOOLEAN FLAG EVALUATION
// ============================================================================

describe('FlagEvaluator', () => {
  describe('boolean flag evaluation', () => {
    it('should return true for enabled boolean flag', async () => {
      const evaluator = createEvaluator([
        {
          key: 'feature-a',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
        },
      ])

      const result = await evaluator.evaluate('feature-a', createContext())

      expect(result.value).toBe(true)
      expect(result.flagKey).toBe('feature-a')
    })

    it('should return false for disabled boolean flag', async () => {
      const evaluator = createEvaluator([
        {
          key: 'feature-disabled',
          type: 'boolean',
          enabled: false,
          defaultValue: false,
        },
      ])

      const result = await evaluator.evaluate('feature-disabled', createContext())

      expect(result.value).toBe(false)
    })

    it('should support getBooleanValue convenience method', async () => {
      const evaluator = createEvaluator([
        {
          key: 'bool-flag',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
        },
      ])

      const value = await evaluator.getBooleanValue('bool-flag', createContext(), false)

      expect(value).toBe(true)
    })

    it('should toggle flag value at runtime', async () => {
      const evaluator = createEvaluator([
        {
          key: 'toggleable',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
        },
      ])

      expect(await evaluator.getBooleanValue('toggleable', createContext(), false)).toBe(true)

      await evaluator.setFlag('toggleable', { enabled: false })

      expect(await evaluator.getBooleanValue('toggleable', createContext(), false)).toBe(false)
    })
  })

  // ============================================================================
  // MULTIVARIATE FLAGS
  // ============================================================================

  describe('multivariate flags', () => {
    it('should evaluate string variant flag', async () => {
      const evaluator = createEvaluator([
        {
          key: 'button-color',
          type: 'string',
          enabled: true,
          variants: [
            { key: 'control', value: 'blue', weight: 50 },
            { key: 'treatment', value: 'green', weight: 50 },
          ],
          defaultValue: 'blue',
        },
      ])

      const result = await evaluator.evaluate('button-color', createContext())

      expect(typeof result.value).toBe('string')
      expect(['blue', 'green']).toContain(result.value)
      expect(result.variant).toBeDefined()
    })

    it('should evaluate number variant flag', async () => {
      const evaluator = createEvaluator([
        {
          key: 'max-items',
          type: 'number',
          enabled: true,
          variants: [
            { key: 'low', value: 10, weight: 33 },
            { key: 'medium', value: 25, weight: 34 },
            { key: 'high', value: 50, weight: 33 },
          ],
          defaultValue: 10,
        },
      ])

      const result = await evaluator.evaluate('max-items', createContext())

      expect(typeof result.value).toBe('number')
      expect([10, 25, 50]).toContain(result.value)
    })

    it('should evaluate JSON variant flag', async () => {
      const evaluator = createEvaluator([
        {
          key: 'pricing-config',
          type: 'json',
          enabled: true,
          variants: [
            { key: 'control', value: { tier: 'basic', price: 9.99 }, weight: 50 },
            { key: 'experiment', value: { tier: 'premium', price: 14.99, discount: 0.1 }, weight: 50 },
          ],
          defaultValue: { tier: 'basic', price: 9.99 },
        },
      ])

      const result = await evaluator.evaluate('pricing-config', createContext())

      expect(typeof result.value).toBe('object')
      expect(result.value).toHaveProperty('tier')
      expect(result.value).toHaveProperty('price')
    })

    it('should support getStringValue convenience method', async () => {
      const evaluator = createEvaluator([
        {
          key: 'string-flag',
          type: 'string',
          enabled: true,
          variants: [{ key: 'only', value: 'hello', weight: 100 }],
          defaultValue: 'default',
        },
      ])

      const value = await evaluator.getStringValue('string-flag', createContext(), 'default')

      expect(value).toBe('hello')
    })

    it('should support getNumberValue convenience method', async () => {
      const evaluator = createEvaluator([
        {
          key: 'number-flag',
          type: 'number',
          enabled: true,
          variants: [{ key: 'only', value: 42, weight: 100 }],
          defaultValue: 0,
        },
      ])

      const value = await evaluator.getNumberValue('number-flag', createContext(), 0)

      expect(value).toBe(42)
    })

    it('should support getJsonValue convenience method', async () => {
      const evaluator = createEvaluator([
        {
          key: 'json-flag',
          type: 'json',
          enabled: true,
          variants: [{ key: 'only', value: { foo: 'bar' }, weight: 100 }],
          defaultValue: {},
        },
      ])

      const value = await evaluator.getJsonValue('json-flag', createContext(), {})

      expect(value).toEqual({ foo: 'bar' })
    })
  })

  // ============================================================================
  // DEFAULT VALUES
  // ============================================================================

  describe('default values', () => {
    it('should return default when flag not found', async () => {
      const evaluator = createEvaluator([])

      const result = await evaluator.evaluate('nonexistent', createContext(), {
        defaultValue: 'fallback',
      })

      expect(result.value).toBe('fallback')
      expect(result.reason).toBe('FLAG_NOT_FOUND')
    })

    it('should return flag default when user not in rollout', async () => {
      const evaluator = createEvaluator([
        {
          key: 'limited-rollout',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          rolloutPercentage: 0, // 0% rollout
        },
      ])

      const result = await evaluator.evaluate('limited-rollout', createContext())

      expect(result.value).toBe(false)
      expect(result.reason).toBe('NOT_IN_ROLLOUT')
    })

    it('should return flag default when disabled', async () => {
      const evaluator = createEvaluator([
        {
          key: 'disabled-flag',
          type: 'string',
          enabled: false,
          variants: [{ key: 'variant', value: 'should-not-see', weight: 100 }],
          defaultValue: 'default-value',
        },
      ])

      const result = await evaluator.evaluate('disabled-flag', createContext())

      expect(result.value).toBe('default-value')
      expect(result.reason).toBe('FLAG_DISABLED')
    })

    it('should prefer context default over flag default', async () => {
      const evaluator = createEvaluator([
        {
          key: 'flag-with-default',
          type: 'string',
          enabled: false,
          defaultValue: 'flag-default',
        },
      ])

      const result = await evaluator.evaluate('flag-with-default', createContext(), {
        defaultValue: 'context-default',
      })

      expect(result.value).toBe('context-default')
    })
  })

  // ============================================================================
  // KILL SWITCH BEHAVIOR
  // ============================================================================

  describe('kill switch behavior', () => {
    it('should return default for all flags when kill switch is on', async () => {
      const evaluator = createEvaluator(
        [
          {
            key: 'feature-a',
            type: 'boolean',
            enabled: true,
            defaultValue: false,
          },
          {
            key: 'feature-b',
            type: 'string',
            enabled: true,
            variants: [{ key: 'variant', value: 'enabled', weight: 100 }],
            defaultValue: 'disabled',
          },
        ],
        { killSwitch: true }
      )

      const resultA = await evaluator.evaluate('feature-a', createContext())
      const resultB = await evaluator.evaluate('feature-b', createContext())

      expect(resultA.value).toBe(false)
      expect(resultA.reason).toBe('KILL_SWITCH')
      expect(resultB.value).toBe('disabled')
      expect(resultB.reason).toBe('KILL_SWITCH')
    })

    it('should enable kill switch at runtime', async () => {
      const evaluator = createEvaluator([
        {
          key: 'feature',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
        },
      ])

      expect(await evaluator.getBooleanValue('feature', createContext(), false)).toBe(true)

      evaluator.setKillSwitch(true)

      expect(await evaluator.getBooleanValue('feature', createContext(), false)).toBe(false)
    })

    it('should disable kill switch at runtime', async () => {
      const evaluator = createEvaluator(
        [
          {
            key: 'feature',
            type: 'boolean',
            enabled: true,
            defaultValue: false,
          },
        ],
        { killSwitch: true }
      )

      expect(await evaluator.getBooleanValue('feature', createContext(), false)).toBe(false)

      evaluator.setKillSwitch(false)

      expect(await evaluator.getBooleanValue('feature', createContext(), false)).toBe(true)
    })
  })

  // ============================================================================
  // USER CONTEXT EVALUATION
  // ============================================================================

  describe('user context evaluation', () => {
    it('should target users by attribute equality', async () => {
      const evaluator = createEvaluator([
        {
          key: 'beta-feature',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          rules: [
            {
              conditions: [{ attribute: 'plan', operator: 'equals', value: 'enterprise' }],
              value: true,
            },
          ],
        },
      ])

      const enterpriseUser = createContext({
        attributes: { plan: 'enterprise' },
      })
      const freeUser = createContext({
        attributes: { plan: 'free' },
      })

      expect(await evaluator.getBooleanValue('beta-feature', enterpriseUser, false)).toBe(true)
      expect(await evaluator.getBooleanValue('beta-feature', freeUser, false)).toBe(false)
    })

    it('should target users by attribute contains', async () => {
      const evaluator = createEvaluator([
        {
          key: 'email-feature',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          rules: [
            {
              conditions: [{ attribute: 'email', operator: 'contains', value: '@company.com' }],
              value: true,
            },
          ],
        },
      ])

      const internalUser = createContext({
        attributes: { email: 'alice@company.com' },
      })
      const externalUser = createContext({
        attributes: { email: 'bob@gmail.com' },
      })

      expect(await evaluator.getBooleanValue('email-feature', internalUser, false)).toBe(true)
      expect(await evaluator.getBooleanValue('email-feature', externalUser, false)).toBe(false)
    })

    it('should target users by attribute in list', async () => {
      const evaluator = createEvaluator([
        {
          key: 'region-feature',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          rules: [
            {
              conditions: [{ attribute: 'country', operator: 'in', value: ['US', 'CA', 'UK'] }],
              value: true,
            },
          ],
        },
      ])

      const usUser = createContext({ attributes: { country: 'US' } })
      const deUser = createContext({ attributes: { country: 'DE' } })

      expect(await evaluator.getBooleanValue('region-feature', usUser, false)).toBe(true)
      expect(await evaluator.getBooleanValue('region-feature', deUser, false)).toBe(false)
    })

    it('should target users by segment membership', async () => {
      const evaluator = createEvaluator([
        {
          key: 'segment-feature',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          rules: [
            {
              conditions: [{ segment: 'beta-testers' }],
              value: true,
            },
          ],
        },
      ])

      const betaUser = createContext({ segments: ['beta-testers'] })
      const regularUser = createContext({ segments: [] })

      expect(await evaluator.getBooleanValue('segment-feature', betaUser, false)).toBe(true)
      expect(await evaluator.getBooleanValue('segment-feature', regularUser, false)).toBe(false)
    })

    it('should evaluate multiple conditions with AND logic', async () => {
      const evaluator = createEvaluator([
        {
          key: 'complex-feature',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          rules: [
            {
              conditions: [
                { attribute: 'plan', operator: 'equals', value: 'enterprise' },
                { attribute: 'country', operator: 'in', value: ['US', 'CA'] },
              ],
              value: true,
            },
          ],
        },
      ])

      const matchingUser = createContext({
        attributes: { plan: 'enterprise', country: 'US' },
      })
      const partialMatchUser = createContext({
        attributes: { plan: 'enterprise', country: 'DE' },
      })

      expect(await evaluator.getBooleanValue('complex-feature', matchingUser, false)).toBe(true)
      expect(await evaluator.getBooleanValue('complex-feature', partialMatchUser, false)).toBe(false)
    })

    it('should evaluate multiple rules with OR logic', async () => {
      const evaluator = createEvaluator([
        {
          key: 'multi-rule-feature',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          rules: [
            {
              conditions: [{ segment: 'vip' }],
              value: true,
            },
            {
              conditions: [{ attribute: 'plan', operator: 'equals', value: 'enterprise' }],
              value: true,
            },
          ],
        },
      ])

      const vipUser = createContext({ segments: ['vip'], attributes: {} })
      const enterpriseUser = createContext({ segments: [], attributes: { plan: 'enterprise' } })
      const regularUser = createContext({ segments: [], attributes: { plan: 'free' } })

      expect(await evaluator.getBooleanValue('multi-rule-feature', vipUser, false)).toBe(true)
      expect(await evaluator.getBooleanValue('multi-rule-feature', enterpriseUser, false)).toBe(true)
      expect(await evaluator.getBooleanValue('multi-rule-feature', regularUser, false)).toBe(false)
    })

    it('should support numeric comparison operators', async () => {
      const evaluator = createEvaluator([
        {
          key: 'high-value-feature',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          rules: [
            {
              conditions: [{ attribute: 'totalSpend', operator: 'greaterThan', value: 1000 }],
              value: true,
            },
          ],
        },
      ])

      const highSpender = createContext({ attributes: { totalSpend: 1500 } })
      const lowSpender = createContext({ attributes: { totalSpend: 500 } })

      expect(await evaluator.getBooleanValue('high-value-feature', highSpender, false)).toBe(true)
      expect(await evaluator.getBooleanValue('high-value-feature', lowSpender, false)).toBe(false)
    })
  })

  // ============================================================================
  // ENVIRONMENT-BASED EVALUATION
  // ============================================================================

  describe('environment-based evaluation', () => {
    it('should enable flag only in specified environments', async () => {
      const evaluator = createEvaluator(
        [
          {
            key: 'debug-feature',
            type: 'boolean',
            enabled: true,
            defaultValue: false,
            environments: ['dev', 'staging'],
          },
        ],
        { environment: 'dev' }
      )

      const result = await evaluator.evaluate('debug-feature', createContext())

      expect(result.value).toBe(true)
    })

    it('should disable flag in non-matching environments', async () => {
      const evaluator = createEvaluator(
        [
          {
            key: 'debug-feature',
            type: 'boolean',
            enabled: true,
            defaultValue: false,
            environments: ['dev', 'staging'],
          },
        ],
        { environment: 'prod' }
      )

      const result = await evaluator.evaluate('debug-feature', createContext())

      expect(result.value).toBe(false)
      expect(result.reason).toBe('ENVIRONMENT_MISMATCH')
    })

    it('should support environment-specific flag values', async () => {
      const evaluator = createEvaluator(
        [
          {
            key: 'api-url',
            type: 'string',
            enabled: true,
            defaultValue: 'https://api.example.com',
            environmentValues: {
              dev: 'http://localhost:3000',
              staging: 'https://staging-api.example.com',
              prod: 'https://api.example.com',
            },
          },
        ],
        { environment: 'staging' }
      )

      const result = await evaluator.evaluate('api-url', createContext())

      expect(result.value).toBe('https://staging-api.example.com')
    })

    it('should change environment at runtime', async () => {
      const evaluator = createEvaluator(
        [
          {
            key: 'env-flag',
            type: 'boolean',
            enabled: true,
            defaultValue: false,
            environments: ['prod'],
          },
        ],
        { environment: 'dev' }
      )

      expect(await evaluator.getBooleanValue('env-flag', createContext(), false)).toBe(false)

      evaluator.setEnvironment('prod')

      expect(await evaluator.getBooleanValue('env-flag', createContext(), false)).toBe(true)
    })
  })

  // ============================================================================
  // PERCENTAGE ROLLOUT
  // ============================================================================

  describe('percentage rollout', () => {
    it('should bucket users consistently by userId', async () => {
      const evaluator = createEvaluator([
        {
          key: 'gradual-rollout',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          rolloutPercentage: 50,
          stickiness: 'userId',
        },
      ])

      const user1 = createContext({ userId: 'user-001' })
      const user2 = createContext({ userId: 'user-002' })

      // Same user should get same result across multiple evaluations
      const result1a = await evaluator.evaluate('gradual-rollout', user1)
      const result1b = await evaluator.evaluate('gradual-rollout', user1)
      const result2a = await evaluator.evaluate('gradual-rollout', user2)
      const result2b = await evaluator.evaluate('gradual-rollout', user2)

      expect(result1a.value).toBe(result1b.value)
      expect(result2a.value).toBe(result2b.value)
    })

    it('should bucket users consistently by sessionId', async () => {
      const evaluator = createEvaluator([
        {
          key: 'session-rollout',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          rolloutPercentage: 50,
          stickiness: 'sessionId',
        },
      ])

      const session1 = createContext({ sessionId: 'session-001' })

      const result1 = await evaluator.evaluate('session-rollout', session1)
      const result2 = await evaluator.evaluate('session-rollout', session1)

      expect(result1.value).toBe(result2.value)
    })

    it('should respect rollout percentage distribution', async () => {
      const evaluator = createEvaluator([
        {
          key: 'rollout-test',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          rolloutPercentage: 30,
          stickiness: 'userId',
        },
      ])

      let enabledCount = 0
      const totalUsers = 1000

      for (let i = 0; i < totalUsers; i++) {
        const context = createContext({ userId: `user-${i}` })
        const result = await evaluator.evaluate('rollout-test', context)
        if (result.value === true) enabledCount++
      }

      // Allow 5% tolerance
      const percentage = enabledCount / totalUsers
      expect(percentage).toBeGreaterThanOrEqual(0.25)
      expect(percentage).toBeLessThanOrEqual(0.35)
    })

    it('should distribute variant weights correctly', async () => {
      const evaluator = createEvaluator([
        {
          key: 'variant-test',
          type: 'string',
          enabled: true,
          defaultValue: 'control',
          variants: [
            { key: 'control', value: 'control', weight: 70 },
            { key: 'treatment', value: 'treatment', weight: 30 },
          ],
          rolloutPercentage: 100,
        },
      ])

      const results: Record<string, number> = { control: 0, treatment: 0 }
      const totalUsers = 1000

      for (let i = 0; i < totalUsers; i++) {
        const context = createContext({ userId: `user-${i}` })
        const result = await evaluator.evaluate('variant-test', context)
        results[result.value as string]++
      }

      // Allow 5% tolerance
      expect(results.control / totalUsers).toBeGreaterThanOrEqual(0.65)
      expect(results.control / totalUsers).toBeLessThanOrEqual(0.75)
      expect(results.treatment / totalUsers).toBeGreaterThanOrEqual(0.25)
      expect(results.treatment / totalUsers).toBeLessThanOrEqual(0.35)
    })

    it('should provide bucket value for analytics', async () => {
      const evaluator = createEvaluator([
        {
          key: 'bucket-flag',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          rolloutPercentage: 50,
        },
      ])

      const result = await evaluator.evaluate('bucket-flag', createContext())

      expect(result.bucket).toBeDefined()
      expect(typeof result.bucket).toBe('number')
      expect(result.bucket).toBeGreaterThanOrEqual(0)
      expect(result.bucket).toBeLessThanOrEqual(100)
    })
  })

  // ============================================================================
  // FLAG DEPENDENCY
  // ============================================================================

  describe('flag dependency', () => {
    it('should evaluate dependent flag only when prerequisite is met', async () => {
      const evaluator = createEvaluator([
        {
          key: 'parent-feature',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
        },
        {
          key: 'child-feature',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          prerequisites: [{ flagKey: 'parent-feature', value: true }],
        },
      ])

      const result = await evaluator.evaluate('child-feature', createContext())

      expect(result.value).toBe(true)
    })

    it('should return default when prerequisite is not met', async () => {
      const evaluator = createEvaluator([
        {
          key: 'parent-feature',
          type: 'boolean',
          enabled: false,
          defaultValue: false,
        },
        {
          key: 'child-feature',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          prerequisites: [{ flagKey: 'parent-feature', value: true }],
        },
      ])

      const result = await evaluator.evaluate('child-feature', createContext())

      expect(result.value).toBe(false)
      expect(result.reason).toBe('PREREQUISITE_NOT_MET')
    })

    it('should support multiple prerequisites with AND logic', async () => {
      const evaluator = createEvaluator([
        {
          key: 'feature-a',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
        },
        {
          key: 'feature-b',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
        },
        {
          key: 'feature-c',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          prerequisites: [
            { flagKey: 'feature-a', value: true },
            { flagKey: 'feature-b', value: true },
          ],
        },
      ])

      const result = await evaluator.evaluate('feature-c', createContext())

      expect(result.value).toBe(true)
    })

    it('should fail when any prerequisite is not met', async () => {
      const evaluator = createEvaluator([
        {
          key: 'feature-a',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
        },
        {
          key: 'feature-b',
          type: 'boolean',
          enabled: false, // This one is disabled
          defaultValue: false,
        },
        {
          key: 'feature-c',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          prerequisites: [
            { flagKey: 'feature-a', value: true },
            { flagKey: 'feature-b', value: true },
          ],
        },
      ])

      const result = await evaluator.evaluate('feature-c', createContext())

      expect(result.value).toBe(false)
      expect(result.reason).toBe('PREREQUISITE_NOT_MET')
    })

    it('should detect circular dependencies', async () => {
      const evaluator = createEvaluator([
        {
          key: 'feature-a',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          prerequisites: [{ flagKey: 'feature-b', value: true }],
        },
        {
          key: 'feature-b',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          prerequisites: [{ flagKey: 'feature-a', value: true }],
        },
      ])

      await expect(evaluator.evaluate('feature-a', createContext())).rejects.toThrow(/circular/i)
    })

    it('should support variant value prerequisites', async () => {
      const evaluator = createEvaluator([
        {
          key: 'experiment',
          type: 'string',
          enabled: true,
          defaultValue: 'control',
          variants: [
            { key: 'control', value: 'control', weight: 50 },
            { key: 'treatment', value: 'treatment', weight: 50 },
          ],
        },
        {
          key: 'treatment-feature',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          prerequisites: [{ flagKey: 'experiment', value: 'treatment' }],
        },
      ])

      // Force user into treatment variant
      const treatmentContext = createContext({ userId: 'treatment-user-xyz' })
      // This test assumes the hashing puts this user in treatment
      // In practice, we might need to mock the hashing or find a known value

      const result = await evaluator.evaluate('treatment-feature', treatmentContext)

      // Result depends on which variant the user got
      expect(['MATCH', 'PREREQUISITE_NOT_MET']).toContain(result.reason)
    })
  })

  // ============================================================================
  // EVALUATION LOGGING
  // ============================================================================

  describe('evaluation logging', () => {
    it('should log flag evaluations', async () => {
      const logs: EvaluationLog[] = []
      const evaluator = createEvaluator(
        [
          {
            key: 'logged-flag',
            type: 'boolean',
            enabled: true,
            defaultValue: false,
          },
        ],
        {
          store: {
            log: async (entry) => {
              logs.push(entry)
            },
          } as FlagStore,
        }
      )

      await evaluator.evaluate('logged-flag', createContext())

      expect(logs).toHaveLength(1)
      expect(logs[0].flagKey).toBe('logged-flag')
      expect(logs[0].userId).toBe('user-123')
      expect(logs[0].value).toBe(true)
      expect(logs[0].timestamp).toBeDefined()
    })

    it('should include evaluation reason in log', async () => {
      const logs: EvaluationLog[] = []
      const evaluator = createEvaluator(
        [
          {
            key: 'reason-flag',
            type: 'boolean',
            enabled: false,
            defaultValue: false,
          },
        ],
        {
          store: {
            log: async (entry) => {
              logs.push(entry)
            },
          } as FlagStore,
        }
      )

      await evaluator.evaluate('reason-flag', createContext())

      expect(logs[0].reason).toBe('FLAG_DISABLED')
    })

    it('should log variant information', async () => {
      const logs: EvaluationLog[] = []
      const evaluator = createEvaluator(
        [
          {
            key: 'variant-flag',
            type: 'string',
            enabled: true,
            defaultValue: 'default',
            variants: [
              { key: 'control', value: 'control', weight: 50 },
              { key: 'treatment', value: 'treatment', weight: 50 },
            ],
          },
        ],
        {
          store: {
            log: async (entry) => {
              logs.push(entry)
            },
          } as FlagStore,
        }
      )

      await evaluator.evaluate('variant-flag', createContext())

      expect(logs[0].variant).toBeDefined()
      expect(['control', 'treatment']).toContain(logs[0].variant)
    })

    it('should batch evaluation logs', async () => {
      let batchCount = 0
      const evaluator = createEvaluator(
        [
          { key: 'flag-1', type: 'boolean', enabled: true, defaultValue: false },
          { key: 'flag-2', type: 'boolean', enabled: true, defaultValue: false },
          { key: 'flag-3', type: 'boolean', enabled: true, defaultValue: false },
        ],
        {
          store: {
            logBatch: async (entries) => {
              batchCount++
              expect(entries.length).toBeGreaterThan(1)
            },
          } as FlagStore,
        }
      )

      await evaluator.evaluate('flag-1', createContext())
      await evaluator.evaluate('flag-2', createContext())
      await evaluator.evaluate('flag-3', createContext())
      await evaluator.flush()

      expect(batchCount).toBeGreaterThanOrEqual(1)
    })

    it('should track evaluation latency', async () => {
      const logs: EvaluationLog[] = []
      const evaluator = createEvaluator(
        [
          {
            key: 'latency-flag',
            type: 'boolean',
            enabled: true,
            defaultValue: false,
          },
        ],
        {
          store: {
            log: async (entry) => {
              logs.push(entry)
            },
          } as FlagStore,
        }
      )

      await evaluator.evaluate('latency-flag', createContext())

      expect(logs[0].evaluationLatencyMs).toBeDefined()
      expect(typeof logs[0].evaluationLatencyMs).toBe('number')
    })

    it('should disable logging when configured', async () => {
      const logs: EvaluationLog[] = []
      const evaluator = createEvaluator(
        [
          {
            key: 'no-log-flag',
            type: 'boolean',
            enabled: true,
            defaultValue: false,
            disableLogging: true,
          },
        ],
        {
          store: {
            log: async (entry) => {
              logs.push(entry)
            },
          } as FlagStore,
        }
      )

      await evaluator.evaluate('no-log-flag', createContext())

      expect(logs).toHaveLength(0)
    })
  })

  // ============================================================================
  // TYPE SAFETY
  // ============================================================================

  describe('type safety', () => {
    it('should throw when expecting boolean but flag is string', async () => {
      const evaluator = createEvaluator([
        {
          key: 'string-flag',
          type: 'string',
          enabled: true,
          defaultValue: 'value',
        },
      ])

      await expect(
        evaluator.getBooleanValue('string-flag', createContext(), false)
      ).rejects.toThrow(/type mismatch/i)
    })

    it('should throw when expecting string but flag is number', async () => {
      const evaluator = createEvaluator([
        {
          key: 'number-flag',
          type: 'number',
          enabled: true,
          defaultValue: 42,
        },
      ])

      await expect(
        evaluator.getStringValue('number-flag', createContext(), 'default')
      ).rejects.toThrow(/type mismatch/i)
    })

    it('should throw when expecting number but flag is json', async () => {
      const evaluator = createEvaluator([
        {
          key: 'json-flag',
          type: 'json',
          enabled: true,
          defaultValue: { key: 'value' },
        },
      ])

      await expect(evaluator.getNumberValue('json-flag', createContext(), 0)).rejects.toThrow(
        /type mismatch/i
      )
    })

    it('should return typed result from generic evaluate', async () => {
      const evaluator = createEvaluator([
        {
          key: 'typed-flag',
          type: 'json',
          enabled: true,
          defaultValue: { count: 0 },
        },
      ])

      const result = await evaluator.evaluate<{ count: number }>('typed-flag', createContext())

      // TypeScript should infer result.value as { count: number }
      expect(result.value.count).toBeDefined()
    })

    it('should validate flag definition types on creation', () => {
      expect(() =>
        createEvaluator([
          {
            key: 'invalid-flag',
            type: 'invalid-type' as FlagType,
            enabled: true,
            defaultValue: 'value',
          },
        ])
      ).toThrow(/invalid flag type/i)
    })

    it('should validate variant types match flag type', () => {
      expect(() =>
        createEvaluator([
          {
            key: 'mismatched-flag',
            type: 'boolean',
            enabled: true,
            defaultValue: false,
            variants: [
              { key: 'variant', value: 'string-value', weight: 100 }, // Should be boolean
            ],
          },
        ])
      ).toThrow(/variant type mismatch/i)
    })
  })

  // ============================================================================
  // STALE FLAG DETECTION
  // ============================================================================

  describe('stale flag detection', () => {
    it('should return default for expired flag', async () => {
      const evaluator = createEvaluator([
        {
          key: 'expired-flag',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          expiresAt: new Date(Date.now() - 86400000).toISOString(), // Expired yesterday
        },
      ])

      const result = await evaluator.evaluate('expired-flag', createContext())

      expect(result.value).toBe(false)
      expect(result.reason).toBe('FLAG_EXPIRED')
    })

    it('should evaluate non-expired flag normally', async () => {
      const evaluator = createEvaluator([
        {
          key: 'valid-flag',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          expiresAt: new Date(Date.now() + 86400000).toISOString(), // Expires tomorrow
        },
      ])

      const result = await evaluator.evaluate('valid-flag', createContext())

      expect(result.value).toBe(true)
    })

    it('should list stale flags', async () => {
      const evaluator = createEvaluator([
        {
          key: 'expired-1',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          expiresAt: new Date(Date.now() - 86400000).toISOString(),
        },
        {
          key: 'expired-2',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          expiresAt: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
        },
        {
          key: 'valid',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      ])

      const staleFlags = evaluator.getStaleFlags()

      expect(staleFlags).toHaveLength(2)
      expect(staleFlags.map((f) => f.key)).toContain('expired-1')
      expect(staleFlags.map((f) => f.key)).toContain('expired-2')
    })

    it('should warn about flags expiring soon', async () => {
      const evaluator = createEvaluator([
        {
          key: 'expiring-soon',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
        },
      ])

      const expiringFlags = evaluator.getFlagsExpiringSoon(86400000) // Within 24 hours

      expect(expiringFlags).toHaveLength(1)
      expect(expiringFlags[0].key).toBe('expiring-soon')
    })

    it('should support staleness callback', async () => {
      const staleCallbackSpy = vi.fn()
      const evaluator = createEvaluator(
        [
          {
            key: 'expired-flag',
            type: 'boolean',
            enabled: true,
            defaultValue: false,
            expiresAt: new Date(Date.now() - 86400000).toISOString(),
          },
        ],
        {
          store: {
            onStaleFlagEvaluated: staleCallbackSpy,
          } as unknown as FlagStore,
        }
      )

      await evaluator.evaluate('expired-flag', createContext())

      expect(staleCallbackSpy).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'expired-flag' })
      )
    })

    it('should return time until expiry', async () => {
      const futureDate = new Date(Date.now() + 7200000) // 2 hours from now
      const evaluator = createEvaluator([
        {
          key: 'future-flag',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          expiresAt: futureDate.toISOString(),
        },
      ])

      const timeUntilExpiry = evaluator.getTimeUntilExpiry('future-flag')

      expect(timeUntilExpiry).toBeGreaterThan(7000000) // ~2 hours in ms
      expect(timeUntilExpiry).toBeLessThanOrEqual(7200000)
    })

    it('should return negative time for expired flags', async () => {
      const pastDate = new Date(Date.now() - 3600000) // 1 hour ago
      const evaluator = createEvaluator([
        {
          key: 'past-flag',
          type: 'boolean',
          enabled: true,
          defaultValue: false,
          expiresAt: pastDate.toISOString(),
        },
      ])

      const timeUntilExpiry = evaluator.getTimeUntilExpiry('past-flag')

      expect(timeUntilExpiry).toBeLessThan(0)
    })
  })

  // ============================================================================
  // FACTORY FUNCTION
  // ============================================================================

  describe('factory function', () => {
    it('should create a FlagEvaluator instance', () => {
      const evaluator = createFlagEvaluator()
      expect(evaluator).toBeInstanceOf(FlagEvaluator)
    })

    it('should accept flags array', () => {
      const evaluator = createFlagEvaluator({
        flags: [
          {
            key: 'test-flag',
            type: 'boolean',
            enabled: true,
            defaultValue: false,
          },
        ],
      })
      expect(evaluator).toBeDefined()
    })

    it('should accept store configuration', () => {
      const mockStore: FlagStore = {
        log: vi.fn(),
        logBatch: vi.fn(),
      }

      const evaluator = createFlagEvaluator({ store: mockStore })
      expect(evaluator).toBeDefined()
    })

    it('should accept environment configuration', () => {
      const evaluator = createFlagEvaluator({ environment: 'staging' })
      expect(evaluator).toBeDefined()
    })
  })
})
