/**
 * FlagsAPI Integration Tests - Real Durable Objects with Miniflare
 *
 * TDD tests for FlagsAPI (feature flags).
 *
 * NO MOCKS - per CLAUDE.md:
 * - Real miniflare runtime
 * - Real SQLite storage
 * - Real DO instances via env bindings
 *
 * FeatureFlag has: key, enabled, rolloutPercentage, targetSegments, overrides
 *
 * @module business/tests/flags.test
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import type { FeatureFlag } from '../types'
import { generateTestId, rpcMayFail } from '@dotdo/test-utils/helpers'

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get a fresh Business DO stub for testing
 */
function getStub(name?: string) {
  const testName = name ?? generateTestId('flags')
  const id = env.BUSINESS.idFromName(testName)
  return env.BUSINESS.get(id)
}

/**
 * Make an RPC call to the DO
 */
async function rpc<T>(stub: DurableObjectStub, method: string, args: unknown[] = []): Promise<T> {
  const { response, data, error } = await rpcMayFail<T>(stub, method, args, 'https://business/rpc')

  // Handle void responses (delete, remove operations return no content)
  if (!response.ok && error) {
    throw new Error(`RPC error (${response.status}): ${JSON.stringify(error)}`)
  }

  return data as T
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('FlagsAPI (do-e71b.5)', () => {
  describe('flags.create()', () => {
    it('should create a feature flag with required fields', async () => {
      const stub = getStub()

      const flag = await rpc<FeatureFlag>(stub, 'flags.create', [
        { key: 'new-checkout', name: 'New Checkout Flow', enabled: false }
      ])

      expect(flag.id).toBeDefined()
      expect(flag.key).toBe('new-checkout')
      expect(flag.name).toBe('New Checkout Flow')
      expect(flag.enabled).toBe(false)
      expect(flag.createdAt).toBeDefined()
      expect(flag.updatedAt).toBeDefined()
    })

    it('should create a feature flag with rollout percentage', async () => {
      const stub = getStub()

      const flag = await rpc<FeatureFlag>(stub, 'flags.create', [
        {
          key: 'gradual-rollout',
          name: 'Gradual Rollout Feature',
          enabled: true,
          rolloutPercentage: 50
        }
      ])

      expect(flag.id).toBeDefined()
      expect(flag.key).toBe('gradual-rollout')
      expect(flag.enabled).toBe(true)
      expect(flag.rolloutPercentage).toBe(50)
    })

    it('should create a feature flag with user overrides', async () => {
      const stub = getStub()

      const flag = await rpc<FeatureFlag>(stub, 'flags.create', [
        {
          key: 'beta-feature',
          name: 'Beta Feature',
          enabled: false,
          overrides: {
            'user-123': true,
            'user-456': true
          }
        }
      ])

      expect(flag.id).toBeDefined()
      expect(flag.key).toBe('beta-feature')
      expect(flag.enabled).toBe(false)
      expect(flag.overrides).toEqual({
        'user-123': true,
        'user-456': true
      })
    })

    it('should create a feature flag with target segments', async () => {
      const stub = getStub()

      const flag = await rpc<FeatureFlag>(stub, 'flags.create', [
        {
          key: 'enterprise-only',
          name: 'Enterprise Feature',
          enabled: true,
          targetSegments: ['enterprise', 'premium']
        }
      ])

      expect(flag.id).toBeDefined()
      expect(flag.key).toBe('enterprise-only')
      expect(flag.targetSegments).toEqual(['enterprise', 'premium'])
    })
  })

  describe('flags.isEnabled()', () => {
    it('should return false when flag is disabled', async () => {
      const stub = getStub()

      // Create disabled flag
      await rpc<FeatureFlag>(stub, 'flags.create', [
        { key: 'disabled-flag', name: 'Disabled Flag', enabled: false }
      ])

      const enabled = await rpc<boolean>(stub, 'flags.isEnabled', ['disabled-flag'])

      expect(enabled).toBe(false)
    })

    it('should return true when flag is enabled with 100% rollout', async () => {
      const stub = getStub()

      // Create enabled flag
      await rpc<FeatureFlag>(stub, 'flags.create', [
        { key: 'enabled-flag', name: 'Enabled Flag', enabled: true }
      ])

      const enabled = await rpc<boolean>(stub, 'flags.isEnabled', ['enabled-flag'])

      expect(enabled).toBe(true)
    })

    it('should return true when flag is enabled with 100% rollout for specific user', async () => {
      const stub = getStub()

      // Create enabled flag
      await rpc<FeatureFlag>(stub, 'flags.create', [
        { key: 'user-enabled-flag', name: 'User Enabled Flag', enabled: true }
      ])

      const enabled = await rpc<boolean>(stub, 'flags.isEnabled', ['user-enabled-flag', 'user-123'])

      expect(enabled).toBe(true)
    })

    it('should respect user override when enabled for specific user', async () => {
      const stub = getStub()

      // Create flag that is disabled but has override for specific user
      await rpc<FeatureFlag>(stub, 'flags.create', [
        {
          key: 'override-test',
          name: 'Override Test',
          enabled: false,
          overrides: { 'beta-user': true }
        }
      ])

      // Regular user should get false
      const regularEnabled = await rpc<boolean>(stub, 'flags.isEnabled', ['override-test', 'regular-user'])
      expect(regularEnabled).toBe(false)

      // Beta user should get true due to override
      const betaEnabled = await rpc<boolean>(stub, 'flags.isEnabled', ['override-test', 'beta-user'])
      expect(betaEnabled).toBe(true)
    })

    it('should respect user override when disabled for specific user', async () => {
      const stub = getStub()

      // Create flag that is enabled but has override to disable for specific user
      await rpc<FeatureFlag>(stub, 'flags.create', [
        {
          key: 'disabled-override',
          name: 'Disabled Override Test',
          enabled: true,
          overrides: { 'blocked-user': false }
        }
      ])

      // Regular user should get true
      const regularEnabled = await rpc<boolean>(stub, 'flags.isEnabled', ['disabled-override', 'regular-user'])
      expect(regularEnabled).toBe(true)

      // Blocked user should get false due to override
      const blockedEnabled = await rpc<boolean>(stub, 'flags.isEnabled', ['disabled-override', 'blocked-user'])
      expect(blockedEnabled).toBe(false)
    })

    it('should return false for non-existent flag', async () => {
      const stub = getStub()

      const enabled = await rpc<boolean>(stub, 'flags.isEnabled', ['non-existent-flag'])

      expect(enabled).toBe(false)
    })
  })

  describe('flags.isEnabled() - percentage rollout', () => {
    it('should have approximately 50% of users enabled with 50% rollout', async () => {
      const stub = getStub()

      // Create 50% rollout flag
      await rpc<FeatureFlag>(stub, 'flags.create', [
        {
          key: 'fifty-percent',
          name: '50% Rollout',
          enabled: true,
          rolloutPercentage: 50
        }
      ])

      // Test with 100 different user IDs
      let enabledCount = 0
      for (let i = 0; i < 100; i++) {
        const enabled = await rpc<boolean>(stub, 'flags.isEnabled', ['fifty-percent', `user-${i}`])
        if (enabled) enabledCount++
      }

      // Should be roughly 50% (allow 20% margin for small sample)
      expect(enabledCount).toBeGreaterThan(30)
      expect(enabledCount).toBeLessThan(70)
    })

    it('should have 0% enabled with 0% rollout', async () => {
      const stub = getStub()

      // Create 0% rollout flag
      await rpc<FeatureFlag>(stub, 'flags.create', [
        {
          key: 'zero-percent',
          name: '0% Rollout',
          enabled: true,
          rolloutPercentage: 0
        }
      ])

      // Test with 20 different user IDs - all should be false
      for (let i = 0; i < 20; i++) {
        const enabled = await rpc<boolean>(stub, 'flags.isEnabled', ['zero-percent', `user-${i}`])
        expect(enabled).toBe(false)
      }
    })

    it('should have 100% enabled with 100% rollout', async () => {
      const stub = getStub()

      // Create 100% rollout flag
      await rpc<FeatureFlag>(stub, 'flags.create', [
        {
          key: 'hundred-percent',
          name: '100% Rollout',
          enabled: true,
          rolloutPercentage: 100
        }
      ])

      // Test with 20 different user IDs - all should be true
      for (let i = 0; i < 20; i++) {
        const enabled = await rpc<boolean>(stub, 'flags.isEnabled', ['hundred-percent', `user-${i}`])
        expect(enabled).toBe(true)
      }
    })

    it('should be deterministic for the same user', async () => {
      const stub = getStub()

      // Create 50% rollout flag
      await rpc<FeatureFlag>(stub, 'flags.create', [
        {
          key: 'deterministic-test',
          name: 'Deterministic Test',
          enabled: true,
          rolloutPercentage: 50
        }
      ])

      // Same user should always get the same result
      const result1 = await rpc<boolean>(stub, 'flags.isEnabled', ['deterministic-test', 'consistent-user'])
      const result2 = await rpc<boolean>(stub, 'flags.isEnabled', ['deterministic-test', 'consistent-user'])
      const result3 = await rpc<boolean>(stub, 'flags.isEnabled', ['deterministic-test', 'consistent-user'])

      expect(result1).toBe(result2)
      expect(result2).toBe(result3)
    })
  })

  describe('flags.get()', () => {
    it('should get a flag by key', async () => {
      const stub = getStub()

      // Create flag
      const created = await rpc<FeatureFlag>(stub, 'flags.create', [
        { key: 'get-test-flag', name: 'Get Test Flag', enabled: true }
      ])

      // Get by key
      const flag = await rpc<FeatureFlag | null>(stub, 'flags.get', ['get-test-flag'])

      expect(flag).not.toBeNull()
      expect(flag!.id).toBe(created.id)
      expect(flag!.key).toBe('get-test-flag')
      expect(flag!.name).toBe('Get Test Flag')
      expect(flag!.enabled).toBe(true)
    })

    it('should return null for non-existent flag', async () => {
      const stub = getStub()

      const flag = await rpc<FeatureFlag | null>(stub, 'flags.get', ['non-existent-flag'])

      expect(flag).toBeNull()
    })
  })

  describe('flags.list()', () => {
    it('should list all feature flags', async () => {
      const stub = getStub()

      // Create multiple flags
      await rpc<FeatureFlag>(stub, 'flags.create', [
        { key: 'flag-a', name: 'Flag A', enabled: true }
      ])
      await rpc<FeatureFlag>(stub, 'flags.create', [
        { key: 'flag-b', name: 'Flag B', enabled: false }
      ])
      await rpc<FeatureFlag>(stub, 'flags.create', [
        { key: 'flag-c', name: 'Flag C', enabled: true }
      ])

      // List all
      const flags = await rpc<FeatureFlag[]>(stub, 'flags.list', [])

      expect(flags.length).toBe(3)
      expect(flags.map(f => f.key).sort()).toEqual(['flag-a', 'flag-b', 'flag-c'])
    })

    it('should return empty array when no flags exist', async () => {
      const stub = getStub()

      const flags = await rpc<FeatureFlag[]>(stub, 'flags.list', [])

      expect(flags).toEqual([])
    })
  })

  describe('flags.update()', () => {
    it('should update flag enabled status', async () => {
      const stub = getStub()

      // Create flag
      const created = await rpc<FeatureFlag>(stub, 'flags.create', [
        { key: 'update-enabled-test', name: 'Update Test', enabled: false }
      ])

      // Update enabled status
      const updated = await rpc<FeatureFlag>(stub, 'flags.update', [
        'update-enabled-test',
        { enabled: true }
      ])

      expect(updated.id).toBe(created.id)
      expect(updated.key).toBe('update-enabled-test')
      expect(updated.enabled).toBe(true)
    })

    it('should update rollout percentage', async () => {
      const stub = getStub()

      // Create flag with 0% rollout
      await rpc<FeatureFlag>(stub, 'flags.create', [
        { key: 'update-rollout-test', name: 'Rollout Update Test', enabled: true, rolloutPercentage: 0 }
      ])

      // Update rollout percentage
      const updated = await rpc<FeatureFlag>(stub, 'flags.update', [
        'update-rollout-test',
        { rolloutPercentage: 75 }
      ])

      expect(updated.key).toBe('update-rollout-test')
      expect(updated.rolloutPercentage).toBe(75)
    })

    it('should update overrides', async () => {
      const stub = getStub()

      // Create flag without overrides
      await rpc<FeatureFlag>(stub, 'flags.create', [
        { key: 'update-overrides-test', name: 'Overrides Update Test', enabled: false }
      ])

      // Update with new overrides
      const updated = await rpc<FeatureFlag>(stub, 'flags.update', [
        'update-overrides-test',
        { overrides: { 'vip-user': true, 'another-vip': true } }
      ])

      expect(updated.key).toBe('update-overrides-test')
      expect(updated.overrides).toEqual({ 'vip-user': true, 'another-vip': true })
    })

    it('should throw error for non-existent flag update', async () => {
      const stub = getStub()

      // Try to update non-existent flag
      const response = await stub.fetch('https://business/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'flags.update',
          args: ['non-existent-flag', { enabled: true }]
        })
      })

      // Should fail since flag doesn't exist
      expect(response.status).toBe(500)
    })
  })

  describe('flags.delete()', () => {
    it('should delete a feature flag', async () => {
      const stub = getStub()

      // Create flag
      await rpc<FeatureFlag>(stub, 'flags.create', [
        { key: 'delete-test-flag', name: 'Delete Test', enabled: true }
      ])

      // Delete flag
      const result = await rpc<boolean>(stub, 'flags.delete', ['delete-test-flag'])

      expect(result).toBe(true)

      // Verify deleted
      const flag = await rpc<FeatureFlag | null>(stub, 'flags.get', ['delete-test-flag'])
      expect(flag).toBeNull()
    })

    it('should return false for non-existent flag delete', async () => {
      const stub = getStub()

      const result = await rpc<boolean>(stub, 'flags.delete', ['non-existent-flag'])

      expect(result).toBe(false)
    })
  })
})
