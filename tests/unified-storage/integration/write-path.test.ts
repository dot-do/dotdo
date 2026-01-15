/**
 * E2E Write Path Integration Tests - TDD RED Phase
 *
 * These tests validate the full write path through the unified storage system:
 * Client -> StateManager -> Pipeline -> Checkpoint
 *
 * Integration test scenarios:
 * 1. Full write path from client through persistence
 * 2. Write acknowledgment timing (after Pipeline emit)
 * 3. Cold start recovery (data survives DO restart)
 * 4. Leader-follower replication propagation
 * 5. Cross-shard write routing
 * 6. Transaction semantics for multi-entity writes
 * 7. Multi-master conflict resolution
 *
 * NOTE: These tests are designed to FAIL because the full integration
 * infrastructure does not exist yet. This is the TDD RED phase.
 *
 * @see /objects/unified-storage/unified-store.ts (to be created)
 * @module tests/unified-storage/integration/write-path.test
 * @issue do-5zu9
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// IMPORTS - These will FAIL because implementations don't exist yet
// ============================================================================

// Core unified storage imports
import {
  UnifiedStore,
  type UnifiedStoreConfig,
  type WriteResult,
  type WriteOptions,
  type TransactionContext,
  type WriteAcknowledgment,
} from '../../../objects/unified-storage/unified-store'

// State management
import { InMemoryStateManager } from '../../../objects/unified-storage/in-memory-state-manager'

// Pipeline emission
import {
  PipelineEmitter,
  type EmittedEvent,
} from '../../../objects/unified-storage/pipeline-emitter'

// Checkpointing
import { LazyCheckpointer } from '../../../objects/unified-storage/lazy-checkpointer'

// Cold start recovery
import { ColdStartRecovery } from '../../../objects/unified-storage/cold-start-recovery'

// Leader-follower replication
import {
  LeaderFollowerManager,
  ReplicationRole,
} from '../../../objects/unified-storage/leader-follower'

// Sharding
import { ShardRouter } from '../../../objects/unified-storage/shard-router'

// Multi-master
import {
  MultiMasterManager,
  VectorClock,
} from '../../../objects/unified-storage/multi-master'

// Conflict resolution
import {
  ConflictResolver,
  LastWriteWinsStrategy,
  VersionVectorStrategy,
  FieldMergeStrategy,
} from '../../../db/primitives/conflict-resolver'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface Thing {
  $id: string
  $type: string
  $version: number
  $createdAt: number
  $updatedAt: number
  [key: string]: unknown
}

interface TestEntity extends Thing {
  name: string
  data?: Record<string, unknown>
}

interface PipelineEvent {
  type: 'thing.created' | 'thing.updated' | 'thing.deleted'
  entityId: string
  entityType: string
  payload: Record<string, unknown>
  timestamp: number
  idempotencyKey: string
  namespace: string
  sequence: number
}

// ============================================================================
// MOCK FACTORIES
// ============================================================================

/**
 * Create a mock Pipeline with event tracking and configurable behavior
 */
function createMockPipeline(options: {
  sendDelayMs?: number
  errorOnSend?: Error | null
  failCount?: number
} = {}) {
  const events: PipelineEvent[] = []
  const subscribers: Map<string, (event: PipelineEvent) => void> = new Map()
  let delay = options.sendDelayMs ?? 0
  let error = options.errorOnSend ?? null
  let failuresRemaining = options.failCount ?? 0
  let sequence = 0

  const send = vi.fn(async (batch: unknown[]) => {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    if (failuresRemaining > 0) {
      failuresRemaining--
      throw error || new Error('Mock pipeline failure')
    }
    if (error) {
      throw error
    }
    for (const event of batch as PipelineEvent[]) {
      sequence++
      const seqEvent = { ...event, sequence }
      events.push(seqEvent)
      // Notify subscribers
      for (const [, callback] of subscribers) {
        callback(seqEvent)
      }
    }
  })

  const subscribe = vi.fn((namespace: string, callback: (event: PipelineEvent) => void) => {
    subscribers.set(namespace, callback)
    return () => subscribers.delete(namespace)
  })

  return {
    send,
    subscribe,
    events,
    getSequence: () => sequence,
    setDelay: (ms: number) => { delay = ms },
    setError: (err: Error | null) => { error = err },
    setFailCount: (count: number) => { failuresRemaining = count },
    clear: () => {
      events.length = 0
      subscribers.clear()
      send.mockClear()
      subscribe.mockClear()
      sequence = 0
    },
    simulateEvent: (event: PipelineEvent) => {
      for (const [, callback] of subscribers) {
        callback(event)
      }
    },
  }
}

type MockPipeline = ReturnType<typeof createMockPipeline>

/**
 * Create a mock SQLite connection for checkpointing
 */
function createMockSqlite() {
  const tables: Map<string, unknown[]> = new Map()

  return {
    exec: vi.fn((query: string, ...params: unknown[]) => {
      // Simple mock that tracks inserts/updates
      if (query.toLowerCase().includes('insert') || query.toLowerCase().includes('update')) {
        const tableName = query.match(/(?:insert into|update)\s+(\w+)/i)?.[1] || 'default'
        if (!tables.has(tableName)) {
          tables.set(tableName, [])
        }
        tables.get(tableName)!.push({ query, params })
      }
      return { toArray: () => [] }
    }),
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({ run: vi.fn(), all: vi.fn(() => []) })),
    })),
    tables,
    clear: () => tables.clear(),
  }
}

type MockSqlite = ReturnType<typeof createMockSqlite>

/**
 * Create a mock Durable Object namespace for sharding
 */
function createMockDONamespace() {
  const stubs = new Map<string, ReturnType<typeof createMockDOStub>>()

  return {
    idFromName: vi.fn((name: string) => ({ toString: () => `id:${name}`, name })),
    get: vi.fn((id: { name: string }) => {
      const name = id.name
      if (!stubs.has(name)) {
        stubs.set(name, createMockDOStub(name))
      }
      return stubs.get(name)!
    }),
    _getStubs: () => stubs,
    _getStub: (name: string) => stubs.get(name),
  }
}

function createMockDOStub(name: string) {
  const responses: Map<string, Response> = new Map()
  const state = new Map<string, unknown>()

  return {
    name,
    state,
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      const key = `${request.method}:${url.pathname}`

      if (responses.has(key)) {
        return responses.get(key)!
      }

      return new Response(JSON.stringify({ shard: name, path: url.pathname }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
    _setResponse: (method: string, path: string, response: Response) => {
      responses.set(`${method}:${path}`, response)
    },
  }
}

type MockDONamespace = ReturnType<typeof createMockDONamespace>

/**
 * Create a mock heartbeat service for leader-follower
 */
function createMockHeartbeatService() {
  const heartbeats: Map<string, number> = new Map()
  let isLeaderAlive = true
  const listeners: ((leaderId: string, alive: boolean) => void)[] = []

  return {
    sendHeartbeat: vi.fn((nodeId: string) => {
      heartbeats.set(nodeId, Date.now())
    }),
    getLastHeartbeat: vi.fn((nodeId: string) => heartbeats.get(nodeId)),
    isAlive: vi.fn((nodeId: string, timeoutMs: number) => {
      if (nodeId === 'leader') return isLeaderAlive
      const last = heartbeats.get(nodeId)
      if (!last) return false
      return Date.now() - last < timeoutMs
    }),
    onLeaderStatus: vi.fn((callback: (leaderId: string, alive: boolean) => void) => {
      listeners.push(callback)
      return () => {
        const idx = listeners.indexOf(callback)
        if (idx >= 0) listeners.splice(idx, 1)
      }
    }),
    setLeaderAlive: (alive: boolean) => {
      isLeaderAlive = alive
      for (const listener of listeners) {
        listener('leader', alive)
      }
    },
    clear: () => {
      heartbeats.clear()
      listeners.length = 0
      isLeaderAlive = true
    },
  }
}

type MockHeartbeatService = ReturnType<typeof createMockHeartbeatService>

// ============================================================================
// TEST SUITE
// ============================================================================

describe('E2E Write Path Integration Tests', () => {
  let mockPipeline: MockPipeline
  let mockSqlite: MockSqlite
  let mockDONamespace: MockDONamespace
  let mockHeartbeat: MockHeartbeatService

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockPipeline = createMockPipeline()
    mockSqlite = createMockSqlite()
    mockDONamespace = createMockDONamespace()
    mockHeartbeat = createMockHeartbeatService()
  })

  afterEach(() => {
    vi.useRealTimers()
    mockPipeline.clear()
    mockSqlite.clear()
  })

  // ==========================================================================
  // TEST 1: Client -> StateManager -> Pipeline -> Checkpoint (full path)
  // ==========================================================================

  describe('1. Full Write Path Integration', () => {
    it('should complete full write path: client -> state -> pipeline -> checkpoint', async () => {
      // Given: A unified store with all components wired together
      const store = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
        checkpointIntervalMs: 5000,
      })

      // When: Client writes an entity
      const result = await store.write({
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
      })

      // Then: Write should succeed
      expect(result.success).toBe(true)
      expect(result.entity.$id).toBeDefined()
      expect(result.entity.$type).toBe('Customer')
      expect(result.entity.$version).toBe(1)

      // And: Entity should be in state manager
      const retrieved = await store.get(result.entity.$id)
      expect(retrieved).not.toBeNull()
      expect(retrieved!.name).toBe('Alice')

      // And: Event should be emitted to pipeline
      expect(mockPipeline.send).toHaveBeenCalled()
      expect(mockPipeline.events.length).toBeGreaterThan(0)
      expect(mockPipeline.events[0].entityId).toBe(result.entity.$id)

      // And: After checkpoint interval, data should be persisted
      await vi.advanceTimersByTimeAsync(6000)
      expect(mockSqlite.exec).toHaveBeenCalled()

      await store.close()
    })

    it('should maintain consistency across all layers', async () => {
      // Given: A unified store
      const store = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
      })

      // When: Multiple writes occur
      const entities: WriteResult[] = []
      for (let i = 0; i < 10; i++) {
        const result = await store.write({
          $type: 'Item',
          name: `Item ${i}`,
          index: i,
        })
        entities.push(result)
      }

      // Then: All entities should be in state
      for (const entity of entities) {
        const retrieved = await store.get(entity.entity.$id)
        expect(retrieved).not.toBeNull()
      }

      // And: All events should be in pipeline
      await vi.advanceTimersByTimeAsync(100)
      expect(mockPipeline.events.length).toBe(10)

      // And: Event sequence should match write order
      for (let i = 0; i < 10; i++) {
        expect(mockPipeline.events[i].entityId).toBe(entities[i].entity.$id)
      }

      await store.close()
    })

    it('should handle update through full path', async () => {
      // Given: A unified store with an existing entity
      const store = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
      })

      const createResult = await store.write({
        $type: 'Customer',
        name: 'Alice',
      })

      mockPipeline.events.length = 0 // Reset for clarity

      // When: Updating the entity
      const updateResult = await store.update(createResult.entity.$id, {
        name: 'Alice Updated',
        email: 'alice@updated.com',
      })

      // Then: Update should succeed with incremented version
      expect(updateResult.success).toBe(true)
      expect(updateResult.entity.$version).toBe(2)
      expect(updateResult.entity.name).toBe('Alice Updated')

      // And: Update event should be emitted
      expect(mockPipeline.events.length).toBe(1)
      expect(mockPipeline.events[0].type).toBe('thing.updated')

      await store.close()
    })

    it('should handle delete through full path', async () => {
      // Given: A unified store with an existing entity
      const store = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
      })

      const createResult = await store.write({
        $type: 'Customer',
        name: 'ToDelete',
      })

      mockPipeline.events.length = 0

      // When: Deleting the entity
      const deleteResult = await store.delete(createResult.entity.$id)

      // Then: Delete should succeed
      expect(deleteResult.success).toBe(true)
      expect(deleteResult.deleted).toBe(true)

      // And: Entity should no longer be retrievable
      const retrieved = await store.get(createResult.entity.$id)
      expect(retrieved).toBeNull()

      // And: Delete event should be emitted
      expect(mockPipeline.events.length).toBe(1)
      expect(mockPipeline.events[0].type).toBe('thing.deleted')

      await store.close()
    })
  })

  // ==========================================================================
  // TEST 2: Write acknowledged after Pipeline emit
  // ==========================================================================

  describe('2. Write Acknowledgment Timing', () => {
    it('should not acknowledge write until pipeline emit succeeds', async () => {
      // Given: A store with slow pipeline
      const slowPipeline = createMockPipeline({ sendDelayMs: 100 })
      const store = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: slowPipeline as any,
        sql: mockSqlite as any,
        acknowledgmentMode: 'pipeline', // Wait for pipeline
      })

      // When: Starting a write (not awaiting yet)
      const writePromise = store.write({
        $type: 'Customer',
        name: 'Alice',
      })

      // Then: Write should not be complete yet
      let resolved = false
      writePromise.then(() => { resolved = true })

      // Wait less than pipeline delay
      await vi.advanceTimersByTimeAsync(50)
      expect(resolved).toBe(false)

      // Wait for pipeline to complete
      await vi.advanceTimersByTimeAsync(100)
      expect(resolved).toBe(true)

      const result = await writePromise
      expect(result.success).toBe(true)
      expect(result.acknowledgment.pipelineEmitted).toBe(true)

      await store.close()
    })

    it('should include acknowledgment metadata', async () => {
      // Given: A unified store
      const store = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
      })

      // When: Writing an entity
      const result = await store.write({
        $type: 'Customer',
        name: 'Alice',
      })

      // Then: Acknowledgment should include timing info
      expect(result.acknowledgment).toBeDefined()
      expect(result.acknowledgment.stateUpdatedAt).toBeDefined()
      expect(result.acknowledgment.pipelineEmittedAt).toBeDefined()
      expect(result.acknowledgment.totalDurationMs).toBeGreaterThanOrEqual(0)

      await store.close()
    })

    it('should fail write if pipeline emit fails (when in pipeline ack mode)', async () => {
      // Given: A store with failing pipeline
      const failingPipeline = createMockPipeline({ failCount: 10 }) // Always fail
      const store = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: failingPipeline as any,
        sql: mockSqlite as any,
        acknowledgmentMode: 'pipeline',
        maxRetries: 3,
      })

      // When: Writing an entity
      const result = await store.write({
        $type: 'Customer',
        name: 'Alice',
      })

      // Then: Write should fail
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toMatch(/pipeline|emit|failed/i)

      await store.close()
    })

    it('should support fire-and-forget acknowledgment mode', async () => {
      // Given: A store with slow pipeline but fast ack mode
      const slowPipeline = createMockPipeline({ sendDelayMs: 1000 })
      const store = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: slowPipeline as any,
        sql: mockSqlite as any,
        acknowledgmentMode: 'state', // Acknowledge after state update only
      })

      // When: Writing an entity
      const startTime = Date.now()
      const result = await store.write({
        $type: 'Customer',
        name: 'Alice',
      })
      const elapsed = Date.now() - startTime

      // Then: Write should complete quickly (before pipeline)
      expect(result.success).toBe(true)
      expect(elapsed).toBeLessThan(100) // Much less than 1000ms pipeline delay
      expect(result.acknowledgment.pipelineEmitted).toBe(false)
      expect(result.acknowledgment.pipelinePending).toBe(true)

      await store.close()
    })
  })

  // ==========================================================================
  // TEST 3: Data recoverable after cold start (persistence verified)
  // ==========================================================================

  describe('3. Cold Start Recovery', () => {
    it('should recover data from SQLite after cold start', async () => {
      // Given: A store with persisted data
      const store1 = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
        checkpointIntervalMs: 0, // Immediate checkpoint
      })

      // Write some data
      const entities: WriteResult[] = []
      for (let i = 0; i < 5; i++) {
        const result = await store1.write({
          $type: 'Customer',
          name: `Customer ${i}`,
          index: i,
        })
        entities.push(result)
      }

      // Force checkpoint
      await store1.checkpoint()
      await store1.close()

      // When: Creating a new store (simulating cold start)
      const store2 = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
      })

      // Wait for recovery
      await store2.waitForReady()

      // Then: All entities should be recovered
      for (const entity of entities) {
        const recovered = await store2.get(entity.entity.$id)
        expect(recovered).not.toBeNull()
        expect(recovered!.$id).toBe(entity.entity.$id)
        expect(recovered!.name).toBe(entity.entity.name)
      }

      await store2.close()
    })

    it('should recover with correct versions', async () => {
      // Given: A store with versioned entities
      const store1 = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
        checkpointIntervalMs: 0,
      })

      const createResult = await store1.write({
        $type: 'Document',
        name: 'Doc 1',
        content: 'v1',
      })

      // Update multiple times
      await store1.update(createResult.entity.$id, { content: 'v2' })
      await store1.update(createResult.entity.$id, { content: 'v3' })
      await store1.update(createResult.entity.$id, { content: 'v4' })

      await store1.checkpoint()
      await store1.close()

      // When: Cold starting
      const store2 = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
      })

      await store2.waitForReady()

      // Then: Entity should have correct version
      const recovered = await store2.get(createResult.entity.$id)
      expect(recovered).not.toBeNull()
      expect(recovered!.$version).toBe(4)
      expect(recovered!.content).toBe('v4')

      await store2.close()
    })

    it('should recover dirty entries that werent checkpointed', async () => {
      // Given: A store with uncheckpointed changes
      const store1 = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
        checkpointIntervalMs: 60000, // Long interval
      })

      // Write data (not checkpointed)
      const result = await store1.write({
        $type: 'Customer',
        name: 'Uncheckpointed Alice',
      })

      // Close without checkpoint (simulating crash)
      await store1.close({ skipCheckpoint: true })

      // When: Cold starting with Iceberg recovery
      const mockIceberg = {
        getRecords: vi.fn(async () => [{
          type: 'thing.created' as const,
          entityId: result.entity.$id,
          entityType: 'Customer',
          payload: { $id: result.entity.$id, $type: 'Customer', name: 'Uncheckpointed Alice' },
          ts: Date.now(),
          version: 1,
          ns: 'test-ns',
        }]),
      }

      const store2 = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
        iceberg: mockIceberg as any,
      })

      await store2.waitForReady()

      // Then: Entity should be recovered from Iceberg
      const recovered = await store2.get(result.entity.$id)
      expect(recovered).not.toBeNull()
      expect(recovered!.name).toBe('Uncheckpointed Alice')

      await store2.close()
    })

    it('should report recovery progress', async () => {
      // Given: A store with recovery progress callback
      const progressUpdates: Array<{ phase: string; loaded: number }> = []

      const store = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
        onRecoveryProgress: (progress) => {
          progressUpdates.push({ phase: progress.phase, loaded: progress.loaded })
        },
      })

      // When: Waiting for recovery
      await store.waitForReady()

      // Then: Progress should have been reported
      expect(progressUpdates.length).toBeGreaterThan(0)
      const phases = progressUpdates.map((p) => p.phase)
      expect(phases).toContain('complete')

      await store.close()
    })
  })

  // ==========================================================================
  // TEST 4: Replication propagates to followers (leader-follower)
  // ==========================================================================

  describe('4. Leader-Follower Replication', () => {
    it('should propagate writes from leader to followers', async () => {
      // Given: A leader and follower store
      const leaderStore = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
        replicationRole: ReplicationRole.Leader,
        nodeId: 'leader-1',
      })

      const followerSqlite = createMockSqlite()
      const followerStore = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: followerSqlite as any,
        replicationRole: ReplicationRole.Follower,
        nodeId: 'follower-1',
        leaderId: 'leader-1',
      })

      await followerStore.startReplication()

      // When: Leader writes data
      const result = await leaderStore.write({
        $type: 'Customer',
        name: 'Replicated Alice',
      })

      // Allow replication to propagate
      await vi.advanceTimersByTimeAsync(100)

      // Then: Follower should have the data
      const onFollower = await followerStore.get(result.entity.$id)
      expect(onFollower).not.toBeNull()
      expect(onFollower!.name).toBe('Replicated Alice')

      await leaderStore.close()
      await followerStore.close()
    })

    it('should reject writes on follower', async () => {
      // Given: A follower store
      const followerStore = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
        replicationRole: ReplicationRole.Follower,
        nodeId: 'follower-1',
        leaderId: 'leader-1',
      })

      // When: Attempting to write on follower
      const result = await followerStore.write({
        $type: 'Customer',
        name: 'Should Fail',
      })

      // Then: Write should be rejected
      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('FOLLOWER_READ_ONLY')
      expect(result.leaderId).toBe('leader-1')

      await followerStore.close()
    })

    it('should serve reads from follower local state', async () => {
      // Given: A follower with replicated data
      const followerStore = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
        replicationRole: ReplicationRole.Follower,
        nodeId: 'follower-1',
        leaderId: 'leader-1',
      })

      await followerStore.startReplication()

      // Simulate replicated event
      mockPipeline.simulateEvent({
        type: 'thing.created',
        entityId: 'customer-123',
        entityType: 'Customer',
        payload: { $id: 'customer-123', $type: 'Customer', name: 'Replicated' },
        timestamp: Date.now(),
        idempotencyKey: 'key-1',
        namespace: 'test-ns',
        sequence: 1,
      })

      await vi.advanceTimersByTimeAsync(50)

      // When: Reading from follower
      const result = await followerStore.get('customer-123')

      // Then: Should return replicated data
      expect(result).not.toBeNull()
      expect(result!.name).toBe('Replicated')

      await followerStore.close()
    })

    it('should track replication lag', async () => {
      // Given: A leader and lagging follower
      const leaderStore = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
        replicationRole: ReplicationRole.Leader,
        nodeId: 'leader-1',
        heartbeatService: mockHeartbeat as any,
      })

      const followerStore = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
        replicationRole: ReplicationRole.Follower,
        nodeId: 'follower-1',
        leaderId: 'leader-1',
        heartbeatService: mockHeartbeat as any,
      })

      // Don't start replication (simulating lag)

      // When: Leader writes multiple events
      for (let i = 0; i < 5; i++) {
        await leaderStore.write({ $type: 'Item', index: i })
      }

      await vi.advanceTimersByTimeAsync(100)

      // Then: Leader should report follower lag
      const metrics = leaderStore.getReplicationMetrics()
      expect(metrics.followers).toBeDefined()
      // Follower hasn't started replication, so lag is unknown or max

      await leaderStore.close()
      await followerStore.close()
    })

    it('should handle follower promotion after leader failure', async () => {
      // Given: A follower that becomes leader
      const store = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
        replicationRole: ReplicationRole.Follower,
        nodeId: 'follower-1',
        leaderId: 'leader-1',
      })

      await store.startReplication()

      // Simulate some replicated data
      mockPipeline.simulateEvent({
        type: 'thing.created',
        entityId: 'customer-123',
        entityType: 'Customer',
        payload: { $id: 'customer-123', $type: 'Customer', name: 'Before Promotion' },
        timestamp: Date.now(),
        idempotencyKey: 'key-1',
        namespace: 'test-ns',
        sequence: 1,
      })

      await vi.advanceTimersByTimeAsync(50)

      // When: Promoting to leader
      await store.promote()

      // Then: Should accept writes
      const result = await store.write({
        $type: 'Customer',
        name: 'After Promotion',
      })

      expect(result.success).toBe(true)
      expect(store.getRole()).toBe(ReplicationRole.Leader)

      await store.close()
    })
  })

  // ==========================================================================
  // TEST 5: Cross-shard write routes correctly (sharding)
  // ==========================================================================

  describe('5. Cross-Shard Write Routing', () => {
    it('should route write to correct shard based on partition key', async () => {
      // Given: A sharded store
      const shardedStore = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        doNamespace: mockDONamespace as any,
        sharding: {
          enabled: true,
          strategy: 'hash',
          shardCount: 4,
        },
      })

      // When: Writing with explicit partition key
      const result = await shardedStore.write(
        { $type: 'Customer', name: 'Alice' },
        { partitionKey: 'customer-alice' }
      )

      // Then: Write should succeed
      expect(result.success).toBe(true)

      // And: Should route to consistent shard
      const shardInfo = shardedStore.getShardInfo('customer-alice')
      expect(shardInfo.shardIndex).toBeGreaterThanOrEqual(0)
      expect(shardInfo.shardIndex).toBeLessThan(4)

      // Subsequent writes with same key should go to same shard
      const shardInfo2 = shardedStore.getShardInfo('customer-alice')
      expect(shardInfo2.shardIndex).toBe(shardInfo.shardIndex)

      await shardedStore.close()
    })

    it('should derive partition key from entity ID when not specified', async () => {
      // Given: A sharded store
      const shardedStore = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        doNamespace: mockDONamespace as any,
        sharding: {
          enabled: true,
          strategy: 'hash',
          shardCount: 4,
        },
      })

      // When: Writing without explicit partition key
      const result = await shardedStore.write({
        $id: 'customer-bob',
        $type: 'Customer',
        name: 'Bob',
      })

      // Then: Should use entity ID as partition key
      expect(result.success).toBe(true)
      expect(result.shardInfo).toBeDefined()
      expect(result.shardInfo!.partitionKey).toBe('customer-bob')

      await shardedStore.close()
    })

    it('should forward write request to remote shard', async () => {
      // Given: A sharded store that routes to remote shards
      const shardedStore = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        doNamespace: mockDONamespace as any,
        sharding: {
          enabled: true,
          strategy: 'hash',
          shardCount: 4,
        },
      })

      // When: Writing multiple entities (some will route to different shards)
      const results: WriteResult[] = []
      for (let i = 0; i < 20; i++) {
        const result = await shardedStore.write({
          $type: 'Item',
          name: `Item ${i}`,
        })
        results.push(result)
      }

      // Then: All writes should succeed
      expect(results.every((r) => r.success)).toBe(true)

      // And: Writes should be distributed across shards
      const shardDistribution = new Map<number, number>()
      for (const result of results) {
        const shard = result.shardInfo!.shardIndex
        shardDistribution.set(shard, (shardDistribution.get(shard) || 0) + 1)
      }

      // Should have used multiple shards (probabilistically)
      expect(shardDistribution.size).toBeGreaterThan(1)

      await shardedStore.close()
    })

    it('should handle shard unavailability gracefully', async () => {
      // Given: A sharded store with a failing shard
      const failingNamespace = {
        ...mockDONamespace,
        get: vi.fn(() => ({
          fetch: vi.fn(async () => {
            throw new Error('Shard unavailable')
          }),
        })),
      }

      const shardedStore = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        doNamespace: failingNamespace as any,
        sharding: {
          enabled: true,
          strategy: 'hash',
          shardCount: 4,
        },
      })

      // When: Writing to unavailable shard
      const result = await shardedStore.write({
        $type: 'Customer',
        name: 'Alice',
      })

      // Then: Should return appropriate error
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/shard|unavailable/i)

      await shardedStore.close()
    })

    it('should support range-based sharding for time-series data', async () => {
      // Given: A store with time-based range sharding
      const shardedStore = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        doNamespace: mockDONamespace as any,
        sharding: {
          enabled: true,
          strategy: 'range',
          ranges: [
            { start: '2024-01', end: '2024-07', shard: 0 },
            { start: '2024-07', end: '2025-01', shard: 1 },
            { start: '2025-01', end: '2025-07', shard: 2 },
            { start: '2025-07', end: '2026-01', shard: 3 },
          ],
        },
      })

      // When: Writing time-series events
      const q1Result = await shardedStore.write(
        { $type: 'Event', name: 'Q1 Event' },
        { partitionKey: '2024-03-15' }
      )
      const q3Result = await shardedStore.write(
        { $type: 'Event', name: 'Q3 Event' },
        { partitionKey: '2024-09-01' }
      )

      // Then: Events should route to correct time-range shards
      expect(q1Result.shardInfo!.shardIndex).toBe(0)
      expect(q3Result.shardInfo!.shardIndex).toBe(1)

      await shardedStore.close()
    })
  })

  // ==========================================================================
  // TEST 6: Transaction semantics (multi-entity writes)
  // ==========================================================================

  describe('6. Transaction Semantics', () => {
    it('should write multiple entities atomically', async () => {
      // Given: A unified store with transaction support
      const store = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
      })

      // When: Writing multiple entities in a transaction
      const result = await store.transaction(async (tx: TransactionContext) => {
        const customer = await tx.write({
          $type: 'Customer',
          name: 'Alice',
        })

        const order = await tx.write({
          $type: 'Order',
          customerId: customer.entity.$id,
          total: 99.99,
        })

        const payment = await tx.write({
          $type: 'Payment',
          orderId: order.entity.$id,
          amount: 99.99,
          status: 'completed',
        })

        return { customer, order, payment }
      })

      // Then: All entities should be written
      expect(result.success).toBe(true)
      expect(result.entities.customer.success).toBe(true)
      expect(result.entities.order.success).toBe(true)
      expect(result.entities.payment.success).toBe(true)

      // And: All should be retrievable
      const customer = await store.get(result.entities.customer.entity.$id)
      const order = await store.get(result.entities.order.entity.$id)
      const payment = await store.get(result.entities.payment.entity.$id)

      expect(customer).not.toBeNull()
      expect(order).not.toBeNull()
      expect(payment).not.toBeNull()

      await store.close()
    })

    it('should rollback all entities on transaction failure', async () => {
      // Given: A unified store
      const store = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
      })

      let customerId: string | undefined

      // When: Transaction fails midway
      const result = await store.transaction(async (tx: TransactionContext) => {
        const customer = await tx.write({
          $type: 'Customer',
          name: 'Alice',
        })
        customerId = customer.entity.$id

        // This write should fail
        throw new Error('Intentional failure')
      })

      // Then: Transaction should fail
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/intentional/i)

      // And: No entities should be persisted
      if (customerId) {
        const customer = await store.get(customerId)
        expect(customer).toBeNull()
      }

      // And: No events should be emitted
      expect(mockPipeline.events.length).toBe(0)

      await store.close()
    })

    it('should emit single batch event for transaction', async () => {
      // Given: A unified store
      const store = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
      })

      // When: Writing multiple entities in transaction
      await store.transaction(async (tx: TransactionContext) => {
        await tx.write({ $type: 'Item', name: 'Item 1' })
        await tx.write({ $type: 'Item', name: 'Item 2' })
        await tx.write({ $type: 'Item', name: 'Item 3' })
      })

      // Then: Should emit all events in a single batch
      expect(mockPipeline.send).toHaveBeenCalledTimes(1)

      // And: Batch should contain all events
      const batchArg = mockPipeline.send.mock.calls[0][0]
      expect(batchArg.length).toBe(3)

      await store.close()
    })

    it('should support read-your-writes within transaction', async () => {
      // Given: A unified store
      const store = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
      })

      // When: Reading after writing within same transaction
      const result = await store.transaction(async (tx: TransactionContext) => {
        const writeResult = await tx.write({
          $type: 'Counter',
          name: 'MyCounter',
          value: 0,
        })

        // Read immediately after write
        const read1 = await tx.get(writeResult.entity.$id)
        expect(read1).not.toBeNull()
        expect(read1!.value).toBe(0)

        // Update and read again
        await tx.update(writeResult.entity.$id, { value: 1 })
        const read2 = await tx.get(writeResult.entity.$id)
        expect(read2).not.toBeNull()
        expect(read2!.value).toBe(1)

        return writeResult
      })

      expect(result.success).toBe(true)

      await store.close()
    })

    it('should provide isolation between concurrent transactions', async () => {
      // Given: A unified store
      const store = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
      })

      // Create initial entity
      const initial = await store.write({
        $type: 'Counter',
        name: 'SharedCounter',
        value: 0,
      })

      // When: Two transactions try to update concurrently
      const tx1Promise = store.transaction(async (tx: TransactionContext) => {
        const counter = await tx.get(initial.entity.$id)
        await new Promise((r) => setTimeout(r, 50)) // Simulate work
        await tx.update(initial.entity.$id, { value: (counter?.value as number) + 10 })
        return 'tx1'
      })

      const tx2Promise = store.transaction(async (tx: TransactionContext) => {
        const counter = await tx.get(initial.entity.$id)
        await tx.update(initial.entity.$id, { value: (counter?.value as number) + 5 })
        return 'tx2'
      })

      // Advance timers to allow both to complete
      await vi.advanceTimersByTimeAsync(100)

      const [result1, result2] = await Promise.all([tx1Promise, tx2Promise])

      // Then: At least one should succeed, the other may conflict
      // (Implementation may use optimistic or pessimistic concurrency)
      const successCount = [result1, result2].filter((r) => r.success).length
      expect(successCount).toBeGreaterThanOrEqual(1)

      await store.close()
    })
  })

  // ==========================================================================
  // TEST 7: Conflict resolution in multi-master
  // ==========================================================================

  describe('7. Multi-Master Conflict Resolution', () => {
    it('should detect concurrent writes to same entity', async () => {
      // Given: Two masters in a multi-master setup
      const masterA = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
        multiMaster: {
          enabled: true,
          masterId: 'master-a',
        },
      })

      const masterBSqlite = createMockSqlite()
      const masterB = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: masterBSqlite as any,
        multiMaster: {
          enabled: true,
          masterId: 'master-b',
        },
      })

      // Create initial entity on master A
      const initial = await masterA.write({
        $id: 'shared-entity',
        $type: 'Document',
        content: 'initial',
      })

      // Sync to master B
      await vi.advanceTimersByTimeAsync(100)

      // When: Both masters update concurrently
      vi.setSystemTime(new Date('2026-01-14T12:00:01.000Z'))
      const updateA = masterA.update('shared-entity', { content: 'from-A' })

      vi.setSystemTime(new Date('2026-01-14T12:00:01.500Z'))
      const updateB = masterB.update('shared-entity', { content: 'from-B' })

      await vi.advanceTimersByTimeAsync(100)

      const [resultA, resultB] = await Promise.all([updateA, updateB])

      // Then: Both updates should succeed locally
      expect(resultA.success).toBe(true)
      expect(resultB.success).toBe(true)

      // But conflict should be detected when syncing
      await vi.advanceTimersByTimeAsync(1000)

      const metrics = masterA.getConflictMetrics()
      expect(metrics.conflictsDetected).toBeGreaterThanOrEqual(1)

      await masterA.close()
      await masterB.close()
    })

    it('should resolve conflicts using Last-Write-Wins', async () => {
      // Given: A multi-master store with LWW conflict resolution
      const store = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
        multiMaster: {
          enabled: true,
          masterId: 'master-a',
          conflictStrategy: 'lww',
        },
      })

      // Simulate receiving conflicting updates
      const localTimestamp = Date.now()
      const remoteTimestamp = localTimestamp + 1000 // Remote is later

      // Write local version
      vi.setSystemTime(new Date(localTimestamp))
      await store.write({
        $id: 'doc-1',
        $type: 'Document',
        content: 'local-version',
      })

      // Receive remote version with later timestamp
      mockPipeline.simulateEvent({
        type: 'thing.updated',
        entityId: 'doc-1',
        entityType: 'Document',
        payload: { $id: 'doc-1', $type: 'Document', content: 'remote-version' },
        timestamp: remoteTimestamp,
        idempotencyKey: 'remote-key',
        namespace: 'test-ns',
        sequence: 2,
      })

      await vi.advanceTimersByTimeAsync(100)

      // Then: Remote version should win (later timestamp)
      const resolved = await store.get('doc-1')
      expect(resolved).not.toBeNull()
      expect(resolved!.content).toBe('remote-version')

      await store.close()
    })

    it('should resolve conflicts using version vectors', async () => {
      // Given: A multi-master store with vector clock conflict resolution
      const store = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
        multiMaster: {
          enabled: true,
          masterId: 'master-a',
          conflictStrategy: 'version-vector',
        },
      })

      await store.startMultiMaster()

      // Write creates local vector clock
      const initial = await store.write({
        $id: 'doc-1',
        $type: 'Document',
        content: 'initial',
      })

      // Update increments local clock
      await store.update('doc-1', { content: 'local-update' })

      // Receive remote update with dominating vector clock
      const remoteVectorClock = {
        'master-a': 2,
        'master-b': 1,
      }

      mockPipeline.simulateEvent({
        type: 'thing.updated',
        entityId: 'doc-1',
        entityType: 'Document',
        payload: {
          $id: 'doc-1',
          $type: 'Document',
          content: 'remote-dominates',
          _vectorClock: remoteVectorClock,
        },
        timestamp: Date.now(),
        idempotencyKey: 'remote-key',
        namespace: 'test-ns',
        sequence: 3,
      })

      await vi.advanceTimersByTimeAsync(100)

      // Then: Remote should win (dominating vector clock)
      const resolved = await store.get('doc-1')
      expect(resolved!.content).toBe('remote-dominates')

      await store.close()
    })

    it('should merge non-conflicting field changes', async () => {
      // Given: A store with field-level merge strategy
      const store = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
        multiMaster: {
          enabled: true,
          masterId: 'master-a',
          conflictStrategy: 'field-merge',
        },
      })

      await store.startMultiMaster()

      // Create initial document
      await store.write({
        $id: 'doc-1',
        $type: 'Document',
        title: 'Original',
        content: 'Original content',
        tags: ['draft'],
      })

      // Local update: change title
      await store.update('doc-1', { title: 'Local Title' })

      // Remote update: change content and tags (no conflict with title)
      mockPipeline.simulateEvent({
        type: 'thing.updated',
        entityId: 'doc-1',
        entityType: 'Document',
        payload: {
          $id: 'doc-1',
          content: 'Remote content',
          tags: ['published'],
        },
        timestamp: Date.now() + 500,
        idempotencyKey: 'remote-key',
        namespace: 'test-ns',
        sequence: 3,
      })

      await vi.advanceTimersByTimeAsync(100)

      // Then: Both changes should be merged
      const merged = await store.get('doc-1')
      expect(merged!.title).toBe('Local Title') // From local
      expect(merged!.content).toBe('Remote content') // From remote
      expect(merged!.tags).toEqual(['published']) // From remote (LWW for same field)

      await store.close()
    })

    it('should track conflict resolution history', async () => {
      // Given: A multi-master store
      const store = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
        multiMaster: {
          enabled: true,
          masterId: 'master-a',
          conflictStrategy: 'lww',
          trackConflictHistory: true,
        },
      })

      await store.startMultiMaster()

      // Create and trigger a conflict
      await store.write({ $id: 'doc-1', $type: 'Document', content: 'v1' })

      mockPipeline.simulateEvent({
        type: 'thing.updated',
        entityId: 'doc-1',
        entityType: 'Document',
        payload: { $id: 'doc-1', content: 'conflicting' },
        timestamp: Date.now() + 100,
        idempotencyKey: 'conflict-key',
        namespace: 'test-ns',
        sequence: 2,
      })

      await vi.advanceTimersByTimeAsync(100)

      // When: Getting conflict history
      const history = await store.getConflictHistory('doc-1')

      // Then: Should have recorded the conflict
      expect(history.length).toBeGreaterThan(0)
      expect(history[0]).toMatchObject({
        entityId: 'doc-1',
        resolution: expect.any(String),
        localVersion: expect.any(Object),
        remoteVersion: expect.any(Object),
      })

      await store.close()
    })

    it('should support custom conflict resolver', async () => {
      // Given: A store with custom conflict resolver
      const customResolutions: Array<{ local: any; remote: any }> = []

      const store = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
        multiMaster: {
          enabled: true,
          masterId: 'master-a',
          conflictResolver: (local, remote) => {
            customResolutions.push({ local, remote })
            // Custom logic: prefer shorter content
            const localContent = (local.value.content as string) || ''
            const remoteContent = (remote.value.content as string) || ''
            if (localContent.length <= remoteContent.length) {
              return { value: local.value, resolution: 'custom' as const }
            }
            return { value: remote.value, resolution: 'custom' as const }
          },
        },
      })

      await store.startMultiMaster()

      // Create and trigger conflict
      await store.write({ $id: 'doc-1', $type: 'Document', content: 'short' })

      mockPipeline.simulateEvent({
        type: 'thing.updated',
        entityId: 'doc-1',
        entityType: 'Document',
        payload: { $id: 'doc-1', content: 'much longer content' },
        timestamp: Date.now() + 100,
        idempotencyKey: 'conflict-key',
        namespace: 'test-ns',
        sequence: 2,
      })

      await vi.advanceTimersByTimeAsync(100)

      // Then: Custom resolver should have been called
      expect(customResolutions.length).toBeGreaterThan(0)

      // And: Local (shorter) should win per custom logic
      const resolved = await store.get('doc-1')
      expect(resolved!.content).toBe('short')

      await store.close()
    })

    it('should report conflict metrics', async () => {
      // Given: A multi-master store
      const store = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
        multiMaster: {
          enabled: true,
          masterId: 'master-a',
        },
      })

      await store.startMultiMaster()

      // Generate some conflicts
      for (let i = 0; i < 5; i++) {
        await store.write({ $id: `doc-${i}`, $type: 'Document', content: 'local' })

        mockPipeline.simulateEvent({
          type: 'thing.updated',
          entityId: `doc-${i}`,
          entityType: 'Document',
          payload: { $id: `doc-${i}`, content: 'remote' },
          timestamp: Date.now() + 100,
          idempotencyKey: `conflict-${i}`,
          namespace: 'test-ns',
          sequence: i + 1,
        })

        await vi.advanceTimersByTimeAsync(50)
      }

      // When: Getting conflict metrics
      const metrics = store.getConflictMetrics()

      // Then: Should report accurate counts
      expect(metrics.conflictsDetected).toBe(5)
      expect(metrics.conflictsResolved).toBe(5)
      expect(metrics.resolutionBreakdown).toBeDefined()

      await store.close()
    })
  })

  // ==========================================================================
  // ADDITIONAL INTEGRATION SCENARIOS
  // ==========================================================================

  describe('Additional Integration Scenarios', () => {
    it('should handle high-throughput writes', async () => {
      // Given: A unified store
      const store = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
        batchSize: 100,
      })

      // When: Writing many entities rapidly
      const writePromises: Promise<WriteResult>[] = []
      for (let i = 0; i < 1000; i++) {
        writePromises.push(
          store.write({
            $type: 'Event',
            name: `Event ${i}`,
            index: i,
          })
        )
      }

      const results = await Promise.all(writePromises)

      // Then: All writes should succeed
      expect(results.every((r) => r.success)).toBe(true)

      // And: All entities should be in state
      const stats = store.getStats()
      expect(stats.entityCount).toBe(1000)

      await store.close()
    })

    it('should preserve write order in pipeline events', async () => {
      // Given: A unified store
      const store = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
      })

      // When: Writing sequentially
      const ids: string[] = []
      for (let i = 0; i < 10; i++) {
        const result = await store.write({
          $type: 'OrderedEvent',
          sequence: i,
        })
        ids.push(result.entity.$id)
      }

      await vi.advanceTimersByTimeAsync(100)

      // Then: Pipeline events should be in order
      expect(mockPipeline.events.length).toBe(10)
      for (let i = 0; i < 10; i++) {
        expect(mockPipeline.events[i].entityId).toBe(ids[i])
      }

      await store.close()
    })

    it('should handle mixed operations correctly', async () => {
      // Given: A unified store
      const store = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
      })

      // When: Performing mixed create/update/delete operations
      const createResult = await store.write({
        $type: 'Customer',
        name: 'Alice',
        status: 'active',
      })

      const updateResult = await store.update(createResult.entity.$id, {
        status: 'premium',
      })

      const deleteResult = await store.delete(createResult.entity.$id)

      // Then: All operations should succeed
      expect(createResult.success).toBe(true)
      expect(updateResult.success).toBe(true)
      expect(deleteResult.success).toBe(true)

      // And: Entity should no longer exist
      const retrieved = await store.get(createResult.entity.$id)
      expect(retrieved).toBeNull()

      // And: Pipeline should have all three events
      await vi.advanceTimersByTimeAsync(100)
      expect(mockPipeline.events.length).toBe(3)
      expect(mockPipeline.events[0].type).toBe('thing.created')
      expect(mockPipeline.events[1].type).toBe('thing.updated')
      expect(mockPipeline.events[2].type).toBe('thing.deleted')

      await store.close()
    })

    it('should expose write path metrics', async () => {
      // Given: A unified store
      const store = new UnifiedStore({
        namespace: 'test-ns',
        pipeline: mockPipeline as any,
        sql: mockSqlite as any,
        enableMetrics: true,
      })

      // When: Performing write operations
      for (let i = 0; i < 10; i++) {
        await store.write({ $type: 'MetricTest', index: i })
      }

      // Then: Metrics should be available
      const metrics = store.getWritePathMetrics()

      expect(metrics.totalWrites).toBe(10)
      expect(metrics.averageWriteLatencyMs).toBeGreaterThanOrEqual(0)
      expect(metrics.pipelineEmitSuccessRate).toBeGreaterThanOrEqual(0)
      expect(metrics.checkpointCount).toBeGreaterThanOrEqual(0)

      await store.close()
    })
  })
})
