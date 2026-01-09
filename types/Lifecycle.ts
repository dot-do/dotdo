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
