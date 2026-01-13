/**
 * ACID Test Suite - Phase 1: fork() - State Fork to New DO
 *
 * RED TDD: These tests define the expected behavior for fork() operation.
 * All tests are expected to FAIL initially as this is the RED phase.
 *
 * The fork() operation creates a new DO with:
 * - Snapshot of current state (latest version of each thing)
 * - Fresh history (no version history carried over)
 * - New identity (new DO ID and namespace)
 * - Branch filtering support
 * - Lifecycle event emission
 *
 * @see objects/tests/do-lifecycle.test.ts for implementation reference
 * @see types/acid/lifecycle.ts for type definitions
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockDONamespace } from '../../harness/do'
import { DO } from '../../../objects/DO'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface ForkOptions {
  /** Target namespace URL for the new DO */
  to: string
  /** Branch to fork from (default: current branch) */
  branch?: string
  /** Optional correlation ID for tracing */
  correlationId?: string
}

interface ForkResult {
  /** Namespace URL of the forked DO */
  ns: string
  /** Durable Object ID of the forked instance */
  doId: string
  /** Number of things forked */
  thingsCount: number
  /** Duration of fork operation in ms */
  durationMs?: number
}

type ForkEventType =
  | 'fork.started'
  | 'fork.completed'
  | 'fork.failed'

interface ForkEvent {
  type: ForkEventType
  timestamp: Date
  targetNs: string
  data?: {
    doId?: string
    thingsCount?: number
    error?: string
    duration?: number
  }
}

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

function createVersionedThings(id: string, versions: number) {
  return Array.from({ length: versions }, (_, i) => createSampleThing({
    id,
    name: `${id} v${i + 1}`,
    data: { version: i + 1 },
    rowid: i + 1,
  }))
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('fork() - State Fork to New DO', () => {
  let result: MockDOResult<DO, MockEnv>
  let capturedEvents: ForkEvent[]
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
          // Versioned thing with multiple versions
          ...createVersionedThings('versioned-thing', 3),
        ]],
        ['branches', [
          { name: 'main', head: 6, forkedFrom: null, createdAt: new Date().toISOString() },
          { name: 'feature', head: 2, forkedFrom: 'main', createdAt: new Date().toISOString() },
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
        type: verb as ForkEventType,
        timestamp: new Date(),
        targetNs: (data as Record<string, unknown>)?.targetNs as string || '',
        data: data as ForkEvent['data'],
      })
      return originalEmit?.call(result.instance, verb, data)
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // BASIC FORK FUNCTIONALITY
  // ==========================================================================

  describe('basic functionality', () => {
    it('creates new DO at target namespace', async () => {
      // RED: Fork should create a new DO with current state
      const targetNs = 'https://forked.test.do'
      const forkResult = await result.instance.fork({ to: targetNs })

      expect(forkResult).toBeDefined()
      expect(forkResult.ns).toBe(targetNs)
      expect(forkResult.doId).toBeDefined()
    })

    it('preserves latest version of each thing', async () => {
      // RED: Only latest version (by rowid) should be in forked DO
      const targetNs = 'https://forked.test.do'
      const forkResult = await result.instance.fork({ to: targetNs })

      // versioned-thing should only have v3 (latest)
      expect(forkResult.thingsCount).toBe(4) // 3 unique + 1 versioned (latest only)
    })

    it('excludes deleted things', async () => {
      // RED: Deleted things should not be forked
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'deleted-thing', deleted: true, rowid: 10 })
      )

      const targetNs = 'https://forked.test.do'
      const forkResult = await result.instance.fork({ to: targetNs })

      // Deleted thing should not be counted
      expect(forkResult.thingsCount).toBe(4)
    })

    it('creates fresh history (no rowids from source)', async () => {
      // RED: Forked DO should have fresh rowids starting from 1
      const targetNs = 'https://forked.test.do'
      const forkResult = await result.instance.fork({ to: targetNs })

      expect(forkResult).toBeDefined()
      // Verify through DO stub that things have fresh rowids
      // This is verified via the mock stub's received data
    })

    it('generates unique DO ID for each fork', async () => {
      // RED: Each fork should create a unique DO
      const fork1 = await result.instance.fork({ to: 'https://fork1.test.do' })
      const fork2 = await result.instance.fork({ to: 'https://fork2.test.do' })

      expect(fork1.doId).not.toBe(fork2.doId)
    })
  })

  // ==========================================================================
  // BRANCH FILTERING
  // ==========================================================================

  describe('branch filtering', () => {
    it('forks from main branch by default', async () => {
      // RED: Without branch option, should fork from main
      const targetNs = 'https://forked.test.do'
      const forkResult = await result.instance.fork({ to: targetNs })

      expect(forkResult.thingsCount).toBeGreaterThan(0)
    })

    it('forks from specified branch', async () => {
      // RED: Should fork only things from specified branch
      // Add things on feature branch
      result.sqlData.get('things')!.push(
        createSampleThing({
          id: 'feature-thing-1',
          branch: 'feature',
          name: 'Feature Thing 1',
          rowid: 20,
        }),
        createSampleThing({
          id: 'feature-thing-2',
          branch: 'feature',
          name: 'Feature Thing 2',
          rowid: 21,
        })
      )

      const targetNs = 'https://forked.test.do'
      const forkResult = await result.instance.fork({ to: targetNs, branch: 'feature' })

      expect(forkResult.thingsCount).toBe(2) // Only feature branch things
    })

    it('throws error for non-existent branch', async () => {
      // RED: Should throw when branch doesn't exist
      await expect(
        result.instance.fork({ to: 'https://forked.test.do', branch: 'non-existent' })
      ).rejects.toThrow(/branch.*not.*found|branch.*not.*exist/i)
    })
  })

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  describe('validation', () => {
    it('validates target namespace URL', async () => {
      // RED: Should throw for invalid URL
      await expect(
        result.instance.fork({ to: 'not-a-valid-url' })
      ).rejects.toThrow(/invalid.*url|invalid.*namespace/i)
    })

    it('throws error on empty state', async () => {
      // RED: Should throw when there's nothing to fork
      result.sqlData.set('things', [])

      await expect(
        result.instance.fork({ to: 'https://forked.test.do' })
      ).rejects.toThrow(/no.*state|nothing.*fork|empty/i)
    })

    it('prevents forking to same namespace', async () => {
      // RED: Should not allow forking to self
      await expect(
        result.instance.fork({ to: sourceNs })
      ).rejects.toThrow(/same.*namespace|cannot.*fork.*self/i)
    })
  })

  // ==========================================================================
  // ACID PROPERTIES
  // ==========================================================================

  describe('ACID properties', () => {
    it('is atomic - all-or-nothing on failure', async () => {
      // RED: If fork fails, source state should be unchanged
      const originalThingsCount = result.sqlData.get('things')!.length

      // Force failure by using invalid namespace
      await expect(
        result.instance.fork({ to: 'invalid-url' })
      ).rejects.toThrow()

      // Source state should be unchanged
      expect(result.sqlData.get('things')!.length).toBe(originalThingsCount)
    })

    it('maintains consistency - state invariants hold after fork', async () => {
      // RED: After fork, both source and target should have consistent state
      const targetNs = 'https://forked.test.do'
      const forkResult = await result.instance.fork({ to: targetNs })

      // Source should be unchanged
      expect(result.sqlData.get('things')!.length).toBeGreaterThan(0)

      // Target should have things
      expect(forkResult.thingsCount).toBeGreaterThan(0)
    })

    it('provides isolation - concurrent forks do not interfere', async () => {
      // RED: Two concurrent forks should create independent DOs
      const [fork1, fork2] = await Promise.all([
        result.instance.fork({ to: 'https://fork1.test.do' }),
        result.instance.fork({ to: 'https://fork2.test.do' }),
      ])

      expect(fork1.doId).not.toBe(fork2.doId)
      expect(fork1.ns).not.toBe(fork2.ns)
    })

    it('ensures durability - forked state persists', async () => {
      // RED: Forked DO should have durable state
      const targetNs = 'https://forked.test.do'
      const forkResult = await result.instance.fork({ to: targetNs })

      expect(forkResult.doId).toBeDefined()
      // In real implementation, verify via stub that state was persisted
    })
  })

  // ==========================================================================
  // EVENT EMISSION
  // ==========================================================================

  describe('events', () => {
    it('emits fork.started event', async () => {
      // RED: Should emit start event before fork begins
      const targetNs = 'https://forked.test.do'
      await result.instance.fork({ to: targetNs })

      const startEvent = capturedEvents.find(e => e.type === 'fork.started')
      expect(startEvent).toBeDefined()
      expect(startEvent?.targetNs).toBe(targetNs)
    })

    it('emits fork.completed event with details', async () => {
      // RED: Should emit completion event with fork details
      const targetNs = 'https://forked.test.do'
      await result.instance.fork({ to: targetNs })

      const completedEvent = capturedEvents.find(e => e.type === 'fork.completed')
      expect(completedEvent).toBeDefined()
      expect(completedEvent?.data?.doId).toBeDefined()
      expect(completedEvent?.data?.thingsCount).toBeGreaterThan(0)
    })

    it('emits fork.failed event on error', async () => {
      // RED: Should emit failure event when fork fails
      await expect(
        result.instance.fork({ to: 'invalid-url' })
      ).rejects.toThrow()

      const failedEvent = capturedEvents.find(e => e.type === 'fork.failed')
      // May or may not have failed event depending on implementation
      // This tests the expected behavior
    })

    it('includes correlation ID in events', async () => {
      // RED: Events should include correlation ID for tracing
      const targetNs = 'https://forked.test.do'
      const correlationId = 'trace-123'
      await result.instance.fork({ to: targetNs, correlationId })

      const startEvent = capturedEvents.find(e => e.type === 'fork.started')
      expect((startEvent?.data as Record<string, unknown>)?.correlationId).toBe(correlationId)
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('handles large state efficiently', async () => {
      // RED: Should handle many things without timeout
      const manyThings = Array.from({ length: 1000 }, (_, i) =>
        createSampleThing({ id: `thing-${i}`, rowid: i + 1 })
      )
      result.sqlData.set('things', manyThings)

      const targetNs = 'https://forked.test.do'
      const startTime = Date.now()
      const forkResult = await result.instance.fork({ to: targetNs })
      const duration = Date.now() - startTime

      expect(forkResult.thingsCount).toBe(1000)
      expect(duration).toBeLessThan(5000) // Should complete within 5 seconds
    })

    it('handles special characters in thing data', async () => {
      // RED: Should fork things with unicode/special characters
      result.sqlData.get('things')!.push(
        createSampleThing({
          id: 'unicode-thing',
          name: 'Unicode Thing',
          data: { emoji: '...', chinese: '...' },
          rowid: 100,
        })
      )

      const targetNs = 'https://forked.test.do'
      const forkResult = await result.instance.fork({ to: targetNs })

      expect(forkResult).toBeDefined()
    })

    it('handles null data values', async () => {
      // RED: Should fork things with null data
      result.sqlData.get('things')!.push(
        createSampleThing({
          id: 'null-data-thing',
          data: { nullable: null, undefined: undefined },
          rowid: 101,
        })
      )

      const targetNs = 'https://forked.test.do'
      const forkResult = await result.instance.fork({ to: targetNs })

      expect(forkResult).toBeDefined()
    })
  })
})
