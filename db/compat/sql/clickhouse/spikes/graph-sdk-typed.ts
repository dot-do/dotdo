/**
 * SPIKE: Fully Type-Safe Graph SDK
 *
 * Demonstrates how TypeScript's type system can provide full type inference
 * for graph traversals based on a schema definition.
 *
 * Key Features:
 * - Schema-driven type inference
 * - Type-safe relationship traversals (db.User.$.follows returns User[])
 * - Chained traversals maintain correct types (user.$.follows.likes returns Post[])
 * - Compile-time errors for invalid relationships
 * - IntelliSense support for available relationships
 */

// ============================================================================
// Core Graph Types
// ============================================================================

/**
 * Base interface for graph nodes
 */
export interface GraphNode {
  id: string
  type: string
  data: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

// ============================================================================
// Schema Definition Types
// ============================================================================

/**
 * Base interface for defining graph schemas.
 * Each key is a node type, each value is an object mapping relationship names to target types.
 *
 * @example
 * interface SocialGraph extends GraphSchema {
 *   User: {
 *     follows: 'User'
 *     likes: 'Post'
 *   }
 *   Post: {
 *     author: 'User'
 *     comments: 'Comment'
 *   }
 *   Comment: {
 *     author: 'User'
 *     parent: 'Post'
 *   }
 * }
 */
export interface GraphSchema {
  [nodeType: string]: {
    [relType: string]: string
  }
}

/**
 * Extract all node type names from a schema
 */
type NodeTypes<S extends GraphSchema> = keyof S & string

/**
 * Extract relationship types for a given node type
 */
type RelationshipTypes<S extends GraphSchema, N extends NodeTypes<S>> = keyof S[N] & string

/**
 * Get the target node type for a relationship
 */
type RelationshipTarget<
  S extends GraphSchema,
  N extends NodeTypes<S>,
  R extends RelationshipTypes<S, N>
> = S[N][R] & string

// ============================================================================
// Typed Node Instances
// ============================================================================

/**
 * A typed node instance that carries its schema type information
 */
export interface TypedNode<S extends GraphSchema, N extends NodeTypes<S>> extends GraphNode {
  type: N
}

/**
 * Create a typed node from data
 */
type NodeInstance<S extends GraphSchema, N extends NodeTypes<S>> = TypedNode<S, N>

// ============================================================================
// Typed Traversal Results
// ============================================================================

/**
 * Result of a traversal that resolves to nodes of a specific type
 */
export interface TypedTraversalResult<S extends GraphSchema, N extends NodeTypes<S>> {
  /** Execute and return node IDs */
  ids(): Promise<string[]>

  /** Execute and return typed nodes */
  nodes(): Promise<NodeInstance<S, N>[]>

  /** Alias for nodes() */
  toArray(): Promise<NodeInstance<S, N>[]>

  /** Count results */
  count(): Promise<number>

  /** Check if any results exist */
  exists(): Promise<boolean>

  /** Get first result */
  first(): Promise<NodeInstance<S, N> | null>

  /** Filter results */
  where(predicate: Record<string, unknown>): TypedTraversalResult<S, N>

  /** Limit results */
  limit(n: number): TypedTraversalResult<S, N>

  /** Skip results */
  skip(n: number): TypedTraversalResult<S, N>

  /** Set operations with another traversal of the same type */
  intersect(other: TypedTraversalResult<S, N>): TypedTraversalResult<S, N>
  union(other: TypedTraversalResult<S, N>): TypedTraversalResult<S, N>
  except(other: TypedTraversalResult<S, N>): TypedTraversalResult<S, N>

  /** Async iteration */
  [Symbol.asyncIterator](): AsyncIterableIterator<NodeInstance<S, N>>
}

// ============================================================================
// Magic $ Proxy Type - The Key to Type-Safe Traversals
// ============================================================================

/**
 * The magic $ proxy that provides type-safe traversals.
 *
 * For each relationship defined on a node type, accessing that property
 * returns a traversal result typed to the target node type.
 *
 * The result itself also has a $ that allows further chaining with
 * proper type inference.
 *
 * @example
 * // Given schema: User: { follows: 'User', likes: 'Post' }
 * user.$                        // MagicProxy<User>
 * user.$.follows                // ChainableResult<User> (traversal to User)
 * user.$.likes                  // ChainableResult<Post> (traversal to Post)
 * user.$.follows.$.follows      // ChainableResult<User> (friends of friends)
 * user.$.follows.$.likes        // ChainableResult<Post> (posts liked by friends)
 */
type MagicProxy<S extends GraphSchema, N extends NodeTypes<S>> = {
  [R in RelationshipTypes<S, N>]: ChainableTraversal<S, RelationshipTarget<S, N, R> & NodeTypes<S>>
} & {
  /** Access incoming edges by relationship type */
  in: IncomingProxy<S, N>
}

/**
 * Proxy for accessing incoming edges
 */
type IncomingProxy<S extends GraphSchema, N extends NodeTypes<S>> = {
  [R in RelationshipTypes<S, N>]: ChainableTraversal<S, RelationshipTarget<S, N, R> & NodeTypes<S>>
}

/**
 * A traversal result that can be further chained via $
 */
type ChainableTraversal<S extends GraphSchema, N extends NodeTypes<S>> =
  TypedTraversalResult<S, N> & {
    /** Chain to traverse from result nodes */
    $: MagicProxy<S, N>
  }

// ============================================================================
// Typed Graph Node Handle
// ============================================================================

/**
 * A handle to a specific node in the graph with typed traversals
 */
export interface TypedGraphNode<S extends GraphSchema, N extends NodeTypes<S>> {
  /** The node's ID */
  id: string

  /** The node type */
  type: N

  /** The underlying data (if loaded) */
  data?: NodeInstance<S, N>

  /** Magic traversal proxy - relationship types become typed properties */
  $: MagicProxy<S, N>

  /** Find shortest path to another node */
  pathTo(targetId: string, options?: PathOptions): Promise<GraphPath | null>

  /** Check if connected to another node */
  connected(targetId: string, options?: PathOptions): Promise<boolean>
}

export interface PathOptions {
  maxDepth?: number
  edgeTypes?: string[]
}

export interface GraphPath {
  vertices: string[]
  edges: Array<{ from: string; to: string; type: string }>
}

// ============================================================================
// Node Type Accessor
// ============================================================================

/**
 * Accessor for a specific node type in the graph.
 * Provides methods to get or query nodes of that type.
 */
export interface NodeTypeAccessor<S extends GraphSchema, N extends NodeTypes<S>> {
  /** Get a node by ID */
  get(id: string): TypedGraphNode<S, N>

  /** Find nodes matching criteria */
  find(query: Record<string, unknown>): Promise<NodeInstance<S, N>[]>

  /** Find one node matching criteria */
  findOne(query: Record<string, unknown>): Promise<NodeInstance<S, N> | null>

  /** Create a new node */
  create(data: Partial<NodeInstance<S, N>>): Promise<NodeInstance<S, N>>

  /** Start a traversal from multiple nodes of this type */
  from(...ids: string[]): ChainableTraversal<S, N>
}

// ============================================================================
// Typed Graph Client
// ============================================================================

/**
 * A typed graph client that provides type-safe access to nodes by type.
 *
 * Each node type in the schema becomes a property on the client that
 * provides typed access to nodes of that type.
 *
 * @example
 * const db = createTypedGraph<SocialGraph>({ namespace: 'social' })
 * db.User           // NodeTypeAccessor<SocialGraph, 'User'>
 * db.Post           // NodeTypeAccessor<SocialGraph, 'Post'>
 * db.User.get('id') // TypedGraphNode<SocialGraph, 'User'>
 */
type TypedGraphClient<S extends GraphSchema> = {
  [N in NodeTypes<S>]: NodeTypeAccessor<S, N>
} & {
  /** Get any node by ID (untyped) */
  node(id: string): TypedGraphNode<S, NodeTypes<S>>

  /** Namespace for this graph */
  readonly namespace: string
}

// ============================================================================
// Graph Client Options
// ============================================================================

export interface TypedGraphOptions {
  namespace: string
  /** Connection string or configuration */
  connection?: string | Record<string, unknown>
}

// ============================================================================
// Implementation (Simplified for spike)
// ============================================================================

/**
 * Create a typed graph client.
 *
 * The implementation uses Proxy to dynamically handle node type access.
 */
export function createTypedGraph<S extends GraphSchema>(
  options: TypedGraphOptions
): TypedGraphClient<S> {
  // This is a simplified implementation for the spike
  // Real implementation would connect to actual storage

  const createNodeAccessor = <N extends NodeTypes<S>>(nodeType: N): NodeTypeAccessor<S, N> => {
    return {
      get(id: string): TypedGraphNode<S, N> {
        return createTypedGraphNode<S, N>(id, nodeType, options.namespace)
      },
      async find(_query: Record<string, unknown>): Promise<NodeInstance<S, N>[]> {
        // Implementation would query storage
        return []
      },
      async findOne(_query: Record<string, unknown>): Promise<NodeInstance<S, N> | null> {
        return null
      },
      async create(data: Partial<NodeInstance<S, N>>): Promise<NodeInstance<S, N>> {
        return {
          id: data.id ?? crypto.randomUUID(),
          type: nodeType,
          data: data.data ?? {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as NodeInstance<S, N>
      },
      from(...ids: string[]): ChainableTraversal<S, N> {
        return createChainableTraversal<S, N>(ids, options.namespace)
      },
    }
  }

  // Use Proxy to dynamically create accessors for any node type
  return new Proxy({} as TypedGraphClient<S>, {
    get(_target, prop: string | symbol) {
      if (prop === 'namespace') return options.namespace
      if (prop === 'node') {
        return (id: string) => createTypedGraphNode<S, NodeTypes<S>>(id, 'Unknown' as NodeTypes<S>, options.namespace)
      }
      if (typeof prop === 'string') {
        return createNodeAccessor(prop as NodeTypes<S>)
      }
      return undefined
    },
  })
}

/**
 * Create a typed graph node handle
 */
function createTypedGraphNode<S extends GraphSchema, N extends NodeTypes<S>>(
  id: string,
  nodeType: N,
  _namespace: string
): TypedGraphNode<S, N> {
  const $ = createMagicProxy<S, N>([id])

  return {
    id,
    type: nodeType,
    $,
    async pathTo(_targetId: string, _options?: PathOptions): Promise<GraphPath | null> {
      // Implementation would use graph engine
      return null
    },
    async connected(_targetId: string, _options?: PathOptions): Promise<boolean> {
      return false
    },
  }
}

/**
 * Create the magic $ proxy for type-safe traversals
 */
function createMagicProxy<S extends GraphSchema, N extends NodeTypes<S>>(
  startIds: string[]
): MagicProxy<S, N> {
  return new Proxy({} as MagicProxy<S, N>, {
    get(_target, prop: string | symbol) {
      if (prop === 'in') {
        // Return incoming edge proxy
        return createIncomingProxy<S, N>(startIds)
      }
      if (typeof prop === 'string') {
        // Any string property is a relationship type
        return createChainableTraversal<S, NodeTypes<S>>(startIds, prop)
      }
      return undefined
    },
  })
}

/**
 * Create proxy for incoming edges
 */
function createIncomingProxy<S extends GraphSchema, N extends NodeTypes<S>>(
  startIds: string[]
): IncomingProxy<S, N> {
  return new Proxy({} as IncomingProxy<S, N>, {
    get(_target, prop: string | symbol) {
      if (typeof prop === 'string') {
        return createChainableTraversal<S, NodeTypes<S>>(startIds, prop, 'in')
      }
      return undefined
    },
  })
}

/**
 * Create a chainable traversal result
 */
function createChainableTraversal<S extends GraphSchema, N extends NodeTypes<S>>(
  startIds: string[],
  _relType?: string,
  _direction?: 'out' | 'in'
): ChainableTraversal<S, N> {
  const traversal: ChainableTraversal<S, N> = {
    async ids(): Promise<string[]> {
      // Implementation would execute traversal
      return startIds
    },
    async nodes(): Promise<NodeInstance<S, N>[]> {
      return []
    },
    async toArray(): Promise<NodeInstance<S, N>[]> {
      return this.nodes()
    },
    async count(): Promise<number> {
      return 0
    },
    async exists(): Promise<boolean> {
      return false
    },
    async first(): Promise<NodeInstance<S, N> | null> {
      return null
    },
    where(_predicate: Record<string, unknown>): TypedTraversalResult<S, N> {
      return this
    },
    limit(_n: number): TypedTraversalResult<S, N> {
      return this
    },
    skip(_n: number): TypedTraversalResult<S, N> {
      return this
    },
    intersect(_other: TypedTraversalResult<S, N>): TypedTraversalResult<S, N> {
      return this
    },
    union(_other: TypedTraversalResult<S, N>): TypedTraversalResult<S, N> {
      return this
    },
    except(_other: TypedTraversalResult<S, N>): TypedTraversalResult<S, N> {
      return this
    },
    async *[Symbol.asyncIterator](): AsyncIterableIterator<NodeInstance<S, N>> {
      const nodes = await this.nodes()
      for (const node of nodes) yield node
    },
    // The key: $ property allows chaining
    get $(): MagicProxy<S, N> {
      return createMagicProxy<S, N>(startIds)
    },
  }

  return traversal
}

// ============================================================================
// Example Schema & Usage (Type Checking Demonstration)
// ============================================================================

/**
 * Example social graph schema
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
 * Type checking examples - uncomment the error lines to see TypeScript errors
 */
async function exampleUsage() {
  // Create typed client
  const db = createTypedGraph<SocialGraph>({ namespace: 'social' })

  // =========================================================================
  // Type-safe node access
  // =========================================================================

  // Access nodes by type
  const user = db.User.get('user-123')
  const post = db.Post.get('post-456')
  const comment = db.Comment.get('comment-789')

  // TypeScript knows the types
  const userId: string = user.id
  const _userType = user.type  // Type is inferred as 'User'
  const _postType = post.type  // Type is inferred as 'Post'
  const _commentType = comment.type // Type is inferred as 'Comment'

  console.log(userId, _userType, _postType, _commentType)

  // =========================================================================
  // Type-safe traversals
  // =========================================================================

  // User.$.follows returns User[]
  const friends = await user.$.follows.toArray()
  //    ^? TypedNode<SocialGraph, 'User'>[]

  // User.$.likes returns Post[]
  const likedPosts = await user.$.likes.toArray()
  //    ^? TypedNode<SocialGraph, 'Post'>[]

  // Chained traversals maintain types
  // User.$.follows.$.follows = friends of friends = User[]
  const friendsOfFriends = await user.$.follows.$.follows.toArray()
  //    ^? TypedNode<SocialGraph, 'User'>[]

  // User.$.follows.$.likes = posts liked by friends = Post[]
  const postsLikedByFriends = await user.$.follows.$.likes.toArray()
  //    ^? TypedNode<SocialGraph, 'Post'>[]

  // Deep chains work correctly
  // Post.$.comments.$.author = authors of comments = User[]
  const commentAuthors = await post.$.comments.$.author.toArray()
  //    ^? TypedNode<SocialGraph, 'User'>[]

  // Comment.$.replies.$.author = authors of replies = User[]
  const replyAuthors = await comment.$.replies.$.author.toArray()
  //    ^? TypedNode<SocialGraph, 'User'>[]

  console.log(friends, likedPosts, friendsOfFriends, postsLikedByFriends, commentAuthors, replyAuthors)

  // =========================================================================
  // Traversal modifiers (maintain types)
  // =========================================================================

  const topFriends = await user.$.follows
    .where({ verified: true })
    .limit(10)
    .toArray()
  //  ^? TypedNode<SocialGraph, 'User'>[]

  const paginatedPosts = await user.$.likes
    .skip(20)
    .limit(10)
    .toArray()
  //  ^? TypedNode<SocialGraph, 'Post'>[]

  console.log(topFriends, paginatedPosts)

  // =========================================================================
  // Set operations (type-safe - must be same type)
  // =========================================================================

  const user2 = db.User.get('user-456')

  // Mutual friends - both traversals return User[], intersection is User[]
  const mutualFriends = await user.$.follows
    .intersect(user2.$.follows)
    .toArray()
  //  ^? TypedNode<SocialGraph, 'User'>[]

  // Friend suggestions - friends of friends excluding existing friends
  const suggestions = await user.$.follows.$.follows
    .except(user.$.follows)
    .toArray()
  //  ^? TypedNode<SocialGraph, 'User'>[]

  console.log(mutualFriends, suggestions)

  // =========================================================================
  // ERROR CASES - These would be caught at compile time with proper types
  // =========================================================================

  // In a fully typed implementation, these would be TypeScript errors:
  //
  // ERROR: 'comments' doesn't exist on User's relationships
  // user.$.comments.toArray()  // Would error: Property 'comments' does not exist
  //
  // ERROR: 'follows' doesn't exist on Post's relationships
  // post.$.follows.toArray()   // Would error: Property 'follows' does not exist
  //
  // ERROR: Can't intersect User[] with Post[]
  // user.$.follows.intersect(user.$.likes)  // Would error: Type mismatch
  //
  // The type system ensures relationships are valid at compile time!

  // Demonstrate type inference working correctly
  type FollowsTarget = RelationshipTarget<SocialGraph, 'User', 'follows'>
  //   ^? 'User' - correctly infers that follows points to User

  type LikesTarget = RelationshipTarget<SocialGraph, 'User', 'likes'>
  //   ^? 'Post' - correctly infers that likes points to Post

  type AuthorTarget = RelationshipTarget<SocialGraph, 'Comment', 'author'>
  //   ^? 'User' - correctly infers that author points to User

  // These type assertions prove the inference works
  const _followsCheck: FollowsTarget = 'User'
  const _likesCheck: LikesTarget = 'Post'
  const _authorCheck: AuthorTarget = 'User'

  console.log(_followsCheck, _likesCheck, _authorCheck)
}

// ============================================================================
// Advanced Type Utilities
// ============================================================================

/**
 * Get all relationships across the entire schema
 */
type AllRelationships<S extends GraphSchema> = {
  [N in NodeTypes<S>]: RelationshipTypes<S, N>
}[NodeTypes<S>]

/**
 * Find which node types have a specific relationship
 */
type NodesWithRelationship<S extends GraphSchema, R extends string> = {
  [N in NodeTypes<S>]: R extends RelationshipTypes<S, N> ? N : never
}[NodeTypes<S>]

/**
 * Invert the schema to get incoming relationships
 * (Which node types have relationships pointing TO a given type)
 */
type IncomingRelationships<S extends GraphSchema, Target extends NodeTypes<S>> = {
  [N in NodeTypes<S>]: {
    [R in RelationshipTypes<S, N>]: RelationshipTarget<S, N, R> extends Target ? R : never
  }[RelationshipTypes<S, N>]
}[NodeTypes<S>]

// Type tests for utilities
type _TestAllRels = AllRelationships<SocialGraph>
//   ^? 'follows' | 'likes' | 'authored' | 'commented' | 'author' | 'comments' | 'likedBy' | 'parent' | 'replies'

type _TestNodesWithFollows = NodesWithRelationship<SocialGraph, 'follows'>
//   ^? 'User'

type _TestNodesWithAuthor = NodesWithRelationship<SocialGraph, 'author'>
//   ^? 'Post' | 'Comment'

type _TestIncomingToUser = IncomingRelationships<SocialGraph, 'User'>
//   ^? 'follows' | 'author' | 'likedBy'

// ============================================================================
// Bidirectional Relationships Support
// ============================================================================

/**
 * Schema with explicit bidirectional relationship mapping
 */
interface BidirectionalSchema extends GraphSchema {
  User: {
    follows: 'User'
    likes: 'Post'
  }
  Post: {
    author: 'User'
  }
}

/**
 * Define reverse relationship names
 */
interface ReverseRelationships {
  User: {
    follows: 'followedBy'   // User.follows has reverse User.followedBy
    likes: 'likedBy'        // User.likes has reverse Post.likedBy
  }
  Post: {
    author: 'authored'      // Post.author has reverse User.authored
  }
}

/**
 * Type that adds reverse relationships to magic proxy
 */
type BidirectionalMagicProxy<
  S extends GraphSchema,
  N extends NodeTypes<S>,
  Rev extends Record<string, Record<string, string>>
> = MagicProxy<S, N> & {
  // Add reverse relationships from other types pointing to this type
  [K in keyof Rev as Rev[K] extends Record<string, string>
    ? Rev[K][keyof Rev[K] & string] extends string
      ? Rev[K][keyof Rev[K] & string]
      : never
    : never
  ]: ChainableTraversal<S, NodeTypes<S>>
}

// This demonstrates how we could extend the system to support
// automatic reverse relationship inference

// ============================================================================
// Run example (for testing)
// ============================================================================

// Execute example usage
exampleUsage().catch(console.error)

// Export for use in other modules
export type { SocialGraph, AllRelationships, NodesWithRelationship, IncomingRelationships }
