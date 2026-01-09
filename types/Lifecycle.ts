/**
 * Lifecycle Types for DO (Durable Object) lifecycle operations
 *
 * These types define the interfaces and options for DO lifecycle operations:
 * - Clone: Duplicate a DO to a new location
 * - Shard: Split a DO across multiple instances
 * - Compact: Archive old data and reduce storage
 * - Move: Relocate a DO to a different colo
 * - Promote: Elevate a Thing to its own DO
 * - Demote: Merge a promoted DO back into its parent
 */

// ============================================================================
// Clone Types
// ============================================================================

/**
 * Mode for clone operations
 * - atomic: All-or-nothing clone operation
 * - staged: Two-phase commit with prepare/commit
 * - eventual: Background async clone
 * - resumable: Checkpoint-based clone that can be resumed
 */
export type CloneMode = 'atomic' | 'staged' | 'eventual' | 'resumable'

/**
 * Options for clone operations
 */
export interface CloneOptions {
  /** Target colo for the clone */
  colo?: string
  /** Clone as a read-only replica */
  asReplica?: boolean
  /** Compress data during clone */
  compress?: boolean
  /** Unshard the source if it's sharded */
  unshard?: boolean
  /** Target branch name */
  branch?: string
  /** Specific version to clone */
  version?: number
  /** Clone mode */
  mode?: CloneMode
}

/**
 * Result of a clone operation
 */
export interface CloneResult {
  /** Namespace of the cloned DO */
  ns: string
  /** ID of the cloned DO */
  doId: string
  /** Mode used for the clone */
  mode: CloneMode
  /** Staged clone info (for staged mode) */
  staged?: {
    /** Prepare transaction ID */
    prepareId: string
    /** Whether the clone has been committed */
    committed: boolean
  }
  /** Checkpoint info (for resumable mode) */
  checkpoint?: {
    /** Checkpoint ID for resuming */
    id: string
    /** Progress (0-1) */
    progress: number
    /** Whether the clone can be resumed */
    resumable: boolean
  }
}

// ============================================================================
// Eventual Clone Types
// ============================================================================

/**
 * Clone operation status lifecycle
 */
export type CloneStatus = 'pending' | 'syncing' | 'active' | 'paused' | 'error' | 'cancelled'

/**
 * Sync phase for eventual clone
 */
export type SyncPhase = 'initial' | 'bulk' | 'delta' | 'catchup'

/**
 * Detailed sync status information
 */
export interface SyncStatus {
  /** Current sync phase */
  phase: SyncPhase
  /** Number of items synced */
  itemsSynced: number
  /** Total items to sync (may increase during delta phase) */
  totalItems: number
  /** Time of last successful sync */
  lastSyncAt: Date | null
  /** Current divergence from source (in items or versions behind) */
  divergence: number
  /** Maximum allowed divergence before forcing sync */
  maxDivergence: number
  /** Sync interval in milliseconds */
  syncInterval: number
  /** Number of consecutive errors */
  errorCount: number
  /** Last error if any */
  lastError: Error | null
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  /** Items synced in this batch */
  itemsSynced: number
  /** Time taken for sync in ms */
  duration: number
  /** Any conflicts encountered */
  conflicts: ConflictInfo[]
}

/**
 * Conflict resolution strategy
 */
export type ConflictResolution = 'last-write-wins' | 'source-wins' | 'target-wins' | 'merge' | 'custom'

/**
 * Conflict information
 */
export interface ConflictInfo {
  /** ID of the conflicted thing */
  thingId: string
  /** Source version */
  sourceVersion: number
  /** Target version */
  targetVersion: number
  /** Resolution strategy used */
  resolution: ConflictResolution
  /** Timestamp of conflict resolution */
  resolvedAt: Date
}

/**
 * Clone handle returned from eventual clone initiation
 */
export interface EventualCloneHandle {
  /** Unique identifier for this clone operation */
  id: string
  /** Current status of the clone */
  status: CloneStatus
  /** Get current progress (0-100) */
  getProgress(): Promise<number>
  /** Get detailed sync status */
  getSyncStatus(): Promise<SyncStatus>
  /** Pause the sync operation */
  pause(): Promise<void>
  /** Resume a paused sync operation */
  resume(): Promise<void>
  /** Trigger a manual sync */
  sync(): Promise<SyncResult>
  /** Cancel the clone operation */
  cancel(): Promise<void>
}

/**
 * Options specific to eventual clone mode
 */
export interface EventualCloneOptions extends CloneOptions {
  mode: 'eventual'
  /** Sync interval in milliseconds (default: 5000) */
  syncInterval?: number
  /** Maximum divergence before forcing sync (default: 100 items) */
  maxDivergence?: number
  /** Conflict resolution strategy */
  conflictResolution?: 'last-write-wins' | 'source-wins' | 'target-wins' | 'merge'
  /** Custom conflict resolver function */
  conflictResolver?: (conflict: ConflictInfo) => Promise<unknown>
  /** Enable chunked transfer for large states */
  chunked?: boolean
  /** Chunk size for bulk transfer (default: 1000 items) */
  chunkSize?: number
  /** Rate limit for sync operations (ops/second) */
  rateLimit?: number
}

/**
 * Internal state for an eventual clone operation
 */
export interface EventualCloneState {
  /** Clone operation ID */
  id: string
  /** Target namespace */
  targetNs: string
  /** Current status */
  status: CloneStatus
  /** Current progress (0-100) */
  progress: number
  /** Current sync phase */
  phase: SyncPhase
  /** Number of items synced */
  itemsSynced: number
  /** Total items to sync */
  totalItems: number
  /** Number of items remaining */
  itemsRemaining: number
  /** Last sync timestamp */
  lastSyncAt: string | null
  /** Current divergence */
  divergence: number
  /** Maximum divergence threshold */
  maxDivergence: number
  /** Sync interval in milliseconds */
  syncInterval: number
  /** Error count */
  errorCount: number
  /** Last error message */
  lastError: string | null
  /** Conflict resolution strategy */
  conflictResolution: ConflictResolution
  /** Custom conflict resolver (stored as serialized reference) */
  hasCustomResolver: boolean
  /** Enable chunked transfer */
  chunked: boolean
  /** Chunk size */
  chunkSize: number
  /** Rate limit */
  rateLimit: number | null
  /** Created timestamp */
  createdAt: string
  /** Last updated timestamp */
  updatedAt: string
  /** Last synced version (for delta sync) */
  lastSyncedVersion: number
}

// ============================================================================
// Staged Clone Types
// ============================================================================

/**
 * Result of a staged clone prepare operation
 */
export interface StagedPrepareResult {
  /** Phase indicator - should be 'prepared' after successful prepare */
  phase: 'prepared'
  /** Unique staging token for this operation */
  token: string
  /** When this staging token expires */
  expiresAt: Date
  /** Staging area namespace */
  stagingNs: string
  /** Metadata about the prepared state */
  metadata: {
    /** Number of things staged */
    thingsCount: number
    /** Size of staged data in bytes */
    sizeBytes: number
    /** Source branch */
    branch: string
    /** Source version */
    version: number
  }
}

/**
 * Result of a staged clone commit operation
 */
export interface StagedCommitResult {
  /** Phase indicator - should be 'committed' after successful commit */
  phase: 'committed'
  /** The clone result */
  result: CloneResult
  /** Commit timestamp */
  committedAt: Date
}

/**
 * Result of a staged clone abort operation
 */
export interface StagedAbortResult {
  /** Phase indicator - should be 'aborted' after successful abort */
  phase: 'aborted'
  /** The token that was aborted */
  token: string
  /** Reason for abort (optional) */
  reason?: string
  /** Abort timestamp */
  abortedAt: Date
}

/**
 * Staging area status
 */
export interface StagingStatus {
  /** Whether the staging area exists */
  exists: boolean
  /** Status of the staging area */
  status: 'staging' | 'ready' | 'committed' | 'aborted' | 'expired' | 'corrupted'
  /** Token associated with this staging area */
  token: string
  /** When the staging area was created */
  createdAt: Date
  /** When the token expires */
  expiresAt: Date
  /** Integrity hash of staged data */
  integrityHash?: string
}

/**
 * Internal staging data structure
 */
export interface StagingData {
  /** Source namespace */
  sourceNs: string
  /** Target namespace */
  targetNs: string
  /** Staging area namespace */
  stagingNs: string
  /** Staged things */
  things: Array<{
    id: string
    type: unknown
    branch: string | null
    name: string | null
    data: unknown
    deleted: boolean
  }>
  /** When the token expires */
  expiresAt: string
  /** Current status */
  status: 'prepared' | 'committed' | 'aborted'
  /** When staging was created */
  createdAt: string
  /** Integrity hash */
  integrityHash: string
  /** Metadata */
  metadata: {
    thingsCount: number
    sizeBytes: number
    branch: string
    version: number
  }
}

/**
 * Checkpoint representing a point in the staged clone process
 */
export interface Checkpoint {
  /** Unique identifier for this checkpoint */
  id: string
  /** Clone operation ID this checkpoint belongs to */
  cloneId: string
  /** Sequence number for ordering checkpoints */
  sequence: number
  /** Number of items processed at this checkpoint */
  itemsProcessed: number
  /** Total items to process */
  totalItems: number
  /** Timestamp when checkpoint was created */
  createdAt: Date
  /** Hash/checksum for validation */
  checksum: string
  /** State snapshot at this checkpoint */
  state: CheckpointState
  /** Whether this checkpoint has been validated */
  validated: boolean
}

/**
 * State stored in a checkpoint
 */
export interface CheckpointState {
  /** IDs of things already cloned */
  clonedThingIds: string[]
  /** IDs of relationships already cloned */
  clonedRelationshipIds: string[]
  /** Current branch being cloned */
  branch: string
  /** Last processed version */
  lastVersion: number
}

// ============================================================================
// Resumable Clone Types
// ============================================================================

/**
 * Status for a resumable clone operation
 */
export type ResumableCloneStatus =
  | 'initializing'
  | 'transferring'
  | 'paused'
  | 'resuming'
  | 'validating'
  | 'completed'
  | 'failed'
  | 'cancelled'

/**
 * Checkpoint data for resumable clone
 */
export interface ResumableCheckpoint {
  /** Unique checkpoint identifier */
  id: string
  /** Position in the data stream (items processed) */
  position: number
  /** SHA-256 integrity hash of data at this checkpoint */
  hash: string
  /** Timestamp when checkpoint was created */
  timestamp: Date
  /** Total items processed up to this checkpoint */
  itemsProcessed: number
  /** Batch number this checkpoint represents */
  batchNumber: number
  /** Clone operation ID this checkpoint belongs to */
  cloneId?: string
  /** Whether compression was used */
  compressed?: boolean
}

/**
 * Clone lock information for concurrency control
 */
export interface CloneLockInfo {
  /** Lock ID */
  lockId: string
  /** Clone operation that holds the lock */
  cloneId: string
  /** When the lock was acquired */
  acquiredAt: Date
  /** When the lock expires */
  expiresAt: Date
  /** Whether the lock is stale */
  isStale: boolean
}

/**
 * Clone handle returned from resumable clone initiation
 */
export interface ResumableCloneHandle {
  /** Unique identifier for this clone operation */
  id: string
  /** Current status of the clone */
  status: ResumableCloneStatus
  /** Array of created checkpoints */
  checkpoints: ResumableCheckpoint[]
  /** Get current progress (0-100) */
  getProgress(): Promise<number>
  /** Pause the clone at the next checkpoint */
  pause(): Promise<void>
  /** Resume from the last checkpoint */
  resume(): Promise<void>
  /** Cancel the clone operation */
  cancel(): Promise<void>
  /** Wait for the next checkpoint to be created */
  waitForCheckpoint(): Promise<ResumableCheckpoint>
  /** Check if clone can be resumed from a specific checkpoint */
  canResumeFrom(checkpointId: string): Promise<boolean>
  /** Get integrity hash for the clone */
  getIntegrityHash(): Promise<string>
  /** Get the clone lock info */
  getLockInfo(): Promise<CloneLockInfo | null>
  /** Force override a stale lock */
  forceOverrideLock(): Promise<void>
}

/**
 * Options specific to resumable clone mode
 */
export interface ResumableCloneOptions extends CloneOptions {
  mode: 'resumable'
  /** Batch size for streaming transfer (default: 100 items) */
  batchSize?: number
  /** Checkpoint interval (create checkpoint every N batches, default: 1) */
  checkpointInterval?: number
  /** Maximum retry attempts on failure (default: 3) */
  maxRetries?: number
  /** Delay between retries in ms (default: 1000) */
  retryDelay?: number
  /** Lock timeout in ms (default: 300000 = 5 minutes) */
  lockTimeout?: number
  /** Checkpoint retention period in ms (default: 3600000 = 1 hour) */
  checkpointRetentionMs?: number
  /** Resume from specific checkpoint ID */
  resumeFrom?: string
  /** Enable compression for transfer */
  compress?: boolean
  /** Force override existing clone lock */
  forceLock?: boolean
  /** Maximum bandwidth in bytes per second (default: unlimited) */
  maxBandwidth?: number
}

/**
 * Internal state for a resumable clone operation
 */
export interface ResumableCloneState {
  /** Clone operation ID */
  id: string
  /** Target namespace */
  targetNs: string
  /** Current status */
  status: ResumableCloneStatus
  /** Array of checkpoints */
  checkpoints: ResumableCheckpoint[]
  /** Current position (items processed) */
  position: number
  /** Current progress (0-100) */
  progress?: number
  /** Batch size */
  batchSize: number
  /** Checkpoint interval */
  checkpointInterval: number
  /** Maximum retries */
  maxRetries: number
  /** Retry delay in ms */
  retryDelay: number
  /** Current retry count */
  retryCount: number
  /** Enable compression */
  compress: boolean
  /** Maximum bandwidth */
  maxBandwidth?: number
  /** Checkpoint retention period */
  checkpointRetentionMs: number
  /** Whether pause is requested */
  pauseRequested: boolean
  /** Whether cancel is requested */
  cancelRequested: boolean
  /** Created timestamp */
  createdAt: Date
  /** Started timestamp (when first batch began) */
  startedAt: Date | null
  /** Bytes transferred */
  bytesTransferred: number
  /** Total bytes to transfer */
  totalBytes: number
}

/**
 * Internal clone lock state
 */
export interface CloneLockState {
  /** Lock ID */
  lockId: string
  /** Clone operation ID */
  cloneId: string
  /** Target namespace */
  target: string
  /** When acquired */
  acquiredAt: Date
  /** When expires */
  expiresAt: Date
  /** Whether stale */
  isStale: boolean
}

// ============================================================================
// Shard Types
// ============================================================================

/**
 * Strategy for distributing data across shards
 * - hash: Hash-based distribution (consistent hashing)
 * - range: Range-based partitioning
 * - roundRobin: Round-robin distribution
 * - custom: Custom sharding function
 */
export type ShardStrategy = 'hash' | 'range' | 'roundRobin' | 'custom'

/**
 * Options for shard operations
 */
export interface ShardOptions {
  /** Key to shard on */
  key: string
  /** Number of shards to create */
  count: number
  /** Sharding strategy */
  strategy?: ShardStrategy
  /** Clone mode for shard creation */
  mode?: CloneMode
}

/**
 * Result of a shard operation
 */
export interface ShardResult {
  /** Key used for sharding */
  shardKey: string
  /** Array of created shards */
  shards: Array<{
    /** Namespace of the shard */
    ns: string
    /** DO ID of the shard */
    doId: string
    /** Index of this shard (0-based) */
    shardIndex: number
    /** Number of things in this shard */
    thingCount: number
  }>
}

/**
 * Options for unshard (merge shards) operations
 */
export interface UnshardOptions {
  /** Target DO to merge into */
  target?: string
  /** Compress during merge */
  compress?: boolean
  /** Mode for the unshard operation */
  mode?: CloneMode
}

// ============================================================================
// Compact Types
// ============================================================================

/**
 * Options for compact operations
 */
export interface CompactOptions {
  /** Archive compacted data */
  archive?: boolean
  /** Branches to compact */
  branches?: string[]
  /** Compact items older than this date */
  olderThan?: Date
  /** Number of versions to keep */
  keepVersions?: number
}

/**
 * Result of a compact operation
 */
export interface CompactResult {
  /** Number of things compacted */
  thingsCompacted: number
  /** Number of actions archived */
  actionsArchived: number
  /** Number of events archived */
  eventsArchived: number
}

// ============================================================================
// Move/Promote/Demote Types
// ============================================================================

/**
 * Result of a move operation
 */
export interface MoveResult {
  /** New DO ID after move */
  newDoId: string
  /** New location info */
  location: {
    /** Colo code (e.g., 'ewr', 'lax') */
    code: string
    /** Region (e.g., 'enam', 'wnam', 'weur', 'apac') */
    region: string
  }
}

/**
 * Result of a promote operation (Thing -> DO)
 */
export interface PromoteResult {
  /** Namespace of the new DO */
  ns: string
  /** ID of the new DO */
  doId: string
  /** Previous Thing ID before promotion */
  previousId: string
}

/**
 * Result of a demote operation (DO -> Thing)
 */
export interface DemoteResult {
  /** New Thing ID after demotion */
  thingId: string
  /** Parent namespace the Thing was demoted into */
  parentNs: string
  /** Namespace that was deleted (the demoted DO) */
  deletedNs: string
}

// ============================================================================
// DOLifecycle Interface
// ============================================================================

/**
 * Interface for DO lifecycle operations
 */
export interface DOLifecycle {
  /**
   * Move the DO to a different colo
   * @param colo - Target colo code
   */
  move(colo: string): Promise<MoveResult>

  /**
   * Compact the DO storage
   * @param options - Compact options
   */
  compact(options?: CompactOptions): Promise<CompactResult>

  /**
   * Clone the DO to a new namespace
   * @param target - Target namespace
   * @param options - Clone options
   */
  clone(target: string, options?: CloneOptions): Promise<CloneResult>

  /**
   * Shard the DO across multiple instances
   * @param options - Shard options
   */
  shard(options: ShardOptions): Promise<ShardResult>

  /**
   * Unshard (merge) sharded DO back into one
   * @param options - Unshard options
   */
  unshard(options?: UnshardOptions): Promise<void>

  /**
   * Promote a Thing to its own DO
   * @param thingId - ID of the Thing to promote
   */
  promote(thingId: string): Promise<PromoteResult>

  /**
   * Demote this DO back to a Thing in another namespace
   * @param targetNs - Target namespace to demote into
   */
  demote(targetNs: string): Promise<DemoteResult>

  /**
   * Resume a resumable clone operation
   * @param checkpointId - Checkpoint ID to resume from
   */
  resume(checkpointId: string): Promise<CloneResult>

  /**
   * Fork the DO to a new namespace with optional branch
   * @param options - Fork options with target and optional branch
   */
  fork(options: { to: string; branch?: string }): Promise<{ ns: string; doId: string }>

  /**
   * Create a new branch
   * @param name - Branch name
   */
  branch(name: string): Promise<{ name: string; head: number }>

  /**
   * Checkout a branch or version
   * @param ref - Branch name or version reference
   */
  checkout(ref: string): Promise<{ branch?: string; version?: number }>

  /**
   * Merge a branch into the current branch
   * @param branch - Branch name to merge
   */
  merge(branch: string): Promise<{ merged: boolean; conflicts?: string[] }>
}
