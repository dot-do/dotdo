/**
 * LeaderFollowerManager tests - Leader-follower replication for read scaling and failover
 *
 * LeaderFollowerManager coordinates leader-follower replication:
 * - Leader handles all writes and emits events to Pipeline
 * - Followers subscribe to Pipeline events and apply to local state
 * - Followers serve reads from local state (read-only)
 * - Failover promotes follower to leader on leader failure
 *
 * NOTE: These tests are designed to FAIL because the implementation does not exist yet.
 * This is the TDD RED phase.
 *
 * @see /objects/unified-storage/leader-follower.ts (to be created in GREEN phase)
 * @see /docs/architecture/unified-storage.md for replication architecture
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Import from non-existent module - this will cause tests to fail
import {
  LeaderFollowerManager,
  type LeaderFollowerConfig,
  type ReplicationEvent,
  type FollowerState,
  type LeaderState,
  type QuorumCallback,
  ReplicationRole,
} from '../../objects/unified-storage/leader-follower'

/**
 * Create a quorum callback that always grants quorum (for basic tests)
 */
const createAllowAllQuorumCallback = (): QuorumCallback => {
  return async () => true
}

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
    // Simulate receiving events from external source (for followers)
    simulateEvent: (event: unknown) => {
      for (const [, callback] of subscribers) {
        callback(event)
      }
    },
    // Get buffered events for replay
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
    // Test helpers
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
// TESTS
// ============================================================================

describe('LeaderFollowerManager', () => {
  let mockPipeline: MockPipeline
  let mockStateStore: MockStateStore
  let mockHeartbeat: MockHeartbeatService
  let manager: LeaderFollowerManager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T10:00:00.000Z'))
    mockPipeline = createMockPipeline()
    mockStateStore = createMockStateStore()
    mockHeartbeat = createMockHeartbeatService()
  })

  afterEach(async () => {
    if (manager) {
      await manager.close()
    }
    vi.useRealTimers()
    mockPipeline.clear()
    mockStateStore.clear()
    mockHeartbeat.clear()
  })

  // ============================================================================
  // LEADER OPERATIONS
  // ============================================================================

  describe('Leader operations', () => {
    describe('write handling', () => {
      it('should accept writes when configured as leader', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'leader-node-1',
          role: ReplicationRole.Leader,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
        })

        const result = await manager.write({
          key: 'customer-123',
          value: { $id: 'customer-123', name: 'Alice' },
          operation: 'create',
        })

        expect(result.success).toBe(true)
        expect(mockStateStore.set).toHaveBeenCalledWith(
          'customer-123',
          expect.objectContaining({ $id: 'customer-123', name: 'Alice' })
        )
      })

      it('should emit write event to Pipeline after local write', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'leader-node-1',
          role: ReplicationRole.Leader,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
        })

        await manager.write({
          key: 'customer-123',
          value: { $id: 'customer-123', name: 'Alice' },
          operation: 'create',
        })

        await vi.advanceTimersByTimeAsync(10)

        expect(mockPipeline.send).toHaveBeenCalled()
        const emittedEvents = mockPipeline.events as ReplicationEvent[]
        expect(emittedEvents.length).toBeGreaterThan(0)
        expect(emittedEvents[0]).toMatchObject({
          type: 'replication.write',
          key: 'customer-123',
          operation: 'create',
        })
      })

      it('should include sequence number in emitted events', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'leader-node-1',
          role: ReplicationRole.Leader,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
        })

        await manager.write({ key: 'item-1', value: { id: 1 }, operation: 'create' })
        await manager.write({ key: 'item-2', value: { id: 2 }, operation: 'create' })
        await manager.write({ key: 'item-3', value: { id: 3 }, operation: 'create' })

        await vi.advanceTimersByTimeAsync(10)

        const emittedEvents = mockPipeline.events as ReplicationEvent[]
        expect(emittedEvents[0].sequence).toBe(1)
        expect(emittedEvents[1].sequence).toBe(2)
        expect(emittedEvents[2].sequence).toBe(3)
      })

      it('should support update operations', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'leader-node-1',
          role: ReplicationRole.Leader,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
        })

        // Create then update
        await manager.write({
          key: 'customer-123',
          value: { $id: 'customer-123', name: 'Alice' },
          operation: 'create',
        })

        await manager.write({
          key: 'customer-123',
          value: { $id: 'customer-123', name: 'Alice Updated' },
          operation: 'update',
        })

        await vi.advanceTimersByTimeAsync(10)

        const emittedEvents = mockPipeline.events as ReplicationEvent[]
        expect(emittedEvents[1].operation).toBe('update')
      })

      it('should support delete operations', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'leader-node-1',
          role: ReplicationRole.Leader,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
        })

        await manager.write({
          key: 'customer-123',
          value: null,
          operation: 'delete',
        })

        await vi.advanceTimersByTimeAsync(10)

        expect(mockStateStore.delete).toHaveBeenCalledWith('customer-123')
        const emittedEvents = mockPipeline.events as ReplicationEvent[]
        expect(emittedEvents[0].operation).toBe('delete')
      })
    })

    describe('write rejection when demoted', () => {
      it('should reject writes when demoted to follower', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'leader-node-1',
          role: ReplicationRole.Leader,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
        })

        // Demote to follower
        await manager.demote()

        const result = await manager.write({
          key: 'customer-123',
          value: { $id: 'customer-123', name: 'Alice' },
          operation: 'create',
        })

        expect(result.success).toBe(false)
        expect(result.error).toMatch(/not.*leader|read.*only/i)
      })

      it('should return appropriate error code when write rejected', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'leader-node-1',
          role: ReplicationRole.Leader,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
        })

        await manager.demote()

        const result = await manager.write({
          key: 'customer-123',
          value: { $id: 'customer-123', name: 'Alice' },
          operation: 'create',
        })

        expect(result.errorCode).toBe('NOT_LEADER')
      })

      it('should not emit events after demotion', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'leader-node-1',
          role: ReplicationRole.Leader,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
        })

        await manager.demote()

        await manager.write({
          key: 'customer-123',
          value: { $id: 'customer-123', name: 'Alice' },
          operation: 'create',
        })

        await vi.advanceTimersByTimeAsync(100)

        expect(mockPipeline.send).not.toHaveBeenCalled()
      })
    })

    describe('follower tracking', () => {
      it('should track connected followers', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'leader-node-1',
          role: ReplicationRole.Leader,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          heartbeatService: mockHeartbeat as any,
        })

        await manager.registerFollower('follower-1')
        await manager.registerFollower('follower-2')

        const followers = manager.getConnectedFollowers()
        expect(followers).toHaveLength(2)
        expect(followers).toContain('follower-1')
        expect(followers).toContain('follower-2')
      })

      it('should remove followers on disconnect', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'leader-node-1',
          role: ReplicationRole.Leader,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          heartbeatService: mockHeartbeat as any,
        })

        await manager.registerFollower('follower-1')
        await manager.registerFollower('follower-2')
        await manager.unregisterFollower('follower-1')

        const followers = manager.getConnectedFollowers()
        expect(followers).toHaveLength(1)
        expect(followers).toContain('follower-2')
      })

      it('should track follower replication lag', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'leader-node-1',
          role: ReplicationRole.Leader,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          heartbeatService: mockHeartbeat as any,
        })

        await manager.registerFollower('follower-1')

        // Write some events
        await manager.write({ key: 'item-1', value: { id: 1 }, operation: 'create' })
        await manager.write({ key: 'item-2', value: { id: 2 }, operation: 'create' })
        await manager.write({ key: 'item-3', value: { id: 3 }, operation: 'create' })

        // Follower reports sequence 1 applied
        await manager.reportFollowerProgress('follower-1', 1)

        const lag = manager.getFollowerLag('follower-1')
        expect(lag).toBe(2) // Leader at seq 3, follower at seq 1
      })

      it('should expose leader state including current sequence', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'leader-node-1',
          role: ReplicationRole.Leader,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
        })

        await manager.write({ key: 'item-1', value: { id: 1 }, operation: 'create' })
        await manager.write({ key: 'item-2', value: { id: 2 }, operation: 'create' })

        const leaderState = manager.getLeaderState() as LeaderState
        expect(leaderState.currentSequence).toBe(2)
        expect(leaderState.role).toBe(ReplicationRole.Leader)
      })
    })
  })

  // ============================================================================
  // FOLLOWER OPERATIONS
  // ============================================================================

  describe('Follower operations', () => {
    describe('Pipeline subscription', () => {
      it('should subscribe to Pipeline events on initialization', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
        })

        await manager.start()

        expect(mockPipeline.subscribe).toHaveBeenCalledWith(
          'test-ns',
          expect.any(Function)
        )
      })

      it('should filter events by namespace', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'tenant-a',
          leaderId: 'leader-node-1',
        })

        await manager.start()

        // Simulate events from different namespaces
        mockPipeline.simulateEvent({
          type: 'replication.write',
          namespace: 'tenant-a',
          key: 'item-1',
          value: { id: 1 },
          operation: 'create',
          sequence: 1,
        })

        mockPipeline.simulateEvent({
          type: 'replication.write',
          namespace: 'tenant-b', // Different namespace
          key: 'item-2',
          value: { id: 2 },
          operation: 'create',
          sequence: 1,
        })

        await vi.advanceTimersByTimeAsync(10)

        // Only tenant-a event should be applied
        expect(mockStateStore.set).toHaveBeenCalledTimes(1)
        expect(mockStateStore.set).toHaveBeenCalledWith('item-1', expect.objectContaining({ id: 1 }))
      })

      it('should unsubscribe on close', async () => {
        const unsubscribe = vi.fn()
        mockPipeline.subscribe.mockReturnValue(unsubscribe)

        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
        })

        await manager.start()
        await manager.close()

        expect(unsubscribe).toHaveBeenCalled()
      })
    })

    describe('event application', () => {
      it('should apply create events to local state', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
        })

        await manager.start()

        mockPipeline.simulateEvent({
          type: 'replication.write',
          namespace: 'test-ns',
          key: 'customer-123',
          value: { $id: 'customer-123', name: 'Alice' },
          operation: 'create',
          sequence: 1,
        })

        await vi.advanceTimersByTimeAsync(10)

        expect(mockStateStore.set).toHaveBeenCalledWith(
          'customer-123',
          expect.objectContaining({ $id: 'customer-123', name: 'Alice' })
        )
      })

      it('should apply update events to local state', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
        })

        await manager.start()

        mockPipeline.simulateEvent({
          type: 'replication.write',
          namespace: 'test-ns',
          key: 'customer-123',
          value: { $id: 'customer-123', name: 'Alice Updated' },
          operation: 'update',
          sequence: 1,
        })

        await vi.advanceTimersByTimeAsync(10)

        expect(mockStateStore.set).toHaveBeenCalledWith(
          'customer-123',
          expect.objectContaining({ name: 'Alice Updated' })
        )
      })

      it('should apply delete events to local state', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
        })

        await manager.start()

        mockPipeline.simulateEvent({
          type: 'replication.write',
          namespace: 'test-ns',
          key: 'customer-123',
          value: null,
          operation: 'delete',
          sequence: 1,
        })

        await vi.advanceTimersByTimeAsync(10)

        expect(mockStateStore.delete).toHaveBeenCalledWith('customer-123')
      })

      it('should track applied sequence number', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
        })

        await manager.start()

        mockPipeline.simulateEvent({
          type: 'replication.write',
          namespace: 'test-ns',
          key: 'item-1',
          value: { id: 1 },
          operation: 'create',
          sequence: 1,
        })

        mockPipeline.simulateEvent({
          type: 'replication.write',
          namespace: 'test-ns',
          key: 'item-2',
          value: { id: 2 },
          operation: 'create',
          sequence: 2,
        })

        await vi.advanceTimersByTimeAsync(10)

        const followerState = manager.getFollowerState() as FollowerState
        expect(followerState.appliedSequence).toBe(2)
      })
    })

    describe('read operations', () => {
      it('should serve reads from local state', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
        })

        await manager.start()

        // Simulate replicated data
        mockPipeline.simulateEvent({
          type: 'replication.write',
          namespace: 'test-ns',
          key: 'customer-123',
          value: { $id: 'customer-123', name: 'Alice' },
          operation: 'create',
          sequence: 1,
        })

        await vi.advanceTimersByTimeAsync(10)

        const result = await manager.read('customer-123')
        expect(result).toEqual({ $id: 'customer-123', name: 'Alice' })
      })

      it('should return null for non-existent keys', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
        })

        await manager.start()

        const result = await manager.read('non-existent-key')
        expect(result).toBeNull()
      })

      it('should indicate staleness if lag exceeds threshold', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
          maxStalenessMs: 5000,
        })

        await manager.start()

        // Simulate no events received for a while
        await vi.advanceTimersByTimeAsync(10000)

        const isStale = manager.isStale()
        expect(isStale).toBe(true)
      })
    })

    describe('write rejection', () => {
      it('should reject writes as follower (read-only)', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
        })

        await manager.start()

        const result = await manager.write({
          key: 'customer-123',
          value: { $id: 'customer-123', name: 'Alice' },
          operation: 'create',
        })

        expect(result.success).toBe(false)
        expect(result.errorCode).toBe('FOLLOWER_READ_ONLY')
      })

      it('should suggest redirecting writes to leader', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
        })

        await manager.start()

        const result = await manager.write({
          key: 'customer-123',
          value: { $id: 'customer-123', name: 'Alice' },
          operation: 'create',
        })

        expect(result.leaderId).toBe('leader-node-1')
      })
    })
  })

  // ============================================================================
  // EVENT SYNCHRONIZATION
  // ============================================================================

  describe('Event synchronization', () => {
    describe('event flow', () => {
      it('should ensure events flow from leader through Pipeline to followers', async () => {
        // Create leader
        const leaderManager = new LeaderFollowerManager({
          nodeId: 'leader-node',
          role: ReplicationRole.Leader,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
        })

        // Create follower with separate state store
        const followerStateStore = createMockStateStore()
        const followerManager = new LeaderFollowerManager({
          nodeId: 'follower-node',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: followerStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node',
        })

        await followerManager.start()

        // Leader writes data
        await leaderManager.write({
          key: 'customer-123',
          value: { $id: 'customer-123', name: 'Alice' },
          operation: 'create',
        })

        await vi.advanceTimersByTimeAsync(100)

        // Follower should have received and applied the event
        expect(followerStateStore.set).toHaveBeenCalledWith(
          'customer-123',
          expect.objectContaining({ $id: 'customer-123', name: 'Alice' })
        )

        await leaderManager.close()
        await followerManager.close()
      })

      it('should maintain event ordering across multiple writes', async () => {
        const leaderManager = new LeaderFollowerManager({
          nodeId: 'leader-node',
          role: ReplicationRole.Leader,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
        })

        const followerStateStore = createMockStateStore()
        const appliedEvents: ReplicationEvent[] = []

        // Track applied events
        followerStateStore.set.mockImplementation((key: string, value: unknown) => {
          appliedEvents.push({ key, value, sequence: appliedEvents.length + 1 } as any)
        })

        const followerManager = new LeaderFollowerManager({
          nodeId: 'follower-node',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: followerStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node',
        })

        await followerManager.start()

        // Write multiple events in order
        await leaderManager.write({ key: 'item-1', value: { order: 1 }, operation: 'create' })
        await leaderManager.write({ key: 'item-2', value: { order: 2 }, operation: 'create' })
        await leaderManager.write({ key: 'item-3', value: { order: 3 }, operation: 'create' })

        await vi.advanceTimersByTimeAsync(100)

        // Verify order preserved
        expect(appliedEvents[0].key).toBe('item-1')
        expect(appliedEvents[1].key).toBe('item-2')
        expect(appliedEvents[2].key).toBe('item-3')

        await leaderManager.close()
        await followerManager.close()
      })
    })

    describe('catch-up on connect', () => {
      it('should catch up from Pipeline on follower connect', async () => {
        // Simulate existing events in Pipeline
        mockPipeline.events.push(
          {
            type: 'replication.write',
            namespace: 'test-ns',
            key: 'historical-1',
            value: { $id: 'historical-1', name: 'Old Data 1' },
            operation: 'create',
            sequence: 1,
          },
          {
            type: 'replication.write',
            namespace: 'test-ns',
            key: 'historical-2',
            value: { $id: 'historical-2', name: 'Old Data 2' },
            operation: 'create',
            sequence: 2,
          }
        )

        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
        })

        // Start follower - should request catch-up
        await manager.start()
        await vi.advanceTimersByTimeAsync(100)

        // Both historical events should be applied
        expect(mockStateStore.set).toHaveBeenCalledWith(
          'historical-1',
          expect.objectContaining({ name: 'Old Data 1' })
        )
        expect(mockStateStore.set).toHaveBeenCalledWith(
          'historical-2',
          expect.objectContaining({ name: 'Old Data 2' })
        )
      })

      it('should resume from last applied sequence on reconnect', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
          lastAppliedSequence: 5, // Already applied up to sequence 5
        })

        // Simulate catch-up request
        const catchUpSpy = vi.spyOn(manager, 'requestCatchUp' as any)

        await manager.start()

        expect(catchUpSpy).toHaveBeenCalledWith(5)
      })

      it('should not re-apply already applied events during catch-up', async () => {
        // Simulate events in Pipeline including one already applied
        mockPipeline.events.push(
          {
            type: 'replication.write',
            namespace: 'test-ns',
            key: 'item-1',
            value: { $id: 'item-1' },
            operation: 'create',
            sequence: 1,
          },
          {
            type: 'replication.write',
            namespace: 'test-ns',
            key: 'item-2',
            value: { $id: 'item-2' },
            operation: 'create',
            sequence: 2,
          }
        )

        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
          lastAppliedSequence: 1, // Already applied sequence 1
        })

        await manager.start()
        await vi.advanceTimersByTimeAsync(100)

        // Should only apply sequence 2, not sequence 1 again
        expect(mockStateStore.set).toHaveBeenCalledTimes(1)
        expect(mockStateStore.set).toHaveBeenCalledWith(
          'item-2',
          expect.objectContaining({ $id: 'item-2' })
        )
      })
    })

    describe('event ordering', () => {
      it('should apply events in sequence order', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
        })

        await manager.start()

        // Simulate out-of-order event arrival
        mockPipeline.simulateEvent({
          type: 'replication.write',
          namespace: 'test-ns',
          key: 'item-3',
          value: { id: 3 },
          operation: 'create',
          sequence: 3,
        })

        mockPipeline.simulateEvent({
          type: 'replication.write',
          namespace: 'test-ns',
          key: 'item-1',
          value: { id: 1 },
          operation: 'create',
          sequence: 1,
        })

        mockPipeline.simulateEvent({
          type: 'replication.write',
          namespace: 'test-ns',
          key: 'item-2',
          value: { id: 2 },
          operation: 'create',
          sequence: 2,
        })

        await vi.advanceTimersByTimeAsync(100)

        // Should apply in sequence order: 1, 2, 3
        const callOrder = mockStateStore.set.mock.calls.map((call) => call[0])
        expect(callOrder).toEqual(['item-1', 'item-2', 'item-3'])
      })

      it('should buffer out-of-order events until missing events arrive', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
        })

        await manager.start()

        // Receive event 2 before event 1
        mockPipeline.simulateEvent({
          type: 'replication.write',
          namespace: 'test-ns',
          key: 'item-2',
          value: { id: 2 },
          operation: 'create',
          sequence: 2,
        })

        await vi.advanceTimersByTimeAsync(10)

        // Event 2 should be buffered, not applied yet
        expect(mockStateStore.set).not.toHaveBeenCalled()

        // Now receive event 1
        mockPipeline.simulateEvent({
          type: 'replication.write',
          namespace: 'test-ns',
          key: 'item-1',
          value: { id: 1 },
          operation: 'create',
          sequence: 1,
        })

        await vi.advanceTimersByTimeAsync(10)

        // Now both should be applied in order
        expect(mockStateStore.set).toHaveBeenCalledTimes(2)
        expect(mockStateStore.set).toHaveBeenNthCalledWith(1, 'item-1', expect.any(Object))
        expect(mockStateStore.set).toHaveBeenNthCalledWith(2, 'item-2', expect.any(Object))
      })

      it('should handle duplicate events idempotently', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
        })

        await manager.start()

        const event = {
          type: 'replication.write',
          namespace: 'test-ns',
          key: 'item-1',
          value: { id: 1 },
          operation: 'create',
          sequence: 1,
        }

        // Simulate duplicate delivery
        mockPipeline.simulateEvent(event)
        mockPipeline.simulateEvent(event)
        mockPipeline.simulateEvent(event)

        await vi.advanceTimersByTimeAsync(10)

        // Should only apply once
        expect(mockStateStore.set).toHaveBeenCalledTimes(1)
      })
    })
  })

  // ============================================================================
  // FAILOVER SCENARIOS
  // ============================================================================

  describe('Failover', () => {
    describe('leader failure detection', () => {
      it('should detect leader failure via heartbeat timeout', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
          heartbeatService: mockHeartbeat as any,
          heartbeatTimeoutMs: 5000,
        })

        await manager.start()

        const leaderFailedHandler = vi.fn()
        manager.on('leaderFailed', leaderFailedHandler)

        // Simulate leader heartbeat stopping
        mockHeartbeat.setLeaderAlive(false)

        await vi.advanceTimersByTimeAsync(6000)

        expect(leaderFailedHandler).toHaveBeenCalled()
      })

      it('should expose leader status', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
          heartbeatService: mockHeartbeat as any,
        })

        await manager.start()

        expect(manager.isLeaderHealthy()).toBe(true)

        mockHeartbeat.setLeaderAlive(false)
        await vi.advanceTimersByTimeAsync(100)

        expect(manager.isLeaderHealthy()).toBe(false)
      })

      it('should continue serving reads during leader failure', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
          heartbeatService: mockHeartbeat as any,
        })

        await manager.start()

        // Apply some data
        mockPipeline.simulateEvent({
          type: 'replication.write',
          namespace: 'test-ns',
          key: 'customer-123',
          value: { $id: 'customer-123', name: 'Alice' },
          operation: 'create',
          sequence: 1,
        })

        await vi.advanceTimersByTimeAsync(10)

        // Leader fails
        mockHeartbeat.setLeaderAlive(false)

        // Reads should still work
        const result = await manager.read('customer-123')
        expect(result).toEqual({ $id: 'customer-123', name: 'Alice' })
      })
    })

    describe('follower promotion', () => {
      it('should promote follower to leader', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
          heartbeatService: mockHeartbeat as any,
          quorumCallback: createAllowAllQuorumCallback(),
        })

        await manager.start()

        expect(manager.getRole()).toBe(ReplicationRole.Follower)

        await manager.promote()

        expect(manager.getRole()).toBe(ReplicationRole.Leader)
      })

      it('should accept writes after promotion', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
          quorumCallback: createAllowAllQuorumCallback(),
        })

        await manager.start()

        // Write rejected as follower
        let result = await manager.write({
          key: 'customer-123',
          value: { $id: 'customer-123', name: 'Alice' },
          operation: 'create',
        })
        expect(result.success).toBe(false)

        // Promote
        await manager.promote()

        // Write accepted as leader
        result = await manager.write({
          key: 'customer-123',
          value: { $id: 'customer-123', name: 'Alice' },
          operation: 'create',
        })
        expect(result.success).toBe(true)
      })

      it('should emit events after promotion', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
          quorumCallback: createAllowAllQuorumCallback(),
        })

        await manager.start()
        await manager.promote()

        await manager.write({
          key: 'customer-123',
          value: { $id: 'customer-123', name: 'Alice' },
          operation: 'create',
        })

        await vi.advanceTimersByTimeAsync(10)

        expect(mockPipeline.send).toHaveBeenCalled()
      })

      it('should continue sequence numbering from last applied after promotion', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
          quorumCallback: createAllowAllQuorumCallback(),
        })

        await manager.start()

        // Apply some events as follower
        mockPipeline.simulateEvent({
          type: 'replication.write',
          namespace: 'test-ns',
          key: 'item-1',
          value: { id: 1 },
          operation: 'create',
          sequence: 10,
        })

        await vi.advanceTimersByTimeAsync(10)

        // Promote
        await manager.promote()

        // New writes should continue from sequence 11
        await manager.write({
          key: 'item-2',
          value: { id: 2 },
          operation: 'create',
        })

        await vi.advanceTimersByTimeAsync(10)

        const emittedEvents = mockPipeline.events as ReplicationEvent[]
        const lastEvent = emittedEvents[emittedEvents.length - 1]
        expect(lastEvent.sequence).toBe(11)
      })

      it('should emit promotion event to notify other followers', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
          quorumCallback: createAllowAllQuorumCallback(),
        })

        await manager.start()
        await manager.promote()

        await vi.advanceTimersByTimeAsync(10)

        const emittedEvents = mockPipeline.events as any[]
        const promotionEvent = emittedEvents.find((e) => e.type === 'replication.leader_changed')
        expect(promotionEvent).toBeDefined()
        expect(promotionEvent.newLeaderId).toBe('follower-node-1')
      })
    })

    describe('follower reconfiguration', () => {
      it('should reconfigure to new leader on leader change event', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-2',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
        })

        await manager.start()

        expect(manager.getLeaderId()).toBe('leader-node-1')

        // Simulate leader change event
        mockPipeline.simulateEvent({
          type: 'replication.leader_changed',
          namespace: 'test-ns',
          newLeaderId: 'follower-node-1',
          previousLeaderId: 'leader-node-1',
        })

        await vi.advanceTimersByTimeAsync(10)

        expect(manager.getLeaderId()).toBe('follower-node-1')
      })

      it('should redirect writes to new leader after reconfiguration', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-2',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
        })

        await manager.start()

        // Reconfigure to new leader
        mockPipeline.simulateEvent({
          type: 'replication.leader_changed',
          namespace: 'test-ns',
          newLeaderId: 'new-leader-node',
          previousLeaderId: 'leader-node-1',
        })

        await vi.advanceTimersByTimeAsync(10)

        const result = await manager.write({
          key: 'customer-123',
          value: { $id: 'customer-123', name: 'Alice' },
          operation: 'create',
        })

        expect(result.success).toBe(false)
        expect(result.leaderId).toBe('new-leader-node')
      })

      it('should not promote self if not eligible', async () => {
        manager = new LeaderFollowerManager({
          nodeId: 'follower-node-1',
          role: ReplicationRole.Follower,
          pipeline: mockPipeline as any,
          stateStore: mockStateStore as any,
          namespace: 'test-ns',
          leaderId: 'leader-node-1',
          promotionEligible: false, // Not eligible for promotion
        })

        await manager.start()

        await expect(manager.promote()).rejects.toThrow(/not eligible/i)
      })

      it('should handle multiple followers with leader election', async () => {
        // Create multiple followers
        const followers = ['follower-1', 'follower-2', 'follower-3'].map((nodeId) => {
          return new LeaderFollowerManager({
            nodeId,
            role: ReplicationRole.Follower,
            pipeline: mockPipeline as any,
            stateStore: createMockStateStore() as any,
            namespace: 'test-ns',
            leaderId: 'leader-node-1',
            heartbeatService: mockHeartbeat as any,
          })
        })

        // Start all followers
        await Promise.all(followers.map((f) => f.start()))

        // Simulate leader failure
        mockHeartbeat.setLeaderAlive(false)
        await vi.advanceTimersByTimeAsync(6000)

        // Get candidates and verify election can happen
        const candidates = followers.filter((f) => f.canParticipateInElection())
        expect(candidates.length).toBeGreaterThan(0)

        // Cleanup
        await Promise.all(followers.map((f) => f.close()))
      })
    })
  })

  // ============================================================================
  // CONSTRUCTOR AND CONFIG
  // ============================================================================

  describe('constructor and config', () => {
    it('should create manager with required config', () => {
      manager = new LeaderFollowerManager({
        nodeId: 'test-node',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline as any,
        stateStore: mockStateStore as any,
        namespace: 'test-ns',
      })

      expect(manager).toBeInstanceOf(LeaderFollowerManager)
    })

    it('should use default config values', () => {
      manager = new LeaderFollowerManager({
        nodeId: 'test-node',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline as any,
        stateStore: mockStateStore as any,
        namespace: 'test-ns',
      })

      expect(manager.config.heartbeatIntervalMs).toBe(1000)
      expect(manager.config.heartbeatTimeoutMs).toBe(5000)
      expect(manager.config.maxStalenessMs).toBe(30000)
    })

    it('should accept custom config', () => {
      const config: LeaderFollowerConfig = {
        nodeId: 'test-node',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline as any,
        stateStore: mockStateStore as any,
        namespace: 'test-ns',
        heartbeatIntervalMs: 2000,
        heartbeatTimeoutMs: 10000,
        maxStalenessMs: 60000,
      }

      manager = new LeaderFollowerManager(config)

      expect(manager.config.heartbeatIntervalMs).toBe(2000)
      expect(manager.config.heartbeatTimeoutMs).toBe(10000)
      expect(manager.config.maxStalenessMs).toBe(60000)
    })

    it('should expose role', () => {
      manager = new LeaderFollowerManager({
        nodeId: 'test-node',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline as any,
        stateStore: mockStateStore as any,
        namespace: 'test-ns',
      })

      expect(manager.getRole()).toBe(ReplicationRole.Leader)
    })

    it('should expose node ID', () => {
      manager = new LeaderFollowerManager({
        nodeId: 'my-unique-node',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline as any,
        stateStore: mockStateStore as any,
        namespace: 'test-ns',
      })

      expect(manager.getNodeId()).toBe('my-unique-node')
    })
  })

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  describe('lifecycle', () => {
    it('should start heartbeat on leader start', async () => {
      manager = new LeaderFollowerManager({
        nodeId: 'leader-node',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline as any,
        stateStore: mockStateStore as any,
        namespace: 'test-ns',
        heartbeatService: mockHeartbeat as any,
        heartbeatIntervalMs: 1000,
      })

      await manager.start()

      await vi.advanceTimersByTimeAsync(3500)

      // Should have sent heartbeats
      expect(mockHeartbeat.sendHeartbeat).toHaveBeenCalledTimes(3)
    })

    it('should stop heartbeat on close', async () => {
      manager = new LeaderFollowerManager({
        nodeId: 'leader-node',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline as any,
        stateStore: mockStateStore as any,
        namespace: 'test-ns',
        heartbeatService: mockHeartbeat as any,
        heartbeatIntervalMs: 1000,
      })

      await manager.start()
      await vi.advanceTimersByTimeAsync(1500)

      const callCount = mockHeartbeat.sendHeartbeat.mock.calls.length

      await manager.close()

      await vi.advanceTimersByTimeAsync(3000)

      // No more heartbeats after close
      expect(mockHeartbeat.sendHeartbeat.mock.calls.length).toBe(callCount)
    })

    it('should flush pending events before close', async () => {
      manager = new LeaderFollowerManager({
        nodeId: 'leader-node',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline as any,
        stateStore: mockStateStore as any,
        namespace: 'test-ns',
      })

      await manager.start()

      await manager.write({
        key: 'customer-123',
        value: { $id: 'customer-123', name: 'Alice' },
        operation: 'create',
      })

      await manager.close()

      // Events should be flushed
      expect(mockPipeline.send).toHaveBeenCalled()
    })

    it('should expose closed state', async () => {
      manager = new LeaderFollowerManager({
        nodeId: 'test-node',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline as any,
        stateStore: mockStateStore as any,
        namespace: 'test-ns',
      })

      expect(manager.isClosed()).toBe(false)

      await manager.close()

      expect(manager.isClosed()).toBe(true)
    })

    it('should reject operations after close', async () => {
      manager = new LeaderFollowerManager({
        nodeId: 'leader-node',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline as any,
        stateStore: mockStateStore as any,
        namespace: 'test-ns',
      })

      await manager.close()

      const result = await manager.write({
        key: 'customer-123',
        value: { $id: 'customer-123', name: 'Alice' },
        operation: 'create',
      })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('MANAGER_CLOSED')
    })
  })

  // ============================================================================
  // METRICS AND OBSERVABILITY
  // ============================================================================

  describe('metrics and observability', () => {
    it('should expose replication metrics', async () => {
      manager = new LeaderFollowerManager({
        nodeId: 'leader-node',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline as any,
        stateStore: mockStateStore as any,
        namespace: 'test-ns',
      })

      await manager.start()

      await manager.write({ key: 'item-1', value: { id: 1 }, operation: 'create' })
      await manager.write({ key: 'item-2', value: { id: 2 }, operation: 'create' })

      await vi.advanceTimersByTimeAsync(10)

      const metrics = manager.getMetrics()
      expect(metrics.eventsEmitted).toBe(2)
      expect(metrics.role).toBe(ReplicationRole.Leader)
    })

    it('should track events applied as follower', async () => {
      manager = new LeaderFollowerManager({
        nodeId: 'follower-node',
        role: ReplicationRole.Follower,
        pipeline: mockPipeline as any,
        stateStore: mockStateStore as any,
        namespace: 'test-ns',
        leaderId: 'leader-node',
      })

      await manager.start()

      mockPipeline.simulateEvent({
        type: 'replication.write',
        namespace: 'test-ns',
        key: 'item-1',
        value: { id: 1 },
        operation: 'create',
        sequence: 1,
      })

      mockPipeline.simulateEvent({
        type: 'replication.write',
        namespace: 'test-ns',
        key: 'item-2',
        value: { id: 2 },
        operation: 'create',
        sequence: 2,
      })

      await vi.advanceTimersByTimeAsync(10)

      const metrics = manager.getMetrics()
      expect(metrics.eventsApplied).toBe(2)
    })

    it('should emit events for observability', async () => {
      manager = new LeaderFollowerManager({
        nodeId: 'leader-node',
        role: ReplicationRole.Leader,
        pipeline: mockPipeline as any,
        stateStore: mockStateStore as any,
        namespace: 'test-ns',
      })

      const writeHandler = vi.fn()
      const promotionHandler = vi.fn()

      manager.on('write', writeHandler)
      manager.on('promoted', promotionHandler)

      await manager.start()

      await manager.write({
        key: 'customer-123',
        value: { $id: 'customer-123', name: 'Alice' },
        operation: 'create',
      })

      expect(writeHandler).toHaveBeenCalled()
    })
  })
})
