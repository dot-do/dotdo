/**
 * LineageTracker Storage - SQLite Schema and Operations
 *
 * Provides SQLite-backed storage for lineage nodes and edges with efficient
 * indexing for graph traversal operations.
 *
 * @module db/primitives/lineage-tracker/storage
 */

import type {
  LineageNode,
  LineageEdge,
  CreateNodeInput,
  CreateEdgeInput,
  NodeQuery,
  EdgeQuery,
  NodeType,
  LineageStats,
  LineageTrackerConfig,
} from './types'

// =============================================================================
// SCHEMA DEFINITIONS (SQL)
// =============================================================================

/**
 * SQL statements for creating the lineage schema
 */
export const LINEAGE_SCHEMA = `
-- Nodes table: stores all entities in the lineage graph
CREATE TABLE IF NOT EXISTS lineage_nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('entity', 'transformation', 'source', 'sink')),
  name TEXT NOT NULL,
  namespace TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Edges table: stores relationships between nodes
CREATE TABLE IF NOT EXISTS lineage_edges (
  id TEXT PRIMARY KEY,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (from_node_id) REFERENCES lineage_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (to_node_id) REFERENCES lineage_nodes(id) ON DELETE CASCADE
);

-- Indexes for efficient graph traversal
CREATE INDEX IF NOT EXISTS idx_lineage_edges_from ON lineage_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_lineage_edges_to ON lineage_edges(to_node_id);
CREATE INDEX IF NOT EXISTS idx_lineage_nodes_type ON lineage_nodes(type);
CREATE INDEX IF NOT EXISTS idx_lineage_nodes_namespace ON lineage_nodes(namespace);
CREATE INDEX IF NOT EXISTS idx_lineage_edges_operation ON lineage_edges(operation);
CREATE INDEX IF NOT EXISTS idx_lineage_edges_timestamp ON lineage_edges(timestamp);
`

// =============================================================================
// SQL EXECUTOR TYPE
// =============================================================================

/**
 * Minimal SQL executor interface compatible with DO SqlStorage
 */
export interface SqlExecutor {
  exec(sql: string): void
  // biome-ignore lint/suspicious/noExplicitAny: SQL results can be any shape
  prepare(sql: string): { bind(...args: unknown[]): { all(): any[]; run(): void; first(): any } }
}

// =============================================================================
// LINEAGE STORE CLASS
// =============================================================================

/**
 * LineageStore - SQLite-backed storage for lineage graph
 *
 * Provides CRUD operations for nodes and edges with efficient
 * graph traversal support.
 */
export class LineageStore {
  private sql: SqlExecutor
  private config: Required<LineageTrackerConfig>
  private idCounter = 0

  constructor(sql: SqlExecutor, config?: LineageTrackerConfig) {
    this.sql = sql
    this.config = {
      autoGenerateIds: config?.autoGenerateIds ?? true,
      idPrefix: config?.idPrefix ?? 'ln',
      maxTraversalDepth: config?.maxTraversalDepth ?? 100,
      detectCycles: config?.detectCycles ?? true,
    }
  }

  /**
   * Initialize the schema (idempotent)
   */
  initialize(): void {
    this.sql.exec(LINEAGE_SCHEMA)
  }

  /**
   * Generate a unique ID
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
   */
  createNode(input: CreateNodeInput): LineageNode {
    const now = Date.now()
    const id = input.id ?? this.generateId(this.config.idPrefix)

    const node: LineageNode = {
      id,
      type: input.type,
      name: input.name,
      namespace: input.namespace,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    }

    this.sql
      .prepare(
        `INSERT INTO lineage_nodes (id, type, name, namespace, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, node.type, node.name, node.namespace ?? null, JSON.stringify(node.metadata), now, now)
      .run()

    return node
  }

  /**
   * Get a node by ID
   */
  getNode(id: string): LineageNode | null {
    const row = this.sql
      .prepare('SELECT * FROM lineage_nodes WHERE id = ?')
      .bind(id)
      .first()

    if (!row) return null

    return this.rowToNode(row)
  }

  /**
   * Update an existing node
   */
  updateNode(id: string, updates: Partial<Omit<LineageNode, 'id' | 'createdAt'>>): LineageNode | null {
    const existing = this.getNode(id)
    if (!existing) return null

    const now = Date.now()
    const updated: LineageNode = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: now,
      metadata: updates.metadata ?? existing.metadata,
    }

    this.sql
      .prepare(
        `UPDATE lineage_nodes
         SET type = ?, name = ?, namespace = ?, metadata = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(
        updated.type,
        updated.name,
        updated.namespace ?? null,
        JSON.stringify(updated.metadata),
        now,
        id
      )
      .run()

    return updated
  }

  /**
   * Delete a node and all its edges
   */
  deleteNode(id: string): boolean {
    const existing = this.getNode(id)
    if (!existing) return false

    // Edges are deleted via CASCADE
    this.sql.prepare('DELETE FROM lineage_nodes WHERE id = ?').bind(id).run()

    return true
  }

  /**
   * Find nodes matching query criteria
   */
  findNodes(query?: NodeQuery): LineageNode[] {
    const conditions: string[] = []
    const params: unknown[] = []

    if (query?.type) {
      conditions.push('type = ?')
      params.push(query.type)
    }

    if (query?.namespace) {
      conditions.push('namespace = ?')
      params.push(query.namespace)
    }

    if (query?.nameContains) {
      conditions.push('name LIKE ?')
      params.push(`%${query.nameContains}%`)
    }

    let sql = 'SELECT * FROM lineage_nodes'
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`
    }
    sql += ' ORDER BY created_at DESC'

    if (query?.limit) {
      sql += ' LIMIT ?'
      params.push(query.limit)
    }

    if (query?.offset) {
      sql += ' OFFSET ?'
      params.push(query.offset)
    }

    const rows = this.sql.prepare(sql).bind(...params).all()
    return rows.map((row) => this.rowToNode(row))
  }

  /**
   * Bulk create nodes
   */
  createNodes(inputs: CreateNodeInput[]): LineageNode[] {
    return inputs.map((input) => this.createNode(input))
  }

  // ===========================================================================
  // EDGE OPERATIONS
  // ===========================================================================

  /**
   * Create a new edge in the lineage graph
   */
  createEdge(input: CreateEdgeInput): LineageEdge {
    // Verify both nodes exist
    const fromNode = this.getNode(input.fromNodeId)
    const toNode = this.getNode(input.toNodeId)

    if (!fromNode) {
      throw new Error(`Source node not found: ${input.fromNodeId}`)
    }
    if (!toNode) {
      throw new Error(`Target node not found: ${input.toNodeId}`)
    }

    // Detect cycles if enabled
    if (this.config.detectCycles && this.wouldCreateCycle(input.fromNodeId, input.toNodeId)) {
      throw new Error(`Edge would create a cycle: ${input.fromNodeId} -> ${input.toNodeId}`)
    }

    const now = Date.now()
    const id = input.id ?? this.generateId('le')

    const edge: LineageEdge = {
      id,
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      operation: input.operation,
      metadata: input.metadata ?? {},
      timestamp: now,
    }

    this.sql
      .prepare(
        `INSERT INTO lineage_edges (id, from_node_id, to_node_id, operation, metadata, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(id, edge.fromNodeId, edge.toNodeId, edge.operation, JSON.stringify(edge.metadata), now)
      .run()

    return edge
  }

  /**
   * Get an edge by ID
   */
  getEdge(id: string): LineageEdge | null {
    const row = this.sql
      .prepare('SELECT * FROM lineage_edges WHERE id = ?')
      .bind(id)
      .first()

    if (!row) return null

    return this.rowToEdge(row)
  }

  /**
   * Delete an edge
   */
  deleteEdge(id: string): boolean {
    const existing = this.getEdge(id)
    if (!existing) return false

    this.sql.prepare('DELETE FROM lineage_edges WHERE id = ?').bind(id).run()

    return true
  }

  /**
   * Find edges matching query criteria
   */
  findEdges(query?: EdgeQuery): LineageEdge[] {
    const conditions: string[] = []
    const params: unknown[] = []

    if (query?.fromNodeId) {
      conditions.push('from_node_id = ?')
      params.push(query.fromNodeId)
    }

    if (query?.toNodeId) {
      conditions.push('to_node_id = ?')
      params.push(query.toNodeId)
    }

    if (query?.operation) {
      conditions.push('operation = ?')
      params.push(query.operation)
    }

    let sql = 'SELECT * FROM lineage_edges'
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`
    }
    sql += ' ORDER BY timestamp DESC'

    if (query?.limit) {
      sql += ' LIMIT ?'
      params.push(query.limit)
    }

    if (query?.offset) {
      sql += ' OFFSET ?'
      params.push(query.offset)
    }

    const rows = this.sql.prepare(sql).bind(...params).all()
    return rows.map((row) => this.rowToEdge(row))
  }

  /**
   * Bulk create edges
   */
  createEdges(inputs: CreateEdgeInput[]): LineageEdge[] {
    return inputs.map((input) => this.createEdge(input))
  }

  /**
   * Get edges from a node (outgoing)
   */
  getOutgoingEdges(nodeId: string): LineageEdge[] {
    const rows = this.sql
      .prepare('SELECT * FROM lineage_edges WHERE from_node_id = ? ORDER BY timestamp DESC')
      .bind(nodeId)
      .all()
    return rows.map((row) => this.rowToEdge(row))
  }

  /**
   * Get edges to a node (incoming)
   */
  getIncomingEdges(nodeId: string): LineageEdge[] {
    const rows = this.sql
      .prepare('SELECT * FROM lineage_edges WHERE to_node_id = ? ORDER BY timestamp DESC')
      .bind(nodeId)
      .all()
    return rows.map((row) => this.rowToEdge(row))
  }

  // ===========================================================================
  // GRAPH OPERATIONS
  // ===========================================================================

  /**
   * Get root nodes (nodes with no incoming edges)
   */
  getRootNodes(): LineageNode[] {
    const rows = this.sql
      .prepare(
        `SELECT n.* FROM lineage_nodes n
         LEFT JOIN lineage_edges e ON n.id = e.to_node_id
         WHERE e.id IS NULL
         ORDER BY n.created_at DESC`
      )
      .bind()
      .all()
    return rows.map((row) => this.rowToNode(row))
  }

  /**
   * Get leaf nodes (nodes with no outgoing edges)
   */
  getLeafNodes(): LineageNode[] {
    const rows = this.sql
      .prepare(
        `SELECT n.* FROM lineage_nodes n
         LEFT JOIN lineage_edges e ON n.id = e.from_node_id
         WHERE e.id IS NULL
         ORDER BY n.created_at DESC`
      )
      .bind()
      .all()
    return rows.map((row) => this.rowToNode(row))
  }

  /**
   * Check if adding an edge would create a cycle
   */
  wouldCreateCycle(fromNodeId: string, toNodeId: string): boolean {
    // If from === to, it's a self-loop
    if (fromNodeId === toNodeId) return true

    // Check if there's already a path from toNodeId to fromNodeId
    // (which would mean adding fromNodeId -> toNodeId creates a cycle)
    const visited = new Set<string>()
    const queue = [toNodeId]

    while (queue.length > 0) {
      const current = queue.shift()!
      if (current === fromNodeId) return true
      if (visited.has(current)) continue
      visited.add(current)

      const outgoing = this.getOutgoingEdges(current)
      for (const edge of outgoing) {
        if (!visited.has(edge.toNodeId)) {
          queue.push(edge.toNodeId)
        }
      }
    }

    return false
  }

  /**
   * Get graph statistics
   */
  getStats(): LineageStats {
    const nodeCountResult = this.sql.prepare('SELECT COUNT(*) as count FROM lineage_nodes').bind().first()
    const nodeCount = (nodeCountResult?.count as number) ?? 0

    const edgeCountResult = this.sql.prepare('SELECT COUNT(*) as count FROM lineage_edges').bind().first()
    const edgeCount = (edgeCountResult?.count as number) ?? 0

    const nodesByTypeRows = this.sql
      .prepare('SELECT type, COUNT(*) as count FROM lineage_nodes GROUP BY type')
      .bind()
      .all()

    const nodesByType: Record<NodeType, number> = {
      entity: 0,
      transformation: 0,
      source: 0,
      sink: 0,
    }

    for (const row of nodesByTypeRows) {
      const type = row.type as NodeType
      nodesByType[type] = row.count as number
    }

    const rootCount = this.getRootNodes().length
    const leafCount = this.getLeafNodes().length

    const avgConnectivity = nodeCount > 0 ? edgeCount / nodeCount : 0

    return {
      nodeCount,
      nodesByType,
      edgeCount,
      rootCount,
      leafCount,
      avgConnectivity,
    }
  }

  /**
   * Clear all lineage data
   */
  clear(): void {
    this.sql.exec('DELETE FROM lineage_edges')
    this.sql.exec('DELETE FROM lineage_nodes')
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  // biome-ignore lint/suspicious/noExplicitAny: SQL row can be any shape
  private rowToNode(row: any): LineageNode {
    return {
      id: row.id,
      type: row.type as NodeType,
      name: row.name,
      namespace: row.namespace ?? undefined,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: SQL row can be any shape
  private rowToEdge(row: any): LineageEdge {
    return {
      id: row.id,
      fromNodeId: row.from_node_id,
      toNodeId: row.to_node_id,
      operation: row.operation,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      timestamp: row.timestamp,
    }
  }
}

/**
 * Create a new LineageStore instance
 */
export function createLineageStore(sql: SqlExecutor, config?: LineageTrackerConfig): LineageStore {
  const store = new LineageStore(sql, config)
  store.initialize()
  return store
}
