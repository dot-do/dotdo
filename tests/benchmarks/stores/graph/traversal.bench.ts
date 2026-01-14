/**
 * GraphStore Traversal Benchmarks
 *
 * GREEN PHASE: Benchmarks for graph operations.
 * Tests edge operations, traversals, and path finding.
 *
 * @see do-z9k - Store Benchmark Implementation
 */

import { describe, bench, beforeAll, afterAll } from 'vitest'
import { GraphGenerator } from '../../datasets/graphs'
import { createMockGraphStore } from '../harness'
import { CostTracker } from '../../framework/cost-tracker'

describe('GraphStore Traversal Benchmarks', () => {
  const generator = new GraphGenerator()
  let store: ReturnType<typeof createMockGraphStore>
  let tracker: CostTracker

  beforeAll(async () => {
    // GREEN: Use mock store - will be replaced with real miniflare instance
    store = createMockGraphStore()
    tracker = new CostTracker()

    // Seed some initial nodes for graph benchmarks
    for (let i = 1; i <= 50; i++) {
      await store.createThing({
        id: `node_${i}`,
        typeId: 1,
        typeName: 'Node',
        data: { name: `Node ${i}`, value: Math.random() * 100 },
      })
    }
    // Create hub and leaf nodes
    await store.createThing({
      id: 'hub_node',
      typeId: 1,
      typeName: 'Node',
      data: { name: 'Hub Node', degree: 'high' },
    })
    await store.createThing({
      id: 'leaf_node',
      typeId: 1,
      typeName: 'Node',
      data: { name: 'Leaf Node', degree: 'low' },
    })
    await store.createThing({
      id: 'thing_1',
      typeId: 1,
      typeName: 'Node',
      data: { name: 'Thing 1' },
    })

    // Seed some relationships
    const edges = generator.generateSync({ size: 100, nodeCount: 50, density: 0.5, seed: 12345 })
    for (const edge of edges) {
      await store.createRelationship({
        verb: 'connected',
        fromId: edge.from,
        toId: edge.to,
        data: { weight: edge.weight },
      })
    }
    // Create specific relationships for tests
    await store.createRelationship({ verb: 'follows', fromId: 'node_1', toId: 'node_2' })
    await store.createRelationship({ verb: 'likes', fromId: 'node_1', toId: 'node_3' })
    await store.createRelationship({ verb: 'purchased', fromId: 'customer_1', toId: 'product_1' })
    // Hub node has many connections
    for (let i = 1; i <= 20; i++) {
      await store.createRelationship({ verb: 'links', fromId: 'hub_node', toId: `node_${i}` })
    }
  })

  afterAll(async () => {
    // Cleanup
  })

  // =========================================================================
  // THING OPERATIONS
  // =========================================================================

  bench('createThing', async () => {
    await store.createThing({
      id: `thing_${Date.now()}`,
      typeId: 1,
      typeName: 'Node',
      data: { name: 'Test Node', value: Math.random() },
    })
  })

  bench('getThing by id', async () => {
    await store.getThing('thing_1')
  })

  bench('getThingsByType', async () => {
    await store.getThingsByType(1, { limit: 100 })
  })

  bench('getThingsByType with cursor', async () => {
    await store.getThingsByType(1, { limit: 100, cursor: 'cursor_id' })
  })

  bench('updateThing', async () => {
    await store.updateThing('thing_1', {
      data: { name: 'Updated', timestamp: Date.now() },
    })
  })

  bench('deleteThing (soft delete)', async () => {
    await store.deleteThing(`thing_to_delete_${Date.now()}`)
  })

  // =========================================================================
  // EDGE/RELATIONSHIP OPERATIONS
  // =========================================================================

  bench('createRelationship (single edge)', async () => {
    await store.createRelationship({
      verb: 'follows',
      fromId: 'node_1',
      toId: 'node_2',
      data: { createdAt: Date.now() },
    })
  })

  bench('createRelationship with complex data', async () => {
    await store.createRelationship({
      verb: 'purchased',
      fromId: 'customer_1',
      toId: 'product_1',
      data: {
        quantity: 5,
        price: 99.99,
        timestamp: Date.now(),
        metadata: { campaign: 'summer_sale' },
      },
    })
  })

  bench('batch create 10 edges', async () => {
    const edges = generator.generateSync({ size: 10, nodeCount: 20, density: 0.5, seed: Date.now() })
    for (const edge of edges) {
      await store.createRelationship({
        verb: edge.type || 'connected',
        fromId: edge.from,
        toId: edge.to,
      })
    }
  })

  bench('batch create 100 edges', async () => {
    const edges = generator.generateSync({ size: 100, nodeCount: 50, density: 0.5, seed: Date.now() })
    for (const edge of edges) {
      await store.createRelationship({
        verb: edge.type || 'connected',
        fromId: edge.from,
        toId: edge.to,
      })
    }
  })

  // =========================================================================
  // RELATIONSHIP QUERIES
  // =========================================================================

  bench('queryRelationshipsFrom - outgoing edges', async () => {
    await store.queryRelationshipsFrom('node_1', {})
  })

  bench('queryRelationshipsFrom with verb filter', async () => {
    await store.queryRelationshipsFrom('node_1', { verb: 'follows' })
  })

  bench('queryRelationshipsFrom with limit', async () => {
    await store.queryRelationshipsFrom('node_1', { limit: 10 })
  })

  bench('queryRelationshipsTo - incoming edges', async () => {
    await store.queryRelationshipsTo('node_1', {})
  })

  bench('queryRelationshipsTo with verb filter', async () => {
    await store.queryRelationshipsTo('node_1', { verb: 'follows' })
  })

  bench('queryRelationshipsByVerb', async () => {
    await store.queryRelationshipsByVerb('follows', { limit: 100 })
  })

  bench('getRelationship by id', async () => {
    await store.getRelationship('rel_1')
  })

  bench('deleteRelationship', async () => {
    await store.deleteRelationship('rel_to_delete')
  })

  // =========================================================================
  // GRAPH TRAVERSALS (via custom implementation)
  // =========================================================================

  bench('BFS traversal - depth 1', async () => {
    // Simulate BFS by querying outgoing edges
    const visited = new Set<string>()
    const queue = ['node_1']
    visited.add('node_1')

    while (queue.length > 0) {
      const nodeId = queue.shift()!
      const edges = await store.queryRelationshipsFrom(nodeId, {})
      for (const edge of edges) {
        if (!visited.has(edge.toId)) {
          visited.add(edge.toId)
          // Stop at depth 1
        }
      }
    }
  })

  bench('BFS traversal - depth 2', async () => {
    const visited = new Set<string>()
    const queue: { id: string; depth: number }[] = [{ id: 'node_1', depth: 0 }]
    visited.add('node_1')

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!
      if (depth >= 2) continue

      const edges = await store.queryRelationshipsFrom(id, {})
      for (const edge of edges) {
        if (!visited.has(edge.toId)) {
          visited.add(edge.toId)
          queue.push({ id: edge.toId, depth: depth + 1 })
        }
      }
    }
  })

  bench('BFS traversal - depth 3', async () => {
    const visited = new Set<string>()
    const queue: { id: string; depth: number }[] = [{ id: 'node_1', depth: 0 }]
    visited.add('node_1')

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!
      if (depth >= 3) continue

      const edges = await store.queryRelationshipsFrom(id, {})
      for (const edge of edges) {
        if (!visited.has(edge.toId)) {
          visited.add(edge.toId)
          queue.push({ id: edge.toId, depth: depth + 1 })
        }
      }
    }
  })

  bench('DFS traversal - depth 3', async () => {
    const visited = new Set<string>()

    async function dfs(nodeId: string, depth: number): Promise<void> {
      if (depth >= 3 || visited.has(nodeId)) return
      visited.add(nodeId)

      const edges = await store.queryRelationshipsFrom(nodeId, {})
      for (const edge of edges) {
        await dfs(edge.toId, depth + 1)
      }
    }

    await dfs('node_1', 0)
  })

  // =========================================================================
  // PATH FINDING (Simulated)
  // =========================================================================

  bench('shortest path - BFS (small graph)', async () => {
    const start = 'node_1'
    const end = 'node_10'

    const visited = new Map<string, string | null>() // node -> parent
    const queue = [start]
    visited.set(start, null)

    while (queue.length > 0) {
      const current = queue.shift()!
      if (current === end) break

      const edges = await store.queryRelationshipsFrom(current, {})
      for (const edge of edges) {
        if (!visited.has(edge.toId)) {
          visited.set(edge.toId, current)
          queue.push(edge.toId)
        }
      }
    }

    // Reconstruct path
    const path: string[] = []
    let node: string | null = end
    while (node) {
      path.unshift(node)
      node = visited.get(node) ?? null
    }
  })

  // =========================================================================
  // BIDIRECTIONAL QUERIES
  // =========================================================================

  bench('get neighbors (in + out)', async () => {
    const [incoming, outgoing] = await Promise.all([
      store.queryRelationshipsTo('node_1', {}),
      store.queryRelationshipsFrom('node_1', {}),
    ])
    const neighbors = new Set([
      ...incoming.map((e) => e.fromId),
      ...outgoing.map((e) => e.toId),
    ])
  })

  bench('get 2-hop neighbors', async () => {
    const firstHop = await store.queryRelationshipsFrom('node_1', {})
    const secondHopPromises = firstHop.map((e) =>
      store.queryRelationshipsFrom(e.toId, {})
    )
    const secondHop = await Promise.all(secondHopPromises)
    const allNeighbors = new Set([
      ...firstHop.map((e) => e.toId),
      ...secondHop.flat().map((e) => e.toId),
    ])
  })

  // =========================================================================
  // TRANSACTION OPERATIONS
  // =========================================================================

  bench('transaction - create node + edges', async () => {
    await store.transaction(async (tx) => {
      await tx.createThing({
        id: `tx_node_${Date.now()}`,
        typeId: 1,
        typeName: 'Node',
        data: { created: true },
      })
      await tx.createRelationship({
        verb: 'links',
        fromId: 'node_1',
        toId: `tx_node_${Date.now()}`,
      })
    })
  })

  // =========================================================================
  // DENSE VS SPARSE GRAPH PATTERNS
  // =========================================================================

  bench('query high-degree node (hub)', async () => {
    // Hub nodes have many connections
    await store.queryRelationshipsFrom('hub_node', { limit: 1000 })
  })

  bench('query low-degree node (leaf)', async () => {
    // Leaf nodes have few connections
    await store.queryRelationshipsFrom('leaf_node', {})
  })

  // =========================================================================
  // TYPED RELATIONSHIP QUERIES
  // =========================================================================

  bench('query by multiple verbs', async () => {
    const results = await Promise.all([
      store.queryRelationshipsByVerb('follows', { limit: 50 }),
      store.queryRelationshipsByVerb('likes', { limit: 50 }),
      store.queryRelationshipsByVerb('purchased', { limit: 50 }),
    ])
  })
})
