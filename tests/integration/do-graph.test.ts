/**
 * GraphEngine Tests
 *
 * This test suite validates the GraphEngine in-memory graph data structure.
 *
 * NOTE: Real DO-to-Graph integration tests that use actual Durable Objects
 * with SQLite storage are in `objects/tests/*-real.test.ts`. Those tests use
 * miniflare's @cloudflare/vitest-pool-workers for real DO instances.
 *
 * This file tests GraphEngine in isolation (no mocks needed since GraphEngine
 * is purely in-memory). DO NOT add mock DB tests here - that defeats the purpose.
 *
 * Run with: npx vitest run tests/integration/do-graph.test.ts --project=integration
 *
 * @module tests/integration/do-graph
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { GraphEngine } from '../../db/graph'

// ============================================================================
// 1. GRAPH ENGINE NODE OPERATIONS
// ============================================================================

describe('GraphEngine Node Operations', () => {
  let engine: GraphEngine

  beforeEach(() => {
    engine = new GraphEngine()
  })

  describe('Node Creation and Retrieval', () => {
    it('creates node and retrieves it back', async () => {
      const customer = await engine.createNode('Customer', {
        name: 'Alice',
        email: 'alice@example.com',
        tier: 'premium',
      })

      expect(customer).toBeDefined()
      expect(customer.id).toBeDefined()
      expect(customer.label).toBe('Customer')
      expect(customer.properties.name).toBe('Alice')

      // Query the node
      const foundNode = await engine.getNode(customer.id)
      expect(foundNode).toBeDefined()
      expect(foundNode?.properties.name).toBe('Alice')
      expect(foundNode?.properties.tier).toBe('premium')
    })

    it('updates node properties', async () => {
      const customer = await engine.createNode('Customer', {
        name: 'Alice',
        tier: 'basic',
      })

      expect(customer.properties.tier).toBe('basic')

      // Update node
      const updated = await engine.updateNode(customer.id, {
        tier: 'premium',
        upgraded_at: new Date().toISOString(),
      })

      expect(updated.properties.tier).toBe('premium')
      expect(updated.properties.upgraded_at).toBeDefined()
    })

    it('handles node deletion with edge cleanup', async () => {
      // Add nodes
      const customer = await engine.createNode('Customer', { name: 'Alice' })
      const order = await engine.createNode('Order', { total: 100 })

      // Add edge (from, type, to, properties)
      await engine.createEdge(customer.id, 'placed', order.id, {})

      // Get stats before deletion
      const statsBefore = await engine.stats()
      expect(statsBefore.nodeCount).toBe(2)
      expect(statsBefore.edgeCount).toBe(1)

      // Delete customer node
      await engine.deleteNode(customer.id)

      // Verify edge is also removed (cascade behavior)
      const statsAfter = await engine.stats()
      expect(statsAfter.nodeCount).toBe(1)
      expect(statsAfter.edgeCount).toBe(0)
    })
  })

  describe('Batch Operations', () => {
    it('creates multiple nodes', async () => {
      const products = await Promise.all([
        engine.createNode('Product', { name: 'Widget', price: 10 }),
        engine.createNode('Product', { name: 'Gadget', price: 25 }),
        engine.createNode('Product', { name: 'Gizmo', price: 15 }),
      ])

      expect(products.length).toBe(3)

      // Verify all are queryable
      const stats = await engine.stats()
      expect(stats.nodeCount).toBe(3)

      // Calculate total via querying
      let totalValue = 0
      for (const product of products) {
        const node = await engine.getNode(product.id)
        totalValue += node?.properties.price as number
      }
      expect(totalValue).toBe(50)
    })
  })
})

// ============================================================================
// 2. GRAPH EDGE AND TRAVERSAL OPERATIONS
// ============================================================================

describe('GraphEngine Edge and Traversal Operations', () => {
  let engine: GraphEngine

  beforeEach(() => {
    engine = new GraphEngine()
  })

  describe('Edge Creation and Traversal', () => {
    it('creates edges and enables traversal', async () => {
      // Create nodes
      const user = await engine.createNode('User', { name: 'Alice' })
      const team = await engine.createNode('Team', { name: 'Engineering' })

      // Create relationship
      const edge = await engine.createEdge(user.id, 'memberOf', team.id, {
        role: 'engineer',
        since: '2024-01-01',
      })

      expect(edge).toBeDefined()
      expect(edge.type).toBe('memberOf')
      expect(edge.from).toBe(user.id)
      expect(edge.to).toBe(team.id)

      // Traverse from user to find teams
      const result = await engine.traverse({
        start: user.id,
        direction: 'OUTGOING',
        maxDepth: 1,
      })

      expect(result.nodes.some(n => n.id === team.id)).toBe(true)
    })

    it('supports bidirectional traversal', async () => {
      // Create team hierarchy
      const team = await engine.createNode('Team', { name: 'Engineering' })
      const alice = await engine.createNode('User', { name: 'Alice' })
      const bob = await engine.createNode('User', { name: 'Bob' })

      await engine.createEdge(alice.id, 'memberOf', team.id, {})
      await engine.createEdge(bob.id, 'memberOf', team.id, {})

      // Query: Find all members of team (incoming edges)
      const result = await engine.traverse({
        start: team.id,
        direction: 'INCOMING',
        maxDepth: 1,
      })

      expect(result.nodes.length).toBe(2)
      expect(result.nodes.some(n => n.properties.name === 'Alice')).toBe(true)
      expect(result.nodes.some(n => n.properties.name === 'Bob')).toBe(true)
    })

    it('filters traversal by edge type', async () => {
      // User with multiple relationship types
      const alice = await engine.createNode('User', { name: 'Alice' })
      const team = await engine.createNode('Team', { name: 'Engineering' })
      const project = await engine.createNode('Project', { name: 'Platform' })
      const bob = await engine.createNode('User', { name: 'Bob' })

      await engine.createEdge(alice.id, 'memberOf', team.id, {})
      await engine.createEdge(alice.id, 'contributes', project.id, {})
      await engine.createEdge(alice.id, 'follows', bob.id, {})

      // Traverse only 'memberOf' edges
      const result = await engine.traverse({
        start: alice.id,
        direction: 'OUTGOING',
        maxDepth: 1,
        filter: { type: 'memberOf' },
      })

      expect(result.nodes.length).toBe(1)
      expect(result.nodes[0].id).toBe(team.id)
    })
  })

  describe('Graph Analytics', () => {
    it('computes shortest path between nodes', async () => {
      // Create social network
      const alice = await engine.createNode('User', { name: 'Alice' })
      const bob = await engine.createNode('User', { name: 'Bob' })
      const carol = await engine.createNode('User', { name: 'Carol' })
      const dave = await engine.createNode('User', { name: 'Dave' })

      // Alice -> Bob -> Carol -> Dave (long path)
      await engine.createEdge(alice.id, 'follows', bob.id, {})
      await engine.createEdge(bob.id, 'follows', carol.id, {})
      await engine.createEdge(carol.id, 'follows', dave.id, {})
      // Alice -> Dave (direct path)
      await engine.createEdge(alice.id, 'follows', dave.id, {})

      const path = await engine.shortestPath(alice.id, dave.id)

      expect(path).toBeDefined()
      expect(path!.length).toBe(1) // Alice -> Dave is 1 hop
    })

    it('finds all paths between nodes within depth', async () => {
      // Create network with multiple paths
      const a = await engine.createNode('Node', {})
      const b = await engine.createNode('Node', {})
      const c = await engine.createNode('Node', {})
      const d = await engine.createNode('Node', {})

      await engine.createEdge(a.id, 'connects', b.id, {})
      await engine.createEdge(b.id, 'connects', d.id, {})
      await engine.createEdge(a.id, 'connects', c.id, {})
      await engine.createEdge(c.id, 'connects', d.id, {})
      await engine.createEdge(a.id, 'connects', d.id, {})

      const paths = await engine.allPaths(a.id, d.id, { maxDepth: 3 })

      // Should find: A->D, A->B->D, A->C->D
      expect(paths.length).toBeGreaterThanOrEqual(3)
    })

    it('detects cycles during traversal', async () => {
      // Create circular dependency
      const taskA = await engine.createNode('Task', { name: 'Task A' })
      const taskB = await engine.createNode('Task', { name: 'Task B' })
      const taskC = await engine.createNode('Task', { name: 'Task C' })

      await engine.createEdge(taskA.id, 'dependsOn', taskB.id, {})
      await engine.createEdge(taskB.id, 'dependsOn', taskC.id, {})
      await engine.createEdge(taskC.id, 'dependsOn', taskA.id, {}) // Creates cycle

      // Traversal should detect and handle cycle (not infinite loop)
      const result = await engine.traverse({
        start: taskA.id,
        direction: 'OUTGOING',
        maxDepth: 10,
      })

      // Each node should appear only once despite cycle
      const uniqueIds = new Set(result.nodes.map(n => n.id))
      expect(uniqueIds.size).toBe(result.nodes.length)
    })
  })
})

// ============================================================================
// 3. TYPED NODES AND GRAPH TYPE SYSTEM
// ============================================================================

describe('Typed Nodes Graph Operations', () => {
  let engine: GraphEngine

  beforeEach(() => {
    engine = new GraphEngine()
  })

  describe('Type-Based Operations', () => {
    it('creates nodes with type labels', async () => {
      const customer = await engine.createNode('Customer', {
        name: 'Alice',
        email: 'alice@example.com',
      })

      expect(customer.label).toBe('Customer')
    })

    it('queries nodes by label', async () => {
      // Add mixed types
      await engine.createNode('Customer', { name: 'Alice' })
      await engine.createNode('Customer', { name: 'Bob' })
      await engine.createNode('Order', { total: 100 })
      await engine.createNode('Product', { price: 50 })

      // Query only Customers
      const customers = await engine.queryNodes({ label: 'Customer' })

      expect(customers.length).toBe(2)
      expect(customers.every(c => c.label === 'Customer')).toBe(true)
    })

    it('queries edges by type', async () => {
      // Create nodes
      const alice = await engine.createNode('User', {})
      const bob = await engine.createNode('User', {})
      const post = await engine.createNode('Post', {})

      // Create edges with different types
      await engine.createEdge(alice.id, 'follows', bob.id, {})
      await engine.createEdge(alice.id, 'authored', post.id, {})
      await engine.createEdge(bob.id, 'liked', post.id, {})

      // Query only 'follows' relationships
      const followEdges = await engine.queryEdges({ type: 'follows' })

      expect(followEdges.length).toBe(1)
      expect(followEdges[0].from).toBe(alice.id)
    })
  })
})

// ============================================================================
// 4. GRAPH STATISTICS
// ============================================================================

describe('Graph Statistics', () => {
  let engine: GraphEngine

  beforeEach(() => {
    engine = new GraphEngine()
  })

  it('reports accurate node and edge counts', async () => {
    const alice = await engine.createNode('User', { name: 'Alice' })
    const bob = await engine.createNode('User', { name: 'Bob' })
    const team = await engine.createNode('Team', { name: 'Engineering' })

    await engine.createEdge(alice.id, 'follows', bob.id, {})
    await engine.createEdge(alice.id, 'memberOf', team.id, {})

    const stats = await engine.stats()

    expect(stats.nodeCount).toBe(3)
    expect(stats.edgeCount).toBe(2)
  })
})
