/**
 * LineageTracker - Data Provenance & Dependency Tracking Primitive
 *
 * A foundational primitive for tracking data lineage, dependencies, and provenance
 * across the dotdo platform. LineageTracker enables understanding of how data flows
 * through the system, what transformations were applied, and maintaining audit trails
 * for compliance and debugging.
 *
 * ## Key Capabilities
 * - Track data origins and transformations
 * - Build dependency graphs between entities
 * - Enable impact analysis (what breaks if X changes)
 * - Support audit/compliance requirements
 * - Power debugging by tracing data flow
 * - Enable cache invalidation through dependency tracking
 *
 * @example Basic Usage
 * ```typescript
 * import { createLineageTracker } from 'dotdo/db/primitives/lineage-tracker'
 *
 * // Create tracker with SQLite storage
 * const tracker = createLineageTracker(ctx.storage.sql)
 *
 * // Create nodes
 * const source = tracker.createNode({
 *   type: 'source',
 *   name: 'raw_events',
 *   namespace: 'warehouse',
 * })
 *
 * const transform = tracker.createNode({
 *   type: 'transformation',
 *   name: 'aggregate_events',
 *   metadata: { sql: 'SELECT event_type, COUNT(*) ...' },
 * })
 *
 * const sink = tracker.createNode({
 *   type: 'sink',
 *   name: 'event_summary',
 *   namespace: 'warehouse',
 * })
 *
 * // Create edges (data flows)
 * tracker.createEdge({
 *   fromNodeId: source.id,
 *   toNodeId: transform.id,
 *   operation: 'read',
 * })
 *
 * tracker.createEdge({
 *   fromNodeId: transform.id,
 *   toNodeId: sink.id,
 *   operation: 'write',
 * })
 *
 * // Query lineage
 * const upstream = tracker.getUpstream(sink.id)
 * const downstream = tracker.getDownstream(source.id)
 *
 * // Impact analysis
 * const impact = tracker.analyzeImpact(source.id)
 * console.log(`Changing ${source.name} affects ${impact.totalAffected} nodes`)
 * ```
 *
 * @module db/primitives/lineage-tracker
 */

// =============================================================================
// RE-EXPORTS
// =============================================================================

// Types
export type {
  NodeType,
  LineageNode,
  LineageEdge,
  CreateNodeInput,
  CreateEdgeInput,
  NodeQuery,
  EdgeQuery,
  LineageQuery,
  LineageGraph,
  LineagePath,
  TraversalOptions,
  ImpactType,
  AffectedNode,
  BlastRadiusMetrics,
  ImpactAnalysis,
  ImpactOptions,
  LineageTrackerConfig,
  LineageStats,
} from './types'

// Storage
export {
  LineageStore,
  createLineageStore,
  LINEAGE_SCHEMA,
  type SqlExecutor,
} from './storage'

// Queries
export {
  LineageTraversal,
  ImpactAnalyzer,
  createLineageTraversal,
  createImpactAnalyzer,
} from './queries'

// =============================================================================
// IMPORTS
// =============================================================================

import { LineageStore, createLineageStore, type SqlExecutor } from './storage'
import { LineageTraversal, ImpactAnalyzer } from './queries'
import type {
  LineageNode,
  LineageEdge,
  CreateNodeInput,
  CreateEdgeInput,
  NodeQuery,
  EdgeQuery,
  LineageGraph,
  TraversalOptions,
  ImpactAnalysis,
  ImpactOptions,
  LineageTrackerConfig,
  LineageStats,
  LineagePath,
} from './types'

// =============================================================================
// LINEAGE TRACKER CLASS
// =============================================================================

/**
 * LineageTracker - Unified API for data lineage tracking
 *
 * Provides a high-level interface combining storage, traversal, and impact
 * analysis capabilities.
 */
export class LineageTracker {
  private store: LineageStore
  private traversal: LineageTraversal
  private analyzer: ImpactAnalyzer

  constructor(sql: SqlExecutor, config?: LineageTrackerConfig) {
    this.store = createLineageStore(sql, config)
    this.traversal = new LineageTraversal(this.store)
    this.analyzer = new ImpactAnalyzer(this.store)
  }

  // ===========================================================================
  // NODE OPERATIONS
  // ===========================================================================

  /**
   * Create a new node in the lineage graph
   */
  createNode(input: CreateNodeInput): LineageNode {
    return this.store.createNode(input)
  }

  /**
   * Get a node by ID
   */
  getNode(id: string): LineageNode | null {
    return this.store.getNode(id)
  }

  /**
   * Update an existing node
   */
  updateNode(id: string, updates: Partial<Omit<LineageNode, 'id' | 'createdAt'>>): LineageNode | null {
    return this.store.updateNode(id, updates)
  }

  /**
   * Delete a node and all its edges
   */
  deleteNode(id: string): boolean {
    return this.store.deleteNode(id)
  }

  /**
   * Find nodes matching query criteria
   */
  findNodes(query?: NodeQuery): LineageNode[] {
    return this.store.findNodes(query)
  }

  /**
   * Bulk create nodes
   */
  createNodes(inputs: CreateNodeInput[]): LineageNode[] {
    return this.store.createNodes(inputs)
  }

  // ===========================================================================
  // EDGE OPERATIONS
  // ===========================================================================

  /**
   * Create a new edge in the lineage graph
   */
  createEdge(input: CreateEdgeInput): LineageEdge {
    return this.store.createEdge(input)
  }

  /**
   * Get an edge by ID
   */
  getEdge(id: string): LineageEdge | null {
    return this.store.getEdge(id)
  }

  /**
   * Delete an edge
   */
  deleteEdge(id: string): boolean {
    return this.store.deleteEdge(id)
  }

  /**
   * Find edges matching query criteria
   */
  findEdges(query?: EdgeQuery): LineageEdge[] {
    return this.store.findEdges(query)
  }

  /**
   * Bulk create edges
   */
  createEdges(inputs: CreateEdgeInput[]): LineageEdge[] {
    return this.store.createEdges(inputs)
  }

  // ===========================================================================
  // LINEAGE QUERIES
  // ===========================================================================

  /**
   * Get all nodes upstream of the given node (what this node depends on)
   *
   * Traverses the graph backwards from the given node to find all sources.
   */
  getUpstream(nodeId: string, options?: TraversalOptions): LineageGraph {
    return this.traversal.getUpstream(nodeId, options)
  }

  /**
   * Get all nodes downstream of the given node (what depends on this node)
   *
   * Traverses the graph forward from the given node to find all dependents.
   */
  getDownstream(nodeId: string, options?: TraversalOptions): LineageGraph {
    return this.traversal.getDownstream(nodeId, options)
  }

  /**
   * Get the full lineage graph in both directions
   */
  getFullLineage(nodeId: string, options?: TraversalOptions): LineageGraph {
    return this.traversal.getFullLineage(nodeId, options)
  }

  /**
   * Find all paths between two nodes
   */
  findPaths(fromId: string, toId: string, maxDepth?: number): LineagePath[] {
    return this.traversal.findPaths(fromId, toId, maxDepth)
  }

  /**
   * Get immediate parents of a node (one hop upstream)
   */
  getParents(nodeId: string): LineageNode[] {
    return this.traversal.getParents(nodeId)
  }

  /**
   * Get immediate children of a node (one hop downstream)
   */
  getChildren(nodeId: string): LineageNode[] {
    return this.traversal.getChildren(nodeId)
  }

  // ===========================================================================
  // IMPACT ANALYSIS
  // ===========================================================================

  /**
   * Analyze the impact of changing a node
   *
   * Returns all downstream nodes that would be affected, with details about
   * distance, path count, and impact classification.
   */
  analyzeImpact(nodeId: string, options?: ImpactOptions): ImpactAnalysis {
    return this.analyzer.analyze(nodeId, options)
  }

  /**
   * Get affected nodes grouped by type
   */
  getAffectedByType(nodeId: string, options?: ImpactOptions): Map<string, LineageNode[]> {
    return this.analyzer.getAffectedByType(nodeId, options)
  }

  /**
   * Get blast radius metrics (lightweight version of analyzeImpact)
   */
  getBlastRadius(nodeId: string, options?: ImpactOptions) {
    return this.analyzer.getBlastRadius(nodeId, options)
  }

  // ===========================================================================
  // GRAPH OPERATIONS
  // ===========================================================================

  /**
   * Get all root nodes (nodes with no upstream dependencies)
   */
  getRootNodes(): LineageNode[] {
    return this.store.getRootNodes()
  }

  /**
   * Get all leaf nodes (nodes with no downstream dependents)
   */
  getLeafNodes(): LineageNode[] {
    return this.store.getLeafNodes()
  }

  /**
   * Get statistics about the lineage graph
   */
  getStats(): LineageStats {
    return this.store.getStats()
  }

  /**
   * Clear all lineage data
   */
  clear(): void {
    this.store.clear()
  }

  // ===========================================================================
  // CONVENIENCE METHODS
  // ===========================================================================

  /**
   * Record a data transformation (creates nodes and edge)
   *
   * Convenience method for recording a complete data flow in one call.
   */
  record(input: {
    source: CreateNodeInput | string
    target: CreateNodeInput | string
    operation: string
    metadata?: Record<string, unknown>
  }): { source: LineageNode; target: LineageNode; edge: LineageEdge } {
    // Get or create source node
    const source =
      typeof input.source === 'string'
        ? this.getNode(input.source)
        : this.createNode(input.source)

    if (!source) {
      throw new Error(`Source node not found: ${input.source}`)
    }

    // Get or create target node
    const target =
      typeof input.target === 'string'
        ? this.getNode(input.target)
        : this.createNode(input.target)

    if (!target) {
      throw new Error(`Target node not found: ${input.target}`)
    }

    // Create edge
    const edge = this.createEdge({
      fromNodeId: source.id,
      toNodeId: target.id,
      operation: input.operation,
      metadata: input.metadata,
    })

    return { source, target, edge }
  }

  /**
   * Get the underlying store for advanced operations
   */
  getStore(): LineageStore {
    return this.store
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new LineageTracker instance
 *
 * @param sql - SQLite executor (e.g., ctx.storage.sql from Durable Object)
 * @param config - Optional configuration
 * @returns A new LineageTracker instance
 *
 * @example
 * ```typescript
 * // In a Durable Object
 * const tracker = createLineageTracker(ctx.storage.sql)
 *
 * // With custom configuration
 * const tracker = createLineageTracker(ctx.storage.sql, {
 *   idPrefix: 'myapp',
 *   detectCycles: true,
 *   maxTraversalDepth: 50,
 * })
 * ```
 */
export function createLineageTracker(sql: SqlExecutor, config?: LineageTrackerConfig): LineageTracker {
  return new LineageTracker(sql, config)
}
