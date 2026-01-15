/**
 * AdjacencyIndex - Columnar Graph Storage
 *
 * GREEN PHASE: Implements columnar graph storage optimized for:
 * - Fast neighbor queries (outgoing and incoming)
 * - Efficient degree counting
 * - Bloom filters for existence checks
 * - Supernode detection and handling
 * - Sharding support for horizontal scaling
 *
 * Storage Format:
 * - adjacency_out: nodeId -> [{to, type, relId, data}] (outgoing adjacency list)
 * - adjacency_in: nodeId -> [{from, type, relId, data}] (incoming / reverse index)
 *
 * @see dotdo-1llrh - [GRAPH-2] GREEN: Adjacency Index
 *
 * Uses real SQLite, NO MOCKS - per project testing philosophy.
 */

/**
 * Generate a random ID similar to nanoid
 * Uses crypto.randomUUID and takes a slice for shorter IDs
 */
function generateId(size: number = 21): string {
  // Use crypto.randomUUID() which is available in modern Node.js and Cloudflare Workers
  // Remove hyphens and take the first `size` characters
  return crypto.randomUUID().replace(/-/g, '').slice(0, size)
}

// ============================================================================
// Types
// ============================================================================

/**
 * Entry in an adjacency list (outgoing edge)
 */
export interface AdjacencyEntry {
  to: string
  type: string
  relId: string
  data: Record<string, unknown> | null
  createdAt: number
}

/**
 * Entry in the reverse index (incoming edge)
 */
export interface ReverseEntry {
  from: string
  type: string
  relId: string
  data: Record<string, unknown> | null
  createdAt: number
}

/**
 * Direction for neighbor queries
 */
export type EdgeDirection = 'out' | 'in' | 'both'

/**
 * Query options for neighbor lookups
 */
export interface NeighborQueryOptions {
  direction?: EdgeDirection
  type?: string | string[]
  limit?: number
  offset?: number
  orderBy?: 'createdAt' | 'type'
  orderDirection?: 'asc' | 'desc'
}

/**
 * Result of a neighbor query
 */
export interface NeighborResult {
  nodeId: string
  direction: 'out' | 'in'
  type: string
  relId: string
  data: Record<string, unknown> | null
  createdAt: number
}

/**
 * Degree information for a node
 */
export interface NodeDegree {
  nodeId: string
  outDegree: number
  inDegree: number
  totalDegree: number
  byType: Record<string, { out: number; in: number }>
}

/**
 * Bloom filter statistics
 */
export interface BloomFilterStats {
  size: number
  hashFunctions: number
  insertedCount: number
  estimatedFalsePositiveRate: number
}

/**
 * Supernode threshold configuration
 */
export interface SupernodeConfig {
  threshold: number
  samplingRate: number
  shardCount: number
}

/**
 * Shard information
 */
export interface ShardInfo {
  shardId: number
  nodeCount: number
  edgeCount: number
  sizeBytes: number
}

/**
 * Graph statistics
 */
export interface GraphStats {
  totalNodes: number
  totalEdges: number
  avgDegree: number
  maxDegree: number
  supernodeCount: number
}

/**
 * AdjacencyIndex interface
 */
export interface IAdjacencyIndex {
  // Edge operations
  addEdge(from: string, to: string, type: string, data?: Record<string, unknown>): Promise<string>
  removeEdge(relId: string): Promise<boolean>
  removeEdgeByEndpoints(from: string, to: string, type: string): Promise<boolean>
  hasEdge(from: string, to: string, type?: string): Promise<boolean>

  // Neighbor queries
  getNeighbors(nodeId: string, options?: NeighborQueryOptions): Promise<NeighborResult[]>
  getOutNeighbors(nodeId: string, type?: string): Promise<string[]>
  getInNeighbors(nodeId: string, type?: string): Promise<string[]>

  // Degree operations
  getDegree(nodeId: string): Promise<NodeDegree>
  getOutDegree(nodeId: string, type?: string): Promise<number>
  getInDegree(nodeId: string, type?: string): Promise<number>

  // Bulk operations
  addEdges(edges: Array<{ from: string; to: string; type: string; data?: Record<string, unknown> }>): Promise<string[]>
  removeEdges(relIds: string[]): Promise<number>
  getNeighborsBatch(nodeIds: string[], options?: NeighborQueryOptions): Promise<Map<string, NeighborResult[]>>

  // Bloom filter operations
  hasVertex(nodeId: string): Promise<boolean>
  probablyHasEdge(from: string, to: string, type?: string): boolean
  getBloomFilterStats(): BloomFilterStats

  // Supernode operations
  isSupernode(nodeId: string): Promise<boolean>
  getSupernodes(minDegree?: number): Promise<string[]>
  configureSupernodeHandling(config: SupernodeConfig): void

  // Sharding operations
  getShardInfo(): Promise<ShardInfo[]>
  getShardForNode(nodeId: string): number
  rebalanceShards(): Promise<void>

  // Maintenance
  compact(): Promise<void>
  vacuum(): Promise<void>
  getStats(): Promise<GraphStats>

  // Node enumeration
  getAllNodeIds(): Promise<string[]>
}

// ============================================================================
// Simple Bloom Filter Implementation
// ============================================================================

/**
 * A simple Bloom filter for probabilistic membership testing.
 * Uses multiple hash functions to minimize false positive rate.
 */
class BloomFilter {
  private bits: Uint8Array
  private hashCount: number
  private insertedCount: number = 0

  constructor(size: number = 65536, hashCount: number = 4) {
    this.bits = new Uint8Array(Math.ceil(size / 8))
    this.hashCount = hashCount
  }

  /**
   * Simple hash function using FNV-1a algorithm
   */
  private hash(str: string, seed: number): number {
    let hash = 2166136261 ^ seed
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return Math.abs(hash) % (this.bits.length * 8)
  }

  /**
   * Add an element to the bloom filter
   */
  add(element: string): void {
    for (let i = 0; i < this.hashCount; i++) {
      const pos = this.hash(element, i)
      const bytePos = Math.floor(pos / 8)
      const bitPos = pos % 8
      this.bits[bytePos]! |= 1 << bitPos
    }
    this.insertedCount++
  }

  /**
   * Check if an element might be in the set.
   * Returns false if definitely not present, true if possibly present.
   */
  mightContain(element: string): boolean {
    for (let i = 0; i < this.hashCount; i++) {
      const pos = this.hash(element, i)
      const bytePos = Math.floor(pos / 8)
      const bitPos = pos % 8
      if (!((this.bits[bytePos]! >> bitPos) & 1)) {
        return false
      }
    }
    return true
  }

  /**
   * Get bloom filter statistics
   */
  getStats(): BloomFilterStats {
    const size = this.bits.length * 8
    const setBits = this.countSetBits()
    // Estimate false positive rate: (setBits / size)^hashCount
    const estimatedFpr = Math.pow(setBits / size, this.hashCount)

    return {
      size,
      hashFunctions: this.hashCount,
      insertedCount: this.insertedCount,
      estimatedFalsePositiveRate: estimatedFpr,
    }
  }

  private countSetBits(): number {
    let count = 0
    for (let i = 0; i < this.bits.length; i++) {
      let byte = this.bits[i]!
      while (byte) {
        count += byte & 1
        byte >>= 1
      }
    }
    return count
  }
}

// ============================================================================
// AdjacencyIndex Class
// ============================================================================

/**
 * AdjacencyIndex implements columnar graph storage using SQLite.
 *
 * Features:
 * - Fast O(1) degree lookups via denormalized degree table
 * - Bloom filters for fast negative lookups
 * - Supernode detection and sampling for high-degree nodes
 * - Consistent hashing for shard assignment
 */
export class AdjacencyIndex implements IAdjacencyIndex {
  private sqlite: import('better-sqlite3').Database | null = null
  private connectionPath: string
  private initialized: boolean = false

  // Bloom filters for fast existence checks
  private edgeBloomFilter: BloomFilter
  private vertexBloomFilter: BloomFilter

  // Supernode configuration
  private supernodeConfig: SupernodeConfig = {
    threshold: 1000,
    samplingRate: 0.1,
    shardCount: 4,
  }

  /**
   * Create a new AdjacencyIndex.
   * @param connectionOrPath - SQLite connection string (':memory:' or file path)
   *                           or an existing better-sqlite3 database instance
   */
  constructor(connectionOrPath: string | import('better-sqlite3').Database = ':memory:') {
    if (typeof connectionOrPath === 'string') {
      this.connectionPath = connectionOrPath
    } else {
      this.sqlite = connectionOrPath
      this.connectionPath = ':existing:'
    }

    // Initialize bloom filters with good default sizes
    this.edgeBloomFilter = new BloomFilter(131072, 5) // 128KB, 5 hash functions
    this.vertexBloomFilter = new BloomFilter(65536, 4) // 64KB, 4 hash functions
  }

  /**
   * Initialize the database connection and create tables.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    const BetterSqlite = (await import('better-sqlite3')).default

    if (!this.sqlite) {
      this.sqlite = new BetterSqlite(this.connectionPath)
    }

    // Enable foreign keys and WAL mode for better performance
    this.sqlite.pragma('journal_mode = WAL')
    this.sqlite.pragma('foreign_keys = ON')

    // Create adjacency tables
    this.sqlite.exec(`
      -- Adjacency list table (outgoing edges)
      CREATE TABLE IF NOT EXISTS adjacency_out (
        node_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        edge_type TEXT NOT NULL,
        rel_id TEXT PRIMARY KEY,
        data TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(node_id, target_id, edge_type)
      );

      -- Reverse index table (incoming edges)
      CREATE TABLE IF NOT EXISTS adjacency_in (
        node_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        edge_type TEXT NOT NULL,
        rel_id TEXT NOT NULL,
        data TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(node_id, source_id, edge_type)
      );

      -- Indexes for efficient queries
      CREATE INDEX IF NOT EXISTS adj_out_node_idx ON adjacency_out(node_id);
      CREATE INDEX IF NOT EXISTS adj_out_node_type_idx ON adjacency_out(node_id, edge_type);
      CREATE INDEX IF NOT EXISTS adj_out_target_idx ON adjacency_out(target_id);
      CREATE INDEX IF NOT EXISTS adj_in_node_idx ON adjacency_in(node_id);
      CREATE INDEX IF NOT EXISTS adj_in_node_type_idx ON adjacency_in(node_id, edge_type);
      CREATE INDEX IF NOT EXISTS adj_in_source_idx ON adjacency_in(source_id);

      -- Degree tracking table (denormalized for O(1) degree lookups)
      CREATE TABLE IF NOT EXISTS node_degrees (
        node_id TEXT PRIMARY KEY,
        out_degree INTEGER DEFAULT 0,
        in_degree INTEGER DEFAULT 0,
        degree_by_type TEXT DEFAULT '{}'
      );

      -- Shard assignment table for horizontal scaling
      CREATE TABLE IF NOT EXISTS shard_assignments (
        shard_id INTEGER PRIMARY KEY,
        node_count INTEGER DEFAULT 0,
        edge_count INTEGER DEFAULT 0,
        size_bytes INTEGER DEFAULT 0
      );
    `)

    // Initialize shard entries if not present
    for (let i = 0; i < this.supernodeConfig.shardCount; i++) {
      this.sqlite.exec(`
        INSERT OR IGNORE INTO shard_assignments (shard_id, node_count, edge_count, size_bytes)
        VALUES (${i}, 0, 0, 0)
      `)
    }

    // Rebuild bloom filters from existing data
    await this.rebuildBloomFilters()

    this.initialized = true
  }

  /**
   * Close the database connection.
   */
  async close(): Promise<void> {
    if (this.sqlite && this.connectionPath !== ':existing:') {
      this.sqlite.close()
    }
    this.sqlite = null
    this.initialized = false
  }

  // =========================================================================
  // EDGE OPERATIONS
  // =========================================================================

  /**
   * Add an edge to the graph.
   */
  async addEdge(
    from: string,
    to: string,
    type: string,
    data?: Record<string, unknown>
  ): Promise<string> {
    await this.ensureInitialized()

    const relId = generateId()
    const now = Date.now()
    const dataJson = data ? JSON.stringify(data) : null

    const insertOut = this.sqlite!.prepare(`
      INSERT INTO adjacency_out (node_id, target_id, edge_type, rel_id, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const insertIn = this.sqlite!.prepare(`
      INSERT INTO adjacency_in (node_id, source_id, edge_type, rel_id, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const updateDegree = this.sqlite!.prepare(`
      INSERT INTO node_degrees (node_id, out_degree, in_degree, degree_by_type)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(node_id) DO UPDATE SET
        out_degree = out_degree + excluded.out_degree,
        in_degree = in_degree + excluded.in_degree,
        degree_by_type = ?
    `)

    // Use transaction for atomicity
    const transaction = this.sqlite!.transaction(() => {
      // Insert into adjacency_out
      insertOut.run(from, to, type, relId, dataJson, now)

      // Insert into adjacency_in
      insertIn.run(to, from, type, relId, dataJson, now)

      // Update degrees for source node
      const fromDegrees = this.getNodeDegreeByType(from)
      fromDegrees[type] = fromDegrees[type] || { out: 0, in: 0 }
      fromDegrees[type].out++
      const fromDegreeJson = JSON.stringify(fromDegrees)
      updateDegree.run(from, 1, 0, fromDegreeJson, fromDegreeJson)

      // Update degrees for target node
      const toDegrees = this.getNodeDegreeByType(to)
      toDegrees[type] = toDegrees[type] || { out: 0, in: 0 }
      toDegrees[type].in++
      const toDegreeJson = JSON.stringify(toDegrees)
      updateDegree.run(to, 0, 1, toDegreeJson, toDegreeJson)

      // Update shard stats
      const shardId = this.getShardForNode(from)
      this.sqlite!.prepare(`
        UPDATE shard_assignments
        SET edge_count = edge_count + 1,
            size_bytes = size_bytes + ?
        WHERE shard_id = ?
      `).run(dataJson ? dataJson.length : 0, shardId)
    })

    transaction()

    // Update bloom filters
    this.edgeBloomFilter.add(`${from}:${to}:${type}`)
    this.edgeBloomFilter.add(`${from}:${to}`) // For type-agnostic checks
    this.vertexBloomFilter.add(from)
    this.vertexBloomFilter.add(to)

    return relId
  }

  /**
   * Remove an edge by relationship ID.
   */
  async removeEdge(relId: string): Promise<boolean> {
    await this.ensureInitialized()

    // First get the edge info for degree updates
    const edge = this.sqlite!.prepare(`
      SELECT node_id, target_id, edge_type, data FROM adjacency_out WHERE rel_id = ?
    `).get(relId) as { node_id: string; target_id: string; edge_type: string; data: string | null } | undefined

    if (!edge) {
      return false
    }

    const deleteOut = this.sqlite!.prepare(`DELETE FROM adjacency_out WHERE rel_id = ?`)
    const deleteIn = this.sqlite!.prepare(`DELETE FROM adjacency_in WHERE rel_id = ?`)

    const transaction = this.sqlite!.transaction(() => {
      deleteIn.run(relId)
      const result = deleteOut.run(relId)

      if (result.changes > 0) {
        // Update degrees
        this.decrementDegree(edge.node_id, edge.edge_type, 'out')
        this.decrementDegree(edge.target_id, edge.edge_type, 'in')

        // Update shard stats
        const shardId = this.getShardForNode(edge.node_id)
        this.sqlite!.prepare(`
          UPDATE shard_assignments
          SET edge_count = edge_count - 1,
              size_bytes = size_bytes - ?
          WHERE shard_id = ?
        `).run(edge.data ? edge.data.length : 0, shardId)
      }

      return result.changes
    })

    return transaction() > 0
  }

  /**
   * Remove an edge by endpoints and type.
   */
  async removeEdgeByEndpoints(from: string, to: string, type: string): Promise<boolean> {
    await this.ensureInitialized()

    // Get the relId first
    const edge = this.sqlite!.prepare(`
      SELECT rel_id FROM adjacency_out WHERE node_id = ? AND target_id = ? AND edge_type = ?
    `).get(from, to, type) as { rel_id: string } | undefined

    if (!edge) {
      return false
    }

    return this.removeEdge(edge.rel_id)
  }

  /**
   * Check if an edge exists between two nodes.
   */
  async hasEdge(from: string, to: string, type?: string): Promise<boolean> {
    await this.ensureInitialized()

    let query: string
    let params: string[]

    if (type !== undefined) {
      query = `SELECT 1 FROM adjacency_out WHERE node_id = ? AND target_id = ? AND edge_type = ? LIMIT 1`
      params = [from, to, type]
    } else {
      query = `SELECT 1 FROM adjacency_out WHERE node_id = ? AND target_id = ? LIMIT 1`
      params = [from, to]
    }

    const result = this.sqlite!.prepare(query).get(...params)
    return result !== undefined
  }

  // =========================================================================
  // NEIGHBOR QUERIES
  // =========================================================================

  /**
   * Get neighbors of a node with options for direction, filtering, and pagination.
   */
  async getNeighbors(nodeId: string, options: NeighborQueryOptions = {}): Promise<NeighborResult[]> {
    await this.ensureInitialized()

    const { direction = 'out', type, limit, offset = 0, orderBy = 'createdAt', orderDirection = 'desc' } = options

    const results: NeighborResult[] = []

    // Check if this is a supernode and apply sampling if needed
    const isSupernode = await this.isSupernode(nodeId)
    const effectiveLimit = isSupernode && limit ? Math.ceil(limit / this.supernodeConfig.samplingRate) : limit

    // Get outgoing neighbors
    if (direction === 'out' || direction === 'both') {
      const outResults = this.queryNeighborsOut(nodeId, type, effectiveLimit, offset, orderBy, orderDirection)
      results.push(
        ...outResults.map((r) => ({
          nodeId: r.target_id,
          direction: 'out' as const,
          type: r.edge_type,
          relId: r.rel_id,
          data: r.data ? JSON.parse(r.data) : null,
          createdAt: r.created_at,
        }))
      )
    }

    // Get incoming neighbors
    if (direction === 'in' || direction === 'both') {
      const inResults = this.queryNeighborsIn(nodeId, type, effectiveLimit, offset, orderBy, orderDirection)
      results.push(
        ...inResults.map((r) => ({
          nodeId: r.source_id,
          direction: 'in' as const,
          type: r.edge_type,
          relId: r.rel_id,
          data: r.data ? JSON.parse(r.data) : null,
          createdAt: r.created_at,
        }))
      )
    }

    // Apply sampling for supernodes
    if (isSupernode && limit && results.length > limit) {
      // Random sampling for supernodes
      const sampled: NeighborResult[] = []
      const step = Math.max(1, Math.floor(results.length / limit))
      for (let i = 0; i < results.length && sampled.length < limit; i += step) {
        sampled.push(results[i]!)
      }
      return sampled
    }

    // Apply limit if specified
    if (limit && results.length > limit) {
      return results.slice(0, limit)
    }

    return results
  }

  /**
   * Get outgoing neighbor IDs.
   */
  async getOutNeighbors(nodeId: string, type?: string): Promise<string[]> {
    await this.ensureInitialized()

    let query: string
    let params: (string | undefined)[]

    if (type) {
      query = `SELECT DISTINCT target_id FROM adjacency_out WHERE node_id = ? AND edge_type = ?`
      params = [nodeId, type]
    } else {
      query = `SELECT DISTINCT target_id FROM adjacency_out WHERE node_id = ?`
      params = [nodeId]
    }

    const results = this.sqlite!.prepare(query).all(...params) as { target_id: string }[]
    return results.map((r) => r.target_id)
  }

  /**
   * Get incoming neighbor IDs.
   */
  async getInNeighbors(nodeId: string, type?: string): Promise<string[]> {
    await this.ensureInitialized()

    let query: string
    let params: (string | undefined)[]

    if (type) {
      query = `SELECT DISTINCT source_id FROM adjacency_in WHERE node_id = ? AND edge_type = ?`
      params = [nodeId, type]
    } else {
      query = `SELECT DISTINCT source_id FROM adjacency_in WHERE node_id = ?`
      params = [nodeId]
    }

    const results = this.sqlite!.prepare(query).all(...params) as { source_id: string }[]
    return results.map((r) => r.source_id)
  }

  // =========================================================================
  // DEGREE OPERATIONS
  // =========================================================================

  /**
   * Get full degree information for a node.
   */
  async getDegree(nodeId: string): Promise<NodeDegree> {
    await this.ensureInitialized()

    const result = this.sqlite!.prepare(`
      SELECT node_id, out_degree, in_degree, degree_by_type FROM node_degrees WHERE node_id = ?
    `).get(nodeId) as { node_id: string; out_degree: number; in_degree: number; degree_by_type: string } | undefined

    if (!result) {
      return {
        nodeId,
        outDegree: 0,
        inDegree: 0,
        totalDegree: 0,
        byType: {},
      }
    }

    const byType = JSON.parse(result.degree_by_type) as Record<string, { out: number; in: number }>

    return {
      nodeId: result.node_id,
      outDegree: result.out_degree,
      inDegree: result.in_degree,
      totalDegree: result.out_degree + result.in_degree,
      byType,
    }
  }

  /**
   * Get outgoing degree for a node.
   */
  async getOutDegree(nodeId: string, type?: string): Promise<number> {
    await this.ensureInitialized()

    if (type) {
      const result = this.sqlite!.prepare(`
        SELECT COUNT(*) as count FROM adjacency_out WHERE node_id = ? AND edge_type = ?
      `).get(nodeId, type) as { count: number }
      return result.count
    }

    const result = this.sqlite!.prepare(`
      SELECT out_degree FROM node_degrees WHERE node_id = ?
    `).get(nodeId) as { out_degree: number } | undefined

    return result?.out_degree ?? 0
  }

  /**
   * Get incoming degree for a node.
   */
  async getInDegree(nodeId: string, type?: string): Promise<number> {
    await this.ensureInitialized()

    if (type) {
      const result = this.sqlite!.prepare(`
        SELECT COUNT(*) as count FROM adjacency_in WHERE node_id = ? AND edge_type = ?
      `).get(nodeId, type) as { count: number }
      return result.count
    }

    const result = this.sqlite!.prepare(`
      SELECT in_degree FROM node_degrees WHERE node_id = ?
    `).get(nodeId) as { in_degree: number } | undefined

    return result?.in_degree ?? 0
  }

  // =========================================================================
  // BULK OPERATIONS
  // =========================================================================

  /**
   * Add multiple edges in a single transaction.
   */
  async addEdges(
    edges: Array<{ from: string; to: string; type: string; data?: Record<string, unknown> }>
  ): Promise<string[]> {
    await this.ensureInitialized()

    const relIds: string[] = []
    const now = Date.now()

    const insertOut = this.sqlite!.prepare(`
      INSERT INTO adjacency_out (node_id, target_id, edge_type, rel_id, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const insertIn = this.sqlite!.prepare(`
      INSERT INTO adjacency_in (node_id, source_id, edge_type, rel_id, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const transaction = this.sqlite!.transaction(() => {
      for (const edge of edges) {
        const relId = generateId()
        const dataJson = edge.data ? JSON.stringify(edge.data) : null

        insertOut.run(edge.from, edge.to, edge.type, relId, dataJson, now)
        insertIn.run(edge.to, edge.from, edge.type, relId, dataJson, now)

        // Update degrees
        this.incrementDegree(edge.from, edge.type, 'out')
        this.incrementDegree(edge.to, edge.type, 'in')

        // Update bloom filters
        this.edgeBloomFilter.add(`${edge.from}:${edge.to}:${edge.type}`)
        this.edgeBloomFilter.add(`${edge.from}:${edge.to}`)
        this.vertexBloomFilter.add(edge.from)
        this.vertexBloomFilter.add(edge.to)

        relIds.push(relId)
      }
    })

    transaction()

    return relIds
  }

  /**
   * Remove multiple edges by their IDs.
   */
  async removeEdges(relIds: string[]): Promise<number> {
    await this.ensureInitialized()

    let removed = 0

    const transaction = this.sqlite!.transaction(() => {
      for (const relId of relIds) {
        // Get edge info first
        const edge = this.sqlite!.prepare(`
          SELECT node_id, target_id, edge_type FROM adjacency_out WHERE rel_id = ?
        `).get(relId) as { node_id: string; target_id: string; edge_type: string } | undefined

        if (!edge) continue

        // Delete from both tables
        this.sqlite!.prepare(`DELETE FROM adjacency_in WHERE rel_id = ?`).run(relId)
        const result = this.sqlite!.prepare(`DELETE FROM adjacency_out WHERE rel_id = ?`).run(relId)

        if (result.changes > 0) {
          removed++
          // Update degrees
          this.decrementDegree(edge.node_id, edge.edge_type, 'out')
          this.decrementDegree(edge.target_id, edge.edge_type, 'in')
        }
      }
    })

    transaction()

    return removed
  }

  /**
   * Get neighbors for multiple nodes in a single batch.
   */
  async getNeighborsBatch(
    nodeIds: string[],
    options: NeighborQueryOptions = {}
  ): Promise<Map<string, NeighborResult[]>> {
    await this.ensureInitialized()

    const result = new Map<string, NeighborResult[]>()

    // Initialize all node entries
    for (const nodeId of nodeIds) {
      result.set(nodeId, [])
    }

    if (nodeIds.length === 0) {
      return result
    }

    const { direction = 'out', type } = options

    // Build IN clause
    const placeholders = nodeIds.map(() => '?').join(', ')

    // Get outgoing neighbors
    if (direction === 'out' || direction === 'both') {
      let query = `SELECT node_id, target_id, edge_type, rel_id, data, created_at FROM adjacency_out WHERE node_id IN (${placeholders})`
      const params: string[] = [...nodeIds]

      if (type) {
        const types = Array.isArray(type) ? type : [type]
        const typePlaceholders = types.map(() => '?').join(', ')
        query += ` AND edge_type IN (${typePlaceholders})`
        params.push(...types)
      }

      const rows = this.sqlite!.prepare(query).all(...params) as Array<{
        node_id: string
        target_id: string
        edge_type: string
        rel_id: string
        data: string | null
        created_at: number
      }>

      for (const row of rows) {
        const neighbors = result.get(row.node_id)!
        neighbors.push({
          nodeId: row.target_id,
          direction: 'out',
          type: row.edge_type,
          relId: row.rel_id,
          data: row.data ? JSON.parse(row.data) : null,
          createdAt: row.created_at,
        })
      }
    }

    // Get incoming neighbors
    if (direction === 'in' || direction === 'both') {
      let query = `SELECT node_id, source_id, edge_type, rel_id, data, created_at FROM adjacency_in WHERE node_id IN (${placeholders})`
      const params: string[] = [...nodeIds]

      if (type) {
        const types = Array.isArray(type) ? type : [type]
        const typePlaceholders = types.map(() => '?').join(', ')
        query += ` AND edge_type IN (${typePlaceholders})`
        params.push(...types)
      }

      const rows = this.sqlite!.prepare(query).all(...params) as Array<{
        node_id: string
        source_id: string
        edge_type: string
        rel_id: string
        data: string | null
        created_at: number
      }>

      for (const row of rows) {
        const neighbors = result.get(row.node_id)!
        neighbors.push({
          nodeId: row.source_id,
          direction: 'in',
          type: row.edge_type,
          relId: row.rel_id,
          data: row.data ? JSON.parse(row.data) : null,
          createdAt: row.created_at,
        })
      }
    }

    return result
  }

  // =========================================================================
  // BLOOM FILTER OPERATIONS
  // =========================================================================

  /**
   * Check if a vertex exists in the index.
   */
  async hasVertex(nodeId: string): Promise<boolean> {
    await this.ensureInitialized()

    // First check bloom filter for fast negative
    if (!this.vertexBloomFilter.mightContain(nodeId)) {
      return false
    }

    // Verify in database - check if node exists in any table
    // Use a single query with EXISTS for efficiency
    const result = this.sqlite!.prepare(`
      SELECT 1 WHERE EXISTS (SELECT 1 FROM node_degrees WHERE node_id = ?)
      OR EXISTS (SELECT 1 FROM adjacency_out WHERE node_id = ?)
      OR EXISTS (SELECT 1 FROM adjacency_in WHERE node_id = ?)
    `).get(nodeId, nodeId, nodeId)

    return result !== undefined
  }

  /**
   * Fast probabilistic check if an edge might exist.
   * Returns false if definitely not present, true if possibly present.
   */
  probablyHasEdge(from: string, to: string, type?: string): boolean {
    if (type !== undefined) {
      return this.edgeBloomFilter.mightContain(`${from}:${to}:${type}`)
    }
    return this.edgeBloomFilter.mightContain(`${from}:${to}`)
  }

  /**
   * Get bloom filter statistics.
   */
  getBloomFilterStats(): BloomFilterStats {
    return this.edgeBloomFilter.getStats()
  }

  // =========================================================================
  // SUPERNODE OPERATIONS
  // =========================================================================

  /**
   * Check if a node is a supernode (high degree).
   */
  async isSupernode(nodeId: string): Promise<boolean> {
    await this.ensureInitialized()

    const degree = await this.getDegree(nodeId)
    return degree.totalDegree >= this.supernodeConfig.threshold
  }

  /**
   * Get all supernodes above a minimum degree.
   */
  async getSupernodes(minDegree?: number): Promise<string[]> {
    await this.ensureInitialized()

    const threshold = minDegree ?? this.supernodeConfig.threshold

    const results = this.sqlite!.prepare(`
      SELECT node_id FROM node_degrees
      WHERE (out_degree + in_degree) >= ?
      ORDER BY (out_degree + in_degree) DESC
    `).all(threshold) as { node_id: string }[]

    return results.map((r) => r.node_id)
  }

  /**
   * Configure supernode handling behavior.
   */
  configureSupernodeHandling(config: SupernodeConfig): void {
    this.supernodeConfig = config

    // Re-initialize shards if count changed
    if (this.initialized) {
      for (let i = 0; i < config.shardCount; i++) {
        this.sqlite!.prepare(`
          INSERT OR IGNORE INTO shard_assignments (shard_id, node_count, edge_count, size_bytes)
          VALUES (?, 0, 0, 0)
        `).run(i)
      }
    }
  }

  // =========================================================================
  // SHARDING OPERATIONS
  // =========================================================================

  /**
   * Get information about all shards.
   */
  async getShardInfo(): Promise<ShardInfo[]> {
    await this.ensureInitialized()

    const results = this.sqlite!.prepare(`
      SELECT shard_id, node_count, edge_count, size_bytes FROM shard_assignments
      ORDER BY shard_id
    `).all() as Array<{ shard_id: number; node_count: number; edge_count: number; size_bytes: number }>

    return results.map((r) => ({
      shardId: r.shard_id,
      nodeCount: r.node_count,
      edgeCount: r.edge_count,
      sizeBytes: r.size_bytes,
    }))
  }

  /**
   * Get the shard assignment for a node using consistent hashing.
   */
  getShardForNode(nodeId: string): number {
    // Simple hash-based shard assignment
    let hash = 0
    for (let i = 0; i < nodeId.length; i++) {
      hash = ((hash << 5) - hash + nodeId.charCodeAt(i)) | 0
    }
    return Math.abs(hash) % this.supernodeConfig.shardCount
  }

  /**
   * Rebalance data across shards.
   */
  async rebalanceShards(): Promise<void> {
    await this.ensureInitialized()

    // Recalculate shard stats from actual data
    const shardStats = new Map<number, { nodeCount: number; edgeCount: number; sizeBytes: number }>()

    // Initialize stats
    for (let i = 0; i < this.supernodeConfig.shardCount; i++) {
      shardStats.set(i, { nodeCount: 0, edgeCount: 0, sizeBytes: 0 })
    }

    // Count nodes per shard
    const nodes = this.sqlite!.prepare(`SELECT DISTINCT node_id FROM node_degrees`).all() as { node_id: string }[]
    for (const node of nodes) {
      const shardId = this.getShardForNode(node.node_id)
      const stats = shardStats.get(shardId)!
      stats.nodeCount++
    }

    // Count edges per shard (based on source node)
    const edges = this.sqlite!.prepare(`SELECT node_id, LENGTH(data) as data_len FROM adjacency_out`).all() as {
      node_id: string
      data_len: number | null
    }[]
    for (const edge of edges) {
      const shardId = this.getShardForNode(edge.node_id)
      const stats = shardStats.get(shardId)!
      stats.edgeCount++
      stats.sizeBytes += edge.data_len ?? 0
    }

    // Update shard assignments table
    const updateStmt = this.sqlite!.prepare(`
      UPDATE shard_assignments
      SET node_count = ?, edge_count = ?, size_bytes = ?
      WHERE shard_id = ?
    `)

    const transaction = this.sqlite!.transaction(() => {
      for (const [shardId, stats] of shardStats) {
        updateStmt.run(stats.nodeCount, stats.edgeCount, stats.sizeBytes, shardId)
      }
    })

    transaction()
  }

  // =========================================================================
  // MAINTENANCE OPERATIONS
  // =========================================================================

  /**
   * Compact the storage by removing tombstones and optimizing.
   */
  async compact(): Promise<void> {
    await this.ensureInitialized()

    // Rebuild indexes for better performance
    this.sqlite!.exec(`
      REINDEX adjacency_out;
      REINDEX adjacency_in;
      REINDEX node_degrees;
    `)

    // Recalculate shard stats
    await this.rebalanceShards()
  }

  /**
   * Vacuum the database to reclaim disk space.
   */
  async vacuum(): Promise<void> {
    await this.ensureInitialized()

    // SQLite VACUUM reclaims space from deleted records
    this.sqlite!.exec('VACUUM')
  }

  /**
   * Get comprehensive graph statistics.
   */
  async getStats(): Promise<GraphStats> {
    await this.ensureInitialized()

    // Count total edges
    const edgeCount = this.sqlite!.prepare(`SELECT COUNT(*) as count FROM adjacency_out`).get() as { count: number }

    // Count unique nodes
    const nodeCount = this.sqlite!.prepare(`
      SELECT COUNT(DISTINCT node_id) as count FROM (
        SELECT node_id FROM adjacency_out
        UNION
        SELECT target_id as node_id FROM adjacency_out
      )
    `).get() as { count: number }

    // Get max degree
    const maxDegree = this.sqlite!.prepare(`
      SELECT MAX(out_degree + in_degree) as max FROM node_degrees
    `).get() as { max: number | null }

    // Count supernodes
    const supernodeCount = this.sqlite!.prepare(`
      SELECT COUNT(*) as count FROM node_degrees
      WHERE (out_degree + in_degree) >= ?
    `).get(this.supernodeConfig.threshold) as { count: number }

    const totalNodes = nodeCount.count
    const totalEdges = edgeCount.count
    const avgDegree = totalNodes > 0 ? (totalEdges * 2) / totalNodes : 0

    return {
      totalNodes,
      totalEdges,
      avgDegree,
      maxDegree: maxDegree.max ?? 0,
      supernodeCount: supernodeCount.count,
    }
  }

  /**
   * Get all unique node IDs in the graph.
   */
  async getAllNodeIds(): Promise<string[]> {
    await this.ensureInitialized()

    // Get all unique node IDs from both source and target of edges
    const results = this.sqlite!.prepare(`
      SELECT DISTINCT node_id FROM (
        SELECT node_id FROM node_degrees
        UNION
        SELECT node_id FROM adjacency_out
        UNION
        SELECT target_id as node_id FROM adjacency_out
      )
    `).all() as Array<{ node_id: string }>

    return results.map((r) => r.node_id)
  }

  // =========================================================================
  // PRIVATE HELPERS
  // =========================================================================

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }

  private getNodeDegreeByType(nodeId: string): Record<string, { out: number; in: number }> {
    const result = this.sqlite!.prepare(`
      SELECT degree_by_type FROM node_degrees WHERE node_id = ?
    `).get(nodeId) as { degree_by_type: string } | undefined

    if (!result) {
      return {}
    }

    return JSON.parse(result.degree_by_type)
  }

  private incrementDegree(nodeId: string, edgeType: string, direction: 'out' | 'in'): void {
    const degrees = this.getNodeDegreeByType(nodeId)
    degrees[edgeType] = degrees[edgeType] || { out: 0, in: 0 }

    if (direction === 'out') {
      degrees[edgeType].out++
    } else {
      degrees[edgeType].in++
    }

    const degreeJson = JSON.stringify(degrees)
    const outIncr = direction === 'out' ? 1 : 0
    const inIncr = direction === 'in' ? 1 : 0

    this.sqlite!.prepare(`
      INSERT INTO node_degrees (node_id, out_degree, in_degree, degree_by_type)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(node_id) DO UPDATE SET
        out_degree = out_degree + ?,
        in_degree = in_degree + ?,
        degree_by_type = ?
    `).run(nodeId, outIncr, inIncr, degreeJson, outIncr, inIncr, degreeJson)
  }

  private decrementDegree(nodeId: string, edgeType: string, direction: 'out' | 'in'): void {
    const degrees = this.getNodeDegreeByType(nodeId)
    if (degrees[edgeType]) {
      if (direction === 'out') {
        degrees[edgeType].out = Math.max(0, degrees[edgeType].out - 1)
      } else {
        degrees[edgeType].in = Math.max(0, degrees[edgeType].in - 1)
      }
    }

    const degreeJson = JSON.stringify(degrees)
    const outDecr = direction === 'out' ? 1 : 0
    const inDecr = direction === 'in' ? 1 : 0

    this.sqlite!.prepare(`
      UPDATE node_degrees
      SET out_degree = MAX(0, out_degree - ?),
          in_degree = MAX(0, in_degree - ?),
          degree_by_type = ?
      WHERE node_id = ?
    `).run(outDecr, inDecr, degreeJson, nodeId)
  }

  private queryNeighborsOut(
    nodeId: string,
    type: string | string[] | undefined,
    limit: number | undefined,
    offset: number,
    orderBy: string,
    orderDirection: string
  ): Array<{ target_id: string; edge_type: string; rel_id: string; data: string | null; created_at: number }> {
    let query = `SELECT target_id, edge_type, rel_id, data, created_at FROM adjacency_out WHERE node_id = ?`
    const params: (string | number)[] = [nodeId]

    if (type) {
      const types = Array.isArray(type) ? type : [type]
      const placeholders = types.map(() => '?').join(', ')
      query += ` AND edge_type IN (${placeholders})`
      params.push(...types)
    }

    query += ` ORDER BY ${orderBy === 'type' ? 'edge_type' : 'created_at'} ${orderDirection.toUpperCase()}`

    if (limit !== undefined) {
      query += ` LIMIT ? OFFSET ?`
      params.push(limit, offset)
    }

    return this.sqlite!.prepare(query).all(...params) as Array<{
      target_id: string
      edge_type: string
      rel_id: string
      data: string | null
      created_at: number
    }>
  }

  private queryNeighborsIn(
    nodeId: string,
    type: string | string[] | undefined,
    limit: number | undefined,
    offset: number,
    orderBy: string,
    orderDirection: string
  ): Array<{ source_id: string; edge_type: string; rel_id: string; data: string | null; created_at: number }> {
    let query = `SELECT source_id, edge_type, rel_id, data, created_at FROM adjacency_in WHERE node_id = ?`
    const params: (string | number)[] = [nodeId]

    if (type) {
      const types = Array.isArray(type) ? type : [type]
      const placeholders = types.map(() => '?').join(', ')
      query += ` AND edge_type IN (${placeholders})`
      params.push(...types)
    }

    query += ` ORDER BY ${orderBy === 'type' ? 'edge_type' : 'created_at'} ${orderDirection.toUpperCase()}`

    if (limit !== undefined) {
      query += ` LIMIT ? OFFSET ?`
      params.push(limit, offset)
    }

    return this.sqlite!.prepare(query).all(...params) as Array<{
      source_id: string
      edge_type: string
      rel_id: string
      data: string | null
      created_at: number
    }>
  }

  private async rebuildBloomFilters(): Promise<void> {
    // Reset bloom filters
    this.edgeBloomFilter = new BloomFilter(131072, 5)
    this.vertexBloomFilter = new BloomFilter(65536, 4)

    // Rebuild from existing data
    const edges = this.sqlite!.prepare(`
      SELECT node_id, target_id, edge_type FROM adjacency_out
    `).all() as Array<{ node_id: string; target_id: string; edge_type: string }>

    for (const edge of edges) {
      this.edgeBloomFilter.add(`${edge.node_id}:${edge.target_id}:${edge.edge_type}`)
      this.edgeBloomFilter.add(`${edge.node_id}:${edge.target_id}`)
      this.vertexBloomFilter.add(edge.node_id)
      this.vertexBloomFilter.add(edge.target_id)
    }
  }

  // =========================================================================
  // LEAN GRAPH COLUMNS - Hierarchy Operations (depth, is_leaf, is_root)
  // =========================================================================

  /**
   * Get hierarchy information for a node.
   *
   * @param nodeId - The node to get hierarchy info for
   * @param edgeType - The edge type defining the hierarchy
   * @returns NodeHierarchyInfo with depth, is_leaf, is_root, and counts
   */
  async getNodeHierarchy(
    nodeId: string,
    edgeType: string
  ): Promise<{
    nodeId: string
    depth: number
    is_leaf: boolean
    is_root: boolean
    childCount: number
    parentCount: number
  }> {
    await this.ensureInitialized()

    // Count children (outgoing edges)
    const childResult = this.sqlite!.prepare(`
      SELECT COUNT(*) as count FROM adjacency_out
      WHERE node_id = ? AND edge_type = ?
    `).get(nodeId, edgeType) as { count: number }

    // Count parents (incoming edges)
    const parentResult = this.sqlite!.prepare(`
      SELECT COUNT(*) as count FROM adjacency_in
      WHERE node_id = ? AND edge_type = ?
    `).get(nodeId, edgeType) as { count: number }

    // Compute depth using recursive traversal
    const depth = await this.computeNodeDepth(nodeId, edgeType)

    return {
      nodeId,
      depth,
      is_leaf: childResult.count === 0,
      is_root: parentResult.count === 0,
      childCount: childResult.count,
      parentCount: parentResult.count,
    }
  }

  /**
   * Get all leaf nodes for a hierarchy (nodes with no children).
   *
   * @param edgeType - The edge type defining the hierarchy
   * @returns Array of node IDs that are leaves
   */
  async getLeafNodes(edgeType: string): Promise<string[]> {
    await this.ensureInitialized()

    // Leaf nodes are targets (in adjacency_in) that are not sources (not in adjacency_out)
    const results = this.sqlite!.prepare(`
      SELECT DISTINCT ai.node_id
      FROM adjacency_in ai
      WHERE ai.edge_type = ?
        AND ai.node_id NOT IN (
          SELECT ao.node_id FROM adjacency_out ao WHERE ao.edge_type = ?
        )
    `).all(edgeType, edgeType) as { node_id: string }[]

    return results.map((r) => r.node_id)
  }

  /**
   * Get all root nodes for a hierarchy (nodes with no parent).
   *
   * @param edgeType - The edge type defining the hierarchy
   * @returns Array of node IDs that are roots
   */
  async getRootNodes(edgeType: string): Promise<string[]> {
    await this.ensureInitialized()

    // Root nodes are sources (in adjacency_out) that are not targets (not in adjacency_in)
    const results = this.sqlite!.prepare(`
      SELECT DISTINCT ao.node_id
      FROM adjacency_out ao
      WHERE ao.edge_type = ?
        AND ao.node_id NOT IN (
          SELECT ai.node_id FROM adjacency_in ai WHERE ai.edge_type = ?
        )
    `).all(edgeType, edgeType) as { node_id: string }[]

    return results.map((r) => r.node_id)
  }

  /**
   * Get all nodes at a specific depth in the hierarchy.
   *
   * @param edgeType - The edge type defining the hierarchy
   * @param depth - The depth level (0 = roots)
   * @returns Array of node IDs at the specified depth
   */
  async getNodesAtDepth(edgeType: string, depth: number): Promise<string[]> {
    await this.ensureInitialized()

    // Get all root nodes first
    const roots = await this.getRootNodes(edgeType)

    if (depth === 0) {
      return roots
    }

    // BFS to find nodes at the target depth
    let currentLevel = roots
    for (let d = 0; d < depth; d++) {
      if (currentLevel.length === 0) {
        return []
      }

      const nextLevel: string[] = []
      for (const nodeId of currentLevel) {
        const children = await this.getOutNeighbors(nodeId, edgeType)
        nextLevel.push(...children)
      }
      currentLevel = [...new Set(nextLevel)] // Deduplicate
    }

    return currentLevel
  }

  /**
   * Get the maximum depth of the hierarchy.
   *
   * @param edgeType - The edge type defining the hierarchy
   * @returns Maximum depth (-1 if empty)
   */
  async getMaxDepth(edgeType: string): Promise<number> {
    await this.ensureInitialized()

    // Use recursive CTE to compute max depth
    const result = this.sqlite!.prepare(`
      WITH RECURSIVE hierarchy AS (
        -- Base case: root nodes have depth 0
        SELECT node_id, 0 as depth
        FROM adjacency_out
        WHERE edge_type = ?
          AND node_id NOT IN (
            SELECT DISTINCT node_id FROM adjacency_in WHERE edge_type = ?
          )

        UNION ALL

        -- Recursive case: children have parent's depth + 1
        SELECT ao.target_id as node_id, h.depth + 1 as depth
        FROM adjacency_out ao
        INNER JOIN hierarchy h ON ao.node_id = h.node_id
        WHERE ao.edge_type = ?
          AND h.depth < 100  -- Prevent infinite recursion
      )
      SELECT MAX(depth) as max_depth FROM hierarchy
    `).get(edgeType, edgeType, edgeType) as { max_depth: number | null }

    return result.max_depth ?? -1
  }

  /**
   * Compute the depth of a specific node in the hierarchy.
   *
   * @param nodeId - The node to compute depth for
   * @param edgeType - The edge type defining the hierarchy
   * @returns Depth from root (0 for root nodes)
   */
  private async computeNodeDepth(nodeId: string, edgeType: string): Promise<number> {
    // Trace path to root by following incoming edges
    let depth = 0
    let current = nodeId
    const visited = new Set<string>()

    while (true) {
      if (visited.has(current)) {
        // Cycle detected
        break
      }
      visited.add(current)

      // Get parent
      const parent = this.sqlite!.prepare(`
        SELECT source_id FROM adjacency_in
        WHERE node_id = ? AND edge_type = ?
        LIMIT 1
      `).get(current, edgeType) as { source_id: string } | undefined

      if (!parent) {
        // Reached root
        break
      }

      current = parent.source_id
      depth++
    }

    return depth
  }

  /**
   * Get the path from a node to its root.
   *
   * @param nodeId - The node to trace from
   * @param edgeType - The edge type defining the hierarchy
   * @returns Array of node IDs from nodeId to root (inclusive)
   */
  async getPathToRoot(nodeId: string, edgeType: string): Promise<string[]> {
    await this.ensureInitialized()

    const path: string[] = [nodeId]
    let current = nodeId
    const visited = new Set<string>()

    while (true) {
      if (visited.has(current)) {
        break
      }
      visited.add(current)

      const parent = this.sqlite!.prepare(`
        SELECT source_id FROM adjacency_in
        WHERE node_id = ? AND edge_type = ?
        LIMIT 1
      `).get(current, edgeType) as { source_id: string } | undefined

      if (!parent) {
        break
      }

      current = parent.source_id
      path.push(current)
    }

    return path
  }

  /**
   * Get all descendants of a node.
   *
   * @param nodeId - The node to get descendants for
   * @param edgeType - The edge type defining the hierarchy
   * @param maxDepth - Maximum depth to traverse (optional)
   * @returns Array of descendant node IDs
   */
  async getDescendants(
    nodeId: string,
    edgeType: string,
    maxDepth?: number
  ): Promise<string[]> {
    await this.ensureInitialized()

    const descendants: string[] = []
    const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }]
    const visited = new Set<string>([nodeId])

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!

      if (maxDepth !== undefined && depth >= maxDepth) {
        continue
      }

      const children = await this.getOutNeighbors(id, edgeType)
      for (const child of children) {
        if (!visited.has(child)) {
          visited.add(child)
          descendants.push(child)
          queue.push({ id: child, depth: depth + 1 })
        }
      }
    }

    return descendants
  }

  /**
   * Get all ancestors of a node.
   *
   * @param nodeId - The node to get ancestors for
   * @param edgeType - The edge type defining the hierarchy
   * @returns Array of ancestor node IDs (from immediate parent to root)
   */
  async getAncestors(nodeId: string, edgeType: string): Promise<string[]> {
    const path = await this.getPathToRoot(nodeId, edgeType)
    // Remove the node itself from the path
    return path.slice(1)
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create an AdjacencyIndex with optional configuration.
 *
 * @example
 * ```typescript
 * // In-memory for testing
 * const index = createAdjacencyIndex()
 *
 * // With file path
 * const index = createAdjacencyIndex('/path/to/db.sqlite')
 *
 * // With existing connection
 * const index = createAdjacencyIndex(existingDbConnection)
 * ```
 */
export function createAdjacencyIndex(
  connectionOrPath: string | import('better-sqlite3').Database = ':memory:'
): AdjacencyIndex {
  return new AdjacencyIndex(connectionOrPath)
}
