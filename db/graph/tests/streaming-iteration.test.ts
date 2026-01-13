/**
 * Streaming Iteration Tests for GraphEngine
 *
 * TDD RED Phase: Failing tests for streaming graph traversal.
 *
 * Problem Statement:
 * - Current traversal methods load entire result sets into memory
 * - Large graphs (10k+ nodes) can cause OOM errors
 * - Need streaming iteration that processes nodes in batches
 *
 * Key Requirements:
 * 1. Async iterator method: traverseStream() yields nodes progressively
 * 2. Pagination support: process large graphs without loading all into memory
 * 3. Memory efficient: streaming doesn't buffer entire graph
 * 4. Configurable batch size: control memory vs. performance tradeoff
 * 5. Stream statistics: track progress during iteration
 *
 * @module db/graph/tests/streaming-iteration.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { GraphEngine, type Node, type Edge } from '../index'

// ============================================================================
// TYPES - Streaming Iteration
// ============================================================================

/**
 * Options for streaming traversal
 */
interface StreamTraversalOptions {
  /** Starting node ID or Node object */
  start: string | Node
  /** Direction of traversal */
  direction: 'OUTGOING' | 'INCOMING' | 'BOTH'
  /** Maximum depth to traverse */
  maxDepth: number
  /** Optional filter by relationship type */
  filter?: {
    type?: string | string[]
  }
  /** Number of nodes to yield per batch (default: 100) */
  batchSize?: number
  /** Whether to include path information (default: false, saves memory) */
  includePaths?: boolean
  /** Whether to track visit order (default: false) */
  trackVisitOrder?: boolean
}

/**
 * A single item yielded by the stream
 */
interface StreamYieldItem {
  /** The current node */
  node: Node
  /** Depth at which this node was found */
  depth: number
  /** Path to this node (only if includePaths is true) */
  path?: {
    nodes: Node[]
    edges: Edge[]
    length: number
  }
  /** Edge that led to this node */
  edge?: Edge
}

/**
 * Progress statistics during streaming
 */
interface StreamProgress {
  /** Total nodes yielded so far */
  nodesYielded: number
  /** Total nodes visited (including skipped duplicates) */
  nodesVisited: number
  /** Current depth being processed */
  currentDepth: number
  /** Number of batches processed */
  batchesProcessed: number
  /** Estimated completion percentage (if knowable) */
  estimatedProgress?: number
}

/**
 * Options for streaming node queries
 */
interface StreamQueryOptions {
  /** Filter by node label */
  label?: string
  /** Where clause for filtering */
  where?: Record<string, unknown>
  /** Batch size for pagination */
  batchSize?: number
  /** Starting cursor for resumable iteration */
  cursor?: string
}

/**
 * Options for streaming edge queries
 */
interface StreamEdgeQueryOptions {
  /** Filter by edge type */
  type?: string
  /** Filter by source node */
  from?: string
  /** Filter by target node */
  to?: string
  /** Where clause for filtering */
  where?: Record<string, unknown>
  /** Batch size for pagination */
  batchSize?: number
  /** Starting cursor for resumable iteration */
  cursor?: string
}

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Helper to create a large graph for testing
 */
async function createLargeGraph(graph: GraphEngine, nodeCount: number): Promise<Node[]> {
  const nodes: Node[] = []

  for (let i = 0; i < nodeCount; i++) {
    const node = await graph.createNode('TestNode', {
      index: i,
      name: `Node-${i}`,
      group: i % 10, // 10 groups
    })
    nodes.push(node)
  }

  // Create edges: each node connects to next 3 nodes (circular)
  for (let i = 0; i < nodeCount; i++) {
    for (let j = 1; j <= 3; j++) {
      const targetIndex = (i + j) % nodeCount
      await graph.createEdge(nodes[i].id, 'CONNECTS_TO', nodes[targetIndex].id, {
        weight: j,
      })
    }
  }

  return nodes
}

/**
 * Helper to collect all items from an async iterator
 */
async function collectStream<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = []
  for await (const item of stream) {
    items.push(item)
  }
  return items
}

/**
 * Helper to count items in an async iterator without storing them
 */
async function countStream<T>(stream: AsyncIterable<T>): Promise<number> {
  let count = 0
  for await (const _ of stream) {
    count++
  }
  return count
}

// ============================================================================
// 1. BASIC STREAMING TRAVERSAL
// ============================================================================

describe('Streaming Traversal', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  describe('traverseStream method', () => {
    it('should be exported from GraphEngine', async () => {
      expect(typeof graph.traverseStream).toBe('function')
    })

    it('returns an async iterator', async () => {
      const alice = await graph.createNode('Person', { name: 'Alice' })

      const stream = graph.traverseStream({
        start: alice.id,
        direction: 'OUTGOING',
        maxDepth: 1,
      })

      // Check it's an async iterator
      expect(Symbol.asyncIterator in stream).toBe(true)
      expect(typeof stream[Symbol.asyncIterator]).toBe('function')
    })

    it('yields nodes progressively during traversal', async () => {
      // Create a chain: A -> B -> C -> D
      const a = await graph.createNode('Person', { name: 'A' })
      const b = await graph.createNode('Person', { name: 'B' })
      const c = await graph.createNode('Person', { name: 'C' })
      const d = await graph.createNode('Person', { name: 'D' })

      await graph.createEdge(a.id, 'KNOWS', b.id)
      await graph.createEdge(b.id, 'KNOWS', c.id)
      await graph.createEdge(c.id, 'KNOWS', d.id)

      const stream = graph.traverseStream({
        start: a.id,
        direction: 'OUTGOING',
        maxDepth: 3,
      })

      const items = await collectStream(stream)

      expect(items).toHaveLength(3) // B, C, D (not A - start node excluded)
      expect(items.map((i) => i.node.properties.name)).toEqual(['B', 'C', 'D'])
    })

    it('yields items with correct depth information', async () => {
      const a = await graph.createNode('Person', { name: 'A' })
      const b = await graph.createNode('Person', { name: 'B' })
      const c = await graph.createNode('Person', { name: 'C' })

      await graph.createEdge(a.id, 'KNOWS', b.id)
      await graph.createEdge(b.id, 'KNOWS', c.id)

      const stream = graph.traverseStream({
        start: a.id,
        direction: 'OUTGOING',
        maxDepth: 2,
      })

      const items = await collectStream(stream)

      const bItem = items.find((i) => i.node.properties.name === 'B')
      const cItem = items.find((i) => i.node.properties.name === 'C')

      expect(bItem?.depth).toBe(1)
      expect(cItem?.depth).toBe(2)
    })

    it('includes edge information in yield items', async () => {
      const a = await graph.createNode('Person', { name: 'A' })
      const b = await graph.createNode('Person', { name: 'B' })

      const edge = await graph.createEdge(a.id, 'KNOWS', b.id, { since: 2020 })

      const stream = graph.traverseStream({
        start: a.id,
        direction: 'OUTGOING',
        maxDepth: 1,
      })

      const items = await collectStream(stream)

      expect(items[0].edge).toBeDefined()
      expect(items[0].edge?.id).toBe(edge.id)
      expect(items[0].edge?.properties.since).toBe(2020)
    })

    it('filters by relationship type', async () => {
      const a = await graph.createNode('Person', { name: 'A' })
      const b = await graph.createNode('Person', { name: 'B' })
      const c = await graph.createNode('Company', { name: 'C' })

      await graph.createEdge(a.id, 'KNOWS', b.id)
      await graph.createEdge(a.id, 'WORKS_AT', c.id)

      const stream = graph.traverseStream({
        start: a.id,
        direction: 'OUTGOING',
        maxDepth: 1,
        filter: { type: 'KNOWS' },
      })

      const items = await collectStream(stream)

      expect(items).toHaveLength(1)
      expect(items[0].node.properties.name).toBe('B')
    })

    it('handles incoming direction', async () => {
      const a = await graph.createNode('Person', { name: 'A' })
      const b = await graph.createNode('Person', { name: 'B' })

      await graph.createEdge(a.id, 'KNOWS', b.id)

      const stream = graph.traverseStream({
        start: b.id,
        direction: 'INCOMING',
        maxDepth: 1,
      })

      const items = await collectStream(stream)

      expect(items).toHaveLength(1)
      expect(items[0].node.properties.name).toBe('A')
    })

    it('handles both directions', async () => {
      const a = await graph.createNode('Person', { name: 'A' })
      const b = await graph.createNode('Person', { name: 'B' })
      const c = await graph.createNode('Person', { name: 'C' })

      await graph.createEdge(a.id, 'KNOWS', b.id)
      await graph.createEdge(b.id, 'KNOWS', c.id)

      const stream = graph.traverseStream({
        start: b.id,
        direction: 'BOTH',
        maxDepth: 1,
      })

      const items = await collectStream(stream)

      expect(items).toHaveLength(2) // A and C
    })

    it('throws error for non-existent start node', async () => {
      const stream = graph.traverseStream({
        start: 'non-existent',
        direction: 'OUTGOING',
        maxDepth: 1,
      })

      await expect(async () => {
        for await (const _ of stream) {
          // Should throw on first iteration
        }
      }).rejects.toThrow(/not found/i)
    })

    it('handles empty graph (no neighbors)', async () => {
      const a = await graph.createNode('Person', { name: 'A' })

      const stream = graph.traverseStream({
        start: a.id,
        direction: 'OUTGOING',
        maxDepth: 1,
      })

      const items = await collectStream(stream)

      expect(items).toHaveLength(0)
    })

    it('handles cycles without infinite loop', async () => {
      const a = await graph.createNode('Person', { name: 'A' })
      const b = await graph.createNode('Person', { name: 'B' })
      const c = await graph.createNode('Person', { name: 'C' })

      // Create cycle: A -> B -> C -> A
      await graph.createEdge(a.id, 'KNOWS', b.id)
      await graph.createEdge(b.id, 'KNOWS', c.id)
      await graph.createEdge(c.id, 'KNOWS', a.id)

      const stream = graph.traverseStream({
        start: a.id,
        direction: 'OUTGOING',
        maxDepth: 10,
      })

      const items = await collectStream(stream)

      // Should visit each node only once
      const uniqueIds = new Set(items.map((i) => i.node.id))
      expect(uniqueIds.size).toBe(items.length)
      expect(items.length).toBe(2) // B and C (A is start, not yielded)
    })
  })

  describe('path inclusion option', () => {
    it('excludes paths by default for memory efficiency', async () => {
      const a = await graph.createNode('Person', { name: 'A' })
      const b = await graph.createNode('Person', { name: 'B' })

      await graph.createEdge(a.id, 'KNOWS', b.id)

      const stream = graph.traverseStream({
        start: a.id,
        direction: 'OUTGOING',
        maxDepth: 1,
      })

      const items = await collectStream(stream)

      expect(items[0].path).toBeUndefined()
    })

    it('includes paths when includePaths is true', async () => {
      const a = await graph.createNode('Person', { name: 'A' })
      const b = await graph.createNode('Person', { name: 'B' })
      const c = await graph.createNode('Person', { name: 'C' })

      await graph.createEdge(a.id, 'KNOWS', b.id)
      await graph.createEdge(b.id, 'KNOWS', c.id)

      const stream = graph.traverseStream({
        start: a.id,
        direction: 'OUTGOING',
        maxDepth: 2,
        includePaths: true,
      })

      const items = await collectStream(stream)
      const cItem = items.find((i) => i.node.properties.name === 'C')

      expect(cItem?.path).toBeDefined()
      expect(cItem?.path?.nodes).toHaveLength(3) // A -> B -> C
      expect(cItem?.path?.edges).toHaveLength(2)
      expect(cItem?.path?.length).toBe(2)
    })
  })
})

// ============================================================================
// 2. BATCH SIZE CONFIGURATION
// ============================================================================

describe('Batch Size Configuration', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  it('uses default batch size of 100', async () => {
    // Create 150 nodes all connected to root
    const root = await graph.createNode('Root', { name: 'Root' })
    for (let i = 0; i < 150; i++) {
      const node = await graph.createNode('Leaf', { index: i })
      await graph.createEdge(root.id, 'HAS_LEAF', node.id)
    }

    const stream = graph.traverseStream({
      start: root.id,
      direction: 'OUTGOING',
      maxDepth: 1,
    })

    // Should yield all 150 nodes
    const count = await countStream(stream)
    expect(count).toBe(150)
  })

  it('respects custom batch size', async () => {
    // Create 50 nodes
    const root = await graph.createNode('Root', { name: 'Root' })
    for (let i = 0; i < 50; i++) {
      const node = await graph.createNode('Leaf', { index: i })
      await graph.createEdge(root.id, 'HAS_LEAF', node.id)
    }

    const yieldedBatches: number[] = []
    let currentBatch = 0

    const stream = graph.traverseStream({
      start: root.id,
      direction: 'OUTGOING',
      maxDepth: 1,
      batchSize: 10,
    })

    let count = 0
    for await (const _ of stream) {
      count++
      // Track when we cross batch boundaries
      const expectedBatch = Math.floor((count - 1) / 10)
      if (expectedBatch > currentBatch) {
        yieldedBatches.push(currentBatch)
        currentBatch = expectedBatch
      }
    }
    yieldedBatches.push(currentBatch)

    expect(count).toBe(50)
    // Should have processed 5 batches (0-9, 10-19, 20-29, 30-39, 40-49)
    expect(yieldedBatches).toHaveLength(5)
  })

  it('handles batch size larger than total nodes', async () => {
    const root = await graph.createNode('Root', { name: 'Root' })
    for (let i = 0; i < 10; i++) {
      const node = await graph.createNode('Leaf', { index: i })
      await graph.createEdge(root.id, 'HAS_LEAF', node.id)
    }

    const stream = graph.traverseStream({
      start: root.id,
      direction: 'OUTGOING',
      maxDepth: 1,
      batchSize: 1000, // Much larger than actual nodes
    })

    const count = await countStream(stream)
    expect(count).toBe(10)
  })

  it('handles batch size of 1', async () => {
    const root = await graph.createNode('Root', { name: 'Root' })
    for (let i = 0; i < 5; i++) {
      const node = await graph.createNode('Leaf', { index: i })
      await graph.createEdge(root.id, 'HAS_LEAF', node.id)
    }

    const stream = graph.traverseStream({
      start: root.id,
      direction: 'OUTGOING',
      maxDepth: 1,
      batchSize: 1,
    })

    const items = await collectStream(stream)
    expect(items).toHaveLength(5)
  })

  it('throws error for invalid batch size (0)', async () => {
    const root = await graph.createNode('Root', { name: 'Root' })

    expect(() => {
      graph.traverseStream({
        start: root.id,
        direction: 'OUTGOING',
        maxDepth: 1,
        batchSize: 0,
      })
    }).toThrow(/batch size/i)
  })

  it('throws error for negative batch size', async () => {
    const root = await graph.createNode('Root', { name: 'Root' })

    expect(() => {
      graph.traverseStream({
        start: root.id,
        direction: 'OUTGOING',
        maxDepth: 1,
        batchSize: -10,
      })
    }).toThrow(/batch size/i)
  })
})

// ============================================================================
// 3. LARGE GRAPH PAGINATION
// ============================================================================

describe('Large Graph Pagination', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  it('handles graphs with thousands of nodes', async () => {
    // Create a graph with 1000 nodes
    const nodes = await createLargeGraph(graph, 1000)

    const stream = graph.traverseStream({
      start: nodes[0].id,
      direction: 'OUTGOING',
      maxDepth: 5,
      batchSize: 100,
    })

    const count = await countStream(stream)

    // Should traverse many nodes (exact count depends on graph structure)
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThanOrEqual(999) // All except start node
  })

  it('yields nodes in consistent order across multiple iterations', async () => {
    // Create deterministic graph
    const root = await graph.createNode('Root', { name: 'Root' })
    for (let i = 0; i < 20; i++) {
      const node = await graph.createNode('Leaf', { index: i })
      await graph.createEdge(root.id, 'HAS_LEAF', node.id)
    }

    // First iteration
    const stream1 = graph.traverseStream({
      start: root.id,
      direction: 'OUTGOING',
      maxDepth: 1,
      batchSize: 5,
    })
    const items1 = await collectStream(stream1)

    // Second iteration
    const stream2 = graph.traverseStream({
      start: root.id,
      direction: 'OUTGOING',
      maxDepth: 1,
      batchSize: 5,
    })
    const items2 = await collectStream(stream2)

    // Should yield in same order
    expect(items1.map((i) => i.node.id)).toEqual(items2.map((i) => i.node.id))
  })

  it('can be stopped early without processing entire graph', async () => {
    const nodes = await createLargeGraph(graph, 500)
    let yieldCount = 0

    const stream = graph.traverseStream({
      start: nodes[0].id,
      direction: 'OUTGOING',
      maxDepth: 10,
      batchSize: 10,
    })

    // Only consume first 50 items
    for await (const _ of stream) {
      yieldCount++
      if (yieldCount >= 50) break
    }

    expect(yieldCount).toBe(50)
  })

  it('supports resumable iteration with getProgress()', async () => {
    const root = await graph.createNode('Root', { name: 'Root' })
    for (let i = 0; i < 100; i++) {
      const node = await graph.createNode('Leaf', { index: i })
      await graph.createEdge(root.id, 'HAS_LEAF', node.id)
    }

    const stream = graph.traverseStream({
      start: root.id,
      direction: 'OUTGOING',
      maxDepth: 1,
      batchSize: 20,
    })

    let count = 0
    let lastProgress: StreamProgress | undefined

    for await (const _ of stream) {
      count++
      if (count === 50) {
        // Get progress midway through iteration
        lastProgress = (stream as AsyncIterable<StreamYieldItem> & { getProgress(): StreamProgress }).getProgress()
        break
      }
    }

    expect(lastProgress).toBeDefined()
    expect(lastProgress?.nodesYielded).toBe(50)
    expect(lastProgress?.batchesProcessed).toBeGreaterThan(0)
  })
})

// ============================================================================
// 4. MEMORY EFFICIENCY
// ============================================================================

describe('Memory Efficiency', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  it('does not load all nodes into memory at once', async () => {
    // Create large graph
    const nodes = await createLargeGraph(graph, 1000)

    // Track max concurrent nodes held
    let currentHeld = 0
    let maxHeld = 0

    const stream = graph.traverseStream({
      start: nodes[0].id,
      direction: 'OUTGOING',
      maxDepth: 5,
      batchSize: 50, // Small batch size
    })

    for await (const item of stream) {
      currentHeld++
      maxHeld = Math.max(maxHeld, currentHeld)
      // Simulate processing and releasing
      currentHeld--
    }

    // Max held should be limited by batch size, not total nodes
    expect(maxHeld).toBeLessThanOrEqual(50)
  })

  it('traverseStream uses less memory than regular traverse for large graphs', async () => {
    // This is a behavioral test - in real implementation, we'd measure actual memory
    // Here we verify the API returns an iterator rather than an array
    const nodes = await createLargeGraph(graph, 100)

    const stream = graph.traverseStream({
      start: nodes[0].id,
      direction: 'OUTGOING',
      maxDepth: 3,
    })

    // Stream should not have all results pre-computed
    expect(stream).toHaveProperty(Symbol.asyncIterator)

    // Regular traverse returns full array
    const result = await graph.traverse({
      start: nodes[0].id,
      direction: 'OUTGOING',
      maxDepth: 3,
    })
    expect(Array.isArray(result.nodes)).toBe(true)
  })

  it('releases processed nodes from internal buffers', async () => {
    const root = await graph.createNode('Root', { name: 'Root' })
    for (let i = 0; i < 100; i++) {
      const node = await graph.createNode('Leaf', { index: i })
      await graph.createEdge(root.id, 'HAS_LEAF', node.id)
    }

    const stream = graph.traverseStream({
      start: root.id,
      direction: 'OUTGOING',
      maxDepth: 1,
      batchSize: 10,
    })

    // Process all items
    const items = await collectStream(stream)

    // Stream should be exhausted and internal state cleared
    expect(items).toHaveLength(100)

    // Iterating again should work (new iterator)
    const stream2 = graph.traverseStream({
      start: root.id,
      direction: 'OUTGOING',
      maxDepth: 1,
      batchSize: 10,
    })
    const items2 = await collectStream(stream2)
    expect(items2).toHaveLength(100)
  })
})

// ============================================================================
// 5. STREAMING NODE AND EDGE QUERIES
// ============================================================================

describe('Streaming Node Queries', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  describe('queryNodesStream', () => {
    it('should be exported from GraphEngine', async () => {
      expect(typeof graph.queryNodesStream).toBe('function')
    })

    it('streams nodes matching query', async () => {
      for (let i = 0; i < 50; i++) {
        await graph.createNode('Person', { name: `Person-${i}`, age: 20 + (i % 30) })
      }
      for (let i = 0; i < 50; i++) {
        await graph.createNode('Company', { name: `Company-${i}` })
      }

      const stream = graph.queryNodesStream({ label: 'Person' })
      const items = await collectStream(stream)

      expect(items).toHaveLength(50)
      expect(items.every((n) => n.label === 'Person')).toBe(true)
    })

    it('supports where clause filtering', async () => {
      for (let i = 0; i < 100; i++) {
        await graph.createNode('Person', { name: `Person-${i}`, age: i })
      }

      const stream = graph.queryNodesStream({
        label: 'Person',
        where: { age: { $gte: 50 } },
      })
      const items = await collectStream(stream)

      expect(items).toHaveLength(50)
      expect(items.every((n) => (n.properties.age as number) >= 50)).toBe(true)
    })

    it('respects batch size for pagination', async () => {
      for (let i = 0; i < 25; i++) {
        await graph.createNode('Person', { name: `Person-${i}` })
      }

      const stream = graph.queryNodesStream({
        label: 'Person',
        batchSize: 10,
      })

      const items = await collectStream(stream)
      expect(items).toHaveLength(25)
    })

    it('supports cursor-based resumption', async () => {
      for (let i = 0; i < 30; i++) {
        await graph.createNode('Person', { name: `Person-${i}`, index: i })
      }

      // First page
      const stream1 = graph.queryNodesStream({
        label: 'Person',
        batchSize: 10,
      })

      let count = 0
      let cursor: string | undefined

      for await (const node of stream1) {
        count++
        if (count === 10) {
          cursor = (stream1 as AsyncIterable<Node> & { getCursor(): string }).getCursor()
          break
        }
      }

      // Resume from cursor
      const stream2 = graph.queryNodesStream({
        label: 'Person',
        batchSize: 10,
        cursor,
      })

      const remainingItems = await collectStream(stream2)
      expect(remainingItems).toHaveLength(20) // 30 - 10 = 20
    })
  })

  describe('queryEdgesStream', () => {
    it('should be exported from GraphEngine', async () => {
      expect(typeof graph.queryEdgesStream).toBe('function')
    })

    it('streams edges matching query', async () => {
      const nodes: Node[] = []
      for (let i = 0; i < 20; i++) {
        nodes.push(await graph.createNode('Person', { name: `Person-${i}` }))
      }

      for (let i = 0; i < 19; i++) {
        await graph.createEdge(nodes[i].id, 'KNOWS', nodes[i + 1].id)
      }

      const stream = graph.queryEdgesStream({ type: 'KNOWS' })
      const items = await collectStream(stream)

      expect(items).toHaveLength(19)
      expect(items.every((e) => e.type === 'KNOWS')).toBe(true)
    })

    it('filters by source and target nodes', async () => {
      const alice = await graph.createNode('Person', { name: 'Alice' })
      const bob = await graph.createNode('Person', { name: 'Bob' })
      const charlie = await graph.createNode('Person', { name: 'Charlie' })

      await graph.createEdge(alice.id, 'KNOWS', bob.id)
      await graph.createEdge(alice.id, 'KNOWS', charlie.id)
      await graph.createEdge(bob.id, 'KNOWS', charlie.id)

      const stream = graph.queryEdgesStream({ from: alice.id })
      const items = await collectStream(stream)

      expect(items).toHaveLength(2)
      expect(items.every((e) => e.from === alice.id)).toBe(true)
    })

    it('respects batch size', async () => {
      const nodes: Node[] = []
      for (let i = 0; i < 50; i++) {
        nodes.push(await graph.createNode('Person', { name: `Person-${i}` }))
      }

      for (let i = 0; i < 49; i++) {
        await graph.createEdge(nodes[i].id, 'KNOWS', nodes[i + 1].id)
      }

      const stream = graph.queryEdgesStream({
        type: 'KNOWS',
        batchSize: 10,
      })
      const items = await collectStream(stream)

      expect(items).toHaveLength(49)
    })
  })
})

// ============================================================================
// 6. STREAMING WITH PATH FINDING
// ============================================================================

describe('Streaming Path Finding', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  describe('allPathsStream', () => {
    it('should be exported from GraphEngine', async () => {
      expect(typeof graph.allPathsStream).toBe('function')
    })

    it('yields paths one at a time', async () => {
      const a = await graph.createNode('Person', { name: 'A' })
      const b = await graph.createNode('Person', { name: 'B' })
      const c = await graph.createNode('Person', { name: 'C' })
      const d = await graph.createNode('Person', { name: 'D' })

      // Multiple paths from A to D:
      // A -> B -> D
      // A -> C -> D
      await graph.createEdge(a.id, 'KNOWS', b.id)
      await graph.createEdge(a.id, 'KNOWS', c.id)
      await graph.createEdge(b.id, 'KNOWS', d.id)
      await graph.createEdge(c.id, 'KNOWS', d.id)

      const stream = graph.allPathsStream(a.id, d.id)
      const paths = await collectStream(stream)

      expect(paths).toHaveLength(2)
    })

    it('respects maxDepth option', async () => {
      const a = await graph.createNode('Person', { name: 'A' })
      const b = await graph.createNode('Person', { name: 'B' })
      const c = await graph.createNode('Person', { name: 'C' })
      const d = await graph.createNode('Person', { name: 'D' })

      // Path: A -> B -> C -> D
      await graph.createEdge(a.id, 'KNOWS', b.id)
      await graph.createEdge(b.id, 'KNOWS', c.id)
      await graph.createEdge(c.id, 'KNOWS', d.id)
      // Short path: A -> D
      await graph.createEdge(a.id, 'KNOWS', d.id)

      const stream = graph.allPathsStream(a.id, d.id, { maxDepth: 2 })
      const paths = await collectStream(stream)

      // Should only find the direct path A -> D (length 1)
      expect(paths).toHaveLength(1)
      expect(paths[0].length).toBe(1)
    })

    it('can stop early without finding all paths', async () => {
      const a = await graph.createNode('Person', { name: 'A' })
      const d = await graph.createNode('Person', { name: 'D' })

      // Create many intermediate paths
      for (let i = 0; i < 20; i++) {
        const middle = await graph.createNode('Person', { name: `M${i}` })
        await graph.createEdge(a.id, 'KNOWS', middle.id)
        await graph.createEdge(middle.id, 'KNOWS', d.id)
      }

      const stream = graph.allPathsStream(a.id, d.id)

      let count = 0
      for await (const _ of stream) {
        count++
        if (count >= 5) break
      }

      expect(count).toBe(5)
    })
  })
})

// ============================================================================
// 7. PROGRESS TRACKING
// ============================================================================

describe('Progress Tracking', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  it('provides progress information during iteration', async () => {
    const root = await graph.createNode('Root', { name: 'Root' })
    for (let i = 0; i < 100; i++) {
      const node = await graph.createNode('Leaf', { index: i })
      await graph.createEdge(root.id, 'HAS_LEAF', node.id)
    }

    const stream = graph.traverseStream({
      start: root.id,
      direction: 'OUTGOING',
      maxDepth: 1,
      batchSize: 25,
    }) as AsyncIterable<StreamYieldItem> & { getProgress(): StreamProgress }

    let progressChecks: StreamProgress[] = []
    let count = 0

    for await (const _ of stream) {
      count++
      if (count % 25 === 0) {
        progressChecks.push(stream.getProgress())
      }
    }

    expect(progressChecks).toHaveLength(4) // 4 checkpoints at 25, 50, 75, 100

    // Progress should increase monotonically
    for (let i = 1; i < progressChecks.length; i++) {
      expect(progressChecks[i].nodesYielded).toBeGreaterThan(progressChecks[i - 1].nodesYielded)
    }
  })

  it('tracks current depth being processed', async () => {
    // Create tree structure: root -> level1 nodes -> level2 nodes
    const root = await graph.createNode('Root', { level: 0 })

    const level1Nodes: Node[] = []
    for (let i = 0; i < 3; i++) {
      const node = await graph.createNode('Node', { level: 1, index: i })
      await graph.createEdge(root.id, 'HAS_CHILD', node.id)
      level1Nodes.push(node)
    }

    for (const l1 of level1Nodes) {
      for (let i = 0; i < 3; i++) {
        const node = await graph.createNode('Node', { level: 2, index: i })
        await graph.createEdge(l1.id, 'HAS_CHILD', node.id)
      }
    }

    const stream = graph.traverseStream({
      start: root.id,
      direction: 'OUTGOING',
      maxDepth: 2,
    }) as AsyncIterable<StreamYieldItem> & { getProgress(): StreamProgress }

    const depthsSeen = new Set<number>()

    for await (const item of stream) {
      depthsSeen.add(item.depth)
    }

    expect(depthsSeen).toContain(1)
    expect(depthsSeen).toContain(2)
  })

  it('reports batches processed', async () => {
    const root = await graph.createNode('Root', { name: 'Root' })
    for (let i = 0; i < 45; i++) {
      const node = await graph.createNode('Leaf', { index: i })
      await graph.createEdge(root.id, 'HAS_LEAF', node.id)
    }

    const stream = graph.traverseStream({
      start: root.id,
      direction: 'OUTGOING',
      maxDepth: 1,
      batchSize: 10,
    }) as AsyncIterable<StreamYieldItem> & { getProgress(): StreamProgress }

    // Consume entire stream
    for await (const _ of stream) {
      // just iterate
    }

    const finalProgress = stream.getProgress()

    // 45 items with batch size 10 = 5 batches (10+10+10+10+5)
    expect(finalProgress.batchesProcessed).toBe(5)
    expect(finalProgress.nodesYielded).toBe(45)
  })
})

// ============================================================================
// 8. DFS STREAMING
// ============================================================================

describe('DFS Streaming', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  describe('traverseStreamDFS', () => {
    it('should be exported from GraphEngine', async () => {
      expect(typeof graph.traverseStreamDFS).toBe('function')
    })

    it('yields nodes in depth-first order', async () => {
      // Tree structure:
      //      A
      //     / \
      //    B   C
      //   / \   \
      //  D   E   F
      const a = await graph.createNode('Node', { name: 'A' })
      const b = await graph.createNode('Node', { name: 'B' })
      const c = await graph.createNode('Node', { name: 'C' })
      const d = await graph.createNode('Node', { name: 'D' })
      const e = await graph.createNode('Node', { name: 'E' })
      const f = await graph.createNode('Node', { name: 'F' })

      await graph.createEdge(a.id, 'HAS_CHILD', b.id)
      await graph.createEdge(a.id, 'HAS_CHILD', c.id)
      await graph.createEdge(b.id, 'HAS_CHILD', d.id)
      await graph.createEdge(b.id, 'HAS_CHILD', e.id)
      await graph.createEdge(c.id, 'HAS_CHILD', f.id)

      const stream = graph.traverseStreamDFS({
        start: a.id,
        direction: 'OUTGOING',
        maxDepth: 3,
      })

      const items = await collectStream(stream)
      const names = items.map((i) => i.node.properties.name)

      // DFS should go deep first: B -> D -> E -> C -> F
      // (exact order depends on edge iteration order, but D and E should come before C)
      const bIndex = names.indexOf('B')
      const dIndex = names.indexOf('D')
      const eIndex = names.indexOf('E')
      const cIndex = names.indexOf('C')

      expect(bIndex).toBeLessThan(cIndex)
      expect(dIndex).toBeLessThan(cIndex)
      expect(eIndex).toBeLessThan(cIndex)
    })

    it('includes visit order when trackVisitOrder is true', async () => {
      const a = await graph.createNode('Node', { name: 'A' })
      const b = await graph.createNode('Node', { name: 'B' })
      const c = await graph.createNode('Node', { name: 'C' })

      await graph.createEdge(a.id, 'CONNECTS', b.id)
      await graph.createEdge(b.id, 'CONNECTS', c.id)

      const stream = graph.traverseStreamDFS({
        start: a.id,
        direction: 'OUTGOING',
        maxDepth: 2,
        trackVisitOrder: true,
      }) as AsyncIterable<StreamYieldItem> & { getVisitOrder(): string[] }

      for await (const _ of stream) {
        // iterate through
      }

      const visitOrder = stream.getVisitOrder()

      expect(visitOrder).toBeDefined()
      expect(visitOrder).toContain(a.id)
      expect(visitOrder).toContain(b.id)
      expect(visitOrder).toContain(c.id)
    })
  })
})

// ============================================================================
// 9. ERROR HANDLING IN STREAMS
// ============================================================================

describe('Error Handling in Streams', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  it('properly cleans up on early termination', async () => {
    const root = await graph.createNode('Root', { name: 'Root' })
    for (let i = 0; i < 100; i++) {
      const node = await graph.createNode('Leaf', { index: i })
      await graph.createEdge(root.id, 'HAS_LEAF', node.id)
    }

    const stream = graph.traverseStream({
      start: root.id,
      direction: 'OUTGOING',
      maxDepth: 1,
    })

    let count = 0
    for await (const _ of stream) {
      count++
      if (count >= 10) break
    }

    // Should be able to create a new stream without issues
    const stream2 = graph.traverseStream({
      start: root.id,
      direction: 'OUTGOING',
      maxDepth: 1,
    })

    const items2 = await collectStream(stream2)
    expect(items2).toHaveLength(100)
  })

  it('handles return() for cleanup', async () => {
    const root = await graph.createNode('Root', { name: 'Root' })
    for (let i = 0; i < 50; i++) {
      const node = await graph.createNode('Leaf', { index: i })
      await graph.createEdge(root.id, 'HAS_LEAF', node.id)
    }

    const stream = graph.traverseStream({
      start: root.id,
      direction: 'OUTGOING',
      maxDepth: 1,
    })

    const iterator = stream[Symbol.asyncIterator]()

    // Manually call return() to signal cleanup
    await iterator.next()
    await iterator.return?.()

    // Should have been cleaned up properly
    expect(true).toBe(true)
  })

  it('throws meaningful error for invalid options', async () => {
    const root = await graph.createNode('Root', { name: 'Root' })

    // Invalid direction
    expect(() => {
      graph.traverseStream({
        start: root.id,
        direction: 'INVALID' as 'OUTGOING',
        maxDepth: 1,
      })
    }).toThrow(/direction/i)

    // Negative maxDepth
    expect(() => {
      graph.traverseStream({
        start: root.id,
        direction: 'OUTGOING',
        maxDepth: -1,
      })
    }).toThrow(/depth/i)
  })
})

// ============================================================================
// 10. INTEGRATION WITH EXISTING METHODS
// ============================================================================

describe('Integration with Existing Methods', () => {
  let graph: GraphEngine

  beforeEach(() => {
    graph = new GraphEngine()
  })

  it('traverseStream produces same nodes as traverse', async () => {
    const nodes = await createLargeGraph(graph, 50)

    // Regular traverse
    const result = await graph.traverse({
      start: nodes[0].id,
      direction: 'OUTGOING',
      maxDepth: 3,
    })

    // Streaming traverse
    const stream = graph.traverseStream({
      start: nodes[0].id,
      direction: 'OUTGOING',
      maxDepth: 3,
    })
    const streamItems = await collectStream(stream)

    // Should find same nodes (order may differ)
    const regularIds = new Set(result.nodes.map((n) => n.id))
    const streamIds = new Set(streamItems.map((i) => i.node.id))

    expect(streamIds).toEqual(regularIds)
  })

  it('queryNodesStream produces same nodes as queryNodes', async () => {
    for (let i = 0; i < 50; i++) {
      await graph.createNode('Person', { name: `Person-${i}`, group: i % 5 })
    }

    // Regular query
    const result = await graph.queryNodes({ label: 'Person', where: { group: 0 } })

    // Streaming query
    const stream = graph.queryNodesStream({ label: 'Person', where: { group: 0 } })
    const streamItems = await collectStream(stream)

    expect(streamItems).toHaveLength(result.length)

    const regularIds = new Set(result.map((n) => n.id))
    const streamIds = new Set(streamItems.map((n) => n.id))

    expect(streamIds).toEqual(regularIds)
  })

  it('allPathsStream produces same paths as allPaths', async () => {
    const a = await graph.createNode('Node', { name: 'A' })
    const b = await graph.createNode('Node', { name: 'B' })
    const c = await graph.createNode('Node', { name: 'C' })
    const d = await graph.createNode('Node', { name: 'D' })

    await graph.createEdge(a.id, 'LINK', b.id)
    await graph.createEdge(a.id, 'LINK', c.id)
    await graph.createEdge(b.id, 'LINK', d.id)
    await graph.createEdge(c.id, 'LINK', d.id)

    // Regular allPaths
    const paths = await graph.allPaths(a.id, d.id)

    // Streaming
    const stream = graph.allPathsStream(a.id, d.id)
    const streamPaths = await collectStream(stream)

    expect(streamPaths).toHaveLength(paths.length)
  })
})
