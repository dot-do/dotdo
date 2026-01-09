import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * RED Phase Tests for Feature Flag API ($.flag)
 *
 * These tests define the expected behavior of the $.flag feature flag system.
 * They will FAIL until the implementation is created.
 *
 * Feature flags use deterministic hashing for per-user assignment,
 * allowing controlled rollouts and A/B testing.
 *
 * Reference: docs/concepts/experiments.mdx
 *
 * Usage:
 *   const enabled = await $.flag('new-checkout').isEnabled(userId)
 *   await $.Flag.create({ id: 'new-checkout', traffic: 0.5 })
 *   await $.flag('new-checkout').enable()   // Roll out to everyone
 *   await $.flag('new-checkout').disable()  // Roll back
 */

// Import the flag API (will fail - module doesn't exist yet)
import { createFlagProxy, FlagStore, Flag, createFlagStore } from '../flag'

describe('Feature Flag API ($.flag)', () => {
  let store: FlagStore

  beforeEach(() => {
    // Create a fresh in-memory store for each test
    store = createFlagStore()
  })

  /**
   * $.flag('name').isEnabled(userId) returns boolean
   *
   * The isEnabled method should return true/false based on:
   * 1. Whether the flag exists
   * 2. The traffic allocation percentage
   * 3. Deterministic hashing of userId to ensure consistent assignment
   */
  describe('isEnabled returns boolean', () => {
    it('returns false when flag does not exist', async () => {
      const $ = createFlagProxy(store)
      const enabled = await $.flag('nonexistent-flag').isEnabled('user-123')

      expect(enabled).toBe(false)
    })

    it('returns boolean true when user is enabled', async () => {
      const $ = createFlagProxy(store)

      // Create a flag with 100% traffic
      await $.Flag.create({ id: 'always-on', traffic: 1.0 })

      const enabled = await $.flag('always-on').isEnabled('user-123')

      expect(typeof enabled).toBe('boolean')
      expect(enabled).toBe(true)
    })

    it('returns boolean false when flag has 0% traffic', async () => {
      const $ = createFlagProxy(store)

      // Create a flag with 0% traffic
      await $.Flag.create({ id: 'always-off', traffic: 0.0 })

      const enabled = await $.flag('always-off').isEnabled('user-123')

      expect(typeof enabled).toBe('boolean')
      expect(enabled).toBe(false)
    })

    it('returns same value for same userId (consistency check)', async () => {
      const $ = createFlagProxy(store)

      await $.Flag.create({ id: 'test-flag', traffic: 0.5 })

      const result1 = await $.flag('test-flag').isEnabled('user-abc')
      const result2 = await $.flag('test-flag').isEnabled('user-abc')
      const result3 = await $.flag('test-flag').isEnabled('user-abc')

      expect(result1).toBe(result2)
      expect(result2).toBe(result3)
    })
  })

  /**
   * Flag respects traffic allocation
   *
   * Traffic allocation should work as follows:
   * - traffic: 0.0 -> no users enabled
   * - traffic: 1.0 -> all users enabled
   * - traffic: 0.5 -> ~50% of users enabled (deterministic per user)
   */
  describe('Flag respects traffic allocation', () => {
    it('enables no users when traffic is 0.0', async () => {
      const $ = createFlagProxy(store)

      await $.Flag.create({ id: 'zero-traffic', traffic: 0.0 })

      // Test multiple users - all should be disabled
      const results = await Promise.all([
        $.flag('zero-traffic').isEnabled('user-1'),
        $.flag('zero-traffic').isEnabled('user-2'),
        $.flag('zero-traffic').isEnabled('user-3'),
        $.flag('zero-traffic').isEnabled('user-100'),
        $.flag('zero-traffic').isEnabled('random-uuid'),
      ])

      expect(results.every((r) => r === false)).toBe(true)
    })

    it('enables all users when traffic is 1.0', async () => {
      const $ = createFlagProxy(store)

      await $.Flag.create({ id: 'full-traffic', traffic: 1.0 })

      // Test multiple users - all should be enabled
      const results = await Promise.all([
        $.flag('full-traffic').isEnabled('user-1'),
        $.flag('full-traffic').isEnabled('user-2'),
        $.flag('full-traffic').isEnabled('user-3'),
        $.flag('full-traffic').isEnabled('user-100'),
        $.flag('full-traffic').isEnabled('random-uuid'),
      ])

      expect(results.every((r) => r === true)).toBe(true)
    })

    it('enables approximately correct percentage with partial traffic', async () => {
      const $ = createFlagProxy(store)

      // Create a flag with 50% traffic
      await $.Flag.create({ id: 'half-traffic', traffic: 0.5 })

      // Generate a large sample of deterministic user IDs
      const userIds = Array.from({ length: 1000 }, (_, i) => `user-${i}`)

      const results = await Promise.all(userIds.map((id) => $.flag('half-traffic').isEnabled(id)))

      const enabledCount = results.filter(Boolean).length

      // With 1000 samples at 50%, we expect ~500 enabled
      // Allow for statistical variance (roughly 400-600 should be enabled)
      expect(enabledCount).toBeGreaterThan(350)
      expect(enabledCount).toBeLessThan(650)
    })

    it('enables approximately 10% with 0.1 traffic', async () => {
      const $ = createFlagProxy(store)

      await $.Flag.create({ id: 'ten-percent', traffic: 0.1 })

      const userIds = Array.from({ length: 1000 }, (_, i) => `test-user-${i}`)

      const results = await Promise.all(userIds.map((id) => $.flag('ten-percent').isEnabled(id)))

      const enabledCount = results.filter(Boolean).length

      // Expect ~100 enabled out of 1000, with variance
      expect(enabledCount).toBeGreaterThan(50)
      expect(enabledCount).toBeLessThan(200)
    })

    it('maintains consistent assignment when checking same user multiple times', async () => {
      const $ = createFlagProxy(store)

      await $.Flag.create({ id: 'consistency-test', traffic: 0.5 })

      // Check same user 100 times
      const results = await Promise.all(Array.from({ length: 100 }, () => $.flag('consistency-test').isEnabled('consistent-user')))

      // All results should be identical
      const allSame = results.every((r) => r === results[0])
      expect(allSame).toBe(true)
    })
  })

  /**
   * enable() sets traffic to 1.0
   *
   * Calling enable() on a flag should roll it out to 100% of users
   */
  describe('enable() sets traffic to 1.0', () => {
    it('enables flag for all users after calling enable()', async () => {
      const $ = createFlagProxy(store)

      // Create flag with 0% traffic
      await $.Flag.create({ id: 'rollout-flag', traffic: 0.0 })

      // Verify initially disabled
      const beforeEnable = await $.flag('rollout-flag').isEnabled('user-1')
      expect(beforeEnable).toBe(false)

      // Enable the flag
      await $.flag('rollout-flag').enable()

      // Now all users should be enabled
      const results = await Promise.all([
        $.flag('rollout-flag').isEnabled('user-1'),
        $.flag('rollout-flag').isEnabled('user-2'),
        $.flag('rollout-flag').isEnabled('user-999'),
      ])

      expect(results.every((r) => r === true)).toBe(true)
    })

    it('enable() updates traffic to 1.0 in store', async () => {
      const $ = createFlagProxy(store)

      await $.Flag.create({ id: 'check-traffic', traffic: 0.3 })

      await $.flag('check-traffic').enable()

      const flag = await store.get('check-traffic')
      expect(flag?.traffic).toBe(1.0)
    })

    it('enable() is idempotent', async () => {
      const $ = createFlagProxy(store)

      await $.Flag.create({ id: 'idempotent-enable', traffic: 0.5 })

      // Call enable multiple times
      await $.flag('idempotent-enable').enable()
      await $.flag('idempotent-enable').enable()
      await $.flag('idempotent-enable').enable()

      const flag = await store.get('idempotent-enable')
      expect(flag?.traffic).toBe(1.0)
    })

    it('enable() throws or returns gracefully for nonexistent flag', async () => {
      const $ = createFlagProxy(store)

      // Depending on implementation, this should either throw or create the flag
      // For safety, we expect it to throw for nonexistent flags
      await expect($.flag('nonexistent').enable()).rejects.toThrow()
    })
  })

  /**
   * disable() sets traffic to 0.0
   *
   * Calling disable() on a flag should roll it back to 0% of users
   */
  describe('disable() sets traffic to 0.0', () => {
    it('disables flag for all users after calling disable()', async () => {
      const $ = createFlagProxy(store)

      // Create flag with 100% traffic
      await $.Flag.create({ id: 'rollback-flag', traffic: 1.0 })

      // Verify initially enabled
      const beforeDisable = await $.flag('rollback-flag').isEnabled('user-1')
      expect(beforeDisable).toBe(true)

      // Disable the flag
      await $.flag('rollback-flag').disable()

      // Now all users should be disabled
      const results = await Promise.all([
        $.flag('rollback-flag').isEnabled('user-1'),
        $.flag('rollback-flag').isEnabled('user-2'),
        $.flag('rollback-flag').isEnabled('user-999'),
      ])

      expect(results.every((r) => r === false)).toBe(true)
    })

    it('disable() updates traffic to 0.0 in store', async () => {
      const $ = createFlagProxy(store)

      await $.Flag.create({ id: 'check-disabled-traffic', traffic: 0.8 })

      await $.flag('check-disabled-traffic').disable()

      const flag = await store.get('check-disabled-traffic')
      expect(flag?.traffic).toBe(0.0)
    })

    it('disable() is idempotent', async () => {
      const $ = createFlagProxy(store)

      await $.Flag.create({ id: 'idempotent-disable', traffic: 1.0 })

      // Call disable multiple times
      await $.flag('idempotent-disable').disable()
      await $.flag('idempotent-disable').disable()
      await $.flag('idempotent-disable').disable()

      const flag = await store.get('idempotent-disable')
      expect(flag?.traffic).toBe(0.0)
    })

    it('disable() throws or returns gracefully for nonexistent flag', async () => {
      const $ = createFlagProxy(store)

      // Depending on implementation, this should either throw or create the flag
      // For safety, we expect it to throw for nonexistent flags
      await expect($.flag('nonexistent').disable()).rejects.toThrow()
    })
  })

  /**
   * Deterministic per-user assignment
   *
   * The assignment of a user to a flag should be:
   * 1. Deterministic: same user + same flag = same result always
   * 2. Based on hash(userId + flagId)
   * 3. Uniform distribution across user space
   */
  describe('Deterministic per-user assignment', () => {
    it('produces same result for same user and flag combination', async () => {
      const $ = createFlagProxy(store)

      await $.Flag.create({ id: 'deterministic-flag', traffic: 0.5 })

      const user = 'deterministic-test-user-12345'

      // Check multiple times
      const results = await Promise.all([
        $.flag('deterministic-flag').isEnabled(user),
        $.flag('deterministic-flag').isEnabled(user),
        $.flag('deterministic-flag').isEnabled(user),
      ])

      expect(results[0]).toBe(results[1])
      expect(results[1]).toBe(results[2])
    })

    it('produces different results for different users (with sufficient sample)', async () => {
      const $ = createFlagProxy(store)

      await $.Flag.create({ id: 'different-users-flag', traffic: 0.5 })

      // With 50% traffic and enough users, we should see both true and false
      const users = Array.from({ length: 100 }, (_, i) => `distinct-user-${i}`)
      const results = await Promise.all(users.map((u) => $.flag('different-users-flag').isEnabled(u)))

      const trueCount = results.filter(Boolean).length
      const falseCount = results.filter((r) => !r).length

      // Both should be non-zero
      expect(trueCount).toBeGreaterThan(0)
      expect(falseCount).toBeGreaterThan(0)
    })

    it('different flags produce independent assignments for same user', async () => {
      const $ = createFlagProxy(store)

      await $.Flag.create({ id: 'flag-a', traffic: 0.5 })
      await $.Flag.create({ id: 'flag-b', traffic: 0.5 })

      // With many users, the assignments for flag-a and flag-b should be independent
      const users = Array.from({ length: 100 }, (_, i) => `independence-user-${i}`)

      const resultsA = await Promise.all(users.map((u) => $.flag('flag-a').isEnabled(u)))
      const resultsB = await Promise.all(users.map((u) => $.flag('flag-b').isEnabled(u)))

      // Count how many users have different assignments between flags
      let differentCount = 0
      for (let i = 0; i < users.length; i++) {
        if (resultsA[i] !== resultsB[i]) {
          differentCount++
        }
      }

      // With independent assignment, roughly 50% should differ
      // (P(different) = P(A=true)P(B=false) + P(A=false)P(B=true) = 0.5*0.5 + 0.5*0.5 = 0.5)
      expect(differentCount).toBeGreaterThan(20) // At least some difference
    })

    it('assignment is based on hash of userId and flagId', async () => {
      const $ = createFlagProxy(store)

      await $.Flag.create({ id: 'hash-based-flag', traffic: 0.5 })

      // The same combination should always yield the same result
      const user = 'hash-test-user'

      // Store first result
      const firstResult = await $.flag('hash-based-flag').isEnabled(user)

      // Create a new proxy instance (simulating different request)
      const $new = createFlagProxy(store)

      // Should get same result
      const secondResult = await $new.flag('hash-based-flag').isEnabled(user)

      expect(firstResult).toBe(secondResult)
    })

    it('hash produces uniform distribution', async () => {
      const $ = createFlagProxy(store)

      // Create a flag with exactly 50% traffic
      await $.Flag.create({ id: 'uniform-dist-flag', traffic: 0.5 })

      // Generate many pseudo-random user IDs
      const users = Array.from({ length: 10000 }, (_, i) => `uniformity-test-${i}-${Math.random()}`)

      const results = await Promise.all(users.map((u) => $.flag('uniform-dist-flag').isEnabled(u)))

      const enabledCount = results.filter(Boolean).length
      const enabledRatio = enabledCount / users.length

      // Should be very close to 0.5 with 10000 samples
      // Allow 5% variance: 0.45 - 0.55
      expect(enabledRatio).toBeGreaterThan(0.45)
      expect(enabledRatio).toBeLessThan(0.55)
    })
  })

  /**
   * $.Flag.create API
   *
   * Creating feature flags with various configurations
   */
  describe('$.Flag.create API', () => {
    it('creates a new flag with specified traffic', async () => {
      const $ = createFlagProxy(store)

      await $.Flag.create({ id: 'new-flag', traffic: 0.5 })

      const flag = await store.get('new-flag')

      expect(flag).toBeDefined()
      expect(flag?.id).toBe('new-flag')
      expect(flag?.traffic).toBe(0.5)
    })

    it('creates a flag with default traffic of 0 if not specified', async () => {
      const $ = createFlagProxy(store)

      await $.Flag.create({ id: 'default-traffic-flag' })

      const flag = await store.get('default-traffic-flag')
      expect(flag?.traffic).toBe(0)
    })

    it('validates traffic is between 0 and 1', async () => {
      const $ = createFlagProxy(store)

      // Traffic > 1 should fail
      await expect($.Flag.create({ id: 'invalid-high', traffic: 1.5 })).rejects.toThrow()

      // Traffic < 0 should fail
      await expect($.Flag.create({ id: 'invalid-low', traffic: -0.1 })).rejects.toThrow()
    })

    it('prevents duplicate flag creation', async () => {
      const $ = createFlagProxy(store)

      await $.Flag.create({ id: 'unique-flag', traffic: 0.5 })

      // Creating same flag again should throw
      await expect($.Flag.create({ id: 'unique-flag', traffic: 0.8 })).rejects.toThrow()
    })

    it('stores flag metadata', async () => {
      const $ = createFlagProxy(store)

      await $.Flag.create({
        id: 'metadata-flag',
        traffic: 0.5,
      })

      const flag = await store.get('metadata-flag')

      expect(flag).toHaveProperty('id')
      expect(flag).toHaveProperty('traffic')
      expect(flag).toHaveProperty('createdAt')
    })
  })

  /**
   * Traffic updates via setTraffic
   *
   * Ability to gradually roll out or roll back a flag
   */
  describe('Traffic updates', () => {
    it('allows updating traffic allocation', async () => {
      const $ = createFlagProxy(store)

      await $.Flag.create({ id: 'gradual-rollout', traffic: 0.1 })

      // Update traffic
      await $.flag('gradual-rollout').setTraffic(0.5)

      const flag = await store.get('gradual-rollout')
      expect(flag?.traffic).toBe(0.5)
    })

    it('validates traffic on update', async () => {
      const $ = createFlagProxy(store)

      await $.Flag.create({ id: 'validate-update', traffic: 0.1 })

      await expect($.flag('validate-update').setTraffic(2.0)).rejects.toThrow()
      await expect($.flag('validate-update').setTraffic(-0.5)).rejects.toThrow()
    })

    it('updating traffic changes user eligibility', async () => {
      const $ = createFlagProxy(store)

      await $.Flag.create({ id: 'eligibility-change', traffic: 0.0 })

      // Initially no users enabled
      const beforeUpdate = await $.flag('eligibility-change').isEnabled('some-user')
      expect(beforeUpdate).toBe(false)

      // Set to 100%
      await $.flag('eligibility-change').setTraffic(1.0)

      // Now user should be enabled
      const afterUpdate = await $.flag('eligibility-change').isEnabled('some-user')
      expect(afterUpdate).toBe(true)
    })
  })

  /**
   * Flag metadata and status
   */
  describe('Flag metadata and status', () => {
    it('can retrieve flag details', async () => {
      const $ = createFlagProxy(store)

      await $.Flag.create({ id: 'details-flag', traffic: 0.75 })

      const flag = await $.flag('details-flag').get()

      expect(flag.id).toBe('details-flag')
      expect(flag.traffic).toBe(0.75)
    })

    it('get() returns undefined for nonexistent flag', async () => {
      const $ = createFlagProxy(store)

      const flag = await $.flag('does-not-exist').get()

      expect(flag).toBeUndefined()
    })

    it('can list all flags', async () => {
      const $ = createFlagProxy(store)

      await $.Flag.create({ id: 'list-flag-1', traffic: 0.1 })
      await $.Flag.create({ id: 'list-flag-2', traffic: 0.2 })
      await $.Flag.create({ id: 'list-flag-3', traffic: 0.3 })

      const flags = await $.Flag.list()

      expect(flags).toHaveLength(3)
      expect(flags.map((f: Flag) => f.id)).toContain('list-flag-1')
      expect(flags.map((f: Flag) => f.id)).toContain('list-flag-2')
      expect(flags.map((f: Flag) => f.id)).toContain('list-flag-3')
    })

    it('can delete a flag', async () => {
      const $ = createFlagProxy(store)

      await $.Flag.create({ id: 'delete-me', traffic: 0.5 })

      // Verify exists
      let flag = await store.get('delete-me')
      expect(flag).toBeDefined()

      // Delete
      await $.flag('delete-me').delete()

      // Verify deleted
      flag = await store.get('delete-me')
      expect(flag).toBeUndefined()
    })
  })
})
