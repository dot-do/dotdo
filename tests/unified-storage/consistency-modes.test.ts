/**
 * ConsistencyModes tests - Configurable strong/eventual consistency modes
 *
 * Tests consistency levels for distributed storage operations:
 * - `strong` - Wait for leader acknowledgment (LeaderFollower) or quorum (MultiMaster)
 * - `eventual` - Return immediately after local write, propagate async
 * - `read-your-writes` - Ensure read returns own writes (session consistency)
 * - `causal` - Respect causal ordering via vector clocks
 *
 * @see /objects/unified-storage/consistency-modes.ts
 * @issue do-2tr.1.9
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  ConsistencyController,
  ConsistencyLevel,
  type ConsistencyConfig,
  type WriteOp,
  type StateStore,
  calculateMajorityQuorum,
  isQuorumSatisfied,
  compareVectorClocks,
} from '../../objects/unified-storage/consistency-modes'

// ============================================================================
// MOCK FACTORIES
// ============================================================================

/**
 * Create a mock state store for testing
 */
function createMockStateStore(): StateStore & {
  data: Map<string, unknown>
  clear: () => void
} {
  const data = new Map<string, unknown>()

  return {
    data,
    get: vi.fn((key: string) => data.get(key)),
    set: vi.fn((key: string, value: unknown) => {
      data.set(key, value)
      return data.size
    }),
    delete: vi.fn((key: string) => {
      const existed = data.has(key)
      data.delete(key)
      return existed
    }),
    has: vi.fn((key: string) => data.has(key)),
    clear: () => data.clear(),
  }
}

type MockStateStore = ReturnType<typeof createMockStateStore>

// ============================================================================
// TEST SUITE
// ============================================================================

describe('ConsistencyModes', () => {
  let controller: ConsistencyController
  let mockStateStore: MockStateStore

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockStateStore = createMockStateStore()
  })

  afterEach(() => {
    vi.useRealTimers()
    mockStateStore.clear()
    controller?.clearPendingAcks()
    controller?.clearSessions()
  })

  // ==========================================================================
  // Constructor and Configuration Tests
  // ==========================================================================

  describe('constructor and configuration', () => {
    it('should create controller with required config', () => {
      controller = new ConsistencyController({
        defaultLevel: ConsistencyLevel.Strong,
      })

      expect(controller).toBeInstanceOf(ConsistencyController)
      expect(controller.getDefaultLevel()).toBe(ConsistencyLevel.Strong)
    })

    it('should use default values for optional config', () => {
      controller = new ConsistencyController({
        defaultLevel: ConsistencyLevel.Eventual,
      })

      expect(controller.config.maxStalenessMs).toBe(30000)
      expect(controller.config.defaultTimeoutMs).toBe(5000)
      expect(controller.config.replicaCount).toBe(3)
    })

    it('should accept custom configuration', () => {
      const config: ConsistencyConfig = {
        defaultLevel: ConsistencyLevel.Strong,
        quorumSize: 3,
        replicaCount: 5,
        maxStalenessMs: 60000,
        defaultTimeoutMs: 10000,
        nodeId: 'custom-node',
      }

      controller = new ConsistencyController(config)

      expect(controller.config.quorumSize).toBe(3)
      expect(controller.config.replicaCount).toBe(5)
      expect(controller.config.maxStalenessMs).toBe(60000)
      expect(controller.config.defaultTimeoutMs).toBe(10000)
      expect(controller.config.nodeId).toBe('custom-node')
    })

    it('should calculate default quorum as majority', () => {
      controller = new ConsistencyController({
        defaultLevel: ConsistencyLevel.Strong,
        replicaCount: 5,
      })

      // Majority of 5 is 3
      expect(controller.getQuorumSize()).toBe(3)
    })

    it('should accept state store dependency', () => {
      controller = new ConsistencyController(
        { defaultLevel: ConsistencyLevel.Eventual },
        mockStateStore
      )

      expect(controller).toBeInstanceOf(ConsistencyController)
    })
  })

  // ==========================================================================
  // Strong Consistency Tests
  // ==========================================================================

  describe('strong consistency', () => {
    beforeEach(() => {
      controller = new ConsistencyController(
        {
          defaultLevel: ConsistencyLevel.Strong,
          defaultTimeoutMs: 1000,
          quorumSize: 2,
        },
        mockStateStore
      )
    })

    describe('writes', () => {
      it('should perform local write immediately', async () => {
        const writePromise = controller.write({
          key: 'customer-123',
          value: { name: 'Alice' },
          operation: 'create',
        })

        // Simulate acknowledgment
        setTimeout(() => controller.acknowledge(1), 50)
        await vi.advanceTimersByTimeAsync(100)

        const result = await writePromise

        expect(result.success).toBe(true)
        expect(mockStateStore.set).toHaveBeenCalledWith(
          'customer-123',
          expect.objectContaining({ name: 'Alice' })
        )
      })

      it('should wait for acknowledgment before returning', async () => {
        const startTime = Date.now()

        const writePromise = controller.write({
          key: 'customer-123',
          value: { name: 'Alice' },
          operation: 'create',
        })

        // Acknowledge after 200ms
        setTimeout(() => controller.acknowledge(1), 200)
        await vi.advanceTimersByTimeAsync(250)

        const result = await writePromise

        expect(result.success).toBe(true)
        expect(result.acked).toBe(true)
        expect(result.ackWaitMs).toBeGreaterThanOrEqual(200)
      })

      it('should timeout if acknowledgment not received', async () => {
        const writePromise = controller.write(
          {
            key: 'customer-123',
            value: { name: 'Alice' },
            operation: 'create',
          },
          ConsistencyLevel.Strong,
          500 // 500ms timeout
        )

        // Don't send acknowledgment
        await vi.advanceTimersByTimeAsync(600)

        const result = await writePromise

        expect(result.success).toBe(true) // Local write succeeded
        expect(result.acked).toBe(false) // But not acknowledged
        expect(result.errorCode).toBe('ACK_TIMEOUT')
      })

      it('should track ack wait time in metrics', async () => {
        const writePromise = controller.write({
          key: 'customer-123',
          value: { name: 'Alice' },
          operation: 'create',
        })

        setTimeout(() => controller.acknowledge(1), 100)
        await vi.advanceTimersByTimeAsync(150)
        await writePromise

        const metrics = controller.getMetrics()
        expect(metrics.strongWriteCount).toBe(1)
        expect(metrics.avgAckWaitMs).toBeGreaterThanOrEqual(100)
      })

      it('should include sequence number in result', async () => {
        const writePromise = controller.write({
          key: 'customer-123',
          value: { name: 'Alice' },
          operation: 'create',
        })

        setTimeout(() => controller.acknowledge(1), 50)
        await vi.advanceTimersByTimeAsync(100)

        const result = await writePromise

        expect(result.sequence).toBe(1)
      })

      it('should increment sequence for multiple writes', async () => {
        // First write
        const promise1 = controller.write({
          key: 'item-1',
          value: { id: 1 },
          operation: 'create',
        })
        setTimeout(() => controller.acknowledge(1), 50)
        await vi.advanceTimersByTimeAsync(100)
        const result1 = await promise1

        // Second write
        const promise2 = controller.write({
          key: 'item-2',
          value: { id: 2 },
          operation: 'create',
        })
        setTimeout(() => controller.acknowledge(2), 50)
        await vi.advanceTimersByTimeAsync(100)
        const result2 = await promise2

        expect(result1.sequence).toBe(1)
        expect(result2.sequence).toBe(2)
      })
    })

    describe('reads', () => {
      it('should wait for replication before reading', async () => {
        // Write some data
        mockStateStore.set('customer-123', { name: 'Alice' })
        controller.updateAppliedSequence(0)
        controller.updateCurrentSequence(1)

        const readPromise = controller.read('customer-123', ConsistencyLevel.Strong)

        // Simulate replication completing
        setTimeout(() => controller.updateAppliedSequence(1), 100)
        await vi.advanceTimersByTimeAsync(150)

        const result = await readPromise

        expect(result.waited).toBe(true)
        expect(result.value).toEqual({ name: 'Alice' })
      })

      it('should return immediately if already replicated', async () => {
        mockStateStore.set('customer-123', { name: 'Alice' })
        controller.updateAppliedSequence(1)
        controller.updateCurrentSequence(1)

        const result = await controller.read('customer-123', ConsistencyLevel.Strong)

        expect(result.waited).toBe(false)
        expect(result.value).toEqual({ name: 'Alice' })
      })

      it('should indicate staleness on timeout', async () => {
        mockStateStore.set('customer-123', { name: 'Alice' })
        controller.updateAppliedSequence(0)
        controller.updateCurrentSequence(5) // Far ahead

        const readPromise = controller.read(
          'customer-123',
          ConsistencyLevel.Strong,
          100 // Short timeout
        )

        await vi.advanceTimersByTimeAsync(150)

        const result = await readPromise

        expect(result.stale).toBe(true)
      })
    })
  })

  // ==========================================================================
  // Eventual Consistency Tests
  // ==========================================================================

  describe('eventual consistency', () => {
    beforeEach(() => {
      controller = new ConsistencyController(
        {
          defaultLevel: ConsistencyLevel.Eventual,
          maxStalenessMs: 5000,
        },
        mockStateStore
      )
    })

    describe('writes', () => {
      it('should return immediately after local write', async () => {
        const result = await controller.write({
          key: 'customer-123',
          value: { name: 'Alice' },
          operation: 'create',
        })

        expect(result.success).toBe(true)
        expect(result.acked).toBe(false) // No wait for ack
        expect(result.ackWaitMs).toBe(0)
      })

      it('should perform local write synchronously', async () => {
        const result = await controller.write({
          key: 'customer-123',
          value: { name: 'Alice' },
          operation: 'create',
        })

        expect(result.success).toBe(true)
        expect(mockStateStore.set).toHaveBeenCalledWith(
          'customer-123',
          expect.objectContaining({ name: 'Alice' })
        )
      })

      it('should track eventual write metrics', async () => {
        await controller.write({
          key: 'item-1',
          value: { id: 1 },
          operation: 'create',
        })

        await controller.write({
          key: 'item-2',
          value: { id: 2 },
          operation: 'create',
        })

        const metrics = controller.getMetrics()
        expect(metrics.eventualWriteCount).toBe(2)
        expect(metrics.writesByLevel[ConsistencyLevel.Eventual]).toBe(2)
      })

      it('should handle delete operations', async () => {
        // First create
        await controller.write({
          key: 'customer-123',
          value: { name: 'Alice' },
          operation: 'create',
        })

        // Then delete
        const result = await controller.write({
          key: 'customer-123',
          value: null,
          operation: 'delete',
        })

        expect(result.success).toBe(true)
        expect(mockStateStore.delete).toHaveBeenCalledWith('customer-123')
      })
    })

    describe('reads', () => {
      it('should return immediately without waiting', async () => {
        mockStateStore.set('customer-123', { name: 'Alice' })

        const result = await controller.read('customer-123', ConsistencyLevel.Eventual)

        expect(result.waited).toBe(false)
        expect(result.waitMs).toBe(0)
        expect(result.value).toEqual({ name: 'Alice' })
      })

      it('should indicate staleness based on maxStalenessMs', async () => {
        mockStateStore.set('customer-123', { name: 'Alice' })
        controller.updateLastWriteTimestamp(Date.now())

        // Advance time past staleness threshold
        await vi.advanceTimersByTimeAsync(10000)

        const result = await controller.read('customer-123', ConsistencyLevel.Eventual)

        expect(result.stale).toBe(true)
      })

      it('should not be stale within maxStalenessMs', async () => {
        mockStateStore.set('customer-123', { name: 'Alice' })
        controller.updateLastWriteTimestamp(Date.now())

        // Advance time but stay within threshold
        await vi.advanceTimersByTimeAsync(1000)

        const result = await controller.read('customer-123', ConsistencyLevel.Eventual)

        expect(result.stale).toBe(false)
      })

      it('should track stale read metrics', async () => {
        mockStateStore.set('customer-123', { name: 'Alice' })
        controller.updateLastWriteTimestamp(Date.now())

        // Advance time past staleness threshold
        await vi.advanceTimersByTimeAsync(10000)

        await controller.read('customer-123', ConsistencyLevel.Eventual)
        await controller.read('customer-456', ConsistencyLevel.Eventual)

        const metrics = controller.getMetrics()
        expect(metrics.staleReadCount).toBe(2)
      })

      it('should return null for non-existent keys', async () => {
        const result = await controller.read('non-existent', ConsistencyLevel.Eventual)

        expect(result.value).toBeNull()
      })
    })
  })

  // ==========================================================================
  // Read-Your-Writes Consistency Tests
  // ==========================================================================

  describe('read-your-writes consistency', () => {
    beforeEach(() => {
      controller = new ConsistencyController(
        {
          defaultLevel: ConsistencyLevel.ReadYourWrites,
          defaultTimeoutMs: 1000,
          nodeId: 'test-node',
        },
        mockStateStore
      )
    })

    describe('session tracking', () => {
      it('should track session after write', async () => {
        await controller.write({
          key: 'customer-123',
          value: { name: 'Alice' },
          operation: 'create',
        })

        const sessionId = controller.createSession()
        const session = controller.getSession(sessionId)

        expect(session).toBeDefined()
      })

      it('should allow creating custom session', () => {
        const sessionId = controller.createSession('my-session')

        expect(sessionId).toBe('my-session')

        const session = controller.getSession('my-session')
        expect(session).toBeDefined()
        expect(session?.sessionId).toBe('my-session')
      })

      it('should track last write sequence per session', async () => {
        controller.setDefaultSession('session-1')

        await controller.write({
          key: 'item-1',
          value: { id: 1 },
          operation: 'create',
        })

        await controller.write({
          key: 'item-2',
          value: { id: 2 },
          operation: 'create',
        })

        const session = controller.getSession('session-1')
        expect(session?.lastWriteSequence).toBe(2)
      })
    })

    describe('writes', () => {
      it('should update session state on write', async () => {
        controller.setDefaultSession('my-session')

        await controller.write({
          key: 'customer-123',
          value: { name: 'Alice' },
          operation: 'create',
        })

        const session = controller.getSession('my-session')
        expect(session?.lastWriteSequence).toBe(1)
        expect(session?.lastWriteTimestamp).toBeGreaterThan(0)
      })

      it('should perform local write', async () => {
        const result = await controller.write({
          key: 'customer-123',
          value: { name: 'Alice' },
          operation: 'create',
        })

        expect(result.success).toBe(true)
        expect(mockStateStore.set).toHaveBeenCalled()
      })
    })

    describe('reads', () => {
      it('should wait for own writes to be visible', async () => {
        controller.setDefaultSession('my-session')

        // Write data
        await controller.write({
          key: 'customer-123',
          value: { name: 'Alice' },
          operation: 'create',
        })

        // Simulate replication lag
        controller.updateAppliedSequence(0)

        const readPromise = controller.read(
          'customer-123',
          ConsistencyLevel.ReadYourWrites
        )

        // Simulate replication completing
        setTimeout(() => controller.updateAppliedSequence(1), 100)
        await vi.advanceTimersByTimeAsync(150)

        const result = await readPromise

        expect(result.waited).toBe(true)
        expect(result.waitMs).toBeGreaterThanOrEqual(100)
      })

      it('should return immediately if own writes already visible', async () => {
        controller.setDefaultSession('my-session')

        // Write data
        await controller.write({
          key: 'customer-123',
          value: { name: 'Alice' },
          operation: 'create',
        })

        // Mark as replicated
        controller.updateAppliedSequence(1)

        const result = await controller.read(
          'customer-123',
          ConsistencyLevel.ReadYourWrites
        )

        expect(result.waited).toBe(false)
      })

      it('should track session violation on timeout', async () => {
        controller.setDefaultSession('my-session')

        // Write data
        await controller.write({
          key: 'customer-123',
          value: { name: 'Alice' },
          operation: 'create',
        })

        // Keep replication behind
        controller.updateAppliedSequence(0)

        const readPromise = controller.read(
          'customer-123',
          ConsistencyLevel.ReadYourWrites,
          100 // Short timeout
        )

        await vi.advanceTimersByTimeAsync(150)
        await readPromise

        const metrics = controller.getMetrics()
        expect(metrics.sessionViolationCount).toBe(1)
      })

      it('should work with no prior writes in session', async () => {
        controller.setDefaultSession('new-session')
        mockStateStore.set('customer-123', { name: 'Alice' })

        const result = await controller.read(
          'customer-123',
          ConsistencyLevel.ReadYourWrites
        )

        expect(result.waited).toBe(false)
        expect(result.value).toEqual({ name: 'Alice' })
      })
    })
  })

  // ==========================================================================
  // Causal Consistency Tests
  // ==========================================================================

  describe('causal consistency', () => {
    beforeEach(() => {
      controller = new ConsistencyController(
        {
          defaultLevel: ConsistencyLevel.Causal,
          defaultTimeoutMs: 1000,
          nodeId: 'node-a',
        },
        mockStateStore
      )
    })

    describe('vector clock management', () => {
      it('should initialize vector clock with own node', () => {
        const clock = controller.getVectorClock()

        expect(clock['node-a']).toBeDefined()
        expect(clock['node-a']).toBe(0)
      })

      it('should increment vector clock on write', async () => {
        await controller.write({
          key: 'item-1',
          value: { id: 1 },
          operation: 'create',
        })

        const clock = controller.getVectorClock()
        expect(clock['node-a']).toBe(1)
      })

      it('should increment for each write', async () => {
        await controller.write({
          key: 'item-1',
          value: { id: 1 },
          operation: 'create',
        })

        await controller.write({
          key: 'item-2',
          value: { id: 2 },
          operation: 'create',
        })

        await controller.write({
          key: 'item-3',
          value: { id: 3 },
          operation: 'create',
        })

        const clock = controller.getVectorClock()
        expect(clock['node-a']).toBe(3)
      })

      it('should merge incoming vector clocks', async () => {
        // Write with incoming vector clock
        await controller.write({
          key: 'item-1',
          value: { id: 1 },
          operation: 'create',
          vectorClock: { 'node-b': 5, 'node-c': 3 },
        })

        const clock = controller.getVectorClock()
        expect(clock['node-a']).toBe(1)
        expect(clock['node-b']).toBe(5)
        expect(clock['node-c']).toBe(3)
      })

      it('should take max on merge', async () => {
        // Set initial clock
        controller.setVectorClockEntry('node-b', 10)

        // Write with lower value for node-b
        await controller.write({
          key: 'item-1',
          value: { id: 1 },
          operation: 'create',
          vectorClock: { 'node-b': 5 }, // Lower than current
        })

        const clock = controller.getVectorClock()
        expect(clock['node-b']).toBe(10) // Should keep higher value
      })
    })

    describe('writes', () => {
      it('should include vector clock in result', async () => {
        const result = await controller.write({
          key: 'item-1',
          value: { id: 1 },
          operation: 'create',
        })

        expect(result.success).toBe(true)
        expect(result.sequence).toBe(1)
      })

      it('should track session with vector clock', async () => {
        controller.setDefaultSession('my-session')

        await controller.write({
          key: 'item-1',
          value: { id: 1 },
          operation: 'create',
        })

        const session = controller.getSession('my-session')
        expect(session?.lastWriteVectorClock).toBeDefined()
        expect(session?.lastWriteVectorClock?.['node-a']).toBe(1)
      })
    })

    describe('reads', () => {
      it('should respect vector clock ordering', async () => {
        controller.setDefaultSession('my-session')

        // Write with vector clock
        await controller.write({
          key: 'item-1',
          value: { id: 1 },
          operation: 'create',
        })

        // Set local clock to satisfy dependency
        controller.setVectorClockEntry('node-a', 1)

        mockStateStore.set('item-1', { id: 1 })

        const result = await controller.read('item-1', ConsistencyLevel.Causal)

        expect(result.value).toEqual({ id: 1 })
        expect(result.vectorClock).toBeDefined()
      })

      it('should wait for causal dependencies', async () => {
        controller.setDefaultSession('my-session')

        // Write with vector clock
        await controller.write({
          key: 'item-1',
          value: { id: 1 },
          operation: 'create',
          vectorClock: { 'node-b': 5 }, // Depends on node-b:5
        })

        // Reset local clock to simulate dependency not met
        controller.setVectorClockEntry('node-b', 0)

        mockStateStore.set('item-1', { id: 1 })

        const readPromise = controller.read('item-1', ConsistencyLevel.Causal)

        // Simulate receiving the dependency
        setTimeout(() => controller.setVectorClockEntry('node-b', 5), 100)
        await vi.advanceTimersByTimeAsync(150)

        const result = await readPromise

        expect(result.waited).toBe(true)
      })

      it('should track causal violation on timeout', async () => {
        controller.setDefaultSession('my-session')

        // Write with vector clock dependency
        await controller.write({
          key: 'item-1',
          value: { id: 1 },
          operation: 'create',
          vectorClock: { 'node-b': 100 }, // Unreachable dependency
        })

        // Reset local clock
        controller.setVectorClockEntry('node-b', 0)

        mockStateStore.set('item-1', { id: 1 })

        const readPromise = controller.read(
          'item-1',
          ConsistencyLevel.Causal,
          100 // Short timeout
        )

        await vi.advanceTimersByTimeAsync(150)
        await readPromise

        const metrics = controller.getMetrics()
        expect(metrics.causalViolationCount).toBe(1)
      })

      it('should return immediately if causal dependencies satisfied', async () => {
        controller.setDefaultSession('my-session')

        // Write
        await controller.write({
          key: 'item-1',
          value: { id: 1 },
          operation: 'create',
        })

        mockStateStore.set('item-1', { id: 1 })

        const result = await controller.read('item-1', ConsistencyLevel.Causal)

        expect(result.waited).toBe(false)
      })
    })
  })

  // ==========================================================================
  // Timeout Handling Tests
  // ==========================================================================

  describe('timeout handling', () => {
    beforeEach(() => {
      controller = new ConsistencyController(
        {
          defaultLevel: ConsistencyLevel.Strong,
          defaultTimeoutMs: 1000,
        },
        mockStateStore
      )
    })

    it('should use default timeout if not specified', async () => {
      const writePromise = controller.write({
        key: 'item-1',
        value: { id: 1 },
        operation: 'create',
      })

      // Wait past default timeout (1000ms)
      await vi.advanceTimersByTimeAsync(1100)

      const result = await writePromise

      expect(result.acked).toBe(false)
      expect(result.errorCode).toBe('ACK_TIMEOUT')
    })

    it('should use custom timeout when specified', async () => {
      const writePromise = controller.write(
        {
          key: 'item-1',
          value: { id: 1 },
          operation: 'create',
        },
        ConsistencyLevel.Strong,
        500 // Custom 500ms timeout
      )

      // Advance 600ms (past custom timeout, but before default)
      await vi.advanceTimersByTimeAsync(600)

      const result = await writePromise

      expect(result.acked).toBe(false)
    })

    it('should succeed if ack received before timeout', async () => {
      const writePromise = controller.write(
        {
          key: 'item-1',
          value: { id: 1 },
          operation: 'create',
        },
        ConsistencyLevel.Strong,
        1000
      )

      // Acknowledge quickly
      setTimeout(() => controller.acknowledge(1), 100)
      await vi.advanceTimersByTimeAsync(200)

      const result = await writePromise

      expect(result.acked).toBe(true)
      expect(result.ackWaitMs).toBeLessThan(1000)
    })

    it('should handle multiple pending acks with different timeouts', async () => {
      const promise1 = controller.write(
        { key: 'item-1', value: { id: 1 }, operation: 'create' },
        ConsistencyLevel.Strong,
        500
      )

      const promise2 = controller.write(
        { key: 'item-2', value: { id: 2 }, operation: 'create' },
        ConsistencyLevel.Strong,
        1500
      )

      // First times out at 500ms
      await vi.advanceTimersByTimeAsync(600)
      const result1 = await promise1
      expect(result1.acked).toBe(false)

      // Acknowledge second before its timeout
      setTimeout(() => controller.acknowledge(2), 100)
      await vi.advanceTimersByTimeAsync(200)
      const result2 = await promise2
      expect(result2.acked).toBe(true)
    })

    it('should clear pending acks on clearPendingAcks()', async () => {
      const writePromise = controller.write({
        key: 'item-1',
        value: { id: 1 },
        operation: 'create',
      })

      // Clear pending acks
      controller.clearPendingAcks()

      const result = await writePromise

      expect(result.acked).toBe(false)
    })
  })

  // ==========================================================================
  // Level Override Tests
  // ==========================================================================

  describe('level override per operation', () => {
    beforeEach(() => {
      controller = new ConsistencyController(
        {
          defaultLevel: ConsistencyLevel.Eventual, // Default is eventual
        },
        mockStateStore
      )
    })

    it('should use default level when not specified', async () => {
      const result = await controller.write({
        key: 'item-1',
        value: { id: 1 },
        operation: 'create',
      })

      expect(result.success).toBe(true)
      expect(result.acked).toBe(false) // Eventual doesn't wait

      const metrics = controller.getMetrics()
      expect(metrics.writesByLevel[ConsistencyLevel.Eventual]).toBe(1)
    })

    it('should override to strong for specific write', async () => {
      const writePromise = controller.write(
        {
          key: 'item-1',
          value: { id: 1 },
          operation: 'create',
        },
        ConsistencyLevel.Strong // Override to strong
      )

      // Acknowledge
      setTimeout(() => controller.acknowledge(1), 50)
      await vi.advanceTimersByTimeAsync(100)

      const result = await writePromise

      expect(result.acked).toBe(true)

      const metrics = controller.getMetrics()
      expect(metrics.writesByLevel[ConsistencyLevel.Strong]).toBe(1)
    })

    it('should override to eventual for specific read', async () => {
      mockStateStore.set('item-1', { id: 1 })

      const result = await controller.read('item-1', ConsistencyLevel.Eventual)

      expect(result.waited).toBe(false)

      const metrics = controller.getMetrics()
      expect(metrics.readsByLevel[ConsistencyLevel.Eventual]).toBe(1)
    })

    it('should track metrics by level correctly', async () => {
      // Eventual write (default)
      await controller.write({
        key: 'item-1',
        value: { id: 1 },
        operation: 'create',
      })

      // Strong write (override)
      const strongPromise = controller.write(
        {
          key: 'item-2',
          value: { id: 2 },
          operation: 'create',
        },
        ConsistencyLevel.Strong
      )
      setTimeout(() => controller.acknowledge(2), 50)
      await vi.advanceTimersByTimeAsync(100)
      await strongPromise

      // Read-your-writes write (override)
      await controller.write(
        {
          key: 'item-3',
          value: { id: 3 },
          operation: 'create',
        },
        ConsistencyLevel.ReadYourWrites
      )

      const metrics = controller.getMetrics()
      expect(metrics.writesByLevel[ConsistencyLevel.Eventual]).toBe(1)
      expect(metrics.writesByLevel[ConsistencyLevel.Strong]).toBe(1)
      expect(metrics.writesByLevel[ConsistencyLevel.ReadYourWrites]).toBe(1)
    })
  })

  // ==========================================================================
  // Staleness Check Tests
  // ==========================================================================

  describe('staleness check', () => {
    beforeEach(() => {
      controller = new ConsistencyController({
        defaultLevel: ConsistencyLevel.Eventual,
        maxStalenessMs: 5000,
      })
    })

    it('should not be stale within threshold', () => {
      const now = Date.now()
      expect(controller.isStale(now - 1000, 5000)).toBe(false)
    })

    it('should be stale past threshold', () => {
      const now = Date.now()
      expect(controller.isStale(now - 10000, 5000)).toBe(true)
    })

    it('should be stale at exactly threshold', () => {
      const now = Date.now()
      expect(controller.isStale(now - 5001, 5000)).toBe(true)
    })

    it('should not be stale at exactly threshold boundary', () => {
      const now = Date.now()
      expect(controller.isStale(now - 5000, 5000)).toBe(false)
    })
  })

  // ==========================================================================
  // Wait For Replication Tests
  // ==========================================================================

  describe('waitForReplication', () => {
    beforeEach(() => {
      controller = new ConsistencyController(
        {
          defaultLevel: ConsistencyLevel.Strong,
          defaultTimeoutMs: 1000,
        },
        mockStateStore
      )
    })

    it('should return true immediately if already at sequence', async () => {
      controller.updateAppliedSequence(5)

      const result = await controller.waitForReplication(5)

      expect(result).toBe(true)
    })

    it('should return true if past sequence', async () => {
      controller.updateAppliedSequence(10)

      const result = await controller.waitForReplication(5)

      expect(result).toBe(true)
    })

    it('should wait and return true when sequence reached', async () => {
      controller.updateAppliedSequence(0)

      const waitPromise = controller.waitForReplication(5, 1000)

      // Simulate replication progress
      setTimeout(() => controller.updateAppliedSequence(5), 100)
      await vi.advanceTimersByTimeAsync(150)

      const result = await waitPromise

      expect(result).toBe(true)
    })

    it('should timeout and return false if sequence not reached', async () => {
      controller.updateAppliedSequence(0)

      const waitPromise = controller.waitForReplication(100, 500)

      await vi.advanceTimersByTimeAsync(600)

      const result = await waitPromise

      expect(result).toBe(false)
    })
  })

  // ==========================================================================
  // Utility Function Tests
  // ==========================================================================

  describe('utility functions', () => {
    describe('calculateMajorityQuorum', () => {
      it('should return majority for odd numbers', () => {
        expect(calculateMajorityQuorum(3)).toBe(2)
        expect(calculateMajorityQuorum(5)).toBe(3)
        expect(calculateMajorityQuorum(7)).toBe(4)
      })

      it('should return majority for even numbers', () => {
        expect(calculateMajorityQuorum(2)).toBe(2)
        expect(calculateMajorityQuorum(4)).toBe(3)
        expect(calculateMajorityQuorum(6)).toBe(4)
      })

      it('should return 1 for single replica', () => {
        expect(calculateMajorityQuorum(1)).toBe(1)
      })
    })

    describe('isQuorumSatisfied', () => {
      it('should return true if acked count meets quorum', () => {
        expect(isQuorumSatisfied(2, 2)).toBe(true)
        expect(isQuorumSatisfied(3, 2)).toBe(true)
      })

      it('should return false if acked count below quorum', () => {
        expect(isQuorumSatisfied(1, 2)).toBe(false)
        expect(isQuorumSatisfied(0, 2)).toBe(false)
      })
    })

    describe('compareVectorClocks', () => {
      it('should detect equal clocks', () => {
        const a = { x: 1, y: 2 }
        const b = { x: 1, y: 2 }

        expect(compareVectorClocks(a, b)).toBe('equal')
      })

      it('should detect before relationship', () => {
        const a = { x: 1, y: 1 }
        const b = { x: 2, y: 1 }

        expect(compareVectorClocks(a, b)).toBe('before')
      })

      it('should detect after relationship', () => {
        const a = { x: 2, y: 2 }
        const b = { x: 1, y: 1 }

        expect(compareVectorClocks(a, b)).toBe('after')
      })

      it('should detect concurrent clocks', () => {
        const a = { x: 2, y: 1 }
        const b = { x: 1, y: 2 }

        expect(compareVectorClocks(a, b)).toBe('concurrent')
      })

      it('should handle different node sets', () => {
        const a = { x: 1 }
        const b = { x: 1, y: 1 }

        expect(compareVectorClocks(a, b)).toBe('before')
      })

      it('should handle empty clocks', () => {
        const a = {}
        const b = {}

        expect(compareVectorClocks(a, b)).toBe('equal')
      })

      it('should handle one empty clock', () => {
        const a = {}
        const b = { x: 1 }

        expect(compareVectorClocks(a, b)).toBe('before')
        expect(compareVectorClocks(b, a)).toBe('after')
      })
    })
  })

  // ==========================================================================
  // Metrics Tests
  // ==========================================================================

  describe('metrics', () => {
    beforeEach(() => {
      controller = new ConsistencyController(
        {
          defaultLevel: ConsistencyLevel.Eventual,
        },
        mockStateStore
      )
    })

    it('should track writes by level', async () => {
      await controller.write(
        { key: 'item-1', value: 1, operation: 'create' },
        ConsistencyLevel.Eventual
      )

      const strongPromise = controller.write(
        { key: 'item-2', value: 2, operation: 'create' },
        ConsistencyLevel.Strong
      )
      setTimeout(() => controller.acknowledge(2), 10)
      await vi.advanceTimersByTimeAsync(50)
      await strongPromise

      const metrics = controller.getMetrics()
      expect(metrics.writesByLevel[ConsistencyLevel.Eventual]).toBe(1)
      expect(metrics.writesByLevel[ConsistencyLevel.Strong]).toBe(1)
    })

    it('should track reads by level', async () => {
      mockStateStore.set('item-1', { id: 1 })
      controller.updateAppliedSequence(1)

      await controller.read('item-1', ConsistencyLevel.Eventual)
      await controller.read('item-1', ConsistencyLevel.Strong)

      const metrics = controller.getMetrics()
      expect(metrics.readsByLevel[ConsistencyLevel.Eventual]).toBe(1)
      expect(metrics.readsByLevel[ConsistencyLevel.Strong]).toBe(1)
    })

    it('should reset metrics', async () => {
      await controller.write(
        { key: 'item-1', value: 1, operation: 'create' },
        ConsistencyLevel.Eventual
      )

      controller.resetMetrics()

      const metrics = controller.getMetrics()
      expect(metrics.eventualWriteCount).toBe(0)
      expect(metrics.writesByLevel[ConsistencyLevel.Eventual]).toBe(0)
    })

    it('should calculate average ack wait time', async () => {
      // First strong write - 100ms
      const promise1 = controller.write(
        { key: 'item-1', value: 1, operation: 'create' },
        ConsistencyLevel.Strong
      )
      setTimeout(() => controller.acknowledge(1), 100)
      await vi.advanceTimersByTimeAsync(150)
      await promise1

      // Second strong write - 200ms
      const promise2 = controller.write(
        { key: 'item-2', value: 2, operation: 'create' },
        ConsistencyLevel.Strong
      )
      setTimeout(() => controller.acknowledge(2), 200)
      await vi.advanceTimersByTimeAsync(250)
      await promise2

      const metrics = controller.getMetrics()
      expect(metrics.avgAckWaitMs).toBeGreaterThanOrEqual(150) // Average of ~100 and ~200
    })
  })
})
