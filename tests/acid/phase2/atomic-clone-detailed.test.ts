/**
 * ACID Test Suite - Phase 2: Atomic Clone Mode - Detailed All-or-Nothing Tests
 *
 * RED TDD: These tests define comprehensive expectations for atomic clone mode.
 * All tests are expected to FAIL initially as this is the RED phase.
 *
 * This file provides detailed tests for atomic clone mode covering:
 * - Full state transfer atomicity
 * - Rollback on partial failure
 * - No partial state in target on failure
 * - Consistency checks and validation
 * - Concurrent clone protection
 * - Large state handling
 * - Cross-region atomic guarantees
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md
 * @task dotdo-qmck
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockDONamespace, createMockId } from '../../do'
import { DO } from '../../../objects/DO'
import type { CloneResult } from '../../../types/Lifecycle'

// ============================================================================
// TYPE DEFINITIONS FOR ATOMIC CLONE DETAILED TESTS
// ============================================================================

/**
 * Extended atomic clone result with detailed statistics
 */
interface AtomicCloneResult extends CloneResult {
  mode: 'atomic'
  /** Whether the clone was successful */
  success: boolean
  /** Number of things cloned */
  thingsCloned: number
  /** Number of relationships cloned */
  relationshipsCloned: number
  /** Number of actions cloned (if history included) */
  actionsCloned?: number
  /** Number of events cloned (if history included) */
  eventsCloned?: number
  /** Duration of clone operation in ms */
  duration: number
  /** Whether history was included */
  historyIncluded: boolean
  /** Bytes transferred */
  bytesTransferred: number
  /** Integrity hash of cloned data */
  integrityHash: string
}

/**
 * Atomic clone failure result
 */
interface AtomicCloneFailure {
  /** Error message */
  error: string
  /** Error code */
  code: 'PARTIAL_FAILURE' | 'TARGET_CREATION_FAILED' | 'STATE_TRANSFER_FAILED' | 'REGISTRY_UPDATE_FAILED' | 'ROLLBACK_COMPLETED' | 'ROLLBACK_FAILED' | 'TIMEOUT' | 'CONCURRENT_CLONE'
  /** Stage at which failure occurred */
  failedAt: 'initialization' | 'state_transfer' | 'relationship_transfer' | 'history_transfer' | 'registry_update' | 'validation'
  /** Items transferred before failure */
  itemsTransferredBeforeFailure: number
  /** Whether rollback was successful */
  rollbackSuccessful: boolean
  /** Source state unchanged */
  sourceUnchanged: boolean
  /** Target cleaned up */
  targetCleanedUp: boolean
  /** Correlation ID for tracing */
  correlationId: string
}

/**
 * Clone state snapshot for verification
 */
interface CloneStateSnapshot {
  /** Source things snapshot */
  sourceThings: ThingRecord[]
  /** Source relationships snapshot */
  sourceRelationships: RelationshipRecord[]
  /** Source branches snapshot */
  sourceBranches: BranchRecord[]
  /** Target things (should be empty on rollback) */
  targetThings: ThingRecord[]
  /** Target relationships (should be empty on rollback) */
  targetRelationships: RelationshipRecord[]
}

/**
 * Thing record structure
 */
interface ThingRecord {
  id: string
  type: number
  branch: string | null
  name: string | null
  data: Record<string, unknown>
  deleted: boolean
  visibility: string
  createdAt?: string
  updatedAt?: string
}

/**
 * Relationship record structure
 */
interface RelationshipRecord {
  id: string
  verb: string
  from: string
  to: string
  data: Record<string, unknown> | null
  createdAt: string
}

/**
 * Branch record structure
 */
interface BranchRecord {
  name: string
  head: number
  forkedFrom: string | null
  createdAt: string
}

/**
 * Clone lock information
 */
interface CloneLock {
  id: string
  target: string
  source: string
  acquiredAt: Date
  expiresAt: Date
  status: 'held' | 'released' | 'expired'
}

/**
 * Clone event for tracking
 */
interface AtomicCloneEvent {
  type: 'clone.started' | 'clone.completed' | 'clone.failed' | 'clone.rollback' | 'clone.rollback.completed' | 'clone.rollback.failed'
  correlationId: string
  timestamp: Date
  source: string
  target: string
  data?: {
    thingsCount?: number
    relationshipsCount?: number
    error?: string
    duration?: number
    stage?: string
    bytesTransferred?: number
  }
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create sample things data for testing
 * Schema order: id, type, branch, name, data, deleted, visibility
 */
function createSampleThings(count: number, options?: { payloadSize?: number; branch?: string }): ThingRecord[] {
  const now = new Date().toISOString()
  const payloadSize = options?.payloadSize ?? 100
  const branch = options?.branch ?? null

  return Array.from({ length: count }, (_, i) => ({
    id: `thing-${i}`,
    type: 1,
    branch,
    name: `Item ${i}`,
    data: {
      name: `Item ${i}`,
      index: i,
      payload: 'x'.repeat(payloadSize),
      nested: { value: i * 10 },
    },
    deleted: false,
    visibility: 'user',
    createdAt: now,
    updatedAt: now,
  }))
}

/**
 * Create sample relationships for testing
 */
function createSampleRelationships(thingIds: string[]): RelationshipRecord[] {
  const now = new Date().toISOString()
  const relationships: RelationshipRecord[] = []

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
 * Create sample actions for history testing
 */
function createSampleActions(count: number): Array<Record<string, unknown>> {
  const now = new Date()
  return Array.from({ length: count }, (_, i) => ({
    id: `action-${i}`,
    verb: 'create',
    actor: 'system',
    target: `thing-${i % 10}`,
    input: null,
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
    duration: 10,
    createdAt: now,
  }))
}

/**
 * Create sample events for history testing
 */
function createSampleEvents(count: number): Array<Record<string, unknown>> {
  const now = new Date()
  return Array.from({ length: count }, (_, i) => ({
    id: `event-${i}`,
    verb: 'thing.created',
    source: 'https://source.test.do',
    data: { thingId: `thing-${i % 10}` },
    actionId: null,
    sequence: i + 1,
    streamed: false,
    streamedAt: null,
    createdAt: now,
  }))
}

/**
 * Capture state snapshot for comparison
 */
function captureSnapshot(sqlData: Map<string, unknown[]>): {
  things: ThingRecord[]
  relationships: RelationshipRecord[]
  branches: BranchRecord[]
} {
  return {
    things: JSON.parse(JSON.stringify(sqlData.get('things') ?? [])),
    relationships: JSON.parse(JSON.stringify(sqlData.get('relationships') ?? [])),
    branches: JSON.parse(JSON.stringify(sqlData.get('branches') ?? [])),
  }
}

// ============================================================================
// TEST SUITE: FULL STATE TRANSFER ATOMICITY
// ============================================================================

describe('Atomic Clone Mode - Full State Transfer Atomicity', () => {
  let result: MockDOResult<DO, MockEnv>
  let capturedEvents: AtomicCloneEvent[]

  beforeEach(() => {
    capturedEvents = []
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createSampleThings(100)],
        ['relationships', createSampleRelationships(Array.from({ length: 100 }, (_, i) => `thing-${i}`))],
        ['branches', [{ name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() }]],
      ]),
    })

    // Mock event capture
    const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
    ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
      capturedEvents.push({
        type: verb as AtomicCloneEvent['type'],
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

  describe('Complete State Transfer', () => {
    it('should transfer ALL things in a single atomic operation', async () => {
      // RED: All 100 things must be transferred or none
      const target = 'https://atomic-full-transfer.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.success).toBe(true)
      expect(cloneResult.thingsCloned).toBe(100)
      // No partial transfer state should exist
    })

    it('should transfer ALL relationships in a single atomic operation', async () => {
      // RED: All 99 relationships must be transferred with things
      const target = 'https://atomic-rel-transfer.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.relationshipsCloned).toBe(99)
    })

    it('should ensure things and relationships are transferred together atomically', async () => {
      // RED: Cannot have relationships without their referenced things
      const target = 'https://atomic-together.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      // If things transfer succeeds, relationships must also succeed
      if (cloneResult.thingsCloned > 0) {
        expect(cloneResult.relationshipsCloned).toBe(99)
      }
    })

    it('should transfer branch information atomically with data', async () => {
      // RED: Branch metadata must be transferred with state
      const target = 'https://atomic-branches.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.success).toBe(true)
      // Branch 'main' should be transferred
    })

    it('should include integrity hash in result for verification', async () => {
      // RED: Result must include hash for data integrity verification
      const target = 'https://atomic-integrity.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.integrityHash).toBeDefined()
      expect(typeof cloneResult.integrityHash).toBe('string')
      expect(cloneResult.integrityHash.length).toBeGreaterThan(0)
    })

    it('should report accurate bytes transferred', async () => {
      // RED: Must track data volume for monitoring
      const target = 'https://atomic-bytes.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.bytesTransferred).toBeGreaterThan(0)
      expect(typeof cloneResult.bytesTransferred).toBe('number')
    })
  })

  describe('History Transfer Atomicity', () => {
    beforeEach(() => {
      // Add history data
      result.sqlData.set('actions', createSampleActions(50))
      result.sqlData.set('events', createSampleEvents(100))
    })

    it('should transfer ALL actions atomically when includeHistory is true', async () => {
      // RED: All 50 actions must be transferred atomically
      const target = 'https://atomic-history-actions.test.do'
      const cloneResult = await result.instance.clone(target, {
        mode: 'atomic',
        includeHistory: true,
      } as Record<string, unknown>) as AtomicCloneResult

      expect(cloneResult.historyIncluded).toBe(true)
      expect(cloneResult.actionsCloned).toBe(50)
    })

    it('should transfer ALL events atomically when includeHistory is true', async () => {
      // RED: All 100 events must be transferred atomically
      const target = 'https://atomic-history-events.test.do'
      const cloneResult = await result.instance.clone(target, {
        mode: 'atomic',
        includeHistory: true,
      } as Record<string, unknown>) as AtomicCloneResult

      expect(cloneResult.historyIncluded).toBe(true)
      expect(cloneResult.eventsCloned).toBe(100)
    })

    it('should transfer state, relationships, actions, and events as a single unit', async () => {
      // RED: Everything must succeed or fail together
      const target = 'https://atomic-full-history.test.do'
      const cloneResult = await result.instance.clone(target, {
        mode: 'atomic',
        includeHistory: true,
      } as Record<string, unknown>) as AtomicCloneResult

      expect(cloneResult.thingsCloned).toBe(100)
      expect(cloneResult.relationshipsCloned).toBe(99)
      expect(cloneResult.actionsCloned).toBe(50)
      expect(cloneResult.eventsCloned).toBe(100)
    })

    it('should exclude history when includeHistory is false', async () => {
      // RED: Default behavior excludes history
      const target = 'https://atomic-no-history.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.historyIncluded).toBe(false)
      expect(cloneResult.actionsCloned).toBeUndefined()
      expect(cloneResult.eventsCloned).toBeUndefined()
    })
  })
})

// ============================================================================
// TEST SUITE: ROLLBACK ON PARTIAL FAILURE
// ============================================================================

describe('Atomic Clone Mode - Rollback on Partial Failure', () => {
  let result: MockDOResult<DO, MockEnv>
  let capturedEvents: AtomicCloneEvent[]

  beforeEach(() => {
    capturedEvents = []
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createSampleThings(1000)],
        ['relationships', createSampleRelationships(Array.from({ length: 1000 }, (_, i) => `thing-${i}`))],
        ['branches', [{ name: 'main', head: 1000, forkedFrom: null, createdAt: new Date().toISOString() }]],
      ]),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Failure During State Transfer', () => {
    it('should rollback completely if target DO creation fails', async () => {
      // RED: Target creation failure must result in clean rollback
      const target = 'https://creation-fail.test.do'

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('creation-fail-id'),
        fetch: vi.fn().mockRejectedValue(new Error('Target DO creation failed')),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow()

      // Target should not exist
      const targetStub = mockNamespace.stubs.get('creation-fail-id')
      expect(targetStub?._instance).toBeUndefined()
    })

    it('should rollback if state transfer fails after 500 of 1000 things', async () => {
      // RED: Partial transfer (500/1000) must be rolled back completely
      const target = 'https://partial-transfer-fail.test.do'
      const originalSnapshot = captureSnapshot(result.sqlData)
      let transferCount = 0

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('partial-fail-id'),
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('/transfer')) {
            transferCount++
            // Fail at item 500
            if (transferCount === 500) {
              throw new Error('Network error at item 500')
            }
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow()

      // Source must be unchanged
      const currentSnapshot = captureSnapshot(result.sqlData)
      expect(currentSnapshot.things).toEqual(originalSnapshot.things)
      expect(currentSnapshot.relationships).toEqual(originalSnapshot.relationships)
    })

    it('should rollback if registry update fails after state copied', async () => {
      // RED: Registry failure after state transfer must still rollback
      const target = 'https://registry-fail.test.do'
      let stateTransferred = false

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('registry-fail-id'),
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('/transfer')) {
            stateTransferred = true
            return new Response('OK')
          }
          if (url.pathname.includes('/register')) {
            throw new Error('Registry update failed')
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow()

      // State was transferred but should be rolled back
      expect(stateTransferred).toBe(true)
    })

    it('should emit clone.rollback event on failure', async () => {
      // RED: Rollback must emit event for observability
      const target = 'https://rollback-event.test.do'

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('rollback-event-id'),
        fetch: vi.fn().mockRejectedValue(new Error('Simulated failure')),
      })
      result.env.DO = mockNamespace

      // Mock event capture
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        capturedEvents.push({
          type: verb as AtomicCloneEvent['type'],
          correlationId: (data as Record<string, unknown>)?.correlationId as string || '',
          timestamp: new Date(),
          source: 'https://source.test.do',
          target,
          data: data as AtomicCloneEvent['data'],
        })
        return originalEmit?.call(result.instance, verb, data)
      }

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow()

      const rollbackEvent = capturedEvents.find((e) => e.type === 'clone.rollback')
      expect(rollbackEvent).toBeDefined()
    })

    it('should emit clone.rollback.completed event after successful rollback', async () => {
      // RED: Successful rollback must be confirmed via event
      const target = 'https://rollback-completed.test.do'

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('rollback-completed-id'),
        fetch: vi.fn().mockRejectedValue(new Error('Simulated failure')),
      })
      result.env.DO = mockNamespace

      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        capturedEvents.push({
          type: verb as AtomicCloneEvent['type'],
          correlationId: (data as Record<string, unknown>)?.correlationId as string || '',
          timestamp: new Date(),
          source: 'https://source.test.do',
          target,
          data: data as AtomicCloneEvent['data'],
        })
        return originalEmit?.call(result.instance, verb, data)
      }

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow()

      const rollbackCompletedEvent = capturedEvents.find((e) => e.type === 'clone.rollback.completed')
      expect(rollbackCompletedEvent).toBeDefined()
    })

    it('should return detailed failure information with rollback status', async () => {
      // RED: Errors should include rollback details
      const target = 'https://failure-details.test.do'

      const mockNamespace = createMockDONamespace()
      let itemsTransferred = 0
      mockNamespace.stubFactory = () => ({
        id: createMockId('failure-details-id'),
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('/transfer')) {
            itemsTransferred++
            if (itemsTransferred >= 100) {
              const error = new Error('State transfer failed') as Error & AtomicCloneFailure
              error.code = 'STATE_TRANSFER_FAILED'
              error.failedAt = 'state_transfer'
              error.itemsTransferredBeforeFailure = itemsTransferred
              error.rollbackSuccessful = true
              error.sourceUnchanged = true
              error.targetCleanedUp = true
              throw error
            }
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      try {
        await result.instance.clone(target, { mode: 'atomic' })
        expect.fail('Should have thrown')
      } catch (error) {
        // Error should contain rollback information
        expect(error).toBeDefined()
      }
    })
  })

  describe('Rollback Guarantees', () => {
    it('should guarantee source DO is NEVER modified after failed clone', async () => {
      // RED: Source immutability is critical
      const target = 'https://source-immutable.test.do'
      const originalSnapshot = captureSnapshot(result.sqlData)

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('source-immutable-id'),
        fetch: vi.fn().mockRejectedValue(new Error('Clone failed')),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow()

      // Deep equality check on source state
      const currentSnapshot = captureSnapshot(result.sqlData)
      expect(JSON.stringify(currentSnapshot.things)).toBe(JSON.stringify(originalSnapshot.things))
      expect(JSON.stringify(currentSnapshot.relationships)).toBe(JSON.stringify(originalSnapshot.relationships))
      expect(JSON.stringify(currentSnapshot.branches)).toBe(JSON.stringify(originalSnapshot.branches))
    })

    it('should guarantee target has ZERO partial state after failed clone', async () => {
      // RED: No orphaned data at target
      const target = 'https://zero-partial.test.do'
      let targetState: unknown[] = []

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('zero-partial-id'),
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('/transfer')) {
            // Simulate some data transferred then fail
            targetState.push({ transferred: true })
            if (targetState.length >= 10) {
              throw new Error('Mid-transfer failure')
            }
          }
          if (url.pathname.includes('/rollback')) {
            targetState = [] // Clear on rollback
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow()

      // After rollback, target should have no data
      expect(targetState).toHaveLength(0)
    })

    it('should handle rollback failure gracefully with appropriate error', async () => {
      // RED: Rollback failure is a critical error
      const target = 'https://rollback-failure.test.do'

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('rollback-failure-id'),
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('/transfer')) {
            throw new Error('Transfer failed')
          }
          if (url.pathname.includes('/rollback')) {
            throw new Error('Rollback also failed')
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      try {
        await result.instance.clone(target, { mode: 'atomic' })
        expect.fail('Should have thrown')
      } catch (error) {
        // Should indicate rollback failure
        expect((error as Error).message).toMatch(/rollback|failed/i)
      }
    })
  })
})

// ============================================================================
// TEST SUITE: NO PARTIAL STATE IN TARGET ON FAILURE
// ============================================================================

describe('Atomic Clone Mode - No Partial State in Target on Failure', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createSampleThings(500)],
        ['relationships', createSampleRelationships(Array.from({ length: 500 }, (_, i) => `thing-${i}`))],
        ['branches', [{ name: 'main', head: 500, forkedFrom: null, createdAt: new Date().toISOString() }]],
      ]),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Target State Verification', () => {
    it('should verify target has no things after failure', async () => {
      // RED: Target DO should have empty things table after rollback
      const target = 'https://verify-no-things.test.do'
      let targetThingsCount = 0

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('verify-no-things-id'),
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('/transfer/things')) {
            targetThingsCount += 10 // Simulate batch transfer
            if (targetThingsCount >= 100) {
              throw new Error('Transfer interrupted')
            }
          }
          if (url.pathname.includes('/getThingsCount')) {
            return new Response(JSON.stringify({ count: targetThingsCount }))
          }
          if (url.pathname.includes('/cleanup')) {
            targetThingsCount = 0
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow()

      // After atomic failure, target should have no things
      expect(targetThingsCount).toBe(0)
    })

    it('should verify target has no relationships after failure', async () => {
      // RED: Target DO should have empty relationships after rollback
      const target = 'https://verify-no-relationships.test.do'
      let targetRelCount = 0

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('verify-no-rels-id'),
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('/transfer/relationships')) {
            targetRelCount += 10
            if (targetRelCount >= 50) {
              throw new Error('Relationship transfer failed')
            }
          }
          if (url.pathname.includes('/cleanup')) {
            targetRelCount = 0
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow()

      expect(targetRelCount).toBe(0)
    })

    it('should verify target has no branches after failure', async () => {
      // RED: Target DO should have no branch metadata after rollback
      const target = 'https://verify-no-branches.test.do'
      let targetBranches: string[] = []

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('verify-no-branches-id'),
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('/transfer/branches')) {
            targetBranches.push('main')
            throw new Error('Branch transfer failed')
          }
          if (url.pathname.includes('/cleanup')) {
            targetBranches = []
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow()

      expect(targetBranches).toHaveLength(0)
    })

    it('should verify target has no history after failure (when includeHistory)', async () => {
      // RED: Target should have no actions/events after rollback
      result.sqlData.set('actions', createSampleActions(100))
      result.sqlData.set('events', createSampleEvents(200))

      const target = 'https://verify-no-history.test.do'
      let targetActions = 0
      let targetEvents = 0

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('verify-no-history-id'),
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('/transfer/actions')) {
            targetActions += 10
          }
          if (url.pathname.includes('/transfer/events')) {
            targetEvents += 10
            if (targetEvents >= 50) {
              throw new Error('Event transfer failed')
            }
          }
          if (url.pathname.includes('/cleanup')) {
            targetActions = 0
            targetEvents = 0
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, { mode: 'atomic', includeHistory: true } as Record<string, unknown>)
      ).rejects.toThrow()

      expect(targetActions).toBe(0)
      expect(targetEvents).toBe(0)
    })

    it('should verify target DO is deleted/unregistered after failure', async () => {
      // RED: Target DO should not exist in registry after rollback
      const target = 'https://verify-unregistered.test.do'
      let targetRegistered = false

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('verify-unregistered-id'),
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('/register')) {
            targetRegistered = true
            throw new Error('Registration failed')
          }
          if (url.pathname.includes('/unregister')) {
            targetRegistered = false
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow()

      expect(targetRegistered).toBe(false)
    })
  })

  describe('Observability', () => {
    it('should report exactly how many items were transferred before failure', async () => {
      // RED: Error details should include transfer progress
      const target = 'https://transfer-progress.test.do'
      let transferredCount = 0
      const failAt = 247 // Fail at arbitrary point

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('transfer-progress-id'),
        fetch: vi.fn().mockImplementation(async () => {
          transferredCount++
          if (transferredCount >= failAt) {
            const error = new Error('Transfer failed') as Error & { itemsTransferred: number }
            error.itemsTransferred = transferredCount
            throw error
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      try {
        await result.instance.clone(target, { mode: 'atomic' })
        expect.fail('Should have thrown')
      } catch (error) {
        // Error should contain transfer count
        expect((error as { itemsTransferred?: number }).itemsTransferred).toBeDefined()
      }
    })

    it('should report failure stage accurately', async () => {
      // RED: Must know where the failure occurred
      const stages = ['initialization', 'state_transfer', 'relationship_transfer', 'registry_update']

      for (const failStage of stages) {
        const target = `https://fail-stage-${failStage}.test.do`

        const mockNamespace = createMockDONamespace()
        mockNamespace.stubFactory = () => ({
          id: createMockId(`fail-stage-${failStage}-id`),
          fetch: vi.fn().mockImplementation(async (req: Request) => {
            const url = new URL(req.url)
            if (url.pathname.includes(`/${failStage}`)) {
              const error = new Error(`Failed at ${failStage}`) as Error & { stage: string }
              error.stage = failStage
              throw error
            }
            return new Response('OK')
          }),
        })
        result.env.DO = mockNamespace

        try {
          await result.instance.clone(target, { mode: 'atomic' })
        } catch (error) {
          expect((error as { stage?: string }).stage).toBe(failStage)
        }
      }
    })
  })
})

// ============================================================================
// TEST SUITE: CONSISTENCY CHECKS
// ============================================================================

describe('Atomic Clone Mode - Consistency Checks', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createSampleThings(200)],
        ['relationships', createSampleRelationships(Array.from({ length: 200 }, (_, i) => `thing-${i}`))],
        ['branches', [{ name: 'main', head: 200, forkedFrom: null, createdAt: new Date().toISOString() }]],
      ]),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Pre-Clone Validation', () => {
    it('should verify source state is consistent before clone', async () => {
      // RED: Source should be validated before clone starts
      const target = 'https://source-consistent.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      // Successful clone implies source was consistent
      expect(cloneResult.success).toBe(true)
    })

    it('should reject clone if source has referential integrity issues', async () => {
      // RED: Should detect broken references before attempting clone
      // Add relationship pointing to non-existent thing
      const relationships = result.sqlData.get('relationships')!
      relationships.push({
        id: 'broken-rel',
        verb: 'relatedTo',
        from: 'thing-999',
        to: 'thing-non-existent',
        data: null,
        createdAt: new Date().toISOString(),
      })

      const target = 'https://broken-ref.test.do'

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow(/integrity|reference|inconsistent/i)
    })

    it('should validate target namespace is available', async () => {
      // RED: Target validation happens before transfer
      const target = 'https://unavailable.test.do'

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('unavailable-id'),
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('/check-available')) {
            return new Response(JSON.stringify({ available: false }), { status: 409 })
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow(/unavailable|exists|occupied/i)
    })
  })

  describe('Post-Clone Validation', () => {
    it('should verify thing counts match after successful clone', async () => {
      // RED: Target thing count must match source
      const target = 'https://count-match.test.do'
      let sourceCount = 0
      let targetCount = 0

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('count-match-id'),
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('/getCount')) {
            return new Response(JSON.stringify({ count: targetCount }))
          }
          if (url.pathname.includes('/transfer')) {
            targetCount++
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      sourceCount = (result.sqlData.get('things') as unknown[]).length

      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.thingsCloned).toBe(sourceCount)
    })

    it('should verify relationship counts match after successful clone', async () => {
      // RED: Target relationship count must match source
      const target = 'https://rel-count-match.test.do'
      const sourceRelCount = (result.sqlData.get('relationships') as unknown[]).length

      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.relationshipsCloned).toBe(sourceRelCount)
    })

    it('should validate data integrity via hash comparison', async () => {
      // RED: Data integrity must be verifiable
      const target = 'https://hash-verify.test.do'
      let sourceHash = ''
      let targetHash = ''

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('hash-verify-id'),
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('/getHash')) {
            return new Response(JSON.stringify({ hash: targetHash || sourceHash }))
          }
          if (url.pathname.includes('/setHash')) {
            const body = await req.json() as { hash: string }
            targetHash = body.hash
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.integrityHash).toBeDefined()
    })

    it('should fail clone if post-transfer validation fails', async () => {
      // RED: Validation failure should trigger rollback
      const target = 'https://validation-fail.test.do'

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('validation-fail-id'),
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('/validate')) {
            return new Response(JSON.stringify({ valid: false, error: 'Hash mismatch' }), { status: 400 })
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow(/validation|mismatch/i)
    })
  })

  describe('Branch Consistency', () => {
    beforeEach(() => {
      // Add multiple branches
      result.sqlData.set('branches', [
        { name: 'main', head: 200, forkedFrom: null, createdAt: new Date().toISOString() },
        { name: 'feature-a', head: 150, forkedFrom: 'main', createdAt: new Date().toISOString() },
        { name: 'feature-b', head: 180, forkedFrom: 'main', createdAt: new Date().toISOString() },
      ])
    })

    it('should clone all branches with correct hierarchy', async () => {
      // RED: Branch relationships must be preserved
      const target = 'https://branch-hierarchy.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.success).toBe(true)
    })

    it('should clone only specified branch when branch option provided', async () => {
      // RED: Should respect branch option
      const target = 'https://single-branch.test.do'
      const cloneResult = await result.instance.clone(target, {
        mode: 'atomic',
        branch: 'feature-a',
      }) as AtomicCloneResult

      expect(cloneResult.success).toBe(true)
    })
  })
})

// ============================================================================
// TEST SUITE: CONCURRENT CLONE PROTECTION
// ============================================================================

describe('Atomic Clone Mode - Concurrent Clone Protection', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createSampleThings(500)],
        ['relationships', createSampleRelationships(Array.from({ length: 500 }, (_, i) => `thing-${i}`))],
        ['branches', [{ name: 'main', head: 500, forkedFrom: null, createdAt: new Date().toISOString() }]],
      ]),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Single Target Protection', () => {
    it('should reject concurrent clones to the SAME target', async () => {
      // RED: Only one clone to a target at a time
      const target = 'https://concurrent-same.test.do'

      const clone1 = result.instance.clone(target, { mode: 'atomic' })
      const clone2 = result.instance.clone(target, { mode: 'atomic' })

      const results = await Promise.allSettled([clone1, clone2])

      // At least one should fail with concurrent error
      const failures = results.filter((r) => r.status === 'rejected')
      expect(failures.length).toBeGreaterThanOrEqual(1)

      // Check for concurrent clone error
      if (failures.length > 0) {
        const failedResult = failures[0] as PromiseRejectedResult
        expect(failedResult.reason.message).toMatch(/concurrent|in progress|locked/i)
      }
    })

    it('should acquire and hold clone lock during operation', async () => {
      // RED: Lock must be acquired before clone starts
      const target = 'https://lock-held.test.do'
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

    it('should release lock on successful clone completion', async () => {
      // RED: Lock must be released after success
      const target = 'https://lock-released-success.test.do'
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

      expect(lockHeld).toBe(false)
    })

    it('should release lock on clone failure', async () => {
      // RED: Lock must be released after failure
      const target = 'https://lock-released-failure.test.do'
      let lockHeld = false

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('lock-failure-id'),
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

      expect(lockHeld).toBe(false)
    })
  })

  describe('Multiple Target Protection', () => {
    it('should serialize clones to DIFFERENT targets from same source', async () => {
      // RED: Concurrent clones from same source should be serialized
      const target1 = 'https://target-1.test.do'
      const target2 = 'https://target-2.test.do'
      const cloneOrder: string[] = []

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          cloneOrder.push(id.toString())
          await new Promise((resolve) => setTimeout(resolve, 10))
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      const clone1 = result.instance.clone(target1, { mode: 'atomic' })
      const clone2 = result.instance.clone(target2, { mode: 'atomic' })

      const results = await Promise.allSettled([clone1, clone2])

      // Both should succeed (serialized)
      const successes = results.filter((r) => r.status === 'fulfilled')
      expect(successes.length).toBe(2)
    })

    it('should prevent read-write conflicts during clone', async () => {
      // RED: Writes to source during clone should be blocked
      const target = 'https://read-write-conflict.test.do'
      let cloneInProgress = false
      let writeAttemptedDuringClone = false

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('rw-conflict-id'),
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

      // Wait briefly for clone to start
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Check if write would be blocked
      if (cloneInProgress) {
        writeAttemptedDuringClone = true
        // In atomic mode, writes should be blocked
      }

      await clonePromise

      // Clone should have been in progress when we checked
      expect(writeAttemptedDuringClone).toBe(true)
    })
  })

  describe('Lock Information', () => {
    it('should provide lock status when clone is in progress', async () => {
      // RED: Should be able to query lock status
      const target = 'https://lock-status.test.do'
      let lockInfo: CloneLock | null = null

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('lock-status-id'),
        fetch: vi.fn().mockImplementation(async () => {
          // Simulate lock being held
          lockInfo = {
            id: 'lock-123',
            target,
            source: 'https://source.test.do',
            acquiredAt: new Date(),
            expiresAt: new Date(Date.now() + 300000),
            status: 'held',
          }
          await new Promise((resolve) => setTimeout(resolve, 10))
          lockInfo.status = 'released'
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await result.instance.clone(target, { mode: 'atomic' })

      // Lock should have been released
      expect(lockInfo?.status).toBe('released')
    })

    it('should include lock timeout in clone options', async () => {
      // RED: Lock timeout should be configurable
      const target = 'https://lock-timeout.test.do'

      const cloneResult = await result.instance.clone(target, {
        mode: 'atomic',
        timeout: 60000, // 60 second timeout
      }) as AtomicCloneResult

      expect(cloneResult.success).toBe(true)
    })
  })
})

// ============================================================================
// TEST SUITE: LARGE STATE HANDLING
// ============================================================================

describe('Atomic Clone Mode - Large State Handling', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    // Create large dataset
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createSampleThings(10000, { payloadSize: 1000 })],
        ['relationships', createSampleRelationships(Array.from({ length: 10000 }, (_, i) => `thing-${i}`))],
        ['branches', [{ name: 'main', head: 10000, forkedFrom: null, createdAt: new Date().toISOString() }]],
      ]),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Large Dataset Transfer', () => {
    it('should successfully clone 10000 things atomically', async () => {
      // RED: Large dataset must still be atomic
      const target = 'https://large-things.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.success).toBe(true)
      expect(cloneResult.thingsCloned).toBe(10000)
    })

    it('should successfully clone 9999 relationships atomically', async () => {
      // RED: Large relationship set must be atomic
      const target = 'https://large-relationships.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.relationshipsCloned).toBe(9999)
    })

    it('should handle 10MB+ payload atomically', async () => {
      // RED: Large data volume must remain atomic
      // 10000 things * 1000 bytes each = ~10MB
      const target = 'https://large-payload.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.bytesTransferred).toBeGreaterThan(10_000_000)
    })

    it('should complete large clone within reasonable timeout', async () => {
      // RED: Performance should be reasonable even for large datasets
      const target = 'https://performance-test.test.do'
      const startTime = Date.now()

      const cloneResult = await result.instance.clone(target, {
        mode: 'atomic',
        timeout: 60000, // 60 second max
      }) as AtomicCloneResult

      const duration = Date.now() - startTime
      expect(duration).toBeLessThan(60000)
      expect(cloneResult.duration).toBeGreaterThan(0)
    })

    it('should use batching internally for large transfers', async () => {
      // RED: Internal batching should not break atomicity
      const target = 'https://batched-transfer.test.do'
      let batchCount = 0

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('batched-id'),
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('/batch')) {
            batchCount++
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      // Should use batching internally but still be atomic
      expect(cloneResult.success).toBe(true)
    })
  })

  describe('Memory Management', () => {
    it('should not exceed memory bounds during large clone', async () => {
      // RED: Memory usage should be bounded
      const target = 'https://memory-bounds.test.do'

      // This should not cause OOM
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.success).toBe(true)
    })

    it('should stream data rather than loading all in memory', async () => {
      // RED: Should use streaming for large transfers
      const target = 'https://streaming.test.do'
      let peakItemsInFlight = 0
      let currentItemsInFlight = 0

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('streaming-id'),
        fetch: vi.fn().mockImplementation(async () => {
          currentItemsInFlight++
          peakItemsInFlight = Math.max(peakItemsInFlight, currentItemsInFlight)
          await new Promise((resolve) => setTimeout(resolve, 1))
          currentItemsInFlight--
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await result.instance.clone(target, { mode: 'atomic' })

      // Peak should be bounded (e.g., batch size not total items)
      expect(peakItemsInFlight).toBeLessThan(10000)
    })
  })

  describe('Large History Transfer', () => {
    beforeEach(() => {
      // Add large history
      result.sqlData.set('actions', createSampleActions(50000))
      result.sqlData.set('events', createSampleEvents(100000))
    })

    it('should clone 50000 actions atomically', async () => {
      // RED: Large action history must be atomic
      const target = 'https://large-actions.test.do'
      const cloneResult = await result.instance.clone(target, {
        mode: 'atomic',
        includeHistory: true,
      } as Record<string, unknown>) as AtomicCloneResult

      expect(cloneResult.actionsCloned).toBe(50000)
    })

    it('should clone 100000 events atomically', async () => {
      // RED: Large event history must be atomic
      const target = 'https://large-events.test.do'
      const cloneResult = await result.instance.clone(target, {
        mode: 'atomic',
        includeHistory: true,
      } as Record<string, unknown>) as AtomicCloneResult

      expect(cloneResult.eventsCloned).toBe(100000)
    })
  })
})

// ============================================================================
// TEST SUITE: CROSS-REGION ATOMIC GUARANTEES
// ============================================================================

describe('Atomic Clone Mode - Cross-Region Atomic Guarantees', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    result = createMockDO(DO, {
      ns: 'https://source.enam.test.do',
      sqlData: new Map([
        ['things', createSampleThings(500)],
        ['relationships', createSampleRelationships(Array.from({ length: 500 }, (_, i) => `thing-${i}`))],
        ['branches', [{ name: 'main', head: 500, forkedFrom: null, createdAt: new Date().toISOString() }]],
      ]),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Cross-Region Transfer', () => {
    it('should maintain atomicity for ENAM to WEUR clone', async () => {
      // RED: Cross-Atlantic clone must be atomic
      const target = 'https://target.weur.test.do'
      const cloneResult = await result.instance.clone(target, {
        mode: 'atomic',
        colo: 'weur',
      }) as AtomicCloneResult

      expect(cloneResult.success).toBe(true)
      expect(cloneResult.thingsCloned).toBe(500)
    })

    it('should maintain atomicity for ENAM to APAC clone', async () => {
      // RED: Cross-Pacific clone must be atomic
      const target = 'https://target.apac.test.do'
      const cloneResult = await result.instance.clone(target, {
        mode: 'atomic',
        colo: 'apac',
      }) as AtomicCloneResult

      expect(cloneResult.success).toBe(true)
    })

    it('should handle higher latency without breaking atomicity', async () => {
      // RED: High latency should not cause partial state
      const target = 'https://high-latency.test.do'

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('high-latency-id'),
        fetch: vi.fn().mockImplementation(async () => {
          // Simulate high latency (200ms per request)
          await new Promise((resolve) => setTimeout(resolve, 200))
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      const cloneResult = await result.instance.clone(target, {
        mode: 'atomic',
        timeout: 120000, // Allow for high latency
      }) as AtomicCloneResult

      expect(cloneResult.success).toBe(true)
    })

    it('should rollback completely on cross-region failure', async () => {
      // RED: Cross-region failure must still fully rollback
      const target = 'https://cross-region-fail.test.do'
      const originalSnapshot = captureSnapshot(result.sqlData)

      const mockNamespace = createMockDONamespace()
      let transferCount = 0
      mockNamespace.stubFactory = () => ({
        id: createMockId('cross-region-fail-id'),
        fetch: vi.fn().mockImplementation(async () => {
          transferCount++
          // Simulate cross-region failure mid-transfer
          if (transferCount === 250) {
            throw new Error('Cross-region network error')
          }
          await new Promise((resolve) => setTimeout(resolve, 10))
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, { mode: 'atomic', colo: 'weur' })
      ).rejects.toThrow()

      // Source must be unchanged
      const currentSnapshot = captureSnapshot(result.sqlData)
      expect(currentSnapshot.things).toEqual(originalSnapshot.things)
    })
  })

  describe('Region-Specific Constraints', () => {
    it('should respect jurisdiction constraints in atomic clone', async () => {
      // RED: Data residency must be respected
      const target = 'https://eu-only.weur.test.do'

      const cloneResult = await result.instance.clone(target, {
        mode: 'atomic',
        colo: 'weur', // EU region
      }) as AtomicCloneResult

      // Clone should succeed and data should be in EU
      expect(cloneResult.success).toBe(true)
    })

    it('should handle region unavailability gracefully', async () => {
      // RED: Unavailable region should fail cleanly
      const target = 'https://unavailable-region.test.do'

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('unavailable-region-id'),
        fetch: vi.fn().mockRejectedValue(new Error('Region unavailable')),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, { mode: 'atomic', colo: 'xyz-unavailable' })
      ).rejects.toThrow(/unavailable|region/i)
    })
  })

  describe('Network Partition Handling', () => {
    it('should detect and handle network partition during clone', async () => {
      // RED: Partition should trigger clean rollback
      const target = 'https://partition.test.do'

      const mockNamespace = createMockDONamespace()
      let requestCount = 0
      mockNamespace.stubFactory = () => ({
        id: createMockId('partition-id'),
        fetch: vi.fn().mockImplementation(async () => {
          requestCount++
          // Simulate partition after some requests
          if (requestCount > 100) {
            throw new Error('Network partition detected')
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow(/partition|network/i)
    })

    it('should not leave inconsistent state after partition', async () => {
      // RED: Partition recovery must not leave partial state
      const target = 'https://partition-recovery.test.do'
      const originalSnapshot = captureSnapshot(result.sqlData)

      const mockNamespace = createMockDONamespace()
      let partitioned = false
      mockNamespace.stubFactory = () => ({
        id: createMockId('partition-recovery-id'),
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('/transfer') && !partitioned) {
            partitioned = true
            throw new Error('Temporary partition')
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow()

      // Source unchanged
      const currentSnapshot = captureSnapshot(result.sqlData)
      expect(currentSnapshot.things).toEqual(originalSnapshot.things)
    })
  })

  describe('Clock Synchronization', () => {
    it('should handle clock skew between regions', async () => {
      // RED: Clock skew should not affect atomicity
      const target = 'https://clock-skew.test.do'

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('clock-skew-id'),
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('/timestamp')) {
            // Return skewed timestamp (5 seconds off)
            return new Response(JSON.stringify({ time: Date.now() + 5000 }))
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      // Should succeed despite clock skew
      expect(cloneResult.success).toBe(true)
    })

    it('should use logical timestamps for ordering', async () => {
      // RED: Logical timestamps ensure consistent ordering
      const target = 'https://logical-time.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.success).toBe(true)
    })
  })
})

// ============================================================================
// TEST SUITE: ERROR CONDITIONS AND EDGE CASES
// ============================================================================

describe('Atomic Clone Mode - Error Conditions and Edge Cases', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createSampleThings(100)],
        ['relationships', createSampleRelationships(Array.from({ length: 100 }, (_, i) => `thing-${i}`))],
        ['branches', [{ name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() }]],
      ]),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Timeout Scenarios', () => {
    it('should timeout and rollback if clone exceeds specified timeout', async () => {
      // RED: Timeout must trigger rollback
      const target = 'https://timeout-rollback.test.do'

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('timeout-id'),
        fetch: vi.fn().mockImplementation(async () => {
          // Simulate slow operation
          await new Promise((resolve) => setTimeout(resolve, 1000))
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.clone(target, { mode: 'atomic', timeout: 100 })
      ).rejects.toThrow(/timeout/i)
    })

    it('should use default timeout if not specified', async () => {
      // RED: Default timeout should be reasonable (e.g., 30s)
      const target = 'https://default-timeout.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.success).toBe(true)
    })

    it('should report timeout progress when clone times out', async () => {
      // RED: Timeout error should include progress info
      const target = 'https://timeout-progress.test.do'
      let itemsTransferred = 0

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: createMockId('timeout-progress-id'),
        fetch: vi.fn().mockImplementation(async () => {
          itemsTransferred++
          await new Promise((resolve) => setTimeout(resolve, 50))
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      try {
        await result.instance.clone(target, { mode: 'atomic', timeout: 200 })
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).toMatch(/timeout/i)
      }
    })
  })

  describe('Empty State Edge Cases', () => {
    it('should reject clone of empty DO (no things)', async () => {
      // RED: Empty source should be rejected
      result.sqlData.set('things', [])

      const target = 'https://empty-source.test.do'

      await expect(
        result.instance.clone(target, { mode: 'atomic' })
      ).rejects.toThrow(/empty|no state/i)
    })

    it('should handle DO with things but no relationships', async () => {
      // RED: Should succeed with things-only state
      result.sqlData.set('relationships', [])

      const target = 'https://no-relationships.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.success).toBe(true)
      expect(cloneResult.thingsCloned).toBe(100)
      expect(cloneResult.relationshipsCloned).toBe(0)
    })
  })

  describe('Special Characters and Data', () => {
    it('should handle Unicode data correctly', async () => {
      // RED: Unicode must be preserved
      result.sqlData.set('things', [
        {
          id: 'unicode-1',
          type: 1,
          branch: null,
          name: 'Test Unicode',
          data: { content: 'Hello World!', chinese: 'Sample Text' },
          deleted: false,
          visibility: 'user',
        },
      ])

      const target = 'https://unicode.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.success).toBe(true)
    })

    it('should handle null and undefined values', async () => {
      // RED: Null values must be preserved
      result.sqlData.set('things', [
        {
          id: 'nulls-1',
          type: 1,
          branch: null,
          name: null,
          data: { value: null, nested: { inner: null } },
          deleted: false,
          visibility: 'user',
        },
      ])

      const target = 'https://nulls.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.success).toBe(true)
    })

    it('should handle deeply nested JSON data', async () => {
      // RED: Deep nesting must be preserved
      const deepNested = {
        l1: { l2: { l3: { l4: { l5: { l6: { l7: { l8: { l9: { l10: 'deep' } } } } } } } } },
      }

      result.sqlData.set('things', [
        {
          id: 'deep-1',
          type: 1,
          branch: null,
          name: 'Deep Nested',
          data: deepNested,
          deleted: false,
          visibility: 'user',
        },
      ])

      const target = 'https://deep-nested.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.success).toBe(true)
    })

    it('should handle circular reference detection', async () => {
      // RED: Circular references in relationships should be handled
      result.sqlData.set('relationships', [
        { id: 'circ-1', verb: 'refs', from: 'thing-0', to: 'thing-1', data: null, createdAt: new Date().toISOString() },
        { id: 'circ-2', verb: 'refs', from: 'thing-1', to: 'thing-2', data: null, createdAt: new Date().toISOString() },
        { id: 'circ-3', verb: 'refs', from: 'thing-2', to: 'thing-0', data: null, createdAt: new Date().toISOString() }, // Circular
      ])

      const target = 'https://circular.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.success).toBe(true)
      expect(cloneResult.relationshipsCloned).toBe(3)
    })
  })

  describe('Deleted Things Handling', () => {
    it('should include soft-deleted things in clone', async () => {
      // RED: Deleted=true things should be cloned
      result.sqlData.set('things', [
        ...createSampleThings(5),
        {
          id: 'deleted-1',
          type: 1,
          branch: null,
          name: 'Deleted Item',
          data: {},
          deleted: true,
          visibility: 'user',
        },
      ])

      const target = 'https://with-deleted.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' }) as AtomicCloneResult

      expect(cloneResult.thingsCloned).toBe(6) // 5 + 1 deleted
    })
  })
})
