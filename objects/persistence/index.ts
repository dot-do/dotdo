/**
 * DO State Persistence Layer
 *
 * A comprehensive persistence abstraction for Durable Objects, providing:
 *
 * - **Checkpoint Manager**: Full state snapshots and recovery points
 *   - Periodic checkpoints with configurable intervals
 *   - R2-backed snapshots with compression
 *   - Point-in-time recovery
 *
 * - **WAL Manager**: Write-ahead logging for crash recovery
 *   - ACID transactions with savepoints
 *   - Automatic crash recovery
 *   - Checksum verification
 *
 * - **Tiered Storage**: Hot/warm/cold data tiering
 *   - Automatic promotion/demotion based on access patterns
 *   - R2-backed cold storage with compression
 *   - Access statistics and analytics
 *
 * - **Replication Manager**: Cross-DO state replication
 *   - Primary/replica topology
 *   - Sync/async replication modes
 *   - Conflict resolution strategies
 *
 * - **Migration Runner**: Schema versioning and migrations
 *   - Forward and backward migrations
 *   - Safe rollback support
 *   - Custom transform functions
 *
 * @example
 * ```typescript
 * import {
 *   CheckpointManager,
 *   WALManager,
 *   TieredStorageManager,
 *   ReplicationManager,
 *   MigrationRunner,
 * } from '@dotdo/persistence'
 *
 * // In your Durable Object
 * export class MyDO extends DurableObject {
 *   private checkpoint: CheckpointManager
 *   private wal: WALManager
 *
 *   constructor(state: DurableObjectState, env: Env) {
 *     super(state, env)
 *
 *     this.checkpoint = new CheckpointManager(state.storage, env, 'my-do', {
 *       config: { createSnapshots: true, intervalMs: 300000 }
 *     })
 *
 *     this.wal = new WALManager(state.storage, {
 *       config: { syncMode: 'async' }
 *     })
 *   }
 * }
 * ```
 *
 * @module objects/persistence
 */

// Types
export type {
  // Checkpoint/Snapshot types
  StateSnapshot,
  Checkpoint,
  CheckpointConfig,

  // WAL types
  WALOperationType,
  TransactionState,
  WALEntry,
  Transaction,
  Savepoint,
  WALConfig,
  WALRecoveryResult,
  WALRecoveryError,

  // Tiered storage types
  StorageTier,
  DataLocation,
  TieredStorageConfig,
  TierPromotionResult,
  TierDemotionResult,

  // Replication types
  ReplicationRole,
  ReplicationStatus,
  ReplicationMode,
  ReplicationState,
  ReplicationConfig,
  ReplicationSyncResult,
  ConflictResolutionStrategy,
  ReplicationConflict,

  // Migration types
  MigrationDirection,
  MigrationStatus,
  SchemaMigration,
  MigrationOperation,
  AppliedMigration,
  MigrationResult,
  MigrationConfig,

  // Persistence state
  PersistenceState,
  PersistenceConfig,
} from './types'

// Checkpoint Manager
export {
  CheckpointManager,
  type CheckpointStorage,
  type R2BucketInterface as CheckpointR2Bucket,
  type CheckpointEnv,
  type TableDataExtractor,
} from './checkpoint-manager'

// WAL Manager
export {
  WALManager,
  type WALStorage,
  type WALBatchEntry,
} from './wal-manager'

// Tiered Storage Manager
export {
  TieredStorageManager,
  type TieredStorage,
  type R2BucketInterface,
  type TieredStorageEnv,
} from './tiered-storage-manager'

// Replication Manager
export {
  ReplicationManager,
  type DOStub,
  type ReplicationEnv,
} from './replication-manager'

// Migration Runner
export {
  MigrationRunner,
  type MigrationStorage,
  type TransformFunction,
} from './migration-runner'
