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
