/**
 * Lifecycle Types Tests (RED Phase)
 *
 * These tests verify the Lifecycle type exports and interfaces for DO lifecycle operations:
 * - CloneMode type: 'atomic' | 'staged' | 'eventual' | 'resumable'
 * - CloneOptions interface: { colo?, asReplica?, compress?, unshard?, branch?, version?, mode? }
 * - CloneResult interface: { ns, doId, mode, staged?, checkpoint? }
 * - ShardOptions interface: { key, count, strategy?, mode? }
 * - ShardStrategy type: 'hash' | 'range' | 'roundRobin' | 'custom'
 * - ShardResult interface: { shardKey, shards: Array<{ ns, doId, shardIndex, thingCount }> }
 * - UnshardOptions interface: { target?, compress?, mode? }
 * - CompactOptions interface: { archive?, branches?, olderThan?, keepVersions? }
 * - CompactResult interface: { thingsCompacted, actionsArchived, eventsArchived }
 * - MoveResult interface: { newDoId, location: { code, region } }
 * - PromoteResult interface: { ns, doId, previousId }
 * - DemoteResult interface: { thingId, parentNs, deletedNs }
 * - DOLifecycle interface with all methods
 *
 * RED TDD: These tests should FAIL because the Lifecycle types don't exist yet.
 *
 * Reference: dotdo-uh9h - TDD RED Phase for Lifecycle types
 */

import { describe, it, expect, expectTypeOf } from 'vitest'

// ============================================================================
// Import types under test (will fail until implemented)
// ============================================================================

// These imports will FAIL - the Lifecycle types don't exist yet
import type {
  CloneMode,
  CloneOptions,
  CloneResult,
  ShardOptions,
  ShardStrategy,
  ShardResult,
  UnshardOptions,
  CompactOptions,
  CompactResult,
  MoveResult,
  PromoteResult,
  DemoteResult,
  DOLifecycle,
} from '../Lifecycle'

// ============================================================================
// TESTS: CloneMode Type
// ============================================================================

describe('CloneMode type', () => {
  it('CloneMode includes "atomic" variant', () => {
    // CloneMode should be a union type that includes 'atomic'
    const mode: CloneMode = 'atomic'
    expect(mode).toBe('atomic')
  })

  it('CloneMode includes "staged" variant', () => {
    const mode: CloneMode = 'staged'
    expect(mode).toBe('staged')
  })

  it('CloneMode includes "eventual" variant', () => {
    const mode: CloneMode = 'eventual'
    expect(mode).toBe('eventual')
  })

  it('CloneMode includes "resumable" variant', () => {
    const mode: CloneMode = 'resumable'
    expect(mode).toBe('resumable')
  })

  it('CloneMode is a string literal union', () => {
    // Type test: CloneMode should be a union of string literals
    const modeValue: CloneMode = 'atomic'
    expectTypeOf(modeValue).toEqualTypeOf<'atomic' | 'staged' | 'eventual' | 'resumable'>()
  })

  it('CloneMode does not accept invalid values', () => {
    // TYPE TEST: Invalid values should produce a type error
    // @ts-expect-error - 'invalid' is not assignable to CloneMode
    const invalidMode: CloneMode = 'invalid'
    expect(invalidMode).toBeDefined()
  })
})

// ============================================================================
// TESTS: CloneOptions Interface
// ============================================================================

describe('CloneOptions interface', () => {
  it('CloneOptions has optional colo property', () => {
    const options: CloneOptions = {}
    expect(options.colo).toBeUndefined()

    const optionsWithColo: CloneOptions = { colo: 'ewr' }
    expect(optionsWithColo.colo).toBe('ewr')
  })

  it('CloneOptions has optional asReplica property', () => {
    const options: CloneOptions = { asReplica: true }
    expect(options.asReplica).toBe(true)

    const optionsDefault: CloneOptions = {}
    expect(optionsDefault.asReplica).toBeUndefined()
  })

  it('CloneOptions has optional compress property', () => {
    const options: CloneOptions = { compress: true }
    expect(options.compress).toBe(true)
  })

  it('CloneOptions has optional unshard property', () => {
    const options: CloneOptions = { unshard: true }
    expect(options.unshard).toBe(true)
  })

  it('CloneOptions has optional branch property', () => {
    const options: CloneOptions = { branch: 'feature-x' }
    expect(options.branch).toBe('feature-x')
  })

  it('CloneOptions has optional version property', () => {
    const options: CloneOptions = { version: 42 }
    expect(options.version).toBe(42)
  })

  it('CloneOptions has optional mode property of type CloneMode', () => {
    const options: CloneOptions = { mode: 'atomic' }
    expect(options.mode).toBe('atomic')

    // TYPE TEST: mode should be CloneMode type
    expectTypeOf<CloneOptions['mode']>().toEqualTypeOf<CloneMode | undefined>()
  })

  it('CloneOptions all properties are optional', () => {
    // Empty object should be valid
    const options: CloneOptions = {}
    expect(options).toBeDefined()
  })

  it('CloneOptions supports all properties together', () => {
    const options: CloneOptions = {
      colo: 'lax',
      asReplica: false,
      compress: true,
      unshard: false,
      branch: 'main',
      version: 100,
      mode: 'staged',
    }
    expect(options.colo).toBe('lax')
    expect(options.mode).toBe('staged')
  })
})

// ============================================================================
// TESTS: CloneResult Interface
// ============================================================================

describe('CloneResult interface', () => {
  it('CloneResult has required ns property', () => {
    const result: CloneResult = {
      ns: 'https://example.com',
      doId: 'do-123',
      mode: 'atomic',
    }
    expect(result.ns).toBe('https://example.com')
  })

  it('CloneResult has required doId property', () => {
    const result: CloneResult = {
      ns: 'https://example.com',
      doId: 'do-456',
      mode: 'atomic',
    }
    expect(result.doId).toBe('do-456')
  })

  it('CloneResult has required mode property', () => {
    const result: CloneResult = {
      ns: 'https://example.com',
      doId: 'do-789',
      mode: 'staged',
    }
    expect(result.mode).toBe('staged')
  })

  it('CloneResult has optional staged property with nested structure', () => {
    const result: CloneResult = {
      ns: 'https://example.com',
      doId: 'do-123',
      mode: 'staged',
      staged: {
        prepareId: 'prep-001',
        committed: false,
      },
    }
    expect(result.staged?.prepareId).toBe('prep-001')
    expect(result.staged?.committed).toBe(false)
  })

  it('CloneResult has optional checkpoint property with nested structure', () => {
    const result: CloneResult = {
      ns: 'https://example.com',
      doId: 'do-123',
      mode: 'resumable',
      checkpoint: {
        id: 'ckpt-001',
        progress: 0.75,
        resumable: true,
      },
    }
    expect(result.checkpoint?.id).toBe('ckpt-001')
    expect(result.checkpoint?.progress).toBe(0.75)
    expect(result.checkpoint?.resumable).toBe(true)
  })

  it('CloneResult staged.committed should be boolean', () => {
    const result: CloneResult = {
      ns: 'https://example.com',
      doId: 'do-123',
      mode: 'staged',
      staged: { prepareId: 'prep-001', committed: true },
    }
    expectTypeOf(result.staged!.committed).toEqualTypeOf<boolean>()
  })

  it('CloneResult checkpoint.progress should be number', () => {
    const result: CloneResult = {
      ns: 'https://example.com',
      doId: 'do-123',
      mode: 'resumable',
      checkpoint: { id: 'ckpt-001', progress: 0.5, resumable: true },
    }
    expectTypeOf(result.checkpoint!.progress).toEqualTypeOf<number>()
  })
})

// ============================================================================
// TESTS: ShardStrategy Type
// ============================================================================

describe('ShardStrategy type', () => {
  it('ShardStrategy includes "hash" variant', () => {
    const strategy: ShardStrategy = 'hash'
    expect(strategy).toBe('hash')
  })

  it('ShardStrategy includes "range" variant', () => {
    const strategy: ShardStrategy = 'range'
    expect(strategy).toBe('range')
  })

  it('ShardStrategy includes "roundRobin" variant', () => {
    const strategy: ShardStrategy = 'roundRobin'
    expect(strategy).toBe('roundRobin')
  })

  it('ShardStrategy includes "custom" variant', () => {
    const strategy: ShardStrategy = 'custom'
    expect(strategy).toBe('custom')
  })

  it('ShardStrategy is a string literal union', () => {
    const strategyValue: ShardStrategy = 'hash'
    expectTypeOf(strategyValue).toEqualTypeOf<'hash' | 'range' | 'roundRobin' | 'custom'>()
  })

  it('ShardStrategy does not accept invalid values', () => {
    // TYPE TEST: Invalid values should produce a type error
    // @ts-expect-error - 'invalid' is not assignable to ShardStrategy
    const invalidStrategy: ShardStrategy = 'invalid'
    expect(invalidStrategy).toBeDefined()
  })
})

// ============================================================================
// TESTS: ShardOptions Interface
// ============================================================================

describe('ShardOptions interface', () => {
  it('ShardOptions has required key property', () => {
    const options: ShardOptions = { key: 'customerId', count: 4 }
    expect(options.key).toBe('customerId')
  })

  it('ShardOptions has required count property', () => {
    const options: ShardOptions = { key: 'tenantId', count: 8 }
    expect(options.count).toBe(8)
  })

  it('ShardOptions has optional strategy property of type ShardStrategy', () => {
    const options: ShardOptions = { key: 'userId', count: 4, strategy: 'hash' }
    expect(options.strategy).toBe('hash')

    expectTypeOf<ShardOptions['strategy']>().toEqualTypeOf<ShardStrategy | undefined>()
  })

  it('ShardOptions has optional mode property', () => {
    const options: ShardOptions = { key: 'region', count: 3, mode: 'atomic' }
    expect(options.mode).toBe('atomic')
  })

  it('ShardOptions requires key and count', () => {
    // TYPE TEST: Missing required properties should produce type error
    // @ts-expect-error - Property 'count' is missing
    const missingCount: ShardOptions = { key: 'id' }

    // @ts-expect-error - Property 'key' is missing
    const missingKey: ShardOptions = { count: 4 }

    expect(missingCount).toBeDefined()
    expect(missingKey).toBeDefined()
  })
})

// ============================================================================
// TESTS: ShardResult Interface
// ============================================================================

describe('ShardResult interface', () => {
  it('ShardResult has required shardKey property', () => {
    const result: ShardResult = {
      shardKey: 'tenantId',
      shards: [],
    }
    expect(result.shardKey).toBe('tenantId')
  })

  it('ShardResult has required shards array property', () => {
    const result: ShardResult = {
      shardKey: 'tenantId',
      shards: [
        { ns: 'https://shard1.example.com', doId: 'do-1', shardIndex: 0, thingCount: 100 },
        { ns: 'https://shard2.example.com', doId: 'do-2', shardIndex: 1, thingCount: 150 },
      ],
    }
    expect(result.shards).toHaveLength(2)
    expect(result.shards[0].shardIndex).toBe(0)
    expect(result.shards[1].thingCount).toBe(150)
  })

  it('ShardResult shard item has ns property', () => {
    const result: ShardResult = {
      shardKey: 'id',
      shards: [{ ns: 'https://shard.example.com', doId: 'do-1', shardIndex: 0, thingCount: 50 }],
    }
    expect(result.shards[0].ns).toBe('https://shard.example.com')
  })

  it('ShardResult shard item has doId property', () => {
    const result: ShardResult = {
      shardKey: 'id',
      shards: [{ ns: 'https://shard.example.com', doId: 'do-abc', shardIndex: 0, thingCount: 50 }],
    }
    expect(result.shards[0].doId).toBe('do-abc')
  })

  it('ShardResult shard item has shardIndex property', () => {
    const result: ShardResult = {
      shardKey: 'id',
      shards: [{ ns: 'https://shard.example.com', doId: 'do-1', shardIndex: 3, thingCount: 50 }],
    }
    expect(result.shards[0].shardIndex).toBe(3)
  })

  it('ShardResult shard item has thingCount property', () => {
    const result: ShardResult = {
      shardKey: 'id',
      shards: [{ ns: 'https://shard.example.com', doId: 'do-1', shardIndex: 0, thingCount: 999 }],
    }
    expect(result.shards[0].thingCount).toBe(999)
  })
})

// ============================================================================
// TESTS: UnshardOptions Interface
// ============================================================================

describe('UnshardOptions interface', () => {
  it('UnshardOptions has optional target property', () => {
    const options: UnshardOptions = { target: 'https://unified.example.com' }
    expect(options.target).toBe('https://unified.example.com')
  })

  it('UnshardOptions has optional compress property', () => {
    const options: UnshardOptions = { compress: true }
    expect(options.compress).toBe(true)
  })

  it('UnshardOptions has optional mode property', () => {
    const options: UnshardOptions = { mode: 'atomic' }
    expect(options.mode).toBe('atomic')
  })

  it('UnshardOptions all properties are optional', () => {
    const options: UnshardOptions = {}
    expect(options).toBeDefined()
  })

  it('UnshardOptions supports all properties together', () => {
    const options: UnshardOptions = {
      target: 'https://merged.example.com',
      compress: true,
      mode: 'staged',
    }
    expect(options.target).toBe('https://merged.example.com')
    expect(options.compress).toBe(true)
    expect(options.mode).toBe('staged')
  })
})

// ============================================================================
// TESTS: CompactOptions Interface
// ============================================================================

describe('CompactOptions interface', () => {
  it('CompactOptions has optional archive property', () => {
    const options: CompactOptions = { archive: true }
    expect(options.archive).toBe(true)
  })

  it('CompactOptions has optional branches property', () => {
    const options: CompactOptions = { branches: ['feature-a', 'feature-b'] }
    expect(options.branches).toEqual(['feature-a', 'feature-b'])
  })

  it('CompactOptions has optional olderThan property', () => {
    const date = new Date('2025-01-01')
    const options: CompactOptions = { olderThan: date }
    expect(options.olderThan).toEqual(date)
  })

  it('CompactOptions has optional keepVersions property', () => {
    const options: CompactOptions = { keepVersions: 5 }
    expect(options.keepVersions).toBe(5)
  })

  it('CompactOptions all properties are optional', () => {
    const options: CompactOptions = {}
    expect(options).toBeDefined()
  })

  it('CompactOptions supports all properties together', () => {
    const options: CompactOptions = {
      archive: true,
      branches: ['main', 'develop'],
      olderThan: new Date('2024-06-01'),
      keepVersions: 10,
    }
    expect(options.archive).toBe(true)
    expect(options.branches).toHaveLength(2)
    expect(options.keepVersions).toBe(10)
  })
})

// ============================================================================
// TESTS: CompactResult Interface
// ============================================================================

describe('CompactResult interface', () => {
  it('CompactResult has required thingsCompacted property', () => {
    const result: CompactResult = {
      thingsCompacted: 50,
      actionsArchived: 100,
      eventsArchived: 200,
    }
    expect(result.thingsCompacted).toBe(50)
  })

  it('CompactResult has required actionsArchived property', () => {
    const result: CompactResult = {
      thingsCompacted: 50,
      actionsArchived: 100,
      eventsArchived: 200,
    }
    expect(result.actionsArchived).toBe(100)
  })

  it('CompactResult has required eventsArchived property', () => {
    const result: CompactResult = {
      thingsCompacted: 50,
      actionsArchived: 100,
      eventsArchived: 200,
    }
    expect(result.eventsArchived).toBe(200)
  })

  it('CompactResult all properties are numbers', () => {
    const result: CompactResult = {
      thingsCompacted: 0,
      actionsArchived: 0,
      eventsArchived: 0,
    }
    expectTypeOf(result.thingsCompacted).toEqualTypeOf<number>()
    expectTypeOf(result.actionsArchived).toEqualTypeOf<number>()
    expectTypeOf(result.eventsArchived).toEqualTypeOf<number>()
  })
})

// ============================================================================
// TESTS: MoveResult Interface
// ============================================================================

describe('MoveResult interface', () => {
  it('MoveResult has required newDoId property', () => {
    const result: MoveResult = {
      newDoId: 'do-new-123',
      location: { code: 'ewr', region: 'enam' },
    }
    expect(result.newDoId).toBe('do-new-123')
  })

  it('MoveResult has required location object', () => {
    const result: MoveResult = {
      newDoId: 'do-123',
      location: { code: 'lax', region: 'wnam' },
    }
    expect(result.location).toBeDefined()
  })

  it('MoveResult location has code property', () => {
    const result: MoveResult = {
      newDoId: 'do-123',
      location: { code: 'cdg', region: 'weur' },
    }
    expect(result.location.code).toBe('cdg')
  })

  it('MoveResult location has region property', () => {
    const result: MoveResult = {
      newDoId: 'do-123',
      location: { code: 'sin', region: 'apac' },
    }
    expect(result.location.region).toBe('apac')
  })

  it('MoveResult requires both newDoId and location', () => {
    // TYPE TEST: Missing required properties should produce type error
    // @ts-expect-error - Property 'location' is missing
    const missingLocation: MoveResult = { newDoId: 'do-123' }

    // @ts-expect-error - Property 'newDoId' is missing
    const missingDoId: MoveResult = { location: { code: 'ewr', region: 'enam' } }

    expect(missingLocation).toBeDefined()
    expect(missingDoId).toBeDefined()
  })
})

// ============================================================================
// TESTS: PromoteResult Interface
// ============================================================================

describe('PromoteResult interface', () => {
  it('PromoteResult has required ns property', () => {
    const result: PromoteResult = {
      ns: 'https://promoted.example.com',
      doId: 'do-promoted-123',
      previousId: 'thing-original-456',
    }
    expect(result.ns).toBe('https://promoted.example.com')
  })

  it('PromoteResult has required doId property', () => {
    const result: PromoteResult = {
      ns: 'https://promoted.example.com',
      doId: 'do-promoted-789',
      previousId: 'thing-original-012',
    }
    expect(result.doId).toBe('do-promoted-789')
  })

  it('PromoteResult has required previousId property', () => {
    const result: PromoteResult = {
      ns: 'https://promoted.example.com',
      doId: 'do-promoted-345',
      previousId: 'thing-original-678',
    }
    expect(result.previousId).toBe('thing-original-678')
  })

  it('PromoteResult requires all properties', () => {
    // TYPE TEST: Missing required properties should produce type error
    // @ts-expect-error - Property 'previousId' is missing
    const missingPreviousId: PromoteResult = {
      ns: 'https://example.com',
      doId: 'do-123',
    }

    expect(missingPreviousId).toBeDefined()
  })
})

// ============================================================================
// TESTS: DemoteResult Interface
// ============================================================================

describe('DemoteResult interface', () => {
  it('DemoteResult has required thingId property', () => {
    const result: DemoteResult = {
      thingId: 'thing-demoted-123',
      parentNs: 'https://parent.example.com',
      deletedNs: 'https://deleted.example.com',
    }
    expect(result.thingId).toBe('thing-demoted-123')
  })

  it('DemoteResult has required parentNs property', () => {
    const result: DemoteResult = {
      thingId: 'thing-demoted-456',
      parentNs: 'https://parent.example.com',
      deletedNs: 'https://deleted.example.com',
    }
    expect(result.parentNs).toBe('https://parent.example.com')
  })

  it('DemoteResult has required deletedNs property', () => {
    const result: DemoteResult = {
      thingId: 'thing-demoted-789',
      parentNs: 'https://parent.example.com',
      deletedNs: 'https://was-promoted.example.com',
    }
    expect(result.deletedNs).toBe('https://was-promoted.example.com')
  })

  it('DemoteResult requires all properties', () => {
    // TYPE TEST: Missing required properties should produce type error
    // @ts-expect-error - Property 'deletedNs' is missing
    const missingDeletedNs: DemoteResult = {
      thingId: 'thing-123',
      parentNs: 'https://parent.example.com',
    }

    expect(missingDeletedNs).toBeDefined()
  })
})

// ============================================================================
// TESTS: DOLifecycle Interface
// ============================================================================

describe('DOLifecycle interface', () => {
  // Mock for testing interface shape
  const mockLifecycle = {} as DOLifecycle

  describe('move method', () => {
    it('DOLifecycle has move method', () => {
      // Type-level verification that move method exists on the interface
      expectTypeOf(mockLifecycle).toHaveProperty('move')
    })

    it('move accepts colo string and returns Promise<MoveResult>', () => {
      // Type test: move should have correct signature
      expectTypeOf(mockLifecycle.move).toBeFunction()
      expectTypeOf(mockLifecycle.move).parameter(0).toBeString()
      expectTypeOf(mockLifecycle.move).returns.resolves.toMatchTypeOf<MoveResult>()
    })
  })

  describe('compact method', () => {
    it('DOLifecycle has compact method', () => {
      // Type-level verification that compact method exists on the interface
      expectTypeOf(mockLifecycle).toHaveProperty('compact')
    })

    it('compact accepts optional CompactOptions and returns Promise<CompactResult>', () => {
      expectTypeOf(mockLifecycle.compact).toBeFunction()
      expectTypeOf(mockLifecycle.compact).returns.resolves.toMatchTypeOf<CompactResult>()
    })
  })

  describe('clone method', () => {
    it('DOLifecycle has clone method', () => {
      expect(typeof mockLifecycle.clone).toBe('function')
    })

    it('clone accepts target ns and optional CloneOptions', () => {
      expectTypeOf(mockLifecycle.clone).toBeFunction()
      expectTypeOf(mockLifecycle.clone).parameter(0).toBeString()
      expectTypeOf(mockLifecycle.clone).returns.resolves.toMatchTypeOf<CloneResult>()
    })
  })

  describe('shard method', () => {
    it('DOLifecycle has shard method', () => {
      expect(typeof mockLifecycle.shard).toBe('function')
    })

    it('shard accepts ShardOptions and returns Promise<ShardResult>', () => {
      expectTypeOf(mockLifecycle.shard).toBeFunction()
      expectTypeOf(mockLifecycle.shard).returns.resolves.toMatchTypeOf<ShardResult>()
    })
  })

  describe('unshard method', () => {
    it('DOLifecycle has unshard method', () => {
      expect(typeof mockLifecycle.unshard).toBe('function')
    })

    it('unshard accepts optional UnshardOptions', () => {
      expectTypeOf(mockLifecycle.unshard).toBeFunction()
    })
  })

  describe('promote method', () => {
    it('DOLifecycle has promote method', () => {
      expect(typeof mockLifecycle.promote).toBe('function')
    })

    it('promote accepts thingId string and returns Promise<PromoteResult>', () => {
      expectTypeOf(mockLifecycle.promote).toBeFunction()
      expectTypeOf(mockLifecycle.promote).parameter(0).toBeString()
      expectTypeOf(mockLifecycle.promote).returns.resolves.toMatchTypeOf<PromoteResult>()
    })
  })

  describe('demote method', () => {
    it('DOLifecycle has demote method', () => {
      expect(typeof mockLifecycle.demote).toBe('function')
    })

    it('demote accepts targetNs string and returns Promise<DemoteResult>', () => {
      expectTypeOf(mockLifecycle.demote).toBeFunction()
      expectTypeOf(mockLifecycle.demote).parameter(0).toBeString()
      expectTypeOf(mockLifecycle.demote).returns.resolves.toMatchTypeOf<DemoteResult>()
    })
  })

  describe('resume method', () => {
    it('DOLifecycle has resume method', () => {
      expect(typeof mockLifecycle.resume).toBe('function')
    })

    it('resume accepts checkpointId string', () => {
      expectTypeOf(mockLifecycle.resume).toBeFunction()
      expectTypeOf(mockLifecycle.resume).parameter(0).toBeString()
    })
  })

  describe('fork method', () => {
    it('DOLifecycle has fork method', () => {
      expect(typeof mockLifecycle.fork).toBe('function')
    })

    it('fork accepts options with target ns', () => {
      expectTypeOf(mockLifecycle.fork).toBeFunction()
    })
  })

  describe('branch method', () => {
    it('DOLifecycle has branch method', () => {
      expect(typeof mockLifecycle.branch).toBe('function')
    })

    it('branch accepts branch name string', () => {
      expectTypeOf(mockLifecycle.branch).toBeFunction()
      expectTypeOf(mockLifecycle.branch).parameter(0).toBeString()
    })
  })

  describe('checkout method', () => {
    it('DOLifecycle has checkout method', () => {
      expect(typeof mockLifecycle.checkout).toBe('function')
    })

    it('checkout accepts ref string', () => {
      expectTypeOf(mockLifecycle.checkout).toBeFunction()
      expectTypeOf(mockLifecycle.checkout).parameter(0).toBeString()
    })
  })

  describe('merge method', () => {
    it('DOLifecycle has merge method', () => {
      expect(typeof mockLifecycle.merge).toBe('function')
    })

    it('merge accepts branch name string', () => {
      expectTypeOf(mockLifecycle.merge).toBeFunction()
      expectTypeOf(mockLifecycle.merge).parameter(0).toBeString()
    })
  })
})

// ============================================================================
// TESTS: Interface Type Shapes
// ============================================================================

describe('Lifecycle interface type shapes', () => {
  it('CloneOptions interface has correct shape', () => {
    type ExpectedCloneOptions = {
      colo?: string
      asReplica?: boolean
      compress?: boolean
      unshard?: boolean
      branch?: string
      version?: number
      mode?: CloneMode
    }

    // This should compile if CloneOptions has the expected shape
    const _typeCheck: ExpectedCloneOptions = {} as CloneOptions
    expect(_typeCheck).toBeDefined()
  })

  it('CloneResult interface has correct shape', () => {
    type ExpectedCloneResult = {
      ns: string
      doId: string
      mode: CloneMode
      staged?: { prepareId: string; committed: boolean }
      checkpoint?: { id: string; progress: number; resumable: boolean }
    }

    const _typeCheck: ExpectedCloneResult = {} as CloneResult
    expect(_typeCheck).toBeDefined()
  })

  it('ShardOptions interface has correct shape', () => {
    type ExpectedShardOptions = {
      key: string
      count: number
      strategy?: ShardStrategy
      mode?: CloneMode
    }

    const _typeCheck: ExpectedShardOptions = {} as ShardOptions
    expect(_typeCheck).toBeDefined()
  })

  it('ShardResult interface has correct shape', () => {
    type ExpectedShardResult = {
      shardKey: string
      shards: Array<{ ns: string; doId: string; shardIndex: number; thingCount: number }>
    }

    const _typeCheck: ExpectedShardResult = {} as ShardResult
    expect(_typeCheck).toBeDefined()
  })

  it('CompactOptions interface has correct shape', () => {
    type ExpectedCompactOptions = {
      archive?: boolean
      branches?: string[]
      olderThan?: Date
      keepVersions?: number
    }

    const _typeCheck: ExpectedCompactOptions = {} as CompactOptions
    expect(_typeCheck).toBeDefined()
  })

  it('MoveResult interface has correct shape', () => {
    type ExpectedMoveResult = {
      newDoId: string
      location: { code: string; region: string }
    }

    const _typeCheck: ExpectedMoveResult = {} as MoveResult
    expect(_typeCheck).toBeDefined()
  })

  it('DOLifecycle interface has all required methods', () => {
    type RequiredMethods = {
      move: (colo: string) => Promise<MoveResult>
      compact: (options?: CompactOptions) => Promise<CompactResult>
      clone: (target: string, options?: CloneOptions) => Promise<CloneResult>
      shard: (options: ShardOptions) => Promise<ShardResult>
      unshard: (options?: UnshardOptions) => Promise<void>
      promote: (thingId: string) => Promise<PromoteResult>
      demote: (targetNs: string) => Promise<DemoteResult>
      resume: (checkpointId: string) => Promise<CloneResult>
      fork: (options: { to: string; branch?: string }) => Promise<{ ns: string; doId: string }>
      branch: (name: string) => Promise<{ name: string; head: number }>
      checkout: (ref: string) => Promise<{ branch?: string; version?: number }>
      merge: (branch: string) => Promise<{ merged: boolean; conflicts?: string[] }>
    }

    // This should compile if DOLifecycle has all required methods
    const _typeCheck: RequiredMethods = {} as DOLifecycle
    expect(_typeCheck).toBeDefined()
  })
})

// ============================================================================
// TESTS: Type Export Verification
// ============================================================================

describe('Lifecycle type exports', () => {
  it('all types are exported from Lifecycle module', () => {
    // This test verifies that all types can be imported
    // If any type is not exported, this file won't compile
    const cloneMode: CloneMode = 'atomic'
    const cloneOptions: CloneOptions = {}
    const cloneResult: CloneResult = { ns: '', doId: '', mode: 'atomic' }
    const shardStrategy: ShardStrategy = 'hash'
    const shardOptions: ShardOptions = { key: '', count: 1 }
    const shardResult: ShardResult = { shardKey: '', shards: [] }
    const unshardOptions: UnshardOptions = {}
    const compactOptions: CompactOptions = {}
    const compactResult: CompactResult = { thingsCompacted: 0, actionsArchived: 0, eventsArchived: 0 }
    const moveResult: MoveResult = { newDoId: '', location: { code: '', region: '' } }
    const promoteResult: PromoteResult = { ns: '', doId: '', previousId: '' }
    const demoteResult: DemoteResult = { thingId: '', parentNs: '', deletedNs: '' }
    const lifecycle: DOLifecycle = {} as DOLifecycle

    // All should be defined
    expect(cloneMode).toBeDefined()
    expect(cloneOptions).toBeDefined()
    expect(cloneResult).toBeDefined()
    expect(shardStrategy).toBeDefined()
    expect(shardOptions).toBeDefined()
    expect(shardResult).toBeDefined()
    expect(unshardOptions).toBeDefined()
    expect(compactOptions).toBeDefined()
    expect(compactResult).toBeDefined()
    expect(moveResult).toBeDefined()
    expect(promoteResult).toBeDefined()
    expect(demoteResult).toBeDefined()
    expect(lifecycle).toBeDefined()
  })
})
