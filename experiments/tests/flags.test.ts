/**
 * Tests for FlagsAPI - Feature flag creation, evaluation, and targeting
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createFlagManager, FeatureFlag } from '../flags'
import type { ExperimentStorage, FeatureFlagDefinition } from '../types'

// Mock storage for testing - same pattern as assignment.test.ts
function createMockStorage(): ExperimentStorage {
  const store = new Map<string, unknown>()

  const storage = {
    get: async <T>(keyOrKeys: string | string[]): Promise<T | Map<string, T> | undefined> => {
      if (typeof keyOrKeys === 'string') {
        return store.get(keyOrKeys) as T | undefined
      }
      const result = new Map<string, T>()
      for (const key of keyOrKeys) {
        const value = store.get(key)
        if (value !== undefined) {
          result.set(key, value as T)
        }
      }
      return result
    },

    put: async <T>(keyOrEntries: string | Map<string, T>, value?: T): Promise<void> => {
      if (typeof keyOrEntries === 'string') {
        store.set(keyOrEntries, value)
      } else {
        for (const [k, v] of keyOrEntries) {
          store.set(k, v)
        }
      }
    },

    delete: async (keyOrKeys: string | string[]): Promise<boolean | number> => {
      if (typeof keyOrKeys === 'string') {
        return store.delete(keyOrKeys)
      }
      let count = 0
      for (const key of keyOrKeys) {
        if (store.delete(key)) count++
      }
      return count
    },

    list: async <T>(options?: { prefix?: string }): Promise<Map<string, T>> => {
      const result = new Map<string, T>()
      const prefix = options?.prefix ?? ''
      for (const [key, value] of store) {
        if (key.startsWith(prefix)) {
          result.set(key, value as T)
        }
      }
      return result
    },
  }

  return storage as unknown as ExperimentStorage
}

describe('createFlagManager', () => {
  let storage: ExperimentStorage
  let flags: ReturnType<typeof createFlagManager>

  beforeEach(() => {
    storage = createMockStorage()
    flags = createFlagManager(storage)
  })

  describe('flag creation', () => {
    it('should create a boolean feature flag', async () => {
      const flag = await flags.create({
        key: 'dark-mode',
        name: 'Dark Mode',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
      })

      expect(flag.key).toBe('dark-mode')
      expect(flag.name).toBe('Dark Mode')
      expect(flag.enabled).toBe(true)
      expect(flag.type).toBe('boolean')
      expect(flag.defaultValue).toBe(false)
      expect(flag.createdAt).toBeDefined()
      expect(flag.updatedAt).toBeDefined()
    })

    it('should create a string feature flag', async () => {
      const flag = await flags.create({
        key: 'theme-color',
        name: 'Theme Color',
        enabled: true,
        type: 'string',
        defaultValue: 'blue',
      })

      expect(flag.key).toBe('theme-color')
      expect(flag.type).toBe('string')
      expect(flag.defaultValue).toBe('blue')
    })

    it('should create a number feature flag', async () => {
      const flag = await flags.create({
        key: 'max-items',
        name: 'Maximum Items',
        enabled: true,
        type: 'number',
        defaultValue: 10,
      })

      expect(flag.key).toBe('max-items')
      expect(flag.type).toBe('number')
      expect(flag.defaultValue).toBe(10)
    })

    it('should create a json feature flag', async () => {
      const flag = await flags.create({
        key: 'config',
        name: 'Feature Config',
        enabled: true,
        type: 'json',
        defaultValue: { limit: 100, enabled: true },
      })

      expect(flag.key).toBe('config')
      expect(flag.type).toBe('json')
      expect(flag.defaultValue).toEqual({ limit: 100, enabled: true })
    })

    it('should update existing flag and preserve createdAt', async () => {
      const original = await flags.create({
        key: 'test-flag',
        name: 'Test Flag',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
      })

      // Wait a bit to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10))

      const updated = await flags.create({
        key: 'test-flag',
        name: 'Updated Test Flag',
        enabled: false,
        type: 'boolean',
        defaultValue: true,
      })

      expect(updated.key).toBe('test-flag')
      expect(updated.name).toBe('Updated Test Flag')
      expect(updated.enabled).toBe(false)
      expect(updated.defaultValue).toBe(true)
      expect(updated.createdAt).toBe(original.createdAt)
      expect(updated.updatedAt).toBeGreaterThanOrEqual(original.updatedAt)
    })

    it('should create flag with targeting rules', async () => {
      const flag = await flags.create({
        key: 'beta-feature',
        name: 'Beta Feature',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
        rules: [
          {
            id: 'beta-users',
            conditions: [{ attribute: 'plan', operator: 'equals', value: 'beta' }],
            value: true,
            priority: 1,
          },
        ],
      })

      expect(flag.rules).toHaveLength(1)
      expect(flag.rules![0].id).toBe('beta-users')
      expect(flag.rules![0].conditions).toHaveLength(1)
    })
  })

  describe('flag retrieval', () => {
    it('should get a flag by key', async () => {
      await flags.create({
        key: 'my-flag',
        name: 'My Flag',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
      })

      const flag = await flags.get('my-flag')

      expect(flag).toBeDefined()
      expect(flag?.key).toBe('my-flag')
    })

    it('should return undefined for non-existent flag', async () => {
      const flag = await flags.get('non-existent')

      expect(flag).toBeUndefined()
    })

    it('should list all flags', async () => {
      await flags.create({
        key: 'flag-1',
        name: 'Flag 1',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
      })

      await flags.create({
        key: 'flag-2',
        name: 'Flag 2',
        enabled: false,
        type: 'string',
        defaultValue: 'default',
      })

      const allFlags = await flags.list()

      expect(allFlags).toHaveLength(2)
      expect(allFlags.map((f) => f.key).sort()).toEqual(['flag-1', 'flag-2'])
    })

    it('should delete a flag', async () => {
      await flags.create({
        key: 'to-delete',
        name: 'To Delete',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
      })

      const deleted = await flags.delete('to-delete')
      expect(deleted).toBe(true)

      const flag = await flags.get('to-delete')
      expect(flag).toBeUndefined()
    })

    it('should return false when deleting non-existent flag', async () => {
      const deleted = await flags.delete('non-existent')
      expect(deleted).toBe(false)
    })
  })

  describe('flag enable/disable', () => {
    it('should enable a flag', async () => {
      await flags.create({
        key: 'toggle-flag',
        name: 'Toggle Flag',
        enabled: false,
        type: 'boolean',
        defaultValue: false,
      })

      await flags.enable('toggle-flag')
      const flag = await flags.get('toggle-flag')

      expect(flag?.enabled).toBe(true)
    })

    it('should disable a flag', async () => {
      await flags.create({
        key: 'toggle-flag',
        name: 'Toggle Flag',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
      })

      await flags.disable('toggle-flag')
      const flag = await flags.get('toggle-flag')

      expect(flag?.enabled).toBe(false)
    })

    it('should update timestamp when enabling/disabling', async () => {
      const original = await flags.create({
        key: 'toggle-flag',
        name: 'Toggle Flag',
        enabled: false,
        type: 'boolean',
        defaultValue: false,
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      await flags.enable('toggle-flag')
      const updated = await flags.get('toggle-flag')

      expect(updated?.updatedAt).toBeGreaterThanOrEqual(original.updatedAt)
    })
  })

  describe('flag evaluation - basic', () => {
    it('should return default value when flag is disabled', async () => {
      await flags.create({
        key: 'disabled-flag',
        name: 'Disabled Flag',
        enabled: false,
        type: 'boolean',
        defaultValue: true,
      })

      const result = await flags.evaluate<boolean>('disabled-flag')

      expect(result.value).toBe(true)
      expect(result.found).toBe(true)
    })

    it('should return default value when flag is enabled with no rules', async () => {
      await flags.create({
        key: 'simple-flag',
        name: 'Simple Flag',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
      })

      const result = await flags.evaluate<boolean>('simple-flag')

      expect(result.value).toBe(false)
      expect(result.found).toBe(true)
    })

    it('should return found=false for non-existent flag', async () => {
      const result = await flags.evaluate('non-existent')

      expect(result.found).toBe(false)
      expect(result.value).toBeUndefined()
    })

    it('should return evaluatedAt timestamp', async () => {
      await flags.create({
        key: 'timed-flag',
        name: 'Timed Flag',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
      })

      const before = Date.now()
      const result = await flags.evaluate('timed-flag')
      const after = Date.now()

      expect(result.evaluatedAt).toBeGreaterThanOrEqual(before)
      expect(result.evaluatedAt).toBeLessThanOrEqual(after)
    })
  })

  describe('flag targeting rules', () => {
    it('should match rule with no conditions (catchall)', async () => {
      await flags.create({
        key: 'catchall-flag',
        name: 'Catchall Flag',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
        rules: [
          {
            id: 'always-on',
            conditions: [],
            value: true,
            priority: 1,
          },
        ],
      })

      const result = await flags.evaluate<boolean>('catchall-flag')

      expect(result.value).toBe(true)
      expect(result.matchedRule).toBe('always-on')
    })

    it('should match rule with equals condition on userId', async () => {
      await flags.create({
        key: 'user-flag',
        name: 'User Flag',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
        rules: [
          {
            id: 'specific-user',
            conditions: [{ attribute: 'userId', operator: 'equals', value: 'user-123' }],
            value: true,
            priority: 1,
          },
        ],
      })

      const resultMatch = await flags.evaluate<boolean>('user-flag', { userId: 'user-123' })
      expect(resultMatch.value).toBe(true)
      expect(resultMatch.matchedRule).toBe('specific-user')

      const resultNoMatch = await flags.evaluate<boolean>('user-flag', { userId: 'user-456' })
      expect(resultNoMatch.value).toBe(false)
      expect(resultNoMatch.matchedRule).toBeUndefined()
    })

    it('should match rule with notEquals condition', async () => {
      await flags.create({
        key: 'exclude-flag',
        name: 'Exclude Flag',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
        rules: [
          {
            id: 'not-admin',
            conditions: [{ attribute: 'role', operator: 'notEquals', value: 'admin' }],
            value: true,
            priority: 1,
          },
        ],
      })

      const resultUser = await flags.evaluate<boolean>('exclude-flag', {
        attributes: { role: 'user' },
      })
      expect(resultUser.value).toBe(true)

      const resultAdmin = await flags.evaluate<boolean>('exclude-flag', {
        attributes: { role: 'admin' },
      })
      expect(resultAdmin.value).toBe(false)
    })

    it('should match rule with contains condition', async () => {
      await flags.create({
        key: 'email-flag',
        name: 'Email Flag',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
        rules: [
          {
            id: 'internal-users',
            conditions: [{ attribute: 'email', operator: 'contains', value: '@company.com' }],
            value: true,
            priority: 1,
          },
        ],
      })

      const resultInternal = await flags.evaluate<boolean>('email-flag', {
        attributes: { email: 'alice@company.com' },
      })
      expect(resultInternal.value).toBe(true)

      const resultExternal = await flags.evaluate<boolean>('email-flag', {
        attributes: { email: 'bob@gmail.com' },
      })
      expect(resultExternal.value).toBe(false)
    })

    it('should match rule with in condition', async () => {
      await flags.create({
        key: 'plan-flag',
        name: 'Plan Flag',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
        rules: [
          {
            id: 'premium-plans',
            conditions: [{ attribute: 'plan', operator: 'in', value: ['pro', 'enterprise'] }],
            value: true,
            priority: 1,
          },
        ],
      })

      const resultPro = await flags.evaluate<boolean>('plan-flag', {
        attributes: { plan: 'pro' },
      })
      expect(resultPro.value).toBe(true)

      const resultEnterprise = await flags.evaluate<boolean>('plan-flag', {
        attributes: { plan: 'enterprise' },
      })
      expect(resultEnterprise.value).toBe(true)

      const resultFree = await flags.evaluate<boolean>('plan-flag', {
        attributes: { plan: 'free' },
      })
      expect(resultFree.value).toBe(false)
    })

    it('should match rule with notIn condition', async () => {
      await flags.create({
        key: 'exclude-plans-flag',
        name: 'Exclude Plans Flag',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
        rules: [
          {
            id: 'not-trial',
            conditions: [{ attribute: 'plan', operator: 'notIn', value: ['trial', 'free'] }],
            value: true,
            priority: 1,
          },
        ],
      })

      const resultPro = await flags.evaluate<boolean>('exclude-plans-flag', {
        attributes: { plan: 'pro' },
      })
      expect(resultPro.value).toBe(true)

      const resultTrial = await flags.evaluate<boolean>('exclude-plans-flag', {
        attributes: { plan: 'trial' },
      })
      expect(resultTrial.value).toBe(false)
    })

    it('should match rule with gte condition', async () => {
      await flags.create({
        key: 'premium-feature',
        name: 'Premium Feature',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
        rules: [
          {
            id: 'high-spend',
            conditions: [{ attribute: 'totalSpend', operator: 'gte', value: 1000 }],
            value: true,
            priority: 1,
          },
        ],
      })

      const resultHighSpend = await flags.evaluate<boolean>('premium-feature', {
        attributes: { totalSpend: 1500 },
      })
      expect(resultHighSpend.value).toBe(true)

      const resultLowSpend = await flags.evaluate<boolean>('premium-feature', {
        attributes: { totalSpend: 500 },
      })
      expect(resultLowSpend.value).toBe(false)
    })

    it('should match rule with lte condition', async () => {
      await flags.create({
        key: 'new-user-feature',
        name: 'New User Feature',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
        rules: [
          {
            id: 'new-users',
            conditions: [{ attribute: 'daysSinceSignup', operator: 'lte', value: 30 }],
            value: true,
            priority: 1,
          },
        ],
      })

      const resultNewUser = await flags.evaluate<boolean>('new-user-feature', {
        attributes: { daysSinceSignup: 15 },
      })
      expect(resultNewUser.value).toBe(true)

      const resultOldUser = await flags.evaluate<boolean>('new-user-feature', {
        attributes: { daysSinceSignup: 60 },
      })
      expect(resultOldUser.value).toBe(false)
    })

    it('should match rule with regex condition', async () => {
      await flags.create({
        key: 'subdomain-flag',
        name: 'Subdomain Flag',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
        rules: [
          {
            id: 'dev-subdomain',
            conditions: [{ attribute: 'hostname', operator: 'regex', value: '^dev\\..*\\.com$' }],
            value: true,
            priority: 1,
          },
        ],
      })

      const resultDev = await flags.evaluate<boolean>('subdomain-flag', {
        attributes: { hostname: 'dev.example.com' },
      })
      expect(resultDev.value).toBe(true)

      const resultProd = await flags.evaluate<boolean>('subdomain-flag', {
        attributes: { hostname: 'www.example.com' },
      })
      expect(resultProd.value).toBe(false)
    })

    it('should require all conditions to match (AND logic)', async () => {
      await flags.create({
        key: 'multi-condition-flag',
        name: 'Multi Condition Flag',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
        rules: [
          {
            id: 'premium-us',
            conditions: [
              { attribute: 'plan', operator: 'equals', value: 'premium' },
              { attribute: 'country', operator: 'equals', value: 'US' },
            ],
            value: true,
            priority: 1,
          },
        ],
      })

      // Both conditions match
      const resultBoth = await flags.evaluate<boolean>('multi-condition-flag', {
        attributes: { plan: 'premium', country: 'US' },
      })
      expect(resultBoth.value).toBe(true)

      // Only plan matches
      const resultPlanOnly = await flags.evaluate<boolean>('multi-condition-flag', {
        attributes: { plan: 'premium', country: 'UK' },
      })
      expect(resultPlanOnly.value).toBe(false)

      // Only country matches
      const resultCountryOnly = await flags.evaluate<boolean>('multi-condition-flag', {
        attributes: { plan: 'free', country: 'US' },
      })
      expect(resultCountryOnly.value).toBe(false)
    })
  })

  describe('rule priority', () => {
    it('should evaluate rules in priority order (lower first)', async () => {
      await flags.create({
        key: 'priority-flag',
        name: 'Priority Flag',
        enabled: true,
        type: 'string',
        defaultValue: 'default',
        rules: [
          {
            id: 'low-priority',
            conditions: [],
            value: 'low',
            priority: 10,
          },
          {
            id: 'high-priority',
            conditions: [],
            value: 'high',
            priority: 1,
          },
          {
            id: 'medium-priority',
            conditions: [],
            value: 'medium',
            priority: 5,
          },
        ],
      })

      const result = await flags.evaluate<string>('priority-flag')

      expect(result.value).toBe('high')
      expect(result.matchedRule).toBe('high-priority')
    })

    it('should skip to next rule if conditions do not match', async () => {
      await flags.create({
        key: 'fallthrough-flag',
        name: 'Fallthrough Flag',
        enabled: true,
        type: 'string',
        defaultValue: 'default',
        rules: [
          {
            id: 'admin-only',
            conditions: [{ attribute: 'role', operator: 'equals', value: 'admin' }],
            value: 'admin',
            priority: 1,
          },
          {
            id: 'fallback',
            conditions: [],
            value: 'fallback',
            priority: 2,
          },
        ],
      })

      const resultUser = await flags.evaluate<string>('fallthrough-flag', {
        attributes: { role: 'user' },
      })
      expect(resultUser.value).toBe('fallback')
      expect(resultUser.matchedRule).toBe('fallback')

      const resultAdmin = await flags.evaluate<string>('fallthrough-flag', {
        attributes: { role: 'admin' },
      })
      expect(resultAdmin.value).toBe('admin')
      expect(resultAdmin.matchedRule).toBe('admin-only')
    })
  })

  describe('percentage rollout', () => {
    it('should consistently include users in rollout based on userId', async () => {
      await flags.create({
        key: 'rollout-flag',
        name: 'Rollout Flag',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
        rules: [
          {
            id: 'gradual-rollout',
            conditions: [],
            value: true,
            percentage: 50,
            priority: 1,
          },
        ],
      })

      // Same user should always get the same result
      const userId = 'consistent-user-123'
      const results: boolean[] = []

      for (let i = 0; i < 10; i++) {
        const result = await flags.evaluate<boolean>('rollout-flag', { userId })
        results.push(result.value)
      }

      // All results should be the same for the same user
      expect(results.every((r) => r === results[0])).toBe(true)
    })

    it('should distribute users across rollout percentage', async () => {
      await flags.create({
        key: 'rollout-50',
        name: 'Rollout 50%',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
        rules: [
          {
            id: 'half-rollout',
            conditions: [],
            value: true,
            percentage: 50,
            priority: 1,
          },
        ],
      })

      let included = 0
      const totalUsers = 1000

      for (let i = 0; i < totalUsers; i++) {
        const result = await flags.evaluate<boolean>('rollout-50', { userId: `user-${i}` })
        if (result.value === true) {
          included++
        }
      }

      // Should be roughly 50% (within 10% margin)
      const percentage = included / totalUsers
      expect(percentage).toBeGreaterThan(0.4)
      expect(percentage).toBeLessThan(0.6)
    })

    it('should respect 0% rollout', async () => {
      await flags.create({
        key: 'rollout-0',
        name: 'Rollout 0%',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
        rules: [
          {
            id: 'no-rollout',
            conditions: [],
            value: true,
            percentage: 0,
            priority: 1,
          },
        ],
      })

      let included = 0
      for (let i = 0; i < 100; i++) {
        const result = await flags.evaluate<boolean>('rollout-0', { userId: `user-${i}` })
        if (result.value === true) {
          included++
        }
      }

      expect(included).toBe(0)
    })

    it('should include all users with 100% rollout', async () => {
      await flags.create({
        key: 'rollout-100',
        name: 'Rollout 100%',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
        rules: [
          {
            id: 'full-rollout',
            conditions: [],
            value: true,
            percentage: 100,
            priority: 1,
          },
        ],
      })

      let included = 0
      for (let i = 0; i < 100; i++) {
        const result = await flags.evaluate<boolean>('rollout-100', { userId: `user-${i}` })
        if (result.value === true) {
          included++
        }
      }

      expect(included).toBe(100)
    })

    it('should skip rule when user not in rollout and fall through to next rule', async () => {
      await flags.create({
        key: 'rollout-fallthrough',
        name: 'Rollout Fallthrough',
        enabled: true,
        type: 'string',
        defaultValue: 'default',
        rules: [
          {
            id: 'limited-rollout',
            conditions: [],
            value: 'special',
            percentage: 0, // No one included
            priority: 1,
          },
          {
            id: 'fallback',
            conditions: [],
            value: 'fallback',
            priority: 2,
          },
        ],
      })

      const result = await flags.evaluate<string>('rollout-fallthrough', { userId: 'any-user' })

      expect(result.value).toBe('fallback')
      expect(result.matchedRule).toBe('fallback')
    })
  })

  describe('evaluateAll - batch evaluation', () => {
    it('should evaluate all flags for a context', async () => {
      await flags.create({
        key: 'flag-a',
        name: 'Flag A',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
      })

      await flags.create({
        key: 'flag-b',
        name: 'Flag B',
        enabled: true,
        type: 'boolean',
        defaultValue: true,
        rules: [
          {
            id: 'premium-only',
            conditions: [{ attribute: 'plan', operator: 'equals', value: 'premium' }],
            value: true,
            priority: 1,
          },
        ],
      })

      await flags.create({
        key: 'flag-c',
        name: 'Flag C',
        enabled: false,
        type: 'string',
        defaultValue: 'disabled-default',
      })

      const results = await flags.evaluateAll({ attributes: { plan: 'free' } })

      expect(Object.keys(results)).toHaveLength(3)
      expect(results['flag-a'].value).toBe(false)
      expect(results['flag-b'].value).toBe(true) // defaultValue since not premium
      expect(results['flag-c'].value).toBe('disabled-default')
    })
  })

  describe('context attributes', () => {
    it('should access sessionId from context', async () => {
      await flags.create({
        key: 'session-flag',
        name: 'Session Flag',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
        rules: [
          {
            id: 'specific-session',
            conditions: [{ attribute: 'sessionId', operator: 'equals', value: 'session-abc' }],
            value: true,
            priority: 1,
          },
        ],
      })

      const resultMatch = await flags.evaluate<boolean>('session-flag', { sessionId: 'session-abc' })
      expect(resultMatch.value).toBe(true)

      const resultNoMatch = await flags.evaluate<boolean>('session-flag', { sessionId: 'session-xyz' })
      expect(resultNoMatch.value).toBe(false)
    })

    it('should return default if no context provided and conditions require it', async () => {
      await flags.create({
        key: 'context-required',
        name: 'Context Required',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
        rules: [
          {
            id: 'needs-plan',
            conditions: [{ attribute: 'plan', operator: 'equals', value: 'premium' }],
            value: true,
            priority: 1,
          },
        ],
      })

      const result = await flags.evaluate<boolean>('context-required')

      expect(result.value).toBe(false) // Falls through to default
    })
  })

  describe('custom prefix', () => {
    it('should use custom key prefix', async () => {
      const customFlags = createFlagManager(storage, { prefix: 'custom:' })

      await customFlags.create({
        key: 'test',
        name: 'Test',
        enabled: true,
        type: 'boolean',
        defaultValue: false,
      })

      // Verify it uses custom prefix by checking it does not appear in default prefix
      const defaultFlags = createFlagManager(storage)
      const defaultList = await defaultFlags.list()

      expect(defaultList).toHaveLength(0)

      const customList = await customFlags.list()
      expect(customList).toHaveLength(1)
    })
  })
})

describe('FeatureFlag convenience function', () => {
  it('should evaluate boolean flag and return value', async () => {
    const storage = createMockStorage()
    const flags = createFlagManager(storage)

    await flags.create({
      key: 'convenience-flag',
      name: 'Convenience Flag',
      enabled: true,
      type: 'boolean',
      defaultValue: true,
    })

    const result = await FeatureFlag(storage, 'convenience-flag')

    expect(result).toBe(true)
  })

  it('should return false for non-existent flag', async () => {
    const storage = createMockStorage()

    const result = await FeatureFlag(storage, 'non-existent')

    expect(result).toBe(false)
  })

  it('should pass context to evaluation', async () => {
    const storage = createMockStorage()
    const flags = createFlagManager(storage)

    await flags.create({
      key: 'context-flag',
      name: 'Context Flag',
      enabled: true,
      type: 'boolean',
      defaultValue: false,
      rules: [
        {
          id: 'beta-users',
          conditions: [{ attribute: 'plan', operator: 'equals', value: 'beta' }],
          value: true,
          priority: 1,
        },
      ],
    })

    const resultBeta = await FeatureFlag(storage, 'context-flag', { attributes: { plan: 'beta' } })
    expect(resultBeta).toBe(true)

    const resultFree = await FeatureFlag(storage, 'context-flag', { attributes: { plan: 'free' } })
    expect(resultFree).toBe(false)
  })
})
