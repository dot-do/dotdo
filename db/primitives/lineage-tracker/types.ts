/**
 * LineageTracker Types - Data Provenance & Dependency Tracking
 *
 * Core type definitions for tracking data lineage, dependencies, and provenance
 * across the dotdo platform.
 *
 * @module db/primitives/lineage-tracker/types
 */

// =============================================================================
// NODE TYPES
// =============================================================================

/**
 * Type of node in the lineage graph
 */
export type NodeType = 'entity' | 'transformation' | 'source' | 'sink'

/**
 * A node in the lineage graph representing a data entity or transformation
 */
export interface LineageNode {
  /** Unique identifier for the node */
  id: string
  /** Type of node */
  type: NodeType
  /** Human-readable name */
  name: string
  /** Optional namespace for grouping (e.g., schema, service) */
  namespace?: string
  /** Custom metadata for the node */
  metadata: Record<string, unknown>
  /** Timestamp when the node was created (epoch ms) */
  createdAt: number
  /** Timestamp when the node was last updated (epoch ms) */
  updatedAt: number
}

/**
 * Input for creating a new node (id is auto-generated if not provided)
 */
export interface CreateNodeInput {
  /** Optional explicit ID (auto-generated if not provided) */
  id?: string
  /** Type of node */
  type: NodeType
  /** Human-readable name */
  name: string
  /** Optional namespace for grouping */
  namespace?: string
  /** Custom metadata */
  metadata?: Record<string, unknown>
}

/**
 * Options for querying nodes
 */
export interface NodeQuery {
  /** Filter by type */
  type?: NodeType
  /** Filter by namespace */
  namespace?: string
  /** Search by name (partial match) */
  nameContains?: string
  /** Maximum number of results */
  limit?: number
  /** Offset for pagination */
  offset?: number
}

// =============================================================================
// EDGE TYPES
// =============================================================================

/**
 * An edge in the lineage graph representing a data flow or dependency
 */
export interface LineageEdge {
  /** Unique identifier for the edge */
  id: string
  /** Source node ID (data flows FROM this node) */
  fromNodeId: string
  /** Target node ID (data flows TO this node) */
  toNodeId: string
  /** Operation or transformation name */
  operation: string
  /** Custom metadata for the edge */
  metadata: Record<string, unknown>
  /** Timestamp when the edge was recorded (epoch ms) */
  timestamp: number
}

/**
 * Input for creating a new edge
 */
export interface CreateEdgeInput {
  /** Optional explicit ID (auto-generated if not provided) */
  id?: string
  /** Source node ID */
  fromNodeId: string
  /** Target node ID */
  toNodeId: string
  /** Operation name describing the transformation */
  operation: string
  /** Custom metadata */
  metadata?: Record<string, unknown>
}

/**
 * Options for querying edges
 */
export interface EdgeQuery {
  /** Filter by source node */
  fromNodeId?: string
  /** Filter by target node */
  toNodeId?: string
  /** Filter by operation */
  operation?: string
  /** Maximum number of results */
  limit?: number
  /** Offset for pagination */
  offset?: number
}

// =============================================================================
// GRAPH TYPES
// =============================================================================

/**
 * Query parameters for lineage traversal
 */
export interface LineageQuery {
  /** Starting node ID */
  nodeId: string
  /** Direction to traverse */
  direction: 'upstream' | 'downstream' | 'both'
  /** Maximum depth to traverse (default: unlimited) */
  maxDepth?: number
  /** Filter to specific node types */
  nodeTypes?: NodeType[]
  /** Whether to include edge metadata in results */
  includeMetadata?: boolean
}

/**
 * A complete lineage graph with nodes and edges
 */
export interface LineageGraph {
  /** All nodes in the graph */
  nodes: LineageNode[]
  /** All edges in the graph */
  edges: LineageEdge[]
  /** The root node ID for this query */
  rootId: string
}

/**
 * A path through the lineage graph
 */
export interface LineagePath {
  /** Ordered list of node IDs in the path */
  nodeIds: string[]
  /** Ordered list of edge IDs connecting the nodes */
  edgeIds: string[]
}

// =============================================================================
// TRAVERSAL OPTIONS
// =============================================================================

/**
 * Options for graph traversal operations
 */
export interface TraversalOptions {
  /** Maximum depth to traverse (default: no limit) */
  maxDepth?: number
  /** Filter to specific node types */
  nodeTypes?: NodeType[]
  /** Whether to include full metadata (default: true) */
  includeMetadata?: boolean
}

// =============================================================================
// IMPACT ANALYSIS
// =============================================================================

/**
 * Impact type classification
 */
export type ImpactType = 'direct' | 'indirect'

/**
 * A node affected by a change with impact details
 */
export interface AffectedNode {
  /** The affected node */
  node: LineageNode
  /** Distance (hops) from the source node */
  distance: number
  /** Number of distinct paths to this node */
  pathCount: number
  /** Whether the impact is direct or indirect */
  impact: ImpactType
}

/**
 * Metrics about the blast radius of a change
 */
export interface BlastRadiusMetrics {
  /** Total number of affected nodes */
  totalAffected: number
  /** Nodes affected at each depth level */
  byDepth: Map<number, number>
  /** Nodes affected by type */
  byType: Map<NodeType, number>
  /** Maximum depth of impact */
  maxDepth: number
  /** Critical paths (paths to high-impact nodes) */
  criticalPathCount: number
}

/**
 * Complete impact analysis result
 */
export interface ImpactAnalysis {
  /** The source node being analyzed */
  sourceNode: LineageNode
  /** All affected downstream nodes with details */
  affectedNodes: AffectedNode[]
  /** Total count of affected nodes */
  totalAffected: number
  /** Critical paths (longest/most important paths) */
  criticalPaths: LineagePath[]
  /** Blast radius metrics */
  metrics: BlastRadiusMetrics
}

/**
 * Options for impact analysis
 */
export interface ImpactOptions {
  /** Maximum depth to analyze */
  maxDepth?: number
  /** Filter to specific node types */
  nodeTypes?: NodeType[]
  /** Include indirect impacts (via multiple hops) */
  includeIndirect?: boolean
  /** Minimum importance threshold for critical paths */
  criticalPathThreshold?: number
}

// =============================================================================
// STORAGE CONFIGURATION
// =============================================================================

/**
 * Configuration options for LineageTracker storage
 */
export interface LineageTrackerConfig {
  /** Enable automatic ID generation (default: true) */
  autoGenerateIds?: boolean
  /** Prefix for auto-generated IDs */
  idPrefix?: string
  /** Maximum graph depth for traversal (default: 100) */
  maxTraversalDepth?: number
  /** Enable cycle detection during edge creation (default: true) */
  detectCycles?: boolean
}

/**
 * Statistics about the lineage graph
 */
export interface LineageStats {
  /** Total number of nodes */
  nodeCount: number
  /** Nodes by type */
  nodesByType: Record<NodeType, number>
  /** Total number of edges */
  edgeCount: number
  /** Number of root nodes (no incoming edges) */
  rootCount: number
  /** Number of leaf nodes (no outgoing edges) */
  leafCount: number
  /** Average node connectivity */
  avgConnectivity: number
}
