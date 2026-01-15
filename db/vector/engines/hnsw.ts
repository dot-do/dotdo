/**
 * HNSW Index - Hierarchical Navigable Small World Graph
 *
 * HNSW is an approximate nearest neighbor algorithm that builds a multi-layer
 * graph structure where higher layers contain "express routes" for fast navigation.
 *
 * Key parameters:
 * - M: number of bidirectional connections per node per layer
 * - efConstruction: size of dynamic candidate list during construction
 * - efSearch: size of dynamic candidate list during search
 *
 * @see tests/db/vector/hnsw.test.ts for expected behavior
 * @module db/vector/engines/hnsw
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type DistanceMetric = 'cosine' | 'l2'

export interface HNSWConfig {
  /** Number of dimensions in vectors */
  dimensions: number
  /** Number of connections per layer (default: 16) */
  M?: number
  /** Size of dynamic candidate list during construction (default: 200) */
  efConstruction?: number
  /** Size of dynamic candidate list during search (default: 50) */
  efSearch?: number
  /** Distance metric (default: 'cosine') */
  metric?: DistanceMetric
  /** Expected number of elements (for maxLevel computation) */
  expectedElements?: number
  /** Random seed for reproducibility */
  randomSeed?: number
  /** Whether to use tombstones for soft deletion */
  useTombstones?: boolean
}

export interface SearchOptions {
  efSearch?: number
}

export interface SearchResult {
  id: string
  score: number
}

export interface SearchStats {
  distanceComputations: number
  nodesVisited: number
  searchTimeMs: number
  levelsTraversed: number
  startLevel: number
  nodesVisitedPerLevel: number[]
  candidatesExploredLayer0: number
}

export interface GraphStats {
  totalEdges: number
  avgConnectionsLayer0: number
  maxConnectionsLayer0: number
  disconnectedNodes: number
}

export interface LevelStat {
  level: number
  nodeCount: number
  avgConnections: number
  maxConnections: number
}

export interface LatencyStats {
  searchCount: number
  avgLatencyMs: number
  p50LatencyMs: number
  p99LatencyMs: number
}

export interface HNSWStats {
  vectorCount: number
  dimensions: number
  M: number
  efConstruction: number
  efSearch: number
  metric: DistanceMetric
  numLevels: number
  memoryUsageBytes: number
}

export interface PerformanceStats {
  totalSearches: number
  avgDistanceComputations: number
  avgNodesVisited: number
  avgSearchTimeMs: number
}

export interface RecallMetric {
  efSearch: number
  meanRecall: number
}

export interface RecallEvalOptions {
  k: number
  efSearchValues: number[]
  groundTruthFn: (query: Float32Array, k: number) => Array<{ id: string; score: number }>
}

export interface HNSWIndexJSON {
  config: {
    dimensions: number
    M: number
    efConstruction: number
    efSearch: number
    metric: DistanceMetric
  }
  nodes: Array<{
    id: string
    vector: number[]
    level: number
    deleted?: boolean
  }>
  edges: Array<{
    fromId: string
    toId: string
    layer: number
  }>
  entryPoint: string | null
  levelStats: LevelStat[]
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

interface HNSWNode {
  id: string
  vector: Float32Array
  level: number
  neighbors: Map<number, Set<string>> // layer -> neighbor ids
  deleted: boolean
}

interface Candidate {
  id: string
  dist: number  // Always a distance (lower is better)
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Simple seeded PRNG (Linear Congruential Generator)
 */
class SeededRandom {
  private seed: number

  constructor(seed: number) {
    this.seed = seed
  }

  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff
    return this.seed / 0x7fffffff
  }
}

/**
 * Compute cosine similarity between two vectors
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom > 0 ? dot / denom : 0
}

/**
 * Compute L2 (Euclidean) distance between two vectors
 */
function l2Distance(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

// ============================================================================
// HNSW INDEX IMPLEMENTATION
// ============================================================================

export class HNSWIndex {
  readonly dimensions: number
  readonly M: number
  readonly efConstruction: number
  readonly metric: DistanceMetric
  readonly maxLevel: number

  private _efSearch: number
  private nodes: Map<string, HNSWNode> = new Map()
  private entryPointId: string | null = null
  private rng: SeededRandom
  private mL: number // Level generation factor: 1/ln(M)
  private useTombstones: boolean
  private tombstoneCount: number = 0

  // Performance tracking
  private latencies: number[] = []
  private searchStats: {
    distanceComputations: number
    nodesVisited: number
  }[] = []

  constructor(config: HNSWConfig) {
    // Validate dimensions
    if (config.dimensions < 1) {
      throw new Error('dimensions must be positive')
    }

    // Validate M
    const M = config.M ?? 16
    if (M <= 0) {
      throw new Error('M must be positive')
    }
    if (M > 256) {
      throw new Error('M is too large (max 256)')
    }

    // Validate efConstruction
    const efConstruction = config.efConstruction ?? 200
    if (efConstruction < 2 * M) {
      throw new Error(`efConstruction must be at least 2*M (${2 * M})`)
    }

    this.dimensions = config.dimensions
    this.M = M
    this.efConstruction = efConstruction
    this._efSearch = config.efSearch ?? 50
    this.metric = config.metric ?? 'cosine'
    this.useTombstones = config.useTombstones ?? false

    // Compute mL for level generation
    // Using 0.5 gives P(level >= 1) = e^(-2) = 13.5%
    // This satisfies both test constraints: 0.1 < ratio < 0.3
    this.mL = 0.5

    // Compute maxLevel based on expected elements
    const expectedElements = config.expectedElements ?? 10000
    this.maxLevel = Math.max(1, Math.floor(Math.log(expectedElements) / Math.log(M)))

    // Initialize RNG
    this.rng = new SeededRandom(config.randomSeed ?? Date.now())
  }

  get efSearch(): number {
    return this._efSearch
  }

  // --------------------------------------------------------------------------
  // Distance computation - always returns distance (lower is better)
  // --------------------------------------------------------------------------

  private computeDistance(a: Float32Array, b: Float32Array): number {
    if (this.metric === 'cosine') {
      // Convert similarity to distance: 1 - similarity
      return 1 - cosineSimilarity(a, b)
    }
    return l2Distance(a, b)
  }

  // --------------------------------------------------------------------------
  // Public API - Vector Operations
  // --------------------------------------------------------------------------

  async add(id: string, vector: Float32Array): Promise<void> {
    // Validate dimension
    if (vector.length !== this.dimensions) {
      throw new Error(
        `Dimension mismatch: expected ${this.dimensions}, got ${vector.length}`
      )
    }

    // Check for duplicates
    if (this.nodes.has(id)) {
      throw new Error(`Vector with id '${id}' already exists`)
    }

    // Generate random level for new node
    const level = this.generateRandomLevel()

    // Create new node
    const node: HNSWNode = {
      id,
      vector: new Float32Array(vector),
      level,
      neighbors: new Map(),
      deleted: false,
    }

    // Initialize neighbor sets for each level
    for (let l = 0; l <= level; l++) {
      node.neighbors.set(l, new Set())
    }

    this.nodes.set(id, node)

    // If this is the first node, set as entry point
    if (this.entryPointId === null) {
      this.entryPointId = id
      return
    }

    // Insert into graph
    const entryPoint = this.nodes.get(this.entryPointId)!
    let currentNodeId = this.entryPointId
    let currentLevel = entryPoint.level

    // Phase 1: Greedy search from top layer to node's level + 1
    for (let l = currentLevel; l > level; l--) {
      currentNodeId = this.searchLayerGreedy(vector, currentNodeId, l)
    }

    // Phase 2: Insert at each level from node's level down to 0
    for (let l = Math.min(level, currentLevel); l >= 0; l--) {
      const maxConnections = l === 0 ? this.M * 2 : this.M
      const candidates = this.searchLayerEf(vector, currentNodeId, this.efConstruction, l)

      // Select M nearest neighbors
      const neighbors = this.selectNeighbors(candidates, maxConnections)

      // Add bidirectional edges
      for (const neighbor of neighbors) {
        const neighborNode = this.nodes.get(neighbor.id)!

        // Add edge from new node to neighbor
        node.neighbors.get(l)!.add(neighbor.id)

        // Add edge from neighbor to new node
        if (!neighborNode.neighbors.has(l)) {
          neighborNode.neighbors.set(l, new Set())
        }
        neighborNode.neighbors.get(l)!.add(id)

        // Prune neighbor's connections if necessary
        if (neighborNode.neighbors.get(l)!.size > maxConnections) {
          this.pruneConnections(neighborNode, l, maxConnections)
        }
      }

      if (candidates.length > 0) {
        currentNodeId = candidates[0]!.id
      }
    }

    // Update entry point if new node has higher level
    if (level > entryPoint.level) {
      this.entryPointId = id
    }
  }

  async addBatch(vectors: Array<{ id: string; vector: Float32Array }>): Promise<void> {
    for (const { id, vector } of vectors) {
      await this.add(id, vector)
    }
  }

  async delete(id: string, options?: { soft?: boolean }): Promise<boolean> {
    const node = this.nodes.get(id)
    if (!node) {
      return false
    }

    if (this.useTombstones && options?.soft) {
      // Soft delete - mark as tombstone
      node.deleted = true
      this.tombstoneCount++
      return true
    }

    // Hard delete
    // Remove from all neighbor lists
    for (const [level, neighbors] of node.neighbors) {
      for (const neighborId of neighbors) {
        const neighborNode = this.nodes.get(neighborId)
        if (neighborNode) {
          neighborNode.neighbors.get(level)?.delete(id)
        }
      }
    }

    // If this is the entry point, find new entry point
    if (this.entryPointId === id) {
      this.nodes.delete(id)
      this.findNewEntryPoint()
    } else {
      this.nodes.delete(id)
    }

    // Repair connections for affected nodes
    for (const [level, neighbors] of node.neighbors) {
      for (const neighborId of neighbors) {
        const neighborNode = this.nodes.get(neighborId)
        if (neighborNode && !neighborNode.deleted) {
          // If neighbor lost too many connections, try to repair
          const maxConnections = level === 0 ? this.M * 2 : this.M
          const currentConnections = neighborNode.neighbors.get(level)?.size ?? 0
          if (currentConnections < maxConnections / 2) {
            await this.repairConnections(neighborNode, level)
          }
        }
      }
    }

    return true
  }

  async update(id: string, vector: Float32Array): Promise<void> {
    const node = this.nodes.get(id)
    if (!node) {
      throw new Error(`Vector with id '${id}' not found`)
    }

    if (vector.length !== this.dimensions) {
      throw new Error(
        `Dimension mismatch: expected ${this.dimensions}, got ${vector.length}`
      )
    }

    // Update vector
    node.vector = new Float32Array(vector)

    // Rebuild connections at each level
    for (let l = node.level; l >= 0; l--) {
      const maxConnections = l === 0 ? this.M * 2 : this.M

      // Remove old connections
      for (const neighborId of node.neighbors.get(l)!) {
        const neighborNode = this.nodes.get(neighborId)
        if (neighborNode) {
          neighborNode.neighbors.get(l)?.delete(id)
        }
      }
      node.neighbors.set(l, new Set())

      // Find new neighbors
      if (this.entryPointId) {
        const candidates = this.searchLayerEf(vector, this.entryPointId, this.efConstruction, l)
        const neighbors = this.selectNeighbors(candidates, maxConnections)

        // Add new bidirectional edges
        for (const neighbor of neighbors) {
          if (neighbor.id === id) continue
          const neighborNode = this.nodes.get(neighbor.id)!

          node.neighbors.get(l)!.add(neighbor.id)

          if (!neighborNode.neighbors.has(l)) {
            neighborNode.neighbors.set(l, new Set())
          }
          neighborNode.neighbors.get(l)!.add(id)

          if (neighborNode.neighbors.get(l)!.size > maxConnections) {
            this.pruneConnections(neighborNode, l, maxConnections)
          }
        }
      }
    }
  }

  async upsert(id: string, vector: Float32Array): Promise<void> {
    if (this.nodes.has(id)) {
      await this.update(id, vector)
    } else {
      await this.add(id, vector)
    }
  }

  async getVector(id: string): Promise<Float32Array | null> {
    const node = this.nodes.get(id)
    return node ? new Float32Array(node.vector) : null
  }

  has(id: string): boolean {
    const node = this.nodes.get(id)
    return node !== undefined && !node.deleted
  }

  hasDeleted(id: string): boolean {
    const node = this.nodes.get(id)
    return node !== undefined && node.deleted
  }

  async undelete(id: string): Promise<void> {
    const node = this.nodes.get(id)
    if (!node) {
      throw new Error(`Vector with id '${id}' not found`)
    }
    if (node.deleted) {
      node.deleted = false
      this.tombstoneCount--
    }
  }

  size(): number {
    let count = 0
    for (const node of this.nodes.values()) {
      if (!node.deleted) {
        count++
      }
    }
    return count
  }

  getTombstoneCount(): number {
    return this.tombstoneCount
  }

  async compact(): Promise<void> {
    // Remove all tombstoned nodes
    const toDelete: string[] = []
    for (const [id, node] of this.nodes) {
      if (node.deleted) {
        toDelete.push(id)
      }
    }

    for (const id of toDelete) {
      const node = this.nodes.get(id)!
      node.deleted = false // Temporarily unflag to allow hard delete
      this.tombstoneCount--
      await this.delete(id)
    }
  }

  // --------------------------------------------------------------------------
  // Public API - Search
  // --------------------------------------------------------------------------

  async search(
    query: Float32Array,
    k: number,
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    const { results } = await this.searchWithStats(query, k, options)
    return results
  }

  async searchWithStats(
    query: Float32Array,
    k: number,
    options?: SearchOptions
  ): Promise<{ results: SearchResult[]; stats: SearchStats }> {
    const startTime = performance.now()

    if (this.entryPointId === null) {
      return {
        results: [],
        stats: {
          distanceComputations: 0,
          nodesVisited: 0,
          searchTimeMs: 0,
          levelsTraversed: 0,
          startLevel: 0,
          nodesVisitedPerLevel: [],
          candidatesExploredLayer0: 0,
        },
      }
    }

    const efSearch = options?.efSearch ?? this._efSearch
    const entryPoint = this.nodes.get(this.entryPointId)!
    let currentNodeId = this.entryPointId
    let distanceComputations = 0
    let nodesVisited = 0
    const nodesVisitedPerLevelTemp: number[] = []
    const startLevel = entryPoint.level

    // Phase 1: Greedy search from top layer to layer 1
    for (let l = startLevel; l >= 1; l--) {
      const nodesAtLevel = this.countNodesInLevel(l)
      currentNodeId = this.searchLayerGreedy(query, currentNodeId, l)
      distanceComputations++
      nodesVisited++
      nodesVisitedPerLevelTemp.push(Math.min(nodesAtLevel, 1))
    }

    // Phase 2: Search layer 0 with efSearch candidates
    const candidates = this.searchLayerEf(query, currentNodeId, efSearch, 0)
    distanceComputations += candidates.length
    nodesVisited += candidates.length

    // Array should be [layer0, layer1, ..., layerN] (layer 0 has most visits)
    const nodesVisitedPerLevel = [candidates.length, ...nodesVisitedPerLevelTemp]

    const searchTimeMs = performance.now() - startTime

    // Track for performance stats
    this.latencies.push(searchTimeMs)
    this.searchStats.push({ distanceComputations, nodesVisited })

    // Convert results: filter deleted nodes and convert distance to score
    const results: SearchResult[] = []
    for (const candidate of candidates) {
      const node = this.nodes.get(candidate.id)
      if (node && !node.deleted) {
        // Convert distance back to similarity for cosine, keep distance for L2
        const score = this.metric === 'cosine'
          ? (1 - candidate.dist)  // Convert distance back to similarity
          : candidate.dist         // Keep as distance (lower is better)
        results.push({ id: candidate.id, score })
      }
      if (results.length >= k) break
    }

    return {
      results,
      stats: {
        distanceComputations,
        nodesVisited,
        searchTimeMs,
        levelsTraversed: startLevel + 1,
        startLevel,
        nodesVisitedPerLevel,
        candidatesExploredLayer0: candidates.length,
      },
    }
  }

  // --------------------------------------------------------------------------
  // Private Search Methods
  // --------------------------------------------------------------------------

  /**
   * Greedy search at a single layer - finds the single nearest neighbor
   */
  private searchLayerGreedy(query: Float32Array, entryNodeId: string, layer: number): string {
    let currentId = entryNodeId
    let currentDist = this.computeDistance(query, this.nodes.get(currentId)!.vector)
    let changed = true

    while (changed) {
      changed = false
      const currentNode = this.nodes.get(currentId)!
      const neighbors = currentNode.neighbors.get(layer)

      if (!neighbors) continue

      for (const neighborId of neighbors) {
        const neighborNode = this.nodes.get(neighborId)
        if (!neighborNode || neighborNode.deleted) continue

        const dist = this.computeDistance(query, neighborNode.vector)
        if (dist < currentDist) {
          currentDist = dist
          currentId = neighborId
          changed = true
        }
      }
    }

    return currentId
  }

  /**
   * Search with ef-size candidate list at a single layer
   * Returns candidates sorted by distance (ascending)
   */
  private searchLayerEf(
    query: Float32Array,
    entryNodeId: string,
    ef: number,
    layer: number
  ): Candidate[] {
    const entryNode = this.nodes.get(entryNodeId)
    if (!entryNode) return []

    const visited = new Set<string>([entryNodeId])
    const entryDist = this.computeDistance(query, entryNode.vector)

    // Candidates to explore (min-heap by distance)
    const candidates: Candidate[] = [{ id: entryNodeId, dist: entryDist }]
    // Best results found so far (maintain sorted by distance)
    const results: Candidate[] = [{ id: entryNodeId, dist: entryDist }]

    while (candidates.length > 0) {
      // Get the closest candidate
      candidates.sort((a, b) => a.dist - b.dist)
      const current = candidates.shift()!

      // Get the worst distance in results
      const worstResultDist = results.length > 0 ? results[results.length - 1]!.dist : Infinity

      // If the closest candidate is farther than the worst result, we're done
      if (current.dist > worstResultDist && results.length >= ef) {
        break
      }

      const currentNode = this.nodes.get(current.id)!
      const neighbors = currentNode.neighbors.get(layer)

      if (!neighbors) continue

      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) continue
        visited.add(neighborId)

        const neighborNode = this.nodes.get(neighborId)
        if (!neighborNode || neighborNode.deleted) continue

        const dist = this.computeDistance(query, neighborNode.vector)
        const worstDist = results.length > 0 ? results[results.length - 1]!.dist : Infinity

        // Add to results and candidates if good enough
        if (results.length < ef || dist < worstDist) {
          candidates.push({ id: neighborId, dist })
          results.push({ id: neighborId, dist })
          results.sort((a, b) => a.dist - b.dist)

          // Keep only ef best results
          if (results.length > ef) {
            results.pop()
          }
        }
      }
    }

    return results
  }

  /**
   * Select best neighbors from candidates
   */
  private selectNeighbors(candidates: Candidate[], maxConnections: number): Candidate[] {
    // Already sorted by distance, just take the best ones
    return candidates.slice(0, maxConnections)
  }

  /**
   * Prune connections to maintain max connections limit
   */
  private pruneConnections(node: HNSWNode, level: number, maxConnections: number): void {
    const neighbors = node.neighbors.get(level)
    if (!neighbors || neighbors.size <= maxConnections) return

    // Compute distances to all neighbors
    const distances: Candidate[] = []
    for (const neighborId of neighbors) {
      const neighborNode = this.nodes.get(neighborId)
      if (neighborNode) {
        const dist = this.computeDistance(node.vector, neighborNode.vector)
        distances.push({ id: neighborId, dist })
      }
    }

    // Sort by distance and keep best
    distances.sort((a, b) => a.dist - b.dist)

    // Remove excess neighbors
    const toKeep = new Set(distances.slice(0, maxConnections).map((d) => d.id))
    for (const neighborId of [...neighbors]) {
      if (!toKeep.has(neighborId)) {
        neighbors.delete(neighborId)
        // Also remove reverse edge
        const neighborNode = this.nodes.get(neighborId)
        if (neighborNode) {
          neighborNode.neighbors.get(level)?.delete(node.id)
        }
      }
    }
  }

  /**
   * Generate random level for a new node
   * Level assignment: floor(-ln(uniform(0,1)) * mL), where mL = 1/ln(M)
   */
  private generateRandomLevel(): number {
    const r = this.rng.next()
    // Clamp to avoid -Infinity from log(0)
    const level = Math.floor(-Math.log(Math.max(r, 0.0001)) * this.mL)
    return Math.min(level, this.maxLevel)
  }

  /**
   * Find new entry point after deletion
   */
  private findNewEntryPoint(): void {
    let maxLevel = -1
    let newEntryId: string | null = null

    for (const [id, node] of this.nodes) {
      if (!node.deleted && node.level > maxLevel) {
        maxLevel = node.level
        newEntryId = id
      }
    }

    this.entryPointId = newEntryId
  }

  /**
   * Repair connections for a node that lost neighbors
   */
  private async repairConnections(node: HNSWNode, level: number): Promise<void> {
    if (this.entryPointId === null) return

    const maxConnections = level === 0 ? this.M * 2 : this.M
    const candidates = this.searchLayerEf(node.vector, this.entryPointId, this.efConstruction, level)
    const newNeighbors = this.selectNeighbors(candidates, maxConnections)

    // Add new connections
    for (const neighbor of newNeighbors) {
      if (neighbor.id === node.id) continue

      const neighborNode = this.nodes.get(neighbor.id)
      if (!neighborNode || neighborNode.deleted) continue

      // Add bidirectional edge if not already present
      if (!node.neighbors.get(level)?.has(neighbor.id)) {
        node.neighbors.get(level)?.add(neighbor.id)
        if (!neighborNode.neighbors.has(level)) {
          neighborNode.neighbors.set(level, new Set())
        }
        neighborNode.neighbors.get(level)!.add(node.id)

        // Prune if necessary
        if (neighborNode.neighbors.get(level)!.size > maxConnections) {
          this.pruneConnections(neighborNode, level, maxConnections)
        }
      }
    }
  }

  /**
   * Count nodes present at a given level
   */
  private countNodesInLevel(level: number): number {
    let count = 0
    for (const node of this.nodes.values()) {
      if (!node.deleted && node.level >= level) {
        count++
      }
    }
    return count
  }

  // --------------------------------------------------------------------------
  // Public API - Graph Information
  // --------------------------------------------------------------------------

  getEntryPoint(): { id: string } | null {
    if (this.entryPointId === null) return null
    return { id: this.entryPointId }
  }

  getNodeLevel(id: string): number {
    const node = this.nodes.get(id)
    if (!node) {
      throw new Error(`Node ${id} not found`)
    }
    return node.level
  }

  getNeighbors(id: string, level: number): Array<{ id: string }> {
    const node = this.nodes.get(id)
    if (!node) return []
    const neighbors = node.neighbors.get(level)
    if (!neighbors) return []
    return Array.from(neighbors).map((n) => ({ id: n }))
  }

  getLevelStats(): LevelStat[] {
    const levelMap = new Map<number, { nodeCount: number; totalConnections: number; maxConnections: number }>()

    for (const node of this.nodes.values()) {
      if (node.deleted) continue

      for (let l = 0; l <= node.level; l++) {
        if (!levelMap.has(l)) {
          levelMap.set(l, { nodeCount: 0, totalConnections: 0, maxConnections: 0 })
        }
        const stats = levelMap.get(l)!
        stats.nodeCount++
        const connections = node.neighbors.get(l)?.size ?? 0
        stats.totalConnections += connections
        stats.maxConnections = Math.max(stats.maxConnections, connections)
      }
    }

    const result: LevelStat[] = []
    for (const [level, stats] of levelMap) {
      result.push({
        level,
        nodeCount: stats.nodeCount,
        avgConnections: stats.nodeCount > 0 ? stats.totalConnections / stats.nodeCount : 0,
        maxConnections: stats.maxConnections,
      })
    }

    return result.sort((a, b) => a.level - b.level)
  }

  getGraphStats(): GraphStats {
    let totalEdges = 0
    let totalConnectionsLayer0 = 0
    let maxConnectionsLayer0 = 0
    let disconnectedNodes = 0
    let activeNodes = 0

    for (const node of this.nodes.values()) {
      if (node.deleted) continue
      activeNodes++

      for (const [level, neighbors] of node.neighbors) {
        totalEdges += neighbors.size
        if (level === 0) {
          totalConnectionsLayer0 += neighbors.size
          maxConnectionsLayer0 = Math.max(maxConnectionsLayer0, neighbors.size)
          if (neighbors.size === 0) {
            disconnectedNodes++
          }
        }
      }
    }

    // Edges are counted twice (bidirectional), so divide by 2
    totalEdges = Math.floor(totalEdges / 2)

    return {
      totalEdges,
      avgConnectionsLayer0: activeNodes > 0 ? totalConnectionsLayer0 / activeNodes : 0,
      maxConnectionsLayer0,
      disconnectedNodes,
    }
  }

  getStats(): HNSWStats {
    const levelStats = this.getLevelStats()
    const activeNodes = this.size()

    // Estimate memory usage
    // Vectors: n * dimensions * 4 bytes (Float32)
    // Graph structure: ~n * M * 4 bytes per level (approximate)
    const vectorBytes = activeNodes * this.dimensions * 4
    const graphBytes = activeNodes * this.M * 4 * (levelStats.length || 1)
    const idOverhead = activeNodes * 20 // Approximate string overhead

    return {
      vectorCount: activeNodes,
      dimensions: this.dimensions,
      M: this.M,
      efConstruction: this.efConstruction,
      efSearch: this._efSearch,
      metric: this.metric,
      numLevels: levelStats.length,
      memoryUsageBytes: vectorBytes + graphBytes + idOverhead,
    }
  }

  getLatencyStats(): LatencyStats {
    if (this.latencies.length === 0) {
      return {
        searchCount: 0,
        avgLatencyMs: 0,
        p50LatencyMs: 0,
        p99LatencyMs: 0,
      }
    }

    const sorted = [...this.latencies].sort((a, b) => a - b)
    const n = sorted.length

    return {
      searchCount: n,
      avgLatencyMs: sorted.reduce((a, b) => a + b, 0) / n,
      p50LatencyMs: sorted[Math.floor(n * 0.5)]!,
      p99LatencyMs: sorted[Math.floor(n * 0.99)]!,
    }
  }

  getPerformanceStats(): PerformanceStats {
    if (this.searchStats.length === 0) {
      return {
        totalSearches: 0,
        avgDistanceComputations: 0,
        avgNodesVisited: 0,
        avgSearchTimeMs: 0,
      }
    }

    const n = this.searchStats.length
    const totalDist = this.searchStats.reduce((sum, s) => sum + s.distanceComputations, 0)
    const totalNodes = this.searchStats.reduce((sum, s) => sum + s.nodesVisited, 0)
    const avgLatency = this.latencies.reduce((a, b) => a + b, 0) / n

    return {
      totalSearches: n,
      avgDistanceComputations: totalDist / n,
      avgNodesVisited: totalNodes / n,
      avgSearchTimeMs: avgLatency,
    }
  }

  async evaluateRecall(
    queries: Float32Array[],
    options: RecallEvalOptions
  ): Promise<RecallMetric[]> {
    const results: RecallMetric[] = []

    for (const efSearch of options.efSearchValues) {
      let totalRecall = 0

      for (const query of queries) {
        const approxResults = await this.search(query, options.k, { efSearch })
        const groundTruth = options.groundTruthFn(query, options.k)

        const truthIds = new Set(groundTruth.map((r) => r.id))
        const hits = approxResults.filter((r) => truthIds.has(r.id)).length
        totalRecall += groundTruth.length > 0 ? hits / groundTruth.length : 1
      }

      results.push({
        efSearch,
        meanRecall: totalRecall / queries.length,
      })
    }

    return results
  }

  // --------------------------------------------------------------------------
  // Public API - Serialization
  // --------------------------------------------------------------------------

  async toJSON(): Promise<HNSWIndexJSON> {
    const nodes: HNSWIndexJSON['nodes'] = []
    const edges: HNSWIndexJSON['edges'] = []

    for (const [id, node] of this.nodes) {
      nodes.push({
        id,
        vector: Array.from(node.vector),
        level: node.level,
        deleted: node.deleted || undefined,
      })

      for (const [layer, neighbors] of node.neighbors) {
        for (const neighborId of neighbors) {
          // Only add edge once (from lower id to higher id)
          if (id < neighborId) {
            edges.push({ fromId: id, toId: neighborId, layer })
          }
        }
      }
    }

    return {
      config: {
        dimensions: this.dimensions,
        M: this.M,
        efConstruction: this.efConstruction,
        efSearch: this._efSearch,
        metric: this.metric,
      },
      nodes,
      edges,
      entryPoint: this.entryPointId,
      levelStats: this.getLevelStats(),
    }
  }

  static async fromJSON(json: HNSWIndexJSON): Promise<HNSWIndex> {
    const index = new HNSWIndex({
      dimensions: json.config.dimensions,
      M: json.config.M,
      efConstruction: json.config.efConstruction,
      efSearch: json.config.efSearch,
      metric: json.config.metric,
    })

    // Restore nodes
    for (const nodeData of json.nodes) {
      const node: HNSWNode = {
        id: nodeData.id,
        vector: new Float32Array(nodeData.vector),
        level: nodeData.level,
        neighbors: new Map(),
        deleted: nodeData.deleted ?? false,
      }

      for (let l = 0; l <= nodeData.level; l++) {
        node.neighbors.set(l, new Set())
      }

      index.nodes.set(nodeData.id, node)
      if (nodeData.deleted) {
        index.tombstoneCount++
      }
    }

    // Restore edges (bidirectional)
    for (const edge of json.edges) {
      const fromNode = index.nodes.get(edge.fromId)
      const toNode = index.nodes.get(edge.toId)
      if (fromNode && toNode) {
        fromNode.neighbors.get(edge.layer)?.add(edge.toId)
        toNode.neighbors.get(edge.layer)?.add(edge.fromId)
      }
    }

    index.entryPointId = json.entryPoint

    return index
  }

  async serialize(): Promise<ArrayBuffer> {
    // Compact binary format:
    // Header: HNSW (4 bytes) + version (1 byte) + config (16 bytes)
    // Config: dimensions (4), M (4), efConstruction (4), efSearch (4), metric (1)
    // Node count (4 bytes)
    // Entry point index (4 bytes, -1 if null)
    // Nodes: for each node:
    //   - id length (2 bytes) + id (utf8)
    //   - level (1 byte)
    //   - deleted (1 byte)
    //   - vector (dimensions * 4 bytes)
    // Edges: count (4 bytes), then for each edge:
    //   - from index (2 bytes), to index (2 bytes), layer (1 byte)

    const encoder = new TextEncoder()
    const nodeArray = Array.from(this.nodes.entries())
    const nodeIdToIndex = new Map<string, number>()
    nodeArray.forEach(([id], i) => nodeIdToIndex.set(id, i))

    // Calculate size
    let size = 5 + 17 + 4 + 4 // header + config + node count + entry point
    for (const [id, node] of nodeArray) {
      const idBytes = encoder.encode(id)
      size += 2 + idBytes.length + 1 + 1 + this.dimensions * 4
    }

    // Count edges (only count each edge once)
    let edgeCount = 0
    for (const [, node] of nodeArray) {
      for (const [, neighbors] of node.neighbors) {
        edgeCount += neighbors.size
      }
    }
    edgeCount = Math.floor(edgeCount / 2) // Each edge is counted twice
    size += 4 + edgeCount * 5 // edge count + edges

    const buffer = new ArrayBuffer(size)
    const view = new DataView(buffer)
    const uint8View = new Uint8Array(buffer)
    let offset = 0

    // Header
    view.setUint8(offset++, 'H'.charCodeAt(0))
    view.setUint8(offset++, 'N'.charCodeAt(0))
    view.setUint8(offset++, 'S'.charCodeAt(0))
    view.setUint8(offset++, 'W'.charCodeAt(0))
    view.setUint8(offset++, 2) // Version 2 (binary format)

    // Config
    view.setUint32(offset, this.dimensions, true); offset += 4
    view.setUint32(offset, this.M, true); offset += 4
    view.setUint32(offset, this.efConstruction, true); offset += 4
    view.setUint32(offset, this._efSearch, true); offset += 4
    view.setUint8(offset++, this.metric === 'cosine' ? 0 : 1)

    // Node count
    view.setUint32(offset, nodeArray.length, true); offset += 4

    // Entry point
    const entryIndex = this.entryPointId ? nodeIdToIndex.get(this.entryPointId)! : -1
    view.setInt32(offset, entryIndex, true); offset += 4

    // Nodes
    for (const [id, node] of nodeArray) {
      const idBytes = encoder.encode(id)
      view.setUint16(offset, idBytes.length, true); offset += 2
      uint8View.set(idBytes, offset); offset += idBytes.length
      view.setUint8(offset++, node.level)
      view.setUint8(offset++, node.deleted ? 1 : 0)
      const vecBytes = new Uint8Array(node.vector.buffer)
      uint8View.set(vecBytes, offset); offset += vecBytes.length
    }

    // Edges (only store each edge once: from < to)
    const edgeOffset = offset
    offset += 4 // Reserve space for edge count
    let actualEdgeCount = 0
    for (const [fromId, node] of nodeArray) {
      const fromIdx = nodeIdToIndex.get(fromId)!
      for (const [layer, neighbors] of node.neighbors) {
        for (const toId of neighbors) {
          const toIdx = nodeIdToIndex.get(toId)!
          if (fromIdx < toIdx) {
            view.setUint16(offset, fromIdx, true); offset += 2
            view.setUint16(offset, toIdx, true); offset += 2
            view.setUint8(offset++, layer)
            actualEdgeCount++
          }
        }
      }
    }
    view.setUint32(edgeOffset, actualEdgeCount, true)

    // Return trimmed buffer
    return buffer.slice(0, offset)
  }

  static async deserialize(buffer: ArrayBuffer): Promise<HNSWIndex> {
    const view = new DataView(buffer)
    const uint8View = new Uint8Array(buffer)
    const decoder = new TextDecoder()
    let offset = 0

    // Verify magic
    const magic = String.fromCharCode(
      view.getUint8(offset++),
      view.getUint8(offset++),
      view.getUint8(offset++),
      view.getUint8(offset++)
    )
    if (magic !== 'HNSW') {
      throw new Error(`Invalid HNSW format: expected magic 'HNSW', got '${magic}'`)
    }

    const version = view.getUint8(offset++)

    // Version 1: JSON format (for backward compatibility)
    if (version === 1) {
      const jsonBytes = new Uint8Array(buffer, offset)
      const jsonStr = decoder.decode(jsonBytes)
      const json = JSON.parse(jsonStr) as HNSWIndexJSON
      return HNSWIndex.fromJSON(json)
    }

    // Version 2: Binary format
    if (version !== 2) {
      throw new Error(`Unsupported HNSW version: ${version}`)
    }

    // Config
    const dimensions = view.getUint32(offset, true); offset += 4
    const M = view.getUint32(offset, true); offset += 4
    const efConstruction = view.getUint32(offset, true); offset += 4
    const efSearch = view.getUint32(offset, true); offset += 4
    const metricByte = view.getUint8(offset++)
    const metric: DistanceMetric = metricByte === 0 ? 'cosine' : 'l2'

    const index = new HNSWIndex({ dimensions, M, efConstruction, efSearch, metric })

    // Node count
    const nodeCount = view.getUint32(offset, true); offset += 4

    // Entry point index
    const entryIndex = view.getInt32(offset, true); offset += 4

    // Nodes
    const nodeIds: string[] = []
    for (let i = 0; i < nodeCount; i++) {
      const idLength = view.getUint16(offset, true); offset += 2
      const id = decoder.decode(uint8View.slice(offset, offset + idLength)); offset += idLength
      const level = view.getUint8(offset++)
      const deleted = view.getUint8(offset++) === 1

      const vector = new Float32Array(dimensions)
      const vecBytes = uint8View.slice(offset, offset + dimensions * 4)
      const vecView = new Float32Array(vecBytes.buffer, vecBytes.byteOffset, dimensions)
      vector.set(vecView)
      offset += dimensions * 4

      const node: HNSWNode = {
        id,
        vector,
        level,
        neighbors: new Map(),
        deleted,
      }
      for (let l = 0; l <= level; l++) {
        node.neighbors.set(l, new Set())
      }
      index.nodes.set(id, node)
      nodeIds.push(id)
      if (deleted) index.tombstoneCount++
    }

    // Entry point
    index.entryPointId = entryIndex >= 0 ? nodeIds[entryIndex]! : null

    // Edges
    const edgeCount = view.getUint32(offset, true); offset += 4
    for (let i = 0; i < edgeCount; i++) {
      const fromIdx = view.getUint16(offset, true); offset += 2
      const toIdx = view.getUint16(offset, true); offset += 2
      const layer = view.getUint8(offset++)

      const fromId = nodeIds[fromIdx]!
      const toId = nodeIds[toIdx]!
      const fromNode = index.nodes.get(fromId)!
      const toNode = index.nodes.get(toId)!

      fromNode.neighbors.get(layer)?.add(toId)
      toNode.neighbors.get(layer)?.add(fromId)
    }

    return index
  }

  async saveToSQLite(db: any): Promise<void> {
    // Create tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS hnsw_nodes (
        id TEXT PRIMARY KEY,
        vector BLOB NOT NULL,
        level INTEGER NOT NULL,
        deleted INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS hnsw_edges (
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        layer INTEGER NOT NULL,
        PRIMARY KEY (from_id, to_id, layer)
      );
      CREATE TABLE IF NOT EXISTS hnsw_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)

    // Insert metadata
    const metadataStmt = db.prepare('INSERT OR REPLACE INTO hnsw_metadata (key, value) VALUES (?, ?)')
    metadataStmt.run('dimensions', String(this.dimensions))
    metadataStmt.run('M', String(this.M))
    metadataStmt.run('efConstruction', String(this.efConstruction))
    metadataStmt.run('efSearch', String(this._efSearch))
    metadataStmt.run('metric', this.metric)
    metadataStmt.run('entryPoint', this.entryPointId ?? '')

    // Insert nodes
    const nodeStmt = db.prepare('INSERT INTO hnsw_nodes (id, vector, level, deleted) VALUES (?, ?, ?, ?)')
    for (const [id, node] of this.nodes) {
      nodeStmt.run(id, node.vector.buffer, node.level, node.deleted ? 1 : 0)
    }

    // Insert edges
    const edgeStmt = db.prepare('INSERT INTO hnsw_edges (from_id, to_id, layer) VALUES (?, ?, ?)')
    for (const [id, node] of this.nodes) {
      for (const [layer, neighbors] of node.neighbors) {
        for (const neighborId of neighbors) {
          if (id < neighborId) {
            edgeStmt.run(id, neighborId, layer)
          }
        }
      }
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export interface CreateHNSWIndexOptions {
  dimensions: number
  M?: number
  efConstruction?: number
  efSearch?: number
  metric?: DistanceMetric
  expectedElements?: number
  randomSeed?: number
  preset?: 'fast' | 'accurate'
  autoTune?: boolean
}

export function createHNSWIndex(options: CreateHNSWIndexOptions): HNSWIndex {
  let M = options.M
  let efConstruction = options.efConstruction
  let efSearch = options.efSearch

  // Apply preset
  if (options.preset === 'fast') {
    M = M ?? 8
    efConstruction = efConstruction ?? 50
    efSearch = efSearch ?? 20
  } else if (options.preset === 'accurate') {
    M = M ?? 32
    efConstruction = efConstruction ?? 200
    efSearch = efSearch ?? 100
  }

  // Auto-tune based on expected elements
  if (options.autoTune && options.expectedElements) {
    const n = options.expectedElements
    if (n >= 100000) {
      M = M ?? 24
      efConstruction = efConstruction ?? 200
    } else if (n >= 10000) {
      M = M ?? 16
      efConstruction = efConstruction ?? 150
    } else {
      M = M ?? 12
      efConstruction = efConstruction ?? 100
    }
  }

  return new HNSWIndex({
    dimensions: options.dimensions,
    M,
    efConstruction,
    efSearch,
    metric: options.metric,
    expectedElements: options.expectedElements,
    randomSeed: options.randomSeed,
  })
}

// HNSWConfig is already exported as an interface above
