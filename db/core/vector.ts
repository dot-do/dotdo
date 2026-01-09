/**
 * VectorRouter - Tiered vector search routing
 *
 * Routes vector operations across multiple backends:
 * - Hot tier: libsql (SQLite F32_BLOB), edgevec (WASM HNSW)
 * - Warm tier: Cloudflare Vectorize
 * - Cold tier: ClickHouse ANN, Iceberg Parquet
 *
 * Strategies:
 * - cascade: Try hot first, fall back to colder tiers
 * - parallel: Query all tiers, merge results
 * - smart: Use query characteristics to pick best tier
 */
import type { VectorConfig, VectorTierConfig, VectorEngineType } from './types'
import { DEFAULT_VECTOR_CONFIG } from './types'

// ============================================================================
// TYPES
// ============================================================================

export interface VectorHit {
  id: string
  score: number
  vector?: number[]
  metadata: Record<string, unknown>
}

export interface SearchOptions {
  limit?: number
  filter?: Record<string, unknown>
  threshold?: number
  includeVectors?: boolean
  tier?: 'hot' | 'warm' | 'cold'
}

export interface VectorEngine {
  name: VectorEngineType
  dimensions: number
  metric: 'cosine' | 'euclidean' | 'dot'
  insert(id: string, vector: number[], metadata: Record<string, unknown>): Promise<void>
  search(vector: number[], options: SearchOptions): Promise<VectorHit[]>
  delete(id: string): Promise<boolean>
  count(): Promise<number>
}

export interface VectorEntry {
  id: string
  vector: number[]
  metadata: Record<string, unknown>
}

// ============================================================================
// MATH UTILITIES
// ============================================================================

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dotProd = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProd += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0

  return dotProd / denominator
}

/**
 * Calculate Euclidean distance between two vectors
 */
export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

/**
 * Calculate dot product of two vectors
 */
export function dotProduct(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i]
  }
  return sum
}

/**
 * Normalize a vector to unit length
 */
export function normalizeVector(v: number[]): number[] {
  const magnitude = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0))
  if (magnitude === 0) return v
  return v.map((x) => x / magnitude)
}

// ============================================================================
// IN-MEMORY ENGINE (for testing)
// ============================================================================

class InMemoryVectorEngine implements VectorEngine {
  name: VectorEngineType
  dimensions: number
  metric: 'cosine' | 'euclidean' | 'dot'
  private vectors: Map<string, VectorEntry> = new Map()

  constructor(config: VectorTierConfig) {
    this.name = config.engine
    this.dimensions = config.dimensions
    this.metric = config.metric ?? 'cosine'
  }

  async insert(id: string, vector: number[], metadata: Record<string, unknown>): Promise<void> {
    this.vectors.set(id, { id, vector, metadata })
  }

  async search(queryVector: number[], options: SearchOptions): Promise<VectorHit[]> {
    const results: VectorHit[] = []

    for (const [id, entry] of this.vectors) {
      let score: number
      switch (this.metric) {
        case 'euclidean':
          // Convert distance to similarity (smaller distance = higher score)
          score = 1 / (1 + euclideanDistance(queryVector, entry.vector))
          break
        case 'dot':
          score = dotProduct(queryVector, entry.vector)
          break
        case 'cosine':
        default:
          score = cosineSimilarity(queryVector, entry.vector)
      }

      // Apply filter if provided
      if (options.filter) {
        let matches = true
        for (const [key, value] of Object.entries(options.filter)) {
          if (entry.metadata[key] !== value) {
            matches = false
            break
          }
        }
        if (!matches) continue
      }

      results.push({
        id,
        score,
        vector: options.includeVectors ? entry.vector : undefined,
        metadata: entry.metadata,
      })
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score)

    // Apply limit
    const limit = options.limit ?? 10
    return results.slice(0, limit)
  }

  async delete(id: string): Promise<boolean> {
    return this.vectors.delete(id)
  }

  async count(): Promise<number> {
    return this.vectors.size
  }
}

// ============================================================================
// ENGINE FACTORY
// ============================================================================

/**
 * Create a vector engine based on config
 *
 * In production, this would create actual engine clients.
 * For testing, we return an in-memory engine.
 */
export function createVectorEngine(
  config: VectorTierConfig,
  _bindings: unknown
): VectorEngine {
  // In-memory implementation for all engines in this version
  // Production version would have real implementations
  return new InMemoryVectorEngine(config)
}

// ============================================================================
// VECTOR ROUTER
// ============================================================================

type TierName = 'hot' | 'warm' | 'cold'
const TIER_ORDER: TierName[] = ['hot', 'warm', 'cold']

export class VectorRouter {
  readonly config: VectorConfig
  private engines: Map<TierName, VectorEngine> = new Map()
  private bindings: unknown

  constructor(bindings: unknown, config?: Partial<VectorConfig>) {
    this.bindings = bindings
    this.config = {
      ...DEFAULT_VECTOR_CONFIG,
      ...config,
      tiers: {
        ...DEFAULT_VECTOR_CONFIG.tiers,
        ...config?.tiers,
      },
      routing: {
        ...DEFAULT_VECTOR_CONFIG.routing,
        ...config?.routing,
      },
    }

    // Initialize engines for configured tiers
    this._initializeEngines()
  }

  private _initializeEngines(): void {
    for (const tier of TIER_ORDER) {
      const tierConfig = this.config.tiers[tier]
      if (tierConfig) {
        const engine = createVectorEngine(tierConfig, this.bindings)
        this.engines.set(tier, engine)
      }
    }
  }

  /**
   * Check if an engine exists for a tier
   */
  hasEngine(tier: TierName): boolean {
    return this.engines.has(tier)
  }

  /**
   * Set engine for a tier (for testing)
   */
  _setEngine(tier: TierName, engine: VectorEngine): void {
    this.engines.set(tier, engine)
  }

  /**
   * Get the first available tier
   */
  private getFirstTier(): TierName | undefined {
    for (const tier of TIER_ORDER) {
      if (this.engines.has(tier)) {
        return tier
      }
    }
    return undefined
  }

  // ==========================================================================
  // INSERT OPERATIONS
  // ==========================================================================

  /**
   * Insert a vector into the specified tier (default: hot)
   */
  async insert(
    id: string,
    vector: number[],
    metadata: Record<string, unknown> = {},
    tier: TierName = 'hot'
  ): Promise<void> {
    const engine = this.engines.get(tier)
    if (!engine) {
      const firstTier = this.getFirstTier()
      if (!firstTier) throw new Error('No vector engines configured')
      const fallbackEngine = this.engines.get(firstTier)!
      await fallbackEngine.insert(id, vector, metadata)
      return
    }
    await engine.insert(id, vector, metadata)
  }

  /**
   * Batch insert multiple vectors
   */
  async insertBatch(
    entries: VectorEntry[],
    tier: TierName = 'hot'
  ): Promise<void> {
    for (const entry of entries) {
      await this.insert(entry.id, entry.vector, entry.metadata, tier)
    }
  }

  // ==========================================================================
  // SEARCH OPERATIONS
  // ==========================================================================

  /**
   * Search for similar vectors
   */
  async search(
    vector: number[],
    options: SearchOptions = {}
  ): Promise<VectorHit[]> {
    const { strategy } = this.config.routing

    switch (strategy) {
      case 'parallel':
        return this.searchParallel(vector, options)
      case 'smart':
        return this.searchSmart(vector, options)
      case 'cascade':
      default:
        return this.searchCascade(vector, options)
    }
  }

  /**
   * Cascade search: try hot first, fall back to colder tiers
   */
  private async searchCascade(
    vector: number[],
    options: SearchOptions
  ): Promise<VectorHit[]> {
    const { fallback } = this.config.routing

    // If specific tier requested, use it directly
    if (options.tier) {
      const engine = this.engines.get(options.tier)
      if (!engine) return []
      const results = await engine.search(vector, options)
      return this.applyThreshold(results, options.threshold)
    }

    // Try each tier in order
    for (const tier of TIER_ORDER) {
      const engine = this.engines.get(tier)
      if (!engine) continue

      const results = await engine.search(vector, options)
      const filtered = this.applyThreshold(results, options.threshold)

      if (filtered.length > 0 || !fallback) {
        return filtered
      }
    }

    return []
  }

  /**
   * Parallel search: query all tiers simultaneously, merge results
   */
  private async searchParallel(
    vector: number[],
    options: SearchOptions
  ): Promise<VectorHit[]> {
    const promises: Promise<VectorHit[]>[] = []

    for (const tier of TIER_ORDER) {
      const engine = this.engines.get(tier)
      if (engine) {
        promises.push(engine.search(vector, { ...options, limit: options.limit ?? 10 }))
      }
    }

    const allResults = await Promise.all(promises)

    // Merge and deduplicate
    const merged = new Map<string, VectorHit>()
    for (const results of allResults) {
      for (const hit of results) {
        const existing = merged.get(hit.id)
        if (!existing || hit.score > existing.score) {
          merged.set(hit.id, hit)
        }
      }
    }

    // Sort by score and apply limit
    const sorted = Array.from(merged.values()).sort((a, b) => b.score - a.score)
    const limited = sorted.slice(0, options.limit ?? 10)

    return this.applyThreshold(limited, options.threshold)
  }

  /**
   * Smart search: use query characteristics to pick best tier
   */
  private async searchSmart(
    vector: number[],
    options: SearchOptions
  ): Promise<VectorHit[]> {
    // If tier explicitly specified, use it
    if (options.tier) {
      const engine = this.engines.get(options.tier)
      if (!engine) return []
      const results = await engine.search(vector, options)
      return this.applyThreshold(results, options.threshold)
    }

    // For now, use cascade strategy for smart routing
    // In production, this would analyze query characteristics
    return this.searchCascade(vector, options)
  }

  /**
   * Apply score threshold to results
   */
  private applyThreshold(results: VectorHit[], threshold?: number): VectorHit[] {
    if (threshold === undefined) return results
    return results.filter((hit) => hit.score >= threshold)
  }

  // ==========================================================================
  // DELETE OPERATIONS
  // ==========================================================================

  /**
   * Delete a vector from hot tier
   */
  async delete(id: string, tier: TierName = 'hot'): Promise<boolean> {
    const engine = this.engines.get(tier)
    if (!engine) return false
    return engine.delete(id)
  }

  /**
   * Delete a vector from all tiers
   */
  async deleteFromAllTiers(id: string): Promise<void> {
    for (const tier of TIER_ORDER) {
      const engine = this.engines.get(tier)
      if (engine) {
        await engine.delete(id)
      }
    }
  }

  // ==========================================================================
  // TIER MANAGEMENT
  // ==========================================================================

  /**
   * Promote a vector from one tier to another (warmer → colder)
   */
  async promote(id: string, fromTier: TierName, toTier: TierName): Promise<void> {
    const fromEngine = this.engines.get(fromTier)
    const toEngine = this.engines.get(toTier)

    if (!fromEngine || !toEngine) {
      throw new Error(`Missing engine for tier: ${!fromEngine ? fromTier : toTier}`)
    }

    // Get vector from source tier
    const results = await fromEngine.search([], { filter: { id }, limit: 1 })
    if (results.length === 0) {
      throw new Error(`Vector ${id} not found in ${fromTier} tier`)
    }

    const { vector, metadata } = results[0] as VectorHit & { vector: number[] }
    if (!vector) {
      throw new Error(`Vector data not available for ${id}`)
    }

    // Insert into destination tier
    await toEngine.insert(id, vector, metadata)

    // Delete from source tier
    await fromEngine.delete(id)
  }

  /**
   * Demote a vector from one tier to another (alias for promote)
   */
  async demote(id: string, fromTier: TierName, toTier: TierName): Promise<void> {
    return this.promote(id, fromTier, toTier)
  }

  // ==========================================================================
  // COUNT OPERATIONS
  // ==========================================================================

  /**
   * Count vectors in a specific tier
   */
  async count(tier: TierName): Promise<number> {
    const engine = this.engines.get(tier)
    if (!engine) return 0
    return engine.count()
  }

  /**
   * Count vectors across all tiers
   */
  async countAll(): Promise<number> {
    let total = 0
    for (const tier of TIER_ORDER) {
      const engine = this.engines.get(tier)
      if (engine) {
        total += await engine.count()
      }
    }
    return total
  }

  // ==========================================================================
  // RETRIEVAL
  // ==========================================================================

  /**
   * Get a vector by ID (searches all tiers)
   */
  async getById(id: string): Promise<VectorHit | undefined> {
    for (const tier of TIER_ORDER) {
      const engine = this.engines.get(tier)
      if (!engine) continue

      // Use search with ID filter
      const results = await engine.search([], {
        filter: { id },
        limit: 1,
        includeVectors: true,
      })

      if (results.length > 0) {
        return results[0]
      }
    }

    return undefined
  }
}
