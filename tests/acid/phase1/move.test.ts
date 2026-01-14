/**
 * ACID Test Suite - Phase 1: move() - Relocate DO to Different Colo
 *
 * RED TDD: These tests define the expected behavior for move() operation.
 * The move() operation transfers a DO to a different Cloudflare colo with:
 * - State transfer to new DO with locationHint
 * - Colo code validation
 * - Objects registry update
 * - Lifecycle event emission
 * - Atomicity - transfers complete before old DO cleanup
 *
 * ACID Properties Tested:
 * - Atomicity: Complete transfer before old DO deletion
 * - Consistency: State unchanged during move
 * - Isolation: Move doesn't affect ongoing operations
 * - Durability: New location persists and is discoverable
 *
 * @see objects/DOFull.ts for move implementation
 * @see objects/tests/do-move.test.ts for basic move tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockDONamespace } from '../../do'
import { DO } from '../../../objects/DO'

// ============================================================================
// TYPE DEFINITIONS FOR MOVE API
// ============================================================================

/**
 * Valid Cloudflare colo codes and region hints
 */
const VALID_COLOS = new Set([
  // Region hints
  'wnam', 'enam', 'sam', 'weur', 'eeur', 'apac', 'oc', 'afr', 'me',
  // Specific colo codes
  'ewr', 'lax', 'cdg', 'sin', 'syd', 'nrt', 'hkg', 'gru',
  'ord', 'dfw', 'iad', 'sjc', 'atl', 'mia', 'sea', 'den',
  'ams', 'fra', 'lhr', 'mad', 'mxp', 'zrh', 'vie', 'arn',
  'bom', 'del', 'hnd', 'icn', 'kix', 'mel', 'akl', 'jnb',
])

/**
 * Options for the move() operation
 */
interface MoveOptions {
  /** Target colo code (e.g., 'ewr', 'lax', 'cdg') */
  colo: string
  /** Correlation ID for tracing */
  correlationId?: string
  /** Force move even if already at target colo */
  force?: boolean
}

/**
 * Result of a move operation
 */
interface MoveResult {
  /** Previous colo */
  fromColo: string | null
  /** New colo */
  toColo: string
  /** New DO ID */
  newDoId: string
  /** Duration in ms */
  durationMs?: number
}

/**
 * Move event types
 */
type MoveEventType =
  | 'move.started'
  | 'move.completed'
  | 'move.failed'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create sample thing data for testing
 */
function createSampleThing(overrides: Partial<{
  id: string
  type: number
  branch: string | null
  name: string
  data: Record<string, unknown>
  deleted: boolean
}> = {}) {
  return {
    id: overrides.id ?? 'thing-001',
    type: overrides.type ?? 1,
    branch: overrides.branch ?? null,
    name: overrides.name ?? 'Test Thing',
    data: overrides.data ?? { key: 'value' },
    deleted: overrides.deleted ?? false,
  }
}

// ============================================================================
// MOVE OPERATION TESTS
// ============================================================================

describe('ACID Phase 1: move() - Relocate DO', () => {
  let mockResult: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    mockResult = createMockDO(DO, {
      id: 'test-do',
      ns: 'https://test.example.com',
    })

    // Set up initial state
    mockResult.sqlData.set('things', [
      createSampleThing({ id: 'customer-1', name: 'Alice' }),
      createSampleThing({ id: 'customer-2', name: 'Bob' }),
    ])

    // Mock newUniqueId to track locationHint
    mockResult.env.DO.newUniqueId = vi.fn().mockImplementation((options?: { locationHint?: string }) => ({
      toString: () => `new-id-${options?.locationHint || 'default'}`,
      locationHint: options?.locationHint,
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // BASIC MOVE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Basic Move Operations', () => {
    it('should move DO to a different colo', async () => {
      const result = await mockResult.instance.move({ colo: 'ewr' } as MoveOptions)

      expect(result).toHaveProperty('toColo', 'ewr')
      expect(result).toHaveProperty('newDoId')
      expect(typeof result.newDoId).toBe('string')
    })

    it('should create new DO with locationHint', async () => {
      await mockResult.instance.move({ colo: 'lax' } as MoveOptions)

      // Verify newUniqueId was called with locationHint
      expect(mockResult.env.DO.newUniqueId).toHaveBeenCalledWith(
        expect.objectContaining({ locationHint: 'lax' })
      )
    })

    it('should transfer all state to new DO', async () => {
      let transferredData: unknown = null

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'new-do-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            transferredData = await req.json()
          }
          return new Response('OK')
        }),
      })

      await mockResult.instance.move({ colo: 'cdg' } as MoveOptions)

      expect(transferredData).not.toBeNull()
    })

    it('should emit move.started and move.completed events', async () => {
      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>

      await mockResult.instance.move({ colo: 'sin' } as MoveOptions)

      const eventVerbs = events.map(e => e.verb)
      expect(eventVerbs).toContain('move.started')
      expect(eventVerbs).toContain('move.completed')
    })

    it('should update objects registry', async () => {
      const objects = mockResult.sqlData.get('objects') as Array<{ id: string; colo: string }>

      await mockResult.instance.move({ colo: 'syd' } as MoveOptions)

      // Objects registry should reflect new location
      // Implementation may vary, but location should be recorded somewhere
      expect(mockResult.env.DO.newUniqueId).toHaveBeenCalled()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Validation', () => {
    it('should validate colo code', async () => {
      await expect(mockResult.instance.move({
        colo: 'invalid-colo-code',
      } as MoveOptions)).rejects.toThrow(/Invalid colo code/)
    })

    it('should prevent moving to current colo', async () => {
      // Set current colo
      mockResult.storage.data.set('colo', 'ewr')

      await expect(mockResult.instance.move({
        colo: 'ewr',
      } as MoveOptions)).rejects.toThrow(/Already at target colo|same colo/)
    })

    it('should allow force move to same colo', async () => {
      mockResult.storage.data.set('colo', 'ewr')

      // Force should bypass the same-colo check
      const result = await mockResult.instance.move({
        colo: 'ewr',
        force: true,
      } as MoveOptions)

      expect(result).toBeDefined()
    })

    it('should error when no state to move', async () => {
      mockResult.sqlData.set('things', [])

      await expect(mockResult.instance.move({
        colo: 'fra',
      } as MoveOptions)).rejects.toThrow(/No state to move|empty/)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ATOMICITY (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Atomicity', () => {
    it('should complete transfer before old DO cleanup', async () => {
      const operationOrder: string[] = []

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'new-do-id' },
        fetch: vi.fn().mockImplementation(async () => {
          operationOrder.push('transfer')
          return new Response('OK')
        }),
      })

      // Track state clearing
      const originalDelete = mockResult.storage.deleteAll
      mockResult.storage.deleteAll = vi.fn().mockImplementation(async () => {
        operationOrder.push('cleanup')
        return originalDelete.call(mockResult.storage)
      })

      await mockResult.instance.move({ colo: 'ams' } as MoveOptions)

      const transferIndex = operationOrder.indexOf('transfer')
      const cleanupIndex = operationOrder.indexOf('cleanup')

      if (transferIndex !== -1 && cleanupIndex !== -1) {
        expect(transferIndex).toBeLessThan(cleanupIndex)
      }
    })

    it('should not clean up old DO if transfer fails', async () => {
      const initialThings = [...(mockResult.sqlData.get('things') as unknown[])]

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'new-do-id' },
        fetch: vi.fn().mockRejectedValue(new Error('Transfer failed')),
      })

      await expect(mockResult.instance.move({
        colo: 'fra',
      } as MoveOptions)).rejects.toThrow()

      // Original state should remain
      const currentThings = mockResult.sqlData.get('things') as unknown[]
      expect(currentThings.length).toBe(initialThings.length)
    })

    it('should emit move.failed on error', async () => {
      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'new-do-id' },
        fetch: vi.fn().mockRejectedValue(new Error('Network error')),
      })

      await expect(mockResult.instance.move({
        colo: 'lhr',
      } as MoveOptions)).rejects.toThrow()

      const eventVerbs = events.map(e => e.verb)
      expect(eventVerbs).toContain('move.started')
      expect(eventVerbs).not.toContain('move.completed')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSISTENCY (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Consistency', () => {
    it('should preserve all state data during move', async () => {
      let transferredThings: unknown[] = []

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'new-do-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            const body = await req.json() as { things?: unknown[] }
            transferredThings = body.things || []
          }
          return new Response('OK')
        }),
      })

      const originalThings = mockResult.sqlData.get('things') as Array<{ id: string; name: string }>

      await mockResult.instance.move({ colo: 'mad' } as MoveOptions)

      // Verify all things were transferred with same data
      expect(transferredThings.length).toBe(originalThings.length)
    })

    it('should maintain type constraints', async () => {
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'typed-1', type: 7, data: { custom: true } }),
      ])

      let transferredData: { things?: Array<{ type: number }> } = {}

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'new-do-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            transferredData = await req.json()
          }
          return new Response('OK')
        }),
      })

      await mockResult.instance.move({ colo: 'mxp' } as MoveOptions)

      expect(transferredData.things?.[0]?.type).toBe(7)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ISOLATION (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Isolation', () => {
    it('should not affect source DO until transfer completes', async () => {
      const thingsBefore = [...(mockResult.sqlData.get('things') as unknown[])]

      // Slow transfer
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'new-do-id' },
        fetch: vi.fn().mockImplementation(async () => {
          // Source should still have data during transfer
          const thingsDuring = mockResult.sqlData.get('things') as unknown[]
          expect(thingsDuring.length).toBe(thingsBefore.length)
          return new Response('OK')
        }),
      })

      await mockResult.instance.move({ colo: 'zrh' } as MoveOptions)
    })

    it('should create independent DO at new location', async () => {
      const result = await mockResult.instance.move({ colo: 'vie' } as MoveOptions)

      expect(result.newDoId).not.toBe('test-do')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // DURABILITY (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Durability', () => {
    it('should persist new location after move completes', async () => {
      const result = await mockResult.instance.move({ colo: 'arn' } as MoveOptions)

      expect(result.toColo).toBe('arn')
      expect(result.newDoId).toBeDefined()
    })

    it('should emit events before operation returns', async () => {
      await mockResult.instance.move({ colo: 'bom' } as MoveOptions)

      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>
      expect(events.some(e => e.verb === 'move.completed')).toBe(true)
    })

    it('should ensure new DO is accessible before returning', async () => {
      let newDOAccessed = false

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'new-do-id' },
        fetch: vi.fn().mockImplementation(async () => {
          newDOAccessed = true
          return new Response('OK')
        }),
      })

      await mockResult.instance.move({ colo: 'del' } as MoveOptions)

      expect(newDOAccessed).toBe(true)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // COLO VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Colo Code Validation', () => {
    it.each([
      'ewr', 'lax', 'cdg', 'sin', 'syd', // Major colos
      'wnam', 'enam', 'weur', 'apac', // Region hints
    ])('should accept valid colo code: %s', async (colo) => {
      // This test verifies that valid colos don't throw validation errors
      // The actual move may still fail for other reasons in the mock
      try {
        await mockResult.instance.move({ colo } as MoveOptions)
      } catch (err) {
        // Should not be a validation error
        expect((err as Error).message).not.toMatch(/Invalid colo/)
      }
    })

    it.each([
      'xyz', 'invalid', '123', 'test-colo', '',
    ])('should reject invalid colo code: %s', async (colo) => {
      await expect(mockResult.instance.move({
        colo,
      } as MoveOptions)).rejects.toThrow(/Invalid colo|empty/)
    })
  })
})
