/**
 * LineageTracker Time-Travel - Query Historical Lineage State
 *
 * Provides temporal queries for lineage data, enabling:
 * - Point-in-time lineage reconstruction
 * - Lineage change history and audit trails
 * - Diff calculations between timestamps
 *
 * Uses an event-sourced approach where all lineage changes (node/edge
 * create, update, delete) are recorded as immutable events. This enables
 * efficient point-in-time reconstruction without duplicating the entire graph.
 *
 * @module db/primitives/lineage-tracker/time-travel
 */

import type {
  LineageNode,
  LineageEdge,
  LineageGraph,
  NodeType,
  CreateNodeInput,
  CreateEdgeInput,
} from './types'
import type { SqlExecutor } from './storage'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Type of lineage event
 */
export type LineageEventType =
  | 'node_created'
  | 'node_updated'
  | 'node_deleted'
  | 'edge_created'
  | 'edge_deleted'

/**
 * A single lineage change event
 */
export interface LineageEvent {
  /** Unique event ID */
  id: string
  /** Type of change */
  type: LineageEventType
  /** Target entity ID (node or edge) */
  entityId: string
  /** Entity type: 'node' or 'edge' */
  entityType: 'node' | 'edge'
  /** Timestamp when the event occurred (epoch ms) */
  timestamp: number
  /** Snapshot of entity state at time of event (for create/update) */
  snapshot: Record<string, unknown> | null
  /** Previous state (for updates, enables rollback) */
  previousState: Record<string, unknown> | null
  /** Actor who made the change (optional audit field) */
  actor?: string
  /** Reason/comment for the change */
  reason?: string
}

/**
 * Options for time-travel queries
 */
export interface TimeTravelOptions {
  /** Include deleted nodes/edges that existed at the point in time */
  includeDeleted?: boolean
  /** Maximum number of events to return in history queries */
  limit?: number
  /** Filter to specific node types */
  nodeTypes?: NodeType[]
}

/**
 * Result of a lineage diff operation
 */
export interface LineageDiff {
  /** Timestamp of the earlier snapshot */
  fromTimestamp: number
  /** Timestamp of the later snapshot */
  toTimestamp: number
  /** Nodes added between the two timestamps */
  nodesAdded: LineageNode[]
  /** Nodes removed between the two timestamps */
  nodesRemoved: LineageNode[]
  /** Nodes modified between the two timestamps */
  nodesModified: Array<{
    before: LineageNode
    after: LineageNode
    changes: string[]
  }>
  /** Edges added between the two timestamps */
  edgesAdded: LineageEdge[]
  /** Edges removed between the two timestamps */
  edgesRemoved: LineageEdge[]
  /** Summary statistics */
  summary: {
    totalChanges: number
    nodesAddedCount: number
    nodesRemovedCount: number
    nodesModifiedCount: number
    edgesAddedCount: number
    edgesRemovedCount: number
  }
}

/**
 * Configuration for time-travel storage
 */
export interface TimeTravelConfig {
  /** Prefix for auto-generated event IDs */
  idPrefix?: string
  /** Maximum events to retain (0 = unlimited) */
  maxEventRetention?: number
  /** Whether to record previous state for updates */
  trackPreviousState?: boolean
}

// =============================================================================
// SCHEMA
// =============================================================================

/**
 * SQL schema for time-travel event log
 */
export const TIME_TRAVEL_SCHEMA = `
-- Lineage events table: immutable log of all changes
CREATE TABLE IF NOT EXISTS lineage_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('node_created', 'node_updated', 'node_deleted', 'edge_created', 'edge_deleted')),
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('node', 'edge')),
  timestamp INTEGER NOT NULL,
  snapshot TEXT,
  previous_state TEXT,
  actor TEXT,
  reason TEXT
);

-- Index for efficient time-range queries
CREATE INDEX IF NOT EXISTS idx_lineage_events_timestamp ON lineage_events(timestamp);

-- Index for entity-specific history lookups
CREATE INDEX IF NOT EXISTS idx_lineage_events_entity ON lineage_events(entity_id, entity_type);

-- Index for event type filtering
CREATE INDEX IF NOT EXISTS idx_lineage_events_type ON lineage_events(type);

-- Composite index for common query pattern
CREATE INDEX IF NOT EXISTS idx_lineage_events_ts_entity ON lineage_events(timestamp, entity_type);
`

// =============================================================================
// TIME TRAVEL STORE
// =============================================================================

/**
 * TimeTravelStore - Event-sourced lineage change tracking
 *
 * Records all lineage changes as immutable events, enabling
 * point-in-time reconstruction and audit trails.
 */
export class TimeTravelStore {
  private sql: SqlExecutor
  private config: Required<TimeTravelConfig>
  private idCounter = 0

  constructor(sql: SqlExecutor, config?: TimeTravelConfig) {
    this.sql = sql
    this.config = {
      idPrefix: config?.idPrefix ?? 'evt',
      maxEventRetention: config?.maxEventRetention ?? 0,
      trackPreviousState: config?.trackPreviousState ?? true,
    }
  }

  /**
   * Initialize the time-travel schema
   */
  initialize(): void {
    this.sql.exec(TIME_TRAVEL_SCHEMA)
  }

  /**
   * Generate a unique event ID
   */
  private generateId(): string {
    const timestamp = Date.now().toString(36)
    const counter = (this.idCounter++).toString(36)
    const random = Math.random().toString(36).substring(2, 6)
    return `${this.config.idPrefix}-${timestamp}-${counter}-${random}`
  }

  // ===========================================================================
  // EVENT RECORDING
  // ===========================================================================

  /**
   * Record a node creation event
   */
  recordNodeCreated(node: LineageNode, actor?: string, reason?: string): LineageEvent {
    return this.recordEvent({
      type: 'node_created',
      entityId: node.id,
      entityType: 'node',
      timestamp: node.createdAt,
      snapshot: this.nodeToSnapshot(node),
      previousState: null,
      actor,
      reason,
    })
  }

  /**
   * Record a node update event
   */
  recordNodeUpdated(
    previousNode: LineageNode,
    updatedNode: LineageNode,
    actor?: string,
    reason?: string
  ): LineageEvent {
    return this.recordEvent({
      type: 'node_updated',
      entityId: updatedNode.id,
      entityType: 'node',
      timestamp: updatedNode.updatedAt,
      snapshot: this.nodeToSnapshot(updatedNode),
      previousState: this.config.trackPreviousState ? this.nodeToSnapshot(previousNode) : null,
      actor,
      reason,
    })
  }

  /**
   * Record a node deletion event
   */
  recordNodeDeleted(node: LineageNode, actor?: string, reason?: string): LineageEvent {
    return this.recordEvent({
      type: 'node_deleted',
      entityId: node.id,
      entityType: 'node',
      timestamp: Date.now(),
      snapshot: null,
      previousState: this.config.trackPreviousState ? this.nodeToSnapshot(node) : null,
      actor,
      reason,
    })
  }

  /**
   * Record an edge creation event
   */
  recordEdgeCreated(edge: LineageEdge, actor?: string, reason?: string): LineageEvent {
    return this.recordEvent({
      type: 'edge_created',
      entityId: edge.id,
      entityType: 'edge',
      timestamp: edge.timestamp,
      snapshot: this.edgeToSnapshot(edge),
      previousState: null,
      actor,
      reason,
    })
  }

  /**
   * Record an edge deletion event
   */
  recordEdgeDeleted(edge: LineageEdge, actor?: string, reason?: string): LineageEvent {
    return this.recordEvent({
      type: 'edge_deleted',
      entityId: edge.id,
      entityType: 'edge',
      timestamp: Date.now(),
      snapshot: null,
      previousState: this.config.trackPreviousState ? this.edgeToSnapshot(edge) : null,
      actor,
      reason,
    })
  }

  /**
   * Record a raw event (internal)
   */
  private recordEvent(
    event: Omit<LineageEvent, 'id'>
  ): LineageEvent {
    const id = this.generateId()
    const fullEvent: LineageEvent = { ...event, id }

    this.sql
      .prepare(
        `INSERT INTO lineage_events (id, type, entity_id, entity_type, timestamp, snapshot, previous_state, actor, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        event.type,
        event.entityId,
        event.entityType,
        event.timestamp,
        event.snapshot ? JSON.stringify(event.snapshot) : null,
        event.previousState ? JSON.stringify(event.previousState) : null,
        event.actor ?? null,
        event.reason ?? null
      )
      .run()

    return fullEvent
  }

  // ===========================================================================
  // POINT-IN-TIME QUERIES
  // ===========================================================================

  /**
   * Get the state of a node at a specific point in time
   *
   * Returns the node as it existed at the given timestamp, or null if
   * the node didn't exist or had been deleted by that time.
   */
  getNodeAt(nodeId: string, timestamp: number): LineageNode | null {
    // Get all events for this node up to the timestamp
    const events = this.sql
      .prepare(
        `SELECT * FROM lineage_events
         WHERE entity_id = ? AND entity_type = 'node' AND timestamp <= ?
         ORDER BY timestamp ASC`
      )
      .bind(nodeId, timestamp)
      .all()
      .map((row) => this.rowToEvent(row))

    if (events.length === 0) return null

    // Replay events to reconstruct state
    let currentState: LineageNode | null = null

    for (const event of events) {
      switch (event.type) {
        case 'node_created':
        case 'node_updated':
          currentState = event.snapshot ? this.snapshotToNode(event.snapshot) : null
          break
        case 'node_deleted':
          currentState = null
          break
      }
    }

    return currentState
  }

  /**
   * Get the state of an edge at a specific point in time
   */
  getEdgeAt(edgeId: string, timestamp: number): LineageEdge | null {
    // Get all events for this edge up to the timestamp
    const events = this.sql
      .prepare(
        `SELECT * FROM lineage_events
         WHERE entity_id = ? AND entity_type = 'edge' AND timestamp <= ?
         ORDER BY timestamp ASC`
      )
      .bind(edgeId, timestamp)
      .all()
      .map((row) => this.rowToEvent(row))

    if (events.length === 0) return null

    // Replay events to reconstruct state
    let currentState: LineageEdge | null = null

    for (const event of events) {
      switch (event.type) {
        case 'edge_created':
          currentState = event.snapshot ? this.snapshotToEdge(event.snapshot) : null
          break
        case 'edge_deleted':
          currentState = null
          break
      }
    }

    return currentState
  }

  /**
   * Get all nodes that existed at a specific point in time
   */
  getNodesAt(timestamp: number, options?: TimeTravelOptions): LineageNode[] {
    // Get all node events up to the timestamp
    const events = this.sql
      .prepare(
        `SELECT * FROM lineage_events
         WHERE entity_type = 'node' AND timestamp <= ?
         ORDER BY timestamp ASC`
      )
      .bind(timestamp)
      .all()
      .map((row) => this.rowToEvent(row))

    // Replay to build state map
    const nodeStates = new Map<string, LineageNode | null>()

    for (const event of events) {
      switch (event.type) {
        case 'node_created':
        case 'node_updated':
          if (event.snapshot) {
            nodeStates.set(event.entityId, this.snapshotToNode(event.snapshot))
          }
          break
        case 'node_deleted':
          nodeStates.set(event.entityId, null)
          break
      }
    }

    // Filter to non-null (existing) nodes
    let nodes = Array.from(nodeStates.values()).filter((n): n is LineageNode => n !== null)

    // Apply type filter if specified
    if (options?.nodeTypes) {
      nodes = nodes.filter((n) => options.nodeTypes!.includes(n.type))
    }

    return nodes
  }

  /**
   * Get all edges that existed at a specific point in time
   */
  getEdgesAt(timestamp: number): LineageEdge[] {
    // Get all edge events up to the timestamp
    const events = this.sql
      .prepare(
        `SELECT * FROM lineage_events
         WHERE entity_type = 'edge' AND timestamp <= ?
         ORDER BY timestamp ASC`
      )
      .bind(timestamp)
      .all()
      .map((row) => this.rowToEvent(row))

    // Replay to build state map
    const edgeStates = new Map<string, LineageEdge | null>()

    for (const event of events) {
      switch (event.type) {
        case 'edge_created':
          if (event.snapshot) {
            edgeStates.set(event.entityId, this.snapshotToEdge(event.snapshot))
          }
          break
        case 'edge_deleted':
          edgeStates.set(event.entityId, null)
          break
      }
    }

    // Filter to non-null (existing) edges
    return Array.from(edgeStates.values()).filter((e): e is LineageEdge => e !== null)
  }

  /**
   * Get the complete lineage graph at a specific point in time
   *
   * @param assetId - The central asset to get lineage for
   * @param timestamp - Point in time to reconstruct
   * @param options - Query options
   * @returns The lineage graph as it existed at the timestamp
   */
  getLineageAt(assetId: string, timestamp: number, options?: TimeTravelOptions): LineageGraph {
    // Get all nodes and edges at the timestamp
    const allNodes = this.getNodesAt(timestamp, options)
    const allEdges = this.getEdgesAt(timestamp)

    // Build adjacency lists for traversal
    const outgoing = new Map<string, LineageEdge[]>()
    const incoming = new Map<string, LineageEdge[]>()

    for (const edge of allEdges) {
      const outList = outgoing.get(edge.fromNodeId) ?? []
      outList.push(edge)
      outgoing.set(edge.fromNodeId, outList)

      const inList = incoming.get(edge.toNodeId) ?? []
      inList.push(edge)
      incoming.set(edge.toNodeId, inList)
    }

    // Traverse to collect connected subgraph
    const visitedNodes = new Set<string>()
    const visitedEdges = new Set<string>()
    const resultNodes: LineageNode[] = []
    const resultEdges: LineageEdge[] = []

    const nodeMap = new Map(allNodes.map((n) => [n.id, n]))

    // BFS in both directions
    const queue = [assetId]
    visitedNodes.add(assetId)

    // Add the root node if it exists
    const rootNode = nodeMap.get(assetId)
    if (rootNode) {
      resultNodes.push(rootNode)
    }

    while (queue.length > 0) {
      const current = queue.shift()!

      // Traverse upstream (incoming edges)
      for (const edge of incoming.get(current) ?? []) {
        if (!visitedEdges.has(edge.id)) {
          visitedEdges.add(edge.id)
          resultEdges.push(edge)
        }
        if (!visitedNodes.has(edge.fromNodeId)) {
          visitedNodes.add(edge.fromNodeId)
          const node = nodeMap.get(edge.fromNodeId)
          if (node) {
            resultNodes.push(node)
            queue.push(edge.fromNodeId)
          }
        }
      }

      // Traverse downstream (outgoing edges)
      for (const edge of outgoing.get(current) ?? []) {
        if (!visitedEdges.has(edge.id)) {
          visitedEdges.add(edge.id)
          resultEdges.push(edge)
        }
        if (!visitedNodes.has(edge.toNodeId)) {
          visitedNodes.add(edge.toNodeId)
          const node = nodeMap.get(edge.toNodeId)
          if (node) {
            resultNodes.push(node)
            queue.push(edge.toNodeId)
          }
        }
      }
    }

    return {
      nodes: resultNodes,
      edges: resultEdges,
      rootId: assetId,
    }
  }

  // ===========================================================================
  // HISTORY QUERIES
  // ===========================================================================

  /**
   * Get the history of changes for a specific entity
   *
   * @param entityId - ID of the node or edge
   * @param from - Start of time range (epoch ms)
   * @param to - End of time range (epoch ms)
   * @param options - Query options
   */
  getEntityHistory(
    entityId: string,
    from: number,
    to: number,
    options?: TimeTravelOptions
  ): LineageEvent[] {
    let query = `SELECT * FROM lineage_events
                 WHERE entity_id = ? AND timestamp >= ? AND timestamp <= ?
                 ORDER BY timestamp ASC`

    const params: unknown[] = [entityId, from, to]

    if (options?.limit) {
      query += ' LIMIT ?'
      params.push(options.limit)
    }

    return this.sql
      .prepare(query)
      .bind(...params)
      .all()
      .map((row) => this.rowToEvent(row))
  }

  /**
   * Get the complete lineage history for an asset within a time range
   *
   * Returns all events that affected the asset or its connected lineage.
   */
  getLineageHistory(
    assetId: string,
    from: number,
    to: number,
    options?: TimeTravelOptions
  ): LineageEvent[] {
    // First, find all entities connected to this asset at the end time
    const graphAtEnd = this.getLineageAt(assetId, to, options)
    const connectedIds = new Set<string>([
      assetId,
      ...graphAtEnd.nodes.map((n) => n.id),
      ...graphAtEnd.edges.map((e) => e.id),
    ])

    // Also check what was connected at the start time
    const graphAtStart = this.getLineageAt(assetId, from, options)
    for (const node of graphAtStart.nodes) connectedIds.add(node.id)
    for (const edge of graphAtStart.edges) connectedIds.add(edge.id)

    // Get all events for connected entities in the time range
    const placeholders = Array.from(connectedIds).map(() => '?').join(',')
    let query = `SELECT * FROM lineage_events
                 WHERE entity_id IN (${placeholders})
                 AND timestamp >= ? AND timestamp <= ?
                 ORDER BY timestamp ASC`

    const params: unknown[] = [...connectedIds, from, to]

    if (options?.limit) {
      query += ' LIMIT ?'
      params.push(options.limit)
    }

    return this.sql
      .prepare(query)
      .bind(...params)
      .all()
      .map((row) => this.rowToEvent(row))
  }

  /**
   * Get all events in a time range
   */
  getAllEvents(from: number, to: number, options?: TimeTravelOptions): LineageEvent[] {
    let query = `SELECT * FROM lineage_events
                 WHERE timestamp >= ? AND timestamp <= ?
                 ORDER BY timestamp ASC`

    const params: unknown[] = [from, to]

    if (options?.limit) {
      query += ' LIMIT ?'
      params.push(options.limit)
    }

    return this.sql
      .prepare(query)
      .bind(...params)
      .all()
      .map((row) => this.rowToEvent(row))
  }

  // ===========================================================================
  // DIFF QUERIES
  // ===========================================================================

  /**
   * Calculate the difference between lineage at two points in time
   *
   * @param t1 - Earlier timestamp (epoch ms)
   * @param t2 - Later timestamp (epoch ms)
   * @returns Detailed diff showing what changed
   */
  diffLineage(t1: number, t2: number): LineageDiff {
    const nodesAtT1 = new Map(this.getNodesAt(t1).map((n) => [n.id, n]))
    const nodesAtT2 = new Map(this.getNodesAt(t2).map((n) => [n.id, n]))
    const edgesAtT1 = new Map(this.getEdgesAt(t1).map((e) => [e.id, e]))
    const edgesAtT2 = new Map(this.getEdgesAt(t2).map((e) => [e.id, e]))

    const nodesAdded: LineageNode[] = []
    const nodesRemoved: LineageNode[] = []
    const nodesModified: Array<{ before: LineageNode; after: LineageNode; changes: string[] }> = []
    const edgesAdded: LineageEdge[] = []
    const edgesRemoved: LineageEdge[] = []

    // Find added and modified nodes
    for (const [id, node] of nodesAtT2) {
      const oldNode = nodesAtT1.get(id)
      if (!oldNode) {
        nodesAdded.push(node)
      } else {
        // Check for modifications
        const changes = this.getNodeChanges(oldNode, node)
        if (changes.length > 0) {
          nodesModified.push({ before: oldNode, after: node, changes })
        }
      }
    }

    // Find removed nodes
    for (const [id, node] of nodesAtT1) {
      if (!nodesAtT2.has(id)) {
        nodesRemoved.push(node)
      }
    }

    // Find added edges
    for (const [id, edge] of edgesAtT2) {
      if (!edgesAtT1.has(id)) {
        edgesAdded.push(edge)
      }
    }

    // Find removed edges
    for (const [id, edge] of edgesAtT1) {
      if (!edgesAtT2.has(id)) {
        edgesRemoved.push(edge)
      }
    }

    return {
      fromTimestamp: t1,
      toTimestamp: t2,
      nodesAdded,
      nodesRemoved,
      nodesModified,
      edgesAdded,
      edgesRemoved,
      summary: {
        totalChanges:
          nodesAdded.length +
          nodesRemoved.length +
          nodesModified.length +
          edgesAdded.length +
          edgesRemoved.length,
        nodesAddedCount: nodesAdded.length,
        nodesRemovedCount: nodesRemoved.length,
        nodesModifiedCount: nodesModified.length,
        edgesAddedCount: edgesAdded.length,
        edgesRemovedCount: edgesRemoved.length,
      },
    }
  }

  /**
   * Diff lineage for a specific asset between two timestamps
   */
  diffAssetLineage(assetId: string, t1: number, t2: number): LineageDiff {
    const graphAtT1 = this.getLineageAt(assetId, t1)
    const graphAtT2 = this.getLineageAt(assetId, t2)

    const nodesAtT1 = new Map(graphAtT1.nodes.map((n) => [n.id, n]))
    const nodesAtT2 = new Map(graphAtT2.nodes.map((n) => [n.id, n]))
    const edgesAtT1 = new Map(graphAtT1.edges.map((e) => [e.id, e]))
    const edgesAtT2 = new Map(graphAtT2.edges.map((e) => [e.id, e]))

    const nodesAdded: LineageNode[] = []
    const nodesRemoved: LineageNode[] = []
    const nodesModified: Array<{ before: LineageNode; after: LineageNode; changes: string[] }> = []
    const edgesAdded: LineageEdge[] = []
    const edgesRemoved: LineageEdge[] = []

    // Find added and modified nodes
    for (const [id, node] of nodesAtT2) {
      const oldNode = nodesAtT1.get(id)
      if (!oldNode) {
        nodesAdded.push(node)
      } else {
        const changes = this.getNodeChanges(oldNode, node)
        if (changes.length > 0) {
          nodesModified.push({ before: oldNode, after: node, changes })
        }
      }
    }

    // Find removed nodes
    for (const [id, node] of nodesAtT1) {
      if (!nodesAtT2.has(id)) {
        nodesRemoved.push(node)
      }
    }

    // Find added edges
    for (const [id, edge] of edgesAtT2) {
      if (!edgesAtT1.has(id)) {
        edgesAdded.push(edge)
      }
    }

    // Find removed edges
    for (const [id, edge] of edgesAtT1) {
      if (!edgesAtT2.has(id)) {
        edgesRemoved.push(edge)
      }
    }

    return {
      fromTimestamp: t1,
      toTimestamp: t2,
      nodesAdded,
      nodesRemoved,
      nodesModified,
      edgesAdded,
      edgesRemoved,
      summary: {
        totalChanges:
          nodesAdded.length +
          nodesRemoved.length +
          nodesModified.length +
          edgesAdded.length +
          edgesRemoved.length,
        nodesAddedCount: nodesAdded.length,
        nodesRemovedCount: nodesRemoved.length,
        nodesModifiedCount: nodesModified.length,
        edgesAddedCount: edgesAdded.length,
        edgesRemovedCount: edgesRemoved.length,
      },
    }
  }

  /**
   * Find when a dependency was first established
   */
  findDependencyStartTime(fromId: string, toId: string): number | null {
    const result = this.sql
      .prepare(
        `SELECT MIN(timestamp) as first_seen FROM lineage_events
         WHERE entity_type = 'edge' AND type = 'edge_created'
         AND snapshot LIKE ? AND snapshot LIKE ?`
      )
      .bind(`%"fromNodeId":"${fromId}"%`, `%"toNodeId":"${toId}"%`)
      .first()

    return result?.first_seen as number | null
  }

  // ===========================================================================
  // UTILITY METHODS
  // ===========================================================================

  /**
   * Get changes between two node states
   */
  private getNodeChanges(before: LineageNode, after: LineageNode): string[] {
    const changes: string[] = []

    if (before.name !== after.name) changes.push('name')
    if (before.type !== after.type) changes.push('type')
    if (before.namespace !== after.namespace) changes.push('namespace')
    if (JSON.stringify(before.metadata) !== JSON.stringify(after.metadata)) changes.push('metadata')

    return changes
  }

  /**
   * Convert node to snapshot format
   */
  private nodeToSnapshot(node: LineageNode): Record<string, unknown> {
    return {
      id: node.id,
      type: node.type,
      name: node.name,
      namespace: node.namespace,
      metadata: node.metadata,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    }
  }

  /**
   * Convert snapshot to node
   */
  private snapshotToNode(snapshot: Record<string, unknown>): LineageNode {
    return {
      id: snapshot.id as string,
      type: snapshot.type as NodeType,
      name: snapshot.name as string,
      namespace: snapshot.namespace as string | undefined,
      metadata: (snapshot.metadata ?? {}) as Record<string, unknown>,
      createdAt: snapshot.createdAt as number,
      updatedAt: snapshot.updatedAt as number,
    }
  }

  /**
   * Convert edge to snapshot format
   */
  private edgeToSnapshot(edge: LineageEdge): Record<string, unknown> {
    return {
      id: edge.id,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      operation: edge.operation,
      metadata: edge.metadata,
      timestamp: edge.timestamp,
    }
  }

  /**
   * Convert snapshot to edge
   */
  private snapshotToEdge(snapshot: Record<string, unknown>): LineageEdge {
    return {
      id: snapshot.id as string,
      fromNodeId: snapshot.fromNodeId as string,
      toNodeId: snapshot.toNodeId as string,
      operation: snapshot.operation as string,
      metadata: (snapshot.metadata ?? {}) as Record<string, unknown>,
      timestamp: snapshot.timestamp as number,
    }
  }

  /**
   * Convert database row to event
   */
  // biome-ignore lint/suspicious/noExplicitAny: SQL row can be any shape
  private rowToEvent(row: any): LineageEvent {
    return {
      id: row.id,
      type: row.type as LineageEventType,
      entityId: row.entity_id,
      entityType: row.entity_type as 'node' | 'edge',
      timestamp: row.timestamp,
      snapshot: row.snapshot ? JSON.parse(row.snapshot) : null,
      previousState: row.previous_state ? JSON.parse(row.previous_state) : null,
      actor: row.actor ?? undefined,
      reason: row.reason ?? undefined,
    }
  }

  /**
   * Get event count (for statistics)
   */
  getEventCount(): number {
    const result = this.sql.prepare('SELECT COUNT(*) as count FROM lineage_events').bind().first()
    return (result?.count as number) ?? 0
  }

  /**
   * Get the earliest event timestamp
   */
  getEarliestTimestamp(): number | null {
    const result = this.sql
      .prepare('SELECT MIN(timestamp) as ts FROM lineage_events')
      .bind()
      .first()
    return result?.ts as number | null
  }

  /**
   * Get the latest event timestamp
   */
  getLatestTimestamp(): number | null {
    const result = this.sql
      .prepare('SELECT MAX(timestamp) as ts FROM lineage_events')
      .bind()
      .first()
    return result?.ts as number | null
  }

  /**
   * Clear all events (use with caution)
   */
  clear(): void {
    this.sql.exec('DELETE FROM lineage_events')
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new TimeTravelStore instance
 *
 * @param sql - SQLite executor (e.g., ctx.storage.sql from Durable Object)
 * @param config - Optional configuration
 * @returns A new TimeTravelStore instance
 */
export function createTimeTravelStore(sql: SqlExecutor, config?: TimeTravelConfig): TimeTravelStore {
  const store = new TimeTravelStore(sql, config)
  store.initialize()
  return store
}
