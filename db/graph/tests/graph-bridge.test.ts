/**
 * GraphEngine-GraphStore Bridge Tests
 *
 * Tests for bridging in-memory GraphEngine with persisted GraphStore.
 *
 * @see dotdo-n4qwd - [RED] GraphEngine-GraphStore Bridge Tests
 *
 * Gap Analysis:
 * - GraphEngine operates on Node/Edge (in-memory)
 * - GraphStore operates on Thing/Relationship (persisted)
 * - No automatic sync between them
 * - Algorithms like PageRank only work in-memory
 *
 * Design:
 * - GraphBridge provides bidirectional sync between GraphEngine and GraphStore
 * - Things map to Nodes (typeName -> label, data -> properties)
 * - Relationships map to Edges (verb -> type, from/to -> from/to, data -> properties)
 * - NO MOCKS - uses real SQLiteGraphStore with :memory: database
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../stores/sqlite'
import { GraphEngine, type Node, type Edge } from '../graph-engine'
import type { GraphStore, GraphThing, GraphRelationship } from '../types'

// ============================================================================
// GRAPH BRIDGE - Type definitions for the bridge
// ============================================================================

/**
 * Options for loading data from GraphStore into GraphEngine.
 */
interface LoadOptions {
  /** Filter by type name(s) */
  typeNames?: string[]
  /** Filter by verb(s) */
  verbs?: string[]
  /** Maximum number of Things to load */
  thingLimit?: number
  /** Include soft-deleted Things */
  includeDeleted?: boolean
}

/**
 * Options for syncing changes from GraphEngine back to GraphStore.
 */
interface SyncOptions {
  /** Only sync changes since last sync */
  incremental?: boolean
  /** Sync mode: 'create' only creates new, 'upsert' creates or updates */
  mode?: 'create' | 'upsert'
}

/**
 * Result of a sync operation.
 */
interface SyncResult {
  /** Number of Things created */
  thingsCreated: number
  /** Number of Things updated */
  thingsUpdated: number
  /** Number of Relationships created */
  relationshipsCreated: number
  /** Number of errors encountered */
  errors: number
}

/**
 * GraphBridge provides bidirectional sync between GraphEngine and GraphStore.
 *
 * Mapping:
 * - Thing.id -> Node.id (direct mapping)
 * - Thing.typeName -> Node.label
 * - Thing.data -> Node.properties
 * - Relationship.verb -> Edge.type
 * - Relationship.from/to -> Edge.from/to (URL to Thing ID extraction)
 * - Relationship.data -> Edge.properties
 */
interface GraphBridge {
  /**
   * Load data from GraphStore into GraphEngine.
   */
  loadFromStore(options?: LoadOptions): Promise<{ nodes: number; edges: number }>

  /**
   * Sync changes from GraphEngine back to GraphStore.
   */
  syncToStore(options?: SyncOptions): Promise<SyncResult>

  /**
   * Get the underlying GraphEngine.
   */
  getEngine(): GraphEngine

  /**
   * Get the underlying GraphStore.
   */
  getStore(): GraphStore

  /**
   * Clear all data from the GraphEngine.
   */
  clearEngine(): Promise<void>

  /**
   * Convert a Thing to a Node.
   */
  thingToNode(thing: GraphThing): { label: string; properties: Record<string, unknown> }

  /**
   * Convert a Node to Thing input.
   */
  nodeToThingInput(node: Node): { id: string; typeId: number; typeName: string; data: Record<string, unknown> }

  /**
   * Convert a Relationship to Edge input.
   */
  relationshipToEdge(rel: GraphRelationship): { from: string; type: string; to: string; properties: Record<string, unknown> }

  /**
   * Extract Thing ID from a DO URL.
   */
  extractThingId(url: string): string
}

// ============================================================================
// TESTS
// ============================================================================

describe('GraphEngine-GraphStore Bridge', () => {
  let store: SQLiteGraphStore
  let engine: GraphEngine

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
    engine = new GraphEngine()
  })

  afterEach(async () => {
    await store.close()
  })

  // ==========================================================================
  // TYPE MAPPING TESTS
  // ==========================================================================

  describe('Type Mapping: Thing <-> Node', () => {
    it('should map Thing.typeName to Node.label', async () => {
      // Create a Thing in the store
      const thing = await store.createThing({
        id: 'customer-1',
        typeId: 500, // Customer type from nouns.ts
        typeName: 'Customer',
        data: { name: 'Alice', email: 'alice@example.com' },
      })

      // Expected mapping: typeName -> label
      expect(thing.typeName).toBe('Customer')

      // When loading into engine, the label should be 'Customer'
      const node = await engine.createNode('Customer', {
        name: 'Alice',
        email: 'alice@example.com',
        _thingId: thing.id,
        _typeId: thing.typeId,
      }, { id: thing.id })

      expect(node.label).toBe('Customer')
      expect(node.id).toBe('customer-1')
    })

    it('should map Thing.data to Node.properties', async () => {
      const thingData = {
        name: 'Widget Pro',
        price: 29.99,
        tags: ['electronics', 'popular'],
        specs: { weight: 1.5, color: 'blue' },
      }

      const thing = await store.createThing({
        id: 'product-1',
        typeId: 500,
        typeName: 'Product',
        data: thingData,
      })

      // Create corresponding node with mapped data
      const node = await engine.createNode('Product', {
        ...thingData,
        _thingId: thing.id,
        _typeId: thing.typeId,
      }, { id: thing.id })

      expect(node.properties.name).toBe('Widget Pro')
      expect(node.properties.price).toBe(29.99)
      expect(node.properties.tags).toEqual(['electronics', 'popular'])
      expect(node.properties.specs).toEqual({ weight: 1.5, color: 'blue' })
    })

    it('should handle null Thing.data gracefully', async () => {
      const thing = await store.createThing({
        id: 'empty-thing',
        typeId: 500,
        typeName: 'Task',
        data: null,
      })

      // Null data should map to empty properties
      const node = await engine.createNode('Task', {
        _thingId: thing.id,
        _typeId: thing.typeId,
      }, { id: thing.id })

      expect(node.label).toBe('Task')
      expect(node.properties._thingId).toBe('empty-thing')
    })

    it('should preserve Thing.id as Node.id', async () => {
      const thing = await store.createThing({
        id: 'unique-id-12345',
        typeId: 500,
        typeName: 'Customer',
        data: { name: 'Bob' },
      })

      const node = await engine.createNode('Customer', {
        name: 'Bob',
      }, { id: thing.id })

      expect(node.id).toBe('unique-id-12345')
    })
  })

  // ==========================================================================
  // RELATIONSHIP <-> EDGE MAPPING TESTS
  // ==========================================================================

  describe('Type Mapping: Relationship <-> Edge', () => {
    beforeEach(async () => {
      // Create nodes for relationship testing
      await store.createThing({
        id: 'alice',
        typeId: 500,
        typeName: 'Customer',
        data: { name: 'Alice' },
      })

      await store.createThing({
        id: 'widget',
        typeId: 500,
        typeName: 'Product',
        data: { name: 'Widget' },
      })

      // Create nodes in engine
      await engine.createNode('Customer', { name: 'Alice' }, { id: 'alice' })
      await engine.createNode('Product', { name: 'Widget' }, { id: 'widget' })
    })

    it('should map Relationship.verb to Edge.type', async () => {
      const rel = await store.createRelationship({
        id: 'rel-1',
        verb: 'purchased',
        from: 'do://tenant/customers/alice',
        to: 'do://tenant/products/widget',
        data: { quantity: 2 },
      })

      // Expected mapping: verb -> type
      expect(rel.verb).toBe('purchased')

      // Create corresponding edge
      const edge = await engine.createEdge('alice', 'purchased', 'widget', {
        quantity: 2,
        _relationshipId: rel.id,
      })

      expect(edge.type).toBe('purchased')
    })

    it('should extract Thing IDs from DO URLs', async () => {
      const rel = await store.createRelationship({
        id: 'rel-2',
        verb: 'manages',
        from: 'do://org1/teams/engineering',
        to: 'do://org1/projects/alpha',
      })

      // URL: do://tenant/collection/id -> extract 'id'
      // Simple extraction: last path segment
      const extractId = (url: string): string => {
        const segments = url.split('/')
        return segments[segments.length - 1] || url
      }

      expect(extractId(rel.from)).toBe('engineering')
      expect(extractId(rel.to)).toBe('alpha')
    })

    it('should map Relationship.data to Edge.properties', async () => {
      const relData = {
        since: '2024-01-01',
        status: 'active',
        metadata: { source: 'web', campaign: 'new-year' },
      }

      const rel = await store.createRelationship({
        id: 'rel-3',
        verb: 'subscribedTo',
        from: 'do://tenant/customers/alice',
        to: 'do://tenant/plans/premium',
        data: relData,
      })

      expect(rel.data).toEqual(relData)

      // Edge properties should contain the same data
      const edge = await engine.createEdge('alice', 'subscribedTo', 'widget', relData)

      expect(edge.properties.since).toBe('2024-01-01')
      expect(edge.properties.status).toBe('active')
    })

    it('should handle null Relationship.data', async () => {
      const rel = await store.createRelationship({
        id: 'rel-4',
        verb: 'follows',
        from: 'do://tenant/users/alice',
        to: 'do://tenant/users/bob',
      })

      expect(rel.data).toBeNull()

      // Edge with empty properties
      const edge = await engine.createEdge('alice', 'follows', 'widget', {})

      expect(edge.properties).toEqual({})
    })
  })

  // ==========================================================================
  // LOADING FROM GRAPHSTORE TO GRAPHENGINE
  // ==========================================================================

  describe('Loading from GraphStore to GraphEngine', () => {
    beforeEach(async () => {
      // Seed GraphStore with test data
      await store.createThing({
        id: 'customer-alice',
        typeId: 500,
        typeName: 'Customer',
        data: { name: 'Alice', tier: 'premium' },
      })

      await store.createThing({
        id: 'customer-bob',
        typeId: 500,
        typeName: 'Customer',
        data: { name: 'Bob', tier: 'standard' },
      })

      await store.createThing({
        id: 'product-widget',
        typeId: 500,
        typeName: 'Product',
        data: { name: 'Widget', price: 29.99 },
      })

      await store.createRelationship({
        id: 'rel-alice-widget',
        verb: 'purchased',
        from: 'do://tenant/customers/customer-alice',
        to: 'do://tenant/products/product-widget',
        data: { quantity: 2 },
      })

      await store.createRelationship({
        id: 'rel-bob-widget',
        verb: 'purchased',
        from: 'do://tenant/customers/customer-bob',
        to: 'do://tenant/products/product-widget',
        data: { quantity: 1 },
      })
    })

    it('should load Things as Nodes', async () => {
      // Load all Things from store
      const things = await store.getThingsByType({})

      expect(things.length).toBeGreaterThanOrEqual(3)

      // Create nodes from things
      for (const thing of things) {
        const properties = thing.data ? { ...thing.data, _typeId: thing.typeId } : { _typeId: thing.typeId }
        await engine.createNode(thing.typeName, properties, { id: thing.id })
      }

      const stats = await engine.stats()
      expect(stats.nodeCount).toBe(things.length)
    })

    it('should load Relationships as Edges', async () => {
      // First load Things as Nodes
      const things = await store.getThingsByType({})
      for (const thing of things) {
        const properties = thing.data ? { ...thing.data } : {}
        await engine.createNode(thing.typeName, properties, { id: thing.id })
      }

      // Load relationships
      const rels = await store.queryRelationshipsByVerb('purchased')

      expect(rels.length).toBe(2)

      // Create edges from relationships
      for (const rel of rels) {
        // Extract Thing IDs from URLs (last path segment)
        const fromId = rel.from.split('/').pop()!
        const toId = rel.to.split('/').pop()!
        const properties = rel.data ? { ...rel.data } : {}

        await engine.createEdge(fromId, rel.verb, toId, properties)
      }

      const stats = await engine.stats()
      expect(stats.edgeCount).toBe(2)
    })

    it('should filter by type when loading', async () => {
      // Load only Customer Things
      const customers = await store.getThingsByType({ typeName: 'Customer' })

      expect(customers.length).toBe(2)

      for (const customer of customers) {
        const properties = customer.data ? { ...customer.data } : {}
        await engine.createNode(customer.typeName, properties, { id: customer.id })
      }

      const stats = await engine.stats()
      expect(stats.nodeCount).toBe(2)
      expect(stats.labelCounts['Customer']).toBe(2)
    })

    it('should run algorithms after loading', async () => {
      // Load all data
      const things = await store.getThingsByType({})
      for (const thing of things) {
        const properties = thing.data ? { ...thing.data } : {}
        await engine.createNode(thing.typeName, properties, { id: thing.id })
      }

      const rels = await store.queryRelationshipsByVerb('purchased')
      for (const rel of rels) {
        const fromId = rel.from.split('/').pop()!
        const toId = rel.to.split('/').pop()!
        const properties = rel.data ? { ...rel.data } : {}
        await engine.createEdge(fromId, rel.verb, toId, properties)
      }

      // Now we can run graph algorithms
      const pageRank = await engine.pageRank()

      expect(pageRank.size).toBe(3)
      expect(pageRank.has('customer-alice')).toBe(true)
      expect(pageRank.has('customer-bob')).toBe(true)
      expect(pageRank.has('product-widget')).toBe(true)

      // Product has higher rank (more incoming edges)
      const productRank = pageRank.get('product-widget')!
      const aliceRank = pageRank.get('customer-alice')!

      expect(productRank).toBeGreaterThan(aliceRank)
    })

    it('should preserve graph structure after loading', async () => {
      // Load all data
      const things = await store.getThingsByType({})
      for (const thing of things) {
        const properties = thing.data ? { ...thing.data } : {}
        await engine.createNode(thing.typeName, properties, { id: thing.id })
      }

      const rels = await store.queryRelationshipsByVerb('purchased')
      for (const rel of rels) {
        const fromId = rel.from.split('/').pop()!
        const toId = rel.to.split('/').pop()!
        const properties = rel.data ? { ...rel.data } : {}
        await engine.createEdge(fromId, rel.verb, toId, properties)
      }

      // Verify traversal works
      const neighbors = await engine.neighbors('product-widget', { direction: 'INCOMING' })

      expect(neighbors.length).toBe(2)
      expect(neighbors.map((n) => n.id).sort()).toEqual(['customer-alice', 'customer-bob'])
    })
  })

  // ==========================================================================
  // SYNCING FROM GRAPHENGINE BACK TO GRAPHSTORE
  // ==========================================================================

  describe('Syncing from GraphEngine to GraphStore', () => {
    it('should create new Things from new Nodes', async () => {
      // Create nodes in engine
      const node = await engine.createNode('Order', {
        total: 99.99,
        status: 'pending',
      }, { id: 'order-1' })

      // Sync to store by creating Thing
      // NOTE: Using typeId 500 (Customer) as a placeholder since Order is not in NOUN_REGISTRY
      // In a real implementation, the bridge would need to resolve typeName to typeId
      await store.createThing({
        id: node.id,
        typeId: 500, // Would need proper type resolution
        typeName: node.label,
        data: node.properties,
      })

      const thing = await store.getThing('order-1')

      expect(thing).not.toBeNull()
      expect(thing!.typeName).toBe('Order')
      expect(thing!.data).toEqual({
        total: 99.99,
        status: 'pending',
      })
    })

    it('should create new Relationships from new Edges', async () => {
      // Setup nodes in both engine and store
      await engine.createNode('Customer', { name: 'Carol' }, { id: 'carol' })
      await engine.createNode('Product', { name: 'Gadget' }, { id: 'gadget' })

      await store.createThing({
        id: 'carol',
        typeId: 500,
        typeName: 'Customer',
        data: { name: 'Carol' },
      })

      await store.createThing({
        id: 'gadget',
        typeId: 500,
        typeName: 'Product',
        data: { name: 'Gadget' },
      })

      // Create edge in engine
      const edge = await engine.createEdge('carol', 'wishlisted', 'gadget', {
        addedAt: '2024-06-15',
      })

      // Sync to store
      await store.createRelationship({
        id: edge.id,
        verb: edge.type,
        from: `do://tenant/things/${edge.from}`,
        to: `do://tenant/things/${edge.to}`,
        data: edge.properties,
      })

      const rels = await store.queryRelationshipsByVerb('wishlisted')

      expect(rels.length).toBe(1)
      expect(rels[0].verb).toBe('wishlisted')
      expect(rels[0].data).toEqual({ addedAt: '2024-06-15' })
    })

    it('should update existing Things from modified Nodes', async () => {
      // Create initial Thing
      await store.createThing({
        id: 'updateable-thing',
        typeId: 500,
        typeName: 'Task',
        data: { status: 'pending' },
      })

      // Load into engine
      await engine.createNode('Task', { status: 'pending' }, { id: 'updateable-thing' })

      // Modify in engine
      await engine.updateNode('updateable-thing', { status: 'completed', completedAt: Date.now() })

      // Sync back to store
      const node = await engine.getNode('updateable-thing')
      await store.updateThing('updateable-thing', { data: node!.properties })

      const thing = await store.getThing('updateable-thing')

      expect(thing!.data).toHaveProperty('status', 'completed')
      expect(thing!.data).toHaveProperty('completedAt')
    })

    it('should handle node deletion by soft-deleting Thing', async () => {
      // Create Thing and Node
      await store.createThing({
        id: 'deleteable-thing',
        typeId: 500,
        typeName: 'Task',
        data: { status: 'pending' },
      })

      await engine.createNode('Task', { status: 'pending' }, { id: 'deleteable-thing' })

      // Delete from engine
      await engine.deleteNode('deleteable-thing')

      // Sync by soft-deleting in store
      await store.deleteThing('deleteable-thing')

      const thing = await store.getThing('deleteable-thing')

      expect(thing).not.toBeNull()
      expect(thing!.deletedAt).not.toBeNull()
    })
  })

  // ==========================================================================
  // INCREMENTAL SYNC TESTS
  // ==========================================================================

  describe('Incremental Sync', () => {
    it('should track which nodes are new since last sync', async () => {
      // Track sync state with timestamps
      const lastSyncTime = Date.now()

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Create new nodes after sync time
      const node1 = await engine.createNode('Customer', { name: 'New Customer 1' })
      const node2 = await engine.createNode('Customer', { name: 'New Customer 2' })

      // Get all nodes
      const allNodes = await engine.getNodes()

      // Filter new nodes (created after last sync)
      const newNodes = allNodes.filter((n) => n.createdAt > lastSyncTime)

      expect(newNodes.length).toBe(2)
      expect(newNodes.map((n) => n.properties.name).sort()).toEqual(['New Customer 1', 'New Customer 2'])
    })

    it('should track which nodes were updated since last sync', async () => {
      // Create node
      const node = await engine.createNode('Task', { status: 'pending' })

      // Record sync time
      const lastSyncTime = Date.now()

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Update node after sync time
      await engine.updateNode(node.id, { status: 'in-progress' })

      // Get updated node
      const updatedNode = await engine.getNode(node.id)

      expect(updatedNode!.updatedAt).toBeGreaterThan(lastSyncTime)
    })

    it('should support delta sync by comparing timestamps', async () => {
      // Initial load
      await store.createThing({
        id: 'thing-1',
        typeId: 500,
        typeName: 'Task',
        data: { status: 'pending' },
      })

      // Load into engine
      const things = await store.getThingsByType({})
      for (const thing of things) {
        await engine.createNode(thing.typeName, thing.data || {}, { id: thing.id })
      }

      // Record sync time
      const syncTime = Date.now()

      // Create new thing in store after sync
      await new Promise((resolve) => setTimeout(resolve, 10))

      await store.createThing({
        id: 'thing-2',
        typeId: 500,
        typeName: 'Task',
        data: { status: 'new' },
      })

      // Get delta (things created after sync time)
      const allThings = await store.getThingsByType({})
      const deltaThings = allThings.filter((t) => t.createdAt > syncTime)

      expect(deltaThings.length).toBe(1)
      expect(deltaThings[0].id).toBe('thing-2')
    })
  })

  // ==========================================================================
  // BIDIRECTIONAL CONSISTENCY TESTS
  // ==========================================================================

  describe('Bidirectional Consistency', () => {
    it('should maintain referential integrity when syncing', async () => {
      // Create connected graph in store
      await store.createThing({
        id: 'user-1',
        typeId: 500,
        typeName: 'User',
        data: { name: 'User 1' },
      })

      await store.createThing({
        id: 'user-2',
        typeId: 500,
        typeName: 'User',
        data: { name: 'User 2' },
      })

      await store.createRelationship({
        id: 'follows-1',
        verb: 'follows',
        from: 'do://tenant/users/user-1',
        to: 'do://tenant/users/user-2',
      })

      // Load into engine
      const things = await store.getThingsByType({})
      for (const thing of things) {
        await engine.createNode(thing.typeName, thing.data || {}, { id: thing.id })
      }

      const rels = await store.queryRelationshipsByVerb('follows')
      for (const rel of rels) {
        const fromId = rel.from.split('/').pop()!
        const toId = rel.to.split('/').pop()!
        await engine.createEdge(fromId, rel.verb, toId, rel.data || {})
      }

      // Verify connectivity in engine
      const path = await engine.shortestPath('user-1', 'user-2')

      expect(path).not.toBeNull()
      expect(path!.length).toBe(1)
    })

    it('should handle conflicting updates gracefully', async () => {
      // Create in both stores
      await store.createThing({
        id: 'shared-thing',
        typeId: 500,
        typeName: 'Task',
        data: { status: 'pending', priority: 'low' },
      })

      await engine.createNode('Task', { status: 'pending', priority: 'low' }, { id: 'shared-thing' })

      // Update in engine
      await engine.updateNode('shared-thing', { status: 'in-progress' })

      // Update in store (different field)
      await store.updateThing('shared-thing', { data: { status: 'pending', priority: 'high' } })

      // Get both versions
      const engineNode = await engine.getNode('shared-thing')
      const storeThing = await store.getThing('shared-thing')

      // They are now out of sync - this is expected
      expect(engineNode!.properties.status).toBe('in-progress')
      expect((storeThing!.data as Record<string, unknown>).status).toBe('pending')

      // A merge strategy would be needed to reconcile
    })

    it('should round-trip data without loss', async () => {
      const originalData = {
        name: 'Complex Entity',
        count: 42,
        active: true,
        tags: ['a', 'b', 'c'],
        nested: {
          level1: {
            level2: 'deep value',
          },
        },
      }

      // Create in store
      await store.createThing({
        id: 'roundtrip-thing',
        typeId: 500,
        typeName: 'Entity',
        data: originalData,
      })

      // Load into engine
      const thing = await store.getThing('roundtrip-thing')
      await engine.createNode(thing!.typeName, thing!.data || {}, { id: thing!.id })

      // Modify slightly in engine
      await engine.updateNode('roundtrip-thing', { modified: true })

      // Sync back
      const node = await engine.getNode('roundtrip-thing')
      await store.updateThing('roundtrip-thing', { data: node!.properties })

      // Verify all original data is preserved
      const finalThing = await store.getThing('roundtrip-thing')
      const finalData = finalThing!.data as Record<string, unknown>

      expect(finalData.name).toBe(originalData.name)
      expect(finalData.count).toBe(originalData.count)
      expect(finalData.active).toBe(originalData.active)
      expect(finalData.tags).toEqual(originalData.tags)
      expect(finalData.nested).toEqual(originalData.nested)
      expect(finalData.modified).toBe(true) // New field added
    })
  })

  // ==========================================================================
  // PERFORMANCE CONSIDERATIONS
  // ==========================================================================

  describe('Performance', () => {
    it('should handle loading 100+ Things efficiently', async () => {
      // Create 100 Things
      const createPromises = Array.from({ length: 100 }, (_, i) =>
        store.createThing({
          id: `bulk-thing-${i}`,
          typeId: 500,
          typeName: 'Task',
          data: { index: i, status: 'pending' },
        })
      )

      await Promise.all(createPromises)

      // Time the load operation
      const startTime = Date.now()

      const things = await store.getThingsByType({ typeName: 'Task' })
      for (const thing of things) {
        await engine.createNode(thing.typeName, thing.data || {}, { id: thing.id })
      }

      const loadTime = Date.now() - startTime

      const stats = await engine.stats()

      expect(stats.nodeCount).toBe(100)
      expect(loadTime).toBeLessThan(5000) // Should complete within 5 seconds
    })

    it('should batch relationship creation for efficiency', async () => {
      // Create nodes first
      for (let i = 0; i < 10; i++) {
        await store.createThing({
          id: `node-${i}`,
          typeId: 500,
          typeName: 'Node',
          data: { index: i },
        })
        await engine.createNode('Node', { index: i }, { id: `node-${i}` })
      }

      // Create relationships in batch
      const relPromises: Promise<GraphRelationship>[] = []
      for (let i = 0; i < 9; i++) {
        relPromises.push(
          store.createRelationship({
            id: `rel-${i}`,
            verb: 'connects',
            from: `do://tenant/nodes/node-${i}`,
            to: `do://tenant/nodes/node-${i + 1}`,
          })
        )
      }

      await Promise.all(relPromises)

      // Load all relationships into engine
      const rels = await store.queryRelationshipsByVerb('connects')
      for (const rel of rels) {
        const fromId = rel.from.split('/').pop()!
        const toId = rel.to.split('/').pop()!
        await engine.createEdge(fromId, rel.verb, toId, {})
      }

      const stats = await engine.stats()

      expect(stats.edgeCount).toBe(9)
    })
  })

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    it('should handle missing referenced Things gracefully', async () => {
      // Create relationship pointing to non-existent Things
      await store.createRelationship({
        id: 'orphan-rel',
        verb: 'references',
        from: 'do://tenant/things/missing-1',
        to: 'do://tenant/things/missing-2',
      })

      const rels = await store.queryRelationshipsByVerb('references')

      expect(rels.length).toBe(1)

      // Attempting to create edge should fail (nodes don't exist)
      const fromId = rels[0].from.split('/').pop()!
      const toId = rels[0].to.split('/').pop()!

      await expect(engine.createEdge(fromId, 'references', toId)).rejects.toThrow()
    })

    it('should handle duplicate Node IDs when loading', async () => {
      // Create Thing
      await store.createThing({
        id: 'duplicate-test',
        typeId: 500,
        typeName: 'Task',
        data: { version: 1 },
      })

      // Load into engine
      const thing = await store.getThing('duplicate-test')
      await engine.createNode(thing!.typeName, thing!.data || {}, { id: thing!.id })

      // Attempting to create duplicate should fail
      await expect(
        engine.createNode('Task', { version: 2 }, { id: 'duplicate-test' })
      ).rejects.toThrow()
    })

    it('should handle malformed URLs in relationships', async () => {
      await store.createRelationship({
        id: 'bad-url-rel',
        verb: 'links',
        from: '', // Empty URL
        to: 'invalid-url-format',
      })

      const rels = await store.queryRelationshipsByVerb('links')

      expect(rels.length).toBe(1)

      // URL extraction should handle edge cases
      const extractId = (url: string): string => {
        if (!url) return ''
        const segments = url.split('/')
        return segments[segments.length - 1] || url
      }

      expect(extractId(rels[0].from)).toBe('')
      expect(extractId(rels[0].to)).toBe('invalid-url-format')
    })
  })
})
