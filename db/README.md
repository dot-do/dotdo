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
import { createThingsStore } from '@dotdo/db'

const store = createThingsStore()

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

## Status

See beads issues do-7rf.4.* for implementation progress.
