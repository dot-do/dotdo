/**
 * DO State Persistence Layer - Type Definitions
 *
 * This module defines the types for DO state persistence, including:
 * - Checkpoint/snapshot system for periodic full state saves
 * - WAL (write-ahead log) for crash recovery
 * - R2 tiered storage (hot in SQLite, cold in R2)
 * - Cross-DO state replication for HA
 * - Schema versioning and migrations
 *
 * @module objects/persistence/types
 */

// ============================================================================
// CHECKPOINT/SNAPSHOT TYPES
// ============================================================================

/**
 * A full state snapshot of the DO at a point in time.
 * Used for backup/restore and disaster recovery.
 */
export interface StateSnapshot {
  /** Unique snapshot ID */
  id: string
  /** DO namespace */
  ns: string
  /** Schema version at time of snapshot */
  schemaVersion: number
  /** Snapshot sequence number (monotonically increasing) */
  sequence: number
  /** Unix timestamp when snapshot was created */
  createdAt: number
  /** Size of snapshot in bytes */
  sizeBytes: number
  /** SHA-256 hash of snapshot data for integrity */
  checksum: string
  /** Compressed snapshot data (gzip) */
  data: Uint8Array
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Checkpoint marks a consistent point in the WAL.
 * All operations before this point are guaranteed to be durable.
 */
export interface Checkpoint {
  /** Unique checkpoint ID */
  id: string
  /** DO namespace */
  ns: string
  /** WAL position (LSN) at checkpoint */
  walPosition: number
  /** Schema version at checkpoint */
  schemaVersion: number
  /** Unix timestamp when checkpoint was created */
  createdAt: number
  /** Snapshot ID if this checkpoint has an associated snapshot */
  snapshotId?: string
  /** Whether checkpoint has been verified */
  verified: boolean
  /** Optional metadata */
  metadata?: string
}

/**
 * Configuration for the checkpoint system
 */
export interface CheckpointConfig {
  /** Interval between automatic checkpoints in milliseconds (default: 5 minutes) */
  intervalMs?: number
  /** Maximum WAL entries before forcing a checkpoint (default: 1000) */
  maxWalEntries?: number
  /** Whether to create snapshots at checkpoints (default: false) */
  createSnapshots?: boolean
  /** Snapshot retention period in milliseconds (default: 7 days) */
  snapshotRetentionMs?: number
  /** Maximum number of snapshots to retain (default: 10) */
  maxSnapshots?: number
  /** Whether to compress snapshots (default: true) */
  compressSnapshots?: boolean
}

// ============================================================================
// WAL (WRITE-AHEAD LOG) TYPES
// ============================================================================

/**
 * Types of operations that can be logged to the WAL
 */
export type WALOperationType =
  | 'INSERT'
  | 'UPDATE'
  | 'DELETE'
  | 'BATCH'
  | 'TX_BEGIN'
  | 'TX_COMMIT'
  | 'TX_ROLLBACK'
  | 'CHECKPOINT'
  | 'SCHEMA_MIGRATE'

/**
 * Transaction states
 */
export type TransactionState = 'ACTIVE' | 'COMMITTED' | 'ROLLED_BACK' | 'ABORTED'

/**
 * A single entry in the Write-Ahead Log
 */
export interface WALEntry {
  /** Log Sequence Number - monotonically increasing */
  lsn: number
  /** Operation type */
  operation: WALOperationType
  /** Target table name */
  table: string
  /** Row/record ID (for single-row ops) */
  recordId?: string
  /** Operation payload (JSON-encoded) */
  payload: Uint8Array
  /** Transaction ID if part of a transaction */
  transactionId?: string
  /** Schema version at time of write */
  schemaVersion: number
  /** Unix timestamp when entry was created */
  createdAt: number
  /** Whether entry has been flushed to durable storage */
  flushed: boolean
  /** Checksum for integrity verification */
  checksum: string
}

/**
 * Transaction tracking for atomic operations
 */
export interface Transaction {
  /** Unique transaction ID */
  id: string
  /** Current transaction state */
  state: TransactionState
  /** Unix timestamp when transaction started */
  startedAt: number
  /** Unix timestamp when transaction ended (if applicable) */
  endedAt?: number
  /** Array of WAL entry LSNs in this transaction */
  operations: number[]
  /** Savepoints for partial rollback */
  savepoints: Savepoint[]
  /** Timeout in milliseconds (default: 30 seconds) */
  timeoutMs: number
}

/**
 * Savepoint for partial transaction rollback
 */
export interface Savepoint {
  /** Savepoint name */
  name: string
  /** WAL position at savepoint */
  lsn: number
  /** Index in transaction operations array */
  operationIndex: number
  /** Unix timestamp when savepoint was created */
  createdAt: number
}

/**
 * Configuration for the WAL system
 */
export interface WALConfig {
  /** Maximum WAL size in bytes before forced checkpoint (default: 10MB) */
  maxSizeBytes?: number
  /** Maximum entries before forced checkpoint (default: 1000) */
  maxEntries?: number
  /** Sync mode: 'sync' (fsync after each write), 'async' (batch fsync) */
  syncMode?: 'sync' | 'async'
  /** Async sync interval in milliseconds (default: 100ms) */
  asyncSyncIntervalMs?: number
  /** Transaction timeout in milliseconds (default: 30 seconds) */
  transactionTimeoutMs?: number
  /** Whether to verify checksums on read (default: true) */
  verifyChecksums?: boolean
  /** Enable WAL compression (default: false for performance) */
  compress?: boolean
}

/**
 * Result of WAL recovery operation
 */
export interface WALRecoveryResult {
  /** Number of entries recovered */
  entriesRecovered: number
  /** Number of transactions recovered */
  transactionsRecovered: number
  /** Number of transactions rolled back */
  transactionsRolledBack: number
  /** Last recovered LSN */
  lastLsn: number
  /** Whether recovery was complete */
  complete: boolean
  /** Any errors encountered */
  errors: WALRecoveryError[]
  /** Duration of recovery in milliseconds */
  durationMs: number
}

/**
 * Error during WAL recovery
 */
export interface WALRecoveryError {
  /** LSN where error occurred */
  lsn: number
  /** Error message */
  message: string
  /** Whether error was recoverable */
  recoverable: boolean
  /** Recovery action taken */
  action: 'skip' | 'rollback' | 'abort'
}

// ============================================================================
// R2 TIERED STORAGE TYPES
// ============================================================================

/**
 * Storage tier for data
 */
export type StorageTier = 'hot' | 'warm' | 'cold' | 'archive'

/**
 * Data location information
 */
export interface DataLocation {
  /** Storage tier */
  tier: StorageTier
  /** Path within tier (R2 key for warm/cold, table:id for hot) */
  path: string
  /** Size in bytes */
  sizeBytes: number
  /** Last access timestamp */
  lastAccessAt: number
  /** Access count */
  accessCount: number
}

/**
 * Configuration for tiered storage
 */
export interface TieredStorageConfig {
  /** Hot tier retention in milliseconds (default: 5 minutes) */
  hotRetentionMs?: number
  /** Warm tier retention before archival in milliseconds (default: 30 days) */
  warmRetentionMs?: number
  /** Access count threshold for keeping in hot tier (default: 10) */
  hotAccessThreshold?: number
  /** Whether to automatically promote frequently accessed cold data */
  autoPromote?: boolean
  /** Batch size for tier promotion/demotion operations */
  batchSize?: number
  /** R2 bucket for warm tier */
  warmBucket?: string
  /** R2 bucket for cold tier */
  coldBucket?: string
  /** Compression for cold tier (default: true) */
  compressCold?: boolean
}

/**
 * Result of tier promotion operation
 */
export interface TierPromotionResult {
  /** Items promoted */
  itemsPromoted: number
  /** Bytes transferred */
  bytesTransferred: number
  /** Source tier */
  fromTier: StorageTier
  /** Target tier */
  toTier: StorageTier
  /** Duration in milliseconds */
  durationMs: number
  /** Errors encountered */
  errors: string[]
}

/**
 * Result of tier demotion operation
 */
export interface TierDemotionResult {
  /** Items demoted */
  itemsDemoted: number
  /** Bytes transferred */
  bytesTransferred: number
  /** Source tier */
  fromTier: StorageTier
  /** Target tier */
  toTier: StorageTier
  /** Duration in milliseconds */
  durationMs: number
  /** R2 paths where data was stored */
  r2Paths: string[]
}

// ============================================================================
// CROSS-DO REPLICATION TYPES
// ============================================================================

/**
 * Replication role
 */
export type ReplicationRole = 'primary' | 'replica' | 'standalone'

/**
 * Replication status
 */
export type ReplicationStatus =
  | 'initializing'
  | 'syncing'
  | 'active'
  | 'stale'
  | 'disconnected'
  | 'error'
  | 'promoting'

/**
 * Replication mode
 */
export type ReplicationMode = 'sync' | 'async' | 'lazy'

/**
 * Replication state for a DO
 */
export interface ReplicationState {
  /** Current role */
  role: ReplicationRole
  /** Current status */
  status: ReplicationStatus
  /** Primary namespace (for replicas) */
  primaryNs?: string
  /** List of replica namespaces (for primary) */
  replicaNs?: string[]
  /** Last sync timestamp */
  lastSyncAt?: number
  /** Current replication lag (in LSN units) */
  lag: number
  /** Replication mode */
  mode: ReplicationMode
  /** Maximum acceptable lag before forcing sync */
  maxLag: number
  /** Sync interval in milliseconds */
  syncIntervalMs: number
  /** Unix timestamp when replication was established */
  establishedAt: number
}

/**
 * Configuration for replication
 */
export interface ReplicationConfig {
  /** Replication mode (default: 'async') */
  mode?: ReplicationMode
  /** Maximum acceptable lag (default: 100) */
  maxLag?: number
  /** Sync interval in milliseconds (default: 5000) */
  syncIntervalMs?: number
  /** Retry count for failed syncs (default: 3) */
  maxRetries?: number
  /** Retry delay in milliseconds (default: 1000) */
  retryDelayMs?: number
  /** Timeout for sync operations (default: 30000) */
  syncTimeoutMs?: number
  /** Enable compression for replication data (default: true) */
  compress?: boolean
  /** Geographic location hint for replica */
  locationHint?: string
}

/**
 * Result of replication sync operation
 */
export interface ReplicationSyncResult {
  /** Number of entries synced */
  entriesSynced: number
  /** Current lag after sync */
  lag: number
  /** Bytes transferred */
  bytesTransferred: number
  /** Duration in milliseconds */
  durationMs: number
  /** Any conflicts resolved */
  conflictsResolved: number
  /** New status */
  status: ReplicationStatus
}

/**
 * Conflict resolution strategies
 */
export type ConflictResolutionStrategy =
  | 'primary-wins'
  | 'replica-wins'
  | 'last-write-wins'
  | 'custom'

/**
 * Conflict information
 */
export interface ReplicationConflict {
  /** Record ID with conflict */
  recordId: string
  /** Table name */
  table: string
  /** Primary version */
  primaryVersion: number
  /** Replica version */
  replicaVersion: number
  /** Resolution strategy used */
  resolution: ConflictResolutionStrategy
  /** Resolved at timestamp */
  resolvedAt: number
}

// ============================================================================
// SCHEMA MIGRATION TYPES
// ============================================================================

/**
 * Migration direction
 */
export type MigrationDirection = 'up' | 'down'

/**
 * Migration status
 */
export type MigrationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'rolled_back'

/**
 * Schema migration definition
 */
export interface SchemaMigration {
  /** Migration version (monotonically increasing) */
  version: number
  /** Migration name/description */
  name: string
  /** Forward migration SQL or operations */
  up: MigrationOperation[]
  /** Rollback migration SQL or operations */
  down: MigrationOperation[]
  /** Unix timestamp when migration was created */
  createdAt: number
  /** Checksum for integrity */
  checksum: string
}

/**
 * A single migration operation
 */
export interface MigrationOperation {
  /** Operation type */
  type: 'sql' | 'transform' | 'custom'
  /** SQL statement for 'sql' type */
  sql?: string
  /** Table name for transforms */
  table?: string
  /** Transform function name for 'transform' type */
  transform?: string
  /** Parameters for operation */
  params?: Record<string, unknown>
}

/**
 * Applied migration record
 */
export interface AppliedMigration {
  /** Migration version */
  version: number
  /** Migration name */
  name: string
  /** Migration checksum */
  checksum: string
  /** Unix timestamp when applied */
  appliedAt: number
  /** Duration in milliseconds */
  durationMs: number
  /** Whether migration can be rolled back */
  reversible: boolean
}

/**
 * Migration result
 */
export interface MigrationResult {
  /** Migration version */
  version: number
  /** Direction executed */
  direction: MigrationDirection
  /** Status */
  status: MigrationStatus
  /** Duration in milliseconds */
  durationMs: number
  /** Error message if failed */
  error?: string
  /** Operations executed */
  operationsExecuted: number
  /** Rows affected */
  rowsAffected: number
}

/**
 * Configuration for migration runner
 */
export interface MigrationConfig {
  /** Auto-run pending migrations on startup (default: false) */
  autoMigrate?: boolean
  /** Create backup before migration (default: true) */
  backupBeforeMigration?: boolean
  /** Dry-run mode (default: false) */
  dryRun?: boolean
  /** Transaction mode: 'all' (single tx) or 'each' (per migration) */
  transactionMode?: 'all' | 'each'
  /** Lock timeout in milliseconds (default: 30000) */
  lockTimeoutMs?: number
}

// ============================================================================
// PERSISTENCE MANAGER TYPES
// ============================================================================

/**
 * Overall persistence state
 */
export interface PersistenceState {
  /** Current schema version */
  schemaVersion: number
  /** Last checkpoint */
  lastCheckpoint?: Checkpoint
  /** Last snapshot */
  lastSnapshot?: StateSnapshot
  /** Current WAL position (LSN) */
  walPosition: number
  /** WAL entry count since last checkpoint */
  walEntriesSinceCheckpoint: number
  /** Replication state */
  replication?: ReplicationState
  /** Tiered storage stats */
  tieredStorage?: {
    hotItems: number
    warmItems: number
    coldItems: number
    archiveItems: number
  }
  /** Applied migrations */
  appliedMigrations: number[]
  /** Pending migrations */
  pendingMigrations: number[]
}

/**
 * Persistence manager configuration
 */
export interface PersistenceConfig {
  /** Checkpoint configuration */
  checkpoint?: CheckpointConfig
  /** WAL configuration */
  wal?: WALConfig
  /** Tiered storage configuration */
  tieredStorage?: TieredStorageConfig
  /** Replication configuration */
  replication?: ReplicationConfig
  /** Migration configuration */
  migration?: MigrationConfig
}
