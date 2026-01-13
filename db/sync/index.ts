/**
 * Sync Module - Data synchronization primitives
 *
 * This module provides utilities for bidirectional data synchronization:
 * - BatchUpserter: Efficient batch upsert operations
 *
 * @module db/sync
 */

export {
  BatchUpserter,
  type SyncRecord,
  type BatchProgress,
  type BatchUpsertOptions,
  type UpsertResult,
  type RecordFailure,
  type Destination,
} from './batch-upserter'
