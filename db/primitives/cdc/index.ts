/**
 * CDC - Change Data Capture primitive
 *
 * Provides Debezium-style change data capture for any data source:
 * - CDCStream: Core stream with checkpointing and exactly-once delivery
 * - Capture: Adapters for polling, logs, and event streams
 * - Transform: Field mapping, filtering, enrichment, aggregation
 * - Sink: Memory, webhook, queue, and file destinations
 *
 * @example Basic usage
 * ```typescript
 * import { createCDCStream, ChangeType } from 'dotdo/db/primitives/cdc'
 *
 * const stream = createCDCStream<User>({
 *   onChange: async (event) => {
 *     console.log(`${event.type}: ${event.after?.name}`)
 *   },
 * })
 *
 * await stream.start()
 * await stream.insert({ id: '1', name: 'John' })
 * await stream.update({ id: '1', name: 'John' }, { id: '1', name: 'Jane' })
 * await stream.stop()
 * ```
 *
 * @example With transformation pipeline
 * ```typescript
 * import {
 *   createCDCStream,
 *   createTransformPipeline,
 *   filter,
 *   map,
 *   createWebhookSink,
 * } from 'dotdo/db/primitives/cdc'
 *
 * const pipeline = createTransformPipeline<User, UserDTO>()
 *   .pipe(filter((e) => e.after?.active ?? false))
 *   .pipe(map((u) => ({ userId: u.id, fullName: u.name })))
 *
 * const sink = createWebhookSink<UserDTO>({
 *   url: 'https://api.example.com/webhook',
 *   batchSize: 10,
 * })
 *
 * const stream = createCDCStream<User>({
 *   transform: (e) => pipeline.transform(e),
 *   onChange: async (e) => sink.write(e),
 * })
 * ```
 *
 * @example Polling capture
 * ```typescript
 * import { createPollingCapture, createCDCStream } from 'dotdo/db/primitives/cdc'
 *
 * const capture = createPollingCapture<User>({
 *   source: {
 *     list: () => db.users.findAll(),
 *     getKey: (u) => u.id,
 *     getTimestamp: (u) => u.updatedAt,
 *   },
 *   pollIntervalMs: 5000,
 *   incremental: true,
 *   onChange: async (change) => {
 *     await stream.processChange(change)
 *   },
 * })
 *
 * await capture.start()
 * ```
 *
 * @module db/primitives/cdc
 */

// =============================================================================
// STREAM
// =============================================================================

export {
  // Class
  CDCStream,
  // Factory
  createCDCStream,
  // Enums
  ChangeType,
  // Types
  type ChangeEvent,
  type CDCPosition,
  type ChangeMetadata,
  type SchemaChangeEvent,
  type ChangeHandler,
  type BatchHandler,
  type SchemaChangeHandler,
  type DeadLetterHandler,
  type ChangeFilter,
  type MetadataEnricher,
  type ChangeOptions,
  type CDCStreamStats,
  type CDCCheckpointState,
  type CDCStreamOptions,
} from './stream'

// =============================================================================
// CAPTURE
// =============================================================================

export {
  // Polling capture
  PollingCapture,
  createPollingCapture,
  // Log capture
  LogCapture,
  createLogCapture,
  // Event capture
  EventCapture,
  createEventCapture,
  // Types
  type CapturedChange,
  type CaptureAdapter,
  type CaptureCheckpoint,
  type CaptureChangeHandler,
  type CaptureErrorHandler,
  type PollingDataSource,
  type PollingCaptureOptions,
  type LogParser,
  type LogCaptureOptions,
  type EventMapper,
  type EventCaptureOptions,
} from './capture'

// =============================================================================
// TRANSFORM
// =============================================================================

export {
  // Transform pipeline
  TransformPipeline,
  createTransformPipeline,
  // Built-in transformers
  map,
  filter,
  project,
  enrich,
  flatten,
  aggregate,
  debounce,
  // Types
  type Transformer,
  type PipelineStats,
  type MapFn,
  type FilterPredicate,
  type FieldPath,
  type ProjectionConfig,
  type EnrichFn,
  type EnrichOptions,
  type FlattenOptions,
  type AggregateOptions,
  type DebounceOptions,
} from './transform'

// =============================================================================
// SINK
// =============================================================================

export {
  // Memory sink
  MemorySink,
  createMemorySink,
  // Webhook sink
  WebhookSink,
  createWebhookSink,
  // Queue sink
  QueueSink,
  createQueueSink,
  // Multi sink
  MultiSink,
  createMultiSink,
  // File sink
  FileSink,
  createFileSink,
  // Types
  type Sink,
  type SinkResult,
  type SinkOptions,
  type MemorySinkOptions,
  type MemorySinkFilter,
  type WebhookSinkOptions,
  type QueueSinkOptions,
  type SinkRoute,
  type MultiSinkOptions,
  type FileFormat,
  type FileSinkOptions,
  type ParquetMetadata,
} from './sink'

// =============================================================================
// OFFSET TRACKER
// =============================================================================

export {
  // Class
  OffsetTracker,
  // Factory
  createOffsetTracker,
  // Types
  type Offset,
  type OffsetFormat,
  type OffsetValue,
  type PartitionOffset,
  type TrackedEvent,
  type CheckpointType,
  type CheckpointConfig,
  type CommitOptions,
  type DeduplicationRetention,
  type OffsetTrackerStats,
  type OffsetCheckpointState,
  type CheckpointId,
  type OffsetTrackerOptions,
} from './offset-tracker'

// =============================================================================
// CHANGE EVENT SCHEMA
// =============================================================================

export {
  // Enum
  ChangeOperation,
  // Zod Schema
  ChangeEventSchema,
  // Types (aliased to avoid conflict with stream types)
  type ChangeEvent as TypedChangeEvent,
  type ChangeEventMetadata as TypedChangeEventMetadata,
  type ChangeEventSchema as TypedChangeEventSchema,
  type SchemaField,
  type FieldType,
  type ValidationResult,
  type CreateChangeEventOptions,
  type EventFactoryOptions,
  // Validation
  validateChangeEvent,
  parseChangeEvent,
  isValidChangeEvent,
  // Serialization
  serializeChangeEvent,
  deserializeChangeEvent,
  // Factory functions
  createChangeEvent,
  createInsertEvent,
  createUpdateEvent,
  createDeleteEvent,
  // Schema embedding
  embedSchema,
  extractSchema,
  // Utilities
  getChangedFields,
} from './change-event'

// =============================================================================
// SNAPSHOT MANAGER
// =============================================================================

export {
  // Class
  SnapshotManager,
  // Factory
  createSnapshotManager,
  // Enum
  SnapshotPhase,
  // Types
  type SnapshotEvent,
  type TableScanner,
  type SnapshotState,
  type SnapshotProgress,
  type ChunkInfo,
  type CutoverInfo,
  type SnapshotStats,
  type SnapshotEventHandler,
  type ChunkCompleteHandler,
  type StateChangeHandler,
  type ProgressHandler,
  type ErrorHandler,
  type SnapshotOptions,
} from './snapshot-manager'

// =============================================================================
// WAL/BINLOG READER
// =============================================================================

export {
  // Interface and base types
  type WALReader,
  type WALEntry,
  type WALPosition,
  type WALReaderOptions,
  type WALReaderState,
  // Enums
  WALOperationType,
  // PostgreSQL
  PostgresWALReader,
  createPostgresWALReader,
  type PostgresWALReaderOptions,
  type PgOutputMessage,
  // MySQL
  MySQLBinlogReader,
  createMySQLBinlogReader,
  type MySQLBinlogReaderOptions,
  type BinlogEvent,
  type GTID,
  // SQLite
  SQLiteChangeCapture,
  createSQLiteChangeCapture,
  type SQLiteChangeCaptureOptions,
  type SQLiteChange,
  // Utilities
  parseWALPosition,
  compareWALPositions,
} from './wal-reader'

// =============================================================================
// SCHEMA EVOLUTION
// =============================================================================

export {
  // Classes
  SchemaEvolution,
  SchemaRegistry,
  SchemaTransformer,
  // Factory functions
  createSchemaEvolution,
  createSchemaRegistry,
  createSchemaTransformer,
  // Constants
  DDLEventTypes,
  CompatibilityModes,
  // Types
  type FieldType as SchemaFieldType,
  type SchemaField as EvolutionSchemaField,
  type SchemaVersion,
  type SchemaMigration,
  type DDLEventType,
  type DDLEvent,
  type SchemaChangeNotification,
  type SchemaCompatibility,
  type EvolutionResult,
  type TransformResult,
  type CompatibilityResult,
  type SchemaEvolutionOptions,
  type SchemaRegistryOptions,
  type SchemaTransformerOptions,
} from './schema-evolution'
