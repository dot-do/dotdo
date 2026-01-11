/**
 * Primitives - Core building blocks for distributed data processing
 *
 * This module exports all primitives organized by category:
 * - Stores: Time-aware and columnar storage
 * - Streaming: Windowing, watermarks, and exactly-once processing
 * - Routing: Partition-aware key routing
 * - Schema: Dynamic schema evolution
 * - Utilities: Hash functions and other helpers
 *
 * @module db/primitives
 */

// =============================================================================
// STORES
// =============================================================================

// Temporal Store - Time-aware key-value storage with versioning and snapshots
export {
  createTemporalStore,
  type TemporalStore,
  type TemporalStoreOptions,
  type SnapshotId,
  type SnapshotInfo,
  type TimeRange,
  type PutOptions,
  type Duration as TemporalDuration,
  type RetentionPolicy,
  type PruneStats,
} from './temporal-store'

// Typed Column Store - Columnar storage with compression codecs
export {
  createColumnStore,
  type TypedColumnStore,
  type ColumnType,
  type ComparisonOp,
  type Predicate,
  type AggregateFunction,
  type ColumnBatch,
  type BloomFilter,
} from './typed-column-store'

// =============================================================================
// STREAMING
// =============================================================================

// Window Manager - Stream windowing (tumbling, sliding, session, global)
export {
  WindowManager,
  type WindowAssigner,
  type WindowAssignerType,
  type Window,
  type WindowState,
  type LateDataHandler,
  type Duration as WindowDuration,
  // Duration helpers
  hours,
  minutes,
  seconds,
  milliseconds,
  // Trigger types
  TriggerResult,
  Trigger,
  EventTimeTrigger,
  CountTrigger,
  ProcessingTimeTrigger,
  PurgingTrigger,
} from './window-manager'

// Watermark Service - Event-time progress tracking
export {
  createWatermarkService,
  WatermarkService,
  type WatermarkServiceInterface,
  type Duration as WatermarkDuration,
  type Unsubscribe,
} from './watermark-service'

// Exactly-Once Context - Transactional processing with deduplication
export {
  createExactlyOnceContext,
  ExactlyOnceContext,
  type ExactlyOnceContextInterface,
  type ExactlyOnceContextOptions,
  type CheckpointBarrier,
  type CheckpointState,
  type Transaction,
} from './exactly-once-context'

// =============================================================================
// ROUTING
// =============================================================================

// Keyed Router - Partition-aware routing for distributed processing
export {
  createKeyedRouter,
  type KeyedRouter,
  type KeyedRouterOptions,
  KeyedRouterImpl,
} from './keyed-router'

// =============================================================================
// SCHEMA
// =============================================================================

// Schema Evolution - Dynamic schema management
export {
  createSchemaEvolution,
  createEmptySchema,
  fieldTypesEqual,
  canWiden,
  fieldTypeToString,
  type SchemaEvolution,
  type SchemaEvolutionOptions,
  type Schema,
  type SchemaDiff,
  type CompatibilityResult,
  type SchemaVersion,
  type HistoryRetentionPolicy,
  type HistoryPruneStats,
  type FieldType,
  type PrimitiveFieldType,
  type ArrayFieldType,
  type MapFieldType,
  type StructFieldType,
  type Duration as SchemaDuration,
} from './schema-evolution'

// =============================================================================
// UTILITIES
// =============================================================================

// MurmurHash3 - Fast non-cryptographic hash function
export { murmurHash3, murmurHash3_32 } from './utils/murmur3'
