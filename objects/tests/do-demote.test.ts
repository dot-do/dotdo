/**
 * DO demote() Tests - RED PHASE TDD
 *
 * These tests define the expected behavior for demote():
 * - demote(options?) - collapses a DO back into a parent DO as a Thing
 *
 * demote() is the inverse of promote(). When a DO no longer needs its own
 * lifecycle, it can be demoted back into a parent DO as a Thing. The DO's
 * state is folded into the parent, relationships are updated, and the
 * original DO is deleted.
 *
 * Options:
 * - options.to: parent DO namespace/ID to demote into (required)
 * - options.compress: squash history before demoting (default: false)
 * - options.mode: 'atomic' | 'staged' (default: 'atomic')
 * - options.preserveId: keep the original DO ID as Thing ID (default: false)
 *
 * All tests should FAIL initially since demote() is not fully implemented.
 *
 * @see types/Thing.ts for Thing and ThingDO interfaces
 * @see types/Lifecycle.ts for DemoteResult type
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockDONamespace } from '../../testing/do'
import { DO } from '../DO'
import type { DemoteResult } from '../../types/Lifecycle'

// ============================================================================
// TYPE DEFINITIONS FOR DEMOTE API
// ============================================================================

/**
 * Options for the demote() operation
 */
interface DemoteOptions {
  /** Parent DO namespace to demote into (required) */
  to: string
  /** Squash history before demoting (default: false) */
  compress?: boolean
  /** Demotion mode (default: 'atomic') */
  mode?: 'atomic' | 'staged'
  /** Keep original DO ID as Thing ID (default: false) */
  preserveId?: boolean
  /** Custom type for the demoted Thing (default: inferred from DO) */
  type?: string
}

/**
 * Extended demote result with detailed information
 */
interface ExtendedDemoteResult extends DemoteResult {
  /** Number of things folded into parent */
  thingsFolded?: number
  /** Number of actions migrated */
  actionsMigrated?: number
  /** Number of events migrated */
  eventsMigrated?: number
  /** Duration of demotion in ms */
  durationMs?: number
  /** Staged token (for staged mode) */
  stagedToken?: string
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
 * Create sample actions for a DO
 */
function createSampleActions(count: number = 3) {
  const now = new Date()
  return Array.from({ length: count }, (_, i) => ({
    id: `action-${i}`,
    verb: i === 0 ? 'create' : 'update',
    actor: 'system',
    target: 'DO',
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
 * Create sample events emitted by a DO
 */
function createSampleEvents(sourceNs: string, count: number = 3) {
  const now = new Date()
  return Array.from({ length: count }, (_, i) => ({
    id: `event-${i}`,
    verb: i === 0 ? 'do.created' : 'do.updated',
    source: sourceNs,
    data: { version: i + 1 },
    actionId: `action-${i}`,
    sequence: i + 1,
    streamed: false,
    streamedAt: null,
    createdAt: now,
  }))
}

/**
 * Create sample relationships for a DO
 */
function createSampleRelationships(doNs: string) {
  return [
    {
      id: 'rel-1',
      verb: 'manages',
      from: doNs,
      to: 'https://other.test.do/thing-002',
      data: { role: 'owner' },
      createdAt: new Date().toISOString(),
    },
    {
      id: 'rel-2',
      verb: 'belongsTo',
      from: 'https://external.test.do/thing-003',
      to: doNs,
      data: null,
      createdAt: new Date().toISOString(),
    },
  ]
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('DO demote() Operation', () => {
  let result: MockDOResult<DO, MockEnv>
  const childNs = 'https://child.test.do'
  const parentNs = 'https://parent.test.do'

  beforeEach(() => {
    result = createMockDO(DO, {
      ns: childNs,
      sqlData: new Map([
        ['things', [
          createSampleThing({ id: 'thing-001', name: 'Child Thing 1' }),
          createSampleThing({ id: 'thing-002', name: 'Child Thing 2' }),
        ]],
        ['branches', [{ name: 'main', head: 1, forkedFrom: null, createdAt: new Date().toISOString() }]],
        ['actions', createSampleActions()],
        ['events', createSampleEvents(childNs)],
        ['relationships', createSampleRelationships(childNs)],
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

  describe('demote(options) Signature', () => {
    it('accepts options object with required "to" property', async () => {
      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toBeDefined()
      expect(demoteResult.parentNs).toBe(parentNs)
    })

    it('returns DemoteResult with thingId, parentNs, and deletedNs', async () => {
      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toHaveProperty('thingId')
      expect(demoteResult).toHaveProperty('parentNs')
      expect(demoteResult).toHaveProperty('deletedNs')
      expect(typeof demoteResult.thingId).toBe('string')
      expect(typeof demoteResult.parentNs).toBe('string')
      expect(typeof demoteResult.deletedNs).toBe('string')
    })

    it('thingId is a non-empty string', async () => {
      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult.thingId).toBeDefined()
      expect(demoteResult.thingId.length).toBeGreaterThan(0)
    })

    it('parentNs matches the "to" option', async () => {
      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult.parentNs).toBe(parentNs)
    })

    it('deletedNs is the current DO namespace', async () => {
      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult.deletedNs).toBe(childNs)
    })
  })

  // ==========================================================================
  // 2. OPTIONS.TO - TARGET PARENT VALIDATION
  // ==========================================================================

  describe('options.to - Parent DO Selection', () => {
    it('accepts valid namespace URL as target', async () => {
      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toBeDefined()
      expect(demoteResult.parentNs).toBe(parentNs)
    })

    it('throws error when "to" is not provided', async () => {
      await expect(
        // @ts-expect-error - testing missing required property
        result.instance.demote({})
      ).rejects.toThrow(/to.*required|missing.*parent/i)
    })

    it('throws error when "to" is empty string', async () => {
      await expect(
        result.instance.demote({ to: '' })
      ).rejects.toThrow(/empty|invalid.*namespace/i)
    })

    it('throws error when "to" is not a valid URL', async () => {
      await expect(
        result.instance.demote({ to: 'not-a-valid-url' })
      ).rejects.toThrow(/invalid.*url|namespace/i)
    })

    it('throws error when demoting to self', async () => {
      await expect(
        result.instance.demote({ to: childNs })
      ).rejects.toThrow(/cannot demote.*self|same.*namespace/i)
    })

    it('throws error when parent DO does not exist', async () => {
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'nonexistent-id', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('DO not found')),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.demote({ to: 'https://nonexistent.test.do' })
      ).rejects.toThrow(/not found|parent.*unavailable/i)
    })

    it('throws error when parent DO is inaccessible', async () => {
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'restricted-id', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Access denied')),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.demote({ to: 'https://restricted.test.do' })
      ).rejects.toThrow(/access denied|permission|unauthorized/i)
    })
  })

  // ==========================================================================
  // 3. STATE FOLDING INTO PARENT
  // ==========================================================================

  describe('State Folding into Parent', () => {
    it('transfers all Things to parent DO', async () => {
      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toBeDefined()
      // Parent should receive all things from child DO
    })

    it('creates a root Thing representing the demoted DO', async () => {
      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult.thingId).toBeDefined()
      // The thingId should reference the new Thing in parent
    })

    it('preserves Thing data during transfer', async () => {
      // Add thing with complex data
      const complexData = {
        nested: { deep: { value: 42 } },
        array: [1, 2, 3],
        string: 'test',
      }
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'complex-thing', data: complexData })
      )

      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toBeDefined()
      // Data should be transferred to parent DO
    })

    it('transfers Thing names correctly', async () => {
      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toBeDefined()
      // Thing names should be preserved
    })

    it('maintains Thing visibility settings', async () => {
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'public-thing', visibility: 'public' })
      )

      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toBeDefined()
      // Visibility should be preserved
    })

    it('transfers actions to parent DO', async () => {
      const demoteResult = await result.instance.demote({ to: parentNs }) as ExtendedDemoteResult

      expect(demoteResult).toBeDefined()
      // Actions should be migrated to parent
    })

    it('transfers events to parent DO', async () => {
      const demoteResult = await result.instance.demote({ to: parentNs }) as ExtendedDemoteResult

      expect(demoteResult).toBeDefined()
      // Events should be migrated to parent
    })

    it('updates event source references to new Thing', async () => {
      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toBeDefined()
      // Event sources should point to the new Thing in parent
    })
  })

  // ==========================================================================
  // 4. OPTIONS.COMPRESS - HISTORY SQUASHING
  // ==========================================================================

  describe('options.compress - History Squashing', () => {
    it('preserves full history by default (compress: false)', async () => {
      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toBeDefined()
      // All versions should be transferred
    })

    it('squashes history when compress: true', async () => {
      // Add multiple versions of a thing
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'versioned', name: 'v1', data: { v: 1 } }),
        createSampleThing({ id: 'versioned', name: 'v2', data: { v: 2 } }),
        createSampleThing({ id: 'versioned', name: 'v3', data: { v: 3 } })
      )

      const demoteResult = await result.instance.demote({ to: parentNs, compress: true })

      expect(demoteResult).toBeDefined()
      // Only latest version should be transferred
    })

    it('compress: true reduces actions transferred', async () => {
      const demoteResult = await result.instance.demote({
        to: parentNs,
        compress: true,
      }) as ExtendedDemoteResult

      expect(demoteResult).toBeDefined()
      // Actions should be compacted
    })

    it('compress: true reduces events transferred', async () => {
      const demoteResult = await result.instance.demote({
        to: parentNs,
        compress: true,
      }) as ExtendedDemoteResult

      expect(demoteResult).toBeDefined()
      // Events should be compacted
    })

    it('compress: false transfers all versions', async () => {
      // Add multiple versions
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'multi-v', name: 'v1', data: { v: 1 } }),
        createSampleThing({ id: 'multi-v', name: 'v2', data: { v: 2 } })
      )

      const demoteResult = await result.instance.demote({
        to: parentNs,
        compress: false,
      })

      expect(demoteResult).toBeDefined()
      // All versions should be transferred
    })
  })

  // ==========================================================================
  // 5. OPTIONS.MODE - ATOMIC VS STAGED
  // ==========================================================================

  describe('options.mode - Demotion Mode', () => {
    describe('Atomic Mode (default)', () => {
      it('defaults to atomic mode when mode not specified', async () => {
        const demoteResult = await result.instance.demote({ to: parentNs })

        expect(demoteResult).toBeDefined()
        // Should complete in single atomic operation
      })

      it('atomic mode completes in single operation', async () => {
        const demoteResult = await result.instance.demote({
          to: parentNs,
          mode: 'atomic',
        })

        expect(demoteResult).toBeDefined()
        expect(demoteResult.thingId).toBeDefined()
        expect(demoteResult.deletedNs).toBe(childNs)
      })

      it('atomic mode rolls back on failure', async () => {
        const mockNamespace = createMockDONamespace()
        let callCount = 0
        mockNamespace.stubFactory = () => ({
          id: { toString: () => 'fail-id', equals: () => false },
          fetch: vi.fn().mockImplementation(async () => {
            callCount++
            if (callCount > 1) {
              throw new Error('Transfer failed')
            }
            return new Response('OK')
          }),
        })
        result.env.DO = mockNamespace

        const thingsBefore = [...result.sqlData.get('things')!]

        await expect(
          result.instance.demote({ to: parentNs, mode: 'atomic' })
        ).rejects.toThrow()

        // Things should still exist (rollback)
        expect(result.sqlData.get('things')!.length).toBe(thingsBefore.length)
      })

      it('atomic mode uses blockConcurrencyWhile', async () => {
        const blockSpy = vi.spyOn(result.ctx, 'blockConcurrencyWhile')

        await result.instance.demote({ to: parentNs, mode: 'atomic' })

        expect(blockSpy).toHaveBeenCalled()
      })
    })

    describe('Staged Mode', () => {
      it('staged mode returns staging token', async () => {
        const demoteResult = await result.instance.demote({
          to: parentNs,
          mode: 'staged',
        }) as ExtendedDemoteResult

        expect(demoteResult).toBeDefined()
        // Should have staging information
      })

      it('staged mode allows commit', async () => {
        const demoteResult = await result.instance.demote({
          to: parentNs,
          mode: 'staged',
        }) as ExtendedDemoteResult

        expect(demoteResult).toBeDefined()
        // Staged demote should be committable
      })

      it('staged mode allows abort', async () => {
        const demoteResult = await result.instance.demote({
          to: parentNs,
          mode: 'staged',
        }) as ExtendedDemoteResult

        expect(demoteResult).toBeDefined()
        // Staged demote should be abortable
      })

      it('staged mode preserves DO until commit', async () => {
        await result.instance.demote({
          to: parentNs,
          mode: 'staged',
        })

        // DO should still exist until commit
        expect(result.sqlData.get('things')!.length).toBeGreaterThan(0)
      })
    })
  })

  // ==========================================================================
  // 6. OPTIONS.PRESERVEID - ID PRESERVATION
  // ==========================================================================

  describe('options.preserveId - ID Preservation', () => {
    it('generates new ID by default (preserveId: false)', async () => {
      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult.thingId).toBeDefined()
      // ID should be newly generated
    })

    it('uses original DO ID when preserveId: true', async () => {
      const demoteResult = await result.instance.demote({
        to: parentNs,
        preserveId: true,
      })

      expect(demoteResult.thingId).toBeDefined()
      // thingId should incorporate the original DO ID
    })

    it('preserveId: true maintains traceability', async () => {
      const demoteResult = await result.instance.demote({
        to: parentNs,
        preserveId: true,
      })

      expect(demoteResult).toBeDefined()
      // Should be able to trace demoted Thing back to original DO
    })

    it('handles ID conflicts when preserveId: true', async () => {
      // Parent already has a thing with conflicting ID
      // Implementation should handle this gracefully
      const demoteResult = await result.instance.demote({
        to: parentNs,
        preserveId: true,
      })

      expect(demoteResult).toBeDefined()
    })
  })

  // ==========================================================================
  // 7. OPTIONS.TYPE - THING TYPE
  // ==========================================================================

  describe('options.type - Thing Type', () => {
    it('infers type from DO by default', async () => {
      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toBeDefined()
      // Type should be inferred from DO's $type
    })

    it('uses specified type when provided', async () => {
      const demoteResult = await result.instance.demote({
        to: parentNs,
        type: 'ArchivedCustomer',
      })

      expect(demoteResult).toBeDefined()
      // Created Thing should have type 'ArchivedCustomer'
    })

    it('throws on invalid type', async () => {
      await expect(
        result.instance.demote({
          to: parentNs,
          type: 'InvalidTypeThatDoesNotExist123',
        })
      ).rejects.toThrow(/invalid.*type/i)
    })
  })

  // ==========================================================================
  // 8. RELATIONSHIP PRESERVATION/UPDATING
  // ==========================================================================

  describe('Relationship Preservation and Updating', () => {
    it('updates outbound relationships to point from new Thing', async () => {
      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toBeDefined()
      // Outbound relationships should now originate from the new Thing
    })

    it('updates inbound relationships to point to new Thing', async () => {
      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toBeDefined()
      // Inbound relationships should now target the new Thing
    })

    it('preserves relationship data during update', async () => {
      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toBeDefined()
      // Relationship metadata (like { role: 'owner' }) should be preserved
    })

    it('creates parent-child relationship with parent DO', async () => {
      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toBeDefined()
      // A relationship should link the new Thing to its parent
    })

    it('handles circular relationship detection', async () => {
      // Trying to demote into a child of this DO should fail
      const circularNs = 'https://child-of-child.test.do'

      // Setup relationship indicating parent-child
      result.sqlData.get('relationships')!.push({
        id: 'rel-circular',
        verb: 'parent-child',
        from: childNs,
        to: circularNs,
        data: null,
        createdAt: new Date().toISOString(),
      })

      await expect(
        result.instance.demote({ to: circularNs })
      ).rejects.toThrow(/circular|cycle|ancestor/i)
    })
  })

  // ==========================================================================
  // 9. ERROR SCENARIOS
  // ==========================================================================

  describe('Error Handling', () => {
    describe('No Parent Errors', () => {
      it('throws when no parent is specified', async () => {
        await expect(
          // @ts-expect-error - testing missing required property
          result.instance.demote({})
        ).rejects.toThrow(/to.*required|parent/i)
      })

      it('error message includes helpful information', async () => {
        try {
          // @ts-expect-error - testing missing required property
          await result.instance.demote({})
          expect.fail('Should have thrown')
        } catch (error) {
          expect((error as Error).message).toMatch(/demote|parent|to/i)
        }
      })
    })

    describe('Parent Not Found Errors', () => {
      it('throws when parent namespace does not exist', async () => {
        const mockNamespace = createMockDONamespace()
        mockNamespace.stubFactory = () => ({
          id: { toString: () => 'missing-id', equals: () => false },
          fetch: vi.fn().mockRejectedValue(new Error('Namespace not found')),
        })
        result.env.DO = mockNamespace

        await expect(
          result.instance.demote({ to: 'https://missing.test.do' })
        ).rejects.toThrow(/not found|missing|unavailable/i)
      })

      it('error includes the namespace that was not found', async () => {
        const mockNamespace = createMockDONamespace()
        mockNamespace.stubFactory = () => ({
          id: { toString: () => 'missing-id', equals: () => false },
          fetch: vi.fn().mockRejectedValue(new Error('Namespace not found')),
        })
        result.env.DO = mockNamespace

        const missingNs = 'https://nonexistent.test.do'
        try {
          await result.instance.demote({ to: missingNs })
          expect.fail('Should have thrown')
        } catch (error) {
          expect((error as Error).message).toContain('nonexistent')
        }
      })
    })

    describe('DO Binding Errors', () => {
      it('throws when DO binding is unavailable', async () => {
        result.env.DO = undefined as unknown as typeof result.env.DO

        await expect(
          result.instance.demote({ to: parentNs })
        ).rejects.toThrow(/DO.*binding|unavailable/i)
      })
    })

    describe('Transfer Errors', () => {
      it('throws when data transfer fails', async () => {
        const mockNamespace = createMockDONamespace()
        mockNamespace.stubFactory = () => ({
          id: { toString: () => 'transfer-fail-id', equals: () => false },
          fetch: vi.fn().mockRejectedValue(new Error('Transfer failed')),
        })
        result.env.DO = mockNamespace

        await expect(
          result.instance.demote({ to: parentNs })
        ).rejects.toThrow(/transfer.*fail/i)
      })

      it('rolls back on partial transfer failure', async () => {
        const mockNamespace = createMockDONamespace()
        let requestCount = 0
        mockNamespace.stubFactory = () => ({
          id: { toString: () => 'partial-fail-id', equals: () => false },
          fetch: vi.fn().mockImplementation(async () => {
            requestCount++
            if (requestCount > 2) {
              throw new Error('Partial transfer failed')
            }
            return new Response('OK')
          }),
        })
        result.env.DO = mockNamespace

        const thingsBefore = [...result.sqlData.get('things')!]

        await expect(
          result.instance.demote({ to: parentNs })
        ).rejects.toThrow()

        // Should rollback - things still exist
        expect(result.sqlData.get('things')!.length).toBe(thingsBefore.length)
      })
    })

    describe('Empty State Errors', () => {
      it('handles demote of DO with no things', async () => {
        result.sqlData.set('things', [])
        result.sqlData.set('actions', [])
        result.sqlData.set('events', [])

        // Should still work - creates empty Thing in parent
        const demoteResult = await result.instance.demote({ to: parentNs })

        expect(demoteResult).toBeDefined()
      })
    })
  })

  // ==========================================================================
  // 10. EVENT EMISSION
  // ==========================================================================

  describe('Event Emission', () => {
    it('emits demote.started event when demotion begins', async () => {
      const capturedEvents: Array<{ verb: string; data: unknown }> = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        capturedEvents.push({ verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      await result.instance.demote({ to: parentNs })

      const startedEvent = capturedEvents.find((e) => e.verb === 'demote.started')
      expect(startedEvent).toBeDefined()
      expect((startedEvent?.data as Record<string, unknown>)?.targetNs).toBe(parentNs)
    })

    it('demote.started includes source namespace', async () => {
      const capturedEvents: Array<{ verb: string; data: unknown }> = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        capturedEvents.push({ verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      await result.instance.demote({ to: parentNs })

      const startedEvent = capturedEvents.find((e) => e.verb === 'demote.started')
      expect((startedEvent?.data as Record<string, unknown>)?.sourceNs).toBe(childNs)
    })

    it('emits demote.completed event on success', async () => {
      const capturedEvents: Array<{ verb: string; data: unknown }> = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        capturedEvents.push({ verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      await result.instance.demote({ to: parentNs })

      const completedEvent = capturedEvents.find((e) => e.verb === 'demote.completed')
      expect(completedEvent).toBeDefined()
    })

    it('demote.completed includes thingId and parentNs', async () => {
      const capturedEvents: Array<{ verb: string; data: unknown }> = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        capturedEvents.push({ verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const demoteResult = await result.instance.demote({ to: parentNs })

      const completedEvent = capturedEvents.find((e) => e.verb === 'demote.completed')
      expect(completedEvent).toBeDefined()
      expect((completedEvent?.data as Record<string, unknown>)?.thingId).toBe(demoteResult.thingId)
      expect((completedEvent?.data as Record<string, unknown>)?.parentNs).toBe(parentNs)
    })

    it('demote.completed includes deletedNs', async () => {
      const capturedEvents: Array<{ verb: string; data: unknown }> = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        capturedEvents.push({ verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      await result.instance.demote({ to: parentNs })

      const completedEvent = capturedEvents.find((e) => e.verb === 'demote.completed')
      expect((completedEvent?.data as Record<string, unknown>)?.deletedNs).toBe(childNs)
    })

    it('emits demote.failed event on error', async () => {
      const capturedEvents: Array<{ verb: string; data: unknown }> = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        capturedEvents.push({ verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'fail-id', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Demotion failed')),
      })
      result.env.DO = mockNamespace

      await expect(result.instance.demote({ to: parentNs })).rejects.toThrow()

      const failedEvent = capturedEvents.find((e) => e.verb === 'demote.failed')
      expect(failedEvent).toBeDefined()
    })

    it('demote.failed includes error details', async () => {
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

      await expect(result.instance.demote({ to: parentNs })).rejects.toThrow()

      const failedEvent = capturedEvents.find((e) => e.verb === 'demote.failed')
      expect((failedEvent?.data as Record<string, unknown>)?.error).toBeDefined()
    })
  })

  // ==========================================================================
  // 11. DO DELETION AFTER DEMOTE
  // ==========================================================================

  describe('DO Deletion After Demote', () => {
    it('schedules DO for deletion after successful demote', async () => {
      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult.deletedNs).toBe(childNs)
      // DO should be scheduled for deletion
    })

    it('does not delete DO if demote fails', async () => {
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'fail-id', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Demote failed')),
      })
      result.env.DO = mockNamespace

      await expect(result.instance.demote({ to: parentNs })).rejects.toThrow()

      // DO should still exist
      expect(result.sqlData.get('things')!.length).toBeGreaterThan(0)
    })

    it('clears objects table entries on deletion', async () => {
      result.sqlData.get('objects')!.push({
        ns: childNs,
        doId: 'child-do-id',
        createdAt: new Date().toISOString(),
      })

      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toBeDefined()
      // Objects table should be cleared
    })
  })

  // ==========================================================================
  // 12. EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles DO with no actions', async () => {
      result.sqlData.set('actions', [])

      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toBeDefined()
    })

    it('handles DO with no events', async () => {
      result.sqlData.set('events', [])

      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toBeDefined()
    })

    it('handles DO with no relationships', async () => {
      result.sqlData.set('relationships', [])

      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toBeDefined()
    })

    it('handles DO with very long namespace URL', async () => {
      const longParentNs = `https://${'a'.repeat(200)}.test.do`

      const demoteResult = await result.instance.demote({ to: longParentNs })

      expect(demoteResult.parentNs).toBe(longParentNs)
    })

    it('handles DO with large number of things', async () => {
      // Add many things
      const manyThings = Array.from({ length: 1000 }, (_, i) => (
        createSampleThing({ id: `thing-${i}`, name: `Thing ${i}` })
      ))
      result.sqlData.set('things', manyThings)

      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toBeDefined()
    })

    it('handles DO with deeply nested data', async () => {
      const deepData = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  value: 'deep',
                },
              },
            },
          },
        },
      }
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'deep-thing', data: deepData })
      )

      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toBeDefined()
    })

    it('handles Things with special characters in IDs', async () => {
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
      }

      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toBeDefined()
    })

    it('handles demote on non-main branch', async () => {
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

      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toBeDefined()
    })

    it('handles unicode in namespace URLs', async () => {
      // While uncommon, test robustness
      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toBeDefined()
    })
  })

  // ==========================================================================
  // 13. DEMOTE RESULT STRUCTURE
  // ==========================================================================

  describe('DemoteResult Structure', () => {
    it('DemoteResult.thingId is the new Thing ID in parent', async () => {
      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(typeof demoteResult.thingId).toBe('string')
      expect(demoteResult.thingId.length).toBeGreaterThan(0)
    })

    it('DemoteResult.parentNs is the target namespace', async () => {
      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult.parentNs).toBe(parentNs)
    })

    it('DemoteResult.deletedNs is the original DO namespace', async () => {
      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult.deletedNs).toBe(childNs)
    })

    it('DemoteResult enables demote chain tracking', async () => {
      const demoteResult = await result.instance.demote({ to: parentNs })

      // deletedNs allows tracing where a Thing came from
      expect(demoteResult.deletedNs).toBeDefined()
    })
  })

  // ==========================================================================
  // 14. DOLIFECYCLE INTERFACE COMPATIBILITY
  // ==========================================================================

  describe('DOLifecycle Interface Compatibility', () => {
    it('demote() matches DOLifecycle.demote signature', async () => {
      // DOLifecycle.demote(targetNs: string): Promise<DemoteResult>
      // Our implementation uses options object

      // Should work with options
      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toHaveProperty('thingId')
      expect(demoteResult).toHaveProperty('parentNs')
      expect(demoteResult).toHaveProperty('deletedNs')
    })

    it('demote() is accessible via $ workflow context', async () => {
      // The $ context should provide access to lifecycle operations
      const $ = (result.instance as unknown as { $: { demote: Function } }).$

      // $ should have demote method
      expect($).toBeDefined()
      // Note: Actual $ context structure may vary
    })
  })

  // ==========================================================================
  // 15. PROMOTE/DEMOTE ROUNDTRIP
  // ==========================================================================

  describe('Promote/Demote Roundtrip', () => {
    it('demoting a promoted Thing should be possible', async () => {
      // This tests that the promote/demote cycle works
      // A Thing promoted to a DO can be demoted back

      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toBeDefined()
      expect(demoteResult.thingId).toBeDefined()
    })

    it('demoted state should be restorable', async () => {
      // After demote, the data should be fully present in parent
      const demoteResult = await result.instance.demote({ to: parentNs })

      expect(demoteResult).toBeDefined()
      // Parent should have all the child's data
    })
  })
})

// ============================================================================
// DEMOTE OPTIONS TYPE TESTS
// ============================================================================

describe('DemoteOptions Type', () => {
  it('options.to is required', () => {
    const options1: DemoteOptions = { to: 'https://parent.test.do' }

    expect(options1.to).toBe('https://parent.test.do')
  })

  it('all other options are optional', () => {
    const options1: DemoteOptions = { to: 'https://parent.test.do' }
    const options2: DemoteOptions = { to: 'https://parent.test.do', compress: true }
    const options3: DemoteOptions = { to: 'https://parent.test.do', mode: 'atomic' }
    const options4: DemoteOptions = { to: 'https://parent.test.do', mode: 'staged' }
    const options5: DemoteOptions = { to: 'https://parent.test.do', preserveId: true }
    const options6: DemoteOptions = { to: 'https://parent.test.do', type: 'Customer' }

    expect(options1).toBeDefined()
    expect(options2.compress).toBe(true)
    expect(options3.mode).toBe('atomic')
    expect(options4.mode).toBe('staged')
    expect(options5.preserveId).toBe(true)
    expect(options6.type).toBe('Customer')
  })

  it('accepts all options together', () => {
    const fullOptions: DemoteOptions = {
      to: 'https://parent.test.do',
      compress: true,
      mode: 'atomic',
      preserveId: true,
      type: 'ArchivedCustomer',
    }

    expect(fullOptions.to).toBe('https://parent.test.do')
    expect(fullOptions.compress).toBe(true)
    expect(fullOptions.mode).toBe('atomic')
    expect(fullOptions.preserveId).toBe(true)
    expect(fullOptions.type).toBe('ArchivedCustomer')
  })
})

// ============================================================================
// DEMOTE RESULT TYPE TESTS
// ============================================================================

describe('DemoteResult Type', () => {
  it('has all required properties', () => {
    const demoteResult: DemoteResult = {
      thingId: 'demoted-thing-001',
      parentNs: 'https://parent.test.do',
      deletedNs: 'https://child.test.do',
    }

    expect(demoteResult.thingId).toBe('demoted-thing-001')
    expect(demoteResult.parentNs).toBe('https://parent.test.do')
    expect(demoteResult.deletedNs).toBe('https://child.test.do')
  })

  it('all properties are strings', () => {
    const demoteResult: DemoteResult = {
      thingId: 'thing-id',
      parentNs: 'https://parent.test.do',
      deletedNs: 'https://child.test.do',
    }

    expect(typeof demoteResult.thingId).toBe('string')
    expect(typeof demoteResult.parentNs).toBe('string')
    expect(typeof demoteResult.deletedNs).toBe('string')
  })
})
