/**
 * Tests for Smart Reverse + Depth Traversal
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createSmartGraph, SmartGraph } from './graph-sdk-smart-reverse'

describe('Smart Reverse Detection', () => {
  let graph: SmartGraph

  beforeEach(() => {
    graph = createSmartGraph({ namespace: 'test' })
    graph.addRelationships([
      // follows relationships
      { id: 'r1', type: 'follows', from: 'alice', to: 'bob', createdAt: Date.now() },
      { id: 'r2', type: 'follows', from: 'alice', to: 'carol', createdAt: Date.now() },
      { id: 'r3', type: 'follows', from: 'bob', to: 'carol', createdAt: Date.now() },
      { id: 'r4', type: 'follows', from: 'carol', to: 'alice', createdAt: Date.now() },

      // likes relationships
      { id: 'r5', type: 'likes', from: 'alice', to: 'post-1', createdAt: Date.now() },
      { id: 'r6', type: 'likes', from: 'bob', to: 'post-1', createdAt: Date.now() },
      { id: 'r7', type: 'likes', from: 'carol', to: 'post-2', createdAt: Date.now() },

      // authored relationships
      { id: 'r8', type: 'authored', from: 'alice', to: 'post-1', createdAt: Date.now() },
      { id: 'r9', type: 'authored', from: 'bob', to: 'post-2', createdAt: Date.now() },
    ])
  })

  describe('$relationship (outgoing)', () => {
    it('should traverse outgoing edges with $follows', async () => {
      const alice = graph.node('alice')
      const following = await (alice as any).$follows.ids()

      expect(following).toContain('bob')
      expect(following).toContain('carol')
      expect(following).toHaveLength(2)
    })

    it('should traverse outgoing edges with $likes', async () => {
      const alice = graph.node('alice')
      const liked = await (alice as any).$likes.ids()

      expect(liked).toContain('post-1')
      expect(liked).toHaveLength(1)
    })
  })

  describe('$relationshipBy (smart reverse)', () => {
    it('should detect $followedBy as reverse of follows', async () => {
      const carol = graph.node('carol')
      // carol is followed by alice and bob
      const followers = await (carol as any).$followedBy.ids()

      expect(followers).toContain('alice')
      expect(followers).toContain('bob')
      expect(followers).toHaveLength(2)
    })

    it('should detect $likedBy as reverse of likes', async () => {
      const post = graph.node('post-1')
      // post-1 is liked by alice and bob
      const likers = await (post as any).$likedBy.ids()

      expect(likers).toContain('alice')
      expect(likers).toContain('bob')
      expect(likers).toHaveLength(2)
    })

    it('should detect $authoredBy as reverse of authored', async () => {
      const post = graph.node('post-1')
      // post-1 is authored by alice
      const author = await (post as any).$authoredBy.ids()

      expect(author).toContain('alice')
      expect(author).toHaveLength(1)
    })
  })

  describe('$[relationship] (explicit reverse)', () => {
    it('should still support bracket syntax for reverse', async () => {
      const carol = graph.node('carol')
      const followers = await (carol as any)['$[follows]'].ids()

      expect(followers).toContain('alice')
      expect(followers).toContain('bob')
    })
  })

  describe('Chaining with smart reverse', () => {
    it('should chain $follows.$followedBy (mutual follows)', async () => {
      const alice = graph.node('alice')
      // alice follows bob, carol
      // who follows alice back? carol!
      const mutualCandidates = await (alice as any).$follows.$followedBy.ids()

      // This finds people who follow the people alice follows
      // alice->bob (carol follows alice but not bob)
      // alice->carol (alice follows carol who follows alice)
      expect(mutualCandidates).toContain('alice') // carol follows alice
    })

    it('should chain $followedBy.$follows (followers\' follows)', async () => {
      const alice = graph.node('alice')
      // Who follows alice? carol
      // Who does carol follow? alice
      const followersFollows = await (alice as any).$followedBy.$follows.ids()

      expect(followersFollows).toContain('alice')
    })
  })
})

describe('Depth Traversal ($out/$in)', () => {
  let graph: SmartGraph

  beforeEach(() => {
    graph = createSmartGraph({ namespace: 'test' })
    // Create a chain: a -> b -> c -> d -> e
    graph.addRelationships([
      { id: 'r1', type: 'knows', from: 'a', to: 'b', createdAt: Date.now() },
      { id: 'r2', type: 'knows', from: 'b', to: 'c', createdAt: Date.now() },
      { id: 'r3', type: 'knows', from: 'c', to: 'd', createdAt: Date.now() },
      { id: 'r4', type: 'knows', from: 'd', to: 'e', createdAt: Date.now() },
      // Add some other relationship types
      { id: 'r5', type: 'likes', from: 'a', to: 'x', createdAt: Date.now() },
      { id: 'r6', type: 'follows', from: 'a', to: 'y', createdAt: Date.now() },
    ])
  })

  describe('$out(n) - any outgoing, n hops', () => {
    it('should traverse 1 hop out (all relationship types)', async () => {
      const a = graph.node('a')
      const oneHop = await (a as any).$out(1).ids()

      // a -> b (knows), a -> x (likes), a -> y (follows)
      expect(oneHop).toContain('b')
      expect(oneHop).toContain('x')
      expect(oneHop).toContain('y')
      expect(oneHop).toHaveLength(3)
    })

    it('should traverse 2 hops out', async () => {
      const a = graph.node('a')
      const twoHops = await (a as any).$out(2).ids()

      // 2 hops from a: b->c
      expect(twoHops).toContain('c')
    })

    it('should traverse 3 hops out', async () => {
      const a = graph.node('a')
      const threeHops = await (a as any).$out(3).ids()

      expect(threeHops).toContain('d')
    })
  })

  describe('$in(n) - any incoming, n hops', () => {
    it('should traverse 1 hop in', async () => {
      const c = graph.node('c')
      const oneHopIn = await (c as any).$in(1).ids()

      // b -> c
      expect(oneHopIn).toContain('b')
    })

    it('should traverse 2 hops in', async () => {
      const c = graph.node('c')
      const twoHopsIn = await (c as any).$in(2).ids()

      // 2 hops back from c: a->b->c, so a
      expect(twoHopsIn).toContain('a')
    })
  })

  describe('Chaining $out/$in with specific relationships', () => {
    it('should chain $knows.$out(2)', async () => {
      const a = graph.node('a')
      // First: a -knows-> b
      // Then: any 2 hops from b: c, then d
      const result = await (a as any).$knows.$out(2).ids()

      expect(result).toContain('d') // b->c->d
    })

    it('should chain $out(2).$knows', async () => {
      const a = graph.node('a')
      // First: any 2 hops from a (gets to c via knows)
      // Then: c -knows-> d
      const result = await (a as any).$out(2).$knows.ids()

      expect(result).toContain('d')
    })
  })
})

describe('.depth() modifier', () => {
  let graph: SmartGraph

  beforeEach(() => {
    graph = createSmartGraph({ namespace: 'test' })
    graph.addRelationships([
      { id: 'r1', type: 'follows', from: 'a', to: 'b', createdAt: Date.now() },
      { id: 'r2', type: 'follows', from: 'b', to: 'c', createdAt: Date.now() },
      { id: 'r3', type: 'follows', from: 'c', to: 'd', createdAt: Date.now() },
      { id: 'r4', type: 'follows', from: 'd', to: 'e', createdAt: Date.now() },
    ])
  })

  it('should support .depth(n) for exact hops', async () => {
    const a = graph.node('a')
    const twoHops = await (a as any).$follows.depth(2).ids()

    expect(twoHops).toContain('c')
    expect(twoHops).not.toContain('b') // 1 hop
    expect(twoHops).not.toContain('d') // 3 hops
  })

  it('should support .depth({ min, max }) for range', async () => {
    const a = graph.node('a')
    const range = await (a as any).$follows.depth({ min: 1, max: 3 }).ids()

    expect(range).toContain('b') // 1 hop
    expect(range).toContain('c') // 2 hops
    expect(range).toContain('d') // 3 hops
    expect(range).not.toContain('e') // 4 hops
  })
})

describe('Node properties', () => {
  it('should still access node properties without $', () => {
    const graph = createSmartGraph({ namespace: 'test' })
    const node = graph.node('test-123')

    expect(node.id).toBe('test-123')
    expect(node.type).toBeDefined()
    expect(node.data).toBeDefined()
  })
})

describe('Syntax Comparison', () => {
  it('documents the three syntax options', () => {
    // This test just documents the patterns

    const syntaxComparison = `
    ┌─────────────────────────────────────────────────────────────────────┐
    │  Intent                │  Bracket        │  Smart Reverse │  Depth │
    ├─────────────────────────────────────────────────────────────────────┤
    │  Outgoing 'follows'    │  $follows       │  $follows      │  -     │
    │  Incoming 'follows'    │  $[follows]     │  $followedBy   │  -     │
    │  Any out, 2 hops       │  -              │  -             │ $out(2)│
    │  Any in, 3 hops        │  -              │  -             │ $in(3) │
    │  'follows' 2 hops      │  $follows.depth(2)              │        │
    └─────────────────────────────────────────────────────────────────────┘

    Examples:
      user.$follows              // outgoing follows
      user.$followedBy           // incoming follows (smart!)
      user.$[follows]            // incoming follows (explicit)
      user.$out(2)               // any edges, 2 hops out
      user.$in(3)                // any edges, 3 hops in
      user.$follows.depth(2)     // follows edges, exactly 2 hops
      user.$follows.$out(2)      // follows, then any 2 more out
    `

    expect(syntaxComparison).toBeDefined()
  })
})
