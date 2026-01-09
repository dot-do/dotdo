import { describe, it, expect, beforeEach } from 'vitest'

/**
 * RED Phase Tests for $.flag() Workflow Context API
 *
 * These tests define the expected behavior of the $.flag() context API
 * that integrates feature flags into the workflow context ($).
 *
 * Tests will FAIL until the implementation is created.
 *
 * Related issues:
 * - dotdo-ppas: [Red] $.flag() context API tests
 *
 * The API integrates with the existing $ proxy pattern:
 * - $.flag('id') returns a FlagContextInstance for per-flag operations
 * - $.flags provides collection-level operations (fetch, evaluate)
 *
 * Enhanced Flag type includes:
 * - id: string
 * - traffic: number (0-1)
 * - status: 'active' | 'disabled' | 'archived'
 * - branches: Array<{ key: string; weight: number; payload?: unknown }>
 * - stickiness: 'user_id' | 'session_id' | 'random'
 */

/**
 * Flag definition with variant support and status
 */
export interface Flag {
  id: string
  traffic: number
  status: 'active' | 'disabled' | 'archived'
  branches: Array<{
    key: string
    weight: number
    payload?: unknown
  }>
  stickiness: 'user_id' | 'session_id' | 'random'
  createdAt: Date
  updatedAt: Date
}

/**
 * Result from evaluating a flag for a user
 */
export interface FlagEvaluation {
  enabled: boolean
  variant: string | null
  payload?: unknown
}

/**
 * Flag instance returned by $.flag('id')
 */
export interface FlagContextInstance {
  isEnabled(userId: string): Promise<boolean>
  get(userId: string): Promise<FlagEvaluation>
  setTraffic(traffic: number): Promise<void>
  enable(): Promise<void>
  disable(): Promise<void>
}

/**
 * Flags collection API at $.flags
 */
export interface FlagsCollection {
  fetch(): Promise<Record<string, Flag>>
  evaluate(flagId: string, userId: string, flags: Record<string, Flag>): FlagEvaluation
}

/**
 * Mock storage for flags
 */
interface MockStorage {
  flags: Map<string, Flag>
}

/**
 * Creates a mock workflow context ($) with flag support for testing
 *
 * This is the factory function that will need to be implemented.
 */
function createMockContext(): {
  flag: (id: string) => FlagContextInstance
  flags: FlagsCollection
  _storage: MockStorage
} {
  // This implementation will fail tests until the real implementation exists
  // For now, we throw to indicate the API doesn't exist
  throw new Error('createMockContext is not implemented - this is expected in RED phase')
}

// ============================================================================
// $.flag('id').isEnabled(userId) returns boolean
// ============================================================================

describe('$.flag().isEnabled() returns boolean', () => {
  it('returns false when flag does not exist', async () => {
    const $ = createMockContext()
    const enabled = await $.flag('nonexistent-flag').isEnabled('user-123')

    expect(enabled).toBe(false)
    expect(typeof enabled).toBe('boolean')
  })

  it('returns true when flag is enabled and user is in traffic', async () => {
    const $ = createMockContext()

    // Setup: create a flag with 100% traffic
    $._storage.flags.set('test-flag', {
      id: 'test-flag',
      traffic: 1.0,
      status: 'active',
      branches: [{ key: 'enabled', weight: 100 }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const enabled = await $.flag('test-flag').isEnabled('user-123')

    expect(enabled).toBe(true)
    expect(typeof enabled).toBe('boolean')
  })

  it('returns false when flag status is disabled', async () => {
    const $ = createMockContext()

    // Setup: create a disabled flag
    $._storage.flags.set('disabled-flag', {
      id: 'disabled-flag',
      traffic: 1.0, // Even with 100% traffic
      status: 'disabled', // Status overrides traffic
      branches: [{ key: 'enabled', weight: 100 }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const enabled = await $.flag('disabled-flag').isEnabled('user-123')

    expect(enabled).toBe(false)
  })

  it('returns same result for same userId (deterministic)', async () => {
    const $ = createMockContext()

    $._storage.flags.set('deterministic-flag', {
      id: 'deterministic-flag',
      traffic: 0.5,
      status: 'active',
      branches: [{ key: 'on', weight: 100 }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const result1 = await $.flag('deterministic-flag').isEnabled('user-abc')
    const result2 = await $.flag('deterministic-flag').isEnabled('user-abc')
    const result3 = await $.flag('deterministic-flag').isEnabled('user-abc')

    expect(result1).toBe(result2)
    expect(result2).toBe(result3)
  })
})

// ============================================================================
// $.flag('id').get(userId) returns { variant, payload }
// ============================================================================

describe('$.flag().get() returns evaluation result', () => {
  it('returns evaluation result with enabled, variant, and payload', async () => {
    const $ = createMockContext()

    $._storage.flags.set('variant-flag', {
      id: 'variant-flag',
      traffic: 1.0,
      status: 'active',
      branches: [
        { key: 'control', weight: 50, payload: { buttonColor: 'blue' } },
        { key: 'treatment', weight: 50, payload: { buttonColor: 'green' } },
      ],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const result = await $.flag('variant-flag').get('user-123')

    expect(result).toHaveProperty('enabled')
    expect(result).toHaveProperty('variant')
    expect(typeof result.enabled).toBe('boolean')
  })

  it('returns variant key for enabled user', async () => {
    const $ = createMockContext()

    $._storage.flags.set('single-variant', {
      id: 'single-variant',
      traffic: 1.0,
      status: 'active',
      branches: [{ key: 'v1', weight: 100, payload: { feature: 'new' } }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const result = await $.flag('single-variant').get('user-456')

    expect(result.enabled).toBe(true)
    expect(result.variant).toBe('v1')
    expect(result.payload).toEqual({ feature: 'new' })
  })

  it('returns null variant when user is not in traffic', async () => {
    const $ = createMockContext()

    $._storage.flags.set('zero-traffic', {
      id: 'zero-traffic',
      traffic: 0,
      status: 'active',
      branches: [{ key: 'v1', weight: 100 }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const result = await $.flag('zero-traffic').get('user-789')

    expect(result.enabled).toBe(false)
    expect(result.variant).toBeNull()
    expect(result.payload).toBeUndefined()
  })

  it('returns null variant for nonexistent flag', async () => {
    const $ = createMockContext()

    const result = await $.flag('does-not-exist').get('user-123')

    expect(result.enabled).toBe(false)
    expect(result.variant).toBeNull()
  })

  it('deterministically assigns same variant to same user', async () => {
    const $ = createMockContext()

    $._storage.flags.set('multi-variant', {
      id: 'multi-variant',
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

    const result1 = await $.flag('multi-variant').get('consistent-user')
    const result2 = await $.flag('multi-variant').get('consistent-user')

    expect(result1.variant).toBe(result2.variant)
  })
})

// ============================================================================
// $.flag('id').setTraffic(n) updates flag traffic
// ============================================================================

describe('$.flag().setTraffic() updates traffic allocation', () => {
  it('updates traffic from 0 to 0.5', async () => {
    const $ = createMockContext()

    $._storage.flags.set('traffic-update', {
      id: 'traffic-update',
      traffic: 0,
      status: 'active',
      branches: [{ key: 'on', weight: 100 }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await $.flag('traffic-update').setTraffic(0.5)

    const flag = $._storage.flags.get('traffic-update')
    expect(flag?.traffic).toBe(0.5)
  })

  it('validates traffic is between 0 and 1', async () => {
    const $ = createMockContext()

    $._storage.flags.set('validate-traffic', {
      id: 'validate-traffic',
      traffic: 0.5,
      status: 'active',
      branches: [{ key: 'on', weight: 100 }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await expect($.flag('validate-traffic').setTraffic(1.5)).rejects.toThrow()
    await expect($.flag('validate-traffic').setTraffic(-0.1)).rejects.toThrow()
  })

  it('throws for nonexistent flag', async () => {
    const $ = createMockContext()

    await expect($.flag('nonexistent').setTraffic(0.5)).rejects.toThrow()
  })

  it('updates updatedAt timestamp', async () => {
    const $ = createMockContext()

    const originalDate = new Date('2024-01-01')
    $._storage.flags.set('timestamp-flag', {
      id: 'timestamp-flag',
      traffic: 0,
      status: 'active',
      branches: [{ key: 'on', weight: 100 }],
      stickiness: 'user_id',
      createdAt: originalDate,
      updatedAt: originalDate,
    })

    await $.flag('timestamp-flag').setTraffic(0.5)

    const flag = $._storage.flags.get('timestamp-flag')
    expect(flag?.updatedAt.getTime()).toBeGreaterThan(originalDate.getTime())
  })
})

// ============================================================================
// $.flag('id').enable() sets traffic to 1 and status to active
// ============================================================================

describe('$.flag().enable() activates flag', () => {
  it('sets traffic to 1.0', async () => {
    const $ = createMockContext()

    $._storage.flags.set('enable-flag', {
      id: 'enable-flag',
      traffic: 0.1,
      status: 'disabled',
      branches: [{ key: 'on', weight: 100 }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await $.flag('enable-flag').enable()

    const flag = $._storage.flags.get('enable-flag')
    expect(flag?.traffic).toBe(1.0)
  })

  it('sets status to active', async () => {
    const $ = createMockContext()

    $._storage.flags.set('enable-status', {
      id: 'enable-status',
      traffic: 0.5,
      status: 'disabled',
      branches: [{ key: 'on', weight: 100 }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await $.flag('enable-status').enable()

    const flag = $._storage.flags.get('enable-status')
    expect(flag?.status).toBe('active')
  })

  it('is idempotent - calling multiple times has same effect', async () => {
    const $ = createMockContext()

    $._storage.flags.set('idempotent-enable', {
      id: 'idempotent-enable',
      traffic: 0,
      status: 'disabled',
      branches: [{ key: 'on', weight: 100 }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await $.flag('idempotent-enable').enable()
    await $.flag('idempotent-enable').enable()
    await $.flag('idempotent-enable').enable()

    const flag = $._storage.flags.get('idempotent-enable')
    expect(flag?.traffic).toBe(1.0)
    expect(flag?.status).toBe('active')
  })

  it('throws for nonexistent flag', async () => {
    const $ = createMockContext()

    await expect($.flag('nonexistent').enable()).rejects.toThrow()
  })

  it('enables all users after calling enable()', async () => {
    const $ = createMockContext()

    $._storage.flags.set('full-enable', {
      id: 'full-enable',
      traffic: 0,
      status: 'disabled',
      branches: [{ key: 'on', weight: 100 }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // Before enable, should be disabled
    const before = await $.flag('full-enable').isEnabled('user-1')
    expect(before).toBe(false)

    await $.flag('full-enable').enable()

    // After enable, all users should be enabled
    const results = await Promise.all([
      $.flag('full-enable').isEnabled('user-1'),
      $.flag('full-enable').isEnabled('user-2'),
      $.flag('full-enable').isEnabled('user-999'),
    ])

    expect(results.every((r) => r === true)).toBe(true)
  })
})

// ============================================================================
// $.flag('id').disable() sets status to disabled
// ============================================================================

describe('$.flag().disable() deactivates flag', () => {
  it('sets status to disabled', async () => {
    const $ = createMockContext()

    $._storage.flags.set('disable-flag', {
      id: 'disable-flag',
      traffic: 1.0,
      status: 'active',
      branches: [{ key: 'on', weight: 100 }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await $.flag('disable-flag').disable()

    const flag = $._storage.flags.get('disable-flag')
    expect(flag?.status).toBe('disabled')
  })

  it('preserves traffic value (does not change to 0)', async () => {
    const $ = createMockContext()

    $._storage.flags.set('preserve-traffic', {
      id: 'preserve-traffic',
      traffic: 0.75, // Original traffic
      status: 'active',
      branches: [{ key: 'on', weight: 100 }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await $.flag('preserve-traffic').disable()

    const flag = $._storage.flags.get('preserve-traffic')
    // Traffic should be preserved for when re-enabling
    expect(flag?.traffic).toBe(0.75)
    expect(flag?.status).toBe('disabled')
  })

  it('is idempotent - calling multiple times has same effect', async () => {
    const $ = createMockContext()

    $._storage.flags.set('idempotent-disable', {
      id: 'idempotent-disable',
      traffic: 1.0,
      status: 'active',
      branches: [{ key: 'on', weight: 100 }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await $.flag('idempotent-disable').disable()
    await $.flag('idempotent-disable').disable()
    await $.flag('idempotent-disable').disable()

    const flag = $._storage.flags.get('idempotent-disable')
    expect(flag?.status).toBe('disabled')
  })

  it('throws for nonexistent flag', async () => {
    const $ = createMockContext()

    await expect($.flag('nonexistent').disable()).rejects.toThrow()
  })

  it('disables all users after calling disable()', async () => {
    const $ = createMockContext()

    $._storage.flags.set('full-disable', {
      id: 'full-disable',
      traffic: 1.0,
      status: 'active',
      branches: [{ key: 'on', weight: 100 }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // Before disable, should be enabled
    const before = await $.flag('full-disable').isEnabled('user-1')
    expect(before).toBe(true)

    await $.flag('full-disable').disable()

    // After disable, all users should be disabled
    const results = await Promise.all([
      $.flag('full-disable').isEnabled('user-1'),
      $.flag('full-disable').isEnabled('user-2'),
      $.flag('full-disable').isEnabled('user-999'),
    ])

    expect(results.every((r) => r === false)).toBe(true)
  })
})

// ============================================================================
// $.flags.fetch() returns all flag definitions as Record<string, Flag>
// ============================================================================

describe('$.flags.fetch() returns all flag definitions', () => {
  it('returns empty object when no flags exist', async () => {
    const $ = createMockContext()

    const flags = await $.flags.fetch()

    expect(flags).toEqual({})
    expect(typeof flags).toBe('object')
  })

  it('returns all flags keyed by id', async () => {
    const $ = createMockContext()

    const flag1: Flag = {
      id: 'flag-1',
      traffic: 0.5,
      status: 'active',
      branches: [{ key: 'on', weight: 100 }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const flag2: Flag = {
      id: 'flag-2',
      traffic: 1.0,
      status: 'active',
      branches: [{ key: 'on', weight: 100 }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    $._storage.flags.set('flag-1', flag1)
    $._storage.flags.set('flag-2', flag2)

    const flags = await $.flags.fetch()

    expect(flags['flag-1']).toBeDefined()
    expect(flags['flag-2']).toBeDefined()
    expect(flags['flag-1'].id).toBe('flag-1')
    expect(flags['flag-2'].id).toBe('flag-2')
  })

  it('returns Record<string, Flag> type', async () => {
    const $ = createMockContext()

    $._storage.flags.set('typed-flag', {
      id: 'typed-flag',
      traffic: 0.5,
      status: 'active',
      branches: [{ key: 'v1', weight: 100, payload: { data: 'test' } }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const flags = await $.flags.fetch()

    // Verify structure of returned flags
    const flag = flags['typed-flag']
    expect(flag.id).toBe('typed-flag')
    expect(flag.traffic).toBe(0.5)
    expect(flag.status).toBe('active')
    expect(flag.branches).toHaveLength(1)
    expect(flag.branches[0].key).toBe('v1')
    expect(flag.branches[0].payload).toEqual({ data: 'test' })
    expect(flag.stickiness).toBe('user_id')
  })

  it('returns a snapshot (mutations do not affect storage)', async () => {
    const $ = createMockContext()

    $._storage.flags.set('snapshot-flag', {
      id: 'snapshot-flag',
      traffic: 0.5,
      status: 'active',
      branches: [{ key: 'on', weight: 100 }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const flags = await $.flags.fetch()

    // Mutate the returned object
    flags['snapshot-flag'].traffic = 0.9
    delete flags['snapshot-flag']

    // Original storage should be unchanged
    const refetched = await $.flags.fetch()
    expect(refetched['snapshot-flag']).toBeDefined()
    expect(refetched['snapshot-flag'].traffic).toBe(0.5)
  })
})

// ============================================================================
// $.flags.evaluate() does local evaluation without DB lookup
// ============================================================================

describe('$.flags.evaluate() performs local evaluation', () => {
  it('evaluates flag against provided flags object (no DB lookup)', () => {
    const $ = createMockContext()

    const flags: Record<string, Flag> = {
      'local-flag': {
        id: 'local-flag',
        traffic: 1.0,
        status: 'active',
        branches: [{ key: 'enabled', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    }

    // This should be synchronous and not hit any database
    const result = $.flags.evaluate('local-flag', 'user-123', flags)

    expect(result.enabled).toBe(true)
    expect(result.variant).toBe('enabled')
  })

  it('returns disabled for flag not in provided flags object', () => {
    const $ = createMockContext()

    const flags: Record<string, Flag> = {}

    const result = $.flags.evaluate('missing-flag', 'user-123', flags)

    expect(result.enabled).toBe(false)
    expect(result.variant).toBeNull()
  })

  it('respects traffic allocation in local evaluation', () => {
    const $ = createMockContext()

    const flags: Record<string, Flag> = {
      'partial-traffic': {
        id: 'partial-traffic',
        traffic: 0.5,
        status: 'active',
        branches: [{ key: 'on', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    }

    // Test multiple users to verify distribution
    const results = Array.from({ length: 100 }, (_, i) => $.flags.evaluate('partial-traffic', `user-${i}`, flags))

    const enabledCount = results.filter((r) => r.enabled).length

    // With 50% traffic, expect roughly 50 enabled (with variance)
    expect(enabledCount).toBeGreaterThan(30)
    expect(enabledCount).toBeLessThan(70)
  })

  it('respects disabled status in local evaluation', () => {
    const $ = createMockContext()

    const flags: Record<string, Flag> = {
      'disabled-local': {
        id: 'disabled-local',
        traffic: 1.0,
        status: 'disabled',
        branches: [{ key: 'on', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    }

    const result = $.flags.evaluate('disabled-local', 'user-123', flags)

    expect(result.enabled).toBe(false)
  })

  it('selects variant based on weights', () => {
    const $ = createMockContext()

    const flags: Record<string, Flag> = {
      'weighted-variants': {
        id: 'weighted-variants',
        traffic: 1.0,
        status: 'active',
        branches: [
          { key: 'a', weight: 50, payload: { version: 'a' } },
          { key: 'b', weight: 50, payload: { version: 'b' } },
        ],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    }

    // Test distribution across many users
    const variants = Array.from({ length: 100 }, (_, i) => $.flags.evaluate('weighted-variants', `user-${i}`, flags).variant)

    const countA = variants.filter((v) => v === 'a').length
    const countB = variants.filter((v) => v === 'b').length

    // Both variants should appear
    expect(countA).toBeGreaterThan(0)
    expect(countB).toBeGreaterThan(0)
  })

  it('returns payload for selected variant', () => {
    const $ = createMockContext()

    const flags: Record<string, Flag> = {
      'payload-test': {
        id: 'payload-test',
        traffic: 1.0,
        status: 'active',
        branches: [{ key: 'treatment', weight: 100, payload: { buttonColor: 'green', fontSize: 14 } }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    }

    const result = $.flags.evaluate('payload-test', 'user-123', flags)

    expect(result.enabled).toBe(true)
    expect(result.variant).toBe('treatment')
    expect(result.payload).toEqual({ buttonColor: 'green', fontSize: 14 })
  })

  it('is deterministic for same user and flag', () => {
    const $ = createMockContext()

    const flags: Record<string, Flag> = {
      'deterministic-local': {
        id: 'deterministic-local',
        traffic: 0.5,
        status: 'active',
        branches: [
          { key: 'a', weight: 50 },
          { key: 'b', weight: 50 },
        ],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    }

    const result1 = $.flags.evaluate('deterministic-local', 'stable-user', flags)
    const result2 = $.flags.evaluate('deterministic-local', 'stable-user', flags)
    const result3 = $.flags.evaluate('deterministic-local', 'stable-user', flags)

    expect(result1.enabled).toBe(result2.enabled)
    expect(result1.variant).toBe(result2.variant)
    expect(result2.enabled).toBe(result3.enabled)
    expect(result2.variant).toBe(result3.variant)
  })

  it('is synchronous (returns result directly, not Promise)', () => {
    const $ = createMockContext()

    const flags: Record<string, Flag> = {
      'sync-flag': {
        id: 'sync-flag',
        traffic: 1.0,
        status: 'active',
        branches: [{ key: 'on', weight: 100 }],
        stickiness: 'user_id',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    }

    const result = $.flags.evaluate('sync-flag', 'user-123', flags)

    // Result should not be a Promise
    expect(result).not.toBeInstanceOf(Promise)
    expect(result.enabled).toBe(true)
  })
})

// ============================================================================
// Integration: flag and flags work together
// ============================================================================

describe('$.flag and $.flags integration', () => {
  it('$.flags.fetch() can be used with $.flags.evaluate() for local-first evaluation', async () => {
    const $ = createMockContext()

    // Setup some flags in storage
    $._storage.flags.set('integration-flag', {
      id: 'integration-flag',
      traffic: 1.0,
      status: 'active',
      branches: [{ key: 'v1', weight: 100, payload: { enabled: true } }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // Fetch all flags once
    const allFlags = await $.flags.fetch()

    // Evaluate locally multiple times without additional fetches
    const result1 = $.flags.evaluate('integration-flag', 'user-1', allFlags)
    const result2 = $.flags.evaluate('integration-flag', 'user-2', allFlags)
    const result3 = $.flags.evaluate('integration-flag', 'user-3', allFlags)

    expect(result1.enabled).toBe(true)
    expect(result2.enabled).toBe(true)
    expect(result3.enabled).toBe(true)
  })

  it('changes via $.flag().enable() are reflected in subsequent $.flags.fetch()', async () => {
    const $ = createMockContext()

    $._storage.flags.set('change-flag', {
      id: 'change-flag',
      traffic: 0,
      status: 'disabled',
      branches: [{ key: 'on', weight: 100 }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // Enable the flag
    await $.flag('change-flag').enable()

    // Fetch should reflect the change
    const flags = await $.flags.fetch()

    expect(flags['change-flag'].traffic).toBe(1.0)
    expect(flags['change-flag'].status).toBe('active')
  })

  it('$.flag().isEnabled() and $.flags.evaluate() give consistent results', async () => {
    const $ = createMockContext()

    $._storage.flags.set('consistency-check', {
      id: 'consistency-check',
      traffic: 1.0,
      status: 'active',
      branches: [{ key: 'on', weight: 100 }],
      stickiness: 'user_id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const flags = await $.flags.fetch()
    const userId = 'consistent-user-123'

    // Both methods should give the same enabled result
    const isEnabledResult = await $.flag('consistency-check').isEnabled(userId)
    const evaluateResult = $.flags.evaluate('consistency-check', userId, flags)

    expect(isEnabledResult).toBe(evaluateResult.enabled)
  })
})
