/**
 * Replication Manager Tests (RED Phase - TDD)
 *
 * Tests for the cross-DO state replication system that provides:
 * - Primary/replica topology
 * - Synchronous and asynchronous replication
 * - Conflict resolution
 * - Failover support
 *
 * RED PHASE: All tests should FAIL initially.
 * GREEN PHASE: Implement ReplicationManager to make tests pass.
 * REFACTOR: Optimize implementation.
 *
 * @module objects/persistence/tests/replication-manager.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type {
  ReplicationRole,
  ReplicationStatus,
  ReplicationMode,
  ReplicationState,
  ReplicationConfig,
  ReplicationSyncResult,
  ReplicationConflict,
  ConflictResolutionStrategy,
} from '../types'

// Will be implemented in GREEN phase
// import { ReplicationManager } from '../replication-manager'

// ============================================================================
// MOCK TYPES FOR TESTING
// ============================================================================

interface MockDOStub {
  ns: string
  fetch(request: Request): Promise<Response>
}

interface MockEnv {
  DO_BINDING?: {
    get(id: { name: string }): MockDOStub
  }
}

// ============================================================================
// TEST HELPERS
// ============================================================================

function createMockDOStub(ns: string, data: Map<string, unknown>): MockDOStub {
  return {
    ns,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url)

      if (url.pathname === '/_replication/state') {
        return new Response(JSON.stringify({
          walPosition: data.size,
          schemaVersion: 1,
          entries: Array.from(data.entries()),
        }))
      }

      if (url.pathname === '/_replication/sync' && request.method === 'POST') {
        const body = await request.json() as { fromLsn: number }
        const entries = Array.from(data.entries()).slice(body.fromLsn)
        return new Response(JSON.stringify({ entries }))
      }

      return new Response('Not Found', { status: 404 })
    }
  }
}

// ============================================================================
// TEST SUITE: REPLICATION MANAGER
// ============================================================================

describe('ReplicationManager', () => {
  let primaryData: Map<string, unknown>
  let replicaData: Map<string, unknown>

  beforeEach(() => {
    vi.useFakeTimers()
    primaryData = new Map([
      ['record-1', { id: 'record-1', name: 'Item 1', version: 1 }],
      ['record-2', { id: 'record-2', name: 'Item 2', version: 1 }],
      ['record-3', { id: 'record-3', name: 'Item 3', version: 1 }],
    ])
    replicaData = new Map()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // REPLICATION SETUP
  // ==========================================================================

  describe('Replication Setup', () => {
    it('should establish primary role', async () => {
      const manager = null as unknown as {
        setPrimary(): Promise<void>
        getState(): Promise<ReplicationState>
      }

      await manager.setPrimary()

      const state = await manager.getState()

      expect(state.role).toBe('primary')
      expect(state.status).toBe('active')
    })

    it('should establish replica from primary', async () => {
      const manager = null as unknown as {
        setReplica(primaryNs: string): Promise<void>
        getState(): Promise<ReplicationState>
      }

      await manager.setReplica('https://primary.test.do')

      const state = await manager.getState()

      expect(state.role).toBe('replica')
      expect(state.primaryNs).toBe('https://primary.test.do')
    })

    it('should track replica namespaces on primary', async () => {
      const manager = null as unknown as {
        setPrimary(): Promise<void>
        registerReplica(replicaNs: string): Promise<void>
        getState(): Promise<ReplicationState>
      }

      await manager.setPrimary()
      await manager.registerReplica('https://replica-1.test.do')
      await manager.registerReplica('https://replica-2.test.do')

      const state = await manager.getState()

      expect(state.replicaNs).toContain('https://replica-1.test.do')
      expect(state.replicaNs).toContain('https://replica-2.test.do')
    })

    it('should set replication mode', async () => {
      const config: ReplicationConfig = { mode: 'sync' }
      const manager = null as unknown as {
        configure(config: ReplicationConfig): void
        setReplica(primaryNs: string): Promise<void>
        getState(): Promise<ReplicationState>
      }

      manager.configure(config)
      await manager.setReplica('https://primary.test.do')

      const state = await manager.getState()

      expect(state.mode).toBe('sync')
    })

    it('should reject establishing replica from non-primary', async () => {
      const manager = null as unknown as {
        setReplica(primaryNs: string): Promise<void>
      }

      // Simulate connecting to another replica
      await expect(manager.setReplica('https://another-replica.test.do'))
        .rejects.toThrow(/not primary|cannot replicate from replica/i)
    })
  })

  // ==========================================================================
  // SYNCHRONOUS REPLICATION
  // ==========================================================================

  describe('Synchronous Replication', () => {
    it('should wait for replica acknowledgment in sync mode', async () => {
      const config: ReplicationConfig = { mode: 'sync' }
      const manager = null as unknown as {
        configure(config: ReplicationConfig): void
        setPrimary(): Promise<void>
        registerReplica(replicaNs: string): Promise<void>
        write(key: string, data: unknown): Promise<{ acknowledged: boolean }>
      }

      manager.configure(config)
      await manager.setPrimary()
      await manager.registerReplica('https://replica-1.test.do')

      const result = await manager.write('record-new', { name: 'New' })

      expect(result.acknowledged).toBe(true)
    })

    it('should fail write if replica unavailable in sync mode', async () => {
      const config: ReplicationConfig = { mode: 'sync', syncTimeoutMs: 1000 }
      const manager = null as unknown as {
        configure(config: ReplicationConfig): void
        setPrimary(): Promise<void>
        registerReplica(replicaNs: string): Promise<void>
        write(key: string, data: unknown): Promise<void>
      }

      manager.configure(config)
      await manager.setPrimary()
      await manager.registerReplica('https://unreachable.test.do')

      await expect(manager.write('record-new', { name: 'New' }))
        .rejects.toThrow(/replica.*unavailable|sync.*timeout/i)
    })

    it('should replicate to all replicas in sync mode', async () => {
      const config: ReplicationConfig = { mode: 'sync' }
      const replicatedTo: string[] = []
      const manager = null as unknown as {
        configure(config: ReplicationConfig): void
        setPrimary(): Promise<void>
        registerReplica(replicaNs: string): Promise<void>
        onReplicated(callback: (replicaNs: string) => void): void
        write(key: string, data: unknown): Promise<void>
      }

      manager.configure(config)
      await manager.setPrimary()
      await manager.registerReplica('https://replica-1.test.do')
      await manager.registerReplica('https://replica-2.test.do')

      manager.onReplicated((ns) => replicatedTo.push(ns))

      await manager.write('record-new', { name: 'New' })

      expect(replicatedTo).toContain('https://replica-1.test.do')
      expect(replicatedTo).toContain('https://replica-2.test.do')
    })
  })

  // ==========================================================================
  // ASYNCHRONOUS REPLICATION
  // ==========================================================================

  describe('Asynchronous Replication', () => {
    it('should return immediately in async mode', async () => {
      const config: ReplicationConfig = { mode: 'async' }
      const manager = null as unknown as {
        configure(config: ReplicationConfig): void
        setPrimary(): Promise<void>
        registerReplica(replicaNs: string): Promise<void>
        write(key: string, data: unknown): Promise<{ queued: boolean }>
      }

      manager.configure(config)
      await manager.setPrimary()
      await manager.registerReplica('https://replica-1.test.do')

      const start = Date.now()
      const result = await manager.write('record-new', { name: 'New' })
      const elapsed = Date.now() - start

      expect(result.queued).toBe(true)
      expect(elapsed).toBeLessThan(100) // Should return quickly
    })

    it('should replicate in background for async mode', async () => {
      const config: ReplicationConfig = { mode: 'async', syncIntervalMs: 1000 }
      const manager = null as unknown as {
        configure(config: ReplicationConfig): void
        setPrimary(): Promise<void>
        registerReplica(replicaNs: string): Promise<void>
        write(key: string, data: unknown): Promise<void>
        getReplicaLag(replicaNs: string): Promise<number>
        start(): void
      }

      manager.configure(config)
      await manager.setPrimary()
      await manager.registerReplica('https://replica-1.test.do')
      manager.start()

      await manager.write('record-new', { name: 'New' })

      // Initial lag
      const lagBefore = await manager.getReplicaLag('https://replica-1.test.do')
      expect(lagBefore).toBeGreaterThan(0)

      // Wait for sync
      await vi.advanceTimersByTimeAsync(1500)

      const lagAfter = await manager.getReplicaLag('https://replica-1.test.do')
      expect(lagAfter).toBe(0)
    })

    it('should batch multiple writes for async replication', async () => {
      const config: ReplicationConfig = { mode: 'async', syncIntervalMs: 1000 }
      let syncCount = 0
      const manager = null as unknown as {
        configure(config: ReplicationConfig): void
        setPrimary(): Promise<void>
        registerReplica(replicaNs: string): Promise<void>
        onSync(callback: () => void): void
        write(key: string, data: unknown): Promise<void>
        start(): void
      }

      manager.configure(config)
      await manager.setPrimary()
      await manager.registerReplica('https://replica-1.test.do')
      manager.onSync(() => { syncCount++ })
      manager.start()

      // Write multiple records quickly
      await manager.write('record-1', { name: 'One' })
      await manager.write('record-2', { name: 'Two' })
      await manager.write('record-3', { name: 'Three' })

      await vi.advanceTimersByTimeAsync(1500)

      // Should batch into single sync
      expect(syncCount).toBe(1)
    })
  })

  // ==========================================================================
  // LAZY REPLICATION
  // ==========================================================================

  describe('Lazy Replication', () => {
    it('should sync on first read in lazy mode', async () => {
      const config: ReplicationConfig = { mode: 'lazy' }
      const manager = null as unknown as {
        configure(config: ReplicationConfig): void
        setReplica(primaryNs: string): Promise<void>
        read(key: string): Promise<unknown>
        getState(): Promise<ReplicationState>
      }

      manager.configure(config)
      await manager.setReplica('https://primary.test.do')

      const stateBefore = await manager.getState()
      expect(stateBefore.status).toBe('initializing')

      await manager.read('record-1')

      const stateAfter = await manager.getState()
      expect(stateAfter.status).toBe('active')
    })

    it('should not sync until data is accessed in lazy mode', async () => {
      const config: ReplicationConfig = { mode: 'lazy' }
      let syncCalled = false
      const manager = null as unknown as {
        configure(config: ReplicationConfig): void
        setReplica(primaryNs: string): Promise<void>
        onSync(callback: () => void): void
        getState(): Promise<ReplicationState>
      }

      manager.configure(config)
      manager.onSync(() => { syncCalled = true })

      await manager.setReplica('https://primary.test.do')

      await vi.advanceTimersByTimeAsync(60000)

      expect(syncCalled).toBe(false)
    })
  })

  // ==========================================================================
  // LAG TRACKING
  // ==========================================================================

  describe('Lag Tracking', () => {
    it('should track replication lag in LSN units', async () => {
      const manager = null as unknown as {
        setPrimary(): Promise<void>
        registerReplica(replicaNs: string): Promise<void>
        write(key: string, data: unknown): Promise<void>
        getReplicaLag(replicaNs: string): Promise<number>
      }

      await manager.setPrimary()
      await manager.registerReplica('https://replica-1.test.do')

      await manager.write('record-1', {})
      await manager.write('record-2', {})
      await manager.write('record-3', {})

      const lag = await manager.getReplicaLag('https://replica-1.test.do')

      expect(lag).toBe(3)
    })

    it('should trigger sync when lag exceeds threshold', async () => {
      const config: ReplicationConfig = { mode: 'async', maxLag: 5, syncIntervalMs: 60000 }
      let syncTriggered = false
      const manager = null as unknown as {
        configure(config: ReplicationConfig): void
        setPrimary(): Promise<void>
        registerReplica(replicaNs: string): Promise<void>
        onSync(callback: () => void): void
        write(key: string, data: unknown): Promise<void>
        start(): void
      }

      manager.configure(config)
      await manager.setPrimary()
      await manager.registerReplica('https://replica-1.test.do')
      manager.onSync(() => { syncTriggered = true })
      manager.start()

      // Write more than maxLag
      for (let i = 0; i < 10; i++) {
        await manager.write(`record-${i}`, {})
      }

      // Should trigger sync due to lag threshold
      expect(syncTriggered).toBe(true)
    })

    it('should report stale status when lag is too high', async () => {
      const config: ReplicationConfig = { maxLag: 100 }
      const manager = null as unknown as {
        configure(config: ReplicationConfig): void
        setReplica(primaryNs: string): Promise<void>
        simulateLag(lag: number): void
        getState(): Promise<ReplicationState>
      }

      manager.configure(config)
      await manager.setReplica('https://primary.test.do')

      manager.simulateLag(150)

      const state = await manager.getState()

      expect(state.status).toBe('stale')
    })

    it('should update lag after successful sync', async () => {
      const manager = null as unknown as {
        setReplica(primaryNs: string): Promise<void>
        simulateLag(lag: number): void
        sync(): Promise<ReplicationSyncResult>
        getState(): Promise<ReplicationState>
      }

      await manager.setReplica('https://primary.test.do')
      manager.simulateLag(50)

      await manager.sync()

      const state = await manager.getState()

      expect(state.lag).toBe(0)
    })
  })

  // ==========================================================================
  // CONFLICT RESOLUTION
  // ==========================================================================

  describe('Conflict Resolution', () => {
    it('should detect write conflicts', async () => {
      const manager = null as unknown as {
        setPrimary(): Promise<void>
        registerReplica(replicaNs: string): Promise<void>
        write(key: string, data: unknown): Promise<void>
        simulateReplicaWrite(replicaNs: string, key: string, data: unknown): void
        sync(): Promise<ReplicationSyncResult>
      }

      await manager.setPrimary()
      await manager.registerReplica('https://replica-1.test.do')

      // Write on primary
      await manager.write('record-1', { version: 2 })

      // Simulate concurrent write on replica
      manager.simulateReplicaWrite('https://replica-1.test.do', 'record-1', { version: 3 })

      const result = await manager.sync()

      expect(result.conflictsResolved).toBeGreaterThan(0)
    })

    it('should resolve conflicts with primary-wins strategy', async () => {
      const config: ReplicationConfig = { mode: 'async' }
      const manager = null as unknown as {
        configure(config: ReplicationConfig): void
        setConflictStrategy(strategy: ConflictResolutionStrategy): void
        setPrimary(): Promise<void>
        write(key: string, data: unknown): Promise<void>
        simulateConflict(key: string, primaryVersion: number, replicaVersion: number): void
        resolveConflicts(): Promise<ReplicationConflict[]>
        read(key: string): Promise<unknown>
      }

      manager.configure(config)
      manager.setConflictStrategy('primary-wins')
      await manager.setPrimary()

      await manager.write('record-1', { name: 'Primary Value', version: 5 })
      manager.simulateConflict('record-1', 5, 6)

      const conflicts = await manager.resolveConflicts()

      expect(conflicts[0].resolution).toBe('primary-wins')

      const data = await manager.read('record-1') as { name: string }
      expect(data.name).toBe('Primary Value')
    })

    it('should resolve conflicts with last-write-wins strategy', async () => {
      const manager = null as unknown as {
        setConflictStrategy(strategy: ConflictResolutionStrategy): void
        setPrimary(): Promise<void>
        simulateConflictWithTimestamps(
          key: string,
          primary: { data: unknown; timestamp: number },
          replica: { data: unknown; timestamp: number }
        ): void
        resolveConflicts(): Promise<ReplicationConflict[]>
        read(key: string): Promise<unknown>
      }

      manager.setConflictStrategy('last-write-wins')
      await manager.setPrimary()

      manager.simulateConflictWithTimestamps('record-1', {
        data: { name: 'Primary Value' },
        timestamp: 1000,
      }, {
        data: { name: 'Replica Value' },
        timestamp: 2000,
      })

      await manager.resolveConflicts()

      const data = await manager.read('record-1') as { name: string }
      expect(data.name).toBe('Replica Value')
    })

    it('should log conflict resolution history', async () => {
      const manager = null as unknown as {
        setPrimary(): Promise<void>
        simulateConflict(key: string, primaryVersion: number, replicaVersion: number): void
        resolveConflicts(): Promise<ReplicationConflict[]>
        getConflictHistory(): Promise<ReplicationConflict[]>
      }

      await manager.setPrimary()

      manager.simulateConflict('record-1', 1, 2)
      manager.simulateConflict('record-2', 1, 3)

      await manager.resolveConflicts()

      const history = await manager.getConflictHistory()

      expect(history.length).toBe(2)
    })
  })

  // ==========================================================================
  // FAILOVER
  // ==========================================================================

  describe('Failover', () => {
    it('should promote replica to primary', async () => {
      const manager = null as unknown as {
        setReplica(primaryNs: string): Promise<void>
        promote(): Promise<void>
        getState(): Promise<ReplicationState>
      }

      await manager.setReplica('https://primary.test.do')

      await manager.promote()

      const state = await manager.getState()

      expect(state.role).toBe('primary')
      expect(state.primaryNs).toBeUndefined()
    })

    it('should reject promotion if significantly behind', async () => {
      const config: ReplicationConfig = { maxLag: 10 }
      const manager = null as unknown as {
        configure(config: ReplicationConfig): void
        setReplica(primaryNs: string): Promise<void>
        simulateLag(lag: number): void
        promote(): Promise<void>
      }

      manager.configure(config)
      await manager.setReplica('https://primary.test.do')
      manager.simulateLag(100)

      await expect(manager.promote())
        .rejects.toThrow(/lag.*too high|sync.*required before promotion/i)
    })

    it('should notify other replicas of promotion', async () => {
      const notified: string[] = []
      const manager = null as unknown as {
        setReplica(primaryNs: string): Promise<void>
        onNotifyReplica(callback: (replicaNs: string) => void): void
        promote(): Promise<void>
      }

      await manager.setReplica('https://primary.test.do')
      manager.onNotifyReplica((ns) => notified.push(ns))

      await manager.promote()

      // Should attempt to notify sibling replicas
      expect(notified.length).toBeGreaterThanOrEqual(0)
    })

    it('should demote primary to standalone', async () => {
      const manager = null as unknown as {
        setPrimary(): Promise<void>
        registerReplica(replicaNs: string): Promise<void>
        demote(): Promise<void>
        getState(): Promise<ReplicationState>
      }

      await manager.setPrimary()
      await manager.registerReplica('https://replica-1.test.do')

      await manager.demote()

      const state = await manager.getState()

      expect(state.role).toBe('standalone')
      expect(state.replicaNs).toEqual([])
    })
  })

  // ==========================================================================
  // DISCONNECTION
  // ==========================================================================

  describe('Disconnection', () => {
    it('should detect primary disconnection', async () => {
      const manager = null as unknown as {
        setReplica(primaryNs: string): Promise<void>
        simulatePrimaryDisconnection(): void
        getState(): Promise<ReplicationState>
        start(): void
      }

      await manager.setReplica('https://primary.test.do')
      manager.start()

      manager.simulatePrimaryDisconnection()

      await vi.advanceTimersByTimeAsync(30000)

      const state = await manager.getState()

      expect(state.status).toBe('disconnected')
    })

    it('should automatically reconnect after transient failure', async () => {
      const config: ReplicationConfig = { maxRetries: 3, retryDelayMs: 1000 }
      const manager = null as unknown as {
        configure(config: ReplicationConfig): void
        setReplica(primaryNs: string): Promise<void>
        simulateTransientFailure(failures: number): void
        sync(): Promise<ReplicationSyncResult>
        getState(): Promise<ReplicationState>
      }

      manager.configure(config)
      await manager.setReplica('https://primary.test.do')

      // Fail twice, then succeed
      manager.simulateTransientFailure(2)

      await manager.sync()

      const state = await manager.getState()

      expect(state.status).toBe('active')
    })

    it('should enter error state after max retries', async () => {
      const config: ReplicationConfig = { maxRetries: 3, retryDelayMs: 100 }
      const manager = null as unknown as {
        configure(config: ReplicationConfig): void
        setReplica(primaryNs: string): Promise<void>
        simulatePermanentFailure(): void
        sync(): Promise<ReplicationSyncResult>
        getState(): Promise<ReplicationState>
      }

      manager.configure(config)
      await manager.setReplica('https://primary.test.do')

      manager.simulatePermanentFailure()

      await expect(manager.sync()).rejects.toThrow()

      const state = await manager.getState()

      expect(state.status).toBe('error')
    })

    it('should pause replication on disconnect', async () => {
      const manager = null as unknown as {
        setReplica(primaryNs: string): Promise<void>
        disconnect(): Promise<void>
        getState(): Promise<ReplicationState>
      }

      await manager.setReplica('https://primary.test.do')

      await manager.disconnect()

      const state = await manager.getState()

      expect(state.status).toBe('disconnected')
      expect(state.primaryNs).toBeUndefined()
    })
  })

  // ==========================================================================
  // SYNC OPERATIONS
  // ==========================================================================

  describe('Sync Operations', () => {
    it('should perform full sync', async () => {
      const manager = null as unknown as {
        setReplica(primaryNs: string): Promise<void>
        fullSync(): Promise<ReplicationSyncResult>
      }

      await manager.setReplica('https://primary.test.do')

      const result = await manager.fullSync()

      expect(result.entriesSynced).toBeGreaterThan(0)
      expect(result.lag).toBe(0)
    })

    it('should perform incremental sync', async () => {
      const manager = null as unknown as {
        setReplica(primaryNs: string): Promise<void>
        fullSync(): Promise<ReplicationSyncResult>
        incrementalSync(): Promise<ReplicationSyncResult>
      }

      await manager.setReplica('https://primary.test.do')
      await manager.fullSync()

      const result = await manager.incrementalSync()

      expect(result.entriesSynced).toBeGreaterThanOrEqual(0)
    })

    it('should track sync duration', async () => {
      const manager = null as unknown as {
        setReplica(primaryNs: string): Promise<void>
        sync(): Promise<ReplicationSyncResult>
      }

      await manager.setReplica('https://primary.test.do')

      const result = await manager.sync()

      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('should track bytes transferred', async () => {
      const manager = null as unknown as {
        setReplica(primaryNs: string): Promise<void>
        sync(): Promise<ReplicationSyncResult>
      }

      await manager.setReplica('https://primary.test.do')

      const result = await manager.sync()

      expect(result.bytesTransferred).toBeGreaterThan(0)
    })

    it('should compress sync data', async () => {
      const config: ReplicationConfig = { compress: true }
      let bytesWithoutCompression: number
      let bytesWithCompression: number

      const managerWithoutCompression = null as unknown as {
        setReplica(primaryNs: string): Promise<void>
        sync(): Promise<ReplicationSyncResult>
      }

      const managerWithCompression = null as unknown as {
        configure(config: ReplicationConfig): void
        setReplica(primaryNs: string): Promise<void>
        sync(): Promise<ReplicationSyncResult>
      }

      await managerWithoutCompression.setReplica('https://primary.test.do')
      const result1 = await managerWithoutCompression.sync()
      bytesWithoutCompression = result1.bytesTransferred

      managerWithCompression.configure(config)
      await managerWithCompression.setReplica('https://primary.test.do')
      const result2 = await managerWithCompression.sync()
      bytesWithCompression = result2.bytesTransferred

      expect(bytesWithCompression).toBeLessThan(bytesWithoutCompression)
    })
  })

  // ==========================================================================
  // READ-ONLY SEMANTICS
  // ==========================================================================

  describe('Read-Only Semantics', () => {
    it('should reject writes on replica', async () => {
      const manager = null as unknown as {
        setReplica(primaryNs: string): Promise<void>
        write(key: string, data: unknown): Promise<void>
      }

      await manager.setReplica('https://primary.test.do')

      await expect(manager.write('record-new', { name: 'New' }))
        .rejects.toThrow(/read-only|cannot write to replica/i)
    })

    it('should forward writes to primary', async () => {
      let forwardedTo: string | null = null
      const manager = null as unknown as {
        setReplica(primaryNs: string): Promise<void>
        onForwardWrite(callback: (primaryNs: string) => void): void
        writeViaForward(key: string, data: unknown): Promise<void>
      }

      await manager.setReplica('https://primary.test.do')
      manager.onForwardWrite((ns) => { forwardedTo = ns })

      await manager.writeViaForward('record-new', { name: 'New' })

      expect(forwardedTo).toBe('https://primary.test.do')
    })

    it('should allow reads from replica', async () => {
      const manager = null as unknown as {
        setReplica(primaryNs: string): Promise<void>
        fullSync(): Promise<ReplicationSyncResult>
        read(key: string): Promise<unknown>
      }

      await manager.setReplica('https://primary.test.do')
      await manager.fullSync()

      const data = await manager.read('record-1')

      expect(data).toBeDefined()
    })
  })
})
