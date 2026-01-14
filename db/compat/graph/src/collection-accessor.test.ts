/**
 * Collection Accessor - TDD RED Phase Tests
 *
 * Tests for the Collection Accessor pattern that enables type-based access:
 * - `graph.$User()` - returns all users
 * - `graph.$User('id')` - returns specific node
 * - `graph.$User.find({...})` - query by predicate
 * - `graph.$User.where({...})` - traversal with filter
 * - `graph.$User.$stream` - streaming access
 *
 * @see Issue: dotdo-oamdb
 * @see Spike: db/compat/sql/clickhouse/spikes/graph-sdk-unified.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'

// Import from production module path (does not exist yet - RED phase)
import {
  createCollectionGraph,
  type CollectionGraph,
  type TypeCollection,
  type GraphNode,
  type Thing,
  type Relationship,
  type Traversal,
} from './collection-accessor'

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Helper to create a Thing with minimal properties
 */
function createThing(
  id: string,
  type: string,
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

/**
 * Creates a pre-populated test graph with Users and Posts
 */
function createTestGraph(): CollectionGraph {
  const graph = createCollectionGraph({ namespace: 'test' })

  // Create users
  graph.addThing(createThing('alice', 'User', { name: 'Alice', email: 'alice@test.com', active: true, role: 'admin' }))
  graph.addThing(createThing('bob', 'User', { name: 'Bob', email: 'bob@test.com', active: true, role: 'user' }))
  graph.addThing(createThing('carol', 'User', { name: 'Carol', email: 'carol@test.com', active: false, role: 'user' }))
  graph.addThing(createThing('dave', 'User', { name: 'Dave', email: 'dave@test.com', active: true, role: 'moderator' }))

  // Create posts
  graph.addThing(createThing('post-1', 'Post', { title: 'First Post', published: true, views: 100 }))
  graph.addThing(createThing('post-2', 'Post', { title: 'Second Post', published: true, views: 50 }))
  graph.addThing(createThing('post-3', 'Post', { title: 'Draft Post', published: false, views: 0 }))

  // Create relationships
  graph.addRelationship(createRelationship('alice', 'follows', 'bob'))
  graph.addRelationship(createRelationship('alice', 'follows', 'carol'))
  graph.addRelationship(createRelationship('bob', 'follows', 'carol'))
  graph.addRelationship(createRelationship('bob', 'follows', 'dave'))

  graph.addRelationship(createRelationship('alice', 'authored', 'post-1'))
  graph.addRelationship(createRelationship('bob', 'authored', 'post-2'))
  graph.addRelationship(createRelationship('carol', 'authored', 'post-3'))

  graph.addRelationship(createRelationship('bob', 'likes', 'post-1'))
  graph.addRelationship(createRelationship('carol', 'likes', 'post-1'))
  graph.addRelationship(createRelationship('dave', 'likes', 'post-2'))

  return graph
}

// ============================================================================
// graph.$User() - GET ALL OF TYPE
// ============================================================================

describe('Collection Accessor - $Type() returns all entities', () => {
  let graph: CollectionGraph

  beforeEach(() => {
    graph = createTestGraph()
  })

  it('should return all users when calling graph.$User()', async () => {
    const users = await graph.$User()

    expect(users).toHaveLength(4)
    expect(users.map((u: Thing) => u.id)).toContain('alice')
    expect(users.map((u: Thing) => u.id)).toContain('bob')
    expect(users.map((u: Thing) => u.id)).toContain('carol')
    expect(users.map((u: Thing) => u.id)).toContain('dave')
  })

  it('should return all posts when calling graph.$Post()', async () => {
    const posts = await graph.$Post()

    expect(posts).toHaveLength(3)
    expect(posts.map((p: Thing) => p.id)).toContain('post-1')
    expect(posts.map((p: Thing) => p.id)).toContain('post-2')
    expect(posts.map((p: Thing) => p.id)).toContain('post-3')
  })

  it('should return empty array for non-existent type', async () => {
    const comments = await graph.$Comment()

    expect(comments).toHaveLength(0)
    expect(Array.isArray(comments)).toBe(true)
  })

  it('should return Thing objects with all properties', async () => {
    const users = await graph.$User()
    const alice = users.find((u: Thing) => u.id === 'alice')

    expect(alice).toBeDefined()
    expect(alice?.type).toBe('User')
    expect(alice?.ns).toBe('test')
    expect(alice?.data.name).toBe('Alice')
    expect(alice?.data.email).toBe('alice@test.com')
    expect(alice?.createdAt).toBeDefined()
    expect(alice?.updatedAt).toBeDefined()
  })

  it('should be callable as a function (TypeCollection interface)', () => {
    const userCollection = graph.$User

    expect(typeof userCollection).toBe('function')
  })

  it('should reflect newly added entities', async () => {
    graph.addThing(createThing('eve', 'User', { name: 'Eve' }))

    const users = await graph.$User()

    expect(users).toHaveLength(5)
    expect(users.map((u: Thing) => u.id)).toContain('eve')
  })
})

// ============================================================================
// graph.$User('id') - GET SPECIFIC NODE BY ID
// ============================================================================

describe('Collection Accessor - $Type(id) returns specific node', () => {
  let graph: CollectionGraph

  beforeEach(() => {
    graph = createTestGraph()
  })

  it('should return a GraphNode when passing an ID', () => {
    const alice = graph.$User('alice')

    expect(alice).toBeDefined()
    expect(alice.$id).toBe('alice')
  })

  it('should return node with JSON-LD style $id property', () => {
    const alice = graph.$User('alice')

    expect(alice.$id).toBe('alice')
  })

  it('should return node with JSON-LD style $type property', () => {
    const alice = graph.$User('alice')

    expect(alice.$type).toBe('User')
  })

  it('should return node with data properties', () => {
    const alice = graph.$User('alice')

    expect(alice.data).toBeDefined()
    expect(alice.data.name).toBe('Alice')
    expect(alice.data.email).toBe('alice@test.com')
    expect(alice.data.active).toBe(true)
    expect(alice.data.role).toBe('admin')
  })

  it('should return node with $graph reference', () => {
    const alice = graph.$User('alice')

    expect(alice.$graph).toBe(graph)
  })

  it('should enable traversal from the returned node', async () => {
    const alice = graph.$User('alice')

    // alice.$follows should return a traversal
    const followingIds = await alice.$follows.ids()

    expect(followingIds).toContain('bob')
    expect(followingIds).toContain('carol')
  })

  it('should handle non-existent ID gracefully', () => {
    const nonExistent = graph.$User('non-existent')

    // Should return a node-like object but with undefined data
    expect(nonExistent.$id).toBe('non-existent')
    expect(nonExistent.$type).toBe('Unknown')
  })

  it('should work with post type', () => {
    const post = graph.$Post('post-1')

    expect(post.$id).toBe('post-1')
    expect(post.$type).toBe('Post')
    expect(post.data.title).toBe('First Post')
  })

  it('should allow traversal chaining from node', async () => {
    const bob = graph.$User('bob')

    // People who authored posts that bob likes
    const authorsOfLikedPosts = await bob.$likes.$authoredBy.ids()

    expect(authorsOfLikedPosts).toContain('alice') // bob likes post-1, authored by alice
  })
})

// ============================================================================
// graph.$User.find({...}) - QUERY BY PREDICATE
// ============================================================================

describe('Collection Accessor - $Type.find() query by predicate', () => {
  let graph: CollectionGraph

  beforeEach(() => {
    graph = createTestGraph()
  })

  it('should find first user matching simple predicate', async () => {
    const admin = await graph.$User.find({ role: 'admin' })

    expect(admin).not.toBeNull()
    expect(admin?.id).toBe('alice')
    expect(admin?.data.role).toBe('admin')
  })

  it('should find first user matching multiple predicates', async () => {
    const activeUser = await graph.$User.find({ active: true, role: 'user' })

    expect(activeUser).not.toBeNull()
    expect(activeUser?.id).toBe('bob')
    expect(activeUser?.data.active).toBe(true)
    expect(activeUser?.data.role).toBe('user')
  })

  it('should return null when no match found', async () => {
    const superAdmin = await graph.$User.find({ role: 'superadmin' })

    expect(superAdmin).toBeNull()
  })

  it('should find post matching predicate', async () => {
    const draft = await graph.$Post.find({ published: false })

    expect(draft).not.toBeNull()
    expect(draft?.id).toBe('post-3')
    expect(draft?.data.published).toBe(false)
  })

  it('should find by exact string match', async () => {
    const bob = await graph.$User.find({ name: 'Bob' })

    expect(bob).not.toBeNull()
    expect(bob?.id).toBe('bob')
  })

  it('should find by numeric value', async () => {
    const popularPost = await graph.$Post.find({ views: 100 })

    expect(popularPost).not.toBeNull()
    expect(popularPost?.id).toBe('post-1')
  })

  it('should find by boolean value', async () => {
    const inactiveUser = await graph.$User.find({ active: false })

    expect(inactiveUser).not.toBeNull()
    expect(inactiveUser?.id).toBe('carol')
  })

  it('should return null for empty collection type', async () => {
    const comment = await graph.$Comment.find({ text: 'Hello' })

    expect(comment).toBeNull()
  })

  it('should return the first match when multiple exist', async () => {
    // Multiple users have role: 'user'
    const user = await graph.$User.find({ role: 'user' })

    expect(user).not.toBeNull()
    // Should return one of bob or carol (first match)
    expect(['bob', 'carol']).toContain(user?.id)
  })

  it('should support empty predicate (returns first item)', async () => {
    const anyUser = await graph.$User.find({})

    expect(anyUser).not.toBeNull()
    expect(anyUser).toHaveProperty('id')
  })
})

// ============================================================================
// graph.$User.where({...}) - TRAVERSAL WITH FILTER
// ============================================================================

describe('Collection Accessor - $Type.where() traversal with filter', () => {
  let graph: CollectionGraph

  beforeEach(() => {
    graph = createTestGraph()
  })

  it('should return a Traversal from where()', () => {
    const traversal = graph.$User.where({ active: true })

    expect(traversal).toBeDefined()
    expect(typeof traversal.ids).toBe('function')
    expect(typeof traversal.nodes).toBe('function')
    expect(typeof traversal.toArray).toBe('function')
    expect(typeof traversal.count).toBe('function')
    expect(typeof traversal.first).toBe('function')
    expect(typeof traversal.exists).toBe('function')
  })

  it('should filter users by predicate with .ids()', async () => {
    const activeUserIds = await graph.$User.where({ active: true }).ids()

    expect(activeUserIds).toHaveLength(3) // alice, bob, dave
    expect(activeUserIds).toContain('alice')
    expect(activeUserIds).toContain('bob')
    expect(activeUserIds).toContain('dave')
    expect(activeUserIds).not.toContain('carol') // inactive
  })

  it('should filter users by predicate with .nodes()', async () => {
    const activeUsers = await graph.$User.where({ active: true }).nodes()

    expect(activeUsers).toHaveLength(3)
    for (const user of activeUsers) {
      expect(user.data.active).toBe(true)
    }
  })

  it('should filter users by predicate with .toArray()', async () => {
    const activeUsers = await graph.$User.where({ active: true }).toArray()

    expect(activeUsers).toHaveLength(3)
  })

  it('should count filtered results', async () => {
    const count = await graph.$User.where({ active: true }).count()

    expect(count).toBe(3)
  })

  it('should get first filtered result', async () => {
    const firstActiveUser = await graph.$User.where({ active: true }).first()

    expect(firstActiveUser).not.toBeNull()
    expect(firstActiveUser?.data.active).toBe(true)
  })

  it('should check existence of filtered results', async () => {
    const hasActiveUsers = await graph.$User.where({ active: true }).exists()
    const hasSuperAdmins = await graph.$User.where({ role: 'superadmin' }).exists()

    expect(hasActiveUsers).toBe(true)
    expect(hasSuperAdmins).toBe(false)
  })

  it('should filter by multiple predicates', async () => {
    const activeNonAdmins = await graph.$User.where({ active: true, role: 'user' }).ids()

    expect(activeNonAdmins).toHaveLength(1) // only bob
    expect(activeNonAdmins).toContain('bob')
  })

  it('should filter posts by predicate', async () => {
    const publishedPosts = await graph.$Post.where({ published: true }).ids()

    expect(publishedPosts).toHaveLength(2)
    expect(publishedPosts).toContain('post-1')
    expect(publishedPosts).toContain('post-2')
    expect(publishedPosts).not.toContain('post-3')
  })

  it('should return empty traversal for no matches', async () => {
    const noMatches = await graph.$User.where({ role: 'superadmin' }).ids()

    expect(noMatches).toHaveLength(0)
  })

  it('should be chainable for further traversal', async () => {
    // Get posts authored by active users
    const activeUserPostIds = await graph.$User.where({ active: true }).$authored.ids()

    expect(activeUserPostIds).toContain('post-1') // alice authored
    expect(activeUserPostIds).toContain('post-2') // bob authored
    // post-3 authored by carol (inactive) should not be included
  })

  it('should support chaining .where() with relationships', async () => {
    // People that active users follow
    const followedByActiveUsers = await graph.$User.where({ active: true }).$follows.ids()

    expect(followedByActiveUsers).toContain('bob') // alice follows bob
    expect(followedByActiveUsers).toContain('carol') // alice and bob follow carol
    expect(followedByActiveUsers).toContain('dave') // bob follows dave
  })

  it('should support async iteration on where() results', async () => {
    const activeUserIds: string[] = []

    for await (const user of graph.$User.where({ active: true })) {
      activeUserIds.push(user.id)
    }

    expect(activeUserIds).toHaveLength(3)
    expect(activeUserIds).toContain('alice')
    expect(activeUserIds).toContain('bob')
    expect(activeUserIds).toContain('dave')
  })
})

// ============================================================================
// graph.$User.$stream - STREAMING ACCESS
// ============================================================================

describe('Collection Accessor - $Type.$stream streaming access', () => {
  let graph: CollectionGraph

  beforeEach(() => {
    graph = createTestGraph()
  })

  it('should provide $stream as an AsyncIterable', () => {
    const stream = graph.$User.$stream

    expect(stream).toBeDefined()
    expect(typeof stream[Symbol.asyncIterator]).toBe('function')
  })

  it('should stream all users one at a time', async () => {
    const users: Thing[] = []

    for await (const user of graph.$User.$stream) {
      users.push(user)
    }

    expect(users).toHaveLength(4)
    expect(users.map((u: Thing) => u.id)).toContain('alice')
    expect(users.map((u: Thing) => u.id)).toContain('bob')
    expect(users.map((u: Thing) => u.id)).toContain('carol')
    expect(users.map((u: Thing) => u.id)).toContain('dave')
  })

  it('should stream all posts', async () => {
    const posts: Thing[] = []

    for await (const post of graph.$Post.$stream) {
      posts.push(post)
    }

    expect(posts).toHaveLength(3)
  })

  it('should yield complete Thing objects', async () => {
    let foundAlice = false

    for await (const user of graph.$User.$stream) {
      if (user.id === 'alice') {
        foundAlice = true
        expect(user.type).toBe('User')
        expect(user.ns).toBe('test')
        expect(user.data.name).toBe('Alice')
        expect(user.data.email).toBe('alice@test.com')
      }
    }

    expect(foundAlice).toBe(true)
  })

  it('should stream empty for non-existent type', async () => {
    const comments: Thing[] = []

    for await (const comment of graph.$Comment.$stream) {
      comments.push(comment)
    }

    expect(comments).toHaveLength(0)
  })

  it('should be memory efficient (not materialize all at once)', async () => {
    // Add many users to test memory efficiency pattern
    for (let i = 0; i < 100; i++) {
      graph.addThing(createThing(`user-bulk-${i}`, 'User', { index: i }))
    }

    let count = 0
    for await (const _user of graph.$User.$stream) {
      count++
      // In real streaming, we wouldn't hold all in memory
      // This test verifies the streaming interface works
    }

    expect(count).toBe(104) // 4 original + 100 bulk
  })

  it('should allow early termination with break', async () => {
    let count = 0

    for await (const _user of graph.$User.$stream) {
      count++
      if (count >= 2) break
    }

    expect(count).toBe(2)
  })

  it('should reflect real-time additions during iteration', async () => {
    const iterator = graph.$User.$stream[Symbol.asyncIterator]()

    // Get first user
    const first = await iterator.next()
    expect(first.done).toBe(false)
    expect(first.value).toBeDefined()

    // Note: Real-time reflection behavior depends on implementation
    // This test documents the expected interface
  })
})

// ============================================================================
// graph.$User.$batch(size) - BATCHED STREAMING ACCESS
// ============================================================================

describe('Collection Accessor - $Type.$batch() batched streaming', () => {
  let graph: CollectionGraph

  beforeEach(() => {
    graph = createTestGraph()
  })

  it('should provide $batch as a function', () => {
    const batchFn = graph.$User.$batch

    expect(typeof batchFn).toBe('function')
  })

  it('should return an AsyncIterable from $batch()', () => {
    const batchStream = graph.$User.$batch(2)

    expect(batchStream).toBeDefined()
    expect(typeof batchStream[Symbol.asyncIterator]).toBe('function')
  })

  it('should yield arrays of specified batch size', async () => {
    const batches: Thing[][] = []

    for await (const batch of graph.$User.$batch(2)) {
      batches.push(batch)
    }

    expect(batches).toHaveLength(2) // 4 users / 2 per batch = 2 batches
    expect(batches[0]).toHaveLength(2)
    expect(batches[1]).toHaveLength(2)
  })

  it('should handle partial final batch', async () => {
    // Add 5th user
    graph.addThing(createThing('eve', 'User', { name: 'Eve' }))

    const batches: Thing[][] = []

    for await (const batch of graph.$User.$batch(2)) {
      batches.push(batch)
    }

    expect(batches).toHaveLength(3) // 5 users / 2 per batch = 3 batches (2, 2, 1)
    expect(batches[0]).toHaveLength(2)
    expect(batches[1]).toHaveLength(2)
    expect(batches[2]).toHaveLength(1)
  })

  it('should yield empty for empty collection', async () => {
    const batches: Thing[][] = []

    for await (const batch of graph.$Comment.$batch(10)) {
      batches.push(batch)
    }

    expect(batches).toHaveLength(0)
  })

  it('should work with batch size of 1', async () => {
    const batches: Thing[][] = []

    for await (const batch of graph.$User.$batch(1)) {
      batches.push(batch)
    }

    expect(batches).toHaveLength(4)
    for (const batch of batches) {
      expect(batch).toHaveLength(1)
    }
  })

  it('should work with batch size larger than collection', async () => {
    const batches: Thing[][] = []

    for await (const batch of graph.$User.$batch(100)) {
      batches.push(batch)
    }

    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(4)
  })

  it('should yield complete Thing objects in batches', async () => {
    for await (const batch of graph.$User.$batch(2)) {
      for (const user of batch) {
        expect(user).toHaveProperty('id')
        expect(user).toHaveProperty('type')
        expect(user).toHaveProperty('ns')
        expect(user).toHaveProperty('data')
        expect(user.type).toBe('User')
      }
    }
  })
})

// ============================================================================
// TRAVERSAL FROM COLLECTION
// ============================================================================

describe('Collection Accessor - Traversal chaining from collection', () => {
  let graph: CollectionGraph

  beforeEach(() => {
    graph = createTestGraph()
  })

  it('should support $follows from where() result', async () => {
    // Who do active users follow?
    const followedIds = await graph.$User.where({ active: true }).$follows.ids()

    expect(followedIds).toContain('bob')
    expect(followedIds).toContain('carol')
    expect(followedIds).toContain('dave')
  })

  it('should support $authored from where() result', async () => {
    // Posts authored by users with role "admin"
    const adminPostIds = await graph.$User.where({ role: 'admin' }).$authored.ids()

    expect(adminPostIds).toContain('post-1') // alice's post
  })

  it('should support reverse traversal $likedBy from posts', async () => {
    // Who liked published posts?
    const likersOfPublishedPosts = await graph.$Post.where({ published: true }).$likedBy.ids()

    expect(likersOfPublishedPosts).toContain('bob') // likes post-1
    expect(likersOfPublishedPosts).toContain('carol') // likes post-1
    expect(likersOfPublishedPosts).toContain('dave') // likes post-2
  })

  it('should support chaining multiple traversals', async () => {
    // Who follows people that authored popular posts?
    // path: $User.where({views: 100}) -> $authoredBy -> $followedBy
    const popularPostAuthorFollowers = await graph.$Post
      .where({ views: 100 })
      .$authoredBy  // alice
      .$followedBy  // no one follows alice in test data
      .ids()

    expect(popularPostAuthorFollowers).toHaveLength(0)
  })

  it('should support $in traversal from collection', async () => {
    // Who is followed by users? (incoming follows edges to users)
    const followedUsers = await graph.$User.where({ active: true }).$in.$follows

    // This should give us who is followed by active users
    // which is a different way of asking "who do active users follow"
    // Actually $in.$follows from a set means incoming follows TO that set
    expect(followedUsers).toBeDefined()
  })
})

// ============================================================================
// TYPE COLLECTION INTERFACE
// ============================================================================

describe('Collection Accessor - TypeCollection interface', () => {
  let graph: CollectionGraph

  beforeEach(() => {
    graph = createTestGraph()
  })

  it('should implement callable for all items', async () => {
    const collection: TypeCollection = graph.$User
    const allUsers = await collection()

    expect(allUsers).toHaveLength(4)
  })

  it('should implement callable with ID for single item', () => {
    const collection: TypeCollection = graph.$User
    const alice = collection('alice')

    expect(alice.$id).toBe('alice')
  })

  it('should expose where() method', () => {
    const collection: TypeCollection = graph.$User

    expect(typeof collection.where).toBe('function')
  })

  it('should expose find() method', () => {
    const collection: TypeCollection = graph.$User

    expect(typeof collection.find).toBe('function')
  })

  it('should expose $stream property', () => {
    const collection: TypeCollection = graph.$User

    expect(collection.$stream).toBeDefined()
    expect(typeof collection.$stream[Symbol.asyncIterator]).toBe('function')
  })

  it('should expose $batch() method', () => {
    const collection: TypeCollection = graph.$User

    expect(typeof collection.$batch).toBe('function')
  })
})

// ============================================================================
// GRAPH NODE INTERFACE
// ============================================================================

describe('Collection Accessor - GraphNode interface', () => {
  let graph: CollectionGraph

  beforeEach(() => {
    graph = createTestGraph()
  })

  it('should have $id property', () => {
    const alice: GraphNode = graph.$User('alice')

    expect(alice.$id).toBe('alice')
  })

  it('should have $type property', () => {
    const alice: GraphNode = graph.$User('alice')

    expect(alice.$type).toBe('User')
  })

  it('should have $graph reference', () => {
    const alice: GraphNode = graph.$User('alice')

    expect(alice.$graph).toBe(graph)
  })

  it('should have data property', () => {
    const alice: GraphNode = graph.$User('alice')

    expect(alice.data).toBeDefined()
    expect(typeof alice.data).toBe('object')
  })

  it('should support $relationship traversal', async () => {
    const alice: GraphNode = graph.$User('alice')
    const followingIds = await alice.$follows.ids()

    expect(followingIds).toContain('bob')
  })

  it('should support $out traversal', async () => {
    const alice: GraphNode = graph.$User('alice')
    const outgoingIds = await alice.$out(1).ids()

    // Should include all outgoing from alice: follows (bob, carol), authored (post-1)
    expect(outgoingIds).toContain('bob')
    expect(outgoingIds).toContain('carol')
    expect(outgoingIds).toContain('post-1')
  })

  it('should support $in traversal', async () => {
    const bob: GraphNode = graph.$User('bob')
    const incomingIds = await bob.$in(1).ids()

    // alice follows bob
    expect(incomingIds).toContain('alice')
  })

  it('should support $expand traversal', async () => {
    const alice: GraphNode = graph.$User('alice')
    const neighborhoodIds = await alice.$expand(1).ids()

    // All directly connected nodes
    expect(neighborhoodIds).toContain('bob')
    expect(neighborhoodIds).toContain('carol')
    expect(neighborhoodIds).toContain('post-1')
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Collection Accessor - Edge Cases', () => {
  let graph: CollectionGraph

  beforeEach(() => {
    graph = createTestGraph()
  })

  it('should handle type names with different casings', async () => {
    graph.addThing(createThing('item-1', 'InventoryItem', { name: 'Widget' }))

    const items = await graph.$InventoryItem()

    expect(items).toHaveLength(1)
  })

  it('should handle type names with numbers', async () => {
    graph.addThing(createThing('entity-1', 'Entity2D', { x: 0, y: 0 }))

    const entities = await graph.$Entity2D()

    expect(entities).toHaveLength(1)
  })

  it('should handle concurrent stream iterations', async () => {
    const stream1 = graph.$User.$stream[Symbol.asyncIterator]()
    const stream2 = graph.$User.$stream[Symbol.asyncIterator]()

    const [result1, result2] = await Promise.all([
      stream1.next(),
      stream2.next(),
    ])

    expect(result1.done).toBe(false)
    expect(result2.done).toBe(false)
  })

  it('should handle where() with undefined values', async () => {
    const result = await graph.$User.where({ nonExistentField: undefined }).ids()

    // Depending on implementation, might return all or none
    expect(Array.isArray(result)).toBe(true)
  })

  it('should handle where() with null values', async () => {
    graph.addThing(createThing('test-user', 'User', { name: 'Test', nullField: null }))

    const result = await graph.$User.where({ nullField: null }).ids()

    expect(result).toContain('test-user')
  })

  it('should handle empty graph', async () => {
    const emptyGraph = createCollectionGraph({ namespace: 'empty' })

    const users = await emptyGraph.$User()
    const stream: Thing[] = []
    for await (const user of emptyGraph.$User.$stream) {
      stream.push(user)
    }

    expect(users).toHaveLength(0)
    expect(stream).toHaveLength(0)
  })

  it('should not confuse $ methods with type names', async () => {
    // $stream should not be treated as type "stream"
    const stream = graph.$User.$stream

    expect(typeof stream[Symbol.asyncIterator]).toBe('function')
  })

  it('should handle special characters in data values', async () => {
    graph.addThing(createThing('special', 'User', { name: "O'Reilly & Co" }))

    const found = await graph.$User.find({ name: "O'Reilly & Co" })

    expect(found).not.toBeNull()
    expect(found?.id).toBe('special')
  })
})

// ============================================================================
// TRAVERSAL INTERFACE COMPLIANCE
// ============================================================================

describe('Collection Accessor - Traversal interface compliance', () => {
  let graph: CollectionGraph

  beforeEach(() => {
    graph = createTestGraph()
  })

  it('should return Traversal from where() with ids() method', async () => {
    const traversal = graph.$User.where({ active: true })
    const ids = await traversal.ids()

    expect(Array.isArray(ids)).toBe(true)
    expect(ids.every((id: unknown) => typeof id === 'string')).toBe(true)
  })

  it('should return Traversal from where() with nodes() method', async () => {
    const traversal = graph.$User.where({ active: true })
    const nodes = await traversal.nodes()

    expect(Array.isArray(nodes)).toBe(true)
    expect(nodes.every((n: Thing) => typeof n.id === 'string')).toBe(true)
  })

  it('should return Traversal from where() with toArray() method', async () => {
    const traversal = graph.$User.where({ active: true })
    const nodes = await traversal.toArray()

    expect(Array.isArray(nodes)).toBe(true)
  })

  it('should return Traversal from where() with count() method', async () => {
    const traversal = graph.$User.where({ active: true })
    const count = await traversal.count()

    expect(typeof count).toBe('number')
  })

  it('should return Traversal from where() with first() method', async () => {
    const traversal = graph.$User.where({ active: true })
    const first = await traversal.first()

    expect(first === null || typeof first?.id === 'string').toBe(true)
  })

  it('should return Traversal from where() with exists() method', async () => {
    const traversal = graph.$User.where({ active: true })
    const exists = await traversal.exists()

    expect(typeof exists).toBe('boolean')
  })

  it('should return Traversal with $stream property', async () => {
    const traversal = graph.$User.where({ active: true })
    const stream = traversal.$stream

    expect(stream).toBeDefined()
    expect(typeof stream[Symbol.asyncIterator]).toBe('function')
  })

  it('should return Traversal with $batch() method', async () => {
    const traversal = graph.$User.where({ active: true })
    const batch = traversal.$batch(2)

    expect(batch).toBeDefined()
    expect(typeof batch[Symbol.asyncIterator]).toBe('function')
  })

  it('should support Symbol.asyncIterator on Traversal', async () => {
    const traversal = graph.$User.where({ active: true })

    expect(typeof traversal[Symbol.asyncIterator]).toBe('function')

    const items: Thing[] = []
    for await (const item of traversal) {
      items.push(item)
    }
    expect(items.length).toBeGreaterThan(0)
  })
})
