# @dotdo/db

> Abstract storage layer for Digital Objects

[![npm version](https://img.shields.io/npm/v/@dotdo/db.svg)](https://www.npmjs.com/package/@dotdo/db)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

## The Problem

Building data layers for serverless applications is tedious:

- **Adapter hell** - Every storage backend has a different API (Redis, Postgres, SQLite, KV)
- **Missing abstractions** - You need entities, relationships, and events but only have raw key-value or SQL
- **Test friction** - Mocking databases for tests is painful and often doesn't reflect real behavior
- **Schema drift** - TypeScript types and database schemas diverge over time

You spend more time on plumbing than on your actual application logic.

## The Solution

One storage abstraction that works everywhere:

```typescript
import { createThingsStoreWithAdapter, MemoryStorageAdapter } from '@dotdo/db'

const store = createThingsStoreWithAdapter(new MemoryStorageAdapter())

// Create entities with automatic IDs and timestamps
const customer = await store.create({
  $type: 'Customer',
  name: 'Alice',
  email: 'alice@example.com'
})

// Query with type safety
const results = await store.list({
  type: 'Customer',
  where: { plan: 'enterprise' },
  limit: 10
})
```

## Quick Start

### Installation

```bash
npm install @dotdo/db
```

### In-Memory (Testing/Development)

```typescript
import { createThingsStoreWithAdapter, MemoryStorageAdapter } from '@dotdo/db'

const adapter = new MemoryStorageAdapter()
const store = createThingsStoreWithAdapter(adapter)

// Ready to use immediately
const user = await store.create({ $type: 'User', name: 'Alice' })
```

### SQLite (Production with Durable Objects)

```typescript
import { createThingsStoreWithAdapter, createSQLiteStorageAdapter } from '@dotdo/db'

// Inside a Durable Object constructor
const adapter = createSQLiteStorageAdapter(state.storage.sql)
const store = createThingsStoreWithAdapter(adapter)
```

## Features

### Things (Entities)

First-class entity support with automatic metadata:

```typescript
const customer = await store.create({
  $type: 'Customer',
  name: 'Alice',
  email: 'alice@example.com'
})

// Result:
// {
//   $id: 'cust_abc123',
//   $type: 'Customer',
//   $createdAt: 1704067200000,
//   $updatedAt: 1704067200000,
//   name: 'Alice',
//   email: 'alice@example.com'
// }
```

### Relationships

Graph-style connections between Things:

```typescript
import { createRelationshipsStoreWithAdapter } from '@dotdo/db'

const relationships = createRelationshipsStoreWithAdapter(adapter)

await relationships.create({
  subject: customer.$id,
  predicate: 'purchased',
  object: product.$id
})

// Query relationships
const purchases = await relationships.list({
  subject: customer.$id,
  predicate: 'purchased'
})
```

### Events

Immutable event log for audit trails and event sourcing:

```typescript
import { createEventsStoreWithAdapter } from '@dotdo/db'

const events = createEventsStoreWithAdapter(adapter)

await events.emit({
  type: 'Order.placed',
  data: { orderId: 'ord_123', total: 99.99 }
})

// Query events
const orderEvents = await events.list({
  type: 'Order.*',
  since: yesterday
})
```

### Query Builder

Fluent API for filtering, sorting, and pagination:

```typescript
const results = await store.list({
  type: 'Customer',
  where: {
    plan: 'enterprise',
    status: 'active'
  },
  orderBy: '$createdAt',
  order: 'desc',
  limit: 20,
  offset: 0
})
```

### Schema Validation

Integration with digital-objects for schema validation:

```typescript
import { createDigitalObjectsAdapter } from '@dotdo/db'
import { createMemoryProvider } from 'digital-objects'

const provider = createMemoryProvider()
await provider.defineNoun({
  name: 'Customer',
  schema: {
    name: { type: 'string', required: true },
    email: 'string?',
    age: 'number?'
  }
})

const store = createDigitalObjectsAdapter(provider)

// Validate on create
const customer = await store.create(
  { $type: 'Customer', name: 'Alice' },
  { validate: true }
)
```

## API Reference

### ThingsStore

```typescript
interface ThingsStore {
  create(data: ThingInput): Promise<Thing>
  get(id: string): Promise<Thing | null>
  update(id: string, data: Partial<ThingInput>): Promise<Thing>
  delete(id: string): Promise<boolean>
  list(options?: ListOptions): Promise<Thing[]>
}

interface ListOptions {
  type?: string
  where?: Record<string, unknown>
  orderBy?: string
  order?: 'asc' | 'desc'
  limit?: number
  offset?: number
}
```

### RelationshipsStore

```typescript
interface RelationshipsStore {
  create(rel: RelationshipInput): Promise<Relationship>
  delete(id: string): Promise<boolean>
  list(options?: RelationshipQuery): Promise<Relationship[]>
}

interface RelationshipQuery {
  subject?: string
  predicate?: string
  object?: string
}
```

### EventsStore

```typescript
interface EventsStore {
  emit(event: EventInput): Promise<Event>
  list(options?: EventQuery): Promise<Event[]>
}

interface EventQuery {
  type?: string
  since?: number
  until?: number
  limit?: number
}
```

### Storage Adapters

| Adapter | Use Case | Notes |
|---------|----------|-------|
| `MemoryStorageAdapter` | Testing, development | Data lost on restart |
| `createSQLiteStorageAdapter` | Production (Durable Objects) | Persistent, transactional |

## Examples

### Shared Storage Across Stores

```typescript
import {
  createThingsStoreWithAdapter,
  createEventsStoreWithAdapter,
  createRelationshipsStoreWithAdapter,
  MemoryStorageAdapter
} from '@dotdo/db'

// Share adapter for consistency
const adapter = new MemoryStorageAdapter()
const things = createThingsStoreWithAdapter(adapter)
const events = createEventsStoreWithAdapter(adapter)
const relationships = createRelationshipsStoreWithAdapter(adapter)
```

### Type Generation

Generate TypeScript interfaces from schemas:

```typescript
import { TypeMapping } from '@dotdo/db'

const noun = await provider.getNoun('Customer')
const interfaceCode = TypeMapping.generateInterface(noun)

// Output:
// export interface Customer {
//   name: string
//   email: string | undefined
//   age: number | undefined
// }
```

## SQLite Transaction Limitations

When using SQLite in Cloudflare Durable Objects, be aware:

1. **No explicit `BEGIN`/`COMMIT`/`ROLLBACK`** - Blocked by the runtime
2. **Use `transactionSync()`** - For atomic synchronous operations
3. **Automatic atomicity** - Consecutive writes without `await` are atomic

See [TRANSACTIONS.md](./TRANSACTIONS.md) for comprehensive documentation.

## Related Packages

| Package | Description |
|---------|-------------|
| [@dotdo/do](/do) | Durable Object with built-in storage |
| [@dotdo/rpc](/rpc) | Cap'n Web RPC transport |
| [@dotdo/api](/api) | Self-describing Hono API |
| [@dotdo/mcp](/mcp) | Model Context Protocol tools |

## License

MIT
