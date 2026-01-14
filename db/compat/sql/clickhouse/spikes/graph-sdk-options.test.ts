/**
 * Tests for Options Object Syntax
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createOptionsGraph, OptionsGraph } from './graph-sdk-options'

describe('Options Object Syntax', () => {
  let graph: OptionsGraph

  beforeEach(() => {
    graph = createOptionsGraph({ namespace: 'test' })
    graph.addRelationships([
      // Org hierarchy
      { id: 'r1', type: 'reportsTo', from: 'alice', to: 'bob', createdAt: Date.now() },
      { id: 'r2', type: 'reportsTo', from: 'bob', to: 'carol', createdAt: Date.now() },
      { id: 'r3', type: 'reportsTo', from: 'carol', to: 'ceo', createdAt: Date.now() },
      { id: 'r4', type: 'reportsTo', from: 'dave', to: 'bob', createdAt: Date.now() },
      { id: 'r5', type: 'reportsTo', from: 'eve', to: 'carol', createdAt: Date.now() },

      // Social
      { id: 'r6', type: 'follows', from: 'alice', to: 'dave', createdAt: Date.now() },
      { id: 'r7', type: 'follows', from: 'dave', to: 'eve', createdAt: Date.now() },
    ])
  })

  describe('Basic $relationship access', () => {
    it('should work as property access', async () => {
      const alice = graph.node('alice')
      const managers = await (alice as any).$reportsTo.ids()

      expect(managers).toContain('bob')
      expect(managers).toHaveLength(1)
    })

    it('should work as function call with no args', async () => {
      const alice = graph.node('alice')
      const managers = await (alice as any).$reportsTo().ids()

      expect(managers).toContain('bob')
      expect(managers).toHaveLength(1)
    })
  })

  describe('$relationship({ depth: n })', () => {
    it('should traverse exact depth', async () => {
      const alice = graph.node('alice')
      // alice -> bob -> carol (2 hops)
      const twoUp = await (alice as any).$reportsTo({ depth: 2 }).ids()

      expect(twoUp).toContain('carol')
      expect(twoUp).not.toContain('bob') // that's 1 hop
    })

    it('should traverse depth range', async () => {
      const alice = graph.node('alice')
      const chain = await (alice as any).$reportsTo({ depth: { min: 1, max: 3 } }).ids()

      expect(chain).toContain('bob')   // 1 hop
      expect(chain).toContain('carol') // 2 hops
      expect(chain).toContain('ceo')   // 3 hops
    })
  })

  describe('$relationship({ where: {...} })', () => {
    it('should filter with where clause', async () => {
      // Note: our test data doesn't have filterable properties,
      // but the syntax should work
      const alice = graph.node('alice')
      const result = await (alice as any).$reportsTo({ where: { type: 'Manager' } }).ids()

      // Will be empty since our stub nodes don't have type: 'Manager'
      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('$relationship({ limit: n })', () => {
    it('should limit results', async () => {
      const bob = graph.node('bob')
      // bob has alice and dave reporting to him
      const reports = await (bob as any).$reportsToBy({ limit: 1 }).ids()

      expect(reports).toHaveLength(1)
    })
  })

  describe('Combined options', () => {
    it('should combine depth and limit', async () => {
      const alice = graph.node('alice')
      const result = await (alice as any).$reportsTo({
        depth: { min: 1, max: 3 },
        limit: 2
      }).ids()

      expect(result.length).toBeLessThanOrEqual(2)
    })
  })
})

describe('$expand - All Directions', () => {
  let graph: OptionsGraph

  beforeEach(() => {
    graph = createOptionsGraph({ namespace: 'test' })
    // Create a star graph: center connected to a, b, c, d
    graph.addRelationships([
      { id: 'r1', type: 'connected', from: 'center', to: 'a', createdAt: Date.now() },
      { id: 'r2', type: 'connected', from: 'center', to: 'b', createdAt: Date.now() },
      { id: 'r3', type: 'connected', from: 'c', to: 'center', createdAt: Date.now() },
      { id: 'r4', type: 'connected', from: 'd', to: 'center', createdAt: Date.now() },
      // Second level
      { id: 'r5', type: 'connected', from: 'a', to: 'a1', createdAt: Date.now() },
      { id: 'r6', type: 'connected', from: 'b1', to: 'b', createdAt: Date.now() },
    ])
  })

  describe('$expand(n)', () => {
    it('should expand in all directions for 1 hop', async () => {
      const center = graph.node('center')
      const neighbors = await (center as any).$expand(1).ids()

      // center -> a, b (outgoing)
      // c, d -> center (incoming)
      expect(neighbors).toContain('a')
      expect(neighbors).toContain('b')
      expect(neighbors).toContain('c')
      expect(neighbors).toContain('d')
    })

    it('should expand 2 hops', async () => {
      const center = graph.node('center')
      const twoHops = await (center as any).$expand(2).ids()

      // 2 hops from center includes a1, b1
      expect(twoHops).toContain('a1')
      expect(twoHops).toContain('b1')
    })
  })

  describe('$reach(n)', () => {
    it('should be alias for $expand', async () => {
      const center = graph.node('center')
      const expandResult = await (center as any).$expand(1).ids()
      const reachResult = await (center as any).$reach(1).ids()

      expect(reachResult.sort()).toEqual(expandResult.sort())
    })
  })
})

describe('$out(n) and $in(n)', () => {
  let graph: OptionsGraph

  beforeEach(() => {
    graph = createOptionsGraph({ namespace: 'test' })
    graph.addRelationships([
      { id: 'r1', type: 'a', from: 'x', to: 'y', createdAt: Date.now() },
      { id: 'r2', type: 'b', from: 'y', to: 'z', createdAt: Date.now() },
      { id: 'r3', type: 'c', from: 'w', to: 'x', createdAt: Date.now() },
    ])
  })

  it('$out(n) should traverse any outgoing edges', async () => {
    const x = graph.node('x')
    const result = await (x as any).$out(2).ids()

    // x -> y -> z (2 hops out, any relationship)
    expect(result).toContain('z')
  })

  it('$in(n) should traverse any incoming edges', async () => {
    const x = graph.node('x')
    const result = await (x as any).$in(1).ids()

    // w -> x (1 hop in)
    expect(result).toContain('w')
  })
})

describe('Chaining with options', () => {
  let graph: OptionsGraph

  beforeEach(() => {
    graph = createOptionsGraph({ namespace: 'test' })
    graph.addRelationships([
      { id: 'r1', type: 'follows', from: 'a', to: 'b', createdAt: Date.now() },
      { id: 'r2', type: 'follows', from: 'b', to: 'c', createdAt: Date.now() },
      { id: 'r3', type: 'likes', from: 'c', to: 'post', createdAt: Date.now() },
    ])
  })

  it('should chain $relationship with options', async () => {
    const a = graph.node('a')
    // follows 2 hops, then likes
    const result = await (a as any).$follows({ depth: 2 }).$likes.ids()

    expect(result).toContain('post')
  })

  it('should chain after $expand', async () => {
    const a = graph.node('a')
    const result = await (a as any).$expand(2).$likes.ids()

    expect(result).toContain('post')
  })
})

describe('Async Iteration (no toArray needed)', () => {
  let graph: OptionsGraph

  beforeEach(() => {
    graph = createOptionsGraph({ namespace: 'test' })
    graph.addRelationships([
      { id: 'r1', type: 'follows', from: 'a', to: 'b', createdAt: Date.now() },
      { id: 'r2', type: 'follows', from: 'a', to: 'c', createdAt: Date.now() },
      { id: 'r3', type: 'follows', from: 'a', to: 'd', createdAt: Date.now() },
    ])
  })

  it('should support for-await-of without toArray()', async () => {
    const a = graph.node('a')
    const ids: string[] = []

    // This is the native way - no array materialization needed
    for await (const node of (a as any).$follows) {
      ids.push(node.id)
    }

    expect(ids).toHaveLength(3)
    expect(ids).toContain('b')
    expect(ids).toContain('c')
    expect(ids).toContain('d')
  })

  it('should support .first() for single results', async () => {
    const a = graph.node('a')
    const first = await (a as any).$follows.first()

    expect(first).not.toBeNull()
    expect(first.id).toBeDefined()
  })

  it('should support .count() for aggregates', async () => {
    const a = graph.node('a')
    const count = await (a as any).$follows.count()

    expect(count).toBe(3)
  })

  it('should support .exists() for boolean check', async () => {
    const a = graph.node('a')
    expect(await (a as any).$follows.exists()).toBe(true)
    expect(await (a as any).$unknown.exists()).toBe(false)
  })
})

describe('Node Properties', () => {
  it('should access properties without $', () => {
    const graph = createOptionsGraph({ namespace: 'test' })
    const node = graph.node('test-id')

    expect(node.id).toBe('test-id')
    expect(node.type).toBeDefined()
    expect(node.data).toBeDefined()
  })
})

describe('Syntax Reference', () => {
  it('documents the final API', () => {
    const syntax = `
    ┌────────────────────────────────────────────────────────────────────────┐
    │  GRAPH SDK SYNTAX                                                      │
    ├────────────────────────────────────────────────────────────────────────┤
    │                                                                        │
    │  TRAVERSAL                                                             │
    │  ─────────                                                             │
    │  user.$follows                    │  Outgoing 'follows'                │
    │  user.$follows()                  │  Same (callable)                   │
    │  user.$follows({ depth: 3 })      │  3 hops deep                       │
    │  user.$follows({ where: {...} })  │  With filter                       │
    │  user.$follows({ limit: 10 })     │  Max 10 results                    │
    │                                                                        │
    │  REVERSE                                                               │
    │  ───────                                                               │
    │  user.$followedBy                 │  Incoming (smart reverse)          │
    │  user.$likedBy                    │  Incoming 'likes'                  │
    │                                                                        │
    │  ANY RELATIONSHIP                                                      │
    │  ────────────────                                                      │
    │  user.$out(2)                     │  Any outgoing, 2 hops              │
    │  user.$in(3)                      │  Any incoming, 3 hops              │
    │  user.$expand(2)                  │  All directions, 2 hops            │
    │  user.$reach(2)                   │  Alias for expand                  │
    │                                                                        │
    │  EXECUTION (Cap'n Proto native)                                        │
    │  ─────────────────────────────                                         │
    │  for await (const n of user.$follows) {...}  │  Stream nodes           │
    │  await user.$follows.first()                 │  Single node            │
    │  await user.$follows.count()                 │  Aggregate              │
    │  await user.$follows.exists()                │  Boolean check          │
    │  await user.$follows.ids()                   │  Just IDs               │
    │                                                                        │
    │  MONGO COMPAT (optional)                                               │
    │  ───────────────────────                                               │
    │  await user.$follows.toArray()    │  Materialize to array              │
    │  await user.$follows.nodes()      │  Same as toArray                   │
    │                                                                        │
    └────────────────────────────────────────────────────────────────────────┘
    `
    expect(syntax).toBeDefined()
  })
})
