/**
 * DrizzleLineageStore - Drizzle ORM-based Lineage Storage
 *
 * A type-safe implementation of the LineageStore using Drizzle ORM
 * for all database operations. Provides CRUD operations for nodes
 * and edges with proper type inference.
 *
 * ## Why Drizzle?
 *
 * - Type-safe queries with full TypeScript inference
 * - No runtime type assertions needed
 * - Composable query builder
 * - Works with multiple SQLite adapters (better-sqlite3, D1, libSQL)
 *
 * @example
 * ```typescript
 * import { drizzle } from 'drizzle-orm/better-sqlite3'
 * import Database from 'better-sqlite3'
 * import { createDrizzleLineageStore } from './store'
 *
 * const sqlite = new Database(':memory:')
 * const db = drizzle(sqlite)
 * const store = createDrizzleLineageStore(db)
 *
 * // Create a node
 * const node = await store.createNode({
 *   type: 'entity',
 *   name: 'users',
 *   namespace: 'warehouse',
 * })
 *
 * // Query nodes
 * const entities = await store.findNodes({ type: 'entity' })
 * ```
 *
 * @module db/primitives/lineage-tracker/store
 */

import { eq, and, like, desc } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { lineageNodes, lineageEdges, type LineageNodeRecord, type LineageEdgeRecord } from './schema'
import type {
  LineageNode,
  LineageEdge,
  CreateNodeInput,
  CreateEdgeInput,
  NodeQuery,
  EdgeQuery,
  NodeType,
} from './types'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Drizzle database interface - compatible with better-sqlite3, D1, libSQL
 */
export interface DrizzleDatabase {
  select(): {
    from: <T>(table: T) => {
      where: (condition: SQL) => {
        get: () => unknown
        all: () => unknown[]
        orderBy: (...args: unknown[]) => {
          limit: (n: number) => {
            offset: (n: number) => { all: () => unknown[] }
            all: () => unknown[]
          }
          all: () => unknown[]
        }
      }
      orderBy: (...args: unknown[]) => {
        limit: (n: number) => {
          offset: (n: number) => { all: () => unknown[] }
          all: () => unknown[]
        }
        all: () => unknown[]
      }
      limit: (n: number) => {
        offset: (n: number) => { all: () => unknown[] }
        all: () => unknown[]
      }
      get: () => unknown
      all: () => unknown[]
    }
  }
  insert: <T>(table: T) => {
    values: (data: unknown) => {
      returning: () => { get: () => unknown; all: () => unknown[] }
      run: () => void
    }
  }
  update: <T>(table: T) => {
    set: (data: unknown) => {
      where: (condition: SQL) => {
        returning: () => { get: () => unknown }
        run: () => void
      }
    }
  }
  delete: <T>(table: T) => {
    where: (condition: SQL) => { run: () => void }
  }
}

/**
 * Configuration options for DrizzleLineageStore
 */
export interface DrizzleLineageStoreConfig {
  /** Prefix for auto-generated IDs (default: 'ln') */
  idPrefix?: string
  /** Enable cycle detection during edge creation (default: true) */
  detectCycles?: boolean
}

// =============================================================================
// DRIZZLE LINEAGE STORE CLASS
// =============================================================================

/**
 * DrizzleLineageStore - Type-safe lineage storage using Drizzle ORM
 *
 * Provides CRUD operations for lineage nodes and edges with full
 * TypeScript type inference. Uses async/await pattern for consistency
 * with other async APIs.
 */
export class DrizzleLineageStore {
  private db: DrizzleDatabase
  private config: Required<DrizzleLineageStoreConfig>
  private idCounter = 0

  /**
   * Create a new DrizzleLineageStore instance
   *
   * @param db - Drizzle database instance
   * @param config - Optional configuration
   */
  constructor(db: DrizzleDatabase, config?: DrizzleLineageStoreConfig) {
    this.db = db
    this.config = {
      idPrefix: config?.idPrefix ?? 'ln',
      detectCycles: config?.detectCycles ?? true,
    }
  }

  /**
   * Generate a unique ID with the configured prefix
   */
  private generateId(prefix: string): string {
    const timestamp = Date.now().toString(36)
    const counter = (this.idCounter++).toString(36)
    const random = Math.random().toString(36).substring(2, 6)
    return `${prefix}-${timestamp}-${counter}-${random}`
  }

  // ===========================================================================
  // NODE OPERATIONS
  // ===========================================================================

  /**
   * Create a new node in the lineage graph
   *
   * @param input - Node creation input
   * @returns The created node with all fields populated
   */
  async createNode(input: CreateNodeInput): Promise<LineageNode> {
    const now = Date.now()
    const id = input.id ?? this.generateId(this.config.idPrefix)
    const metadata = input.metadata ?? {}

    const result = this.db
      .insert(lineageNodes)
      .values({
        id,
        type: input.type,
        name: input.name,
        namespace: input.namespace ?? null,
        metadata,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get() as LineageNodeRecord

    return this.recordToNode(result)
  }

  /**
   * Get a node by ID
   *
   * @param id - Node ID to retrieve
   * @returns The node or null if not found
   */
  async getNode(id: string): Promise<LineageNode | null> {
    const result = this.db
      .select()
      .from(lineageNodes)
      .where(eq(lineageNodes.id, id))
      .get() as LineageNodeRecord | undefined

    if (!result) return null

    return this.recordToNode(result)
  }

  /**
   * Update an existing node
   *
   * @param id - Node ID to update
   * @param updates - Partial node updates
   * @returns The updated node or null if not found
   */
  async updateNode(
    id: string,
    updates: Partial<Omit<LineageNode, 'id' | 'createdAt'>>
  ): Promise<LineageNode | null> {
    const existing = await this.getNode(id)
    if (!existing) return null

    const now = Date.now()

    // Build update object preserving existing values for unspecified fields
    const updateData: Record<string, unknown> = {
      updatedAt: now,
    }

    if (updates.type !== undefined) updateData.type = updates.type
    if (updates.name !== undefined) updateData.name = updates.name
    if (updates.namespace !== undefined) updateData.namespace = updates.namespace
    if (updates.metadata !== undefined) updateData.metadata = updates.metadata

    const result = this.db
      .update(lineageNodes)
      .set(updateData)
      .where(eq(lineageNodes.id, id))
      .returning()
      .get() as LineageNodeRecord

    return this.recordToNode(result)
  }

  /**
   * Delete a node and all its edges (via CASCADE)
   *
   * @param id - Node ID to delete
   */
  async deleteNode(id: string): Promise<void> {
    this.db.delete(lineageNodes).where(eq(lineageNodes.id, id)).run()
  }

  /**
   * Find nodes matching query criteria
   *
   * @param query - Query options for filtering, pagination
   * @returns Array of matching nodes
   */
  async findNodes(query?: NodeQuery): Promise<LineageNode[]> {
    const conditions: SQL[] = []

    if (query?.type) {
      conditions.push(eq(lineageNodes.type, query.type))
    }

    if (query?.namespace) {
      conditions.push(eq(lineageNodes.namespace, query.namespace))
    }

    if (query?.nameContains) {
      conditions.push(like(lineageNodes.name, `%${query.nameContains}%`))
    }

    // Build query with conditions
    let baseQuery = this.db.select().from(lineageNodes)

    if (conditions.length > 0) {
      const where = conditions.length === 1 ? conditions[0] : and(...conditions)!
      baseQuery = baseQuery.where(where) as typeof baseQuery
    }

    // Apply ordering and pagination
    let orderedQuery = baseQuery.orderBy(desc(lineageNodes.createdAt))

    let results: unknown[]

    if (query?.limit !== undefined && query?.offset !== undefined) {
      results = orderedQuery.limit(query.limit).offset(query.offset).all()
    } else if (query?.limit !== undefined) {
      results = orderedQuery.limit(query.limit).all()
    } else if (query?.offset !== undefined) {
      // SQLite requires LIMIT when using OFFSET
      results = orderedQuery.limit(999999999).offset(query.offset).all()
    } else {
      results = orderedQuery.all()
    }

    return (results as LineageNodeRecord[]).map((r) => this.recordToNode(r))
  }

  /**
   * Bulk create multiple nodes
   *
   * @param inputs - Array of node creation inputs
   * @returns Array of created nodes
   */
  async createNodes(inputs: CreateNodeInput[]): Promise<LineageNode[]> {
    if (inputs.length === 0) return []

    const nodes: LineageNode[] = []
    for (const input of inputs) {
      const node = await this.createNode(input)
      nodes.push(node)
    }
    return nodes
  }

  // ===========================================================================
  // EDGE OPERATIONS
  // ===========================================================================

  /**
   * Create a new edge in the lineage graph
   *
   * @param input - Edge creation input
   * @returns The created edge
   * @throws Error if source or target node not found, or if cycle detected
   */
  async createEdge(input: CreateEdgeInput): Promise<LineageEdge> {
    // Verify source node exists
    const fromNode = await this.getNode(input.fromNodeId)
    if (!fromNode) {
      throw new Error(`Source node not found: ${input.fromNodeId}`)
    }

    // Verify target node exists
    const toNode = await this.getNode(input.toNodeId)
    if (!toNode) {
      throw new Error(`Target node not found: ${input.toNodeId}`)
    }

    // Check for cycles if enabled
    if (this.config.detectCycles) {
      const wouldCycle = await this.wouldCreateCycle(input.fromNodeId, input.toNodeId)
      if (wouldCycle) {
        throw new Error(`Edge would create a cycle: ${input.fromNodeId} -> ${input.toNodeId}`)
      }
    }

    const now = Date.now()
    const id = input.id ?? this.generateId('le')
    const metadata = input.metadata ?? {}

    const result = this.db
      .insert(lineageEdges)
      .values({
        id,
        fromNodeId: input.fromNodeId,
        toNodeId: input.toNodeId,
        operation: input.operation,
        metadata,
        timestamp: now,
      })
      .returning()
      .get() as LineageEdgeRecord

    return this.recordToEdge(result)
  }

  /**
   * Get an edge by ID
   *
   * @param id - Edge ID to retrieve
   * @returns The edge or null if not found
   */
  async getEdge(id: string): Promise<LineageEdge | null> {
    const result = this.db
      .select()
      .from(lineageEdges)
      .where(eq(lineageEdges.id, id))
      .get() as LineageEdgeRecord | undefined

    if (!result) return null

    return this.recordToEdge(result)
  }

  /**
   * Delete an edge
   *
   * @param id - Edge ID to delete
   */
  async deleteEdge(id: string): Promise<void> {
    this.db.delete(lineageEdges).where(eq(lineageEdges.id, id)).run()
  }

  /**
   * Find edges matching query criteria
   *
   * @param query - Query options for filtering, pagination
   * @returns Array of matching edges
   */
  async findEdges(query?: EdgeQuery): Promise<LineageEdge[]> {
    const conditions: SQL[] = []

    if (query?.fromNodeId) {
      conditions.push(eq(lineageEdges.fromNodeId, query.fromNodeId))
    }

    if (query?.toNodeId) {
      conditions.push(eq(lineageEdges.toNodeId, query.toNodeId))
    }

    if (query?.operation) {
      conditions.push(eq(lineageEdges.operation, query.operation))
    }

    // Build query with conditions
    let baseQuery = this.db.select().from(lineageEdges)

    if (conditions.length > 0) {
      const where = conditions.length === 1 ? conditions[0] : and(...conditions)!
      baseQuery = baseQuery.where(where) as typeof baseQuery
    }

    // Apply ordering and pagination
    let orderedQuery = baseQuery.orderBy(desc(lineageEdges.timestamp))

    let results: unknown[]

    if (query?.limit !== undefined && query?.offset !== undefined) {
      results = orderedQuery.limit(query.limit).offset(query.offset).all()
    } else if (query?.limit !== undefined) {
      results = orderedQuery.limit(query.limit).all()
    } else if (query?.offset !== undefined) {
      results = orderedQuery.limit(999999999).offset(query.offset).all()
    } else {
      results = orderedQuery.all()
    }

    return (results as LineageEdgeRecord[]).map((r) => this.recordToEdge(r))
  }

  /**
   * Bulk create multiple edges
   *
   * @param inputs - Array of edge creation inputs
   * @returns Array of created edges
   */
  async createEdges(inputs: CreateEdgeInput[]): Promise<LineageEdge[]> {
    if (inputs.length === 0) return []

    const edges: LineageEdge[] = []
    for (const input of inputs) {
      const edge = await this.createEdge(input)
      edges.push(edge)
    }
    return edges
  }

  /**
   * Get outgoing edges from a node
   *
   * @param nodeId - Node ID to get outgoing edges for
   * @returns Array of edges where fromNodeId matches
   */
  async getOutgoingEdges(nodeId: string): Promise<LineageEdge[]> {
    return this.findEdges({ fromNodeId: nodeId })
  }

  /**
   * Get incoming edges to a node
   *
   * @param nodeId - Node ID to get incoming edges for
   * @returns Array of edges where toNodeId matches
   */
  async getIncomingEdges(nodeId: string): Promise<LineageEdge[]> {
    return this.findEdges({ toNodeId: nodeId })
  }

  // ===========================================================================
  // CYCLE DETECTION
  // ===========================================================================

  /**
   * Check if adding an edge would create a cycle in the graph
   *
   * @param fromNodeId - Source node ID
   * @param toNodeId - Target node ID
   * @returns True if adding this edge would create a cycle
   */
  private async wouldCreateCycle(fromNodeId: string, toNodeId: string): Promise<boolean> {
    // Self-loop is always a cycle
    if (fromNodeId === toNodeId) return true

    // BFS from toNodeId to see if we can reach fromNodeId
    // If we can, adding fromNodeId -> toNodeId would create a cycle
    const visited = new Set<string>()
    const queue = [toNodeId]

    while (queue.length > 0) {
      const current = queue.shift()!

      if (current === fromNodeId) return true
      if (visited.has(current)) continue

      visited.add(current)

      // Get all outgoing edges from current node
      const outgoingEdges = await this.getOutgoingEdges(current)
      for (const edge of outgoingEdges) {
        if (!visited.has(edge.toNodeId)) {
          queue.push(edge.toNodeId)
        }
      }
    }

    return false
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /**
   * Convert a database record to a LineageNode
   */
  private recordToNode(record: LineageNodeRecord): LineageNode {
    return {
      id: record.id,
      type: record.type as NodeType,
      name: record.name,
      namespace: record.namespace ?? undefined,
      metadata: (record.metadata ?? {}) as Record<string, unknown>,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  }

  /**
   * Convert a database record to a LineageEdge
   */
  private recordToEdge(record: LineageEdgeRecord): LineageEdge {
    return {
      id: record.id,
      fromNodeId: record.fromNodeId,
      toNodeId: record.toNodeId,
      operation: record.operation,
      metadata: (record.metadata ?? {}) as Record<string, unknown>,
      timestamp: record.timestamp,
    }
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new DrizzleLineageStore instance
 *
 * @param db - Drizzle database instance
 * @param config - Optional configuration
 * @returns A new DrizzleLineageStore instance
 *
 * @example
 * ```typescript
 * import { drizzle } from 'drizzle-orm/better-sqlite3'
 * import Database from 'better-sqlite3'
 * import { createDrizzleLineageStore, LINEAGE_DRIZZLE_SCHEMA } from './store'
 *
 * const sqlite = new Database(':memory:')
 * sqlite.exec(LINEAGE_DRIZZLE_SCHEMA) // Create tables
 * const db = drizzle(sqlite)
 * const store = createDrizzleLineageStore(db)
 * ```
 */
export function createDrizzleLineageStore(
  db: DrizzleDatabase,
  config?: DrizzleLineageStoreConfig
): DrizzleLineageStore {
  return new DrizzleLineageStore(db, config)
}
