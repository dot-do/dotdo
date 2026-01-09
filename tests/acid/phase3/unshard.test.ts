/**
 * ACID Test Suite - Phase 3: unshard() - Merge Shard Set
 *
 * RED TDD: These tests define the expected behavior for the unshard() method
 * that merges a sharded DO set back into a single DO. All tests are expected
 * to FAIL initially as this is the RED phase.
 *
 * Unsharding provides:
 * - Consolidation of distributed data back to single DO
 * - Data integrity validation during merge
 * - Cross-shard relationship reconciliation
 * - Conflict detection and resolution
 * - Registry cleanup after unshard
 * - Rollback support if merge fails
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockDONamespace, createMockId } from '../../do'
import { DO } from '../../../objects/DO'
import type {
  UnshardOptions,
  ShardOptions,
  CloneMode,
} from '../../../types/Lifecycle'

// ============================================================================
// TYPE DEFINITIONS FOR UNSHARD TESTS
// ============================================================================

/**
 * Extended unshard options with additional configuration
 */
interface ExtendedUnshardOptions extends UnshardOptions {
  /** Timeout for the unshard operation in ms */
  timeout?: number
  /** Correlation ID for tracing */
  correlationId?: string
  /** Conflict resolution strategy */
  conflictResolution?: 'last-write-wins' | 'source-wins' | 'merge' | 'fail'
  /** Whether to validate data integrity after merge */
  validateIntegrity?: boolean
  /** Whether to delete shard DOs after successful merge */
  deleteShards?: boolean
  /** Batch size for data transfer */
  batchSize?: number
  /** Enable incremental unshard (merge one shard at a time) */
  incremental?: boolean
  /** Shard index to merge (required when incremental is true) */
  shardIndex?: number
}

/**
 * Extended unshard result with detailed metadata
 */
interface ExtendedUnshardResult {
  /** Whether unshard completed successfully */
  success: boolean
  /** Number of things merged */
  thingsMerged: number
  /** Number of relationships merged */
  relationshipsMerged: number
  /** Number of shards that were merged */
  shardsMerged: number
  /** Time taken for unshard operation */
  duration: number
  /** Conflicts encountered during merge */
  conflicts: UnshardConflict[]
  /** Integrity validation result */
  integrityCheck?: IntegrityCheckResult
  /** Shards that were deleted (if deleteShards was true) */
  deletedShards?: string[]
}

/**
 * Conflict encountered during unshard
 */
interface UnshardConflict {
  /** Thing ID that had conflict */
  thingId: string
  /** Shard that had conflicting version */
  shardIndex: number
  /** Type of conflict */
  type: 'duplicate' | 'version_mismatch' | 'data_divergence'
  /** Resolution applied */
  resolution: 'kept_source' | 'kept_shard' | 'merged' | 'failed'
  /** Additional details */
  details?: Record<string, unknown>
}

/**
 * Integrity check result
 */
interface IntegrityCheckResult {
  /** Whether integrity check passed */
  valid: boolean
  /** Expected thing count */
  expectedThings: number
  /** Actual thing count after merge */
  actualThings: number
  /** Expected relationship count */
  expectedRelationships: number
  /** Actual relationship count after merge */
  actualRelationships: number
  /** Any integrity errors found */
  errors: string[]
}

/**
 * Thing record for testing
 */
interface ThingRecord {
  id: string
  type: number
  branch: string | null
  name: string
  data: Record<string, unknown>
  deleted: boolean
  visibility: string
  createdAt?: string
  updatedAt?: string
  version?: number
}

/**
 * Shard registry entry
 */
interface ShardRegistry {
  /** Unique ID for this shard set */
  id: string
  /** Shard key field name */
  shardKey: string
  /** Number of shards */
  shardCount: number
  /** Strategy used */
  strategy: 'hash' | 'range' | 'roundRobin' | 'custom'
  /** Creation timestamp */
  createdAt: Date
  /** Array of shard endpoints */
  endpoints: Array<{
    shardIndex: number
    ns: string
    doId: string
    status: 'active' | 'inactive' | 'rebalancing' | 'merging'
  }>
}

/**
 * Unshard event types
 */
type UnshardEventType =
  | 'unshard.started'
  | 'unshard.completed'
  | 'unshard.failed'
  | 'unshard.shard_merged'
  | 'unshard.conflict_detected'
  | 'unshard.conflict_resolved'
  | 'unshard.integrity_check'
  | 'unshard.rollback'

/**
 * Unshard event payload
 */
interface UnshardEvent {
  type: UnshardEventType
  correlationId: string
  timestamp: Date
  data?: Record<string, unknown>
}

/**
 * Mock shard data for testing
 */
interface MockShardData {
  shardIndex: number
  ns: string
  doId: string
  things: ThingRecord[]
  relationships: Array<{
    id: string
    verb: string
    from: string
    to: string
    data: Record<string, unknown> | null
    createdAt: string
  }>
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create sample things for testing
 */
function createTestThings(
  count: number,
  prefix: string = 'thing'
): ThingRecord[] {
  const now = new Date().toISOString()
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    type: 1,
    branch: null,
    name: `Item ${i}`,
    data: {
      tenantId: `tenant-${i % 5}`,
      index: i,
      value: `value-${i}`,
    },
    deleted: false,
    visibility: 'user',
    createdAt: now,
    updatedAt: now,
    version: 1,
  }))
}

/**
 * Create sample relationships for testing
 */
function createTestRelationships(
  thingIds: string[]
): Array<{
  id: string
  verb: string
  from: string
  to: string
  data: Record<string, unknown> | null
  createdAt: string
}> {
  const now = new Date().toISOString()
  const relationships: Array<{
    id: string
    verb: string
    from: string
    to: string
    data: Record<string, unknown> | null
    createdAt: string
  }> = []

  for (let i = 0; i < thingIds.length - 1; i++) {
    relationships.push({
      id: `rel-${i}`,
      verb: 'relatedTo',
      from: thingIds[i],
      to: thingIds[i + 1],
      data: { order: i },
      createdAt: now,
    })
  }

  return relationships
}

/**
 * Create mock shard data for multiple shards
 */
function createMockShardData(
  shardCount: number,
  thingsPerShard: number
): MockShardData[] {
  return Array.from({ length: shardCount }, (_, shardIndex) => {
    const things = createTestThings(thingsPerShard, `shard${shardIndex}-thing`)
    const thingIds = things.map((t) => t.id)

    return {
      shardIndex,
      ns: `https://shard-${shardIndex}.test.do`,
      doId: `shard-do-${shardIndex}`,
      things,
      relationships: createTestRelationships(thingIds),
    }
  })
}

/**
 * Create a mock shard registry
 */
function createMockShardRegistry(shards: MockShardData[]): ShardRegistry {
  return {
    id: `shard-set-${Date.now()}`,
    shardKey: 'tenantId',
    shardCount: shards.length,
    strategy: 'hash',
    createdAt: new Date(),
    endpoints: shards.map((s) => ({
      shardIndex: s.shardIndex,
      ns: s.ns,
      doId: s.doId,
      status: 'active' as const,
    })),
  }
}

// ============================================================================
// TEST SUITE: BASIC UNSHARDING
// ============================================================================

describe('unshard() - merge shard set', () => {
  let result: MockDOResult<DO, MockEnv>
  let capturedEvents: UnshardEvent[]
  let mockShardData: MockShardData[]
  let mockRegistry: ShardRegistry

  beforeEach(() => {
    capturedEvents = []
    mockShardData = createMockShardData(4, 25) // 4 shards with 25 things each
    mockRegistry = createMockShardRegistry(mockShardData)

    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', []], // Source is empty (data is in shards)
        ['relationships', []],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    // Store shard registry to simulate sharded state
    result.storage.data.set('shardRegistry', mockRegistry)
    result.storage.data.set('isSharded', true)

    // Mock event capture
    const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
    ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
      capturedEvents.push({
        type: verb as UnshardEventType,
        correlationId: (data as Record<string, unknown>)?.correlationId as string || '',
        timestamp: new Date(),
        data: data as Record<string, unknown>,
      })
      return originalEmit?.call(result.instance, verb, data)
    }

    // Setup mock DO namespace to return shard data
    const mockNamespace = createMockDONamespace()
    mockNamespace.stubFactory = (id) => ({
      id,
      fetch: vi.fn().mockImplementation(async (request: Request) => {
        const url = new URL(request.url)
        const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
        const shard = mockShardData[shardIndex]

        if (!shard) {
          return new Response('Not found', { status: 404 })
        }

        if (url.pathname.includes('/things')) {
          return new Response(JSON.stringify(shard.things))
        }
        if (url.pathname.includes('/relationships')) {
          return new Response(JSON.stringify(shard.relationships))
        }
        if (url.pathname.includes('/delete')) {
          return new Response('OK')
        }

        return new Response(JSON.stringify({
          things: shard.things,
          relationships: shard.relationships,
        }))
      }),
    })
    result.env.DO = mockNamespace
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // BASIC UNSHARDING
  // ==========================================================================

  describe('basic unsharding', () => {
    it('should merge all shards back into source DO', async () => {
      // RED: This test should fail until unshard() is implemented
      const unshardResult = await result.instance.unshard() as ExtendedUnshardResult

      expect(unshardResult.success).toBe(true)
      expect(unshardResult.shardsMerged).toBe(4)
    })

    it('should consolidate all things from shards', async () => {
      // RED: All things should be merged into source
      const unshardResult = await result.instance.unshard() as ExtendedUnshardResult

      expect(unshardResult.thingsMerged).toBe(100) // 4 shards * 25 things

      // Check source DO now has all things
      const things = result.sqlData.get('things') as ThingRecord[]
      expect(things.length).toBe(100)
    })

    it('should consolidate all relationships from shards', async () => {
      // RED: All relationships should be merged
      const unshardResult = await result.instance.unshard() as ExtendedUnshardResult

      // Each shard has thingsPerShard - 1 relationships
      expect(unshardResult.relationshipsMerged).toBe(96) // 4 * 24

      const relationships = result.sqlData.get('relationships') as unknown[]
      expect(relationships.length).toBe(96)
    })

    it('should return correct unshard result structure', async () => {
      // RED: Result should conform to ExtendedUnshardResult interface
      const unshardResult = await result.instance.unshard() as ExtendedUnshardResult

      expect(unshardResult).toHaveProperty('success')
      expect(unshardResult).toHaveProperty('thingsMerged')
      expect(unshardResult).toHaveProperty('relationshipsMerged')
      expect(unshardResult).toHaveProperty('shardsMerged')
      expect(unshardResult).toHaveProperty('duration')
      expect(unshardResult).toHaveProperty('conflicts')
    })

    it('should clear sharded state after successful unshard', async () => {
      // RED: DO should no longer be marked as sharded
      await result.instance.unshard()

      const isSharded = await (result.instance as unknown as {
        isSharded(): Promise<boolean>
      }).isSharded()

      expect(isSharded).toBe(false)
    })

    it('should remove shard registry after unshard', async () => {
      // RED: Registry should be cleaned up
      await result.instance.unshard()

      const registry = result.storage.data.get('shardRegistry')
      expect(registry).toBeUndefined()
    })
  })

  // ==========================================================================
  // UNSHARD OPTIONS
  // ==========================================================================

  describe('unshard options', () => {
    it('should support target option to merge into different DO', async () => {
      // RED: Should be able to merge shards into a specified target
      const options: ExtendedUnshardOptions = {
        target: 'https://target.test.do',
      }

      const unshardResult = await result.instance.unshard(options) as ExtendedUnshardResult

      expect(unshardResult.success).toBe(true)
      // Source should remain sharded, target should have merged data
    })

    it('should support compress option', async () => {
      // RED: Should compress data during merge
      const options: ExtendedUnshardOptions = {
        compress: true,
      }

      const unshardResult = await result.instance.unshard(options) as ExtendedUnshardResult

      expect(unshardResult.success).toBe(true)
    })

    it('should support atomic mode', async () => {
      // RED: Atomic mode should be all-or-nothing
      const options: ExtendedUnshardOptions = {
        mode: 'atomic',
      }

      const unshardResult = await result.instance.unshard(options) as ExtendedUnshardResult

      expect(unshardResult.success).toBe(true)
    })

    it('should support staged mode', async () => {
      // RED: Staged mode should use two-phase commit
      const options: ExtendedUnshardOptions = {
        mode: 'staged',
      }

      const unshardResult = await result.instance.unshard(options) as ExtendedUnshardResult

      expect(unshardResult.success).toBe(true)
    })

    it('should support eventual mode', async () => {
      // RED: Eventual mode should merge in background
      const options: ExtendedUnshardOptions = {
        mode: 'eventual',
      }

      const unshardResult = await result.instance.unshard(options) as ExtendedUnshardResult

      expect(unshardResult.success).toBe(true)
    })

    it('should support timeout option', async () => {
      // RED: Should respect timeout
      const options: ExtendedUnshardOptions = {
        timeout: 5000,
      }

      const unshardResult = await result.instance.unshard(options) as ExtendedUnshardResult

      expect(unshardResult.success).toBe(true)
    })

    it('should support batch size option', async () => {
      // RED: Should transfer data in batches
      const options: ExtendedUnshardOptions = {
        batchSize: 10,
      }

      const unshardResult = await result.instance.unshard(options) as ExtendedUnshardResult

      expect(unshardResult.success).toBe(true)
    })

    it('should support deleteShards option', async () => {
      // RED: Should delete shard DOs after successful merge
      const options: ExtendedUnshardOptions = {
        deleteShards: true,
      }

      const unshardResult = await result.instance.unshard(options) as ExtendedUnshardResult

      expect(unshardResult.success).toBe(true)
      expect(unshardResult.deletedShards).toHaveLength(4)
    })

    it('should not delete shards by default', async () => {
      // RED: Default should preserve shard DOs
      const unshardResult = await result.instance.unshard() as ExtendedUnshardResult

      expect(unshardResult.success).toBe(true)
      expect(unshardResult.deletedShards).toBeUndefined()
    })
  })

  // ==========================================================================
  // CONFLICT HANDLING
  // ==========================================================================

  describe('conflict handling', () => {
    it('should detect duplicate thing IDs across shards', async () => {
      // RED: Should detect when same ID exists in multiple shards
      // Setup duplicate ID in two shards
      mockShardData[0].things.push({
        id: 'shared-thing',
        type: 1,
        branch: null,
        name: 'Shared Thing',
        data: { value: 'from-shard-0' },
        deleted: false,
        visibility: 'user',
        version: 1,
      })
      mockShardData[1].things.push({
        id: 'shared-thing',
        type: 1,
        branch: null,
        name: 'Shared Thing',
        data: { value: 'from-shard-1' },
        deleted: false,
        visibility: 'user',
        version: 2,
      })

      const unshardResult = await result.instance.unshard() as ExtendedUnshardResult

      expect(unshardResult.conflicts.length).toBeGreaterThan(0)
      const duplicateConflict = unshardResult.conflicts.find((c) => c.type === 'duplicate')
      expect(duplicateConflict).toBeDefined()
      expect(duplicateConflict?.thingId).toBe('shared-thing')
    })

    it('should use last-write-wins by default for conflicts', async () => {
      // RED: Default conflict resolution should be last-write-wins
      mockShardData[0].things.push({
        id: 'conflict-thing',
        type: 1,
        branch: null,
        name: 'Conflict Thing',
        data: { value: 'old' },
        deleted: false,
        visibility: 'user',
        updatedAt: '2024-01-01T00:00:00Z',
        version: 1,
      })
      mockShardData[1].things.push({
        id: 'conflict-thing',
        type: 1,
        branch: null,
        name: 'Conflict Thing',
        data: { value: 'new' },
        deleted: false,
        visibility: 'user',
        updatedAt: '2024-01-02T00:00:00Z',
        version: 2,
      })

      const unshardResult = await result.instance.unshard() as ExtendedUnshardResult

      const things = result.sqlData.get('things') as ThingRecord[]
      const conflictThing = things.find((t) => t.id === 'conflict-thing')
      expect(conflictThing?.data.value).toBe('new') // Newer write wins
    })

    it('should support source-wins conflict resolution', async () => {
      // RED: Source-wins should prefer source shard data
      mockShardData[0].things.push({
        id: 'conflict-thing',
        type: 1,
        branch: null,
        name: 'Conflict Thing',
        data: { value: 'first-shard' },
        deleted: false,
        visibility: 'user',
        version: 1,
      })
      mockShardData[1].things.push({
        id: 'conflict-thing',
        type: 1,
        branch: null,
        name: 'Conflict Thing',
        data: { value: 'second-shard' },
        deleted: false,
        visibility: 'user',
        version: 2,
      })

      const options: ExtendedUnshardOptions = {
        conflictResolution: 'source-wins',
      }

      const unshardResult = await result.instance.unshard(options) as ExtendedUnshardResult

      const conflict = unshardResult.conflicts.find((c) => c.thingId === 'conflict-thing')
      expect(conflict?.resolution).toBe('kept_source')
    })

    it('should support merge conflict resolution', async () => {
      // RED: Merge should combine data from conflicting things
      mockShardData[0].things.push({
        id: 'merge-thing',
        type: 1,
        branch: null,
        name: 'Merge Thing',
        data: { field1: 'value1', common: 'old' },
        deleted: false,
        visibility: 'user',
        version: 1,
      })
      mockShardData[1].things.push({
        id: 'merge-thing',
        type: 1,
        branch: null,
        name: 'Merge Thing',
        data: { field2: 'value2', common: 'new' },
        deleted: false,
        visibility: 'user',
        version: 2,
      })

      const options: ExtendedUnshardOptions = {
        conflictResolution: 'merge',
      }

      const unshardResult = await result.instance.unshard(options) as ExtendedUnshardResult

      const things = result.sqlData.get('things') as ThingRecord[]
      const mergeThing = things.find((t) => t.id === 'merge-thing')
      expect(mergeThing?.data).toEqual(expect.objectContaining({
        field1: 'value1',
        field2: 'value2',
      }))
    })

    it('should support fail conflict resolution (abort on conflict)', async () => {
      // RED: Fail should abort the entire unshard on any conflict
      mockShardData[0].things.push({
        id: 'conflict-thing',
        type: 1,
        branch: null,
        name: 'Conflict Thing',
        data: { value: 'a' },
        deleted: false,
        visibility: 'user',
        version: 1,
      })
      mockShardData[1].things.push({
        id: 'conflict-thing',
        type: 1,
        branch: null,
        name: 'Conflict Thing',
        data: { value: 'b' },
        deleted: false,
        visibility: 'user',
        version: 2,
      })

      const options: ExtendedUnshardOptions = {
        conflictResolution: 'fail',
      }

      await expect(result.instance.unshard(options)).rejects.toThrow(/conflict/i)
    })

    it('should track all conflicts in result', async () => {
      // RED: All conflicts should be recorded
      // Add multiple conflicts
      for (let i = 0; i < 3; i++) {
        mockShardData[0].things.push({
          id: `conflict-${i}`,
          type: 1,
          branch: null,
          name: `Conflict ${i}`,
          data: { shard: 0 },
          deleted: false,
          visibility: 'user',
          version: 1,
        })
        mockShardData[1].things.push({
          id: `conflict-${i}`,
          type: 1,
          branch: null,
          name: `Conflict ${i}`,
          data: { shard: 1 },
          deleted: false,
          visibility: 'user',
          version: 2,
        })
      }

      const unshardResult = await result.instance.unshard() as ExtendedUnshardResult

      expect(unshardResult.conflicts.length).toBeGreaterThanOrEqual(3)
    })
  })

  // ==========================================================================
  // DATA INTEGRITY
  // ==========================================================================

  describe('data integrity', () => {
    it('should validate data integrity after merge', async () => {
      // RED: Should verify all data was transferred correctly
      const options: ExtendedUnshardOptions = {
        validateIntegrity: true,
      }

      const unshardResult = await result.instance.unshard(options) as ExtendedUnshardResult

      expect(unshardResult.integrityCheck).toBeDefined()
      expect(unshardResult.integrityCheck?.valid).toBe(true)
    })

    it('should count expected vs actual things', async () => {
      // RED: Integrity check should compare counts
      const options: ExtendedUnshardOptions = {
        validateIntegrity: true,
      }

      const unshardResult = await result.instance.unshard(options) as ExtendedUnshardResult

      expect(unshardResult.integrityCheck?.expectedThings).toBe(100)
      expect(unshardResult.integrityCheck?.actualThings).toBe(100)
    })

    it('should count expected vs actual relationships', async () => {
      // RED: Integrity check should verify relationships
      const options: ExtendedUnshardOptions = {
        validateIntegrity: true,
      }

      const unshardResult = await result.instance.unshard(options) as ExtendedUnshardResult

      expect(unshardResult.integrityCheck?.expectedRelationships).toBe(96)
      expect(unshardResult.integrityCheck?.actualRelationships).toBe(96)
    })

    it('should detect missing things in integrity check', async () => {
      // RED: Should detect if things are lost during merge
      // Simulate a shard that fails to return all data
      const originalFetch = result.env.DO!.stubs.get('shard-do-2')?.fetch
      if (result.env.DO?.stubFactory) {
        const mockNamespace = result.env.DO
        mockNamespace.stubFactory = (id) => ({
          id,
          fetch: vi.fn().mockImplementation(async (request: Request) => {
            const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)

            // Shard 2 returns fewer things
            if (shardIndex === 2) {
              const partialThings = mockShardData[2].things.slice(0, 10) // Only 10 of 25
              return new Response(JSON.stringify({
                things: partialThings,
                relationships: mockShardData[2].relationships,
              }))
            }

            const shard = mockShardData[shardIndex]
            return new Response(JSON.stringify({
              things: shard?.things || [],
              relationships: shard?.relationships || [],
            }))
          }),
        })
      }

      const options: ExtendedUnshardOptions = {
        validateIntegrity: true,
      }

      const unshardResult = await result.instance.unshard(options) as ExtendedUnshardResult

      expect(unshardResult.integrityCheck?.valid).toBe(false)
      expect(unshardResult.integrityCheck?.actualThings).toBeLessThan(
        unshardResult.integrityCheck?.expectedThings || 0
      )
    })

    it('should preserve thing data exactly', async () => {
      // RED: Thing data should not be modified during merge
      const testThing: ThingRecord = {
        id: 'integrity-test-thing',
        type: 42,
        branch: 'feature',
        name: 'Integrity Test',
        data: {
          nested: { deep: { value: 123 } },
          array: [1, 2, 3],
          unicode: 'hello',
          special: 'line1\nline2',
        },
        deleted: false,
        visibility: 'private',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        version: 5,
      }
      mockShardData[0].things.push(testThing)

      await result.instance.unshard()

      const things = result.sqlData.get('things') as ThingRecord[]
      const mergedThing = things.find((t) => t.id === 'integrity-test-thing')

      expect(mergedThing).toBeDefined()
      expect(mergedThing?.type).toBe(42)
      expect(mergedThing?.branch).toBe('feature')
      expect(mergedThing?.data.nested).toEqual({ deep: { value: 123 } })
      expect(mergedThing?.data.array).toEqual([1, 2, 3])
      expect(mergedThing?.data.unicode).toBe('hello')
    })

    it('should preserve relationship data exactly', async () => {
      // RED: Relationship data should not be modified
      const testRel = {
        id: 'integrity-test-rel',
        verb: 'customVerb',
        from: 'shard0-thing-0',
        to: 'shard0-thing-1',
        data: { weight: 0.5, tags: ['a', 'b'] },
        createdAt: '2024-01-01T00:00:00Z',
      }
      mockShardData[0].relationships.push(testRel)

      await result.instance.unshard()

      const relationships = result.sqlData.get('relationships') as typeof testRel[]
      const mergedRel = relationships.find((r) => r.id === 'integrity-test-rel')

      expect(mergedRel).toBeDefined()
      expect(mergedRel?.verb).toBe('customVerb')
      expect(mergedRel?.data?.weight).toBe(0.5)
      expect(mergedRel?.data?.tags).toEqual(['a', 'b'])
    })
  })

  // ==========================================================================
  // CROSS-SHARD RELATIONSHIPS
  // ==========================================================================

  describe('cross-shard relationships', () => {
    it('should reconstruct relationships between things from different shards', async () => {
      // RED: Should handle relationships that span shards
      // Create a cross-shard relationship
      mockShardData[0].relationships.push({
        id: 'cross-shard-rel',
        verb: 'references',
        from: 'shard0-thing-0',
        to: 'shard1-thing-0', // References thing in different shard
        data: null,
        createdAt: new Date().toISOString(),
      })

      await result.instance.unshard()

      const relationships = result.sqlData.get('relationships') as unknown[]
      const crossShardRel = (relationships as Array<{ id: string }>).find((r) => r.id === 'cross-shard-rel')
      expect(crossShardRel).toBeDefined()
    })

    it('should validate cross-shard relationship targets exist', async () => {
      // RED: Should ensure referenced things exist after merge
      mockShardData[0].relationships.push({
        id: 'orphan-rel',
        verb: 'references',
        from: 'shard0-thing-0',
        to: 'nonexistent-thing', // Invalid target
        data: null,
        createdAt: new Date().toISOString(),
      })

      const options: ExtendedUnshardOptions = {
        validateIntegrity: true,
      }

      const unshardResult = await result.instance.unshard(options) as ExtendedUnshardResult

      expect(unshardResult.integrityCheck?.errors).toContain(
        expect.stringMatching(/orphan|invalid|missing.*relationship/i)
      )
    })

    it('should merge cross-shard relationship index', async () => {
      // RED: Cross-shard relationship tracking should be cleaned up
      // Setup mock cross-shard index
      result.storage.data.set('crossShardRelationships', [
        { from: 'shard0-thing-0', to: 'shard1-thing-0', relId: 'cross-1' },
        { from: 'shard1-thing-5', to: 'shard2-thing-3', relId: 'cross-2' },
      ])

      await result.instance.unshard()

      // Cross-shard index should be cleared (no longer needed)
      const crossShardIndex = result.storage.data.get('crossShardRelationships')
      expect(crossShardIndex).toBeUndefined()
    })
  })

  // ==========================================================================
  // ROLLBACK BEHAVIOR
  // ==========================================================================

  describe('rollback behavior', () => {
    it('should rollback on failure in atomic mode', async () => {
      // RED: Atomic mode should undo partial changes on failure
      // Make shard 3 fail
      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
          if (shardIndex === 3) {
            throw new Error('Shard 3 unreachable')
          }
          const shard = mockShardData[shardIndex]
          return new Response(JSON.stringify({
            things: shard?.things || [],
            relationships: shard?.relationships || [],
          }))
        }),
      })

      const options: ExtendedUnshardOptions = {
        mode: 'atomic',
      }

      await expect(result.instance.unshard(options)).rejects.toThrow()

      // Source should still be marked as sharded
      const isSharded = result.storage.data.get('isSharded')
      expect(isSharded).toBe(true)

      // No things should be in source (rolled back)
      const things = result.sqlData.get('things') as unknown[]
      expect(things.length).toBe(0)
    })

    it('should not rollback in eventual mode', async () => {
      // RED: Eventual mode should keep partial progress
      const mockNamespace = result.env.DO!
      let callCount = 0
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          callCount++
          const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
          if (shardIndex === 3) {
            throw new Error('Shard 3 unreachable')
          }
          const shard = mockShardData[shardIndex]
          return new Response(JSON.stringify({
            things: shard?.things || [],
            relationships: shard?.relationships || [],
          }))
        }),
      })

      const options: ExtendedUnshardOptions = {
        mode: 'eventual',
      }

      const unshardResult = await result.instance.unshard(options) as ExtendedUnshardResult

      // Partial merge should be recorded
      expect(unshardResult.shardsMerged).toBe(3) // 3 of 4 succeeded
    })

    it('should emit rollback event on failure', async () => {
      // RED: Should emit rollback event
      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockRejectedValue(new Error('All shards failed')),
      })

      const options: ExtendedUnshardOptions = {
        mode: 'atomic',
        correlationId: 'rollback-test',
      }

      await expect(result.instance.unshard(options)).rejects.toThrow()

      const rollbackEvent = capturedEvents.find((e) => e.type === 'unshard.rollback')
      expect(rollbackEvent).toBeDefined()
      expect(rollbackEvent?.correlationId).toBe('rollback-test')
    })

    it('should support resumable mode for recovery', async () => {
      // RED: Resumable mode should checkpoint progress
      const options: ExtendedUnshardOptions = {
        mode: 'resumable' as CloneMode,
      }

      // This test verifies the capability exists
      const unshardResult = await result.instance.unshard(options) as ExtendedUnshardResult

      expect(unshardResult.success).toBe(true)
    })
  })

  // ==========================================================================
  // EVENT EMISSION
  // ==========================================================================

  describe('event emission', () => {
    it('should emit unshard.started event', async () => {
      // RED: Should emit start event
      const options: ExtendedUnshardOptions = {
        correlationId: 'unshard-123',
      }

      await result.instance.unshard(options)

      const startEvent = capturedEvents.find((e) => e.type === 'unshard.started')
      expect(startEvent).toBeDefined()
      expect(startEvent?.correlationId).toBe('unshard-123')
    })

    it('should emit unshard.completed event on success', async () => {
      // RED: Should emit completion event
      const options: ExtendedUnshardOptions = {
        correlationId: 'unshard-456',
      }

      await result.instance.unshard(options)

      const completedEvent = capturedEvents.find((e) => e.type === 'unshard.completed')
      expect(completedEvent).toBeDefined()
      expect(completedEvent?.correlationId).toBe('unshard-456')
      expect(completedEvent?.data?.shardsMerged).toBe(4)
    })

    it('should emit unshard.failed event on failure', async () => {
      // RED: Should emit failure event
      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockRejectedValue(new Error('Shard unreachable')),
      })

      const options: ExtendedUnshardOptions = {
        correlationId: 'unshard-789',
        mode: 'atomic',
      }

      await expect(result.instance.unshard(options)).rejects.toThrow()

      const failedEvent = capturedEvents.find((e) => e.type === 'unshard.failed')
      expect(failedEvent).toBeDefined()
      expect(failedEvent?.correlationId).toBe('unshard-789')
    })

    it('should emit unshard.shard_merged for each shard', async () => {
      // RED: Should emit per-shard events
      await result.instance.unshard()

      const shardMergedEvents = capturedEvents.filter((e) => e.type === 'unshard.shard_merged')
      expect(shardMergedEvents.length).toBe(4)
    })

    it('should emit unshard.conflict_detected for conflicts', async () => {
      // RED: Should emit conflict events
      mockShardData[0].things.push({
        id: 'conflict-thing',
        type: 1,
        branch: null,
        name: 'Conflict',
        data: { v: 1 },
        deleted: false,
        visibility: 'user',
        version: 1,
      })
      mockShardData[1].things.push({
        id: 'conflict-thing',
        type: 1,
        branch: null,
        name: 'Conflict',
        data: { v: 2 },
        deleted: false,
        visibility: 'user',
        version: 2,
      })

      await result.instance.unshard()

      const conflictEvent = capturedEvents.find((e) => e.type === 'unshard.conflict_detected')
      expect(conflictEvent).toBeDefined()
    })

    it('should emit unshard.integrity_check event', async () => {
      // RED: Should emit integrity check event
      const options: ExtendedUnshardOptions = {
        validateIntegrity: true,
      }

      await result.instance.unshard(options)

      const integrityEvent = capturedEvents.find((e) => e.type === 'unshard.integrity_check')
      expect(integrityEvent).toBeDefined()
    })

    it('should generate correlation ID if not provided', async () => {
      // RED: Auto-generate correlation ID
      await result.instance.unshard()

      const startEvent = capturedEvents.find((e) => e.type === 'unshard.started')
      expect(startEvent?.correlationId).toBeDefined()
      expect(startEvent?.correlationId.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  describe('validation', () => {
    it('should reject unshard on non-sharded DO', async () => {
      // RED: Cannot unshard if not sharded
      result.storage.data.delete('shardRegistry')
      result.storage.data.set('isSharded', false)

      await expect(result.instance.unshard()).rejects.toThrow(/not.*sharded/i)
    })

    it('should reject unshard with invalid target', async () => {
      // RED: Target must be valid namespace
      const options: ExtendedUnshardOptions = {
        target: '', // Empty target
      }

      await expect(result.instance.unshard(options)).rejects.toThrow(/invalid.*target/i)
    })

    it('should reject unshard with invalid mode', async () => {
      // RED: Mode must be valid
      const options: ExtendedUnshardOptions = {
        mode: 'invalid' as CloneMode,
      }

      await expect(result.instance.unshard(options)).rejects.toThrow(/invalid.*mode/i)
    })

    it('should reject unshard during active unshard', async () => {
      // RED: Cannot start new unshard while one is in progress
      // Start first unshard (don't await)
      const unshard1 = result.instance.unshard()
      const unshard2 = result.instance.unshard()

      const results = await Promise.allSettled([unshard1, unshard2])

      const rejections = results.filter((r) => r.status === 'rejected')
      expect(rejections.length).toBeGreaterThanOrEqual(1)
    })

    it('should validate shard registry exists', async () => {
      // RED: Registry is required for unshard
      result.storage.data.delete('shardRegistry')

      await expect(result.instance.unshard()).rejects.toThrow(/registry|not.*sharded/i)
    })

    it('should validate all shards are reachable before starting', async () => {
      // RED: Should pre-check shard availability
      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
          if (shardIndex === 2) {
            throw new Error('Shard 2 unreachable')
          }
          return new Response('OK')
        }),
      })

      const options: ExtendedUnshardOptions = {
        mode: 'atomic',
      }

      await expect(result.instance.unshard(options)).rejects.toThrow(/unreachable|unavailable/i)
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle empty shards', async () => {
      // RED: Some shards may have no data
      mockShardData[1].things = []
      mockShardData[1].relationships = []

      const unshardResult = await result.instance.unshard() as ExtendedUnshardResult

      expect(unshardResult.success).toBe(true)
      expect(unshardResult.thingsMerged).toBe(75) // 3 shards with 25 each
    })

    it('should handle single shard unshard', async () => {
      // RED: Should work with just one shard
      mockShardData = createMockShardData(1, 50)
      mockRegistry = createMockShardRegistry(mockShardData)
      result.storage.data.set('shardRegistry', mockRegistry)

      const unshardResult = await result.instance.unshard() as ExtendedUnshardResult

      expect(unshardResult.success).toBe(true)
      expect(unshardResult.shardsMerged).toBe(1)
      expect(unshardResult.thingsMerged).toBe(50)
    })

    it('should handle large number of shards', async () => {
      // RED: Should scale to many shards
      mockShardData = createMockShardData(16, 10)
      mockRegistry = createMockShardRegistry(mockShardData)
      result.storage.data.set('shardRegistry', mockRegistry)

      // Re-setup mock namespace for new shard data
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
          const shard = mockShardData[shardIndex]
          return new Response(JSON.stringify({
            things: shard?.things || [],
            relationships: shard?.relationships || [],
          }))
        }),
      })
      result.env.DO = mockNamespace

      const unshardResult = await result.instance.unshard() as ExtendedUnshardResult

      expect(unshardResult.success).toBe(true)
      expect(unshardResult.shardsMerged).toBe(16)
      expect(unshardResult.thingsMerged).toBe(160)
    })

    it('should handle very large things', async () => {
      // RED: Should handle things with large data payloads
      const largeThing: ThingRecord = {
        id: 'large-thing',
        type: 1,
        branch: null,
        name: 'Large Thing',
        data: {
          largeArray: Array.from({ length: 10000 }, (_, i) => ({ index: i, value: `item-${i}` })),
          largeString: 'x'.repeat(100000),
        },
        deleted: false,
        visibility: 'user',
        version: 1,
      }
      mockShardData[0].things.push(largeThing)

      const unshardResult = await result.instance.unshard() as ExtendedUnshardResult

      expect(unshardResult.success).toBe(true)

      const things = result.sqlData.get('things') as ThingRecord[]
      const merged = things.find((t) => t.id === 'large-thing')
      expect(merged?.data.largeArray).toHaveLength(10000)
    })

    it('should handle unicode in thing data', async () => {
      // RED: Unicode should be preserved
      const unicodeThing: ThingRecord = {
        id: 'unicode-thing',
        type: 1,
        branch: null,
        name: 'Unicode Test',
        data: {
          chinese: 'Chinese characters',
          japanese: 'Japanese characters',
          arabic: 'Arabic characters',
          emojis: 'Various emojis',
          mixed: 'Mixed content',
        },
        deleted: false,
        visibility: 'user',
        version: 1,
      }
      mockShardData[0].things.push(unicodeThing)

      await result.instance.unshard()

      const things = result.sqlData.get('things') as ThingRecord[]
      const merged = things.find((t) => t.id === 'unicode-thing')
      expect(merged?.data.mixed).toBe('Mixed content')
    })

    it('should timeout if unshard takes too long', async () => {
      // RED: Should respect timeout
      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          // Simulate slow response
          await new Promise((resolve) => setTimeout(resolve, 200))
          const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
          const shard = mockShardData[shardIndex]
          return new Response(JSON.stringify({
            things: shard?.things || [],
            relationships: shard?.relationships || [],
          }))
        }),
      })

      const options: ExtendedUnshardOptions = {
        timeout: 100, // Very short timeout
      }

      await expect(result.instance.unshard(options)).rejects.toThrow(/timeout/i)
    })

    it('should handle concurrent reads during unshard', async () => {
      // RED: Reads should be handled during merge
      const unshardPromise = result.instance.unshard()

      // Simulate concurrent read
      const readPromise = (result.instance as unknown as {
        getThings(): Promise<ThingRecord[]>
      }).getThings?.()

      await expect(unshardPromise).resolves.toBeDefined()
      // Read should either succeed or fail gracefully
    })

    it('should handle deleted things in shards', async () => {
      // RED: Deleted things should be handled correctly
      mockShardData[0].things.push({
        id: 'deleted-thing',
        type: 1,
        branch: null,
        name: 'Deleted Thing',
        data: {},
        deleted: true, // Marked as deleted
        visibility: 'user',
        version: 1,
      })

      const unshardResult = await result.instance.unshard() as ExtendedUnshardResult

      expect(unshardResult.success).toBe(true)

      const things = result.sqlData.get('things') as ThingRecord[]
      const deletedThing = things.find((t) => t.id === 'deleted-thing')
      expect(deletedThing?.deleted).toBe(true)
    })
  })

  // ==========================================================================
  // SHARD CLEANUP
  // ==========================================================================

  describe('shard cleanup', () => {
    it('should mark shards as inactive during merge', async () => {
      // RED: Shards should be marked inactive while merging
      let registryDuringMerge: ShardRegistry | undefined

      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          // Capture registry state during merge
          registryDuringMerge = result.storage.data.get('shardRegistry') as ShardRegistry

          const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
          const shard = mockShardData[shardIndex]
          return new Response(JSON.stringify({
            things: shard?.things || [],
            relationships: shard?.relationships || [],
          }))
        }),
      })

      await result.instance.unshard()

      // During merge, at least some endpoints should be marked as merging
      const mergingEndpoints = registryDuringMerge?.endpoints.filter(
        (e) => e.status === 'merging'
      )
      expect(mergingEndpoints?.length).toBeGreaterThan(0)
    })

    it('should delete shard DOs when deleteShards is true', async () => {
      // RED: Should delete all shard DOs
      const deletedShards: string[] = []

      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async (request: Request) => {
          const url = new URL(request.url)
          const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)

          if (url.pathname.includes('/delete') || request.method === 'DELETE') {
            deletedShards.push(id.toString())
            return new Response('OK')
          }

          const shard = mockShardData[shardIndex]
          return new Response(JSON.stringify({
            things: shard?.things || [],
            relationships: shard?.relationships || [],
          }))
        }),
      })

      const options: ExtendedUnshardOptions = {
        deleteShards: true,
      }

      const unshardResult = await result.instance.unshard(options) as ExtendedUnshardResult

      expect(unshardResult.deletedShards).toHaveLength(4)
    })

    it('should not delete shards if merge fails', async () => {
      // RED: Should preserve shards on failure
      const deletedShards: string[] = []

      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async (request: Request) => {
          const url = new URL(request.url)
          const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)

          if (url.pathname.includes('/delete')) {
            deletedShards.push(id.toString())
            return new Response('OK')
          }

          // Fail on last shard data fetch
          if (shardIndex === 3) {
            throw new Error('Shard 3 failed')
          }

          const shard = mockShardData[shardIndex]
          return new Response(JSON.stringify({
            things: shard?.things || [],
            relationships: shard?.relationships || [],
          }))
        }),
      })

      const options: ExtendedUnshardOptions = {
        deleteShards: true,
        mode: 'atomic',
      }

      await expect(result.instance.unshard(options)).rejects.toThrow()

      // No shards should be deleted
      expect(deletedShards.length).toBe(0)
    })

    it('should cleanup cross-shard indexes after unshard', async () => {
      // RED: Cross-shard tracking data should be removed
      result.storage.data.set('crossShardIndex', { some: 'data' })
      result.storage.data.set('shardKeyMap', { key: 'map' })

      await result.instance.unshard()

      expect(result.storage.data.get('crossShardIndex')).toBeUndefined()
      expect(result.storage.data.get('shardKeyMap')).toBeUndefined()
    })
  })

  // ==========================================================================
  // INCREMENTAL UNSHARDING
  // ==========================================================================

  describe('incremental unsharding', () => {
    it('should support merging one shard at a time', async () => {
      // RED: Should be able to unshard incrementally
      const options: ExtendedUnshardOptions = {
        incremental: true,
        shardIndex: 0, // Merge only shard 0
      }

      const unshardResult = await result.instance.unshard(options) as ExtendedUnshardResult

      expect(unshardResult.success).toBe(true)
      expect(unshardResult.shardsMerged).toBe(1)

      // Should still be marked as sharded (not all shards merged)
      const isSharded = await (result.instance as unknown as {
        isSharded(): Promise<boolean>
      }).isSharded()
      expect(isSharded).toBe(true)
    })

    it('should update registry after incremental unshard', async () => {
      // RED: Registry should reflect reduced shard count
      const options: ExtendedUnshardOptions = {
        incremental: true,
        shardIndex: 1,
      }

      await result.instance.unshard(options)

      const registry = result.storage.data.get('shardRegistry') as ShardRegistry
      expect(registry.shardCount).toBe(3) // Down from 4
      expect(registry.endpoints.length).toBe(3)
      expect(registry.endpoints.every((e) => e.shardIndex !== 1)).toBe(true)
    })

    it('should merge things from specified shard only', async () => {
      // RED: Only specified shard data should be merged
      const initialThingsCount = (result.sqlData.get('things') as ThingRecord[]).length

      const options: ExtendedUnshardOptions = {
        incremental: true,
        shardIndex: 2,
      }

      const unshardResult = await result.instance.unshard(options) as ExtendedUnshardResult

      // Should only have merged 25 things (from one shard)
      expect(unshardResult.thingsMerged).toBe(25)

      const finalThingsCount = (result.sqlData.get('things') as ThingRecord[]).length
      expect(finalThingsCount).toBe(initialThingsCount + 25)
    })

    it('should allow multiple incremental unshards', async () => {
      // RED: Should be able to unshard multiple shards one at a time
      // Merge shard 0
      await result.instance.unshard({
        incremental: true,
        shardIndex: 0,
      } as ExtendedUnshardOptions)

      // Merge shard 1
      await result.instance.unshard({
        incremental: true,
        shardIndex: 1,
      } as ExtendedUnshardOptions)

      // Check registry reflects 2 remaining shards
      const registry = result.storage.data.get('shardRegistry') as ShardRegistry
      expect(registry.shardCount).toBe(2)
    })

    it('should complete unshard when last shard is merged', async () => {
      // RED: Merging final shard should complete unshard
      // Merge first 3 shards
      for (let i = 0; i < 3; i++) {
        await result.instance.unshard({
          incremental: true,
          shardIndex: i,
        } as ExtendedUnshardOptions)
      }

      // Merge final shard
      await result.instance.unshard({
        incremental: true,
        shardIndex: 3,
      } as ExtendedUnshardOptions)

      // Should no longer be sharded
      const isSharded = await (result.instance as unknown as {
        isSharded(): Promise<boolean>
      }).isSharded()
      expect(isSharded).toBe(false)

      // Registry should be cleaned up
      const registry = result.storage.data.get('shardRegistry')
      expect(registry).toBeUndefined()
    })

    it('should reject invalid shard index in incremental mode', async () => {
      // RED: Should validate shard index
      const options: ExtendedUnshardOptions = {
        incremental: true,
        shardIndex: 99, // Invalid index
      }

      await expect(result.instance.unshard(options)).rejects.toThrow(/invalid.*shard.*index/i)
    })

    it('should reject merging already-merged shard', async () => {
      // RED: Cannot merge a shard twice
      const options: ExtendedUnshardOptions = {
        incremental: true,
        shardIndex: 0,
      }

      // First merge should succeed
      await result.instance.unshard(options)

      // Second merge of same shard should fail
      await expect(result.instance.unshard(options)).rejects.toThrow(/already.*merged|not.*found/i)
    })

    it('should emit incremental unshard events', async () => {
      // RED: Should emit appropriate events for incremental unshard
      const options: ExtendedUnshardOptions = {
        incremental: true,
        shardIndex: 0,
        correlationId: 'incremental-unshard-1',
      }

      await result.instance.unshard(options)

      const startEvent = capturedEvents.find((e) => e.type === 'unshard.started')
      expect(startEvent).toBeDefined()
      expect(startEvent?.data?.incremental).toBe(true)
      expect(startEvent?.data?.shardIndex).toBe(0)
    })

    it('should handle failed incremental unshard without affecting other shards', async () => {
      // RED: Failed incremental should not impact other shards
      // Make shard 1 fail
      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
          if (shardIndex === 1) {
            throw new Error('Shard 1 failed')
          }
          const shard = mockShardData[shardIndex]
          return new Response(JSON.stringify({
            things: shard?.things || [],
            relationships: shard?.relationships || [],
          }))
        }),
      })

      // Try to merge failing shard
      await expect(result.instance.unshard({
        incremental: true,
        shardIndex: 1,
      } as ExtendedUnshardOptions)).rejects.toThrow()

      // Other shards should still be mergeable
      const successResult = await result.instance.unshard({
        incremental: true,
        shardIndex: 0,
      } as ExtendedUnshardOptions) as ExtendedUnshardResult

      expect(successResult.success).toBe(true)
    })

    it('should support deleteShards option in incremental mode', async () => {
      // RED: Should delete individual shard DO after incremental merge
      const deletedShards: string[] = []

      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async (request: Request) => {
          const url = new URL(request.url)
          const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)

          if (url.pathname.includes('/delete') || request.method === 'DELETE') {
            deletedShards.push(id.toString())
            return new Response('OK')
          }

          const shard = mockShardData[shardIndex]
          return new Response(JSON.stringify({
            things: shard?.things || [],
            relationships: shard?.relationships || [],
          }))
        }),
      })

      const options: ExtendedUnshardOptions = {
        incremental: true,
        shardIndex: 2,
        deleteShards: true,
      }

      const unshardResult = await result.instance.unshard(options) as ExtendedUnshardResult

      expect(unshardResult.deletedShards).toHaveLength(1)
      expect(unshardResult.deletedShards?.[0]).toContain('shard-do-2')
    })

    it('should track progress across incremental unshards', async () => {
      // RED: Should track cumulative progress
      // Merge first shard
      const result1 = await result.instance.unshard({
        incremental: true,
        shardIndex: 0,
      } as ExtendedUnshardOptions) as ExtendedUnshardResult

      // Merge second shard
      const result2 = await result.instance.unshard({
        incremental: true,
        shardIndex: 1,
      } as ExtendedUnshardOptions) as ExtendedUnshardResult

      // Get cumulative progress
      const progress = await (result.instance as unknown as {
        getUnshardProgress(): Promise<{
          totalShards: number
          mergedShards: number
          remainingShards: number
          totalThingsMerged: number
        }>
      }).getUnshardProgress()

      expect(progress.totalShards).toBe(4)
      expect(progress.mergedShards).toBe(2)
      expect(progress.remainingShards).toBe(2)
      expect(progress.totalThingsMerged).toBe(50) // 25 per shard
    })
  })

  // ==========================================================================
  // PERFORMANCE
  // ==========================================================================

  describe('performance', () => {
    it('should track duration in result', async () => {
      // RED: Should measure merge time
      const unshardResult = await result.instance.unshard() as ExtendedUnshardResult

      expect(unshardResult.duration).toBeGreaterThanOrEqual(0)
      expect(typeof unshardResult.duration).toBe('number')
    })

    it('should process shards in parallel when possible', async () => {
      // RED: Should parallelize shard fetching
      const fetchTimes: number[] = []

      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          fetchTimes.push(Date.now())
          const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
          const shard = mockShardData[shardIndex]
          return new Response(JSON.stringify({
            things: shard?.things || [],
            relationships: shard?.relationships || [],
          }))
        }),
      })

      await result.instance.unshard()

      // Fetches should happen roughly at the same time (parallel)
      if (fetchTimes.length >= 2) {
        const maxTimeDiff = Math.max(...fetchTimes) - Math.min(...fetchTimes)
        expect(maxTimeDiff).toBeLessThan(100) // Within 100ms of each other
      }
    })

    it('should batch database writes', async () => {
      // RED: Should batch inserts for efficiency
      const sqlOps = result.storage.sql.operations

      await result.instance.unshard()

      // Should have fewer INSERT statements than total things
      const insertOps = sqlOps.filter((op) => op.query.includes('INSERT'))
      expect(insertOps.length).toBeLessThan(100) // Less than one per thing
    })
  })
})

// ============================================================================
// TEST SUITE: UNSHARD WITH RE-SHARD
// ============================================================================

describe('unshard with re-shard integration', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    const mockShardData = createMockShardData(4, 25)
    const mockRegistry = createMockShardRegistry(mockShardData)

    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', []],
        ['relationships', []],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    result.storage.data.set('shardRegistry', mockRegistry)
    result.storage.data.set('isSharded', true)

    const mockNamespace = createMockDONamespace()
    mockNamespace.stubFactory = (id) => ({
      id,
      fetch: vi.fn().mockImplementation(async () => {
        const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
        const shard = mockShardData[shardIndex]
        return new Response(JSON.stringify({
          things: shard?.things || [],
          relationships: shard?.relationships || [],
        }))
      }),
    })
    result.env.DO = mockNamespace
  })

  it('should allow re-sharding after unshard', async () => {
    // RED: Should be able to shard again after unshard
    await result.instance.unshard()

    const isSharded = result.storage.data.get('isSharded')
    expect(isSharded).toBe(false)

    // Now shard again
    const shardResult = await result.instance.shard({
      key: 'tenantId',
      count: 8, // Different shard count
    })

    expect(shardResult.shards.length).toBe(8)
  })

  it('should preserve data through unshard-reshard cycle', async () => {
    // RED: Data should survive unshard and reshard
    await result.instance.unshard()

    const thingsBeforeReshard = (result.sqlData.get('things') as ThingRecord[]).length

    await result.instance.shard({
      key: 'tenantId',
      count: 2,
    })

    // Unshard again to verify
    await result.instance.unshard()

    const thingsAfterCycle = (result.sqlData.get('things') as ThingRecord[]).length
    expect(thingsAfterCycle).toBe(thingsBeforeReshard)
  })
})
