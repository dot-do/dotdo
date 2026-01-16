/**
 * Unified Storage - Cost-optimized storage pattern
 *
 * Pipeline-as-WAL architecture:
 * - InMemoryState for fast reads/writes
 * - Pipeline for durability (WAL)
 * - LazyCheckpointer for batched SQLite persistence
 *
 * @module @dotdo/workers/storage
 */

/**
 * Thing data structure
 */
export interface ThingData {
  $id: string
  $type: string
  $createdAt: string
  $updatedAt: string
  $version: number
  [key: string]: unknown
}

/**
 * Storage tier interface
 */
export interface StorageTier {
  get(id: string): Promise<ThingData | null> | ThingData | null
  put(id: string, data: ThingData): Promise<void> | void
  delete(id: string): Promise<boolean> | boolean
  list(options?: { prefix?: string; limit?: number }): Promise<ThingData[]> | ThingData[]
}

/**
 * Unified store configuration
 */
export interface UnifiedStoreConfig {
  namespace: string
  checkpointInterval?: number
  dirtyCountThreshold?: number
}

/**
 * Unified store statistics
 */
export interface UnifiedStoreStats {
  inMemoryCount: number
  dirtyCount: number
  lastCheckpoint: number
}

/**
 * Create a unified store
 *
 * @param state - DO state object
 * @param env - Environment bindings
 * @param config - Store configuration
 * @returns UnifiedStore instance
 */
export function createUnifiedStore(
  _state: unknown,
  _env: unknown,
  _config: UnifiedStoreConfig
): StorageTier & { getStats(): UnifiedStoreStats } {
  throw new Error('createUnifiedStore not implemented yet')
}
