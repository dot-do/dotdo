/**
 * @dotdo/flags - Feature Flags Package Tests
 *
 * TDD RED phase: Tests written first. These should FAIL until implementation is complete.
 *
 * This package provides a LaunchDarkly-compatible feature flags SDK with:
 * - In-memory storage backend (no external dependencies)
 * - Boolean, string, number, and JSON flag types
 * - User targeting and rule-based evaluation
 * - Percentage rollouts for gradual releases
 * - A/B experiment support
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  // Client factory
  createClient,
  createTestClient,

  // Core evaluation
  evaluateFlag,

  // Types
  type LDUser,
  type LDContext,
  type LDFlagValue,
  type LDEvaluationDetail,
  type FeatureFlag,
  type FlagStore,
} from '../src'

describe('@dotdo/flags - Feature Flags Package', () => {
  // ===========================================================================
  // Basic Flag Evaluation
  // ===========================================================================

  describe('Basic Flag Evaluation', () => {
    it('should create a test client with flags', () => {
      const client = createTestClient({
        flags: {
          'my-flag': { value: true },
        },
      })

      expect(client).toBeDefined()
    })

    it('should evaluate boolean flag to true', async () => {
      const client = createTestClient({
        flags: {
          'feature-enabled': { value: true },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const result = await client.variation('feature-enabled', user, false)

      expect(result).toBe(true)
    })

    it('should evaluate boolean flag to false', async () => {
      const client = createTestClient({
        flags: {
          'feature-disabled': { value: false },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const result = await client.variation('feature-disabled', user, true)

      expect(result).toBe(false)
    })

    it('should return default value for unknown flag', async () => {
      const client = createTestClient()

      const user: LDUser = { key: 'user-123' }
      const result = await client.variation('unknown-flag', user, 'default-value')

      expect(result).toBe('default-value')
    })

    it('should return default when flag is off', async () => {
      const client = createTestClient({
        flags: {
          'disabled-flag': { value: true, on: false },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const result = await client.variation('disabled-flag', user, false)

      expect(result).toBe(false)
    })
  })

  // ===========================================================================
  // String Flags
  // ===========================================================================

  describe('String Flags', () => {
    it('should evaluate string flag', async () => {
      const client = createTestClient({
        flags: {
          'theme': { value: 'dark' },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const result = await client.variation('theme', user, 'light')

      expect(result).toBe('dark')
    })

    it('should support stringVariation helper', async () => {
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

    it('should support numberVariation helper', async () => {
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
            },
          },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const result = await client.variation('config', user, {})

      expect(result).toEqual({
        theme: 'dark',
        features: ['a', 'b'],
      })
    })

    it('should support jsonVariation helper', async () => {
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

    it('should return ERROR reason for unknown flag', async () => {
      const client = createTestClient()

      const user: LDUser = { key: 'user-123' }
      const detail = await client.variationDetail('unknown', user, false)

      expect(detail.reason.kind).toBe('ERROR')
      expect(detail.reason.errorKind).toBe('FLAG_NOT_FOUND')
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
  })

  // ===========================================================================
  // Rule Operators
  // ===========================================================================

  describe('Rule Operators', () => {
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
                clauses: [{ attribute: 'email', op: 'contains', values: ['@acme.com'] }],
                variation: 0,
              },
            ],
            variations: [true, false],
          },
        },
      })

      const acmeUser: LDUser = { key: 'u1', email: 'alice@acme.com' }
      const otherUser: LDUser = { key: 'u2', email: 'bob@gmail.com' }

      expect(await client.variation('flag', acmeUser, false)).toBe(true)
      expect(await client.variation('flag', otherUser, false)).toBe(false)
    })

    it('should support "startsWith" operator', async () => {
      const client = createTestClient({
        flags: {
          'flag': {
            value: false,
            rules: [
              {
                clauses: [{ attribute: 'key', op: 'startsWith', values: ['test-'] }],
                variation: 0,
              },
            ],
            variations: [true, false],
          },
        },
      })

      const testUser: LDUser = { key: 'test-user-123' }
      const prodUser: LDUser = { key: 'prod-user-456' }

      expect(await client.variation('flag', testUser, false)).toBe(true)
      expect(await client.variation('flag', prodUser, false)).toBe(false)
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

    it('should support "matches" regex operator', async () => {
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

    it('should return RULE_MATCH reason when rule matches', async () => {
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
  })

  // ===========================================================================
  // Percentage Rollouts
  // ===========================================================================

  describe('Percentage Rollouts', () => {
    it('should be deterministic for same user', async () => {
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
      })

      const user: LDUser = { key: 'user-123' }
      const result1 = await client.variation('rollout', user, false)
      const result2 = await client.variation('rollout', user, false)

      expect(result1).toBe(result2)
    })

    it('should distribute users according to percentages', async () => {
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
      })

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

    it('should support custom bucket attribute', async () => {
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
  // A/B Experiments
  // ===========================================================================

  describe('A/B Experiments', () => {
    it('should assign users to experiment variants', async () => {
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
            variations: ['control', 'variant-a'],
          },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const result = await client.variation('experiment', user, 'control')

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
  })

  // ===========================================================================
  // Flag Prerequisites
  // ===========================================================================

  describe('Flag Prerequisites', () => {
    it('should evaluate prerequisite flags', async () => {
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
      const result = await client.variation('child-flag', user, false)

      expect(result).toBe(true)
    })

    it('should return off when prerequisite not met', async () => {
      const client = createTestClient({
        flags: {
          'parent-flag': { value: false, variations: [true, false] },
          'child-flag': {
            value: true,
            prerequisites: [
              { key: 'parent-flag', variation: 0 },
            ],
            offVariation: 1,
            variations: [true, false],
          },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const result = await client.variation('child-flag', user, true)

      expect(result).toBe(false)
    })

    it('should return PREREQUISITE_FAILED reason', async () => {
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
  // Multi-context
  // ===========================================================================

  describe('Multi-context', () => {
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
  })

  // ===========================================================================
  // In-Memory Store
  // ===========================================================================

  describe('In-Memory Store', () => {
    it('should support setting flags after creation', async () => {
      const client = createTestClient()

      client.setFlag('new-flag', { value: 'hello' })

      const user: LDUser = { key: 'user-123' }
      const result = await client.variation('new-flag', user, 'default')

      expect(result).toBe('hello')
    })

    it('should support updating flags', async () => {
      const client = createTestClient({
        flags: {
          'feature': { value: true },
        },
      })

      const user: LDUser = { key: 'user-123' }

      expect(await client.variation('feature', user, false)).toBe(true)

      client.setFlag('feature', { value: false })

      expect(await client.variation('feature', user, true)).toBe(false)
    })

    it('should support deleting flags', async () => {
      const client = createTestClient({
        flags: {
          'feature': { value: true },
        },
      })

      client.deleteFlag('feature')

      const user: LDUser = { key: 'user-123' }
      const result = await client.variation('feature', user, false)
      expect(result).toBe(false)
    })

    it('should emit update event on flag change', async () => {
      const client = createTestClient({
        flags: {
          'feature': { value: true },
        },
      })

      const updateCallback = vi.fn()
      client.on('update', updateCallback)

      client.setFlag('feature', { value: false })

      expect(updateCallback).toHaveBeenCalledWith({ key: 'feature' })
    })
  })

  // ===========================================================================
  // All Flags State
  // ===========================================================================

  describe('All Flags State', () => {
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

    it('should get individual flag value', async () => {
      const client = createTestClient({
        flags: {
          'flag-1': { value: 'test' },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const state = await client.allFlagsState(user)

      expect(state.getFlagValue('flag-1')).toBe('test')
    })

    it('should include metadata with withReasons option', async () => {
      const client = createTestClient({
        flags: {
          'flag': { value: true, version: 5 },
        },
      })

      const user: LDUser = { key: 'user-123' }
      const state = await client.allFlagsState(user, { withReasons: true })

      const json = state.toJSON()
      expect(json.$flagsState).toBeDefined()
      expect(json.$flagsState!['flag'].version).toBe(5)
    })
  })

  // ===========================================================================
  // Custom Events
  // ===========================================================================

  describe('Custom Events', () => {
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
          data: { amount: 99.99 },
        })
      )
    })

    it('should track metric value', async () => {
      const client = createTestClient()
      const eventCallback = vi.fn()
      client.on('event', eventCallback)

      const user: LDUser = { key: 'user-123' }
      client.track('revenue', user, {}, 99.99)

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
        })
      )
    })
  })

  // ===========================================================================
  // Client Lifecycle
  // ===========================================================================

  describe('Client Lifecycle', () => {
    it('should emit ready event', async () => {
      const client = createTestClient()
      const readyCallback = vi.fn()
      client.on('ready', readyCallback)

      await client.waitForInitialization()
      expect(readyCallback).toHaveBeenCalled()
    })

    it('should flush events', async () => {
      const client = createTestClient()

      const user: LDUser = { key: 'user-123' }
      client.track('event-1', user)
      client.track('event-2', user)

      await client.flush()
      // No error means success
    })

    it('should close client', async () => {
      const client = createTestClient()

      await client.close()

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
      expect(result).toBe(false)
    })

    it('should handle missing user key', async () => {
      const client = createTestClient({
        flags: {
          'feature': { value: true },
        },
      })

      // @ts-expect-error - Testing invalid input
      const detail = await client.variationDetail('feature', {}, false)

      expect(detail.reason.kind).toBe('ERROR')
      expect(detail.reason.errorKind).toBe('USER_NOT_SPECIFIED')
    })
  })
})
