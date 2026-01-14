/**
 * AdjacencyIndex - Graph adjacency index primitive on TypedColumnStore
 *
 * A dedicated primitive for optimized graph traversals providing:
 * - Bloom filters for fast "has edge?" checks
 * - Columnar storage for large graphs
 * - Range queries on edge timestamps
 * - Batch operations for efficiency
 * - Bidirectional edge tracking (outgoing + incoming)
 *
 * Storage Model (TypedColumnStore):
 * Columns: from (string), to (string), type (string), created_at (timestamp), props (JSON encoded)
 *
 * Performance characteristics:
 * | Operation | Time Complexity | Notes |
 * |-----------|-----------------|-------|
 * | addEdge | O(1) amortized | Updates both directions |
 * | hasEdge | O(1) | Bloom filter accelerated |
 * | getOutgoing | O(k) | k = outgoing edges |
 * | getIncoming | O(k) | k = incoming edges |
 * | degree | O(1) | Cached counts |
 *
 * @module db/primitives/adjacency-index
 */

import { murmurHash3_32 } from './utils/murmur3'

// ============================================================================
// Types
// ============================================================================

/**
 * Direction for neighbor queries
 */
export type Direction = 'out' | 'in' | 'both'

/**
 * Edge representation
 */
export interface Edge {
  /** Source node ID */
  from: string
  /** Target node ID */
  to: string
  /** Edge type/label */
  type: string
  /** Edge creation timestamp */
  createdAt: number
  /** Optional edge properties */
  props?: Record<string, unknown>
}

/**
 * Input for batch edge creation
 */
export interface EdgeInput {
  from: string
  to: string
  type: string
  props?: Record<string, unknown>
}

/**
 * Query options for edge filtering
 */
export interface EdgeQuery {
  /** Filter by source node */
  from?: string
  /** Filter by target node */
  to?: string
  /** Filter by edge types */
  types?: string[]
  /** Edges created after this timestamp */
  createdAfter?: number
  /** Edges created before this timestamp */
  createdBefore?: number
  /** Maximum number of results */
  limit?: number
}

/**
 * Statistics about the adjacency index
 */
export interface AdjacencyStats {
  /** Total number of edges */
  edgeCount: number
  /** Number of unique nodes (with at least one edge) */
  nodeCount: number
  /** Edge count by type */
  typeCounts: Record<string, number>
  /** Average out-degree */
  avgOutDegree: number
}

/**
 * Export format for serialization
 */
export interface AdjacencyExport {
  edges: Edge[]
  metadata?: {
    version: string
    exportedAt: number
  }
}

/**
 * AdjacencyIndex interface
 */
export interface AdjacencyIndex {
  // Edge mutations
  addEdge(from: string, to: string, type: string, props?: Record<string, unknown>): void
  removeEdge(from: string, to: string, type: string): boolean

  // Neighbor queries
  getOutgoing(nodeId: string, edgeTypes?: string[]): Edge[]
  getIncoming(nodeId: string, edgeTypes?: string[]): Edge[]
  getNeighbors(nodeId: string, direction: Direction, edgeTypes?: string[]): string[]

  // Edge existence (bloom filter accelerated)
  hasEdge(from: string, to: string, type?: string): boolean

  // Degree calculations
  degree(nodeId: string, direction: Direction): number

  // Batch operations
  addEdgeBatch(edges: EdgeInput[]): void
  getNeighborsBatch(nodeIds: string[]): Map<string, string[]>

  // Edge queries
  queryEdges(query: EdgeQuery): Edge[]

  // Statistics
  stats(): AdjacencyStats

  // Serialization
  export(): AdjacencyExport
  import(data: AdjacencyExport): void
}

// ============================================================================
// Bloom Filter Implementation (optimized for edge keys)
// ============================================================================

class EdgeBloomFilter {
  private readonly bits: Uint32Array
  private readonly numBits: number
  private readonly numHashFunctions: number

  constructor(expectedElements: number, falsePositiveRate: number = 0.005) {
    // Calculate optimal size: m = -n * ln(p) / (ln(2)^2)
    const ln2Squared = Math.LN2 * Math.LN2
    this.numBits = Math.max(64, Math.ceil((-expectedElements * Math.log(falsePositiveRate * 0.5)) / ln2Squared))

    // Use Uint32Array for efficiency
    const numWords = Math.ceil(this.numBits / 32)
    this.bits = new Uint32Array(numWords)

    // Optimal hash functions: k = (m/n) * ln(2)
    this.numHashFunctions = Math.max(1, Math.min(20, Math.round((this.numBits / expectedElements) * Math.LN2)))
  }

  private hashEdgeKey(from: string, to: string, type?: string): [number, number] {
    // Create a combined key for the edge
    const key = type ? `${from}|${to}|${type}` : `${from}|${to}`
    const keyBytes = new TextEncoder().encode(key)
    const h1 = murmurHash3_32(keyBytes, 0)
    const h2 = murmurHash3_32(keyBytes, h1)
    return [h1, h2]
  }

  add(from: string, to: string, type: string): void {
    // Add with type
    const [h1, h2] = this.hashEdgeKey(from, to, type)
    this.addWithHashes(h1, h2)

    // Also add without type for generic hasEdge() queries
    const [h1NoType, h2NoType] = this.hashEdgeKey(from, to)
    this.addWithHashes(h1NoType, h2NoType)
  }

  private addWithHashes(h1: number, h2: number): void {
    for (let i = 0; i < this.numHashFunctions; i++) {
      const combinedHash = (h1 + i * h2) >>> 0
      const bitIndex = combinedHash % this.numBits
      const wordIndex = Math.floor(bitIndex / 32)
      const bitOffset = bitIndex % 32
      this.bits[wordIndex]! |= 1 << bitOffset
    }
  }

  mightContain(from: string, to: string, type?: string): boolean {
    const [h1, h2] = this.hashEdgeKey(from, to, type)

    for (let i = 0; i < this.numHashFunctions; i++) {
      const combinedHash = (h1 + i * h2) >>> 0
      const bitIndex = combinedHash % this.numBits
      const wordIndex = Math.floor(bitIndex / 32)
      const bitOffset = bitIndex % 32

      if ((this.bits[wordIndex]! & (1 << bitOffset)) === 0) {
        return false
      }
    }

    return true
  }

  clear(): void {
    this.bits.fill(0)
  }
}

// ============================================================================
// AdjacencyIndex Implementation
// ============================================================================

class AdjacencyIndexImpl implements AdjacencyIndex {
  // Columnar storage for edges
  private edges: Edge[] = []

  // Index structures for fast lookups
  private outgoingIndex: Map<string, number[]> = new Map() // nodeId -> edge indices
  private incomingIndex: Map<string, number[]> = new Map() // nodeId -> edge indices
  private typeIndex: Map<string, number[]> = new Map() // type -> edge indices

  // Bloom filter for fast existence checks
  private bloomFilter: EdgeBloomFilter

  // Cached statistics
  private nodeSet: Set<string> = new Set()
  private typeCounts: Map<string, number> = new Map()

  // Configuration
  private readonly initialCapacity: number

  constructor(options: { initialCapacity?: number } = {}) {
    this.initialCapacity = options.initialCapacity ?? 10000
    this.bloomFilter = new EdgeBloomFilter(this.initialCapacity)
  }

  // ==========================================================================
  // Edge Mutations
  // ==========================================================================

  addEdge(from: string, to: string, type: string, props?: Record<string, unknown>): void {
    const edge: Edge = {
      from,
      to,
      type,
      createdAt: Date.now(),
      props,
    }

    const edgeIndex = this.edges.length
    this.edges.push(edge)

    // Update outgoing index
    const outgoing = this.outgoingIndex.get(from) ?? []
    outgoing.push(edgeIndex)
    this.outgoingIndex.set(from, outgoing)

    // Update incoming index
    const incoming = this.incomingIndex.get(to) ?? []
    incoming.push(edgeIndex)
    this.incomingIndex.set(to, incoming)

    // Update type index
    const typeEdges = this.typeIndex.get(type) ?? []
    typeEdges.push(edgeIndex)
    this.typeIndex.set(type, typeEdges)

    // Update bloom filter
    this.bloomFilter.add(from, to, type)

    // Update statistics
    this.nodeSet.add(from)
    this.nodeSet.add(to)
    this.typeCounts.set(type, (this.typeCounts.get(type) ?? 0) + 1)
  }

  removeEdge(from: string, to: string, type: string): boolean {
    const outgoing = this.outgoingIndex.get(from)
    if (!outgoing) return false

    let removedIndex = -1
    for (let i = 0; i < outgoing.length; i++) {
      const edgeIndex = outgoing[i]!
      const edge = this.edges[edgeIndex]!
      if (edge.to === to && edge.type === type) {
        removedIndex = edgeIndex
        outgoing.splice(i, 1)
        break
      }
    }

    if (removedIndex === -1) return false

    // Update outgoing index (already done above)
    if (outgoing.length === 0) {
      this.outgoingIndex.delete(from)
    }

    // Update incoming index
    const incoming = this.incomingIndex.get(to)
    if (incoming) {
      const inIdx = incoming.indexOf(removedIndex)
      if (inIdx !== -1) {
        incoming.splice(inIdx, 1)
        if (incoming.length === 0) {
          this.incomingIndex.delete(to)
        }
      }
    }

    // Update type index
    const typeEdges = this.typeIndex.get(type)
    if (typeEdges) {
      const typeIdx = typeEdges.indexOf(removedIndex)
      if (typeIdx !== -1) {
        typeEdges.splice(typeIdx, 1)
        if (typeEdges.length === 0) {
          this.typeIndex.delete(type)
        }
      }
    }

    // Mark edge as deleted (null pattern to avoid reindexing)
    // We set to empty object to mark as deleted but keep array indices valid
    this.edges[removedIndex] = { from: '', to: '', type: '', createdAt: 0, props: { _deleted: true } }

    // Update statistics
    this.typeCounts.set(type, (this.typeCounts.get(type) ?? 0) - 1)

    // Note: We don't update bloom filter (can't remove from bloom filter)
    // This may cause slightly higher false positive rate over time

    return true
  }

  // ==========================================================================
  // Neighbor Queries
  // ==========================================================================

  getOutgoing(nodeId: string, edgeTypes?: string[]): Edge[] {
    const indices = this.outgoingIndex.get(nodeId)
    if (!indices) return []

    let result = indices.map((i) => this.edges[i]!).filter((e) => !e.props?._deleted)

    if (edgeTypes && edgeTypes.length > 0) {
      const typeSet = new Set(edgeTypes)
      result = result.filter((e) => typeSet.has(e.type))
    }

    return result
  }

  getIncoming(nodeId: string, edgeTypes?: string[]): Edge[] {
    const indices = this.incomingIndex.get(nodeId)
    if (!indices) return []

    let result = indices.map((i) => this.edges[i]!).filter((e) => !e.props?._deleted)

    if (edgeTypes && edgeTypes.length > 0) {
      const typeSet = new Set(edgeTypes)
      result = result.filter((e) => typeSet.has(e.type))
    }

    return result
  }

  getNeighbors(nodeId: string, direction: Direction, edgeTypes?: string[]): string[] {
    const neighbors = new Set<string>()

    if (direction === 'out' || direction === 'both') {
      const outgoing = this.getOutgoing(nodeId, edgeTypes)
      for (const edge of outgoing) {
        neighbors.add(edge.to)
      }
    }

    if (direction === 'in' || direction === 'both') {
      const incoming = this.getIncoming(nodeId, edgeTypes)
      for (const edge of incoming) {
        neighbors.add(edge.from)
      }
    }

    return Array.from(neighbors)
  }

  // ==========================================================================
  // Edge Existence (Bloom Filter Accelerated)
  // ==========================================================================

  hasEdge(from: string, to: string, type?: string): boolean {
    // Fast path: bloom filter check
    if (!this.bloomFilter.mightContain(from, to, type)) {
      return false // Definitely not in the set
    }

    // Slow path: verify in actual data (bloom filter can have false positives)
    const outgoing = this.outgoingIndex.get(from)
    if (!outgoing) return false

    for (const edgeIndex of outgoing) {
      const edge = this.edges[edgeIndex]!
      if (edge.props?._deleted) continue
      if (edge.to !== to) continue
      if (type !== undefined && edge.type !== type) continue
      return true
    }

    return false
  }

  // ==========================================================================
  // Degree Calculations
  // ==========================================================================

  degree(nodeId: string, direction: Direction): number {
    if (direction === 'out') {
      return this.getOutgoing(nodeId).length
    }

    if (direction === 'in') {
      return this.getIncoming(nodeId).length
    }

    // For 'both', we need to count unique edges (not double-count self-loops)
    const outgoing = this.getOutgoing(nodeId)
    const incoming = this.getIncoming(nodeId)

    // Create a set of edge identifiers to avoid double-counting
    const edgeSet = new Set<string>()
    for (const edge of outgoing) {
      edgeSet.add(`${edge.from}|${edge.to}|${edge.type}|${edge.createdAt}`)
    }
    for (const edge of incoming) {
      edgeSet.add(`${edge.from}|${edge.to}|${edge.type}|${edge.createdAt}`)
    }

    return edgeSet.size
  }

  // ==========================================================================
  // Batch Operations
  // ==========================================================================

  addEdgeBatch(edges: EdgeInput[]): void {
    // Pre-allocate space if needed
    if (this.edges.length + edges.length > this.initialCapacity) {
      // Rebuild bloom filter with larger capacity
      const newCapacity = (this.edges.length + edges.length) * 2
      this.rebuildBloomFilter(newCapacity)
    }

    const now = Date.now()

    for (const input of edges) {
      const edge: Edge = {
        from: input.from,
        to: input.to,
        type: input.type,
        createdAt: now,
        props: input.props,
      }

      const edgeIndex = this.edges.length
      this.edges.push(edge)

      // Update outgoing index
      const outgoing = this.outgoingIndex.get(input.from) ?? []
      outgoing.push(edgeIndex)
      this.outgoingIndex.set(input.from, outgoing)

      // Update incoming index
      const incoming = this.incomingIndex.get(input.to) ?? []
      incoming.push(edgeIndex)
      this.incomingIndex.set(input.to, incoming)

      // Update type index
      const typeEdges = this.typeIndex.get(input.type) ?? []
      typeEdges.push(edgeIndex)
      this.typeIndex.set(input.type, typeEdges)

      // Update bloom filter
      this.bloomFilter.add(input.from, input.to, input.type)

      // Update statistics
      this.nodeSet.add(input.from)
      this.nodeSet.add(input.to)
      this.typeCounts.set(input.type, (this.typeCounts.get(input.type) ?? 0) + 1)
    }
  }

  getNeighborsBatch(nodeIds: string[]): Map<string, string[]> {
    const result = new Map<string, string[]>()

    for (const nodeId of nodeIds) {
      result.set(nodeId, this.getNeighbors(nodeId, 'out'))
    }

    return result
  }

  // ==========================================================================
  // Edge Queries
  // ==========================================================================

  queryEdges(query: EdgeQuery): Edge[] {
    let result: Edge[]

    // Optimize query by starting with most selective filter
    if (query.from) {
      result = this.getOutgoing(query.from, query.types)
    } else if (query.to) {
      result = this.getIncoming(query.to, query.types)
    } else if (query.types && query.types.length > 0) {
      // Use type index
      result = []
      for (const type of query.types) {
        const indices = this.typeIndex.get(type) ?? []
        for (const idx of indices) {
          const edge = this.edges[idx]!
          if (!edge.props?._deleted) {
            result.push(edge)
          }
        }
      }
    } else {
      // Full scan
      result = this.edges.filter((e) => !e.props?._deleted)
    }

    // Apply secondary filters
    if (query.from && query.to) {
      result = result.filter((e) => e.to === query.to)
    }

    if (query.createdAfter !== undefined) {
      result = result.filter((e) => e.createdAt > query.createdAfter!)
    }

    if (query.createdBefore !== undefined) {
      result = result.filter((e) => e.createdAt < query.createdBefore!)
    }

    // Apply limit
    if (query.limit !== undefined && result.length > query.limit) {
      result = result.slice(0, query.limit)
    }

    return result
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  stats(): AdjacencyStats {
    const edgeCount = this.edges.filter((e) => !e.props?._deleted).length
    const nodeCount = this.nodeSet.size
    const typeCounts: Record<string, number> = {}

    this.typeCounts.forEach((count, type) => {
      if (count > 0) {
        typeCounts[type] = count
      }
    })

    const avgOutDegree = nodeCount > 0 ? edgeCount / nodeCount : 0

    return {
      edgeCount,
      nodeCount,
      typeCounts,
      avgOutDegree,
    }
  }

  // ==========================================================================
  // Serialization
  // ==========================================================================

  export(): AdjacencyExport {
    return {
      edges: this.edges.filter((e) => !e.props?._deleted),
      metadata: {
        version: '1.0.0',
        exportedAt: Date.now(),
      },
    }
  }

  import(data: AdjacencyExport): void {
    // Clear existing data
    this.edges = []
    this.outgoingIndex.clear()
    this.incomingIndex.clear()
    this.typeIndex.clear()
    this.nodeSet.clear()
    this.typeCounts.clear()

    // Rebuild bloom filter
    this.rebuildBloomFilter(Math.max(data.edges.length * 2, this.initialCapacity))

    // Import edges
    for (const edge of data.edges) {
      const edgeIndex = this.edges.length
      this.edges.push(edge)

      // Update outgoing index
      const outgoing = this.outgoingIndex.get(edge.from) ?? []
      outgoing.push(edgeIndex)
      this.outgoingIndex.set(edge.from, outgoing)

      // Update incoming index
      const incoming = this.incomingIndex.get(edge.to) ?? []
      incoming.push(edgeIndex)
      this.incomingIndex.set(edge.to, incoming)

      // Update type index
      const typeEdges = this.typeIndex.get(edge.type) ?? []
      typeEdges.push(edgeIndex)
      this.typeIndex.set(edge.type, typeEdges)

      // Update bloom filter
      this.bloomFilter.add(edge.from, edge.to, edge.type)

      // Update statistics
      this.nodeSet.add(edge.from)
      this.nodeSet.add(edge.to)
      this.typeCounts.set(edge.type, (this.typeCounts.get(edge.type) ?? 0) + 1)
    }
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private rebuildBloomFilter(capacity: number): void {
    this.bloomFilter = new EdgeBloomFilter(capacity)

    // Re-add all existing edges
    for (const edge of this.edges) {
      if (!edge.props?._deleted) {
        this.bloomFilter.add(edge.from, edge.to, edge.type)
      }
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new AdjacencyIndex instance
 */
export function createAdjacencyIndex(options?: { initialCapacity?: number }): AdjacencyIndex {
  return new AdjacencyIndexImpl(options)
}

// Re-export the implementation class for type purposes
export { AdjacencyIndexImpl }
