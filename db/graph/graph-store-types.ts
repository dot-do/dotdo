/**
 * GraphStore Types
 *
 * TypeScript types for the GraphStore class - relationship/edge storage
 * with traversal queries based on the README specification.
 *
 * @module db/graph/graph-store-types
 */

// ============================================================================
// RELATIONSHIP TYPES
// ============================================================================

/**
 * Input for creating a relationship (edge).
 */
export interface RelateInput {
  /** Source node ID (e.g., 'User/alice') */
  from: string
  /** Target node ID (e.g., 'Team/engineering') */
  to: string
  /** Relationship type/verb (e.g., 'memberOf') */
  type: string
  /** Optional JSON data payload */
  data?: Record<string, unknown> | null
}

/**
 * A stored relationship (edge) in the graph.
 */
export interface Relationship {
  /** Unique relationship ID */
  $id: string
  /** Source node ID */
  from: string
  /** Source node type (extracted from from ID) */
  from_type: string
  /** Target node ID */
  to: string
  /** Target node type (extracted from to ID) */
  to_type: string
  /** Relationship type/verb */
  type: string
  /** Optional JSON data payload */
  data: Record<string, unknown> | null
  /** Creation timestamp */
  $createdAt: number
  /** Update timestamp */
  $updatedAt: number
}

/**
 * Options for filtering edge queries.
 */
export interface EdgeQueryOptions {
  /** Filter by relationship type */
  type?: string
}

// ============================================================================
// TRAVERSAL TYPES
// ============================================================================

/**
 * Options for graph traversal.
 */
export interface TraverseOptions {
  /** Starting node ID */
  start: string
  /** Direction of traversal */
  direction: 'outgoing' | 'incoming'
  /** Relationship types to follow */
  types: string[]
  /** Maximum depth to traverse */
  maxDepth: number
  /** Algorithm to use (default: 'bfs') */
  algorithm?: 'bfs' | 'dfs'
}

/**
 * A node in traversal results.
 */
export interface TraversalNode {
  /** Node ID */
  id: string
  /** Depth at which this node was discovered */
  depth: number
}

/**
 * Result of a traversal operation.
 */
export interface TraverseResult {
  /** Nodes discovered during traversal */
  nodes: TraversalNode[]
}

// ============================================================================
// PATH FINDING TYPES
// ============================================================================

/**
 * Options for finding a path between two nodes.
 */
export interface FindPathOptions {
  /** Starting node ID */
  from: string
  /** Target node ID */
  to: string
  /** Relationship types to follow */
  types: string[]
}

/**
 * Options for finding the shortest path.
 */
export interface ShortestPathOptions {
  /** Starting node ID */
  from: string
  /** Target node ID */
  to: string
  /** Relationship types to follow */
  types: string[]
  /** Maximum depth to search */
  maxDepth?: number
}

// ============================================================================
// CDC EVENT TYPES
// ============================================================================

/**
 * CDC event for relationship changes.
 */
export interface CDCEvent {
  /** Event type */
  type: 'cdc.insert' | 'cdc.update' | 'cdc.delete'
  /** Operation code */
  op: 'c' | 'u' | 'd'
  /** Store name */
  store: 'graph'
  /** Table name */
  table: 'relationships'
  /** Primary key of the affected row */
  key: string
  /** State before change (for updates/deletes) */
  before?: {
    from?: string
    to?: string
    type?: string
    data?: Record<string, unknown> | null
  }
  /** State after change (for inserts/updates) */
  after?: {
    from?: string
    to?: string
    type?: string
    data?: Record<string, unknown> | null
  }
}

/**
 * CDC event handler callback.
 */
export type CDCHandler = (event: CDCEvent) => void

// ============================================================================
// SCHEMA TYPES
// ============================================================================

/**
 * Schema information for introspection.
 */
export interface SchemaInfo {
  /** Table names */
  tables: string[]
  /** Columns by table */
  columns: Record<string, string[]>
}

/**
 * Constraint information.
 */
export interface ConstraintInfo {
  /** Table name */
  table: string
  /** Constraint type */
  type: 'unique' | 'primary' | 'foreign'
  /** Columns involved */
  columns: string[]
}

/**
 * Index information.
 */
export interface IndexInfo {
  /** Table name */
  table: string
  /** Index name */
  name: string
  /** Columns covered */
  columns: string[]
}
