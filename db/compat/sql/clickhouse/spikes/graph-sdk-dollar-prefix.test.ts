/**
 * Tests for $prefix Graph SDK Syntax
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createDollarGraph, DollarGraph } from './graph-sdk-dollar-prefix'

describe('$prefix Syntax', () => {
  let graph: DollarGraph

  beforeEach(() => {
    graph = createDollarGraph({ namespace: 'test' })
    graph.addRelationships([
      // Social graph
      { id: 'r1', type: 'follows', from: 'alice', to: 'bob', createdAt: Date.now() },
      { id: 'r2', type: 'follows', from: 'alice', to: 'carol', createdAt: Date.now() },
      { id: 'r3', type: 'follows', from: 'bob', to: 'carol', createdAt: Date.now() },
      { id: 'r4', type: 'follows', from: 'bob', to: 'dave', createdAt: Date.now() },
      { id: 'r5', type: 'follows', from: 'carol', to: 'alice', createdAt: Date.now() },

      // Likes
      { id: 'r6', type: 'likes', from: 'alice', to: 'post-1', createdAt: Date.now() },
      { id: 'r7', type: 'likes', from: 'bob', to: 'post-1', createdAt: Date.now() },
      { id: 'r8', type: 'likes', from: 'carol', to: 'post-2', createdAt: Date.now() },

      // Authored
      { id: 'r9', type: 'authored', from: 'alice', to: 'post-1', createdAt: Date.now() },
      { id: 'r10', type: 'authored', from: 'bob', to: 'post-2', createdAt: Date.now() },
    ])
  })

  describe('Basic $property syntax', () => {
    it('should traverse outgoing edges with $relType', async () => {
      const alice = graph.node('alice')
      const following = await (alice as any).$follows.ids()

      expect(following).toContain('bob')
      expect(following).toContain('carol')
      expect(following).toHaveLength(2)
    })

    it('should access node properties without $', () => {
      const alice = graph.node('alice')

      expect(alice.id).toBe('alice')
      expect(alice.type).toBeDefined()
      expect(alice.data).toBeDefined()
    })
  })

  describe('Reverse lookup with $[relType]', () => {
    it('should traverse incoming edges with $[relType]', async () => {
      const carol = graph.node('carol')
      const followers = await (carol as any)['$[follows]'].ids()

      expect(followers).toContain('alice')
      expect(followers).toContain('bob')
      expect(followers).toHaveLength(2)
    })

    it('should find who follows alice', async () => {
      const alice = graph.node('alice')
      const followers = await (alice as any)['$[follows]'].ids()

      expect(followers).toContain('carol')
      expect(followers).toHaveLength(1)
    })
  })

  describe('Chaining traversals', () => {
    it('should chain outgoing traversals naturally', async () => {
      const alice = graph.node('alice')
      // Friends of friends
      const fof = await (alice as any).$follows.$follows.ids()

      expect(fof).toContain('carol') // alice->bob->carol
      expect(fof).toContain('dave')  // alice->bob->dave
    })

    it('should chain different relationship types', async () => {
      const alice = graph.node('alice')
      // Posts liked by people alice follows
      const posts = await (alice as any).$follows.$likes.ids()

      expect(posts).toContain('post-1') // bob likes post-1
      expect(posts).toContain('post-2') // carol likes post-2
    })
  })

  describe('Mixed direction chains', () => {
    it('should support $rel then $[rel] in chain', async () => {
      const alice = graph.node('alice')
      // People who like posts authored by alice
      const likers = await (alice as any).$authored['$[likes]'].ids()

      expect(likers).toContain('alice') // alice likes post-1
      expect(likers).toContain('bob')   // bob likes post-1
    })
  })

  describe('Execution methods', () => {
    it('should support .ids()', async () => {
      const alice = graph.node('alice')
      const ids = await (alice as any).$follows.ids()
      expect(Array.isArray(ids)).toBe(true)
      expect(ids.every((id: unknown) => typeof id === 'string')).toBe(true)
    })

    it('should support .nodes() / .toArray()', async () => {
      const alice = graph.node('alice')
      const nodes = await (alice as any).$follows.nodes()
      expect(Array.isArray(nodes)).toBe(true)
      expect(nodes[0]).toHaveProperty('id')
    })

    it('should support .count()', async () => {
      const alice = graph.node('alice')
      const count = await (alice as any).$follows.count()
      expect(count).toBe(2)
    })

    it('should support .first()', async () => {
      const alice = graph.node('alice')
      const first = await (alice as any).$follows.first()
      expect(first).not.toBeNull()
      expect(first.id).toBeDefined()
    })

    it('should support .exists()', async () => {
      const alice = graph.node('alice')
      expect(await (alice as any).$follows.exists()).toBe(true)
      expect(await (alice as any).$unknownRel.exists()).toBe(false)
    })
  })

  describe('Modifiers', () => {
    it('should support .limit()', async () => {
      const alice = graph.node('alice')
      const limited = await (alice as any).$follows.limit(1).ids()
      expect(limited).toHaveLength(1)
    })

    it('should support .skip()', async () => {
      const alice = graph.node('alice')
      const all = await (alice as any).$follows.ids()
      const skipped = await (alice as any).$follows.skip(1).ids()
      expect(skipped).toHaveLength(1)
      expect(skipped[0]).not.toBe(all[0])
    })
  })

  describe('Async iteration', () => {
    it('should support for-await-of', async () => {
      const alice = graph.node('alice')
      const ids: string[] = []

      for await (const friend of (alice as any).$follows) {
        ids.push(friend.id)
      }

      expect(ids).toHaveLength(2)
    })
  })
})

describe('Syntax Visual Comparison', () => {
  it('demonstrates the $prefix syntax patterns', () => {
    // This test just documents the syntax patterns

    const patterns = {
      // Outgoing edges
      'old: user.$.follows': 'new: user.$follows',

      // Incoming edges (reverse lookup)
      'old: user.$.in.follows': 'new: user.$[follows]',

      // Chain outgoing
      'old: user.$.follows.likes': 'new: user.$follows.likes',

      // Chain with reverse mid-way
      'old: user.$.follows.in.likes': 'new: user.$follows.$[likes]',

      // Properties unchanged
      'old: user.id': 'new: user.id',
      'old: user.data.email': 'new: user.data.email',
    }

    // The new syntax:
    // - $rel = outgoing traversal
    // - $[rel] = incoming traversal (reverse lookup)
    // - No inner $ needed for chaining
    // - Bracket notation = "look back" / "who has this relation TO me"

    expect(patterns).toBeDefined()
  })
})
