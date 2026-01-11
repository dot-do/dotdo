/**
 * [SDK-10] RED: Type-Safe Schema
 *
 * Failing tests for generic schema definitions and compile-time type checking.
 * These tests define the expected API for type-safe graph traversals.
 *
 * Key Features Under Test:
 * - Schema definition via interface extending GraphSchema
 * - Typed client creation with createTypedGraph<S>()
 * - Node type accessors (db.User, db.Post, etc.)
 * - Typed traversals (user.$.follows returns User[])
 * - Chained type inference (user.$.follows.$.likes infers Post type)
 * - Type narrowing (results are typed, not unknown)
 * - Compile-time validation (@ts-expect-error for invalid operations)
 * - Runtime behavior matching declared types
 *
 * @see /db/compat/sql/clickhouse/spikes/graph-sdk-typed.ts for spike implementation
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Equals, Expect } from './type-utils'

// Production module imports (these don't exist yet - that's the RED phase)
import {
  createTypedGraph,
  type GraphSchema,
  type TypedGraphClient,
  type NodeTypeAccessor,
  type TypedGraphNode,
  type TypedTraversalResult,
  type GraphNode,
  type ChainableTraversal,
} from '../src/typed-schema'

// ============================================================================
// SCHEMA DEFINITIONS - Used across all tests
// ============================================================================

/**
 * Social graph schema for testing.
 * Defines User, Post, and Comment node types with their relationships.
 */
interface SocialGraph extends GraphSchema {
  User: {
    follows: 'User'      // User -[follows]-> User
    likes: 'Post'        // User -[likes]-> Post
    authored: 'Post'     // User -[authored]-> Post
    commented: 'Comment' // User -[commented]-> Comment
  }
  Post: {
    author: 'User'       // Post -[author]-> User
    comments: 'Comment'  // Post -[comments]-> Comment
    likedBy: 'User'      // Post -[likedBy]-> User
  }
  Comment: {
    author: 'User'       // Comment -[author]-> User
    parent: 'Post'       // Comment -[parent]-> Post
    replies: 'Comment'   // Comment -[replies]-> Comment
  }
}

/**
 * E-commerce graph schema for testing polymorphic scenarios
 */
interface EcommerceGraph extends GraphSchema {
  Customer: {
    purchased: 'Order'
    viewed: 'Product'
    reviewed: 'Product'
  }
  Product: {
    category: 'Category'
    reviews: 'Review'
    relatedTo: 'Product'
  }
  Order: {
    customer: 'Customer'
    items: 'Product'
  }
  Category: {
    parent: 'Category'
    products: 'Product'
  }
  Review: {
    author: 'Customer'
    product: 'Product'
  }
}

/**
 * Minimal schema for edge case testing
 */
interface MinimalGraph extends GraphSchema {
  Node: {
    self: 'Node' // Self-referential relationship
  }
}

// ============================================================================
// 1. SCHEMA DEFINITION TESTS
// ============================================================================

describe('Schema definition', () => {
  it('should allow interface extending GraphSchema', () => {
    // The interface definition itself should be valid TypeScript
    // If this compiles, the test passes
    const _schemaCheck: GraphSchema = {} as SocialGraph
    expect(_schemaCheck).toBeDefined()
  })

  it('should support multiple node types', () => {
    // Schema should allow any number of node types
    type NodeTypes = keyof SocialGraph
    // Type-level assertion: NodeTypes should be 'User' | 'Post' | 'Comment'
    type _Check = Expect<Equals<NodeTypes, 'User' | 'Post' | 'Comment'>>

    expect(true).toBe(true) // Type-level test
  })

  it('should support self-referential relationships', () => {
    // MinimalGraph has Node -> Node relationship
    type NodeRels = MinimalGraph['Node']
    type _Check = Expect<Equals<NodeRels, { self: 'Node' }>>

    expect(true).toBe(true) // Type-level test
  })

  it('should support complex relationship structures', () => {
    // EcommerceGraph has multiple interconnected types
    type CustomerRels = keyof EcommerceGraph['Customer']
    type _Check = Expect<Equals<CustomerRels, 'purchased' | 'viewed' | 'reviewed'>>

    expect(true).toBe(true) // Type-level test
  })
})

// ============================================================================
// 2. TYPED CLIENT CREATION TESTS
// ============================================================================

describe('Typed client creation', () => {
  it('should create typed graph client with namespace', () => {
    const db = createTypedGraph<SocialGraph>({ namespace: 'social' })
    expect(db).toBeDefined()
    expect(db.namespace).toBe('social')
  })

  it('should create typed graph client with connection options', () => {
    const db = createTypedGraph<SocialGraph>({
      namespace: 'social',
      connection: {
        host: 'localhost',
        port: 9000,
      },
    })
    expect(db).toBeDefined()
  })

  it('should return TypedGraphClient with correct type parameter', () => {
    const db = createTypedGraph<SocialGraph>({ namespace: 'social' })

    // Type-level check: db should be TypedGraphClient<SocialGraph>
    type DbType = typeof db
    type _Check = Expect<DbType extends TypedGraphClient<SocialGraph> ? true : false>

    expect(db).toBeDefined()
  })

  it('should infer different types for different schemas', () => {
    const socialDb = createTypedGraph<SocialGraph>({ namespace: 'social' })
    const ecommerceDb = createTypedGraph<EcommerceGraph>({ namespace: 'shop' })

    // These should be different types
    type SocialDbType = typeof socialDb
    type EcommerceDbType = typeof ecommerceDb

    // Type-level check: the types should not be identical
    // This is verified by the fact that they have different accessors
    expect(socialDb.namespace).toBe('social')
    expect(ecommerceDb.namespace).toBe('shop')
  })
})

// ============================================================================
// 3. NODE TYPE ACCESSORS TESTS
// ============================================================================

describe('Node type accessors', () => {
  let db: TypedGraphClient<SocialGraph>

  beforeEach(() => {
    db = createTypedGraph<SocialGraph>({ namespace: 'social' })
  })

  it('should have User accessor on typed client', () => {
    expect(db.User).toBeDefined()
    expect(typeof db.User.get).toBe('function')
    expect(typeof db.User.find).toBe('function')
    expect(typeof db.User.findOne).toBe('function')
    expect(typeof db.User.create).toBe('function')
    expect(typeof db.User.from).toBe('function')
  })

  it('should have Post accessor on typed client', () => {
    expect(db.Post).toBeDefined()
    expect(typeof db.Post.get).toBe('function')
  })

  it('should have Comment accessor on typed client', () => {
    expect(db.Comment).toBeDefined()
    expect(typeof db.Comment.get).toBe('function')
  })

  it('should return NodeTypeAccessor with correct type', () => {
    const userAccessor = db.User

    // Type-level check
    type AccessorType = typeof userAccessor
    type _Check = Expect<AccessorType extends NodeTypeAccessor<SocialGraph, 'User'> ? true : false>

    expect(userAccessor).toBeDefined()
  })

  it('should get node by ID', () => {
    const user = db.User.get('user-123')

    expect(user).toBeDefined()
    expect(user.id).toBe('user-123')
    expect(user.type).toBe('User')
  })

  it('should return TypedGraphNode from get()', () => {
    const user = db.User.get('user-123')

    // Type-level check: user should be TypedGraphNode<SocialGraph, 'User'>
    type UserNodeType = typeof user
    type _Check = Expect<UserNodeType extends TypedGraphNode<SocialGraph, 'User'> ? true : false>

    expect(user.id).toBe('user-123')
  })

  it('should find nodes matching criteria', async () => {
    const users = await db.User.find({ verified: true })

    expect(Array.isArray(users)).toBe(true)
  })

  it('should find one node matching criteria', async () => {
    const user = await db.User.findOne({ email: 'alice@example.com' })

    // Result can be null
    expect(user === null || typeof user === 'object').toBe(true)
  })

  it('should create a new node', async () => {
    const newUser = await db.User.create({
      data: { name: 'Alice', email: 'alice@example.com' },
    })

    expect(newUser).toBeDefined()
    expect(newUser.id).toBeDefined()
    expect(newUser.type).toBe('User')
  })

  it('should start traversal from multiple nodes', () => {
    const traversal = db.User.from('user-1', 'user-2', 'user-3')

    expect(traversal).toBeDefined()
    expect(typeof traversal.ids).toBe('function')
    expect(typeof traversal.nodes).toBe('function')
  })

  // Compile-time validation
  it('should error on invalid node type accessor', () => {
    // @ts-expect-error - InvalidNode does not exist in SocialGraph
    const _invalid = db.InvalidNode

    // @ts-expect-error - Customer is not in SocialGraph (it's in EcommerceGraph)
    const _customer = db.Customer

    expect(true).toBe(true) // Test passes if TypeScript errors on above lines
  })
})

// ============================================================================
// 4. TYPED TRAVERSALS TESTS
// ============================================================================

describe('Typed traversals', () => {
  let db: TypedGraphClient<SocialGraph>
  let user: TypedGraphNode<SocialGraph, 'User'>
  let post: TypedGraphNode<SocialGraph, 'Post'>

  beforeEach(() => {
    db = createTypedGraph<SocialGraph>({ namespace: 'social' })
    user = db.User.get('user-123')
    post = db.Post.get('post-456')
  })

  it('should have $ property for traversals', () => {
    expect(user.$).toBeDefined()
    expect(post.$).toBeDefined()
  })

  it('should traverse follows relationship from User', () => {
    const followsTraversal = user.$.follows

    expect(followsTraversal).toBeDefined()
    expect(typeof followsTraversal.ids).toBe('function')
    expect(typeof followsTraversal.nodes).toBe('function')
    expect(typeof followsTraversal.toArray).toBe('function')
    expect(typeof followsTraversal.count).toBe('function')
    expect(typeof followsTraversal.exists).toBe('function')
    expect(typeof followsTraversal.first).toBe('function')
  })

  it('should traverse likes relationship from User', () => {
    const likesTraversal = user.$.likes

    expect(likesTraversal).toBeDefined()
  })

  it('should traverse author relationship from Post', () => {
    const authorTraversal = post.$.author

    expect(authorTraversal).toBeDefined()
  })

  it('should return traversal result with correct target type for follows', async () => {
    const friends = await user.$.follows.toArray()

    // Type-level check: friends should be an array of User nodes
    type FriendsType = typeof friends
    type _Check = Expect<FriendsType extends GraphNode<SocialGraph, 'User'>[] ? true : false>

    expect(Array.isArray(friends)).toBe(true)
  })

  it('should return traversal result with correct target type for likes', async () => {
    const likedPosts = await user.$.likes.toArray()

    // Type-level check: likedPosts should be an array of Post nodes
    type LikedPostsType = typeof likedPosts
    type _Check = Expect<LikedPostsType extends GraphNode<SocialGraph, 'Post'>[] ? true : false>

    expect(Array.isArray(likedPosts)).toBe(true)
  })

  it('should return correct type for Post.author traversal', async () => {
    const author = await post.$.author.first()

    // Type-level check: author should be User | null
    type AuthorType = typeof author
    type _Check = Expect<AuthorType extends GraphNode<SocialGraph, 'User'> | null ? true : false>

    expect(author === null || typeof author === 'object').toBe(true)
  })

  it('should support incoming edge traversals', () => {
    const followersTraversal = user.$.in.follows

    expect(followersTraversal).toBeDefined()
  })

  // Compile-time validation for invalid relationships
  it('should error on invalid relationship', () => {
    // @ts-expect-error - 'invalidRel' does not exist on User
    const _invalid = user.$.invalidRel

    // @ts-expect-error - 'follows' does not exist on Post
    const _postFollows = post.$.follows

    // @ts-expect-error - 'comments' does not exist on User (it's 'commented')
    const _userComments = user.$.comments

    expect(true).toBe(true)
  })
})

// ============================================================================
// 5. CHAINED TYPE INFERENCE TESTS
// ============================================================================

describe('Chained type inference', () => {
  let db: TypedGraphClient<SocialGraph>
  let user: TypedGraphNode<SocialGraph, 'User'>

  beforeEach(() => {
    db = createTypedGraph<SocialGraph>({ namespace: 'social' })
    user = db.User.get('user-123')
  })

  it('should infer User type for follows.follows (friends of friends)', async () => {
    const friendsOfFriends = await user.$.follows.$.follows.toArray()

    // Type-level check: should be User[]
    type FoFType = typeof friendsOfFriends
    type _Check = Expect<FoFType extends GraphNode<SocialGraph, 'User'>[] ? true : false>

    expect(Array.isArray(friendsOfFriends)).toBe(true)
  })

  it('should infer Post type for follows.likes', async () => {
    const postsLikedByFriends = await user.$.follows.$.likes.toArray()

    // Type-level check: should be Post[]
    type PostsType = typeof postsLikedByFriends
    type _Check = Expect<PostsType extends GraphNode<SocialGraph, 'Post'>[] ? true : false>

    expect(Array.isArray(postsLikedByFriends)).toBe(true)
  })

  it('should infer Comment type for follows.commented', async () => {
    const commentsFromFriends = await user.$.follows.$.commented.toArray()

    // Type-level check: should be Comment[]
    type CommentsType = typeof commentsFromFriends
    type _Check = Expect<CommentsType extends GraphNode<SocialGraph, 'Comment'>[] ? true : false>

    expect(Array.isArray(commentsFromFriends)).toBe(true)
  })

  it('should infer User type for likes.author', async () => {
    const authorsOfLikedPosts = await user.$.likes.$.author.toArray()

    // Type-level check: should be User[]
    type AuthorsType = typeof authorsOfLikedPosts
    type _Check = Expect<AuthorsType extends GraphNode<SocialGraph, 'User'>[] ? true : false>

    expect(Array.isArray(authorsOfLikedPosts)).toBe(true)
  })

  it('should infer Comment type for likes.comments', async () => {
    const commentsOnLikedPosts = await user.$.likes.$.comments.toArray()

    // Type-level check: should be Comment[]
    type CommentsType = typeof commentsOnLikedPosts
    type _Check = Expect<CommentsType extends GraphNode<SocialGraph, 'Comment'>[] ? true : false>

    expect(Array.isArray(commentsOnLikedPosts)).toBe(true)
  })

  it('should infer User type for deep chain: follows.likes.comments.author', async () => {
    const result = await user.$.follows.$.likes.$.comments.$.author.toArray()

    // Type-level check: should be User[]
    type ResultType = typeof result
    type _Check = Expect<ResultType extends GraphNode<SocialGraph, 'User'>[] ? true : false>

    expect(Array.isArray(result)).toBe(true)
  })

  it('should infer Comment type for self-referential: commented.replies.replies', async () => {
    const comment = db.Comment.get('comment-1')
    const nestedReplies = await comment.$.replies.$.replies.toArray()

    // Type-level check: should be Comment[]
    type RepliesType = typeof nestedReplies
    type _Check = Expect<RepliesType extends GraphNode<SocialGraph, 'Comment'>[] ? true : false>

    expect(Array.isArray(nestedReplies)).toBe(true)
  })

  // Compile-time validation for invalid chained traversals
  it('should error on invalid chained relationship', () => {
    // @ts-expect-error - User.follows returns User, and User has no 'category' relationship
    const _invalid1 = user.$.follows.$.category

    // @ts-expect-error - User.likes returns Post, and Post has no 'follows' relationship
    const _invalid2 = user.$.likes.$.follows

    // @ts-expect-error - User.authored returns Post, and Post has no 'purchased' relationship
    const _invalid3 = user.$.authored.$.purchased

    expect(true).toBe(true)
  })
})

// ============================================================================
// 6. TYPE NARROWING TESTS
// ============================================================================

describe('Type narrowing', () => {
  let db: TypedGraphClient<SocialGraph>
  let user: TypedGraphNode<SocialGraph, 'User'>

  beforeEach(() => {
    db = createTypedGraph<SocialGraph>({ namespace: 'social' })
    user = db.User.get('user-123')
  })

  it('should narrow first() result to node type or null', async () => {
    const firstFriend = await user.$.follows.first()

    // Type-level check: should be User | null, not unknown
    type FirstFriendType = typeof firstFriend
    type _Check = Expect<FirstFriendType extends GraphNode<SocialGraph, 'User'> | null ? true : false>

    if (firstFriend !== null) {
      // TypeScript should allow accessing User properties
      expect(firstFriend.type).toBe('User')
      expect(firstFriend.id).toBeDefined()
    }
  })

  it('should narrow toArray() result to typed array', async () => {
    const friends = await user.$.follows.toArray()

    // Type-level check: should be User[], not unknown[]
    type FriendsType = typeof friends
    type _Check = Expect<FriendsType extends GraphNode<SocialGraph, 'User'>[] ? true : false>

    for (const friend of friends) {
      // TypeScript should allow accessing User properties
      expect(friend.type).toBe('User')
      expect(friend.id).toBeDefined()
    }
  })

  it('should narrow nodes() result to typed array', async () => {
    const posts = await user.$.likes.nodes()

    // Type-level check: should be Post[], not unknown[]
    type PostsType = typeof posts
    type _Check = Expect<PostsType extends GraphNode<SocialGraph, 'Post'>[] ? true : false>

    for (const post of posts) {
      expect(post.type).toBe('Post')
    }
  })

  it('should allow type-safe property access on result nodes', async () => {
    const friends = await user.$.follows.toArray()

    for (const friend of friends) {
      // These should all be valid because friend is typed as User node
      const id: string = friend.id
      const type: 'User' = friend.type
      const data = friend.data

      expect(id).toBeDefined()
      expect(type).toBe('User')
    }
  })

  it('should preserve type through where() filter', async () => {
    const verifiedFriends = await user.$.follows
      .where({ verified: true })
      .toArray()

    // Type should still be User[]
    type VerifiedType = typeof verifiedFriends
    type _Check = Expect<VerifiedType extends GraphNode<SocialGraph, 'User'>[] ? true : false>

    expect(Array.isArray(verifiedFriends)).toBe(true)
  })

  it('should preserve type through limit()', async () => {
    const topFriends = await user.$.follows.limit(10).toArray()

    // Type should still be User[]
    type TopFriendsType = typeof topFriends
    type _Check = Expect<TopFriendsType extends GraphNode<SocialGraph, 'User'>[] ? true : false>

    expect(Array.isArray(topFriends)).toBe(true)
  })

  it('should preserve type through skip()', async () => {
    const skippedFriends = await user.$.follows.skip(5).toArray()

    // Type should still be User[]
    type SkippedType = typeof skippedFriends
    type _Check = Expect<SkippedType extends GraphNode<SocialGraph, 'User'>[] ? true : false>

    expect(Array.isArray(skippedFriends)).toBe(true)
  })

  it('should preserve type through chained modifiers', async () => {
    const paginatedFriends = await user.$.follows
      .where({ active: true })
      .skip(10)
      .limit(5)
      .toArray()

    // Type should still be User[]
    type PaginatedType = typeof paginatedFriends
    type _Check = Expect<PaginatedType extends GraphNode<SocialGraph, 'User'>[] ? true : false>

    expect(Array.isArray(paginatedFriends)).toBe(true)
  })
})

// ============================================================================
// 7. COMPILE-TIME VALIDATION TESTS
// ============================================================================

describe('Compile-time validation', () => {
  let db: TypedGraphClient<SocialGraph>
  let user: TypedGraphNode<SocialGraph, 'User'>
  let post: TypedGraphNode<SocialGraph, 'Post'>

  beforeEach(() => {
    db = createTypedGraph<SocialGraph>({ namespace: 'social' })
    user = db.User.get('user-123')
    post = db.Post.get('post-456')
  })

  describe('Invalid relationship access', () => {
    it('should error when accessing non-existent relationship on User', () => {
      // @ts-expect-error - 'reviews' does not exist on User
      const _reviews = user.$.reviews

      // @ts-expect-error - 'category' does not exist on User
      const _category = user.$.category

      // @ts-expect-error - 'items' does not exist on User
      const _items = user.$.items

      expect(true).toBe(true)
    })

    it('should error when accessing non-existent relationship on Post', () => {
      // @ts-expect-error - 'follows' does not exist on Post
      const _follows = post.$.follows

      // @ts-expect-error - 'likes' does not exist on Post (it's 'likedBy')
      const _likes = post.$.likes

      // @ts-expect-error - 'purchased' does not exist on Post
      const _purchased = post.$.purchased

      expect(true).toBe(true)
    })
  })

  describe('Invalid node type access', () => {
    it('should error when accessing non-existent node type', () => {
      // @ts-expect-error - 'InvalidNode' does not exist in SocialGraph
      const _invalid = db.InvalidNode

      // @ts-expect-error - 'Product' does not exist in SocialGraph
      const _product = db.Product

      // @ts-expect-error - 'Customer' does not exist in SocialGraph
      const _customer = db.Customer

      // @ts-expect-error - 'Order' does not exist in SocialGraph
      const _order = db.Order

      expect(true).toBe(true)
    })
  })

  describe('Type mismatch in set operations', () => {
    it('should error when intersecting incompatible types', () => {
      const user2 = db.User.get('user-456')

      // Valid: User intersect User
      const _valid = user.$.follows.intersect(user2.$.follows)

      // @ts-expect-error - Cannot intersect User (follows) with Post (likes)
      const _invalid = user.$.follows.intersect(user.$.likes)

      expect(true).toBe(true)
    })

    it('should error when unioning incompatible types', () => {
      const user2 = db.User.get('user-456')

      // Valid: User union User
      const _valid = user.$.follows.union(user2.$.follows)

      // @ts-expect-error - Cannot union User with Post
      const _invalid = user.$.follows.union(user.$.likes)

      expect(true).toBe(true)
    })

    it('should error when excepting incompatible types', () => {
      // Valid: User except User
      const _valid = user.$.follows.$.follows.except(user.$.follows)

      // @ts-expect-error - Cannot except User with Comment
      const _invalid = user.$.follows.except(user.$.commented)

      expect(true).toBe(true)
    })
  })

  describe('Invalid chained traversals', () => {
    it('should error on multi-hop invalid chain', () => {
      // @ts-expect-error - User -> Post -> (no 'follows' on Post)
      const _invalid1 = user.$.likes.$.follows.toArray()

      // @ts-expect-error - User -> User -> (no 'category' on User)
      const _invalid2 = user.$.follows.$.category.toArray()

      // @ts-expect-error - User -> Post -> Comment -> (no 'likes' on Comment)
      const _invalid3 = user.$.likes.$.comments.$.likes.toArray()

      expect(true).toBe(true)
    })
  })
})

// ============================================================================
// 8. RUNTIME BEHAVIOR TESTS
// ============================================================================

describe('Runtime behavior matches types', () => {
  let db: TypedGraphClient<SocialGraph>

  beforeEach(() => {
    db = createTypedGraph<SocialGraph>({ namespace: 'social' })
  })

  describe('Node accessor behavior', () => {
    it('should return node with correct type property', () => {
      const user = db.User.get('user-123')
      expect(user.type).toBe('User')

      const post = db.Post.get('post-456')
      expect(post.type).toBe('Post')

      const comment = db.Comment.get('comment-789')
      expect(comment.type).toBe('Comment')
    })

    it('should return node with id matching parameter', () => {
      const user = db.User.get('my-user-id')
      expect(user.id).toBe('my-user-id')
    })

    it('should have $ property on returned node', () => {
      const user = db.User.get('user-123')
      expect(user.$).toBeDefined()
      expect(typeof user.$).toBe('object')
    })
  })

  describe('Traversal execution', () => {
    it('should return array from toArray()', async () => {
      const user = db.User.get('user-123')
      const friends = await user.$.follows.toArray()

      expect(Array.isArray(friends)).toBe(true)
    })

    it('should return array from nodes()', async () => {
      const user = db.User.get('user-123')
      const friends = await user.$.follows.nodes()

      expect(Array.isArray(friends)).toBe(true)
    })

    it('should return string array from ids()', async () => {
      const user = db.User.get('user-123')
      const ids = await user.$.follows.ids()

      expect(Array.isArray(ids)).toBe(true)
      // If there are results, they should be strings
      for (const id of ids) {
        expect(typeof id).toBe('string')
      }
    })

    it('should return number from count()', async () => {
      const user = db.User.get('user-123')
      const count = await user.$.follows.count()

      expect(typeof count).toBe('number')
      expect(count).toBeGreaterThanOrEqual(0)
    })

    it('should return boolean from exists()', async () => {
      const user = db.User.get('user-123')
      const exists = await user.$.follows.exists()

      expect(typeof exists).toBe('boolean')
    })

    it('should return node or null from first()', async () => {
      const user = db.User.get('user-123')
      const first = await user.$.follows.first()

      expect(first === null || typeof first === 'object').toBe(true)
    })
  })

  describe('Result node properties', () => {
    it('should have standard GraphNode properties on results', async () => {
      const user = db.User.get('user-123')
      const friends = await user.$.follows.toArray()

      for (const friend of friends) {
        expect(friend.id).toBeDefined()
        expect(typeof friend.id).toBe('string')
        expect(friend.type).toBe('User')
      }
    })

    it('should have $ property on result nodes for chaining', async () => {
      const user = db.User.get('user-123')
      const friend = await user.$.follows.first()

      if (friend !== null) {
        // Result nodes should have $ for further traversal
        expect(friend.$).toBeDefined()
      }
    })
  })

  describe('Modifier behavior', () => {
    it('should return traversal from where()', () => {
      const user = db.User.get('user-123')
      const filtered = user.$.follows.where({ verified: true })

      expect(filtered).toBeDefined()
      expect(typeof filtered.toArray).toBe('function')
    })

    it('should return traversal from limit()', () => {
      const user = db.User.get('user-123')
      const limited = user.$.follows.limit(10)

      expect(limited).toBeDefined()
      expect(typeof limited.toArray).toBe('function')
    })

    it('should return traversal from skip()', () => {
      const user = db.User.get('user-123')
      const skipped = user.$.follows.skip(5)

      expect(skipped).toBeDefined()
      expect(typeof skipped.toArray).toBe('function')
    })

    it('should allow chaining modifiers', () => {
      const user = db.User.get('user-123')
      const chained = user.$.follows
        .where({ active: true })
        .skip(5)
        .limit(10)

      expect(chained).toBeDefined()
      expect(typeof chained.toArray).toBe('function')
    })
  })

  describe('Set operations', () => {
    it('should return traversal from intersect()', () => {
      const user1 = db.User.get('user-1')
      const user2 = db.User.get('user-2')

      const mutual = user1.$.follows.intersect(user2.$.follows)

      expect(mutual).toBeDefined()
      expect(typeof mutual.toArray).toBe('function')
    })

    it('should return traversal from union()', () => {
      const user1 = db.User.get('user-1')
      const user2 = db.User.get('user-2')

      const combined = user1.$.follows.union(user2.$.follows)

      expect(combined).toBeDefined()
      expect(typeof combined.toArray).toBe('function')
    })

    it('should return traversal from except()', () => {
      const user = db.User.get('user-123')

      const suggestions = user.$.follows.$.follows.except(user.$.follows)

      expect(suggestions).toBeDefined()
      expect(typeof suggestions.toArray).toBe('function')
    })
  })
})

// ============================================================================
// 9. ASYNC ITERATION TESTS
// ============================================================================

describe('Async iteration', () => {
  let db: TypedGraphClient<SocialGraph>
  let user: TypedGraphNode<SocialGraph, 'User'>

  beforeEach(() => {
    db = createTypedGraph<SocialGraph>({ namespace: 'social' })
    user = db.User.get('user-123')
  })

  it('should be async iterable', async () => {
    const traversal = user.$.follows

    // Should have Symbol.asyncIterator
    expect(traversal[Symbol.asyncIterator]).toBeDefined()
  })

  it('should yield typed nodes in for-await-of', async () => {
    const nodes: GraphNode<SocialGraph, 'User'>[] = []

    for await (const friend of user.$.follows) {
      // Type should be inferred as User node
      type FriendType = typeof friend
      type _Check = Expect<FriendType extends GraphNode<SocialGraph, 'User'> ? true : false>

      nodes.push(friend)
    }

    expect(Array.isArray(nodes)).toBe(true)
  })
})

// ============================================================================
// 10. PATH FINDING TESTS
// ============================================================================

describe('Path finding', () => {
  let db: TypedGraphClient<SocialGraph>
  let user: TypedGraphNode<SocialGraph, 'User'>

  beforeEach(() => {
    db = createTypedGraph<SocialGraph>({ namespace: 'social' })
    user = db.User.get('user-123')
  })

  it('should have pathTo method on node', () => {
    expect(typeof user.pathTo).toBe('function')
  })

  it('should have connected method on node', () => {
    expect(typeof user.connected).toBe('function')
  })

  it('should return path or null from pathTo', async () => {
    const path = await user.pathTo('user-456')

    expect(path === null || typeof path === 'object').toBe(true)
    if (path !== null) {
      expect(path.vertices).toBeDefined()
      expect(Array.isArray(path.vertices)).toBe(true)
      expect(path.edges).toBeDefined()
      expect(Array.isArray(path.edges)).toBe(true)
    }
  })

  it('should return boolean from connected', async () => {
    const isConnected = await user.connected('user-456')

    expect(typeof isConnected).toBe('boolean')
  })

  it('should accept options for pathTo', async () => {
    const path = await user.pathTo('user-456', {
      maxDepth: 5,
      edgeTypes: ['follows'],
    })

    expect(path === null || typeof path === 'object').toBe(true)
  })
})

// ============================================================================
// 11. ECOMMERCE SCHEMA TESTS
// ============================================================================

describe('EcommerceGraph schema', () => {
  let db: TypedGraphClient<EcommerceGraph>

  beforeEach(() => {
    db = createTypedGraph<EcommerceGraph>({ namespace: 'shop' })
  })

  it('should have all node type accessors', () => {
    expect(db.Customer).toBeDefined()
    expect(db.Product).toBeDefined()
    expect(db.Order).toBeDefined()
    expect(db.Category).toBeDefined()
    expect(db.Review).toBeDefined()
  })

  it('should allow Customer traversals', async () => {
    const customer = db.Customer.get('cust-1')

    // Valid traversals
    const orders = await customer.$.purchased.toArray()
    const viewedProducts = await customer.$.viewed.toArray()
    const reviewedProducts = await customer.$.reviewed.toArray()

    expect(Array.isArray(orders)).toBe(true)
    expect(Array.isArray(viewedProducts)).toBe(true)
    expect(Array.isArray(reviewedProducts)).toBe(true)
  })

  it('should infer correct types for EcommerceGraph chains', async () => {
    const customer = db.Customer.get('cust-1')

    // Customer -> Order -> Product
    const purchasedProducts = await customer.$.purchased.$.items.toArray()

    // Type check
    type ProductsType = typeof purchasedProducts
    type _Check = Expect<ProductsType extends GraphNode<EcommerceGraph, 'Product'>[] ? true : false>

    expect(Array.isArray(purchasedProducts)).toBe(true)
  })

  it('should support category hierarchy traversal', async () => {
    const category = db.Category.get('cat-1')

    // Category -> Category (parent)
    const parent = await category.$.parent.first()

    // Type check
    type ParentType = typeof parent
    type _Check = Expect<ParentType extends GraphNode<EcommerceGraph, 'Category'> | null ? true : false>

    expect(parent === null || typeof parent === 'object').toBe(true)
  })

  // Compile-time validation
  it('should error on EcommerceGraph-invalid relationships', () => {
    const customer = db.Customer.get('cust-1')

    // @ts-expect-error - 'follows' does not exist on Customer
    const _invalid1 = customer.$.follows

    // @ts-expect-error - 'likes' does not exist on Customer
    const _invalid2 = customer.$.likes

    expect(true).toBe(true)
  })
})

// ============================================================================
// 12. MINIMAL SCHEMA TESTS (Edge Cases)
// ============================================================================

describe('MinimalGraph schema (edge cases)', () => {
  let db: TypedGraphClient<MinimalGraph>

  beforeEach(() => {
    db = createTypedGraph<MinimalGraph>({ namespace: 'minimal' })
  })

  it('should handle self-referential schema', () => {
    expect(db.Node).toBeDefined()
  })

  it('should allow self-referential traversal', async () => {
    const node = db.Node.get('node-1')

    // Node -> Node (self)
    const related = await node.$.self.toArray()

    // Type check
    type RelatedType = typeof related
    type _Check = Expect<RelatedType extends GraphNode<MinimalGraph, 'Node'>[] ? true : false>

    expect(Array.isArray(related)).toBe(true)
  })

  it('should allow deep self-referential chain', async () => {
    const node = db.Node.get('node-1')

    // Node -> Node -> Node -> Node
    const deepChain = await node.$.self.$.self.$.self.toArray()

    // Type should still be Node[]
    type DeepType = typeof deepChain
    type _Check = Expect<DeepType extends GraphNode<MinimalGraph, 'Node'>[] ? true : false>

    expect(Array.isArray(deepChain)).toBe(true)
  })
})

