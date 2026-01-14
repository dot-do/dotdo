/**
 * LineageTraversal Tests - Graph Traversal for DrizzleLineageStore
 *
 * Tests for efficient graph traversal algorithms using recursive CTEs.
 * Covers upstream/downstream queries, path finding, and cycle detection.
 *
 * @module db/primitives/lineage-tracker/tests/traversal
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { DrizzleLineageStore, createDrizzleLineageStore } from '../store'
import { LineageTraversalDrizzle, createLineageTraversalDrizzle } from '../traversal'
import { LINEAGE_DRIZZLE_SCHEMA } from '../schema'
import type { LineageNode, LineageGraph, LineagePath } from '../types'

// =============================================================================
// TEST UTILITIES
// =============================================================================

interface TestContext {
  sqlite: Database.Database
  db: BetterSQLite3Database
  store: DrizzleLineageStore
  traversal: LineageTraversalDrizzle
}

function createTestContext(): TestContext {
  const sqlite = new Database(':memory:')
  sqlite.exec(LINEAGE_DRIZZLE_SCHEMA)
  const db = drizzle(sqlite)
  const store = createDrizzleLineageStore(db)
  const traversal = createLineageTraversalDrizzle(store)
  return { sqlite, db, store, traversal }
}

/**
 * Creates a simple linear graph: A -> B -> C -> D
 */
async function createLinearGraph(store: DrizzleLineageStore): Promise<{
  nodes: Record<string, LineageNode>
}> {
  const a = await store.createNode({ id: 'A', type: 'source', name: 'Source A' })
  const b = await store.createNode({ id: 'B', type: 'transformation', name: 'Transform B' })
  const c = await store.createNode({ id: 'C', type: 'transformation', name: 'Transform C' })
  const d = await store.createNode({ id: 'D', type: 'sink', name: 'Sink D' })

  await store.createEdge({ fromNodeId: 'A', toNodeId: 'B', operation: 'read' })
  await store.createEdge({ fromNodeId: 'B', toNodeId: 'C', operation: 'process' })
  await store.createEdge({ fromNodeId: 'C', toNodeId: 'D', operation: 'write' })

  return { nodes: { A: a, B: b, C: c, D: d } }
}

/**
 * Creates a diamond-shaped graph:
 *       A
 *      / \
 *     B   C
 *      \ /
 *       D
 */
async function createDiamondGraph(store: DrizzleLineageStore): Promise<{
  nodes: Record<string, LineageNode>
}> {
  const a = await store.createNode({ id: 'A', type: 'source', name: 'Source A' })
  const b = await store.createNode({ id: 'B', type: 'transformation', name: 'Path B' })
  const c = await store.createNode({ id: 'C', type: 'transformation', name: 'Path C' })
  const d = await store.createNode({ id: 'D', type: 'sink', name: 'Sink D' })

  await store.createEdge({ fromNodeId: 'A', toNodeId: 'B', operation: 'fork1' })
  await store.createEdge({ fromNodeId: 'A', toNodeId: 'C', operation: 'fork2' })
  await store.createEdge({ fromNodeId: 'B', toNodeId: 'D', operation: 'join1' })
  await store.createEdge({ fromNodeId: 'C', toNodeId: 'D', operation: 'join2' })

  return { nodes: { A: a, B: b, C: c, D: d } }
}

/**
 * Creates a complex graph with multiple paths:
 *     A
 *    /|\
 *   B C D
 *   |X|/
 *   E F
 *    \|
 *     G
 */
async function createComplexGraph(store: DrizzleLineageStore): Promise<{
  nodes: Record<string, LineageNode>
}> {
  const a = await store.createNode({ id: 'A', type: 'source', name: 'Source A' })
  const b = await store.createNode({ id: 'B', type: 'transformation', name: 'Trans B' })
  const c = await store.createNode({ id: 'C', type: 'transformation', name: 'Trans C' })
  const d = await store.createNode({ id: 'D', type: 'transformation', name: 'Trans D' })
  const e = await store.createNode({ id: 'E', type: 'transformation', name: 'Trans E' })
  const f = await store.createNode({ id: 'F', type: 'transformation', name: 'Trans F' })
  const g = await store.createNode({ id: 'G', type: 'sink', name: 'Sink G' })

  await store.createEdge({ fromNodeId: 'A', toNodeId: 'B', operation: 'op1' })
  await store.createEdge({ fromNodeId: 'A', toNodeId: 'C', operation: 'op2' })
  await store.createEdge({ fromNodeId: 'A', toNodeId: 'D', operation: 'op3' })
  await store.createEdge({ fromNodeId: 'B', toNodeId: 'E', operation: 'op4' })
  await store.createEdge({ fromNodeId: 'C', toNodeId: 'E', operation: 'op5' })
  await store.createEdge({ fromNodeId: 'C', toNodeId: 'F', operation: 'op6' })
  await store.createEdge({ fromNodeId: 'D', toNodeId: 'F', operation: 'op7' })
  await store.createEdge({ fromNodeId: 'E', toNodeId: 'G', operation: 'op8' })
  await store.createEdge({ fromNodeId: 'F', toNodeId: 'G', operation: 'op9' })

  return { nodes: { A: a, B: b, C: c, D: d, E: e, F: f, G: g } }
}

// =============================================================================
// getUpstream TESTS
// =============================================================================

describe('LineageTraversalDrizzle - getUpstream', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('should return empty graph for node with no upstream dependencies', async () => {
    const { nodes } = await createLinearGraph(ctx.store)

    const result = await ctx.traversal.getUpstream('A')

    expect(result.nodes).toHaveLength(0)
    expect(result.edges).toHaveLength(0)
    expect(result.rootId).toBe('A')
  })

  it('should return immediate parent for single hop', async () => {
    const { nodes } = await createLinearGraph(ctx.store)

    const result = await ctx.traversal.getUpstream('B')

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].id).toBe('A')
    expect(result.edges).toHaveLength(1)
    expect(result.rootId).toBe('B')
  })

  it('should return all ancestors for deep graph', async () => {
    await createLinearGraph(ctx.store)

    const result = await ctx.traversal.getUpstream('D')

    expect(result.nodes).toHaveLength(3)
    const nodeIds = result.nodes.map((n) => n.id).sort()
    expect(nodeIds).toEqual(['A', 'B', 'C'])
    expect(result.edges).toHaveLength(3)
  })

  it('should handle diamond graph without duplicates', async () => {
    await createDiamondGraph(ctx.store)

    const result = await ctx.traversal.getUpstream('D')

    // Should have A, B, C (no duplicates)
    expect(result.nodes).toHaveLength(3)
    const nodeIds = result.nodes.map((n) => n.id).sort()
    expect(nodeIds).toEqual(['A', 'B', 'C'])

    // Should have all 4 edges
    expect(result.edges).toHaveLength(4)
  })

  it('should respect maxDepth option', async () => {
    await createLinearGraph(ctx.store)

    const result = await ctx.traversal.getUpstream('D', { maxDepth: 1 })

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].id).toBe('C')
  })

  it('should respect maxDepth=2', async () => {
    await createLinearGraph(ctx.store)

    const result = await ctx.traversal.getUpstream('D', { maxDepth: 2 })

    expect(result.nodes).toHaveLength(2)
    const nodeIds = result.nodes.map((n) => n.id).sort()
    expect(nodeIds).toEqual(['B', 'C'])
  })

  it('should filter by nodeTypes', async () => {
    await createLinearGraph(ctx.store)

    const result = await ctx.traversal.getUpstream('D', { nodeTypes: ['transformation'] })

    expect(result.nodes).toHaveLength(2)
    const nodeIds = result.nodes.map((n) => n.id).sort()
    expect(nodeIds).toEqual(['B', 'C'])
    expect(result.nodes.every((n) => n.type === 'transformation')).toBe(true)
  })

  it('should handle includeMetadata=false', async () => {
    const a = await ctx.store.createNode({
      id: 'A',
      type: 'source',
      name: 'A',
      metadata: { key: 'value' },
    })
    const b = await ctx.store.createNode({ id: 'B', type: 'sink', name: 'B' })
    await ctx.store.createEdge({
      fromNodeId: 'A',
      toNodeId: 'B',
      operation: 'test',
      metadata: { edgeKey: 'edgeValue' },
    })

    const result = await ctx.traversal.getUpstream('B', { includeMetadata: false })

    expect(result.nodes[0].metadata).toEqual({})
    expect(result.edges[0].metadata).toEqual({})
  })

  it('should handle non-existent node gracefully', async () => {
    const result = await ctx.traversal.getUpstream('non-existent')

    expect(result.nodes).toHaveLength(0)
    expect(result.edges).toHaveLength(0)
    expect(result.rootId).toBe('non-existent')
  })
})

// =============================================================================
// getDownstream TESTS
// =============================================================================

describe('LineageTraversalDrizzle - getDownstream', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('should return empty graph for node with no downstream dependents', async () => {
    await createLinearGraph(ctx.store)

    const result = await ctx.traversal.getDownstream('D')

    expect(result.nodes).toHaveLength(0)
    expect(result.edges).toHaveLength(0)
    expect(result.rootId).toBe('D')
  })

  it('should return immediate child for single hop', async () => {
    await createLinearGraph(ctx.store)

    const result = await ctx.traversal.getDownstream('C')

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].id).toBe('D')
    expect(result.edges).toHaveLength(1)
  })

  it('should return all descendants for deep graph', async () => {
    await createLinearGraph(ctx.store)

    const result = await ctx.traversal.getDownstream('A')

    expect(result.nodes).toHaveLength(3)
    const nodeIds = result.nodes.map((n) => n.id).sort()
    expect(nodeIds).toEqual(['B', 'C', 'D'])
    expect(result.edges).toHaveLength(3)
  })

  it('should handle diamond graph without duplicates', async () => {
    await createDiamondGraph(ctx.store)

    const result = await ctx.traversal.getDownstream('A')

    expect(result.nodes).toHaveLength(3)
    const nodeIds = result.nodes.map((n) => n.id).sort()
    expect(nodeIds).toEqual(['B', 'C', 'D'])
    expect(result.edges).toHaveLength(4)
  })

  it('should respect maxDepth option', async () => {
    await createLinearGraph(ctx.store)

    const result = await ctx.traversal.getDownstream('A', { maxDepth: 1 })

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].id).toBe('B')
  })

  it('should filter by nodeTypes', async () => {
    await createLinearGraph(ctx.store)

    const result = await ctx.traversal.getDownstream('A', { nodeTypes: ['sink'] })

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].id).toBe('D')
    expect(result.nodes[0].type).toBe('sink')
  })
})

// =============================================================================
// getFullLineage TESTS
// =============================================================================

describe('LineageTraversalDrizzle - getFullLineage', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('should return both upstream and downstream', async () => {
    await createLinearGraph(ctx.store)

    const result = await ctx.traversal.getFullLineage('B')

    // B should see A upstream, C and D downstream
    expect(result.nodes).toHaveLength(3)
    const nodeIds = result.nodes.map((n) => n.id).sort()
    expect(nodeIds).toEqual(['A', 'C', 'D'])
    expect(result.edges).toHaveLength(3)
    expect(result.rootId).toBe('B')
  })

  it('should return full graph for middle node in diamond', async () => {
    await createDiamondGraph(ctx.store)

    const result = await ctx.traversal.getFullLineage('B')

    // B sees A upstream, D downstream (C is sibling)
    expect(result.nodes).toHaveLength(2)
    const nodeIds = result.nodes.map((n) => n.id).sort()
    expect(nodeIds).toEqual(['A', 'D'])
  })

  it('should deduplicate nodes appearing in both directions', async () => {
    await createComplexGraph(ctx.store)

    const result = await ctx.traversal.getFullLineage('C')

    // C sees A upstream; E, F, G downstream (and touches B, D indirectly)
    const nodeIds = new Set(result.nodes.map((n) => n.id))
    expect(nodeIds.size).toBe(result.nodes.length) // No duplicates
  })

  it('should respect maxDepth for both directions', async () => {
    await createLinearGraph(ctx.store)

    const result = await ctx.traversal.getFullLineage('B', { maxDepth: 1 })

    // Should only see A (1 hop up) and C (1 hop down)
    expect(result.nodes).toHaveLength(2)
    const nodeIds = result.nodes.map((n) => n.id).sort()
    expect(nodeIds).toEqual(['A', 'C'])
  })
})

// =============================================================================
// findPaths TESTS
// =============================================================================

describe('LineageTraversalDrizzle - findPaths', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('should find single path in linear graph', async () => {
    await createLinearGraph(ctx.store)

    const paths = await ctx.traversal.findPaths('A', 'D')

    expect(paths).toHaveLength(1)
    expect(paths[0].nodeIds).toEqual(['A', 'B', 'C', 'D'])
    expect(paths[0].edgeIds).toHaveLength(3)
  })

  it('should find multiple paths in diamond graph', async () => {
    await createDiamondGraph(ctx.store)

    const paths = await ctx.traversal.findPaths('A', 'D')

    expect(paths).toHaveLength(2)
    // Path through B
    const pathB = paths.find((p) => p.nodeIds.includes('B'))
    expect(pathB?.nodeIds).toEqual(['A', 'B', 'D'])
    // Path through C
    const pathC = paths.find((p) => p.nodeIds.includes('C'))
    expect(pathC?.nodeIds).toEqual(['A', 'C', 'D'])
  })

  it('should return empty array when no path exists', async () => {
    await createLinearGraph(ctx.store)

    const paths = await ctx.traversal.findPaths('D', 'A')

    expect(paths).toHaveLength(0)
  })

  it('should return single-node path for same source and target', async () => {
    await createLinearGraph(ctx.store)

    const paths = await ctx.traversal.findPaths('B', 'B')

    expect(paths).toHaveLength(1)
    expect(paths[0].nodeIds).toEqual(['B'])
    expect(paths[0].edgeIds).toHaveLength(0)
  })

  it('should find all paths in complex graph', async () => {
    await createComplexGraph(ctx.store)

    const paths = await ctx.traversal.findPaths('A', 'G')

    // Multiple paths: A->B->E->G, A->C->E->G, A->C->F->G, A->D->F->G
    expect(paths.length).toBeGreaterThanOrEqual(4)
    // All paths should start with A and end with G
    expect(paths.every((p) => p.nodeIds[0] === 'A')).toBe(true)
    expect(paths.every((p) => p.nodeIds[p.nodeIds.length - 1] === 'G')).toBe(true)
  })

  it('should respect maxDepth limit', async () => {
    await createLinearGraph(ctx.store)

    const paths = await ctx.traversal.findPaths('A', 'D', 2)

    // A -> D is 3 hops, maxDepth=2 means we can only traverse 2 edges
    expect(paths).toHaveLength(0)
  })

  it('should handle non-existent nodes', async () => {
    await createLinearGraph(ctx.store)

    const paths = await ctx.traversal.findPaths('A', 'non-existent')

    expect(paths).toHaveLength(0)
  })
})

// =============================================================================
// getParents TESTS
// =============================================================================

describe('LineageTraversalDrizzle - getParents', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('should return immediate parents only', async () => {
    await createLinearGraph(ctx.store)

    const parents = await ctx.traversal.getParents('C')

    expect(parents).toHaveLength(1)
    expect(parents[0].id).toBe('B')
  })

  it('should return multiple parents in diamond graph', async () => {
    await createDiamondGraph(ctx.store)

    const parents = await ctx.traversal.getParents('D')

    expect(parents).toHaveLength(2)
    const parentIds = parents.map((p) => p.id).sort()
    expect(parentIds).toEqual(['B', 'C'])
  })

  it('should return empty array for root node', async () => {
    await createLinearGraph(ctx.store)

    const parents = await ctx.traversal.getParents('A')

    expect(parents).toHaveLength(0)
  })

  it('should return empty array for non-existent node', async () => {
    const parents = await ctx.traversal.getParents('non-existent')

    expect(parents).toHaveLength(0)
  })
})

// =============================================================================
// getChildren TESTS
// =============================================================================

describe('LineageTraversalDrizzle - getChildren', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('should return immediate children only', async () => {
    await createLinearGraph(ctx.store)

    const children = await ctx.traversal.getChildren('B')

    expect(children).toHaveLength(1)
    expect(children[0].id).toBe('C')
  })

  it('should return multiple children for fork', async () => {
    await createDiamondGraph(ctx.store)

    const children = await ctx.traversal.getChildren('A')

    expect(children).toHaveLength(2)
    const childIds = children.map((c) => c.id).sort()
    expect(childIds).toEqual(['B', 'C'])
  })

  it('should return empty array for leaf node', async () => {
    await createLinearGraph(ctx.store)

    const children = await ctx.traversal.getChildren('D')

    expect(children).toHaveLength(0)
  })
})

// =============================================================================
// CYCLE DETECTION TESTS
// =============================================================================

describe('LineageTraversalDrizzle - Cycle Detection', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('should handle graph with disabled cycle detection', async () => {
    // Create store without cycle detection
    const sqlite = new Database(':memory:')
    sqlite.exec(LINEAGE_DRIZZLE_SCHEMA)
    const db = drizzle(sqlite)
    const store = createDrizzleLineageStore(db, { detectCycles: false })
    const traversal = createLineageTraversalDrizzle(store)

    // Create a cycle: A -> B -> A
    await store.createNode({ id: 'A', type: 'entity', name: 'A' })
    await store.createNode({ id: 'B', type: 'entity', name: 'B' })
    await store.createEdge({ fromNodeId: 'A', toNodeId: 'B', operation: 'step1' })
    await store.createEdge({ fromNodeId: 'B', toNodeId: 'A', operation: 'step2' })

    // Traversal should NOT infinite loop - should handle cycles gracefully
    const upstream = await traversal.getUpstream('A')
    const downstream = await traversal.getDownstream('A')

    // Should find B in both directions (due to cycle)
    expect(upstream.nodes.some((n) => n.id === 'B')).toBe(true)
    expect(downstream.nodes.some((n) => n.id === 'B')).toBe(true)
  })

  it('should handle self-referencing node in graph with disabled cycle detection', async () => {
    const sqlite = new Database(':memory:')
    sqlite.exec(LINEAGE_DRIZZLE_SCHEMA)
    const db = drizzle(sqlite)
    const store = createDrizzleLineageStore(db, { detectCycles: false })
    const traversal = createLineageTraversalDrizzle(store)

    await store.createNode({ id: 'A', type: 'entity', name: 'A' })
    await store.createEdge({ fromNodeId: 'A', toNodeId: 'A', operation: 'self' })

    // Should not infinite loop
    const result = await traversal.getDownstream('A')
    expect(result.rootId).toBe('A')
  })

  it('should handle complex cycle without infinite loop', async () => {
    const sqlite = new Database(':memory:')
    sqlite.exec(LINEAGE_DRIZZLE_SCHEMA)
    const db = drizzle(sqlite)
    const store = createDrizzleLineageStore(db, { detectCycles: false })
    const traversal = createLineageTraversalDrizzle(store)

    // Create: A -> B -> C -> A (triangle cycle)
    await store.createNode({ id: 'A', type: 'entity', name: 'A' })
    await store.createNode({ id: 'B', type: 'entity', name: 'B' })
    await store.createNode({ id: 'C', type: 'entity', name: 'C' })
    await store.createEdge({ fromNodeId: 'A', toNodeId: 'B', operation: 's1' })
    await store.createEdge({ fromNodeId: 'B', toNodeId: 'C', operation: 's2' })
    await store.createEdge({ fromNodeId: 'C', toNodeId: 'A', operation: 's3' })

    const result = await traversal.getFullLineage('A')

    // Should complete without hanging
    expect(result.nodes).toHaveLength(2) // B and C
  })
})

// =============================================================================
// PERFORMANCE TESTS
// =============================================================================

describe('LineageTraversalDrizzle - Performance', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('should handle graph with 100+ nodes efficiently', async () => {
    // Create a linear chain of 100 nodes
    const nodeCount = 100
    const nodeIds: string[] = []

    for (let i = 0; i < nodeCount; i++) {
      await ctx.store.createNode({
        id: `node-${i}`,
        type: i % 3 === 0 ? 'source' : i % 3 === 1 ? 'transformation' : 'sink',
        name: `Node ${i}`,
      })
      nodeIds.push(`node-${i}`)
    }

    for (let i = 0; i < nodeCount - 1; i++) {
      await ctx.store.createEdge({
        fromNodeId: `node-${i}`,
        toNodeId: `node-${i + 1}`,
        operation: `op-${i}`,
      })
    }

    const startTime = Date.now()
    const result = await ctx.traversal.getUpstream(`node-${nodeCount - 1}`)
    const elapsed = Date.now() - startTime

    expect(result.nodes).toHaveLength(nodeCount - 1)
    // Should complete in reasonable time (under 1 second)
    expect(elapsed).toBeLessThan(1000)
  })

  it('should handle wide graph with many children', async () => {
    // Create a star pattern: 1 root with 50 children
    await ctx.store.createNode({ id: 'root', type: 'source', name: 'Root' })

    const childCount = 50
    for (let i = 0; i < childCount; i++) {
      await ctx.store.createNode({ id: `child-${i}`, type: 'sink', name: `Child ${i}` })
      await ctx.store.createEdge({ fromNodeId: 'root', toNodeId: `child-${i}`, operation: `op-${i}` })
    }

    const startTime = Date.now()
    const result = await ctx.traversal.getDownstream('root')
    const elapsed = Date.now() - startTime

    expect(result.nodes).toHaveLength(childCount)
    expect(elapsed).toBeLessThan(500)
  })

  it('should handle deep graph with maxDepth efficiently', async () => {
    // Create a 1000-node chain but query with maxDepth=10
    const nodeCount = 1000

    for (let i = 0; i < nodeCount; i++) {
      await ctx.store.createNode({ id: `n-${i}`, type: 'entity', name: `Node ${i}` })
    }

    for (let i = 0; i < nodeCount - 1; i++) {
      await ctx.store.createEdge({ fromNodeId: `n-${i}`, toNodeId: `n-${i + 1}`, operation: `e-${i}` })
    }

    const startTime = Date.now()
    const result = await ctx.traversal.getDownstream('n-0', { maxDepth: 10 })
    const elapsed = Date.now() - startTime

    expect(result.nodes).toHaveLength(10)
    expect(elapsed).toBeLessThan(200) // Should be fast due to depth limit
  })
})

// =============================================================================
// EDGE CASES
// =============================================================================

describe('LineageTraversalDrizzle - Edge Cases', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('should handle isolated nodes', async () => {
    await ctx.store.createNode({ id: 'isolated', type: 'entity', name: 'Isolated' })

    const upstream = await ctx.traversal.getUpstream('isolated')
    const downstream = await ctx.traversal.getDownstream('isolated')

    expect(upstream.nodes).toHaveLength(0)
    expect(downstream.nodes).toHaveLength(0)
  })

  it('should handle graph with parallel edges', async () => {
    await ctx.store.createNode({ id: 'A', type: 'source', name: 'A' })
    await ctx.store.createNode({ id: 'B', type: 'sink', name: 'B' })
    await ctx.store.createEdge({ fromNodeId: 'A', toNodeId: 'B', operation: 'read1' })
    await ctx.store.createEdge({ fromNodeId: 'A', toNodeId: 'B', operation: 'read2' })

    const result = await ctx.traversal.getDownstream('A')

    // Should have B once, but both edges
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].id).toBe('B')
    expect(result.edges).toHaveLength(2)
  })

  it('should handle empty graph', async () => {
    const upstream = await ctx.traversal.getUpstream('any')
    const downstream = await ctx.traversal.getDownstream('any')
    const paths = await ctx.traversal.findPaths('any', 'other')

    expect(upstream.nodes).toHaveLength(0)
    expect(downstream.nodes).toHaveLength(0)
    expect(paths).toHaveLength(0)
  })

  it('should maintain correct edge associations', async () => {
    await createLinearGraph(ctx.store)

    const result = await ctx.traversal.getDownstream('A')

    // Verify each edge connects correct nodes
    for (const edge of result.edges) {
      const fromExists = edge.fromNodeId === 'A' || result.nodes.some((n) => n.id === edge.fromNodeId)
      const toExists = result.nodes.some((n) => n.id === edge.toNodeId)
      expect(fromExists).toBe(true)
      expect(toExists).toBe(true)
    }
  })
})
