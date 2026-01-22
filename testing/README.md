# @dotdo/testing

Custom Vitest matchers and assertion helpers for validating dotdo entities (Things, Events, Relationships).

## Installation

```bash
npm install --save-dev @dotdo/testing
```

## Quick Start

```typescript
import { describe, it, expect } from 'vitest'
import { setupEntityAssertions } from '@dotdo/testing'

// Setup once (in vitest setup file or at start of test file)
setupEntityAssertions()

describe('Entity tests', () => {
  it('validates things', async () => {
    const thing = await store.create({
      $type: 'Customer',
      name: 'Alice'
    })

    expect(thing).toBeValidThing()
    expect(thing).toHaveThingType('Customer')
  })

  it('validates events', async () => {
    const event = await events.emit({
      type: 'user.created',
      payload: { id: '123' }
    })

    expect(event).toBeValidEvent()
    expect(event).toHaveEventType('user.created')
  })

  it('validates relationships', async () => {
    const rels = await relationships.find({ subject: thing1.$id })

    expect(rels).toContainRelationship(thing1.$id, 'owns', thing2.$id)
  })
})
```

## Custom Matchers

### Thing Matchers

#### `toBeValidThing()`

Validates that an object is a valid Thing with required fields.

```typescript
expect(thing).toBeValidThing()
// Validates:
// - Has $id field
// - Has $type field
// - Has $createdAt timestamp
// - Has $updatedAt timestamp
```

#### `toHaveThingType(type)`

Validates that a Thing has a specific $type.

```typescript
expect(thing).toHaveThingType('Customer')
expect(thing).toHaveThingType('Order')
```

### Event Matchers

#### `toBeValidEvent()`

Validates that an object is a valid Event.

```typescript
expect(event).toBeValidEvent()
// Validates:
// - Has $id field
// - Has type field
// - Has timestamp field
// - Has payload field
```

#### `toHaveEventType(type)`

Validates that an Event has a specific type.

```typescript
expect(event).toHaveEventType('user.created')
expect(event).toHaveEventType('order.shipped')
```

### Relationship Matchers

#### `toBeValidRelationship()`

Validates that an object is a valid Relationship.

```typescript
expect(relationship).toBeValidRelationship()
// Validates:
// - Has $id field
// - Has from field (subject)
// - Has to field (object)
// - Has type field (predicate)
```

#### `toContainRelationship(from, type, to)`

Validates that a relationship array contains a specific relationship.

```typescript
const relationships = await store.relationships.find({ subject: customerId })

expect(relationships).toContainRelationship(customerId, 'owns', orderId)
```

## Validation Functions

These functions can be used directly in assertions or custom logic:

### `validateThing(thing)`

Returns validation result for a Thing.

```typescript
import { validateThing } from '@dotdo/testing'

const result = validateThing(thing)
if (!result.valid) {
  console.log('Validation errors:', result.errors)
}
```

### `validateEvent(event)`

Returns validation result for an Event.

```typescript
import { validateEvent } from '@dotdo/testing'

const result = validateEvent(event)
expect(result.valid).toBe(true)
```

### `validateRelationship(relationship)`

Returns validation result for a Relationship.

```typescript
import { validateRelationship } from '@dotdo/testing'

const result = validateRelationship(relationship)
expect(result.valid).toBe(true)
```

### `validateEntity(entity, type)`

Generic validator for any entity type.

```typescript
import { validateEntity } from '@dotdo/testing'

const result = validateEntity(thing, 'thing')
const eventResult = validateEntity(event, 'event')
const relResult = validateEntity(relationship, 'relationship')
```

## Setup

### In vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts']
  }
})
```

### In test/setup.ts

```typescript
import { setupEntityAssertions } from '@dotdo/testing'

// Register custom matchers globally
setupEntityAssertions()
```

## TypeScript Support

Add types to your test files:

```typescript
/// <reference types="@dotdo/testing" />

import { describe, it, expect } from 'vitest'

// Now you have full TypeScript support for custom matchers
expect(thing).toBeValidThing() // ✓ Type-safe
```

## API Reference

### Matchers

| Matcher | Description |
|---------|-------------|
| `toBeValidThing()` | Validates Thing structure |
| `toHaveThingType(type)` | Validates Thing $type |
| `toBeValidEvent()` | Validates Event structure |
| `toHaveEventType(type)` | Validates Event type |
| `toBeValidRelationship()` | Validates Relationship structure |
| `toContainRelationship(from, type, to)` | Finds relationship in array |

### Functions

| Function | Description |
|----------|-------------|
| `validateThing(thing)` | Validate Thing object |
| `validateEvent(event)` | Validate Event object |
| `validateRelationship(rel)` | Validate Relationship object |
| `validateEntity(entity, type)` | Generic entity validator |
| `findRelationship(rels, from, type, to)` | Find specific relationship |
| `setupEntityAssertions()` | Register custom matchers |

## Related Packages

- [@dotdo/db](/db) - Storage layer for Things, Events, Relationships
- [@dotdo/test-utils](/test-utils) - Shared test utilities (factories, helpers)

## License

MIT
