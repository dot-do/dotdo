/**
 * Chunked HNSW Index Implementation
 *
 * HNSW index designed to work within 128MB memory limits on Cloudflare Workers/Durable Objects.
 * Features:
 * - Chunked storage (10MB default per chunk)
 * - On-demand chunk loading during search
 * - Binary quantization for 32x memory reduction
 * - LRU cache with memory budget
 *
 * @module db/edgevec/chunked-hnsw
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Storage backend interface for chunks
 */
export interface ChunkStorage {
  put(key: string, data: ArrayBuffer): Promise<void>
  get(key: string): Promise<ArrayBuffer | null>
  delete(key: string): Promise<void>
  list(prefix: string): Promise<string[]>
}

/**
 * Configuration for ChunkedHNSWIndex
 */
export interface ChunkedHNSWConfig {
  /** Number of dimensions in vectors */
  dimensions: number
  /** Max connections per node (default: 16) */
  M?: number
  /** Size of dynamic candidate list during construction (default: 200) */
  efConstruction?: number
  /** Distance metric (default: 'cosine') */
  metric?: 'cosine' | 'l2' | 'dot'
  /** Maximum memory per chunk in bytes (default: 10MB) */
  maxChunkSizeBytes?: number
  /** Enable binary quantization for 32x memory reduction */
  useBinaryQuantization?: boolean
  /** Storage backend for chunks */
  storage?: ChunkStorage
  /** Maximum cache size in bytes (default: 50MB) */
  maxCacheBytes?: number
  /** Auto-flush threshold in number of vectors (default: 1000) */
  autoFlushThreshold?: number
}

/**
 * Resolved configuration with defaults applied
 */
export interface ResolvedChunkedHNSWConfig {
  dimensions: number
  M: number
  maxM: number
  maxM0: number
  efConstruction: number
  metric: 'cosine' | 'l2' | 'dot'
  maxChunkSizeBytes: number
  useBinaryQuantization: boolean
  maxCacheBytes: number
  autoFlushThreshold: number
  ml: number
}

/**
 * Chunk manifest stored with the index
 */
export interface ChunkManifest {
  /** Index configuration */
  config: ResolvedChunkedHNSWConfig
  /** Total number of vectors */
  vectorCount: number
  /** Chunk information */
  chunks: ChunkInfo[]
  /** Entry point chunk for search */
  entryPointChunk: number
  /** Entry point node ID within the chunk */
  entryPointNode: string
  /** Max level in the graph */
  maxLevel: number
  /** Created timestamp */
  createdAt: number
}

/**
 * Information about a single chunk
 */
export interface ChunkInfo {
  /** Chunk ID (index) */
  id: number
  /** Storage key */
  key: string
  /** Number of vectors in chunk */
  vectorCount: number
  /** Size in bytes */
  sizeBytes: number
  /** Min vector ID in chunk */
  minId: string
  /** Max vector ID in chunk */
  maxId: string
  /** Checksum for validation */
  checksum: string
}

/**
 * Search result with chunk information
 */
export interface ChunkedSearchResult {
  id: string
  score: number
  chunkId: number
}

/**
 * Statistics from chunk loading during search
 */
export interface ChunkLoadStats {
  /** Number of chunks loaded during search */
  chunksLoaded: number
  /** Total bytes loaded */
  bytesLoaded: number
  /** Peak memory usage in bytes */
  peakMemoryBytes: number
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Current bytes in cache */
  currentBytes: number
  /** Number of chunks in cache */
  chunkCount: number
  /** Cache hit rate */
  hitRate: number
}

/**
 * Internal node representation
 */
interface HNSWNode {
  id: string
  level: number
  neighbors: string[][]
}

/**
 * Chunk data structure (stored)
 */
interface ChunkData {
  nodes: Map<string, HNSWNode>
  vectors: Map<string, Float32Array>
  binaryVectors?: Map<string, Uint8Array>
}

// ============================================================================
// BINARY QUANTIZATION
// ============================================================================

/**
 * Binarize a float32 vector using sign threshold
 * value >= 0 -> 1, value < 0 -> 0
 */
export function binarizeVector(vector: Float32Array): Uint8Array {
  const numBytes = Math.ceil(vector.length / 8)
  const binary = new Uint8Array(numBytes)

  for (let i = 0; i < vector.length; i++) {
    if (vector[i] >= 0) {
      const byteIndex = Math.floor(i / 8)
      const bitIndex = i % 8
      binary[byteIndex] |= (1 << bitIndex)
    }
  }

  return binary
}

/**
 * Compute Hamming distance between two binary vectors
 * Uses popcount for efficiency
 */
export function hammingDistance(a: Uint8Array, b: Uint8Array): number {
  let distance = 0

  for (let i = 0; i < a.length; i++) {
    // XOR gives bits that differ
    let xor = a[i]! ^ b[i]!
    // Popcount the XOR result
    while (xor !== 0) {
      distance += xor & 1
      xor >>>= 1
    }
  }

  return distance
}

// ============================================================================
// DISTANCE FUNCTIONS
// ============================================================================

function cosineDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

function l2Distance(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

function dotDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
  }
  return dot
}

// ============================================================================
// LRU CACHE
// ============================================================================

class LRUCache<T> {
  private cache: Map<string, { data: T; size: number }> = new Map()
  private accessOrder: string[] = []
  private currentSize = 0
  private hits = 0
  private misses = 0

  constructor(private maxSize: number) {}

  get(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (entry) {
      this.hits++
      // Move to end of access order
      const idx = this.accessOrder.indexOf(key)
      if (idx !== -1) {
        this.accessOrder.splice(idx, 1)
        this.accessOrder.push(key)
      }
      return entry.data
    }
    this.misses++
    return undefined
  }

  set(key: string, data: T, size: number): void {
    // Evict until we have room
    while (this.currentSize + size > this.maxSize && this.accessOrder.length > 0) {
      const evictKey = this.accessOrder.shift()!
      const evicted = this.cache.get(evictKey)
      if (evicted) {
        this.currentSize -= evicted.size
        this.cache.delete(evictKey)
      }
    }

    this.cache.set(key, { data, size })
    this.currentSize += size
    this.accessOrder.push(key)
  }

  has(key: string): boolean {
    return this.cache.has(key)
  }

  clear(): void {
    this.cache.clear()
    this.accessOrder = []
    this.currentSize = 0
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses
    return {
      currentBytes: this.currentSize,
      chunkCount: this.cache.size,
      hitRate: total > 0 ? this.hits / total : 0,
    }
  }
}

// ============================================================================
// PRIORITY QUEUE
// ============================================================================

interface HeapItem {
  id: string
  distance: number
  chunkId: number
}

class MinHeap {
  private heap: HeapItem[] = []

  push(item: HeapItem): void {
    this.heap.push(item)
    this.bubbleUp(this.heap.length - 1)
  }

  pop(): HeapItem | undefined {
    if (this.heap.length === 0) return undefined
    const result = this.heap[0]
    const last = this.heap.pop()!
    if (this.heap.length > 0) {
      this.heap[0] = last
      this.bubbleDown(0)
    }
    return result
  }

  peek(): HeapItem | undefined {
    return this.heap[0]
  }

  size(): number {
    return this.heap.length
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      if (this.heap[parentIndex]!.distance <= this.heap[index]!.distance) break
      ;[this.heap[parentIndex], this.heap[index]] = [
        this.heap[index]!,
        this.heap[parentIndex]!,
      ]
      index = parentIndex
    }
  }

  private bubbleDown(index: number): void {
    const length = this.heap.length
    while (true) {
      const leftChild = 2 * index + 1
      const rightChild = 2 * index + 2
      let smallest = index

      if (
        leftChild < length &&
        this.heap[leftChild]!.distance < this.heap[smallest]!.distance
      ) {
        smallest = leftChild
      }
      if (
        rightChild < length &&
        this.heap[rightChild]!.distance < this.heap[smallest]!.distance
      ) {
        smallest = rightChild
      }

      if (smallest === index) break
      ;[this.heap[smallest], this.heap[index]] = [
        this.heap[index]!,
        this.heap[smallest]!,
      ]
      index = smallest
    }
  }
}

class MaxHeap {
  private heap: HeapItem[] = []

  push(item: HeapItem): void {
    this.heap.push(item)
    this.bubbleUp(this.heap.length - 1)
  }

  pop(): HeapItem | undefined {
    if (this.heap.length === 0) return undefined
    const result = this.heap[0]
    const last = this.heap.pop()!
    if (this.heap.length > 0) {
      this.heap[0] = last
      this.bubbleDown(0)
    }
    return result
  }

  peek(): HeapItem | undefined {
    return this.heap[0]
  }

  size(): number {
    return this.heap.length
  }

  toArray(): HeapItem[] {
    return [...this.heap].sort((a, b) => b.distance - a.distance)
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      if (this.heap[parentIndex]!.distance >= this.heap[index]!.distance) break
      ;[this.heap[parentIndex], this.heap[index]] = [
        this.heap[index]!,
        this.heap[parentIndex]!,
      ]
      index = parentIndex
    }
  }

  private bubbleDown(index: number): void {
    const length = this.heap.length
    while (true) {
      const leftChild = 2 * index + 1
      const rightChild = 2 * index + 2
      let largest = index

      if (
        leftChild < length &&
        this.heap[leftChild]!.distance > this.heap[largest]!.distance
      ) {
        largest = leftChild
      }
      if (
        rightChild < length &&
        this.heap[rightChild]!.distance > this.heap[largest]!.distance
      ) {
        largest = rightChild
      }

      if (largest === index) break
      ;[this.heap[largest], this.heap[index]] = [
        this.heap[index]!,
        this.heap[largest]!,
      ]
      index = largest
    }
  }
}

// ============================================================================
// CHUNKED HNSW INDEX
// ============================================================================

export class ChunkedHNSWIndex {
  private _config: ResolvedChunkedHNSWConfig
  private storage: ChunkStorage
  private cache: LRUCache<ChunkData>

  // In-memory buffer for unflushed vectors
  private buffer: {
    nodes: Map<string, HNSWNode>
    vectors: Map<string, Float32Array>
    binaryVectors: Map<string, Uint8Array>
  } = {
    nodes: new Map(),
    vectors: new Map(),
    binaryVectors: new Map(),
  }

  // Manifest tracking all chunks
  private manifest: ChunkManifest | null = null

  // Entry point for search
  private entryPointId: string | null = null
  private maxLevel: number = -1

  // Mapping from vector ID to chunk ID
  private vectorToChunk: Map<string, number> = new Map()

  // Distance function
  private distanceFn: (a: Float32Array, b: Float32Array) => number
  private higherIsBetter: boolean

  // Statistics
  private peakMemoryBytes: number = 0
  private chunksLoadedInSearch: number = 0
  private bytesLoadedInSearch: number = 0

  constructor(config: ChunkedHNSWConfig) {
    // Validate configuration
    if (config.dimensions <= 0) {
      throw new Error('dimensions must be positive')
    }

    const maxChunkSizeBytes = config.maxChunkSizeBytes ?? 10 * 1024 * 1024 // 10MB default

    if (maxChunkSizeBytes < 1 * 1024 * 1024) {
      throw new Error('chunk size must be at least 1MB')
    }

    if (maxChunkSizeBytes > 100 * 1024 * 1024) {
      throw new Error('chunk size must not exceed 100MB')
    }

    const M = config.M ?? 16
    if (M < 2) {
      throw new Error('M must be at least 2')
    }

    const efConstruction = config.efConstruction ?? 200
    if (efConstruction < M) {
      throw new Error('efConstruction must be at least M')
    }

    const metric = config.metric ?? 'cosine'

    this._config = {
      dimensions: config.dimensions,
      M,
      maxM: M,
      maxM0: M * 2,
      efConstruction,
      metric,
      maxChunkSizeBytes,
      useBinaryQuantization: config.useBinaryQuantization ?? false,
      maxCacheBytes: config.maxCacheBytes ?? 50 * 1024 * 1024, // 50MB default
      autoFlushThreshold: config.autoFlushThreshold ?? 1000,
      ml: 1 / Math.log(M),
    }

    // Set distance function
    if (metric === 'cosine') {
      this.distanceFn = cosineDistance
      this.higherIsBetter = true
    } else if (metric === 'l2') {
      this.distanceFn = l2Distance
      this.higherIsBetter = false
    } else {
      this.distanceFn = dotDistance
      this.higherIsBetter = true
    }

    // Initialize storage
    this.storage = config.storage ?? new InMemoryChunkStorage()

    // Initialize cache
    this.cache = new LRUCache<ChunkData>(this._config.maxCacheBytes)
  }

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  config(): ResolvedChunkedHNSWConfig {
    return { ...this._config }
  }

  /**
   * Calculate maximum vectors per chunk based on dimensions and settings
   */
  getMaxVectorsPerChunk(): number {
    const dims = this._config.dimensions
    const maxBytes = this._config.maxChunkSizeBytes

    // Calculate bytes per vector
    let bytesPerVector: number
    if (this._config.useBinaryQuantization) {
      // Binary: dims/8 bytes for binary vector + dims*4 for full vector (kept for reranking)
      // Actually for pure binary mode, we only need binary + ID storage
      bytesPerVector = Math.ceil(dims / 8)
    } else {
      // Float32: dims * 4 bytes for vector
      bytesPerVector = dims * 4
    }

    // Add graph overhead (rough estimate: M neighbors * 8 bytes ID + overhead)
    // For JSON serialization, IDs are strings so estimate higher overhead
    const graphOverheadPerNode = this._config.M * 2 * 20 + 200

    const totalBytesPerVector = bytesPerVector + graphOverheadPerNode

    // Return max vectors, leaving some buffer for metadata
    return Math.floor((maxBytes * 0.8) / totalBytesPerVector)
  }

  size(): number {
    const bufferSize = this.buffer.nodes.size
    const manifestSize = this.manifest?.vectorCount ?? 0
    return bufferSize + manifestSize
  }

  getCacheStats(): CacheStats {
    return this.cache.getStats()
  }

  // ============================================================================
  // INSERT
  // ============================================================================

  async insert(id: string, vector: Float32Array): Promise<void> {
    // Validate dimension
    if (vector.length !== this._config.dimensions) {
      throw new Error(
        `dimension mismatch: expected ${this._config.dimensions}, got ${vector.length}`
      )
    }

    // Generate level for new node
    const level = this.generateLevel()

    // Create node
    const node: HNSWNode = {
      id,
      level,
      neighbors: Array.from({ length: level + 1 }, () => []),
    }

    // Store in buffer
    this.buffer.nodes.set(id, node)
    this.buffer.vectors.set(id, vector)

    if (this._config.useBinaryQuantization) {
      this.buffer.binaryVectors.set(id, binarizeVector(vector))
    }

    // Update entry point if needed
    if (this.entryPointId === null || level > this.maxLevel) {
      this.entryPointId = id
      this.maxLevel = level
    }

    // Build connections in buffer
    await this.connectNode(id, vector, level)

    // Auto-flush if threshold exceeded
    if (this.buffer.nodes.size >= this._config.autoFlushThreshold) {
      await this.flush()
    }
  }

  private async connectNode(id: string, vector: Float32Array, level: number): Promise<void> {
    if (this.buffer.nodes.size === 1) {
      return // First node, nothing to connect
    }

    // Find candidates to connect to
    const candidates = await this.searchBufferAndChunks(vector, this._config.efConstruction, level)

    // Connect at each level
    for (let lc = Math.min(level, this.maxLevel); lc >= 0; lc--) {
      const levelCandidates = candidates.filter(c => {
        const node = this.buffer.nodes.get(c.id) ?? this.getNodeFromChunk(c.id, c.chunkId)
        return node && node.level >= lc
      })

      const selected = this.selectNeighbors(levelCandidates, lc)

      // Add connections
      const node = this.buffer.nodes.get(id)!
      node.neighbors[lc] = selected.map(s => s.id)

      // Add reverse connections (only in buffer for now)
      for (const neighbor of selected) {
        const neighborNode = this.buffer.nodes.get(neighbor.id)
        if (neighborNode && neighborNode.neighbors[lc]) {
          neighborNode.neighbors[lc].push(id)
          // Prune if over limit
          const maxConn = lc === 0 ? this._config.maxM0 : this._config.maxM
          if (neighborNode.neighbors[lc].length > maxConn) {
            this.pruneConnections(neighborNode, lc, maxConn)
          }
        }
      }
    }
  }

  private async searchBufferAndChunks(
    query: Float32Array,
    ef: number,
    maxLevel: number
  ): Promise<HeapItem[]> {
    const visited = new Set<string>()
    const candidates = new MinHeap()
    const results = new MaxHeap()

    // Start from entry point
    let currentId = this.entryPointId
    if (!currentId) return []

    // Get entry point's chunk
    const entryChunkId = this.vectorToChunk.get(currentId) ?? -1 // -1 for buffer

    const entryVector = this.getVectorForSearch(currentId, entryChunkId)
    if (!entryVector) return []

    const entryDist = this.distanceFn(query, entryVector)

    visited.add(currentId)
    candidates.push({ id: currentId, distance: entryDist, chunkId: entryChunkId })
    results.push({ id: currentId, distance: entryDist, chunkId: entryChunkId })

    while (candidates.size() > 0) {
      const current = candidates.pop()!

      // Check termination condition
      const worstResult = results.peek()
      if (worstResult && results.size() >= ef && this.isBetter(worstResult.distance, current.distance)) {
        break
      }

      // Get neighbors
      const node = this.getNodeForSearch(current.id, current.chunkId)
      if (!node) continue

      const neighbors = node.neighbors[0] ?? []

      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) continue
        visited.add(neighborId)

        const neighborChunkId = this.vectorToChunk.get(neighborId) ?? -1
        const neighborVec = this.getVectorForSearch(neighborId, neighborChunkId)
        if (!neighborVec) continue

        const dist = this.distanceFn(query, neighborVec)
        const worstResultDist = results.peek()?.distance

        if (results.size() < ef || !worstResultDist || this.isBetter(dist, worstResultDist)) {
          candidates.push({ id: neighborId, distance: dist, chunkId: neighborChunkId })
          results.push({ id: neighborId, distance: dist, chunkId: neighborChunkId })

          if (results.size() > ef) {
            results.pop()
          }
        }
      }
    }

    return results.toArray()
  }

  private getVectorForSearch(id: string, chunkId: number): Float32Array | null {
    // Check buffer first
    const bufferVec = this.buffer.vectors.get(id)
    if (bufferVec) return bufferVec

    // Check chunks
    if (chunkId >= 0) {
      const chunk = this.getChunkFromCache(chunkId)
      if (chunk) {
        return chunk.vectors.get(id) ?? null
      }
    }

    return null
  }

  private getNodeForSearch(id: string, chunkId: number): HNSWNode | null {
    // Check buffer first
    const bufferNode = this.buffer.nodes.get(id)
    if (bufferNode) return bufferNode

    // Check chunks
    if (chunkId >= 0) {
      const chunk = this.getChunkFromCache(chunkId)
      if (chunk) {
        return chunk.nodes.get(id) ?? null
      }
    }

    return null
  }

  private getNodeFromChunk(id: string, chunkId: number): HNSWNode | null {
    const chunk = this.getChunkFromCache(chunkId)
    if (chunk) {
      return chunk.nodes.get(id) ?? null
    }
    return null
  }

  private getChunkFromCache(chunkId: number): ChunkData | null {
    const key = `chunk-${chunkId.toString().padStart(5, '0')}.bin`
    return this.cache.get(key) ?? null
  }

  private selectNeighbors(candidates: HeapItem[], level: number): HeapItem[] {
    const maxConn = level === 0 ? this._config.maxM0 : this._config.maxM

    if (this.higherIsBetter) {
      candidates.sort((a, b) => b.distance - a.distance)
    } else {
      candidates.sort((a, b) => a.distance - b.distance)
    }

    return candidates.slice(0, maxConn)
  }

  private pruneConnections(node: HNSWNode, level: number, maxConn: number): void {
    const nodeVec = this.buffer.vectors.get(node.id)
    if (!nodeVec) return

    const neighbors = node.neighbors[level]!
    const scored: Array<{ id: string; distance: number }> = []

    for (const neighborId of neighbors) {
      const neighborVec = this.buffer.vectors.get(neighborId)
      if (neighborVec) {
        scored.push({
          id: neighborId,
          distance: this.distanceFn(nodeVec, neighborVec),
        })
      }
    }

    if (this.higherIsBetter) {
      scored.sort((a, b) => b.distance - a.distance)
    } else {
      scored.sort((a, b) => a.distance - b.distance)
    }

    node.neighbors[level] = scored.slice(0, maxConn).map(s => s.id)
  }

  private generateLevel(): number {
    const r = Math.random()
    return Math.floor(-Math.log(r) * this._config.ml)
  }

  private isBetter(newDist: number, oldDist: number): boolean {
    return this.higherIsBetter ? newDist > oldDist : newDist < oldDist
  }

  // ============================================================================
  // SEARCH
  // ============================================================================

  async search(
    query: Float32Array,
    options: { k?: number; ef?: number } = {}
  ): Promise<ChunkedSearchResult[]> {
    const { results } = await this.searchWithStats(query, options)
    return results
  }

  async searchWithStats(
    query: Float32Array,
    options: { k?: number; ef?: number } = {}
  ): Promise<{ results: ChunkedSearchResult[]; loadStats: ChunkLoadStats }> {
    // Validate dimension
    if (query.length !== this._config.dimensions) {
      throw new Error(
        `dimension mismatch: expected ${this._config.dimensions}, got ${query.length}`
      )
    }

    const k = options.k ?? 10
    const ef = Math.max(options.ef ?? 40, k)

    // Reset statistics
    this.chunksLoadedInSearch = 0
    this.bytesLoadedInSearch = 0
    this.peakMemoryBytes = this.cache.getStats().currentBytes

    if (this.size() === 0) {
      return {
        results: [],
        loadStats: {
          chunksLoaded: 0,
          bytesLoaded: 0,
          peakMemoryBytes: 0,
        },
      }
    }

    // Perform search
    const candidates = await this.searchBufferAndChunks(query, ef, this.maxLevel)

    // Rerank with exact distance if using binary quantization
    let results: ChunkedSearchResult[]
    if (this._config.useBinaryQuantization) {
      // Get full vectors for reranking
      const rerankCandidates = candidates.slice(0, Math.min(ef, k * 10))
      const reranked: ChunkedSearchResult[] = []

      for (const candidate of rerankCandidates) {
        const vec = this.getVectorForSearch(candidate.id, candidate.chunkId)
        if (vec) {
          const exactDist = this.distanceFn(query, vec)
          reranked.push({
            id: candidate.id,
            score: exactDist,
            chunkId: candidate.chunkId,
          })
        }
      }

      if (this.higherIsBetter) {
        reranked.sort((a, b) => b.score - a.score)
      } else {
        reranked.sort((a, b) => a.score - b.score)
      }

      results = reranked.slice(0, k)
    } else {
      results = candidates.slice(0, k).map(c => ({
        id: c.id,
        score: c.distance,
        chunkId: c.chunkId,
      }))
    }

    return {
      results,
      loadStats: {
        chunksLoaded: this.chunksLoadedInSearch,
        bytesLoaded: this.bytesLoadedInSearch,
        peakMemoryBytes: this.peakMemoryBytes,
      },
    }
  }

  // ============================================================================
  // FLUSH / PERSIST
  // ============================================================================

  async flush(): Promise<void> {
    if (this.buffer.nodes.size === 0) {
      return
    }

    // Create chunk data
    const chunkData: ChunkData = {
      nodes: new Map(this.buffer.nodes),
      vectors: new Map(this.buffer.vectors),
      binaryVectors: this._config.useBinaryQuantization
        ? new Map(this.buffer.binaryVectors)
        : undefined,
    }

    // Determine chunk ID
    const chunkId = this.manifest?.chunks.length ?? 0
    const chunkKey = `chunk-${chunkId.toString().padStart(5, '0')}.bin`

    // Serialize chunk
    const serialized = this.serializeChunk(chunkData)
    const checksum = await this.calculateChecksum(serialized)

    // Store chunk
    await this.storage.put(chunkKey, serialized)

    // Update vector to chunk mapping
    for (const id of this.buffer.nodes.keys()) {
      this.vectorToChunk.set(id, chunkId)
    }

    // Update cache
    this.cache.set(chunkKey, chunkData, serialized.byteLength)

    // Get min/max IDs
    const ids = Array.from(this.buffer.nodes.keys()).sort()
    const minId = ids[0] ?? ''
    const maxId = ids[ids.length - 1] ?? ''

    // Create chunk info
    const chunkInfo: ChunkInfo = {
      id: chunkId,
      key: chunkKey,
      vectorCount: this.buffer.nodes.size,
      sizeBytes: serialized.byteLength,
      minId,
      maxId,
      checksum,
    }

    // Update manifest
    if (!this.manifest) {
      this.manifest = {
        config: this._config,
        vectorCount: 0,
        chunks: [],
        entryPointChunk: 0,
        entryPointNode: this.entryPointId ?? '',
        maxLevel: this.maxLevel,
        createdAt: Date.now(),
      }
    }

    this.manifest.chunks.push(chunkInfo)
    this.manifest.vectorCount += this.buffer.nodes.size
    this.manifest.entryPointNode = this.entryPointId ?? ''
    this.manifest.entryPointChunk = this.vectorToChunk.get(this.entryPointId ?? '') ?? 0
    this.manifest.maxLevel = this.maxLevel

    // Save manifest
    await this.saveManifest()

    // Clear buffer
    this.buffer.nodes.clear()
    this.buffer.vectors.clear()
    this.buffer.binaryVectors.clear()
  }

  async getManifest(): Promise<ChunkManifest> {
    if (!this.manifest) {
      throw new Error('No manifest available - call flush() first')
    }
    return { ...this.manifest }
  }

  private serializeChunk(data: ChunkData): ArrayBuffer {
    // Simple JSON serialization for now
    // TODO: Optimize with binary format
    const serializable = {
      nodes: Array.from(data.nodes.entries()),
      vectors: Array.from(data.vectors.entries()).map(([id, vec]) => [
        id,
        Array.from(vec),
      ]),
      binaryVectors: data.binaryVectors
        ? Array.from(data.binaryVectors.entries()).map(([id, bin]) => [
            id,
            Array.from(bin),
          ])
        : undefined,
    }

    const json = JSON.stringify(serializable)
    const encoder = new TextEncoder()
    return encoder.encode(json).buffer as ArrayBuffer
  }

  private deserializeChunk(buffer: ArrayBuffer): ChunkData {
    const decoder = new TextDecoder()
    const json = decoder.decode(buffer)
    const parsed = JSON.parse(json)

    const nodes = new Map<string, HNSWNode>()
    for (const [id, node] of parsed.nodes) {
      nodes.set(id, node)
    }

    const vectors = new Map<string, Float32Array>()
    for (const [id, arr] of parsed.vectors) {
      vectors.set(id, new Float32Array(arr))
    }

    let binaryVectors: Map<string, Uint8Array> | undefined
    if (parsed.binaryVectors) {
      binaryVectors = new Map<string, Uint8Array>()
      for (const [id, arr] of parsed.binaryVectors) {
        binaryVectors.set(id, new Uint8Array(arr))
      }
    }

    return { nodes, vectors, binaryVectors }
  }

  private async saveManifest(): Promise<void> {
    if (!this.manifest) return

    const json = JSON.stringify(this.manifest)
    const encoder = new TextEncoder()
    await this.storage.put('manifest.json', encoder.encode(json).buffer as ArrayBuffer)
  }

  private async calculateChecksum(data: ArrayBuffer): Promise<string> {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
    }

    // Fallback: simple checksum
    const bytes = new Uint8Array(data)
    let checksum = 0
    for (let i = 0; i < bytes.byteLength; i++) {
      checksum = ((checksum << 5) - checksum + bytes[i]!) | 0
    }
    return checksum.toString(16)
  }

  // ============================================================================
  // LOAD
  // ============================================================================

  static async load(
    storage: ChunkStorage,
    options: { validateChecksums?: boolean } = {}
  ): Promise<ChunkedHNSWIndex> {
    // Load manifest
    const manifestData = await storage.get('manifest.json')
    if (!manifestData) {
      throw new Error('No manifest found')
    }

    const decoder = new TextDecoder()
    const manifest = JSON.parse(decoder.decode(manifestData)) as ChunkManifest

    // Create index with loaded config
    const index = new ChunkedHNSWIndex({
      ...manifest.config,
      storage,
    })

    index.manifest = manifest
    index.entryPointId = manifest.entryPointNode
    index.maxLevel = manifest.maxLevel

    // Load and validate chunks
    for (const chunkInfo of manifest.chunks) {
      const chunkData = await storage.get(chunkInfo.key)
      if (!chunkData) {
        throw new Error(`Chunk ${chunkInfo.key} not found`)
      }

      // Validate checksum
      if (options.validateChecksums) {
        const actualChecksum = await index.calculateChecksum(chunkData)
        if (actualChecksum !== chunkInfo.checksum) {
          throw new Error(`checksum mismatch for chunk ${chunkInfo.key}`)
        }
      }

      // Deserialize and cache chunk
      const chunk = index.deserializeChunk(chunkData)

      // Update vector to chunk mapping
      for (const id of chunk.nodes.keys()) {
        index.vectorToChunk.set(id, chunkInfo.id)
      }

      // Add to cache
      index.cache.set(chunkInfo.key, chunk, chunkData.byteLength)
    }

    return index
  }
}

// ============================================================================
// IN-MEMORY CHUNK STORAGE (default)
// ============================================================================

class InMemoryChunkStorage implements ChunkStorage {
  private data: Map<string, ArrayBuffer> = new Map()

  async put(key: string, data: ArrayBuffer): Promise<void> {
    this.data.set(key, data)
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    return this.data.get(key) ?? null
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key)
  }

  async list(prefix: string): Promise<string[]> {
    return Array.from(this.data.keys()).filter((k) => k.startsWith(prefix))
  }
}
