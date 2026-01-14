/**
 * HNSW Index Implementation
 *
 * Hierarchical Navigable Small World (HNSW) graph for approximate nearest neighbor search.
 * This implementation is optimized for Cloudflare Workers edge computing environment.
 *
 * ## Algorithm Overview
 *
 * HNSW builds a multi-layer graph where:
 * - Layer 0 contains all vectors with dense connections
 * - Higher layers contain exponentially fewer nodes with sparse connections
 * - Search starts from the top layer and descends to layer 0
 * - This provides O(log N) search complexity
 *
 * ## Key Parameters
 *
 * - **M**: Maximum connections per node (default: 16). Higher M = better recall, more memory
 * - **efConstruction**: Build-time search depth (default: 200). Higher = better index quality
 * - **ef**: Search-time depth (default: 40). Higher = better recall, slower search
 *
 * ## Supported Metrics
 *
 * - **cosine**: Best for normalized embeddings (OpenAI, Cohere). Returns similarity [-1, 1]
 * - **l2**: Euclidean distance. Returns distance, lower = more similar
 * - **dot**: Inner product. Returns score, higher = more similar
 *
 * ## Memory Usage
 *
 * Approximate memory per vector: `D * 4 + M * 2 * 8 + overhead` bytes
 * - 768-dim vectors with M=16: ~3.5KB per vector
 * - 1536-dim vectors with M=16: ~6.5KB per vector
 *
 * @example Basic semantic search
 * ```typescript
 * import { createHNSWIndex } from 'db/edgevec/hnsw'
 *
 * // Create index for OpenAI text-embedding-3-small
 * const index = createHNSWIndex({
 *   dimensions: 768,
 *   metric: 'cosine',
 *   M: 16,
 *   efConstruction: 200
 * })
 *
 * // Insert document embeddings
 * const embedding = await openai.embeddings.create({
 *   model: 'text-embedding-3-small',
 *   input: 'Hello world'
 * })
 * index.insert('doc-1', new Float32Array(embedding.data[0].embedding))
 *
 * // Search for similar documents
 * const queryEmbedding = await openai.embeddings.create({
 *   model: 'text-embedding-3-small',
 *   input: 'greeting message'
 * })
 * const results = index.search(new Float32Array(queryEmbedding.data[0].embedding), {
 *   k: 10,
 *   ef: 100  // Higher ef for better recall
 * })
 *
 * // Results: [{ id: 'doc-1', score: 0.95 }, ...]
 * ```
 *
 * @example Persistence with R2
 * ```typescript
 * // Save index to R2
 * const serialized = index.serialize()
 * await env.R2.put('indices/my-index.bin', serialized)
 *
 * // Load index from R2
 * const data = await env.R2.get('indices/my-index.bin')
 * const loadedIndex = HNSWIndexImpl.deserialize(await data.arrayBuffer())
 * ```
 *
 * @example JSON export for debugging
 * ```typescript
 * const json = index.toJSON()
 * console.log(`Index has ${json.nodes.length} nodes`)
 * console.log(`Entry point: ${json.entryPointId}`)
 * ```
 *
 * @module db/edgevec/hnsw
 * @see {@link https://arxiv.org/abs/1603.09320 | Original HNSW Paper}
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Distance metric for vector similarity
 */
export type DistanceMetric = 'cosine' | 'l2' | 'dot'

/**
 * Configuration for HNSW index
 */
export interface HNSWConfig {
  /** Number of dimensions in vectors */
  dimensions: number
  /** Max connections per node on layers > 0 (default: 16) */
  M?: number
  /** Size of dynamic candidate list during construction (default: 200) */
  efConstruction?: number
  /** Distance metric (default: 'cosine') */
  metric?: DistanceMetric
}

/**
 * Resolved configuration with all defaults applied
 */
export interface ResolvedHNSWConfig {
  dimensions: number
  M: number
  maxM: number
  maxM0: number
  efConstruction: number
  metric: DistanceMetric
  ml: number // Level generation factor: 1 / ln(M)
}

/**
 * HNSW graph node
 */
export interface HNSWNode {
  /** Node ID */
  id: string
  /** Max layer this node exists on */
  level: number
  /** Neighbors at each layer [layer0, layer1, ...] */
  neighbors: string[][]
}

/**
 * Search result with score
 */
export interface SearchResult {
  /** Vector ID */
  id: string
  /** Similarity/distance score */
  score: number
}

/**
 * Search options
 */
export interface SearchOptions {
  /** Number of results to return (default: 10) */
  k?: number
  /** Size of dynamic candidate list during search (default: max(k, 40)) */
  ef?: number
}

/**
 * Index statistics
 */
export interface HNSWStats {
  /** Total number of vectors */
  size: number
  /** Vector dimensions */
  dimensions: number
  /** Maximum layer in the graph */
  maxLevel: number
  /** Number of nodes at each layer */
  layerDistribution: number[]
  /** Average connections at each layer */
  avgConnections: number[]
  /** Estimated memory usage in bytes */
  memoryBytes: number
}

/**
 * Entry point information
 */
export interface EntryPoint {
  /** Node ID */
  id: string
  /** Layer level */
  level: number
}

/**
 * Serialized JSON format
 */
export interface HNSWJson {
  config: ResolvedHNSWConfig
  nodes: HNSWNode[]
  vectors: Record<string, number[]>
  entryPointId: string | null
}

/**
 * HNSW Index interface
 */
export interface HNSWIndex {
  // Core operations
  insert(id: string, vector: Float32Array, metadata?: Record<string, unknown>): void
  search(query: Float32Array | number[], options?: SearchOptions): SearchResult[]
  delete(id: string): boolean

  // Accessors
  size(): number
  dimensions(): number
  has(id: string): boolean
  config(): ResolvedHNSWConfig

  // Node access
  getNode(id: string): HNSWNode | undefined
  getVector(id: string): Float32Array | undefined
  getEntryPoint(): EntryPoint | undefined

  // Stats
  getStats(): HNSWStats

  // Serialization
  serialize(): ArrayBuffer
  toJSON(): HNSWJson
}

// ============================================================================
// DISTANCE FUNCTIONS (OPTIMIZED WITH 8-WAY LOOP UNROLLING)
// ============================================================================

/**
 * Validates that two vectors have matching dimensions
 * @throws Error if dimensions don't match
 */
export function validateVectorDimensions(a: Float32Array, b: Float32Array): void {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`)
  }
}

/**
 * Cosine similarity with 8-way loop unrolling (higher is better)
 *
 * Optimized for modern CPUs with multiple accumulators to maximize
 * instruction-level parallelism.
 */
function cosineDistance(a: Float32Array, b: Float32Array): number {
  validateVectorDimensions(a, b)
  const len = a.length
  const remainder = len & 7 // len % 8
  const unrolledLen = len - remainder

  // 8 accumulators for dot product, norm A squared, norm B squared
  let d0 = 0, d1 = 0, d2 = 0, d3 = 0, d4 = 0, d5 = 0, d6 = 0, d7 = 0
  let na0 = 0, na1 = 0, na2 = 0, na3 = 0, na4 = 0, na5 = 0, na6 = 0, na7 = 0
  let nb0 = 0, nb1 = 0, nb2 = 0, nb3 = 0, nb4 = 0, nb5 = 0, nb6 = 0, nb7 = 0

  for (let i = 0; i < unrolledLen; i += 8) {
    const a0 = a[i]!, a1 = a[i + 1]!, a2 = a[i + 2]!, a3 = a[i + 3]!
    const a4 = a[i + 4]!, a5 = a[i + 5]!, a6 = a[i + 6]!, a7 = a[i + 7]!
    const b0 = b[i]!, b1 = b[i + 1]!, b2 = b[i + 2]!, b3 = b[i + 3]!
    const b4 = b[i + 4]!, b5 = b[i + 5]!, b6 = b[i + 6]!, b7 = b[i + 7]!

    d0 += a0 * b0; d1 += a1 * b1; d2 += a2 * b2; d3 += a3 * b3
    d4 += a4 * b4; d5 += a5 * b5; d6 += a6 * b6; d7 += a7 * b7

    na0 += a0 * a0; na1 += a1 * a1; na2 += a2 * a2; na3 += a3 * a3
    na4 += a4 * a4; na5 += a5 * a5; na6 += a6 * a6; na7 += a7 * a7

    nb0 += b0 * b0; nb1 += b1 * b1; nb2 += b2 * b2; nb3 += b3 * b3
    nb4 += b4 * b4; nb5 += b5 * b5; nb6 += b6 * b6; nb7 += b7 * b7
  }

  // Handle remainder
  let dr = 0, nar = 0, nbr = 0
  for (let i = unrolledLen; i < len; i++) {
    const ai = a[i]!, bi = b[i]!
    dr += ai * bi
    nar += ai * ai
    nbr += bi * bi
  }

  const dot = d0 + d1 + d2 + d3 + d4 + d5 + d6 + d7 + dr
  const normA = na0 + na1 + na2 + na3 + na4 + na5 + na6 + na7 + nar
  const normB = nb0 + nb1 + nb2 + nb3 + nb4 + nb5 + nb6 + nb7 + nbr

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  if (denom === 0) return 0

  return dot / denom
}

/**
 * L2 (Euclidean) distance with 8-way loop unrolling (lower is better)
 */
function l2Distance(a: Float32Array, b: Float32Array): number {
  validateVectorDimensions(a, b)
  const len = a.length
  const remainder = len & 7
  const unrolledLen = len - remainder

  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, s5 = 0, s6 = 0, s7 = 0

  for (let i = 0; i < unrolledLen; i += 8) {
    const d0 = a[i]! - b[i]!
    const d1 = a[i + 1]! - b[i + 1]!
    const d2 = a[i + 2]! - b[i + 2]!
    const d3 = a[i + 3]! - b[i + 3]!
    const d4 = a[i + 4]! - b[i + 4]!
    const d5 = a[i + 5]! - b[i + 5]!
    const d6 = a[i + 6]! - b[i + 6]!
    const d7 = a[i + 7]! - b[i + 7]!
    s0 += d0 * d0; s1 += d1 * d1; s2 += d2 * d2; s3 += d3 * d3
    s4 += d4 * d4; s5 += d5 * d5; s6 += d6 * d6; s7 += d7 * d7
  }

  let sr = 0
  for (let i = unrolledLen; i < len; i++) {
    const d = a[i]! - b[i]!
    sr += d * d
  }

  return Math.sqrt(s0 + s1 + s2 + s3 + s4 + s5 + s6 + s7 + sr)
}

/**
 * Dot product with 8-way loop unrolling (higher is better)
 */
function dotDistance(a: Float32Array, b: Float32Array): number {
  validateVectorDimensions(a, b)
  const len = a.length
  const remainder = len & 7
  const unrolledLen = len - remainder

  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, s5 = 0, s6 = 0, s7 = 0

  for (let i = 0; i < unrolledLen; i += 8) {
    s0 += a[i]! * b[i]!
    s1 += a[i + 1]! * b[i + 1]!
    s2 += a[i + 2]! * b[i + 2]!
    s3 += a[i + 3]! * b[i + 3]!
    s4 += a[i + 4]! * b[i + 4]!
    s5 += a[i + 5]! * b[i + 5]!
    s6 += a[i + 6]! * b[i + 6]!
    s7 += a[i + 7]! * b[i + 7]!
  }

  let sr = 0
  for (let i = unrolledLen; i < len; i++) {
    sr += a[i]! * b[i]!
  }

  return s0 + s1 + s2 + s3 + s4 + s5 + s6 + s7 + sr
}

// ============================================================================
// PRIORITY QUEUE (Min-Heap for candidates)
// ============================================================================

interface HeapItem {
  id: string
  distance: number
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

  toArray(): HeapItem[] {
    return [...this.heap].sort((a, b) => a.distance - b.distance)
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
// HNSW IMPLEMENTATION
// ============================================================================

/**
 * HNSW Index Implementation.
 *
 * The main class implementing the HNSW algorithm for approximate nearest
 * neighbor search. This class manages the multi-layer graph structure,
 * handles insertions and deletions, and provides efficient similarity search.
 *
 * @example Creating and using an index
 * ```typescript
 * const index = new HNSWIndexImpl({
 *   dimensions: 768,
 *   metric: 'cosine',
 *   M: 16,
 *   efConstruction: 200
 * })
 *
 * // Insert vectors
 * for (const doc of documents) {
 *   index.insert(doc.id, new Float32Array(doc.embedding))
 * }
 *
 * // Search
 * const results = index.search(queryVector, { k: 10, ef: 100 })
 * ```
 */
export class HNSWIndexImpl implements HNSWIndex {
  private _config: ResolvedHNSWConfig
  private nodes: Map<string, HNSWNode> = new Map()
  private vectors: Map<string, Float32Array> = new Map()
  private entryPointId: string | null = null
  private maxLevel: number = -1

  // Distance function based on metric
  private distanceFn: (a: Float32Array, b: Float32Array) => number
  private higherIsBetter: boolean

  constructor(config: HNSWConfig) {
    // Validate config
    if (config.dimensions <= 0) {
      throw new Error('dimensions must be positive')
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
  }

  // ============================================================================
  // CORE OPERATIONS
  // ============================================================================

  insert(id: string, vector: Float32Array, _metadata?: Record<string, unknown>): void {
    // Validate dimension
    if (vector.length !== this._config.dimensions) {
      throw new Error(
        `dimension mismatch: expected ${this._config.dimensions}, got ${vector.length}`
      )
    }

    // Convert to Float32Array if needed
    const vec =
      vector instanceof Float32Array ? vector : new Float32Array(vector)

    // Check if updating existing
    const existing = this.nodes.get(id)
    if (existing) {
      // Update vector, keep node structure
      this.vectors.set(id, vec)
      return
    }

    // Generate random level for new node
    const level = this.generateLevel()

    // Create node
    const node: HNSWNode = {
      id,
      level,
      neighbors: Array.from({ length: level + 1 }, () => []),
    }

    this.nodes.set(id, node)
    this.vectors.set(id, vec)

    // Handle first insertion
    if (this.entryPointId === null) {
      this.entryPointId = id
      this.maxLevel = level
      return
    }

    // Find entry point and navigate down
    let currentNode = this.nodes.get(this.entryPointId)!
    let currentLevel = this.maxLevel

    // Navigate from top to level + 1 (greedy search)
    while (currentLevel > level) {
      const changed = this.greedySearchAtLevel(vec, currentNode.id, currentLevel)
      if (changed !== currentNode.id) {
        currentNode = this.nodes.get(changed)!
      }
      currentLevel--
    }

    // Insert at each level from level down to 0
    for (let lc = Math.min(level, this.maxLevel); lc >= 0; lc--) {
      const neighbors = this.searchLayer(vec, currentNode.id, this._config.efConstruction, lc)
      const selectedNeighbors = this.selectNeighbors(vec, neighbors, lc)

      // Add edges
      node.neighbors[lc] = selectedNeighbors.map((n) => n.id)

      // Add reverse edges and prune if needed
      for (const neighbor of selectedNeighbors) {
        const neighborNode = this.nodes.get(neighbor.id)!
        if (!neighborNode.neighbors[lc]) {
          neighborNode.neighbors[lc] = []
        }
        neighborNode.neighbors[lc]!.push(id)

        // Prune if over limit
        const maxConn = lc === 0 ? this._config.maxM0 : this._config.maxM
        if (neighborNode.neighbors[lc]!.length > maxConn) {
          this.pruneConnections(neighborNode, lc, maxConn)
        }
      }

      // Update entry point for next level
      if (neighbors.length > 0) {
        currentNode = this.nodes.get(neighbors[0]!.id)!
      }
    }

    // Update entry point if new node has higher level
    if (level > this.maxLevel) {
      this.entryPointId = id
      this.maxLevel = level
    }
  }

  search(query: Float32Array | number[], options?: SearchOptions): SearchResult[] {
    const vec = query instanceof Float32Array ? query : new Float32Array(query)

    if (vec.length !== this._config.dimensions) {
      throw new Error(
        `dimension mismatch: expected ${this._config.dimensions}, got ${vec.length}`
      )
    }

    if (this.entryPointId === null) {
      return []
    }

    const k = options?.k ?? 10
    const ef = Math.max(options?.ef ?? 40, k)

    // Navigate from top to layer 1
    let currentId = this.entryPointId
    for (let level = this.maxLevel; level > 0; level--) {
      currentId = this.greedySearchAtLevel(vec, currentId, level)
    }

    // Search at layer 0
    const candidates = this.searchLayer(vec, currentId, ef, 0)

    // Return top k
    // For L2, lower distance is better, so we return distance directly (not negated)
    // For cosine/dot, higher is better
    const results = candidates.slice(0, k).map((c) => ({
      id: c.id,
      score: this._config.metric === 'l2' ? c.distance : c.distance,
    }))

    // Sort by score (higher is better for cosine/dot, lower for l2)
    if (this.higherIsBetter) {
      results.sort((a, b) => b.score - a.score)
    } else {
      results.sort((a, b) => a.score - b.score)
    }

    return results
  }

  delete(id: string): boolean {
    const node = this.nodes.get(id)
    if (!node) {
      return false
    }

    // Remove node and vector first
    this.nodes.delete(id)
    this.vectors.delete(id)

    // Remove from all neighbor lists of all other nodes
    for (const otherNode of this.nodes.values()) {
      for (let level = 0; level <= otherNode.level; level++) {
        if (otherNode.neighbors[level]) {
          otherNode.neighbors[level] = otherNode.neighbors[level]!.filter(
            (n) => n !== id
          )
        }
      }
    }

    // Update entry point if needed
    if (this.entryPointId === id) {
      if (this.nodes.size === 0) {
        this.entryPointId = null
        this.maxLevel = -1
      } else {
        // Find new entry point with highest level
        let newEntryId: string | null = null
        let newMaxLevel = -1

        for (const [nodeId, n] of this.nodes) {
          if (n.level > newMaxLevel) {
            newMaxLevel = n.level
            newEntryId = nodeId
          }
        }

        this.entryPointId = newEntryId
        this.maxLevel = newMaxLevel
      }
    }

    return true
  }

  // ============================================================================
  // ACCESSORS
  // ============================================================================

  size(): number {
    return this.nodes.size
  }

  dimensions(): number {
    return this._config.dimensions
  }

  has(id: string): boolean {
    return this.nodes.has(id)
  }

  config(): ResolvedHNSWConfig {
    return { ...this._config }
  }

  getNode(id: string): HNSWNode | undefined {
    const node = this.nodes.get(id)
    if (!node) return undefined
    return {
      id: node.id,
      level: node.level,
      neighbors: node.neighbors.map((n) => [...n]),
    }
  }

  getVector(id: string): Float32Array | undefined {
    const vec = this.vectors.get(id)
    if (!vec) return undefined
    return new Float32Array(vec)
  }

  getEntryPoint(): EntryPoint | undefined {
    if (!this.entryPointId) return undefined
    const node = this.nodes.get(this.entryPointId)
    if (!node) return undefined
    return { id: node.id, level: node.level }
  }

  // ============================================================================
  // STATS
  // ============================================================================

  getStats(): HNSWStats {
    const layerDistribution: number[] = []
    const connectionSums: number[] = []
    const connectionCounts: number[] = []

    for (let level = 0; level <= this.maxLevel; level++) {
      layerDistribution.push(0)
      connectionSums.push(0)
      connectionCounts.push(0)
    }

    for (const node of this.nodes.values()) {
      for (let level = 0; level <= node.level; level++) {
        layerDistribution[level]!++
        connectionSums[level]! += node.neighbors[level]?.length ?? 0
        connectionCounts[level]!++
      }
    }

    const avgConnections = layerDistribution.map((count, level) =>
      count > 0 ? connectionSums[level]! / count : 0
    )

    // Estimate memory usage
    const vectorBytes = this.nodes.size * this._config.dimensions * 4
    let edgeBytes = 0
    for (const node of this.nodes.values()) {
      for (const neighbors of node.neighbors) {
        edgeBytes += neighbors.length * 8 // Assuming 8 bytes per edge reference
      }
    }
    const overheadBytes = this.nodes.size * 100 // Rough estimate for node overhead

    return {
      size: this.nodes.size,
      dimensions: this._config.dimensions,
      maxLevel: this.maxLevel,
      layerDistribution,
      avgConnections,
      memoryBytes: vectorBytes + edgeBytes + overheadBytes,
    }
  }

  // ============================================================================
  // SERIALIZATION
  // ============================================================================

  serialize(): ArrayBuffer {
    const json = this.toJSON()
    const jsonString = JSON.stringify(json)
    const encoder = new TextEncoder()
    return encoder.encode(jsonString).buffer as ArrayBuffer
  }

  static deserialize(buffer: ArrayBuffer): HNSWIndexImpl {
    const decoder = new TextDecoder()
    const jsonString = decoder.decode(buffer)
    const json = JSON.parse(jsonString) as HNSWJson
    return HNSWIndexImpl.fromJSON(json)
  }

  toJSON(): HNSWJson {
    const vectors: Record<string, number[]> = {}
    for (const [id, vec] of this.vectors) {
      vectors[id] = Array.from(vec)
    }

    return {
      config: this._config,
      nodes: Array.from(this.nodes.values()),
      vectors,
      entryPointId: this.entryPointId,
    }
  }

  static fromJSON(json: HNSWJson): HNSWIndexImpl {
    const index = new HNSWIndexImpl({
      dimensions: json.config.dimensions,
      M: json.config.M,
      efConstruction: json.config.efConstruction,
      metric: json.config.metric,
    })

    // Restore nodes
    for (const node of json.nodes) {
      index.nodes.set(node.id, node)
    }

    // Restore vectors
    for (const [id, values] of Object.entries(json.vectors)) {
      index.vectors.set(id, new Float32Array(values))
    }

    // Restore entry point
    index.entryPointId = json.entryPointId

    // Compute max level
    index.maxLevel = -1
    for (const node of index.nodes.values()) {
      if (node.level > index.maxLevel) {
        index.maxLevel = node.level
      }
    }

    return index
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private generateLevel(): number {
    // Random level generation with exponential distribution
    const r = Math.random()
    return Math.floor(-Math.log(r) * this._config.ml)
  }

  private greedySearchAtLevel(query: Float32Array, startId: string, level: number): string {
    let currentId = startId
    let currentDist = this.distance(query, this.vectors.get(currentId)!)
    let changed = true

    while (changed) {
      changed = false
      const node = this.nodes.get(currentId)!
      const neighbors = node.neighbors[level] ?? []

      for (const neighborId of neighbors) {
        const neighborVec = this.vectors.get(neighborId)
        if (!neighborVec) continue

        const dist = this.distance(query, neighborVec)
        if (this.isBetter(dist, currentDist)) {
          currentId = neighborId
          currentDist = dist
          changed = true
        }
      }
    }

    return currentId
  }

  private searchLayer(
    query: Float32Array,
    entryId: string,
    ef: number,
    level: number
  ): HeapItem[] {
    const visited = new Set<string>([entryId])
    const entryDist = this.distance(query, this.vectors.get(entryId)!)

    // For higherIsBetter (cosine/dot): use MaxHeap for candidates (best first), MinHeap for results (track worst to evict)
    // For lowerIsBetter (l2): use MinHeap for candidates (best first), MaxHeap for results (track worst to evict)
    // Candidates: we want to explore the BEST candidates first
    // Results: we need to track the WORST result to know when to evict
    const candidates = this.higherIsBetter ? new MaxHeap() : new MinHeap()
    const results = this.higherIsBetter ? new MinHeap() : new MaxHeap()

    candidates.push({ id: entryId, distance: entryDist })
    results.push({ id: entryId, distance: entryDist })

    while (candidates.size() > 0) {
      const current = candidates.pop()!

      // Check if we can stop
      // The worst result is what peek() returns from our results heap
      const worstResult = results.peek()
      if (
        worstResult &&
        results.size() >= ef &&
        this.isBetter(worstResult.distance, current.distance)
      ) {
        // The current best candidate is worse than our worst result, so stop
        break
      }

      const node = this.nodes.get(current.id)
      if (!node) continue

      const neighbors = node.neighbors[level] ?? []

      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) continue
        visited.add(neighborId)

        const neighborVec = this.vectors.get(neighborId)
        if (!neighborVec) continue

        const dist = this.distance(query, neighborVec)
        const worstResultDist = results.peek()?.distance

        if (
          results.size() < ef ||
          !worstResultDist ||
          this.isBetter(dist, worstResultDist)
        ) {
          candidates.push({ id: neighborId, distance: dist })
          results.push({ id: neighborId, distance: dist })

          if (results.size() > ef) {
            results.pop() // Remove the worst result
          }
        }
      }
    }

    // Convert to sorted array
    const resultArray = results.toArray()
    if (this.higherIsBetter) {
      resultArray.sort((a, b) => b.distance - a.distance)
    } else {
      resultArray.sort((a, b) => a.distance - b.distance)
    }
    return resultArray
  }

  private selectNeighbors(
    query: Float32Array,
    candidates: HeapItem[],
    level: number
  ): HeapItem[] {
    const maxConn = level === 0 ? this._config.maxM0 : this._config.maxM

    // Simple selection: take top maxConn
    // More sophisticated: use heuristic to ensure diversity
    if (this.higherIsBetter) {
      candidates.sort((a, b) => b.distance - a.distance)
    } else {
      candidates.sort((a, b) => a.distance - b.distance)
    }

    return candidates.slice(0, maxConn)
  }

  private pruneConnections(node: HNSWNode, level: number, maxConn: number): void {
    const nodeVec = this.vectors.get(node.id)
    if (!nodeVec) return

    const neighbors = node.neighbors[level]!

    // Calculate distances to all neighbors (filter out any that may have been deleted)
    const scored: HeapItem[] = []
    for (const neighborId of neighbors) {
      const neighborVec = this.vectors.get(neighborId)
      if (neighborVec) {
        scored.push({
          id: neighborId,
          distance: this.distance(nodeVec, neighborVec),
        })
      }
    }

    // Sort and keep best
    if (this.higherIsBetter) {
      scored.sort((a, b) => b.distance - a.distance)
    } else {
      scored.sort((a, b) => a.distance - b.distance)
    }

    node.neighbors[level] = scored.slice(0, maxConn).map((s) => s.id)
  }

  private distance(a: Float32Array, b: Float32Array): number {
    return this.distanceFn(a, b)
  }

  private isBetter(newDist: number, oldDist: number): boolean {
    return this.higherIsBetter ? newDist > oldDist : newDist < oldDist
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new HNSW index with the given configuration.
 *
 * This is the recommended way to create an HNSW index. The function
 * validates the configuration and returns an initialized index ready for use.
 *
 * @param config - Index configuration including dimensions and metric
 * @returns A new HNSW index instance
 *
 * @example Create index for semantic search
 * ```typescript
 * const index = createHNSWIndex({
 *   dimensions: 768,
 *   metric: 'cosine',
 *   M: 16,
 *   efConstruction: 200
 * })
 * ```
 *
 * @example Create index for image similarity (Euclidean)
 * ```typescript
 * const index = createHNSWIndex({
 *   dimensions: 512,
 *   metric: 'l2',
 *   M: 32,
 *   efConstruction: 400
 * })
 * ```
 *
 * @throws {Error} If dimensions is not positive
 * @throws {Error} If M is less than 2
 * @throws {Error} If efConstruction is less than M
 */
export function createHNSWIndex(config: HNSWConfig): HNSWIndex {
  return new HNSWIndexImpl(config)
}
