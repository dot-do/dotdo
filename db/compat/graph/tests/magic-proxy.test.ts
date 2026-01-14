/**
 * Magic $ Proxy - TDD RED Phase Tests
 *
 * Tests for the Magic $ Proxy that enables ergonomic graph traversal syntax:
 * - `user.$.follows` - traverse outgoing 'follows' edges
 * - `user.$.in.follows` - traverse incoming 'follows' edges (followers)
 * - `user.$.follows.follows` - chain traversals (friends of friends)
 * - `user.$.follows.likes` - chain different relationship types
 *
 * @see SDK-1: Magic $ Proxy Implementation
 */
import { describe, it, expect, beforeEach } from 'vitest'

// Import from production module path (does not exist yet - RED phase)
import {
  createMagicProxy,
  MagicTraversal,
  TraversalContext,
  type Thing,
  type Relationship,
} from '../src/magic-proxy'

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Creates a mock traversal context with test data for graph traversal tests.
 * The context manages relationships and provides the underlying traversal engine.
 */
function createTestContext(): TraversalContext {
  const relationships: Relationship[] = []
  const things = new Map<string, Thing>()

  const context: TraversalContext = {
    addRelationship(rel: Relationship) {
      relationships.push(rel)
    },
    addThing(thing: Thing) {
      things.set(thing.id, thing)
    },
    getRelationships() {
      return relationships
    },
    getThing(id: string) {
      return things.get(id)
    },
    getThings(ids: string[]) {
      return ids.map(id => things.get(id)).filter(Boolean) as Thing[]
    },
  }

  return context
}

/**
 * Helper to create a Thing with minimal properties
 */
function createThing(id: string, type = 'User', data: Record<string, unknown> = {}): Thing {
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
// BASIC PROPERTY ACCESS
// ============================================================================

describe('Magic $ Proxy - Basic Property Access', () => {
  let ctx: TraversalContext

  beforeEach(() => {
    ctx = createTestContext()

    // Create test users
    ctx.addThing(createThing('alice', 'User', { name: 'Alice' }))
    ctx.addThing(createThing('bob', 'User', { name: 'Bob' }))
    ctx.addThing(createThing('carol', 'User', { name: 'Carol' }))
    ctx.addThing(createThing('dave', 'User', { name: 'Dave' }))

    // Create follows relationships: alice -> bob, alice -> carol
    ctx.addRelationship(createRelationship('alice', 'follows', 'bob'))
    ctx.addRelationship(createRelationship('alice', 'follows', 'carol'))
    ctx.addRelationship(createRelationship('bob', 'follows', 'carol'))
    ctx.addRelationship(createRelationship('bob', 'follows', 'dave'))
  })

  it('should return a traversal when accessing a relationship type as property', () => {
    const $ = createMagicProxy(ctx, ['alice'])

    // Accessing .follows should return something traversal-like
    const traversal = $.follows

    expect(traversal).toBeDefined()
    expect(typeof traversal.ids).toBe('function')
    expect(typeof traversal.nodes).toBe('function')
    expect(typeof traversal.toArray).toBe('function')
    expect(typeof traversal.count).toBe('function')
  })

  it('should traverse outgoing edges with $.follows', async () => {
    const $ = createMagicProxy(ctx, ['alice'])

    const followingIds = await $.follows.ids()

    expect(followingIds).toContain('bob')
    expect(followingIds).toContain('carol')
    expect(followingIds).toHaveLength(2)
  })

  it('should return node objects with $.follows.nodes()', async () => {
    const $ = createMagicProxy(ctx, ['alice'])

    const following = await $.follows.nodes()

    expect(following).toHaveLength(2)
    expect(following.map(n => n.id)).toContain('bob')
    expect(following.map(n => n.id)).toContain('carol')
    expect(following[0]).toHaveProperty('type')
    expect(following[0]).toHaveProperty('data')
  })

  it('should return node objects with $.follows.toArray() (alias)', async () => {
    const $ = createMagicProxy(ctx, ['alice'])

    const following = await $.follows.toArray()

    expect(following).toHaveLength(2)
    expect(following.map(n => n.id)).toContain('bob')
  })

  it('should count results with $.follows.count()', async () => {
    const $ = createMagicProxy(ctx, ['alice'])

    const count = await $.follows.count()

    expect(count).toBe(2)
  })

  it('should handle nodes with no outgoing relationships', async () => {
    const $ = createMagicProxy(ctx, ['dave'])

    const followingIds = await $.follows.ids()

    expect(followingIds).toHaveLength(0)
  })

  it('should be chainable from GraphNode.$ accessor', async () => {
    // This tests the integration pattern where a GraphNode has a $ property
    const node = {
      id: 'alice',
      $: createMagicProxy(ctx, ['alice']),
    }

    const followingIds = await node.$.follows.ids()

    expect(followingIds).toContain('bob')
    expect(followingIds).toContain('carol')
  })
})

// ============================================================================
// REVERSE DIRECTION (INCOMING EDGES)
// ============================================================================

describe('Magic $ Proxy - Reverse Direction ($.in)', () => {
  let ctx: TraversalContext

  beforeEach(() => {
    ctx = createTestContext()

    // Create test users
    ctx.addThing(createThing('alice', 'User', { name: 'Alice' }))
    ctx.addThing(createThing('bob', 'User', { name: 'Bob' }))
    ctx.addThing(createThing('carol', 'User', { name: 'Carol' }))
    ctx.addThing(createThing('dave', 'User', { name: 'Dave' }))

    // Create follows relationships
    // alice -> bob, alice -> carol, bob -> carol, bob -> dave
    ctx.addRelationship(createRelationship('alice', 'follows', 'bob'))
    ctx.addRelationship(createRelationship('alice', 'follows', 'carol'))
    ctx.addRelationship(createRelationship('bob', 'follows', 'carol'))
    ctx.addRelationship(createRelationship('bob', 'follows', 'dave'))
  })

  it('should return a magic proxy for $.in', () => {
    const $ = createMagicProxy(ctx, ['carol'])

    const inProxy = $.in

    expect(inProxy).toBeDefined()
    // $.in should allow further property access for relationship types
    expect(typeof inProxy.follows).not.toBe('undefined')
  })

  it('should traverse incoming edges with $.in.follows', async () => {
    const $ = createMagicProxy(ctx, ['carol'])

    // Carol is followed by alice and bob
    const followerIds = await $.in.follows.ids()

    expect(followerIds).toContain('alice')
    expect(followerIds).toContain('bob')
    expect(followerIds).toHaveLength(2)
  })

  it('should return node objects with $.in.follows.nodes()', async () => {
    const $ = createMagicProxy(ctx, ['carol'])

    const followers = await $.in.follows.nodes()

    expect(followers).toHaveLength(2)
    expect(followers.map(n => n.id)).toContain('alice')
    expect(followers.map(n => n.id)).toContain('bob')
  })

  it('should count incoming edges with $.in.follows.count()', async () => {
    const $ = createMagicProxy(ctx, ['carol'])

    const count = await $.in.follows.count()

    expect(count).toBe(2)
  })

  it('should handle nodes with no incoming relationships', async () => {
    const $ = createMagicProxy(ctx, ['alice'])

    // No one follows alice in our test data
    const followerIds = await $.in.follows.ids()

    expect(followerIds).toHaveLength(0)
  })

  it('should support .toArray() on incoming traversals', async () => {
    const $ = createMagicProxy(ctx, ['bob'])

    // Bob is followed by alice
    const followers = await $.in.follows.toArray()

    expect(followers).toHaveLength(1)
    expect(followers[0].id).toBe('alice')
  })
})

// ============================================================================
// CHAINING TRAVERSALS
// ============================================================================

describe('Magic $ Proxy - Chaining Traversals', () => {
  let ctx: TraversalContext

  beforeEach(() => {
    ctx = createTestContext()

    // Create test users
    ctx.addThing(createThing('alice', 'User', { name: 'Alice' }))
    ctx.addThing(createThing('bob', 'User', { name: 'Bob' }))
    ctx.addThing(createThing('carol', 'User', { name: 'Carol' }))
    ctx.addThing(createThing('dave', 'User', { name: 'Dave' }))
    ctx.addThing(createThing('eve', 'User', { name: 'Eve' }))

    // Create follows relationships (social graph)
    // alice -> bob -> dave
    // alice -> carol -> eve
    // bob -> carol
    ctx.addRelationship(createRelationship('alice', 'follows', 'bob'))
    ctx.addRelationship(createRelationship('alice', 'follows', 'carol'))
    ctx.addRelationship(createRelationship('bob', 'follows', 'carol'))
    ctx.addRelationship(createRelationship('bob', 'follows', 'dave'))
    ctx.addRelationship(createRelationship('carol', 'follows', 'eve'))
  })

  it('should chain same relationship type (friends of friends)', async () => {
    const $ = createMagicProxy(ctx, ['alice'])

    // alice.follows.follows = friends of friends
    // alice -> bob -> (carol, dave)
    // alice -> carol -> eve
    const fofIds = await $.follows.follows.ids()

    expect(fofIds).toContain('carol') // via bob
    expect(fofIds).toContain('dave') // via bob
    expect(fofIds).toContain('eve') // via carol
  })

  it('should return unique results when chaining (no duplicates)', async () => {
    const $ = createMagicProxy(ctx, ['alice'])

    // carol appears in both bob's follows and alice's follows
    // but in friends-of-friends, carol should only appear once
    const fofIds = await $.follows.follows.ids()

    // Each ID should be unique
    const uniqueIds = Array.from(new Set(fofIds))
    expect(fofIds.length).toBe(uniqueIds.length)
  })

  it('should support deep chaining (3+ levels)', async () => {
    const $ = createMagicProxy(ctx, ['alice'])

    // alice -> bob -> carol -> eve
    // or alice -> carol -> eve
    const deepIds = await $.follows.follows.follows.ids()

    // From alice's perspective:
    // - alice -> bob -> (carol, dave) -> carol follows eve, dave follows no one
    // - alice -> carol -> eve -> eve follows no one
    // So: eve should appear
    expect(deepIds).toContain('eve')
  })

  it('should return node objects when chaining', async () => {
    const $ = createMagicProxy(ctx, ['alice'])

    const fof = await $.follows.follows.nodes()

    expect(fof.length).toBeGreaterThan(0)
    expect(fof[0]).toHaveProperty('id')
    expect(fof[0]).toHaveProperty('type')
  })

  it('should count chained results', async () => {
    const $ = createMagicProxy(ctx, ['alice'])

    const count = await $.follows.follows.count()

    expect(count).toBeGreaterThan(0)
  })
})

// ============================================================================
// MIXED CHAINING (DIFFERENT RELATIONSHIP TYPES)
// ============================================================================

describe('Magic $ Proxy - Mixed Chaining (Different Relationship Types)', () => {
  let ctx: TraversalContext

  beforeEach(() => {
    ctx = createTestContext()

    // Create test users and posts
    ctx.addThing(createThing('alice', 'User', { name: 'Alice' }))
    ctx.addThing(createThing('bob', 'User', { name: 'Bob' }))
    ctx.addThing(createThing('carol', 'User', { name: 'Carol' }))
    ctx.addThing(createThing('post-1', 'Post', { title: 'First Post' }))
    ctx.addThing(createThing('post-2', 'Post', { title: 'Second Post' }))
    ctx.addThing(createThing('post-3', 'Post', { title: 'Third Post' }))

    // Create relationships
    // alice follows bob, carol
    ctx.addRelationship(createRelationship('alice', 'follows', 'bob'))
    ctx.addRelationship(createRelationship('alice', 'follows', 'carol'))

    // bob likes post-1, post-2
    ctx.addRelationship(createRelationship('bob', 'likes', 'post-1'))
    ctx.addRelationship(createRelationship('bob', 'likes', 'post-2'))

    // carol likes post-2, post-3
    ctx.addRelationship(createRelationship('carol', 'likes', 'post-2'))
    ctx.addRelationship(createRelationship('carol', 'likes', 'post-3'))

    // carol authored post-3
    ctx.addRelationship(createRelationship('carol', 'authored', 'post-3'))
  })

  it('should chain different relationship types', async () => {
    const $ = createMagicProxy(ctx, ['alice'])

    // Posts liked by people Alice follows
    const likedPostIds = await $.follows.likes.ids()

    expect(likedPostIds).toContain('post-1') // bob likes
    expect(likedPostIds).toContain('post-2') // bob and carol like
    expect(likedPostIds).toContain('post-3') // carol likes
  })

  it('should chain follows -> authored', async () => {
    const $ = createMagicProxy(ctx, ['alice'])

    // Posts authored by people Alice follows
    const authoredPostIds = await $.follows.authored.ids()

    expect(authoredPostIds).toContain('post-3') // carol authored
    expect(authoredPostIds).toHaveLength(1)
  })

  it('should return correct node types when chaining different types', async () => {
    const $ = createMagicProxy(ctx, ['alice'])

    const likedPosts = await $.follows.likes.nodes()

    expect(likedPosts.length).toBeGreaterThan(0)
    // All results should be Posts
    for (const post of likedPosts) {
      expect(post.type).toBe('Post')
    }
  })

  it('should handle mixed chains with empty intermediate results', async () => {
    // dave has no likes
    ctx.addThing(createThing('dave', 'User', { name: 'Dave' }))
    ctx.addRelationship(createRelationship('alice', 'follows', 'dave'))

    // dave follows no one, so dave.follows.likes should be empty
    const $dave = createMagicProxy(ctx, ['dave'])
    const result = await $dave.follows.likes.ids()

    expect(result).toHaveLength(0)
  })
})

// ============================================================================
// DIRECTION AFTER CHAIN ($.follows.in.likes)
// ============================================================================

describe('Magic $ Proxy - Direction After Chain', () => {
  let ctx: TraversalContext

  beforeEach(() => {
    ctx = createTestContext()

    // Create test data
    ctx.addThing(createThing('alice', 'User', { name: 'Alice' }))
    ctx.addThing(createThing('bob', 'User', { name: 'Bob' }))
    ctx.addThing(createThing('carol', 'User', { name: 'Carol' }))
    ctx.addThing(createThing('post-1', 'Post', { title: 'First Post' }))
    ctx.addThing(createThing('post-2', 'Post', { title: 'Second Post' }))

    // alice follows bob
    ctx.addRelationship(createRelationship('alice', 'follows', 'bob'))

    // carol likes bob (incoming like relationship to bob)
    ctx.addRelationship(createRelationship('carol', 'likes', 'bob'))

    // dave follows bob too
    ctx.addThing(createThing('dave', 'User', { name: 'Dave' }))
    ctx.addRelationship(createRelationship('dave', 'follows', 'bob'))
  })

  it('should support direction change mid-chain with $.follows.in.likes', async () => {
    const $ = createMagicProxy(ctx, ['alice'])

    // alice -> bob (follows), then who likes bob (incoming likes)
    // carol likes bob, so result should be carol
    const likerIds = await $.follows.in.likes.ids()

    expect(likerIds).toContain('carol')
  })

  it('should support $.follows.in.follows (who follows the people I follow)', async () => {
    const $ = createMagicProxy(ctx, ['alice'])

    // alice follows bob, who follows bob? alice and dave
    const coFollowerIds = await $.follows.in.follows.ids()

    // Both alice and dave follow bob
    expect(coFollowerIds).toContain('alice')
    expect(coFollowerIds).toContain('dave')
  })

  it('should support multiple direction changes in a chain', async () => {
    // Create more complex relationships
    ctx.addThing(createThing('eve', 'User', { name: 'Eve' }))
    ctx.addRelationship(createRelationship('bob', 'follows', 'eve'))
    ctx.addRelationship(createRelationship('carol', 'follows', 'eve'))

    const $ = createMagicProxy(ctx, ['alice'])

    // alice.follows (bob) .follows (eve) .in.follows (who follows eve: bob, carol)
    const result = await $.follows.follows.in.follows.ids()

    expect(result).toContain('bob')
    expect(result).toContain('carol')
  })

  it('should handle direction changes with no results', async () => {
    const $ = createMagicProxy(ctx, ['carol'])

    // carol follows no one, so carol.follows.in.likes should be empty
    const result = await $.follows.in.likes.ids()

    expect(result).toHaveLength(0)
  })
})

// ============================================================================
// TRAVERSAL METHODS PRESERVATION
// ============================================================================

describe('Magic $ Proxy - Traversal Methods', () => {
  let ctx: TraversalContext

  beforeEach(() => {
    ctx = createTestContext()

    // Create 10 test users
    for (let i = 1; i <= 10; i++) {
      ctx.addThing(createThing(`user-${i}`, 'User', { name: `User ${i}`, index: i }))
    }

    // user-1 follows users 2-10
    for (let i = 2; i <= 10; i++) {
      ctx.addRelationship(createRelationship('user-1', 'follows', `user-${i}`))
    }
  })

  it('should provide .ids() method returning string array', async () => {
    const $ = createMagicProxy(ctx, ['user-1'])

    const ids = await $.follows.ids()

    expect(Array.isArray(ids)).toBe(true)
    expect(ids.length).toBe(9)
    expect(typeof ids[0]).toBe('string')
  })

  it('should provide .nodes() method returning Thing array', async () => {
    const $ = createMagicProxy(ctx, ['user-1'])

    const nodes = await $.follows.nodes()

    expect(Array.isArray(nodes)).toBe(true)
    expect(nodes.length).toBe(9)
    expect(nodes[0]).toHaveProperty('id')
    expect(nodes[0]).toHaveProperty('type')
    expect(nodes[0]).toHaveProperty('data')
  })

  it('should provide .toArray() as alias for .nodes()', async () => {
    const $ = createMagicProxy(ctx, ['user-1'])

    const nodesFromToArray = await $.follows.toArray()
    const nodesFromNodes = await $.follows.nodes()

    expect(nodesFromToArray.length).toBe(nodesFromNodes.length)
    expect(nodesFromToArray.map(n => n.id).sort()).toEqual(nodesFromNodes.map(n => n.id).sort())
  })

  it('should provide .count() method returning number', async () => {
    const $ = createMagicProxy(ctx, ['user-1'])

    const count = await $.follows.count()

    expect(typeof count).toBe('number')
    expect(count).toBe(9)
  })

  it('should provide .first() method returning single Thing or null', async () => {
    const $ = createMagicProxy(ctx, ['user-1'])

    const first = await $.follows.first()

    expect(first).not.toBeNull()
    expect(first).toHaveProperty('id')
    expect(first).toHaveProperty('type')
  })

  it('should return null from .first() when no results', async () => {
    ctx.addThing(createThing('lonely', 'User', { name: 'Lonely' }))

    const $ = createMagicProxy(ctx, ['lonely'])

    const first = await $.follows.first()

    expect(first).toBeNull()
  })

  it('should provide .exists() method returning boolean', async () => {
    const $ = createMagicProxy(ctx, ['user-1'])

    const exists = await $.follows.exists()

    expect(typeof exists).toBe('boolean')
    expect(exists).toBe(true)
  })

  it('should return false from .exists() when no results', async () => {
    ctx.addThing(createThing('lonely', 'User', { name: 'Lonely' }))

    const $ = createMagicProxy(ctx, ['lonely'])

    const exists = await $.follows.exists()

    expect(exists).toBe(false)
  })

  it('should provide .limit() method', async () => {
    const $ = createMagicProxy(ctx, ['user-1'])

    const limited = await $.follows.limit(3).ids()

    expect(limited.length).toBe(3)
  })

  it('should provide .skip() method', async () => {
    const $ = createMagicProxy(ctx, ['user-1'])

    const allIds = await $.follows.ids()
    const skippedIds = await $.follows.skip(2).ids()

    expect(skippedIds.length).toBe(7) // 9 - 2
    expect(skippedIds).not.toContain(allIds[0])
    expect(skippedIds).not.toContain(allIds[1])
  })

  it('should chain .skip() and .limit()', async () => {
    const $ = createMagicProxy(ctx, ['user-1'])

    const paginated = await $.follows.skip(2).limit(3).ids()

    expect(paginated.length).toBe(3)
  })

  it('should preserve methods after property access chain', async () => {
    ctx.addRelationship(createRelationship('user-2', 'follows', 'user-3'))
    ctx.addRelationship(createRelationship('user-2', 'follows', 'user-4'))

    const $ = createMagicProxy(ctx, ['user-1'])

    // Even after chaining .follows.follows, methods should work
    const count = await $.follows.follows.count()

    expect(typeof count).toBe('number')
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Magic $ Proxy - Edge Cases', () => {
  let ctx: TraversalContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('should handle non-existent relationship types gracefully', async () => {
    ctx.addThing(createThing('alice', 'User', { name: 'Alice' }))

    const $ = createMagicProxy(ctx, ['alice'])

    // 'unknownType' doesn't exist as a relationship
    const ids = await $.unknownType.ids()

    expect(ids).toHaveLength(0)
  })

  it('should handle empty starting node set', async () => {
    const $ = createMagicProxy(ctx, [])

    const ids = await $.follows.ids()

    expect(ids).toHaveLength(0)
  })

  it('should handle non-existent starting nodes', async () => {
    const $ = createMagicProxy(ctx, ['non-existent-user'])

    const ids = await $.follows.ids()

    expect(ids).toHaveLength(0)
  })

  it('should handle circular relationships without infinite loops', async () => {
    // Create circular: alice -> bob -> carol -> alice
    ctx.addThing(createThing('alice', 'User', { name: 'Alice' }))
    ctx.addThing(createThing('bob', 'User', { name: 'Bob' }))
    ctx.addThing(createThing('carol', 'User', { name: 'Carol' }))

    ctx.addRelationship(createRelationship('alice', 'follows', 'bob'))
    ctx.addRelationship(createRelationship('bob', 'follows', 'carol'))
    ctx.addRelationship(createRelationship('carol', 'follows', 'alice'))

    const $ = createMagicProxy(ctx, ['alice'])

    // Should not hang or throw, should return carol
    const fofIds = await $.follows.follows.ids()

    expect(fofIds).toContain('carol')
  })

  it('should handle self-referential relationships', async () => {
    ctx.addThing(createThing('narcissist', 'User', { name: 'Narcissist' }))
    ctx.addRelationship(createRelationship('narcissist', 'follows', 'narcissist'))

    const $ = createMagicProxy(ctx, ['narcissist'])

    const ids = await $.follows.ids()

    expect(ids).toContain('narcissist')
    expect(ids).toHaveLength(1)
  })

  it('should handle multiple starting nodes', async () => {
    ctx.addThing(createThing('alice', 'User', { name: 'Alice' }))
    ctx.addThing(createThing('bob', 'User', { name: 'Bob' }))
    ctx.addThing(createThing('carol', 'User', { name: 'Carol' }))
    ctx.addThing(createThing('dave', 'User', { name: 'Dave' }))

    ctx.addRelationship(createRelationship('alice', 'follows', 'carol'))
    ctx.addRelationship(createRelationship('bob', 'follows', 'dave'))

    const $ = createMagicProxy(ctx, ['alice', 'bob'])

    const ids = await $.follows.ids()

    expect(ids).toContain('carol')
    expect(ids).toContain('dave')
  })

  it('should not treat internal properties as relationship types', async () => {
    ctx.addThing(createThing('alice', 'User', { name: 'Alice' }))

    const $ = createMagicProxy(ctx, ['alice'])

    // These should return the actual method/property, not a traversal
    expect(typeof $.ids).toBe('function')
    expect(typeof $.nodes).toBe('function')
    expect(typeof $.toArray).toBe('function')
    expect(typeof $.count).toBe('function')
    expect(typeof $.limit).toBe('function')
    expect(typeof $.skip).toBe('function')
  })

  it('should handle relationship types with special characters in names', async () => {
    ctx.addThing(createThing('alice', 'User', { name: 'Alice' }))
    ctx.addThing(createThing('post', 'Post', { title: 'Post' }))

    // Relationship type with underscore
    ctx.addRelationship(createRelationship('alice', 'has_written', 'post'))

    const $ = createMagicProxy(ctx, ['alice'])

    const ids = await $.has_written.ids()

    expect(ids).toContain('post')
  })

  it('should handle camelCase relationship type names', async () => {
    ctx.addThing(createThing('alice', 'User', { name: 'Alice' }))
    ctx.addThing(createThing('company', 'Company', { name: 'Acme' }))

    ctx.addRelationship(createRelationship('alice', 'worksAt', 'company'))

    const $ = createMagicProxy(ctx, ['alice'])

    const ids = await $.worksAt.ids()

    expect(ids).toContain('company')
  })

  it('should handle SCREAMING_SNAKE_CASE relationship type names', async () => {
    ctx.addThing(createThing('alice', 'User', { name: 'Alice' }))
    ctx.addThing(createThing('bob', 'User', { name: 'Bob' }))

    ctx.addRelationship(createRelationship('alice', 'FRIENDS_WITH', 'bob'))

    const $ = createMagicProxy(ctx, ['alice'])

    const ids = await $.FRIENDS_WITH.ids()

    expect(ids).toContain('bob')
  })
})

// ============================================================================
// ASYNC ITERATION SUPPORT
// ============================================================================

describe('Magic $ Proxy - Async Iteration', () => {
  let ctx: TraversalContext

  beforeEach(() => {
    ctx = createTestContext()

    ctx.addThing(createThing('alice', 'User', { name: 'Alice' }))
    ctx.addThing(createThing('bob', 'User', { name: 'Bob' }))
    ctx.addThing(createThing('carol', 'User', { name: 'Carol' }))

    ctx.addRelationship(createRelationship('alice', 'follows', 'bob'))
    ctx.addRelationship(createRelationship('alice', 'follows', 'carol'))
  })

  it('should support for-await-of iteration', async () => {
    const $ = createMagicProxy(ctx, ['alice'])

    const ids: string[] = []
    for await (const node of $.follows) {
      ids.push(node.id)
    }

    expect(ids).toContain('bob')
    expect(ids).toContain('carol')
    expect(ids).toHaveLength(2)
  })

  it('should support Symbol.asyncIterator', async () => {
    const $ = createMagicProxy(ctx, ['alice'])

    const traversal = $.follows

    expect(typeof traversal[Symbol.asyncIterator]).toBe('function')
  })
})

// ============================================================================
// TYPE SAFETY (compile-time checks, documented here for reference)
// ============================================================================

describe('Magic $ Proxy - Type Annotations', () => {
  let ctx: TraversalContext

  beforeEach(() => {
    ctx = createTestContext()
    ctx.addThing(createThing('alice', 'User', { name: 'Alice' }))
    ctx.addThing(createThing('bob', 'User', { name: 'Bob' }))
    ctx.addRelationship(createRelationship('alice', 'follows', 'bob'))
  })

  it('should return MagicTraversal from property access', () => {
    const $ = createMagicProxy(ctx, ['alice'])

    const traversal: MagicTraversal = $.follows

    // This is a compile-time check - if types are wrong, this won't compile
    expect(traversal).toBeDefined()
  })

  it('should preserve types through chaining', () => {
    const $ = createMagicProxy(ctx, ['alice'])

    // Each step should return MagicTraversal
    const step1: MagicTraversal = $.follows
    const step2: MagicTraversal = $.in.follows
    const step3: MagicTraversal = $.follows.follows

    expect(step1).toBeDefined()
    expect(step2).toBeDefined()
    expect(step3).toBeDefined()
  })
})

// ============================================================================
// INTEGRATION WITH GRAPH CLIENT PATTERN
// ============================================================================

describe('Magic $ Proxy - Graph Client Integration Pattern', () => {
  let ctx: TraversalContext

  beforeEach(() => {
    ctx = createTestContext()

    ctx.addThing(createThing('alice', 'User', { name: 'Alice' }))
    ctx.addThing(createThing('bob', 'User', { name: 'Bob' }))
    ctx.addThing(createThing('carol', 'User', { name: 'Carol' }))

    ctx.addRelationship(createRelationship('alice', 'follows', 'bob'))
    ctx.addRelationship(createRelationship('bob', 'follows', 'carol'))
  })

  it('should work with graph.node(id).$ pattern', async () => {
    // Simulating the Graph client pattern
    const graph = {
      node: (id: string) => ({
        id,
        $: createMagicProxy(ctx, [id]),
      }),
    }

    const alice = graph.node('alice')
    const followingIds = await alice.$.follows.ids()

    expect(followingIds).toContain('bob')
  })

  it('should work with graph.from(...ids) pattern', async () => {
    // Simulating starting traversal from multiple nodes
    const $ = createMagicProxy(ctx, ['alice', 'bob'])

    const followingIds = await $.follows.ids()

    // alice follows bob, bob follows carol
    expect(followingIds).toContain('bob')
    expect(followingIds).toContain('carol')
  })
})
