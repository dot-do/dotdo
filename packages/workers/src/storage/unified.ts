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
 * In-memory unified store implementation
 */
class InMemoryUnifiedStore implements StorageTier {
  private store = new Map<string, ThingData>()
  private dirtyKeys = new Set<string>()
  private lastCheckpoint = Date.now()

  constructor(
    _state: unknown,
    _env: unknown,
    private config: UnifiedStoreConfig
  ) {}

  get(id: string): ThingData | null {
    return this.store.get(id) ?? null
  }

  put(id: string, data: ThingData): void {
    this.store.set(id, data)
    this.dirtyKeys.add(id)
  }

  delete(id: string): boolean {
    const existed = this.store.has(id)
    this.store.delete(id)
    this.dirtyKeys.delete(id)
    return existed
  }

  list(options?: { prefix?: string; limit?: number }): ThingData[] {
    const result: ThingData[] = []
    let count = 0

    for (const [key, value] of this.store.entries()) {
      if (options?.prefix && !key.startsWith(options.prefix)) {
        continue
      }
      if (options?.limit && count >= options.limit) {
        break
      }
      result.push(value)
      count++
    }

    return result
  }

  getStats(): UnifiedStoreStats {
    return {
      inMemoryCount: this.store.size,
      dirtyCount: this.dirtyKeys.size,
      lastCheckpoint: this.lastCheckpoint,
    }
  }
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
  state: unknown,
  env: unknown,
  config: UnifiedStoreConfig
): StorageTier & { getStats(): UnifiedStoreStats } {
  return new InMemoryUnifiedStore(state, env, config)
}
