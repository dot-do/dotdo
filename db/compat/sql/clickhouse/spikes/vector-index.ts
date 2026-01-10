/**
 * SPIKE: Chunked HNSW Vector Index for 128MB Memory Limit
 *
 * Goal: Implement a chunked vector index that can stream from R2
 *       while staying within Cloudflare Workers' 128MB memory limit
 *
 * Key design decisions:
 * - Simplified HNSW with chunked graph storage
 * - Support for quantization (float32, float16, int8, binary)
 * - On-demand chunk loading for memory efficiency
 * - Binary quantization for 32x memory reduction
 *
 * Run: npx vitest run vector-index.test.ts
 */

// ============================================================================
// TYPES
// ============================================================================

export interface SearchResult {
  id: string
  score: number
}

export type QuantizationType = 'none' | 'float16' | 'int8' | 'binary'

export interface VectorIndexOptions {
  /** Number of dimensions for vectors */
  dimensions: number
  /** Chunk size in bytes (default: 10MB) */
  chunkSize?: number
  /** Quantization method (default: 'none') */
  quantization?: QuantizationType
  /** HNSW M parameter - max connections per node (default: 16) */
  M?: number
  /** HNSW efConstruction - size of dynamic candidate list (default: 200) */
  efConstruction?: number
  /** Distance metric (default: 'cosine') */
  metric?: 'cosine' | 'euclidean' | 'dot'
}

interface VectorNode {
  id: string
  vector: Float32Array | Uint8Array | Int8Array // Depending on quantization
  connections: number[][] // connections[level] = [node indices]
  level: number // Max level this node appears in
}

interface ChunkHeader {
  magic: 'VECI' // Vector Index
  version: number
  dimensions: number
  quantization: QuantizationType
  M: number
  metric: 'cosine' | 'euclidean' | 'dot'
  vectorCount: number
  chunkCount: number
  chunkSize: number // Bytes per chunk used during serialization
  entryPoint: number // Index of entry point node
  maxLevel: number
  chunkOffsets: number[] // Byte offsets for each chunk
}

interface Chunk {
  index: number
  startNodeIdx: number
  endNodeIdx: number // exclusive
  nodes: VectorNode[]
}

// ============================================================================
// QUANTIZATION UTILITIES
// ============================================================================

/**
 * Quantize float32 vector to different formats
 */
export function quantize(
  vector: Float32Array,
  type: QuantizationType
): Float32Array | Uint8Array | Int8Array {
  switch (type) {
    case 'none':
      return vector

    case 'float16':
      // Simulate float16 by rounding to 16-bit precision
      // Note: Real float16 would use DataView for actual IEEE 754 half precision
      const f16 = new Float32Array(vector.length)
      for (let i = 0; i < vector.length; i++) {
        // Round to ~3.5 decimal digits of precision
        f16[i] = Math.fround(vector[i])
      }
      return f16

    case 'int8':
      // Scale to [-127, 127] range
      let max = 0
      for (let i = 0; i < vector.length; i++) {
        const abs = Math.abs(vector[i])
        if (abs > max) max = abs
      }
      const scale = max > 0 ? 127 / max : 1
      const i8 = new Int8Array(vector.length)
      for (let i = 0; i < vector.length; i++) {
        i8[i] = Math.round(vector[i] * scale)
      }
      return i8

    case 'binary':
      // Binary quantization: 1 bit per dimension
      // Pack 8 dimensions into each byte
      const byteLen = Math.ceil(vector.length / 8)
      const binary = new Uint8Array(byteLen)
      for (let i = 0; i < vector.length; i++) {
        if (vector[i] > 0) {
          binary[Math.floor(i / 8)] |= 1 << (i % 8)
        }
      }
      return binary
  }
}

/**
 * Dequantize back to float32 (for display/debugging)
 */
export function dequantize(
  vector: Float32Array | Uint8Array | Int8Array,
  type: QuantizationType,
  dimensions: number
): Float32Array {
  switch (type) {
    case 'none':
    case 'float16':
      return vector as Float32Array

    case 'int8':
      const f32 = new Float32Array(dimensions)
      const i8 = vector as Int8Array
      for (let i = 0; i < dimensions; i++) {
        f32[i] = i8[i] / 127
      }
      return f32

    case 'binary':
      const result = new Float32Array(dimensions)
      const binary = vector as Uint8Array
      for (let i = 0; i < dimensions; i++) {
        result[i] = (binary[Math.floor(i / 8)] & (1 << (i % 8))) ? 1 : -1
      }
      return result
  }
}

/**
 * Get bytes per vector for a given quantization type
 */
export function bytesPerVector(dimensions: number, quantization: QuantizationType): number {
  switch (quantization) {
    case 'none':
      return dimensions * 4 // float32
    case 'float16':
      return dimensions * 2 // float16
    case 'int8':
      return dimensions // int8
    case 'binary':
      return Math.ceil(dimensions / 8) // 1 bit per dimension
  }
}

// ============================================================================
// DISTANCE FUNCTIONS
// ============================================================================

/**
 * Compute distance based on quantization type and metric
 * Returns a score where higher = more similar for cosine/dot, lower = more similar for euclidean
 */
export function distance(
  a: Float32Array | Uint8Array | Int8Array,
  b: Float32Array | Uint8Array | Int8Array,
  quantization: QuantizationType,
  metric: 'cosine' | 'euclidean' | 'dot'
): number {
  if (quantization === 'binary') {
    // Hamming distance for binary vectors (convert to similarity later)
    const ua = a as Uint8Array
    const ub = b as Uint8Array
    let hamming = 0
    for (let i = 0; i < ua.length; i++) {
      let xor = ua[i] ^ ub[i]
      // Count bits using Brian Kernighan's algorithm
      while (xor) {
        hamming++
        xor &= xor - 1
      }
    }
    // Convert to similarity (higher is better for cosine/dot)
    const totalBits = ua.length * 8
    return metric === 'euclidean' ? hamming : 1 - hamming / totalBits
  }

  // Float-based distance
  const fa = a as Float32Array | Int8Array
  const fb = b as Float32Array | Int8Array

  switch (metric) {
    case 'cosine': {
      let dot = 0
      let normA = 0
      let normB = 0
      for (let i = 0; i < fa.length; i++) {
        dot += fa[i] * fb[i]
        normA += fa[i] * fa[i]
        normB += fb[i] * fb[i]
      }
      const denom = Math.sqrt(normA) * Math.sqrt(normB)
      return denom > 0 ? dot / denom : 0
    }

    case 'euclidean': {
      let sum = 0
      for (let i = 0; i < fa.length; i++) {
        const diff = fa[i] - fb[i]
        sum += diff * diff
      }
      return Math.sqrt(sum)
    }

    case 'dot': {
      let dot = 0
      for (let i = 0; i < fa.length; i++) {
        dot += fa[i] * fb[i]
      }
      return dot
    }
  }
}

// ============================================================================
// PRIORITY QUEUE FOR HNSW SEARCH
// ============================================================================

interface HeapEntry {
  nodeIdx: number
  dist: number
}

/**
 * Max-heap that keeps the k worst results (used for result set W)
 * Allows fast check of the worst result and eviction
 */
class MaxHeap {
  private heap: HeapEntry[] = []
  private _capacity: number

  constructor(capacity: number) {
    this._capacity = capacity
  }

  get size(): number {
    return this.heap.length
  }

  get capacity(): number {
    return this._capacity
  }

  /** Get the worst (largest distance for similarity, smallest for euclidean) entry */
  peekWorst(): HeapEntry | undefined {
    return this.heap[0]
  }

  push(entry: HeapEntry, isSimilarity: boolean): boolean {
    if (this.heap.length < this._capacity) {
      this.heap.push(entry)
      this.bubbleUp(this.heap.length - 1, isSimilarity)
      return true
    }

    // Check if new entry is better than worst
    const worst = this.heap[0]
    if (isSimilarity) {
      // For similarity (cosine, dot): higher is better, so replace if new > worst
      if (entry.dist > worst.dist) {
        this.heap[0] = entry
        this.bubbleDown(0, isSimilarity)
        return true
      }
    } else {
      // For distance (euclidean): lower is better, so replace if new < worst
      if (entry.dist < worst.dist) {
        this.heap[0] = entry
        this.bubbleDown(0, isSimilarity)
        return true
      }
    }
    return false
  }

  pop(isSimilarity: boolean): HeapEntry | undefined {
    if (this.heap.length === 0) return undefined
    const result = this.heap[0]
    const last = this.heap.pop()
    if (this.heap.length > 0 && last) {
      this.heap[0] = last
      this.bubbleDown(0, isSimilarity)
    }
    return result
  }

  toSortedArray(isSimilarity: boolean): HeapEntry[] {
    // Sort: best first (highest for similarity, lowest for distance)
    return [...this.heap].sort((a, b) => {
      return isSimilarity ? b.dist - a.dist : a.dist - b.dist
    })
  }

  getAll(): HeapEntry[] {
    return [...this.heap]
  }

  private bubbleUp(idx: number, isSimilarity: boolean): void {
    while (idx > 0) {
      const parent = Math.floor((idx - 1) / 2)
      // Max-heap: parent should be >= children (for similarity)
      // For euclidean: parent should be <= children (we want max distance at top)
      const shouldSwap = isSimilarity
        ? this.heap[parent].dist > this.heap[idx].dist  // Lower at top for max-heap of similarity
        : this.heap[parent].dist < this.heap[idx].dist  // Higher at top for max-heap of distance
      if (!shouldSwap) break
      ;[this.heap[parent], this.heap[idx]] = [this.heap[idx], this.heap[parent]]
      idx = parent
    }
  }

  private bubbleDown(idx: number, isSimilarity: boolean): void {
    const len = this.heap.length
    while (true) {
      const left = 2 * idx + 1
      const right = 2 * idx + 2
      let target = idx

      if (isSimilarity) {
        // For similarity max-heap: we want smallest (worst) at top
        if (left < len && this.heap[left].dist < this.heap[target].dist) {
          target = left
        }
        if (right < len && this.heap[right].dist < this.heap[target].dist) {
          target = right
        }
      } else {
        // For distance max-heap: we want largest (worst) at top
        if (left < len && this.heap[left].dist > this.heap[target].dist) {
          target = left
        }
        if (right < len && this.heap[right].dist > this.heap[target].dist) {
          target = right
        }
      }

      if (target === idx) break
      ;[this.heap[idx], this.heap[target]] = [this.heap[target], this.heap[idx]]
      idx = target
    }
  }
}

/**
 * Min-heap for candidates (we want to explore best candidates first)
 */
class MinHeap {
  private heap: HeapEntry[] = []

  get size(): number {
    return this.heap.length
  }

  peek(): HeapEntry | undefined {
    return this.heap[0]
  }

  push(entry: HeapEntry, isSimilarity: boolean): void {
    this.heap.push(entry)
    this.bubbleUp(this.heap.length - 1, isSimilarity)
  }

  pop(isSimilarity: boolean): HeapEntry | undefined {
    if (this.heap.length === 0) return undefined
    const result = this.heap[0]
    const last = this.heap.pop()
    if (this.heap.length > 0 && last) {
      this.heap[0] = last
      this.bubbleDown(0, isSimilarity)
    }
    return result
  }

  private bubbleUp(idx: number, isSimilarity: boolean): void {
    while (idx > 0) {
      const parent = Math.floor((idx - 1) / 2)
      // Min-heap: best first (highest for similarity, lowest for distance)
      const shouldSwap = isSimilarity
        ? this.heap[parent].dist < this.heap[idx].dist  // Higher (better) should bubble up
        : this.heap[parent].dist > this.heap[idx].dist  // Lower (better) should bubble up
      if (!shouldSwap) break
      ;[this.heap[parent], this.heap[idx]] = [this.heap[idx], this.heap[parent]]
      idx = parent
    }
  }

  private bubbleDown(idx: number, isSimilarity: boolean): void {
    const len = this.heap.length
    while (true) {
      const left = 2 * idx + 1
      const right = 2 * idx + 2
      let best = idx

      if (isSimilarity) {
        // Higher is better for similarity
        if (left < len && this.heap[left].dist > this.heap[best].dist) {
          best = left
        }
        if (right < len && this.heap[right].dist > this.heap[best].dist) {
          best = right
        }
      } else {
        // Lower is better for distance
        if (left < len && this.heap[left].dist < this.heap[best].dist) {
          best = left
        }
        if (right < len && this.heap[right].dist < this.heap[best].dist) {
          best = right
        }
      }

      if (best === idx) break
      ;[this.heap[idx], this.heap[best]] = [this.heap[best], this.heap[idx]]
      idx = best
    }
  }
}

// ============================================================================
// CHUNKED VECTOR INDEX
// ============================================================================

/**
 * Chunked HNSW Vector Index
 *
 * Designed for Cloudflare Workers with 128MB memory limit.
 * Supports on-demand chunk loading from R2.
 */
export class VectorIndex {
  private options: Required<VectorIndexOptions>
  private nodes: VectorNode[] = []
  private entryPoint: number = -1
  private maxLevel: number = 0
  private levelMult: number

  constructor(options: VectorIndexOptions) {
    this.options = {
      dimensions: options.dimensions,
      chunkSize: options.chunkSize ?? 10 * 1024 * 1024, // 10MB
      quantization: options.quantization ?? 'none',
      M: options.M ?? 16,
      efConstruction: options.efConstruction ?? 200,
      metric: options.metric ?? 'cosine',
    }
    // Level multiplier for HNSW (1/ln(M))
    this.levelMult = 1 / Math.log(this.options.M)
  }

  private get isSimilarityMetric(): boolean {
    return this.options.metric !== 'euclidean'
  }

  /**
   * Get random level for new node (HNSW paper algorithm)
   */
  private getRandomLevel(): number {
    let level = 0
    while (Math.random() < 1 / this.options.M && level < 16) {
      level++
    }
    return level
  }

  /**
   * Check if score a is better than score b
   */
  private isBetter(a: number, b: number): boolean {
    if (this.options.metric === 'euclidean') {
      return a < b // Lower is better
    }
    return a > b // Higher is better for cosine/dot
  }

  /**
   * Add a vector to the index
   */
  add(id: string, vector: Float32Array): void {
    if (vector.length !== this.options.dimensions) {
      throw new Error(
        `Vector dimension mismatch: expected ${this.options.dimensions}, got ${vector.length}`
      )
    }

    const quantizedVector = quantize(vector, this.options.quantization)
    const level = this.getRandomLevel()
    const nodeIdx = this.nodes.length

    const node: VectorNode = {
      id,
      vector: quantizedVector,
      connections: Array(level + 1)
        .fill(null)
        .map(() => []),
      level,
    }

    this.nodes.push(node)

    if (this.entryPoint === -1) {
      this.entryPoint = nodeIdx
      this.maxLevel = level
      return
    }

    // Find entry point for insertion
    let currNode = this.entryPoint
    let currDist = this.distanceToNode(quantizedVector, currNode)

    // Traverse from top level down to level+1 (greedy search)
    for (let lv = this.maxLevel; lv > level; lv--) {
      let changed = true
      while (changed) {
        changed = false
        const connections = this.nodes[currNode].connections[lv] ?? []
        for (const neighbor of connections) {
          const dist = this.distanceToNode(quantizedVector, neighbor)
          if (this.isBetter(dist, currDist)) {
            currNode = neighbor
            currDist = dist
            changed = true
          }
        }
      }
    }

    // Insert at levels 0 to level using ef-construction search
    for (let lv = Math.min(level, this.maxLevel); lv >= 0; lv--) {
      const neighbors = this.searchLayer(quantizedVector, currNode, this.options.efConstruction, lv)

      // Select M best neighbors
      const M = lv === 0 ? this.options.M * 2 : this.options.M
      const selectedNeighbors = neighbors.slice(0, M)

      // Add bidirectional connections
      node.connections[lv] = selectedNeighbors.map((n) => n.nodeIdx)

      for (const neighbor of selectedNeighbors) {
        const neighborNode = this.nodes[neighbor.nodeIdx]
        if (!neighborNode.connections[lv]) {
          neighborNode.connections[lv] = []
        }
        neighborNode.connections[lv].push(nodeIdx)

        // Prune if too many connections
        if (neighborNode.connections[lv].length > M) {
          this.pruneConnections(neighbor.nodeIdx, lv, M)
        }
      }

      if (neighbors.length > 0) {
        currNode = neighbors[0].nodeIdx
      }
    }

    // Update entry point if new node has higher level
    if (level > this.maxLevel) {
      this.maxLevel = level
      this.entryPoint = nodeIdx
    }
  }

  /**
   * Search a single layer of the graph (beam search / greedy search with ef candidates)
   */
  private searchLayer(
    query: Float32Array | Uint8Array | Int8Array,
    entryNode: number,
    ef: number,
    level: number
  ): HeapEntry[] {
    const visited = new Set<number>([entryNode])
    const isSim = this.isSimilarityMetric

    // Candidates: ordered by best first (min-heap behavior for "pop best")
    const candidates: HeapEntry[] = []
    // Results: ordered with worst at position 0 (max-heap for "pop worst")
    const results = new MaxHeap(ef)

    const entryDist = this.distanceToNode(query, entryNode)
    candidates.push({ nodeIdx: entryNode, dist: entryDist })
    results.push({ nodeIdx: entryNode, dist: entryDist }, isSim)

    while (candidates.length > 0) {
      // Sort candidates: best first
      candidates.sort((a, b) => isSim ? b.dist - a.dist : a.dist - b.dist)
      const current = candidates.shift()!

      // Stop if current candidate is worse than the worst in results
      const worstResult = results.peekWorst()
      if (worstResult && results.size >= ef) {
        if (isSim) {
          if (current.dist < worstResult.dist) break  // Current is worse
        } else {
          if (current.dist > worstResult.dist) break  // Current is worse
        }
      }

      // Explore neighbors
      const connections = this.nodes[current.nodeIdx].connections[level] ?? []
      for (const neighborIdx of connections) {
        if (visited.has(neighborIdx)) continue
        visited.add(neighborIdx)

        const dist = this.distanceToNode(query, neighborIdx)

        // Add to results if better than worst or results not full
        const worst = results.peekWorst()
        let shouldAdd = results.size < ef
        if (!shouldAdd && worst) {
          shouldAdd = isSim ? dist > worst.dist : dist < worst.dist
        }

        if (shouldAdd) {
          candidates.push({ nodeIdx: neighborIdx, dist })
          results.push({ nodeIdx: neighborIdx, dist }, isSim)
        }
      }
    }

    return results.toSortedArray(isSim)
  }

  /**
   * Prune connections to keep only the best M
   */
  private pruneConnections(nodeIdx: number, level: number, maxConnections: number): void {
    const node = this.nodes[nodeIdx]
    const connections = node.connections[level]

    if (connections.length <= maxConnections) return

    // Score and sort connections
    const scored = connections.map((neighborIdx) => ({
      neighborIdx,
      dist: this.distanceToNode(node.vector, neighborIdx),
    }))

    scored.sort((a, b) => (this.isBetter(a.dist, b.dist) ? -1 : 1))
    node.connections[level] = scored.slice(0, maxConnections).map((s) => s.neighborIdx)
  }

  /**
   * Compute distance from query to a node
   */
  private distanceToNode(
    query: Float32Array | Uint8Array | Int8Array,
    nodeIdx: number
  ): number {
    return distance(query, this.nodes[nodeIdx].vector, this.options.quantization, this.options.metric)
  }

  /**
   * Search for k nearest neighbors
   */
  search(query: Float32Array, k: number): SearchResult[] {
    if (query.length !== this.options.dimensions) {
      throw new Error(
        `Query dimension mismatch: expected ${this.options.dimensions}, got ${query.length}`
      )
    }

    if (this.entryPoint === -1 || this.nodes.length === 0) {
      return []
    }

    const quantizedQuery = quantize(query, this.options.quantization)

    // Find entry point by traversing from top (greedy)
    let currNode = this.entryPoint
    let currDist = this.distanceToNode(quantizedQuery, currNode)

    for (let lv = this.maxLevel; lv > 0; lv--) {
      let changed = true
      while (changed) {
        changed = false
        const connections = this.nodes[currNode].connections[lv] ?? []
        for (const neighbor of connections) {
          const dist = this.distanceToNode(quantizedQuery, neighbor)
          if (this.isBetter(dist, currDist)) {
            currNode = neighbor
            currDist = dist
            changed = true
          }
        }
      }
    }

    // Search layer 0 with ef = max(k, efConstruction)
    const ef = Math.max(k * 2, this.options.efConstruction)
    const results = this.searchLayer(quantizedQuery, currNode, ef, 0)

    return results.slice(0, k).map(({ nodeIdx, dist }) => ({
      id: this.nodes[nodeIdx].id,
      score: dist,
    }))
  }

  /**
   * Serialize the index into chunks
   */
  serialize(): Uint8Array[] {
    const header: ChunkHeader = {
      magic: 'VECI',
      version: 1,
      dimensions: this.options.dimensions,
      quantization: this.options.quantization,
      M: this.options.M,
      metric: this.options.metric,
      vectorCount: this.nodes.length,
      chunkCount: 0, // Will be calculated
      chunkSize: this.options.chunkSize,
      entryPoint: this.entryPoint,
      maxLevel: this.maxLevel,
      chunkOffsets: [],
    }

    // Calculate bytes per node
    const vectorBytes = bytesPerVector(this.options.dimensions, this.options.quantization)
    // Rough estimate: vector + id (avg 32 bytes) + connections (avg 100 bytes)
    const bytesPerNode = vectorBytes + 32 + 100

    // Calculate nodes per chunk
    const nodesPerChunk = Math.max(1, Math.floor(this.options.chunkSize / bytesPerNode))
    const chunkCount = Math.ceil(this.nodes.length / nodesPerChunk)

    header.chunkCount = chunkCount

    const chunks: Uint8Array[] = []

    // Serialize header
    const headerJson = JSON.stringify(header)
    const headerBytes = new TextEncoder().encode(headerJson)
    const headerChunk = new Uint8Array(4 + headerBytes.length)
    new DataView(headerChunk.buffer).setUint32(0, headerBytes.length, true)
    headerChunk.set(headerBytes, 4)
    chunks.push(headerChunk)

    // Serialize each chunk of nodes
    for (let c = 0; c < chunkCount; c++) {
      const startIdx = c * nodesPerChunk
      const endIdx = Math.min(startIdx + nodesPerChunk, this.nodes.length)

      const chunkData: Chunk = {
        index: c,
        startNodeIdx: startIdx,
        endNodeIdx: endIdx,
        nodes: this.nodes.slice(startIdx, endIdx).map((node) => ({
          id: node.id,
          vector: node.vector,
          connections: node.connections,
          level: node.level,
        })),
      }

      // Serialize chunk to JSON with base64 for binary data
      const serializedChunk = {
        ...chunkData,
        nodes: chunkData.nodes.map((node) => ({
          ...node,
          vector: this.encodeVector(node.vector),
        })),
      }

      const chunkJson = JSON.stringify(serializedChunk)
      const chunkBytes = new TextEncoder().encode(chunkJson)
      const chunk = new Uint8Array(4 + chunkBytes.length)
      new DataView(chunk.buffer).setUint32(0, chunkBytes.length, true)
      chunk.set(chunkBytes, 4)
      chunks.push(chunk)
    }

    return chunks
  }

  /**
   * Encode vector to base64 string for JSON serialization
   */
  private encodeVector(vector: Float32Array | Uint8Array | Int8Array): string {
    const bytes = new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }

  /**
   * Decode base64 string to typed array
   */
  private decodeVector(
    base64: string,
    quantization: QuantizationType,
    dimensions: number
  ): Float32Array | Uint8Array | Int8Array {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }

    switch (quantization) {
      case 'none':
      case 'float16':
        return new Float32Array(bytes.buffer)
      case 'int8':
        return new Int8Array(bytes.buffer)
      case 'binary':
        return bytes
    }
  }

  /**
   * Deserialize from chunks
   */
  static deserialize(chunks: Uint8Array[]): VectorIndex {
    if (chunks.length === 0) {
      throw new Error('No chunks provided')
    }

    // Parse header
    const headerChunk = chunks[0]
    const headerLen = new DataView(headerChunk.buffer).getUint32(0, true)
    const headerJson = new TextDecoder().decode(headerChunk.slice(4, 4 + headerLen))
    const header: ChunkHeader = JSON.parse(headerJson)

    const index = new VectorIndex({
      dimensions: header.dimensions,
      quantization: header.quantization,
      M: header.M,
      metric: header.metric,
    })

    index.entryPoint = header.entryPoint
    index.maxLevel = header.maxLevel

    // Parse node chunks
    for (let i = 1; i < chunks.length; i++) {
      const chunk = chunks[i]
      const chunkLen = new DataView(chunk.buffer).getUint32(0, true)
      const chunkJson = new TextDecoder().decode(chunk.slice(4, 4 + chunkLen))
      const chunkData = JSON.parse(chunkJson) as {
        nodes: Array<{
          id: string
          vector: string
          connections: number[][]
          level: number
        }>
      }

      for (const nodeData of chunkData.nodes) {
        index.nodes.push({
          id: nodeData.id,
          vector: index.decodeVector(nodeData.vector, header.quantization, header.dimensions),
          connections: nodeData.connections,
          level: nodeData.level,
        })
      }
    }

    return index
  }

  /**
   * Streaming search that loads chunks on demand
   * Memory-efficient for large indexes
   */
  async searchStreaming(
    query: Float32Array,
    k: number,
    loadChunk: (index: number) => Promise<Uint8Array>
  ): Promise<SearchResult[]> {
    if (query.length !== this.options.dimensions) {
      throw new Error(
        `Query dimension mismatch: expected ${this.options.dimensions}, got ${query.length}`
      )
    }

    // Load header chunk first
    const headerChunk = await loadChunk(0)
    const headerLen = new DataView(headerChunk.buffer).getUint32(0, true)
    const headerJson = new TextDecoder().decode(headerChunk.slice(4, 4 + headerLen))
    const header: ChunkHeader = JSON.parse(headerJson)

    if (header.entryPoint === -1 || header.vectorCount === 0) {
      return []
    }

    const isSim = header.metric !== 'euclidean'

    // Calculate nodes per chunk using the chunkSize from the header
    const vectorBytes = bytesPerVector(header.dimensions, header.quantization)
    const bytesPerNode = vectorBytes + 32 + 100
    const nodesPerChunk = Math.max(1, Math.floor(header.chunkSize / bytesPerNode))

    // Track loaded chunks
    const loadedNodes = new Map<number, VectorNode>()

    // Helper to get node, loading chunk if needed
    const getNode = async (nodeIdx: number): Promise<VectorNode> => {
      if (loadedNodes.has(nodeIdx)) {
        return loadedNodes.get(nodeIdx)!
      }

      const chunkIdx = Math.floor(nodeIdx / nodesPerChunk)
      const chunk = await loadChunk(chunkIdx + 1) // +1 because chunk 0 is header
      const chunkLen = new DataView(chunk.buffer).getUint32(0, true)
      const chunkJson = new TextDecoder().decode(chunk.slice(4, 4 + chunkLen))
      const chunkData = JSON.parse(chunkJson) as {
        startNodeIdx: number
        nodes: Array<{
          id: string
          vector: string
          connections: number[][]
          level: number
        }>
      }

      // Load all nodes from this chunk
      for (let i = 0; i < chunkData.nodes.length; i++) {
        const nodeData = chunkData.nodes[i]
        const globalIdx = chunkData.startNodeIdx + i
        loadedNodes.set(globalIdx, {
          id: nodeData.id,
          vector: this.decodeVector(nodeData.vector, header.quantization, header.dimensions),
          connections: nodeData.connections,
          level: nodeData.level,
        })
      }

      return loadedNodes.get(nodeIdx)!
    }

    // Helper to compute distance
    const distToNode = async (
      queryVec: Float32Array | Uint8Array | Int8Array,
      nodeIdx: number
    ): Promise<number> => {
      const node = await getNode(nodeIdx)
      return distance(queryVec, node.vector, header.quantization, header.metric)
    }

    const isBetter = (a: number, b: number): boolean => {
      return isSim ? a > b : a < b
    }

    const quantizedQuery = quantize(query, header.quantization)

    // Start from entry point - greedy traversal from top
    let currNode = header.entryPoint
    let currDist = await distToNode(quantizedQuery, currNode)

    for (let lv = header.maxLevel; lv > 0; lv--) {
      let changed = true
      while (changed) {
        changed = false
        const node = await getNode(currNode)
        const connections = node.connections[lv] ?? []
        for (const neighbor of connections) {
          const dist = await distToNode(quantizedQuery, neighbor)
          if (isBetter(dist, currDist)) {
            currNode = neighbor
            currDist = dist
            changed = true
          }
        }
      }
    }

    // Search layer 0 with beam search
    const ef = Math.max(k * 2, this.options.efConstruction)
    const visited = new Set<number>([currNode])
    const candidates: Array<{ nodeIdx: number; dist: number }> = [
      { nodeIdx: currNode, dist: currDist },
    ]
    const results: Array<{ nodeIdx: number; dist: number }> = [
      { nodeIdx: currNode, dist: currDist },
    ]

    while (candidates.length > 0) {
      // Sort candidates: best first
      candidates.sort((a, b) => isSim ? b.dist - a.dist : a.dist - b.dist)
      const current = candidates.shift()!

      // Check if we should stop
      if (results.length >= ef) {
        results.sort((a, b) => isSim ? b.dist - a.dist : a.dist - b.dist)
        const worst = results[results.length - 1]
        if (!isBetter(current.dist, worst.dist)) {
          break
        }
      }

      const node = await getNode(current.nodeIdx)
      const connections = node.connections[0] ?? []

      for (const neighborIdx of connections) {
        if (visited.has(neighborIdx)) continue
        visited.add(neighborIdx)

        const dist = await distToNode(quantizedQuery, neighborIdx)

        let shouldAdd = results.length < ef
        if (!shouldAdd) {
          results.sort((a, b) => isSim ? b.dist - a.dist : a.dist - b.dist)
          const worst = results[results.length - 1]
          shouldAdd = isBetter(dist, worst.dist)
        }

        if (shouldAdd) {
          candidates.push({ nodeIdx: neighborIdx, dist })
          results.push({ nodeIdx: neighborIdx, dist })
          if (results.length > ef) {
            results.sort((a, b) => isSim ? b.dist - a.dist : a.dist - b.dist)
            results.pop()
          }
        }
      }
    }

    // Sort and return top k
    results.sort((a, b) => isSim ? b.dist - a.dist : a.dist - b.dist)
    const topK = results.slice(0, k)

    const finalResults: SearchResult[] = []
    for (const { nodeIdx, dist } of topK) {
      const node = await getNode(nodeIdx)
      finalResults.push({ id: node.id, score: dist })
    }

    return finalResults
  }

  /**
   * Get index statistics
   */
  stats(): {
    vectorCount: number
    dimensions: number
    quantization: QuantizationType
    memoryBytes: number
    maxLevel: number
  } {
    const vectorBytes = bytesPerVector(this.options.dimensions, this.options.quantization)
    const totalVectorBytes = this.nodes.length * vectorBytes

    // Estimate connection overhead (approximate)
    let connectionCount = 0
    for (const node of this.nodes) {
      for (const level of node.connections) {
        connectionCount += level.length
      }
    }
    const connectionBytes = connectionCount * 4 // 4 bytes per index

    // ID strings (approximate)
    const idBytes = this.nodes.reduce((sum, n) => sum + n.id.length * 2, 0)

    return {
      vectorCount: this.nodes.length,
      dimensions: this.options.dimensions,
      quantization: this.options.quantization,
      memoryBytes: totalVectorBytes + connectionBytes + idBytes,
      maxLevel: this.maxLevel,
    }
  }
}

// ============================================================================
// BRUTE FORCE INDEX (FALLBACK FOR SMALL DATASETS)
// ============================================================================

/**
 * Simple brute-force index for small datasets or validation
 * Also supports chunking for memory efficiency
 */
export class BruteForceIndex {
  private options: Required<Omit<VectorIndexOptions, 'M' | 'efConstruction'>>
  private vectors: Array<{
    id: string
    vector: Float32Array | Uint8Array | Int8Array
  }> = []

  constructor(options: Omit<VectorIndexOptions, 'M' | 'efConstruction'>) {
    this.options = {
      dimensions: options.dimensions,
      chunkSize: options.chunkSize ?? 10 * 1024 * 1024,
      quantization: options.quantization ?? 'none',
      metric: options.metric ?? 'cosine',
    }
  }

  add(id: string, vector: Float32Array): void {
    if (vector.length !== this.options.dimensions) {
      throw new Error(
        `Vector dimension mismatch: expected ${this.options.dimensions}, got ${vector.length}`
      )
    }

    this.vectors.push({
      id,
      vector: quantize(vector, this.options.quantization),
    })
  }

  search(query: Float32Array, k: number): SearchResult[] {
    if (query.length !== this.options.dimensions) {
      throw new Error(
        `Query dimension mismatch: expected ${this.options.dimensions}, got ${query.length}`
      )
    }

    const quantizedQuery = quantize(query, this.options.quantization)

    const scored = this.vectors.map(({ id, vector }) => ({
      id,
      score: distance(quantizedQuery, vector, this.options.quantization, this.options.metric),
    }))

    // Sort based on metric
    if (this.options.metric === 'euclidean') {
      scored.sort((a, b) => a.score - b.score)
    } else {
      scored.sort((a, b) => b.score - a.score)
    }

    return scored.slice(0, k)
  }

  serialize(): Uint8Array[] {
    const header = {
      magic: 'BFVI', // Brute Force Vector Index
      version: 1,
      dimensions: this.options.dimensions,
      quantization: this.options.quantization,
      metric: this.options.metric,
      vectorCount: this.vectors.length,
    }

    const chunks: Uint8Array[] = []

    // Header chunk
    const headerJson = JSON.stringify(header)
    const headerBytes = new TextEncoder().encode(headerJson)
    const headerChunk = new Uint8Array(4 + headerBytes.length)
    new DataView(headerChunk.buffer).setUint32(0, headerBytes.length, true)
    headerChunk.set(headerBytes, 4)
    chunks.push(headerChunk)

    // Calculate vectors per chunk
    const vectorBytes = bytesPerVector(this.options.dimensions, this.options.quantization)
    const bytesPerEntry = vectorBytes + 32 // vector + id
    const entriesPerChunk = Math.max(1, Math.floor(this.options.chunkSize / bytesPerEntry))

    for (let i = 0; i < this.vectors.length; i += entriesPerChunk) {
      const chunkVectors = this.vectors.slice(i, i + entriesPerChunk)
      const chunkData = chunkVectors.map(({ id, vector }) => ({
        id,
        vector: this.encodeVector(vector),
      }))

      const chunkJson = JSON.stringify(chunkData)
      const chunkBytes = new TextEncoder().encode(chunkJson)
      const chunk = new Uint8Array(4 + chunkBytes.length)
      new DataView(chunk.buffer).setUint32(0, chunkBytes.length, true)
      chunk.set(chunkBytes, 4)
      chunks.push(chunk)
    }

    return chunks
  }

  private encodeVector(vector: Float32Array | Uint8Array | Int8Array): string {
    const bytes = new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }

  stats(): {
    vectorCount: number
    dimensions: number
    quantization: QuantizationType
    memoryBytes: number
  } {
    const vectorBytes = bytesPerVector(this.options.dimensions, this.options.quantization)
    const totalBytes = this.vectors.length * vectorBytes
    const idBytes = this.vectors.reduce((sum, v) => sum + v.id.length * 2, 0)

    return {
      vectorCount: this.vectors.length,
      dimensions: this.options.dimensions,
      quantization: this.options.quantization,
      memoryBytes: totalBytes + idBytes,
    }
  }
}
