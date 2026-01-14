/**
 * Graph Primitives - Unified Foundation for Graph Database Compat Layers
 *
 * This module provides the core building blocks for implementing graph database
 * compatibility layers (Neo4j, DGraph, ArangoDB, Neptune). Built on existing
 * unified primitives:
 *
 * - **TemporalStore**: Versioned node/edge storage with time-travel
 * - **TypedColumnStore**: Columnar adjacency lists with bloom filters
 * - **SchemaEvolution**: Node/edge type definitions and evolution
 * - **KeyedRouter**: Partition-aware graph sharding
 *
 * ## Features
 * - **Property Graph Model**: Nodes with labels, edges with types, properties
 * - **Cypher-like Queries**: Pattern matching, WHERE clauses, RETURN projections
 * - **Graph Traversals**: BFS, DFS, shortest path, all paths
 * - **Graph Analytics**: PageRank, connected components, centrality metrics
 * - **Streaming Interface**: Memory-efficient iteration for large graphs
 *
 * ## Usage
 * ```typescript
 * import { createPropertyGraph, createCypherEngine, createGraphAnalytics } from 'db/primitives/graph'
 *
 * // Create a property graph
 * const graph = createPropertyGraph({ namespace: 'social' })
 *
 * // Add nodes and edges
 * const alice = await graph.createNode('Person', { name: 'Alice' })
 * const bob = await graph.createNode('Person', { name: 'Bob' })
 * await graph.createEdge(alice.id, 'KNOWS', bob.id, { since: 2020 })
 *
 * // Run Cypher-like queries
 * const engine = createCypherEngine(graph)
 * const result = await engine.query(`
 *   MATCH (a:Person)-[:KNOWS]->(b:Person)
 *   WHERE a.name = 'Alice'
 *   RETURN b.name
 * `)
 *
 * // Run analytics
 * const analytics = createGraphAnalytics(graph)
 * const ranks = await analytics.pageRank()
 * ```
 *
 * @module db/primitives/graph
 */

// =============================================================================
// EXPORTS
// =============================================================================

// Property Graph - Core graph primitives
export {
  createPropertyGraph,
  type PropertyGraph,
  type PropertyGraphOptions,
  type GraphNode,
  type GraphEdge,
  type NodeInput,
  type EdgeInput,
  type NodeQuery,
  type EdgeQuery,
  type GraphSnapshot,
  type GraphStats,
} from './property-graph'

// Query Engine - Cypher-like queries
export {
  createCypherEngine,
  type CypherEngine,
  type CypherQuery,
  type CypherResult,
  type PatternClause,
  type WhereClause,
  type ReturnClause,
  type QueryPlan,
} from './cypher-engine'

// Traversal - BFS, DFS, path finding
export {
  createTraversalEngine,
  type TraversalEngine,
  type TraversalOptions,
  type TraversalResult,
  type PathResult,
  type PathOptions,
  type TraversalDirection,
  type VisitedSetMode,
} from './traversal-engine'

// Analytics - PageRank, centrality, components
export {
  createGraphAnalytics,
  type GraphAnalytics,
  type PageRankOptions,
  type CentralityOptions,
  type ComponentsResult,
  type CommunityOptions,
  type CommunityResult,
} from './analytics-engine'

// Streaming - Memory-efficient iteration
export {
  createStreamingTraversal,
  type StreamingTraversal,
  type StreamOptions,
  type BatchOptions,
} from './streaming'

// Types - Shared type definitions
export {
  type Direction,
  type NodeId,
  type EdgeId,
  type Label,
  type EdgeType,
  type Properties,
  type Timestamp,
} from './types'
