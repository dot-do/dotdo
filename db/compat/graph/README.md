# Graph SDK with Magic $ Traversal

> Fluent graph traversal API with relationship types as properties over Things/Relationships Adjacency Index

## Overview

This module provides an intuitive graph traversal SDK where relationship types become properties through a magic `$` proxy:

```typescript
import { createGraph } from '@dotdo/graph'

const graph = createGraph({ namespace: 'social' })
const user = graph.node('user-123')

// Friends (outgoing 'follows' edges)
const friends = await user.$.follows.toArray()

// Followers (incoming 'follows' edges)
const followers = await user.$.in.follows.toArray()

// Friends of friends
const fof = await user.$.follows.follows.toArray()

// Mutual friends with another user
const other = graph.node('user-456')
const mutual = await user.$.follows.intersect(other.$.follows).toArray()

// Path finding
const path = await user.pathTo('user-789')
console.log(path?.vertices) // ['user-123', 'user-456', 'user-789']
```

## Architecture

```
+-----------------------------------------------------------------------------+
|                          GRAPH SDK ARCHITECTURE                              |
|                                                                              |
|  +------------------+     +------------------+     +-------------------+     |
|  |   GraphNode<T>   |     |    Traversal<T>  |     |  MagicTraversal   |     |
|  |                  |     |                  |     |                   |     |
|  | id: string       |     | steps: Step[]    |     | $.follows         |     |
|  | data?: T         |     | startIds: []     |     | $.in.follows      |     |
|  | $: MagicProxy    |---->| engine: Engine   |<--->| $.likes.author    |     |
|  | pathTo()         |     | thingResolver()  |     | [relType]: Magic  |     |
|  | connected()      |     |                  |     |                   |     |
|  +------------------+     +------------------+     +-------------------+     |
|           |                        |                                         |
|           |                        v                                         |
|           |         +------------------------------+                         |
|           |         |   GraphTraversalEngine       |                         |
|           |         |   - BFS/DFS traversal        |                         |
|           +-------->|   - Path finding             |                         |
|                     |   - Common neighbors         |                         |
|                     +------------------------------+                         |
|                                    |                                         |
|                                    v                                         |
|  +-----------------------------------------------------------------------+   |
|  |                       ADJACENCY INDEX                                  |   |
|  |  +-------------------+  +-------------------+  +-------------------+   |   |
|  |  | Out Edges         |  | In Edges          |  | Edge Metadata     |   |   |
|  |  | user-1 -> [       |  | user-2 <- [       |  | (type, ts, data)  |   |   |
|  |  |   follows: [2,3]  |  |   follows: [1,5]  |  |                   |   |   |
|  |  |   likes: [p1,p2]  |  |   likes: [u3,u4]  |  |                   |   |   |
|  |  | ]                 |  | ]                 |  |                   |   |   |
|  |  +-------------------+  +-------------------+  +-------------------+   |   |
|  |                                                                        |   |
|  |  * O(1) neighbor lookup      * Index-only operations                  |   |
|  |  * Set operations on IDs     * No cold storage for traversal          |   |
|  +-----------------------------------------------------------------------+   |
|                                    |                                         |
|                                    v                                         |
|  +-----------------------------------------------------------------------+   |
|  |                    THINGS / RELATIONSHIPS                              |   |
|  |                                                                        |   |
|  |   Thing {                     Relationship {                           |   |
|  |     id, type, ns,               id, type,                              |   |
|  |     data, createdAt,            from, to,                              |   |
|  |     updatedAt                   data, createdAt                        |   |
|  |   }                           }                                        |   |
|  |                                                                        |   |
|  |   R2 Iceberg Cold Storage (only accessed for node materialization)    |   |
|  +-----------------------------------------------------------------------+   |
+-----------------------------------------------------------------------------+
```

## Quick Start

### Basic Traversal

```typescript
const graph = createGraph({ namespace: 'social' })
const user = graph.node('user-123')

// Follow the 'follows' relationship (outgoing)
const friends = await user.$.follows.toArray()

// Follow the 'follows' relationship (incoming = followers)
const followers = await user.$.in.follows.toArray()

// Chain traversals (friends of friends)
const fof = await user.$.follows.follows.toArray()

// Multiple relationship types
const postsLikedByFriends = await user.$.follows.likes.toArray()
```

### Filtering and Pagination

```typescript
// Filter by predicate
const verifiedFriends = await user.$.follows
  .where({ verified: true })
  .toArray()

// Limit results
const topFriends = await user.$.follows.limit(10).toArray()

// Pagination
const page2 = await user.$.follows.skip(20).limit(10).toArray()
```

### Variable Depth Traversal

```typescript
// Exactly 2 hops away
const twoHops = await user.$.follows.depth(2).toArray()

// 1-3 hops (extended network)
const network = await user.$.follows.depth({ min: 1, max: 3 }).toArray()
```

### Set Operations

```typescript
const user1 = graph.node('user-1')
const user2 = graph.node('user-2')

// Mutual friends
const mutual = await user1.$.follows.intersect(user2.$.follows).toArray()

// Combined networks
const combined = await user1.$.follows.union(user2.$.follows).toArray()

// Friend suggestions (fof who aren't already friends)
const suggestions = await user1.$.follows.follows
  .except(user1.$.follows)
  .toArray()
```

### Path Finding

```typescript
const user = graph.node('user-123')

// Shortest path
const path = await user.pathTo('user-789')
// { vertices: ['user-123', 'user-456', 'user-789'], edges: [...] }

// Check connectivity
const connected = await user.connected('user-789')

// All paths for visualization
const allPaths = await user.allPathsTo('user-789', { maxDepth: 4 })
```

## Performance Characteristics

| Operation | Index Usage | Cold Storage | Time Complexity |
|-----------|-------------|--------------|-----------------|
| `$.follows.ids()` | Adjacency only | None | O(neighbors) |
| `$.follows.toArray()` | Adjacency + Resolve | Thing lookup | O(neighbors) |
| `$.follows.count()` | Adjacency only | None | O(1) |
| `$.follows.exists()` | Adjacency only | None | O(1) |
| `pathTo(target)` | BFS on adjacency | None | O(V + E) |
| `connected(target)` | BFS on adjacency | None | O(V + E) |
| `intersect/union/except` | Set operations | None | O(n + m) |
| `depth({ min, max })` | Multi-hop BFS | None | O(branching^depth) |

### Index-Only Operations

Most traversal operations are **index-only** and never touch cold storage:

- **ID retrieval**: `.ids()` returns vertex IDs from adjacency index
- **Counting**: `.count()` counts without materializing
- **Existence**: `.exists()` checks without materializing
- **Path finding**: BFS/DFS on in-memory adjacency lists
- **Set operations**: Pure set operations on ID sets

Only `.toArray()`, `.nodes()`, and `.first()` materialize Thing data from storage.

### Adjacency Index Structure

```
OutEdges[vertex_id][edge_type] -> Set<target_id>
InEdges[vertex_id][edge_type]  -> Set<source_id>
```

Each lookup is O(1) hash access. Traversals are O(degree) per hop.

## Type-Safe Schemas

Define your graph schema for full TypeScript inference:

```typescript
interface SocialGraph extends GraphSchema {
  User: { follows: 'User', likes: 'Post', authored: 'Post' }
  Post: { author: 'User', comments: 'Comment', tags: 'Tag' }
  Comment: { author: 'User', post: 'Post' }
  Tag: { posts: 'Post' }
}

const graph = createGraph<SocialGraph>({ namespace: 'social' })

// TypeScript knows $.follows returns User[]
const friends = await graph.node('user-1').$.follows.toArray()

// Chain maintains type safety
const postsByFriends = await graph.node('user-1').$.follows.authored.toArray()
```

## Installation

```bash
npm install @dotdo/graph
```
