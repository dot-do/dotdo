/**
 * Filtered Vector Search - HNSW with Metadata Filtering
 *
 * This module extends the HNSW index with metadata filtering capabilities,
 * enabling hybrid semantic + attribute search. It supports MongoDB-like
 * query operators for flexible metadata filtering.
 *
 * ## Use Cases
 *
 * - **Multi-tenant search**: Filter by `tenantId` to isolate results
 * - **Access control**: Filter by `visibility`, `permissions`
 * - **Category refinement**: Filter by `category`, `tags`, `type`
 * - **Time-based search**: Filter by `createdAt`, `expiresAt`
 * - **Price/rating filters**: Filter by numeric ranges
 *
 * ## Filter Modes
 *
 * - **Pre-filter**: Filter candidates before HNSW search (best for selective filters)
 * - **Post-filter**: Search first, then filter results (best for broad filters)
 * - **Auto**: Automatically chooses based on filter selectivity (default)
 *
 * ## Supported Operators
 *
 * | Operator    | Description                 | Example                        |
 * |-------------|-----------------------------|---------------------------------|
 * | `$eq`       | Equality                    | `{ status: { $eq: 'active' }}` |
 * | `$ne`       | Not equal                   | `{ status: { $ne: 'deleted' }}`|
 * | `$gt`       | Greater than                | `{ price: { $gt: 100 }}`       |
 * | `$gte`      | Greater than or equal       | `{ price: { $gte: 100 }}`      |
 * | `$lt`       | Less than                   | `{ price: { $lt: 500 }}`       |
 * | `$lte`      | Less than or equal          | `{ price: { $lte: 500 }}`      |
 * | `$in`       | Value in array              | `{ category: { $in: ['a','b']}}|
 * | `$nin`      | Value not in array          | `{ status: { $nin: ['x','y']}} |
 * | `$contains` | Array contains value        | `{ tags: { $contains: 'ai' }}` |
 * | `$exists`   | Field exists                | `{ thumbnail: { $exists: true }}`|
 * | `$and`      | Logical AND                 | `{ $and: [{...}, {...}] }`     |
 * | `$or`       | Logical OR                  | `{ $or: [{...}, {...}] }`      |
 * | `$not`      | Logical NOT                 | `{ $not: {...} }`              |
 *
 * @example Basic filtered search
 * ```typescript
 * import { createFilteredIndex } from 'db/edgevec/filtered-search'
 *
 * const index = createFilteredIndex({
 *   dimensions: 768,
 *   metric: 'cosine',
 *   M: 16,
 *   efConstruction: 200
 * })
 *
 * // Insert vectors with metadata
 * index.insert('doc-1', embedding1, { category: 'tech', price: 99 })
 * index.insert('doc-2', embedding2, { category: 'tech', price: 199 })
 * index.insert('doc-3', embedding3, { category: 'finance', price: 149 })
 *
 * // Search with metadata filter
 * const results = index.search(queryVector, {
 *   k: 10,
 *   filter: {
 *     category: 'tech',          // Shorthand for { $eq: 'tech' }
 *     price: { $lte: 150 }       // Price <= 150
 *   }
 * })
 * ```
 *
 * @example Complex filters with logical operators
 * ```typescript
 * // Find tech OR finance documents under $200
 * const results = index.search(queryVector, {
 *   k: 10,
 *   filter: {
 *     $and: [
 *       { $or: [
 *         { category: 'tech' },
 *         { category: 'finance' }
 *       ]},
 *       { price: { $lt: 200 }}
 *     ]
 *   }
 * })
 * ```
 *
 * @example Multi-tenant search
 * ```typescript
 * // Each tenant only sees their own data
 * const results = index.search(queryVector, {
 *   k: 10,
 *   filter: { tenantId: ctx.tenantId }
 * })
 * ```
 *
 * @example Persistence with metadata
 * ```typescript
 * // Serialize includes metadata
 * const buffer = index.serialize()
 * await env.R2.put('index.bin', buffer)
 *
 * // Deserialize restores metadata
 * const data = await env.R2.get('index.bin')
 * const loaded = FilteredHNSWIndexImpl.deserialize(await data.arrayBuffer())
 * ```
 *
 * @module db/edgevec/filtered-search
 */

import {
  createHNSWIndex,
  HNSWIndexImpl,
  type HNSWConfig,
  type HNSWIndex,
  type SearchResult,
  type SearchOptions,
} from './hnsw'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Filter operator types
 */
export type FilterOperator =
  | '$eq'
  | '$ne'
  | '$gt'
  | '$gte'
  | '$lt'
  | '$lte'
  | '$in'
  | '$nin'
  | '$contains'
  | '$exists'
  | '$and'
  | '$or'
  | '$not'

/**
 * Filter value can be a primitive or operator object
 */
export type FilterValue =
  | string
  | number
  | boolean
  | null
  | { [K in FilterOperator]?: unknown }

/**
 * Metadata filter structure
 */
export interface MetadataFilter {
  [key: string]: FilterValue | MetadataFilter[] | undefined
  $and?: MetadataFilter[]
  $or?: MetadataFilter[]
  $not?: MetadataFilter
}

/**
 * Search options with filtering
 */
export interface FilteredSearchOptions extends SearchOptions {
  /** Metadata filter */
  filter?: MetadataFilter
  /** Filter mode: 'pre' filters before search, 'post' filters after (default: auto) */
  filterMode?: 'pre' | 'post' | 'auto'
}

/**
 * Filtered HNSW Index interface
 */
export interface FilteredHNSWIndex extends HNSWIndex {
  /** Insert with metadata */
  insert(id: string, vector: Float32Array, metadata?: Record<string, unknown>): void

  /** Get metadata for a vector */
  getMetadata(id: string): Record<string, unknown> | undefined

  /** Update metadata for a vector */
  updateMetadata(id: string, metadata: Record<string, unknown>): void

  /** Patch (merge) metadata for a vector */
  patchMetadata(id: string, patch: Record<string, unknown>): void

  /** Search with optional metadata filter */
  search(query: Float32Array | number[], options?: FilteredSearchOptions): SearchResult[]
}

// ============================================================================
// FILTER EVALUATION
// ============================================================================

/**
 * Evaluate a filter against metadata
 */
function evaluateFilter(
  metadata: Record<string, unknown> | undefined,
  filter: MetadataFilter
): boolean {
  if (!metadata) return false

  // Handle compound operators
  if (filter.$and) {
    return filter.$and.every((f) => evaluateFilter(metadata, f))
  }

  if (filter.$or) {
    return filter.$or.some((f) => evaluateFilter(metadata, f))
  }

  if (filter.$not) {
    return !evaluateFilter(metadata, filter.$not)
  }

  // Handle field-level filters
  for (const [key, value] of Object.entries(filter)) {
    if (key.startsWith('$')) continue // Skip operators handled above

    const fieldValue = metadata[key]

    if (value === null || value === undefined) {
      if (fieldValue !== value) return false
      continue
    }

    // Direct value comparison (shorthand for $eq)
    if (typeof value !== 'object') {
      if (fieldValue !== value) return false
      continue
    }

    // Operator-based comparison
    const operators = value as { [K in FilterOperator]?: unknown }

    // $eq - equality
    if ('$eq' in operators) {
      if (fieldValue !== operators.$eq) return false
    }

    // $ne - not equal
    if ('$ne' in operators) {
      if (fieldValue === operators.$ne) return false
    }

    // $gt - greater than
    if ('$gt' in operators) {
      if (typeof fieldValue !== 'number' || fieldValue <= (operators.$gt as number)) {
        return false
      }
    }

    // $gte - greater than or equal
    if ('$gte' in operators) {
      if (typeof fieldValue !== 'number' || fieldValue < (operators.$gte as number)) {
        return false
      }
    }

    // $lt - less than
    if ('$lt' in operators) {
      if (typeof fieldValue !== 'number' || fieldValue >= (operators.$lt as number)) {
        return false
      }
    }

    // $lte - less than or equal
    if ('$lte' in operators) {
      if (typeof fieldValue !== 'number' || fieldValue > (operators.$lte as number)) {
        return false
      }
    }

    // $in - value in array
    if ('$in' in operators) {
      const arr = operators.$in as unknown[]
      if (!arr.includes(fieldValue)) return false
    }

    // $nin - value not in array
    if ('$nin' in operators) {
      const arr = operators.$nin as unknown[]
      if (arr.includes(fieldValue)) return false
    }

    // $contains - array contains value
    if ('$contains' in operators) {
      if (!Array.isArray(fieldValue) || !fieldValue.includes(operators.$contains)) {
        return false
      }
    }

    // $exists - field exists
    if ('$exists' in operators) {
      const shouldExist = operators.$exists as boolean
      const exists = fieldValue !== undefined
      if (shouldExist !== exists) return false
    }
  }

  return true
}

// ============================================================================
// FILTERED HNSW INDEX IMPLEMENTATION
// ============================================================================

export class FilteredHNSWIndexImpl implements FilteredHNSWIndex {
  private baseIndex: HNSWIndexImpl
  private metadata: Map<string, Record<string, unknown>> = new Map()

  constructor(config: HNSWConfig) {
    this.baseIndex = new HNSWIndexImpl(config)
  }

  // ============================================================================
  // METADATA OPERATIONS
  // ============================================================================

  insert(id: string, vector: Float32Array, metadata?: Record<string, unknown>): void {
    this.baseIndex.insert(id, vector)
    if (metadata) {
      this.metadata.set(id, { ...metadata })
    }
  }

  getMetadata(id: string): Record<string, unknown> | undefined {
    const meta = this.metadata.get(id)
    return meta ? { ...meta } : undefined
  }

  updateMetadata(id: string, metadata: Record<string, unknown>): void {
    if (!this.baseIndex.has(id)) {
      throw new Error(`Vector ${id} not found`)
    }
    this.metadata.set(id, { ...metadata })
  }

  patchMetadata(id: string, patch: Record<string, unknown>): void {
    if (!this.baseIndex.has(id)) {
      throw new Error(`Vector ${id} not found`)
    }
    const existing = this.metadata.get(id) ?? {}
    this.metadata.set(id, { ...existing, ...patch })
  }

  delete(id: string): boolean {
    const deleted = this.baseIndex.delete(id)
    if (deleted) {
      this.metadata.delete(id)
    }
    return deleted
  }

  // ============================================================================
  // SEARCH WITH FILTERING
  // ============================================================================

  search(query: Float32Array | number[], options?: FilteredSearchOptions): SearchResult[] {
    const k = options?.k ?? 10
    const filter = options?.filter
    const filterMode = options?.filterMode ?? 'auto'

    // No filter - use base search
    if (!filter) {
      return this.baseIndex.search(query, options)
    }

    // Determine filter mode
    const usePreFilter = filterMode === 'pre' || (filterMode === 'auto' && this.shouldPreFilter(filter))

    if (usePreFilter) {
      return this.preFilterSearch(query, k, filter, options)
    } else {
      return this.postFilterSearch(query, k, filter, options)
    }
  }

  /**
   * Heuristic to determine if pre-filtering is beneficial
   */
  private shouldPreFilter(filter: MetadataFilter): boolean {
    // For now, always use post-filter which is simpler
    // Pre-filter would require building a filtered candidate set first
    return false
  }

  /**
   * Pre-filter: Filter candidates first, then search among filtered
   */
  private preFilterSearch(
    query: Float32Array | number[],
    k: number,
    filter: MetadataFilter,
    options?: SearchOptions
  ): SearchResult[] {
    // Get all matching IDs
    const matchingIds: string[] = []
    for (const [id, meta] of this.metadata) {
      if (evaluateFilter(meta, filter)) {
        matchingIds.push(id)
      }
    }

    // Also include items without metadata if filter allows
    // (in case filter has no required fields)

    if (matchingIds.length === 0) {
      return []
    }

    // Search with higher ef to get more candidates
    const ef = Math.max(options?.ef ?? 40, k * 4)
    const candidates = this.baseIndex.search(query, { k: matchingIds.length, ef })

    // Filter to only matching IDs
    const matchingSet = new Set(matchingIds)
    const filtered = candidates.filter((r) => matchingSet.has(r.id))

    return filtered.slice(0, k)
  }

  /**
   * Post-filter: Search first, then filter results
   */
  private postFilterSearch(
    query: Float32Array | number[],
    k: number,
    filter: MetadataFilter,
    options?: SearchOptions
  ): SearchResult[] {
    // Request more results to account for filtering
    const overFetchMultiplier = 5
    const overFetchK = Math.min(k * overFetchMultiplier, this.baseIndex.size())
    const ef = Math.max(options?.ef ?? 40, overFetchK)

    const candidates = this.baseIndex.search(query, { k: overFetchK, ef })

    // Filter by metadata
    const filtered = candidates.filter((r) => {
      const meta = this.metadata.get(r.id)
      return evaluateFilter(meta, filter)
    })

    return filtered.slice(0, k)
  }

  // ============================================================================
  // DELEGATE TO BASE INDEX
  // ============================================================================

  size(): number {
    return this.baseIndex.size()
  }

  dimensions(): number {
    return this.baseIndex.dimensions()
  }

  has(id: string): boolean {
    return this.baseIndex.has(id)
  }

  config() {
    return this.baseIndex.config()
  }

  getNode(id: string) {
    return this.baseIndex.getNode(id)
  }

  getVector(id: string) {
    return this.baseIndex.getVector(id)
  }

  getEntryPoint() {
    return this.baseIndex.getEntryPoint()
  }

  getStats() {
    return this.baseIndex.getStats()
  }

  serialize(): ArrayBuffer {
    // Serialize both index and metadata
    const indexJson = this.baseIndex.toJSON()
    const metadataObj: Record<string, Record<string, unknown>> = {}
    for (const [id, meta] of this.metadata) {
      metadataObj[id] = meta
    }

    const combined = {
      index: indexJson,
      metadata: metadataObj,
    }

    const encoder = new TextEncoder()
    return encoder.encode(JSON.stringify(combined)).buffer as ArrayBuffer
  }

  static deserialize(buffer: ArrayBuffer): FilteredHNSWIndexImpl {
    const decoder = new TextDecoder()
    const json = JSON.parse(decoder.decode(buffer))

    const index = new FilteredHNSWIndexImpl({
      dimensions: json.index.config.dimensions,
      M: json.index.config.M,
      efConstruction: json.index.config.efConstruction,
      metric: json.index.config.metric,
    })

    // Restore base index
    index.baseIndex = HNSWIndexImpl.fromJSON(json.index)

    // Restore metadata
    for (const [id, meta] of Object.entries(json.metadata)) {
      index.metadata.set(id, meta as Record<string, unknown>)
    }

    return index
  }

  toJSON() {
    const indexJson = this.baseIndex.toJSON()
    const metadataObj: Record<string, Record<string, unknown>> = {}
    for (const [id, meta] of this.metadata) {
      metadataObj[id] = meta
    }

    return {
      ...indexJson,
      metadata: metadataObj,
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a filtered HNSW index
 */
export function createFilteredIndex(config: HNSWConfig): FilteredHNSWIndex {
  return new FilteredHNSWIndexImpl(config)
}
