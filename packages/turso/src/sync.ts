/**
 * Sync Protocol Types and Interfaces
 *
 * This file defines the sync protocol for embedded replicas.
 * Implementation will be added in the GREEN phase.
 */

// ============================================================================
// TYPE EXPORTS
// ============================================================================

/**
 * Sync status for tracking replica state
 */
export type SyncStatus =
  | 'idle'           // No sync in progress
  | 'syncing'        // Sync in progress
  | 'synced'         // Up to date with primary
  | 'stale'          // Behind primary, needs sync
  | 'corrupted'      // Replica corrupted, needs full sync
  | 'recovering'     // Full sync recovery in progress

/**
 * Frame represents a WAL frame from libSQL replication
 */
export interface Frame {
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
export interface SyncCheckpoint {
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
export interface ConflictInfo {
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
export interface SyncStats {
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
export interface SyncConfig {
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
 * Result of a sync operation
 */
export interface SyncResult {
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
 * Embedded replica client interface
 */
export interface EmbeddedReplica {
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

// ============================================================================
// FACTORY FUNCTION (STUB - TO BE IMPLEMENTED)
// ============================================================================

/**
 * Creates an embedded replica client
 *
 * @param config - Sync configuration
 * @returns Embedded replica instance
 *
 * @example
 * ```typescript
 * const replica = createEmbeddedReplica({
 *   syncUrl: 'libsql://my-db.turso.io',
 *   authToken: 'token',
 * })
 *
 * // Initial sync
 * await replica.sync()
 *
 * // Query local replica
 * // ...
 *
 * // Periodic sync
 * setInterval(() => replica.sync(), 60000)
 * ```
 */
export function createEmbeddedReplica(_config: SyncConfig): EmbeddedReplica {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented: createEmbeddedReplica')
}
