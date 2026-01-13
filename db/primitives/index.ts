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
  type CodecType,
  type DataCharacteristics,
  type CodecStats,
  type StringEncodingType,
  type ColumnConfig,
  type ColumnMetadata,
} from './typed-column-store'

// Dictionary Codec - Efficient string column encoding for analytics
export {
  createDictionaryCodec,
  type DictionaryCodec,
  type DictionaryEncodeResult,
  type DictionaryMergeResult,
  type DictionaryEncodedColumn,
  type EncodedIndices,
} from './dictionary-codec'

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
// STATE MANAGEMENT
// =============================================================================

// StatefulOperator - Flink-style stream state management
export {
  // Core types
  type StateBackend,
  type StateSnapshot,
  type StateDescriptor,
  type StateTTLConfig,
  type StateAccess,
  type StateEntry,
  type StateSerializer,
  // InMemory backend
  InMemoryStateBackend,
  // KeyedState
  type KeyedState,
  type Partitioner,
  HashPartitioner,
  RangePartitioner,
  createKeyedState,
  // WindowState (renamed to avoid conflict with window-manager)
  type WindowState as StatefulWindowState,
  type WindowKey,
  type WindowAssigner as StatefulWindowAssigner,
  TumblingWindowAssigner as StatefulTumblingWindowAssigner,
  SlidingWindowAssigner as StatefulSlidingWindowAssigner,
  SessionWindowAssigner as StatefulSessionWindowAssigner,
  createWindowState,
  // CheckpointBarrier (renamed to avoid conflict with exactly-once-context)
  type CheckpointBarrier as StatefulCheckpointBarrier,
  type CheckpointOptions as StatefulCheckpointOptions,
  type CheckpointResult,
  type CheckpointSource,
  type CheckpointSink,
  type CheckpointCoordinatorConfig,
  BarrierAligner,
  CheckpointCoordinator,
  // TTL
  type TTLPolicy,
  type CleanupStrategy,
  type CleanupResult,
  type AlarmScheduler,
  TTLStateWrapper,
  // Recovery
  type CheckpointMetadata,
  type CheckpointStore,
  type StatefulOperator,
  StateRecoveryManager,
  // Metrics
  type StateMetrics,
  type MetricsRegistry,
  type Counter as StateCounter,
  type Gauge as StateGauge,
  type Histogram as StateHistogram,
  MetricsStateWrapper,
  createStateMetrics,
} from './stateful-operator'

// =============================================================================
// ORCHESTRATION
// =============================================================================

// DAGScheduler - Workflow orchestration with dependency resolution
export {
  // Core types
  type TaskNode,
  type TaskNodeOptions,
  type DAG,
  type DAGOptions,
  type DAGRun,
  type TaskResult,
  type TaskStatus,
  type DAGRunStatus,
  type TaskContext,
  // Dependency resolution
  type DependencyResolver,
  createDependencyResolver,
  // Factories
  createTaskNode,
  createDAG,
  dag,
  task,
  // Parallel execution
  type ParallelExecutor,
  type ExecutorOptions,
  createParallelExecutor,
  // Retry policies
  type RetryPolicy,
  type RetryPolicyInstance,
  type BackoffStrategy,
  type FixedBackoff,
  type ExponentialBackoff,
  type ExponentialJitterBackoff,
  type CustomBackoff,
  createRetryPolicy,
  // State persistence
  type DAGStateStore,
  type DAGRunState,
  type ListRunsOptions,
  createInMemoryStateStore,
  // Cron triggers
  type CronTrigger,
  type CronTriggerOptions,
  type ParsedCron,
  type ScheduleTrigger,
  type CronScheduleTrigger,
  type IntervalScheduleTrigger,
  type EventScheduleTrigger,
  createCronTrigger,
  parseCronExpression,
  // Dynamic tasks
  type DynamicTaskGenerator,
  // Cross-DAG dependencies
  type ExternalDependency,
  type DAGTrigger,
  type Sensor,
  type SensorOptions,
  createSensor,
  // Cross-DAG orchestration
  type Dataset,
  type DatasetEventType,
  type DatasetEvent,
  type DatasetTrigger,
  type CrossDAGState,
  type DAGRegistry,
  type DAGOrchestrator,
  type ExternalDAGSensor,
  type ExternalDAGSensorOptions,
  type DAGOrchestratorOptions,
  type DatasetAwareState,
  createExternalDAGSensor,
  createCrossDAGState,
  createDAGRegistry,
  validateDAGDependencies,
  createDAGOrchestrator,
  createDatasetAwareState,
  createExternalDAGTask,
  createDatasetSensorTask,
  // DAG Schedule Manager
  type DAGScheduleManager,
  type DAGScheduleManagerConfig,
  type ScheduledDAG,
  type RegisterOptions as DAGRegisterOptions,
  type ScheduledRunResult,
  type ScheduledRunEvent,
  type DAGScheduleBuilder,
  type DAGScheduleTimeProxy,
  type DAGScheduleEveryProxy,
  createDAGScheduleManager,
  createDAGScheduleEveryProxy,
} from './dag-scheduler'

// =============================================================================
// UTILITIES
// =============================================================================

// MurmurHash3 - Fast non-cryptographic hash function
export { murmurHash3, murmurHash3_32 } from './utils/murmur3'

// =============================================================================
// DOCUMENT STORE
// =============================================================================

// DocumentStore - MongoDB-like document storage primitive
export {
  createDocumentStore,
  type DocumentStore,
  type Document,
  type DocumentId,
  type DocumentStoreOptions,
  type DocumentStoreSession,
  type QueryFilter,
  type FindOptions,
  type UpdateOperators,
  type UpdateResult,
  type DeleteResult,
  type InsertResult,
  type InsertManyResult,
  type IndexSpec,
  type IndexOptions,
  type IndexInfo,
  type AggregationStage,
} from './document-store'

// =============================================================================
// SYNC
// =============================================================================

// Sync Primitives - Bidirectional data synchronization
export {
  ConflictDetector,
  createConflictDetector,
  type Conflict,
  type DiffRecord,
  type DiffResult,
  type ConflictResolutionStrategy,
  type FieldComparator,
  type ConflictDetectorOptions,
} from './sync'

// =============================================================================
// CACHE
// =============================================================================

// MultiTierCache - L1/L2/L3 hierarchical caching
export {
  createMultiTierCache,
  InMemoryL2Storage,
  MultiTierCacheMetrics,
  type MultiTierCache,
  type MultiTierCacheOptions,
  type CacheEntry,
  type CacheGetOptions,
  type CacheSetOptions,
  type CacheDeleteOptions,
  type CacheStats,
  type CacheLoader,
  type L2Storage,
  type WriteStrategy,
  type EvictionPolicy,
} from './multi-tier-cache'

// HashStore - Redis-like hash operations
export {
  createHashStore,
  HashStoreMetrics,
  type HashStore,
  type HashStoreOptions,
  type HSetOptions,
  type ScanOptions as HashScanOptions,
} from './hash-store'

// ListStore - Redis-like list operations
export {
  createListStore,
  type ListStore,
  type ListStoreOptions,
  type ListPosition,
  type ListDirection,
  type LPosOptions,
  type BlockingPopResult,
  type LMPopResult,
  type BlockingOptions,
  type PushOptions,
} from './list-store'

// SortedSetStore - Redis-like sorted set operations
export {
  createSortedSetStore,
  type SortedSetStore,
  type SortedSetStoreOptions,
  type ScoredMember,
  type ZAddOptions,
  type ZRangeByScoreOptions,
  type ZRangeOptions,
} from './sorted-set-store'

// PubSubBroker - Redis-like pub/sub messaging
export {
  createPubSubBroker,
  type PubSubBroker,
  type PubSubOptions,
  type PubSubMessage,
  type SubscriptionHandle,
  type ChannelStats,
} from './pubsub-broker'
