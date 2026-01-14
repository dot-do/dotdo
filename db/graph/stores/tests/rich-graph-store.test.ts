/**
 * RichGraphStore Interface Tests - Advanced Graph Operations
 *
 * RED PHASE: These tests define the contract for a RichGraphStore interface that
 * extends GraphStore with advanced traversal and analysis capabilities.
 *
 * @see dotdo-e82o4 - [RED] RichGraphStore Interface Tests
 *
 * Problem Statement:
 * - SQLiteGraphStore and DocumentGraphStore share traversal code
 * - Traversal logic is duplicated across implementations
 * - No interface for advanced graph operations
 *
 * RichGraphStore extends GraphStore with:
 * - Traversal depth limiting
 * - Path finding between Things
 * - Subgraph extraction
 * - Aggregations over relationships
 * - Transaction support
 *
 * Design:
 * - Uses factory pattern to test multiple backends
 * - NO MOCKS - uses real storage backends (per CLAUDE.md)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { GraphStore, GraphThing, GraphRelationship } from '../../types'

// ============================================================================
// TYPES - RichGraphStore Interface
// ============================================================================

/**
 * Traversal options for graph walks
 */
export interface TraversalOptions {
  /** Maximum depth to traverse from start node */
  maxDepth?: number
  /** Relationship verbs to follow (filter) */
  verbs?: string | string[]
  /** Direction of traversal */
  direction?: 'outgoing' | 'incoming' | 'both'
  /** Optional filter function for nodes */
  nodeFilter?: (thing: GraphThing) => boolean
  /** Optional filter function for edges */
  edgeFilter?: (relationship: GraphRelationship) => boolean
  /** Maximum number of nodes to visit */
  limit?: number
  /** Whether to include the start node in results */
  includeStart?: boolean
}

/**
 * Result of a graph traversal operation
 */
export interface TraversalResult {
  /** All nodes visited during traversal */
  nodes: GraphThing[]
  /** All edges traversed */
  edges: GraphRelationship[]
  /** Depth at which each node was found */
  depths: Map<string, number>
  /** Visit order of nodes (BFS by default) */
  visitOrder: string[]
}

/**
 * Path finding options
 */
export interface PathFindingOptions {
  /** Maximum path length to search */
  maxDepth?: number
  /** Relationship verbs to follow */
  verbs?: string | string[]
  /** Maximum number of paths to return */
  maxPaths?: number
  /** Whether to find shortest path only */
  shortestOnly?: boolean
  /** Direction of traversal */
  direction?: 'outgoing' | 'incoming' | 'both'
}

/**
 * A path through the graph
 */
export interface GraphPath {
  /** Sequence of node IDs in the path */
  nodeIds: string[]
  /** Sequence of relationship IDs in the path */
  relationshipIds: string[]
  /** Full node objects */
  nodes: GraphThing[]
  /** Full relationship objects */
  relationships: GraphRelationship[]
  /** Total path length */
  length: number
}

/**
 * Subgraph extraction options
 */
export interface SubgraphOptions {
  /** Starting node IDs */
  startIds: string[]
  /** Maximum depth from start nodes */
  maxDepth?: number
  /** Relationship verbs to include */
  verbs?: string | string[]
  /** Include nodes reachable via incoming edges */
  includeIncoming?: boolean
  /** Include nodes reachable via outgoing edges */
  includeOutgoing?: boolean
  /** Node type names to include (filter) */
  typeNames?: string[]
}

/**
 * Result of subgraph extraction
 */
export interface Subgraph {
  /** All nodes in the subgraph */
  nodes: GraphThing[]
  /** All relationships in the subgraph */
  relationships: GraphRelationship[]
  /** Map of node ID to its relationships */
  adjacencyList: Map<string, string[]>
}

/**
 * Aggregation options for relationships
 */
export interface AggregationOptions {
  /** Group by this field */
  groupBy: 'verb' | 'from' | 'to' | 'fromType' | 'toType'
  /** Aggregation function */
  aggregation: 'count' | 'sum' | 'avg' | 'min' | 'max'
  /** Field to aggregate (for sum/avg/min/max) */
  field?: string
  /** Filter relationships before aggregation */
  filter?: {
    verb?: string | string[]
    fromType?: string
    toType?: string
  }
}

/**
 * Result of an aggregation operation
 */
export interface AggregationResult {
  /** Group key -> aggregated value */
  groups: Map<string, number>
  /** Total count of relationships processed */
  totalCount: number
}

/**
 * Transaction session for atomic operations
 */
export interface TransactionSession {
  /** Create a Thing within the transaction */
  createThing(input: Parameters<GraphStore['createThing']>[0]): Promise<GraphThing>
  /** Create a Relationship within the transaction */
  createRelationship(input: Parameters<GraphStore['createRelationship']>[0]): Promise<GraphRelationship>
  /** Update a Thing within the transaction */
  updateThing(id: string, updates: Parameters<GraphStore['updateThing']>[1]): Promise<GraphThing | null>
  /** Delete a Thing within the transaction */
  deleteThing(id: string): Promise<GraphThing | null>
  /** Delete a Relationship within the transaction */
  deleteRelationship(id: string): Promise<boolean>
}

/**
 * RichGraphStore extends GraphStore with advanced graph operations
 */
export interface RichGraphStore extends GraphStore {
  // =========================================================================
  // TRAVERSAL OPERATIONS
  // =========================================================================

  /**
   * Traverse the graph from a starting node with depth limiting.
   *
   * @param startId - ID of the starting node
   * @param options - Traversal options (depth, direction, filters)
   * @returns Traversal result with visited nodes, edges, and depths
   */
  traverse(startId: string, options?: TraversalOptions): Promise<TraversalResult>

  /**
   * Traverse the graph from multiple starting nodes.
   *
   * @param startIds - IDs of starting nodes
   * @param options - Traversal options
   * @returns Combined traversal result
   */
  traverseMultiple(startIds: string[], options?: TraversalOptions): Promise<TraversalResult>

  // =========================================================================
  // PATH FINDING
  // =========================================================================

  /**
   * Find all paths between two nodes.
   *
   * @param fromId - Starting node ID
   * @param toId - Target node ID
   * @param options - Path finding options
   * @returns Array of paths (may be empty if no path exists)
   */
  findPaths(fromId: string, toId: string, options?: PathFindingOptions): Promise<GraphPath[]>

  /**
   * Find the shortest path between two nodes.
   *
   * @param fromId - Starting node ID
   * @param toId - Target node ID
   * @param options - Path finding options (excluding shortestOnly)
   * @returns Shortest path or null if no path exists
   */
  shortestPath(fromId: string, toId: string, options?: Omit<PathFindingOptions, 'shortestOnly'>): Promise<GraphPath | null>

  /**
   * Check if a path exists between two nodes.
   *
   * @param fromId - Starting node ID
   * @param toId - Target node ID
   * @param options - Path finding options
   * @returns true if path exists, false otherwise
   */
  pathExists(fromId: string, toId: string, options?: PathFindingOptions): Promise<boolean>

  // =========================================================================
  // SUBGRAPH EXTRACTION
  // =========================================================================

  /**
   * Extract a subgraph around specified nodes.
   *
   * @param options - Subgraph extraction options
   * @returns The extracted subgraph
   */
  extractSubgraph(options: SubgraphOptions): Promise<Subgraph>

  /**
   * Get the connected component containing a node.
   *
   * @param nodeId - Node to find component for
   * @returns All nodes in the same connected component
   */
  getConnectedComponent(nodeId: string): Promise<GraphThing[]>

  /**
   * Get all connected components in the graph.
   *
   * @returns Array of connected components (arrays of node IDs)
   */
  getAllConnectedComponents(): Promise<string[][]>

  // =========================================================================
  // AGGREGATIONS
  // =========================================================================

  /**
   * Aggregate relationships by a grouping field.
   *
   * @param options - Aggregation options
   * @returns Aggregation result with groups and totals
   */
  aggregateRelationships(options: AggregationOptions): Promise<AggregationResult>

  /**
   * Count relationships by verb.
   *
   * @returns Map of verb to count
   */
  countRelationshipsByVerb(): Promise<Map<string, number>>

  /**
   * Get degree of a node (count of relationships).
   *
   * @param nodeId - Node ID
   * @param direction - 'outgoing', 'incoming', or 'both' (default)
   * @param verb - Optional verb filter
   * @returns Degree count
   */
  getDegree(nodeId: string, direction?: 'outgoing' | 'incoming' | 'both', verb?: string): Promise<number>

  /**
   * Get nodes with highest degree.
   *
   * @param limit - Maximum number of nodes to return
   * @param direction - Direction for degree calculation
   * @returns Array of [nodeId, degree] sorted by degree descending
   */
  getTopNodesByDegree(limit: number, direction?: 'outgoing' | 'incoming' | 'both'): Promise<Array<[string, number]>>

  // =========================================================================
  // TRANSACTIONS
  // =========================================================================

  /**
   * Execute operations within a transaction.
   * All operations succeed or all are rolled back.
   *
   * @param callback - Function receiving transaction session
   */
  transaction<T>(callback: (session: TransactionSession) => Promise<T>): Promise<T>
}

// ============================================================================
// TEST FACTORY
// ============================================================================

/**
 * Create a suite of tests for a RichGraphStore implementation.
 */
export function createRichGraphStoreTests(
  name: string,
  factory: () => Promise<RichGraphStore>,
  cleanup?: (store: RichGraphStore) => Promise<void>
): void {
  describe(`RichGraphStore: ${name}`, () => {
    let store: RichGraphStore

    beforeEach(async () => {
      store = await factory()
    })

    afterEach(async () => {
      if (cleanup) {
        await cleanup(store)
      }
    })

    // ========================================================================
    // 1. TRAVERSAL OPERATIONS TESTS
    // ========================================================================

    describe('Traversal Operations', () => {
      describe('traverse', () => {
        beforeEach(async () => {
          // Create a test graph:
          // A -> B -> C -> D
          //      |
          //      v
          //      E -> F
          await store.createThing({ id: 'A', typeId: 1, typeName: 'Node', data: { name: 'A' } })
          await store.createThing({ id: 'B', typeId: 1, typeName: 'Node', data: { name: 'B' } })
          await store.createThing({ id: 'C', typeId: 1, typeName: 'Node', data: { name: 'C' } })
          await store.createThing({ id: 'D', typeId: 1, typeName: 'Node', data: { name: 'D' } })
          await store.createThing({ id: 'E', typeId: 1, typeName: 'Node', data: { name: 'E' } })
          await store.createThing({ id: 'F', typeId: 1, typeName: 'Node', data: { name: 'F' } })

          await store.createRelationship({ id: 'r1', verb: 'connects', from: 'url://A', to: 'url://B' })
          await store.createRelationship({ id: 'r2', verb: 'connects', from: 'url://B', to: 'url://C' })
          await store.createRelationship({ id: 'r3', verb: 'connects', from: 'url://C', to: 'url://D' })
          await store.createRelationship({ id: 'r4', verb: 'links', from: 'url://B', to: 'url://E' })
          await store.createRelationship({ id: 'r5', verb: 'connects', from: 'url://E', to: 'url://F' })
        })

        it('traverses all nodes from start with no depth limit', async () => {
          const result = await store.traverse('A')

          expect(result.nodes.length).toBe(5) // B, C, D, E, F (not A by default)
          expect(result.visitOrder).toContain('B')
        })

        it('respects maxDepth option', async () => {
          const result = await store.traverse('A', { maxDepth: 1 })

          expect(result.nodes.length).toBe(1) // Only B at depth 1
          expect(result.nodes[0]?.id).toBe('B')
          expect(result.depths.get('B')).toBe(1)
        })

        it('respects maxDepth=2', async () => {
          const result = await store.traverse('A', { maxDepth: 2 })

          expect(result.nodes.length).toBe(3) // B at 1, C and E at 2
          expect(result.depths.get('C')).toBe(2)
          expect(result.depths.get('E')).toBe(2)
        })

        it('filters by verb', async () => {
          const result = await store.traverse('A', { verbs: 'connects' })

          // Should only follow 'connects' edges: A -> B -> C -> D
          const ids = result.nodes.map(n => n.id)
          expect(ids).toContain('B')
          expect(ids).toContain('C')
          expect(ids).toContain('D')
          expect(ids).not.toContain('E') // E is via 'links' verb
        })

        it('filters by multiple verbs', async () => {
          const result = await store.traverse('A', { verbs: ['connects', 'links'] })

          expect(result.nodes.length).toBe(5) // All reachable
        })

        it('supports incoming direction', async () => {
          const result = await store.traverse('D', { direction: 'incoming' })

          // Traverse backwards: D <- C <- B <- A
          const ids = result.nodes.map(n => n.id)
          expect(ids).toContain('C')
          expect(ids).toContain('B')
          expect(ids).toContain('A')
        })

        it('supports both directions', async () => {
          const result = await store.traverse('B', { direction: 'both', maxDepth: 1 })

          // B connects to: A (incoming), C (outgoing), E (outgoing)
          const ids = result.nodes.map(n => n.id)
          expect(ids).toContain('A')
          expect(ids).toContain('C')
          expect(ids).toContain('E')
        })

        it('includes start node when requested', async () => {
          const result = await store.traverse('A', { includeStart: true })

          const ids = result.nodes.map(n => n.id)
          expect(ids).toContain('A')
        })

        it('applies node filter', async () => {
          const result = await store.traverse('A', {
            nodeFilter: (thing) => thing.id !== 'C'
          })

          // Should stop at C, so D not reachable via that path
          const ids = result.nodes.map(n => n.id)
          expect(ids).not.toContain('C')
        })

        it('respects limit option', async () => {
          const result = await store.traverse('A', { limit: 2 })

          expect(result.nodes.length).toBe(2)
        })

        it('returns empty result for non-existent node', async () => {
          const result = await store.traverse('NONEXISTENT')

          expect(result.nodes).toHaveLength(0)
        })

        it('tracks depths correctly', async () => {
          const result = await store.traverse('A')

          expect(result.depths.get('B')).toBe(1)
          expect(result.depths.get('C')).toBe(2)
          expect(result.depths.get('D')).toBe(3)
          expect(result.depths.get('E')).toBe(2)
          expect(result.depths.get('F')).toBe(3)
        })

        it('provides visit order (BFS)', async () => {
          const result = await store.traverse('A')

          // BFS: B first, then C and E (both at depth 2), then D and F
          expect(result.visitOrder[0]).toBe('B')
          expect(result.visitOrder.indexOf('C')).toBeLessThan(result.visitOrder.indexOf('D'))
          expect(result.visitOrder.indexOf('E')).toBeLessThan(result.visitOrder.indexOf('F'))
        })
      })

      describe('traverseMultiple', () => {
        beforeEach(async () => {
          // Create disconnected subgraphs
          await store.createThing({ id: 'X1', typeId: 1, typeName: 'Node', data: {} })
          await store.createThing({ id: 'X2', typeId: 1, typeName: 'Node', data: {} })
          await store.createThing({ id: 'Y1', typeId: 1, typeName: 'Node', data: {} })
          await store.createThing({ id: 'Y2', typeId: 1, typeName: 'Node', data: {} })

          await store.createRelationship({ id: 'rx', verb: 'connects', from: 'url://X1', to: 'url://X2' })
          await store.createRelationship({ id: 'ry', verb: 'connects', from: 'url://Y1', to: 'url://Y2' })
        })

        it('traverses from multiple start nodes', async () => {
          const result = await store.traverseMultiple(['X1', 'Y1'])

          const ids = result.nodes.map(n => n.id)
          expect(ids).toContain('X2')
          expect(ids).toContain('Y2')
        })

        it('deduplicates visited nodes', async () => {
          // Add connection between subgraphs
          await store.createRelationship({ id: 'rxy', verb: 'connects', from: 'url://X2', to: 'url://Y1' })

          const result = await store.traverseMultiple(['X1', 'Y1'])

          // Y1 should appear only once even though reachable from both
          const y1Count = result.nodes.filter(n => n.id === 'Y1').length
          expect(y1Count).toBeLessThanOrEqual(1)
        })

        it('handles empty array', async () => {
          const result = await store.traverseMultiple([])

          expect(result.nodes).toHaveLength(0)
        })
      })
    })

    // ========================================================================
    // 2. PATH FINDING TESTS
    // ========================================================================

    describe('Path Finding', () => {
      beforeEach(async () => {
        // Create a graph with multiple paths:
        //     B
        //    / \
        //   A   D
        //    \ /
        //     C
        await store.createThing({ id: 'A', typeId: 1, typeName: 'Node', data: {} })
        await store.createThing({ id: 'B', typeId: 1, typeName: 'Node', data: {} })
        await store.createThing({ id: 'C', typeId: 1, typeName: 'Node', data: {} })
        await store.createThing({ id: 'D', typeId: 1, typeName: 'Node', data: {} })

        await store.createRelationship({ id: 'r1', verb: 'connects', from: 'url://A', to: 'url://B' })
        await store.createRelationship({ id: 'r2', verb: 'connects', from: 'url://A', to: 'url://C' })
        await store.createRelationship({ id: 'r3', verb: 'connects', from: 'url://B', to: 'url://D' })
        await store.createRelationship({ id: 'r4', verb: 'connects', from: 'url://C', to: 'url://D' })
      })

      describe('findPaths', () => {
        it('finds all paths between two nodes', async () => {
          const paths = await store.findPaths('A', 'D')

          expect(paths.length).toBe(2) // A->B->D and A->C->D
        })

        it('returns paths with correct structure', async () => {
          const paths = await store.findPaths('A', 'D')

          for (const path of paths) {
            expect(path.nodeIds[0]).toBe('A')
            expect(path.nodeIds[path.nodeIds.length - 1]).toBe('D')
            expect(path.length).toBe(2) // 2 hops
            expect(path.nodes.length).toBe(3) // A, (B or C), D
            expect(path.relationships.length).toBe(2)
          }
        })

        it('respects maxDepth', async () => {
          const paths = await store.findPaths('A', 'D', { maxDepth: 1 })

          expect(paths.length).toBe(0) // No direct path from A to D
        })

        it('respects maxPaths', async () => {
          const paths = await store.findPaths('A', 'D', { maxPaths: 1 })

          expect(paths.length).toBe(1)
        })

        it('filters by verb', async () => {
          // Add a path with different verb
          await store.createRelationship({ id: 'r5', verb: 'links', from: 'url://A', to: 'url://D' })

          const paths = await store.findPaths('A', 'D', { verbs: 'connects' })

          // Should only find paths via 'connects'
          for (const path of paths) {
            for (const rel of path.relationships) {
              expect(rel.verb).toBe('connects')
            }
          }
        })

        it('returns empty array for non-existent path', async () => {
          await store.createThing({ id: 'Z', typeId: 1, typeName: 'Node', data: {} })

          const paths = await store.findPaths('A', 'Z')

          expect(paths).toHaveLength(0)
        })

        it('handles same start and end', async () => {
          const paths = await store.findPaths('A', 'A')

          expect(paths.length).toBe(1)
          expect(paths[0]?.length).toBe(0)
        })
      })

      describe('shortestPath', () => {
        it('finds the shortest path', async () => {
          // Add a longer alternative path A -> E -> F -> D
          await store.createThing({ id: 'E', typeId: 1, typeName: 'Node', data: {} })
          await store.createThing({ id: 'F', typeId: 1, typeName: 'Node', data: {} })
          await store.createRelationship({ id: 'r5', verb: 'connects', from: 'url://A', to: 'url://E' })
          await store.createRelationship({ id: 'r6', verb: 'connects', from: 'url://E', to: 'url://F' })
          await store.createRelationship({ id: 'r7', verb: 'connects', from: 'url://F', to: 'url://D' })

          const path = await store.shortestPath('A', 'D')

          expect(path).not.toBeNull()
          expect(path!.length).toBe(2) // A->B->D or A->C->D, not A->E->F->D
        })

        it('returns null for non-existent path', async () => {
          await store.createThing({ id: 'Z', typeId: 1, typeName: 'Node', data: {} })

          const path = await store.shortestPath('A', 'Z')

          expect(path).toBeNull()
        })

        it('handles same start and end', async () => {
          const path = await store.shortestPath('A', 'A')

          expect(path).not.toBeNull()
          expect(path!.length).toBe(0)
        })
      })

      describe('pathExists', () => {
        it('returns true for existing path', async () => {
          const exists = await store.pathExists('A', 'D')

          expect(exists).toBe(true)
        })

        it('returns false for non-existent path', async () => {
          await store.createThing({ id: 'Z', typeId: 1, typeName: 'Node', data: {} })

          const exists = await store.pathExists('A', 'Z')

          expect(exists).toBe(false)
        })

        it('returns true for same start and end', async () => {
          const exists = await store.pathExists('A', 'A')

          expect(exists).toBe(true)
        })

        it('respects direction', async () => {
          // A -> B (outgoing only)
          const existsForward = await store.pathExists('A', 'B', { direction: 'outgoing' })
          const existsBackward = await store.pathExists('B', 'A', { direction: 'outgoing' })

          expect(existsForward).toBe(true)
          expect(existsBackward).toBe(false)
        })
      })
    })

    // ========================================================================
    // 3. SUBGRAPH EXTRACTION TESTS
    // ========================================================================

    describe('Subgraph Extraction', () => {
      beforeEach(async () => {
        // Create a complex graph
        await store.createThing({ id: 'user1', typeId: 1, typeName: 'User', data: { name: 'Alice' } })
        await store.createThing({ id: 'user2', typeId: 1, typeName: 'User', data: { name: 'Bob' } })
        await store.createThing({ id: 'post1', typeId: 2, typeName: 'Post', data: { title: 'Post 1' } })
        await store.createThing({ id: 'post2', typeId: 2, typeName: 'Post', data: { title: 'Post 2' } })
        await store.createThing({ id: 'comment1', typeId: 3, typeName: 'Comment', data: {} })

        await store.createRelationship({ id: 'r1', verb: 'authored', from: 'url://user1', to: 'url://post1' })
        await store.createRelationship({ id: 'r2', verb: 'authored', from: 'url://user2', to: 'url://post2' })
        await store.createRelationship({ id: 'r3', verb: 'commented', from: 'url://user1', to: 'url://comment1' })
        await store.createRelationship({ id: 'r4', verb: 'on', from: 'url://comment1', to: 'url://post2' })
        await store.createRelationship({ id: 'r5', verb: 'follows', from: 'url://user1', to: 'url://user2' })
      })

      describe('extractSubgraph', () => {
        it('extracts subgraph around a node', async () => {
          const subgraph = await store.extractSubgraph({
            startIds: ['user1'],
            maxDepth: 1,
          })

          expect(subgraph.nodes.length).toBeGreaterThan(0)
          const ids = subgraph.nodes.map(n => n.id)
          expect(ids).toContain('user1')
          expect(ids).toContain('post1') // authored
          expect(ids).toContain('comment1') // commented
          expect(ids).toContain('user2') // follows
        })

        it('respects maxDepth', async () => {
          const subgraph = await store.extractSubgraph({
            startIds: ['user1'],
            maxDepth: 2,
          })

          const ids = subgraph.nodes.map(n => n.id)
          // At depth 2, should also include post2 (via user2 or comment1)
          expect(ids).toContain('post2')
        })

        it('filters by verb', async () => {
          const subgraph = await store.extractSubgraph({
            startIds: ['user1'],
            verbs: ['authored'],
          })

          const ids = subgraph.nodes.map(n => n.id)
          expect(ids).toContain('post1')
          expect(ids).not.toContain('comment1') // Not via 'authored'
        })

        it('filters by type name', async () => {
          const subgraph = await store.extractSubgraph({
            startIds: ['user1'],
            typeNames: ['Post'],
          })

          for (const node of subgraph.nodes) {
            if (node.id !== 'user1') { // Start node may be included
              expect(node.typeName).toBe('Post')
            }
          }
        })

        it('extracts from multiple start nodes', async () => {
          const subgraph = await store.extractSubgraph({
            startIds: ['user1', 'user2'],
            maxDepth: 1,
          })

          const ids = subgraph.nodes.map(n => n.id)
          expect(ids).toContain('post1')
          expect(ids).toContain('post2')
        })

        it('includes adjacency list', async () => {
          const subgraph = await store.extractSubgraph({
            startIds: ['user1'],
            maxDepth: 1,
          })

          expect(subgraph.adjacencyList.get('user1')?.length).toBeGreaterThan(0)
        })

        it('includes incoming edges when specified', async () => {
          // Create a node that points to user1
          await store.createThing({ id: 'admin', typeId: 1, typeName: 'User', data: {} })
          await store.createRelationship({ id: 'r6', verb: 'manages', from: 'url://admin', to: 'url://user1' })

          const subgraph = await store.extractSubgraph({
            startIds: ['user1'],
            maxDepth: 1,
            includeIncoming: true,
          })

          const ids = subgraph.nodes.map(n => n.id)
          expect(ids).toContain('admin')
        })
      })

      describe('getConnectedComponent', () => {
        it('returns all nodes in the connected component', async () => {
          const component = await store.getConnectedComponent('user1')

          // All nodes should be reachable from user1 in undirected sense
          expect(component.length).toBeGreaterThan(1)
        })

        it('returns only the node for isolated node', async () => {
          await store.createThing({ id: 'isolated', typeId: 1, typeName: 'Node', data: {} })

          const component = await store.getConnectedComponent('isolated')

          expect(component.length).toBe(1)
          expect(component[0]?.id).toBe('isolated')
        })
      })

      describe('getAllConnectedComponents', () => {
        it('returns all connected components', async () => {
          // Create an isolated subgraph
          await store.createThing({ id: 'isolated1', typeId: 1, typeName: 'Node', data: {} })
          await store.createThing({ id: 'isolated2', typeId: 1, typeName: 'Node', data: {} })
          await store.createRelationship({
            id: 'riso',
            verb: 'connects',
            from: 'url://isolated1',
            to: 'url://isolated2'
          })

          const components = await store.getAllConnectedComponents()

          expect(components.length).toBe(2) // Main component + isolated pair
        })

        it('returns empty array for empty graph', async () => {
          // Create a fresh store
          const emptyStore = await factory()

          const components = await emptyStore.getAllConnectedComponents()

          expect(components).toHaveLength(0)

          if (cleanup) {
            await cleanup(emptyStore)
          }
        })
      })
    })

    // ========================================================================
    // 4. AGGREGATION TESTS
    // ========================================================================

    describe('Aggregations', () => {
      beforeEach(async () => {
        // Create things of different types
        await store.createThing({ id: 'u1', typeId: 1, typeName: 'User', data: {} })
        await store.createThing({ id: 'u2', typeId: 1, typeName: 'User', data: {} })
        await store.createThing({ id: 'p1', typeId: 2, typeName: 'Product', data: { price: 100 } })
        await store.createThing({ id: 'p2', typeId: 2, typeName: 'Product', data: { price: 200 } })
        await store.createThing({ id: 'o1', typeId: 3, typeName: 'Order', data: { amount: 150 } })
        await store.createThing({ id: 'o2', typeId: 3, typeName: 'Order', data: { amount: 250 } })

        // Create various relationships
        await store.createRelationship({ id: 'r1', verb: 'purchased', from: 'url://u1', to: 'url://p1', data: { qty: 2 } })
        await store.createRelationship({ id: 'r2', verb: 'purchased', from: 'url://u1', to: 'url://p2', data: { qty: 1 } })
        await store.createRelationship({ id: 'r3', verb: 'purchased', from: 'url://u2', to: 'url://p1', data: { qty: 3 } })
        await store.createRelationship({ id: 'r4', verb: 'placed', from: 'url://u1', to: 'url://o1' })
        await store.createRelationship({ id: 'r5', verb: 'placed', from: 'url://u2', to: 'url://o2' })
        await store.createRelationship({ id: 'r6', verb: 'follows', from: 'url://u1', to: 'url://u2' })
      })

      describe('aggregateRelationships', () => {
        it('counts relationships grouped by verb', async () => {
          const result = await store.aggregateRelationships({
            groupBy: 'verb',
            aggregation: 'count',
          })

          expect(result.groups.get('purchased')).toBe(3)
          expect(result.groups.get('placed')).toBe(2)
          expect(result.groups.get('follows')).toBe(1)
          expect(result.totalCount).toBe(6)
        })

        it('counts relationships grouped by from', async () => {
          const result = await store.aggregateRelationships({
            groupBy: 'from',
            aggregation: 'count',
          })

          expect(result.groups.get('url://u1')).toBe(4) // 2 purchases + 1 placed + 1 follows
          expect(result.groups.get('url://u2')).toBe(2) // 1 purchase + 1 placed
        })

        it('sums relationship data field', async () => {
          const result = await store.aggregateRelationships({
            groupBy: 'verb',
            aggregation: 'sum',
            field: 'data.qty',
            filter: { verb: 'purchased' },
          })

          expect(result.groups.get('purchased')).toBe(6) // 2 + 1 + 3
        })

        it('filters by verb before aggregation', async () => {
          const result = await store.aggregateRelationships({
            groupBy: 'from',
            aggregation: 'count',
            filter: { verb: 'purchased' },
          })

          expect(result.groups.get('url://u1')).toBe(2)
          expect(result.groups.get('url://u2')).toBe(1)
          expect(result.totalCount).toBe(3)
        })
      })

      describe('countRelationshipsByVerb', () => {
        it('returns map of verb to count', async () => {
          const counts = await store.countRelationshipsByVerb()

          expect(counts.get('purchased')).toBe(3)
          expect(counts.get('placed')).toBe(2)
          expect(counts.get('follows')).toBe(1)
        })

        it('returns empty map for empty graph', async () => {
          const emptyStore = await factory()

          const counts = await emptyStore.countRelationshipsByVerb()

          expect(counts.size).toBe(0)

          if (cleanup) {
            await cleanup(emptyStore)
          }
        })
      })

      describe('getDegree', () => {
        it('returns total degree by default', async () => {
          const degree = await store.getDegree('u1')

          expect(degree).toBe(4) // 2 purchased + 1 placed + 1 follows (outgoing)
        })

        it('returns outgoing degree', async () => {
          const degree = await store.getDegree('u1', 'outgoing')

          expect(degree).toBe(4)
        })

        it('returns incoming degree', async () => {
          const degree = await store.getDegree('u2', 'incoming')

          expect(degree).toBe(1) // u1 follows u2
        })

        it('filters by verb', async () => {
          const degree = await store.getDegree('u1', 'outgoing', 'purchased')

          expect(degree).toBe(2)
        })

        it('returns 0 for non-existent node', async () => {
          const degree = await store.getDegree('nonexistent')

          expect(degree).toBe(0)
        })
      })

      describe('getTopNodesByDegree', () => {
        it('returns nodes sorted by degree', async () => {
          const top = await store.getTopNodesByDegree(3)

          expect(top.length).toBe(3)
          // First should have highest degree
          expect(top[0]![1]).toBeGreaterThanOrEqual(top[1]![1])
          expect(top[1]![1]).toBeGreaterThanOrEqual(top[2]![1])
        })

        it('respects limit', async () => {
          const top = await store.getTopNodesByDegree(2)

          expect(top.length).toBe(2)
        })

        it('respects direction', async () => {
          const topOutgoing = await store.getTopNodesByDegree(2, 'outgoing')
          const topIncoming = await store.getTopNodesByDegree(2, 'incoming')

          // Results should differ based on direction
          expect(topOutgoing[0]![0]).not.toBe(topIncoming[0]![0])
        })
      })
    })

    // ========================================================================
    // 5. TRANSACTION TESTS
    // ========================================================================

    describe('Transactions', () => {
      it('commits all operations on success', async () => {
        await store.transaction(async (session) => {
          await session.createThing({ id: 'tx1', typeId: 1, typeName: 'Node', data: {} })
          await session.createThing({ id: 'tx2', typeId: 1, typeName: 'Node', data: {} })
          await session.createRelationship({
            id: 'rtx1',
            verb: 'connects',
            from: 'url://tx1',
            to: 'url://tx2'
          })
        })

        const thing1 = await store.getThing('tx1')
        const thing2 = await store.getThing('tx2')
        const rels = await store.queryRelationshipsFrom('url://tx1')

        expect(thing1).not.toBeNull()
        expect(thing2).not.toBeNull()
        expect(rels.length).toBe(1)
      })

      it('rolls back all operations on error', async () => {
        try {
          await store.transaction(async (session) => {
            await session.createThing({ id: 'txRollback1', typeId: 1, typeName: 'Node', data: {} })
            await session.createThing({ id: 'txRollback2', typeId: 1, typeName: 'Node', data: {} })
            throw new Error('Intentional error')
          })
        } catch {
          // Expected
        }

        const thing1 = await store.getThing('txRollback1')
        const thing2 = await store.getThing('txRollback2')

        expect(thing1).toBeNull()
        expect(thing2).toBeNull()
      })

      it('supports update within transaction', async () => {
        await store.createThing({ id: 'txUpdate', typeId: 1, typeName: 'Node', data: { value: 1 } })

        await store.transaction(async (session) => {
          await session.updateThing('txUpdate', { data: { value: 2 } })
        })

        const thing = await store.getThing('txUpdate')
        expect(thing?.data).toEqual({ value: 2 })
      })

      it('supports delete within transaction', async () => {
        await store.createThing({ id: 'txDelete', typeId: 1, typeName: 'Node', data: {} })

        await store.transaction(async (session) => {
          await session.deleteThing('txDelete')
        })

        const thing = await store.getThing('txDelete')
        expect(thing?.deletedAt).not.toBeNull()
      })

      it('returns value from transaction callback', async () => {
        const result = await store.transaction(async (session) => {
          const thing = await session.createThing({ id: 'txReturn', typeId: 1, typeName: 'Node', data: {} })
          return thing.id
        })

        expect(result).toBe('txReturn')
      })

      it('isolates concurrent transactions', async () => {
        await store.createThing({ id: 'concurrent', typeId: 1, typeName: 'Node', data: { counter: 0 } })

        // Run two transactions concurrently
        const [result1, result2] = await Promise.allSettled([
          store.transaction(async (session) => {
            const thing = await store.getThing('concurrent')
            const newValue = ((thing?.data as Record<string, number>)?.counter ?? 0) + 1
            await session.updateThing('concurrent', { data: { counter: newValue } })
          }),
          store.transaction(async (session) => {
            const thing = await store.getThing('concurrent')
            const newValue = ((thing?.data as Record<string, number>)?.counter ?? 0) + 1
            await session.updateThing('concurrent', { data: { counter: newValue } })
          }),
        ])

        // At least one should succeed
        expect(result1.status === 'fulfilled' || result2.status === 'fulfilled').toBe(true)
      })
    })

    // ========================================================================
    // 6. EDGE CASES AND ERROR HANDLING
    // ========================================================================

    describe('Edge Cases', () => {
      describe('Cycles in graph', () => {
        it('handles cycles during traversal', async () => {
          // Create a cycle: A -> B -> C -> A
          await store.createThing({ id: 'cycleA', typeId: 1, typeName: 'Node', data: {} })
          await store.createThing({ id: 'cycleB', typeId: 1, typeName: 'Node', data: {} })
          await store.createThing({ id: 'cycleC', typeId: 1, typeName: 'Node', data: {} })

          await store.createRelationship({ id: 'rc1', verb: 'connects', from: 'url://cycleA', to: 'url://cycleB' })
          await store.createRelationship({ id: 'rc2', verb: 'connects', from: 'url://cycleB', to: 'url://cycleC' })
          await store.createRelationship({ id: 'rc3', verb: 'connects', from: 'url://cycleC', to: 'url://cycleA' })

          const result = await store.traverse('cycleA')

          // Should visit each node exactly once
          expect(result.nodes.length).toBe(2) // B and C (not A since it's start)
        })

        it('finds paths in cyclic graphs', async () => {
          await store.createThing({ id: 'cycleA', typeId: 1, typeName: 'Node', data: {} })
          await store.createThing({ id: 'cycleB', typeId: 1, typeName: 'Node', data: {} })
          await store.createThing({ id: 'cycleC', typeId: 1, typeName: 'Node', data: {} })

          await store.createRelationship({ id: 'rc1', verb: 'connects', from: 'url://cycleA', to: 'url://cycleB' })
          await store.createRelationship({ id: 'rc2', verb: 'connects', from: 'url://cycleB', to: 'url://cycleC' })
          await store.createRelationship({ id: 'rc3', verb: 'connects', from: 'url://cycleC', to: 'url://cycleA' })

          const path = await store.shortestPath('cycleA', 'cycleC')

          expect(path).not.toBeNull()
          expect(path!.length).toBe(2) // A -> B -> C
        })
      })

      describe('Large graphs', () => {
        it('handles traversal in moderately large graph', async () => {
          // Create a chain of 100 nodes
          const ids: string[] = []
          for (let i = 0; i < 100; i++) {
            const id = `chain-${i}`
            ids.push(id)
            await store.createThing({ id, typeId: 1, typeName: 'Node', data: { index: i } })
          }

          for (let i = 0; i < 99; i++) {
            await store.createRelationship({
              id: `chain-rel-${i}`,
              verb: 'next',
              from: `url://${ids[i]}`,
              to: `url://${ids[i + 1]}`
            })
          }

          const result = await store.traverse('chain-0')

          expect(result.nodes.length).toBe(99) // All except start
        })

        it('respects depth limit in large graph', async () => {
          // Create a chain
          for (let i = 0; i < 50; i++) {
            await store.createThing({ id: `depth-${i}`, typeId: 1, typeName: 'Node', data: {} })
          }

          for (let i = 0; i < 49; i++) {
            await store.createRelationship({
              id: `depth-rel-${i}`,
              verb: 'next',
              from: `url://depth-${i}`,
              to: `url://depth-${i + 1}`
            })
          }

          const result = await store.traverse('depth-0', { maxDepth: 10 })

          expect(result.nodes.length).toBe(10)
        })
      })

      describe('Self-loops', () => {
        it('handles self-referential relationships', async () => {
          await store.createThing({ id: 'self', typeId: 1, typeName: 'Node', data: {} })
          await store.createRelationship({ id: 'rself', verb: 'references', from: 'url://self', to: 'url://self' })

          const result = await store.traverse('self')

          // Should handle gracefully, not infinite loop
          expect(result.nodes.length).toBe(0) // Self is the start node
        })

        it('counts self-loop in degree', async () => {
          await store.createThing({ id: 'selfDegree', typeId: 1, typeName: 'Node', data: {} })
          await store.createRelationship({ id: 'rselfDeg', verb: 'references', from: 'url://selfDegree', to: 'url://selfDegree' })

          const degree = await store.getDegree('selfDegree', 'both')

          // Self-loop should count
          expect(degree).toBeGreaterThanOrEqual(1)
        })
      })

      describe('Empty graph operations', () => {
        it('traverse returns empty result on empty graph', async () => {
          const emptyStore = await factory()

          const result = await emptyStore.traverse('nonexistent')

          expect(result.nodes).toHaveLength(0)
          expect(result.edges).toHaveLength(0)

          if (cleanup) {
            await cleanup(emptyStore)
          }
        })

        it('aggregation returns empty result on empty graph', async () => {
          const emptyStore = await factory()

          const result = await emptyStore.aggregateRelationships({
            groupBy: 'verb',
            aggregation: 'count',
          })

          expect(result.groups.size).toBe(0)
          expect(result.totalCount).toBe(0)

          if (cleanup) {
            await cleanup(emptyStore)
          }
        })
      })
    })
  })
}

// ============================================================================
// INTERFACE EXISTENCE TESTS
// ============================================================================

describe('RichGraphStore Interface Contract [RED]', () => {
  it('RichGraphStore type should be exported from db/graph/stores', async () => {
    // This will fail until RichGraphStore is implemented
    const stores = await import('../index').catch(() => null)

    expect(stores).not.toBeNull()
    expect(stores).toHaveProperty('RichGraphStore')
  })

  it('createRichGraphStore factory should be exported', async () => {
    const stores = await import('../index').catch(() => null)

    expect(stores).not.toBeNull()
    expect(stores).toHaveProperty('createRichGraphStore')
  })
})

// ============================================================================
// IMPLEMENTATION TESTS (will fail until GREEN phase)
// ============================================================================

describe('RichGraphStore SQLite Implementation [RED]', () => {
  it('SQLiteRichGraphStore should be exported from db/graph/stores', async () => {
    const stores = await import('../index').catch(() => null)

    expect(stores).not.toBeNull()
    expect(stores).toHaveProperty('SQLiteRichGraphStore')
  })

  it('SQLiteRichGraphStore should extend SQLiteGraphStore', async () => {
    const stores = await import('../index').catch(() => null)

    expect(stores).not.toBeNull()

    const { SQLiteRichGraphStore, SQLiteGraphStore } = stores as {
      SQLiteRichGraphStore: new (...args: unknown[]) => RichGraphStore
      SQLiteGraphStore: new (...args: unknown[]) => GraphStore
    }

    // Verify prototype chain
    expect(SQLiteRichGraphStore.prototype).toBeInstanceOf(Object)
    expect(Object.getPrototypeOf(SQLiteRichGraphStore.prototype).constructor).toBe(SQLiteGraphStore)
  })
})

// ============================================================================
// Run tests against future SQLiteRichGraphStore implementation
// ============================================================================

// These will fail until the implementation is created in GREEN phase
describe.skip('RichGraphStore: SQLiteRichGraphStore [PENDING]', () => {
  // Placeholder - tests will be enabled in GREEN phase
  it.todo('implement SQLiteRichGraphStore')
})
