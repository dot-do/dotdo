# @dotdo/core

Core types and interfaces for the dotdo database abstraction layer.

## Overview

`@dotdo/core` provides the foundational types and interfaces that all dotdo storage backends implement:

- **Thing** - Entities/nodes with namespace, type, and data
- **Relationship** - Edges connecting Things
- **Events** - Immutable event log for event sourcing
- **Actions** - Durable task execution with status tracking
- **DBClient** - Unified database interface
- **TypedDBClient** - Type-safe client for single entity types
- **Polymorphic Collections** - Type hierarchies with inheritance

## Installation

```bash
npm install @dotdo/core
```

## Quick Start

### Using DBClient

```typescript
import type { DBClient, Thing } from '@dotdo/core'

// All storage backends implement DBClient
async function example(db: DBClient) {
  // Create a Thing
  const user = await db.create({
    ns: 'app',
    type: 'User',
    data: { name: 'Alice', email: 'alice@example.com' }
  })

  // Query Things
  const users = await db.find({
    type: 'User',
    where: { email: { $contains: '@example.com' } },
    orderBy: 'createdAt',
    order: 'desc'
  })

  // Create relationships
  await db.relate({
    type: 'follows',
    from: user.url,
    to: otherUser.url
  })

  // Get related Things
  const following = await db.related(user.url, 'follows')
}
```

### Using TypedDBClient

```typescript
import { createTypedClient } from '@dotdo/core'
import type { TypedDBClient, Thing } from '@dotdo/core'

interface User {
  name: string
  email: string
  role?: string
}

// Create a typed client scoped to User type
const users: TypedDBClient<User> = createTypedClient(db, 'app', 'User')

// Type-safe operations
const alice = await users.create({ name: 'Alice', email: 'alice@example.com' })
const user = await users.get('user-123')
const admins = await users.find({ where: { role: 'admin' } })
```

## API Reference

### Core Types

#### Thing

A node/entity in the database:

```typescript
interface Thing<T extends StorableData = StorableData> {
  ns: string        // Namespace (e.g., 'example.com')
  type: string      // Entity type (e.g., 'User', 'Post')
  id: string        // Unique ID within namespace and type
  url: string       // Full URL (canonical identifier)
  createdAt: Date   // Creation timestamp
  updatedAt: Date   // Last update timestamp
  data: T           // User-defined properties
}
```

**Example:**
```typescript
const user: Thing<{ name: string; email: string }> = {
  ns: 'example.com',
  type: 'User',
  id: 'user-123',
  url: 'https://example.com/User/user-123',
  createdAt: new Date(),
  updatedAt: new Date(),
  data: { name: 'Alice', email: 'alice@example.com' }
}
```

#### Relationship

An edge between two Things:

```typescript
interface Relationship<T extends StorableData = StorableData> {
  id: string        // Unique relationship ID
  type: string      // Relationship type (e.g., 'author', 'follows')
  from: string      // Source Thing URL
  to: string        // Target Thing URL
  createdAt: Date   // Creation timestamp
  data?: T          // Optional edge data
}
```

#### QueryOptions

Options for filtering and pagination:

```typescript
interface QueryOptions {
  ns?: string                      // Filter by namespace
  type?: string                    // Filter by entity type
  where?: Record<string, unknown>  // Where clause conditions
  orderBy?: string                 // Field to order by
  order?: 'asc' | 'desc'          // Sort order
  limit?: number                   // Max results
  offset?: number                  // Results to skip
}
```

### DBClient Interface

The unified database interface implemented by all storage backends.

#### CRUD Operations

```typescript
interface DBClient<T extends StorableData = StorableData> {
  // Get by URL
  get(url: string): Promise<Thing<T> | null>

  // Get by namespace/type/id
  getById(ns: string, type: string, id: string): Promise<Thing<T> | null>

  // Create
  create(options: CreateThingInput<T>): Promise<Thing<T>>

  // Update
  update(url: string, data: Partial<T>): Promise<Thing<T>>

  // Upsert (create or update)
  upsert(options: Required<CreateThingInput<T>>): Promise<Thing<T>>

  // Delete
  delete(url: string): Promise<boolean>
}
```

#### Query Operations

```typescript
interface DBClient<T extends StorableData = StorableData> {
  // List with optional filtering
  list(options?: QueryOptions): Promise<Thing<T>[]>

  // Find matching criteria
  find(options: QueryOptions): Promise<Thing<T>[]>

  // Text/semantic search
  search(options: SearchOptions): Promise<Thing<T>[]>

  // Count matching
  count(options?: QueryOptions): Promise<number>
}
```

#### Relationship Operations

```typescript
interface DBClient<T extends StorableData = StorableData> {
  // Create relationship
  relate(options: CreateRelationshipInput): Promise<Relationship>

  // Remove relationship
  unrelate(from: string, type: string, to: string): Promise<boolean>

  // Get related Things (outbound)
  related(url: string, relationshipType?: string): Promise<Thing<T>[]>

  // Get referencing Things (inbound/backlinks)
  references(url: string, relationshipType?: string): Promise<Thing<T>[]>

  // Get relationships
  relationships(
    url: string,
    type?: string,
    direction?: 'from' | 'to' | 'both'
  ): Promise<Relationship[]>
}
```

#### Batch Operations

```typescript
interface DBClient<T extends StorableData = StorableData> {
  // Get multiple by URL
  batchGet(urls: string[]): Promise<Map<string, Thing<T> | null>>

  // Create multiple
  batchCreate(items: CreateThingInput<T>[]): Promise<Thing<T>[]>

  // Update multiple (optional)
  batchUpdate?(items: Array<{ url: string; data: Partial<T> }>): Promise<Thing<T>[]>

  // Delete multiple (optional)
  batchDelete?(urls: string[]): Promise<number>
}
```

### TypedDBClient

A DBClient scoped to a specific type for ergonomic usage:

```typescript
interface TypedDBClient<T extends StorableData = StorableData> {
  get(id: string): Promise<Thing<T> | null>
  create(data: T): Promise<Thing<T>>
  update(id: string, data: Partial<T>): Promise<Thing<T>>
  delete(id: string): Promise<boolean>
  list(options?: Omit<QueryOptions, 'ns' | 'type'>): Promise<Thing<T>[]>
  find(options: Omit<QueryOptions, 'ns' | 'type'>): Promise<Thing<T>[]>
  count(options?: Omit<QueryOptions, 'ns' | 'type'>): Promise<number>
}
```

**Usage:**
```typescript
import { createTypedClient } from '@dotdo/core'

interface Post {
  title: string
  content: string
  authorId: string
}

const posts = createTypedClient<Post>(db, 'blog', 'Post')

// Simplified API - no need to specify ns/type
const post = await posts.create({
  title: 'Hello World',
  content: 'My first post',
  authorId: 'user-123'
})

const recent = await posts.list({
  orderBy: 'createdAt',
  order: 'desc',
  limit: 10
})
```

### Actions

Durable task execution with status tracking:

```typescript
interface Action {
  id: string
  type: string
  status: ActionStatus  // 'pending' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled'
  trigger: ActionTrigger
  input: JsonObject
  output?: JsonObject
  error?: ActionError
  createdAt: Date
  updatedAt: Date
  scheduledFor?: Date
  startedAt?: Date
  completedAt?: Date
  attempts: number
  maxAttempts: number
}

interface ActionsClient {
  create(input: CreateActionInput): Promise<Action>
  get(id: string): Promise<Action | null>
  update(id: string, input: UpdateActionInput): Promise<Action>
  claim(options?: ClaimActionsOptions): Promise<Action[]>
  find(options?: FindActionsOptions): Promise<Action[]>
}
```

### Events

Immutable event log for event sourcing:

```typescript
interface Event {
  id: string
  type: string
  data: JsonObject
  metadata?: JsonObject
  timestamp: Date
  sequence: number
}

interface EventsClient {
  emit(input: EmitEventInput): Promise<Event>
  query(options?: QueryEventsOptions): Promise<Event[]>
  subscribe(options: SubscribeEventsOptions): AsyncIterable<Event>
}

// Replay events to rebuild state
const state = await replayEvents(events, initialState, handler)
```

### Polymorphic Collections

Type hierarchies with inheritance support:

```typescript
import { TypeRegistry, isType, assertType } from '@dotdo/core'

// Define type hierarchy
const registry = new TypeRegistry()

registry.register({
  name: 'Function',
  abstract: true,
  fields: {
    name: { type: 'string', required: true },
    description: { type: 'string' }
  }
})

registry.register({
  name: 'CodeFunction',
  extends: 'Function',
  fields: {
    code: { type: 'string', required: true },
    language: { type: 'string' }
  }
})

registry.register({
  name: 'GenerativeFunction',
  extends: 'Function',
  fields: {
    prompt: { type: 'string', required: true },
    model: { type: 'string' }
  }
})

// Type checking
if (isType(thing.data, 'CodeFunction', registry)) {
  console.log(thing.data.code)
}

// Type assertion
assertType(thing.data, 'GenerativeFunction', registry)
```

### Full Client

Combine multiple clients into a unified interface:

```typescript
import { combineClients } from '@dotdo/core'
import type { DBClientFull } from '@dotdo/core'

const client: DBClientFull = combineClients({
  things: thingsClient,
  events: eventsClient,
  actions: actionsClient,
})

// Access all capabilities
await client.things.create({ /* ... */ })
await client.events.emit({ /* ... */ })
await client.actions.claim()
```

## Storage Backends

These packages implement the `DBClient` interface:

- **@dotdo/db** - SQLite storage for Durable Objects
- **@dotdo/db4** - Pure TypeScript columnar store
- **@dotdo/postgres** - PGlite WASM PostgreSQL
- **@dotdo/sqlite** - sql.js WASM SQLite
- **@dotdo/mongo** - MongoDB compatibility on PostgreSQL
- **@dotdo/evodb** - Columnar shredding for analytics

## Related Packages

- [@dotdo/db](/db) - Abstract storage layer implementation
- [@dotdo/do](/do) - Durable Object base class
- [@dotdo/api](/api) - Self-describing API framework

## License

MIT
