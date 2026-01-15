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
 * Create a quorum callback that allows only the specified node to win
 */
const createMockQuorumCallback = (winnerNodeId: string | null = null): QuorumCallback => {
  return async (nodeId: string, action: string) => {
    if (winnerNodeId === null) return true // Allow all
    return nodeId === winnerNodeId
  }
}

/**
 * Create a quorum callback that only allows one node to win (first one to call)
 */
const createRaceQuorumCallback = (): QuorumCallback & { winner: string | null } => {
  let winner: string | null = null
  const callback = async (nodeId: string, action: string) => {
    if (winner === null) {
      winner = nodeId
      return true
    }
    return nodeId === winner
  }
  ;(callback as any).winner = winner
  Object.defineProperty(callback, 'winner', {
    get: () => winner,
  })
  return callback as QuorumCallback & { winner: string | null }
}

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
       * Tests split-brain prevention: Only ONE node should become leader
       * when multiple followers try to promote simultaneously.
       *
       * The implementation uses:
       * - Quorum callback for consensus simulation
       * - Global locks to prevent concurrent promotions
       */

      // Create a race quorum callback that only allows first caller to win
      const raceQuorum = createRaceQuorumCallback()

      // Create 3 followers that will all try to become leader
      const stateStores = [createMockStateStore(), createMockStateStore(), createMockStateStore()]
      const followers = [
        createFollowerManager('follower-1', mockPipeline, stateStores[0], mockHeartbeat, {
          quorumCallback: raceQuorum,
        }),
        createFollowerManager('follower-2', mockPipeline, stateStores[1], mockHeartbeat, {
          quorumCallback: raceQuorum,
        }),
        createFollowerManager('follower-3', mockPipeline, stateStores[2], mockHeartbeat, {
          quorumCallback: raceQuorum,
        }),
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

      // With proper quorum and locking, exactly 1 should become leader
      expect(leaderCount).toBe(1)
      expect(successCount).toBe(1)
    })

    it('should reject promote() if another node already holds the leader lock', async () => {
      /**
       * Tests that promote() fails if another node holds the leader lock.
       * Uses quorum callback to simulate proper distributed coordination.
       */

      const stateStore1 = createMockStateStore()
      const stateStore2 = createMockStateStore()

      // Quorum that only allows follower-1 to win
      const quorumCallback = createMockQuorumCallback('follower-1')

      const follower1 = createFollowerManager('follower-1', mockPipeline, stateStore1, mockHeartbeat, {
        quorumCallback,
      })
      const follower2 = createFollowerManager('follower-2', mockPipeline, stateStore2, mockHeartbeat, {
        quorumCallback,
      })
      managers.push(follower1, follower2)

      await follower1.start()
      await follower2.start()

      // Follower 1 promotes first (has quorum)
      await follower1.promote()
      expect(follower1.getRole()).toBe(ReplicationRole.Leader)

      // Follower 2 tries to promote while follower 1 is leader
      // Should fail because quorum is not reached (only follower-1 can win)
      await expect(follower2.promote()).rejects.toThrow(/quorum|lock.*held|election.*failed/i)
    })

    it('should use fencing tokens to prevent stale leader writes', async () => {
      /**
       * Tests fencing token mechanism: A stale leader's writes should be rejected.
       */

      const stateStore1 = createMockStateStore()
      const stateStore2 = createMockStateStore()

      // Quorum that allows both nodes (we'll control promotion order)
      const quorumCallback = createMockQuorumCallback(null) // null = allow all

      // Create two managers that will alternate as leader
      const manager1 = new LeaderFollowerManager({
        nodeId: 'node-1',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline,
        stateStore: stateStore1,
        namespace: 'test-namespace',
        heartbeatService: mockHeartbeat,
        quorumCallback,
      })
      managers.push(manager1)

      const manager2 = createFollowerManager('node-2', mockPipeline, stateStore2, mockHeartbeat, {
        quorumCallback,
      })
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
      // @ts-expect-error - accessing private for test
      manager1._role = ReplicationRole.Leader

      // This write should be REJECTED because fencing token is stale
      const staleResult = await manager1.write({ key: 'data', value: 'stale-write', operation: 'update' })

      // Write should fail due to stale fencing token
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
       * Tests that promotion fails while another leader holds the lock.
       * The quorum callback prevents the follower from acquiring quorum
       * while the leader is still active.
       */

      const leaderStore = createMockStateStore()
      const followerStore = createMockStateStore()

      // Quorum callback that only allows 'leader' node to have quorum
      const quorumCallback = createMockQuorumCallback('leader')

      // Create original leader
      const leader = new LeaderFollowerManager({
        nodeId: 'leader',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline,
        stateStore: leaderStore,
        namespace: 'test-namespace',
        heartbeatService: mockHeartbeat,
        quorumCallback,
      })
      managers.push(leader)

      // Create follower
      const follower = createFollowerManager('follower', mockPipeline, followerStore, mockHeartbeat, {
        leaderId: 'leader',
        quorumCallback,
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
      // Should fail because quorum callback rejects 'follower' node
      await expect(follower.promote()).rejects.toThrow(/quorum|lock|election.*failed/i)

      // Verify: Old leader is still leader, follower failed to promote
      const leaderRole = leader.getRole()
      const followerRole = follower.getRole()

      // Old leader should still be leader, follower should NOT be leader
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

      // Use a quorum callback that allows both initially
      const quorumCallback = createMockQuorumCallback(null)

      // Create two managers that both think they're leader
      // (simulating split-brain scenario from network partition)
      const manager1 = new LeaderFollowerManager({
        nodeId: 'node-1',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline,
        stateStore: store1,
        namespace: 'test-namespace',
        quorumCallback,
      })
      managers.push(manager1)

      const manager2 = new LeaderFollowerManager({
        nodeId: 'node-2',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline,
        stateStore: store2,
        namespace: 'test-namespace',
        quorumCallback,
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

      // Manager2's write should fail due to stale fencing token or being a stale leader
      expect(result2.success).toBe(false)
      expect(result2.errorCode).toMatch(/STALE_FENCING_TOKEN|NOT_LEADER|STALE_LEADER/)

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
       * Tests that epoch/term tracking works correctly.
       */

      const store = createMockStateStore()
      const quorumCallback = createMockQuorumCallback(null) // Allow all
      const manager = createFollowerManager('node-1', mockPipeline, store, mockHeartbeat, {
        quorumCallback,
      })
      managers.push(manager)

      await manager.start()
      await manager.promote()

      // Get leader state - should include epoch
      const state = manager.getLeaderState()

      // Epoch tracking is now implemented
      // @ts-expect-error - epoch should exist
      expect(state?.epoch).toBeDefined()
      // @ts-expect-error - epoch should exist
      expect(typeof state?.epoch).toBe('number')
      // @ts-expect-error - epoch should start at 1
      expect(state?.epoch).toBeGreaterThan(0)
    })

    it('should reject writes from nodes with stale epoch', async () => {
      /**
       * Tests that writes from nodes with stale epochs are rejected.
       */

      const store1 = createMockStateStore()
      const store2 = createMockStateStore()

      const quorumCallback = createMockQuorumCallback(null) // Allow all

      const manager1 = new LeaderFollowerManager({
        nodeId: 'node-1',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline,
        stateStore: store1,
        namespace: 'test-namespace',
        quorumCallback,
      })
      managers.push(manager1)

      const manager2 = createFollowerManager('node-2', mockPipeline, store2, mockHeartbeat, {
        quorumCallback,
      })
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

      // This write should fail due to stale epoch
      const staleResult = await manager1.write({ key: 'test', value: 'stale', operation: 'update' })

      // Should fail due to stale epoch
      expect(staleResult.success).toBe(false)
      expect(staleResult.errorCode).toMatch(/STALE_EPOCH|NOT_LEADER|EPOCH_MISMATCH|STALE_FENCING_TOKEN/)
    })

    it('should increment epoch on each promotion', async () => {
      /**
       * Tests that epoch is incremented on each promotion.
       */

      const store = createMockStateStore()
      const quorumCallback = createMockQuorumCallback(null) // Allow all

      const manager = new LeaderFollowerManager({
        nodeId: 'node-1',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline,
        stateStore: store,
        namespace: 'test-namespace',
        quorumCallback,
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

      // Epoch should increase
      expect(epoch2).toBeGreaterThan(epoch1)
    })
  })

  // ==========================================================================
  // DISTRIBUTED LOCK INTEGRATION
  // ==========================================================================

  describe('Distributed Lock Integration', () => {
    it('should require distributed lock for promotion', async () => {
      /**
       * Tests that promotion acquires the distributed lock.
       */

      const store = createMockStateStore()
      const quorumCallback = createMockQuorumCallback(null) // Allow all

      const manager = createFollowerManager('node-1', mockPipeline, store, mockHeartbeat, {
        quorumCallback,
      })
      managers.push(manager)

      await manager.start()

      // Promote should internally acquire lock
      await manager.promote()

      // Verify lock was acquired
      const hasLock = manager.hasLeaderLock()

      expect(hasLock).toBe(true)
    })

    it('should release lock on demotion', async () => {
      /**
       * Tests that demotion releases the distributed lock.
       */

      const store = createMockStateStore()
      const quorumCallback = createMockQuorumCallback(null) // Allow all

      const manager = new LeaderFollowerManager({
        nodeId: 'node-1',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline,
        stateStore: store,
        namespace: 'test-namespace',
        quorumCallback,
      })
      managers.push(manager)

      await manager.start()
      await manager.demote()

      // Lock should be released
      const hasLock = manager.hasLeaderLock()

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

      const quorumCallback = createMockQuorumCallback(null) // Allow all

      const manager1 = new LeaderFollowerManager({
        nodeId: 'node-1',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline,
        stateStore: store1,
        namespace: 'test-namespace',
        quorumCallback,
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

      const manager2 = createFollowerManager('node-2', mockPipeline, store2, mockHeartbeat, {
        quorumCallback,
      })
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
      expect(staleResult.errorCode).toMatch(/STALE_FENCING_TOKEN|NOT_LEADER|STALE_EPOCH|STALE_LEADER/)

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

      const quorumCallback = createMockQuorumCallback(null) // Allow all

      // Simulate two leaders that emerged during partition
      const leader1 = new LeaderFollowerManager({
        nodeId: 'node-1',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline,
        stateStore: store1,
        namespace: 'test-namespace',
        quorumCallback,
      })
      managers.push(leader1)

      const leader2 = new LeaderFollowerManager({
        nodeId: 'node-2',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline,
        stateStore: store2,
        namespace: 'test-namespace',
        quorumCallback,
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
