/**
 * Vector Context API for $.vector
 *
 * Provides a workflow context API for tiered vector search with support for:
 * - $.vector(config?) - Create or access VectorManager
 * - $.vector().insert(id, vector, metadata?, tier?) - Insert a vector
 * - $.vector().search(vector, options?) - Search for similar vectors
 * - $.vector().delete(id, tier?) - Delete a vector
 * - $.vector().count(tier?) - Count vectors in a tier
 * - $.vector().getById(id) - Get a vector by ID
 *
 * Manages vector operations across multiple backends:
 * - Hot tier: libsql (SQLite F32_BLOB), edgevec (WASM HNSW)
 * - Warm tier: Cloudflare Vectorize
 * - Cold tier: ClickHouse ANN, Iceberg Parquet
 *
 * Routing strategies:
 * - cascade: Try hot first, fall back to colder tiers
 * - parallel: Query all tiers, merge results
 * - smart: Use query characteristics to pick best tier
 *
 * @module workflows/context/vector
 */

import {
  VectorManager,
  cosineSimilarity,
  euclideanDistance,
  dotProduct,
  normalizeVector,
  type VectorHit,
  type SearchOptions,
  type VectorEngine,
  type VectorEntry,
} from '../../db/core/vector'
import {
  type VectorConfig,
  type VectorTierConfig,
  type VectorRoutingStrategy,
  type VectorEngineType,
  DEFAULT_VECTOR_CONFIG,
} from '../../db/core/types'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Tier names for vector storage
 */
export type VectorTier = 'hot' | 'warm' | 'cold'

/**
 * Configuration options for vector context
 */
export interface VectorContextConfig extends Partial<VectorConfig> {
  /** Optional bindings (for testing with mocks) */
  bindings?: unknown
}

/**
 * Batch insert entry
 */
export interface VectorBatchEntry {
  id: string
  vector: number[]
  metadata?: Record<string, unknown>
}

/**
 * Vector context instance returned by $.vector()
 */
export interface VectorContextInstance {
  /**
   * Get the VectorManager
   */
  manager(): VectorManager

  /**
   * Insert a vector into the specified tier (default: hot)
   * @param id - Unique identifier for the vector
   * @param vector - Vector data (array of numbers)
   * @param metadata - Optional metadata
   * @param tier - Target tier (default: hot)
   */
  insert(
    id: string,
    vector: number[],
    metadata?: Record<string, unknown>,
    tier?: VectorTier
  ): Promise<void>

  /**
   * Batch insert multiple vectors
   * @param entries - Array of vector entries
   * @param tier - Target tier (default: hot)
   */
  insertBatch(entries: VectorBatchEntry[], tier?: VectorTier): Promise<void>

  /**
   * Search for similar vectors
   * @param vector - Query vector
   * @param options - Search options (limit, filter, threshold, tier)
   */
  search(vector: number[], options?: SearchOptions): Promise<VectorHit[]>

  /**
   * Delete a vector from a specific tier
   * @param id - Vector ID
   * @param tier - Tier to delete from (default: hot)
   */
  delete(id: string, tier?: VectorTier): Promise<boolean>

  /**
   * Delete a vector from all tiers
   * @param id - Vector ID
   */
  deleteFromAllTiers(id: string): Promise<void>

  /**
   * Count vectors in a specific tier
   * @param tier - Tier to count
   */
  count(tier: VectorTier): Promise<number>

  /**
   * Count vectors across all tiers
   */
  countAll(): Promise<number>

  /**
   * Get a vector by ID (searches all tiers)
   * @param id - Vector ID
   */
  getById(id: string): Promise<VectorHit | undefined>

  /**
   * Promote a vector from one tier to another
   * @param id - Vector ID
   * @param fromTier - Source tier
   * @param toTier - Destination tier
   */
  promote(id: string, fromTier: VectorTier, toTier: VectorTier): Promise<void>

  /**
   * Demote a vector from one tier to another (alias for promote)
   * @param id - Vector ID
   * @param fromTier - Source tier
   * @param toTier - Destination tier
   */
  demote(id: string, fromTier: VectorTier, toTier: VectorTier): Promise<void>

  /**
   * Check if an engine exists for a tier
   * @param tier - Tier to check
   */
  hasEngine(tier: VectorTier): boolean

  /**
   * Get current configuration
   */
  config(): VectorConfig
}

/**
 * Internal storage for vector context state
 */
export interface VectorStorage {
  /** The VectorManager instance */
  manager: VectorManager | null
  /** Current configuration */
  config: VectorConfig | null
  /** Bindings for the manager */
  bindings: unknown
}

/**
 * Full context interface returned by createMockContext
 */
export interface VectorContext {
  vector: (config?: VectorContextConfig) => VectorContextInstance
  _storage: VectorStorage
  _setBindings: (bindings: unknown) => void
}

// ============================================================================
// CONTEXT FACTORY
// ============================================================================

/**
 * Creates a mock workflow context ($) with vector support for testing
 *
 * This factory creates a context object with:
 * - $.vector(config?) - Returns a VectorContextInstance
 * - $._storage - Internal storage for test setup
 * - $._setBindings - Set bindings for the manager
 *
 * @returns A VectorContext object with vector API methods
 *
 * @example Basic usage
 * ```typescript
 * const $ = createMockContext()
 *
 * // Configure vector search
 * const vec = $.vector({
 *   tiers: {
 *     hot: { engine: 'libsql', dimensions: 1536 },
 *     warm: { engine: 'vectorize', dimensions: 1536 }
 *   },
 *   routing: { strategy: 'cascade', fallback: true }
 * })
 *
 * // Insert vectors
 * await vec.insert('doc-1', embeddings, { title: 'My Doc' })
 *
 * // Search for similar
 * const results = await vec.search(queryEmbedding, {
 *   limit: 10,
 *   threshold: 0.7
 * })
 * ```
 */
export function createMockContext(): VectorContext {
  // Internal storage
  const storage: VectorStorage = {
    manager: null,
    config: null,
    bindings: null,
  }

  /**
   * Get or create VectorManager
   */
  function getOrCreateManager(config?: VectorContextConfig): VectorManager {
    if (!storage.manager || config) {
      // Merge config with defaults
      const vectorConfig: VectorConfig = {
        tiers: {
          ...DEFAULT_VECTOR_CONFIG.tiers,
          ...config?.tiers,
        },
        routing: {
          ...DEFAULT_VECTOR_CONFIG.routing,
          ...config?.routing,
        },
      }

      const bindings = config?.bindings ?? storage.bindings
      storage.manager = new VectorManager(bindings, vectorConfig)
      storage.config = vectorConfig
    }

    return storage.manager
  }

  /**
   * Create a VectorContextInstance
   */
  function createVectorInstance(config?: VectorContextConfig): VectorContextInstance {
    const manager = getOrCreateManager(config)

    return {
      manager(): VectorManager {
        return manager
      },

      async insert(
        id: string,
        vector: number[],
        metadata: Record<string, unknown> = {},
        tier: VectorTier = 'hot'
      ): Promise<void> {
        return manager.insert(id, vector, metadata, tier)
      },

      async insertBatch(entries: VectorBatchEntry[], tier: VectorTier = 'hot'): Promise<void> {
        const vectorEntries: VectorEntry[] = entries.map((e) => ({
          id: e.id,
          vector: e.vector,
          metadata: e.metadata ?? {},
        }))
        return manager.insertBatch(vectorEntries, tier)
      },

      async search(vector: number[], options?: SearchOptions): Promise<VectorHit[]> {
        return manager.search(vector, options)
      },

      async delete(id: string, tier: VectorTier = 'hot'): Promise<boolean> {
        return manager.delete(id, tier)
      },

      async deleteFromAllTiers(id: string): Promise<void> {
        return manager.deleteFromAllTiers(id)
      },

      async count(tier: VectorTier): Promise<number> {
        return manager.count(tier)
      },

      async countAll(): Promise<number> {
        return manager.countAll()
      },

      async getById(id: string): Promise<VectorHit | undefined> {
        return manager.getById(id)
      },

      async promote(id: string, fromTier: VectorTier, toTier: VectorTier): Promise<void> {
        return manager.promote(id, fromTier, toTier)
      },

      async demote(id: string, fromTier: VectorTier, toTier: VectorTier): Promise<void> {
        return manager.demote(id, fromTier, toTier)
      },

      hasEngine(tier: VectorTier): boolean {
        return manager.hasEngine(tier)
      },

      config(): VectorConfig {
        return manager.config
      },
    }
  }

  return {
    vector: createVectorInstance,
    _storage: storage,
    _setBindings(bindings: unknown): void {
      storage.bindings = bindings
    },
  }
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

// Re-export utility functions from vector module
export {
  cosineSimilarity,
  euclideanDistance,
  dotProduct,
  normalizeVector,
}

// Re-export types
export type {
  VectorConfig,
  VectorTierConfig,
  VectorRoutingStrategy,
  VectorEngineType,
  VectorHit,
  SearchOptions,
  VectorEngine,
  VectorEntry,
}
