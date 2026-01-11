/**
 * Graph Traversal Engine Tests - RED Phase (dotdo-pkrnk)
 *
 * Comprehensive failing tests for the graph traversal engine.
 * These tests are designed to FAIL until the production implementation is complete.
 *
 * Features tested:
 * - BFS traversal with depth range (min/max)
 * - Multi-step chaining ($follows.$likes)
 * - $out/$in/$expand for any-relationship traversal
 * - Visited set handling for source vs target nodes
 *
 * @see /db/compat/sql/clickhouse/spikes/graph-sdk-unified.ts for reference implementation
 */

import { describe, it, expect, beforeEach } from 'vitest'

// Import from production module path (doesn't exist yet - RED phase)
import {
  TraversalEngine,
  createTraversalEngine,
  AdjacencyIndex,
  GraphNode,
  TraversalOptions,
  VisitedSetMode,
} from './traversal-engine'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Helper to create a standardized test graph
 *
 * Graph structure:
 *
 *   alice --follows--> bob --follows--> carol --follows--> dave
 *         --follows--> eve --likes----> frank --likes----> grace
 *         --likes----> bob
 *
 *   bob --follows--> alice (mutual)
 *   carol --likes--> alice
 *   dave --follows--> eve
 *   eve --follows--> carol
 *   frank --follows--> dave
 *   grace --follows--> alice
 *
 * This creates various interesting traversal scenarios for testing
 * depth ranges, multi-step chaining, and visited set handling.
 */
function createTestGraph(): AdjacencyIndex {
  const index = new AdjacencyIndex()
  const now = Date.now()

  // Add relationships
  const relationships = [
    // alice's outgoing
    { id: 'r1', type: 'follows', from: 'alice', to: 'bob', createdAt: now },
    { id: 'r2', type: 'follows', from: 'alice', to: 'eve', createdAt: now },
    { id: 'r3', type: 'likes', from: 'alice', to: 'bob', createdAt: now },

    // bob's outgoing
    { id: 'r4', type: 'follows', from: 'bob', to: 'carol', createdAt: now },
    { id: 'r5', type: 'follows', from: 'bob', to: 'alice', createdAt: now }, // mutual

    // carol's outgoing
    { id: 'r6', type: 'follows', from: 'carol', to: 'dave', createdAt: now },
    { id: 'r7', type: 'likes', from: 'carol', to: 'alice', createdAt: now },

    // eve's outgoing
    { id: 'r8', type: 'likes', from: 'eve', to: 'frank', createdAt: now },
    { id: 'r9', type: 'follows', from: 'eve', to: 'carol', createdAt: now },

    // frank's outgoing
    { id: 'r10', type: 'likes', from: 'frank', to: 'grace', createdAt: now },
    { id: 'r11', type: 'follows', from: 'frank', to: 'dave', createdAt: now },

    // dave's outgoing
    { id: 'r12', type: 'follows', from: 'dave', to: 'eve', createdAt: now },

    // grace's outgoing
    { id: 'r13', type: 'follows', from: 'grace', to: 'alice', createdAt: now },
  ]

  for (const rel of relationships) {
    index.addEdge(rel)
  }

  return index
}

/**
 * Helper to create a larger graph for depth range testing
 *
 * Linear chain: node-0 --> node-1 --> node-2 --> ... --> node-N
 */
function createLinearGraph(length: number): AdjacencyIndex {
  const index = new AdjacencyIndex()
  const now = Date.now()

  for (let i = 0; i < length - 1; i++) {
    index.addEdge({
      id: `rel-${i}`,
      type: 'next',
      from: `node-${i}`,
      to: `node-${i + 1}`,
      createdAt: now,
    })
  }

  return index
}

/**
 * Helper to create a branching graph for BFS testing
 *
 *                   node-1-1
 *                 /
 *       node-1 --
 *     /           \
 *   root           node-1-2
 *     \
 *       node-2 -- node-2-1
 *
 */
function createBranchingGraph(): AdjacencyIndex {
  const index = new AdjacencyIndex()
  const now = Date.now()

  const relationships = [
    // Level 1
    { id: 'r1', type: 'child', from: 'root', to: 'node-1', createdAt: now },
    { id: 'r2', type: 'child', from: 'root', to: 'node-2', createdAt: now },

    // Level 2
    { id: 'r3', type: 'child', from: 'node-1', to: 'node-1-1', createdAt: now },
    { id: 'r4', type: 'child', from: 'node-1', to: 'node-1-2', createdAt: now },
    { id: 'r5', type: 'child', from: 'node-2', to: 'node-2-1', createdAt: now },

    // Level 3
    { id: 'r6', type: 'child', from: 'node-1-1', to: 'node-1-1-1', createdAt: now },
    { id: 'r7', type: 'child', from: 'node-1-2', to: 'node-1-2-1', createdAt: now },
    { id: 'r8', type: 'child', from: 'node-2-1', to: 'node-2-1-1', createdAt: now },
  ]

  for (const rel of relationships) {
    index.addEdge(rel)
  }

  return index
}

/**
 * Helper to create a graph with multiple relationship types
 */
function createMultiRelGraph(): AdjacencyIndex {
  const index = new AdjacencyIndex()
  const now = Date.now()

  const relationships = [
    // User follows
    { id: 'r1', type: 'follows', from: 'user-a', to: 'user-b', createdAt: now },
    { id: 'r2', type: 'follows', from: 'user-b', to: 'user-c', createdAt: now },
    { id: 'r3', type: 'follows', from: 'user-c', to: 'user-d', createdAt: now },

    // User likes posts
    { id: 'r4', type: 'likes', from: 'user-b', to: 'post-1', createdAt: now },
    { id: 'r5', type: 'likes', from: 'user-c', to: 'post-2', createdAt: now },
    { id: 'r6', type: 'likes', from: 'user-d', to: 'post-3', createdAt: now },

    // Post authored by
    { id: 'r7', type: 'authored', from: 'post-1', to: 'user-a', createdAt: now },
    { id: 'r8', type: 'authored', from: 'post-2', to: 'user-b', createdAt: now },
    { id: 'r9', type: 'authored', from: 'post-3', to: 'user-c', createdAt: now },
  ]

  for (const rel of relationships) {
    index.addEdge(rel)
  }

  return index
}

// ============================================================================
// BFS TRAVERSAL WITH DEPTH RANGE
// ============================================================================

describe('TraversalEngine', () => {
  describe('BFS Traversal with Depth Range', () => {
    describe('Exact depth', () => {
      it('should return only nodes at exactly depth 1', async () => {
        const index = createLinearGraph(10)
        const engine = createTraversalEngine(index)

        const result = await engine.bfs(['node-0'], {
          depth: 1,
          direction: 'out',
        })

        expect(result.ids).toEqual(['node-1'])
        expect(result.ids).not.toContain('node-0')
        expect(result.ids).not.toContain('node-2')
      })

      it('should return only nodes at exactly depth 2', async () => {
        const index = createLinearGraph(10)
        const engine = createTraversalEngine(index)

        const result = await engine.bfs(['node-0'], {
          depth: 2,
          direction: 'out',
        })

        expect(result.ids).toEqual(['node-2'])
        expect(result.ids).not.toContain('node-0')
        expect(result.ids).not.toContain('node-1')
        expect(result.ids).not.toContain('node-3')
      })

      it('should return only nodes at exactly depth 5', async () => {
        const index = createLinearGraph(10)
        const engine = createTraversalEngine(index)

        const result = await engine.bfs(['node-0'], {
          depth: 5,
          direction: 'out',
        })

        expect(result.ids).toEqual(['node-5'])
      })

      it('should return empty array when depth exceeds graph size', async () => {
        const index = createLinearGraph(5)
        const engine = createTraversalEngine(index)

        const result = await engine.bfs(['node-0'], {
          depth: 10,
          direction: 'out',
        })

        expect(result.ids).toEqual([])
      })
    })

    describe('Depth range (min/max)', () => {
      it('should return nodes within depth range [1, 3]', async () => {
        const index = createLinearGraph(10)
        const engine = createTraversalEngine(index)

        const result = await engine.bfs(['node-0'], {
          depth: { min: 1, max: 3 },
          direction: 'out',
        })

        expect(result.ids).toContain('node-1')
        expect(result.ids).toContain('node-2')
        expect(result.ids).toContain('node-3')
        expect(result.ids).not.toContain('node-0')
        expect(result.ids).not.toContain('node-4')
        expect(result.ids).toHaveLength(3)
      })

      it('should return nodes within depth range [2, 4]', async () => {
        const index = createLinearGraph(10)
        const engine = createTraversalEngine(index)

        const result = await engine.bfs(['node-0'], {
          depth: { min: 2, max: 4 },
          direction: 'out',
        })

        expect(result.ids).toContain('node-2')
        expect(result.ids).toContain('node-3')
        expect(result.ids).toContain('node-4')
        expect(result.ids).not.toContain('node-1')
        expect(result.ids).not.toContain('node-5')
        expect(result.ids).toHaveLength(3)
      })

      it('should handle open-ended max (min only)', async () => {
        const index = createLinearGraph(6)
        const engine = createTraversalEngine(index)

        // min: 3 means depth >= 3
        const result = await engine.bfs(['node-0'], {
          depth: { min: 3 },
          direction: 'out',
        })

        expect(result.ids).toContain('node-3')
        expect(result.ids).toContain('node-4')
        expect(result.ids).toContain('node-5')
        expect(result.ids).not.toContain('node-1')
        expect(result.ids).not.toContain('node-2')
      })

      it('should handle open-ended min (max only, defaults to min=1)', async () => {
        const index = createLinearGraph(10)
        const engine = createTraversalEngine(index)

        // max: 2 means depth 1 to 2
        const result = await engine.bfs(['node-0'], {
          depth: { max: 2 },
          direction: 'out',
        })

        expect(result.ids).toContain('node-1')
        expect(result.ids).toContain('node-2')
        expect(result.ids).not.toContain('node-0')
        expect(result.ids).not.toContain('node-3')
        expect(result.ids).toHaveLength(2)
      })

      it('should handle min=0 to include start nodes', async () => {
        const index = createLinearGraph(5)
        const engine = createTraversalEngine(index)

        const result = await engine.bfs(['node-0'], {
          depth: { min: 0, max: 2 },
          direction: 'out',
        })

        expect(result.ids).toContain('node-0') // start node included
        expect(result.ids).toContain('node-1')
        expect(result.ids).toContain('node-2')
        expect(result.ids).toHaveLength(3)
      })

      it('should handle branching graph with depth range', async () => {
        const index = createBranchingGraph()
        const engine = createTraversalEngine(index)

        const result = await engine.bfs(['root'], {
          depth: { min: 1, max: 2 },
          direction: 'out',
          edgeTypes: ['child'],
        })

        // Level 1: node-1, node-2
        // Level 2: node-1-1, node-1-2, node-2-1
        expect(result.ids).toContain('node-1')
        expect(result.ids).toContain('node-2')
        expect(result.ids).toContain('node-1-1')
        expect(result.ids).toContain('node-1-2')
        expect(result.ids).toContain('node-2-1')
        expect(result.ids).not.toContain('root')
        expect(result.ids).not.toContain('node-1-1-1')
        expect(result.ids).toHaveLength(5)
      })
    })

    describe('Depth with specific edge types', () => {
      it('should respect edge type filter with depth range', async () => {
        const index = createTestGraph()
        const engine = createTraversalEngine(index)

        const result = await engine.bfs(['alice'], {
          depth: { min: 1, max: 2 },
          direction: 'out',
          edgeTypes: ['follows'],
        })

        // alice --follows--> bob, eve (depth 1)
        // bob --follows--> carol, alice (depth 2)
        // eve --follows--> carol (depth 2)
        expect(result.ids).toContain('bob')
        expect(result.ids).toContain('eve')
        expect(result.ids).toContain('carol')
        // alice is at depth 2 but should be excluded (it's the start node)
      })

      it('should handle multiple edge types', async () => {
        const index = createTestGraph()
        const engine = createTraversalEngine(index)

        const result = await engine.bfs(['alice'], {
          depth: 1,
          direction: 'out',
          edgeTypes: ['follows', 'likes'],
        })

        // alice --follows--> bob, eve
        // alice --likes--> bob
        expect(result.ids).toContain('bob')
        expect(result.ids).toContain('eve')
        expect(result.ids).toHaveLength(2) // bob only counted once
      })
    })

    describe('Edge cases for depth', () => {
      it('should throw error for negative depth', async () => {
        const index = createLinearGraph(5)
        const engine = createTraversalEngine(index)

        await expect(
          engine.bfs(['node-0'], {
            depth: -1,
            direction: 'out',
          })
        ).rejects.toThrow()
      })

      it('should throw error for depth range with min > max', async () => {
        const index = createLinearGraph(5)
        const engine = createTraversalEngine(index)

        await expect(
          engine.bfs(['node-0'], {
            depth: { min: 5, max: 2 },
            direction: 'out',
          })
        ).rejects.toThrow()
      })

      it('should handle depth: 0 returning only start nodes', async () => {
        const index = createLinearGraph(5)
        const engine = createTraversalEngine(index)

        const result = await engine.bfs(['node-0', 'node-1'], {
          depth: 0,
          direction: 'out',
        })

        expect(result.ids).toContain('node-0')
        expect(result.ids).toContain('node-1')
        expect(result.ids).toHaveLength(2)
      })
    })
  })

  // ==========================================================================
  // MULTI-STEP CHAINING ($follows.$likes)
  // ==========================================================================

  describe('Multi-Step Chaining', () => {
    describe('Basic chaining', () => {
      it('should chain $follows.$likes traversal', async () => {
        const index = createMultiRelGraph()
        const engine = createTraversalEngine(index)

        // user-a --follows--> user-b --likes--> post-1
        const result = await engine.chain(['user-a'], [
          { relType: 'follows', direction: 'out' },
          { relType: 'likes', direction: 'out' },
        ])

        expect(result.ids).toContain('post-1')
        expect(result.ids).toHaveLength(1)
      })

      it('should chain $follows.$follows traversal (FoF)', async () => {
        const index = createMultiRelGraph()
        const engine = createTraversalEngine(index)

        // user-a --follows--> user-b --follows--> user-c
        const result = await engine.chain(['user-a'], [
          { relType: 'follows', direction: 'out' },
          { relType: 'follows', direction: 'out' },
        ])

        expect(result.ids).toContain('user-c')
        expect(result.ids).toHaveLength(1)
      })

      it('should chain three-step traversal', async () => {
        const index = createMultiRelGraph()
        const engine = createTraversalEngine(index)

        // user-a --follows--> user-b --follows--> user-c --likes--> post-2
        const result = await engine.chain(['user-a'], [
          { relType: 'follows', direction: 'out' },
          { relType: 'follows', direction: 'out' },
          { relType: 'likes', direction: 'out' },
        ])

        expect(result.ids).toContain('post-2')
        expect(result.ids).toHaveLength(1)
      })

      it('should handle reverse direction in chain', async () => {
        const index = createMultiRelGraph()
        const engine = createTraversalEngine(index)

        // post-1 <--authored-- (incoming) is actually post-1 --authored--> user-a
        // So we need to go backwards: find who authored posts that user-b likes
        // user-b --likes--> post-1 --authored--> user-a
        const result = await engine.chain(['user-b'], [
          { relType: 'likes', direction: 'out' },
          { relType: 'authored', direction: 'out' },
        ])

        expect(result.ids).toContain('user-a')
      })
    })

    describe('Chaining with depth in steps', () => {
      it('should chain step with depth: 2', async () => {
        const index = createMultiRelGraph()
        const engine = createTraversalEngine(index)

        // user-a --follows(depth:2)--> user-c --likes--> post-2
        const result = await engine.chain(['user-a'], [
          { relType: 'follows', direction: 'out', depth: 2 },
          { relType: 'likes', direction: 'out' },
        ])

        expect(result.ids).toContain('post-2')
      })

      it('should chain steps with mixed depths', async () => {
        const index = createMultiRelGraph()
        const engine = createTraversalEngine(index)

        // user-a --follows(depth: {min:1, max:2})--> [user-b, user-c] --likes--> [post-1, post-2]
        const result = await engine.chain(['user-a'], [
          { relType: 'follows', direction: 'out', depth: { min: 1, max: 2 } },
          { relType: 'likes', direction: 'out' },
        ])

        expect(result.ids).toContain('post-1')
        expect(result.ids).toContain('post-2')
        expect(result.ids).toHaveLength(2)
      })
    })

    describe('Chaining with empty intermediate results', () => {
      it('should return empty when first step yields no results', async () => {
        const index = createMultiRelGraph()
        const engine = createTraversalEngine(index)

        const result = await engine.chain(['user-d'], [
          { relType: 'follows', direction: 'out' }, // user-d has no outgoing follows
          { relType: 'likes', direction: 'out' },
        ])

        expect(result.ids).toEqual([])
      })

      it('should return empty when intermediate step yields no results', async () => {
        const index = createMultiRelGraph()
        const engine = createTraversalEngine(index)

        const result = await engine.chain(['user-a'], [
          { relType: 'follows', direction: 'out' },
          { relType: 'authored', direction: 'out' }, // user-b has no authored
          { relType: 'likes', direction: 'out' },
        ])

        expect(result.ids).toEqual([])
      })
    })

    describe('Chaining from multiple start nodes', () => {
      it('should collect results from all start nodes', async () => {
        const index = createMultiRelGraph()
        const engine = createTraversalEngine(index)

        // [user-a, user-b] --follows--> [user-b, user-c] --likes--> [post-1, post-2]
        const result = await engine.chain(['user-a', 'user-b'], [
          { relType: 'follows', direction: 'out' },
          { relType: 'likes', direction: 'out' },
        ])

        expect(result.ids).toContain('post-1')
        expect(result.ids).toContain('post-2')
      })
    })
  })

  // ==========================================================================
  // $OUT / $IN / $EXPAND FOR ANY-RELATIONSHIP TRAVERSAL
  // ==========================================================================

  describe('Any-Relationship Traversal', () => {
    describe('$out - any outgoing relationship', () => {
      it('should traverse all outgoing relationships with $out(1)', async () => {
        const index = createTestGraph()
        const engine = createTraversalEngine(index)

        const result = await engine.$out(['alice'], 1)

        // alice --follows--> bob, eve
        // alice --likes--> bob
        expect(result.ids).toContain('bob')
        expect(result.ids).toContain('eve')
        expect(result.ids).toHaveLength(2) // bob counted once
      })

      it('should traverse any outgoing to depth 2 with $out(2)', async () => {
        const index = createTestGraph()
        const engine = createTraversalEngine(index)

        const result = await engine.$out(['alice'], 2)

        // Depth 1: bob, eve
        // Depth 2: bob->carol, bob->alice, eve->frank, eve->carol
        expect(result.ids).toContain('carol')
        expect(result.ids).toContain('frank')
        // alice at depth 2 should be handled by visited set
      })

      it('should support depth range in $out', async () => {
        const index = createLinearGraph(10)
        const engine = createTraversalEngine(index)

        const result = await engine.$out(['node-0'], { min: 2, max: 4 })

        expect(result.ids).toContain('node-2')
        expect(result.ids).toContain('node-3')
        expect(result.ids).toContain('node-4')
        expect(result.ids).not.toContain('node-1')
        expect(result.ids).not.toContain('node-5')
      })
    })

    describe('$in - any incoming relationship', () => {
      it('should traverse all incoming relationships with $in(1)', async () => {
        const index = createTestGraph()
        const engine = createTraversalEngine(index)

        const result = await engine.$in(['alice'], 1)

        // who follows/likes alice: bob (follows), carol (likes), eve (follows), grace (follows)
        expect(result.ids).toContain('bob')
        expect(result.ids).toContain('carol')
        expect(result.ids).toContain('eve')
        expect(result.ids).toContain('grace')
        expect(result.ids).toHaveLength(4)
      })

      it('should traverse any incoming to depth 2 with $in(2)', async () => {
        const index = createTestGraph()
        const engine = createTraversalEngine(index)

        const result = await engine.$in(['alice'], 2)

        // Depth 1: bob, carol, eve, grace
        // Depth 2: alice->bob (but alice is start), frank->dave (who follows eve)...
        // Need to find all who point to [bob, carol, eve, grace]
        expect(result.ids.length).toBeGreaterThan(0)
      })

      it('should support depth range in $in', async () => {
        const index = createBranchingGraph()
        const engine = createTraversalEngine(index)

        // Go backwards from leaves
        const result = await engine.$in(['node-1-1-1'], { min: 1, max: 2 })

        // Depth 1: node-1-1
        // Depth 2: node-1
        expect(result.ids).toContain('node-1-1')
        expect(result.ids).toContain('node-1')
        expect(result.ids).not.toContain('root')
      })
    })

    describe('$expand - any relationship, any direction', () => {
      it('should expand in all directions with $expand(1)', async () => {
        const index = createTestGraph()
        const engine = createTraversalEngine(index)

        const result = await engine.$expand(['alice'], 1)

        // Outgoing from alice: bob, eve (follows), bob (likes)
        // Incoming to alice: bob (follows), carol (likes), eve (follows), grace (follows)
        expect(result.ids).toContain('bob')
        expect(result.ids).toContain('eve')
        expect(result.ids).toContain('carol')
        expect(result.ids).toContain('grace')
      })

      it('should get full neighborhood with $expand(2)', async () => {
        const index = createBranchingGraph()
        const engine = createTraversalEngine(index)

        const result = await engine.$expand(['node-1'], 2)

        // Depth 1 out: node-1-1, node-1-2
        // Depth 1 in: root
        // Depth 2 out: node-1-1-1, node-1-2-1
        // Depth 2 in from root: node-2
        expect(result.ids).toContain('node-1-1')
        expect(result.ids).toContain('node-1-2')
        expect(result.ids).toContain('root')
        expect(result.ids).toContain('node-2')
        expect(result.ids).toContain('node-1-1-1')
        expect(result.ids).toContain('node-1-2-1')
      })

      it('should support depth range in $expand', async () => {
        const index = createBranchingGraph()
        const engine = createTraversalEngine(index)

        const result = await engine.$expand(['node-1'], { min: 2, max: 2 })

        // Only depth 2 neighbors (not depth 1)
        expect(result.ids).toContain('node-1-1-1')
        expect(result.ids).toContain('node-1-2-1')
        expect(result.ids).toContain('node-2')
        expect(result.ids).not.toContain('node-1-1')
        expect(result.ids).not.toContain('node-1-2')
        expect(result.ids).not.toContain('root')
      })
    })

    describe('$out/$in/$expand with options', () => {
      it('should support limit in $out', async () => {
        const index = createTestGraph()
        const engine = createTraversalEngine(index)

        const result = await engine.$out(['alice'], 1, { limit: 1 })

        expect(result.ids).toHaveLength(1)
      })

      it('should support where filter in $expand', async () => {
        const index = createTestGraph()
        const engine = createTraversalEngine(index)

        const result = await engine.$expand(['alice'], 1, {
          where: (node: any) => node.id.startsWith('b'), // only nodes starting with 'b'
        })

        expect(result.ids).toEqual(['bob'])
      })
    })
  })

  // ==========================================================================
  // VISITED SET HANDLING FOR SOURCE VS TARGET NODES
  // ==========================================================================

  describe('Visited Set Handling', () => {
    describe('Default behavior (exclude source from results)', () => {
      it('should not include start node in results by default', async () => {
        const index = createTestGraph()
        const engine = createTraversalEngine(index)

        // alice --follows--> bob --follows--> alice (cycle)
        const result = await engine.bfs(['alice'], {
          depth: 2,
          direction: 'out',
          edgeTypes: ['follows'],
        })

        expect(result.ids).not.toContain('alice')
        expect(result.ids).toContain('bob')
        expect(result.ids).toContain('carol')
        expect(result.ids).toContain('eve')
      })

      it('should not include any start nodes when multiple start nodes', async () => {
        const index = createTestGraph()
        const engine = createTraversalEngine(index)

        const result = await engine.bfs(['alice', 'bob'], {
          depth: 1,
          direction: 'out',
          edgeTypes: ['follows'],
        })

        expect(result.ids).not.toContain('alice')
        expect(result.ids).not.toContain('bob')
      })
    })

    describe('VisitedSetMode.SOURCE_EXCLUDED (default)', () => {
      it('should mark source nodes as visited from the start', async () => {
        const index = createTestGraph()
        const engine = createTraversalEngine(index)

        const result = await engine.bfs(['alice'], {
          depth: { min: 1, max: 3 },
          direction: 'out',
          edgeTypes: ['follows'],
          visitedMode: VisitedSetMode.SOURCE_EXCLUDED,
        })

        // Even though alice is reachable at depth 2 (bob->alice), it should be excluded
        expect(result.ids).not.toContain('alice')
      })
    })

    describe('VisitedSetMode.SOURCE_INCLUDED', () => {
      it('should include start node if depth includes 0', async () => {
        const index = createTestGraph()
        const engine = createTraversalEngine(index)

        const result = await engine.bfs(['alice'], {
          depth: { min: 0, max: 2 },
          direction: 'out',
          edgeTypes: ['follows'],
          visitedMode: VisitedSetMode.SOURCE_INCLUDED,
        })

        expect(result.ids).toContain('alice')
      })

      it('should not include start node if depth starts at 1', async () => {
        const index = createTestGraph()
        const engine = createTraversalEngine(index)

        const result = await engine.bfs(['alice'], {
          depth: { min: 1, max: 2 },
          direction: 'out',
          edgeTypes: ['follows'],
          visitedMode: VisitedSetMode.SOURCE_INCLUDED,
        })

        expect(result.ids).not.toContain('alice')
      })
    })

    describe('VisitedSetMode.TARGET_ONLY', () => {
      it('should track visited only at target level (allow same node multiple times in path)', async () => {
        const index = createTestGraph()
        const engine = createTraversalEngine(index)

        // With TARGET_ONLY, the visited set is reset between BFS levels
        // This allows finding the same node at different depths
        const result = await engine.bfs(['alice'], {
          depth: { min: 1, max: 3 },
          direction: 'out',
          edgeTypes: ['follows'],
          visitedMode: VisitedSetMode.TARGET_ONLY,
        })

        // alice could appear if reachable via different paths
        // This mode is useful for counting paths, not just reachable nodes
        expect(result.ids.length).toBeGreaterThanOrEqual(1)
      })
    })

    describe('VisitedSetMode.NONE (no cycle detection)', () => {
      it('should allow cycles without limit (use with caution)', async () => {
        const index = createTestGraph()
        const engine = createTraversalEngine(index)

        // This is dangerous but sometimes needed for specific algorithms
        const result = await engine.bfs(['alice'], {
          depth: 2, // Must have a depth limit!
          direction: 'out',
          edgeTypes: ['follows'],
          visitedMode: VisitedSetMode.NONE,
        })

        // alice --follows--> bob --follows--> alice
        // With no visited tracking, alice would be included at depth 2
        expect(result.ids).toContain('alice')
      })
    })

    describe('Visited set with $expand (bidirectional)', () => {
      it('should track visited nodes in both directions', async () => {
        const index = createTestGraph()
        const engine = createTraversalEngine(index)

        const result = await engine.$expand(['bob'], 2)

        // bob should not appear in results (it's the start node)
        expect(result.ids).not.toContain('bob')

        // All reachable nodes should appear exactly once
        const uniqueIds = new Set(result.ids)
        expect(result.ids.length).toBe(uniqueIds.size)
      })

      it('should handle mutual connections correctly', async () => {
        const index = createTestGraph()
        const engine = createTraversalEngine(index)

        // alice and bob have mutual follows
        const result = await engine.$expand(['alice'], 1)

        // bob should appear once (via either direction)
        expect(result.ids).toContain('bob')
        expect(result.ids.filter(id => id === 'bob')).toHaveLength(1)
      })
    })

    describe('Visited set in multi-step chaining', () => {
      it('should carry visited set across chain steps', async () => {
        const index = createMultiRelGraph()
        const engine = createTraversalEngine(index)

        // If we chain steps, nodes visited in earlier steps should not reappear
        const result = await engine.chain(['user-a'], [
          { relType: 'follows', direction: 'out' }, // user-b
          { relType: 'follows', direction: 'out' }, // user-c
          { relType: 'follows', direction: 'out' }, // user-d
          { relType: 'follows', direction: 'in' },  // who follows user-d? frank
        ], { carryVisitedSet: true })

        // user-a, user-b, user-c should not appear in results
        expect(result.ids).not.toContain('user-a')
        expect(result.ids).not.toContain('user-b')
        expect(result.ids).not.toContain('user-c')
      })

      it('should reset visited set between steps when configured', async () => {
        const index = createMultiRelGraph()
        const engine = createTraversalEngine(index)

        const result = await engine.chain(['user-a'], [
          { relType: 'follows', direction: 'out' },
          { relType: 'follows', direction: 'out' },
        ], { carryVisitedSet: false })

        // With carryVisitedSet: false, we might see overlapping nodes
        // This is the default MongoDB-like behavior
        expect(result.ids).toBeDefined()
      })
    })

    describe('Per-step visited set in depth range', () => {
      it('should not revisit nodes within the same BFS traversal', async () => {
        // Diamond graph: A -> B, A -> C, B -> D, C -> D
        const index = new AdjacencyIndex()
        const now = Date.now()
        index.addEdge({ id: 'r1', type: 'edge', from: 'A', to: 'B', createdAt: now })
        index.addEdge({ id: 'r2', type: 'edge', from: 'A', to: 'C', createdAt: now })
        index.addEdge({ id: 'r3', type: 'edge', from: 'B', to: 'D', createdAt: now })
        index.addEdge({ id: 'r4', type: 'edge', from: 'C', to: 'D', createdAt: now })

        const engine = createTraversalEngine(index)

        const result = await engine.bfs(['A'], {
          depth: { min: 1, max: 2 },
          direction: 'out',
        })

        // D should appear only once even though reachable via B and C
        expect(result.ids).toContain('B')
        expect(result.ids).toContain('C')
        expect(result.ids).toContain('D')
        expect(result.ids.filter(id => id === 'D')).toHaveLength(1)
      })
    })
  })

  // ==========================================================================
  // TRAVERSAL RESULT STRUCTURE
  // ==========================================================================

  describe('Traversal Result Structure', () => {
    it('should return ids array in result', async () => {
      const index = createLinearGraph(5)
      const engine = createTraversalEngine(index)

      const result = await engine.bfs(['node-0'], {
        depth: 1,
        direction: 'out',
      })

      expect(result).toHaveProperty('ids')
      expect(Array.isArray(result.ids)).toBe(true)
    })

    it('should return depths map when returnDepths is true', async () => {
      const index = createLinearGraph(5)
      const engine = createTraversalEngine(index)

      const result = await engine.bfs(['node-0'], {
        depth: { min: 1, max: 3 },
        direction: 'out',
        returnDepths: true,
      })

      expect(result).toHaveProperty('depths')
      expect(result.depths).toBeInstanceOf(Map)
      expect(result.depths!.get('node-1')).toBe(1)
      expect(result.depths!.get('node-2')).toBe(2)
      expect(result.depths!.get('node-3')).toBe(3)
    })

    it('should return paths when returnPaths is true', async () => {
      const index = createLinearGraph(5)
      const engine = createTraversalEngine(index)

      const result = await engine.bfs(['node-0'], {
        depth: 2,
        direction: 'out',
        returnPaths: true,
      })

      expect(result).toHaveProperty('paths')
      expect(result.paths).toBeDefined()
      expect(result.paths!.get('node-2')).toEqual(['node-0', 'node-1', 'node-2'])
    })

    it('should return stats when returnStats is true', async () => {
      const index = createLinearGraph(10)
      const engine = createTraversalEngine(index)

      const result = await engine.bfs(['node-0'], {
        depth: 5,
        direction: 'out',
        returnStats: true,
      })

      expect(result).toHaveProperty('stats')
      expect(result.stats).toHaveProperty('nodesVisited')
      expect(result.stats).toHaveProperty('edgesTraversed')
      expect(result.stats).toHaveProperty('executionTimeMs')
      expect(result.stats!.nodesVisited).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // INTEGRATION TESTS
  // ==========================================================================

  describe('Integration Tests', () => {
    it('should handle friend suggestions (FoF except friends)', async () => {
      const index = createTestGraph()
      const engine = createTraversalEngine(index)

      // Friends of friends who are not already friends
      const friends = await engine.bfs(['alice'], {
        depth: 1,
        direction: 'out',
        edgeTypes: ['follows'],
      })

      const fof = await engine.bfs(['alice'], {
        depth: 2,
        direction: 'out',
        edgeTypes: ['follows'],
      })

      const suggestions = fof.ids.filter(
        id => !friends.ids.includes(id) && id !== 'alice'
      )

      // carol and eve's follows (excluding bob who is already friend)
      expect(suggestions.length).toBeGreaterThan(0)
    })

    it('should handle mutual connections check', async () => {
      const index = createTestGraph()
      const engine = createTraversalEngine(index)

      // Check who alice follows that also follows alice back
      const aliceFollows = await engine.bfs(['alice'], {
        depth: 1,
        direction: 'out',
        edgeTypes: ['follows'],
      })

      const aliceFollowedBy = await engine.bfs(['alice'], {
        depth: 1,
        direction: 'in',
        edgeTypes: ['follows'],
      })

      const mutual = aliceFollows.ids.filter(id =>
        aliceFollowedBy.ids.includes(id)
      )

      expect(mutual).toContain('bob')
    })

    it('should handle content discovery (network likes)', async () => {
      const index = createMultiRelGraph()
      const engine = createTraversalEngine(index)

      // Posts liked by people I follow
      const result = await engine.chain(['user-a'], [
        { relType: 'follows', direction: 'out', depth: { min: 1, max: 2 } },
        { relType: 'likes', direction: 'out' },
      ])

      expect(result.ids).toContain('post-1')
      expect(result.ids).toContain('post-2')
    })
  })
})
