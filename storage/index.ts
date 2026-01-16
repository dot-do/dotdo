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
  type TierMetadata,
  type AccessStats,
  type TelemetryEmitter,
  type TelemetryEvent,
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
  type CrossTierVerification,
  type RepairResult,
  type TierHealth,
  type LatencyMetrics,
  type L0DataProvider,
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

// ============================================================================
// Unified StorageTier Interface
// ============================================================================

import type { ThingData } from './in-memory-state-manager'

/**
 * Unified StorageTier Interface
 *
 * All storage tiers (L0, L2, L3) implement this interface for consistent
 * polymorphic access to storage operations.
 */
export interface StorageTier {
  /**
   * Get a thing by ID
   */
  get(id: string): Promise<ThingData | null> | ThingData | null

  /**
   * Put a thing into storage
   */
  put(id: string, data: ThingData): Promise<void> | void

  /**
   * Delete a thing from storage
   */
  delete(id: string): Promise<boolean> | boolean

  /**
   * List things with optional prefix filtering
   */
  list(options?: { prefix?: string; limit?: number }): Promise<ThingData[]> | ThingData[]
}

/**
 * Storage tier statistics interface
 */
export interface StorageTierStats {
  entryCount: number
  estimatedBytes: number
}

/**
 * Symbol to mark classes that implement StorageTier
 * Used for runtime type checking
 */
export const StorageTierSymbol = Symbol.for('StorageTier')

/**
 * Runtime representation of StorageTier interface
 * Since TypeScript interfaces are erased at compile time, this object
 * provides runtime access to the interface definition for type checking.
 */
export const StorageTier = {
  /**
   * Required methods that all tiers must implement
   */
  requiredMethods: ['get', 'put', 'delete', 'list'] as const,

  /**
   * Check if an object implements the StorageTier interface
   */
  isStorageTier(obj: unknown): obj is StorageTierContract {
    if (!obj || typeof obj !== 'object') return false
    const record = obj as Record<string, unknown>
    return (
      typeof record.get === 'function' &&
      typeof record.put === 'function' &&
      typeof record.delete === 'function' &&
      typeof record.list === 'function'
    )
  },

  /**
   * Symbol for runtime identification
   */
  symbol: StorageTierSymbol,
}

/**
 * Contract type that matches the StorageTier interface
 * Used for runtime type checking
 */
type StorageTierContract = {
  get(id: string): Promise<ThingData | null> | ThingData | null
  put(id: string, data: ThingData): Promise<void> | void
  delete(id: string): Promise<boolean> | boolean
  list(options?: { prefix?: string; limit?: number }): Promise<ThingData[]> | ThingData[]
}
