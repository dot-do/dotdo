/**
 * Time-Travel Tests - Query Historical Lineage State
 *
 * Tests for:
 * - Point-in-time lineage reconstruction
 * - Lineage history and audit trails
 * - Diff calculations between timestamps
 * - Event replay correctness
 *
 * @module db/primitives/lineage-tracker/tests/time-travel
 */

import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  TimeTravelStore,
  createTimeTravelStore,
  TIME_TRAVEL_SCHEMA,
  type LineageEvent,
  type LineageDiff,
} from '../time-travel'
import type { LineageNode, LineageEdge, NodeType } from '../types'
import type { SqlExecutor } from '../storage'

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

function createStore(config?: Parameters<typeof createTimeTravelStore>[1]): TimeTravelStore {
  const sql = createTestDb()
  return createTimeTravelStore(sql, config)
}

/**
 * Helper to create a mock node
 */
function mockNode(overrides: Partial<LineageNode> = {}): LineageNode {
  const now = Date.now()
  return {
    id: `node-${Math.random().toString(36).substring(2, 8)}`,
    type: 'entity',
    name: 'test-node',
    namespace: 'test',
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

/**
 * Helper to create a mock edge
 */
function mockEdge(overrides: Partial<LineageEdge> = {}): LineageEdge {
  return {
    id: `edge-${Math.random().toString(36).substring(2, 8)}`,
    fromNodeId: 'from-node',
    toNodeId: 'to-node',
    operation: 'read',
    metadata: {},
    timestamp: Date.now(),
    ...overrides,
  }
}

/**
 * Helper to advance time in tests
 */
function advanceTime(ms: number): number {
  const newTime = Date.now() + ms
  // Note: In a real implementation, you might need to mock Date.now()
  // For these tests, we use explicit timestamps
  return newTime
}

// =============================================================================
// SCHEMA TESTS
// =============================================================================

describe('TimeTravelStore - Schema', () => {
  it('should create schema without errors', () => {
    const sql = createTestDb()
    expect(() => sql.exec(TIME_TRAVEL_SCHEMA)).not.toThrow()
  })

  it('should be idempotent (can run schema multiple times)', () => {
    const sql = createTestDb()
    expect(() => {
      sql.exec(TIME_TRAVEL_SCHEMA)
      sql.exec(TIME_TRAVEL_SCHEMA)
      sql.exec(TIME_TRAVEL_SCHEMA)
    }).not.toThrow()
  })

  it('should create required indexes', () => {
    const sql = createTestDb()
    sql.exec(TIME_TRAVEL_SCHEMA)

    const indexes = sql
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_lineage_events_%'")
      .bind()
      .all()

    const indexNames = indexes.map((i: { name: string }) => i.name)
    expect(indexNames).toContain('idx_lineage_events_timestamp')
    expect(indexNames).toContain('idx_lineage_events_entity')
    expect(indexNames).toContain('idx_lineage_events_type')
    expect(indexNames).toContain('idx_lineage_events_ts_entity')
  })
})

// =============================================================================
// EVENT RECORDING TESTS
// =============================================================================

describe('TimeTravelStore - Event Recording', () => {
  let store: TimeTravelStore

  beforeEach(() => {
    store = createStore()
  })

  describe('recordNodeCreated', () => {
    it('should record node creation event', () => {
      const node = mockNode({ id: 'test-node-1', name: 'Users Table' })
      const event = store.recordNodeCreated(node)

      expect(event.id).toBeDefined()
      expect(event.type).toBe('node_created')
      expect(event.entityId).toBe('test-node-1')
      expect(event.entityType).toBe('node')
      expect(event.timestamp).toBe(node.createdAt)
      expect(event.snapshot).toMatchObject({
        id: 'test-node-1',
        name: 'Users Table',
      })
      expect(event.previousState).toBeNull()
    })

    it('should record actor and reason', () => {
      const node = mockNode()
      const event = store.recordNodeCreated(node, 'admin@example.com', 'Initial schema import')

      expect(event.actor).toBe('admin@example.com')
      expect(event.reason).toBe('Initial schema import')
    })
  })

  describe('recordNodeUpdated', () => {
    it('should record node update with previous state', () => {
      const oldNode = mockNode({ id: 'node-1', name: 'Old Name', updatedAt: 1000 })
      const newNode = mockNode({ id: 'node-1', name: 'New Name', updatedAt: 2000 })

      const event = store.recordNodeUpdated(oldNode, newNode)

      expect(event.type).toBe('node_updated')
      expect(event.entityId).toBe('node-1')
      expect(event.snapshot).toMatchObject({ name: 'New Name' })
      expect(event.previousState).toMatchObject({ name: 'Old Name' })
      expect(event.timestamp).toBe(2000)
    })

    it('should track metadata changes', () => {
      const oldNode = mockNode({
        id: 'node-1',
        metadata: { version: 1 },
        updatedAt: 1000,
      })
      const newNode = mockNode({
        id: 'node-1',
        metadata: { version: 2, schema: 'updated' },
        updatedAt: 2000,
      })

      const event = store.recordNodeUpdated(oldNode, newNode)

      expect(event.snapshot?.metadata).toEqual({ version: 2, schema: 'updated' })
      expect(event.previousState?.metadata).toEqual({ version: 1 })
    })
  })

  describe('recordNodeDeleted', () => {
    it('should record node deletion with previous state', () => {
      const node = mockNode({ id: 'deleted-node', name: 'To Be Deleted' })

      const event = store.recordNodeDeleted(node)

      expect(event.type).toBe('node_deleted')
      expect(event.entityId).toBe('deleted-node')
      expect(event.snapshot).toBeNull()
      expect(event.previousState).toMatchObject({
        id: 'deleted-node',
        name: 'To Be Deleted',
      })
    })
  })

  describe('recordEdgeCreated', () => {
    it('should record edge creation event', () => {
      const edge = mockEdge({
        id: 'edge-1',
        fromNodeId: 'source',
        toNodeId: 'target',
        operation: 'transform',
      })

      const event = store.recordEdgeCreated(edge)

      expect(event.type).toBe('edge_created')
      expect(event.entityId).toBe('edge-1')
      expect(event.entityType).toBe('edge')
      expect(event.snapshot).toMatchObject({
        fromNodeId: 'source',
        toNodeId: 'target',
        operation: 'transform',
      })
    })
  })

  describe('recordEdgeDeleted', () => {
    it('should record edge deletion with previous state', () => {
      const edge = mockEdge({ id: 'deleted-edge' })

      const event = store.recordEdgeDeleted(edge)

      expect(event.type).toBe('edge_deleted')
      expect(event.entityId).toBe('deleted-edge')
      expect(event.snapshot).toBeNull()
      expect(event.previousState).toMatchObject({ id: 'deleted-edge' })
    })
  })

  describe('config options', () => {
    it('should respect trackPreviousState=false', () => {
      const store = createStore({ trackPreviousState: false })
      const oldNode = mockNode({ name: 'Old' })
      const newNode = mockNode({ name: 'New' })

      const event = store.recordNodeUpdated(oldNode, newNode)

      expect(event.previousState).toBeNull()
    })

    it('should use custom id prefix', () => {
      const store = createStore({ idPrefix: 'audit' })
      const node = mockNode()

      const event = store.recordNodeCreated(node)

      expect(event.id).toMatch(/^audit-/)
    })
  })
})

// =============================================================================
// POINT-IN-TIME QUERY TESTS
// =============================================================================

describe('TimeTravelStore - Point-in-Time Queries', () => {
  let store: TimeTravelStore

  beforeEach(() => {
    store = createStore()
  })

  describe('getNodeAt', () => {
    it('should return null for node that did not exist at timestamp', () => {
      const node = mockNode({ id: 'node-1', createdAt: 2000 })
      store.recordNodeCreated(node)

      // Query before node was created
      const result = store.getNodeAt('node-1', 1000)
      expect(result).toBeNull()
    })

    it('should return node state at creation time', () => {
      const node = mockNode({
        id: 'node-1',
        name: 'Initial Name',
        createdAt: 1000,
        updatedAt: 1000,
      })
      store.recordNodeCreated(node)

      const result = store.getNodeAt('node-1', 1500)

      expect(result).not.toBeNull()
      expect(result?.name).toBe('Initial Name')
    })

    it('should return updated state after update', () => {
      const node1 = mockNode({
        id: 'node-1',
        name: 'Version 1',
        createdAt: 1000,
        updatedAt: 1000,
      })
      const node2 = mockNode({
        id: 'node-1',
        name: 'Version 2',
        createdAt: 1000,
        updatedAt: 2000,
      })

      store.recordNodeCreated(node1)
      store.recordNodeUpdated(node1, node2)

      // Query between creation and update
      const beforeUpdate = store.getNodeAt('node-1', 1500)
      expect(beforeUpdate?.name).toBe('Version 1')

      // Query after update
      const afterUpdate = store.getNodeAt('node-1', 2500)
      expect(afterUpdate?.name).toBe('Version 2')
    })

    it('should return null after node deletion', () => {
      const node = mockNode({ id: 'node-1', createdAt: 1000, updatedAt: 1000 })
      store.recordNodeCreated(node)

      // Record deletion at time 2000 (mocked by manipulating the event directly)
      const deletedEvent = store.recordNodeDeleted(node)
      // Update the timestamp in the database to simulate deletion at 2000
      // For this test, we'll query at different times

      // Since recordNodeDeleted uses Date.now(), let's check the flow differently
      // The node exists before the deletion event
      const beforeDelete = store.getNodeAt('node-1', node.createdAt + 500)
      expect(beforeDelete).not.toBeNull()

      // After deletion, the node should be null
      const afterDelete = store.getNodeAt('node-1', Date.now() + 1000)
      expect(afterDelete).toBeNull()
    })

    it('should handle multiple updates correctly', () => {
      const t1 = 1000
      const t2 = 2000
      const t3 = 3000
      const t4 = 4000

      const v1 = mockNode({ id: 'node-1', name: 'v1', createdAt: t1, updatedAt: t1 })
      const v2 = mockNode({ id: 'node-1', name: 'v2', createdAt: t1, updatedAt: t2 })
      const v3 = mockNode({ id: 'node-1', name: 'v3', createdAt: t1, updatedAt: t3 })

      store.recordNodeCreated(v1)
      store.recordNodeUpdated(v1, v2)
      store.recordNodeUpdated(v2, v3)

      expect(store.getNodeAt('node-1', t1 + 500)?.name).toBe('v1')
      expect(store.getNodeAt('node-1', t2 + 500)?.name).toBe('v2')
      expect(store.getNodeAt('node-1', t3 + 500)?.name).toBe('v3')
    })
  })

  describe('getEdgeAt', () => {
    it('should return null for edge that did not exist at timestamp', () => {
      const edge = mockEdge({ id: 'edge-1', timestamp: 2000 })
      store.recordEdgeCreated(edge)

      const result = store.getEdgeAt('edge-1', 1000)
      expect(result).toBeNull()
    })

    it('should return edge state after creation', () => {
      const edge = mockEdge({
        id: 'edge-1',
        fromNodeId: 'A',
        toNodeId: 'B',
        operation: 'transform',
        timestamp: 1000,
      })
      store.recordEdgeCreated(edge)

      const result = store.getEdgeAt('edge-1', 1500)

      expect(result).not.toBeNull()
      expect(result?.fromNodeId).toBe('A')
      expect(result?.toNodeId).toBe('B')
      expect(result?.operation).toBe('transform')
    })

    it('should return null after edge deletion', () => {
      const edge = mockEdge({ id: 'edge-1', timestamp: 1000 })
      store.recordEdgeCreated(edge)
      store.recordEdgeDeleted(edge)

      const afterDelete = store.getEdgeAt('edge-1', Date.now() + 1000)
      expect(afterDelete).toBeNull()
    })
  })

  describe('getNodesAt', () => {
    it('should return empty array when no nodes exist', () => {
      const result = store.getNodesAt(Date.now())
      expect(result).toEqual([])
    })

    it('should return all nodes that existed at timestamp', () => {
      const node1 = mockNode({ id: 'node-1', createdAt: 1000, updatedAt: 1000 })
      const node2 = mockNode({ id: 'node-2', createdAt: 1500, updatedAt: 1500 })
      const node3 = mockNode({ id: 'node-3', createdAt: 3000, updatedAt: 3000 })

      store.recordNodeCreated(node1)
      store.recordNodeCreated(node2)
      store.recordNodeCreated(node3)

      // At time 2000, only node1 and node2 existed
      const result = store.getNodesAt(2000)

      expect(result).toHaveLength(2)
      expect(result.map((n) => n.id).sort()).toEqual(['node-1', 'node-2'])
    })

    it('should exclude deleted nodes', () => {
      const node1 = mockNode({ id: 'node-1', createdAt: 1000, updatedAt: 1000 })
      const node2 = mockNode({ id: 'node-2', createdAt: 1000, updatedAt: 1000 })

      store.recordNodeCreated(node1)
      store.recordNodeCreated(node2)
      store.recordNodeDeleted(node1)

      // After deletion, only node2 should exist
      const result = store.getNodesAt(Date.now() + 1000)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('node-2')
    })

    it('should filter by node type', () => {
      const entity = mockNode({ id: 'entity-1', type: 'entity', createdAt: 1000, updatedAt: 1000 })
      const source = mockNode({ id: 'source-1', type: 'source', createdAt: 1000, updatedAt: 1000 })
      const transform = mockNode({ id: 'transform-1', type: 'transformation', createdAt: 1000, updatedAt: 1000 })

      store.recordNodeCreated(entity)
      store.recordNodeCreated(source)
      store.recordNodeCreated(transform)

      const result = store.getNodesAt(2000, { nodeTypes: ['entity', 'source'] })

      expect(result).toHaveLength(2)
      expect(result.map((n) => n.type).sort()).toEqual(['entity', 'source'])
    })
  })

  describe('getEdgesAt', () => {
    it('should return all edges that existed at timestamp', () => {
      const edge1 = mockEdge({ id: 'edge-1', timestamp: 1000 })
      const edge2 = mockEdge({ id: 'edge-2', timestamp: 1500 })
      const edge3 = mockEdge({ id: 'edge-3', timestamp: 3000 })

      store.recordEdgeCreated(edge1)
      store.recordEdgeCreated(edge2)
      store.recordEdgeCreated(edge3)

      const result = store.getEdgesAt(2000)

      expect(result).toHaveLength(2)
      expect(result.map((e) => e.id).sort()).toEqual(['edge-1', 'edge-2'])
    })
  })

  describe('getLineageAt', () => {
    it('should return empty graph for non-existent asset', () => {
      const result = store.getLineageAt('non-existent', Date.now())

      expect(result.nodes).toEqual([])
      expect(result.edges).toEqual([])
      expect(result.rootId).toBe('non-existent')
    })

    it('should return connected lineage graph at point in time', () => {
      // Create a simple lineage: A -> B -> C
      const nodeA = mockNode({ id: 'A', type: 'source', createdAt: 1000, updatedAt: 1000 })
      const nodeB = mockNode({ id: 'B', type: 'transformation', createdAt: 1000, updatedAt: 1000 })
      const nodeC = mockNode({ id: 'C', type: 'sink', createdAt: 1000, updatedAt: 1000 })
      const edgeAB = mockEdge({ id: 'AB', fromNodeId: 'A', toNodeId: 'B', timestamp: 1000 })
      const edgeBC = mockEdge({ id: 'BC', fromNodeId: 'B', toNodeId: 'C', timestamp: 1000 })

      store.recordNodeCreated(nodeA)
      store.recordNodeCreated(nodeB)
      store.recordNodeCreated(nodeC)
      store.recordEdgeCreated(edgeAB)
      store.recordEdgeCreated(edgeBC)

      // Get lineage for B at time 2000
      const result = store.getLineageAt('B', 2000)

      expect(result.nodes).toHaveLength(3)
      expect(result.nodes.map((n) => n.id).sort()).toEqual(['A', 'B', 'C'])
      expect(result.edges).toHaveLength(2)
      expect(result.rootId).toBe('B')
    })

    it('should reflect historical state before edge was added', () => {
      // Create nodes first
      const nodeA = mockNode({ id: 'A', createdAt: 1000, updatedAt: 1000 })
      const nodeB = mockNode({ id: 'B', createdAt: 1000, updatedAt: 1000 })

      store.recordNodeCreated(nodeA)
      store.recordNodeCreated(nodeB)

      // Edge added later at time 3000
      const edge = mockEdge({ id: 'AB', fromNodeId: 'A', toNodeId: 'B', timestamp: 3000 })
      store.recordEdgeCreated(edge)

      // Before edge was created, lineage of B should only include B
      const beforeEdge = store.getLineageAt('B', 2000)
      expect(beforeEdge.nodes).toHaveLength(1)
      expect(beforeEdge.nodes[0].id).toBe('B')
      expect(beforeEdge.edges).toHaveLength(0)

      // After edge was created, lineage of B should include A
      const afterEdge = store.getLineageAt('B', 4000)
      expect(afterEdge.nodes).toHaveLength(2)
      expect(afterEdge.nodes.map((n) => n.id).sort()).toEqual(['A', 'B'])
      expect(afterEdge.edges).toHaveLength(1)
    })

    it('should handle complex graph with multiple branches', () => {
      //     A    B
      //      \  /
      //       C
      //      / \
      //     D   E

      const t = 1000
      store.recordNodeCreated(mockNode({ id: 'A', createdAt: t, updatedAt: t }))
      store.recordNodeCreated(mockNode({ id: 'B', createdAt: t, updatedAt: t }))
      store.recordNodeCreated(mockNode({ id: 'C', createdAt: t, updatedAt: t }))
      store.recordNodeCreated(mockNode({ id: 'D', createdAt: t, updatedAt: t }))
      store.recordNodeCreated(mockNode({ id: 'E', createdAt: t, updatedAt: t }))

      store.recordEdgeCreated(mockEdge({ id: 'AC', fromNodeId: 'A', toNodeId: 'C', timestamp: t }))
      store.recordEdgeCreated(mockEdge({ id: 'BC', fromNodeId: 'B', toNodeId: 'C', timestamp: t }))
      store.recordEdgeCreated(mockEdge({ id: 'CD', fromNodeId: 'C', toNodeId: 'D', timestamp: t }))
      store.recordEdgeCreated(mockEdge({ id: 'CE', fromNodeId: 'C', toNodeId: 'E', timestamp: t }))

      const lineage = store.getLineageAt('C', t + 1000)

      expect(lineage.nodes).toHaveLength(5)
      expect(lineage.edges).toHaveLength(4)
    })
  })
})

// =============================================================================
// HISTORY QUERY TESTS
// =============================================================================

describe('TimeTravelStore - History Queries', () => {
  let store: TimeTravelStore

  beforeEach(() => {
    store = createStore()
  })

  describe('getEntityHistory', () => {
    it('should return empty array for entity with no history', () => {
      const result = store.getEntityHistory('non-existent', 0, Date.now())
      expect(result).toEqual([])
    })

    it('should return chronological history for an entity', () => {
      const node = mockNode({ id: 'node-1', name: 'v1', createdAt: 1000, updatedAt: 1000 })
      store.recordNodeCreated(node)

      const updated1 = { ...node, name: 'v2', updatedAt: 2000 }
      store.recordNodeUpdated(node, updated1)

      const updated2 = { ...updated1, name: 'v3', updatedAt: 3000 }
      store.recordNodeUpdated(updated1, updated2)

      const history = store.getEntityHistory('node-1', 0, 5000)

      expect(history).toHaveLength(3)
      expect(history[0].type).toBe('node_created')
      expect(history[1].type).toBe('node_updated')
      expect(history[2].type).toBe('node_updated')
      expect(history[0].timestamp).toBeLessThan(history[1].timestamp)
      expect(history[1].timestamp).toBeLessThan(history[2].timestamp)
    })

    it('should filter by time range', () => {
      const node = mockNode({ id: 'node-1', createdAt: 1000, updatedAt: 1000 })
      store.recordNodeCreated(node)

      const v2 = { ...node, name: 'v2', updatedAt: 2000 }
      store.recordNodeUpdated(node, v2)

      const v3 = { ...v2, name: 'v3', updatedAt: 3000 }
      store.recordNodeUpdated(v2, v3)

      const v4 = { ...v3, name: 'v4', updatedAt: 4000 }
      store.recordNodeUpdated(v3, v4)

      // Only get events between 1500 and 3500
      const history = store.getEntityHistory('node-1', 1500, 3500)

      expect(history).toHaveLength(2)
      expect(history.every((e) => e.timestamp >= 1500 && e.timestamp <= 3500)).toBe(true)
    })

    it('should respect limit option', () => {
      const node = mockNode({ id: 'node-1', createdAt: 1000, updatedAt: 1000 })
      store.recordNodeCreated(node)

      for (let i = 2; i <= 10; i++) {
        const prev = { ...node, updatedAt: (i - 1) * 1000 }
        const next = { ...node, name: `v${i}`, updatedAt: i * 1000 }
        store.recordNodeUpdated(prev, next)
      }

      const limited = store.getEntityHistory('node-1', 0, 20000, { limit: 3 })

      expect(limited).toHaveLength(3)
    })
  })

  describe('getLineageHistory', () => {
    it('should return all events affecting connected lineage', () => {
      // Create simple lineage A -> B
      const nodeA = mockNode({ id: 'A', createdAt: 1000, updatedAt: 1000 })
      const nodeB = mockNode({ id: 'B', createdAt: 2000, updatedAt: 2000 })
      const edge = mockEdge({ id: 'AB', fromNodeId: 'A', toNodeId: 'B', timestamp: 3000 })

      store.recordNodeCreated(nodeA)
      store.recordNodeCreated(nodeB)
      store.recordEdgeCreated(edge)

      const history = store.getLineageHistory('B', 0, 5000)

      // Should include: A created, B created, edge created
      expect(history.length).toBeGreaterThanOrEqual(2)
      expect(history.some((e) => e.entityId === 'A')).toBe(true)
      expect(history.some((e) => e.entityId === 'B')).toBe(true)
    })
  })

  describe('getAllEvents', () => {
    it('should return all events in time range', () => {
      const node1 = mockNode({ id: 'node-1', createdAt: 1000, updatedAt: 1000 })
      const node2 = mockNode({ id: 'node-2', createdAt: 2000, updatedAt: 2000 })
      const edge = mockEdge({ id: 'edge-1', timestamp: 3000 })

      store.recordNodeCreated(node1)
      store.recordNodeCreated(node2)
      store.recordEdgeCreated(edge)

      const allEvents = store.getAllEvents(0, 5000)

      expect(allEvents).toHaveLength(3)
    })
  })
})

// =============================================================================
// DIFF QUERY TESTS
// =============================================================================

describe('TimeTravelStore - Diff Queries', () => {
  let store: TimeTravelStore

  beforeEach(() => {
    store = createStore()
  })

  describe('diffLineage', () => {
    it('should detect added nodes', () => {
      const node1 = mockNode({ id: 'node-1', createdAt: 1000, updatedAt: 1000 })
      const node2 = mockNode({ id: 'node-2', createdAt: 3000, updatedAt: 3000 })

      store.recordNodeCreated(node1)
      store.recordNodeCreated(node2)

      const diff = store.diffLineage(2000, 4000)

      expect(diff.nodesAdded).toHaveLength(1)
      expect(diff.nodesAdded[0].id).toBe('node-2')
      expect(diff.nodesRemoved).toHaveLength(0)
      expect(diff.summary.nodesAddedCount).toBe(1)
    })

    it('should detect removed nodes', () => {
      const node = mockNode({ id: 'node-1', createdAt: 1000, updatedAt: 1000 })

      store.recordNodeCreated(node)
      store.recordNodeDeleted(node)

      const diff = store.diffLineage(1500, Date.now() + 1000)

      expect(diff.nodesRemoved).toHaveLength(1)
      expect(diff.nodesRemoved[0].id).toBe('node-1')
      expect(diff.summary.nodesRemovedCount).toBe(1)
    })

    it('should detect modified nodes', () => {
      const node1 = mockNode({
        id: 'node-1',
        name: 'Original',
        createdAt: 1000,
        updatedAt: 1000,
      })
      const node2 = mockNode({
        id: 'node-1',
        name: 'Modified',
        createdAt: 1000,
        updatedAt: 3000,
      })

      store.recordNodeCreated(node1)
      store.recordNodeUpdated(node1, node2)

      const diff = store.diffLineage(1500, 4000)

      expect(diff.nodesModified).toHaveLength(1)
      expect(diff.nodesModified[0].before.name).toBe('Original')
      expect(diff.nodesModified[0].after.name).toBe('Modified')
      expect(diff.nodesModified[0].changes).toContain('name')
      expect(diff.summary.nodesModifiedCount).toBe(1)
    })

    it('should detect added edges', () => {
      const edge = mockEdge({ id: 'edge-1', timestamp: 2000 })

      store.recordEdgeCreated(edge)

      const diff = store.diffLineage(1000, 3000)

      expect(diff.edgesAdded).toHaveLength(1)
      expect(diff.edgesAdded[0].id).toBe('edge-1')
      expect(diff.summary.edgesAddedCount).toBe(1)
    })

    it('should detect removed edges', () => {
      const edge = mockEdge({ id: 'edge-1', timestamp: 1000 })

      store.recordEdgeCreated(edge)
      store.recordEdgeDeleted(edge)

      const diff = store.diffLineage(1500, Date.now() + 1000)

      expect(diff.edgesRemoved).toHaveLength(1)
      expect(diff.edgesRemoved[0].id).toBe('edge-1')
      expect(diff.summary.edgesRemovedCount).toBe(1)
    })

    it('should calculate total changes correctly', () => {
      const node1 = mockNode({ id: 'new-node', createdAt: 2500, updatedAt: 2500 })
      const node2 = mockNode({ id: 'deleted-node', createdAt: 1000, updatedAt: 1000 })
      const node3 = mockNode({ id: 'modified-node', name: 'v1', createdAt: 1000, updatedAt: 1000 })
      const node3v2 = mockNode({ id: 'modified-node', name: 'v2', createdAt: 1000, updatedAt: 2500 })
      const edge = mockEdge({ id: 'new-edge', timestamp: 2500 })

      store.recordNodeCreated(node2)
      store.recordNodeCreated(node3)
      store.recordNodeCreated(node1)
      store.recordNodeDeleted(node2)
      store.recordNodeUpdated(node3, node3v2)
      store.recordEdgeCreated(edge)

      const diff = store.diffLineage(1500, Date.now() + 1000)

      expect(diff.summary.totalChanges).toBe(
        diff.summary.nodesAddedCount +
        diff.summary.nodesRemovedCount +
        diff.summary.nodesModifiedCount +
        diff.summary.edgesAddedCount +
        diff.summary.edgesRemovedCount
      )
    })

    it('should return correct timestamps in diff result', () => {
      const diff = store.diffLineage(1000, 5000)

      expect(diff.fromTimestamp).toBe(1000)
      expect(diff.toTimestamp).toBe(5000)
    })
  })

  describe('diffAssetLineage', () => {
    it('should only include changes in connected lineage', () => {
      // Connected: A -> B
      // Disconnected: C

      const nodeA = mockNode({ id: 'A', createdAt: 1000, updatedAt: 1000 })
      const nodeB = mockNode({ id: 'B', createdAt: 1000, updatedAt: 1000 })
      const nodeC = mockNode({ id: 'C', createdAt: 2500, updatedAt: 2500 }) // Disconnected, added later
      const edgeAB = mockEdge({ id: 'AB', fromNodeId: 'A', toNodeId: 'B', timestamp: 1000 })

      store.recordNodeCreated(nodeA)
      store.recordNodeCreated(nodeB)
      store.recordEdgeCreated(edgeAB)
      store.recordNodeCreated(nodeC)

      const diff = store.diffAssetLineage('B', 1500, 3000)

      // C should not be in the diff since it's not connected to B
      expect(diff.nodesAdded.find((n) => n.id === 'C')).toBeUndefined()
    })
  })

  describe('findDependencyStartTime', () => {
    it('should find when a dependency was first established', () => {
      const edge = mockEdge({
        id: 'edge-1',
        fromNodeId: 'source',
        toNodeId: 'target',
        timestamp: 5000,
      })

      store.recordEdgeCreated(edge)

      const startTime = store.findDependencyStartTime('source', 'target')

      expect(startTime).toBe(5000)
    })

    it('should return null if dependency never existed', () => {
      const startTime = store.findDependencyStartTime('non', 'existent')

      expect(startTime).toBeNull()
    })
  })
})

// =============================================================================
// UTILITY METHOD TESTS
// =============================================================================

describe('TimeTravelStore - Utility Methods', () => {
  let store: TimeTravelStore

  beforeEach(() => {
    store = createStore()
  })

  describe('getEventCount', () => {
    it('should return 0 for empty store', () => {
      expect(store.getEventCount()).toBe(0)
    })

    it('should return correct count after events', () => {
      const node = mockNode({ createdAt: 1000, updatedAt: 1000 })
      store.recordNodeCreated(node)
      store.recordNodeUpdated(node, { ...node, name: 'updated', updatedAt: 2000 })

      expect(store.getEventCount()).toBe(2)
    })
  })

  describe('getEarliestTimestamp', () => {
    it('should return null for empty store', () => {
      expect(store.getEarliestTimestamp()).toBeNull()
    })

    it('should return earliest event timestamp', () => {
      const node1 = mockNode({ id: 'n1', createdAt: 3000, updatedAt: 3000 })
      const node2 = mockNode({ id: 'n2', createdAt: 1000, updatedAt: 1000 })
      const node3 = mockNode({ id: 'n3', createdAt: 2000, updatedAt: 2000 })

      store.recordNodeCreated(node1)
      store.recordNodeCreated(node2)
      store.recordNodeCreated(node3)

      expect(store.getEarliestTimestamp()).toBe(1000)
    })
  })

  describe('getLatestTimestamp', () => {
    it('should return null for empty store', () => {
      expect(store.getLatestTimestamp()).toBeNull()
    })

    it('should return latest event timestamp', () => {
      const node1 = mockNode({ id: 'n1', createdAt: 1000, updatedAt: 1000 })
      const node2 = mockNode({ id: 'n2', createdAt: 3000, updatedAt: 3000 })
      const node3 = mockNode({ id: 'n3', createdAt: 2000, updatedAt: 2000 })

      store.recordNodeCreated(node1)
      store.recordNodeCreated(node2)
      store.recordNodeCreated(node3)

      expect(store.getLatestTimestamp()).toBe(3000)
    })
  })

  describe('clear', () => {
    it('should remove all events', () => {
      const node = mockNode({ createdAt: 1000, updatedAt: 1000 })
      store.recordNodeCreated(node)
      store.recordNodeCreated(mockNode({ id: 'n2', createdAt: 2000, updatedAt: 2000 }))

      expect(store.getEventCount()).toBe(2)

      store.clear()

      expect(store.getEventCount()).toBe(0)
    })
  })
})

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

describe('TimeTravelStore - Integration', () => {
  let store: TimeTravelStore

  beforeEach(() => {
    store = createStore()
  })

  it('should handle realistic ETL pipeline lineage evolution', () => {
    // Day 1: Initial pipeline setup
    const day1 = 86400000 // epoch for day 1

    const rawEvents = mockNode({
      id: 'raw_events',
      type: 'source',
      name: 'Raw Events',
      createdAt: day1,
      updatedAt: day1,
    })
    const transform1 = mockNode({
      id: 'transform_1',
      type: 'transformation',
      name: 'Event Aggregation',
      createdAt: day1,
      updatedAt: day1,
    })
    const dashboard = mockNode({
      id: 'dashboard',
      type: 'sink',
      name: 'Analytics Dashboard',
      createdAt: day1,
      updatedAt: day1,
    })

    store.recordNodeCreated(rawEvents)
    store.recordNodeCreated(transform1)
    store.recordNodeCreated(dashboard)
    store.recordEdgeCreated(mockEdge({
      id: 'e1',
      fromNodeId: 'raw_events',
      toNodeId: 'transform_1',
      timestamp: day1,
    }))
    store.recordEdgeCreated(mockEdge({
      id: 'e2',
      fromNodeId: 'transform_1',
      toNodeId: 'dashboard',
      timestamp: day1,
    }))

    // Day 2: Add new data source
    const day2 = day1 + 86400000

    const userProfiles = mockNode({
      id: 'user_profiles',
      type: 'source',
      name: 'User Profiles',
      createdAt: day2,
      updatedAt: day2,
    })
    store.recordNodeCreated(userProfiles)
    store.recordEdgeCreated(mockEdge({
      id: 'e3',
      fromNodeId: 'user_profiles',
      toNodeId: 'transform_1',
      timestamp: day2,
    }))

    // Day 3: Update transformation
    const day3 = day2 + 86400000

    const transform1Updated = {
      ...transform1,
      name: 'Event & User Aggregation',
      metadata: { version: 2 },
      updatedAt: day3,
    }
    store.recordNodeUpdated(transform1, transform1Updated)

    // Verify point-in-time queries
    const lineageDay1 = store.getLineageAt('dashboard', day1 + 1000)
    expect(lineageDay1.nodes).toHaveLength(3) // raw_events, transform_1, dashboard
    expect(lineageDay1.edges).toHaveLength(2)

    const lineageDay2 = store.getLineageAt('dashboard', day2 + 1000)
    expect(lineageDay2.nodes).toHaveLength(4) // Added user_profiles
    expect(lineageDay2.edges).toHaveLength(3)

    // Verify diff between day 1 and day 3
    const diff = store.diffLineage(day1, day3 + 1000)

    expect(diff.nodesAdded).toHaveLength(1) // user_profiles
    expect(diff.nodesModified).toHaveLength(1) // transform_1
    expect(diff.edgesAdded).toHaveLength(1) // e3

    // Verify transformation started depending on user_profiles on day 2
    const depStart = store.findDependencyStartTime('user_profiles', 'transform_1')
    expect(depStart).toBe(day2)
  })

  it('should handle node deletion and recreation', () => {
    const t1 = 1000
    const t2 = 2000
    const t3 = 3000

    // Create node
    const node = mockNode({ id: 'recreated', name: 'v1', createdAt: t1, updatedAt: t1 })
    store.recordNodeCreated(node)

    // Delete node
    store.recordNodeDeleted(node)

    // Recreate with different data (new version)
    const nodeV2 = mockNode({ id: 'recreated', name: 'v2', createdAt: t3, updatedAt: t3 })
    store.recordNodeCreated(nodeV2)

    // At t1 + 500, should see v1
    const atT1 = store.getNodeAt('recreated', t1 + 500)
    expect(atT1?.name).toBe('v1')

    // After deletion but before recreation, should be null
    // (Note: In real scenario, deletion timestamp would be between t1 and t3)

    // At t3 + 500, should see v2
    const atT3 = store.getNodeAt('recreated', t3 + 500)
    expect(atT3?.name).toBe('v2')
  })

  it('should support audit trail queries', () => {
    const events: LineageEvent[] = []

    // Record changes by different actors
    const node = mockNode({ id: 'audited', createdAt: 1000, updatedAt: 1000 })
    events.push(store.recordNodeCreated(node, 'alice@example.com', 'Initial creation'))

    const updated = { ...node, name: 'Updated', updatedAt: 2000 }
    events.push(store.recordNodeUpdated(node, updated, 'bob@example.com', 'Schema update'))

    events.push(store.recordNodeDeleted(updated, 'admin@example.com', 'Deprecated'))

    // Query history
    const history = store.getEntityHistory('audited', 0, Date.now())

    expect(history).toHaveLength(3)
    expect(history[0].actor).toBe('alice@example.com')
    expect(history[0].reason).toBe('Initial creation')
    expect(history[1].actor).toBe('bob@example.com')
    expect(history[2].actor).toBe('admin@example.com')
    expect(history[2].reason).toBe('Deprecated')
  })
})

// =============================================================================
// PERFORMANCE TESTS
// =============================================================================

describe('TimeTravelStore - Performance', () => {
  it('should handle 10k events efficiently', () => {
    const store = createStore()
    const eventCount = 10000

    const start = performance.now()

    // Record many events
    for (let i = 0; i < eventCount; i++) {
      const node = mockNode({
        id: `node-${i % 100}`, // 100 unique nodes
        name: `v${Math.floor(i / 100)}`,
        createdAt: i * 10,
        updatedAt: i * 10,
      })

      if (i < 100) {
        store.recordNodeCreated(node)
      } else {
        const prev = { ...node, updatedAt: (i - 1) * 10 }
        store.recordNodeUpdated(prev, node)
      }
    }

    const writeTime = performance.now() - start

    // Should write 10k events in under 10 seconds
    expect(writeTime).toBeLessThan(10000)

    // Point-in-time query should be fast
    const queryStart = performance.now()
    store.getNodesAt(50000)
    const queryTime = performance.now() - queryStart

    expect(queryTime).toBeLessThan(1000)
  })

  it('should efficiently calculate diffs', () => {
    const store = createStore()

    // Create nodes at various times
    for (let i = 0; i < 1000; i++) {
      const node = mockNode({
        id: `node-${i}`,
        createdAt: i * 100,
        updatedAt: i * 100,
      })
      store.recordNodeCreated(node)
    }

    const start = performance.now()
    const diff = store.diffLineage(25000, 75000)
    const diffTime = performance.now() - start

    expect(diff.nodesAdded.length).toBe(500) // nodes 250-749
    expect(diffTime).toBeLessThan(1000)
  })
})
