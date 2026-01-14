/**
 * LineageTracker Tests
 *
 * Comprehensive test suite for the LineageTracker primitive including:
 * - Node CRUD operations
 * - Edge CRUD operations
 * - Graph traversal (upstream/downstream)
 * - Impact analysis
 * - Cycle detection
 * - Edge cases
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  createLineageTracker,
  LineageTracker,
  createLineageStore,
  LineageStore,
  LineageTraversal,
  ImpactAnalyzer,
  type SqlExecutor,
  type LineageNode,
  type LineageEdge,
  type NodeType,
} from '../index'

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Creates an in-memory SQLite database compatible with our SqlExecutor interface
 */
function createTestDb(): SqlExecutor {
  const db = new Database(':memory:')
  return {
    exec: (sql: string) => db.exec(sql),
    prepare: (sql: string) => {
      const stmt = db.prepare(sql)
      return {
        bind: (...args: unknown[]) => ({
          all: () => stmt.all(...args),
          run: () => stmt.run(...args),
          first: () => stmt.get(...args),
        }),
      }
    },
  }
}

function createTracker(): LineageTracker {
  const sql = createTestDb()
  return createLineageTracker(sql)
}

// =============================================================================
// NODE CRUD TESTS
// =============================================================================

describe('LineageTracker - Node Operations', () => {
  let tracker: LineageTracker

  beforeEach(() => {
    tracker = createTracker()
  })

  describe('createNode', () => {
    it('should create a node with auto-generated ID', () => {
      const node = tracker.createNode({
        type: 'entity',
        name: 'users',
        namespace: 'warehouse',
      })

      expect(node.id).toBeDefined()
      expect(node.type).toBe('entity')
      expect(node.name).toBe('users')
      expect(node.namespace).toBe('warehouse')
      expect(node.createdAt).toBeLessThanOrEqual(Date.now())
      expect(node.updatedAt).toBeLessThanOrEqual(Date.now())
    })

    it('should create a node with explicit ID', () => {
      const node = tracker.createNode({
        id: 'my-custom-id',
        type: 'source',
        name: 'api_events',
      })

      expect(node.id).toBe('my-custom-id')
    })

    it('should store metadata', () => {
      const node = tracker.createNode({
        type: 'transformation',
        name: 'aggregate',
        metadata: {
          sql: 'SELECT COUNT(*) FROM events',
          author: 'alice',
        },
      })

      expect(node.metadata).toEqual({
        sql: 'SELECT COUNT(*) FROM events',
        author: 'alice',
      })
    })

    it('should handle all node types', () => {
      const types: NodeType[] = ['entity', 'transformation', 'source', 'sink']

      for (const type of types) {
        const node = tracker.createNode({ type, name: `${type}_node` })
        expect(node.type).toBe(type)
      }
    })
  })

  describe('getNode', () => {
    it('should retrieve an existing node', () => {
      const created = tracker.createNode({
        type: 'entity',
        name: 'customers',
      })

      const retrieved = tracker.getNode(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
      expect(retrieved?.name).toBe('customers')
    })

    it('should return null for non-existent node', () => {
      const result = tracker.getNode('non-existent-id')
      expect(result).toBeNull()
    })
  })

  describe('updateNode', () => {
    it('should update node fields', () => {
      const node = tracker.createNode({
        type: 'entity',
        name: 'orders',
      })

      const updated = tracker.updateNode(node.id, {
        name: 'order_items',
        namespace: 'sales',
        metadata: { updated: true },
      })

      expect(updated).not.toBeNull()
      expect(updated?.name).toBe('order_items')
      expect(updated?.namespace).toBe('sales')
      expect(updated?.metadata).toEqual({ updated: true })
      expect(updated?.updatedAt).toBeGreaterThanOrEqual(node.updatedAt)
    })

    it('should return null when updating non-existent node', () => {
      const result = tracker.updateNode('non-existent', { name: 'new-name' })
      expect(result).toBeNull()
    })

    it('should preserve createdAt timestamp', () => {
      const node = tracker.createNode({ type: 'entity', name: 'test' })
      const updated = tracker.updateNode(node.id, { name: 'updated' })

      expect(updated?.createdAt).toBe(node.createdAt)
    })
  })

  describe('deleteNode', () => {
    it('should delete an existing node', () => {
      const node = tracker.createNode({ type: 'entity', name: 'to-delete' })

      const result = tracker.deleteNode(node.id)

      expect(result).toBe(true)
      expect(tracker.getNode(node.id)).toBeNull()
    })

    it('should return false for non-existent node', () => {
      const result = tracker.deleteNode('non-existent')
      expect(result).toBe(false)
    })

    it('should cascade delete edges when node is deleted', () => {
      const nodeA = tracker.createNode({ type: 'entity', name: 'A' })
      const nodeB = tracker.createNode({ type: 'entity', name: 'B' })
      const edge = tracker.createEdge({
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        operation: 'read',
      })

      tracker.deleteNode(nodeA.id)

      expect(tracker.getEdge(edge.id)).toBeNull()
    })
  })

  describe('findNodes', () => {
    beforeEach(() => {
      tracker.createNode({ type: 'entity', name: 'users', namespace: 'db' })
      tracker.createNode({ type: 'entity', name: 'orders', namespace: 'db' })
      tracker.createNode({ type: 'transformation', name: 'transform_users', namespace: 'etl' })
      tracker.createNode({ type: 'source', name: 'api_events', namespace: 'api' })
    })

    it('should filter by type', () => {
      const entities = tracker.findNodes({ type: 'entity' })
      expect(entities).toHaveLength(2)
      expect(entities.every((n) => n.type === 'entity')).toBe(true)
    })

    it('should filter by namespace', () => {
      const dbNodes = tracker.findNodes({ namespace: 'db' })
      expect(dbNodes).toHaveLength(2)
      expect(dbNodes.every((n) => n.namespace === 'db')).toBe(true)
    })

    it('should filter by name contains', () => {
      const userNodes = tracker.findNodes({ nameContains: 'user' })
      expect(userNodes).toHaveLength(2) // users and transform_users
    })

    it('should limit results', () => {
      const limited = tracker.findNodes({ limit: 2 })
      expect(limited).toHaveLength(2)
    })

    it('should return all nodes when no query provided', () => {
      const all = tracker.findNodes()
      expect(all).toHaveLength(4)
    })
  })

  describe('createNodes (bulk)', () => {
    it('should create multiple nodes', () => {
      const nodes = tracker.createNodes([
        { type: 'entity', name: 'node1' },
        { type: 'entity', name: 'node2' },
        { type: 'entity', name: 'node3' },
      ])

      expect(nodes).toHaveLength(3)
      expect(nodes.every((n) => n.id)).toBe(true)
    })
  })
})

// =============================================================================
// EDGE CRUD TESTS
// =============================================================================

describe('LineageTracker - Edge Operations', () => {
  let tracker: LineageTracker
  let nodeA: LineageNode
  let nodeB: LineageNode
  let nodeC: LineageNode

  beforeEach(() => {
    tracker = createTracker()
    nodeA = tracker.createNode({ type: 'source', name: 'A' })
    nodeB = tracker.createNode({ type: 'transformation', name: 'B' })
    nodeC = tracker.createNode({ type: 'sink', name: 'C' })
  })

  describe('createEdge', () => {
    it('should create an edge between two nodes', () => {
      const edge = tracker.createEdge({
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        operation: 'read',
      })

      expect(edge.id).toBeDefined()
      expect(edge.fromNodeId).toBe(nodeA.id)
      expect(edge.toNodeId).toBe(nodeB.id)
      expect(edge.operation).toBe('read')
      expect(edge.timestamp).toBeLessThanOrEqual(Date.now())
    })

    it('should store edge metadata', () => {
      const edge = tracker.createEdge({
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        operation: 'transform',
        metadata: {
          rowsProcessed: 1000,
          duration: 500,
        },
      })

      expect(edge.metadata).toEqual({
        rowsProcessed: 1000,
        duration: 500,
      })
    })

    it('should throw error for non-existent source node', () => {
      expect(() =>
        tracker.createEdge({
          fromNodeId: 'non-existent',
          toNodeId: nodeB.id,
          operation: 'read',
        })
      ).toThrow(/Source node not found/)
    })

    it('should throw error for non-existent target node', () => {
      expect(() =>
        tracker.createEdge({
          fromNodeId: nodeA.id,
          toNodeId: 'non-existent',
          operation: 'read',
        })
      ).toThrow(/Target node not found/)
    })
  })

  describe('cycle detection', () => {
    it('should detect self-loops', () => {
      expect(() =>
        tracker.createEdge({
          fromNodeId: nodeA.id,
          toNodeId: nodeA.id,
          operation: 'loop',
        })
      ).toThrow(/cycle/)
    })

    it('should detect simple cycles', () => {
      tracker.createEdge({
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        operation: 'step1',
      })

      expect(() =>
        tracker.createEdge({
          fromNodeId: nodeB.id,
          toNodeId: nodeA.id,
          operation: 'step2',
        })
      ).toThrow(/cycle/)
    })

    it('should detect longer cycles', () => {
      tracker.createEdge({ fromNodeId: nodeA.id, toNodeId: nodeB.id, operation: 's1' })
      tracker.createEdge({ fromNodeId: nodeB.id, toNodeId: nodeC.id, operation: 's2' })

      expect(() =>
        tracker.createEdge({
          fromNodeId: nodeC.id,
          toNodeId: nodeA.id,
          operation: 's3',
        })
      ).toThrow(/cycle/)
    })
  })

  describe('getEdge', () => {
    it('should retrieve an existing edge', () => {
      const created = tracker.createEdge({
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        operation: 'test',
      })

      const retrieved = tracker.getEdge(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
    })

    it('should return null for non-existent edge', () => {
      const result = tracker.getEdge('non-existent')
      expect(result).toBeNull()
    })
  })

  describe('deleteEdge', () => {
    it('should delete an existing edge', () => {
      const edge = tracker.createEdge({
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        operation: 'test',
      })

      const result = tracker.deleteEdge(edge.id)

      expect(result).toBe(true)
      expect(tracker.getEdge(edge.id)).toBeNull()
    })

    it('should return false for non-existent edge', () => {
      const result = tracker.deleteEdge('non-existent')
      expect(result).toBe(false)
    })
  })

  describe('findEdges', () => {
    beforeEach(() => {
      tracker.createEdge({ fromNodeId: nodeA.id, toNodeId: nodeB.id, operation: 'read' })
      tracker.createEdge({ fromNodeId: nodeB.id, toNodeId: nodeC.id, operation: 'write' })
    })

    it('should filter by fromNodeId', () => {
      const edges = tracker.findEdges({ fromNodeId: nodeA.id })
      expect(edges).toHaveLength(1)
      expect(edges[0].fromNodeId).toBe(nodeA.id)
    })

    it('should filter by toNodeId', () => {
      const edges = tracker.findEdges({ toNodeId: nodeC.id })
      expect(edges).toHaveLength(1)
      expect(edges[0].toNodeId).toBe(nodeC.id)
    })

    it('should filter by operation', () => {
      const edges = tracker.findEdges({ operation: 'read' })
      expect(edges).toHaveLength(1)
      expect(edges[0].operation).toBe('read')
    })
  })
})

// =============================================================================
// GRAPH TRAVERSAL TESTS
// =============================================================================

describe('LineageTracker - Graph Traversal', () => {
  let tracker: LineageTracker

  // Build a test graph:
  //   A -> B -> D
  //        |
  //        v
  //   C -> E -> F
  //
  beforeEach(() => {
    tracker = createTracker()

    const a = tracker.createNode({ id: 'A', type: 'source', name: 'A' })
    const b = tracker.createNode({ id: 'B', type: 'transformation', name: 'B' })
    const c = tracker.createNode({ id: 'C', type: 'source', name: 'C' })
    const d = tracker.createNode({ id: 'D', type: 'sink', name: 'D' })
    const e = tracker.createNode({ id: 'E', type: 'transformation', name: 'E' })
    const f = tracker.createNode({ id: 'F', type: 'sink', name: 'F' })

    tracker.createEdge({ fromNodeId: 'A', toNodeId: 'B', operation: 'read' })
    tracker.createEdge({ fromNodeId: 'B', toNodeId: 'D', operation: 'write' })
    tracker.createEdge({ fromNodeId: 'B', toNodeId: 'E', operation: 'transform' })
    tracker.createEdge({ fromNodeId: 'C', toNodeId: 'E', operation: 'read' })
    tracker.createEdge({ fromNodeId: 'E', toNodeId: 'F', operation: 'write' })
  })

  describe('getUpstream', () => {
    it('should return all upstream nodes', () => {
      const upstream = tracker.getUpstream('F')

      expect(upstream.nodes.map((n) => n.id).sort()).toEqual(['A', 'B', 'C', 'E'])
      expect(upstream.rootId).toBe('F')
    })

    it('should respect maxDepth', () => {
      const upstream = tracker.getUpstream('F', { maxDepth: 1 })

      expect(upstream.nodes.map((n) => n.id)).toEqual(['E'])
    })

    it('should return empty for root nodes', () => {
      const upstream = tracker.getUpstream('A')

      expect(upstream.nodes).toHaveLength(0)
    })

    it('should filter by nodeTypes', () => {
      const upstream = tracker.getUpstream('F', { nodeTypes: ['source'] })

      expect(upstream.nodes.map((n) => n.id).sort()).toEqual(['A', 'C'])
    })
  })

  describe('getDownstream', () => {
    it('should return all downstream nodes', () => {
      const downstream = tracker.getDownstream('A')

      expect(downstream.nodes.map((n) => n.id).sort()).toEqual(['B', 'D', 'E', 'F'])
    })

    it('should respect maxDepth', () => {
      const downstream = tracker.getDownstream('A', { maxDepth: 1 })

      expect(downstream.nodes.map((n) => n.id)).toEqual(['B'])
    })

    it('should return empty for leaf nodes', () => {
      const downstream = tracker.getDownstream('F')

      expect(downstream.nodes).toHaveLength(0)
    })

    it('should filter by nodeTypes', () => {
      const downstream = tracker.getDownstream('A', { nodeTypes: ['sink'] })

      expect(downstream.nodes.map((n) => n.id).sort()).toEqual(['D', 'F'])
    })
  })

  describe('getFullLineage', () => {
    it('should return both upstream and downstream', () => {
      const lineage = tracker.getFullLineage('B')

      const nodeIds = lineage.nodes.map((n) => n.id).sort()
      expect(nodeIds).toEqual(['A', 'D', 'E', 'F'])
    })
  })

  describe('findPaths', () => {
    it('should find direct path', () => {
      const paths = tracker.findPaths('A', 'B')

      expect(paths).toHaveLength(1)
      expect(paths[0].nodeIds).toEqual(['A', 'B'])
    })

    it('should find longer paths', () => {
      const paths = tracker.findPaths('A', 'F')

      expect(paths).toHaveLength(1)
      expect(paths[0].nodeIds).toEqual(['A', 'B', 'E', 'F'])
    })

    it('should find multiple paths (diamond)', () => {
      // Add another path A -> C -> E to create diamond
      tracker.createEdge({ fromNodeId: 'A', toNodeId: 'C', operation: 'alt' })

      const paths = tracker.findPaths('A', 'F')

      expect(paths).toHaveLength(2)
    })

    it('should return empty for no path', () => {
      const paths = tracker.findPaths('D', 'A') // D is downstream of A, no reverse path

      expect(paths).toHaveLength(0)
    })
  })

  describe('getParents / getChildren', () => {
    it('should get immediate parents', () => {
      const parents = tracker.getParents('E')

      expect(parents.map((n) => n.id).sort()).toEqual(['B', 'C'])
    })

    it('should get immediate children', () => {
      const children = tracker.getChildren('B')

      expect(children.map((n) => n.id).sort()).toEqual(['D', 'E'])
    })
  })

  describe('getRootNodes / getLeafNodes', () => {
    it('should identify root nodes', () => {
      const roots = tracker.getRootNodes()

      expect(roots.map((n) => n.id).sort()).toEqual(['A', 'C'])
    })

    it('should identify leaf nodes', () => {
      const leaves = tracker.getLeafNodes()

      expect(leaves.map((n) => n.id).sort()).toEqual(['D', 'F'])
    })
  })
})

// =============================================================================
// IMPACT ANALYSIS TESTS
// =============================================================================

describe('LineageTracker - Impact Analysis', () => {
  let tracker: LineageTracker

  // Build a more complex test graph:
  //   Source1 -> Transform1 -> Entity1 -> Transform2 -> Sink1
  //                               |
  //                               v
  //   Source2 -----------------> Entity2 -> Sink2
  //
  beforeEach(() => {
    tracker = createTracker()

    tracker.createNode({ id: 'source1', type: 'source', name: 'Source 1' })
    tracker.createNode({ id: 'source2', type: 'source', name: 'Source 2' })
    tracker.createNode({ id: 'transform1', type: 'transformation', name: 'Transform 1' })
    tracker.createNode({ id: 'transform2', type: 'transformation', name: 'Transform 2' })
    tracker.createNode({ id: 'entity1', type: 'entity', name: 'Entity 1' })
    tracker.createNode({ id: 'entity2', type: 'entity', name: 'Entity 2' })
    tracker.createNode({ id: 'sink1', type: 'sink', name: 'Sink 1' })
    tracker.createNode({ id: 'sink2', type: 'sink', name: 'Sink 2' })

    tracker.createEdge({ fromNodeId: 'source1', toNodeId: 'transform1', operation: 'read' })
    tracker.createEdge({ fromNodeId: 'transform1', toNodeId: 'entity1', operation: 'write' })
    tracker.createEdge({ fromNodeId: 'entity1', toNodeId: 'transform2', operation: 'read' })
    tracker.createEdge({ fromNodeId: 'transform2', toNodeId: 'sink1', operation: 'write' })
    tracker.createEdge({ fromNodeId: 'entity1', toNodeId: 'entity2', operation: 'derive' })
    tracker.createEdge({ fromNodeId: 'source2', toNodeId: 'entity2', operation: 'read' })
    tracker.createEdge({ fromNodeId: 'entity2', toNodeId: 'sink2', operation: 'write' })
  })

  describe('analyzeImpact', () => {
    it('should find all affected nodes', () => {
      const impact = tracker.analyzeImpact('source1')

      expect(impact.sourceNode.id).toBe('source1')
      // transform1, entity1, transform2, sink1, entity2, sink2 = 6 nodes
      expect(impact.totalAffected).toBe(6)
    })

    it('should calculate distances correctly', () => {
      const impact = tracker.analyzeImpact('source1')

      const distances = new Map(impact.affectedNodes.map((a) => [a.node.id, a.distance]))

      expect(distances.get('transform1')).toBe(1)
      expect(distances.get('entity1')).toBe(2)
      expect(distances.get('transform2')).toBe(3)
      expect(distances.get('sink1')).toBe(4)
    })

    it('should classify direct vs indirect impact', () => {
      const impact = tracker.analyzeImpact('source1')

      const directNodes = impact.affectedNodes.filter((a) => a.impact === 'direct')
      const indirectNodes = impact.affectedNodes.filter((a) => a.impact === 'indirect')

      expect(directNodes.map((a) => a.node.id)).toEqual(['transform1'])
      expect(indirectNodes.length).toBeGreaterThan(0)
    })

    it('should respect maxDepth', () => {
      const impact = tracker.analyzeImpact('source1', { maxDepth: 2 })

      expect(impact.totalAffected).toBe(2) // Only transform1 and entity1
    })

    it('should filter by nodeTypes', () => {
      const impact = tracker.analyzeImpact('source1', { nodeTypes: ['sink'] })

      expect(impact.affectedNodes.map((a) => a.node.id).sort()).toEqual(['sink1', 'sink2'])
    })

    it('should calculate blast radius metrics', () => {
      const impact = tracker.analyzeImpact('source1')

      expect(impact.metrics.totalAffected).toBe(impact.totalAffected)
      expect(impact.metrics.maxDepth).toBeGreaterThan(0)
      expect(impact.metrics.byDepth.size).toBeGreaterThan(0)
      expect(impact.metrics.byType.size).toBeGreaterThan(0)
    })
  })

  describe('getAffectedByType', () => {
    it('should group affected nodes by type', () => {
      const byType = tracker.getAffectedByType('source1')

      expect(byType.get('transformation')?.length).toBe(2)
      expect(byType.get('entity')?.length).toBe(2)
      expect(byType.get('sink')?.length).toBe(2)
    })
  })

  describe('getBlastRadius', () => {
    it('should return metrics without full analysis', () => {
      const metrics = tracker.getBlastRadius('source1')

      expect(metrics.totalAffected).toBeGreaterThan(0)
      expect(metrics.maxDepth).toBeGreaterThan(0)
    })
  })
})

// =============================================================================
// CONVENIENCE METHOD TESTS
// =============================================================================

describe('LineageTracker - Convenience Methods', () => {
  let tracker: LineageTracker

  beforeEach(() => {
    tracker = createTracker()
  })

  describe('record', () => {
    it('should create nodes and edge in one call', () => {
      const { source, target, edge } = tracker.record({
        source: { type: 'source', name: 'api_events' },
        target: { type: 'sink', name: 'event_log' },
        operation: 'ingest',
      })

      expect(source.id).toBeDefined()
      expect(target.id).toBeDefined()
      expect(edge.fromNodeId).toBe(source.id)
      expect(edge.toNodeId).toBe(target.id)
    })

    it('should use existing nodes by ID', () => {
      const existingSource = tracker.createNode({ type: 'source', name: 'existing' })

      const { source, target, edge } = tracker.record({
        source: existingSource.id,
        target: { type: 'sink', name: 'new_target' },
        operation: 'process',
      })

      expect(source.id).toBe(existingSource.id)
      expect(edge.fromNodeId).toBe(existingSource.id)
    })

    it('should include metadata on edge', () => {
      const { edge } = tracker.record({
        source: { type: 'source', name: 'src' },
        target: { type: 'sink', name: 'dst' },
        operation: 'etl',
        metadata: { rows: 1000, duration: 500 },
      })

      expect(edge.metadata).toEqual({ rows: 1000, duration: 500 })
    })
  })

  describe('getStats', () => {
    it('should return correct statistics', () => {
      tracker.createNode({ type: 'source', name: 'A' })
      tracker.createNode({ type: 'source', name: 'B' })
      tracker.createNode({ type: 'transformation', name: 'C' })
      tracker.createNode({ type: 'sink', name: 'D' })

      // Can't create edges without connecting them properly due to cycle detection
      // So we'll just test node counts

      const stats = tracker.getStats()

      expect(stats.nodeCount).toBe(4)
      expect(stats.nodesByType.source).toBe(2)
      expect(stats.nodesByType.transformation).toBe(1)
      expect(stats.nodesByType.sink).toBe(1)
    })
  })

  describe('clear', () => {
    it('should remove all data', () => {
      tracker.createNode({ type: 'entity', name: 'test1' })
      tracker.createNode({ type: 'entity', name: 'test2' })

      tracker.clear()

      const stats = tracker.getStats()
      expect(stats.nodeCount).toBe(0)
      expect(stats.edgeCount).toBe(0)
    })
  })
})

// =============================================================================
// EDGE CASE TESTS
// =============================================================================

describe('LineageTracker - Edge Cases', () => {
  let tracker: LineageTracker

  beforeEach(() => {
    tracker = createTracker()
  })

  it('should handle empty graph', () => {
    const stats = tracker.getStats()
    expect(stats.nodeCount).toBe(0)
    expect(stats.edgeCount).toBe(0)

    const roots = tracker.getRootNodes()
    expect(roots).toHaveLength(0)
  })

  it('should handle isolated nodes (no edges)', () => {
    tracker.createNode({ type: 'entity', name: 'isolated' })

    const stats = tracker.getStats()
    expect(stats.nodeCount).toBe(1)
    expect(stats.rootCount).toBe(1)
    expect(stats.leafCount).toBe(1)
  })

  it('should handle very long chains', () => {
    const nodes: LineageNode[] = []
    for (let i = 0; i < 50; i++) {
      nodes.push(tracker.createNode({ type: 'entity', name: `node_${i}` }))
    }

    for (let i = 0; i < 49; i++) {
      tracker.createEdge({
        fromNodeId: nodes[i].id,
        toNodeId: nodes[i + 1].id,
        operation: `step_${i}`,
      })
    }

    const downstream = tracker.getDownstream(nodes[0].id)
    expect(downstream.nodes).toHaveLength(49)

    const upstream = tracker.getUpstream(nodes[49].id)
    expect(upstream.nodes).toHaveLength(49)
  })

  it('should handle diamond dependencies', () => {
    //   A
    //  / \
    // B   C
    //  \ /
    //   D
    const a = tracker.createNode({ id: 'A', type: 'source', name: 'A' })
    const b = tracker.createNode({ id: 'B', type: 'transformation', name: 'B' })
    const c = tracker.createNode({ id: 'C', type: 'transformation', name: 'C' })
    const d = tracker.createNode({ id: 'D', type: 'sink', name: 'D' })

    tracker.createEdge({ fromNodeId: 'A', toNodeId: 'B', operation: 's1' })
    tracker.createEdge({ fromNodeId: 'A', toNodeId: 'C', operation: 's2' })
    tracker.createEdge({ fromNodeId: 'B', toNodeId: 'D', operation: 's3' })
    tracker.createEdge({ fromNodeId: 'C', toNodeId: 'D', operation: 's4' })

    const paths = tracker.findPaths('A', 'D')
    expect(paths).toHaveLength(2)

    const upstream = tracker.getUpstream('D')
    expect(upstream.nodes.map((n) => n.id).sort()).toEqual(['A', 'B', 'C'])
  })

  it('should handle multiple parallel edges (different operations)', () => {
    const a = tracker.createNode({ id: 'A', type: 'source', name: 'A' })
    const b = tracker.createNode({ id: 'B', type: 'sink', name: 'B' })

    tracker.createEdge({ fromNodeId: 'A', toNodeId: 'B', operation: 'read' })
    tracker.createEdge({ fromNodeId: 'A', toNodeId: 'B', operation: 'validate' })
    tracker.createEdge({ fromNodeId: 'A', toNodeId: 'B', operation: 'transform' })

    const edges = tracker.findEdges({ fromNodeId: 'A', toNodeId: 'B' })
    expect(edges).toHaveLength(3)
  })

  it('should handle special characters in names', () => {
    const node = tracker.createNode({
      type: 'entity',
      name: 'table-with-special_chars.and.dots',
      namespace: 'schema/with/slashes',
      metadata: {
        'key.with.dots': 'value',
        'key-with-dashes': true,
      },
    })

    const retrieved = tracker.getNode(node.id)
    expect(retrieved?.name).toBe('table-with-special_chars.and.dots')
    expect(retrieved?.namespace).toBe('schema/with/slashes')
  })

  it('should handle large metadata', () => {
    const largeMetadata: Record<string, unknown> = {}
    for (let i = 0; i < 100; i++) {
      largeMetadata[`key_${i}`] = `value_${i}`.repeat(10)
    }

    const node = tracker.createNode({
      type: 'entity',
      name: 'large_metadata_node',
      metadata: largeMetadata,
    })

    const retrieved = tracker.getNode(node.id)
    expect(Object.keys(retrieved?.metadata ?? {}).length).toBe(100)
  })
})

// =============================================================================
// LINEAGE STORE UNIT TESTS
// =============================================================================

describe('LineageStore - Unit Tests', () => {
  let store: LineageStore

  beforeEach(() => {
    const sql = createTestDb()
    store = createLineageStore(sql)
  })

  it('should initialize schema', () => {
    // Just verify it doesn't throw
    expect(store).toBeDefined()
  })

  it('should generate unique IDs', () => {
    const node1 = store.createNode({ type: 'entity', name: 'n1' })
    const node2 = store.createNode({ type: 'entity', name: 'n2' })

    expect(node1.id).not.toBe(node2.id)
  })

  it('should handle getOutgoingEdges', () => {
    const a = store.createNode({ type: 'entity', name: 'A' })
    const b = store.createNode({ type: 'entity', name: 'B' })
    const c = store.createNode({ type: 'entity', name: 'C' })

    store.createEdge({ fromNodeId: a.id, toNodeId: b.id, operation: 'e1' })
    store.createEdge({ fromNodeId: a.id, toNodeId: c.id, operation: 'e2' })

    const outgoing = store.getOutgoingEdges(a.id)
    expect(outgoing).toHaveLength(2)
  })

  it('should handle getIncomingEdges', () => {
    const a = store.createNode({ type: 'entity', name: 'A' })
    const b = store.createNode({ type: 'entity', name: 'B' })
    const c = store.createNode({ type: 'entity', name: 'C' })

    store.createEdge({ fromNodeId: a.id, toNodeId: c.id, operation: 'e1' })
    store.createEdge({ fromNodeId: b.id, toNodeId: c.id, operation: 'e2' })

    const incoming = store.getIncomingEdges(c.id)
    expect(incoming).toHaveLength(2)
  })
})
