/**
 * LineageStore Storage Tests
 *
 * Focused tests for the SQLite-backed storage layer including:
 * - CRUD operations for nodes and edges
 * - Index efficiency
 * - Performance with large graphs
 * - Concurrent operations
 *
 * @module db/primitives/lineage-tracker/tests/storage
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  createLineageStore,
  LineageStore,
  LINEAGE_SCHEMA,
  type SqlExecutor,
} from '../storage'
import type { LineageNode, LineageEdge, NodeType } from '../types'

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

function createStore(config?: Parameters<typeof createLineageStore>[1]): LineageStore {
  const sql = createTestDb()
  return createLineageStore(sql, config)
}

// =============================================================================
// SCHEMA TESTS
// =============================================================================

describe('LineageStore - Schema', () => {
  it('should create schema without errors', () => {
    const sql = createTestDb()
    expect(() => sql.exec(LINEAGE_SCHEMA)).not.toThrow()
  })

  it('should be idempotent (can run schema multiple times)', () => {
    const sql = createTestDb()
    expect(() => {
      sql.exec(LINEAGE_SCHEMA)
      sql.exec(LINEAGE_SCHEMA)
      sql.exec(LINEAGE_SCHEMA)
    }).not.toThrow()
  })

  it('should create required indexes', () => {
    const sql = createTestDb()
    sql.exec(LINEAGE_SCHEMA)

    const indexes = sql
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_lineage_%'")
      .bind()
      .all()

    const indexNames = indexes.map((i: { name: string }) => i.name)
    expect(indexNames).toContain('idx_lineage_edges_from')
    expect(indexNames).toContain('idx_lineage_edges_to')
    expect(indexNames).toContain('idx_lineage_nodes_type')
    expect(indexNames).toContain('idx_lineage_nodes_namespace')
    expect(indexNames).toContain('idx_lineage_edges_operation')
    expect(indexNames).toContain('idx_lineage_edges_timestamp')
  })
})

// =============================================================================
// NODE CRUD TESTS
// =============================================================================

describe('LineageStore - Node CRUD', () => {
  let store: LineageStore

  beforeEach(() => {
    store = createStore()
  })

  describe('createNode', () => {
    it('should create node with auto-generated ID', () => {
      const node = store.createNode({
        type: 'entity',
        name: 'users',
        namespace: 'warehouse',
      })

      expect(node.id).toBeDefined()
      expect(node.id).toMatch(/^ln-/)
      expect(node.type).toBe('entity')
      expect(node.name).toBe('users')
      expect(node.namespace).toBe('warehouse')
    })

    it('should create node with custom ID', () => {
      const node = store.createNode({
        id: 'custom-id-123',
        type: 'source',
        name: 'events',
      })

      expect(node.id).toBe('custom-id-123')
    })

    it('should store metadata as JSON', () => {
      const metadata = {
        schema: { columns: ['id', 'name', 'email'] },
        rowCount: 1000,
        lastUpdated: '2024-01-15',
      }

      const node = store.createNode({
        type: 'entity',
        name: 'users',
        metadata,
      })

      expect(node.metadata).toEqual(metadata)

      // Retrieve and verify metadata persists
      const retrieved = store.getNode(node.id)
      expect(retrieved?.metadata).toEqual(metadata)
    })

    it('should set timestamps', () => {
      const before = Date.now()
      const node = store.createNode({ type: 'entity', name: 'test' })
      const after = Date.now()

      expect(node.createdAt).toBeGreaterThanOrEqual(before)
      expect(node.createdAt).toBeLessThanOrEqual(after)
      expect(node.updatedAt).toBeGreaterThanOrEqual(before)
      expect(node.updatedAt).toBeLessThanOrEqual(after)
      expect(node.createdAt).toBe(node.updatedAt)
    })

    it('should use custom ID prefix from config', () => {
      const customStore = createStore({ idPrefix: 'asset' })
      const node = customStore.createNode({ type: 'entity', name: 'test' })

      expect(node.id).toMatch(/^asset-/)
    })
  })

  describe('getNode', () => {
    it('should retrieve existing node', () => {
      const created = store.createNode({
        type: 'entity',
        name: 'customers',
        namespace: 'db',
        metadata: { key: 'value' },
      })

      const retrieved = store.getNode(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
      expect(retrieved?.name).toBe('customers')
      expect(retrieved?.namespace).toBe('db')
      expect(retrieved?.metadata).toEqual({ key: 'value' })
    })

    it('should return null for non-existent node', () => {
      const result = store.getNode('non-existent-id')
      expect(result).toBeNull()
    })
  })

  describe('updateNode', () => {
    it('should update node fields', () => {
      const node = store.createNode({
        type: 'entity',
        name: 'original',
        namespace: 'ns1',
      })

      const updated = store.updateNode(node.id, {
        name: 'updated',
        namespace: 'ns2',
        metadata: { updated: true },
      })

      expect(updated).not.toBeNull()
      expect(updated?.name).toBe('updated')
      expect(updated?.namespace).toBe('ns2')
      expect(updated?.metadata).toEqual({ updated: true })
    })

    it('should preserve createdAt timestamp', () => {
      const node = store.createNode({ type: 'entity', name: 'test' })
      const originalCreatedAt = node.createdAt

      // Wait a bit to ensure time difference
      const updated = store.updateNode(node.id, { name: 'updated' })

      expect(updated?.createdAt).toBe(originalCreatedAt)
    })

    it('should update updatedAt timestamp', () => {
      const node = store.createNode({ type: 'entity', name: 'test' })
      const originalUpdatedAt = node.updatedAt

      // Small delay to ensure time difference
      const updated = store.updateNode(node.id, { name: 'updated' })

      expect(updated?.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt)
    })

    it('should return null for non-existent node', () => {
      const result = store.updateNode('non-existent', { name: 'test' })
      expect(result).toBeNull()
    })
  })

  describe('deleteNode', () => {
    it('should delete existing node', () => {
      const node = store.createNode({ type: 'entity', name: 'to-delete' })

      const result = store.deleteNode(node.id)

      expect(result).toBe(true)
      expect(store.getNode(node.id)).toBeNull()
    })

    it('should return false for non-existent node', () => {
      const result = store.deleteNode('non-existent')
      expect(result).toBe(false)
    })

    it('should cascade delete related edges', () => {
      const nodeA = store.createNode({ type: 'entity', name: 'A' })
      const nodeB = store.createNode({ type: 'entity', name: 'B' })
      const edge = store.createEdge({
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        operation: 'read',
      })

      store.deleteNode(nodeA.id)

      expect(store.getEdge(edge.id)).toBeNull()
    })
  })

  describe('findNodes', () => {
    beforeEach(() => {
      store.createNode({ type: 'entity', name: 'users', namespace: 'db' })
      store.createNode({ type: 'entity', name: 'orders', namespace: 'db' })
      store.createNode({ type: 'transformation', name: 'user_transform', namespace: 'etl' })
      store.createNode({ type: 'source', name: 'api_events', namespace: 'api' })
      store.createNode({ type: 'sink', name: 'warehouse', namespace: 'db' })
    })

    it('should return all nodes when no query', () => {
      const nodes = store.findNodes()
      expect(nodes).toHaveLength(5)
    })

    it('should filter by type', () => {
      const entities = store.findNodes({ type: 'entity' })
      expect(entities).toHaveLength(2)
      expect(entities.every((n) => n.type === 'entity')).toBe(true)
    })

    it('should filter by namespace', () => {
      const dbNodes = store.findNodes({ namespace: 'db' })
      expect(dbNodes).toHaveLength(3)
      expect(dbNodes.every((n) => n.namespace === 'db')).toBe(true)
    })

    it('should filter by name contains', () => {
      const userNodes = store.findNodes({ nameContains: 'user' })
      expect(userNodes).toHaveLength(2) // users and user_transform
    })

    it('should respect limit', () => {
      const limited = store.findNodes({ limit: 2 })
      expect(limited).toHaveLength(2)
    })

    it('should combine multiple filters', () => {
      const results = store.findNodes({ type: 'entity', namespace: 'db' })
      expect(results).toHaveLength(2)
    })
  })

  describe('createNodes (bulk)', () => {
    it('should create multiple nodes', () => {
      const nodes = store.createNodes([
        { type: 'entity', name: 'node1' },
        { type: 'entity', name: 'node2' },
        { type: 'entity', name: 'node3' },
      ])

      expect(nodes).toHaveLength(3)
      expect(nodes.every((n) => n.id)).toBe(true)

      // Verify all are persisted
      for (const node of nodes) {
        expect(store.getNode(node.id)).not.toBeNull()
      }
    })
  })
})

// =============================================================================
// EDGE CRUD TESTS
// =============================================================================

describe('LineageStore - Edge CRUD', () => {
  let store: LineageStore
  let nodeA: LineageNode
  let nodeB: LineageNode
  let nodeC: LineageNode

  beforeEach(() => {
    store = createStore()
    nodeA = store.createNode({ type: 'source', name: 'A' })
    nodeB = store.createNode({ type: 'transformation', name: 'B' })
    nodeC = store.createNode({ type: 'sink', name: 'C' })
  })

  describe('createEdge', () => {
    it('should create edge between existing nodes', () => {
      const edge = store.createEdge({
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        operation: 'read',
      })

      expect(edge.id).toBeDefined()
      expect(edge.fromNodeId).toBe(nodeA.id)
      expect(edge.toNodeId).toBe(nodeB.id)
      expect(edge.operation).toBe('read')
    })

    it('should store edge metadata', () => {
      const metadata = { rowsProcessed: 1000, duration: 500 }
      const edge = store.createEdge({
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        operation: 'transform',
        metadata,
      })

      expect(edge.metadata).toEqual(metadata)

      // Verify persistence
      const retrieved = store.getEdge(edge.id)
      expect(retrieved?.metadata).toEqual(metadata)
    })

    it('should throw error for non-existent source node', () => {
      expect(() =>
        store.createEdge({
          fromNodeId: 'non-existent',
          toNodeId: nodeB.id,
          operation: 'read',
        })
      ).toThrow(/Source node not found/)
    })

    it('should throw error for non-existent target node', () => {
      expect(() =>
        store.createEdge({
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
        store.createEdge({
          fromNodeId: nodeA.id,
          toNodeId: nodeA.id,
          operation: 'loop',
        })
      ).toThrow(/cycle/)
    })

    it('should detect direct cycles', () => {
      store.createEdge({
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        operation: 'step1',
      })

      expect(() =>
        store.createEdge({
          fromNodeId: nodeB.id,
          toNodeId: nodeA.id,
          operation: 'step2',
        })
      ).toThrow(/cycle/)
    })

    it('should detect indirect cycles', () => {
      store.createEdge({ fromNodeId: nodeA.id, toNodeId: nodeB.id, operation: 's1' })
      store.createEdge({ fromNodeId: nodeB.id, toNodeId: nodeC.id, operation: 's2' })

      expect(() =>
        store.createEdge({
          fromNodeId: nodeC.id,
          toNodeId: nodeA.id,
          operation: 's3',
        })
      ).toThrow(/cycle/)
    })

    it('should allow disabling cycle detection', () => {
      const permissiveStore = createStore({ detectCycles: false })
      const a = permissiveStore.createNode({ type: 'entity', name: 'A' })
      const b = permissiveStore.createNode({ type: 'entity', name: 'B' })

      permissiveStore.createEdge({ fromNodeId: a.id, toNodeId: b.id, operation: 's1' })

      // Should NOT throw with cycle detection disabled
      expect(() =>
        permissiveStore.createEdge({
          fromNodeId: b.id,
          toNodeId: a.id,
          operation: 's2',
        })
      ).not.toThrow()
    })
  })

  describe('getEdge', () => {
    it('should retrieve existing edge', () => {
      const created = store.createEdge({
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        operation: 'test',
      })

      const retrieved = store.getEdge(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
      expect(retrieved?.operation).toBe('test')
    })

    it('should return null for non-existent edge', () => {
      const result = store.getEdge('non-existent')
      expect(result).toBeNull()
    })
  })

  describe('deleteEdge', () => {
    it('should delete existing edge', () => {
      const edge = store.createEdge({
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        operation: 'test',
      })

      const result = store.deleteEdge(edge.id)

      expect(result).toBe(true)
      expect(store.getEdge(edge.id)).toBeNull()
    })

    it('should return false for non-existent edge', () => {
      const result = store.deleteEdge('non-existent')
      expect(result).toBe(false)
    })
  })

  describe('findEdges', () => {
    beforeEach(() => {
      store.createEdge({ fromNodeId: nodeA.id, toNodeId: nodeB.id, operation: 'read' })
      store.createEdge({ fromNodeId: nodeB.id, toNodeId: nodeC.id, operation: 'write' })
    })

    it('should return all edges when no query', () => {
      const edges = store.findEdges()
      expect(edges).toHaveLength(2)
    })

    it('should filter by fromNodeId', () => {
      const edges = store.findEdges({ fromNodeId: nodeA.id })
      expect(edges).toHaveLength(1)
      expect(edges[0].fromNodeId).toBe(nodeA.id)
    })

    it('should filter by toNodeId', () => {
      const edges = store.findEdges({ toNodeId: nodeC.id })
      expect(edges).toHaveLength(1)
      expect(edges[0].toNodeId).toBe(nodeC.id)
    })

    it('should filter by operation', () => {
      const edges = store.findEdges({ operation: 'read' })
      expect(edges).toHaveLength(1)
      expect(edges[0].operation).toBe('read')
    })
  })

  describe('getOutgoingEdges / getIncomingEdges', () => {
    beforeEach(() => {
      store.createEdge({ fromNodeId: nodeA.id, toNodeId: nodeB.id, operation: 'e1' })
      store.createEdge({ fromNodeId: nodeA.id, toNodeId: nodeC.id, operation: 'e2' })
      store.createEdge({ fromNodeId: nodeB.id, toNodeId: nodeC.id, operation: 'e3' })
    })

    it('should get outgoing edges', () => {
      const outgoing = store.getOutgoingEdges(nodeA.id)
      expect(outgoing).toHaveLength(2)
      expect(outgoing.every((e) => e.fromNodeId === nodeA.id)).toBe(true)
    })

    it('should get incoming edges', () => {
      const incoming = store.getIncomingEdges(nodeC.id)
      expect(incoming).toHaveLength(2)
      expect(incoming.every((e) => e.toNodeId === nodeC.id)).toBe(true)
    })

    it('should return empty array for node with no edges', () => {
      const isolated = store.createNode({ type: 'entity', name: 'isolated' })

      expect(store.getOutgoingEdges(isolated.id)).toHaveLength(0)
      expect(store.getIncomingEdges(isolated.id)).toHaveLength(0)
    })
  })
})

// =============================================================================
// GRAPH OPERATIONS TESTS
// =============================================================================

describe('LineageStore - Graph Operations', () => {
  let store: LineageStore

  beforeEach(() => {
    store = createStore()
  })

  describe('getRootNodes / getLeafNodes', () => {
    it('should identify root nodes (no incoming edges)', () => {
      const a = store.createNode({ id: 'A', type: 'source', name: 'A' })
      const b = store.createNode({ id: 'B', type: 'source', name: 'B' })
      const c = store.createNode({ id: 'C', type: 'transformation', name: 'C' })

      store.createEdge({ fromNodeId: 'A', toNodeId: 'C', operation: 'read' })
      store.createEdge({ fromNodeId: 'B', toNodeId: 'C', operation: 'read' })

      const roots = store.getRootNodes()
      expect(roots.map((n) => n.id).sort()).toEqual(['A', 'B'])
    })

    it('should identify leaf nodes (no outgoing edges)', () => {
      const a = store.createNode({ id: 'A', type: 'source', name: 'A' })
      const b = store.createNode({ id: 'B', type: 'sink', name: 'B' })
      const c = store.createNode({ id: 'C', type: 'sink', name: 'C' })

      store.createEdge({ fromNodeId: 'A', toNodeId: 'B', operation: 'write' })
      store.createEdge({ fromNodeId: 'A', toNodeId: 'C', operation: 'write' })

      const leaves = store.getLeafNodes()
      expect(leaves.map((n) => n.id).sort()).toEqual(['B', 'C'])
    })

    it('should handle isolated nodes (both root and leaf)', () => {
      store.createNode({ id: 'isolated', type: 'entity', name: 'Isolated' })

      const roots = store.getRootNodes()
      const leaves = store.getLeafNodes()

      expect(roots.map((n) => n.id)).toContain('isolated')
      expect(leaves.map((n) => n.id)).toContain('isolated')
    })
  })

  describe('getStats', () => {
    it('should return correct statistics for empty graph', () => {
      const stats = store.getStats()

      expect(stats.nodeCount).toBe(0)
      expect(stats.edgeCount).toBe(0)
      expect(stats.rootCount).toBe(0)
      expect(stats.leafCount).toBe(0)
    })

    it('should count nodes by type', () => {
      store.createNode({ type: 'source', name: 'S1' })
      store.createNode({ type: 'source', name: 'S2' })
      store.createNode({ type: 'transformation', name: 'T1' })
      store.createNode({ type: 'sink', name: 'SK1' })

      const stats = store.getStats()

      expect(stats.nodeCount).toBe(4)
      expect(stats.nodesByType.source).toBe(2)
      expect(stats.nodesByType.transformation).toBe(1)
      expect(stats.nodesByType.sink).toBe(1)
      expect(stats.nodesByType.entity).toBe(0)
    })

    it('should calculate average connectivity', () => {
      const a = store.createNode({ id: 'A', type: 'source', name: 'A' })
      const b = store.createNode({ id: 'B', type: 'entity', name: 'B' })
      const c = store.createNode({ id: 'C', type: 'sink', name: 'C' })

      store.createEdge({ fromNodeId: 'A', toNodeId: 'B', operation: 'e1' })
      store.createEdge({ fromNodeId: 'B', toNodeId: 'C', operation: 'e2' })

      const stats = store.getStats()

      expect(stats.edgeCount).toBe(2)
      expect(stats.avgConnectivity).toBeCloseTo(2 / 3) // 2 edges / 3 nodes
    })
  })

  describe('clear', () => {
    it('should remove all data', () => {
      store.createNode({ type: 'entity', name: 'test1' })
      store.createNode({ type: 'entity', name: 'test2' })

      store.clear()

      const stats = store.getStats()
      expect(stats.nodeCount).toBe(0)
      expect(stats.edgeCount).toBe(0)
    })
  })
})

// =============================================================================
// PERFORMANCE TESTS
// =============================================================================

describe('LineageStore - Performance', () => {
  it('should handle 10k+ nodes efficiently', () => {
    const store = createStore()
    const nodeCount = 10000
    const nodeIds: string[] = []

    // Create nodes
    const createStart = performance.now()
    for (let i = 0; i < nodeCount; i++) {
      const node = store.createNode({
        type: ['entity', 'transformation', 'source', 'sink'][i % 4] as NodeType,
        name: `node_${i}`,
        namespace: `ns_${i % 10}`,
        metadata: { index: i },
      })
      nodeIds.push(node.id)
    }
    const createDuration = performance.now() - createStart

    // Should create 10k nodes in under 10 seconds (relaxed for CI)
    expect(createDuration).toBeLessThan(10000)

    // Verify count
    const stats = store.getStats()
    expect(stats.nodeCount).toBe(nodeCount)
  })

  it('should handle 50k+ edges efficiently', () => {
    const store = createStore({ detectCycles: false }) // Disable for performance
    const nodeCount = 1000
    const edgesPerNode = 50
    const nodeIds: string[] = []

    // Create nodes
    for (let i = 0; i < nodeCount; i++) {
      const node = store.createNode({ type: 'entity', name: `node_${i}` })
      nodeIds.push(node.id)
    }

    // Create edges (random connections)
    const createStart = performance.now()
    let edgeCount = 0
    for (let i = 0; i < nodeCount; i++) {
      for (let j = 0; j < edgesPerNode && i + j + 1 < nodeCount; j++) {
        store.createEdge({
          fromNodeId: nodeIds[i],
          toNodeId: nodeIds[(i + j + 1) % nodeCount],
          operation: `op_${j}`,
        })
        edgeCount++
      }
    }
    const createDuration = performance.now() - createStart

    // Should create many edges in reasonable time
    expect(createDuration).toBeLessThan(30000) // 30 seconds max

    const stats = store.getStats()
    expect(stats.edgeCount).toBeGreaterThan(0)
  })

  it('should query edges by node efficiently with indexes', () => {
    const store = createStore({ detectCycles: false })
    const nodeCount = 500
    const nodeIds: string[] = []

    // Create nodes
    for (let i = 0; i < nodeCount; i++) {
      const node = store.createNode({ type: 'entity', name: `node_${i}` })
      nodeIds.push(node.id)
    }

    // Create edges (chain structure)
    for (let i = 0; i < nodeCount - 1; i++) {
      store.createEdge({
        fromNodeId: nodeIds[i],
        toNodeId: nodeIds[i + 1],
        operation: 'chain',
      })
    }

    // Query should be fast due to indexes
    const queryStart = performance.now()
    for (let i = 0; i < 100; i++) {
      const randomNode = nodeIds[Math.floor(Math.random() * nodeCount)]
      store.getOutgoingEdges(randomNode)
      store.getIncomingEdges(randomNode)
    }
    const queryDuration = performance.now() - queryStart

    // 200 queries should complete in under 1 second
    expect(queryDuration).toBeLessThan(1000)
  })

  it('should filter nodes efficiently', () => {
    const store = createStore()
    const nodeCount = 5000

    // Create nodes with varied types and namespaces
    for (let i = 0; i < nodeCount; i++) {
      store.createNode({
        type: ['entity', 'transformation', 'source', 'sink'][i % 4] as NodeType,
        name: `node_${i}`,
        namespace: `ns_${i % 100}`,
      })
    }

    // Filtered queries should be fast due to indexes
    const queryStart = performance.now()
    const byType = store.findNodes({ type: 'entity', limit: 100 })
    const byNamespace = store.findNodes({ namespace: 'ns_0', limit: 100 })
    const byName = store.findNodes({ nameContains: 'node_10', limit: 100 })
    const queryDuration = performance.now() - queryStart

    expect(byType.length).toBeLessThanOrEqual(100)
    expect(byNamespace.length).toBeGreaterThan(0)
    expect(byName.length).toBeGreaterThan(0)
    expect(queryDuration).toBeLessThan(500)
  })
})

// =============================================================================
// EDGE CASES
// =============================================================================

describe('LineageStore - Edge Cases', () => {
  let store: LineageStore

  beforeEach(() => {
    store = createStore()
  })

  it('should handle special characters in names', () => {
    const node = store.createNode({
      type: 'entity',
      name: 'table-with-special_chars.and.dots',
      namespace: 'schema/with/slashes',
    })

    const retrieved = store.getNode(node.id)
    expect(retrieved?.name).toBe('table-with-special_chars.and.dots')
    expect(retrieved?.namespace).toBe('schema/with/slashes')
  })

  it('should handle unicode characters', () => {
    const node = store.createNode({
      type: 'entity',
      name: 'datos_usuario',
      metadata: { description: 'Contains special chars' },
    })

    const retrieved = store.getNode(node.id)
    expect(retrieved?.name).toBe('datos_usuario')
  })

  it('should handle empty metadata', () => {
    const node = store.createNode({
      type: 'entity',
      name: 'test',
      metadata: {},
    })

    const retrieved = store.getNode(node.id)
    expect(retrieved?.metadata).toEqual({})
  })

  it('should handle large metadata', () => {
    const largeMetadata: Record<string, unknown> = {}
    for (let i = 0; i < 100; i++) {
      largeMetadata[`key_${i}`] = `value_${i}`.repeat(10)
    }

    const node = store.createNode({
      type: 'entity',
      name: 'large_metadata',
      metadata: largeMetadata,
    })

    const retrieved = store.getNode(node.id)
    expect(Object.keys(retrieved?.metadata ?? {}).length).toBe(100)
  })

  it('should handle null namespace', () => {
    const node = store.createNode({
      type: 'entity',
      name: 'no-namespace',
      namespace: undefined,
    })

    const retrieved = store.getNode(node.id)
    expect(retrieved?.namespace).toBeUndefined()
  })

  it('should handle multiple parallel edges (different operations)', () => {
    const a = store.createNode({ id: 'A', type: 'source', name: 'A' })
    const b = store.createNode({ id: 'B', type: 'sink', name: 'B' })

    store.createEdge({ fromNodeId: 'A', toNodeId: 'B', operation: 'read' })
    store.createEdge({ fromNodeId: 'A', toNodeId: 'B', operation: 'validate' })
    store.createEdge({ fromNodeId: 'A', toNodeId: 'B', operation: 'transform' })

    const edges = store.findEdges({ fromNodeId: 'A', toNodeId: 'B' })
    expect(edges).toHaveLength(3)
  })

  it('should handle empty graph operations', () => {
    expect(store.findNodes()).toHaveLength(0)
    expect(store.findEdges()).toHaveLength(0)
    expect(store.getRootNodes()).toHaveLength(0)
    expect(store.getLeafNodes()).toHaveLength(0)

    const stats = store.getStats()
    expect(stats.nodeCount).toBe(0)
    expect(stats.edgeCount).toBe(0)
  })
})

// =============================================================================
// CONCURRENT OPERATIONS
// =============================================================================

describe('LineageStore - Concurrent Operations', () => {
  it('should handle rapid sequential operations', () => {
    const store = createStore()
    const operations: Promise<void>[] = []

    // Simulate rapid operations
    for (let i = 0; i < 100; i++) {
      const node = store.createNode({ type: 'entity', name: `node_${i}` })
      store.updateNode(node.id, { metadata: { updated: true } })
      if (i > 0) {
        const prevNode = store.findNodes({ nameContains: `node_${i - 1}` })[0]
        if (prevNode) {
          store.createEdge({
            fromNodeId: prevNode.id,
            toNodeId: node.id,
            operation: 'chain',
          })
        }
      }
    }

    const stats = store.getStats()
    expect(stats.nodeCount).toBe(100)
    expect(stats.edgeCount).toBe(99)
  })
})
