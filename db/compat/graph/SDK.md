# Graph SDK Reference

## Graph Client

```typescript
import { createGraph, Graph } from '@dotdo/graph'

const graph = createGraph({
  namespace: string,                              // Your app namespace
  thingResolver?: (ids: string[]) => Promise<Thing[]>  // Optional resolver for Thing data
})
```

### graph.node()

Get a graph node by ID.

```typescript
const user = graph.node('user-123')
const post = graph.node<Post>('post-456')  // With type annotation
```

### graph.thing()

Alias for `node()`.

```typescript
const user = graph.thing('user-123')
```

### graph.from()

Start a traversal from multiple nodes.

```typescript
const traversal = graph.from('user-1', 'user-2', 'user-3')
const combined = await traversal.out('follows').toArray()
```

### graph.addRelationship()

Add a relationship to the graph index.

```typescript
graph.addRelationship({
  id: 'rel-1',
  type: 'follows',
  from: 'user-1',
  to: 'user-2',
  data: { since: Date.now() },
  createdAt: Date.now()
})
```

### graph.addRelationships()

Add multiple relationships.

```typescript
graph.addRelationships([
  { id: 'rel-1', type: 'follows', from: 'user-1', to: 'user-2', ... },
  { id: 'rel-2', type: 'follows', from: 'user-1', to: 'user-3', ... },
])
```

### graph.pathExists()

Check if a path exists between two nodes.

```typescript
const exists = await graph.pathExists('user-1', 'user-100', 6)
```

### graph.shortestPath()

Find the shortest path between two nodes.

```typescript
const path = await graph.shortestPath('user-1', 'user-100', 10)
// { vertices: ['user-1', 'user-50', 'user-100'], edges: [...] }
```

### graph.commonNeighbors()

Find common neighbors between two nodes.

```typescript
const mutual = await graph.commonNeighbors('user-1', 'user-2', 'out')
```

### graph.getStats()

Get index statistics.

```typescript
const stats = graph.getStats()
// { vertices: 10000, edges: 50000, ... }
```

---

## GraphNode

A node in the graph with traversal capabilities.

```typescript
interface GraphNode<T extends Thing = Thing> {
  id: string                    // The node's ID
  data?: T                      // The underlying Thing data (if loaded)
  $: MagicTraversal<T>         // Magic traversal proxy
  pathTo(targetId, options?)    // Find shortest path
  connected(targetId, options?) // Check connectivity
  allPathsTo(targetId, options?) // Find all paths
}
```

### node.$ (Magic Traversal)

The `$` property is a magic proxy where relationship types become properties:

```typescript
const user = graph.node('user-123')

// Access relationship types as properties
user.$.follows           // outgoing 'follows' edges
user.$.likes             // outgoing 'likes' edges
user.$.authored          // outgoing 'authored' edges

// Chain traversals
user.$.follows.follows   // friends of friends
user.$.follows.likes     // posts liked by friends
user.$.follows.authored  // posts by friends
```

### node.$.in

Access incoming edges:

```typescript
user.$.in.follows        // followers (who follows this user)
user.$.in.likes          // who liked this (if user is a post)
user.$.in.authored       // posts authored by this user (reverse)
```

### node.pathTo()

Find shortest path to another node.

```typescript
const path = await user.pathTo('user-789')
const path = await user.pathTo('user-789', {
  maxDepth: 10,
  edgeTypes: ['follows', 'knows']  // Only traverse these edge types
})

// Returns: GraphPath | null
// {
//   vertices: ['user-123', 'user-456', 'user-789'],
//   edges: [{ from: 'user-123', to: 'user-456', type: 'follows' }, ...]
// }
```

### node.connected()

Check if connected to another node.

```typescript
const isConnected = await user.connected('user-789')
const isConnected = await user.connected('user-789', { maxDepth: 6 })
```

### node.allPathsTo()

Find all paths to another node (useful for visualization).

```typescript
const paths = await user.allPathsTo('user-789', { maxDepth: 4 })
// Returns: GraphPath[]
```

---

## Traversal Methods

All traversal methods return a new `Traversal` instance (immutable chaining).

### out(relType, options?)

Traverse outgoing edges of a given type.

```typescript
user.$.out('follows')
user.$.out('follows', { limit: 10 })
```

### in(relType, options?)

Traverse incoming edges of a given type.

```typescript
user.$.in('follows')  // Same as user.$.in.follows
```

### both(relType, options?)

Traverse edges in both directions.

```typescript
user.$.both('knows')  // Bidirectional relationships
```

### where(predicate)

Filter nodes at current position.

```typescript
// Object predicate (field matching)
user.$.follows.where({ verified: true })
user.$.follows.where({ 'data.status': 'active' })

// Function predicate
user.$.follows.where(node => node.data.followers > 1000)
```

### filter(predicate)

Alias for `where()`.

```typescript
user.$.follows.filter({ verified: true })
```

### limit(n)

Limit number of results.

```typescript
user.$.follows.limit(10)
user.$.follows.follows.limit(100)  // Limit final results
```

### skip(n)

Skip results (for pagination).

```typescript
user.$.follows.skip(20).limit(10)  // Page 3
```

### depth(d)

Set traversal depth.

```typescript
// Exact depth
user.$.follows.depth(2)  // Exactly 2 hops away

// Range
user.$.follows.depth({ min: 1, max: 3 })  // 1-3 hops

// Extended network
user.$.follows.depth({ max: 6 })  // Up to 6 degrees of separation
```

### unique()

Remove duplicate nodes from results.

```typescript
user.$.follows.follows.unique()  // Deduplicate fof
```

---

## Set Operations

Combine traversal results using set operations.

### intersect(other)

Intersection with another traversal (mutual friends, etc.).

```typescript
const user1 = graph.node('user-1')
const user2 = graph.node('user-2')

// Mutual friends
const mutual = await user1.$.follows.intersect(user2.$.follows).toArray()

// Mutual interests
const shared = await user1.$.likes.intersect(user2.$.likes).toArray()
```

### union(other)

Union with another traversal.

```typescript
// Combined networks
const combined = await user1.$.follows.union(user2.$.follows).toArray()

// All content from multiple users
const feed = await user1.$.authored.union(user2.$.authored).toArray()
```

### except(other)

Exclude nodes from another traversal.

```typescript
// Friends of friends who aren't already friends
const suggestions = await user.$.follows.follows
  .except(user.$.follows)
  .toArray()

// New followers (not following back)
const newFollowers = await user.$.in.follows
  .except(user.$.follows)
  .toArray()
```

---

## Path Finding

### pathTo(targetId, options?)

Find shortest path to target.

```typescript
const path = await user.$.pathTo('user-789')

// With options
const path = await user.$.pathTo('user-789', {
  maxDepth: 10,         // Maximum hops to search (default: 10)
  edgeTypes: ['follows'] // Restrict to specific edge types
})
```

Returns `GraphPath | null`:

```typescript
interface GraphPath {
  vertices: string[]     // Node IDs in path order
  edges: GraphEdge[]     // Edges connecting vertices
}

interface GraphEdge {
  from: string
  to: string
  type: string
}
```

### allPathsTo(targetId, options?)

Find all paths to target (up to limit).

```typescript
const paths = await user.$.allPathsTo('user-789', {
  maxDepth: 4,  // Default: 5
  all: true     // Return all paths
})

// Useful for visualization, understanding connections
for (const path of paths) {
  console.log(path.vertices.join(' -> '))
}
```

### connected(targetId, options?)

Check if path exists to target (boolean).

```typescript
const isConnected = await user.$.connected('user-789')

const isClose = await user.$.connected('user-789', {
  maxDepth: 3  // Within 3 degrees
})
```

---

## Execution Methods

These methods execute the traversal and return results.

### ids()

Execute and return node IDs only (index-only, no cold storage).

```typescript
const friendIds = await user.$.follows.ids()
// ['user-2', 'user-3', 'user-4', ...]
```

### nodes()

Execute and return full Thing objects.

```typescript
const friends = await user.$.follows.nodes()
// [{ id: 'user-2', type: 'User', data: {...} }, ...]
```

### toArray()

Alias for `nodes()`.

```typescript
const friends = await user.$.follows.toArray()
```

### count()

Count results without materializing (index-only when possible).

```typescript
const friendCount = await user.$.follows.count()
const fofCount = await user.$.follows.follows.count()
```

### exists()

Check if any results exist (early termination).

```typescript
const hasFriends = await user.$.follows.exists()
const hasVerifiedFriends = await user.$.follows.where({ verified: true }).exists()
```

### first()

Get first result only.

```typescript
const bestFriend = await user.$.follows.first()
const topPost = await user.$.authored.limit(1).first()
```

---

## Async Iteration

Traversals support async iteration:

```typescript
for await (const friend of user.$.follows) {
  console.log(friend.id, friend.data?.name)
}

// With filtering
for await (const post of user.$.follows.likes.where({ public: true })) {
  await processPost(post)
}
```

---

## Type-Safe Schema

Define a schema for full TypeScript inference:

```typescript
import { GraphSchema, createGraph } from '@dotdo/graph'

// Define your graph structure
interface MyGraph extends GraphSchema {
  User: {
    follows: 'User'
    likes: 'Post'
    authored: 'Post'
    memberOf: 'Group'
  }
  Post: {
    author: 'User'
    comments: 'Comment'
    tags: 'Tag'
    likes: 'User'  // Incoming likes
  }
  Comment: {
    author: 'User'
    post: 'Post'
    replies: 'Comment'
  }
  Group: {
    members: 'User'
    posts: 'Post'
  }
  Tag: {
    posts: 'Post'
  }
}

// Create typed graph
const graph = createGraph<MyGraph>({ namespace: 'app' })

// TypeScript knows the return types
const user = graph.node<User>('user-1')
const friends = await user.$.follows.toArray()     // User[]
const posts = await user.$.authored.toArray()      // Post[]
const feed = await user.$.follows.authored.toArray() // Post[]
```

---

## TraversalOptions

Options that can be passed to traversal methods:

```typescript
interface TraversalOptions {
  // Filter nodes by predicate
  where?: Record<string, unknown> | ((node: Thing) => boolean)

  // Limit results
  limit?: number

  // Skip results (pagination)
  skip?: number

  // Sort by field
  sort?: Record<string, 1 | -1>

  // Traversal depth
  depth?: number | { min?: number; max?: number }
}
```

---

## PathOptions

Options for path-finding operations:

```typescript
interface PathOptions {
  // Maximum depth to search (default: 10 for pathTo, 5 for allPathsTo, 6 for connected)
  maxDepth?: number

  // Return all paths up to limit
  all?: boolean

  // Edge types to traverse (undefined = all types)
  edgeTypes?: string[]
}
```

---

## Complete Example

```typescript
import { createGraph, GraphSchema } from '@dotdo/graph'

// Define schema
interface SocialGraph extends GraphSchema {
  User: { follows: 'User', likes: 'Post', authored: 'Post' }
  Post: { author: 'User', comments: 'Comment' }
  Comment: { author: 'User' }
}

// Create client
const graph = createGraph<SocialGraph>({
  namespace: 'social',
  thingResolver: async (ids) => {
    // Fetch Things from your storage
    return await db.things.findMany({ id: { $in: ids } })
  }
})

// Load relationships
graph.addRelationships(await fetchRelationships())

// Traverse
const user = graph.node('user-alice')

// Get follower count (index-only)
const followerCount = await user.$.in.follows.count()

// Get mutual friends with Bob
const bob = graph.node('user-bob')
const mutualFriends = await user.$.follows.intersect(bob.$.follows).toArray()

// Friend suggestions (fof not already following)
const suggestions = await user.$.follows.follows
  .except(user.$.follows)
  .where({ verified: true })
  .limit(10)
  .toArray()

// Check degrees of separation
const connected = await user.connected('user-charlie', { maxDepth: 6 })
if (connected) {
  const path = await user.pathTo('user-charlie')
  console.log(`${path.vertices.length - 1} degrees of separation`)
}

// Feed: recent posts from people I follow
const feed = await user.$.follows.authored
  .where({ public: true })
  .limit(50)
  .toArray()

// Async iteration
for await (const friend of user.$.follows) {
  console.log(`Processing ${friend.id}`)
}
```
