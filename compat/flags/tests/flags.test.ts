/**
 * @dotdo/flags - Feature Flags Compat Layer Tests
 *
 * Comprehensive tests for the LaunchDarkly-compatible feature flags layer.
 * Following TDD: These tests are written first and should FAIL initially.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  // Core client
  LDClient,
  createClient,

  // Types
  type LDOptions,
  type LDUser,
  type LDContext,
  type LDFlagValue,
  type LDFlagSet,
  type LDEvaluationDetail,
  type LDEvaluationReason,

  // Flag definitions
  type FeatureFlag,
  type FlagVariation,
  type FlagRule,
  type RolloutConfig,
  type TargetingRule,

  // Experiments
  type Experiment,
  type ExperimentVariant,
  type ExperimentResult,

  // Testing utilities
  createTestClient,
  _clear,
} from '../index'

describe('@dotdo/flags - Feature Flags Compat Layer', () => {
  beforeEach(() => {
    _clear()
  })

  // ===========================================================================
  // Client Initialization
  // ===========================================================================

  describe('Client Initialization', () => {
    it('should create client with SDK key', () => {
      const client = createClient('sdk-key-123')
      expect(client).toBeDefined()
      expect(client.sdkKey).toBe('sdk-key-123')
    })

    it('should accept optional configuration', () => {
      const client = createClient('sdk-key-123', {
        baseUri: 'https://custom.launchdarkly.com',
        streamUri: 'https://stream.launchdarkly.com',
        eventsUri: 'https://events.launchdarkly.com',
        timeout: 5000,
      })
      expect(client.baseUri).toBe('https://custom.launchdarkly.com')
    })

    it('should have default configuration', () => {
      const client = createClient('sdk-key-123')
      expect(client.baseUri).toBe('https://sdk.launchdarkly.com')
      expect(client.timeout).toBe(5000)
    })

    it('should support offline mode', () => {
      const client = createClient('sdk-key-123', { offline: true })
      expect(client.offline).toBe(true)
    })

    it('should emit ready event when initialized', async () => {
      const client = createTestClient()
      const readyCallback = vi.fn()
      client.on('ready', readyCallback)

      await client.waitForInitialization()
      expect(readyCallback).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Boolean Flags
  // ===========================================================================

  describe('Boolean Flags', () => {
    it('should evaluate simple boolean flag', async () => {
      const client = createTestClient({
        flags: {
          'feature-enabled': { value: true },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const result = await client.variation('feature-enabled', user, false)

      expect(result).toBe(true)
    })

    it('should return default value for unknown flag', async () => {
      const client = createTestClient()
      const user: LDUser = { key: 'user-123' }

      const result = await client.variation('unknown-flag', user, false)
      expect(result).toBe(false)
    })

    it('should return default value when flag is off', async () => {
      const client = createTestClient({
        flags: {
          'feature-off': { value: true, on: false },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const result = await client.variation('feature-off', user, false)

      expect(result).toBe(false)
    })

    it('should support boolVariation for type safety', async () => {
      const client = createTestClient({
        flags: {
          'bool-flag': { value: true },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const result = await client.boolVariation('bool-flag', user, false)

      expect(typeof result).toBe('boolean')
      expect(result).toBe(true)
    })
  })

  // ===========================================================================
  // String Flags
  // ===========================================================================

  describe('String Flags', () => {
    it('should evaluate string flag', async () => {
      const client = createTestClient({
        flags: {
          'button-color': { value: 'blue' },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const result = await client.variation('button-color', user, 'gray')

      expect(result).toBe('blue')
    })

    it('should support stringVariation for type safety', async () => {
      const client = createTestClient({
        flags: {
          'message': { value: 'Hello World' },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const result = await client.stringVariation('message', user, 'default')

      expect(typeof result).toBe('string')
      expect(result).toBe('Hello World')
    })
  })

  // ===========================================================================
  // Number Flags
  // ===========================================================================

  describe('Number Flags', () => {
    it('should evaluate number flag', async () => {
      const client = createTestClient({
        flags: {
          'max-items': { value: 100 },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const result = await client.variation('max-items', user, 10)

      expect(result).toBe(100)
    })

    it('should support numberVariation for type safety', async () => {
      const client = createTestClient({
        flags: {
          'rate-limit': { value: 1000 },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const result = await client.numberVariation('rate-limit', user, 100)

      expect(typeof result).toBe('number')
      expect(result).toBe(1000)
    })
  })

  // ===========================================================================
  // JSON Flags
  // ===========================================================================

  describe('JSON Flags', () => {
    it('should evaluate JSON flag', async () => {
      const client = createTestClient({
        flags: {
          'config': {
            value: {
              theme: 'dark',
              features: ['a', 'b'],
              nested: { key: 'value' },
            },
          },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const result = await client.variation('config', user, {})

      expect(result).toEqual({
        theme: 'dark',
        features: ['a', 'b'],
        nested: { key: 'value' },
      })
    })

    it('should support jsonVariation for type safety', async () => {
      interface Config {
        maxRetries: number
        timeout: number
      }

      const client = createTestClient({
        flags: {
          'api-config': {
            value: { maxRetries: 3, timeout: 5000 },
          },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const result = await client.jsonVariation<Config>('api-config', user, {
        maxRetries: 1,
        timeout: 1000,
      })

      expect(result.maxRetries).toBe(3)
      expect(result.timeout).toBe(5000)
    })
  })

  // ===========================================================================
  // User Targeting
  // ===========================================================================

  describe('User Targeting', () => {
    it('should target specific user by key', async () => {
      const client = createTestClient({
        flags: {
          'beta-feature': {
            value: false,
            targets: [
              { values: ['user-123', 'user-456'], variation: 0 },
            ],
            variations: [true, false],
          },
        },
      })

      const targetedUser: LDUser = { key: 'user-123' }
      const normalUser: LDUser = { key: 'user-789' }

      expect(await client.variation('beta-feature', targetedUser, false)).toBe(true)
      expect(await client.variation('beta-feature', normalUser, false)).toBe(false)
    })

    it('should target users by custom attribute', async () => {
      const client = createTestClient({
        flags: {
          'enterprise-feature': {
            value: false,
            rules: [
              {
                clauses: [
                  { attribute: 'plan', op: 'in', values: ['enterprise', 'business'] },
                ],
                variation: 0,
              },
            ],
            variations: [true, false],
          },
        },
      })

      const enterpriseUser: LDUser = { key: 'user-123', custom: { plan: 'enterprise' } }
      const freeUser: LDUser = { key: 'user-456', custom: { plan: 'free' } }

      expect(await client.variation('enterprise-feature', enterpriseUser, false)).toBe(true)
      expect(await client.variation('enterprise-feature', freeUser, false)).toBe(false)
    })

    it('should target users by built-in attributes', async () => {
      const client = createTestClient({
        flags: {
          'us-only': {
            value: false,
            rules: [
              {
                clauses: [
                  { attribute: 'country', op: 'in', values: ['US', 'CA'] },
                ],
                variation: 0,
              },
            ],
            variations: [true, false],
          },
        },
      })

      const usUser: LDUser = { key: 'user-123', country: 'US' }
      const ukUser: LDUser = { key: 'user-456', country: 'UK' }

      expect(await client.variation('us-only', usUser, false)).toBe(true)
      expect(await client.variation('us-only', ukUser, false)).toBe(false)
    })

    it('should support email targeting', async () => {
      const client = createTestClient({
        flags: {
          'internal-users': {
            value: false,
            rules: [
              {
                clauses: [
                  { attribute: 'email', op: 'endsWith', values: ['@company.com'] },
                ],
                variation: 0,
              },
            ],
            variations: [true, false],
          },
        },
      })

      const internalUser: LDUser = { key: 'user-123', email: 'alice@company.com' }
      const externalUser: LDUser = { key: 'user-456', email: 'bob@gmail.com' }

      expect(await client.variation('internal-users', internalUser, false)).toBe(true)
      expect(await client.variation('internal-users', externalUser, false)).toBe(false)
    })

    it('should support anonymous users', async () => {
      const client = createTestClient({
        flags: {
          'feature': { value: true },
        },
      })

      const anonymousUser: LDUser = { key: 'anon-123', anonymous: true }
      const result = await client.variation('feature', anonymousUser, false)

      expect(result).toBe(true)
    })
  })

  // ===========================================================================
  // Targeting Rule Operators
  // ===========================================================================

  describe('Targeting Rule Operators', () => {
    it('should support "in" operator', async () => {
      const client = createTestClient({
        flags: {
          'flag': {
            value: false,
            rules: [
              {
                clauses: [{ attribute: 'role', op: 'in', values: ['admin', 'moderator'] }],
                variation: 0,
              },
            ],
            variations: [true, false],
          },
        },
      })

      const admin: LDUser = { key: 'u1', custom: { role: 'admin' } }
      const user: LDUser = { key: 'u2', custom: { role: 'user' } }

      expect(await client.variation('flag', admin, false)).toBe(true)
      expect(await client.variation('flag', user, false)).toBe(false)
    })

    it('should support "contains" operator', async () => {
      const client = createTestClient({
        flags: {
          'flag': {
            value: false,
            rules: [
              {
                clauses: [{ attribute: 'email', op: 'contains', values: ['@test'] }],
                variation: 0,
              },
            ],
            variations: [true, false],
          },
        },
      })

      const testUser: LDUser = { key: 'u1', email: 'user@test.com' }
      const prodUser: LDUser = { key: 'u2', email: 'user@prod.com' }

      expect(await client.variation('flag', testUser, false)).toBe(true)
      expect(await client.variation('flag', prodUser, false)).toBe(false)
    })

    it('should support "startsWith" operator', async () => {
      const client = createTestClient({
        flags: {
          'flag': {
            value: false,
            rules: [
              {
                clauses: [{ attribute: 'key', op: 'startsWith', values: ['beta-'] }],
                variation: 0,
              },
            ],
            variations: [true, false],
          },
        },
      })

      const betaUser: LDUser = { key: 'beta-user-123' }
      const normalUser: LDUser = { key: 'user-123' }

      expect(await client.variation('flag', betaUser, false)).toBe(true)
      expect(await client.variation('flag', normalUser, false)).toBe(false)
    })

    it('should support "endsWith" operator', async () => {
      const client = createTestClient({
        flags: {
          'flag': {
            value: false,
            rules: [
              {
                clauses: [{ attribute: 'email', op: 'endsWith', values: ['.gov'] }],
                variation: 0,
              },
            ],
            variations: [true, false],
          },
        },
      })

      const govUser: LDUser = { key: 'u1', email: 'user@agency.gov' }
      const comUser: LDUser = { key: 'u2', email: 'user@company.com' }

      expect(await client.variation('flag', govUser, false)).toBe(true)
      expect(await client.variation('flag', comUser, false)).toBe(false)
    })

    it('should support "matches" (regex) operator', async () => {
      const client = createTestClient({
        flags: {
          'flag': {
            value: false,
            rules: [
              {
                clauses: [{ attribute: 'key', op: 'matches', values: ['^test-\\d+$'] }],
                variation: 0,
              },
            ],
            variations: [true, false],
          },
        },
      })

      const matchingUser: LDUser = { key: 'test-123' }
      const nonMatchingUser: LDUser = { key: 'test-abc' }

      expect(await client.variation('flag', matchingUser, false)).toBe(true)
      expect(await client.variation('flag', nonMatchingUser, false)).toBe(false)
    })

    it('should support "lessThan" operator', async () => {
      const client = createTestClient({
        flags: {
          'flag': {
            value: false,
            rules: [
              {
                clauses: [{ attribute: 'age', op: 'lessThan', values: [18] }],
                variation: 0,
              },
            ],
            variations: [true, false],
          },
        },
      })

      const minor: LDUser = { key: 'u1', custom: { age: 15 } }
      const adult: LDUser = { key: 'u2', custom: { age: 25 } }

      expect(await client.variation('flag', minor, false)).toBe(true)
      expect(await client.variation('flag', adult, false)).toBe(false)
    })

    it('should support "greaterThan" operator', async () => {
      const client = createTestClient({
        flags: {
          'flag': {
            value: false,
            rules: [
              {
                clauses: [{ attribute: 'score', op: 'greaterThan', values: [100] }],
                variation: 0,
              },
            ],
            variations: [true, false],
          },
        },
      })

      const highScorer: LDUser = { key: 'u1', custom: { score: 150 } }
      const lowScorer: LDUser = { key: 'u2', custom: { score: 50 } }

      expect(await client.variation('flag', highScorer, false)).toBe(true)
      expect(await client.variation('flag', lowScorer, false)).toBe(false)
    })

    it('should support "semVerEqual" operator', async () => {
      const client = createTestClient({
        flags: {
          'flag': {
            value: false,
            rules: [
              {
                clauses: [{ attribute: 'appVersion', op: 'semVerEqual', values: ['2.0.0'] }],
                variation: 0,
              },
            ],
            variations: [true, false],
          },
        },
      })

      const v2User: LDUser = { key: 'u1', custom: { appVersion: '2.0.0' } }
      const v1User: LDUser = { key: 'u2', custom: { appVersion: '1.9.9' } }

      expect(await client.variation('flag', v2User, false)).toBe(true)
      expect(await client.variation('flag', v1User, false)).toBe(false)
    })

    it('should support "semVerGreaterThan" operator', async () => {
      const client = createTestClient({
        flags: {
          'flag': {
            value: false,
            rules: [
              {
                clauses: [{ attribute: 'appVersion', op: 'semVerGreaterThan', values: ['2.0.0'] }],
                variation: 0,
              },
            ],
            variations: [true, false],
          },
        },
      })

      const newUser: LDUser = { key: 'u1', custom: { appVersion: '2.1.0' } }
      const oldUser: LDUser = { key: 'u2', custom: { appVersion: '1.9.9' } }

      expect(await client.variation('flag', newUser, false)).toBe(true)
      expect(await client.variation('flag', oldUser, false)).toBe(false)
    })
  })

  // ===========================================================================
  // Percentage Rollouts
  // ===========================================================================

  describe('Percentage Rollouts', () => {
    it('should support percentage rollout', async () => {
      const client = createTestClient({
        flags: {
          'gradual-rollout': {
            value: false,
            fallthrough: {
              rollout: {
                variations: [
                  { variation: 0, weight: 20000 }, // 20%
                  { variation: 1, weight: 80000 }, // 80%
                ],
              },
            },
            variations: [true, false],
          },
        },
      })

      // Test deterministic rollout - same user always gets same result
      const user: LDUser = { key: 'user-123' }
      const result1 = await client.variation('gradual-rollout', user, false)
      const result2 = await client.variation('gradual-rollout', user, false)

      expect(result1).toBe(result2) // Deterministic
    })

    it('should distribute users according to percentages', async () => {
      const client = createTestClient({
        flags: {
          'rollout': {
            value: false,
            fallthrough: {
              rollout: {
                variations: [
                  { variation: 0, weight: 50000 }, // 50%
                  { variation: 1, weight: 50000 }, // 50%
                ],
              },
            },
            variations: [true, false],
          },
        },
      })

      // Test distribution with many users
      let trueCount = 0
      let falseCount = 0

      for (let i = 0; i < 1000; i++) {
        const user: LDUser = { key: `user-${i}` }
        const result = await client.variation('rollout', user, false)
        if (result === true) trueCount++
        else falseCount++
      }

      // Should be roughly 50/50 (allow 10% tolerance)
      expect(trueCount).toBeGreaterThan(400)
      expect(trueCount).toBeLessThan(600)
    })

    it('should support rollout by custom bucket attribute', async () => {
      const client = createTestClient({
        flags: {
          'rollout': {
            value: false,
            fallthrough: {
              rollout: {
                bucketBy: 'company',
                variations: [
                  { variation: 0, weight: 50000 },
                  { variation: 1, weight: 50000 },
                ],
              },
            },
            variations: [true, false],
          },
        },
      })

      // Users from same company should get same result
      const user1: LDUser = { key: 'user-1', custom: { company: 'acme' } }
      const user2: LDUser = { key: 'user-2', custom: { company: 'acme' } }

      const result1 = await client.variation('rollout', user1, false)
      const result2 = await client.variation('rollout', user2, false)

      expect(result1).toBe(result2)
    })
  })

  // ===========================================================================
  // Rule-based Targeting with Rollouts
  // ===========================================================================

  describe('Rule-based Targeting with Rollouts', () => {
    it('should support percentage rollout within a rule', async () => {
      const client = createTestClient({
        flags: {
          'flag': {
            value: false,
            rules: [
              {
                clauses: [{ attribute: 'plan', op: 'in', values: ['premium'] }],
                rollout: {
                  variations: [
                    { variation: 0, weight: 50000 },
                    { variation: 1, weight: 50000 },
                  ],
                },
              },
            ],
            variations: [true, false],
          },
        },
      })

      const premiumUser: LDUser = { key: 'user-123', custom: { plan: 'premium' } }
      const freeUser: LDUser = { key: 'user-456', custom: { plan: 'free' } }

      // Premium user gets rollout
      const premiumResult = await client.variation('flag', premiumUser, false)
      expect(typeof premiumResult).toBe('boolean')

      // Free user gets default (fallthrough)
      const freeResult = await client.variation('flag', freeUser, false)
      expect(freeResult).toBe(false)
    })
  })

  // ===========================================================================
  // Multi-variate Flags
  // ===========================================================================

  describe('Multi-variate Flags', () => {
    it('should support multiple variations', async () => {
      const client = createTestClient({
        flags: {
          'button-color': {
            value: 'gray',
            targets: [
              { values: ['user-1'], variation: 0 },
              { values: ['user-2'], variation: 1 },
              { values: ['user-3'], variation: 2 },
            ],
            variations: ['red', 'blue', 'green'],
          },
        },
      })

      expect(await client.variation('button-color', { key: 'user-1' }, 'gray')).toBe('red')
      expect(await client.variation('button-color', { key: 'user-2' }, 'gray')).toBe('blue')
      expect(await client.variation('button-color', { key: 'user-3' }, 'gray')).toBe('green')
    })
  })

  // ===========================================================================
  // Evaluation Details
  // ===========================================================================

  describe('Evaluation Details', () => {
    it('should return evaluation details with variationDetail', async () => {
      const client = createTestClient({
        flags: {
          'feature': { value: true },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const detail = await client.variationDetail('feature', user, false)

      expect(detail).toHaveProperty('value')
      expect(detail).toHaveProperty('variationIndex')
      expect(detail).toHaveProperty('reason')
      expect(detail.value).toBe(true)
    })

    it('should return FALLTHROUGH reason for default evaluation', async () => {
      const client = createTestClient({
        flags: {
          'feature': { value: true },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const detail = await client.variationDetail('feature', user, false)

      expect(detail.reason.kind).toBe('FALLTHROUGH')
    })

    it('should return TARGET_MATCH reason for targeted users', async () => {
      const client = createTestClient({
        flags: {
          'feature': {
            value: false,
            targets: [{ values: ['user-123'], variation: 0 }],
            variations: [true, false],
          },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const detail = await client.variationDetail('feature', user, false)

      expect(detail.reason.kind).toBe('TARGET_MATCH')
    })

    it('should return RULE_MATCH reason for rule matches', async () => {
      const client = createTestClient({
        flags: {
          'feature': {
            value: false,
            rules: [
              {
                id: 'rule-1',
                clauses: [{ attribute: 'plan', op: 'in', values: ['premium'] }],
                variation: 0,
              },
            ],
            variations: [true, false],
          },
        },
      })

      const user: LDUser = { key: 'user-123', custom: { plan: 'premium' } }
      const detail = await client.variationDetail('feature', user, false)

      expect(detail.reason.kind).toBe('RULE_MATCH')
      expect(detail.reason.ruleId).toBe('rule-1')
    })

    it('should return OFF reason when flag is off', async () => {
      const client = createTestClient({
        flags: {
          'feature': { value: true, on: false },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const detail = await client.variationDetail('feature', user, false)

      expect(detail.reason.kind).toBe('OFF')
    })

    it('should return ERROR reason for unknown flags', async () => {
      const client = createTestClient()

      const user: LDUser = { key: 'user-123' }
      const detail = await client.variationDetail('unknown-flag', user, false)

      expect(detail.reason.kind).toBe('ERROR')
      expect(detail.reason.errorKind).toBe('FLAG_NOT_FOUND')
    })
  })

  // ===========================================================================
  // Flag Dependencies (Prerequisites)
  // ===========================================================================

  describe('Flag Dependencies (Prerequisites)', () => {
    it('should support flag prerequisites', async () => {
      const client = createTestClient({
        flags: {
          'parent-flag': { value: true },
          'child-flag': {
            value: true,
            prerequisites: [
              { key: 'parent-flag', variation: 0 },
            ],
            variations: [true, false],
          },
        },
      })

      const user: LDUser = { key: 'user-123' }

      // Child flag should evaluate when prerequisite is met
      const result = await client.variation('child-flag', user, false)
      expect(result).toBe(true)
    })

    it('should return off variation when prerequisite not met', async () => {
      const client = createTestClient({
        flags: {
          'parent-flag': { value: false, variations: [true, false] },
          'child-flag': {
            value: true,
            prerequisites: [
              { key: 'parent-flag', variation: 0 }, // Requires parent to be true
            ],
            offVariation: 1,
            variations: [true, false],
          },
        },
      })

      const user: LDUser = { key: 'user-123' }

      // Child flag should return off variation when prerequisite not met
      const result = await client.variation('child-flag', user, true)
      expect(result).toBe(false)
    })

    it('should return PREREQUISITE_FAILED reason when prerequisite not met', async () => {
      const client = createTestClient({
        flags: {
          'parent-flag': { value: false, variations: [true, false] },
          'child-flag': {
            value: true,
            prerequisites: [{ key: 'parent-flag', variation: 0 }],
            offVariation: 1,
            variations: [true, false],
          },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const detail = await client.variationDetail('child-flag', user, true)

      expect(detail.reason.kind).toBe('PREREQUISITE_FAILED')
      expect(detail.reason.prerequisiteKey).toBe('parent-flag')
    })
  })

  // ===========================================================================
  // A/B Testing (Experiments)
  // ===========================================================================

  describe('A/B Testing (Experiments)', () => {
    it('should assign users to experiment variants', async () => {
      const client = createTestClient({
        flags: {
          'checkout-experiment': {
            value: 'control',
            trackEvents: true,
            trackEventsFallthrough: true,
            fallthrough: {
              rollout: {
                kind: 'experiment',
                variations: [
                  { variation: 0, weight: 50000 },
                  { variation: 1, weight: 50000 },
                ],
              },
            },
            variations: ['control', 'variant-a'],
          },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const result = await client.variation('checkout-experiment', user, 'control')

      expect(['control', 'variant-a']).toContain(result)
    })

    it('should report inExperiment in evaluation reason', async () => {
      const client = createTestClient({
        flags: {
          'experiment': {
            value: 'control',
            trackEvents: true,
            fallthrough: {
              rollout: {
                kind: 'experiment',
                variations: [
                  { variation: 0, weight: 50000 },
                  { variation: 1, weight: 50000 },
                ],
              },
            },
            variations: ['control', 'variant'],
          },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const detail = await client.variationDetail('experiment', user, 'control')

      expect(detail.reason.inExperiment).toBe(true)
    })

    it('should track experiment events', async () => {
      const client = createTestClient({
        flags: {
          'experiment': {
            value: 'control',
            trackEvents: true,
            variations: ['control', 'variant'],
          },
        },
      })

      const trackCallback = vi.fn()
      client.on('event', trackCallback)

      const user: LDUser = { key: 'user-123' }
      await client.variation('experiment', user, 'control')

      // Event should be tracked
      expect(trackCallback).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // All Flags
  // ===========================================================================

  describe('All Flags', () => {
    it('should return all flags with allFlagsState', async () => {
      const client = createTestClient({
        flags: {
          'flag-1': { value: true },
          'flag-2': { value: 'hello' },
          'flag-3': { value: 42 },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const state = await client.allFlagsState(user)

      expect(state.toJSON()).toEqual({
        'flag-1': true,
        'flag-2': 'hello',
        'flag-3': 42,
      })
    })

    it('should include metadata in allFlagsState', async () => {
      const client = createTestClient({
        flags: {
          'flag': { value: true, version: 5 },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const state = await client.allFlagsState(user, { withReasons: true })

      const json = state.toJSON()
      expect(json.$flagsState).toBeDefined()
      expect(json.$flagsState['flag'].version).toBe(5)
    })

    it('should filter client-side flags', async () => {
      const client = createTestClient({
        flags: {
          'client-flag': { value: true, clientSideAvailability: { usingEnvironmentId: true } },
          'server-flag': { value: false, clientSideAvailability: { usingEnvironmentId: false } },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const state = await client.allFlagsState(user, { clientSideOnly: true })

      const json = state.toJSON()
      expect(json['client-flag']).toBe(true)
      expect(json['server-flag']).toBeUndefined()
    })
  })

  // ===========================================================================
  // Context (Multi-context)
  // ===========================================================================

  describe('Context (Multi-context)', () => {
    it('should support multi-context evaluation', async () => {
      const client = createTestClient({
        flags: {
          'org-feature': {
            value: false,
            rules: [
              {
                clauses: [
                  { contextKind: 'organization', attribute: 'plan', op: 'in', values: ['enterprise'] },
                ],
                variation: 0,
              },
            ],
            variations: [true, false],
          },
        },
      })

      const context: LDContext = {
        kind: 'multi',
        user: { key: 'user-123' },
        organization: { key: 'org-456', plan: 'enterprise' },
      }

      const result = await client.variation('org-feature', context, false)
      expect(result).toBe(true)
    })

    it('should support single-kind context', async () => {
      const client = createTestClient({
        flags: {
          'feature': { value: true },
        },
      })

      const context: LDContext = {
        kind: 'user',
        key: 'user-123',
        name: 'Alice',
      }

      const result = await client.variation('feature', context, false)
      expect(result).toBe(true)
    })
  })

  // ===========================================================================
  // Events
  // ===========================================================================

  describe('Events', () => {
    it('should track custom events', async () => {
      const client = createTestClient()
      const eventCallback = vi.fn()
      client.on('event', eventCallback)

      const user: LDUser = { key: 'user-123' }
      client.track('purchase', user, { amount: 99.99 })

      expect(eventCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'custom',
          key: 'purchase',
          user: expect.objectContaining({ key: 'user-123' }),
          data: { amount: 99.99 },
        })
      )
    })

    it('should track metric value for experiments', async () => {
      const client = createTestClient()
      const eventCallback = vi.fn()
      client.on('event', eventCallback)

      const user: LDUser = { key: 'user-123' }
      client.track('revenue', user, { item: 'widget' }, 99.99)

      expect(eventCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'custom',
          key: 'revenue',
          metricValue: 99.99,
        })
      )
    })

    it('should identify users', async () => {
      const client = createTestClient()
      const eventCallback = vi.fn()
      client.on('event', eventCallback)

      const user: LDUser = { key: 'user-123', name: 'Alice' }
      client.identify(user)

      expect(eventCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'identify',
          user: expect.objectContaining({ key: 'user-123' }),
        })
      )
    })
  })

  // ===========================================================================
  // Flag History (TemporalStore Integration)
  // ===========================================================================

  describe('Flag History (TemporalStore Integration)', () => {
    it('should store flag evaluation history', async () => {
      const client = createTestClient({
        flags: {
          'feature': { value: true },
        },
        enableHistory: true,
      })

      const user: LDUser = { key: 'user-123' }

      // Evaluate flag
      await client.variation('feature', user, false)

      // Get history
      const history = await client.getEvaluationHistory('feature', user.key)
      expect(history).toHaveLength(1)
      expect(history[0]).toMatchObject({
        flagKey: 'feature',
        userKey: 'user-123',
        value: true,
      })
    })

    it('should get flag value at specific point in time', async () => {
      const client = createTestClient({
        flags: {
          'feature': { value: true },
        },
        enableHistory: true,
      })

      const user: LDUser = { key: 'user-123' }
      const timestamp = Date.now()

      await client.variation('feature', user, false)

      const value = await client.getValueAsOf('feature', user.key, timestamp)
      expect(value).toBe(true)
    })
  })

  // ===========================================================================
  // Analytics Aggregation (WindowManager Integration)
  // ===========================================================================

  describe('Analytics Aggregation (WindowManager Integration)', () => {
    it('should aggregate flag evaluations by time window', async () => {
      const client = createTestClient({
        flags: {
          'feature': { value: true },
        },
        enableAnalytics: true,
      })

      // Simulate many evaluations
      for (let i = 0; i < 100; i++) {
        const user: LDUser = { key: `user-${i}` }
        await client.variation('feature', user, false)
      }

      const stats = await client.getEvaluationStats('feature')
      expect(stats.totalEvaluations).toBe(100)
      expect(stats.uniqueUsers).toBe(100)
    })

    it('should track variation distribution', async () => {
      const client = createTestClient({
        flags: {
          'rollout': {
            value: false,
            fallthrough: {
              rollout: {
                variations: [
                  { variation: 0, weight: 50000 },
                  { variation: 1, weight: 50000 },
                ],
              },
            },
            variations: [true, false],
          },
        },
        enableAnalytics: true,
      })

      for (let i = 0; i < 100; i++) {
        const user: LDUser = { key: `user-${i}` }
        await client.variation('rollout', user, false)
      }

      const stats = await client.getEvaluationStats('rollout')
      expect(stats.variationCounts).toBeDefined()
      expect(stats.variationCounts[0]).toBeGreaterThan(30)
      expect(stats.variationCounts[1]).toBeGreaterThan(30)
    })
  })

  // ===========================================================================
  // Flag Management
  // ===========================================================================

  describe('Flag Management', () => {
    it('should update flag configuration', async () => {
      const client = createTestClient({
        flags: {
          'feature': { value: true },
        },
      })

      const user: LDUser = { key: 'user-123' }

      // Initial value
      expect(await client.variation('feature', user, false)).toBe(true)

      // Update flag
      client.setFlag('feature', { value: false })

      // New value
      expect(await client.variation('feature', user, true)).toBe(false)
    })

    it('should emit update event when flag changes', async () => {
      const client = createTestClient({
        flags: {
          'feature': { value: true },
        },
      })

      const updateCallback = vi.fn()
      client.on('update', updateCallback)

      client.setFlag('feature', { value: false })

      expect(updateCallback).toHaveBeenCalledWith({
        key: 'feature',
      })
    })

    it('should delete flag', async () => {
      const client = createTestClient({
        flags: {
          'feature': { value: true },
        },
      })

      client.deleteFlag('feature')

      const user: LDUser = { key: 'user-123' }
      const result = await client.variation('feature', user, false)
      expect(result).toBe(false) // Default value
    })
  })

  // ===========================================================================
  // Flush and Close
  // ===========================================================================

  describe('Flush and Close', () => {
    it('should flush pending events', async () => {
      const client = createTestClient()

      const user: LDUser = { key: 'user-123' }
      client.track('event-1', user)
      client.track('event-2', user)

      await client.flush()
      // No error means success
    })

    it('should close client and stop processing', async () => {
      const client = createTestClient()

      await client.close()

      // Client should be closed
      expect(client.isOffline()).toBe(true)
    })
  })

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('should handle invalid user gracefully', async () => {
      const client = createTestClient({
        flags: {
          'feature': { value: true },
        },
      })

      // @ts-expect-error - Testing invalid input
      const result = await client.variation('feature', null, false)
      expect(result).toBe(false) // Default value
    })

    it('should emit error event on evaluation failure', async () => {
      const client = createTestClient()
      const errorCallback = vi.fn()
      client.on('error', errorCallback)

      // @ts-expect-error - Testing invalid input
      await client.variation('feature', {}, false)

      expect(errorCallback).toHaveBeenCalled()
    })
  })
})
