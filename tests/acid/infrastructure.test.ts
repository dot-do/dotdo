/**
 * ACID Test Infrastructure Tests
 *
 * Tests for the ACID testing infrastructure itself. Verifies that:
 * - Location types are correctly defined
 * - Lifecycle types work as expected
 * - Fixtures load correctly
 * - Base classes can be extended
 * - Custom matchers work
 * - Context properly manages DOs
 *
 * @module tests/acid/infrastructure
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// Import from the testing/acid module
import {
  // Fixtures
  FIXTURES,
  createThingFixture,
  createThingFixtures,
  createVersionedThingFixtures,
  createRelationshipFixtures,
  createActionFixtures,
  createEventFixtures,

  // Context
  createACIDTestContext,
  defaultACIDTestConfig,
  type ACIDTestContext,
  type ACIDTestConfig,

  // Base classes
  ACIDTestBase,
  LifecycleTestBase,
  CrossDOTestBase,

  // Matchers
  acidMatchers,
} from '../../testing/acid'

// Import types from types/acid
import {
  type RegionHint,
  type ColoCode,
  type LocationConfig,
  REGION_COLOS,
  ALL_REGIONS,
  ALL_COLOS,
  getRegionForColo,
  getColosForRegion,
  isColoInRegion,
  validateLocationConfig,
} from '../../types/acid/location'

import {
  type CloneMode,
  type CloneOptions,
  type LifecycleStatus,
  type LifecycleOperation,
  isCloneMode,
  isLifecycleStatus,
  isLifecycleOperation,
  validateCloneOptions,
  createLifecycleEvent,
} from '../../types/acid/lifecycle'

// Extend Vitest with ACID matchers for this test file
expect.extend(acidMatchers)

// ============================================================================
// LOCATION TYPES TESTS
// ============================================================================

describe('Location Types', () => {
  describe('REGION_COLOS mapping', () => {
    it('contains all regions', () => {
      for (const region of ALL_REGIONS) {
        expect(REGION_COLOS).toHaveProperty(region)
      }
    })

    it('maps regions to valid colo arrays', () => {
      for (const region of ALL_REGIONS) {
        const colos = REGION_COLOS[region]
        expect(Array.isArray(colos)).toBe(true)
      }
    })

    it('wnam region has west coast colos', () => {
      expect(REGION_COLOS.wnam).toContain('lax')
      expect(REGION_COLOS.wnam).toContain('sjc')
      expect(REGION_COLOS.wnam).toContain('sea')
    })

    it('enam region has east coast colos', () => {
      expect(REGION_COLOS.enam).toContain('ewr')
      expect(REGION_COLOS.enam).toContain('ord')
      expect(REGION_COLOS.enam).toContain('iad')
    })

    it('weur region has western european colos', () => {
      expect(REGION_COLOS.weur).toContain('cdg')
      expect(REGION_COLOS.weur).toContain('ams')
      expect(REGION_COLOS.weur).toContain('fra')
      expect(REGION_COLOS.weur).toContain('lhr')
    })
  })

  describe('getRegionForColo', () => {
    it('returns correct region for wnam colo', () => {
      expect(getRegionForColo('lax')).toBe('wnam')
      expect(getRegionForColo('sjc')).toBe('wnam')
    })

    it('returns correct region for enam colo', () => {
      expect(getRegionForColo('ewr')).toBe('enam')
      expect(getRegionForColo('ord')).toBe('enam')
    })

    it('returns correct region for weur colo', () => {
      expect(getRegionForColo('cdg')).toBe('weur')
      expect(getRegionForColo('fra')).toBe('weur')
    })

    it('returns correct region for apac colo', () => {
      expect(getRegionForColo('sin')).toBe('apac')
      expect(getRegionForColo('nrt')).toBe('apac')
    })
  })

  describe('getColosForRegion', () => {
    it('returns colos for wnam', () => {
      const colos = getColosForRegion('wnam')
      expect(colos).toContain('lax')
      expect(colos).toContain('sjc')
    })

    it('returns empty array for me region', () => {
      const colos = getColosForRegion('me')
      expect(colos).toHaveLength(0)
    })
  })

  describe('isColoInRegion', () => {
    it('returns true for valid colo-region pairs', () => {
      expect(isColoInRegion('lax', 'wnam')).toBe(true)
      expect(isColoInRegion('ewr', 'enam')).toBe(true)
      expect(isColoInRegion('cdg', 'weur')).toBe(true)
    })

    it('returns false for invalid colo-region pairs', () => {
      expect(isColoInRegion('lax', 'enam')).toBe(false)
      expect(isColoInRegion('ewr', 'wnam')).toBe(false)
      expect(isColoInRegion('cdg', 'apac')).toBe(false)
    })
  })

  describe('validateLocationConfig', () => {
    it('validates valid config', () => {
      const config: LocationConfig = {
        region: 'wnam',
        colo: 'lax',
        latencyMs: 10,
      }
      expect(validateLocationConfig(config)).toBe(true)
    })

    it('throws for mismatched colo and region', () => {
      const config: LocationConfig = {
        region: 'wnam',
        colo: 'cdg', // cdg is in weur, not wnam
      }
      expect(() => validateLocationConfig(config)).toThrow()
    })

    it('throws for negative latency', () => {
      const config: LocationConfig = {
        latencyMs: -10,
      }
      expect(() => validateLocationConfig(config)).toThrow()
    })
  })
})

// ============================================================================
// LIFECYCLE TYPES TESTS
// ============================================================================

describe('Lifecycle Types', () => {
  describe('isCloneMode', () => {
    it('returns true for valid clone modes', () => {
      expect(isCloneMode('atomic')).toBe(true)
      expect(isCloneMode('staged')).toBe(true)
      expect(isCloneMode('eventual')).toBe(true)
      expect(isCloneMode('resumable')).toBe(true)
    })

    it('returns false for invalid values', () => {
      expect(isCloneMode('invalid')).toBe(false)
      expect(isCloneMode('')).toBe(false)
      expect(isCloneMode(123)).toBe(false)
      expect(isCloneMode(null)).toBe(false)
    })
  })

  describe('isLifecycleStatus', () => {
    it('returns true for valid statuses', () => {
      expect(isLifecycleStatus('pending')).toBe(true)
      expect(isLifecycleStatus('in_progress')).toBe(true)
      expect(isLifecycleStatus('completed')).toBe(true)
      expect(isLifecycleStatus('failed')).toBe(true)
      expect(isLifecycleStatus('rolled_back')).toBe(true)
    })

    it('returns false for invalid values', () => {
      expect(isLifecycleStatus('invalid')).toBe(false)
      expect(isLifecycleStatus('')).toBe(false)
    })
  })

  describe('isLifecycleOperation', () => {
    it('returns true for valid operations', () => {
      expect(isLifecycleOperation('fork')).toBe(true)
      expect(isLifecycleOperation('compact')).toBe(true)
      expect(isLifecycleOperation('moveTo')).toBe(true)
      expect(isLifecycleOperation('clone')).toBe(true)
      expect(isLifecycleOperation('shard')).toBe(true)
      expect(isLifecycleOperation('unshard')).toBe(true)
      expect(isLifecycleOperation('replicate')).toBe(true)
    })

    it('returns false for invalid values', () => {
      expect(isLifecycleOperation('invalid')).toBe(false)
    })
  })

  describe('validateCloneOptions', () => {
    it('validates valid options', () => {
      const options: CloneOptions = {
        mode: 'atomic',
        to: 'https://target.api.dotdo.dev',
      }
      const result = validateCloneOptions(options)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('requires mode', () => {
      const result = validateCloneOptions({ to: 'https://target.do' })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('mode is required')
    })

    it('requires to', () => {
      const result = validateCloneOptions({ mode: 'atomic' })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('to is required')
    })

    it('validates to is valid URL', () => {
      const result = validateCloneOptions({
        mode: 'atomic',
        to: 'not-a-url',
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('Invalid URL'))).toBe(true)
    })

    it('validates to uses http/https', () => {
      const result = validateCloneOptions({
        mode: 'atomic',
        to: 'ftp://target.do',
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('http or https'))).toBe(true)
    })
  })

  describe('createLifecycleEvent', () => {
    it('creates event with defaults', () => {
      const event = createLifecycleEvent('fork')
      expect(event.operation).toBe('fork')
      expect(event.status).toBe('pending')
      expect(event.startedAt).toBeInstanceOf(Date)
      expect(event.completedAt).toBeUndefined()
      expect(event.metadata).toEqual({})
    })

    it('creates event with metadata', () => {
      const event = createLifecycleEvent('clone', { target: 'https://target.do' })
      expect(event.metadata).toEqual({ target: 'https://target.do' })
    })
  })
})

// ============================================================================
// CONTEXT TESTS
// ============================================================================

describe('ACIDTestContext', () => {
  let ctx: ACIDTestContext

  beforeEach(() => {
    ctx = createACIDTestContext({ isolation: 'full' })
  })

  afterEach(() => {
    ctx.cleanup()
  })

  describe('createACIDTestContext', () => {
    it('creates context with default config', () => {
      const defaultCtx = createACIDTestContext()
      expect(defaultCtx.config.isolation).toBe('storage')
      expect(defaultCtx.config.timeout).toBe(5000)
      defaultCtx.cleanup()
    })

    it('creates context with custom config', () => {
      expect(ctx.config.isolation).toBe('full')
    })

    it('accepts network configuration', () => {
      const networkCtx = createACIDTestContext({
        network: { latencyMs: 10, jitterMs: 5, dropRate: 0.1 },
      })
      expect(networkCtx.config.network?.latencyMs).toBe(10)
      expect(networkCtx.config.network?.jitterMs).toBe(5)
      expect(networkCtx.config.network?.dropRate).toBe(0.1)
      networkCtx.cleanup()
    })
  })

  describe('defaultACIDTestConfig', () => {
    it('has expected defaults', () => {
      expect(defaultACIDTestConfig.isolation).toBe('storage')
      expect(defaultACIDTestConfig.timeout).toBe(5000)
    })
  })

  describe('lifecycle event tracking', () => {
    it('records and retrieves events', async () => {
      const event = createLifecycleEvent('fork', { target: 'test' })
      ctx.recordEvent('do-1', event)

      const history = await ctx.getHistory('do-1')
      expect(history).toHaveLength(1)
      expect(history[0]?.operation).toBe('fork')
    })

    it('updates event status', async () => {
      const event = createLifecycleEvent('compact')
      ctx.recordEvent('do-1', event)

      ctx.updateEventStatus('do-1', 0, 'completed')

      const history = await ctx.getHistory('do-1')
      expect(history[0]?.status).toBe('completed')
      expect(history[0]?.completedAt).toBeInstanceOf(Date)
    })

    it('updates event with error on failure', async () => {
      const event = createLifecycleEvent('clone')
      ctx.recordEvent('do-1', event)

      ctx.updateEventStatus('do-1', 0, 'failed', 'Network error')

      const history = await ctx.getHistory('do-1')
      expect(history[0]?.status).toBe('failed')
      expect(history[0]?.error).toBe('Network error')
    })
  })

  describe('partition and heal', () => {
    it('partitions DOs', async () => {
      await ctx.partition(['do-1', 'do-2'])
      // Partition state is internal, but should not throw
    })

    it('heals partitions', async () => {
      await ctx.partition(['do-1', 'do-2'])
      await ctx.heal()
      // Should not throw
    })
  })

  describe('cleanup', () => {
    it('clears all state', async () => {
      const event = createLifecycleEvent('fork')
      ctx.recordEvent('do-1', event)

      ctx.cleanup()

      const history = await ctx.getHistory('do-1')
      expect(history).toHaveLength(0)
    })
  })
})

// ============================================================================
// MATCHERS TESTS
// ============================================================================

describe('ACID Matchers', () => {
  describe('toBeAtomic', () => {
    it('passes when operation succeeds with expected state', () => {
      const result = {
        success: true,
        stateBefore: { value: 1 },
        stateAfter: { value: 2 },
      }
      expect(result).toBeAtomic({ value: 2 })
    })

    it('passes when operation fails and state is rolled back', () => {
      const result = {
        success: false,
        stateBefore: { value: 1 },
        stateAfter: { value: 1 }, // Same as before = rollback
      }
      expect(result).toBeAtomic({ value: 999 }) // Expected doesn't matter on failure
    })

    it('fails when operation succeeds but state mismatch', () => {
      const result = {
        success: true,
        stateBefore: { value: 1 },
        stateAfter: { value: 2 },
      }
      expect(() => expect(result).toBeAtomic({ value: 3 })).toThrow()
    })

    it('fails when operation fails but state not rolled back', () => {
      const result = {
        success: false,
        stateBefore: { value: 1 },
        stateAfter: { value: 2 }, // Different = not rolled back
      }
      expect(() => expect(result).toBeAtomic({ value: 1 })).toThrow()
    })
  })

  describe('toBeConsistent', () => {
    it('passes for valid state', () => {
      const state = {
        id: 'test-1',
        count: 42,
        active: true,
        items: [1, 2, 3],
        config: { key: 'value' },
      }

      expect(state).toBeConsistent({
        id: 'string',
        count: 'number',
        active: 'boolean',
        items: 'array',
        config: 'object',
      })
    })

    it('fails for missing required field', () => {
      const state = { id: 'test-1' }

      expect(() =>
        expect(state).toBeConsistent({
          id: 'string',
          required: 'number',
        })
      ).toThrow()
    })

    it('fails for type mismatch', () => {
      const state = { id: 123 } // Should be string

      expect(() =>
        expect(state).toBeConsistent({ id: 'string' })
      ).toThrow()
    })

    it('passes for optional field when missing', () => {
      const state = { id: 'test-1' }

      expect(state).toBeConsistent({
        id: 'string',
        optional: { type: 'number', optional: true },
      })
    })
  })

  describe('toBeIsolated', () => {
    it('passes when results match expected', () => {
      const result = {
        results: [1, 2, 3],
        expectedResults: [1, 2, 3],
      }
      expect(result).toBeIsolated()
    })

    it('fails when results mismatch', () => {
      const result = {
        results: [1, 2, 3],
        expectedResults: [1, 2, 4],
      }
      expect(() => expect(result).toBeIsolated()).toThrow()
    })

    it('fails when result count mismatch', () => {
      const result = {
        results: [1, 2],
        expectedResults: [1, 2, 3],
      }
      expect(() => expect(result).toBeIsolated()).toThrow()
    })
  })

  describe('toBeDurable', () => {
    it('passes when state persists', () => {
      const result = {
        stateBefore: { saved: true },
        stateAfter: { saved: true },
      }
      expect(result).toBeDurable({ saved: true })
    })

    it('fails when state changes after restart', () => {
      const result = {
        stateBefore: { saved: true },
        stateAfter: { saved: false },
      }
      expect(() => expect(result).toBeDurable({ saved: true })).toThrow()
    })
  })

  describe('toHaveEmitted', () => {
    it('passes when event exists', () => {
      const history = [
        createLifecycleEvent('fork'),
        { ...createLifecycleEvent('compact'), status: 'completed' as const },
      ]
      expect(history).toHaveEmitted('fork')
      expect(history).toHaveEmitted('compact', 'completed')
    })

    it('fails when event missing', () => {
      const history = [createLifecycleEvent('fork')]
      expect(() => expect(history).toHaveEmitted('clone')).toThrow()
    })

    it('fails when status mismatch', () => {
      const history = [createLifecycleEvent('fork')] // status is 'pending'
      expect(() => expect(history).toHaveEmitted('fork', 'completed')).toThrow()
    })
  })

  describe('toHaveRolledBack', () => {
    it('passes when state equals original', () => {
      const currentState = { value: 1 }
      const originalState = { value: 1 }
      expect(currentState).toHaveRolledBack(originalState)
    })

    it('fails when state differs from original', () => {
      const currentState = { value: 2 }
      const originalState = { value: 1 }
      expect(() => expect(currentState).toHaveRolledBack(originalState)).toThrow()
    })
  })
})

// ============================================================================
// BASE CLASS TESTS (verify they can be extended)
// ============================================================================

describe('Base Classes', () => {
  describe('ACIDTestBase', () => {
    it('can be extended', () => {
      // Verify the class can be extended (compile-time check)
      class TestImpl extends ACIDTestBase {
        getConfig(): ACIDTestConfig {
          return { isolation: 'storage' }
        }
        async setup(): Promise<void> {}
        async teardown(): Promise<void> {}
      }

      const instance = new TestImpl()
      expect(instance.getConfig()).toEqual({ isolation: 'storage' })
    })
  })

  describe('LifecycleTestBase', () => {
    it('can be extended', () => {
      class TestImpl extends LifecycleTestBase {
        getConfig(): ACIDTestConfig {
          return { isolation: 'full' }
        }
        async setup(): Promise<void> {}
        async teardown(): Promise<void> {}
      }

      const instance = new TestImpl()
      expect(instance.getConfig()).toEqual({ isolation: 'full' })
    })
  })

  describe('CrossDOTestBase', () => {
    it('can be extended', () => {
      class TestImpl extends CrossDOTestBase {
        getConfig(): ACIDTestConfig {
          return { isolation: 'storage' }
        }
        async setup(): Promise<void> {}
        async teardown(): Promise<void> {}
      }

      const instance = new TestImpl()
      expect(instance['cluster']).toEqual([]) // Protected member
    })
  })
})

// ============================================================================
// FIXTURES TESTS (verify factories work)
// ============================================================================

describe('Fixture Factories', () => {
  describe('createThingFixture', () => {
    it('creates fixture with defaults', () => {
      const thing = createThingFixture()
      expect(thing.type).toBe(1)
      expect(thing.branch).toBeNull()
      expect(thing.deleted).toBe(false)
    })

    it('creates fixture with overrides', () => {
      const thing = createThingFixture({
        id: 'custom',
        name: 'Custom Thing',
        deleted: true,
      })
      expect(thing.id).toBe('custom')
      expect(thing.name).toBe('Custom Thing')
      expect(thing.deleted).toBe(true)
    })
  })

  describe('createThingFixtures', () => {
    it('creates multiple fixtures', () => {
      const things = createThingFixtures(5)
      expect(things).toHaveLength(5)
      expect(things[0]?.id).toBe('thing-0')
      expect(things[4]?.id).toBe('thing-4')
    })

    it('applies template to all', () => {
      const things = createThingFixtures(3, { type: 42 })
      for (const thing of things) {
        expect(thing.type).toBe(42)
      }
    })
  })

  describe('createVersionedThingFixtures', () => {
    it('creates versioned fixtures', () => {
      const versions = createVersionedThingFixtures('doc-1', 3)
      expect(versions).toHaveLength(3)
      expect(versions[0]?.id).toBe('doc-1')
      expect(versions[0]?.data.version).toBe(1)
      expect(versions[2]?.data.version).toBe(3)
    })
  })

  describe('createRelationshipFixtures', () => {
    it('creates relationships', () => {
      const rels = createRelationshipFixtures('parent', ['child-1', 'child-2'])
      expect(rels).toHaveLength(2)
      expect(rels[0]?.from).toBe('parent')
      expect(rels[0]?.to).toBe('child-1')
      expect(rels[1]?.to).toBe('child-2')
    })

    it('uses custom verb', () => {
      const rels = createRelationshipFixtures('a', ['b'], 'contains')
      expect(rels[0]?.verb).toBe('contains')
    })
  })

  describe('createActionFixtures', () => {
    it('creates actions', () => {
      const actions = createActionFixtures(3, 'thing-1')
      expect(actions).toHaveLength(3)
      expect(actions[0]?.verb).toBe('create')
      expect(actions[1]?.verb).toBe('update')
      expect(actions[2]?.verb).toBe('update')
    })
  })

  describe('createEventFixtures', () => {
    it('creates events', () => {
      const events = createEventFixtures(3, 'https://test.do')
      expect(events).toHaveLength(3)
      expect(events[0]?.verb).toBe('thing.created')
      expect(events[1]?.verb).toBe('thing.updated')
      expect(events[0]?.source).toBe('https://test.do')
    })
  })
})

// ============================================================================
// INTEGRATION TEST
// ============================================================================

describe('Infrastructure Integration', () => {
  it('all modules are exported from testing/acid', async () => {
    // This verifies the index.ts re-exports work correctly
    const mod = await import('../../testing/acid')

    // Fixtures
    expect(mod.FIXTURES).toBeDefined()
    expect(mod.createThingFixture).toBeDefined()
    expect(mod.createThingFixtures).toBeDefined()
    expect(mod.createVersionedThingFixtures).toBeDefined()
    expect(mod.createRelationshipFixtures).toBeDefined()
    expect(mod.createActionFixtures).toBeDefined()
    expect(mod.createEventFixtures).toBeDefined()
    expect(mod.createTestDOWithFixtures).toBeDefined()

    // Context
    expect(mod.createACIDTestContext).toBeDefined()
    expect(mod.defaultACIDTestConfig).toBeDefined()

    // Base classes
    expect(mod.ACIDTestBase).toBeDefined()
    expect(mod.LifecycleTestBase).toBeDefined()
    expect(mod.CrossDOTestBase).toBeDefined()
    expect(mod.runACIDTest).toBeDefined()

    // Matchers
    expect(mod.acidMatchers).toBeDefined()
    expect(mod.matchers).toBeDefined()
  })

  it('all modules are exported from types/acid', async () => {
    const mod = await import('../../types/acid')

    // Location
    expect(mod.REGION_COLOS).toBeDefined()
    expect(mod.ALL_REGIONS).toBeDefined()
    expect(mod.ALL_COLOS).toBeDefined()
    expect(mod.getRegionForColo).toBeDefined()
    expect(mod.getColosForRegion).toBeDefined()
    expect(mod.isColoInRegion).toBeDefined()
    expect(mod.validateLocationConfig).toBeDefined()

    // Lifecycle
    expect(mod.isCloneMode).toBeDefined()
    expect(mod.isLifecycleStatus).toBeDefined()
    expect(mod.isLifecycleOperation).toBeDefined()
    expect(mod.validateCloneOptions).toBeDefined()
    expect(mod.createLifecycleEvent).toBeDefined()
  })
})
