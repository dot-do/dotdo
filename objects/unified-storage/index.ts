/**
 * Unified Storage Module
 *
 * Exports all unified storage components for the Durable Object architecture:
 * - InMemoryStateManager: Fast in-memory state with dirty tracking
 * - PipelineEmitter: Fire-and-forget event emission to Pipeline
 * - LazyCheckpointer: Lazy SQLite persistence with columnar optimization
 * - ColdStartRecovery: State recovery from SQLite or Iceberg
 * - UnifiedStoreDO: Main DO class integrating all components
 *
 * @module objects/unified-storage
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
