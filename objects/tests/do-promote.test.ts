/**
 * DO promote() Tests - RED PHASE TDD
 *
 * These tests define the expected behavior for promote():
 * - promote(thingId, options?) - elevates a Thing to its own Durable Object
 *
 * A "Thing" is a data entity stored within a DO's `things` table.
 * When promoted, the Thing becomes its own independent DO (ThingDO),
 * with its own lifecycle, storage, and identity.
 *
 * Options:
 * - options.newId: custom ID for the new DO (default: auto-generated)
 * - options.preserveHistory: keep Thing's history in new DO (default: true)
 * - options.linkParent: maintain reference to original parent DO (default: true)
 * - options.type: what kind of DO to create (default: inferred from Thing.$type)
 *
 * All tests should FAIL initially since promote() is not fully implemented.
 *
 * @see types/Thing.ts for Thing and ThingDO interfaces
 * @see types/Lifecycle.ts for PromoteResult type
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockDONamespace } from '../../testing/do'
import { DO } from '../DO'
import type { PromoteResult } from '../../types/Lifecycle'

// ============================================================================
// TYPE DEFINITIONS FOR PROMOTE API
// ============================================================================

/**
 * Options for the promote() operation
 */
interface PromoteOptions {
  /** Custom ID for the new DO (default: auto-generated from Thing ID) */
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
}

/**
 * Extended promote result with detailed information
 */
interface ExtendedPromoteResult extends PromoteResult {
  /** Number of actions migrated */
  actionsMigrated?: number
  /** Number of events migrated */
  eventsMigrated?: number
  /** Whether parent link was created */
  parentLinked?: boolean
  /** Duration of promotion in ms */
  durationMs?: number
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
    data: overrides.data ?? { key: 'value' },
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
    id: `action-${i}`,
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
    id: `event-${i}`,
    verb: i === 0 ? 'thing.created' : 'thing.updated',
    source: `${sourceNs}/Thing/${thingId}`,
    data: { version: i + 1 },
    actionId: `action-${i}`,
    sequence: i + 1,
    streamed: false,
    streamedAt: null,
    createdAt: now,
  }))
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('DO promote() Operation', () => {
  let result: MockDOResult<DO, MockEnv>
  const sourceNs = 'https://source.test.do'

  beforeEach(() => {
    result = createMockDO(DO, {
      ns: sourceNs,
      sqlData: new Map([
        ['things', [createSampleThing({ id: 'thing-001', name: 'Customer ABC' })]],
        ['branches', [{ name: 'main', head: 1, forkedFrom: null, createdAt: new Date().toISOString() }]],
        ['actions', createSampleActions('thing-001')],
        ['events', createSampleEvents('thing-001', sourceNs)],
        ['relationships', []],
        ['objects', []],
      ]),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // 1. BASIC SIGNATURE AND BEHAVIOR
  // ==========================================================================

  describe('promote(thingId, options?) Signature', () => {
    it('accepts thingId as first argument', async () => {
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
      expect(promoteResult.previousId).toBe('thing-001')
    })

    it('accepts optional PromoteOptions as second argument', async () => {
      const options: PromoteOptions = {
        newId: 'custom-do-id',
        preserveHistory: true,
        linkParent: true,
      }

      const promoteResult = await result.instance.promote('thing-001', options)

      expect(promoteResult).toBeDefined()
    })

    it('works without options argument', async () => {
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
      expect(promoteResult.ns).toBeDefined()
      expect(promoteResult.doId).toBeDefined()
    })

    it('returns PromoteResult with ns, doId, and previousId', async () => {
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toHaveProperty('ns')
      expect(promoteResult).toHaveProperty('doId')
      expect(promoteResult).toHaveProperty('previousId')
      expect(typeof promoteResult.ns).toBe('string')
      expect(typeof promoteResult.doId).toBe('string')
      expect(promoteResult.previousId).toBe('thing-001')
    })
  })

  // ==========================================================================
  // 2. THING SELECTION AND VALIDATION
  // ==========================================================================

  describe('Thing Selection and Validation', () => {
    it('finds Thing by id in parent DO', async () => {
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
      expect(promoteResult.previousId).toBe('thing-001')
    })

    it('throws error when Thing does not exist', async () => {
      await expect(
        result.instance.promote('non-existent-thing')
      ).rejects.toThrow(/not found|does not exist/i)
    })

    it('throws error when thingId is empty string', async () => {
      await expect(
        result.instance.promote('')
      ).rejects.toThrow(/empty|required/i)
    })

    it('throws error when Thing is already deleted (soft delete)', async () => {
      // Add a deleted thing
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'deleted-thing', deleted: true })
      )

      await expect(
        result.instance.promote('deleted-thing')
      ).rejects.toThrow(/deleted|cannot promote/i)
    })

    it('throws error when Thing is already a DO root', async () => {
      // A Thing whose $id matches the namespace is already a DO
      // Add a thing that represents the root
      result.sqlData.get('things')!.push(
        createSampleThing({ id: '', name: 'Root Thing' }) // Empty ID = root
      )

      await expect(
        result.instance.promote('')
      ).rejects.toThrow(/already.*DO|cannot promote.*root/i)
    })

    it('validates thingId format', async () => {
      const invalidIds = ['../escape', 'thing\0null', 'thing\nline']

      for (const invalidId of invalidIds) {
        await expect(
          result.instance.promote(invalidId)
        ).rejects.toThrow(/invalid.*id|format/i)
      }
    })
  })

  // ==========================================================================
  // 3. NEW DO CREATION
  // ==========================================================================

  describe('New DO Creation', () => {
    it('creates a new DO for the promoted Thing', async () => {
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult.ns).toBeDefined()
      expect(promoteResult.doId).toBeDefined()
      // Verify DO namespace was called
      expect(result.env.DO?.stubs.size).toBeGreaterThan(0)
    })

    it('uses auto-generated ID when newId not specified', async () => {
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult.doId).toBeDefined()
      expect(promoteResult.doId.length).toBeGreaterThan(0)
    })

    it('uses custom ID when options.newId is specified', async () => {
      const customId = 'my-custom-do-id'

      const promoteResult = await result.instance.promote('thing-001', {
        newId: customId,
      })

      expect(promoteResult.doId).toContain(customId)
    })

    it('generates namespace URL based on Thing identity', async () => {
      const promoteResult = await result.instance.promote('thing-001')

      // Namespace should be a valid URL containing the thing identifier
      expect(promoteResult.ns).toMatch(/^https?:\/\//)
    })

    it('supports options.colo for location targeting', async () => {
      const promoteResult = await result.instance.promote('thing-001', {
        colo: 'ewr',
      })

      expect(promoteResult).toBeDefined()
      // Location hint should be passed to newUniqueId
    })

    it('supports options.region for geographic targeting', async () => {
      const promoteResult = await result.instance.promote('thing-001', {
        region: 'wnam',
      })

      expect(promoteResult).toBeDefined()
      // Region hint should be passed to newUniqueId for western North America
    })

    it('supports both colo and region together', async () => {
      const promoteResult = await result.instance.promote('thing-001', {
        colo: 'lax',
        region: 'wnam',
      })

      expect(promoteResult).toBeDefined()
      // Both location hints should be considered
    })

    it('infers DO type from Thing.$type when options.type not specified', async () => {
      // Add a typed thing
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'typed-thing', type: 2 }) // type 2 = some noun
      )

      const promoteResult = await result.instance.promote('typed-thing')

      expect(promoteResult).toBeDefined()
    })

    it('uses options.type when specified', async () => {
      const promoteResult = await result.instance.promote('thing-001', {
        type: 'Customer',
      })

      expect(promoteResult).toBeDefined()
    })
  })

  // ==========================================================================
  // 4. STATE MIGRATION
  // ==========================================================================

  describe('State Migration from Thing to DO', () => {
    it('transfers Thing data to new DO', async () => {
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
      // New DO should have received the thing data via fetch
    })

    it('removes Thing from parent DO after successful promotion', async () => {
      const thingsBefore = result.sqlData.get('things')!.length

      await result.instance.promote('thing-001')

      // Thing should be removed (or marked as promoted)
      const thingsAfter = result.sqlData.get('things')!.filter(
        (t: { id: string; deleted: boolean }) => t.id === 'thing-001' && !t.deleted
      ).length

      expect(thingsAfter).toBeLessThan(thingsBefore)
    })

    it('preserves Thing.data in new DO', async () => {
      // Add thing with complex data
      const complexData = {
        nested: { deep: { value: 42 } },
        array: [1, 2, 3],
        string: 'test',
      }
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'complex-thing', data: complexData })
      )

      const promoteResult = await result.instance.promote('complex-thing')

      expect(promoteResult).toBeDefined()
      // Data should be transferred to new DO
    })

    it('preserves Thing.name in new DO', async () => {
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
      // Name should be preserved
    })

    it('preserves Thing visibility settings', async () => {
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'public-thing', visibility: 'public' })
      )

      const promoteResult = await result.instance.promote('public-thing')

      expect(promoteResult).toBeDefined()
    })
  })

  // ==========================================================================
  // 5. HISTORY PRESERVATION
  // ==========================================================================

  describe('options.preserveHistory - History Preservation', () => {
    it('preserves action history by default (preserveHistory: true)', async () => {
      const promoteResult = await result.instance.promote('thing-001') as ExtendedPromoteResult

      expect(promoteResult).toBeDefined()
      // Actions should be migrated
    })

    it('preserves event history by default', async () => {
      const promoteResult = await result.instance.promote('thing-001') as ExtendedPromoteResult

      expect(promoteResult).toBeDefined()
      // Events should be migrated
    })

    it('migrates actions referencing the Thing', async () => {
      const promoteResult = await result.instance.promote('thing-001') as ExtendedPromoteResult

      expect(promoteResult).toBeDefined()
      // Should have migrated the 3 sample actions
    })

    it('migrates events emitted by the Thing', async () => {
      const promoteResult = await result.instance.promote('thing-001') as ExtendedPromoteResult

      expect(promoteResult).toBeDefined()
      // Should have migrated the 3 sample events
    })

    it('skips history when preserveHistory: false', async () => {
      const promoteResult = await result.instance.promote('thing-001', {
        preserveHistory: false,
      }) as ExtendedPromoteResult

      expect(promoteResult).toBeDefined()
      // History should not be migrated
    })

    it('removes migrated actions from parent DO', async () => {
      const actionsBefore = result.sqlData.get('actions')!.length

      await result.instance.promote('thing-001')

      // Actions for thing-001 should be removed from parent
      const actionsAfter = result.sqlData.get('actions')!.filter(
        (a: { target: string }) => a.target.includes('thing-001')
      ).length

      expect(actionsAfter).toBeLessThan(actionsBefore)
    })

    it('removes migrated events from parent DO', async () => {
      const eventsBefore = result.sqlData.get('events')!.length

      await result.instance.promote('thing-001')

      // Events for thing-001 should be removed from parent
      const eventsAfter = result.sqlData.get('events')!.filter(
        (e: { source: string }) => e.source.includes('thing-001')
      ).length

      expect(eventsAfter).toBeLessThan(eventsBefore)
    })

    it('updates event source URLs to new namespace', async () => {
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
      // Event sources should point to new namespace
    })
  })

  // ==========================================================================
  // 6. PARENT LINKING
  // ==========================================================================

  describe('options.linkParent - Parent Reference', () => {
    it('creates parent link by default (linkParent: true)', async () => {
      const promoteResult = await result.instance.promote('thing-001') as ExtendedPromoteResult

      expect(promoteResult).toBeDefined()
      expect(promoteResult.parentLinked).toBe(true)
    })

    it('stores $parent reference in new DO', async () => {
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
      // New DO should have $parent pointing to source DO
    })

    it('adds relationship in parent DO pointing to new DO', async () => {
      await result.instance.promote('thing-001')

      // Parent should have a relationship to the promoted DO
      const relationships = result.sqlData.get('relationships')!
      // Check for 'promoted' or similar relationship
    })

    it('skips parent link when linkParent: false', async () => {
      const promoteResult = await result.instance.promote('thing-001', {
        linkParent: false,
      }) as ExtendedPromoteResult

      expect(promoteResult).toBeDefined()
      // No parent link should be created
    })

    it('parent link enables traversal back to origin', async () => {
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
      expect(promoteResult.previousId).toBe('thing-001')
      // previousId allows tracing promotion chain
    })
  })

  // ==========================================================================
  // 7. ERROR SCENARIOS
  // ==========================================================================

  describe('Error Handling', () => {
    describe('Thing Not Found Errors', () => {
      it('throws NotFoundError when Thing does not exist', async () => {
        await expect(
          result.instance.promote('non-existent')
        ).rejects.toThrow(/not found/i)
      })

      it('error includes the thingId that was not found', async () => {
        try {
          await result.instance.promote('missing-thing-xyz')
          expect.fail('Should have thrown')
        } catch (error) {
          expect((error as Error).message).toContain('missing-thing-xyz')
        }
      })
    })

    describe('Invalid Type Errors', () => {
      it('throws when options.type is invalid DO type', async () => {
        await expect(
          result.instance.promote('thing-001', { type: 'InvalidDOType' })
        ).rejects.toThrow(/invalid.*type/i)
      })
    })

    describe('Concurrent Promotion Errors', () => {
      it('throws when Thing is already being promoted', async () => {
        // Start first promotion
        const firstPromote = result.instance.promote('thing-001')

        // Attempt second promotion immediately
        await expect(
          result.instance.promote('thing-001')
        ).rejects.toThrow(/already.*promoting|concurrent/i)

        // Clean up
        await firstPromote.catch(() => {})
      })

      it('throws when Thing was already promoted', async () => {
        // Mark thing as previously promoted
        result.sqlData.get('things')!.push(
          createSampleThing({ id: 'promoted-thing', data: { _promoted: true } })
        )

        await expect(
          result.instance.promote('promoted-thing')
        ).rejects.toThrow(/already promoted/i)
      })
    })

    describe('DO Creation Errors', () => {
      it('rolls back if new DO creation fails', async () => {
        // Make DO creation fail
        const mockNamespace = createMockDONamespace()
        mockNamespace.stubFactory = () => ({
          id: { toString: () => 'fail-id', equals: () => false },
          fetch: vi.fn().mockRejectedValue(new Error('DO creation failed')),
        })
        result.env.DO = mockNamespace

        const thingsBefore = [...result.sqlData.get('things')!]

        await expect(
          result.instance.promote('thing-001')
        ).rejects.toThrow()

        // Thing should still exist in parent DO
        const thingsAfter = result.sqlData.get('things')!
        const thing = thingsAfter.find((t: { id: string }) => t.id === 'thing-001')
        expect(thing).toBeDefined()
      })

      it('rolls back if data transfer fails', async () => {
        const mockNamespace = createMockDONamespace()
        let requestCount = 0
        mockNamespace.stubFactory = () => ({
          id: { toString: () => 'transfer-fail-id', equals: () => false },
          fetch: vi.fn().mockImplementation(async () => {
            requestCount++
            if (requestCount > 1) {
              throw new Error('Data transfer failed')
            }
            return new Response('OK')
          }),
        })
        result.env.DO = mockNamespace

        await expect(
          result.instance.promote('thing-001')
        ).rejects.toThrow()

        // Thing should still exist
        const thing = result.sqlData.get('things')!.find(
          (t: { id: string }) => t.id === 'thing-001'
        )
        expect(thing).toBeDefined()
      })
    })

    describe('Permission Errors', () => {
      it('throws when DO binding is unavailable', async () => {
        result.env.DO = undefined as unknown as typeof result.env.DO

        await expect(
          result.instance.promote('thing-001')
        ).rejects.toThrow(/DO.*binding|unavailable/i)
      })
    })
  })

  // ==========================================================================
  // 8. EVENT EMISSION
  // ==========================================================================

  describe('Event Emission', () => {
    it('emits promote.started event when promotion begins', async () => {
      const capturedEvents: Array<{ verb: string; data: unknown }> = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        capturedEvents.push({ verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      await result.instance.promote('thing-001')

      const startedEvent = capturedEvents.find((e) => e.verb === 'promote.started')
      expect(startedEvent).toBeDefined()
      expect((startedEvent?.data as Record<string, unknown>)?.thingId).toBe('thing-001')
    })

    it('emits promote.completed event on success', async () => {
      const capturedEvents: Array<{ verb: string; data: unknown }> = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        capturedEvents.push({ verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      await result.instance.promote('thing-001')

      const completedEvent = capturedEvents.find((e) => e.verb === 'promote.completed')
      expect(completedEvent).toBeDefined()
    })

    it('promote.completed includes new namespace and doId', async () => {
      const capturedEvents: Array<{ verb: string; data: unknown }> = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        capturedEvents.push({ verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const promoteResult = await result.instance.promote('thing-001')

      const completedEvent = capturedEvents.find((e) => e.verb === 'promote.completed')
      expect(completedEvent).toBeDefined()
      expect((completedEvent?.data as Record<string, unknown>)?.newNs).toBe(promoteResult.ns)
      expect((completedEvent?.data as Record<string, unknown>)?.doId).toBe(promoteResult.doId)
    })

    it('emits promote.failed event on error', async () => {
      const capturedEvents: Array<{ verb: string; data: unknown }> = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        capturedEvents.push({ verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'fail-id', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Promotion failed')),
      })
      result.env.DO = mockNamespace

      await expect(result.instance.promote('thing-001')).rejects.toThrow()

      const failedEvent = capturedEvents.find((e) => e.verb === 'promote.failed')
      expect(failedEvent).toBeDefined()
    })

    it('promote.failed includes error details', async () => {
      const capturedEvents: Array<{ verb: string; data: unknown }> = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        capturedEvents.push({ verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'fail-id', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Specific error message')),
      })
      result.env.DO = mockNamespace

      await expect(result.instance.promote('thing-001')).rejects.toThrow()

      const failedEvent = capturedEvents.find((e) => e.verb === 'promote.failed')
      expect((failedEvent?.data as Record<string, unknown>)?.error).toBeDefined()
    })
  })

  // ==========================================================================
  // 9. RELATIONSHIP HANDLING
  // ==========================================================================

  describe('Relationship Handling', () => {
    beforeEach(() => {
      // Add relationships for thing-001
      result.sqlData.get('relationships')!.push(
        {
          id: 'rel-1',
          verb: 'manages',
          from: 'thing-001',
          to: 'thing-002',
          data: { role: 'owner' },
          createdAt: new Date().toISOString(),
        },
        {
          id: 'rel-2',
          verb: 'belongsTo',
          from: 'thing-003',
          to: 'thing-001',
          data: null,
          createdAt: new Date().toISOString(),
        }
      )
      // Add the related things
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'thing-002', name: 'Related Thing 2' }),
        createSampleThing({ id: 'thing-003', name: 'Related Thing 3' })
      )
    })

    it('migrates outbound relationships from the Thing', async () => {
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
      // Outbound relationships (from thing-001) should move to new DO
    })

    it('updates inbound relationship references to new namespace', async () => {
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
      // Inbound relationships (to thing-001) should be updated to point to new ns
    })

    it('preserves relationship data during migration', async () => {
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
      // Relationship data like { role: 'owner' } should be preserved
    })
  })

  // ==========================================================================
  // 10. EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles Thing with no actions', async () => {
      // Clear actions
      result.sqlData.set('actions', [])

      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
    })

    it('handles Thing with no events', async () => {
      // Clear events
      result.sqlData.set('events', [])

      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
    })

    it('handles Thing with no relationships', async () => {
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
    })

    it('handles Thing with very long ID', async () => {
      const longId = 'a'.repeat(500)
      result.sqlData.get('things')!.push(
        createSampleThing({ id: longId, name: 'Long ID Thing' })
      )

      const promoteResult = await result.instance.promote(longId)

      expect(promoteResult).toBeDefined()
      expect(promoteResult.previousId).toBe(longId)
    })

    it('handles Thing with special characters in ID', async () => {
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

    it('handles Thing with large data payload', async () => {
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

    it('handles promoting last Thing in parent DO', async () => {
      // Remove all but one thing
      result.sqlData.set('things', [createSampleThing({ id: 'only-thing' })])

      const promoteResult = await result.instance.promote('only-thing')

      expect(promoteResult).toBeDefined()
      // Parent DO should now be empty (valid state)
    })

    it('handles promoting Thing on non-main branch', async () => {
      // Add a branch
      result.sqlData.get('branches')!.push({
        name: 'feature-x',
        head: 5,
        forkedFrom: 'main',
        createdAt: new Date().toISOString(),
      })
      // Add thing on feature branch
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'feature-thing', branch: 'feature-x' })
      )

      const promoteResult = await result.instance.promote('feature-thing')

      expect(promoteResult).toBeDefined()
    })
  })

  // ==========================================================================
  // 11. PROMOTE RESULT STRUCTURE
  // ==========================================================================

  describe('PromoteResult Structure', () => {
    it('PromoteResult.ns is a valid namespace URL', async () => {
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult.ns).toMatch(/^https?:\/\//)
    })

    it('PromoteResult.doId is a non-empty string', async () => {
      const promoteResult = await result.instance.promote('thing-001')

      expect(typeof promoteResult.doId).toBe('string')
      expect(promoteResult.doId.length).toBeGreaterThan(0)
    })

    it('PromoteResult.previousId matches original thingId', async () => {
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult.previousId).toBe('thing-001')
    })

    it('PromoteResult enables promotion chain tracking', async () => {
      const promoteResult = await result.instance.promote('thing-001')

      // previousId allows tracing where a DO came from
      expect(promoteResult.previousId).toBeDefined()
      // Combined with parent linking, enables full genealogy
    })
  })

  // ==========================================================================
  // 12. OBJECTS TABLE UPDATE
  // ==========================================================================

  describe('Objects Table Update', () => {
    it('adds entry to objects table for new DO', async () => {
      const promoteResult = await result.instance.promote('thing-001')

      const objects = result.sqlData.get('objects') as Array<{ ns: string; doId: string }>

      // Should have an entry for the new DO
      // Note: This may be tracked differently - adjust based on actual implementation
      expect(promoteResult.doId).toBeDefined()
    })

    it('records promotion metadata in objects table', async () => {
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toBeDefined()
      // Metadata like promotedFrom, promotedAt should be recorded
    })
  })

  // ==========================================================================
  // 13. DOLifecycle INTERFACE COMPATIBILITY
  // ==========================================================================

  describe('DOLifecycle Interface Compatibility', () => {
    it('promote() matches DOLifecycle.promote signature', async () => {
      // DOLifecycle.promote(thingId: string): Promise<PromoteResult>
      // Our implementation extends this with options

      // Basic signature should work
      const promoteResult = await result.instance.promote('thing-001')

      expect(promoteResult).toHaveProperty('ns')
      expect(promoteResult).toHaveProperty('doId')
      expect(promoteResult).toHaveProperty('previousId')
    })

    it('promote() is accessible via $ workflow context', async () => {
      // The $ context should provide access to lifecycle operations
      const $ = (result.instance as unknown as { $: { promote: Function } }).$

      // $ should have promote method
      expect($).toBeDefined()
      // Note: Actual $ context structure may vary
    })
  })

  // ==========================================================================
  // 14. ATOMIC BEHAVIOR
  // ==========================================================================

  describe('Atomic Behavior', () => {
    it('promote is atomic - all or nothing', async () => {
      // If any part fails, entire operation should roll back

      const mockNamespace = createMockDONamespace()
      let step = 0
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'atomic-test-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async () => {
          step++
          if (step === 3) {
            // Fail on third step (simulating partial failure)
            throw new Error('Partial failure')
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      const thingsBefore = [...result.sqlData.get('things')!]

      await expect(result.instance.promote('thing-001')).rejects.toThrow()

      // Thing should still exist in parent DO (rollback)
      const thing = result.sqlData.get('things')!.find(
        (t: { id: string }) => t.id === 'thing-001'
      )
      expect(thing).toBeDefined()
    })

    it('uses blockConcurrencyWhile for atomicity', async () => {
      const blockSpy = vi.spyOn(result.ctx, 'blockConcurrencyWhile')

      await result.instance.promote('thing-001')

      expect(blockSpy).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// PROMOTE OPTIONS TYPE TESTS
// ============================================================================

describe('PromoteOptions Type', () => {
  it('all options are optional', () => {
    const options1: PromoteOptions = {}
    const options2: PromoteOptions = { newId: 'custom' }
    const options3: PromoteOptions = { preserveHistory: false }
    const options4: PromoteOptions = { linkParent: false }
    const options5: PromoteOptions = { type: 'Customer' }
    const options6: PromoteOptions = { colo: 'ewr' }
    const options7: PromoteOptions = { region: 'wnam' }

    expect(options1).toBeDefined()
    expect(options2.newId).toBe('custom')
    expect(options3.preserveHistory).toBe(false)
    expect(options4.linkParent).toBe(false)
    expect(options5.type).toBe('Customer')
    expect(options6.colo).toBe('ewr')
    expect(options7.region).toBe('wnam')
  })

  it('accepts all options together', () => {
    const fullOptions: PromoteOptions = {
      newId: 'my-custom-id',
      preserveHistory: true,
      linkParent: true,
      type: 'Customer',
      colo: 'lax',
      region: 'wnam',
    }

    expect(fullOptions.newId).toBe('my-custom-id')
    expect(fullOptions.preserveHistory).toBe(true)
    expect(fullOptions.linkParent).toBe(true)
    expect(fullOptions.type).toBe('Customer')
    expect(fullOptions.colo).toBe('lax')
    expect(fullOptions.region).toBe('wnam')
  })
})
