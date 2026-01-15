/**
 * Leader Election Split-Brain Prevention Tests (RED Phase - TDD)
 *
 * Tests for split-brain prevention during leader election.
 * The current promote() method has NO distributed coordination:
 * - Multiple nodes can call promote() simultaneously
 * - No distributed lock mechanism
 * - Risk of split-brain where multiple nodes think they're the leader
 *
 * These tests are designed to FAIL because the implementation lacks:
 * - Distributed locks (e.g., Redis SETNX, etcd, or Raft consensus)
 * - Fencing tokens to prevent stale leaders from writing
 * - Quorum-based leader election
 *
 * @see /objects/unified-storage/leader-follower.ts (promote method needs distributed coordination)
 * @module tests/unified-storage/leader-election.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  LeaderFollowerManager,
  type LeaderFollowerConfig,
  type QuorumCallback,
  ReplicationRole,
} from '../../objects/unified-storage/leader-follower'

// ============================================================================
// MOCK PIPELINE
// ============================================================================

interface MockPipelineOptions {
  sendDelayMs?: number
  errorOnSend?: Error | null
}

const createMockPipeline = (options: MockPipelineOptions = {}) => {
  const events: unknown[] = []
  const subscribers: Map<string, (event: unknown) => void> = new Map()
  let delay = options.sendDelayMs ?? 0
  let error = options.errorOnSend ?? null

  const send = vi.fn(async (batch: unknown[]) => {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    if (error) {
      throw error
    }
    events.push(...batch)
    // Notify all subscribers of new events
    for (const [, callback] of subscribers) {
      for (const event of batch) {
        callback(event)
      }
    }
  })

  const subscribe = vi.fn((namespace: string, callback: (event: unknown) => void) => {
    subscribers.set(namespace, callback)
    return () => subscribers.delete(namespace)
  })

  return {
    send,
    subscribe,
    events,
    subscribers,
    setDelay: (ms: number) => {
      delay = ms
    },
    setError: (err: Error | null) => {
      error = err
    },
    clear: () => {
      events.length = 0
      subscribers.clear()
      send.mockClear()
      subscribe.mockClear()
    },
    simulateEvent: (event: unknown) => {
      for (const [, callback] of subscribers) {
        callback(event)
      }
    },
    getEvents: (fromSequence?: number) => {
      if (fromSequence === undefined) return [...events]
      return events.slice(fromSequence)
    },
  }
}

type MockPipeline = ReturnType<typeof createMockPipeline>

// ============================================================================
// MOCK STATE STORE
// ============================================================================

const createMockStateStore = () => {
  const state: Map<string, unknown> = new Map()
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
    clear: () => {
      state.clear()
      version = 0
    },
  }
}

type MockStateStore = ReturnType<typeof createMockStateStore>

// ============================================================================
// MOCK HEARTBEAT SERVICE
// ============================================================================

const createMockHeartbeatService = () => {
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
// MOCK DISTRIBUTED LOCK SERVICE
// ============================================================================

/**
 * Mock distributed lock service for testing.
 * In production, this would be backed by etcd, Redis SETNX, or Raft consensus.
 */
const createMockDistributedLockService = () => {
  let currentHolder: string | null = null
  let fencingToken = 0

  return {
    /**
     * Attempt to acquire the leader lock
     * Returns fencing token on success, null on failure
     */
    tryAcquireLock: vi.fn(async (nodeId: string): Promise<number | null> => {
      if (currentHolder === null) {
        currentHolder = nodeId
        fencingToken++
        return fencingToken
      }
      return null
    }),
    /**
     * Release the leader lock
     */
    releaseLock: vi.fn(async (nodeId: string): Promise<boolean> => {
      if (currentHolder === nodeId) {
        currentHolder = null
        return true
      }
      return false
    }),
    /**
     * Check who holds the lock
     */
    getCurrentHolder: vi.fn(() => currentHolder),
    /**
     * Get current fencing token
     */
    getFencingToken: vi.fn(() => fencingToken),
    /**
     * Simulate lock expiry (for testing timeouts)
     */
    expireLock: () => {
      currentHolder = null
    },
    clear: () => {
      currentHolder = null
      fencingToken = 0
    },
  }
}

type MockDistributedLockService = ReturnType<typeof createMockDistributedLockService>

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a follower manager with common config
 */
const createFollowerManager = (
  nodeId: string,
  pipeline: MockPipeline,
  stateStore: MockStateStore,
  heartbeatService: MockHeartbeatService,
  options: Partial<LeaderFollowerConfig> = {}
): LeaderFollowerManager => {
  return new LeaderFollowerManager({
    nodeId,
    role: ReplicationRole.Follower,
    pipeline,
    stateStore,
    namespace: 'test-namespace',
    leaderId: 'original-leader',
    heartbeatService,
    promotionEligible: true,
    ...options,
  })
}

// ============================================================================
// SPLIT-BRAIN PREVENTION TESTS
// ============================================================================

describe('LeaderElection Split-Brain Prevention', () => {
  let mockPipeline: MockPipeline
  let mockHeartbeat: MockHeartbeatService
  let mockLock: MockDistributedLockService
  const managers: LeaderFollowerManager[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T10:00:00.000Z'))
    mockPipeline = createMockPipeline()
    mockHeartbeat = createMockHeartbeatService()
    mockLock = createMockDistributedLockService()
  })

  afterEach(async () => {
    // Clean up all managers
    for (const manager of managers) {
      try {
        await manager.close()
      } catch {
        // Ignore close errors
      }
    }
    managers.length = 0
    // Clear global locks between tests
    LeaderFollowerManager.clearGlobalLocks()
    vi.useRealTimers()
    mockPipeline.clear()
    mockHeartbeat.clear()
    mockLock.clear()
  })

  // ==========================================================================
  // CONCURRENT PROMOTION RACE CONDITIONS
  // ==========================================================================

  describe('Concurrent Promotion Race Conditions', () => {
    it('should only allow ONE node to become leader when multiple call promote() simultaneously', async () => {
      /**
       * BUG: Current promote() has no distributed coordination.
       * When multiple followers detect leader failure and call promote() at the same time,
       * they ALL become leaders, causing split-brain.
       *
       * EXPECTED: Only ONE node should win the leader election.
       * This requires a distributed lock or consensus mechanism.
       */

      // Create 3 followers that will all try to become leader
      const stateStores = [createMockStateStore(), createMockStateStore(), createMockStateStore()]
      const followers = [
        createFollowerManager('follower-1', mockPipeline, stateStores[0], mockHeartbeat),
        createFollowerManager('follower-2', mockPipeline, stateStores[1], mockHeartbeat),
        createFollowerManager('follower-3', mockPipeline, stateStores[2], mockHeartbeat),
      ]
      managers.push(...followers)

      // Start all followers
      await Promise.all(followers.map((f) => f.start()))

      // Simulate leader failure - all followers detect it
      mockHeartbeat.setLeaderAlive(false)

      // All followers try to promote simultaneously (race condition)
      const promotionResults = await Promise.allSettled(followers.map((f) => f.promote()))

      // Count how many succeeded in becoming leader
      const successCount = promotionResults.filter((r) => r.status === 'fulfilled').length
      const leaderCount = followers.filter((f) => f.getRole() === ReplicationRole.Leader).length

      // BUG: Currently ALL 3 will succeed, causing split-brain
      // EXPECTED: Exactly 1 should become leader
      expect(leaderCount).toBe(1) // This WILL FAIL - currently all become leaders
      expect(successCount).toBe(1) // This WILL FAIL - all promotions succeed
    })

    it('should reject promote() if another node already holds the leader lock', async () => {
      /**
       * BUG: promote() doesn't check for existing leader lock.
       * A new leader can be elected even while another valid leader exists.
       *
       * EXPECTED: promote() should fail if distributed lock is held by another node.
       */

      const stateStore1 = createMockStateStore()
      const stateStore2 = createMockStateStore()

      const follower1 = createFollowerManager('follower-1', mockPipeline, stateStore1, mockHeartbeat)
      const follower2 = createFollowerManager('follower-2', mockPipeline, stateStore2, mockHeartbeat)
      managers.push(follower1, follower2)

      await follower1.start()
      await follower2.start()

      // Follower 1 promotes first (simulated lock acquisition)
      await follower1.promote()
      expect(follower1.getRole()).toBe(ReplicationRole.Leader)

      // Follower 2 tries to promote while follower 1 is leader
      // BUG: This currently succeeds, creating split-brain
      // EXPECTED: Should throw or return failure
      await expect(follower2.promote()).rejects.toThrow(/leader.*exists|lock.*held|election.*failed/i)
    })

    it('should use fencing tokens to prevent stale leader writes', async () => {
      /**
       * BUG: No fencing token mechanism exists.
       * A stale leader that was partitioned can come back and write,
       * overwriting data from the new leader.
       *
       * EXPECTED: Writes should include a fencing token that increases
       * with each leader election. Stale tokens should be rejected.
       */

      const stateStore1 = createMockStateStore()
      const stateStore2 = createMockStateStore()

      // Create two managers that will alternate as leader
      const manager1 = new LeaderFollowerManager({
        nodeId: 'node-1',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline,
        stateStore: stateStore1,
        namespace: 'test-namespace',
        heartbeatService: mockHeartbeat,
      })
      managers.push(manager1)

      const manager2 = createFollowerManager('node-2', mockPipeline, stateStore2, mockHeartbeat)
      managers.push(manager2)

      await manager1.start()
      await manager2.start()

      // Manager 1 writes with initial fencing token
      const result1 = await manager1.write({ key: 'data', value: 'from-leader-1', operation: 'create' })
      expect(result1.success).toBe(true)

      // Simulate network partition - manager 1 becomes isolated
      // Manager 2 gets promoted with a NEW fencing token
      await manager1.demote() // Demote old leader
      await manager2.promote()

      // Manager 2 writes with new (higher) fencing token
      const result2 = await manager2.write({ key: 'data', value: 'from-leader-2', operation: 'update' })
      expect(result2.success).toBe(true)

      // Manager 1 recovers and tries to write with OLD fencing token
      // It thinks it's still leader (promote back for test)
      // BUG: Currently there's no fencing token check
      // @ts-expect-error - accessing private for test
      manager1._role = ReplicationRole.Leader

      // This write should be REJECTED because fencing token is stale
      const staleResult = await manager1.write({ key: 'data', value: 'stale-write', operation: 'update' })

      // EXPECTED: Write should fail due to stale fencing token
      expect(staleResult.success).toBe(false)
      expect(staleResult.errorCode).toMatch(/STALE_FENCING_TOKEN|NOT_LEADER/)
    })
  })

  // ==========================================================================
  // FAILOVER RACE CONDITIONS
  // ==========================================================================

  describe('Failover Race Conditions', () => {
    it('should prevent promotion when old leader has not fully stepped down', async () => {
      /**
       * BUG: promote() doesn't wait for old leader to release resources.
       * A follower can become leader while old leader is still writing.
       *
       * EXPECTED: Promotion should wait for old leader to release lock
       * or timeout with error.
       */

      const leaderStore = createMockStateStore()
      const followerStore = createMockStateStore()

      // Create original leader
      const leader = new LeaderFollowerManager({
        nodeId: 'leader',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline,
        stateStore: leaderStore,
        namespace: 'test-namespace',
        heartbeatService: mockHeartbeat,
      })
      managers.push(leader)

      // Create follower
      const follower = createFollowerManager('follower', mockPipeline, followerStore, mockHeartbeat, {
        leaderId: 'leader',
      })
      managers.push(follower)

      await leader.start()
      await follower.start()

      // Leader is active and thinks it's leader
      expect(leader.getRole()).toBe(ReplicationRole.Leader)

      // Perform a write as leader
      const writeResult = await leader.write({ key: 'important', value: 'data', operation: 'create' })
      expect(writeResult.success).toBe(true)

      // Follower tries to promote while leader is still active (not stepped down)
      // EXPECTED: Should require leader to acknowledge demotion first
      // With distributed lock, promotion should fail because leader still holds lock
      await expect(follower.promote()).rejects.toThrow(/leader.*lock|election.*failed/i)

      // Verify: Old leader is still leader, follower failed to promote
      const leaderRole = leader.getRole()
      const followerRole = follower.getRole()

      // EXPECTED: Old leader should still be leader (holds lock), follower should NOT be leader
      expect(leaderRole).toBe(ReplicationRole.Leader)
      expect(followerRole).toBe(ReplicationRole.Follower)
      expect(leaderRole === ReplicationRole.Leader && followerRole === ReplicationRole.Leader).toBe(false)
    })

    it('should handle split-brain detection and recovery', async () => {
      /**
       * Scenario: Two managers think they're leader due to network partition.
       * When network heals, reconcileWithPeer should detect and resolve split-brain.
       *
       * EXPECTED: System should detect multiple leaders and resolve to single leader.
       */

      const store1 = createMockStateStore()
      const store2 = createMockStateStore()

      // Create two managers that both think they're leader
      // (simulating split-brain scenario from network partition)
      const manager1 = new LeaderFollowerManager({
        nodeId: 'node-1',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline,
        stateStore: store1,
        namespace: 'test-namespace',
      })
      managers.push(manager1)

      const manager2 = new LeaderFollowerManager({
        nodeId: 'node-2',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline,
        stateStore: store2,
        namespace: 'test-namespace',
      })
      managers.push(manager2)

      // Start manager1 - it acquires the global lock
      await manager1.start()
      expect(manager1.getRole()).toBe(ReplicationRole.Leader)

      // Start manager2 - with our lock implementation, the second leader
      // will register in global lock with higher epoch when start() tries to acquire
      // But manager2 started as Leader with _hasLeaderLock=true from constructor
      await manager2.start()
      expect(manager2.getRole()).toBe(ReplicationRole.Leader)

      // Manager1 writes successfully (holds actual global lock)
      const result1 = await manager1.write({ key: 'test', value: 'from-1', operation: 'create' })
      expect(result1.success).toBe(true)

      // Manager2 thinks it's leader but global lock shows manager1 as holder
      // When manager2 tries to write, fencing token check should fail
      const result2 = await manager2.write({ key: 'test', value: 'from-2', operation: 'create' })

      // Manager2's write should fail due to stale fencing token
      expect(result2.success).toBe(false)
      expect(result2.errorCode).toMatch(/STALE_FENCING_TOKEN|NOT_LEADER/)

      // After failed write, manager2 realizes it's not the real leader
      expect(manager2.hasLeaderLock()).toBe(false)

      // Now resolve through reconciliation
      // Manager2 reconciles and should detect that manager1 has higher authority
      const resolved = await manager2.reconcileWithPeer(manager1.getNodeId())

      // Manager2 should have demoted itself during reconciliation
      expect(resolved).toBeDefined()
      expect(resolved.winner).toBe('node-1')

      // Only one should be leader after reconciliation
      const leaderCount = [manager1, manager2].filter((m) => m.getRole() === ReplicationRole.Leader).length
      expect(leaderCount).toBe(1)

      // Verify manager1 is the winner and manager2 is follower
      expect(manager1.getRole()).toBe(ReplicationRole.Leader)
      expect(manager2.getRole()).toBe(ReplicationRole.Follower)
    })

    it('should require quorum for leader election in multi-node cluster', async () => {
      /**
       * BUG: promote() has no quorum requirement.
       * A single partitioned node can elect itself leader.
       *
       * EXPECTED: Leader election should require acknowledgment from majority of nodes.
       */

      const stores = Array.from({ length: 5 }, () => createMockStateStore())
      const nodes: LeaderFollowerManager[] = []

      // Create quorum callback that simulates network partition
      // Node 0 is isolated, cannot reach quorum
      const isolatedNodeQuorumCallback: QuorumCallback = async (nodeId, action) => {
        // Isolated node cannot reach majority
        if (nodeId === 'node-0') return false
        return true
      }

      // Create 5-node cluster (quorum = 3)
      for (let i = 0; i < 5; i++) {
        const node = new LeaderFollowerManager({
          nodeId: `node-${i}`,
          role: ReplicationRole.Follower,
          pipeline: mockPipeline,
          stateStore: stores[i],
          namespace: 'test-namespace',
          leaderId: 'original-leader',
          heartbeatService: mockHeartbeat,
          promotionEligible: true,
          quorumCallback: isolatedNodeQuorumCallback,
        })
        nodes.push(node)
        managers.push(node)
      }

      // Start all nodes
      await Promise.all(nodes.map((n) => n.start()))

      // Simulate network partition: node-0 is isolated from nodes 1-4
      // Node 0 tries to promote itself (should fail - can't reach quorum)
      const isolatedNode = nodes[0]

      // EXPECTED: Should throw error about quorum not reached
      await expect(isolatedNode.promote()).rejects.toThrow(/quorum|majority|consensus/i)
    })
  })

  // ==========================================================================
  // LEADER EPOCH / TERM VALIDATION
  // ==========================================================================

  describe('Leader Epoch/Term Validation', () => {
    it('should track and validate leader epochs/terms', async () => {
      /**
       * BUG: No epoch/term tracking exists.
       * Can't distinguish between different leader generations.
       *
       * EXPECTED: Each leader election should increment epoch.
       * Operations should validate epoch to prevent stale leader actions.
       */

      const store = createMockStateStore()
      const manager = createFollowerManager('node-1', mockPipeline, store, mockHeartbeat)
      managers.push(manager)

      await manager.start()
      await manager.promote()

      // Get leader state - should include epoch
      const state = manager.getLeaderState()

      // BUG: No epoch/term field exists in LeaderState
      // @ts-expect-error - epoch should exist but doesn't
      expect(state?.epoch).toBeDefined()
      // @ts-expect-error - epoch should exist but doesn't
      expect(typeof state?.epoch).toBe('number')
      // @ts-expect-error - epoch should start at 1
      expect(state?.epoch).toBeGreaterThan(0)
    })

    it('should reject writes from nodes with stale epoch', async () => {
      /**
       * BUG: No epoch validation on writes.
       *
       * EXPECTED: Writes should be rejected if the node's epoch is behind current.
       */

      const store1 = createMockStateStore()
      const store2 = createMockStateStore()

      const manager1 = new LeaderFollowerManager({
        nodeId: 'node-1',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline,
        stateStore: store1,
        namespace: 'test-namespace',
      })
      managers.push(manager1)

      const manager2 = createFollowerManager('node-2', mockPipeline, store2, mockHeartbeat)
      managers.push(manager2)

      await manager1.start()
      await manager2.start()

      // Manager 1 is leader at epoch 1
      const result1 = await manager1.write({ key: 'test', value: 'v1', operation: 'create' })
      expect(result1.success).toBe(true)

      // Manager 2 becomes leader (epoch 2)
      await manager1.demote()
      await manager2.promote()

      // Manager 1 (now at stale epoch 1) tries to write
      // @ts-expect-error - forcefully restore leader role for test
      manager1._role = ReplicationRole.Leader

      // BUG: This write succeeds but shouldn't
      const staleResult = await manager1.write({ key: 'test', value: 'stale', operation: 'update' })

      // EXPECTED: Should fail due to stale epoch
      expect(staleResult.success).toBe(false)
      expect(staleResult.errorCode).toMatch(/STALE_EPOCH|NOT_LEADER|EPOCH_MISMATCH/)
    })

    it('should increment epoch on each promotion', async () => {
      /**
       * BUG: No epoch tracking means can't detect leader succession.
       *
       * EXPECTED: Each promotion should result in a higher epoch.
       */

      const store = createMockStateStore()
      const manager = new LeaderFollowerManager({
        nodeId: 'node-1',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline,
        stateStore: store,
        namespace: 'test-namespace',
      })
      managers.push(manager)

      await manager.start()

      // Get initial epoch
      const state1 = manager.getLeaderState()
      // @ts-expect-error - epoch should exist
      const epoch1 = state1?.epoch ?? 0

      // Demote and re-promote
      await manager.demote()
      await manager.promote()

      // Get new epoch
      const state2 = manager.getLeaderState()
      // @ts-expect-error - epoch should exist
      const epoch2 = state2?.epoch ?? 0

      // EXPECTED: Epoch should increase
      expect(epoch2).toBeGreaterThan(epoch1)
    })
  })

  // ==========================================================================
  // DISTRIBUTED LOCK INTEGRATION
  // ==========================================================================

  describe('Distributed Lock Integration', () => {
    it('should require distributed lock for promotion', async () => {
      /**
       * BUG: promote() doesn't use distributed lock.
       *
       * EXPECTED: promote() should:
       * 1. Attempt to acquire distributed lock
       * 2. Only proceed if lock acquired
       * 3. Fail if lock held by another node
       */

      const store = createMockStateStore()
      const manager = createFollowerManager('node-1', mockPipeline, store, mockHeartbeat)
      managers.push(manager)

      await manager.start()

      // Promote should internally acquire lock
      // BUG: No lock is acquired - this is the core problem
      await manager.promote()

      // Verify lock was acquired (if implemented)
      // EXPECTED: Manager should have acquired lock with its node ID
      // @ts-expect-error - leaderLock should exist but doesn't
      const hasLock = manager.hasLeaderLock?.() ?? false

      expect(hasLock).toBe(true)
    })

    it('should release lock on demotion', async () => {
      /**
       * BUG: No lock to release on demotion.
       *
       * EXPECTED: demote() should release the distributed lock
       * so other nodes can become leader.
       */

      const store = createMockStateStore()
      const manager = new LeaderFollowerManager({
        nodeId: 'node-1',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline,
        stateStore: store,
        namespace: 'test-namespace',
      })
      managers.push(manager)

      await manager.start()
      await manager.demote()

      // Lock should be released
      // @ts-expect-error - leaderLock should exist but doesn't
      const hasLock = manager.hasLeaderLock?.() ?? true // Default true shows bug

      expect(hasLock).toBe(false)
    })

    it('should handle lock timeout/expiry gracefully', async () => {
      /**
       * Scenario: Lock expires after node crash (no graceful demote).
       *
       * EXPECTED: If lock expires (e.g., node crashed without releasing),
       * another node should be able to acquire it.
       */

      const store1 = createMockStateStore()
      const store2 = createMockStateStore()

      const manager1 = new LeaderFollowerManager({
        nodeId: 'node-1',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline,
        stateStore: store1,
        namespace: 'test-namespace',
      })
      managers.push(manager1)

      await manager1.start()

      // Verify manager1 is leader and can write
      const result1 = await manager1.write({ key: 'test', value: 'v1', operation: 'create' })
      expect(result1.success).toBe(true)

      // Simulate crash (don't call close/demote - lock not released)
      // In a real distributed lock, this would eventually expire

      // Wait for lock timeout (simulated)
      vi.advanceTimersByTime(31000) // 31 seconds > 30 second lock timeout

      const manager2 = createFollowerManager('node-2', mockPipeline, store2, mockHeartbeat)
      managers.push(manager2)

      await manager2.start()

      // Manager 2 should be able to acquire lock after timeout
      await manager2.promote()

      // Manager2 should be the new leader
      expect(manager2.getRole()).toBe(ReplicationRole.Leader)
      expect(manager2.hasLeaderLock()).toBe(true)

      // Manager2 can write successfully
      const result2 = await manager2.write({ key: 'test2', value: 'v2', operation: 'create' })
      expect(result2.success).toBe(true)

      // Manager1 still thinks it's leader (role not changed)
      // But when it tries to write, fencing check should fail
      const staleResult = await manager1.write({ key: 'test3', value: 'stale', operation: 'create' })
      expect(staleResult.success).toBe(false)
      expect(staleResult.errorCode).toMatch(/STALE_FENCING_TOKEN|NOT_LEADER|STALE_EPOCH/)

      // Verify only manager2 actually holds the lock
      expect(manager1.hasLeaderLock()).toBe(false)
      expect(manager2.hasLeaderLock()).toBe(true)
    })
  })

  // ==========================================================================
  // NETWORK PARTITION SCENARIOS
  // ==========================================================================

  describe('Network Partition Scenarios', () => {
    it('should prevent leader election in minority partition', async () => {
      /**
       * BUG: No partition awareness.
       * A minority partition can elect a leader, causing split-brain.
       *
       * EXPECTED: Nodes should only elect leader if they can reach majority.
       */

      const stores = Array.from({ length: 5 }, () => createMockStateStore())

      // Create quorum callback that simulates network partition
      // Nodes 0-1 are isolated (minority partition), cannot reach quorum
      const minorityPartitionQuorumCallback: QuorumCallback = async (nodeId, action) => {
        // Minority nodes (0-1) cannot reach majority
        if (nodeId === 'node-0' || nodeId === 'node-1') return false
        return true
      }

      // Create 5-node cluster
      const nodes = stores.map((store, i) =>
        new LeaderFollowerManager({
          nodeId: `node-${i}`,
          role: ReplicationRole.Follower,
          pipeline: mockPipeline,
          stateStore: store,
          namespace: 'test-namespace',
          leaderId: 'original-leader',
          heartbeatService: mockHeartbeat,
          promotionEligible: true,
          quorumCallback: minorityPartitionQuorumCallback,
        })
      )
      managers.push(...nodes)

      // Start all nodes
      await Promise.all(nodes.map((n) => n.start()))

      // Simulate partition: nodes 0-1 are isolated from nodes 2-4
      // Minority partition (0-1) tries to elect leader
      const minorityNode = nodes[0]

      // EXPECTED: Should fail because can't reach quorum (3 out of 5)
      await expect(minorityNode.promote()).rejects.toThrow(/quorum|partition|unreachable/i)
    })

    it('should handle network heal after partition', async () => {
      /**
       * Scenario: Network partition caused two leaders to emerge.
       * When network heals, reconciliation should resolve to single leader.
       *
       * EXPECTED: When network heals:
       * 1. Detect if multiple leaders exist
       * 2. Resolve to single leader (the one holding the lock wins)
       * 3. Demote other leaders
       */

      const store1 = createMockStateStore()
      const store2 = createMockStateStore()

      // Simulate two leaders that emerged during partition
      const leader1 = new LeaderFollowerManager({
        nodeId: 'node-1',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline,
        stateStore: store1,
        namespace: 'test-namespace',
      })
      managers.push(leader1)

      const leader2 = new LeaderFollowerManager({
        nodeId: 'node-2',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline,
        stateStore: store2,
        namespace: 'test-namespace',
      })
      managers.push(leader2)

      // Leader1 starts first and acquires the global lock
      await leader1.start()
      expect(leader1.getRole()).toBe(ReplicationRole.Leader)

      // Leader2 starts but global lock is held by leader1
      await leader2.start()
      expect(leader2.getRole()).toBe(ReplicationRole.Leader) // Still thinks it's leader

      // Leader1 writes successfully (holds the lock)
      const result1 = await leader1.write({ key: 'x', value: 'from-1', operation: 'create' })
      expect(result1.success).toBe(true)

      // Leader2 tries to write - should fail due to fencing
      const result2 = await leader2.write({ key: 'x', value: 'from-2', operation: 'create' })
      expect(result2.success).toBe(false)

      // Network heals - reconcile using the reconcileWithPeer method
      const resolved = await leader1.reconcileWithPeer(leader2.getNodeId())

      // After reconciliation, only leader1 should be the actual leader
      expect(resolved).toBeDefined()
      expect(resolved.winner).toBe('node-1')

      // Leader1 holds the lock
      expect(leader1.hasLeaderLock()).toBe(true)
      // Leader2 lost its lock status when write failed
      expect(leader2.hasLeaderLock()).toBe(false)

      // Verify only one can successfully write
      const verifyResult1 = await leader1.write({ key: 'verify', value: 'from-1', operation: 'create' })
      expect(verifyResult1.success).toBe(true)

      const verifyResult2 = await leader2.write({ key: 'verify', value: 'from-2', operation: 'create' })
      expect(verifyResult2.success).toBe(false)
    })
  })
})
