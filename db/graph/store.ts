/**
 * GraphStore Class
 *
 * Relationship and edge storage with traversal queries.
 * Provides bidirectional lookups, cycle detection, shortest path, and CDC events.
 *
 * @module db/graph/store
 */

import type {
  RelateInput,
  Relationship,
  EdgeQueryOptions,
  TraverseOptions,
  TraverseResult,
  FindPathOptions,
  ShortestPathOptions,
  CDCEvent,
  CDCHandler,
  SchemaInfo,
  ConstraintInfo,
  IndexInfo,
} from './graph-store-types'
import { traverse } from './traversal'
import { detectCycle as detectCycleAlgo, findPath as findPathAlgo, shortestPath as shortestPathAlgo } from './algorithms'

/**
 * Generate a unique ID for a relationship.
 */
function generateId(): string {
  return `rel_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
}

/**
 * Extract the type from a node ID (e.g., 'User/alice' -> 'User').
 */
function extractType(nodeId: string): string {
  const slashIndex = nodeId.indexOf('/')
  if (slashIndex === -1) {
    return nodeId
  }
  return nodeId.substring(0, slashIndex)
}

/**
 * GraphStore provides edge CRUD, bidirectional lookups, traversal queries,
 * cycle detection, and shortest path algorithms.
 *
 * Uses an in-memory store for this implementation (tests use mock db).
 */
export class GraphStore {
  /** In-memory storage for relationships (keyed by composite key) */
  private relationships: Map<string, Relationship> = new Map()

  /** Index: from_id -> relationships */
  private fromIndex: Map<string, Relationship[]> = new Map()

  /** Index: to_id -> relationships */
  private toIndex: Map<string, Relationship[]> = new Map()

  /** CDC event handlers */
  private cdcHandlers: CDCHandler[] = []

  /** Database instance (kept for compatibility but unused in mock mode) */
  private db: unknown

  constructor(db: unknown) {
    this.db = db
  }

  // ==========================================================================
  // EDGE CRUD OPERATIONS
  // ==========================================================================

  /**
   * Create a relationship between two nodes.
   */
  async relate(input: RelateInput): Promise<Relationship> {
    const { from, to, type, data = null } = input
    const compositeKey = `${from}|${to}|${type}`

    // Check for duplicate
    if (this.relationships.has(compositeKey)) {
      throw new Error(`Relationship already exists: ${from} -> ${to} (${type})`)
    }

    const now = Date.now()
    const relationship: Relationship = {
      $id: generateId(),
      from,
      from_type: extractType(from),
      to,
      to_type: extractType(to),
      type,
      data: data ?? null,
      $createdAt: now,
      $updatedAt: now,
    }

    // Store relationship
    this.relationships.set(compositeKey, relationship)

    // Update from index
    const fromEdges = this.fromIndex.get(from) ?? []
    fromEdges.push(relationship)
    this.fromIndex.set(from, fromEdges)

    // Update to index
    const toEdges = this.toIndex.get(to) ?? []
    toEdges.push(relationship)
    this.toIndex.set(to, toEdges)

    // Emit CDC event
    this.emitCDC({
      type: 'cdc.insert',
      op: 'c',
      store: 'graph',
      table: 'relationships',
      key: relationship.$id,
      after: {
        from: relationship.from,
        to: relationship.to,
        type: relationship.type,
        data: relationship.data,
      },
    })

    return relationship
  }

  /**
   * Delete a relationship between two nodes.
   */
  async unrelate(from: string, to: string, type: string): Promise<boolean> {
    const compositeKey = `${from}|${to}|${type}`
    const relationship = this.relationships.get(compositeKey)

    if (!relationship) {
      return false
    }

    // Remove from main store
    this.relationships.delete(compositeKey)

    // Remove from from index
    const fromEdges = this.fromIndex.get(from)
    if (fromEdges) {
      const filtered = fromEdges.filter((r) => r.$id !== relationship.$id)
      if (filtered.length > 0) {
        this.fromIndex.set(from, filtered)
      } else {
        this.fromIndex.delete(from)
      }
    }

    // Remove from to index
    const toEdges = this.toIndex.get(to)
    if (toEdges) {
      const filtered = toEdges.filter((r) => r.$id !== relationship.$id)
      if (filtered.length > 0) {
        this.toIndex.set(to, filtered)
      } else {
        this.toIndex.delete(to)
      }
    }

    // Emit CDC event
    this.emitCDC({
      type: 'cdc.delete',
      op: 'd',
      store: 'graph',
      table: 'relationships',
      key: relationship.$id,
      before: {
        from: relationship.from,
        to: relationship.to,
        type: relationship.type,
      },
    })

    return true
  }

  /**
   * Check if a relationship exists.
   */
  async exists(from: string, to: string, type: string): Promise<boolean> {
    const compositeKey = `${from}|${to}|${type}`
    return this.relationships.has(compositeKey)
  }

  /**
   * Update a relationship's data.
   */
  async updateRelationship(
    from: string,
    to: string,
    type: string,
    updates: { data: Record<string, unknown> },
  ): Promise<Relationship | null> {
    const compositeKey = `${from}|${to}|${type}`
    const relationship = this.relationships.get(compositeKey)

    if (!relationship) {
      return null
    }

    const before = { data: relationship.data }
    relationship.data = updates.data
    relationship.$updatedAt = Date.now()

    // Emit CDC event
    this.emitCDC({
      type: 'cdc.update',
      op: 'u',
      store: 'graph',
      table: 'relationships',
      key: relationship.$id,
      before,
      after: { data: updates.data },
    })

    return relationship
  }

  // ==========================================================================
  // BIDIRECTIONAL LOOKUPS
  // ==========================================================================

  /**
   * Get all outgoing edges from a node.
   */
  async outgoing(nodeId: string, options?: EdgeQueryOptions): Promise<Relationship[]> {
    const edges = this.fromIndex.get(nodeId) ?? []
    if (options?.type) {
      return edges.filter((r) => r.type === options.type)
    }
    return edges
  }

  /**
   * Get all incoming edges to a node.
   */
  async incoming(nodeId: string, options?: EdgeQueryOptions): Promise<Relationship[]> {
    const edges = this.toIndex.get(nodeId) ?? []
    if (options?.type) {
      return edges.filter((r) => r.type === options.type)
    }
    return edges
  }

  /**
   * Batch query outgoing edges for multiple nodes.
   */
  async outgoingBatch(
    nodeIds: string[],
    options?: EdgeQueryOptions,
  ): Promise<Map<string, Relationship[]>> {
    const result = new Map<string, Relationship[]>()
    for (const nodeId of nodeIds) {
      const edges = await this.outgoing(nodeId, options)
      result.set(nodeId, edges)
    }
    return result
  }

  // ==========================================================================
  // TRAVERSAL QUERIES
  // ==========================================================================

  /**
   * Traverse the graph from a starting node.
   */
  async traverse(options: TraverseOptions): Promise<TraverseResult> {
    const getNeighbors = (nodeId: string, types: string[]): Relationship[] => {
      let edges: Relationship[]
      if (options.direction === 'outgoing') {
        edges = this.fromIndex.get(nodeId) ?? []
      } else {
        edges = this.toIndex.get(nodeId) ?? []
      }
      return edges.filter((r) => types.includes(r.type))
    }

    return traverse(options, getNeighbors)
  }

  // ==========================================================================
  // CYCLE DETECTION
  // ==========================================================================

  /**
   * Detect if there is a cycle starting from the given node.
   */
  async detectCycle(start: string, type: string): Promise<boolean> {
    const getOutgoing = (nodeId: string, relType: string): Relationship[] => {
      const edges = this.fromIndex.get(nodeId) ?? []
      return edges.filter((r) => r.type === relType)
    }

    return detectCycleAlgo(start, type, getOutgoing)
  }

  // ==========================================================================
  // SHORTEST PATH
  // ==========================================================================

  /**
   * Find any path between two nodes.
   */
  async findPath(options: FindPathOptions): Promise<string[] | null> {
    const { from, to, types } = options

    const getOutgoing = (nodeId: string, relTypes: string[]): Relationship[] => {
      const edges = this.fromIndex.get(nodeId) ?? []
      return edges.filter((r) => relTypes.includes(r.type))
    }

    return findPathAlgo(from, to, types, getOutgoing)
  }

  /**
   * Find the shortest path between two nodes.
   */
  async shortestPath(options: ShortestPathOptions): Promise<string[] | null> {
    const { from, to, types, maxDepth = Infinity } = options

    const getOutgoing = (nodeId: string, relTypes: string[]): Relationship[] => {
      const edges = this.fromIndex.get(nodeId) ?? []
      return edges.filter((r) => relTypes.includes(r.type))
    }

    return shortestPathAlgo(from, to, types, maxDepth, getOutgoing)
  }

  // ==========================================================================
  // CDC EVENT EMISSION
  // ==========================================================================

  /**
   * Register a CDC event handler.
   */
  onCDC(handler: CDCHandler): void {
    this.cdcHandlers.push(handler)
  }

  /**
   * Emit a CDC event to all registered handlers.
   */
  private emitCDC(event: CDCEvent): void {
    for (const handler of this.cdcHandlers) {
      handler(event)
    }
  }

  // ==========================================================================
  // SCHEMA INTROSPECTION
  // ==========================================================================

  /**
   * Get schema information.
   */
  async getSchema(): Promise<SchemaInfo> {
    return {
      tables: ['relationships'],
      columns: {
        relationships: [
          '$id',
          'from_id',
          'from_type',
          'to_id',
          'to_type',
          'type',
          'data',
          '$createdAt',
          '$updatedAt',
        ],
      },
    }
  }

  /**
   * Get constraint information.
   */
  async getConstraints(): Promise<ConstraintInfo[]> {
    return [
      {
        table: 'relationships',
        type: 'unique',
        columns: ['from_id', 'to_id', 'type'],
      },
    ]
  }

  /**
   * Get index information.
   */
  async getIndexes(): Promise<IndexInfo[]> {
    return [
      {
        table: 'relationships',
        name: 'idx_rel_from',
        columns: ['from_id', 'type'],
      },
      {
        table: 'relationships',
        name: 'idx_rel_to',
        columns: ['to_id', 'type'],
      },
    ]
  }
}
