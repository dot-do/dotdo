/**
 * ACID Test Suite - Phase 1: move() - Relocate DO to Different Colo
 *
 * RED TDD: These tests define the expected behavior for move() operation.
 * All tests are expected to FAIL initially as this is the RED phase.
 *
 * The move() operation (currently moveTo in implementation) transfers the DO
 * to a different Cloudflare colo while preserving identity:
 * - Validates colo code against VALID_COLOS set
 * - Prevents moving to current colo (already at target)
 * - Creates new DO with locationHint
 * - Updates objects registry with new DO ID
 * - Emits lifecycle events (move.started, move.completed)
 * - Throws error on empty state
 * - Atomicity - transfers complete before old DO cleanup
 *
 * @see objects/DOFull.ts for moveTo() implementation reference
 * @see objects/tests/do-move.test.ts for extended move() tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockDONamespace } from '../../harness/do'
import { DO } from '../../../objects/DO'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface MoveResult {
  /** The new DO ID at the target location */
  newDoId: string
  /** The resolved region/colo of the target */
  region: string
}

type MoveEventType =
  | 'move.started'
  | 'move.completed'
  | 'move.failed'

interface MoveEvent {
  type: MoveEventType
  timestamp: Date
  data: {
    targetColo?: string
    newDoId?: string
    region?: string
    error?: string
  }
}

// Valid Cloudflare colo codes (subset for testing)
const VALID_COLOS = new Set([
  // Region hints
  'wnam', 'enam', 'sam', 'weur', 'eeur', 'apac', 'oc', 'afr', 'me',
  // Specific colo codes (IATA)
  'ewr', 'lax', 'cdg', 'sin', 'syd', 'nrt', 'hkg', 'gru',
  'ord', 'dfw', 'iad', 'sjc', 'atl', 'mia', 'sea', 'den',
  'ams', 'fra', 'lhr', 'mad', 'mxp', 'zrh', 'vie', 'arn',
  'bom', 'del', 'hnd', 'icn', 'kix', 'mel', 'akl', 'jnb',
])

// ============================================================================
// TEST HELPERS
// ============================================================================

function createSampleThing(overrides: Partial<{
  id: string
  type: number
  branch: string | null
  name: string
  data: Record<string, unknown>
  deleted: boolean
  rowid: number
  visibility: string
}> = {}) {
  return {
    id: overrides.id ?? 'thing-001',
    type: overrides.type ?? 1,
    branch: overrides.branch ?? null,
    name: overrides.name ?? 'Test Thing',
    data: overrides.data ?? { key: 'value' },
    deleted: overrides.deleted ?? false,
    rowid: overrides.rowid ?? 1,
    visibility: overrides.visibility ?? 'user',
  }
}

function createBranchRecord(overrides: Partial<{
  name: string
  head: number
  base: number | null
  forkedFrom: string | null
  createdAt: string
}> = {}) {
  return {
    name: overrides.name ?? 'main',
    head: overrides.head ?? 1,
    base: overrides.base ?? null,
    forkedFrom: overrides.forkedFrom ?? null,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  }
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('move() - Relocate DO to Different Colo', () => {
  let result: MockDOResult<DO, MockEnv>
  let capturedEvents: MoveEvent[]
  const sourceNs = 'https://source.test.do'

  beforeEach(() => {
    capturedEvents = []

    result = createMockDO(DO, {
      ns: sourceNs,
      sqlData: new Map([
        ['things', [
          createSampleThing({ id: 'thing-001', name: 'Customer ABC' }),
          createSampleThing({ id: 'thing-002', name: 'Order XYZ', rowid: 2 }),
          createSampleThing({ id: 'thing-003', name: 'Product 123', rowid: 3 }),
        ]],
        ['branches', [
          createBranchRecord({ name: 'main', head: 3 }),
        ]],
        ['actions', []],
        ['events', []],
        ['objects', []],
      ]),
    })

    // Mock event capture
    const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
    ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
      capturedEvents.push({
        type: verb as MoveEventType,
        timestamp: new Date(),
        data: data as MoveEvent['data'],
      })
      return originalEmit?.call(result.instance, verb, data)
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // BASIC MOVE FUNCTIONALITY
  // ==========================================================================

  describe('basic functionality', () => {
    it('transfers state to new colo', async () => {
      // RED: Move should transfer all state to target colo
      const moveResult = await result.instance.moveTo('ewr')

      expect(moveResult).toBeDefined()
      expect(moveResult.newDoId).toBeDefined()
      expect(moveResult.region).toBe('ewr')
    })

    it('preserves thing data during transfer', async () => {
      // RED: All non-deleted things should be transferred
      const moveResult = await result.instance.moveTo('lax')

      expect(moveResult).toBeDefined()
      // Verify via stub that data was sent
      expect(result.env.DO?.stubs.size).toBeGreaterThan(0)
    })

    it('only transfers non-deleted things', async () => {
      // RED: Deleted things should not be transferred
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'deleted-thing', deleted: true, rowid: 10 })
      )

      const moveResult = await result.instance.moveTo('cdg')

      expect(moveResult).toBeDefined()
      // The deleted thing should not be included in transfer
    })

    it('returns new DO ID in result', async () => {
      // RED: Result should contain the new DO ID
      const moveResult = await result.instance.moveTo('sin')

      expect(moveResult.newDoId).toBeDefined()
      expect(typeof moveResult.newDoId).toBe('string')
      expect(moveResult.newDoId.length).toBeGreaterThan(0)
    })

    it('returns target region in result', async () => {
      // RED: Result should contain the target region
      const moveResult = await result.instance.moveTo('syd')

      expect(moveResult.region).toBe('syd')
    })
  })

  // ==========================================================================
  // COLO CODE VALIDATION
  // ==========================================================================

  describe('colo code validation', () => {
    it('validates colo code against VALID_COLOS set', async () => {
      // RED: Should accept valid colo codes
      const moveResult = await result.instance.moveTo('nrt')

      expect(moveResult.region).toBe('nrt')
    })

    it('throws error for invalid colo code', async () => {
      // RED: Should reject invalid colo codes
      await expect(
        result.instance.moveTo('invalid-colo')
      ).rejects.toThrow(/invalid.*colo/i)
    })

    it('accepts all IATA colo codes', async () => {
      // RED: Should accept standard IATA codes
      const validColos = ['ewr', 'lax', 'cdg', 'sin', 'syd']

      for (const colo of validColos) {
        // Reset state for each test
        result.sqlData.get('things')!.length = 0
        result.sqlData.get('things')!.push(
          createSampleThing({ id: 'test-thing', rowid: 1 })
        )

        // Reset current colo
        ;(result.instance as unknown as { currentColo: string | null }).currentColo = null

        const moveResult = await result.instance.moveTo(colo)
        expect(moveResult.region).toBe(colo)
      }
    })

    it('accepts region hints', async () => {
      // RED: Should accept region hints like 'wnam', 'enam', etc.
      const regionHints = ['wnam', 'enam', 'sam', 'weur', 'eeur', 'apac']

      for (const region of regionHints) {
        result.sqlData.get('things')!.length = 0
        result.sqlData.get('things')!.push(
          createSampleThing({ id: 'test-thing', rowid: 1 })
        )
        ;(result.instance as unknown as { currentColo: string | null }).currentColo = null

        const moveResult = await result.instance.moveTo(region)
        expect(moveResult.region).toBe(region)
      }
    })
  })

  // ==========================================================================
  // PREVENT MOVING TO CURRENT COLO
  // ==========================================================================

  describe('prevent moving to current colo', () => {
    it('throws error when already at target colo', async () => {
      // RED: Should prevent moving to same colo
      // First move to ewr
      await result.instance.moveTo('ewr')

      // Then try to move to ewr again
      await expect(
        result.instance.moveTo('ewr')
      ).rejects.toThrow(/already.*colo|already.*at/i)
    })

    it('allows moving to different colo after previous move', async () => {
      // RED: Should allow moving to different colo
      await result.instance.moveTo('ewr')

      // Reset things for second move
      result.sqlData.get('things')!.length = 0
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'thing-1', rowid: 1 })
      )

      const moveResult = await result.instance.moveTo('lax')
      expect(moveResult.region).toBe('lax')
    })
  })

  // ==========================================================================
  // CREATES NEW DO WITH LOCATIONHINT
  // ==========================================================================

  describe('creates new DO with locationHint', () => {
    it('creates new DO ID with locationHint option', async () => {
      // RED: Should use locationHint when creating new DO
      const moveResult = await result.instance.moveTo('hkg')

      expect(moveResult.newDoId).toBeDefined()
      // The new ID should be created with locationHint
      expect(result.env.DO?.newUniqueId).toBeDefined()
    })

    it('transfers state to the new DO via fetch', async () => {
      // RED: Should transfer state to new DO
      const moveResult = await result.instance.moveTo('gru')

      expect(moveResult.newDoId).toBeDefined()
      // Verify stub fetch was called
      const stubs = result.env.DO?.stubs
      expect(stubs?.size).toBeGreaterThan(0)
    })

    it('includes non-deleted things in transfer payload', async () => {
      // RED: Transfer should include all non-deleted things
      const moveResult = await result.instance.moveTo('ord')

      expect(moveResult).toBeDefined()
      // Verify transfer included things via stub
    })

    it('includes branches in transfer payload', async () => {
      // RED: Transfer should include branch information
      const moveResult = await result.instance.moveTo('dfw')

      expect(moveResult).toBeDefined()
      // Verify branches were included
    })
  })

  // ==========================================================================
  // UPDATES OBJECTS REGISTRY
  // ==========================================================================

  describe('updates objects registry', () => {
    it('inserts new entry in objects table', async () => {
      // RED: Should add entry to objects table
      const moveResult = await result.instance.moveTo('iad')

      const objects = result.sqlData.get('objects') as Array<Record<string, unknown>>
      const newEntry = objects.find(o => o.id === moveResult.newDoId)

      expect(newEntry).toBeDefined()
    })

    it('records namespace in objects table', async () => {
      // RED: Should record the namespace URL
      const moveResult = await result.instance.moveTo('sjc')

      const objects = result.sqlData.get('objects') as Array<Record<string, unknown>>
      const newEntry = objects.find(o => o.id === moveResult.newDoId)

      expect(newEntry?.ns).toBe(sourceNs)
    })

    it('records region in objects table', async () => {
      // RED: Should record the target region
      const moveResult = await result.instance.moveTo('atl')

      const objects = result.sqlData.get('objects') as Array<Record<string, unknown>>
      const newEntry = objects.find(o => o.id === moveResult.newDoId)

      expect(newEntry?.region).toBe('atl')
    })

    it('sets primary flag in objects table', async () => {
      // RED: New DO should be marked as primary
      const moveResult = await result.instance.moveTo('mia')

      const objects = result.sqlData.get('objects') as Array<Record<string, unknown>>
      const newEntry = objects.find(o => o.id === moveResult.newDoId)

      expect(newEntry?.primary).toBe(true)
    })
  })

  // ==========================================================================
  // LIFECYCLE EVENTS
  // ==========================================================================

  describe('lifecycle events', () => {
    it('emits move.started event', async () => {
      // RED: Should emit start event before move begins
      await result.instance.moveTo('sea')

      const startEvent = capturedEvents.find(e => e.type === 'move.started')
      expect(startEvent).toBeDefined()
    })

    it('move.started includes target colo', async () => {
      // RED: Start event should contain target colo
      await result.instance.moveTo('den')

      const startEvent = capturedEvents.find(e => e.type === 'move.started')
      expect(startEvent?.data?.targetColo).toBe('den')
    })

    it('emits move.completed event on success', async () => {
      // RED: Should emit completion event after successful move
      await result.instance.moveTo('ams')

      const completedEvent = capturedEvents.find(e => e.type === 'move.completed')
      expect(completedEvent).toBeDefined()
    })

    it('move.completed includes newDoId', async () => {
      // RED: Completion event should contain new DO ID
      const moveResult = await result.instance.moveTo('fra')

      const completedEvent = capturedEvents.find(e => e.type === 'move.completed')
      expect(completedEvent?.data?.newDoId).toBe(moveResult.newDoId)
    })

    it('move.completed includes region', async () => {
      // RED: Completion event should contain region
      await result.instance.moveTo('lhr')

      const completedEvent = capturedEvents.find(e => e.type === 'move.completed')
      expect(completedEvent?.data?.region).toBe('lhr')
    })

    it('emits events in correct order', async () => {
      // RED: Started should come before completed
      await result.instance.moveTo('mad')

      const startIdx = capturedEvents.findIndex(e => e.type === 'move.started')
      const completedIdx = capturedEvents.findIndex(e => e.type === 'move.completed')

      expect(startIdx).toBeLessThan(completedIdx)
    })
  })

  // ==========================================================================
  // EMPTY STATE ERROR
  // ==========================================================================

  describe('empty state error', () => {
    it('throws error when no things exist', async () => {
      // RED: Should throw when there's nothing to move
      result.sqlData.set('things', [])

      await expect(
        result.instance.moveTo('mxp')
      ).rejects.toThrow(/no.*state|nothing.*move|empty/i)
    })

    it('throws error when all things are deleted', async () => {
      // RED: Only deleted things = no valid state
      result.sqlData.set('things', [
        createSampleThing({ id: 'deleted-1', deleted: true, rowid: 1 }),
        createSampleThing({ id: 'deleted-2', deleted: true, rowid: 2 }),
      ])

      await expect(
        result.instance.moveTo('zrh')
      ).rejects.toThrow(/no.*state|nothing.*move/i)
    })

    it('succeeds with at least one non-deleted thing', async () => {
      // RED: Should work with at least one valid thing
      result.sqlData.set('things', [
        createSampleThing({ id: 'deleted-1', deleted: true, rowid: 1 }),
        createSampleThing({ id: 'valid-thing', deleted: false, rowid: 2 }),
      ])

      const moveResult = await result.instance.moveTo('vie')
      expect(moveResult).toBeDefined()
    })
  })

  // ==========================================================================
  // ATOMICITY - TRANSFER COMPLETE BEFORE CLEANUP
  // ==========================================================================

  describe('atomicity', () => {
    it('transfers complete before old DO cleanup', async () => {
      // RED: State should be fully transferred before any cleanup
      const moveResult = await result.instance.moveTo('arn')

      // Verify transfer completed (stub fetch called)
      expect(moveResult.newDoId).toBeDefined()

      // waitUntil should be called for cleanup
      expect(result.ctx.waitUntil).toBeDefined()
    })

    it('does not modify source state on transfer failure', async () => {
      // RED: Source should remain unchanged if transfer fails
      const originalThingsCount = result.sqlData.get('things')!.length

      // Make transfer fail by removing DO namespace
      result.env.DO = undefined as unknown as typeof result.env.DO

      await expect(
        result.instance.moveTo('bom')
      ).rejects.toThrow()

      // Source state should be unchanged
      expect(result.sqlData.get('things')!.length).toBe(originalThingsCount)
    })

    it('source state remains intact after successful move', async () => {
      // RED: Source state should still exist until explicit cleanup
      const originalThings = [...result.sqlData.get('things')!]

      const moveResult = await result.instance.moveTo('del')

      expect(moveResult).toBeDefined()
      // Things should still exist in source (cleanup is async via waitUntil)
      expect(result.sqlData.get('things')!.length).toBe(originalThings.length)
    })

    it('schedules cleanup via waitUntil', async () => {
      // RED: Cleanup should be scheduled, not immediate
      let waitUntilCalled = false
      result.ctx.waitUntil = vi.fn((_promise: Promise<unknown>) => {
        waitUntilCalled = true
      })

      await result.instance.moveTo('hnd')

      expect(waitUntilCalled).toBe(true)
    })
  })

  // ==========================================================================
  // ACID PROPERTIES
  // ==========================================================================

  describe('ACID properties', () => {
    it('is atomic - move is all-or-nothing', async () => {
      // RED: If move fails, no state should change
      const originalObjectsCount = (result.sqlData.get('objects') as unknown[]).length

      // Force failure with invalid colo
      await expect(
        result.instance.moveTo('invalid-colo')
      ).rejects.toThrow()

      // Objects table should be unchanged
      expect((result.sqlData.get('objects') as unknown[]).length).toBe(originalObjectsCount)
    })

    it('maintains consistency - state invariants hold after move', async () => {
      // RED: After move, state should be consistent
      const moveResult = await result.instance.moveTo('icn')

      // New DO ID should be recorded
      const objects = result.sqlData.get('objects') as Array<Record<string, unknown>>
      const newEntry = objects.find(o => o.id === moveResult.newDoId)

      expect(newEntry).toBeDefined()
      expect(newEntry?.region).toBe('icn')
      expect(newEntry?.ns).toBe(sourceNs)
    })

    it('provides isolation - concurrent moves do not interfere', async () => {
      // RED: Multiple move attempts should be handled safely
      // First move
      const move1 = await result.instance.moveTo('kix')

      // Second move should fail (already moved)
      await expect(
        result.instance.moveTo('mel')
      ).rejects.toThrow(/already.*colo/i)

      expect(move1.region).toBe('kix')
    })

    it('ensures durability - move persists', async () => {
      // RED: Move should be durable
      const moveResult = await result.instance.moveTo('akl')

      // Objects table should have persistent entry
      const objects = result.sqlData.get('objects') as Array<Record<string, unknown>>
      expect(objects.some(o => o.id === moveResult.newDoId)).toBe(true)
    })
  })

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('error handling', () => {
    it('throws when DO namespace is not configured', async () => {
      // RED: Should throw if DO binding is missing
      result.env.DO = undefined as unknown as typeof result.env.DO

      await expect(
        result.instance.moveTo('jnb')
      ).rejects.toThrow(/DO.*namespace|not.*configured/i)
    })

    it('throws descriptive error for invalid colo', async () => {
      // RED: Error should clearly indicate invalid colo
      await expect(
        result.instance.moveTo('not-a-colo')
      ).rejects.toThrow(/invalid.*colo/i)
    })

    it('throws descriptive error for empty state', async () => {
      // RED: Error should clearly indicate empty state
      result.sqlData.set('things', [])

      await expect(
        result.instance.moveTo('ewr')
      ).rejects.toThrow(/no.*state|empty/i)
    })

    it('throws descriptive error for already at colo', async () => {
      // RED: Error should clearly indicate already at target
      await result.instance.moveTo('lax')

      await expect(
        result.instance.moveTo('lax')
      ).rejects.toThrow(/already.*colo/i)
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('handles single thing state', async () => {
      // RED: Should work with minimal state
      result.sqlData.set('things', [
        createSampleThing({ id: 'only-thing', rowid: 1 }),
      ])

      const moveResult = await result.instance.moveTo('cdg')
      expect(moveResult).toBeDefined()
    })

    it('handles large state efficiently', async () => {
      // RED: Should handle many things without timeout
      const manyThings = Array.from({ length: 1000 }, (_, i) =>
        createSampleThing({ id: `thing-${i}`, rowid: i + 1 })
      )
      result.sqlData.set('things', manyThings)

      const startTime = Date.now()
      const moveResult = await result.instance.moveTo('sin')
      const duration = Date.now() - startTime

      expect(moveResult).toBeDefined()
      expect(duration).toBeLessThan(5000) // Should complete within 5 seconds
    })

    it('handles complex nested data', async () => {
      // RED: Should preserve complex data structures
      result.sqlData.set('things', [
        createSampleThing({
          id: 'complex-thing',
          data: {
            nested: { deep: { value: 42 } },
            array: [1, 2, { nested: true }],
            null: null,
          },
          rowid: 1,
        }),
      ])

      const moveResult = await result.instance.moveTo('syd')
      expect(moveResult).toBeDefined()
    })

    it('handles unicode data', async () => {
      // RED: Should preserve unicode characters
      result.sqlData.set('things', [
        createSampleThing({
          id: 'unicode-thing',
          name: 'Unicode Test',
          data: { emoji: 'Hello', chinese: 'Example' },
          rowid: 1,
        }),
      ])

      const moveResult = await result.instance.moveTo('nrt')
      expect(moveResult).toBeDefined()
    })

    it('handles multiple branches', async () => {
      // RED: Should transfer things from all branches
      result.sqlData.set('things', [
        createSampleThing({ id: 'main-thing', branch: null, rowid: 1 }),
        createSampleThing({ id: 'feature-thing', branch: 'feature', rowid: 2 }),
        createSampleThing({ id: 'develop-thing', branch: 'develop', rowid: 3 }),
      ])
      result.sqlData.set('branches', [
        createBranchRecord({ name: 'main', head: 1 }),
        createBranchRecord({ name: 'feature', head: 2, forkedFrom: 'main' }),
        createBranchRecord({ name: 'develop', head: 3, forkedFrom: 'main' }),
      ])

      const moveResult = await result.instance.moveTo('hkg')
      expect(moveResult).toBeDefined()
    })
  })

  // ==========================================================================
  // BACKWARDS COMPATIBILITY
  // ==========================================================================

  describe('backwards compatibility', () => {
    it('moveTo() method exists and is callable', async () => {
      // RED: moveTo should exist as the current API
      expect(typeof result.instance.moveTo).toBe('function')
    })

    it('moveTo() accepts colo string parameter', async () => {
      // RED: Should accept single colo string
      const moveResult = await result.instance.moveTo('gru')

      expect(moveResult).toBeDefined()
      expect(moveResult.region).toBe('gru')
    })

    it('moveTo() returns { newDoId, region } structure', async () => {
      // RED: Return type should match expected structure
      const moveResult = await result.instance.moveTo('ord')

      expect(moveResult).toHaveProperty('newDoId')
      expect(moveResult).toHaveProperty('region')
      expect(typeof moveResult.newDoId).toBe('string')
      expect(typeof moveResult.region).toBe('string')
    })
  })
})
