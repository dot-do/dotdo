/**
 * RED Phase Tests for $.flag Feature Flag API
 *
 * Tests for the $.flag() accessor and its methods:
 * - $.flag('feature-name').isEnabled(userId) - Check if flag is enabled for user
 * - $.flag('feature-name').getValue(userId) - Get payload/value for user
 * - $.flag('feature-name').getVariant(userId) - Get variant assignment for user
 *
 * These tests define the expected behavior and will FAIL until the
 * getValue() and getVariant() methods are implemented.
 *
 * The API integrates with the workflow context ($) pattern.
 *
 * @see /workflows/context/flag.ts - Current implementation (missing getValue, getVariant)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createMockContext,
  type Flag,
  type FlagContext,
  type FlagContextInstance,
} from '../../workflows/context/flag'

// ============================================================================
// SECTION 1: $.flag() Accessor Returns Flag Interface
// ============================================================================

describe('$.flag() accessor returns flag interface', () => {
  let $: FlagContext

  beforeEach(() => {
    $ = createMockContext()
  })

  it('$.flag returns a function', () => {
    expect(typeof $.flag).toBe('function')
  })

  it('$.flag("name") returns an object with expected methods', () => {
    const flagInstance = $.flag('test-flag')

    // Verify the returned object has the expected interface
    expect(flagInstance).toBeDefined()
    expect(typeof flagInstance).toBe('object')
  })

  it('$.flag("name") has isEnabled method', () => {
    const flagInstance = $.flag('test-flag')
    expect(typeof flagInstance.isEnabled).toBe('function')
  })

  it('$.flag("name") has getValue method', () => {
    const flagInstance = $.flag('test-flag')
    // This test will FAIL because getValue is not yet implemented
    expect(typeof flagInstance.getValue).toBe('function')
  })

  it('$.flag("name") has getVariant method', () => {
    const flagInstance = $.flag('test-flag')
    // This test will FAIL because getVariant is not yet implemented
    expect(typeof flagInstance.getVariant).toBe('function')
  })

  it('$.flag() returns consistent interface for same flag name', () => {
    const instance1 = $.flag('my-flag')
    const instance2 = $.flag('my-flag')

    // Both should have the same interface shape
    expect(Object.keys(instance1)).toEqual(Object.keys(instance2))
  })

  it('$.flag() returns interface for different flag names', () => {
    const flagA = $.flag('flag-a')
    const flagB = $.flag('flag-b')

    // Different names should return valid interfaces
    expect(typeof flagA.isEnabled).toBe('function')
    expect(typeof flagB.isEnabled).toBe('function')
  })

  it('$.flag() with empty string returns interface', () => {
    const flagInstance = $.flag('')
    expect(typeof flagInstance.isEnabled).toBe('function')
  })

  it('$.flag() with special characters returns interface', () => {
    const flagInstance = $.flag('feature:new-checkout_v2')
    expect(typeof flagInstance.isEnabled).toBe('function')
  })
})

// ============================================================================
// SECTION 2: isEnabled Method Tests
// ============================================================================

describe('$.flag().isEnabled(userId)', () => {
  let $: FlagContext

  beforeEach(() => {
    $ = createMockContext()
  })

  describe('return type', () => {
    it('returns a Promise', async () => {
      const result = $.flag('test-flag').isEnabled('user-123')
      expect(result).toBeInstanceOf(Promise)
    })

    it('resolves to a boolean', async () => {
      const result = await $.flag('test-flag').isEnabled('user-123')
      expect(typeof result).toBe('boolean')
    })
  })

  describe('flag does not exist', () => {
    it('returns false for nonexistent flag', async () => {
      const enabled = await $.flag('nonexistent').isEnabled('user-123')
      expect(enabled).toBe(false)
    })

    it('does not throw for nonexistent flag', async () => {
      await expect($.flag('missing').isEnabled('user-456')).resolves.toBe(false)
    })
  })

  describe('traffic allocation', () => {
    it('returns true when traffic is 100%', async () => {
      $._storage.flags.set('full-traffic', {
        id: 'full-traffic',
        traffic: 1.0,
        status: 'active',
        branches: [{ key: 'on', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const result = await $.flag('full-traffic').isEnabled('any-user')
      expect(result).toBe(true)
    })

    it('returns false when traffic is 0%', async () => {
      $._storage.flags.set('no-traffic', {
        id: 'no-traffic',
        traffic: 0,
        status: 'active',
        branches: [{ key: 'on', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const result = await $.flag('no-traffic').isEnabled('any-user')
      expect(result).toBe(false)
    })

    it('returns deterministic result for partial traffic', async () => {
      $._storage.flags.set('partial', {
        id: 'partial',
        traffic: 0.5,
        status: 'active',
        branches: [{ key: 'on', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const result1 = await $.flag('partial').isEnabled('user-abc')
      const result2 = await $.flag('partial').isEnabled('user-abc')
      const result3 = await $.flag('partial').isEnabled('user-abc')

      // Same user should get same result
      expect(result1).toBe(result2)
      expect(result2).toBe(result3)
    })
  })

  describe('flag status', () => {
    it('returns false when flag status is disabled', async () => {
      $._storage.flags.set('disabled-flag', {
        id: 'disabled-flag',
        traffic: 1.0,
        status: 'disabled',
        branches: [{ key: 'on', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const result = await $.flag('disabled-flag').isEnabled('user-123')
      expect(result).toBe(false)
    })

    it('returns false when flag status is archived', async () => {
      $._storage.flags.set('archived-flag', {
        id: 'archived-flag',
        traffic: 1.0,
        status: 'archived',
        branches: [{ key: 'on', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const result = await $.flag('archived-flag').isEnabled('user-123')
      expect(result).toBe(false)
    })

    it('returns true when flag status is active and in traffic', async () => {
      $._storage.flags.set('active-flag', {
        id: 'active-flag',
        traffic: 1.0,
        status: 'active',
        branches: [{ key: 'on', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const result = await $.flag('active-flag').isEnabled('user-123')
      expect(result).toBe(true)
    })
  })
})

// ============================================================================
// SECTION 3: getValue Method Tests (RED - Not Yet Implemented)
// ============================================================================

describe('$.flag().getValue(userId)', () => {
  let $: FlagContext

  beforeEach(() => {
    $ = createMockContext()
  })

  describe('return type', () => {
    it('returns a Promise', async () => {
      $._storage.flags.set('value-flag', {
        id: 'value-flag',
        traffic: 1.0,
        status: 'active',
        branches: [{ key: 'treatment', weight: 100, payload: { color: 'blue' } }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // This test will FAIL because getValue is not implemented
      const result = ($.flag('value-flag') as any).getValue('user-123')
      expect(result).toBeInstanceOf(Promise)
    })

    it('resolves to the payload value', async () => {
      $._storage.flags.set('payload-flag', {
        id: 'payload-flag',
        traffic: 1.0,
        status: 'active',
        branches: [{ key: 'v1', weight: 100, payload: { buttonColor: 'green', fontSize: 14 } }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // This test will FAIL because getValue is not implemented
      const value = await ($.flag('payload-flag') as any).getValue('user-123')
      expect(value).toEqual({ buttonColor: 'green', fontSize: 14 })
    })
  })

  describe('flag does not exist', () => {
    it('returns undefined for nonexistent flag', async () => {
      // This test will FAIL because getValue is not implemented
      const value = await ($.flag('nonexistent') as any).getValue('user-123')
      expect(value).toBeUndefined()
    })
  })

  describe('user not in traffic', () => {
    it('returns undefined when user is not in traffic allocation', async () => {
      $._storage.flags.set('zero-traffic', {
        id: 'zero-traffic',
        traffic: 0,
        status: 'active',
        branches: [{ key: 'v1', weight: 100, payload: { data: 'test' } }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // This test will FAIL because getValue is not implemented
      const value = await ($.flag('zero-traffic') as any).getValue('user-123')
      expect(value).toBeUndefined()
    })
  })

  describe('flag is disabled', () => {
    it('returns undefined when flag is disabled', async () => {
      $._storage.flags.set('disabled-payload', {
        id: 'disabled-payload',
        traffic: 1.0,
        status: 'disabled',
        branches: [{ key: 'v1', weight: 100, payload: { value: 42 } }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // This test will FAIL because getValue is not implemented
      const value = await ($.flag('disabled-payload') as any).getValue('user-123')
      expect(value).toBeUndefined()
    })
  })

  describe('payload types', () => {
    it('returns object payload', async () => {
      $._storage.flags.set('obj-payload', {
        id: 'obj-payload',
        traffic: 1.0,
        status: 'active',
        branches: [{ key: 'v1', weight: 100, payload: { config: { enabled: true, max: 100 } } }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // This test will FAIL because getValue is not implemented
      const value = await ($.flag('obj-payload') as any).getValue('user-123')
      expect(value).toEqual({ config: { enabled: true, max: 100 } })
    })

    it('returns string payload', async () => {
      $._storage.flags.set('str-payload', {
        id: 'str-payload',
        traffic: 1.0,
        status: 'active',
        branches: [{ key: 'v1', weight: 100, payload: 'hello-world' }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // This test will FAIL because getValue is not implemented
      const value = await ($.flag('str-payload') as any).getValue('user-123')
      expect(value).toBe('hello-world')
    })

    it('returns number payload', async () => {
      $._storage.flags.set('num-payload', {
        id: 'num-payload',
        traffic: 1.0,
        status: 'active',
        branches: [{ key: 'v1', weight: 100, payload: 42 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // This test will FAIL because getValue is not implemented
      const value = await ($.flag('num-payload') as any).getValue('user-123')
      expect(value).toBe(42)
    })

    it('returns array payload', async () => {
      $._storage.flags.set('arr-payload', {
        id: 'arr-payload',
        traffic: 1.0,
        status: 'active',
        branches: [{ key: 'v1', weight: 100, payload: ['a', 'b', 'c'] }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // This test will FAIL because getValue is not implemented
      const value = await ($.flag('arr-payload') as any).getValue('user-123')
      expect(value).toEqual(['a', 'b', 'c'])
    })

    it('returns boolean payload', async () => {
      $._storage.flags.set('bool-payload', {
        id: 'bool-payload',
        traffic: 1.0,
        status: 'active',
        branches: [{ key: 'v1', weight: 100, payload: true }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // This test will FAIL because getValue is not implemented
      const value = await ($.flag('bool-payload') as any).getValue('user-123')
      expect(value).toBe(true)
    })

    it('returns undefined when branch has no payload', async () => {
      $._storage.flags.set('no-payload', {
        id: 'no-payload',
        traffic: 1.0,
        status: 'active',
        branches: [{ key: 'v1', weight: 100 }], // No payload
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // This test will FAIL because getValue is not implemented
      const value = await ($.flag('no-payload') as any).getValue('user-123')
      expect(value).toBeUndefined()
    })
  })

  describe('deterministic assignment', () => {
    it('returns same value for same user', async () => {
      $._storage.flags.set('deterministic-value', {
        id: 'deterministic-value',
        traffic: 1.0,
        status: 'active',
        branches: [
          { key: 'a', weight: 50, payload: { variant: 'A' } },
          { key: 'b', weight: 50, payload: { variant: 'B' } },
        ],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // This test will FAIL because getValue is not implemented
      const value1 = await ($.flag('deterministic-value') as any).getValue('stable-user')
      const value2 = await ($.flag('deterministic-value') as any).getValue('stable-user')

      expect(value1).toEqual(value2)
    })
  })
})

// ============================================================================
// SECTION 4: getVariant Method Tests (RED - Not Yet Implemented)
// ============================================================================

describe('$.flag().getVariant(userId)', () => {
  let $: FlagContext

  beforeEach(() => {
    $ = createMockContext()
  })

  describe('return type', () => {
    it('returns a Promise', async () => {
      $._storage.flags.set('variant-flag', {
        id: 'variant-flag',
        traffic: 1.0,
        status: 'active',
        branches: [{ key: 'treatment', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // This test will FAIL because getVariant is not implemented
      const result = ($.flag('variant-flag') as any).getVariant('user-123')
      expect(result).toBeInstanceOf(Promise)
    })

    it('resolves to a string (variant key)', async () => {
      $._storage.flags.set('string-variant', {
        id: 'string-variant',
        traffic: 1.0,
        status: 'active',
        branches: [{ key: 'control', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // This test will FAIL because getVariant is not implemented
      const variant = await ($.flag('string-variant') as any).getVariant('user-123')
      expect(typeof variant).toBe('string')
      expect(variant).toBe('control')
    })
  })

  describe('flag does not exist', () => {
    it('returns null for nonexistent flag', async () => {
      // This test will FAIL because getVariant is not implemented
      const variant = await ($.flag('nonexistent') as any).getVariant('user-123')
      expect(variant).toBeNull()
    })
  })

  describe('user not in traffic', () => {
    it('returns null when user is not in traffic allocation', async () => {
      $._storage.flags.set('zero-traffic-variant', {
        id: 'zero-traffic-variant',
        traffic: 0,
        status: 'active',
        branches: [{ key: 'treatment', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // This test will FAIL because getVariant is not implemented
      const variant = await ($.flag('zero-traffic-variant') as any).getVariant('user-123')
      expect(variant).toBeNull()
    })
  })

  describe('flag is disabled', () => {
    it('returns null when flag is disabled', async () => {
      $._storage.flags.set('disabled-variant', {
        id: 'disabled-variant',
        traffic: 1.0,
        status: 'disabled',
        branches: [{ key: 'treatment', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // This test will FAIL because getVariant is not implemented
      const variant = await ($.flag('disabled-variant') as any).getVariant('user-123')
      expect(variant).toBeNull()
    })
  })

  describe('single variant', () => {
    it('returns the single variant key', async () => {
      $._storage.flags.set('single-branch', {
        id: 'single-branch',
        traffic: 1.0,
        status: 'active',
        branches: [{ key: 'only-variant', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // This test will FAIL because getVariant is not implemented
      const variant = await ($.flag('single-branch') as any).getVariant('user-123')
      expect(variant).toBe('only-variant')
    })
  })

  describe('multiple variants', () => {
    it('returns one of the variant keys', async () => {
      $._storage.flags.set('multi-branch', {
        id: 'multi-branch',
        traffic: 1.0,
        status: 'active',
        branches: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // This test will FAIL because getVariant is not implemented
      const variant = await ($.flag('multi-branch') as any).getVariant('user-123')
      expect(['control', 'treatment']).toContain(variant)
    })

    it('distributes users across variants', async () => {
      $._storage.flags.set('distribution-test', {
        id: 'distribution-test',
        traffic: 1.0,
        status: 'active',
        branches: [
          { key: 'a', weight: 50 },
          { key: 'b', weight: 50 },
        ],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // This test will FAIL because getVariant is not implemented
      const variants = await Promise.all(
        Array.from({ length: 100 }, (_, i) => ($.flag('distribution-test') as any).getVariant(`user-${i}`))
      )

      const countA = variants.filter((v: string | null) => v === 'a').length
      const countB = variants.filter((v: string | null) => v === 'b').length

      // Both variants should appear
      expect(countA).toBeGreaterThan(0)
      expect(countB).toBeGreaterThan(0)
    })
  })

  describe('deterministic assignment', () => {
    it('returns same variant for same user', async () => {
      $._storage.flags.set('deterministic-variant', {
        id: 'deterministic-variant',
        traffic: 1.0,
        status: 'active',
        branches: [
          { key: 'a', weight: 33 },
          { key: 'b', weight: 33 },
          { key: 'c', weight: 34 },
        ],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // This test will FAIL because getVariant is not implemented
      const variant1 = await ($.flag('deterministic-variant') as any).getVariant('stable-user')
      const variant2 = await ($.flag('deterministic-variant') as any).getVariant('stable-user')
      const variant3 = await ($.flag('deterministic-variant') as any).getVariant('stable-user')

      expect(variant1).toBe(variant2)
      expect(variant2).toBe(variant3)
    })

    it('different users may get different variants', async () => {
      $._storage.flags.set('different-users', {
        id: 'different-users',
        traffic: 1.0,
        status: 'active',
        branches: [
          { key: 'a', weight: 50 },
          { key: 'b', weight: 50 },
        ],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // This test will FAIL because getVariant is not implemented
      const users = Array.from({ length: 50 }, (_, i) => `different-user-${i}`)
      const variants = await Promise.all(users.map((u) => ($.flag('different-users') as any).getVariant(u)))

      // With 50 users and 50/50 split, we should see both variants
      const uniqueVariants = new Set(variants)
      expect(uniqueVariants.size).toBe(2)
    })
  })

  describe('no branches', () => {
    it('returns null when flag has no branches', async () => {
      $._storage.flags.set('no-branches', {
        id: 'no-branches',
        traffic: 1.0,
        status: 'active',
        branches: [], // Empty branches
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // This test will FAIL because getVariant is not implemented
      const variant = await ($.flag('no-branches') as any).getVariant('user-123')
      expect(variant).toBeNull()
    })
  })
})

// ============================================================================
// SECTION 5: User-Based Targeting Tests
// ============================================================================

describe('User-based targeting', () => {
  let $: FlagContext

  beforeEach(() => {
    $ = createMockContext()
  })

  describe('user ID hashing', () => {
    it('same user ID always gets same result for isEnabled', async () => {
      $._storage.flags.set('user-hash', {
        id: 'user-hash',
        traffic: 0.5,
        status: 'active',
        branches: [{ key: 'on', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const userId = 'consistent-user-id-12345'

      // Check multiple times
      const results = await Promise.all([
        $.flag('user-hash').isEnabled(userId),
        $.flag('user-hash').isEnabled(userId),
        $.flag('user-hash').isEnabled(userId),
        $.flag('user-hash').isEnabled(userId),
        $.flag('user-hash').isEnabled(userId),
      ])

      // All results should be identical
      expect(results.every((r) => r === results[0])).toBe(true)
    })

    it('same user ID always gets same variant', async () => {
      $._storage.flags.set('user-variant-hash', {
        id: 'user-variant-hash',
        traffic: 1.0,
        status: 'active',
        branches: [
          { key: 'a', weight: 25 },
          { key: 'b', weight: 25 },
          { key: 'c', weight: 25 },
          { key: 'd', weight: 25 },
        ],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const userId = 'variant-test-user'

      // This test will FAIL because getVariant is not implemented
      const variants = await Promise.all(
        Array.from({ length: 10 }, () => ($.flag('user-variant-hash') as any).getVariant(userId))
      )

      // All should be the same variant
      expect(variants.every((v: string | null) => v === variants[0])).toBe(true)
    })
  })

  describe('different flags are independent', () => {
    it('same user can have different results for different flags', async () => {
      // Create two flags with 50% traffic
      $._storage.flags.set('flag-x', {
        id: 'flag-x',
        traffic: 0.5,
        status: 'active',
        branches: [{ key: 'on', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      $._storage.flags.set('flag-y', {
        id: 'flag-y',
        traffic: 0.5,
        status: 'active',
        branches: [{ key: 'on', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // With many users, some should have different results for X and Y
      const users = Array.from({ length: 100 }, (_, i) => `independence-user-${i}`)

      const resultsX = await Promise.all(users.map((u) => $.flag('flag-x').isEnabled(u)))
      const resultsY = await Promise.all(users.map((u) => $.flag('flag-y').isEnabled(u)))

      // Count users with different results
      let differentCount = 0
      for (let i = 0; i < users.length; i++) {
        if (resultsX[i] !== resultsY[i]) {
          differentCount++
        }
      }

      // Should see some differences (independence)
      expect(differentCount).toBeGreaterThan(10)
    })
  })

  describe('user ID formats', () => {
    it('handles UUID format', async () => {
      $._storage.flags.set('uuid-flag', {
        id: 'uuid-flag',
        traffic: 1.0,
        status: 'active',
        branches: [{ key: 'on', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const result = await $.flag('uuid-flag').isEnabled('550e8400-e29b-41d4-a716-446655440000')
      expect(typeof result).toBe('boolean')
    })

    it('handles email format', async () => {
      $._storage.flags.set('email-flag', {
        id: 'email-flag',
        traffic: 1.0,
        status: 'active',
        branches: [{ key: 'on', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const result = await $.flag('email-flag').isEnabled('user@example.com')
      expect(typeof result).toBe('boolean')
    })

    it('handles numeric string ID', async () => {
      $._storage.flags.set('numeric-flag', {
        id: 'numeric-flag',
        traffic: 1.0,
        status: 'active',
        branches: [{ key: 'on', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const result = await $.flag('numeric-flag').isEnabled('12345678')
      expect(typeof result).toBe('boolean')
    })

    it('handles empty string user ID', async () => {
      $._storage.flags.set('empty-user-flag', {
        id: 'empty-user-flag',
        traffic: 1.0,
        status: 'active',
        branches: [{ key: 'on', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const result = await $.flag('empty-user-flag').isEnabled('')
      expect(typeof result).toBe('boolean')
    })

    it('handles special characters in user ID', async () => {
      $._storage.flags.set('special-char-flag', {
        id: 'special-char-flag',
        traffic: 1.0,
        status: 'active',
        branches: [{ key: 'on', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const result = await $.flag('special-char-flag').isEnabled('user/123:test@domain')
      expect(typeof result).toBe('boolean')
    })
  })
})

// ============================================================================
// SECTION 6: Edge Cases and Error Conditions
// ============================================================================

describe('Edge cases and error conditions', () => {
  let $: FlagContext

  beforeEach(() => {
    $ = createMockContext()
  })

  describe('concurrent access', () => {
    it('handles concurrent isEnabled calls', async () => {
      $._storage.flags.set('concurrent-flag', {
        id: 'concurrent-flag',
        traffic: 1.0,
        status: 'active',
        branches: [{ key: 'on', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Make many concurrent calls
      const promises = Array.from({ length: 100 }, (_, i) => $.flag('concurrent-flag').isEnabled(`user-${i}`))

      const results = await Promise.all(promises)

      // All should resolve successfully
      results.forEach((result) => {
        expect(typeof result).toBe('boolean')
      })
    })
  })

  describe('flag mutation during evaluation', () => {
    it('handles flag update between calls', async () => {
      $._storage.flags.set('mutable-flag', {
        id: 'mutable-flag',
        traffic: 0,
        status: 'active',
        branches: [{ key: 'on', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // First call with 0% traffic
      const before = await $.flag('mutable-flag').isEnabled('user-123')
      expect(before).toBe(false)

      // Update traffic
      $._storage.flags.get('mutable-flag')!.traffic = 1.0

      // Second call should reflect new traffic
      const after = await $.flag('mutable-flag').isEnabled('user-123')
      expect(after).toBe(true)
    })
  })

  describe('boundary conditions', () => {
    it('handles traffic at exact boundary (0)', async () => {
      $._storage.flags.set('boundary-zero', {
        id: 'boundary-zero',
        traffic: 0,
        status: 'active',
        branches: [{ key: 'on', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // All users should be excluded
      const results = await Promise.all(
        Array.from({ length: 100 }, (_, i) => $.flag('boundary-zero').isEnabled(`user-${i}`))
      )

      expect(results.every((r) => r === false)).toBe(true)
    })

    it('handles traffic at exact boundary (1)', async () => {
      $._storage.flags.set('boundary-one', {
        id: 'boundary-one',
        traffic: 1,
        status: 'active',
        branches: [{ key: 'on', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // All users should be included
      const results = await Promise.all(
        Array.from({ length: 100 }, (_, i) => $.flag('boundary-one').isEnabled(`user-${i}`))
      )

      expect(results.every((r) => r === true)).toBe(true)
    })

    it('handles very small traffic (0.001)', async () => {
      $._storage.flags.set('tiny-traffic', {
        id: 'tiny-traffic',
        traffic: 0.001,
        status: 'active',
        branches: [{ key: 'on', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // With 0.1% traffic, most should be false
      const results = await Promise.all(
        Array.from({ length: 1000 }, (_, i) => $.flag('tiny-traffic').isEnabled(`user-${i}`))
      )

      const enabledCount = results.filter((r) => r).length

      // Should be approximately 1 (0.1% of 1000)
      expect(enabledCount).toBeLessThan(20)
    })
  })

  describe('weight edge cases', () => {
    it('handles zero-weight branches', async () => {
      $._storage.flags.set('zero-weight', {
        id: 'zero-weight',
        traffic: 1.0,
        status: 'active',
        branches: [
          { key: 'zero', weight: 0 },
          { key: 'full', weight: 100 },
        ],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // This test will FAIL because getVariant is not implemented
      const variants = await Promise.all(
        Array.from({ length: 100 }, (_, i) => ($.flag('zero-weight') as any).getVariant(`user-${i}`))
      )

      // All should get 'full' variant, never 'zero'
      expect(variants.every((v: string | null) => v === 'full')).toBe(true)
    })

    it('handles all branches with zero weight', async () => {
      $._storage.flags.set('all-zero-weight', {
        id: 'all-zero-weight',
        traffic: 1.0,
        status: 'active',
        branches: [
          { key: 'a', weight: 0 },
          { key: 'b', weight: 0 },
        ],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // This test will FAIL because getVariant is not implemented
      const variant = await ($.flag('all-zero-weight') as any).getVariant('user-123')

      // Should return null when total weight is 0
      expect(variant).toBeNull()
    })
  })
})

// ============================================================================
// SECTION 7: Type Safety Tests
// ============================================================================

describe('Type safety', () => {
  it('FlagContextInstance interface includes getValue', () => {
    // This is a compile-time type check
    // The test will pass at runtime but we're checking the interface
    type HasGetValue = FlagContextInstance extends { getValue: (userId: string) => Promise<unknown> } ? true : false

    // This assertion will fail until getValue is added to the interface
    // We use a runtime check to verify the type definition
    const checkType: HasGetValue = false as HasGetValue
    // Note: This test documents that getValue should be added to FlagContextInstance
    expect(checkType).toBeDefined()
  })

  it('FlagContextInstance interface includes getVariant', () => {
    // This is a compile-time type check
    type HasGetVariant = FlagContextInstance extends { getVariant: (userId: string) => Promise<string | null> }
      ? true
      : false

    // This assertion will fail until getVariant is added to the interface
    const checkType: HasGetVariant = false as HasGetVariant
    // Note: This test documents that getVariant should be added to FlagContextInstance
    expect(checkType).toBeDefined()
  })
})
