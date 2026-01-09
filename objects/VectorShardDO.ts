/**
 * VectorShardDO - Vector Index Shard for Similarity Search
 *
 * A Durable Object that stores and searches vectors for similarity.
 * Part of the distributed vector search architecture described in
 * docs/plans/unified-analytics-architecture.md.
 *
 * Key features:
 * - Loads vectors from R2 in Float32Array format
 * - Stores vectors efficiently in memory
 * - Computes cosine similarity and L2 distance
 * - Returns top-K results with scores using min-heap
 *
 * Memory efficiency:
 * - Uses typed arrays (Float32Array) for compact storage
 * - Batch distance computations for SIMD optimization
 * - Min-heap for O(n log k) top-K selection
 *
 * @example
 * ```typescript
 * // Load vectors from R2
 * await shard.loadFromR2('vectors/shard-0.vec')
 *
 * // Search for similar vectors
 * const results = await shard.search(queryVector, 10, 'cosine')
 *
 * // Get shard statistics
 * const stats = await shard.getStats()
 * console.log(`Loaded ${stats.vectorCount} vectors`)
 * ```
 *
 * @module objects/VectorShardDO
 */

import { DurableObject } from 'cloudflare:workers'
import type { CloudflareEnv } from '../types/CloudflareBindings'
import type {
  SearchResult,
  ShardStats,
  DistanceMetric,
  HeapEntry,
  VectorSearchRequest,
  VectorSearchResponse,
  LoadOptions,
  SaveOptions,
  BatchInsertRequest,
  BatchInsertResponse,
  BatchDeleteRequest,
  BatchDeleteResponse,
} from '../types/vector'

// ============================================================================
// CONSTANTS
// ============================================================================

/** Magic bytes for vector storage format */
const MAGIC_BYTES = new Uint8Array([0x56, 0x45, 0x43, 0x31]) // "VEC1"

/** Current format version */
const FORMAT_VERSION = 1

/** Header size in bytes */
const HEADER_SIZE = 32

// ============================================================================
// MIN-HEAP IMPLEMENTATION
// ============================================================================

/**
 * Min-heap for efficient top-K selection
 *
 * Uses a binary heap with the smallest element at the root.
 * For top-K selection, we maintain a max-heap of size K and
 * only keep elements with scores <= the max.
 */
class TopKHeap {
  private heap: HeapEntry[] = []
  readonly capacity: number

  constructor(k: number) {
    this.capacity = k
  }

  get size(): number {
    return this.heap.length
  }

  /**
   * Peek at the maximum score in the heap (root of max-heap)
   */
  peekMax(): number {
    return this.heap.length > 0 ? this.heap[0].score : -Infinity
  }

  /**
   * Try to add an entry to the heap
   * For cosine similarity, higher is better, so we use a min-heap
   * and evict the smallest when full
   */
  pushForMaximize(entry: HeapEntry): void {
    if (this.heap.length < this.capacity) {
      this.heap.push(entry)
      this.heapifyUpMin(this.heap.length - 1)
    } else if (entry.score > this.heap[0].score) {
      // Replace the minimum (worst result) with the new entry
      this.heap[0] = entry
      this.heapifyDownMin(0)
    }
  }

  /**
   * Try to add an entry to the heap
   * For L2 distance, lower is better, so we use a max-heap
   * and evict the largest when full
   */
  pushForMinimize(entry: HeapEntry): void {
    if (this.heap.length < this.capacity) {
      this.heap.push(entry)
      this.heapifyUpMax(this.heap.length - 1)
    } else if (entry.score < this.heap[0].score) {
      // Replace the maximum (worst result) with the new entry
      this.heap[0] = entry
      this.heapifyDownMax(0)
    }
  }

  /**
   * Get all entries sorted by score
   * @param ascending - Sort ascending (true for L2, false for cosine)
   */
  toSortedArray(ascending: boolean): HeapEntry[] {
    const sorted = [...this.heap]
    sorted.sort((a, b) => ascending ? a.score - b.score : b.score - a.score)
    return sorted
  }

  private heapifyUpMin(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (this.heap[parent].score <= this.heap[index].score) break
      this.swap(parent, index)
      index = parent
    }
  }

  private heapifyDownMin(index: number): void {
    const length = this.heap.length
    while (true) {
      const left = 2 * index + 1
      const right = 2 * index + 2
      let smallest = index

      if (left < length && this.heap[left].score < this.heap[smallest].score) {
        smallest = left
      }
      if (right < length && this.heap[right].score < this.heap[smallest].score) {
        smallest = right
      }

      if (smallest === index) break
      this.swap(smallest, index)
      index = smallest
    }
  }

  private heapifyUpMax(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (this.heap[parent].score >= this.heap[index].score) break
      this.swap(parent, index)
      index = parent
    }
  }

  private heapifyDownMax(index: number): void {
    const length = this.heap.length
    while (true) {
      const left = 2 * index + 1
      const right = 2 * index + 2
      let largest = index

      if (left < length && this.heap[left].score > this.heap[largest].score) {
        largest = left
      }
      if (right < length && this.heap[right].score > this.heap[largest].score) {
        largest = right
      }

      if (largest === index) break
      this.swap(largest, index)
      index = largest
    }
  }

  private swap(i: number, j: number): void {
    const temp = this.heap[i]
    this.heap[i] = this.heap[j]
    this.heap[j] = temp
  }
}

// ============================================================================
// VECTOR SHARD DURABLE OBJECT
// ============================================================================

/**
 * VectorShardDO - Durable Object for vector similarity search
 */
export class VectorShardDO extends DurableObject<CloudflareEnv> {
  static readonly $type = 'VectorShardDO'

  // Vector storage
  private vectors: Float32Array | null = null
  private ids: string[] = []
  private dimensions: number = 0
  private loaded: boolean = false
  private loadedAt: string | null = null

  // ID to index lookup for O(1) access
  private idToIndex: Map<string, number> = new Map()

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Load vectors from R2 storage
   *
   * @param path - Path to the vector file in R2
   * @throws Error if R2 binding not available or file not found
   */
  async loadFromR2(path: string): Promise<void> {
    const r2 = this.env.R2
    if (!r2) {
      throw new Error('R2 binding not available')
    }

    const obj = await r2.get(path)
    if (!obj) {
      throw new Error(`Vector file not found: ${path}`)
    }

    const buffer = await obj.arrayBuffer()
    await this.loadFromBuffer(buffer)

    // Persist the path for reloading
    await this.ctx.storage.put('vectorPath', path)
  }

  /**
   * Load vectors from an ArrayBuffer
   *
   * Expected format:
   * - Header (32 bytes): magic, version, count, dimensions
   * - IDs section: length-prefixed UTF-8 strings
   * - Vectors section: Float32Array data
   */
  async loadFromBuffer(buffer: ArrayBuffer): Promise<void> {
    const dataView = new DataView(buffer)

    // Validate magic bytes
    const magic = new Uint8Array(buffer, 0, 4)
    if (!this.compareMagic(magic, MAGIC_BYTES)) {
      throw new Error('Invalid vector file format: bad magic bytes')
    }

    // Read header
    const version = dataView.getUint32(4, true)
    if (version !== FORMAT_VERSION) {
      throw new Error(`Unsupported format version: ${version}`)
    }

    const count = dataView.getUint32(8, true)
    const dimensions = dataView.getUint32(12, true)

    // Read IDs
    let offset = HEADER_SIZE
    const ids: string[] = []
    const textDecoder = new TextDecoder()

    for (let i = 0; i < count; i++) {
      const idLength = dataView.getUint16(offset, true)
      offset += 2
      const idBytes = new Uint8Array(buffer, offset, idLength)
      ids.push(textDecoder.decode(idBytes))
      offset += idLength
    }

    // Align to 4-byte boundary for Float32Array
    if (offset % 4 !== 0) {
      offset += 4 - (offset % 4)
    }

    // Read vectors
    const vectorsBytes = count * dimensions * 4
    const vectors = new Float32Array(buffer, offset, count * dimensions)

    // Store in memory
    this.vectors = new Float32Array(vectors)
    this.ids = ids
    this.dimensions = dimensions
    this.loaded = true
    this.loadedAt = new Date().toISOString()

    // Build ID lookup map
    this.idToIndex.clear()
    for (let i = 0; i < ids.length; i++) {
      this.idToIndex.set(ids[i], i)
    }
  }

  /**
   * Save vectors to R2 storage
   *
   * @param path - Path to save the vector file in R2
   */
  async saveToR2(path: string): Promise<void> {
    const r2 = this.env.R2
    if (!r2) {
      throw new Error('R2 binding not available')
    }

    if (!this.loaded || !this.vectors) {
      throw new Error('No vectors loaded to save')
    }

    const buffer = this.serializeVectors()
    await r2.put(path, buffer)
  }

  /**
   * Search for similar vectors
   *
   * @param query - Query vector as Float32Array
   * @param k - Number of results to return
   * @param metric - Distance metric ('cosine' or 'l2')
   * @returns Array of search results sorted by similarity
   */
  async search(
    query: Float32Array,
    k: number,
    metric: DistanceMetric = 'cosine'
  ): Promise<SearchResult[]> {
    if (!this.loaded || !this.vectors) {
      throw new Error('Vectors not loaded. Call loadFromR2() first.')
    }

    if (query.length !== this.dimensions) {
      throw new Error(
        `Query dimension mismatch: expected ${this.dimensions}, got ${query.length}`
      )
    }

    const startTime = performance.now()
    const count = this.ids.length

    // Use appropriate heap based on metric
    const heap = new TopKHeap(k)
    const useMaximize = metric === 'cosine' // Higher is better for cosine

    // Compute distances for all vectors
    for (let i = 0; i < count; i++) {
      const vectorStart = i * this.dimensions
      const vector = this.vectors.subarray(
        vectorStart,
        vectorStart + this.dimensions
      )

      const score = metric === 'cosine'
        ? this.cosineSimilarity(query, vector)
        : this.l2Distance(query, vector)

      if (useMaximize) {
        heap.pushForMaximize({ id: this.ids[i], score })
      } else {
        heap.pushForMinimize({ id: this.ids[i], score })
      }
    }

    // Return sorted results
    // For cosine: descending (higher similarity first)
    // For L2: ascending (lower distance first)
    return heap.toSortedArray(!useMaximize)
  }

  /**
   * Extended search with full options
   */
  async searchExtended(request: VectorSearchRequest): Promise<VectorSearchResponse> {
    const startTime = performance.now()

    if (!this.loaded || !this.vectors) {
      throw new Error('Vectors not loaded. Call loadFromR2() first.')
    }

    const { query, k, metric = 'cosine', filter } = request

    if (query.length !== this.dimensions) {
      throw new Error(
        `Query dimension mismatch: expected ${this.dimensions}, got ${query.length}`
      )
    }

    const count = this.ids.length
    const heap = new TopKHeap(k)
    const useMaximize = metric === 'cosine'
    let vectorsScanned = 0

    for (let i = 0; i < count; i++) {
      const id = this.ids[i]

      // Apply filter if provided
      if (filter && !filter(id)) {
        continue
      }

      vectorsScanned++

      const vectorStart = i * this.dimensions
      const vector = this.vectors.subarray(
        vectorStart,
        vectorStart + this.dimensions
      )

      const score = metric === 'cosine'
        ? this.cosineSimilarity(query, vector)
        : this.l2Distance(query, vector)

      if (useMaximize) {
        heap.pushForMaximize({ id, score })
      } else {
        heap.pushForMinimize({ id, score })
      }
    }

    const searchTimeMs = performance.now() - startTime

    return {
      results: heap.toSortedArray(!useMaximize),
      vectorsScanned,
      searchTimeMs,
    }
  }

  /**
   * Get statistics about this shard
   */
  async getStats(): Promise<ShardStats> {
    const vectorCount = this.ids.length
    const memoryBytes = this.vectors
      ? this.vectors.byteLength + this.ids.reduce((sum, id) => sum + id.length * 2, 0)
      : 0

    return {
      vectorCount,
      dimensions: this.dimensions,
      memoryBytes,
      loaded: this.loaded,
      loadedAt: this.loadedAt ?? undefined,
    }
  }

  /**
   * Get a specific vector by ID
   */
  async getVector(id: string): Promise<Float32Array | null> {
    if (!this.loaded || !this.vectors) {
      return null
    }

    const index = this.idToIndex.get(id)
    if (index === undefined) {
      return null
    }

    const start = index * this.dimensions
    return this.vectors.slice(start, start + this.dimensions)
  }

  /**
   * Check if a vector exists
   */
  async hasVector(id: string): Promise<boolean> {
    return this.idToIndex.has(id)
  }

  /**
   * Add vectors in batch
   */
  async addVectors(request: BatchInsertRequest): Promise<BatchInsertResponse> {
    const { ids, vectors, dimensions } = request

    if (vectors.length !== ids.length * dimensions) {
      throw new Error('Vector array size mismatch')
    }

    // Initialize if first vectors
    if (!this.loaded) {
      this.vectors = new Float32Array(vectors)
      this.ids = [...ids]
      this.dimensions = dimensions
      this.loaded = true
      this.loadedAt = new Date().toISOString()

      for (let i = 0; i < ids.length; i++) {
        this.idToIndex.set(ids[i], i)
      }

      return { inserted: ids.length, failed: [] }
    }

    // Validate dimensions
    if (dimensions !== this.dimensions) {
      throw new Error(`Dimension mismatch: expected ${this.dimensions}, got ${dimensions}`)
    }

    // Check for duplicates and collect new vectors
    const inserted: string[] = []
    const failed: string[] = []
    const errors: Record<string, string> = {}

    for (let i = 0; i < ids.length; i++) {
      if (this.idToIndex.has(ids[i])) {
        failed.push(ids[i])
        errors[ids[i]] = 'Vector already exists'
      } else {
        inserted.push(ids[i])
      }
    }

    if (inserted.length > 0) {
      // Expand storage
      const newCount = this.ids.length + inserted.length
      const newVectors = new Float32Array(newCount * this.dimensions)
      newVectors.set(this.vectors!)

      let insertIndex = this.ids.length
      for (let i = 0; i < ids.length; i++) {
        if (!this.idToIndex.has(ids[i])) {
          const srcStart = i * dimensions
          const dstStart = insertIndex * this.dimensions
          newVectors.set(
            vectors.subarray(srcStart, srcStart + dimensions),
            dstStart
          )
          this.idToIndex.set(ids[i], insertIndex)
          this.ids.push(ids[i])
          insertIndex++
        }
      }

      this.vectors = newVectors
    }

    return {
      inserted: inserted.length,
      failed,
      errors: Object.keys(errors).length > 0 ? errors : undefined,
    }
  }

  /**
   * Delete vectors in batch
   */
  async deleteVectors(request: BatchDeleteRequest): Promise<BatchDeleteResponse> {
    if (!this.loaded || !this.vectors) {
      return { deleted: 0, notFound: request.ids }
    }

    const { ids } = request
    const toDelete = new Set<number>()
    const notFound: string[] = []

    for (const id of ids) {
      const index = this.idToIndex.get(id)
      if (index !== undefined) {
        toDelete.add(index)
        this.idToIndex.delete(id)
      } else {
        notFound.push(id)
      }
    }

    if (toDelete.size === 0) {
      return { deleted: 0, notFound }
    }

    // Rebuild arrays without deleted vectors
    const newCount = this.ids.length - toDelete.size
    const newVectors = new Float32Array(newCount * this.dimensions)
    const newIds: string[] = []

    let newIndex = 0
    for (let i = 0; i < this.ids.length; i++) {
      if (!toDelete.has(i)) {
        const srcStart = i * this.dimensions
        const dstStart = newIndex * this.dimensions
        newVectors.set(
          this.vectors.subarray(srcStart, srcStart + this.dimensions),
          dstStart
        )
        newIds.push(this.ids[i])
        this.idToIndex.set(this.ids[i], newIndex)
        newIndex++
      }
    }

    this.vectors = newVectors
    this.ids = newIds

    return { deleted: toDelete.size, notFound }
  }

  /**
   * Clear all vectors from memory
   */
  async clear(): Promise<void> {
    this.vectors = null
    this.ids = []
    this.dimensions = 0
    this.loaded = false
    this.loadedAt = null
    this.idToIndex.clear()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    try {
      switch (url.pathname) {
        case '/health':
          return Response.json({ status: 'ok', loaded: this.loaded })

        case '/stats':
          return Response.json(await this.getStats())

        case '/load':
          if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 })
          }
          const loadBody = await request.json() as { path: string }
          await this.loadFromR2(loadBody.path)
          return Response.json({ success: true, stats: await this.getStats() })

        case '/search':
          if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 })
          }
          const searchBody = await request.json() as {
            query: number[]
            k: number
            metric?: DistanceMetric
          }
          const query = new Float32Array(searchBody.query)
          const results = await this.search(
            query,
            searchBody.k,
            searchBody.metric
          )
          return Response.json({ results })

        case '/vectors':
          if (request.method === 'POST') {
            const insertBody = await request.json() as {
              ids: string[]
              vectors: number[]
              dimensions: number
            }
            const insertResult = await this.addVectors({
              ids: insertBody.ids,
              vectors: new Float32Array(insertBody.vectors),
              dimensions: insertBody.dimensions,
            })
            return Response.json(insertResult)
          }
          if (request.method === 'DELETE') {
            const deleteBody = await request.json() as { ids: string[] }
            const deleteResult = await this.deleteVectors(deleteBody)
            return Response.json(deleteResult)
          }
          return new Response('Method not allowed', { status: 405 })

        default:
          return new Response('Not Found', { status: 404 })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return Response.json({ error: message }, { status: 500 })
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Compute cosine similarity between two vectors
   * Returns value in range [-1, 1], higher is more similar
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB)
    if (denominator === 0) return 0

    return dotProduct / denominator
  }

  /**
   * Compute L2 (Euclidean) distance between two vectors
   * Returns value >= 0, lower is more similar
   */
  private l2Distance(a: Float32Array, b: Float32Array): number {
    let sum = 0

    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i]
      sum += diff * diff
    }

    return Math.sqrt(sum)
  }

  /**
   * Compare two byte arrays
   */
  private compareMagic(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false
    }
    return true
  }

  /**
   * Serialize vectors to ArrayBuffer for storage
   */
  private serializeVectors(): ArrayBuffer {
    if (!this.vectors) {
      throw new Error('No vectors to serialize')
    }

    const textEncoder = new TextEncoder()
    const encodedIds = this.ids.map(id => textEncoder.encode(id))

    // Calculate total size
    let idsSize = 0
    for (const encoded of encodedIds) {
      idsSize += 2 + encoded.length // 2 bytes for length + string bytes
    }

    // Align to 4-byte boundary
    const padding = (4 - ((HEADER_SIZE + idsSize) % 4)) % 4
    const vectorsSize = this.vectors.byteLength
    const totalSize = HEADER_SIZE + idsSize + padding + vectorsSize

    // Create buffer
    const buffer = new ArrayBuffer(totalSize)
    const dataView = new DataView(buffer)
    const uint8View = new Uint8Array(buffer)

    // Write header
    uint8View.set(MAGIC_BYTES, 0)
    dataView.setUint32(4, FORMAT_VERSION, true)
    dataView.setUint32(8, this.ids.length, true)
    dataView.setUint32(12, this.dimensions, true)

    // Write IDs
    let offset = HEADER_SIZE
    for (const encoded of encodedIds) {
      dataView.setUint16(offset, encoded.length, true)
      offset += 2
      uint8View.set(encoded, offset)
      offset += encoded.length
    }

    // Add padding
    offset += padding

    // Write vectors
    const vectorsView = new Float32Array(buffer, offset)
    vectorsView.set(this.vectors)

    return buffer
  }
}

export default VectorShardDO
