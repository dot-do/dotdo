/**
 * @fileoverview Unified Storage Module - Cost-optimized DO storage using Pipeline-as-WAL
 *
 * This module provides a complete storage architecture for Durable Objects that
 * achieves 95%+ cost reduction through the Pipeline-as-WAL pattern.
 *
 * ## Components
 *
 * - **InMemoryStateManager**: O(1) reads/writes with dirty tracking and LRU eviction
 * - **PipelineEmitter**: Fire-and-forget event emission to Cloudflare Pipeline
 * - **LazyCheckpointer**: Batched SQLite persistence with columnar optimization
 * - **ColdStartRecovery**: State recovery from SQLite or Iceberg
 * - **UnifiedStoreDO**: Main DO class integrating all components
 * - **MetricsCollector**: Observability and metrics collection
 *
 * ## Key Invariant
 *
 * Pipeline is the WAL (Write-Ahead Log). Events are durable in Pipeline
 * BEFORE local SQLite persistence. This guarantees zero data loss while
 * enabling batched persistence for cost optimization.
 *
 * ## Usage
 *
 * ```typescript
 * import { UnifiedStoreDO, MetricsCollector } from './unified-storage'
 *
 * export class MyDO {
 *   private store: UnifiedStoreDO
 *
 *   constructor(state: DurableObjectState, env: Env) {
 *     this.store = new UnifiedStoreDO(state, env, {
 *       checkpointInterval: 5000,
 *     })
 *   }
 * }
 * ```
 *
 * @module objects/unified-storage
 * @see README.md for detailed documentation
 */

// InMemoryStateManager - O(1) reads/writes with dirty tracking
export {
  InMemoryStateManager,
  type ThingData,
  type CreateThingInput,
  type InMemoryStateManagerOptions,
  type StateManagerStats,
} from './in-memory-state-manager'

// PipelineEmitter - Fire-and-forget event emission
export {
  PipelineEmitter,
  type EventVerb,
  type EmitOptions,
  type EmittedEvent,
  type PipelineEmitterConfig,
  type ResolvedPipelineEmitterConfig,
  type Pipeline,
} from './pipeline-emitter'

// LazyCheckpointer - Lazy SQLite persistence
export {
  LazyCheckpointer,
  type DirtyTracker,
  type SqlStorage,
  type CheckpointTrigger,
  type CheckpointStats,
  type LazyCheckpointerStats,
  type LazyCheckpointerConfig,
  type LazyCheckpointerOptions,
} from './lazy-checkpointer'

// ColdStartRecovery - State recovery
export {
  ColdStartRecovery,
  type Thing,
  type DomainEvent,
  type RecoveryOptions,
  type RecoveryProgress,
  type RecoveryResult,
  type SqliteConnection,
  type IcebergReader,
  type ValidationResult,
} from './cold-start-recovery'

// UnifiedStoreDO - Main DO class
export { UnifiedStoreDO, type UnifiedStoreConfig } from './unified-store-do'

// Metrics - Observability and metrics collection
export {
  MetricsCollector,
  NoOpMetricsCollector,
  type Counter,
  type Gauge,
  type Histogram,
  type StateManagerMetrics,
  type PipelineEmitterMetrics,
  type CheckpointerMetrics,
  type RecoveryMetrics,
  type UnifiedStorageMetrics,
  type MetricsSnapshot,
  type MetricCheckpointTrigger,
  type MetricRecoverySource,
} from './metrics'

// WSProtocol - WebSocket message types and serialization
export {
  WSProtocol,
  type WSMessage,
  type CreateMessage,
  type ReadMessage,
  type UpdateMessage,
  type DeleteMessage,
  type BatchMessage,
  type SubscribeMessage,
  type UnsubscribeMessage,
  type AckResponse,
  type ReadResponse,
  type ErrorResponse,
  type SubscriptionUpdate,
  type MessageType,
  type ResponseType,
  type SubscriptionEventType,
  type ThingResponse,
  type SerializeOptions,
} from './ws-protocol'

// WSOperationRouter - Routes WebSocket messages to state manager operations
export {
  WSOperationRouter,
  type WSMessage as WSRouterMessage,
  type WSCreateMessage,
  type WSReadMessage,
  type WSUpdateMessage,
  type WSDeleteMessage,
  type WSBatchMessage,
  type WSAckResponse,
  type WSReadResponse,
  type WSErrorResponse,
  type WSBatchResponse,
  type WSBatchOperation,
  type WSBatchOperationResult,
  ErrorCodes,
} from './ws-operation-router'

// ShardAssigner - Partition key extraction and shard assignment
export {
  ShardAssigner,
  type ShardAssignerConfig,
  type ShardMetadata,
  type ShardUtilization,
  type RebalanceHint,
  type MigrationPlan,
  type HotShardOptions,
  type PartitionKeyStrategy,
  type ShardAssignerStats,
  type ThingData as ShardThingData,
} from './shard-assigner'

// CrossShardQuery - Query data across all shards via Iceberg
export {
  CrossShardQuery,
  type CrossShardQueryConfig,
  type GlobalQueryOptions,
  type GlobalQueryResult,
  type StreamQueryOptions,
  type AggregationOptions,
  type AggregationResult,
  type QueryStats,
  type IcebergReader,
  type Thing as CrossShardThing,
  type DomainEvent as CrossShardDomainEvent,
} from './cross-shard-query'

// ShardRouter - Routes requests to appropriate DO shards based on partition key
export {
  ShardRouter,
  ConsistentHashRing,
  RangeRouter,
  type DurableObjectId,
  type DurableObjectStub,
  type DurableObjectNamespace,
  type RangeDefinition,
  type GenericRange,
  type RetryConfig,
  type ShardInfo,
  type ShardRouterConfig,
  type ShardRouterMetrics,
  type AggregateOptions,
  type ConsistentHashRingConfig,
  type RangeRouterConfig,
} from './shard-router'

// ShardMigration - Handles shard topology changes with zero-downtime
export {
  ShardMigration,
  type ShardMigrationConfig,
  type MigrationPlan as ShardMigrationPlan,
  type MigrationProgress,
  type MigrationResult,
  type ShardInfo as MigrationShardInfo,
  type ShardStub,
  type ShardRouter as MigrationShardRouter,
  type IcebergReader as MigrationIcebergReader,
  type WriteBuffer,
  type PlanValidation,
  type ReplayOptions,
  type ReplayResult,
  type BalanceAnalysis,
  type RebalanceOptions,
  type AddShardOptions,
  type MigrationMetrics,
  type DomainEvent as MigrationDomainEvent,
  type Entity as MigrationEntity,
} from './shard-migration'

// ShardMetrics - Hot shard detection and metrics collection
export {
  ShardMetricsCollector,
  HotSpotDetector,
  createInstrumentedForward,
  type ShardMetrics as ShardMetricsData,
  type ShardMetricsSnapshot,
  type HotShardInfo,
  type DistributionScore,
  type HotSpotDetectorConfig,
  type RequestType,
  type OperationRecord,
  type HotSpotEvent,
  type HotSpotCallback,
  type ForwardFunction,
} from './shard-metrics'

// EventSubscriber - Subscribe to Pipeline events for replication
export {
  EventSubscriber,
  type ConsumedEvent,
  type CheckpointMode,
  type SubscriptionOptions,
  type CheckpointStore,
  type PipelineSource,
  type EventSubscriberConfig,
  type ResolvedEventSubscriberConfig,
  type IdempotencyStats,
  type ProcessingStats,
} from './event-subscriber'

// MultiMasterManager - Multi-master replication with eventual consistency
export {
  MultiMasterManager,
  VectorClock,
  type Entity,
  type WriteEvent,
  type RemoteEvent,
  type ConflictStrategy,
  type ConflictResult,
  type WriteResult,
  type ConflictInfo,
  type MultiMasterMetrics,
  type Pipeline as MultiMasterPipeline,
  type StateManager,
  type MergeFn,
  type MasterNode,
  type MultiMasterConfig,
} from './multi-master'

// LeaderFollowerManager - Leader-follower replication for read scaling and failover
export {
  LeaderFollowerManager,
  ReplicationRole,
  type ReplicationEvent,
  type LeaderChangeEvent,
  type WriteOperation,
  type WriteResult,
  type StateStore,
  type HeartbeatService,
  type LeaderFollowerConfig,
  type ResolvedLeaderFollowerConfig,
  type LeaderState,
  type FollowerInfo,
  type FollowerState,
  type ManagerMetrics,
} from './leader-follower'

// GeoRouter - Geo-aware routing for distributed replicas
export {
  GeoRouter,
  createGeoRouterForLeaderFollower,
  createGeoRouterForMultiMaster,
  type GeoInfo,
  type ReplicaInfo,
  type RoutingStrategy,
  type GeoRouterConfig,
  type ResolvedGeoRouterConfig,
  type GeoRoutingMetrics,
  type ReplicaHealth,
} from './geo-router'

// ConsistencyModes - Configurable strong/eventual consistency modes
export {
  ConsistencyController,
  ConsistencyLevel,
  calculateMajorityQuorum,
  isQuorumSatisfied,
  compareVectorClocks,
  type ConsistencyConfig,
  type ResolvedConsistencyConfig,
  type WriteOp,
  type WriteResult as ConsistencyWriteResult,
  type ReadResult as ConsistencyReadResult,
  type SessionState,
  type ReplicationStatus,
  type StateStore as ConsistencyStateStore,
  type ReplicationManager,
  type ConsistencyMetrics,
} from './consistency-modes'
