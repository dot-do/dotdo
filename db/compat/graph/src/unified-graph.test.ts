/**
 * Unified Graph SDK Core Types - TDD RED Phase Tests
 * Issue: dotdo-m4azq
 *
 * Failing tests for the unified Graph SDK core interfaces:
 * - GraphNode interface with JSON-LD style properties ($id, $type, $context, $graph)
 * - TraversalOptions interface (depth, where, limit, skip, direction)
 * - Traversal interface (ids, first, count, exists, nodes, toArray)
 * - TypeCollection interface for $Type access
 * - UnifiedGraph interface
 *
 * @see /db/compat/sql/clickhouse/spikes/graph-sdk-unified.ts for spike implementation
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { Equals, Expect, IsNever } from '../tests/type-utils'

// Production module imports (these don't exist yet - that's the RED phase)
import {
  // Core interfaces
  type GraphNode,
  type TraversalOptions,
  type Traversal,
  type TypeCollection,
  type UnifiedGraph,
  // Factory function
  createUnifiedGraph,
  // Base types
  type Thing,
  type Relationship,
} from './unified-graph'

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Helper to create a Thing with minimal properties
 */
function createThing(
  id: string,
  type: string = 'User',
  data: Record<string, unknown> = {}
): Thing {
  return {
    id,
    type,
    ns: 'test',
    data,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

/**
 * Helper to create a Relationship
 */
function createRelationship(
  from: string,
  type: string,
  to: string,
  data: Record<string, unknown> = {}
): Relationship {
  return {
    id: `${from}-${type}-${to}`,
    type,
    from,
    to,
    data,
    createdAt: Date.now(),
  }
}

// ============================================================================
// 1. GraphNode INTERFACE TESTS - JSON-LD Style Properties
// ============================================================================

describe('GraphNode interface - JSON-LD style properties', () => {
  let graph: UnifiedGraph

  beforeEach(() => {
    graph = createUnifiedGraph({ namespace: 'test' })

    // Add test data
    graph.addThing(createThing('user-1', 'User', { name: 'Alice', email: 'alice@example.com' }))
    graph.addThing(createThing('user-2', 'User', { name: 'Bob', email: 'bob@example.com' }))
    graph.addThing(createThing('post-1', 'Post', { title: 'Hello World' }))

    graph.addRelationship(createRelationship('user-1', 'follows', 'user-2'))
    graph.addRelationship(createRelationship('user-1', 'authored', 'post-1'))
  })

  describe('$id property', () => {
    it('should have readonly $id property', () => {
      const node = graph.node('user-1')

      expect(node.$id).toBe('user-1')
    })

    it('should return correct $id for different nodes', () => {
      const user = graph.node('user-1')
      const post = graph.node('post-1')

      expect(user.$id).toBe('user-1')
      expect(post.$id).toBe('post-1')
    })

    it('should have $id as string type', () => {
      const node = graph.node('user-1')

      // Type-level check
      type IdType = typeof node.$id
      type _Check = Expect<Equals<IdType, string>>

      expect(typeof node.$id).toBe('string')
    })
  })

  describe('$type property', () => {
    it('should have readonly $type property', () => {
      const node = graph.node('user-1')

      expect(node.$type).toBe('User')
    })

    it('should return correct $type for different node types', () => {
      const user = graph.node('user-1')
      const post = graph.node('post-1')

      expect(user.$type).toBe('User')
      expect(post.$type).toBe('Post')
    })

    it('should support $type as string or string[] (for multi-type nodes)', () => {
      const node = graph.node('user-1')

      // Type-level check: $type should be string | string[]
      type TypeProp = typeof node.$type
      type _Check = Expect<TypeProp extends string | string[] ? true : false>

      expect(typeof node.$type === 'string' || Array.isArray(node.$type)).toBe(true)
    })

    it('should support multi-type nodes with string[] $type', () => {
      // Add a node with multiple types
      graph.addThing({
        id: 'multi-type-1',
        type: ['User', 'Admin'],
        ns: 'test',
        data: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as Thing)

      const multiNode = graph.node('multi-type-1')

      // Should be an array of types
      expect(Array.isArray(multiNode.$type) || typeof multiNode.$type === 'string').toBe(true)
    })
  })

  describe('$context property', () => {
    it('should have optional $context property', () => {
      const node = graph.node('user-1')

      // $context is optional, so it can be undefined
      expect(node.$context === undefined || typeof node.$context === 'string').toBe(true)
    })

    it('should support custom $context for JSON-LD compliance', () => {
      const graphWithContext = createUnifiedGraph({
        namespace: 'test',
        context: 'https://schema.org',
      })

      graphWithContext.addThing(createThing('user-ctx', 'User', { name: 'Context User' }))

      const node = graphWithContext.node('user-ctx')

      // Type-level check: $context should be string | undefined
      type ContextType = typeof node.$context
      type _Check = Expect<ContextType extends string | undefined ? true : false>

      expect(node.$context === undefined || typeof node.$context === 'string').toBe(true)
    })
  })

  describe('$graph property', () => {
    it('should have readonly $graph reference back to UnifiedGraph', () => {
      const node = graph.node('user-1')

      expect(node.$graph).toBeDefined()
      expect(node.$graph).toBe(graph)
    })

    it('should allow traversing back to graph for further operations', () => {
      const node = graph.node('user-1')
      const anotherNode = node.$graph.node('user-2')

      expect(anotherNode.$id).toBe('user-2')
    })

    it('should have $graph as UnifiedGraph type', () => {
      const node = graph.node('user-1')

      // Type-level check
      type GraphRef = typeof node.$graph
      type _Check = Expect<GraphRef extends UnifiedGraph ? true : false>

      expect(node.$graph).toBeDefined()
    })
  })

  describe('data property', () => {
    it('should have readonly data property with node properties', () => {
      const node = graph.node('user-1')

      expect(node.data).toBeDefined()
      expect(node.data.name).toBe('Alice')
      expect(node.data.email).toBe('alice@example.com')
    })

    it('should have data as Record<string, unknown>', () => {
      const node = graph.node('user-1')

      // Type-level check
      type DataType = typeof node.data
      type _Check = Expect<DataType extends Record<string, unknown> ? true : false>

      expect(typeof node.data).toBe('object')
    })
  })
})

// ============================================================================
// 2. GraphNode INTERFACE TESTS - Traversal Properties
// ============================================================================

describe('GraphNode interface - Traversal properties', () => {
  let graph: UnifiedGraph

  beforeEach(() => {
    graph = createUnifiedGraph({ namespace: 'test' })

    // Create test users and relationships
    graph.addThings([
      createThing('alice', 'User', { name: 'Alice' }),
      createThing('bob', 'User', { name: 'Bob' }),
      createThing('carol', 'User', { name: 'Carol' }),
      createThing('dave', 'User', { name: 'Dave' }),
      createThing('post-1', 'Post', { title: 'First Post' }),
      createThing('post-2', 'Post', { title: 'Second Post' }),
    ])

    graph.addRelationships([
      createRelationship('alice', 'follows', 'bob'),
      createRelationship('alice', 'follows', 'carol'),
      createRelationship('bob', 'follows', 'carol'),
      createRelationship('bob', 'follows', 'dave'),
      createRelationship('alice', 'likes', 'post-1'),
      createRelationship('bob', 'likes', 'post-2'),
    ])
  })

  describe('$relationship syntax - property access', () => {
    it('should support $follows as property access returning Traversal', async () => {
      const alice = graph.node('alice')

      // Property access should return a Traversal
      const followsTraversal = alice.$follows

      expect(followsTraversal).toBeDefined()
      expect(typeof followsTraversal.ids).toBe('function')
      expect(typeof followsTraversal.nodes).toBe('function')
    })

    it('should traverse outgoing edges with $follows', async () => {
      const alice = graph.node('alice')

      const followingIds = await alice.$follows.ids()

      expect(followingIds).toContain('bob')
      expect(followingIds).toContain('carol')
      expect(followingIds).toHaveLength(2)
    })

    it('should support $likes traversal', async () => {
      const alice = graph.node('alice')

      const likedIds = await alice.$likes.ids()

      expect(likedIds).toContain('post-1')
    })
  })

  describe('$relationship syntax - function call with options', () => {
    it('should support $follows() as function call', async () => {
      const alice = graph.node('alice')

      const followsTraversal = alice.$follows()

      expect(followsTraversal).toBeDefined()
      expect(typeof followsTraversal.ids).toBe('function')
    })

    it('should support $follows({ depth: 2 }) for multi-hop traversal', async () => {
      const alice = graph.node('alice')

      // Friends of friends (depth 2)
      const fofIds = await alice.$follows({ depth: 2 }).ids()

      // alice -> bob -> (carol, dave), alice -> carol -> (nobody)
      expect(fofIds).toContain('carol')
      expect(fofIds).toContain('dave')
    })

    it('should support depth as { min, max } range', async () => {
      const alice = graph.node('alice')

      const rangeIds = await alice.$follows({ depth: { min: 1, max: 2 } }).ids()

      // Should include direct follows AND friends-of-friends
      expect(rangeIds.length).toBeGreaterThan(0)
    })

    it('should support where option for filtering', async () => {
      const alice = graph.node('alice')

      const filteredIds = await alice.$follows({
        where: { name: 'Bob' },
      }).ids()

      expect(filteredIds).toContain('bob')
      expect(filteredIds).not.toContain('carol')
    })

    it('should support limit option', async () => {
      const alice = graph.node('alice')

      const limitedIds = await alice.$follows({ limit: 1 }).ids()

      expect(limitedIds).toHaveLength(1)
    })

    it('should support skip option', async () => {
      const alice = graph.node('alice')

      const allIds = await alice.$follows.ids()
      const skippedIds = await alice.$follows({ skip: 1 }).ids()

      expect(skippedIds.length).toBe(allIds.length - 1)
    })

    it('should support direction option', async () => {
      const bob = graph.node('bob')

      // Get incoming follows (who follows bob)
      const followersIds = await bob.$follows({ direction: 'in' }).ids()

      expect(followersIds).toContain('alice')
    })
  })

  describe('$followedBy - smart reverse detection', () => {
    it('should auto-detect reverse traversal with $followedBy', async () => {
      const bob = graph.node('bob')

      // $followedBy should traverse incoming 'follows' edges
      const followerIds = await bob.$followedBy.ids()

      expect(followerIds).toContain('alice')
    })

    it('should support $likedBy for reverse likes', async () => {
      const post = graph.node('post-1')

      const likerIds = await post.$likedBy.ids()

      expect(likerIds).toContain('alice')
    })
  })

  describe('$out / $in / $expand - any-relationship traversal', () => {
    it('should have $out method for any outgoing edges', async () => {
      const alice = graph.node('alice')

      const outIds = await alice.$out(1).ids()

      // Should include both follows and likes targets
      expect(outIds).toContain('bob')
      expect(outIds).toContain('carol')
      expect(outIds).toContain('post-1')
    })

    it('should have $in method for any incoming edges', async () => {
      const bob = graph.node('bob')

      const inIds = await bob.$in(1).ids()

      // Should include alice who follows bob
      expect(inIds).toContain('alice')
    })

    it('should have $expand method for both directions', async () => {
      const bob = graph.node('bob')

      const neighborIds = await bob.$expand(1).ids()

      // Should include both incoming and outgoing
      expect(neighborIds).toContain('alice') // incoming follows
      expect(neighborIds).toContain('carol') // outgoing follows
      expect(neighborIds).toContain('dave') // outgoing follows
    })

    it('should support options with $out/$in/$expand', async () => {
      const alice = graph.node('alice')

      const limitedOut = await alice.$out(1, { limit: 2 }).ids()

      expect(limitedOut).toHaveLength(2)
    })
  })
})

// ============================================================================
// 3. TraversalOptions INTERFACE TESTS
// ============================================================================

describe('TraversalOptions interface', () => {
  let graph: UnifiedGraph

  beforeEach(() => {
    graph = createUnifiedGraph({ namespace: 'test' })

    // Create a deeper graph for testing
    for (let i = 1; i <= 10; i++) {
      graph.addThing(createThing(`user-${i}`, 'User', { name: `User ${i}`, verified: i % 2 === 0 }))
    }

    // Chain: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10
    for (let i = 1; i < 10; i++) {
      graph.addRelationship(createRelationship(`user-${i}`, 'follows', `user-${i + 1}`))
    }
  })

  describe('depth option', () => {
    it('should accept depth as number', async () => {
      const user1 = graph.node('user-1')

      const depth2Ids = await user1.$follows({ depth: 2 }).ids()

      // user-1 -> user-2 -> user-3
      expect(depth2Ids).toContain('user-3')
    })

    it('should accept depth as { min: number }', async () => {
      const user1 = graph.node('user-1')

      const minDepthIds = await user1.$follows({ depth: { min: 2 } }).ids()

      // Should not include user-2 (depth 1)
      expect(minDepthIds).not.toContain('user-2')
      expect(minDepthIds).toContain('user-3') // depth 2
    })

    it('should accept depth as { max: number }', async () => {
      const user1 = graph.node('user-1')

      const maxDepthIds = await user1.$follows({ depth: { max: 3 } }).ids()

      // Should include depth 1, 2, 3
      expect(maxDepthIds).toContain('user-2')
      expect(maxDepthIds).toContain('user-3')
      expect(maxDepthIds).toContain('user-4')
    })

    it('should accept depth as { min: number, max: number }', async () => {
      const user1 = graph.node('user-1')

      const rangeIds = await user1.$follows({ depth: { min: 2, max: 4 } }).ids()

      // Should include depths 2, 3, 4 but not 1
      expect(rangeIds).not.toContain('user-2')
      expect(rangeIds).toContain('user-3')
      expect(rangeIds).toContain('user-4')
      expect(rangeIds).toContain('user-5')
    })
  })

  describe('where option', () => {
    it('should accept where as Record<string, unknown>', async () => {
      const user1 = graph.node('user-1')

      const verifiedIds = await user1.$follows({
        depth: 5,
        where: { verified: true },
      }).ids()

      // Only even-numbered users are verified
      expect(verifiedIds).toContain('user-2')
      expect(verifiedIds).toContain('user-4')
      expect(verifiedIds).not.toContain('user-3')
      expect(verifiedIds).not.toContain('user-5')
    })

    it('should accept where as predicate function', async () => {
      const user1 = graph.node('user-1')

      const customFilterIds = await user1.$follows({
        depth: 5,
        where: (node: Thing) => node.data.name?.toString().includes('3'),
      }).ids()

      expect(customFilterIds).toContain('user-3')
    })
  })

  describe('limit option', () => {
    it('should limit results to specified count', async () => {
      const user1 = graph.node('user-1')

      const limitedIds = await user1.$follows({ depth: 5, limit: 3 }).ids()

      expect(limitedIds).toHaveLength(3)
    })

    it('should return fewer than limit if not enough results', async () => {
      const user1 = graph.node('user-1')

      const limitedIds = await user1.$follows({ depth: 2, limit: 100 }).ids()

      // Only 2 users reachable at depth 2
      expect(limitedIds.length).toBeLessThanOrEqual(2)
    })
  })

  describe('skip option', () => {
    it('should skip specified number of results', async () => {
      const user1 = graph.node('user-1')

      const allIds = await user1.$follows({ depth: 5 }).ids()
      const skippedIds = await user1.$follows({ depth: 5, skip: 2 }).ids()

      expect(skippedIds.length).toBe(allIds.length - 2)
    })

    it('should work with limit for pagination', async () => {
      const user1 = graph.node('user-1')

      const page1 = await user1.$follows({ depth: 5, limit: 2, skip: 0 }).ids()
      const page2 = await user1.$follows({ depth: 5, limit: 2, skip: 2 }).ids()

      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(2)

      // Pages should not overlap
      for (const id of page1) {
        expect(page2).not.toContain(id)
      }
    })
  })

  describe('direction option', () => {
    it('should support direction: "out"', async () => {
      const user5 = graph.node('user-5')

      const outIds = await user5.$follows({ direction: 'out' }).ids()

      expect(outIds).toContain('user-6')
    })

    it('should support direction: "in"', async () => {
      const user5 = graph.node('user-5')

      const inIds = await user5.$follows({ direction: 'in' }).ids()

      expect(inIds).toContain('user-4')
    })

    it('should support direction: "both"', async () => {
      const user5 = graph.node('user-5')

      const bothIds = await user5.$follows({ direction: 'both' }).ids()

      expect(bothIds).toContain('user-4') // incoming
      expect(bothIds).toContain('user-6') // outgoing
    })
  })
})

// ============================================================================
// 4. Traversal INTERFACE TESTS
// ============================================================================

describe('Traversal interface', () => {
  let graph: UnifiedGraph

  beforeEach(() => {
    graph = createUnifiedGraph({ namespace: 'test' })

    graph.addThings([
      createThing('alice', 'User', { name: 'Alice', verified: true }),
      createThing('bob', 'User', { name: 'Bob', verified: false }),
      createThing('carol', 'User', { name: 'Carol', verified: true }),
      createThing('dave', 'User', { name: 'Dave', verified: false }),
      createThing('eve', 'User', { name: 'Eve', verified: true }),
    ])

    graph.addRelationships([
      createRelationship('alice', 'follows', 'bob'),
      createRelationship('alice', 'follows', 'carol'),
      createRelationship('alice', 'follows', 'dave'),
      createRelationship('bob', 'follows', 'carol'),
      createRelationship('bob', 'follows', 'eve'),
    ])
  })

  describe('ids() method', () => {
    it('should return Promise<string[]>', async () => {
      const alice = graph.node('alice')

      const ids = await alice.$follows.ids()

      expect(Array.isArray(ids)).toBe(true)
      expect(ids.every(id => typeof id === 'string')).toBe(true)
    })

    it('should return empty array when no results', async () => {
      const eve = graph.node('eve')

      const ids = await eve.$follows.ids()

      expect(ids).toEqual([])
    })
  })

  describe('first() method', () => {
    it('should return Promise<T | null>', async () => {
      const alice = graph.node('alice')

      const first = await alice.$follows.first()

      expect(first === null || typeof first === 'object').toBe(true)
    })

    it('should return single node when results exist', async () => {
      const alice = graph.node('alice')

      const first = await alice.$follows.first()

      expect(first).not.toBeNull()
      expect(first!.id).toBeDefined()
    })

    it('should return null when no results', async () => {
      const eve = graph.node('eve')

      const first = await eve.$follows.first()

      expect(first).toBeNull()
    })
  })

  describe('count() method', () => {
    it('should return Promise<number>', async () => {
      const alice = graph.node('alice')

      const count = await alice.$follows.count()

      expect(typeof count).toBe('number')
      expect(count).toBe(3)
    })

    it('should return 0 when no results', async () => {
      const eve = graph.node('eve')

      const count = await eve.$follows.count()

      expect(count).toBe(0)
    })
  })

  describe('exists() method', () => {
    it('should return Promise<boolean>', async () => {
      const alice = graph.node('alice')

      const exists = await alice.$follows.exists()

      expect(typeof exists).toBe('boolean')
      expect(exists).toBe(true)
    })

    it('should return false when no results', async () => {
      const eve = graph.node('eve')

      const exists = await eve.$follows.exists()

      expect(exists).toBe(false)
    })
  })

  describe('nodes() method', () => {
    it('should return Promise<T[]>', async () => {
      const alice = graph.node('alice')

      const nodes = await alice.$follows.nodes()

      expect(Array.isArray(nodes)).toBe(true)
      expect(nodes.every(n => typeof n === 'object' && n.id)).toBe(true)
    })

    it('should return Thing objects with expected properties', async () => {
      const alice = graph.node('alice')

      const nodes = await alice.$follows.nodes()

      for (const node of nodes) {
        expect(node).toHaveProperty('id')
        expect(node).toHaveProperty('type')
        expect(node).toHaveProperty('data')
      }
    })
  })

  describe('toArray() method', () => {
    it('should be alias for nodes()', async () => {
      const alice = graph.node('alice')

      const fromNodes = await alice.$follows.nodes()
      const fromToArray = await alice.$follows.toArray()

      expect(fromNodes.map(n => n.id).sort()).toEqual(fromToArray.map(n => n.id).sort())
    })
  })

  describe('$stream property', () => {
    it('should be AsyncIterable<T>', async () => {
      const alice = graph.node('alice')

      const stream = alice.$follows.$stream

      expect(stream[Symbol.asyncIterator]).toBeDefined()
    })

    it('should yield nodes one at a time', async () => {
      const alice = graph.node('alice')

      const nodes: Thing[] = []
      for await (const node of alice.$follows.$stream) {
        nodes.push(node)
      }

      expect(nodes.length).toBe(3)
    })
  })

  describe('$batch() method', () => {
    it('should return AsyncIterable<T[]>', async () => {
      const alice = graph.node('alice')

      const batches = alice.$follows.$batch(2)

      expect(batches[Symbol.asyncIterator]).toBeDefined()
    })

    it('should yield batches of specified size', async () => {
      const alice = graph.node('alice')

      const batches: Thing[][] = []
      for await (const batch of alice.$follows.$batch(2)) {
        batches.push(batch)
      }

      // 3 items with batch size 2 = 2 batches (2 + 1)
      expect(batches.length).toBe(2)
      expect(batches[0].length).toBe(2)
      expect(batches[1].length).toBe(1)
    })
  })

  describe('Symbol.asyncIterator', () => {
    it('should support for-await-of iteration', async () => {
      const alice = graph.node('alice')

      const nodes: Thing[] = []
      for await (const node of alice.$follows) {
        nodes.push(node)
      }

      expect(nodes.length).toBe(3)
    })
  })

  describe('Set operations', () => {
    it('should have intersect() method', async () => {
      const alice = graph.node('alice')
      const bob = graph.node('bob')

      // People both Alice and Bob follow
      const mutual = await alice.$follows.intersect(bob.$follows).ids()

      expect(mutual).toContain('carol') // Both follow carol
    })

    it('should have union() method', async () => {
      const alice = graph.node('alice')
      const bob = graph.node('bob')

      // Everyone either Alice or Bob follows
      const combined = await alice.$follows.union(bob.$follows).ids()

      expect(combined).toContain('bob')
      expect(combined).toContain('carol')
      expect(combined).toContain('dave')
      expect(combined).toContain('eve')
    })

    it('should have except() method with Traversal', async () => {
      const alice = graph.node('alice')

      // FoF except direct friends (friend suggestions)
      const fofExceptFriends = await alice.$follows.$follows.except(alice.$follows).ids()

      expect(fofExceptFriends).toContain('eve') // bob follows eve, alice doesn't
      expect(fofExceptFriends).not.toContain('carol') // alice already follows carol
    })

    it('should have except() method with string[]', async () => {
      const alice = graph.node('alice')

      const exceptSpecific = await alice.$follows.except(['bob', 'dave']).ids()

      expect(exceptSpecific).toContain('carol')
      expect(exceptSpecific).not.toContain('bob')
      expect(exceptSpecific).not.toContain('dave')
    })
  })

  describe('Chaining traversals', () => {
    it('should chain relationship traversals', async () => {
      const alice = graph.node('alice')

      // Friends of friends
      const fofIds = await alice.$follows.$follows.ids()

      expect(fofIds).toContain('carol')
      expect(fofIds).toContain('eve')
    })

    it('should preserve traversal methods after chaining', async () => {
      const alice = graph.node('alice')

      const fofTraversal = alice.$follows.$follows

      expect(typeof fofTraversal.ids).toBe('function')
      expect(typeof fofTraversal.first).toBe('function')
      expect(typeof fofTraversal.count).toBe('function')
    })
  })
})

// ============================================================================
// 5. TypeCollection INTERFACE TESTS
// ============================================================================

describe('TypeCollection interface', () => {
  let graph: UnifiedGraph

  beforeEach(() => {
    graph = createUnifiedGraph({ namespace: 'test' })

    graph.addThings([
      createThing('user-1', 'User', { name: 'Alice', verified: true, role: 'admin' }),
      createThing('user-2', 'User', { name: 'Bob', verified: false, role: 'user' }),
      createThing('user-3', 'User', { name: 'Carol', verified: true, role: 'user' }),
      createThing('post-1', 'Post', { title: 'First Post', published: true }),
      createThing('post-2', 'Post', { title: 'Second Post', published: false }),
    ])
  })

  describe('$Type accessor on graph', () => {
    it('should access $User collection', () => {
      const userCollection = graph.$User

      expect(userCollection).toBeDefined()
    })

    it('should access $Post collection', () => {
      const postCollection = graph.$Post

      expect(postCollection).toBeDefined()
    })
  })

  describe('TypeCollection callable - get all', () => {
    it('should return all items of type when called with no args', async () => {
      const allUsers = await graph.$User()

      expect(Array.isArray(allUsers)).toBe(true)
      expect(allUsers).toHaveLength(3)
      expect(allUsers.every(u => u.type === 'User')).toBe(true)
    })

    it('should return empty array for type with no items', async () => {
      const allComments = await graph.$Comment()

      expect(allComments).toEqual([])
    })
  })

  describe('TypeCollection callable - get by ID', () => {
    it('should return GraphNode when called with ID', () => {
      const user = graph.$User('user-1')

      expect(user).toBeDefined()
      expect(user.$id).toBe('user-1')
    })

    it('should return node with correct properties', () => {
      const user = graph.$User('user-1')

      expect(user.$type).toBe('User')
      expect(user.data.name).toBe('Alice')
    })
  })

  describe('where() method', () => {
    it('should filter by predicate', async () => {
      const verifiedUsers = await graph.$User.where({ verified: true }).toArray()

      expect(verifiedUsers).toHaveLength(2)
      expect(verifiedUsers.every(u => u.data.verified === true)).toBe(true)
    })

    it('should return empty when no matches', async () => {
      const noMatches = await graph.$User.where({ role: 'superadmin' }).toArray()

      expect(noMatches).toEqual([])
    })

    it('should return Traversal for chaining', () => {
      const traversal = graph.$User.where({ verified: true })

      expect(typeof traversal.ids).toBe('function')
      expect(typeof traversal.count).toBe('function')
    })
  })

  describe('find() method', () => {
    it('should return first matching item or null', async () => {
      const admin = await graph.$User.find({ role: 'admin' })

      expect(admin).not.toBeNull()
      expect(admin!.data.role).toBe('admin')
    })

    it('should return null when no matches', async () => {
      const notFound = await graph.$User.find({ role: 'superadmin' })

      expect(notFound).toBeNull()
    })
  })

  describe('$stream property', () => {
    it('should be AsyncIterable', async () => {
      const users: Thing[] = []
      for await (const user of graph.$User.$stream) {
        users.push(user)
      }

      expect(users).toHaveLength(3)
    })
  })

  describe('$batch() method', () => {
    it('should yield batches', async () => {
      const batches: Thing[][] = []
      for await (const batch of graph.$User.$batch(2)) {
        batches.push(batch)
      }

      expect(batches.length).toBe(2)
    })
  })
})

// ============================================================================
// 6. UnifiedGraph INTERFACE TESTS
// ============================================================================

describe('UnifiedGraph interface', () => {
  describe('createUnifiedGraph factory', () => {
    it('should create graph with namespace', () => {
      const graph = createUnifiedGraph({ namespace: 'social' })

      expect(graph).toBeDefined()
    })

    it('should create graph with optional context', () => {
      const graph = createUnifiedGraph({
        namespace: 'social',
        context: 'https://schema.org',
      })

      expect(graph).toBeDefined()
    })
  })

  describe('node() method', () => {
    it('should return GraphNode for given ID', () => {
      const graph = createUnifiedGraph({ namespace: 'test' })
      graph.addThing(createThing('user-1', 'User', { name: 'Alice' }))

      const node = graph.node('user-1')

      expect(node.$id).toBe('user-1')
    })

    it('should be generic for type parameter', () => {
      const graph = createUnifiedGraph({ namespace: 'test' })
      graph.addThing(createThing('user-1', 'User', { name: 'Alice' }))

      const node = graph.node<Thing>('user-1')

      // Type-level check
      type NodeType = typeof node
      type _Check = Expect<NodeType extends GraphNode<Thing> ? true : false>

      expect(node.$id).toBe('user-1')
    })
  })

  describe('addRelationship() method', () => {
    it('should add single relationship', () => {
      const graph = createUnifiedGraph({ namespace: 'test' })
      graph.addThing(createThing('alice', 'User'))
      graph.addThing(createThing('bob', 'User'))

      graph.addRelationship(createRelationship('alice', 'follows', 'bob'))

      // Verify by traversing
      const alice = graph.node('alice')
      expect(alice.$follows).toBeDefined()
    })
  })

  describe('addRelationships() method', () => {
    it('should add multiple relationships', async () => {
      const graph = createUnifiedGraph({ namespace: 'test' })
      graph.addThings([
        createThing('alice', 'User'),
        createThing('bob', 'User'),
        createThing('carol', 'User'),
      ])

      graph.addRelationships([
        createRelationship('alice', 'follows', 'bob'),
        createRelationship('alice', 'follows', 'carol'),
      ])

      const alice = graph.node('alice')
      const followingIds = await alice.$follows.ids()

      expect(followingIds).toHaveLength(2)
    })
  })

  describe('addThing() method', () => {
    it('should add single thing', () => {
      const graph = createUnifiedGraph({ namespace: 'test' })

      graph.addThing(createThing('user-1', 'User', { name: 'Alice' }))

      const node = graph.node('user-1')
      expect(node.data.name).toBe('Alice')
    })
  })

  describe('addThings() method', () => {
    it('should add multiple things', () => {
      const graph = createUnifiedGraph({ namespace: 'test' })

      graph.addThings([
        createThing('user-1', 'User', { name: 'Alice' }),
        createThing('user-2', 'User', { name: 'Bob' }),
      ])

      const alice = graph.node('user-1')
      const bob = graph.node('user-2')

      expect(alice.data.name).toBe('Alice')
      expect(bob.data.name).toBe('Bob')
    })
  })

  describe('$Type collection accessors', () => {
    it('should provide dynamic $Type accessors', async () => {
      const graph = createUnifiedGraph({ namespace: 'test' })
      graph.addThings([
        createThing('user-1', 'User', { name: 'Alice' }),
        createThing('post-1', 'Post', { title: 'Hello' }),
      ])

      const users = await graph.$User()
      const posts = await graph.$Post()

      expect(users).toHaveLength(1)
      expect(posts).toHaveLength(1)
    })
  })
})

// ============================================================================
// 7. TYPE SAFETY TESTS
// ============================================================================

describe('Type safety', () => {
  describe('GraphNode type parameters', () => {
    it('should preserve type through traversal', async () => {
      const graph = createUnifiedGraph({ namespace: 'test' })
      graph.addThings([
        createThing('alice', 'User'),
        createThing('bob', 'User'),
      ])
      graph.addRelationship(createRelationship('alice', 'follows', 'bob'))

      const alice = graph.node<Thing>('alice')
      const followers = await alice.$follows.nodes()

      // Type check: followers should be Thing[]
      type FollowersType = typeof followers
      type _Check = Expect<FollowersType extends Thing[] ? true : false>

      expect(followers[0]).toHaveProperty('id')
    })
  })

  describe('Traversal return types', () => {
    it('should have correct return types for all methods', () => {
      const graph = createUnifiedGraph({ namespace: 'test' })
      graph.addThing(createThing('alice', 'User'))
      const alice = graph.node('alice')
      const traversal = alice.$follows

      // Type checks
      type IdsReturn = ReturnType<typeof traversal.ids>
      type FirstReturn = ReturnType<typeof traversal.first>
      type CountReturn = ReturnType<typeof traversal.count>
      type ExistsReturn = ReturnType<typeof traversal.exists>
      type NodesReturn = ReturnType<typeof traversal.nodes>
      type ToArrayReturn = ReturnType<typeof traversal.toArray>

      type _CheckIds = Expect<IdsReturn extends Promise<string[]> ? true : false>
      type _CheckFirst = Expect<FirstReturn extends Promise<Thing | null> ? true : false>
      type _CheckCount = Expect<CountReturn extends Promise<number> ? true : false>
      type _CheckExists = Expect<ExistsReturn extends Promise<boolean> ? true : false>
      type _CheckNodes = Expect<NodesReturn extends Promise<Thing[]> ? true : false>
      type _CheckToArray = Expect<ToArrayReturn extends Promise<Thing[]> ? true : false>

      expect(true).toBe(true) // Type-level test
    })
  })

  describe('TraversalOptions type safety', () => {
    it('should accept valid TraversalOptions', () => {
      const graph = createUnifiedGraph({ namespace: 'test' })
      graph.addThing(createThing('alice', 'User'))
      const alice = graph.node('alice')

      // These should all be valid
      const _valid1 = alice.$follows({ depth: 2 })
      const _valid2 = alice.$follows({ depth: { min: 1, max: 3 } })
      const _valid3 = alice.$follows({ where: { verified: true } })
      const _valid4 = alice.$follows({ where: (n: Thing) => n.data.verified === true })
      const _valid5 = alice.$follows({ limit: 10 })
      const _valid6 = alice.$follows({ skip: 5 })
      const _valid7 = alice.$follows({ direction: 'out' })
      const _valid8 = alice.$follows({ direction: 'in' })
      const _valid9 = alice.$follows({ direction: 'both' })

      expect(true).toBe(true) // Compile-time test
    })
  })
})

// ============================================================================
// 8. EDGE CASES
// ============================================================================

describe('Edge cases', () => {
  let graph: UnifiedGraph

  beforeEach(() => {
    graph = createUnifiedGraph({ namespace: 'test' })
  })

  it('should handle non-existent nodes gracefully', () => {
    const node = graph.node('non-existent')

    // Should return a node object even for non-existent IDs
    expect(node.$id).toBe('non-existent')
  })

  it('should handle empty traversal results', async () => {
    graph.addThing(createThing('lonely', 'User'))
    const lonely = graph.node('lonely')

    const ids = await lonely.$follows.ids()
    const first = await lonely.$follows.first()
    const count = await lonely.$follows.count()
    const exists = await lonely.$follows.exists()

    expect(ids).toEqual([])
    expect(first).toBeNull()
    expect(count).toBe(0)
    expect(exists).toBe(false)
  })

  it('should handle self-referential relationships', async () => {
    graph.addThing(createThing('narcissist', 'User'))
    graph.addRelationship(createRelationship('narcissist', 'follows', 'narcissist'))

    const narcissist = graph.node('narcissist')
    const selfFollows = await narcissist.$follows.ids()

    expect(selfFollows).toContain('narcissist')
  })

  it('should handle circular relationships', async () => {
    graph.addThings([
      createThing('a', 'User'),
      createThing('b', 'User'),
      createThing('c', 'User'),
    ])
    graph.addRelationships([
      createRelationship('a', 'follows', 'b'),
      createRelationship('b', 'follows', 'c'),
      createRelationship('c', 'follows', 'a'),
    ])

    const a = graph.node('a')

    // Should not hang or throw
    const fofIds = await a.$follows.$follows.ids()

    expect(fofIds).toContain('c')
  })

  it('should handle nodes with multiple types', async () => {
    graph.addThing({
      id: 'admin-user',
      type: ['User', 'Admin'],
      ns: 'test',
      data: { name: 'Admin' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as Thing)

    const adminUser = graph.node('admin-user')

    expect(adminUser.$type).toEqual(['User', 'Admin'])
  })

  it('should handle special characters in relationship types', async () => {
    graph.addThings([
      createThing('a', 'User'),
      createThing('b', 'User'),
    ])
    graph.addRelationship(createRelationship('a', 'has_written', 'b'))

    const a = graph.node('a')

    const ids = await a.$has_written.ids()

    expect(ids).toContain('b')
  })
})

// ============================================================================
// 9. REAL-WORLD PATTERNS
// ============================================================================

describe('Real-world patterns', () => {
  let graph: UnifiedGraph

  beforeEach(() => {
    graph = createUnifiedGraph({ namespace: 'social' })

    // Setup a realistic social graph
    graph.addThings([
      createThing('alice', 'User', { name: 'Alice', verified: true }),
      createThing('bob', 'User', { name: 'Bob', verified: true }),
      createThing('carol', 'User', { name: 'Carol', verified: false }),
      createThing('dave', 'User', { name: 'Dave', verified: true }),
      createThing('eve', 'User', { name: 'Eve', verified: false }),
      createThing('post-1', 'Post', { title: 'Hello World', author: 'alice' }),
      createThing('post-2', 'Post', { title: 'Tech News', author: 'bob' }),
      createThing('post-3', 'Post', { title: 'Random Thoughts', author: 'carol' }),
    ])

    graph.addRelationships([
      // Social connections
      createRelationship('alice', 'follows', 'bob'),
      createRelationship('alice', 'follows', 'carol'),
      createRelationship('bob', 'follows', 'alice'),
      createRelationship('bob', 'follows', 'dave'),
      createRelationship('carol', 'follows', 'dave'),
      createRelationship('dave', 'follows', 'eve'),
      // Content interactions
      createRelationship('alice', 'likes', 'post-2'),
      createRelationship('alice', 'likes', 'post-3'),
      createRelationship('bob', 'likes', 'post-1'),
      createRelationship('carol', 'likes', 'post-1'),
      createRelationship('carol', 'likes', 'post-2'),
      // Authorship
      createRelationship('alice', 'authored', 'post-1'),
      createRelationship('bob', 'authored', 'post-2'),
      createRelationship('carol', 'authored', 'post-3'),
    ])
  })

  it('should find verified friends of friends', async () => {
    const alice = graph.node('alice')

    const verifiedFoF = await alice.$follows({
      depth: 2,
      where: { verified: true },
    }).ids()

    // Bob's friends include Dave (verified)
    expect(verifiedFoF).toContain('dave')
  })

  it('should find mutual followers', async () => {
    const alice = graph.node('alice')
    const bob = graph.node('bob')

    const mutualFollows = await alice.$follows.intersect(bob.$follows).ids()

    // Alice doesn't follow Dave but Bob does, Carol is only followed by Alice
    // Actually looking at the data: alice follows bob, carol. bob follows alice, dave
    // So no mutual follows
    expect(mutualFollows).toEqual([])
  })

  it('should find friend suggestions (FoF not already friends)', async () => {
    const alice = graph.node('alice')

    const suggestions = await alice.$follows.$follows.except(alice.$follows).ids()

    // alice -> bob -> (alice, dave), alice -> carol -> dave
    // except alice's follows (bob, carol)
    // Result should include dave (and alice from bob, but alice should exclude herself?)
    expect(suggestions).toContain('dave')
  })

  it('should find posts liked by friends', async () => {
    const alice = graph.node('alice')

    const postsLikedByFriends = await alice.$follows.$likes.ids()

    // bob likes post-1, carol likes post-1, post-2
    expect(postsLikedByFriends).toContain('post-1')
    expect(postsLikedByFriends).toContain('post-2')
  })

  it('should find authors of posts liked by network', async () => {
    const alice = graph.node('alice')

    const authorsOfLikedPosts = await alice.$follows.$likes.$authoredBy.ids()

    // Friends like posts by alice and bob
    expect(authorsOfLikedPosts).toContain('alice')
    expect(authorsOfLikedPosts).toContain('bob')
  })

  it('should explore 2-hop neighborhood', async () => {
    const alice = graph.node('alice')

    const neighborhood = await alice.$expand(2).ids()

    // Should include all nodes reachable within 2 hops in any direction
    expect(neighborhood.length).toBeGreaterThan(0)
  })

  it('should paginate through large result sets', async () => {
    const allUsers = await graph.$User()
    expect(allUsers.length).toBe(5)

    const page1 = await graph.$User.where({}).$batch(2)
    const pages: Thing[][] = []
    for await (const batch of page1) {
      pages.push(batch)
    }

    expect(pages.length).toBeGreaterThan(0)
  })
})
