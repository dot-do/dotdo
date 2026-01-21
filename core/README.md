# @dotdo/core

> Foundational types and interfaces for the dotdo ecosystem

## The Problem

Building with Durable Objects is powerful, but you keep running into the same issues:

- **Scattered type definitions** - Every package defines its own `Thing`, `Event`, `Action` types
- **Inconsistent interfaces** - One backend uses `create()`, another uses `insert()`, a third uses `add()`
- **No standard patterns** - You reinvent entity schemas, relationships, and event sourcing in every project
- **Type safety gaps** - Lose type information when passing data between packages

Your codebase becomes a patchwork of incompatible abstractions.

## The Solution

**@dotdo/core** provides the foundational types that all dotdo packages share. One source of truth. Complete type safety. Consistent patterns everywhere.

```typescript
import type { Thing, DBClient, Event, Action } from '@dotdo/core'
```

Every storage backend implements `DBClient`. Every entity follows `Thing`. Every event matches `Event`. Your code works with any backend, any scale.

## Quick Start

```bash
npm install @dotdo/core
```

```typescript
import type { Thing, DBClient, Event } from '@dotdo/core'
import { createTypedClient, replayEvents } from '@dotdo/core'

// Define your entity type
interface User {
  name: string
  email: string
}

// Type-safe entity
const user: Thing<User> = {
  ns: 'myapp.com',
  type: 'User',
  id: 'user-123',
  url: 'https://myapp.com/User/user-123',
  createdAt: new Date(),
  updatedAt: new Date(),
  data: { name: 'Alice', email: 'alice@example.com' }
}

// Works with any DBClient implementation
async function createUser(db: DBClient, data: User) {
  return db.create({
    ns: 'myapp.com',
    type: 'User',
    data
  })
}
```

## What You Get

### Core Entity Types

| Type | Description |
|------|-------------|
| **Thing** | The universal entity type with namespace, type, id, url, timestamps, and data |
| **Relationship** | Directional edges between Things with optional edge data |
| **Event** | Immutable facts - append-only, never modified |
| **Action** | Durable execution with status lifecycle and retries |

### Database Interface

| Interface | Description |
|-----------|-------------|
| **DBClient** | Full CRUD, query, relationships, and batch operations |
| **TypedDBClient** | Scoped to a specific namespace/type for ergonomic access |
| **DBClientFull** | Complete interface combining DBClient, ActionsClient, EventsClient |
| **ActionsClient** | Create, claim, update, and retry durable actions |
| **EventsClient** | Emit, query, and subscribe to events |

### Polymorphic Collections

| Export | Description |
|--------|-------------|
| **TypeRegistry** | Manage type hierarchies with inheritance |
| **buildTypeFilter** | Generate queries that include subtypes |
| **isType** | Type guard for discriminated unions |
| **assertType** | Assert and narrow discriminated types |
| **matchType** | Pattern matching over discriminated unions |

### Utilities

| Export | Description |
|--------|-------------|
| **createTypedClient** | Create a scoped client from a DBClient |
| **combineClients** | Merge DBClient + ActionsClient + EventsClient into DBClientFull |
| **replayEvents** | Reconstruct state from event history |

## API Reference

### Thing

The core entity type. All data in dotdo is a Thing.

```typescript
interface Thing<T extends StorableData = StorableData> {
  ns: string        // Namespace (e.g., 'example.com')
  type: string      // Entity type (e.g., 'User', 'Order')
  id: string        // Unique ID within namespace/type
  url: string       // Canonical URL identifier
  createdAt: Date
  updatedAt: Date
  data: T           // Your typed data
}
```

### Relationship

Directional edges connecting Things.

```typescript
interface Relationship<T extends StorableData = StorableData> {
  id: string        // Relationship ID
  type: string      // Relationship type (e.g., 'author', 'follows')
  from: string      // Source Thing URL
  to: string        // Target Thing URL
  createdAt: Date
  data?: T          // Optional edge data
}
```

### Event

Immutable records of what happened.

```typescript
interface Event<T extends StorableData = StorableData> {
  id: string
  type: string       // e.g., 'User.created', 'Order.shipped'
  subject: string    // Thing URL this event is about
  data: T            // Event payload
  actor: string      // Who caused this
  source: string     // Where it came from
  timestamp: Date
  correlationId?: string  // Group related events
  causationId?: string    // What caused this event
  actionId?: string       // Associated action
}
```

### Action

Durable execution with lifecycle management.

```typescript
interface Action<TInput, TOutput, TConfig> {
  id: string
  type: string           // e.g., 'Email.send', 'Order.process'
  trigger: ActionTrigger // manual | scheduled | event | webhook | rpc
  target: string         // Thing URL being acted on
  input: TInput
  config?: TConfig
  status: ActionStatus   // pending | running | completed | failed | cancelled | timeout | retrying
  output?: TOutput       // Set on completion
  error?: ActionError    // Set on failure
  createdAt: Date
  startedAt?: Date
  completedAt?: Date
  attempts: number
  maxAttempts: number
  nextRetryAt?: Date
}
```

### DBClient

The unified database interface all backends implement.

```typescript
interface DBClient<T extends StorableData = StorableData> {
  // CRUD
  get(url: string): Promise<Thing<T> | null>
  getById(ns: string, type: string, id: string): Promise<Thing<T> | null>
  create(options: CreateThingInput<T>): Promise<Thing<T>>
  update(url: string, data: Partial<T>): Promise<Thing<T>>
  upsert(options: Required<CreateThingInput<T>>): Promise<Thing<T>>
  delete(url: string): Promise<boolean>

  // Query
  list(options?: QueryOptions): Promise<Thing<T>[]>
  find(options: QueryOptions): Promise<Thing<T>[]>
  search(options: SearchOptions): Promise<Thing<T>[]>
  count(options?: QueryOptions): Promise<number>

  // Relationships
  relate(options: CreateRelationshipInput): Promise<Relationship>
  unrelate(from: string, type: string, to: string): Promise<boolean>
  related(url: string, relationshipType?: string): Promise<Thing<T>[]>
  references(url: string, relationshipType?: string): Promise<Thing<T>[]>
  relationships(url: string, type?: string, direction?: 'from' | 'to' | 'both'): Promise<Relationship[]>

  // Batch
  batchGet(urls: string[]): Promise<Map<string, Thing<T> | null>>
  batchCreate(items: CreateThingInput<T>[]): Promise<Thing<T>[]>
  batchUpdate?(items: Array<{ url: string; data: Partial<T> }>): Promise<Thing<T>[]>
  batchDelete?(urls: string[]): Promise<number>

  close?(): Promise<void>
}
```

### TypeRegistry

Manage polymorphic type hierarchies.

```typescript
import { TypeRegistry, buildTypeFilter, isType } from '@dotdo/core'

// Register types with inheritance
const registry = new TypeRegistry()

registry.register({
  $type: 'Function',
  $abstract: true,
  name: 'string!',
  input: 'json!',
  output: 'json!'
})

registry.register({
  $type: 'CodeFunction',
  $extends: 'Function',
  runtime: 'string!',
  code: 'text!'
})

registry.register({
  $type: 'GenerativeFunction',
  $extends: 'Function',
  model: 'string!',
  prompt: 'text!'
})

// Query all Function types
const types = registry.getHierarchy('Function')
// ['Function', 'CodeFunction', 'GenerativeFunction']

// Type guards
const fn: FunctionType = getFunction()
if (isType(fn, 'CodeFunction')) {
  console.log(fn.code)  // TypeScript knows fn is CodeFunction
}
```

### Event Sourcing

Replay events to reconstruct state.

```typescript
import { replayEvents, type EventHandler } from '@dotdo/core'

interface OrderState {
  items: string[]
  status: 'pending' | 'paid' | 'shipped'
  total: number
}

const handlers: Record<string, EventHandler<OrderState>> = {
  'Order.created': (_, event) => ({
    items: event.data.items,
    status: 'pending',
    total: event.data.total
  }),
  'Order.paid': (state, event) => ({
    ...state!,
    status: 'paid'
  }),
  'Order.shipped': (state, event) => ({
    ...state!,
    status: 'shipped'
  })
}

// Reconstruct current state from history
const events = await db.queryEvents({ subject: orderUrl, order: 'asc' })
const orderState = replayEvents(events, handlers)
```

## Implementing a Backend

Create your own storage backend by implementing `DBClient`:

```typescript
import type { DBClient, Thing, CreateThingInput, QueryOptions } from '@dotdo/core'

export function createMyClient(storage: MyStorage): DBClient {
  return {
    async get(url) {
      // Your implementation
    },
    async getById(ns, type, id) {
      // Your implementation
    },
    async create(options) {
      // Your implementation
    },
    // ... implement all DBClient methods
  }
}
```

All dotdo packages will work with your backend automatically.

## Related Packages

| Package | Description |
|---------|-------------|
| **@dotdo/db** | Database implementations (db4, sqlite, postgres) |
| **@dotdo/do** | The Durable Object class with built-in storage |
| **@dotdo/api** | Self-describing Hono API with HATEOAS |
| **@dotdo/rpc** | Cap'n Web RPC for all communication |
| **dotdo** | Main package that re-exports everything |

## License

MIT
