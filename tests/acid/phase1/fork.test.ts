/**
 * ACID Test Suite - Phase 1: fork() - Create Child DO with Parent Reference
 *
 * RED TDD: These tests define the expected behavior for fork() operation.
 * The fork() operation creates a new DO at target namespace with:
 * - Snapshot of current state (latest version of each thing)
 * - Fresh history (no historical versions)
 * - New identity (different DO ID)
 * - Parent reference maintained
 * - Branch filtering support
 * - Event emission for observability
 *
 * ACID Properties Tested:
 * - Atomicity: All-or-nothing state transfer
 * - Consistency: Valid state invariants maintained
 * - Isolation: Fork doesn't affect source DO
 * - Durability: State persists after fork completes
 *
 * @see objects/DOFull.ts for fork() implementation
 * @see objects/tests/do-lifecycle.test.ts for basic lifecycle tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockDONamespace } from '../../do'
import { DO } from '../../../objects/DO'

// ============================================================================
// TYPE DEFINITIONS FOR FORK API
// ============================================================================

/**
 * Options for the fork() operation
 */
interface ForkOptions {
  /** Target namespace URL for the new DO */
  to: string
  /** Branch to fork from (default: current branch) */
  branch?: string
  /** Location hint for new DO placement */
  colo?: string
  /** Correlation ID for tracing */
  correlationId?: string
}

/**
 * Result of a fork operation
 */
interface ForkResult {
  /** Target namespace URL */
  ns: string
  /** New DO ID */
  doId: string
  /** Number of things forked */
  thingsForked?: number
  /** Duration in ms */
  durationMs?: number
}

/**
 * Fork event types
 */
type ForkEventType =
  | 'fork.started'
  | 'fork.completed'
  | 'fork.failed'

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
  rowid: number
}> = {}) {
  return {
    id: overrides.id ?? 'thing-001',
    type: overrides.type ?? 1,
    branch: overrides.branch ?? null,
    name: overrides.name ?? 'Test Thing',
    data: overrides.data ?? { key: 'value' },
    deleted: overrides.deleted ?? false,
    rowid: overrides.rowid ?? 1,
  }
}

/**
 * Create sample relationship data
 */
function createSampleRelationship(overrides: Partial<{
  id: string
  verb: string
  from: string
  to: string
  data: Record<string, unknown> | null
}> = {}) {
  return {
    id: overrides.id ?? 'rel-001',
    verb: overrides.verb ?? 'relates-to',
    from: overrides.from ?? 'thing-001',
    to: overrides.to ?? 'thing-002',
    data: overrides.data ?? null,
  }
}

// ============================================================================
// FORK OPERATION TESTS
// ============================================================================

describe('ACID Phase 1: fork() - Create Child DO', () => {
  let mockResult: MockDOResult<DO, MockEnv>
  let capturedEvents: Array<{ verb: string; data: unknown }>

  beforeEach(() => {
    capturedEvents = []
    mockResult = createMockDO(DO, {
      id: 'source-do',
      ns: 'https://source.example.com',
    })

    // Set up things in SQLite
    mockResult.sqlData.set('things', [
      createSampleThing({ id: 'customer-1', name: 'Alice', data: { email: 'alice@example.com' } }),
      createSampleThing({ id: 'customer-2', name: 'Bob', data: { email: 'bob@example.com' } }),
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // BASIC FORK OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Basic Fork Operations', () => {
    it('should fork state to a new DO at target namespace', async () => {
      const result = await mockResult.instance.fork({
        to: 'https://fork.example.com',
      })

      expect(result).toHaveProperty('ns', 'https://fork.example.com')
      expect(result).toHaveProperty('doId')
      expect(typeof result.doId).toBe('string')
    })

    it('should preserve latest version of each thing (not history)', async () => {
      // Add multiple versions of the same thing
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'item-1', rowid: 1, data: { version: 1 } }),
        createSampleThing({ id: 'item-1', rowid: 2, data: { version: 2 } }),
        createSampleThing({ id: 'item-1', rowid: 3, data: { version: 3 } }), // Latest
        createSampleThing({ id: 'item-2', rowid: 4, data: { value: 'only-version' } }),
      ])

      const result = await mockResult.instance.fork({
        to: 'https://fork.example.com',
      })

      // Fork should only contain latest versions
      expect(result.thingsForked).toBe(2) // item-1 (v3) and item-2
    })

    it('should filter by branch correctly', async () => {
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'main-1', branch: null, name: 'Main Item' }),
        createSampleThing({ id: 'feature-1', branch: 'feature-x', name: 'Feature Item' }),
        createSampleThing({ id: 'feature-2', branch: 'feature-x', name: 'Feature Item 2' }),
      ])

      const result = await mockResult.instance.fork({
        to: 'https://fork.example.com',
        branch: 'feature-x',
      })

      // Should only fork items from feature-x branch
      expect(result.thingsForked).toBe(2)
    })

    it('should exclude deleted things', async () => {
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'active-1', deleted: false }),
        createSampleThing({ id: 'deleted-1', deleted: true }),
        createSampleThing({ id: 'active-2', deleted: false }),
      ])

      const result = await mockResult.instance.fork({
        to: 'https://fork.example.com',
      })

      // Should only fork non-deleted items
      expect(result.thingsForked).toBe(2)
    })

    it('should emit fork.started and fork.completed events', async () => {
      const events: Array<{ verb: string }> = []
      mockResult.sqlData.set('events', events)

      await mockResult.instance.fork({
        to: 'https://fork.example.com',
      })

      const eventVerbs = events.map(e => e.verb)
      expect(eventVerbs).toContain('fork.started')
      expect(eventVerbs).toContain('fork.completed')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Validation', () => {
    it('should validate target namespace URL', async () => {
      await expect(mockResult.instance.fork({
        to: 'not-a-valid-url',
      })).rejects.toThrow(/Invalid namespace URL/)
    })

    it('should error when no state to fork', async () => {
      mockResult.sqlData.set('things', [])

      await expect(mockResult.instance.fork({
        to: 'https://fork.example.com',
      })).rejects.toThrow(/No state to fork/)
    })

    it('should error when branch does not exist', async () => {
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'main-1', branch: null }),
      ])

      await expect(mockResult.instance.fork({
        to: 'https://fork.example.com',
        branch: 'non-existent-branch',
      })).rejects.toThrow(/Branch .* does not exist|No state to fork/)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ATOMICITY (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Atomicity', () => {
    it('should complete fork fully or not at all', async () => {
      const initialThings = [...(mockResult.sqlData.get('things') as unknown[])]

      // Simulate failure during fork by mocking fetch to fail
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'mock-id' },
        fetch: vi.fn().mockRejectedValue(new Error('Network error')),
      })

      await expect(mockResult.instance.fork({
        to: 'https://fork.example.com',
      })).rejects.toThrow()

      // Source state should be unchanged
      expect(mockResult.sqlData.get('things')).toEqual(initialThings)
    })

    it('should not create partial state on error', async () => {
      // Track what was sent to target DO
      const sentData: unknown[] = []

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'mock-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const body = await req.json()
          sentData.push(body)
          // Fail after receiving first batch
          if (sentData.length > 0) {
            throw new Error('Simulated failure')
          }
          return new Response('OK')
        }),
      })

      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'item-1' }),
        createSampleThing({ id: 'item-2' }),
      ])

      await expect(mockResult.instance.fork({
        to: 'https://fork.example.com',
      })).rejects.toThrow()
    })

    it('should rollback on failure', async () => {
      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'mock-id' },
        fetch: vi.fn().mockRejectedValue(new Error('Network error')),
      })

      await expect(mockResult.instance.fork({
        to: 'https://fork.example.com',
      })).rejects.toThrow()

      // fork.failed should be emitted
      const eventVerbs = events.map(e => e.verb)
      expect(eventVerbs).toContain('fork.started')
      // Either fork.failed or no fork.completed
      expect(eventVerbs).not.toContain('fork.completed')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSISTENCY (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Consistency', () => {
    it('should maintain state invariants after fork', async () => {
      const things = [
        createSampleThing({ id: 'customer-1', data: { email: 'a@b.com' } }),
      ]
      mockResult.sqlData.set('things', things)

      await mockResult.instance.fork({
        to: 'https://fork.example.com',
      })

      // Source should still have valid state
      const sourceThings = mockResult.sqlData.get('things') as unknown[]
      expect(sourceThings).toHaveLength(1)
      expect((sourceThings[0] as { id: string }).id).toBe('customer-1')
    })

    it('should preserve type constraints', async () => {
      const things = [
        createSampleThing({ id: 'typed-1', type: 5, data: { specific: 'value' } }),
      ]
      mockResult.sqlData.set('things', things)

      const result = await mockResult.instance.fork({
        to: 'https://fork.example.com',
      })

      expect(result).toBeDefined()
      // Type information should be preserved in forked DO
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ISOLATION (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Isolation', () => {
    it('should not affect source DO state during fork', async () => {
      const originalThings = [
        createSampleThing({ id: 'item-1', data: { value: 'original' } }),
      ]
      mockResult.sqlData.set('things', [...originalThings])

      await mockResult.instance.fork({
        to: 'https://fork.example.com',
      })

      // Source state should be unchanged
      const currentThings = mockResult.sqlData.get('things') as Array<{ data: { value: string } }>
      expect(currentThings[0]?.data.value).toBe('original')
    })

    it('should create independent state in target DO', async () => {
      const result = await mockResult.instance.fork({
        to: 'https://fork.example.com',
      })

      // Target DO should have its own ID
      expect(result.doId).not.toBe('source-do')
    })

    it('should maintain branch isolation', async () => {
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'main-1', branch: null }),
        createSampleThing({ id: 'feat-1', branch: 'feature' }),
      ])

      await mockResult.instance.fork({
        to: 'https://fork.example.com',
        branch: 'feature',
      })

      // Source main branch should still have its item
      const things = mockResult.sqlData.get('things') as Array<{ branch: string | null }>
      const mainItems = things.filter(t => t.branch === null)
      expect(mainItems).toHaveLength(1)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // DURABILITY (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Durability', () => {
    it('should persist state after fork completes', async () => {
      const result = await mockResult.instance.fork({
        to: 'https://fork.example.com',
      })

      // Fork should complete with valid result
      expect(result.ns).toBe('https://fork.example.com')
      expect(result.doId).toBeDefined()
    })

    it('should emit events before operation returns', async () => {
      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>

      await mockResult.instance.fork({
        to: 'https://fork.example.com',
      })

      // Events should be recorded
      expect(events.some(e => e.verb === 'fork.completed')).toBe(true)
    })

    it('should ensure target DO is initialized before returning', async () => {
      let targetInitialized = false

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async () => {
          targetInitialized = true
          return new Response('OK')
        }),
      })

      await mockResult.instance.fork({
        to: 'https://fork.example.com',
      })

      expect(targetInitialized).toBe(true)
    })
  })
})
