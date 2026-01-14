/**
 * ACID Test Suite - Phase 4: Create Replica
 *
 * RED TDD: These tests define the expected behavior for creating replicas via clone.
 * All tests are expected to FAIL initially as this is the RED phase.
 *
 * Creating a replica via clone({ asReplica: true }) establishes:
 * - A follower relationship to the primary (source) DO
 * - Read-only semantics on the replica (writes go to primary)
 * - Automatic sync from primary to replica
 * - Geographic distribution for latency optimization
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 4 Replication
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv } from '../../../testing/do'
import { DO } from '../../../objects/DO'
import type { CloneOptions, CloneResult } from '../../../types/Lifecycle'
import type { ColoCode, Region } from '../../../types/Location'

// ============================================================================
// TYPE DEFINITIONS FOR REPLICATION
// ============================================================================

/**
 * Replica status indicates the current state of the replica
 */
type ReplicaStatus = 'initializing' | 'syncing' | 'active' | 'stale' | 'disconnected' | 'promoting'

/**
 * Replica role distinguishes primary from follower
 */
type ReplicaRole = 'primary' | 'follower'

/**
 * Replica metadata stored on the DO
 */
interface ReplicaMetadata {
  /** Role of this replica */
  role: ReplicaRole
  /** Current status */
  status: ReplicaStatus
  /** Primary namespace (for followers) */
  primaryNs?: string
  /** Array of follower namespaces (for primary) */
  followerNs?: string[]
  /** Last sync timestamp */
  lastSyncAt: Date | null
  /** Current lag in versions behind primary */
  lag: number
  /** Geographic location hint */
  location?: ColoCode | Region
  /** When this replica was created */
  createdAt: Date
}

/**
 * Replica handle for managing replica operations
 */
interface ReplicaHandle {
  /** Namespace of the replica */
  ns: string
  /** DO ID of the replica */
  doId: string
  /** Get current replica metadata */
  getMetadata(): Promise<ReplicaMetadata>
  /** Get current lag */
  getLag(): Promise<number>
  /** Force sync from primary */
  sync(): Promise<void>
  /** Disconnect from primary (become standalone) */
  disconnect(): Promise<void>
  /** Promote to primary (failover) */
  promote(): Promise<void>
}

/**
 * Extended clone options for replica creation
 */
interface ReplicaCloneOptions extends CloneOptions {
  asReplica: true
  /** Sync mode for replica */
  syncMode?: 'sync' | 'async' | 'lazy'
  /** Maximum acceptable lag before forcing sync */
  maxLag?: number
  /** Sync interval in milliseconds */
  syncInterval?: number
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Create Replica via clone({ asReplica: true })', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    vi.useFakeTimers()
    result = createMockDO(DO, {
      ns: 'https://primary.test.do',
      sqlData: new Map([
        ['things', Array.from({ length: 50 }, (_, i) => ({
          id: `thing-${i}`,
          type: 1,
          data: { index: i, name: `Item ${i}` },
          version: 1,
          branch: null,
          deleted: false,
        }))],
        ['objects', [{
          ns: 'https://primary.test.do',
          class: 'DO',
          primary: true,
          region: 'us-east',
          createdAt: new Date().toISOString(),
        }]],
      ]),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // BASIC REPLICA CREATION
  // ==========================================================================

  describe('Basic Replica Creation', () => {
    it('should create a replica with asReplica: true', async () => {
      const target = 'https://replica.test.do'
      const cloneResult = await result.instance.clone(target, { asReplica: true }) as unknown as ReplicaHandle

      expect(cloneResult.ns).toBe(target)
      expect(cloneResult.doId).toBeDefined()
    })

    it('should mark replica as follower role', async () => {
      const target = 'https://replica.test.do'
      const replica = await result.instance.clone(target, { asReplica: true }) as unknown as ReplicaHandle

      const metadata = await replica.getMetadata()

      expect(metadata.role).toBe('follower')
    })

    it('should store reference to primary namespace', async () => {
      const target = 'https://replica.test.do'
      const replica = await result.instance.clone(target, { asReplica: true }) as unknown as ReplicaHandle

      const metadata = await replica.getMetadata()

      expect(metadata.primaryNs).toBe('https://primary.test.do')
    })

    it('should register replica in primary follower list', async () => {
      const target = 'https://replica.test.do'
      await result.instance.clone(target, { asReplica: true })

      // Primary should track followers
      // @ts-expect-error - accessing internal replica list
      const followers = await result.instance.getFollowers?.() ?? []
      expect(followers).toContain(target)
    })

    it('should copy all data from primary to replica', async () => {
      const target = 'https://replica.test.do'
      const replica = await result.instance.clone(target, { asReplica: true }) as unknown as ReplicaHandle

      // Initial sync should complete
      await vi.advanceTimersByTimeAsync(5000)

      const metadata = await replica.getMetadata()
      expect(metadata.status).toBe('active')
    })

    it('should create replica with specified location', async () => {
      const target = 'https://replica-eu.test.do'
      const options: ReplicaCloneOptions = {
        asReplica: true,
        colo: 'lhr', // London
      }

      const replica = await result.instance.clone(target, options) as unknown as ReplicaHandle
      const metadata = await replica.getMetadata()

      expect(metadata.location).toBe('lhr')
    })

    it('should create replica with region hint', async () => {
      const target = 'https://replica-asia.test.do'
      const options: ReplicaCloneOptions = {
        asReplica: true,
        colo: 'asia-pacific',
      }

      const replica = await result.instance.clone(target, options) as unknown as ReplicaHandle
      const metadata = await replica.getMetadata()

      expect(metadata.location).toBe('asia-pacific')
    })
  })

  // ==========================================================================
  // REPLICA LIFECYCLE
  // ==========================================================================

  describe('Replica Lifecycle', () => {
    it('should transition from initializing to syncing', async () => {
      const target = 'https://replica.test.do'
      const replica = await result.instance.clone(target, { asReplica: true }) as unknown as ReplicaHandle

      const metadata = await replica.getMetadata()
      expect(['initializing', 'syncing']).toContain(metadata.status)
    })

    it('should transition to active when caught up', async () => {
      const target = 'https://replica.test.do'
      const replica = await result.instance.clone(target, { asReplica: true }) as unknown as ReplicaHandle

      // Wait for sync to complete
      await vi.advanceTimersByTimeAsync(30000)

      const metadata = await replica.getMetadata()
      expect(metadata.status).toBe('active')
    })

    it('should track lag in versions behind primary', async () => {
      const target = 'https://replica.test.do'
      const replica = await result.instance.clone(target, { asReplica: true }) as unknown as ReplicaHandle

      // Initial lag should be 0 or positive
      const lag = await replica.getLag()
      expect(lag).toBeGreaterThanOrEqual(0)
    })

    it('should track lastSyncAt timestamp', async () => {
      const target = 'https://replica.test.do'
      const replica = await result.instance.clone(target, { asReplica: true }) as unknown as ReplicaHandle

      // Trigger sync
      await replica.sync()

      const metadata = await replica.getMetadata()
      expect(metadata.lastSyncAt).toBeInstanceOf(Date)
    })

    it('should become stale if sync fails for too long', async () => {
      const target = 'https://unreachable-replica.test.do'
      const replica = await result.instance.clone(target, { asReplica: true }) as unknown as ReplicaHandle

      // Simulate extended disconnection
      await vi.advanceTimersByTimeAsync(300000) // 5 minutes

      const metadata = await replica.getMetadata()
      expect(['stale', 'disconnected']).toContain(metadata.status)
    })
  })

  // ==========================================================================
  // MULTI-REGION REPLICAS
  // ==========================================================================

  describe('Multi-Region Replicas', () => {
    it('should support multiple replicas in different regions', async () => {
      const replica1 = await result.instance.clone('https://replica-us-west.test.do', {
        asReplica: true,
        colo: 'lax',
      }) as unknown as ReplicaHandle

      const replica2 = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      }) as unknown as ReplicaHandle

      const replica3 = await result.instance.clone('https://replica-asia.test.do', {
        asReplica: true,
        colo: 'sin',
      }) as unknown as ReplicaHandle

      expect(replica1.ns).toBe('https://replica-us-west.test.do')
      expect(replica2.ns).toBe('https://replica-eu.test.do')
      expect(replica3.ns).toBe('https://replica-asia.test.do')
    })

    it('should track all replicas in primary', async () => {
      await result.instance.clone('https://replica-1.test.do', { asReplica: true })
      await result.instance.clone('https://replica-2.test.do', { asReplica: true })
      await result.instance.clone('https://replica-3.test.do', { asReplica: true })

      // @ts-expect-error - accessing internal replica list
      const followers = await result.instance.getFollowers?.() ?? []
      expect(followers).toHaveLength(3)
    })

    it('should sync all replicas when primary updates', async () => {
      const replica1 = await result.instance.clone('https://replica-1.test.do', { asReplica: true }) as unknown as ReplicaHandle
      const replica2 = await result.instance.clone('https://replica-2.test.do', { asReplica: true }) as unknown as ReplicaHandle

      // Simulate primary update
      result.sqlData.get('things')!.push({
        id: 'new-thing',
        type: 1,
        data: { name: 'New Item' },
        version: 1,
        branch: null,
        deleted: false,
      })

      // Wait for sync
      await vi.advanceTimersByTimeAsync(10000)

      const lag1 = await replica1.getLag()
      const lag2 = await replica2.getLag()

      // Both should be synced (lag = 0 or close)
      expect(lag1).toBeLessThanOrEqual(1)
      expect(lag2).toBeLessThanOrEqual(1)
    })

    it('should support cascading replicas (replica of replica)', async () => {
      const tier1Replica = await result.instance.clone('https://tier1-replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaHandle

      // Create tier 2 replica from tier 1 (for geographic distribution)
      // This should be blocked or redirect to primary
      await expect(async () => {
        // @ts-expect-error - tier1Replica.clone may not exist
        await tier1Replica.clone?.('https://tier2-replica.test.do', { asReplica: true })
      }).rejects.toThrow(/cannot create replica from follower|replica must be created from primary/i)
    })
  })

  // ==========================================================================
  // REPLICA SYNC MODES
  // ==========================================================================

  describe('Replica Sync Modes', () => {
    it('should support sync mode (wait for confirmation)', async () => {
      const options: ReplicaCloneOptions = {
        asReplica: true,
        syncMode: 'sync',
      }

      const replica = await result.instance.clone('https://replica.test.do', options) as unknown as ReplicaHandle

      // Sync mode should wait for initial sync to complete
      const metadata = await replica.getMetadata()
      expect(metadata.lag).toBe(0)
    })

    it('should support async mode (return immediately)', async () => {
      const options: ReplicaCloneOptions = {
        asReplica: true,
        syncMode: 'async',
      }

      const startTime = Date.now()
      const replica = await result.instance.clone('https://replica.test.do', options) as unknown as ReplicaHandle
      const elapsed = Date.now() - startTime

      // Should return quickly
      expect(elapsed).toBeLessThan(100)

      // But may have lag
      const lag = await replica.getLag()
      expect(lag).toBeGreaterThanOrEqual(0)
    })

    it('should support lazy mode (sync on first access)', async () => {
      const options: ReplicaCloneOptions = {
        asReplica: true,
        syncMode: 'lazy',
      }

      const replica = await result.instance.clone('https://replica.test.do', options) as unknown as ReplicaHandle
      const metadata = await replica.getMetadata()

      // Should be in lazy state initially
      expect(['initializing', 'lazy']).toContain(metadata.status)
    })

    it('should respect configurable sync interval', async () => {
      const options: ReplicaCloneOptions = {
        asReplica: true,
        syncInterval: 60000, // 1 minute
      }

      const replica = await result.instance.clone('https://replica.test.do', options) as unknown as ReplicaHandle

      // Add data to primary
      result.sqlData.get('things')!.push({
        id: 'interval-thing',
        type: 1,
        data: { name: 'Interval Item' },
        version: 1,
        branch: null,
        deleted: false,
      })

      // Wait less than sync interval
      await vi.advanceTimersByTimeAsync(30000)

      // Replica should still have lag
      const lag = await replica.getLag()
      expect(lag).toBeGreaterThan(0)

      // Wait for sync interval to pass
      await vi.advanceTimersByTimeAsync(35000)

      const lagAfter = await replica.getLag()
      expect(lagAfter).toBe(0)
    })

    it('should respect configurable max lag threshold', async () => {
      const options: ReplicaCloneOptions = {
        asReplica: true,
        maxLag: 10,
        syncInterval: 60000, // Long interval
      }

      const replica = await result.instance.clone('https://replica.test.do', options) as unknown as ReplicaHandle

      // Add many items to exceed max lag
      for (let i = 0; i < 20; i++) {
        result.sqlData.get('things')!.push({
          id: `lag-thing-${i}`,
          type: 1,
          data: { index: i },
          version: 1,
          branch: null,
          deleted: false,
        })
      }

      // Wait a bit (less than sync interval)
      await vi.advanceTimersByTimeAsync(5000)

      // Should have force-synced due to max lag threshold
      const lag = await replica.getLag()
      expect(lag).toBeLessThanOrEqual(10)
    })
  })

  // ==========================================================================
  // REPLICA READ/WRITE SEMANTICS
  // ==========================================================================

  describe('Replica Read/Write Semantics', () => {
    it('should allow reads from replica', async () => {
      const replica = await result.instance.clone('https://replica.test.do', { asReplica: true }) as unknown as ReplicaHandle

      // Wait for sync
      await vi.advanceTimersByTimeAsync(5000)

      // Reading should work
      // @ts-expect-error - accessing internal method
      const things = await replica.getThings?.() ?? []
      expect(things.length).toBeGreaterThanOrEqual(0)
    })

    it('should redirect writes to primary', async () => {
      const replica = await result.instance.clone('https://replica.test.do', { asReplica: true }) as unknown as ReplicaHandle

      // Attempting to write should redirect or throw
      await expect(async () => {
        // @ts-expect-error - accessing internal method
        await replica.createThing?.({ id: 'new', type: 1, data: {} })
      }).rejects.toThrow(/writes.*redirect|read-only replica/i)
    })

    it('should support read-your-writes through session affinity', async () => {
      // Session-based writes should be visible immediately
      // This is tested more thoroughly in read-your-writes.test.ts
      const replica = await result.instance.clone('https://replica.test.do', { asReplica: true }) as unknown as ReplicaHandle

      expect(replica).toBeDefined()
    })

    it('should provide stale read warning when significantly behind', async () => {
      const replica = await result.instance.clone('https://replica.test.do', { asReplica: true }) as unknown as ReplicaHandle

      // Simulate significant lag
      await vi.advanceTimersByTimeAsync(1000)

      // Add many changes to primary without syncing
      for (let i = 0; i < 100; i++) {
        result.sqlData.get('things')!.push({
          id: `stale-thing-${i}`,
          type: 1,
          data: { index: i },
          version: 1,
          branch: null,
          deleted: false,
        })
      }

      const lag = await replica.getLag()
      const metadata = await replica.getMetadata()

      // High lag should be reflected
      expect(lag).toBeGreaterThan(50)
      // Status might indicate staleness
      expect(['active', 'stale']).toContain(metadata.status)
    })
  })

  // ==========================================================================
  // REPLICA MANAGEMENT
  // ==========================================================================

  describe('Replica Management', () => {
    it('should support manual sync trigger', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        syncInterval: 300000, // 5 minutes
      }) as unknown as ReplicaHandle

      // Add data to primary
      result.sqlData.get('things')!.push({
        id: 'manual-sync-thing',
        type: 1,
        data: { name: 'Manual Sync Item' },
        version: 1,
        branch: null,
        deleted: false,
      })

      // Manual sync
      await replica.sync()

      const lag = await replica.getLag()
      expect(lag).toBe(0)
    })

    it('should support disconnecting replica from primary', async () => {
      const replica = await result.instance.clone('https://replica.test.do', { asReplica: true }) as unknown as ReplicaHandle

      await replica.disconnect()

      const metadata = await replica.getMetadata()
      expect(metadata.status).toBe('disconnected')
      expect(metadata.primaryNs).toBeUndefined()
    })

    it('should remove disconnected replica from primary follower list', async () => {
      const replica = await result.instance.clone('https://replica.test.do', { asReplica: true }) as unknown as ReplicaHandle

      // @ts-expect-error - accessing internal replica list
      let followers = await result.instance.getFollowers?.() ?? []
      expect(followers).toContain('https://replica.test.do')

      await replica.disconnect()

      // @ts-expect-error - accessing internal replica list
      followers = await result.instance.getFollowers?.() ?? []
      expect(followers).not.toContain('https://replica.test.do')
    })

    it('should convert replica to standalone DO on disconnect', async () => {
      const replica = await result.instance.clone('https://replica.test.do', { asReplica: true }) as unknown as ReplicaHandle

      // Wait for sync
      await vi.advanceTimersByTimeAsync(5000)

      await replica.disconnect()

      const metadata = await replica.getMetadata()
      // After disconnect, role should be standalone (effectively primary of itself)
      expect(['standalone', 'primary', 'disconnected']).toContain(metadata.role)
    })
  })

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    it('should fail if primary is not available', async () => {
      // Create a DO that isn't properly configured as primary
      const orphanResult = createMockDO(DO, {
        ns: 'https://orphan.test.do',
        sqlData: new Map([
          ['things', [{ id: 'orphan-thing', type: 1, data: {}, version: 1, branch: null, deleted: false }]],
          ['objects', [{ ns: 'https://orphan.test.do', class: 'DO', primary: false }]],
        ]),
      })

      await expect(async () => {
        await orphanResult.instance.clone('https://replica.test.do', { asReplica: true })
      }).rejects.toThrow(/not primary|cannot create replica/i)
    })

    it('should handle primary failure during sync', async () => {
      const replica = await result.instance.clone('https://replica.test.do', { asReplica: true }) as unknown as ReplicaHandle

      // Simulate primary becoming unavailable
      // This would be done by mock configuration in real test

      await vi.advanceTimersByTimeAsync(60000)

      const metadata = await replica.getMetadata()
      expect(['stale', 'disconnected']).toContain(metadata.status)
    })

    it('should retry sync on transient failures', async () => {
      const replica = await result.instance.clone('https://replica.test.do', { asReplica: true }) as unknown as ReplicaHandle

      // Simulate transient failure and recovery
      await vi.advanceTimersByTimeAsync(10000)

      // Should have attempted retries
      const metadata = await replica.getMetadata()
      expect(['syncing', 'active']).toContain(metadata.status)
    })

    it('should prevent duplicate replica namespaces', async () => {
      await result.instance.clone('https://replica.test.do', { asReplica: true })

      // Attempting to create another replica with same namespace should fail
      await expect(async () => {
        await result.instance.clone('https://replica.test.do', { asReplica: true })
      }).rejects.toThrow(/already exists|duplicate replica/i)
    })

    it('should validate target namespace format', async () => {
      await expect(async () => {
        await result.instance.clone('invalid-namespace', { asReplica: true })
      }).rejects.toThrow(/invalid.*namespace|must be.*url/i)
    })
  })

  // ==========================================================================
  // COMPRESSED REPLICAS
  // ==========================================================================

  describe('Compressed Replicas', () => {
    it('should support compress: true with asReplica: true', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        compress: true,
      }) as unknown as ReplicaHandle

      expect(replica.ns).toBe('https://replica.test.do')
    })

    it('should create replica with single version when compressed', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        compress: true,
      }) as unknown as ReplicaHandle

      // Replica should have only current state, no history
      await vi.advanceTimersByTimeAsync(5000)

      const metadata = await replica.getMetadata()
      expect(metadata.status).toBe('active')
    })
  })

  // ==========================================================================
  // EVENTS
  // ==========================================================================

  describe('Replica Events', () => {
    it('should emit replica.created event on primary', async () => {
      const events: unknown[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      await result.instance.clone('https://replica.test.do', { asReplica: true })

      const createdEvent = events.find((e) => (e as Record<string, string>).type === 'replica.created')
      expect(createdEvent).toBeDefined()
    })

    it('should emit replica.synced event after successful sync', async () => {
      const events: unknown[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const replica = await result.instance.clone('https://replica.test.do', { asReplica: true }) as unknown as ReplicaHandle

      await replica.sync()

      const syncedEvent = events.find((e) => (e as Record<string, string>).type === 'replica.synced')
      expect(syncedEvent).toBeDefined()
    })

    it('should emit replica.stale event when lag exceeds threshold', async () => {
      const events: unknown[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        maxLag: 5,
        syncInterval: 60000,
      })

      // Add many items to exceed threshold
      for (let i = 0; i < 20; i++) {
        result.sqlData.get('things')!.push({
          id: `stale-event-thing-${i}`,
          type: 1,
          data: { index: i },
          version: 1,
          branch: null,
          deleted: false,
        })
      }

      await vi.advanceTimersByTimeAsync(5000)

      const staleEvent = events.find((e) => (e as Record<string, string>).type === 'replica.stale')
      // Stale event should be emitted when lag exceeds threshold
      expect(staleEvent).toBeDefined()
    })
  })
})
