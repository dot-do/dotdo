/**
 * HNSW Index Implementation
 *
 * Hierarchical Navigable Small World graph for approximate nearest neighbor search.
 * Optimized for Cloudflare Workers with:
 * - Configurable M and efConstruction parameters
 * - Support for cosine, L2, and dot product metrics
 * - Binary serialization for R2 persistence
 * - Memory-efficient Float32Array storage
 *
 * @module db/edgevec/hnsw
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
// DISTANCE FUNCTIONS
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
 * Cosine similarity (higher is better)
 */
function cosineDistance(a: Float32Array, b: Float32Array): number {
  validateVectorDimensions(a, b)
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

/**
 * L2 (Euclidean) distance (lower is better)
 */
function l2Distance(a: Float32Array, b: Float32Array): number {
  validateVectorDimensions(a, b)
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

/**
 * Dot product (higher is better)
 */
function dotDistance(a: Float32Array, b: Float32Array): number {
  validateVectorDimensions(a, b)
  let dot = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
  }
  return dot
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

    const candidates = new MinHeap()
    const results = new MaxHeap()

    candidates.push({ id: entryId, distance: entryDist })
    results.push({ id: entryId, distance: entryDist })

    while (candidates.size() > 0) {
      const current = candidates.pop()!

      // Check if we can stop
      const worstResult = results.peek()
      if (
        worstResult &&
        results.size() >= ef &&
        this.isBetter(worstResult.distance, current.distance)
      ) {
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
            results.pop()
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
 * Create a new HNSW index
 */
export function createHNSWIndex(config: HNSWConfig): HNSWIndex {
  return new HNSWIndexImpl(config)
}
