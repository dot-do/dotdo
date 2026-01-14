/**
 * Sync Primitives - Core building blocks for bidirectional data synchronization
 *
 * This module provides primitives for implementing Census/Hightouch-style
 * reverse ETL and bidirectional sync workflows.
 *
 * ## Components
 *
 * - **ConflictDetector**: Identifies conflicts in bidirectional sync scenarios
 * - **RateLimiter**: Rate limits requests to respect destination API limits
 * - **SyncStatus**: Tracks sync operation state and progress
 * - **FieldMapper**: Maps and transforms fields between source and destination schemas
 *
 * ## Usage Example
 *
 * ```typescript
 * import {
 *   ConflictDetector,
 *   createConflictDetector,
 *   RateLimiter,
 *   createRateLimiter,
 *   SyncStatus,
 *   createSyncStatus
 * } from '@dotdo/primitives/sync'
 *
 * // Conflict detection
 * const detector = createConflictDetector({
 *   defaultStrategy: 'last-write-wins'
 * })
 * const conflicts = detector.detect(sourceChanges, destChanges)
 *
 * // Rate limiting
 * const limiter = createRateLimiter({
 *   requestsPerSecond: 10,
 *   burstSize: 20
 * })
 * await limiter.acquire()
 * await callDestinationAPI()
 *
 * // Sync status tracking
 * const status = createSyncStatus({ planId: 'plan-123', totalRecords: 1000 })
 * status.on('progress', ({ percentage }) => console.log(`${percentage}%`))
 * status.start()
 * status.recordProcessed('added')
 * status.complete()
 * ```
 *
 * @module db/primitives/sync
 */

// =============================================================================
// CONFLICT DETECTION
// =============================================================================

export {
  ConflictDetector,
  createConflictDetector,
  type Conflict,
  type DiffRecord,
  type DiffResult,
  type ConflictResolutionStrategy,
  type FieldComparator,
  type ConflictDetectorOptions,
} from './conflict-detector'

// =============================================================================
// RATE LIMITING
// =============================================================================

export {
  RateLimiter,
  createRateLimiter,
  type RateLimitConfig,
} from './rate-limiter'

// =============================================================================
// SYNC STATUS & PROGRESS
// =============================================================================

export {
  SyncStatus,
  createSyncStatus,
  type SyncProgress,
  type SyncError,
  type SyncStatusState,
  type SyncStatusEvents,
  type SyncStatusOptions,
  type SyncStatusJSON,
  type ProcessedResultType,
  type BatchResult,
} from './sync-status'

// =============================================================================
// FIELD MAPPING
// =============================================================================

export {
  FieldMapper,
  createFieldMapper,
  type FieldMapping,
  type TransformFunction,
  type TransformPipeline,
  type BuiltInTransform,
  type CustomTransformFunction,
  type FieldMapperOptions,
  type MappingValidationError,
  type ValidationResult,
} from './field-mapper'

// =============================================================================
// ERROR HANDLING AND RETRIES
// =============================================================================

export {
  RetryExecutor,
  SyncErrorTracker,
  createRetryExecutor,
  createSyncErrorTracker,
  type RetryPolicy,
  type RetryError,
  type RetryResult,
  type FailedRecord,
  type TrackFailureInput,
  type FailedRecordFilter,
  type FailureSummary,
  type ExportedFailure,
  type RetryExecutorOptions,
  type ExecutionContext,
  type RetryBatchResult,
} from './retry-executor'

// =============================================================================
// HEARTBEAT, RECONNECTION, AND STATE SYNCHRONIZATION
// =============================================================================

export {
  createHeartbeatMonitor,
  createReconnectionManager,
  createStateSynchronizer,
  type HeartbeatMonitor,
  type HeartbeatConfig,
  type HeartbeatState,
  type PingEvent,
  type TimeoutEvent,
  type PongMessage,
  type ReconnectionManager,
  type ReconnectionConfig,
  type ReconnectionState,
  type AttemptEvent,
  type ExhaustedEvent,
  type StateSynchronizer,
  type SyncState,
  type PendingMutation,
  type StateSyncResult,
  type StateDiff,
  type SubscriptionEntry,
} from './heartbeat'
