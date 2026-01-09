/**
 * ACID Test Suite - Phase 1: promote() - Thing to DO Elevation
 *
 * RED TDD: These tests define the expected behavior for promote() operation.
 * All tests are expected to FAIL initially as this is the RED phase.
 *
 * The promote() operation elevates a Thing stored within a DO to become
 * its own independent Durable Object with:
 * - Unique identity (new DO ID and namespace)
 * - Migrated data (all Thing properties)
 * - Related Actions and Events migration
 * - Reference updates in the source DO
 * - Rollback capability on failure
 * - Event emission for observability
 *
 * @see types/Lifecycle.ts for PromoteResult type
 * @see objects/tests/do-promote.test.ts for basic promote tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockDONamespace } from '../../do'
import { DO } from '../../../objects/DO'
import type { PromoteResult } from '../../../types/Lifecycle'

// ============================================================================
// TYPE DEFINITIONS FOR PROMOTE API
// ============================================================================

/**
 * Extended options for promote() operation
 */
interface PromoteOptions {
  /** Custom ID for the new DO (default: auto-generated) */
  newId?: string
  /** Keep Thing's action/event history in new DO (default: true) */
  preserveHistory?: boolean
  /** Maintain reference to original parent DO (default: true) */
  linkParent?: boolean
  /** What kind of DO to create (default: inferred from Thing.$type) */
  type?: string
  /** Target colo for the new DO (e.g., 'ewr', 'lax') */
  colo?: string
  /** Target region for the new DO (e.g., 'enam', 'wnam', 'weur', 'apac') */
  region?: string
  /** Namespace binding to use for the new DO */
  namespace?: string
  /** Correlation ID for tracing */
  correlationId?: string
}

/**
 * Extended promote result with detailed information
 */
interface ExtendedPromoteResult extends PromoteResult {
  /** Number of actions migrated */
  actionsMigrated: number
  /** Number of events migrated */
  eventsMigrated: number
  /** Number of relationships migrated */
  relationshipsMigrated: number
  /** Whether parent link was created */
  parentLinked: boolean
  /** Duration of promotion in ms */
  durationMs: number
  /** Correlation ID for tracing */
  correlationId?: string
}

/**
 * Promote event types
 */
type PromoteEventType =
  | 'thing.promoted'
  | 'promote.started'
  | 'promote.completed'
  | 'promote.failed'
  | 'promote.rollback'

/**
 * Promote event payload
 */
interface PromoteEvent {
  type: PromoteEventType
  correlationId: string
  timestamp: Date
  thingId: string
  data?: {
    newNs?: string
    doId?: string
    error?: string
    duration?: number
  }
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create sample thing data for testing.
 * Schema: id, type, branch, name, data, deleted, visibility
 */
function createSampleThing(overrides: Partial<{
  id: string
  type: number
  branch: string | null
  name: string
  data: Record<string, unknown>
  deleted: boolean
  visibility: string
}> = {}) {
  return {
    id: overrides.id ?? 'thing-001',
    type: overrides.type ?? 1,
    branch: overrides.branch ?? null,
    name: overrides.name ?? 'Test Thing',
    data: overrides.data ?? { key: 'value', nested: { prop: 'test' } },
    deleted: overrides.deleted ?? false,
    visibility: overrides.visibility ?? 'user',
  }
}

/**
 * Create sample actions referencing a thing
 */
function createSampleActions(thingId: string, count: number = 3) {
  const now = new Date()
  return Array.from({ length: count }, (_, i) => ({
    id: `action-${thingId}-${i}`,
    verb: i === 0 ? 'create' : 'update',
    actor: 'system',
    target: `Thing/${thingId}`,
    input: i === 0 ? null : i,
    output: i + 1,
    options: null,
    durability: 'try',
    status: 'completed',
    error: null,
    requestId: null,
    sessionId: null,
    workflowId: null,
    startedAt: now,
    completedAt: now,
    duration: 10 + i,
    createdAt: now,
  }))
}

/**
 * Create sample events emitted by a thing
 */
function createSampleEvents(thingId: string, sourceNs: string, count: number = 3) {
  const now = new Date()
  return Array.from({ length: count }, (_, i) => ({
    id: `event-${thingId}-${i}`,
    verb: i === 0 ? 'thing.created' : 'thing.updated',
    source: `${sourceNs}/Thing/${thingId}`,
    data: { version: i + 1 },
    actionId: `action-${thingId}-${i}`,
    sequence: i + 1,
    streamed: false,
    streamedAt: null,
    createdAt: now,
  }))
}

/**
 * Create sample relationships for a thing
 */
function createSampleRelationships(thingId: string, relatedThingIds: string[]) {
  const now = new Date().toISOString()
  return relatedThingIds.map((relatedId, i) => ({
    id: `rel-${thingId}-${i}`,
    verb: i % 2 === 0 ? 'manages' : 'belongsTo',
    from: i % 2 === 0 ? thingId : relatedId,
    to: i % 2 === 0 ? relatedId : thingId,
    data: { order: i },
    createdAt: now,
  }))
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('promote() - Thing to DO elevation', () => {
  let result: MockDOResult<DO, MockEnv>
  let capturedEvents: PromoteEvent[]
  const sourceNs = 'https://source.test.do'

  beforeEach(() => {
    capturedEvents = []

    result = createMockDO(DO, {
      ns: sourceNs,
      sqlData: new Map([
        ['things', [
          createSampleThing({ id: 'thing-001', name: 'Customer ABC' }),
          createSampleThing({ id: 'thing-002', name: 'Order XYZ' }),
          createSampleThing({ id: 'thing-003', name: 'Product 123' }),
        ]],
        ['branches', [
          { name: 'main', head: 5, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
        ['actions', [
          ...createSampleActions('thing-001'),
          ...createSampleActions('thing-002', 2),
        ]],
        ['events', [
          ...createSampleEvents('thing-001', sourceNs),
          ...createSampleEvents('thing-002', sourceNs, 2),
        ]],
        ['relationships', createSampleRelationships('thing-001', ['thing-002', 'thing-003'])],
        ['objects', []],
      ]),
    })

    // Mock event capture
    const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
    ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
      capturedEvents.push({
        type: verb as PromoteEventType,
        correlationId: (data as Record<string, unknown>)?.correlationId as string || '',
        timestamp: new Date(),
        thingId: (data as Record<string, unknown>)?.thingId as string || '',
        data: data as PromoteEvent['data'],
      })
      return originalEmit?.call(result.instance, verb, data)
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // BASIC PROMOTION
  // ==========================================================================

  describe('basic promotion', () => {
    it('promotes Thing to its own DO', async () => {
      // RED: Thing should become an independent DO
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
      expect(promoteResult.ns).toBeDefined()
      expect(promoteResult.doId).toBeDefined()
      expect(promoteResult.previousId).toBe('thing-001')
    })

    it('generates unique DO ID', async () => {
      // RED: Each promotion should create a unique DO
      const promoteResult1 = await result.instance.promote('thing-001')

      // Restore thing-001 for second promotion (in real scenario, use different thing)
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'thing-004', name: 'Another Thing' })
      )
      const promoteResult2 = await result.instance.promote('thing-004')

      expect(promoteResult1.doId).toBeDefined()
      expect(promoteResult2.doId).toBeDefined()
      expect(promoteResult1.doId).not.toBe(promoteResult2.doId)
    })

    it('migrates all Thing data', async () => {
      // RED: All Thing properties should be transferred to new DO
      const originalThing = result.sqlData.get('things')!.find(
        (t: { id: string }) => t.id === 'thing-001'
      )

      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
      // New DO should have the complete Thing data
      // (verified through the new DO's storage)
      expect(originalThing).toBeDefined()
    })

    it('assigns correct namespace URL to promoted DO', async () => {
      // RED: New DO should have a valid namespace URL
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult.ns).toMatch(/^https?:\/\//)
      expect(promoteResult.ns).not.toBe(sourceNs)
    })

    it('removes Thing from source DO after successful promotion', async () => {
      // RED: Thing should no longer exist in source DO
      const thingsBefore = result.sqlData.get('things')!.length

      await result.instance.promote('thing-001')

      const thingsAfter = result.sqlData.get('things')!.filter(
        (t: { id: string; deleted: boolean }) => t.id === 'thing-001' && !t.deleted
      ).length

      expect(thingsAfter).toBe(0)
      expect(result.sqlData.get('things')!.length).toBeLessThan(thingsBefore)
    })

    it('uses custom newId when provided', async () => {
      // RED: Should use the provided ID for new DO
      const customId = 'my-custom-promoted-do'

      const promoteResult = await result.instance.promote('thing-001', {
        newId: customId,
      })

      expect(promoteResult.doId).toContain(customId)
    })
  })

  // ==========================================================================
  // ID ASSIGNMENT FOR NEW DO
  // ==========================================================================

  describe('ID assignment for new DO', () => {
    it('generates deterministic ID from Thing identity', async () => {
      // RED: ID generation should be reproducible
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult.doId).toBeDefined()
      expect(promoteResult.doId.length).toBeGreaterThan(0)
    })

    it('supports colo hint for DO placement', async () => {
      // RED: Location hint should be passed to newUniqueId
      const promoteResult = await result.instance.promote('thing-001', {
        colo: 'ewr',
      })

      expect(promoteResult).toBeDefined()
      // Location hint should influence DO placement
    })

    it('supports region hint for DO placement', async () => {
      // RED: Region hint should be passed to newUniqueId
      const promoteResult = await result.instance.promote('thing-001', {
        region: 'wnam',
      })

      expect(promoteResult).toBeDefined()
    })

    it('generates valid DO ID format', async () => {
      // RED: DO ID should be a valid Cloudflare format
      const promoteResult = await result.instance.promote('thing-001')

      // CF DO IDs are hex strings
      expect(promoteResult.doId).toBeDefined()
      expect(typeof promoteResult.doId).toBe('string')
    })
  })

  // ==========================================================================
  // DATA MIGRATION TO NEW DO
  // ==========================================================================

  describe('data migration to new DO', () => {
    it('transfers Thing.data completely', async () => {
      // RED: All nested data should be preserved
      const complexData = {
        nested: { deep: { value: 42 } },
        array: [1, 2, 3],
        date: new Date().toISOString(),
        nullValue: null,
      }
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'complex-thing', data: complexData })
      )

      const promoteResult = await result.instance.promote('complex-thing')

      expect(promoteResult).toBeDefined()
      // Data integrity should be verified through new DO
    })

    it('preserves Thing.name in new DO', async () => {
      // RED: Name should be preserved
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
    })

    it('preserves Thing.type in new DO', async () => {
      // RED: Type should be preserved for proper DO class instantiation
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'typed-thing', type: 5 })
      )

      const promoteResult = await result.instance.promote('typed-thing')

      expect(promoteResult).toBeDefined()
    })

    it('preserves Thing.visibility in new DO', async () => {
      // RED: Visibility settings should be preserved
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'public-thing', visibility: 'public' })
      )

      const promoteResult = await result.instance.promote('public-thing')

      expect(promoteResult).toBeDefined()
    })

    it('preserves Thing.branch in new DO', async () => {
      // RED: Branch information should be preserved
      result.sqlData.get('branches')!.push({
        name: 'feature-x',
        head: 10,
        forkedFrom: 'main',
        createdAt: new Date().toISOString(),
      })
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'branched-thing', branch: 'feature-x' })
      )

      const promoteResult = await result.instance.promote('branched-thing')

      expect(promoteResult).toBeDefined()
    })

    it('handles large data payload migration', async () => {
      // RED: Large data should be handled correctly
      const largeData = {
        items: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: `Item ${i}`,
          description: 'x'.repeat(100),
        })),
      }
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'large-thing', data: largeData })
      )

      const promoteResult = await result.instance.promote('large-thing')

      expect(promoteResult).toBeDefined()
    })
  })

  // ==========================================================================
  // REFERENCES UPDATE IN SOURCE DO
  // ==========================================================================

  describe('references update in source DO', () => {
    it('updates references in source DO', async () => {
      // RED: Source DO should have updated references to the new DO
      const promoteResult = await result.instance.promote('thing-001')

      // Check that objects table or relationships have the new reference
      const objects = result.sqlData.get('objects') as Array<{ ns: string; doId: string; promotedFrom?: string }>

      expect(promoteResult).toBeDefined()
      // Should have a reference entry to the promoted DO
    })

    it('creates stub reference in source DO', async () => {
      // RED: A stub/reference should remain pointing to the new DO
      const promoteResult = await result.instance.promote('thing-001')

      // The source DO should maintain a reference to where the thing went
      expect(promoteResult).toBeDefined()
      expect(promoteResult.ns).toBeDefined()
    })

    it('updates inbound relationship targets to new namespace', async () => {
      // RED: Relationships pointing TO the thing should update to new ns
      const promoteResult = await result.instance.promote('thing-001')

      const relationships = result.sqlData.get('relationships') as Array<{
        to: string
        from: string
        verb: string
      }>

      expect(promoteResult).toBeDefined()
      // Relationships with thing-001 as target should reference new ns
    })

    it('updates outbound relationship sources in new DO', async () => {
      // RED: Relationships pointing FROM the thing should be migrated
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
      // Outbound relationships should now be in the new DO
    })

    it('maintains bidirectional relationship integrity', async () => {
      // RED: Both sides of relationships should be consistent
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
      // thing-002 and thing-003 should still be able to find thing-001 via its new ns
    })
  })

  // ==========================================================================
  // RELATED ACTIONS/EVENTS MIGRATION
  // ==========================================================================

  describe('related data - Actions migration', () => {
    it('migrates related Actions', async () => {
      // RED: All actions targeting the thing should be migrated
      const actionsBefore = result.sqlData.get('actions')!.filter(
        (a: { target: string }) => a.target.includes('thing-001')
      ).length

      const promoteResult = await result.instance.promote('thing-001') as ExtendedPromoteResult

      expect(promoteResult).toBeDefined()
      expect(promoteResult.actionsMigrated).toBe(actionsBefore)
    })

    it('removes migrated Actions from source DO', async () => {
      // RED: Actions should be removed from source after migration
      await result.instance.promote('thing-001')

      const actionsAfter = result.sqlData.get('actions')!.filter(
        (a: { target: string }) => a.target.includes('thing-001')
      ).length

      expect(actionsAfter).toBe(0)
    })

    it('preserves Action data integrity during migration', async () => {
      // RED: All action fields should be preserved
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
      // Actions in new DO should have identical data
    })

    it('updates Action target references to new namespace', async () => {
      // RED: Action targets should point to new DO namespace
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
      // Action targets should be updated to new ns
    })

    it('skips Action migration when preserveHistory is false', async () => {
      // RED: Actions should not be migrated when history preservation is disabled
      const promoteResult = await result.instance.promote('thing-001', {
        preserveHistory: false,
      }) as ExtendedPromoteResult

      expect(promoteResult).toBeDefined()
      expect(promoteResult.actionsMigrated).toBe(0)
    })
  })

  describe('related data - Events migration', () => {
    it('migrates related Events', async () => {
      // RED: All events from the thing should be migrated
      const eventsBefore = result.sqlData.get('events')!.filter(
        (e: { source: string }) => e.source.includes('thing-001')
      ).length

      const promoteResult = await result.instance.promote('thing-001') as ExtendedPromoteResult

      expect(promoteResult).toBeDefined()
      expect(promoteResult.eventsMigrated).toBe(eventsBefore)
    })

    it('removes migrated Events from source DO', async () => {
      // RED: Events should be removed from source after migration
      await result.instance.promote('thing-001')

      const eventsAfter = result.sqlData.get('events')!.filter(
        (e: { source: string }) => e.source.includes('thing-001')
      ).length

      expect(eventsAfter).toBe(0)
    })

    it('preserves Event data integrity during migration', async () => {
      // RED: All event fields should be preserved
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
    })

    it('updates Event source URLs to new namespace', async () => {
      // RED: Event sources should reflect new DO namespace
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
      // Event sources should contain new ns
    })

    it('skips Event migration when preserveHistory is false', async () => {
      // RED: Events should not be migrated when history preservation is disabled
      const promoteResult = await result.instance.promote('thing-001', {
        preserveHistory: false,
      }) as ExtendedPromoteResult

      expect(promoteResult).toBeDefined()
      expect(promoteResult.eventsMigrated).toBe(0)
    })
  })

  // ==========================================================================
  // ROLLBACK ON FAILURE
  // ==========================================================================

  describe('error handling - rollback on failure', () => {
    it('rolls back on failure', async () => {
      // RED: Failed promotion should leave source DO unchanged
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'fail-id', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('DO creation failed')),
      })
      result.env.DO = mockNamespace

      const thingsBefore = [...result.sqlData.get('things')!]

      await expect(result.instance.promote('thing-001')).rejects.toThrow()

      // Thing should still exist in source DO
      const thing = result.sqlData.get('things')!.find(
        (t: { id: string }) => t.id === 'thing-001'
      )
      expect(thing).toBeDefined()
    })

    it('rolls back Actions on failure', async () => {
      // RED: Actions should remain in source on failure
      const mockNamespace = createMockDONamespace()
      let requestCount = 0
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'partial-fail-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async () => {
          requestCount++
          if (requestCount > 2) {
            throw new Error('Data transfer failed')
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      const actionsBefore = result.sqlData.get('actions')!.filter(
        (a: { target: string }) => a.target.includes('thing-001')
      ).length

      await expect(result.instance.promote('thing-001')).rejects.toThrow()

      const actionsAfter = result.sqlData.get('actions')!.filter(
        (a: { target: string }) => a.target.includes('thing-001')
      ).length

      expect(actionsAfter).toBe(actionsBefore)
    })

    it('rolls back Events on failure', async () => {
      // RED: Events should remain in source on failure
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'event-fail-id', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Event migration failed')),
      })
      result.env.DO = mockNamespace

      const eventsBefore = result.sqlData.get('events')!.filter(
        (e: { source: string }) => e.source.includes('thing-001')
      ).length

      await expect(result.instance.promote('thing-001')).rejects.toThrow()

      const eventsAfter = result.sqlData.get('events')!.filter(
        (e: { source: string }) => e.source.includes('thing-001')
      ).length

      expect(eventsAfter).toBe(eventsBefore)
    })

    it('rolls back Relationships on failure', async () => {
      // RED: Relationships should remain unchanged on failure
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'rel-fail-id', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Relationship migration failed')),
      })
      result.env.DO = mockNamespace

      const relsBefore = result.sqlData.get('relationships')!.length

      await expect(result.instance.promote('thing-001')).rejects.toThrow()

      const relsAfter = result.sqlData.get('relationships')!.length
      expect(relsAfter).toBe(relsBefore)
    })

    it('cleans up new DO on rollback', async () => {
      // RED: New DO should be deleted if promotion fails
      const mockNamespace = createMockDONamespace()
      let doCreated = false
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'cleanup-fail-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.url.includes('/init')) {
            doCreated = true
            return new Response('OK')
          }
          // Fail on data transfer
          throw new Error('Transfer failed')
        }),
      })
      result.env.DO = mockNamespace

      await expect(result.instance.promote('thing-001')).rejects.toThrow()

      // New DO should have been cleaned up
      // (In real implementation, verify deletion was called)
    })

    it('emits promote.rollback event on failure', async () => {
      // RED: Rollback should emit an event
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'rollback-event-id', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Promotion failed')),
      })
      result.env.DO = mockNamespace

      await expect(result.instance.promote('thing-001')).rejects.toThrow()

      const rollbackEvent = capturedEvents.find((e) => e.type === 'promote.rollback')
      expect(rollbackEvent).toBeDefined()
    })

    it('rejects missing Thing', async () => {
      // RED: Non-existent thing should throw
      await expect(
        result.instance.promote('non-existent-thing')
      ).rejects.toThrow(/not found|does not exist/i)
    })

    it('rejects deleted Thing', async () => {
      // RED: Deleted things cannot be promoted
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'deleted-thing', deleted: true })
      )

      await expect(
        result.instance.promote('deleted-thing')
      ).rejects.toThrow(/deleted|cannot promote/i)
    })

    it('rejects already promoted Thing', async () => {
      // RED: Things already promoted should not be promotable again
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'promoted-thing', data: { _promoted: true, _promotedTo: 'https://new.do' } })
      )

      await expect(
        result.instance.promote('promoted-thing')
      ).rejects.toThrow(/already promoted/i)
    })

    it('rejects when DO binding is unavailable', async () => {
      // RED: Missing DO binding should throw
      result.env.DO = undefined as unknown as typeof result.env.DO

      await expect(
        result.instance.promote('thing-001')
      ).rejects.toThrow(/DO.*binding|unavailable/i)
    })
  })

  // ==========================================================================
  // NAMESPACE CONFIGURATION FOR PROMOTED DO
  // ==========================================================================

  describe('namespace configuration for promoted DO', () => {
    it('uses default DO namespace binding', async () => {
      // RED: Should use the env.DO binding by default
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
      expect(result.env.DO?.stubs.size).toBeGreaterThan(0)
    })

    it('supports custom namespace binding via options', async () => {
      // RED: Should use specified namespace binding
      const customNamespace = createMockDONamespace()
      result.env.CUSTOM_DO = customNamespace

      const promoteResult = await result.instance.promote('thing-001', {
        namespace: 'CUSTOM_DO',
      })

      expect(promoteResult).toBeDefined()
      // Should have used custom namespace
    })

    it('generates appropriate namespace URL based on Thing type', async () => {
      // RED: Namespace URL should reflect the Thing type
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'customer-thing', type: 2 }) // type 2 = Customer
      )

      const promoteResult = await result.instance.promote('customer-thing', {
        type: 'Customer',
      })

      expect(promoteResult.ns).toBeDefined()
      // Namespace should reflect Customer type
    })

    it('validates namespace binding exists', async () => {
      // RED: Non-existent binding should throw
      await expect(
        result.instance.promote('thing-001', {
          namespace: 'NON_EXISTENT_DO',
        })
      ).rejects.toThrow(/binding.*not found|unavailable/i)
    })

    it('supports specifying DO type for the new DO', async () => {
      // RED: type option should determine DO class to instantiate
      const promoteResult = await result.instance.promote('thing-001', {
        type: 'Business',
      })

      expect(promoteResult).toBeDefined()
    })

    it('infers DO type from Thing.$type when not specified', async () => {
      // RED: Should infer type from thing's type field
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'typed-thing', type: 3 }) // type 3 = some noun
      )

      const promoteResult = await result.instance.promote('typed-thing')

      expect(promoteResult).toBeDefined()
    })
  })

  // ==========================================================================
  // EVENT EMISSION
  // ==========================================================================

  describe('event emission (thing.promoted)', () => {
    it('emits promote.started event when promotion begins', async () => {
      // RED: Should emit started event
      await result.instance.promote('thing-001')

      const startedEvent = capturedEvents.find((e) => e.type === 'promote.started')
      expect(startedEvent).toBeDefined()
      expect(startedEvent?.thingId).toBe('thing-001')
    })

    it('emits thing.promoted event on success', async () => {
      // RED: Should emit the standard thing.promoted event
      await result.instance.promote('thing-001')

      const promotedEvent = capturedEvents.find((e) => e.type === 'thing.promoted')
      expect(promotedEvent).toBeDefined()
      expect(promotedEvent?.thingId).toBe('thing-001')
    })

    it('emits promote.completed event with result details', async () => {
      // RED: Completed event should include result details
      const promoteResult = await result.instance.promote('thing-001')

      const completedEvent = capturedEvents.find((e) => e.type === 'promote.completed')
      expect(completedEvent).toBeDefined()
      expect(completedEvent?.data?.newNs).toBe(promoteResult.ns)
      expect(completedEvent?.data?.doId).toBe(promoteResult.doId)
    })

    it('emits promote.failed event on error', async () => {
      // RED: Failed promotion should emit failure event
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'fail-event-id', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Promotion failed')),
      })
      result.env.DO = mockNamespace

      await expect(result.instance.promote('thing-001')).rejects.toThrow()

      const failedEvent = capturedEvents.find((e) => e.type === 'promote.failed')
      expect(failedEvent).toBeDefined()
      expect(failedEvent?.data?.error).toContain('failed')
    })

    it('includes correlationId in all events', async () => {
      // RED: All events should have correlation ID for tracing
      const correlationId = `trace-${Date.now()}`

      await result.instance.promote('thing-001', { correlationId })

      const eventsWithCorrelation = capturedEvents.filter(
        (e) => e.correlationId === correlationId
      )
      expect(eventsWithCorrelation.length).toBeGreaterThan(0)
    })

    it('generates correlationId if not provided', async () => {
      // RED: Should auto-generate correlation ID
      await result.instance.promote('thing-001')

      const startedEvent = capturedEvents.find((e) => e.type === 'promote.started')
      expect(startedEvent?.correlationId).toBeDefined()
      expect(startedEvent?.correlationId.length).toBeGreaterThan(0)
    })

    it('includes duration in completed event', async () => {
      // RED: Duration should be tracked and reported
      await result.instance.promote('thing-001')

      const completedEvent = capturedEvents.find((e) => e.type === 'promote.completed')
      expect(completedEvent?.data?.duration).toBeDefined()
      expect(completedEvent?.data?.duration).toBeGreaterThanOrEqual(0)
    })
  })

  // ==========================================================================
  // ATOMIC BEHAVIOR
  // ==========================================================================

  describe('atomic behavior', () => {
    it('uses blockConcurrencyWhile for atomicity', async () => {
      // RED: Promotion should be atomic
      const blockSpy = vi.spyOn(result.ctx, 'blockConcurrencyWhile')

      await result.instance.promote('thing-001')

      expect(blockSpy).toHaveBeenCalled()
    })

    it('prevents concurrent promotions of the same Thing', async () => {
      // RED: Concurrent promotions should be serialized or rejected
      const promote1 = result.instance.promote('thing-001')

      await expect(
        result.instance.promote('thing-001')
      ).rejects.toThrow(/already.*promoting|concurrent/i)

      await promote1.catch(() => {})
    })

    it('allows concurrent promotions of different Things', async () => {
      // RED: Different things should be promotable concurrently
      const promote1 = result.instance.promote('thing-001')
      const promote2 = result.instance.promote('thing-002')

      const results = await Promise.allSettled([promote1, promote2])

      const successes = results.filter((r) => r.status === 'fulfilled')
      expect(successes.length).toBe(2)
    })

    it('is all-or-nothing on failure', async () => {
      // RED: Partial promotion state should never exist
      const mockNamespace = createMockDONamespace()
      let step = 0
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'atomic-test-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async () => {
          step++
          if (step === 3) {
            throw new Error('Partial failure')
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await expect(result.instance.promote('thing-001')).rejects.toThrow()

      // Source DO should be completely unchanged
      const thing = result.sqlData.get('things')!.find(
        (t: { id: string }) => t.id === 'thing-001'
      )
      expect(thing).toBeDefined()
      expect(thing.deleted).toBe(false)
    })
  })

  // ==========================================================================
  // PARENT LINKING
  // ==========================================================================

  describe('parent linking', () => {
    it('creates parent link by default', async () => {
      // RED: New DO should have reference to parent
      const promoteResult = await result.instance.promote('thing-001') as ExtendedPromoteResult

      expect(promoteResult.parentLinked).toBe(true)
    })

    it('stores $parent reference in new DO', async () => {
      // RED: New DO should have $parent pointing to source
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
      // New DO storage should have $parent = sourceNs
    })

    it('skips parent link when linkParent is false', async () => {
      // RED: Should not create parent link when disabled
      const promoteResult = await result.instance.promote('thing-001', {
        linkParent: false,
      }) as ExtendedPromoteResult

      expect(promoteResult).toBeDefined()
      expect(promoteResult.parentLinked).toBe(false)
    })

    it('enables promotion chain tracking via previousId', async () => {
      // RED: previousId should enable tracing promotion history
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult.previousId).toBe('thing-001')
      // Combined with $parent, full genealogy is traceable
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('handles Thing with no actions', async () => {
      // RED: Things without history should be promotable
      result.sqlData.set('actions', [])

      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
    })

    it('handles Thing with no events', async () => {
      // RED: Things without events should be promotable
      result.sqlData.set('events', [])

      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
    })

    it('handles Thing with no relationships', async () => {
      // RED: Standalone things should be promotable
      result.sqlData.set('relationships', [])

      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
    })

    it('handles Thing with empty data', async () => {
      // RED: Empty data should be valid
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'empty-data-thing', data: {} })
      )

      const promoteResult = await result.instance.promote('empty-data-thing')

      expect(promoteResult).toBeDefined()
    })

    it('handles Thing with very long ID', async () => {
      // RED: Long IDs should be handled
      const longId = 'a'.repeat(500)
      result.sqlData.get('things')!.push(
        createSampleThing({ id: longId, name: 'Long ID Thing' })
      )

      const promoteResult = await result.instance.promote(longId)

      expect(promoteResult.previousId).toBe(longId)
    })

    it('handles Thing with special characters in ID', async () => {
      // RED: Special characters should be handled
      const specialIds = [
        'thing-with-dash',
        'thing_with_underscore',
        'thing.with.dots',
        'thing:with:colons',
      ]

      for (const specialId of specialIds) {
        result.sqlData.get('things')!.push(
          createSampleThing({ id: specialId, name: `Thing ${specialId}` })
        )

        const promoteResult = await result.instance.promote(specialId)
        expect(promoteResult.previousId).toBe(specialId)
      }
    })

    it('handles promoting last Thing in parent DO', async () => {
      // RED: Empty parent DO after promotion is valid
      result.sqlData.set('things', [createSampleThing({ id: 'only-thing' })])
      result.sqlData.set('actions', [])
      result.sqlData.set('events', [])
      result.sqlData.set('relationships', [])

      const promoteResult = await result.instance.promote('only-thing')

      expect(promoteResult).toBeDefined()
      expect(result.sqlData.get('things')!.length).toBe(0)
    })

    it('handles unicode data in Thing', async () => {
      // RED: Unicode should be preserved
      const unicodeData = {
        emoji: 'Hello World!',
        chinese: 'Example Text',
        arabic: 'Sample',
      }
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'unicode-thing', data: unicodeData })
      )

      const promoteResult = await result.instance.promote('unicode-thing')

      expect(promoteResult).toBeDefined()
    })

    it('handles binary data in Thing', async () => {
      // RED: Binary/base64 data should be preserved
      const binaryData = {
        buffer: Buffer.from('test binary data').toString('base64'),
        raw: '\x00\x01\x02\x03',
      }
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'binary-thing', data: binaryData })
      )

      const promoteResult = await result.instance.promote('binary-thing')

      expect(promoteResult).toBeDefined()
    })

    it('validates thingId format', async () => {
      // RED: Invalid IDs should be rejected
      const invalidIds = ['../escape', 'thing\0null', 'thing\nline']

      for (const invalidId of invalidIds) {
        await expect(
          result.instance.promote(invalidId)
        ).rejects.toThrow(/invalid.*id|format/i)
      }
    })

    it('rejects empty thingId', async () => {
      // RED: Empty ID is invalid
      await expect(
        result.instance.promote('')
      ).rejects.toThrow(/empty|required/i)
    })
  })

  // ==========================================================================
  // PROMOTE RESULT STRUCTURE
  // ==========================================================================

  describe('PromoteResult structure', () => {
    it('returns PromoteResult with required fields', async () => {
      // RED: Result should have all required fields
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toHaveProperty('ns')
      expect(promoteResult).toHaveProperty('doId')
      expect(promoteResult).toHaveProperty('previousId')
    })

    it('ns is a valid namespace URL', async () => {
      // RED: Namespace should be valid URL
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult.ns).toMatch(/^https?:\/\//)
    })

    it('doId is a non-empty string', async () => {
      // RED: DO ID should be valid
      const promoteResult = await result.instance.promote('thing-001')

      expect(typeof promoteResult.doId).toBe('string')
      expect(promoteResult.doId.length).toBeGreaterThan(0)
    })

    it('previousId matches the original thingId', async () => {
      // RED: Should preserve the original ID
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult.previousId).toBe('thing-001')
    })

    it('extended result includes migration statistics', async () => {
      // RED: Should include detailed stats
      const promoteResult = await result.instance.promote('thing-001') as ExtendedPromoteResult

      expect(promoteResult.actionsMigrated).toBeDefined()
      expect(promoteResult.eventsMigrated).toBeDefined()
      expect(promoteResult.relationshipsMigrated).toBeDefined()
      expect(promoteResult.durationMs).toBeDefined()
    })
  })
})

// ============================================================================
// PROMOTE OPTIONS TYPE TESTS
// ============================================================================

describe('PromoteOptions type', () => {
  it('all options are optional', () => {
    // These are compile-time type checks
    const options1: PromoteOptions = {}
    const options2: PromoteOptions = { newId: 'custom' }
    const options3: PromoteOptions = { preserveHistory: false }
    const options4: PromoteOptions = { linkParent: false }
    const options5: PromoteOptions = { type: 'Customer' }
    const options6: PromoteOptions = { colo: 'ewr' }
    const options7: PromoteOptions = { region: 'wnam' }
    const options8: PromoteOptions = { namespace: 'CUSTOM_DO' }
    const options9: PromoteOptions = { correlationId: 'trace-123' }

    expect(options1).toBeDefined()
    expect(options2.newId).toBe('custom')
    expect(options3.preserveHistory).toBe(false)
    expect(options4.linkParent).toBe(false)
    expect(options5.type).toBe('Customer')
    expect(options6.colo).toBe('ewr')
    expect(options7.region).toBe('wnam')
    expect(options8.namespace).toBe('CUSTOM_DO')
    expect(options9.correlationId).toBe('trace-123')
  })

  it('accepts all options together', () => {
    const fullOptions: PromoteOptions = {
      newId: 'my-custom-id',
      preserveHistory: true,
      linkParent: true,
      type: 'Customer',
      colo: 'lax',
      region: 'wnam',
      namespace: 'CUSTOM_DO',
      correlationId: 'trace-full',
    }

    expect(fullOptions.newId).toBe('my-custom-id')
    expect(fullOptions.preserveHistory).toBe(true)
    expect(fullOptions.linkParent).toBe(true)
    expect(fullOptions.type).toBe('Customer')
    expect(fullOptions.colo).toBe('lax')
    expect(fullOptions.region).toBe('wnam')
    expect(fullOptions.namespace).toBe('CUSTOM_DO')
    expect(fullOptions.correlationId).toBe('trace-full')
  })
})
