/**
 * Network Partition Recovery Tests - TDD RED Phase
 *
 * These tests define expected behavior for network partition recovery scenarios.
 * Network partitions are one of the most challenging distributed systems problems,
 * requiring careful handling to maintain consistency and availability.
 *
 * Test scenarios cover:
 * 1. Leader-follower: Follower catches up after partition heals
 * 2. Leader-follower: No split-brain during partition (only one leader)
 * 3. Multi-master: Conflicts detected after partition heals
 * 4. Multi-master: CRDTs converge after partition
 * 5. Events not lost during partition (buffered and replayed)
 * 6. Clients reconnect automatically after partition heals
 * 7. Partition detection within timeout
 * 8. Graceful degradation during partition
 *
 * NOTE: These tests are designed to FAIL because the partition recovery
 * implementation does not fully exist yet. This is the TDD RED phase.
 *
 * @see /objects/unified-storage/partition-recovery.ts (to be created in GREEN phase)
 * @see /docs/architecture/unified-storage.md for partition recovery architecture
 * @module tests/unified-storage/chaos/partition-recovery.test
 * @issue do-ft1y
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Import from non-existent module - this will cause tests to fail
import {
  PartitionRecoveryManager,
  type PartitionRecoveryConfig,
  type PartitionState,
  type RecoveryEvent,
  type PartitionMetrics,
  NetworkSimulator,
  type NetworkPartition,
} from '../../../objects/unified-storage/partition-recovery'

// Import related modules for integration tests
import {
  LeaderFollowerManager,
  ReplicationRole,
  type ReplicationEvent,
  type QuorumCallback,
} from '../../../objects/unified-storage/leader-follower'

import {
  MultiMasterManager,
  VectorClock,
  type MultiMasterConfig,
} from '../../../objects/unified-storage/multi-master'

// ============================================================================
// QUORUM HELPERS
// ============================================================================

/**
 * Create a quorum callback that always grants quorum
 */
const createAllowAllQuorumCallback = (): QuorumCallback => {
  return async () => true
}

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Creates a mock Pipeline that can simulate network partitions
 */
function createPartitionablePipeline() {
  const events: unknown[] = []
  const subscribers = new Map<string, Set<(event: unknown) => Promise<void>>>()
  const partitions = new Set<string>() // Node IDs that are partitioned
  let globalPartition = false // Complete network partition

  return {
    send: vi.fn(async (batch: unknown[], senderId?: string) => {
      if (globalPartition) {
        throw new Error('NETWORK_PARTITION: Pipeline unreachable')
      }
      if (senderId && partitions.has(senderId)) {
        throw new Error(`NETWORK_PARTITION: Node ${senderId} is partitioned`)
      }

      events.push(...batch)

      // Deliver to non-partitioned subscribers
      for (const [nodeId, handlers] of subscribers) {
        if (!partitions.has(nodeId)) {
          for (const handler of handlers) {
            for (const event of batch) {
              await handler(event)
            }
          }
        }
      }
    }),

    subscribe: vi.fn((nodeId: string, handler: (event: unknown) => Promise<void>) => {
      if (!subscribers.has(nodeId)) {
        subscribers.set(nodeId, new Set())
      }
      subscribers.get(nodeId)!.add(handler)
      return () => subscribers.get(nodeId)?.delete(handler)
    }),

    // Test helpers for simulating partitions
    partitionNode: (nodeId: string) => {
      partitions.add(nodeId)
    },

    healNode: (nodeId: string) => {
      partitions.delete(nodeId)
    },

    createGlobalPartition: () => {
      globalPartition = true
    },

    healGlobalPartition: () => {
      globalPartition = false
    },

    isPartitioned: (nodeId: string) => partitions.has(nodeId),

    isGlobalPartition: () => globalPartition,

    getEvents: () => [...events],

    getBufferedEvents: (fromSequence?: number) => {
      if (fromSequence === undefined) return [...events]
      return events.filter((e: any) => e.sequence > fromSequence)
    },

    clear: () => {
      events.length = 0
      subscribers.clear()
      partitions.clear()
      globalPartition = false
    },
  }
}

type PartitionablePipeline = ReturnType<typeof createPartitionablePipeline>

/**
 * Creates a mock state store with persistence
 */
function createMockStateStore() {
  const state = new Map<string, unknown>()
  let version = 0

  return {
    get: vi.fn((key: string) => state.get(key)),
    set: vi.fn((key: string, value: unknown) => {
      state.set(key, value)
      version++
      return version
    }),
    delete: vi.fn((key: string) => state.delete(key)),
    has: vi.fn((key: string) => state.has(key)),
    getAll: vi.fn(() => new Map(state)),
    getVersion: vi.fn(() => version),
    snapshot: () => new Map(state),
    restore: (snapshot: Map<string, unknown>) => {
      state.clear()
      for (const [k, v] of snapshot) {
        state.set(k, v)
      }
    },
    clear: () => {
      state.clear()
      version = 0
    },
  }
}

type MockStateStore = ReturnType<typeof createMockStateStore>

/**
 * Creates a mock heartbeat service that can simulate failures
 */
function createMockHeartbeatService() {
  const heartbeats = new Map<string, number>()
  const aliveStatus = new Map<string, boolean>()
  const listeners: ((nodeId: string, alive: boolean) => void)[] = []

  return {
    sendHeartbeat: vi.fn((nodeId: string) => {
      heartbeats.set(nodeId, Date.now())
      aliveStatus.set(nodeId, true)
    }),

    getLastHeartbeat: vi.fn((nodeId: string) => heartbeats.get(nodeId)),

    isAlive: vi.fn((nodeId: string, timeoutMs: number) => {
      const status = aliveStatus.get(nodeId)
      if (status === false) return false

      const last = heartbeats.get(nodeId)
      if (!last) return false
      return Date.now() - last < timeoutMs
    }),

    onLeaderStatus: vi.fn((callback: (nodeId: string, alive: boolean) => void) => {
      listeners.push(callback)
      return () => {
        const idx = listeners.indexOf(callback)
        if (idx >= 0) listeners.splice(idx, 1)
      }
    }),

    // Test helpers
    setNodeAlive: (nodeId: string, alive: boolean) => {
      aliveStatus.set(nodeId, alive)
      for (const listener of listeners) {
        listener(nodeId, alive)
      }
    },

    simulateTimeout: (nodeId: string) => {
      // Set last heartbeat to long ago
      heartbeats.set(nodeId, Date.now() - 100000)
      aliveStatus.set(nodeId, false)
      for (const listener of listeners) {
        listener(nodeId, false)
      }
    },

    clear: () => {
      heartbeats.clear()
      aliveStatus.clear()
      listeners.length = 0
    },
  }
}

type MockHeartbeatService = ReturnType<typeof createMockHeartbeatService>

/**
 * Creates a mock client connection
 */
function createMockClient(clientId: string) {
  return {
    id: clientId,
    isConnected: vi.fn(() => true),
    send: vi.fn(async (_message: unknown) => {}),
    onReconnect: vi.fn(),
    onDisconnect: vi.fn(),
    bufferedMessages: [] as unknown[],
    connectionState: 'connected' as 'connected' | 'disconnected' | 'reconnecting',
  }
}

type MockClient = ReturnType<typeof createMockClient>

// ============================================================================
// TESTS: LEADER-FOLLOWER PARTITION RECOVERY
// ============================================================================

describe('Network Partition Recovery', () => {
  let mockPipeline: PartitionablePipeline
  let mockHeartbeat: MockHeartbeatService

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockPipeline = createPartitionablePipeline()
    mockHeartbeat = createMockHeartbeatService()
  })

  afterEach(() => {
    vi.useRealTimers()
    mockPipeline.clear()
    mockHeartbeat.clear()
  })

  // ==========================================================================
  // LEADER-FOLLOWER: FOLLOWER CATCH-UP AFTER PARTITION HEALS
  // ==========================================================================

  describe('Leader-Follower: Follower catches up after partition heals', () => {
    let leader: LeaderFollowerManager
    let follower: LeaderFollowerManager
    let leaderStore: MockStateStore
    let followerStore: MockStateStore

    beforeEach(() => {
      leaderStore = createMockStateStore()
      followerStore = createMockStateStore()

      const quorumCallback = createAllowAllQuorumCallback()

      leader = new LeaderFollowerManager({
        nodeId: 'leader-node',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline as any,
        stateStore: leaderStore as any,
        namespace: 'test-ns',
        heartbeatService: mockHeartbeat as any,
        quorumCallback,
      })

      follower = new LeaderFollowerManager({
        nodeId: 'follower-node',
        role: ReplicationRole.Follower,
        pipeline: mockPipeline as any,
        stateStore: followerStore as any,
        namespace: 'test-ns',
        leaderId: 'leader-node',
        heartbeatService: mockHeartbeat as any,
        quorumCallback,
      })
    })

    afterEach(async () => {
      await leader?.close()
      await follower?.close()
    })

    it('should buffer events during partition and replay after healing', async () => {
      // Given: Leader and follower are connected
      await follower.start()

      // Initial sync
      await leader.write({ key: 'item-1', value: { id: 1 }, operation: 'create' })
      await vi.advanceTimersByTimeAsync(50)

      expect(followerStore.set).toHaveBeenCalledWith('item-1', expect.any(Object))

      // When: Network partition occurs
      mockPipeline.partitionNode('follower-node')

      // Leader writes during partition
      await leader.write({ key: 'item-2', value: { id: 2 }, operation: 'create' })
      await leader.write({ key: 'item-3', value: { id: 3 }, operation: 'create' })
      await leader.write({ key: 'item-4', value: { id: 4 }, operation: 'create' })

      await vi.advanceTimersByTimeAsync(100)

      // Follower should NOT have received partition-period writes
      expect(followerStore.set).not.toHaveBeenCalledWith('item-2', expect.any(Object))
      expect(followerStore.set).not.toHaveBeenCalledWith('item-3', expect.any(Object))
      expect(followerStore.set).not.toHaveBeenCalledWith('item-4', expect.any(Object))

      // When: Partition heals
      mockPipeline.healNode('follower-node')

      // Trigger catch-up
      await follower.requestCatchUp()
      await vi.advanceTimersByTimeAsync(200)

      // Then: Follower should have all data
      expect(followerStore.set).toHaveBeenCalledWith('item-2', expect.any(Object))
      expect(followerStore.set).toHaveBeenCalledWith('item-3', expect.any(Object))
      expect(followerStore.set).toHaveBeenCalledWith('item-4', expect.any(Object))
    })

    it('should track replication lag during partition', async () => {
      await follower.start()

      // Initial state - no lag
      expect(follower.getReplicationLag()).toBe(0)

      // Partition follower
      mockPipeline.partitionNode('follower-node')

      // Leader writes
      await leader.write({ key: 'item-1', value: { id: 1 }, operation: 'create' })
      await leader.write({ key: 'item-2', value: { id: 2 }, operation: 'create' })
      await leader.write({ key: 'item-3', value: { id: 3 }, operation: 'create' })

      await vi.advanceTimersByTimeAsync(100)

      // Follower should report lag
      const lag = follower.getReplicationLag()
      expect(lag).toBeGreaterThan(0)
    })

    it('should resume from correct sequence after recovery', async () => {
      await follower.start()

      // Write some events
      await leader.write({ key: 'item-1', value: { id: 1 }, operation: 'create' })
      await leader.write({ key: 'item-2', value: { id: 2 }, operation: 'create' })
      await vi.advanceTimersByTimeAsync(50)

      // Record applied sequence
      const prePartitionSequence = follower.getAppliedSequence()

      // Partition
      mockPipeline.partitionNode('follower-node')

      // More writes
      await leader.write({ key: 'item-3', value: { id: 3 }, operation: 'create' })
      await leader.write({ key: 'item-4', value: { id: 4 }, operation: 'create' })
      await vi.advanceTimersByTimeAsync(50)

      // Heal and recover
      mockPipeline.healNode('follower-node')
      await follower.requestCatchUp(prePartitionSequence)
      await vi.advanceTimersByTimeAsync(100)

      // Should have caught up
      const postRecoverySequence = follower.getAppliedSequence()
      expect(postRecoverySequence).toBeGreaterThan(prePartitionSequence)
    })

    it('should maintain data consistency after recovery', async () => {
      await follower.start()

      // Pre-partition writes
      await leader.write({ key: 'user-1', value: { name: 'Alice', age: 25 }, operation: 'create' })
      await vi.advanceTimersByTimeAsync(50)

      // Partition
      mockPipeline.partitionNode('follower-node')

      // Update during partition
      await leader.write({ key: 'user-1', value: { name: 'Alice', age: 26 }, operation: 'update' })
      await leader.write({ key: 'user-2', value: { name: 'Bob', age: 30 }, operation: 'create' })
      await vi.advanceTimersByTimeAsync(50)

      // Heal
      mockPipeline.healNode('follower-node')
      await follower.requestCatchUp()
      await vi.advanceTimersByTimeAsync(100)

      // Verify consistency
      const leaderSnapshot = leaderStore.snapshot()
      const followerSnapshot = followerStore.snapshot()

      expect(followerSnapshot.size).toBe(leaderSnapshot.size)

      for (const [key, value] of leaderSnapshot) {
        expect(followerSnapshot.get(key)).toEqual(value)
      }
    })

    it('should emit recovery complete event', async () => {
      await follower.start()

      const recoveryHandler = vi.fn()
      follower.on('recoveryComplete', recoveryHandler)

      // Partition and write
      mockPipeline.partitionNode('follower-node')
      await leader.write({ key: 'item-1', value: { id: 1 }, operation: 'create' })
      await vi.advanceTimersByTimeAsync(50)

      // Heal
      mockPipeline.healNode('follower-node')
      await follower.requestCatchUp()
      await vi.advanceTimersByTimeAsync(100)

      expect(recoveryHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          eventsRecovered: expect.any(Number),
          recoveryDurationMs: expect.any(Number),
        })
      )
    })
  })

  // ==========================================================================
  // LEADER-FOLLOWER: NO SPLIT-BRAIN DURING PARTITION
  // ==========================================================================

  describe('Leader-Follower: No split-brain during partition (only one leader)', () => {
    let leader: LeaderFollowerManager
    let follower1: LeaderFollowerManager
    let follower2: LeaderFollowerManager

    beforeEach(() => {
      const quorumCallback = createAllowAllQuorumCallback()

      leader = new LeaderFollowerManager({
        nodeId: 'leader-node',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline as any,
        stateStore: createMockStateStore() as any,
        namespace: 'test-ns',
        heartbeatService: mockHeartbeat as any,
        heartbeatIntervalMs: 1000,
        quorumCallback,
      })

      follower1 = new LeaderFollowerManager({
        nodeId: 'follower-1',
        role: ReplicationRole.Follower,
        pipeline: mockPipeline as any,
        stateStore: createMockStateStore() as any,
        namespace: 'test-ns',
        leaderId: 'leader-node',
        heartbeatService: mockHeartbeat as any,
        heartbeatTimeoutMs: 5000,
        quorumCallback,
      })

      follower2 = new LeaderFollowerManager({
        nodeId: 'follower-2',
        role: ReplicationRole.Follower,
        pipeline: mockPipeline as any,
        stateStore: createMockStateStore() as any,
        namespace: 'test-ns',
        leaderId: 'leader-node',
        heartbeatService: mockHeartbeat as any,
        heartbeatTimeoutMs: 5000,
        quorumCallback,
      })
    })

    afterEach(async () => {
      await leader?.close()
      await follower1?.close()
      await follower2?.close()
    })

    it('should not allow multiple leaders during partition', async () => {
      await leader.start()
      await follower1.start()
      await follower2.start()

      // Count initial leaders
      const countLeaders = () => {
        let count = 0
        if (leader.getRole() === ReplicationRole.Leader) count++
        if (follower1.getRole() === ReplicationRole.Leader) count++
        if (follower2.getRole() === ReplicationRole.Leader) count++
        return count
      }

      expect(countLeaders()).toBe(1)

      // Simulate leader becoming unreachable by some followers
      mockPipeline.partitionNode('follower-1')
      mockHeartbeat.simulateTimeout('leader-node')

      await vi.advanceTimersByTimeAsync(10000)

      // Even with partition, there should still be only one leader
      // Followers should NOT auto-promote without consensus
      expect(countLeaders()).toBeLessThanOrEqual(1)
    })

    it('should use fencing tokens to prevent stale leader writes', async () => {
      await leader.start()
      await follower1.start()

      // Get initial fencing token
      const initialToken = leader.getFencingToken()
      expect(initialToken).toBeDefined()

      // Partition leader
      mockPipeline.partitionNode('leader-node')
      mockHeartbeat.simulateTimeout('leader-node')

      await vi.advanceTimersByTimeAsync(10000)

      // If follower promotes (with consensus), it should have higher token
      await follower1.promote()

      const newToken = follower1.getFencingToken()
      expect(newToken).toBeGreaterThan(initialToken!)

      // Old leader's writes should be rejected based on stale token
      mockPipeline.healNode('leader-node')

      const result = await leader.write({
        key: 'stale-write',
        value: { id: 'stale' },
        operation: 'create',
      })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('STALE_LEADER')
    })

    it('should require quorum for leader election', async () => {
      await leader.start()
      await follower1.start()
      await follower2.start()

      // Partition leader AND follower2 (no quorum available to follower1)
      mockPipeline.partitionNode('leader-node')
      mockPipeline.partitionNode('follower-2')
      mockHeartbeat.simulateTimeout('leader-node')

      await vi.advanceTimersByTimeAsync(10000)

      // Follower1 alone should NOT be able to become leader
      const canPromote = await follower1.canAchieveQuorum()
      expect(canPromote).toBe(false)

      // Attempting promotion without quorum should fail
      await expect(follower1.promote()).rejects.toThrow(/quorum/i)
    })

    it('should step down old leader when partition heals', async () => {
      await leader.start()
      await follower1.start()

      // Simulate partition where follower promotes
      mockPipeline.partitionNode('leader-node')
      mockHeartbeat.simulateTimeout('leader-node')
      await vi.advanceTimersByTimeAsync(10000)

      // Force promote follower (simulating successful election in partition)
      await follower1.forcePromote() // Test helper that bypasses quorum

      expect(follower1.getRole()).toBe(ReplicationRole.Leader)

      // Heal partition
      mockPipeline.healNode('leader-node')
      await vi.advanceTimersByTimeAsync(1000)

      // Old leader should detect new leader and step down
      await leader.detectNewLeader()

      expect(leader.getRole()).toBe(ReplicationRole.Follower)
    })

    it('should detect and resolve split-brain scenario', async () => {
      await leader.start()
      await follower1.start()

      // Artificially create split-brain (shouldn't happen normally)
      await follower1.forcePromote()

      // Both think they're leader
      expect(leader.getRole()).toBe(ReplicationRole.Leader)
      expect(follower1.getRole()).toBe(ReplicationRole.Leader)

      // Resolution should pick one (highest fencing token)
      await leader.resolveSplitBrain()
      await follower1.resolveSplitBrain()

      await vi.advanceTimersByTimeAsync(1000)

      // Only one should remain leader
      const leaderCount =
        (leader.getRole() === ReplicationRole.Leader ? 1 : 0) +
        (follower1.getRole() === ReplicationRole.Leader ? 1 : 0)

      expect(leaderCount).toBe(1)
    })
  })

  // ==========================================================================
  // MULTI-MASTER: CONFLICTS DETECTED AFTER PARTITION HEALS
  // ==========================================================================

  describe('Multi-Master: Conflicts detected after partition heals', () => {
    let masterA: MultiMasterManager
    let masterB: MultiMasterManager
    let storeA: MockStateStore
    let storeB: MockStateStore

    beforeEach(() => {
      storeA = createMockStateStore()
      storeB = createMockStateStore()

      masterA = new MultiMasterManager({
        masterId: 'master-a',
        pipeline: mockPipeline as any,
        stateManager: storeA as any,
        conflictStrategy: 'detect',
      })

      masterB = new MultiMasterManager({
        masterId: 'master-b',
        pipeline: mockPipeline as any,
        stateManager: storeB as any,
        conflictStrategy: 'detect',
      })
    })

    afterEach(async () => {
      await masterA?.close?.()
      await masterB?.close?.()
    })

    it('should detect concurrent writes during partition as conflicts', async () => {
      await masterA.subscribe()
      await masterB.subscribe()

      // Create initial data
      await masterA.write('entity-1', { value: 'initial' })
      await vi.advanceTimersByTimeAsync(50)

      // Create partition
      mockPipeline.createGlobalPartition()

      // Concurrent writes during partition
      await masterA.write('entity-1', { value: 'from-a' })
      await masterB.write('entity-1', { value: 'from-b' })

      await vi.advanceTimersByTimeAsync(100)

      // Heal partition
      mockPipeline.healGlobalPartition()

      // Trigger sync
      await masterA.syncWithRemote()
      await masterB.syncWithRemote()

      await vi.advanceTimersByTimeAsync(200)

      // Both should detect conflicts
      const conflictsA = await masterA.getConflicts()
      const conflictsB = await masterB.getConflicts()

      expect(conflictsA.length).toBeGreaterThan(0)
      expect(conflictsB.length).toBeGreaterThan(0)

      // Conflict should reference entity-1
      expect(conflictsA.some((c) => c.entityId === 'entity-1')).toBe(true)
    })

    it('should record conflict versions from both sides', async () => {
      await masterA.subscribe()
      await masterB.subscribe()

      // Partition
      mockPipeline.createGlobalPartition()

      // Concurrent writes
      await masterA.write('user-1', { name: 'Alice-A', department: 'Engineering' })
      await masterB.write('user-1', { name: 'Alice-B', department: 'Sales' })

      await vi.advanceTimersByTimeAsync(50)

      // Heal
      mockPipeline.healGlobalPartition()
      await masterA.syncWithRemote()
      await vi.advanceTimersByTimeAsync(100)

      const conflicts = await masterA.getConflicts()
      const userConflict = conflicts.find((c) => c.entityId === 'user-1')

      expect(userConflict).toBeDefined()
      expect(userConflict!.versions).toHaveLength(2)

      const versionA = userConflict!.versions.find((v) => v.masterId === 'master-a')
      const versionB = userConflict!.versions.find((v) => v.masterId === 'master-b')

      expect(versionA!.data.name).toBe('Alice-A')
      expect(versionB!.data.name).toBe('Alice-B')
    })

    it('should not flag non-conflicting concurrent writes', async () => {
      await masterA.subscribe()
      await masterB.subscribe()

      // Partition
      mockPipeline.createGlobalPartition()

      // Write to DIFFERENT entities during partition
      await masterA.write('entity-a', { source: 'A' })
      await masterB.write('entity-b', { source: 'B' })

      await vi.advanceTimersByTimeAsync(50)

      // Heal
      mockPipeline.healGlobalPartition()
      await masterA.syncWithRemote()
      await masterB.syncWithRemote()
      await vi.advanceTimersByTimeAsync(100)

      // No conflicts - different entities
      const conflictsA = await masterA.getConflicts()
      expect(conflictsA.length).toBe(0)

      // Both should have both entities
      expect(await masterA.getEntity('entity-a')).toBeDefined()
      expect(await masterA.getEntity('entity-b')).toBeDefined()
      expect(await masterB.getEntity('entity-a')).toBeDefined()
      expect(await masterB.getEntity('entity-b')).toBeDefined()
    })

    it('should allow manual conflict resolution after partition', async () => {
      await masterA.subscribe()
      await masterB.subscribe()

      // Create conflict
      mockPipeline.createGlobalPartition()

      await masterA.write('entity-1', { value: 'A' })
      await masterB.write('entity-1', { value: 'B' })

      await vi.advanceTimersByTimeAsync(50)

      mockPipeline.healGlobalPartition()
      await masterA.syncWithRemote()
      await vi.advanceTimersByTimeAsync(100)

      // Resolve conflict manually
      await masterA.resolveConflict('entity-1', { value: 'merged-value' })

      await vi.advanceTimersByTimeAsync(100)

      // Conflict should be cleared
      const conflicts = await masterA.getConflicts()
      expect(conflicts.find((c) => c.entityId === 'entity-1')).toBeUndefined()

      // Resolved value should propagate
      const entityA = await masterA.getEntity('entity-1')
      const entityB = await masterB.getEntity('entity-1')

      expect(entityA!.data.value).toBe('merged-value')
      expect(entityB!.data.value).toBe('merged-value')
    })
  })

  // ==========================================================================
  // MULTI-MASTER: CRDTS CONVERGE AFTER PARTITION
  // ==========================================================================

  describe('Multi-Master: CRDTs converge after partition', () => {
    let masterA: MultiMasterManager
    let masterB: MultiMasterManager

    beforeEach(() => {
      masterA = new MultiMasterManager({
        masterId: 'master-a',
        pipeline: mockPipeline as any,
        stateManager: createMockStateStore() as any,
        conflictStrategy: 'crdt',
      })

      masterB = new MultiMasterManager({
        masterId: 'master-b',
        pipeline: mockPipeline as any,
        stateManager: createMockStateStore() as any,
        conflictStrategy: 'crdt',
      })
    })

    afterEach(async () => {
      await masterA?.close?.()
      await masterB?.close?.()
    })

    it('should converge G-Counter after partition', async () => {
      await masterA.subscribe()
      await masterB.subscribe()

      // Initialize counter
      await masterA.writeCounter('page-views', 0)
      await vi.advanceTimersByTimeAsync(50)

      // Partition
      mockPipeline.createGlobalPartition()

      // Concurrent increments
      await masterA.incrementCounter('page-views', 10)
      await masterA.incrementCounter('page-views', 5)

      await masterB.incrementCounter('page-views', 20)
      await masterB.incrementCounter('page-views', 3)

      await vi.advanceTimersByTimeAsync(50)

      // Heal
      mockPipeline.healGlobalPartition()
      await masterA.syncWithRemote()
      await masterB.syncWithRemote()
      await vi.advanceTimersByTimeAsync(200)

      // Both should converge to same value (sum of all increments)
      const counterA = await masterA.getCounter('page-views')
      const counterB = await masterB.getCounter('page-views')

      expect(counterA).toBe(counterB)
      expect(counterA).toBe(38) // 10 + 5 + 20 + 3
    })

    it('should converge G-Set after partition', async () => {
      await masterA.subscribe()
      await masterB.subscribe()

      // Partition
      mockPipeline.createGlobalPartition()

      // Add different elements during partition
      await masterA.addToSet('tags', 'important')
      await masterA.addToSet('tags', 'urgent')

      await masterB.addToSet('tags', 'urgent') // Duplicate
      await masterB.addToSet('tags', 'review')

      await vi.advanceTimersByTimeAsync(50)

      // Heal
      mockPipeline.healGlobalPartition()
      await masterA.syncWithRemote()
      await masterB.syncWithRemote()
      await vi.advanceTimersByTimeAsync(200)

      // Both should have union of all elements
      const setA = await masterA.getSet('tags')
      const setB = await masterB.getSet('tags')

      expect(setA).toEqual(setB)
      expect(setA).toContain('important')
      expect(setA).toContain('urgent')
      expect(setA).toContain('review')
      expect(setA).toHaveLength(3) // Deduplicated
    })

    it('should converge LWW-Register after partition', async () => {
      await masterA.subscribe()
      await masterB.subscribe()

      // Partition
      mockPipeline.createGlobalPartition()

      // Concurrent writes with different timestamps
      vi.setSystemTime(new Date('2026-01-14T12:00:01.000Z'))
      await masterA.writeRegister('status', 'pending')

      vi.setSystemTime(new Date('2026-01-14T12:00:02.000Z'))
      await masterB.writeRegister('status', 'approved')

      await vi.advanceTimersByTimeAsync(50)

      // Heal
      mockPipeline.healGlobalPartition()
      await masterA.syncWithRemote()
      await masterB.syncWithRemote()
      await vi.advanceTimersByTimeAsync(200)

      // Both should converge to later write
      const registerA = await masterA.getRegister('status')
      const registerB = await masterB.getRegister('status')

      expect(registerA).toBe('approved')
      expect(registerB).toBe('approved')
    })

    it('should converge PN-Counter after partition', async () => {
      await masterA.subscribe()
      await masterB.subscribe()

      // Initialize
      await masterA.writePNCounter('balance', 100)
      await vi.advanceTimersByTimeAsync(50)

      // Partition
      mockPipeline.createGlobalPartition()

      // Concurrent increments and decrements
      await masterA.incrementPNCounter('balance', 50) // +50
      await masterA.decrementPNCounter('balance', 20) // -20

      await masterB.decrementPNCounter('balance', 30) // -30
      await masterB.incrementPNCounter('balance', 10) // +10

      await vi.advanceTimersByTimeAsync(50)

      // Heal
      mockPipeline.healGlobalPartition()
      await masterA.syncWithRemote()
      await masterB.syncWithRemote()
      await vi.advanceTimersByTimeAsync(200)

      // Both should converge: 100 + 50 - 20 - 30 + 10 = 110
      const balanceA = await masterA.getPNCounter('balance')
      const balanceB = await masterB.getPNCounter('balance')

      expect(balanceA).toBe(balanceB)
      expect(balanceA).toBe(110)
    })

    it('should handle nested CRDTs in documents', async () => {
      await masterA.subscribe()
      await masterB.subscribe()

      // Partition
      mockPipeline.createGlobalPartition()

      // Complex document with multiple CRDT fields
      await masterA.writeCRDTDocument('doc-1', {
        title: { type: 'lww-register', value: 'Draft' },
        views: { type: 'g-counter', value: 0 },
        tags: { type: 'g-set', values: ['draft'] },
      })

      await masterB.writeCRDTDocument('doc-1', {
        title: { type: 'lww-register', value: 'Published' },
        views: { type: 'g-counter', value: 100 },
        tags: { type: 'g-set', values: ['published'] },
      })

      await vi.advanceTimersByTimeAsync(50)

      // Heal
      mockPipeline.healGlobalPartition()
      await masterA.syncWithRemote()
      await masterB.syncWithRemote()
      await vi.advanceTimersByTimeAsync(200)

      // Check convergence
      const docA = await masterA.getCRDTDocument('doc-1')
      const docB = await masterB.getCRDTDocument('doc-1')

      expect(docA).toEqual(docB)

      // LWW should pick later, counters sum, sets union
      expect(docA.views.value).toBe(100) // Max of concurrent creates
      expect(docA.tags.values).toContain('draft')
      expect(docA.tags.values).toContain('published')
    })
  })

  // ==========================================================================
  // EVENTS NOT LOST DURING PARTITION (BUFFERED AND REPLAYED)
  // ==========================================================================

  describe('Events not lost during partition (buffered and replayed)', () => {
    let partitionManager: PartitionRecoveryManager

    beforeEach(() => {
      partitionManager = new PartitionRecoveryManager({
        nodeId: 'node-1',
        pipeline: mockPipeline as any,
        bufferSize: 10000,
        maxBufferDurationMs: 60000,
      })
    })

    afterEach(async () => {
      await partitionManager?.close()
    })

    it('should buffer outgoing events during partition', async () => {
      await partitionManager.start()

      // Create partition
      mockPipeline.createGlobalPartition()

      // Attempt to send events
      await partitionManager.sendEvent({ type: 'event-1', data: 'first' })
      await partitionManager.sendEvent({ type: 'event-2', data: 'second' })
      await partitionManager.sendEvent({ type: 'event-3', data: 'third' })

      // Events should be buffered
      const bufferSize = partitionManager.getBufferedEventCount()
      expect(bufferSize).toBe(3)

      // Pipeline should not have received them
      expect(mockPipeline.getEvents()).toHaveLength(0)
    })

    it('should replay buffered events when partition heals', async () => {
      await partitionManager.start()

      // Buffer events during partition
      mockPipeline.createGlobalPartition()

      await partitionManager.sendEvent({ type: 'event-1', data: 'first' })
      await partitionManager.sendEvent({ type: 'event-2', data: 'second' })

      expect(partitionManager.getBufferedEventCount()).toBe(2)

      // Heal partition
      mockPipeline.healGlobalPartition()

      // Trigger replay
      await partitionManager.flushBuffer()
      await vi.advanceTimersByTimeAsync(100)

      // Buffer should be empty
      expect(partitionManager.getBufferedEventCount()).toBe(0)

      // Events should be in pipeline
      const pipelineEvents = mockPipeline.getEvents()
      expect(pipelineEvents).toHaveLength(2)
      expect(pipelineEvents[0]).toMatchObject({ type: 'event-1' })
      expect(pipelineEvents[1]).toMatchObject({ type: 'event-2' })
    })

    it('should maintain event order during replay', async () => {
      await partitionManager.start()

      mockPipeline.createGlobalPartition()

      // Send events in specific order
      for (let i = 0; i < 10; i++) {
        await partitionManager.sendEvent({ type: 'event', sequence: i })
      }

      mockPipeline.healGlobalPartition()
      await partitionManager.flushBuffer()
      await vi.advanceTimersByTimeAsync(100)

      // Verify order preserved
      const events = mockPipeline.getEvents()
      for (let i = 0; i < events.length; i++) {
        expect((events[i] as any).sequence).toBe(i)
      }
    })

    it('should handle buffer overflow gracefully', async () => {
      // Small buffer for testing
      const smallBufferManager = new PartitionRecoveryManager({
        nodeId: 'node-1',
        pipeline: mockPipeline as any,
        bufferSize: 3,
        overflowStrategy: 'drop-oldest',
      })

      await smallBufferManager.start()
      mockPipeline.createGlobalPartition()

      // Overflow the buffer
      await smallBufferManager.sendEvent({ type: 'event', id: 1 })
      await smallBufferManager.sendEvent({ type: 'event', id: 2 })
      await smallBufferManager.sendEvent({ type: 'event', id: 3 })
      await smallBufferManager.sendEvent({ type: 'event', id: 4 }) // Overflow

      // Should keep newest 3
      expect(smallBufferManager.getBufferedEventCount()).toBe(3)

      mockPipeline.healGlobalPartition()
      await smallBufferManager.flushBuffer()
      await vi.advanceTimersByTimeAsync(100)

      const events = mockPipeline.getEvents()
      expect(events.map((e: any) => e.id)).toEqual([2, 3, 4])

      await smallBufferManager.close()
    })

    it('should emit metrics about buffered events', async () => {
      await partitionManager.start()

      mockPipeline.createGlobalPartition()

      await partitionManager.sendEvent({ type: 'event-1', data: 'x' })
      await partitionManager.sendEvent({ type: 'event-2', data: 'x' })

      const metrics = partitionManager.getBufferMetrics()

      expect(metrics.bufferedCount).toBe(2)
      expect(metrics.oldestEventAge).toBeGreaterThanOrEqual(0)
      expect(metrics.bufferUtilization).toBeGreaterThan(0)
    })

    it('should timeout and discard very old buffered events', async () => {
      const shortTimeoutManager = new PartitionRecoveryManager({
        nodeId: 'node-1',
        pipeline: mockPipeline as any,
        bufferSize: 1000,
        maxBufferDurationMs: 5000, // 5 second timeout
      })

      await shortTimeoutManager.start()
      mockPipeline.createGlobalPartition()

      await shortTimeoutManager.sendEvent({ type: 'old-event' })

      // Advance time past timeout
      await vi.advanceTimersByTimeAsync(10000)

      // Old event should be discarded
      expect(shortTimeoutManager.getBufferedEventCount()).toBe(0)

      // Metrics should track discarded events
      const metrics = shortTimeoutManager.getBufferMetrics()
      expect(metrics.eventsDiscardedDueToTimeout).toBe(1)

      await shortTimeoutManager.close()
    })
  })

  // ==========================================================================
  // CLIENTS RECONNECT AUTOMATICALLY AFTER PARTITION HEALS
  // ==========================================================================

  describe('Clients reconnect automatically after partition heals', () => {
    let clientManager: PartitionRecoveryManager
    let mockClient1: MockClient
    let mockClient2: MockClient

    beforeEach(() => {
      clientManager = new PartitionRecoveryManager({
        nodeId: 'server-1',
        pipeline: mockPipeline as any,
        reconnectIntervalMs: 1000,
        maxReconnectAttempts: 5,
      })

      mockClient1 = createMockClient('client-1')
      mockClient2 = createMockClient('client-2')
    })

    afterEach(async () => {
      await clientManager?.close()
    })

    it('should detect client disconnection during partition', async () => {
      await clientManager.start()
      await clientManager.registerClient(mockClient1 as any)
      await clientManager.registerClient(mockClient2 as any)

      expect(clientManager.getConnectedClientCount()).toBe(2)

      // Simulate partition disconnecting clients
      mockPipeline.createGlobalPartition()
      clientManager.simulateClientDisconnect('client-1')

      expect(clientManager.getConnectedClientCount()).toBe(1)
      expect(clientManager.getDisconnectedClients()).toContain('client-1')
    })

    it('should auto-reconnect clients when partition heals', async () => {
      await clientManager.start()
      await clientManager.registerClient(mockClient1 as any)

      // Disconnect
      mockPipeline.createGlobalPartition()
      clientManager.simulateClientDisconnect('client-1')

      expect(clientManager.getConnectedClientCount()).toBe(0)

      // Heal partition
      mockPipeline.healGlobalPartition()

      // Trigger reconnection attempts
      await vi.advanceTimersByTimeAsync(2000)

      // Client should be reconnected
      expect(mockClient1.onReconnect).toHaveBeenCalled()
      expect(clientManager.getConnectedClientCount()).toBe(1)
    })

    it('should replay missed events to reconnected clients', async () => {
      await clientManager.start()
      await clientManager.registerClient(mockClient1 as any)

      // Client records last seen sequence
      await clientManager.recordClientSequence('client-1', 5)

      // Partition and generate events
      mockPipeline.createGlobalPartition()
      clientManager.simulateClientDisconnect('client-1')

      // Events happen during partition (sequences 6, 7, 8)
      await clientManager.recordEvent({ sequence: 6, data: 'event-6' })
      await clientManager.recordEvent({ sequence: 7, data: 'event-7' })
      await clientManager.recordEvent({ sequence: 8, data: 'event-8' })

      // Heal and reconnect
      mockPipeline.healGlobalPartition()
      await clientManager.reconnectClient('client-1')

      await vi.advanceTimersByTimeAsync(1000)

      // Client should receive missed events
      expect(mockClient1.send).toHaveBeenCalledWith(
        expect.objectContaining({ sequence: 6 })
      )
      expect(mockClient1.send).toHaveBeenCalledWith(
        expect.objectContaining({ sequence: 7 })
      )
      expect(mockClient1.send).toHaveBeenCalledWith(
        expect.objectContaining({ sequence: 8 })
      )
    })

    it('should respect max reconnect attempts', async () => {
      await clientManager.start()
      await clientManager.registerClient(mockClient1 as any)

      // Disconnect and keep partition
      mockPipeline.createGlobalPartition()
      clientManager.simulateClientDisconnect('client-1')

      // Advance through max retry attempts (still partitioned)
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(1000)
      }

      // Should have stopped trying
      const status = clientManager.getClientStatus('client-1')
      expect(status.reconnectAttempts).toBe(5) // Max attempts
      expect(status.state).toBe('disconnected')
    })

    it('should use exponential backoff for reconnection', async () => {
      await clientManager.start()
      await clientManager.registerClient(mockClient1 as any)

      // Disconnect (partition stays)
      mockPipeline.createGlobalPartition()
      clientManager.simulateClientDisconnect('client-1')

      // Track reconnection attempts
      const attempts: number[] = []

      clientManager.onReconnectAttempt((clientId, attempt, delayMs) => {
        if (clientId === 'client-1') {
          attempts.push(delayMs)
        }
      })

      // Trigger multiple reconnect cycles
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(10000)
      }

      // Delays should increase exponentially
      for (let i = 1; i < attempts.length; i++) {
        expect(attempts[i]).toBeGreaterThanOrEqual(attempts[i - 1]!)
      }
    })

    it('should handle multiple clients reconnecting simultaneously', async () => {
      await clientManager.start()
      await clientManager.registerClient(mockClient1 as any)
      await clientManager.registerClient(mockClient2 as any)

      // Disconnect all
      mockPipeline.createGlobalPartition()
      clientManager.simulateClientDisconnect('client-1')
      clientManager.simulateClientDisconnect('client-2')

      expect(clientManager.getConnectedClientCount()).toBe(0)

      // Heal
      mockPipeline.healGlobalPartition()
      await vi.advanceTimersByTimeAsync(2000)

      // Both should reconnect
      expect(mockClient1.onReconnect).toHaveBeenCalled()
      expect(mockClient2.onReconnect).toHaveBeenCalled()
      expect(clientManager.getConnectedClientCount()).toBe(2)
    })
  })

  // ==========================================================================
  // PARTITION DETECTION WITHIN TIMEOUT
  // ==========================================================================

  describe('Partition detection within timeout', () => {
    let detector: PartitionRecoveryManager

    beforeEach(() => {
      detector = new PartitionRecoveryManager({
        nodeId: 'node-1',
        pipeline: mockPipeline as any,
        partitionDetectionTimeoutMs: 3000,
        heartbeatIntervalMs: 1000,
      })
    })

    afterEach(async () => {
      await detector?.close()
    })

    it('should detect partition within configured timeout', async () => {
      await detector.start()

      const partitionHandler = vi.fn()
      detector.onPartitionDetected(partitionHandler)

      // Simulate network issues
      mockPipeline.createGlobalPartition()

      // Should detect within timeout
      await vi.advanceTimersByTimeAsync(3500)

      expect(partitionHandler).toHaveBeenCalled()
      expect(detector.isPartitioned()).toBe(true)
    })

    it('should track time since last successful communication', async () => {
      await detector.start()

      // Initial state - recently communicated
      expect(detector.getTimeSinceLastCommunication()).toBeLessThan(1000)

      // Partition
      mockPipeline.createGlobalPartition()

      await vi.advanceTimersByTimeAsync(5000)

      // Should track elapsed time
      expect(detector.getTimeSinceLastCommunication()).toBeGreaterThanOrEqual(5000)
    })

    it('should emit partition state changes', async () => {
      await detector.start()

      const stateChanges: PartitionState[] = []
      detector.onStateChange((state) => stateChanges.push(state))

      // Normal -> Partitioned
      mockPipeline.createGlobalPartition()
      await vi.advanceTimersByTimeAsync(4000)

      // Partitioned -> Healing
      mockPipeline.healGlobalPartition()
      await vi.advanceTimersByTimeAsync(1000)

      // Healing -> Normal
      await vi.advanceTimersByTimeAsync(5000)

      expect(stateChanges).toContain('partitioned')
      expect(stateChanges).toContain('healing')
      expect(stateChanges).toContain('normal')
    })

    it('should support configurable detection sensitivity', async () => {
      const sensitiveDetector = new PartitionRecoveryManager({
        nodeId: 'node-2',
        pipeline: mockPipeline as any,
        partitionDetectionTimeoutMs: 1000, // More sensitive
        heartbeatIntervalMs: 200,
      })

      await sensitiveDetector.start()

      const partitionHandler = vi.fn()
      sensitiveDetector.onPartitionDetected(partitionHandler)

      mockPipeline.createGlobalPartition()

      // Should detect faster
      await vi.advanceTimersByTimeAsync(1500)

      expect(partitionHandler).toHaveBeenCalled()

      await sensitiveDetector.close()
    })

    it('should distinguish between partition and slow network', async () => {
      await detector.start()

      // Simulate slow network (not partition)
      mockPipeline.send = vi.fn(async (batch) => {
        await new Promise((r) => setTimeout(r, 2000)) // Slow but succeeds
        return batch
      })

      await vi.advanceTimersByTimeAsync(4000)

      // Should NOT be detected as partition (messages still succeed)
      expect(detector.isPartitioned()).toBe(false)
    })

    it('should detect partial partition (some nodes unreachable)', async () => {
      await detector.start()

      // Partition only specific nodes
      mockPipeline.partitionNode('node-2')

      await vi.advanceTimersByTimeAsync(4000)

      const partitionInfo = detector.getPartitionInfo()

      expect(partitionInfo.type).toBe('partial')
      expect(partitionInfo.unreachableNodes).toContain('node-2')
    })
  })

  // ==========================================================================
  // GRACEFUL DEGRADATION DURING PARTITION
  // ==========================================================================

  describe('Graceful degradation during partition', () => {
    let degradationManager: PartitionRecoveryManager

    beforeEach(() => {
      degradationManager = new PartitionRecoveryManager({
        nodeId: 'node-1',
        pipeline: mockPipeline as any,
        degradationConfig: {
          allowLocalReads: true,
          allowLocalWrites: true,
          queueRemoteOperations: true,
          maxQueueSize: 1000,
        },
      })
    })

    afterEach(async () => {
      await degradationManager?.close()
    })

    it('should continue serving local reads during partition', async () => {
      await degradationManager.start()

      // Store some data locally
      await degradationManager.setLocal('key-1', { value: 'local-data' })

      // Create partition
      mockPipeline.createGlobalPartition()
      await vi.advanceTimersByTimeAsync(4000)

      // Local reads should still work
      const result = await degradationManager.getLocal('key-1')
      expect(result).toEqual({ value: 'local-data' })
    })

    it('should queue remote operations during partition', async () => {
      await degradationManager.start()

      mockPipeline.createGlobalPartition()
      await vi.advanceTimersByTimeAsync(4000)

      // Attempt remote operation
      const result = await degradationManager.remoteWrite('key-1', { value: 'data' })

      expect(result.status).toBe('queued')
      expect(degradationManager.getQueuedOperationCount()).toBe(1)
    })

    it('should execute queued operations when partition heals', async () => {
      await degradationManager.start()

      mockPipeline.createGlobalPartition()
      await vi.advanceTimersByTimeAsync(4000)

      // Queue operations
      await degradationManager.remoteWrite('key-1', { value: 'data-1' })
      await degradationManager.remoteWrite('key-2', { value: 'data-2' })

      expect(degradationManager.getQueuedOperationCount()).toBe(2)

      // Heal partition
      mockPipeline.healGlobalPartition()
      await degradationManager.processQueue()
      await vi.advanceTimersByTimeAsync(1000)

      // Queue should be empty and operations executed
      expect(degradationManager.getQueuedOperationCount()).toBe(0)
      expect(mockPipeline.send).toHaveBeenCalled()
    })

    it('should report degraded status during partition', async () => {
      await degradationManager.start()

      expect(degradationManager.getOperationalStatus()).toBe('normal')

      mockPipeline.createGlobalPartition()
      await vi.advanceTimersByTimeAsync(4000)

      expect(degradationManager.getOperationalStatus()).toBe('degraded')

      mockPipeline.healGlobalPartition()
      await vi.advanceTimersByTimeAsync(5000)

      expect(degradationManager.getOperationalStatus()).toBe('normal')
    })

    it('should expose partition metrics for monitoring', async () => {
      await degradationManager.start()

      mockPipeline.createGlobalPartition()
      await vi.advanceTimersByTimeAsync(4000)

      await degradationManager.remoteWrite('key-1', { value: 'data' })
      await degradationManager.remoteWrite('key-2', { value: 'data' })

      const metrics = degradationManager.getPartitionMetrics()

      expect(metrics.isPartitioned).toBe(true)
      expect(metrics.partitionDurationMs).toBeGreaterThanOrEqual(4000)
      expect(metrics.queuedOperations).toBe(2)
      expect(metrics.localOperationsServed).toBeGreaterThan(0)
    })

    it('should limit queue size and reject operations when full', async () => {
      const smallQueueManager = new PartitionRecoveryManager({
        nodeId: 'node-1',
        pipeline: mockPipeline as any,
        degradationConfig: {
          allowLocalReads: true,
          allowLocalWrites: true,
          queueRemoteOperations: true,
          maxQueueSize: 3,
        },
      })

      await smallQueueManager.start()

      mockPipeline.createGlobalPartition()
      await vi.advanceTimersByTimeAsync(4000)

      // Fill queue
      await smallQueueManager.remoteWrite('key-1', { value: 'data' })
      await smallQueueManager.remoteWrite('key-2', { value: 'data' })
      await smallQueueManager.remoteWrite('key-3', { value: 'data' })

      // Next should be rejected
      const result = await smallQueueManager.remoteWrite('key-4', { value: 'data' })

      expect(result.status).toBe('rejected')
      expect(result.reason).toMatch(/queue.*full/i)

      await smallQueueManager.close()
    })

    it('should provide estimated recovery time', async () => {
      await degradationManager.start()

      mockPipeline.createGlobalPartition()
      await vi.advanceTimersByTimeAsync(4000)

      // Queue some operations
      for (let i = 0; i < 10; i++) {
        await degradationManager.remoteWrite(`key-${i}`, { value: 'data' })
      }

      const estimate = degradationManager.getEstimatedRecoveryTime()

      // Should provide some estimate based on queue size
      expect(estimate).toBeDefined()
      expect(estimate).toBeGreaterThan(0)
    })

    it('should allow configuring which operations are allowed during degradation', async () => {
      const strictManager = new PartitionRecoveryManager({
        nodeId: 'node-1',
        pipeline: mockPipeline as any,
        degradationConfig: {
          allowLocalReads: true,
          allowLocalWrites: false, // No local writes during partition
          queueRemoteOperations: false, // Don't queue
          maxQueueSize: 0,
        },
      })

      await strictManager.start()

      mockPipeline.createGlobalPartition()
      await vi.advanceTimersByTimeAsync(4000)

      // Local write should be rejected
      const writeResult = await strictManager.localWrite('key-1', { value: 'data' })
      expect(writeResult.success).toBe(false)
      expect(writeResult.error).toMatch(/not.*allowed.*partition/i)

      // Remote operation should be rejected (not queued)
      const remoteResult = await strictManager.remoteWrite('key-2', { value: 'data' })
      expect(remoteResult.status).toBe('rejected')

      await strictManager.close()
    })
  })

  // ==========================================================================
  // PARTITION RECOVERY METRICS AND OBSERVABILITY
  // ==========================================================================

  describe('Partition recovery metrics and observability', () => {
    let manager: PartitionRecoveryManager

    beforeEach(() => {
      manager = new PartitionRecoveryManager({
        nodeId: 'node-1',
        pipeline: mockPipeline as any,
      })
    })

    afterEach(async () => {
      await manager?.close()
    })

    it('should track partition count over time', async () => {
      await manager.start()

      // Simulate multiple partitions
      mockPipeline.createGlobalPartition()
      await vi.advanceTimersByTimeAsync(5000)
      mockPipeline.healGlobalPartition()
      await vi.advanceTimersByTimeAsync(5000)

      mockPipeline.createGlobalPartition()
      await vi.advanceTimersByTimeAsync(5000)
      mockPipeline.healGlobalPartition()
      await vi.advanceTimersByTimeAsync(5000)

      const metrics = manager.getMetrics()
      expect(metrics.totalPartitionCount).toBe(2)
    })

    it('should track total partition duration', async () => {
      await manager.start()

      mockPipeline.createGlobalPartition()
      await vi.advanceTimersByTimeAsync(10000)
      mockPipeline.healGlobalPartition()
      await vi.advanceTimersByTimeAsync(5000)

      const metrics = manager.getMetrics()
      expect(metrics.totalPartitionDurationMs).toBeGreaterThanOrEqual(10000)
    })

    it('should track recovery success/failure rates', async () => {
      await manager.start()

      // Successful recovery
      mockPipeline.createGlobalPartition()
      await vi.advanceTimersByTimeAsync(5000)
      mockPipeline.healGlobalPartition()
      await manager.attemptRecovery()

      // Track success
      const metrics = manager.getMetrics()
      expect(metrics.recoveryAttempts).toBeGreaterThan(0)
      expect(metrics.recoverySuccesses).toBeGreaterThan(0)
    })

    it('should emit partition recovery events for monitoring', async () => {
      await manager.start()

      const events: RecoveryEvent[] = []
      manager.onRecoveryEvent((event) => events.push(event))

      mockPipeline.createGlobalPartition()
      await vi.advanceTimersByTimeAsync(5000)
      mockPipeline.healGlobalPartition()
      await manager.attemptRecovery()
      await vi.advanceTimersByTimeAsync(1000)

      expect(events.some((e) => e.type === 'partition_detected')).toBe(true)
      expect(events.some((e) => e.type === 'recovery_started')).toBe(true)
      expect(events.some((e) => e.type === 'recovery_completed')).toBe(true)
    })
  })
})
