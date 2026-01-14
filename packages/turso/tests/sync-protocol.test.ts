/**
 * @dotdo/turso Sync Protocol Tests
 *
 * RED TDD Phase: These tests define the expected behavior for the Turso sync protocol.
 * All tests are expected to FAIL initially as this is the RED phase.
 *
 * The sync protocol handles:
 * - Embedded replica synchronization from Turso primary
 * - Frame-based replication (libSQL WAL frames)
 * - Conflict detection and resolution (last-write-wins)
 * - Sync status tracking and checkpointing
 * - Incremental and full sync recovery
 *
 * @see https://docs.turso.tech/features/embedded-replicas
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Sync status for tracking replica state
 */
type SyncStatus =
  | 'idle'           // No sync in progress
  | 'syncing'        // Sync in progress
  | 'synced'         // Up to date with primary
  | 'stale'          // Behind primary, needs sync
  | 'corrupted'      // Replica corrupted, needs full sync
  | 'recovering'     // Full sync recovery in progress

/**
 * Frame represents a WAL frame from libSQL replication
 */
interface Frame {
  /** Frame number (monotonically increasing) */
  frameNo: number
  /** Page number this frame applies to */
  pageNo: number
  /** Raw page data */
  data: Uint8Array
  /** Checksum for integrity validation */
  checksum: number
  /** Timestamp when frame was created on primary */
  timestamp: number
}

/**
 * Sync checkpoint for resumable syncs
 */
interface SyncCheckpoint {
  /** Last successfully applied frame number */
  frameNo: number
  /** Database page count at checkpoint */
  pageCount: number
  /** Checksum of the database at this point */
  checksum: number
  /** Timestamp of checkpoint */
  timestamp: number
}

/**
 * Conflict information for resolution
 */
interface ConflictInfo {
  /** Table where conflict occurred */
  table: string
  /** Primary key of conflicting row */
  primaryKey: Record<string, unknown>
  /** Local version */
  localVersion: {
    data: Record<string, unknown>
    timestamp: number
  }
  /** Remote (primary) version */
  remoteVersion: {
    data: Record<string, unknown>
    timestamp: number
  }
}

/**
 * Sync statistics
 */
interface SyncStats {
  /** Total frames synced */
  framesApplied: number
  /** Total bytes transferred */
  bytesTransferred: number
  /** Number of conflicts detected */
  conflictsDetected: number
  /** Number of conflicts resolved */
  conflictsResolved: number
  /** Time spent syncing (ms) */
  syncDuration: number
  /** Last sync timestamp */
  lastSyncAt: Date | null
  /** Current lag (frames behind primary) */
  lag: number
}

/**
 * Configuration for sync behavior
 */
interface SyncConfig {
  /** Sync URL (Turso primary) */
  syncUrl: string
  /** Auth token for Turso */
  authToken: string
  /** Sync interval in milliseconds */
  syncInterval?: number
  /** Maximum frames per sync batch */
  batchSize?: number
  /** Conflict resolution strategy */
  conflictResolution?: 'last-write-wins' | 'local-wins' | 'remote-wins' | 'manual'
  /** Enable periodic sync */
  periodicSync?: boolean
  /** Read-your-writes consistency */
  readYourWrites?: boolean
}

/**
 * Embedded replica client interface
 */
interface EmbeddedReplica {
  /** Current sync status */
  status: SyncStatus
  /** Sync statistics */
  stats: SyncStats
  /** Sync configuration */
  config: SyncConfig
  /** Last checkpoint */
  checkpoint: SyncCheckpoint | null

  /** Sync from primary */
  sync(): Promise<SyncResult>
  /** Force full sync (drop and rebuild) */
  fullSync(): Promise<SyncResult>
  /** Get current frame position */
  getFramePosition(): Promise<number>
  /** Apply a single frame */
  applyFrame(frame: Frame): Promise<void>
  /** Detect conflicts with pending local changes */
  detectConflicts(frames: Frame[]): Promise<ConflictInfo[]>
  /** Create checkpoint at current position */
  createCheckpoint(): Promise<SyncCheckpoint>
  /** Resume from checkpoint */
  resumeFromCheckpoint(checkpoint: SyncCheckpoint): Promise<void>
  /** Close replica */
  close(): Promise<void>
}

/**
 * Result of a sync operation
 */
interface SyncResult {
  /** Whether sync completed successfully */
  success: boolean
  /** Frames applied in this sync */
  framesApplied: number
  /** New frame position */
  framePosition: number
  /** Conflicts encountered */
  conflicts: ConflictInfo[]
  /** Error if sync failed */
  error?: Error
  /** Duration of sync (ms) */
  duration: number
}

/**
 * Primary database interface for sync source
 */
interface SyncPrimary {
  /** Get frames since position */
  getFramesSince(frameNo: number, limit?: number): Promise<Frame[]>
  /** Get current frame number */
  getCurrentFrameNo(): Promise<number>
  /** Get full database snapshot */
  getSnapshot(): Promise<Uint8Array>
}

// ============================================================================
// MOCK IMPLEMENTATIONS (for test setup)
// ============================================================================

/**
 * Creates a mock embedded replica for testing
 */
function createMockReplica(_config: SyncConfig): EmbeddedReplica {
  // This will be implemented in GREEN phase
  throw new Error('Not implemented: createMockReplica')
}

/**
 * Creates a mock primary for testing
 */
function createMockPrimary(): SyncPrimary {
  // This will be implemented in GREEN phase
  throw new Error('Not implemented: createMockPrimary')
}

/**
 * Creates test frames for sync testing
 */
function createTestFrames(count: number, startingFrameNo: number = 0): Frame[] {
  return Array.from({ length: count }, (_, i) => ({
    frameNo: startingFrameNo + i,
    pageNo: i % 100, // Simulate page distribution
    data: new Uint8Array(4096).fill(i % 256),
    checksum: (startingFrameNo + i) * 12345, // Dummy checksum
    timestamp: Date.now() + i * 100,
  }))
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('@dotdo/turso sync protocol', () => {
  let replica: EmbeddedReplica
  let primary: SyncPrimary

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // REPLICA SYNC
  // ==========================================================================

  describe('Replica sync', () => {
    beforeEach(() => {
      primary = createMockPrimary()
      replica = createMockReplica({
        syncUrl: 'libsql://test.turso.io',
        authToken: 'test-token',
      })
    })

    it('syncs from primary to replica', async () => {
      // Setup: Primary has 100 frames, replica has 0
      const frames = createTestFrames(100)

      // Execute: Sync from primary
      const result = await replica.sync()

      // Verify: All frames should be applied
      expect(result.success).toBe(true)
      expect(result.framesApplied).toBe(100)
      expect(result.framePosition).toBe(99)
    })

    it('tracks sync position', async () => {
      // Get initial position
      const initialPosition = await replica.getFramePosition()
      expect(initialPosition).toBe(-1) // No frames yet

      // Sync some frames
      await replica.sync()

      // Verify position is updated
      const newPosition = await replica.getFramePosition()
      expect(newPosition).toBeGreaterThan(initialPosition)
    })

    it('handles incremental sync', async () => {
      // Initial sync
      const firstResult = await replica.sync()
      const firstPosition = firstResult.framePosition

      // Primary gets more frames
      // (In real implementation, mock would track this)

      // Incremental sync
      const secondResult = await replica.sync()

      // Should only sync new frames
      expect(secondResult.framePosition).toBeGreaterThan(firstPosition)
      expect(secondResult.framesApplied).toBeLessThan(firstResult.framesApplied)
    })

    it('updates sync stats after sync', async () => {
      const initialStats = replica.stats

      await replica.sync()

      expect(replica.stats.framesApplied).toBeGreaterThan(initialStats.framesApplied)
      expect(replica.stats.bytesTransferred).toBeGreaterThan(0)
      expect(replica.stats.lastSyncAt).not.toBeNull()
    })

    it('reports lag correctly', async () => {
      // Before sync, should have lag
      expect(replica.stats.lag).toBeGreaterThan(0)

      // After sync, lag should be 0
      await replica.sync()
      expect(replica.stats.lag).toBe(0)
    })

    it('transitions status through sync lifecycle', async () => {
      expect(replica.status).toBe('idle')

      const syncPromise = replica.sync()
      // During sync, status should be 'syncing'
      expect(replica.status).toBe('syncing')

      await syncPromise
      // After sync, status should be 'synced'
      expect(replica.status).toBe('synced')
    })

    it('handles empty sync (already up to date)', async () => {
      // First sync to get up to date
      await replica.sync()

      // Second sync should be no-op
      const result = await replica.sync()

      expect(result.success).toBe(true)
      expect(result.framesApplied).toBe(0)
    })

    it('respects batch size configuration', async () => {
      const batchedReplica = createMockReplica({
        syncUrl: 'libsql://test.turso.io',
        authToken: 'test-token',
        batchSize: 10,
      })

      // With 100 frames to sync and batch size of 10,
      // should do multiple batches
      const result = await batchedReplica.sync()

      expect(result.success).toBe(true)
      // Implementation detail: batching is internal
    })

    it('supports periodic sync', async () => {
      const periodicReplica = createMockReplica({
        syncUrl: 'libsql://test.turso.io',
        authToken: 'test-token',
        periodicSync: true,
        syncInterval: 5000, // 5 seconds
      })

      // Initial sync
      await periodicReplica.sync()
      const firstSyncAt = periodicReplica.stats.lastSyncAt

      // Advance time
      await vi.advanceTimersByTimeAsync(5000)

      // Should have synced again
      expect(periodicReplica.stats.lastSyncAt).not.toEqual(firstSyncAt)
    })
  })

  // ==========================================================================
  // FRAME REPLICATION
  // ==========================================================================

  describe('Frame replication', () => {
    beforeEach(() => {
      primary = createMockPrimary()
      replica = createMockReplica({
        syncUrl: 'libsql://test.turso.io',
        authToken: 'test-token',
      })
    })

    it('applies frame to replica', async () => {
      const frame: Frame = {
        frameNo: 0,
        pageNo: 1,
        data: new Uint8Array(4096).fill(42),
        checksum: 12345,
        timestamp: Date.now(),
      }

      await replica.applyFrame(frame)

      const position = await replica.getFramePosition()
      expect(position).toBe(0)
    })

    it('orders frames correctly', async () => {
      // Apply frames out of order
      const frames = createTestFrames(5)

      // Apply in reverse order
      for (let i = frames.length - 1; i >= 0; i--) {
        await replica.applyFrame(frames[i])
      }

      // Frames should be applied in correct order internally
      const position = await replica.getFramePosition()
      expect(position).toBe(4) // Last frame number
    })

    it('rejects frame with invalid checksum', async () => {
      const badFrame: Frame = {
        frameNo: 0,
        pageNo: 1,
        data: new Uint8Array(4096).fill(42),
        checksum: 99999, // Invalid checksum
        timestamp: Date.now(),
      }

      await expect(replica.applyFrame(badFrame)).rejects.toThrow(/checksum|invalid/i)
    })

    it('rejects frame with gap in sequence', async () => {
      // Apply frame 0
      const frame0 = createTestFrames(1, 0)[0]
      await replica.applyFrame(frame0)

      // Skip frame 1, try to apply frame 2
      const frame2 = createTestFrames(1, 2)[0]

      await expect(replica.applyFrame(frame2)).rejects.toThrow(/gap|sequence|missing/i)
    })

    it('handles duplicate frame idempotently', async () => {
      const frame = createTestFrames(1)[0]

      await replica.applyFrame(frame)
      await replica.applyFrame(frame) // Apply again

      // Should not error, position unchanged
      const position = await replica.getFramePosition()
      expect(position).toBe(0)
    })

    it('validates frame data integrity', async () => {
      const corruptFrame: Frame = {
        frameNo: 0,
        pageNo: 1,
        data: new Uint8Array(100), // Wrong size (should be 4096)
        checksum: 12345,
        timestamp: Date.now(),
      }

      await expect(replica.applyFrame(corruptFrame)).rejects.toThrow(/size|corrupt|invalid/i)
    })

    it('applies frames atomically', async () => {
      const frames = createTestFrames(5)

      // Apply frames
      for (const frame of frames) {
        await replica.applyFrame(frame)
      }

      // All or nothing - if one fails, previous should be rolled back
      // This tests atomicity of frame application
      const position = await replica.getFramePosition()
      expect(position).toBe(4)
    })
  })

  // ==========================================================================
  // CONFLICT HANDLING
  // ==========================================================================

  describe('Conflict handling', () => {
    beforeEach(() => {
      primary = createMockPrimary()
      replica = createMockReplica({
        syncUrl: 'libsql://test.turso.io',
        authToken: 'test-token',
        conflictResolution: 'last-write-wins',
      })
    })

    it('detects conflicting writes', async () => {
      // Simulate local write
      const localWrite = {
        table: 'users',
        primaryKey: { id: '123' },
        localVersion: {
          data: { id: '123', name: 'Local Name' },
          timestamp: Date.now(),
        },
        remoteVersion: {
          data: { id: '123', name: 'Remote Name' },
          timestamp: Date.now() - 1000, // Remote is older
        },
      }

      // Frames from primary that conflict with local write
      const conflictingFrames = createTestFrames(5)

      const conflicts = await replica.detectConflicts(conflictingFrames)

      expect(conflicts.length).toBeGreaterThan(0)
      expect(conflicts[0].table).toBe('users')
      expect(conflicts[0].primaryKey).toEqual({ id: '123' })
    })

    it('applies last-write-wins resolution', async () => {
      const replicaWithLWW = createMockReplica({
        syncUrl: 'libsql://test.turso.io',
        authToken: 'test-token',
        conflictResolution: 'last-write-wins',
      })

      // Local write at timestamp T
      // Remote write at timestamp T+1

      const result = await replicaWithLWW.sync()

      // Remote should win because it has later timestamp
      expect(result.conflicts.length).toBe(0) // Resolved automatically
      expect(replicaWithLWW.stats.conflictsResolved).toBeGreaterThan(0)
    })

    it('applies local-wins resolution when configured', async () => {
      const replicaLocalWins = createMockReplica({
        syncUrl: 'libsql://test.turso.io',
        authToken: 'test-token',
        conflictResolution: 'local-wins',
      })

      // With local-wins, local changes should be preserved
      const result = await replicaLocalWins.sync()

      expect(result.success).toBe(true)
    })

    it('applies remote-wins resolution when configured', async () => {
      const replicaRemoteWins = createMockReplica({
        syncUrl: 'libsql://test.turso.io',
        authToken: 'test-token',
        conflictResolution: 'remote-wins',
      })

      // With remote-wins, remote changes should be applied
      const result = await replicaRemoteWins.sync()

      expect(result.success).toBe(true)
    })

    it('reports conflicts for manual resolution', async () => {
      const replicaManual = createMockReplica({
        syncUrl: 'libsql://test.turso.io',
        authToken: 'test-token',
        conflictResolution: 'manual',
      })

      // With manual resolution, sync should pause and report conflicts
      const result = await replicaManual.sync()

      expect(result.conflicts.length).toBeGreaterThan(0)
      // Sync completes but conflicts are reported for user handling
    })

    it('tracks conflict statistics', async () => {
      await replica.sync()

      expect(replica.stats.conflictsDetected).toBeGreaterThanOrEqual(0)
      expect(replica.stats.conflictsResolved).toBeGreaterThanOrEqual(0)
    })

    it('handles multi-row conflicts', async () => {
      // Simulate multiple conflicting rows
      const frames = createTestFrames(10)
      const conflicts = await replica.detectConflicts(frames)

      // Each conflict should be independently tracked
      for (const conflict of conflicts) {
        expect(conflict.table).toBeDefined()
        expect(conflict.primaryKey).toBeDefined()
        expect(conflict.localVersion).toBeDefined()
        expect(conflict.remoteVersion).toBeDefined()
      }
    })

    it('handles conflict on same row with multiple writes', async () => {
      // Same row modified multiple times
      const frames = createTestFrames(3)

      // All frames affect same row
      const conflicts = await replica.detectConflicts(frames)

      // Should consolidate to single conflict per row
      expect(conflicts.length).toBeLessThanOrEqual(1)
    })
  })

  // ==========================================================================
  // RECOVERY
  // ==========================================================================

  describe('Recovery', () => {
    beforeEach(() => {
      primary = createMockPrimary()
      replica = createMockReplica({
        syncUrl: 'libsql://test.turso.io',
        authToken: 'test-token',
      })
    })

    it('performs full sync on corruption', async () => {
      // Simulate corruption detection
      // @ts-expect-error - accessing internal state for testing
      replica._status = 'corrupted'

      // Full sync should rebuild from scratch
      const result = await replica.fullSync()

      expect(result.success).toBe(true)
      expect(replica.status).toBe('synced')
    })

    it('resumes from last checkpoint', async () => {
      // Create checkpoint at position 50
      const checkpoint = await replica.createCheckpoint()
      expect(checkpoint.frameNo).toBeGreaterThanOrEqual(0)

      // Simulate crash/restart
      const newReplica = createMockReplica({
        syncUrl: 'libsql://test.turso.io',
        authToken: 'test-token',
      })

      // Resume from checkpoint
      await newReplica.resumeFromCheckpoint(checkpoint)

      // Should continue from checkpoint, not start over
      const position = await newReplica.getFramePosition()
      expect(position).toBe(checkpoint.frameNo)
    })

    it('creates checkpoint at current position', async () => {
      // Sync some frames
      await replica.sync()

      const checkpoint = await replica.createCheckpoint()

      expect(checkpoint.frameNo).toBeGreaterThanOrEqual(0)
      expect(checkpoint.pageCount).toBeGreaterThan(0)
      expect(checkpoint.checksum).toBeDefined()
      expect(checkpoint.timestamp).toBeDefined()
    })

    it('validates checkpoint before resuming', async () => {
      const invalidCheckpoint: SyncCheckpoint = {
        frameNo: 9999,
        pageCount: 1000,
        checksum: 12345,
        timestamp: Date.now(),
      }

      // Should detect invalid checkpoint
      await expect(replica.resumeFromCheckpoint(invalidCheckpoint))
        .rejects.toThrow(/invalid|corrupt|mismatch/i)
    })

    it('detects corruption via checksum mismatch', async () => {
      await replica.sync()

      // Corrupt the database (simulate file corruption)
      // @ts-expect-error - accessing internal state for testing
      replica._corrupt()

      // Next sync should detect corruption
      const result = await replica.sync()

      expect(result.success).toBe(false)
      expect(replica.status).toBe('corrupted')
    })

    it('automatically triggers full sync on unrecoverable state', async () => {
      // Simulate unrecoverable state (huge gap in frames)
      // @ts-expect-error - accessing internal state for testing
      replica._framePosition = 9999999

      const result = await replica.sync()

      // Should have fallen back to full sync
      expect(result.success).toBe(true)
      expect(replica.status).toBe('synced')
    })

    it('preserves local changes during recovery when possible', async () => {
      // Make local writes
      // @ts-expect-error - accessing internal method for testing
      await replica._localWrite({ table: 'users', data: { id: '1', name: 'Local' } })

      // Trigger recovery
      await replica.fullSync()

      // Local changes should be re-applied if possible
      // (this depends on implementation strategy)
    })

    it('reports recovery progress', async () => {
      let progressReports: number[] = []

      // @ts-expect-error - attaching progress handler
      replica.onProgress = (progress: number) => {
        progressReports.push(progress)
      }

      await replica.fullSync()

      // Should have reported progress
      expect(progressReports.length).toBeGreaterThan(0)
      expect(progressReports[progressReports.length - 1]).toBe(100)
    })

    it('handles network failure during recovery', async () => {
      // Simulate network failure
      // @ts-expect-error - simulating network failure
      replica._networkFail = true

      await expect(replica.fullSync()).rejects.toThrow(/network|connection|timeout/i)

      // Status should indicate problem
      expect(replica.status).toBe('recovering')
    })

    it('transitions to stale status when sync fails repeatedly', async () => {
      // Simulate repeated sync failures
      for (let i = 0; i < 5; i++) {
        try {
          await replica.sync()
        } catch {
          // Expected to fail
        }
      }

      // After multiple failures, should be marked stale
      expect(replica.status).toBe('stale')
    })
  })

  // ==========================================================================
  // READ-YOUR-WRITES CONSISTENCY
  // ==========================================================================

  describe('Read-your-writes consistency', () => {
    beforeEach(() => {
      replica = createMockReplica({
        syncUrl: 'libsql://test.turso.io',
        authToken: 'test-token',
        readYourWrites: true,
      })
    })

    it('ensures local writes are visible immediately', async () => {
      // Write locally
      // @ts-expect-error - accessing internal method for testing
      await replica._localWrite({ table: 'users', data: { id: '1', name: 'Test' } })

      // Read should see local write even before sync
      // @ts-expect-error - accessing internal method for testing
      const result = await replica._localRead('users', '1')

      expect(result).toEqual({ id: '1', name: 'Test' })
    })

    it('maintains consistency after sync', async () => {
      // Write locally
      // @ts-expect-error - accessing internal method for testing
      await replica._localWrite({ table: 'users', data: { id: '1', name: 'Local' } })

      // Sync
      await replica.sync()

      // Local write should still be visible (or merged correctly)
      // @ts-expect-error - accessing internal method for testing
      const result = await replica._localRead('users', '1')

      expect(result.name).toBe('Local') // Or merged value
    })
  })

  // ==========================================================================
  // SYNC CONFIGURATION
  // ==========================================================================

  describe('Sync configuration', () => {
    it('validates sync URL format', () => {
      expect(() => createMockReplica({
        syncUrl: 'invalid-url',
        authToken: 'test-token',
      })).toThrow(/invalid.*url|malformed/i)
    })

    it('requires auth token', () => {
      expect(() => createMockReplica({
        syncUrl: 'libsql://test.turso.io',
        authToken: '',
      })).toThrow(/auth.*required|token.*missing/i)
    })

    it('accepts valid libsql URL', () => {
      const replica = createMockReplica({
        syncUrl: 'libsql://test.turso.io',
        authToken: 'valid-token',
      })

      expect(replica.config.syncUrl).toBe('libsql://test.turso.io')
    })

    it('accepts valid https URL', () => {
      const replica = createMockReplica({
        syncUrl: 'https://test.turso.io',
        authToken: 'valid-token',
      })

      expect(replica.config.syncUrl).toBe('https://test.turso.io')
    })

    it('defaults sync interval to 60 seconds', () => {
      const replica = createMockReplica({
        syncUrl: 'libsql://test.turso.io',
        authToken: 'test-token',
      })

      expect(replica.config.syncInterval).toBe(60000)
    })

    it('defaults conflict resolution to last-write-wins', () => {
      const replica = createMockReplica({
        syncUrl: 'libsql://test.turso.io',
        authToken: 'test-token',
      })

      expect(replica.config.conflictResolution).toBe('last-write-wins')
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('Edge cases', () => {
    beforeEach(() => {
      replica = createMockReplica({
        syncUrl: 'libsql://test.turso.io',
        authToken: 'test-token',
      })
    })

    it('handles empty database sync', async () => {
      // Primary has no data
      const result = await replica.sync()

      expect(result.success).toBe(true)
      expect(result.framesApplied).toBe(0)
    })

    it('handles very large frames', async () => {
      const largeFrame: Frame = {
        frameNo: 0,
        pageNo: 1,
        data: new Uint8Array(4096 * 100), // 100 pages worth
        checksum: 12345,
        timestamp: Date.now(),
      }

      // Should handle or reject gracefully
      await expect(replica.applyFrame(largeFrame)).rejects.toThrow(/size|too large/i)
    })

    it('handles concurrent sync requests', async () => {
      // Start two syncs concurrently
      const sync1 = replica.sync()
      const sync2 = replica.sync()

      // One should complete, one should wait or be deduplicated
      const [result1, result2] = await Promise.all([sync1, sync2])

      // At least one should succeed
      expect(result1.success || result2.success).toBe(true)
    })

    it('handles rapid successive syncs', async () => {
      // Rapid fire syncs
      const results = await Promise.all([
        replica.sync(),
        replica.sync(),
        replica.sync(),
      ])

      // All should complete successfully
      expect(results.every(r => r.success)).toBe(true)
    })

    it('cleans up resources on close', async () => {
      await replica.sync()
      await replica.close()

      // Further operations should fail
      await expect(replica.sync()).rejects.toThrow(/closed|disposed/i)
    })

    it('handles primary going offline during sync', async () => {
      // Start sync
      const syncPromise = replica.sync()

      // Primary goes offline
      // @ts-expect-error - simulating offline
      replica._primaryOffline = true

      const result = await syncPromise

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('handles schema changes from primary', async () => {
      // Primary adds a new table/column
      await replica.sync()

      // New schema should be applied
      // @ts-expect-error - accessing schema info
      const schema = await replica._getSchema()
      expect(schema).toBeDefined()
    })
  })

  // ==========================================================================
  // METRICS AND OBSERVABILITY
  // ==========================================================================

  describe('Metrics and observability', () => {
    beforeEach(() => {
      replica = createMockReplica({
        syncUrl: 'libsql://test.turso.io',
        authToken: 'test-token',
      })
    })

    it('tracks sync duration', async () => {
      await replica.sync()

      expect(replica.stats.syncDuration).toBeGreaterThan(0)
    })

    it('tracks bytes transferred', async () => {
      await replica.sync()

      expect(replica.stats.bytesTransferred).toBeGreaterThan(0)
    })

    it('provides last sync timestamp', async () => {
      expect(replica.stats.lastSyncAt).toBeNull()

      await replica.sync()

      expect(replica.stats.lastSyncAt).toBeInstanceOf(Date)
    })

    it('calculates current lag', async () => {
      // Before sync
      const lagBefore = replica.stats.lag
      expect(lagBefore).toBeGreaterThanOrEqual(0)

      await replica.sync()

      // After sync
      expect(replica.stats.lag).toBe(0)
    })

    it('exposes detailed frame statistics', async () => {
      await replica.sync()

      expect(replica.stats.framesApplied).toBeGreaterThanOrEqual(0)
    })
  })
})
