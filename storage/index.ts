/**
 * DOStorage 4-Layer Storage Stack
 *
 * L0: InMemoryStateManager - Fast O(1) CRUD with dirty tracking and LRU eviction
 * L1: PipelineEmitter (WAL) - Fire-and-forget event emission for durability
 * L2: LazyCheckpointer (SQLite) - Batched lazy persistence to SQLite
 * L3: IcebergWriter (Cold Storage) - Long-term storage in R2 with time travel
 *
 * Write Path: Client -> L0 (memory) -> L1 (WAL ACK) -> lazy L2 -> eventual L3
 * Read Path: L0 (hit?) -> L2 (hit?) -> L3 (restore)
 */

// L0: InMemoryStateManager
export {
  InMemoryStateManager,
  type ThingData,
  type CreateThingInput,
  type InMemoryStateManagerOptions,
  type StateManagerStats,
} from './in-memory-state-manager'

// L1: PipelineEmitter (WAL)
export {
  PipelineEmitter,
  type PipelineEmitterConfig,
  type EmittedEvent,
} from './pipeline-emitter'

// L2: LazyCheckpointer (SQLite)
export {
  LazyCheckpointer,
  type LazyCheckpointerOptions,
  type CheckpointStats,
  type DirtyTracker,
} from './lazy-checkpointer'

// L3: IcebergWriter (Cold Storage)
export {
  IcebergWriter,
  type IcebergWriterConfig,
  type IcebergPartition,
  type TimeTravelQuery,
} from './iceberg-writer'

// Cold Start Recovery
export {
  ColdStartRecovery,
  type RecoveryResult,
  type RecoveryOptions,
} from './cold-start-recovery'

// Integrated DOStorage
export {
  DOStorage,
  type DOStorageConfig,
} from './do-storage'
