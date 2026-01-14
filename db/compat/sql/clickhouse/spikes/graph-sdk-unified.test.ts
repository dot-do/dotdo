/**
 * Tests for Unified Graph SDK
 * Combines all patterns: $relationship, smart reverse, $expand, options object, streaming, collections
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createUnifiedGraph, UnifiedGraph, GraphNode } from './graph-sdk-unified'

describe('Unified Graph SDK', () => {
  let graph: UnifiedGraph

  beforeEach(() => {
    graph = createUnifiedGraph({ namespace: 'test' })

    // Add things (nodes with types)
    graph.addThings([
      { id: 'alice', type: 'User', ns: 'test', data: { name: 'Alice', verified: true }, createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'bob', type: 'User', ns: 'test', data: { name: 'Bob', verified: false }, createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'carol', type: 'User', ns: 'test', data: { name: 'Carol', verified: true }, createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'dave', type: 'User', ns: 'test', data: { name: 'Dave', verified: false }, createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'post-1', type: 'Post', ns: 'test', data: { title: 'Hello World' }, createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'post-2', type: 'Post', ns: 'test', data: { title: 'Graph SDK' }, createdAt: Date.now(), updatedAt: Date.now() },
    ])

    // Add relationships
    graph.addRelationships([
      // Social follows
      { id: 'r1', type: 'follows', from: 'alice', to: 'bob', createdAt: Date.now() },
      { id: 'r2', type: 'follows', from: 'alice', to: 'carol', createdAt: Date.now() },
      { id: 'r3', type: 'follows', from: 'bob', to: 'carol', createdAt: Date.now() },
      { id: 'r4', type: 'follows', from: 'carol', to: 'dave', createdAt: Date.now() },
      { id: 'r5', type: 'follows', from: 'dave', to: 'alice', createdAt: Date.now() },

      // Likes
      { id: 'r6', type: 'likes', from: 'alice', to: 'post-1', createdAt: Date.now() },
      { id: 'r7', type: 'likes', from: 'bob', to: 'post-1', createdAt: Date.now() },
      { id: 'r8', type: 'likes', from: 'carol', to: 'post-2', createdAt: Date.now() },

      // Authored
      { id: 'r9', type: 'authored', from: 'alice', to: 'post-1', createdAt: Date.now() },
      { id: 'r10', type: 'authored', from: 'bob', to: 'post-2', createdAt: Date.now() },
    ])
  })

  describe('JSON-LD Style Properties', () => {
    it('should expose $id', () => {
      const node = graph.node('alice')
      expect(node.$id).toBe('alice')
    })

    it('should expose $type', () => {
      const node = graph.node('alice')
      expect(node.$type).toBe('User')
    })

    it('should expose $graph reference', () => {
      const node = graph.node('alice')
      // Note: $graph is a reference to graph, but may be wrapped in proxy
      expect(node.$graph.node).toBeDefined()
      expect(node.$graph.addRelationship).toBeDefined()
    })

    it('should expose data properties', () => {
      const node = graph.node('alice')
      expect(node.data.name).toBe('Alice')
      expect(node.data.verified).toBe(true)
    })
  })

  describe('$relationship Traversal', () => {
    it('should traverse outgoing with property access', async () => {
      const alice = graph.node('alice')
      const following = await (alice as any).$follows.ids()

      expect(following).toContain('bob')
      expect(following).toContain('carol')
      expect(following).toHaveLength(2)
    })

    it('should traverse outgoing with function call', async () => {
      const alice = graph.node('alice')
      const following = await (alice as any).$follows().ids()

      expect(following).toContain('bob')
      expect(following).toContain('carol')
    })

    it('should support depth option', async () => {
      const alice = graph.node('alice')
      // alice -> bob/carol -> carol/dave (2 hops)
      const twoHops = await (alice as any).$follows({ depth: 2 }).ids()

      expect(twoHops).toContain('dave')
      expect(twoHops).toContain('carol')
    })

    it('should support depth range', async () => {
      const alice = graph.node('alice')
      const range = await (alice as any).$follows({ depth: { min: 1, max: 3 } }).ids()

      expect(range).toContain('bob')   // 1 hop
      expect(range).toContain('carol') // 1-2 hops
      expect(range).toContain('dave')  // 2-3 hops
    })

    it('should support limit option', async () => {
      const alice = graph.node('alice')
      const limited = await (alice as any).$follows({ limit: 1 }).ids()

      expect(limited).toHaveLength(1)
    })
  })

  describe('Smart Reverse ($followedBy)', () => {
    it('should detect $followedBy as reverse of follows', async () => {
      const bob = graph.node('bob')
      const followers = await (bob as any).$followedBy.ids()

      expect(followers).toContain('alice')
    })

    it('should detect $likedBy as reverse of likes', async () => {
      const post = graph.node('post-1')
      const likers = await (post as any).$likedBy.ids()

      expect(likers).toContain('alice')
      expect(likers).toContain('bob')
      expect(likers).toHaveLength(2)
    })

    it('should detect $authoredBy as reverse of authored', async () => {
      const post = graph.node('post-1')
      const authors = await (post as any).$authoredBy.ids()

      expect(authors).toContain('alice')
      expect(authors).toHaveLength(1)
    })
  })

  describe('$out/$in/$expand - Any Relationship', () => {
    it('should traverse any outgoing with $out(n)', async () => {
      const alice = graph.node('alice')
      // alice -> bob, carol (follows), post-1 (likes, authored)
      const oneOut = await (alice as any).$out(1).ids()

      expect(oneOut).toContain('bob')
      expect(oneOut).toContain('carol')
      expect(oneOut).toContain('post-1')
    })

    it('should traverse any incoming with $in(n)', async () => {
      const bob = graph.node('bob')
      // alice -> bob (follows)
      const oneIn = await (bob as any).$in(1).ids()

      expect(oneIn).toContain('alice')
    })

    it('should traverse all directions with $expand(n)', async () => {
      const bob = graph.node('bob')
      // bob <- alice (follows), bob -> carol (follows), bob -> post-1 (likes)
      const neighbors = await (bob as any).$expand(1).ids()

      expect(neighbors).toContain('alice')
      expect(neighbors).toContain('carol')
      expect(neighbors).toContain('post-1')
    })

    it('should support multi-hop $out', async () => {
      const alice = graph.node('alice')
      // 2 hops out from alice
      const twoOut = await (alice as any).$out(2).ids()

      expect(twoOut).toContain('dave') // alice -> carol -> dave
    })
  })

  describe('Chaining', () => {
    it('should chain $follows.$likes', async () => {
      const alice = graph.node('alice')
      // alice -> bob/carol -> post-1/post-2 (likes)
      const friendsLikes = await (alice as any).$follows.$likes.ids()

      expect(friendsLikes).toContain('post-1')
      expect(friendsLikes).toContain('post-2')
    })

    it('should chain $follows with depth then $likes', async () => {
      const alice = graph.node('alice')
      const fofLikes = await (alice as any).$follows({ depth: 2 }).$likes.ids()

      expect(fofLikes).toContain('post-2') // carol likes post-2
    })

    it('should chain $followedBy.$follows', async () => {
      const alice = graph.node('alice')
      // who follows alice? dave
      // who does dave follow? alice
      const followersFollows = await (alice as any).$followedBy.$follows.ids()

      expect(followersFollows).toContain('alice')
    })

    it('should chain $expand with specific relationship', async () => {
      const alice = graph.node('alice')
      // alice's 1-hop neighborhood includes bob and carol
      // bob likes post-1, carol likes post-2
      const neighborhoodLikes = await (alice as any).$expand(1).$likes.ids()

      // Note: this may have edge cases with nodes that are both source and target
      expect(neighborhoodLikes.length).toBeGreaterThan(0)
      expect(neighborhoodLikes).toContain('post-1')
    })
  })

  describe('Execution Methods', () => {
    it('should return ids()', async () => {
      const alice = graph.node('alice')
      const ids = await (alice as any).$follows.ids()

      expect(ids).toHaveLength(2)
      expect(ids.every((id: unknown) => typeof id === 'string')).toBe(true)
    })

    it('should return nodes()', async () => {
      const alice = graph.node('alice')
      const nodes = await (alice as any).$follows.nodes()

      expect(nodes).toHaveLength(2)
      expect(nodes[0].id).toBeDefined()
    })

    it('should return toArray() (MongoDB compat)', async () => {
      const alice = graph.node('alice')
      const arr = await (alice as any).$follows.toArray()

      expect(arr).toHaveLength(2)
    })

    it('should return count()', async () => {
      const alice = graph.node('alice')
      const count = await (alice as any).$follows.count()

      expect(count).toBe(2)
    })

    it('should return first()', async () => {
      const alice = graph.node('alice')
      const first = await (alice as any).$follows.first()

      expect(first).not.toBeNull()
      expect(first.id).toBeDefined()
    })

    it('should return exists() true', async () => {
      const alice = graph.node('alice')
      const exists = await (alice as any).$follows.exists()

      expect(exists).toBe(true)
    })

    it('should return exists() false for unknown', async () => {
      const alice = graph.node('alice')
      const exists = await (alice as any).$unknownRel.exists()

      expect(exists).toBe(false)
    })
  })

  describe('Async Iteration', () => {
    it('should support for-await-of', async () => {
      const alice = graph.node('alice')
      const ids: string[] = []

      for await (const node of (alice as any).$follows) {
        ids.push(node.id)
      }

      expect(ids).toHaveLength(2)
      expect(ids).toContain('bob')
      expect(ids).toContain('carol')
    })
  })

  describe('Streaming - $stream and $batch', () => {
    it('should stream one at a time with $stream', async () => {
      const alice = graph.node('alice')
      const ids: string[] = []

      for await (const node of (alice as any).$follows.$stream) {
        ids.push(node.id)
      }

      expect(ids).toHaveLength(2)
    })

    it('should batch with $batch(n)', async () => {
      const alice = graph.node('alice')
      const batches: any[][] = []

      for await (const batch of (alice as any).$follows.$batch(1)) {
        batches.push(batch)
      }

      expect(batches).toHaveLength(2)
      expect(batches[0]).toHaveLength(1)
    })
  })

  describe('Collection Accessor - $Type', () => {
    it('should get all of type with $User()', async () => {
      const users = await (graph as any).$User()

      expect(users).toHaveLength(4)
    })

    it('should get node by ID with $User(id)', () => {
      const alice = (graph as any).$User('alice')

      expect(alice.$id).toBe('alice')
    })

    it('should find by predicate', async () => {
      const alice = await (graph as any).$User.find({ name: 'Alice' })

      expect(alice).not.toBeNull()
      expect(alice.id).toBe('alice')
    })

    it('should stream collection with $stream', async () => {
      const users: any[] = []

      for await (const user of (graph as any).$User.$stream) {
        users.push(user)
      }

      expect(users).toHaveLength(4)
    })

    it('should batch collection with $batch', async () => {
      const batches: any[][] = []

      for await (const batch of (graph as any).$User.$batch(2)) {
        batches.push(batch)
      }

      expect(batches).toHaveLength(2)
      expect(batches[0]).toHaveLength(2)
    })
  })
})

describe('Advanced Patterns', () => {
  let graph: UnifiedGraph

  beforeEach(() => {
    graph = createUnifiedGraph({ namespace: 'test' })

    // Org hierarchy
    graph.addThings([
      { id: 'ceo', type: 'User', ns: 'test', data: { title: 'CEO' }, createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'vp1', type: 'User', ns: 'test', data: { title: 'VP' }, createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'vp2', type: 'User', ns: 'test', data: { title: 'VP' }, createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'mgr1', type: 'User', ns: 'test', data: { title: 'Manager' }, createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'mgr2', type: 'User', ns: 'test', data: { title: 'Manager' }, createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'emp1', type: 'User', ns: 'test', data: { title: 'Engineer' }, createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'emp2', type: 'User', ns: 'test', data: { title: 'Engineer' }, createdAt: Date.now(), updatedAt: Date.now() },
    ])

    graph.addRelationships([
      // reportsTo: from reports to their manager
      { id: 'r1', type: 'reportsTo', from: 'vp1', to: 'ceo', createdAt: Date.now() },
      { id: 'r2', type: 'reportsTo', from: 'vp2', to: 'ceo', createdAt: Date.now() },
      { id: 'r3', type: 'reportsTo', from: 'mgr1', to: 'vp1', createdAt: Date.now() },
      { id: 'r4', type: 'reportsTo', from: 'mgr2', to: 'vp2', createdAt: Date.now() },
      { id: 'r5', type: 'reportsTo', from: 'emp1', to: 'mgr1', createdAt: Date.now() },
      { id: 'r6', type: 'reportsTo', from: 'emp2', to: 'mgr2', createdAt: Date.now() },
    ])
  })

  it('should find all reports (CEO -> all employees)', async () => {
    const ceo = graph.node('ceo')
    // reportsToBy = people who report to this person
    const allReports = await (ceo as any).$reportsToBy({ depth: { min: 1, max: 5 } }).ids()

    expect(allReports).toContain('vp1')
    expect(allReports).toContain('vp2')
    expect(allReports).toContain('mgr1')
    expect(allReports).toContain('mgr2')
    expect(allReports).toContain('emp1')
    expect(allReports).toContain('emp2')
  })

  it('should find management chain (employee -> CEO)', async () => {
    const emp = graph.node('emp1')
    // reportsTo = who this person reports to
    const chain = await (emp as any).$reportsTo({ depth: { min: 1, max: 5 } }).ids()

    expect(chain).toContain('mgr1')
    expect(chain).toContain('vp1')
    expect(chain).toContain('ceo')
  })

  it('should find direct reports only', async () => {
    const ceo = graph.node('ceo')
    const directReports = await (ceo as any).$reportsToBy({ depth: 1 }).ids()

    expect(directReports).toContain('vp1')
    expect(directReports).toContain('vp2')
    expect(directReports).not.toContain('mgr1')
  })
})

describe('Syntax Reference', () => {
  it('documents the complete API', () => {
    const syntaxRef = `
    ┌────────────────────────────────────────────────────────────────────────────┐
    │  UNIFIED GRAPH SDK - COMPLETE SYNTAX REFERENCE                             │
    ├────────────────────────────────────────────────────────────────────────────┤
    │                                                                            │
    │  JSON-LD STYLE METADATA                                                    │
    │  ───────────────────────                                                   │
    │  node.$id                      │  Entity identifier                        │
    │  node.$type                    │  Entity type(s)                           │
    │  node.$context                 │  Schema context                           │
    │  node.$graph                   │  Graph reference                          │
    │  node.data                     │  Properties object                        │
    │                                                                            │
    │  $RELATIONSHIP TRAVERSAL                                                   │
    │  ───────────────────────                                                   │
    │  node.$follows                 │  Outgoing 'follows' (property)            │
    │  node.$follows()               │  Same (function call)                     │
    │  node.$follows({ depth: 2 })   │  2 hops deep                              │
    │  node.$follows({ limit: 10 })  │  Max 10 results                           │
    │                                                                            │
    │  SMART REVERSE DETECTION                                                   │
    │  ───────────────────────                                                   │
    │  node.$followedBy              │  Incoming 'follows' (auto-detected!)      │
    │  node.$likedBy                 │  Incoming 'likes'                         │
    │  node.$authoredBy              │  Incoming 'authored'                      │
    │  node.$reportsToBy             │  Incoming 'reportsTo'                     │
    │                                                                            │
    │  ANY RELATIONSHIP                                                          │
    │  ────────────────                                                          │
    │  node.$out(n)                  │  Any outgoing, n hops                     │
    │  node.$in(n)                   │  Any incoming, n hops                     │
    │  node.$expand(n)               │  All directions, n hops                   │
    │                                                                            │
    │  CHAINING                                                                  │
    │  ────────                                                                  │
    │  node.$follows.$likes          │  Friends' likes                           │
    │  node.$expand(2).$authored     │  Neighborhood's posts                     │
    │                                                                            │
    │  EXECUTION                                                                 │
    │  ─────────                                                                 │
    │  await node.$follows.ids()     │  Just IDs                                 │
    │  await node.$follows.first()   │  Single node                              │
    │  await node.$follows.count()   │  Aggregate                                │
    │  await node.$follows.exists()  │  Boolean check                            │
    │  await node.$follows.nodes()   │  Materialize array                        │
    │  await node.$follows.toArray() │  MongoDB compat                           │
    │                                                                            │
    │  ASYNC ITERATION                                                           │
    │  ───────────────                                                           │
    │  for await (const n of node.$follows) │  Native streaming                  │
    │                                                                            │
    │  STREAMING                                                                 │
    │  ─────────                                                                 │
    │  node.$follows.$stream         │  Stream one at a time                     │
    │  node.$follows.$batch(1000)    │  Batch for efficiency                     │
    │                                                                            │
    │  COLLECTION ACCESS                                                         │
    │  ─────────────────                                                         │
    │  graph.$User()                 │  All users                                │
    │  graph.$User('id')             │  User by ID                               │
    │  graph.$User.find({...})       │  Find one by predicate                    │
    │  graph.$User.$stream           │  Stream all users                         │
    │  graph.$User.$batch(100)       │  Batch users                              │
    │                                                                            │
    └────────────────────────────────────────────────────────────────────────────┘
    `
    expect(syntaxRef).toBeDefined()
  })
})
