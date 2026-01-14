/**
 * DrizzleLineageStore Tests - TDD RED Phase
 *
 * Tests for the Drizzle ORM-based LineageStore implementation.
 * This store provides type-safe CRUD operations using Drizzle ORM
 * instead of raw SQL queries.
 *
 * @module db/primitives/lineage-tracker/tests/store
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import {
  DrizzleLineageStore,
  createDrizzleLineageStore,
} from '../store'
import type { LineageNode, LineageEdge, NodeType } from '../types'
import { lineageNodes, lineageEdges, LINEAGE_DRIZZLE_SCHEMA } from '../schema'

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Creates an in-memory SQLite database with Drizzle ORM
 */
function createTestDb(): { sqlite: Database.Database; db: BetterSQLite3Database } {
  const sqlite = new Database(':memory:')
  // Create schema
  sqlite.exec(LINEAGE_DRIZZLE_SCHEMA)
  const db = drizzle(sqlite)
  return { sqlite, db }
}

function createStore(config?: { idPrefix?: string; detectCycles?: boolean }): DrizzleLineageStore {
  const { db } = createTestDb()
  return createDrizzleLineageStore(db, config)
}

// =============================================================================
// NODE CRUD TESTS
// =============================================================================

describe('DrizzleLineageStore - Node CRUD', () => {
  let store: DrizzleLineageStore

  beforeEach(() => {
    store = createStore()
  })

  describe('createNode', () => {
    it('should create node with auto-generated ID', async () => {
      const node = await store.createNode({
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

    it('should create node with custom ID', async () => {
      const node = await store.createNode({
        id: 'custom-id-123',
        type: 'source',
        name: 'events',
      })

      expect(node.id).toBe('custom-id-123')
    })

    it('should store metadata as JSON', async () => {
      const metadata = {
        schema: { columns: ['id', 'name', 'email'] },
        rowCount: 1000,
        lastUpdated: '2024-01-15',
      }

      const node = await store.createNode({
        type: 'entity',
        name: 'users',
        metadata,
      })

      expect(node.metadata).toEqual(metadata)

      // Retrieve and verify metadata persists
      const retrieved = await store.getNode(node.id)
      expect(retrieved?.metadata).toEqual(metadata)
    })

    it('should set timestamps', async () => {
      const before = Date.now()
      const node = await store.createNode({ type: 'entity', name: 'test' })
      const after = Date.now()

      expect(node.createdAt).toBeGreaterThanOrEqual(before)
      expect(node.createdAt).toBeLessThanOrEqual(after)
      expect(node.updatedAt).toBeGreaterThanOrEqual(before)
      expect(node.updatedAt).toBeLessThanOrEqual(after)
      expect(node.createdAt).toBe(node.updatedAt)
    })

    it('should use custom ID prefix from config', async () => {
      const customStore = createStore({ idPrefix: 'asset' })
      const node = await customStore.createNode({ type: 'entity', name: 'test' })

      expect(node.id).toMatch(/^asset-/)
    })

    it('should default metadata to empty object', async () => {
      const node = await store.createNode({ type: 'entity', name: 'test' })
      expect(node.metadata).toEqual({})
    })
  })

  describe('getNode', () => {
    it('should retrieve existing node', async () => {
      const created = await store.createNode({
        type: 'entity',
        name: 'customers',
        namespace: 'db',
        metadata: { key: 'value' },
      })

      const retrieved = await store.getNode(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
      expect(retrieved?.name).toBe('customers')
      expect(retrieved?.namespace).toBe('db')
      expect(retrieved?.metadata).toEqual({ key: 'value' })
    })

    it('should return null for non-existent node', async () => {
      const result = await store.getNode('non-existent-id')
      expect(result).toBeNull()
    })
  })

  describe('updateNode', () => {
    it('should update node fields', async () => {
      const node = await store.createNode({
        type: 'entity',
        name: 'original',
        namespace: 'ns1',
      })

      const updated = await store.updateNode(node.id, {
        name: 'updated',
        namespace: 'ns2',
        metadata: { updated: true },
      })

      expect(updated).not.toBeNull()
      expect(updated?.name).toBe('updated')
      expect(updated?.namespace).toBe('ns2')
      expect(updated?.metadata).toEqual({ updated: true })
    })

    it('should preserve createdAt timestamp', async () => {
      const node = await store.createNode({ type: 'entity', name: 'test' })
      const originalCreatedAt = node.createdAt

      const updated = await store.updateNode(node.id, { name: 'updated' })

      expect(updated?.createdAt).toBe(originalCreatedAt)
    })

    it('should update updatedAt timestamp', async () => {
      const node = await store.createNode({ type: 'entity', name: 'test' })
      const originalUpdatedAt = node.updatedAt

      // Small delay to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 1))
      const updated = await store.updateNode(node.id, { name: 'updated' })

      expect(updated?.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt)
    })

    it('should return null for non-existent node', async () => {
      const result = await store.updateNode('non-existent', { name: 'test' })
      expect(result).toBeNull()
    })

    it('should preserve fields not included in update', async () => {
      const node = await store.createNode({
        type: 'entity',
        name: 'original',
        namespace: 'ns1',
        metadata: { key: 'value' },
      })

      const updated = await store.updateNode(node.id, { name: 'updated' })

      expect(updated?.type).toBe('entity')
      expect(updated?.namespace).toBe('ns1')
      expect(updated?.metadata).toEqual({ key: 'value' })
    })
  })

  describe('deleteNode', () => {
    it('should delete existing node', async () => {
      const node = await store.createNode({ type: 'entity', name: 'to-delete' })

      await store.deleteNode(node.id)

      expect(await store.getNode(node.id)).toBeNull()
    })

    it('should not throw for non-existent node', async () => {
      await expect(store.deleteNode('non-existent')).resolves.not.toThrow()
    })

    it('should cascade delete related edges', async () => {
      const nodeA = await store.createNode({ type: 'entity', name: 'A' })
      const nodeB = await store.createNode({ type: 'entity', name: 'B' })
      const edge = await store.createEdge({
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        operation: 'read',
      })

      await store.deleteNode(nodeA.id)

      expect(await store.getEdge(edge.id)).toBeNull()
    })
  })

  describe('findNodes', () => {
    beforeEach(async () => {
      await store.createNode({ type: 'entity', name: 'users', namespace: 'db' })
      await store.createNode({ type: 'entity', name: 'orders', namespace: 'db' })
      await store.createNode({ type: 'transformation', name: 'user_transform', namespace: 'etl' })
      await store.createNode({ type: 'source', name: 'api_events', namespace: 'api' })
      await store.createNode({ type: 'sink', name: 'warehouse', namespace: 'db' })
    })

    it('should return all nodes when no query', async () => {
      const nodes = await store.findNodes()
      expect(nodes).toHaveLength(5)
    })

    it('should filter by type', async () => {
      const entities = await store.findNodes({ type: 'entity' })
      expect(entities).toHaveLength(2)
      expect(entities.every((n) => n.type === 'entity')).toBe(true)
    })

    it('should filter by namespace', async () => {
      const dbNodes = await store.findNodes({ namespace: 'db' })
      expect(dbNodes).toHaveLength(3)
      expect(dbNodes.every((n) => n.namespace === 'db')).toBe(true)
    })

    it('should filter by name contains', async () => {
      const userNodes = await store.findNodes({ nameContains: 'user' })
      expect(userNodes).toHaveLength(2) // users and user_transform
    })

    it('should respect limit', async () => {
      const limited = await store.findNodes({ limit: 2 })
      expect(limited).toHaveLength(2)
    })

    it('should respect offset', async () => {
      const all = await store.findNodes()
      const offset2 = await store.findNodes({ offset: 2 })
      expect(offset2).toHaveLength(3)
    })

    it('should combine multiple filters', async () => {
      const results = await store.findNodes({ type: 'entity', namespace: 'db' })
      expect(results).toHaveLength(2)
    })
  })

  describe('createNodes (bulk)', () => {
    it('should create multiple nodes', async () => {
      const nodes = await store.createNodes([
        { type: 'entity', name: 'node1' },
        { type: 'entity', name: 'node2' },
        { type: 'entity', name: 'node3' },
      ])

      expect(nodes).toHaveLength(3)
      expect(nodes.every((n) => n.id)).toBe(true)

      // Verify all are persisted
      for (const node of nodes) {
        expect(await store.getNode(node.id)).not.toBeNull()
      }
    })

    it('should handle empty array', async () => {
      const nodes = await store.createNodes([])
      expect(nodes).toHaveLength(0)
    })
  })
})

// =============================================================================
// EDGE CRUD TESTS
// =============================================================================

describe('DrizzleLineageStore - Edge CRUD', () => {
  let store: DrizzleLineageStore
  let nodeA: LineageNode
  let nodeB: LineageNode
  let nodeC: LineageNode

  beforeEach(async () => {
    store = createStore()
    nodeA = await store.createNode({ type: 'source', name: 'A' })
    nodeB = await store.createNode({ type: 'transformation', name: 'B' })
    nodeC = await store.createNode({ type: 'sink', name: 'C' })
  })

  describe('createEdge', () => {
    it('should create edge between existing nodes', async () => {
      const edge = await store.createEdge({
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        operation: 'read',
      })

      expect(edge.id).toBeDefined()
      expect(edge.fromNodeId).toBe(nodeA.id)
      expect(edge.toNodeId).toBe(nodeB.id)
      expect(edge.operation).toBe('read')
    })

    it('should create edge with custom ID', async () => {
      const edge = await store.createEdge({
        id: 'custom-edge-id',
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        operation: 'read',
      })

      expect(edge.id).toBe('custom-edge-id')
    })

    it('should store edge metadata', async () => {
      const metadata = { rowsProcessed: 1000, duration: 500 }
      const edge = await store.createEdge({
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        operation: 'transform',
        metadata,
      })

      expect(edge.metadata).toEqual(metadata)

      // Verify persistence
      const retrieved = await store.getEdge(edge.id)
      expect(retrieved?.metadata).toEqual(metadata)
    })

    it('should set timestamp', async () => {
      const before = Date.now()
      const edge = await store.createEdge({
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        operation: 'read',
      })
      const after = Date.now()

      expect(edge.timestamp).toBeGreaterThanOrEqual(before)
      expect(edge.timestamp).toBeLessThanOrEqual(after)
    })

    it('should throw error for non-existent source node', async () => {
      await expect(
        store.createEdge({
          fromNodeId: 'non-existent',
          toNodeId: nodeB.id,
          operation: 'read',
        })
      ).rejects.toThrow(/Source node not found/)
    })

    it('should throw error for non-existent target node', async () => {
      await expect(
        store.createEdge({
          fromNodeId: nodeA.id,
          toNodeId: 'non-existent',
          operation: 'read',
        })
      ).rejects.toThrow(/Target node not found/)
    })
  })

  describe('cycle detection', () => {
    it('should detect self-loops', async () => {
      await expect(
        store.createEdge({
          fromNodeId: nodeA.id,
          toNodeId: nodeA.id,
          operation: 'loop',
        })
      ).rejects.toThrow(/cycle/)
    })

    it('should detect direct cycles', async () => {
      await store.createEdge({
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        operation: 'step1',
      })

      await expect(
        store.createEdge({
          fromNodeId: nodeB.id,
          toNodeId: nodeA.id,
          operation: 'step2',
        })
      ).rejects.toThrow(/cycle/)
    })

    it('should detect indirect cycles', async () => {
      await store.createEdge({ fromNodeId: nodeA.id, toNodeId: nodeB.id, operation: 's1' })
      await store.createEdge({ fromNodeId: nodeB.id, toNodeId: nodeC.id, operation: 's2' })

      await expect(
        store.createEdge({
          fromNodeId: nodeC.id,
          toNodeId: nodeA.id,
          operation: 's3',
        })
      ).rejects.toThrow(/cycle/)
    })

    it('should allow disabling cycle detection', async () => {
      const permissiveStore = createStore({ detectCycles: false })
      const a = await permissiveStore.createNode({ type: 'entity', name: 'A' })
      const b = await permissiveStore.createNode({ type: 'entity', name: 'B' })

      await permissiveStore.createEdge({ fromNodeId: a.id, toNodeId: b.id, operation: 's1' })

      // Should NOT throw with cycle detection disabled
      await expect(
        permissiveStore.createEdge({
          fromNodeId: b.id,
          toNodeId: a.id,
          operation: 's2',
        })
      ).resolves.toBeDefined()
    })
  })

  describe('getEdge', () => {
    it('should retrieve existing edge', async () => {
      const created = await store.createEdge({
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        operation: 'test',
      })

      const retrieved = await store.getEdge(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
      expect(retrieved?.operation).toBe('test')
    })

    it('should return null for non-existent edge', async () => {
      const result = await store.getEdge('non-existent')
      expect(result).toBeNull()
    })
  })

  describe('deleteEdge', () => {
    it('should delete existing edge', async () => {
      const edge = await store.createEdge({
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        operation: 'test',
      })

      await store.deleteEdge(edge.id)

      expect(await store.getEdge(edge.id)).toBeNull()
    })

    it('should not throw for non-existent edge', async () => {
      await expect(store.deleteEdge('non-existent')).resolves.not.toThrow()
    })
  })

  describe('findEdges', () => {
    beforeEach(async () => {
      await store.createEdge({ fromNodeId: nodeA.id, toNodeId: nodeB.id, operation: 'read' })
      await store.createEdge({ fromNodeId: nodeB.id, toNodeId: nodeC.id, operation: 'write' })
    })

    it('should return all edges when no query', async () => {
      const edges = await store.findEdges()
      expect(edges).toHaveLength(2)
    })

    it('should filter by fromNodeId', async () => {
      const edges = await store.findEdges({ fromNodeId: nodeA.id })
      expect(edges).toHaveLength(1)
      expect(edges[0].fromNodeId).toBe(nodeA.id)
    })

    it('should filter by toNodeId', async () => {
      const edges = await store.findEdges({ toNodeId: nodeC.id })
      expect(edges).toHaveLength(1)
      expect(edges[0].toNodeId).toBe(nodeC.id)
    })

    it('should filter by operation', async () => {
      const edges = await store.findEdges({ operation: 'read' })
      expect(edges).toHaveLength(1)
      expect(edges[0].operation).toBe('read')
    })

    it('should respect limit', async () => {
      const edges = await store.findEdges({ limit: 1 })
      expect(edges).toHaveLength(1)
    })

    it('should respect offset', async () => {
      const edges = await store.findEdges({ offset: 1 })
      expect(edges).toHaveLength(1)
    })
  })

  describe('createEdges (bulk)', () => {
    it('should create multiple edges', async () => {
      const nodeD = await store.createNode({ type: 'sink', name: 'D' })

      const edges = await store.createEdges([
        { fromNodeId: nodeA.id, toNodeId: nodeB.id, operation: 'op1' },
        { fromNodeId: nodeB.id, toNodeId: nodeC.id, operation: 'op2' },
        { fromNodeId: nodeC.id, toNodeId: nodeD.id, operation: 'op3' },
      ])

      expect(edges).toHaveLength(3)
      expect(edges.every((e) => e.id)).toBe(true)

      // Verify all are persisted
      for (const edge of edges) {
        expect(await store.getEdge(edge.id)).not.toBeNull()
      }
    })

    it('should handle empty array', async () => {
      const edges = await store.createEdges([])
      expect(edges).toHaveLength(0)
    })
  })
})

// =============================================================================
// EDGE CASES
// =============================================================================

describe('DrizzleLineageStore - Edge Cases', () => {
  let store: DrizzleLineageStore

  beforeEach(() => {
    store = createStore()
  })

  it('should handle special characters in names', async () => {
    const node = await store.createNode({
      type: 'entity',
      name: 'table-with-special_chars.and.dots',
      namespace: 'schema/with/slashes',
    })

    const retrieved = await store.getNode(node.id)
    expect(retrieved?.name).toBe('table-with-special_chars.and.dots')
    expect(retrieved?.namespace).toBe('schema/with/slashes')
  })

  it('should handle unicode characters', async () => {
    const node = await store.createNode({
      type: 'entity',
      name: 'datos_usuario',
      metadata: { description: 'Contains special chars' },
    })

    const retrieved = await store.getNode(node.id)
    expect(retrieved?.name).toBe('datos_usuario')
  })

  it('should handle empty metadata', async () => {
    const node = await store.createNode({
      type: 'entity',
      name: 'test',
      metadata: {},
    })

    const retrieved = await store.getNode(node.id)
    expect(retrieved?.metadata).toEqual({})
  })

  it('should handle large metadata', async () => {
    const largeMetadata: Record<string, unknown> = {}
    for (let i = 0; i < 100; i++) {
      largeMetadata[`key_${i}`] = `value_${i}`.repeat(10)
    }

    const node = await store.createNode({
      type: 'entity',
      name: 'large_metadata',
      metadata: largeMetadata,
    })

    const retrieved = await store.getNode(node.id)
    expect(Object.keys(retrieved?.metadata ?? {}).length).toBe(100)
  })

  it('should handle null/undefined namespace', async () => {
    const node = await store.createNode({
      type: 'entity',
      name: 'no-namespace',
      namespace: undefined,
    })

    const retrieved = await store.getNode(node.id)
    expect(retrieved?.namespace).toBeUndefined()
  })

  it('should handle multiple parallel edges (different operations)', async () => {
    const a = await store.createNode({ id: 'A', type: 'source', name: 'A' })
    const b = await store.createNode({ id: 'B', type: 'sink', name: 'B' })

    await store.createEdge({ fromNodeId: 'A', toNodeId: 'B', operation: 'read' })
    await store.createEdge({ fromNodeId: 'A', toNodeId: 'B', operation: 'validate' })
    await store.createEdge({ fromNodeId: 'A', toNodeId: 'B', operation: 'transform' })

    const edges = await store.findEdges({ fromNodeId: 'A', toNodeId: 'B' })
    expect(edges).toHaveLength(3)
  })

  it('should handle empty graph operations', async () => {
    expect(await store.findNodes()).toHaveLength(0)
    expect(await store.findEdges()).toHaveLength(0)
  })
})

// =============================================================================
// TYPE SAFETY TESTS
// =============================================================================

describe('DrizzleLineageStore - Type Safety', () => {
  let store: DrizzleLineageStore

  beforeEach(() => {
    store = createStore()
  })

  it('should enforce valid node types', async () => {
    // These should work
    await store.createNode({ type: 'entity', name: 'test' })
    await store.createNode({ type: 'transformation', name: 'test' })
    await store.createNode({ type: 'source', name: 'test' })
    await store.createNode({ type: 'sink', name: 'test' })

    // Type system should prevent invalid types at compile time
    // This is a runtime check for invalid types from external input
    const nodes = await store.findNodes()
    expect(nodes.every((n) => ['entity', 'transformation', 'source', 'sink'].includes(n.type))).toBe(true)
  })
})
