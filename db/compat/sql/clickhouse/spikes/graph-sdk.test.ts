/**
 * Tests for Magic $ Graph SDK
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  Graph,
  createGraph,
  GraphNode,
  Traversal,
  createMagicTraversal,
  MagicTraversal,
} from './graph-sdk'
import {
  AdjacencyIndex,
  GraphTraversalEngine,
  Thing,
  Relationship,
  generateSocialGraph,
} from './graph-query-engine'

describe('Graph SDK', () => {
  describe('Graph Client', () => {
    it('should create a graph client', () => {
      const graph = createGraph({ namespace: 'test' })
      expect(graph).toBeDefined()
      expect(graph.namespace).toBe('test')
    })

    it('should add relationships', () => {
      const graph = createGraph({ namespace: 'test' })

      graph.addRelationship({
        id: 'rel-1',
        type: 'follows',
        from: 'user-1',
        to: 'user-2',
        createdAt: Date.now(),
      })

      const stats = graph.getStats()
      expect(stats.edges).toBe(1)
    })

    it('should add multiple relationships', () => {
      const graph = createGraph({ namespace: 'test' })

      graph.addRelationships([
        { id: 'rel-1', type: 'follows', from: 'user-1', to: 'user-2', createdAt: Date.now() },
        { id: 'rel-2', type: 'follows', from: 'user-2', to: 'user-3', createdAt: Date.now() },
        { id: 'rel-3', type: 'follows', from: 'user-1', to: 'user-3', createdAt: Date.now() },
      ])

      const stats = graph.getStats()
      expect(stats.edges).toBe(3)
    })
  })

  describe('GraphNode', () => {
    let graph: Graph

    beforeEach(() => {
      graph = createGraph({ namespace: 'test' })
      graph.addRelationships([
        { id: 'rel-1', type: 'follows', from: 'alice', to: 'bob', createdAt: Date.now() },
        { id: 'rel-2', type: 'follows', from: 'alice', to: 'carol', createdAt: Date.now() },
        { id: 'rel-3', type: 'follows', from: 'bob', to: 'carol', createdAt: Date.now() },
        { id: 'rel-4', type: 'follows', from: 'bob', to: 'dave', createdAt: Date.now() },
        { id: 'rel-5', type: 'likes', from: 'alice', to: 'post-1', createdAt: Date.now() },
        { id: 'rel-6', type: 'likes', from: 'bob', to: 'post-1', createdAt: Date.now() },
        { id: 'rel-7', type: 'likes', from: 'carol', to: 'post-2', createdAt: Date.now() },
      ])
    })

    it('should create a graph node', () => {
      const alice = graph.node('alice')
      expect(alice.id).toBe('alice')
    })

    it('should have $ property for magic traversal', () => {
      const alice = graph.node('alice')
      expect(alice.$).toBeDefined()
    })

    it('should find path to another node', async () => {
      const alice = graph.node('alice')
      const path = await alice.pathTo('dave')

      expect(path).not.toBeNull()
      expect(path!.vertices).toContain('alice')
      expect(path!.vertices).toContain('dave')
    })

    it('should check if connected', async () => {
      const alice = graph.node('alice')

      expect(await alice.connected('bob')).toBe(true)
      expect(await alice.connected('dave')).toBe(true)
      expect(await alice.connected('unknown')).toBe(false)
    })
  })

  describe('Magic $ Traversal', () => {
    let graph: Graph

    beforeEach(() => {
      graph = createGraph({ namespace: 'test' })
      graph.addRelationships([
        { id: 'rel-1', type: 'follows', from: 'alice', to: 'bob', createdAt: Date.now() },
        { id: 'rel-2', type: 'follows', from: 'alice', to: 'carol', createdAt: Date.now() },
        { id: 'rel-3', type: 'follows', from: 'bob', to: 'carol', createdAt: Date.now() },
        { id: 'rel-4', type: 'follows', from: 'bob', to: 'dave', createdAt: Date.now() },
        { id: 'rel-5', type: 'follows', from: 'carol', to: 'eve', createdAt: Date.now() },
      ])
    })

    it('should traverse outgoing edges with $.relType', async () => {
      const alice = graph.node('alice')
      const friends = await alice.$.follows.ids()

      expect(friends).toContain('bob')
      expect(friends).toContain('carol')
      expect(friends).toHaveLength(2)
    })

    it('should traverse incoming edges with $.in.relType', async () => {
      const carol = graph.node('carol')
      const followers = await carol.$.in.follows.ids()

      expect(followers).toContain('alice')
      expect(followers).toContain('bob')
      expect(followers).toHaveLength(2)
    })

    it('should chain traversals (friends of friends)', async () => {
      const alice = graph.node('alice')
      const fof = await alice.$.follows.follows.ids()

      // Alice -> Bob -> Carol, Dave
      // Alice -> Carol -> Eve
      expect(fof).toContain('carol')
      expect(fof).toContain('dave')
      expect(fof).toContain('eve')
    })

    it('should use toArray() to get nodes', async () => {
      const alice = graph.node('alice')
      const friends = await alice.$.follows.toArray()

      expect(friends).toHaveLength(2)
      expect(friends[0]).toHaveProperty('id')
    })

    it('should use nodes() alias', async () => {
      const alice = graph.node('alice')
      const friends = await alice.$.follows.nodes()

      expect(friends).toHaveLength(2)
    })
  })

  describe('Traversal Methods', () => {
    let graph: Graph

    beforeEach(() => {
      graph = createGraph({ namespace: 'test' })
      graph.addRelationships([
        { id: 'rel-1', type: 'follows', from: 'user-1', to: 'user-2', createdAt: Date.now() },
        { id: 'rel-2', type: 'follows', from: 'user-1', to: 'user-3', createdAt: Date.now() },
        { id: 'rel-3', type: 'follows', from: 'user-1', to: 'user-4', createdAt: Date.now() },
        { id: 'rel-4', type: 'follows', from: 'user-1', to: 'user-5', createdAt: Date.now() },
        { id: 'rel-5', type: 'follows', from: 'user-1', to: 'user-6', createdAt: Date.now() },
      ])
    })

    it('should limit results', async () => {
      const user = graph.node('user-1')
      const limited = await user.$.follows.limit(3).ids()

      expect(limited).toHaveLength(3)
    })

    it('should skip results', async () => {
      const user = graph.node('user-1')
      const all = await user.$.follows.ids()
      const skipped = await user.$.follows.skip(2).ids()

      expect(skipped).toHaveLength(3)
      expect(skipped).not.toContain(all[0])
      expect(skipped).not.toContain(all[1])
    })

    it('should count without materializing', async () => {
      const user = graph.node('user-1')
      const count = await user.$.follows.count()

      expect(count).toBe(5)
    })

    it('should check existence', async () => {
      const user1 = graph.node('user-1')
      const user2 = graph.node('user-2')

      expect(await user1.$.follows.exists()).toBe(true)
      expect(await user2.$.follows.exists()).toBe(false)
    })

    it('should get first result', async () => {
      const user = graph.node('user-1')
      const first = await user.$.follows.first()

      expect(first).not.toBeNull()
      expect(first!.id).toBeDefined()
    })
  })

  describe('Variable Depth', () => {
    let graph: Graph

    beforeEach(() => {
      graph = createGraph({ namespace: 'test' })
      // Create a chain: 1 -> 2 -> 3 -> 4 -> 5
      graph.addRelationships([
        { id: 'rel-1', type: 'follows', from: 'user-1', to: 'user-2', createdAt: Date.now() },
        { id: 'rel-2', type: 'follows', from: 'user-2', to: 'user-3', createdAt: Date.now() },
        { id: 'rel-3', type: 'follows', from: 'user-3', to: 'user-4', createdAt: Date.now() },
        { id: 'rel-4', type: 'follows', from: 'user-4', to: 'user-5', createdAt: Date.now() },
      ])
    })

    it('should traverse exactly n hops with depth(n)', async () => {
      const user = graph.node('user-1')
      const twoHops = await user.$.follows.depth(2).ids()

      expect(twoHops).toContain('user-3')
      expect(twoHops).not.toContain('user-2')
      expect(twoHops).not.toContain('user-4')
    })

    it('should traverse range with depth({ min, max })', async () => {
      const user = graph.node('user-1')
      const range = await user.$.follows.depth({ min: 1, max: 3 }).ids()

      expect(range).toContain('user-2')
      expect(range).toContain('user-3')
      expect(range).toContain('user-4')
      expect(range).not.toContain('user-5')
    })
  })

  describe('Set Operations', () => {
    let graph: Graph

    beforeEach(() => {
      graph = createGraph({ namespace: 'test' })
      graph.addRelationships([
        // Alice follows: Bob, Carol, Dave
        { id: 'rel-1', type: 'follows', from: 'alice', to: 'bob', createdAt: Date.now() },
        { id: 'rel-2', type: 'follows', from: 'alice', to: 'carol', createdAt: Date.now() },
        { id: 'rel-3', type: 'follows', from: 'alice', to: 'dave', createdAt: Date.now() },
        // Bob follows: Carol, Eve
        { id: 'rel-4', type: 'follows', from: 'bob', to: 'carol', createdAt: Date.now() },
        { id: 'rel-5', type: 'follows', from: 'bob', to: 'eve', createdAt: Date.now() },
      ])
    })

    it('should intersect traversals (mutual friends)', async () => {
      const alice = graph.node('alice')
      const bob = graph.node('bob')

      const mutual = await alice.$.follows.intersect(bob.$.follows).ids()

      expect(mutual).toContain('carol')
      expect(mutual).toHaveLength(1)
    })

    it('should union traversals', async () => {
      const alice = graph.node('alice')
      const bob = graph.node('bob')

      const combined = await alice.$.follows.union(bob.$.follows).ids()

      expect(combined).toContain('bob')
      expect(combined).toContain('carol')
      expect(combined).toContain('dave')
      expect(combined).toContain('eve')
    })

    it('should except traversals (fof not already friends)', async () => {
      const alice = graph.node('alice')

      // Alice's friends' friends, excluding Alice's direct friends
      const fofNotFriends = await alice.$.follows.follows
        .except(alice.$.follows)
        .ids()

      expect(fofNotFriends).toContain('eve')
      expect(fofNotFriends).not.toContain('bob')
      expect(fofNotFriends).not.toContain('carol')
      expect(fofNotFriends).not.toContain('dave')
    })
  })

  describe('Path Finding via Magic $', () => {
    let graph: Graph

    beforeEach(() => {
      graph = createGraph({ namespace: 'test' })
      graph.addRelationships([
        { id: 'rel-1', type: 'follows', from: 'alice', to: 'bob', createdAt: Date.now() },
        { id: 'rel-2', type: 'follows', from: 'bob', to: 'carol', createdAt: Date.now() },
        { id: 'rel-3', type: 'follows', from: 'carol', to: 'dave', createdAt: Date.now() },
        { id: 'rel-4', type: 'follows', from: 'alice', to: 'eve', createdAt: Date.now() },
        { id: 'rel-5', type: 'follows', from: 'eve', to: 'dave', createdAt: Date.now() },
      ])
    })

    it('should find path via $.pathTo()', async () => {
      const alice = graph.node('alice')
      const path = await alice.$.pathTo('dave')

      expect(path).not.toBeNull()
      expect(path!.vertices[0]).toBe('alice')
      expect(path!.vertices[path!.vertices.length - 1]).toBe('dave')
    })

    it('should check connectivity via $.connected()', async () => {
      const alice = graph.node('alice')

      expect(await alice.$.connected('dave')).toBe(true)
      expect(await alice.$.connected('unknown')).toBe(false)
    })

    it('should find all paths via $.allPathsTo()', async () => {
      const alice = graph.node('alice')
      const paths = await alice.$.allPathsTo('dave')

      expect(paths.length).toBeGreaterThanOrEqual(2)
      // Two paths: alice->bob->carol->dave and alice->eve->dave
    })
  })

  describe('Async Iteration', () => {
    let graph: Graph

    beforeEach(() => {
      graph = createGraph({ namespace: 'test' })
      graph.addRelationships([
        { id: 'rel-1', type: 'follows', from: 'user-1', to: 'user-2', createdAt: Date.now() },
        { id: 'rel-2', type: 'follows', from: 'user-1', to: 'user-3', createdAt: Date.now() },
        { id: 'rel-3', type: 'follows', from: 'user-1', to: 'user-4', createdAt: Date.now() },
      ])
    })

    it('should support async iteration', async () => {
      const user = graph.node('user-1')
      const ids: string[] = []

      for await (const friend of user.$.follows) {
        ids.push(friend.id)
      }

      expect(ids).toHaveLength(3)
    })
  })

  describe('from() - Multiple start nodes', () => {
    let graph: Graph

    beforeEach(() => {
      graph = createGraph({ namespace: 'test' })
      graph.addRelationships([
        { id: 'rel-1', type: 'follows', from: 'alice', to: 'dave', createdAt: Date.now() },
        { id: 'rel-2', type: 'follows', from: 'bob', to: 'eve', createdAt: Date.now() },
        { id: 'rel-3', type: 'follows', from: 'carol', to: 'dave', createdAt: Date.now() },
      ])
    })

    it('should traverse from multiple start nodes', async () => {
      const results = await graph.from('alice', 'bob', 'carol').follows.ids()

      expect(results).toContain('dave')
      expect(results).toContain('eve')
    })
  })

  describe('Mixed Relationship Types', () => {
    let graph: Graph

    beforeEach(() => {
      graph = createGraph({ namespace: 'test' })
      graph.addRelationships([
        { id: 'rel-1', type: 'follows', from: 'alice', to: 'bob', createdAt: Date.now() },
        { id: 'rel-2', type: 'likes', from: 'bob', to: 'post-1', createdAt: Date.now() },
        { id: 'rel-3', type: 'authored', from: 'carol', to: 'post-1', createdAt: Date.now() },
      ])
    })

    it('should chain different relationship types', async () => {
      const alice = graph.node('alice')

      // Posts liked by people Alice follows
      const posts = await alice.$.follows.likes.ids()
      expect(posts).toContain('post-1')
    })

    it('should reverse different relationship types', async () => {
      const post = graph.node('post-1')

      // Author of the post
      const author = await post.$.in.authored.ids()
      expect(author).toContain('carol')

      // People who liked the post
      const likers = await post.$.in.likes.ids()
      expect(likers).toContain('bob')
    })
  })

  describe('Performance - Large Graph', () => {
    it('should handle 1000 nodes efficiently', async () => {
      const graph = createGraph({ namespace: 'perf' })
      const { relationships } = generateSocialGraph(1000, 10)

      graph.addRelationships(relationships)

      const start = performance.now()

      // Find friends of friends for a popular user
      // Note: generateSocialGraph uses 'FOLLOWS' (uppercase)
      const user = graph.node('user-999')
      const fof = await user.$.FOLLOWS.FOLLOWS.ids()

      const elapsed = performance.now() - start

      expect(fof.length).toBeGreaterThan(0)
      expect(elapsed).toBeLessThan(100) // Should complete in < 100ms
    })

    it('should find paths efficiently', async () => {
      const graph = createGraph({ namespace: 'perf' })
      const { relationships } = generateSocialGraph(500, 5)

      graph.addRelationships(relationships)

      const start = performance.now()

      const user = graph.node('user-499')
      const connected = await user.connected('user-0')

      const elapsed = performance.now() - start

      expect(connected).toBe(true)
      expect(elapsed).toBeLessThan(50) // Bidirectional BFS is fast
    })
  })

  describe('Edge Cases', () => {
    it('should handle node with no edges', async () => {
      const graph = createGraph({ namespace: 'test' })
      const user = graph.node('lonely-user')

      const friends = await user.$.follows.ids()
      expect(friends).toHaveLength(0)
    })

    it('should handle non-existent relationship type', async () => {
      const graph = createGraph({ namespace: 'test' })
      graph.addRelationship({
        id: 'rel-1',
        type: 'follows',
        from: 'alice',
        to: 'bob',
        createdAt: Date.now(),
      })

      const alice = graph.node('alice')
      const result = await alice.$.unknownRelType.ids()

      expect(result).toHaveLength(0)
    })

    it('should return null for path to self with length > 0', async () => {
      const graph = createGraph({ namespace: 'test' })
      const user = graph.node('user-1')

      const path = await user.pathTo('user-1')
      expect(path).toEqual({ vertices: ['user-1'], edges: [], length: 0 })
    })
  })
})
