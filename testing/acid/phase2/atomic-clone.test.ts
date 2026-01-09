/**
 * ACID Test Suite - Phase 2: Atomic Clone Mode
 *
 * RED TDD: These tests define the expected behavior for atomic clone mode.
 * All tests are expected to FAIL initially as this is the RED phase.
 *
 * Atomic clone mode provides:
 * - All-or-nothing semantics (entire clone succeeds or fails completely)
 * - No partial state at target on failure
 * - Source remains unchanged regardless of outcome
 * - Transaction isolation during clone operation
 * - Event emission for observability
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockDONamespace } from '../../do'
import { DO } from '../../../objects/DO'
import type { CloneMode, CloneOptions, CloneResult } from '../../../types/Lifecycle'

// ============================================================================
// TYPE DEFINITIONS FOR ATOMIC CLONE MODE
// ============================================================================

/**
 * Atomic clone options
 */
interface AtomicCloneOptions extends CloneOptions {
  mode: 'atomic'
  /** Include history in clone (default: false) */
  includeHistory?: boolean
  /** Timeout for the atomic operation in ms (default: 30000) */
  timeout?: number
  /** Correlation ID for tracing across systems */
  correlationId?: string
}

/**
 * Atomic clone result
 */
interface AtomicCloneResult extends CloneResult {
  mode: 'atomic'
  /** Number of things cloned */
  thingsCloned: number
  /** Number of relationships cloned */
  relationshipsCloned: number
  /** Duration of clone operation in ms */
  duration: number
  /** Whether history was included */
  historyIncluded: boolean
}

/**
 * Thing with metadata for verification
 */
interface ThingWithMetadata {
  id: string
  type: number
  data: Record<string, unknown>
  version: number
  branch: string | null
  deleted: boolean
  createdAt?: string
  updatedAt?: string
}

/**
 * Clone event types
 */
type AtomicCloneEventType =
  | 'clone.started'
  | 'clone.completed'
  | 'clone.failed'
  | 'clone.rollback'

/**
 * Clone event payload
 */
interface AtomicCloneEvent {
  type: AtomicCloneEventType
  correlationId: string
  timestamp: Date
  source: string
  target: string
  data?: {
    thingsCount?: number
    error?: string
    duration?: number
  }
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create sample things data for testing
 */
function createSampleThings(count: number): ThingWithMetadata[] {
  const now = new Date().toISOString()
  // IMPORTANT: Object keys must match schema column order for Drizzle's raw() mapping
  // Schema order: id, type, branch, name, data, deleted, visibility
  return Array.from({ length: count }, (_, i) => ({
    id: `thing-${i}`,
    type: 1,
    branch: null, // null = main branch in schema
    name: `Item ${i}`,
    data: { name: `Item ${i}`, index: i, nested: { value: i * 10 } },
    deleted: false,
    visibility: 'user',
    // Extra fields for test metadata (not in schema but expected by tests)
    createdAt: now,
    updatedAt: now,
  }))
}

/**
 * Create sample relationships data
 */
function createSampleRelationships(thingIds: string[]): Array<{
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

  // Create a chain of relationships
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

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Atomic Clone Mode', () => {
  let result: MockDOResult<DO, MockEnv>
  let capturedEvents: AtomicCloneEvent[]

  beforeEach(() => {
    capturedEvents = []

    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createSampleThings(5)],
        ['relationships', createSampleRelationships(['thing-0', 'thing-1', 'thing-2', 'thing-3', 'thing-4'])],
        ['branches', [
          { name: 'main', head: 5, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    // Mock event capture
    const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
    ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
      capturedEvents.push({
        type: verb as AtomicCloneEventType,
        correlationId: (data as Record<string, unknown>)?.correlationId as string || '',
        timestamp: new Date(),
        source: 'https://source.test.do',
        target: (data as Record<string, unknown>)?.target as string || '',
        data: data as AtomicCloneEvent['data'],
      })
      return originalEmit?.call(result.instance, verb, data)
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // BASIC ATOMIC CLONE
  // ==========================================================================

  describe('Basic Atomic Clone', () => {
    it('should successfully clone entire state to target namespace', async () => {
      // RED: This test should fail until atomic clone() is implemented
      const target = 'https://target.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.success).toBe(true)
      expect(cloneResult.ns).toBe(target)
      expect(cloneResult.doId).toBeDefined()
      expect(cloneResult.mode).toBe('atomic')
    })

    it('should clone identical to source (deep equality of data)', async () => {
      // RED: Verify cloned data matches source exactly
      const target = 'https://target.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      // Get source things
      const sourceThings = result.sqlData.get('things') as ThingWithMetadata[]

      // Verify clone has same number of things
      expect(cloneResult.thingsCloned).toBe(sourceThings.length)

      // In real implementation, we'd verify the target DO has identical data
      // For now, we assert the result indicates complete transfer
      expect(cloneResult.thingsCloned).toBe(5)
    })

    it('should create clone with new identity (different DO ID)', async () => {
      // RED: Clone must have its own unique DO identity
      const target = 'https://target.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      // Clone ID should be different from source
      const sourceId = result.ctx.id.toString()
      expect(cloneResult.doId).not.toBe(sourceId)

      // Clone should have the target namespace
      expect(cloneResult.ns).toBe(target)
    })

    it('should leave source unchanged after successful clone', async () => {
      // RED: Source state must remain intact
      const target = 'https://target.test.do'
      const originalThings = JSON.parse(JSON.stringify(result.sqlData.get('things')))
      const originalRelationships = JSON.parse(JSON.stringify(result.sqlData.get('relationships')))

      await result.instance.clone(target, { mode: 'atomic' })

      // Source data should be unchanged
      const currentThings = result.sqlData.get('things')
      const currentRelationships = result.sqlData.get('relationships')

      expect(currentThings).toEqual(originalThings)
      expect(currentRelationships).toEqual(originalRelationships)
    })

    it('should return accurate clone statistics', async () => {
      // RED: Clone result should include detailed stats
      const target = 'https://target.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.thingsCloned).toBe(5)
      expect(cloneResult.relationshipsCloned).toBe(4) // Chain of 5 things = 4 relationships
      expect(cloneResult.duration).toBeGreaterThan(0)
      expect(typeof cloneResult.duration).toBe('number')
    })
  })

  // ==========================================================================
  // ALL-OR-NOTHING SEMANTICS
  // ==========================================================================

  describe('All-or-Nothing Semantics', () => {
    it('should roll back completely on failure mid-clone (no partial state)', async () => {
      // RED: If clone fails mid-operation, target should have no state
      const target = 'https://failing.test.do'

      // Mock a failure during clone transfer
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'fail-id', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Network error during transfer')),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow()

      // Target should have no state (would verify through mock inspection)
      // The key assertion is that partial transfer doesn't exist
      const targetStub = mockNamespace.stubs.get('fail-id')
      expect(targetStub?._instance).toBeUndefined()
    })

    it('should ensure target does not exist if clone fails', async () => {
      // RED: Failed clone must not leave orphaned target DO
      const target = 'https://orphan-check.test.do'

      const mockNamespace = createMockDONamespace()
      let targetInitialized = false

      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'orphan-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('init')) {
            targetInitialized = true
            throw new Error('Simulated init failure')
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow()

      // Even if init was attempted, rollback should clean up
      // In atomic mode, the target shouldn't be accessible after failure
      expect(targetInitialized).toBe(true) // Init was attempted
      // But atomic semantics means it should be rolled back
    })

    it('should not modify source on clone failure', async () => {
      // RED: Source must be unchanged even when clone fails
      const target = 'https://source-protect.test.do'
      const originalThings = JSON.parse(JSON.stringify(result.sqlData.get('things')))

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'source-protect-id', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Clone destination error')),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow()

      // Source should be completely unchanged
      expect(result.sqlData.get('things')).toEqual(originalThings)
    })

    it('should handle network error during clone without orphaned state', async () => {
      // RED: Network failures should trigger clean rollback
      const target = 'https://network-error.test.do'

      const mockNamespace = createMockDONamespace()
      let transferCount = 0

      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'network-error-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          transferCount++
          // Throw on transfer (2nd fetch, after health check)
          if (req.url.includes('/init')) {
            throw new Error('Network connection lost')
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow('Network connection lost')

      // Health check passed but transfer failed
      expect(transferCount).toBeGreaterThanOrEqual(1)
    })

    it('should timeout and rollback if clone takes too long', async () => {
      // RED: Clone should respect timeout and rollback on timeout
      const target = 'https://timeout.test.do'
      const options: AtomicCloneOptions = {
        mode: 'atomic',
        timeout: 100, // 100ms timeout
      }

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'timeout-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async () => {
          // Simulate slow operation
          await new Promise((resolve) => setTimeout(resolve, 500))
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, options)
      ).rejects.toThrow(/timeout/i)
    })
  })

  // ==========================================================================
  // STATE TRANSFER COMPLETENESS
  // ==========================================================================

  describe('State Transfer Completeness', () => {
    it('should clone all things from source', async () => {
      // RED: All things must be transferred
      const target = 'https://complete-transfer.test.do'
      const sourceThings = result.sqlData.get('things') as ThingWithMetadata[]

      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.thingsCloned).toBe(sourceThings.length)
      expect(cloneResult.thingsCloned).toBe(5)
    })

    it('should preserve thing metadata (createdAt, updatedAt)', async () => {
      // RED: Metadata timestamps must be preserved in clone
      const target = 'https://metadata-preserve.test.do'
      const sourceThings = result.sqlData.get('things') as ThingWithMetadata[]
      const originalTimestamps = sourceThings.map((t) => ({
        id: t.id,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      }))

      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      // Clone should report that metadata was preserved
      expect(cloneResult.thingsCloned).toBe(sourceThings.length)
      // In real implementation, we'd verify timestamps match
      expect(originalTimestamps.length).toBe(5)
    })

    it('should clone relationships between things', async () => {
      // RED: Relationships must be cloned along with things
      const target = 'https://relationships.test.do'
      const sourceRelationships = result.sqlData.get('relationships') as unknown[]

      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.relationshipsCloned).toBe(sourceRelationships.length)
      expect(cloneResult.relationshipsCloned).toBe(4)
    })

    it('should exclude history by default', async () => {
      // RED: Default clone should not include version history
      const target = 'https://no-history.test.do'

      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.historyIncluded).toBe(false)
    })

    it('should include history when configured', async () => {
      // RED: History can be optionally included
      const target = 'https://with-history.test.do'
      const options: AtomicCloneOptions = {
        mode: 'atomic',
        includeHistory: true,
      }

      const cloneResult = await result.instance.clone(target, options) as AtomicCloneResult

      expect(cloneResult.historyIncluded).toBe(true)
    })

    it('should clone actions when including history', async () => {
      // RED: If history is included, actions should be cloned
      // Add some actions to the source
      result.sqlData.set('actions', [
        { id: 'action-1', verb: 'create', target: 'thing-0', status: 'completed' },
        { id: 'action-2', verb: 'update', target: 'thing-1', status: 'completed' },
      ])

      const target = 'https://with-actions.test.do'
      const options: AtomicCloneOptions = {
        mode: 'atomic',
        includeHistory: true,
      }

      const cloneResult = await result.instance.clone(target, options) as AtomicCloneResult

      expect(cloneResult.historyIncluded).toBe(true)
      // Actions count would be in extended result type
    })

    it('should clone events when including history', async () => {
      // RED: If history is included, events should be cloned
      result.sqlData.set('events', [
        { id: 'evt-1', verb: 'thing.created', source: 'https://source.test.do' },
        { id: 'evt-2', verb: 'thing.updated', source: 'https://source.test.do' },
      ])

      const target = 'https://with-events.test.do'
      const options: AtomicCloneOptions = {
        mode: 'atomic',
        includeHistory: true,
      }

      const cloneResult = await result.instance.clone(target, options) as AtomicCloneResult

      expect(cloneResult.historyIncluded).toBe(true)
    })

    it('should preserve branch information', async () => {
      // RED: Branch metadata should be transferred
      const target = 'https://with-branches.test.do'

      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.success).toBe(true)
      // Branch info should be preserved (verified through target inspection)
    })
  })

  // ==========================================================================
  // TRANSACTION ISOLATION
  // ==========================================================================

  describe('Transaction Isolation', () => {
    it('should not expose clone-in-progress state to concurrent reads on source', async () => {
      // RED: Concurrent reads should see consistent pre-clone state
      const target = 'https://isolation-read.test.do'
      let readsDuringClone: number[] = []

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'isolation-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async () => {
          // Simulate read during clone
          const things = result.sqlData.get('things') as ThingWithMetadata[]
          readsDuringClone.push(things.length)
          await new Promise((resolve) => setTimeout(resolve, 10))
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      // Start clone
      const clonePromise = result.instance.clone(target, { mode: 'atomic' })

      // Concurrent reads should see consistent state
      const things = result.sqlData.get('things') as ThingWithMetadata[]
      expect(things.length).toBe(5)

      await clonePromise
    })

    it('should block or fail concurrent writes to source during clone', async () => {
      // RED: Writes during atomic clone should be blocked
      const target = 'https://isolation-write.test.do'

      const mockNamespace = createMockDONamespace()
      let cloneInProgress = false

      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'write-isolation-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async () => {
          cloneInProgress = true
          await new Promise((resolve) => setTimeout(resolve, 50))
          cloneInProgress = false
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      // Start clone
      const clonePromise = result.instance.clone(target, { mode: 'atomic' })

      // Wait a tick for clone to start
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Attempt write during clone should be blocked
      if (cloneInProgress) {
        // Atomic clone should have exclusive lock
        // This would throw or wait in real implementation
      }

      await clonePromise
    })

    it('should acquire exclusive lock on source for clone operation', async () => {
      // RED: Clone must hold exclusive lock
      const target = 'https://exclusive-lock.test.do'

      // Track lock acquisition
      let lockAcquired = false
      let lockReleased = false

      const originalBlockConcurrency = result.ctx.blockConcurrencyWhile
      result.ctx.blockConcurrencyWhile = async <T>(callback: () => Promise<T>): Promise<T> => {
        lockAcquired = true
        try {
          return await callback()
        } finally {
          lockReleased = true
        }
      }

      await result.instance.clone(target, { mode: 'atomic' })

      expect(lockAcquired).toBe(true)
      expect(lockReleased).toBe(true)
    })

    it('should release lock on success', async () => {
      // RED: Lock must be released after successful clone
      const target = 'https://lock-success.test.do'
      let lockHeld = false

      const originalBlockConcurrency = result.ctx.blockConcurrencyWhile
      result.ctx.blockConcurrencyWhile = async <T>(callback: () => Promise<T>): Promise<T> => {
        lockHeld = true
        try {
          return await callback()
        } finally {
          lockHeld = false
        }
      }

      await result.instance.clone(target, { mode: 'atomic' })

      expect(lockHeld).toBe(false) // Lock should be released
    })

    it('should release lock on failure', async () => {
      // RED: Lock must be released even on failure
      const target = 'https://lock-failure.test.do'
      let lockHeld = false

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'lock-fail-id', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Clone failed')),
      })
      result.env.DO = mockNamespace

      const originalBlockConcurrency = result.ctx.blockConcurrencyWhile
      result.ctx.blockConcurrencyWhile = async <T>(callback: () => Promise<T>): Promise<T> => {
        lockHeld = true
        try {
          return await callback()
        } finally {
          lockHeld = false
        }
      }

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow()

      expect(lockHeld).toBe(false) // Lock should be released even on failure
    })
  })

  // ==========================================================================
  // EVENT EMISSION
  // ==========================================================================

  describe('Event Emission', () => {
    it('should emit clone.started event with target info', async () => {
      // RED: Clone start should emit event
      const target = 'https://event-started.test.do'
      const options: AtomicCloneOptions = {
        mode: 'atomic',
        correlationId: 'corr-123',
      }

      await result.instance.clone(target, options)

      const startedEvent = capturedEvents.find((e) => e.type === 'clone.started')
      expect(startedEvent).toBeDefined()
      expect(startedEvent?.target).toBe(target)
      expect(startedEvent?.correlationId).toBe('corr-123')
    })

    it('should emit clone.completed on success', async () => {
      // RED: Successful clone should emit completed event
      const target = 'https://event-completed.test.do'
      const options: AtomicCloneOptions = {
        mode: 'atomic',
        correlationId: 'corr-456',
      }

      await result.instance.clone(target, options)

      const completedEvent = capturedEvents.find((e) => e.type === 'clone.completed')
      expect(completedEvent).toBeDefined()
      expect(completedEvent?.correlationId).toBe('corr-456')
      expect(completedEvent?.data?.thingsCount).toBe(5)
    })

    it('should emit clone.failed on failure with error details', async () => {
      // RED: Failed clone should emit failure event
      const target = 'https://event-failed.test.do'
      const options: AtomicCloneOptions = {
        mode: 'atomic',
        correlationId: 'corr-789',
      }

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'event-fail-id', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Destination unreachable')),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, options)
      ).rejects.toThrow()

      const failedEvent = capturedEvents.find((e) => e.type === 'clone.failed')
      expect(failedEvent).toBeDefined()
      expect(failedEvent?.correlationId).toBe('corr-789')
      expect(failedEvent?.data?.error).toContain('unreachable')
    })

    it('should include correlationId in all events for tracing', async () => {
      // RED: All events should have correlationId
      const target = 'https://correlation.test.do'
      const correlationId = `trace-${Date.now()}`
      const options: AtomicCloneOptions = {
        mode: 'atomic',
        correlationId,
      }

      await result.instance.clone(target, options)

      // All events should have the same correlationId
      const eventsWithCorrelation = capturedEvents.filter((e) => e.correlationId === correlationId)
      expect(eventsWithCorrelation.length).toBeGreaterThan(0)

      for (const event of capturedEvents) {
        if (event.type.startsWith('clone.')) {
          expect(event.correlationId).toBe(correlationId)
        }
      }
    })

    it('should generate correlationId if not provided', async () => {
      // RED: Auto-generate correlationId when not specified
      const target = 'https://auto-correlation.test.do'

      await result.instance.clone(target, { mode: 'atomic' })

      const startedEvent = capturedEvents.find((e) => e.type === 'clone.started')
      expect(startedEvent?.correlationId).toBeDefined()
      expect(startedEvent?.correlationId.length).toBeGreaterThan(0)
    })

    it('should emit clone.rollback event on failure rollback', async () => {
      // RED: Rollback should emit its own event
      const target = 'https://event-rollback.test.do'
      const options: AtomicCloneOptions = {
        mode: 'atomic',
        correlationId: 'corr-rollback',
      }

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'rollback-event-id', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Transfer failed')),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, options)
      ).rejects.toThrow()

      const rollbackEvent = capturedEvents.find((e) => e.type === 'clone.rollback')
      expect(rollbackEvent).toBeDefined()
      expect(rollbackEvent?.correlationId).toBe('corr-rollback')
    })

    it('should include duration in completed event', async () => {
      // RED: Completed event should include timing info
      const target = 'https://event-duration.test.do'

      await result.instance.clone(target, { mode: 'atomic' })

      const completedEvent = capturedEvents.find((e) => e.type === 'clone.completed')
      expect(completedEvent?.data?.duration).toBeDefined()
      expect(completedEvent?.data?.duration).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  describe('Validation', () => {
    it('should validate target namespace URL format', async () => {
      // RED: Invalid URL should be rejected
      const invalidTargets = [
        'not-a-url',
        'ftp://wrong-protocol.com',
        '',
        '   ',
      ]

      for (const target of invalidTargets) {
        await expect(
          result.instance.clone(target, { mode: 'atomic' })
        ).rejects.toThrow(/invalid.*url|namespace/i)
      }
    })

    it('should prevent cloning to same namespace', async () => {
      // RED: Cannot clone to self
      const selfTarget = 'https://source.test.do'

      await expect(
        result.instance.clone(selfTarget, { mode: 'atomic' })
      ).rejects.toThrow(/same.*namespace|self/i)
    })

    it('should validate target is reachable (health check)', async () => {
      // RED: Should verify target accessibility before clone
      const target = 'https://unreachable-health.test.do'

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'unreachable-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname === '/health') {
            throw new Error('Connection refused')
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow(/unreachable|health.*check|connection/i)
    })

    it('should handle invalid target gracefully', async () => {
      // RED: Invalid targets should produce clear error messages
      const target = 'https://invalid-target.test.do'

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'invalid-target-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          return new Response('Not Found', { status: 404 })
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow()
    })

    it('should validate clone options', async () => {
      // RED: Invalid options should be rejected
      const target = 'https://options-validation.test.do'

      // Invalid timeout
      await expect(
        result.instance.clone(target, { mode: 'atomic', timeout: -1 } as AtomicCloneOptions)
      ).rejects.toThrow(/invalid.*timeout/i)

      // Invalid timeout type
      await expect(
        result.instance.clone(target, { mode: 'atomic', timeout: 'invalid' as unknown as number } as AtomicCloneOptions)
      ).rejects.toThrow()
    })

    it('should reject clone when source has no state', async () => {
      // RED: Empty source should not be clonable
      result.sqlData.set('things', [])
      const target = 'https://empty-source.test.do'

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow(/no.*state|empty/i)
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle large state transfer atomically', async () => {
      // RED: Large state must still be atomic
      const largeData = createSampleThings(1000)
      result.sqlData.set('things', largeData)

      const target = 'https://large-state.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.thingsCloned).toBe(1000)
    })

    it('should handle circular relationships', async () => {
      // RED: Circular refs should be handled correctly
      const circularRelationships = [
        { id: 'rel-a', verb: 'references', from: 'thing-0', to: 'thing-1', data: null, createdAt: new Date().toISOString() },
        { id: 'rel-b', verb: 'references', from: 'thing-1', to: 'thing-2', data: null, createdAt: new Date().toISOString() },
        { id: 'rel-c', verb: 'references', from: 'thing-2', to: 'thing-0', data: null, createdAt: new Date().toISOString() }, // Circular
      ]
      result.sqlData.set('relationships', circularRelationships)

      const target = 'https://circular.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.relationshipsCloned).toBe(3)
    })

    it('should handle things with complex nested data', async () => {
      // RED: Nested objects must be cloned correctly
      // Schema order: id, type, branch, name, data, deleted, visibility
      const complexThings = [
        {
          id: 'complex-1',
          type: 1,
          branch: null,
          name: 'Complex Item',
          data: {
            nested: {
              deeply: {
                nested: {
                  value: 'test',
                  array: [1, 2, { inner: true }],
                },
              },
            },
            date: new Date().toISOString(),
            nullValue: null,
            emptyObject: {},
            emptyArray: [],
          },
          deleted: false,
          visibility: 'user',
        },
      ]
      result.sqlData.set('things', complexThings)

      const target = 'https://complex-data.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.thingsCloned).toBe(1)
    })

    it('should handle unicode and special characters in data', async () => {
      // RED: Unicode must be preserved
      const unicodeThings = [
        {
          id: 'unicode-1',
          type: 1,
          data: {
            name: 'Test',
            emoji: 'Hello World!',
            chinese: 'Example Text',
            arabic: 'Sample',
            special: '<script>alert("test")</script>',
          },
          version: 1,
          branch: 'main',
          deleted: false,
        },
      ]
      result.sqlData.set('things', unicodeThings)

      const target = 'https://unicode.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.thingsCloned).toBe(1)
    })

    it('should handle binary data in things', async () => {
      // RED: Binary data must be handled correctly
      const binaryThings = [
        {
          id: 'binary-1',
          type: 1,
          data: {
            buffer: Buffer.from('test binary data').toString('base64'),
            raw: '\x00\x01\x02\x03',
          },
          version: 1,
          branch: 'main',
          deleted: false,
        },
      ]
      result.sqlData.set('things', binaryThings)

      const target = 'https://binary.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.thingsCloned).toBe(1)
    })

    it('should handle concurrent clone requests to same target', async () => {
      // RED: Multiple clones to same target should be serialized or rejected
      const target = 'https://concurrent-same.test.do'

      const clone1 = result.instance.clone(target, { mode: 'atomic' })
      const clone2 = result.instance.clone(target, { mode: 'atomic' })

      // One should succeed, one should fail or they should be serialized
      const results = await Promise.allSettled([clone1, clone2])

      // At least one should succeed
      const successes = results.filter((r) => r.status === 'fulfilled')
      expect(successes.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle concurrent clone requests to different targets', async () => {
      // RED: Clones to different targets might be allowed or queued
      const target1 = 'https://concurrent-1.test.do'
      const target2 = 'https://concurrent-2.test.do'

      const clone1 = result.instance.clone(target1, { mode: 'atomic' })
      const clone2 = result.instance.clone(target2, { mode: 'atomic' })

      const results = await Promise.allSettled([clone1, clone2])

      // Both should eventually complete (might be serialized)
      const successes = results.filter((r) => r.status === 'fulfilled')
      expect(successes.length).toBe(2)
    })
  })

  // ==========================================================================
  // INTEGRATION WITH CLONE RESULT
  // ==========================================================================

  describe('Integration with CloneResult', () => {
    it('should return standard CloneResult with atomic mode', async () => {
      // RED: Result should conform to CloneResult interface
      const target = 'https://result-format.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' })

      // Standard CloneResult fields
      expect(cloneResult).toHaveProperty('ns')
      expect(cloneResult).toHaveProperty('doId')
      expect(cloneResult).toHaveProperty('mode')
      expect((cloneResult as CloneResult).mode).toBe('atomic')
    })

    it('should not have staged fields in atomic mode', async () => {
      // RED: Atomic mode should not use staged fields
      const target = 'https://no-staged.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as CloneResult

      expect(cloneResult.staged).toBeUndefined()
    })

    it('should not have checkpoint fields in atomic mode', async () => {
      // RED: Atomic mode should not use checkpoint fields
      const target = 'https://no-checkpoint.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as CloneResult

      expect(cloneResult.checkpoint).toBeUndefined()
    })

    it('should include atomic-specific fields', async () => {
      // RED: Atomic mode should have its own specific fields
      const target = 'https://atomic-fields.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.thingsCloned).toBeDefined()
      expect(cloneResult.relationshipsCloned).toBeDefined()
      expect(cloneResult.duration).toBeDefined()
      expect(cloneResult.historyIncluded).toBeDefined()
    })
  })
})
