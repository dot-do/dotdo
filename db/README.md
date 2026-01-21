# @dotdo/db

Abstract storage layer for dotdo Digital Objects.

## Features

- Things (entities with $id and $type)
- Relationships (subject-predicate-object)
- Events (immutable event log)
- Query Builder (fluent API for filtering, sorting, pagination)
- Digital Objects Integration (schema validation, type generation)

## Quick Start

```typescript
import { createThingsStoreWithAdapter, MemoryStorageAdapter } from '@dotdo/db'

// Create a store with in-memory adapter (for testing)
const adapter = new MemoryStorageAdapter()
const store = createThingsStoreWithAdapter(adapter)

// Create a thing
const customer = await store.create({
  $type: 'Customer',
  name: 'Alice',
  email: 'alice@example.com'
})

// Query
const results = await store.list({
  type: 'Customer',
  limit: 10
})
```

## Storage Adapters

### In-Memory (Testing/Development)

```typescript
import { createThingsStoreWithAdapter, MemoryStorageAdapter } from '@dotdo/db'

const adapter = new MemoryStorageAdapter()
const store = createThingsStoreWithAdapter(adapter)
```

### SQLite (Production with Durable Objects)

```typescript
import { createThingsStoreWithAdapter, createSQLiteStorageAdapter } from '@dotdo/db'

// Inside a Durable Object constructor
const adapter = createSQLiteStorageAdapter(state.storage.sql)
const store = createThingsStoreWithAdapter(adapter)
```

### Shared Storage

When using multiple stores, share the adapter for consistency:

```typescript
import {
  createThingsStoreWithAdapter,
  createEventsStoreWithAdapter,
  createRelationshipsStoreWithAdapter,
  MemoryStorageAdapter
} from '@dotdo/db'

const adapter = new MemoryStorageAdapter()
const things = createThingsStoreWithAdapter(adapter)
const events = createEventsStoreWithAdapter(adapter)
const relationships = createRelationshipsStoreWithAdapter(adapter)
```

## Migration from createThingsStore()

The `createThingsStore()` function is **deprecated** and will be removed in v4.0.0.
See the [Migration Guide](#migration-guide) below.

### Migration Guide

**Before (deprecated):**
```typescript
import { createThingsStore } from '@dotdo/db'
const store = createThingsStore()
```

**After (recommended):**
```typescript
import { createThingsStoreWithAdapter, MemoryStorageAdapter } from '@dotdo/db'
const adapter = new MemoryStorageAdapter()
const store = createThingsStoreWithAdapter(adapter)
```

The API is identical - only the initialization changes. All `store.create()`, `store.get()`,
`store.update()`, `store.delete()`, and `store.list()` calls work the same way.

## Digital Objects Integration

The `@dotdo/db` package integrates with the `digital-objects` package from primitives, providing:

- Schema validation using Noun definitions
- Type generation from schemas
- Mapping between digital-objects and @dotdo/db formats

### Usage

```typescript
import { createMemoryProvider } from 'digital-objects'
import { createDigitalObjectsAdapter } from '@dotdo/db'

// Create provider and define schema
const provider = createMemoryProvider()
await provider.defineNoun({
  name: 'Customer',
  schema: {
    name: { type: 'string', required: true },
    email: 'string?',
    age: 'number?',
  }
})

// Create adapter
const store = createDigitalObjectsAdapter(provider)

// Use with validation
const customer = await store.create(
  { $type: 'Customer', name: 'Alice', email: 'alice@example.com' },
  { validate: true } // Enable schema validation
)

// Access noun definitions
const noun = await store.getNoun('Customer')
console.log(noun.schema)
```

### Field Mapping

| digital-objects | @dotdo/db | Type |
|----------------|-----------|------|
| `id` | `$id` | string |
| `noun` | `$type` | string |
| `createdAt` | `$createdAt` | number (timestamp) |
| `updatedAt` | `$updatedAt` | number (timestamp) |
| `data.*` | `*` | (flattened to top level) |

### Type Generation

Generate TypeScript interfaces from Noun schemas:

```typescript
import { TypeMapping } from '@dotdo/db'

const noun = await provider.getNoun('Customer')
const interfaceCode = TypeMapping.generateInterface(noun)
console.log(interfaceCode)
// export interface Customer {
//   name: string
//   email: string | undefined
//   age: number | undefined
// }
```

### Validation

```typescript
import { validateSchema } from '@dotdo/db'

// Pre-flight validation without creating
const result = await validateSchema(provider, 'Customer', {
  name: 'Alice',
  age: 'not-a-number' // Invalid!
})

if (!result.valid) {
  console.log(result.errors)
  // [{ field: 'age', message: 'Field has wrong type: expected number, got string' }]
}
```

## AI-Database Integration (Future)

The `@dotdo/db` package will support AI-powered operations through integration with the ai-database primitives. This integration is currently in the TDD phase with 10 skipped tests defining the expected API.

### Planned Features

#### 1. Natural Language Queries (2 tests)
Transform natural language questions into database queries:

```typescript
// Future API
const result = await store.queryNL('show all customers from Acme')
console.log(result.interpretation) // "Filtering customers by company name"
console.log(result.results) // [...matching Things]
```

#### 2. AI Value Generation (3 tests)
Generate field values using LLM when prompt fields are detected:

```typescript
// Future API: Draft/resolve pattern
const draft = await store.createDraft({
  $type: 'Lead',
  customer: 'the CEO of Acme Corp' // Natural language reference
})
// draft.$refs.customer = 'the CEO of Acme Corp'

const lead = await store.resolveDraft(draft)
// lead.customerId = '<actual-customer-id>' // Resolved via semantic matching
```

#### 3. Semantic Search (1 test)
Vector-based similarity search for entities:

```typescript
// Future API
const results = await store.semanticSearch('artificial intelligence concepts', {
  minScore: 0.7,
  limit: 10
})
// Returns Things sorted by semantic similarity with $score field
```

#### 4. Event Emission (2 tests)
Subscribe to entity lifecycle events:

```typescript
// Future API
store.on('Customer.created', async (event) => {
  console.log('New customer:', event.data)
})

await store.emit('Customer.signup', { plan: 'enterprise' })
```

#### 5. Relationship Traversal (1 test)
Verb-based relationship operations:

```typescript
// Future API
await provider.perform('employs', companyId, customerId)
const employees = await provider.related(companyId, 'employs', 'forward')
```

#### 6. Promise Pipelining (1 test)
Lazy evaluation with method chaining:

```typescript
// Future API
const names = await store
  .list()
  .filter(c => c.name.startsWith('A'))
  .map(c => c.name)
// Query executes only when awaited
```

### Implementation Status

- **Working (14 tests pass)**: Basic CRUD via DigitalObjectsAdapter
- **TDD Phase (10 tests skipped)**: AI features documented in tests/ai-database-integration.test.ts
- **See**: `db/tests/ai-database-integration.test.ts` for detailed implementation requirements

Each skipped test includes comprehensive documentation explaining:
- Expected API design
- Implementation requirements
- Integration points with @dotdo/ai
- Dependencies and architecture decisions

## Status

See beads issues do-7rf.4.* for implementation progress.
