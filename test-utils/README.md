# @dotdo/test-utils

Shared test utilities for @dotdo packages - DO stub helpers, factories, assertions, and Miniflare setup.

Following dotdo's **NO MOCKS** philosophy - all utilities work with real Miniflare and Durable Object instances.

## Installation

```bash
npm install --save-dev @dotdo/test-utils
```

## Quick Start

```typescript
import { env } from 'cloudflare:test'
import {
  getTestDO,
  generateTestId,
  rpc,
  createCustomerInput,
  expectValidEntity
} from '@dotdo/test-utils'

describe('Customer tests', () => {
  it('should create a customer', async () => {
    // Get real DO stub (no mocking!)
    const stub = getTestDO(env)

    // Use factory to create test data
    const input = createCustomerInput({
      name: 'Alice',
      email: 'alice@example.com'
    })

    // Call DO method via RPC helper
    const customer = await rpc(stub, 'things.create', [input])

    // Use custom assertions
    expectValidEntity(customer)
    expect(customer.name).toBe('Alice')
  })
})
```

## Features

### DO Stub Helpers

Work with real Durable Object stubs in tests.

```typescript
import { getTestDO, generateTestId, createTestId } from '@dotdo/test-utils'

// Get DO stub with generated ID
const stub = getTestDO(env)

// Generate unique test ID
const id = generateTestId() // 'test-xyz123'

// Create DO stub with specific ID
const stub2 = getTestDO(env, createTestId('my-test'))
```

### RPC Helpers

Call DO methods with type-safe RPC.

```typescript
import { rpc, rpcMayFail } from '@dotdo/test-utils'

// Call DO method (throws on error)
const result = await rpc(stub, 'things.create', [{ $type: 'User' }])

// Call DO method (returns error result)
const { data, error } = await rpcMayFail(stub, 'things.get', ['invalid-id'])
if (error) {
  console.log('Expected error:', error)
}
```

### Test Data Factories

Create test entities with sensible defaults.

```typescript
import {
  createThingInput,
  createEventInput,
  createRelationshipInput,
  createCustomerInput,
  createOrderInput,
  createUserInput
} from '@dotdo/test-utils'

// Generic thing
const thing = createThingInput({ $type: 'Product', name: 'Widget' })

// Domain-specific factories
const customer = createCustomerInput({
  name: 'Alice',
  email: 'alice@example.com'
})

const order = createOrderInput({
  customerId: customer.$id,
  total: 100
})

const user = createUserInput({
  username: 'alice',
  email: 'alice@example.com'
})

// Events
const event = createEventInput({
  type: 'user.created',
  payload: { userId: '123' }
})

// Relationships
const rel = createRelationshipInput({
  from: customer.$id,
  to: order.$id,
  type: 'placed'
})
```

### Batch Creation

Create multiple test entities at once.

```typescript
import { createThingInputs, createTestBatch } from '@dotdo/test-utils'

// Create multiple inputs
const customers = createThingInputs(
  { $type: 'Customer' },
  [
    { name: 'Alice' },
    { name: 'Bob' },
    { name: 'Charlie' }
  ]
)

// Create batch with relationships
const batch = createTestBatch({
  things: 10,
  events: 5,
  relationships: 8
})
```

### Custom Assertions

Validate entities, responses, and common patterns.

```typescript
import {
  expectValidEntity,
  expectValidEvent,
  expectValidRelationship,
  expectValidEntityList,
  expectJsonResponse,
  expectHATEOASResponse,
  expectRPCError,
  expectValidId,
  expectValidTimestamp
} from '@dotdo/test-utils'

// Entity assertions
expectValidEntity(thing)
expectValidEvent(event)
expectValidRelationship(rel)

// List assertions
expectValidEntityList(things)
expectValidEventList(events)

// Response assertions
expectJsonResponse(response, 200)
expectHATEOASResponse(response, { self: true, collection: true })
expectErrorResponse(response, 404, 'Not found')

// RPC assertions
expectRPCError(response, 'NotFound')
expectRPCErrorType(error, 'ValidationError')

// Field assertions
expectValidId(thing.$id)
expectValidTimestamp(thing.$createdAt)
expectTimestampNear(thing.$createdAt, Date.now(), 1000)
expectIdPattern(thing.$id, /^[a-z0-9-]+$/)
```

### Request Helpers

Create test requests easily.

```typescript
import { createJsonRequest, createRpcRequest } from '@dotdo/test-utils'

// JSON request
const req = createJsonRequest('POST', '/users', {
  name: 'Alice',
  email: 'alice@example.com'
})

// RPC request
const rpcReq = createRpcRequest('users.create', [{
  name: 'Alice',
  email: 'alice@example.com'
}])
```

### Async Test Utilities

Wait for conditions, retry operations.

```typescript
import { sleep, waitFor, retry } from '@dotdo/test-utils'

// Sleep for milliseconds
await sleep(100)

// Wait for condition
await waitFor(() => {
  return thing.$status === 'processed'
}, {
  timeout: 5000,
  interval: 100
})

// Retry operation
const result = await retry(async () => {
  const data = await fetchData()
  if (!data.ready) throw new Error('Not ready')
  return data
}, {
  maxAttempts: 5,
  delayMs: 100
})
```

### Miniflare Setup

Create real Miniflare instances for testing.

```typescript
import { createTestMiniflare, getDoStub } from '@dotdo/test-utils'

const { mf, env } = await createTestMiniflare({
  doBindings: {
    DO: 'MyDO'
  },
  kvNamespaces: ['KV']
})

const stub = getDoStub(env, 'DO', 'test-id')
const result = await stub.fetch('https://test/')
```

## API Reference

### Helpers

| Function | Description |
|----------|-------------|
| `generateTestId()` | Generate unique test ID |
| `generateDeterministicId(seed)` | Generate deterministic ID from seed |
| `getTestDO(env, id?)` | Get DO stub from test env |
| `createTestId(name?)` | Create test ID with optional name |
| `rpc(stub, method, args)` | Call DO method via RPC |
| `rpcMayFail(stub, method, args)` | Call DO method, return error result |
| `createJsonRequest(method, path, body?)` | Create JSON request |
| `createRpcRequest(method, args)` | Create RPC request |
| `sleep(ms)` | Sleep for milliseconds |
| `waitFor(condition, options?)` | Wait for condition |
| `retry(fn, options?)` | Retry async operation |

### Factories

| Function | Description |
|----------|-------------|
| `createThingInput(data)` | Create Thing input |
| `createThing(data)` | Create Thing with defaults |
| `createThingInputs(base, variants)` | Create multiple Thing inputs |
| `createEventInput(data)` | Create Event input |
| `createEvent(data)` | Create Event with defaults |
| `createEventInputs(base, variants)` | Create multiple Event inputs |
| `createRelationshipInput(data)` | Create Relationship input |
| `createRelationship(data)` | Create Relationship with defaults |
| `createRelationshipInputs(base, variants)` | Create multiple Relationship inputs |
| `createCustomerInput(data?)` | Create Customer input |
| `createOrderInput(data?)` | Create Order input |
| `createUserInput(data?)` | Create User input |
| `createTestBatch(counts)` | Create batch of test data |

### Assertions

| Function | Description |
|----------|-------------|
| `expectValidEntity(entity)` | Validate entity structure |
| `expectValidEvent(event)` | Validate event structure |
| `expectValidRelationship(rel)` | Validate relationship structure |
| `expectValidEntityList(list)` | Validate entity list |
| `expectValidEventList(list)` | Validate event list |
| `expectValidRelationshipList(list)` | Validate relationship list |
| `expectRPCError(response, code?)` | Validate RPC error |
| `expectRPCErrorType(error, type)` | Validate error type |
| `expectJsonResponse(response, status?)` | Validate JSON response |
| `expectHATEOASResponse(response, links)` | Validate HATEOAS response |
| `expectErrorResponse(response, status, message?)` | Validate error response |
| `expectValidLink(link)` | Validate HATEOAS link |
| `expectValidTimestamp(ts)` | Validate timestamp |
| `expectTimestampNear(ts, expected, delta)` | Validate timestamp proximity |
| `expectValidId(id)` | Validate ID format |
| `expectIdPattern(id, pattern)` | Validate ID matches pattern |

### Miniflare

| Function | Description |
|----------|-------------|
| `createTestMiniflare(options)` | Create Miniflare instance |
| `getDoStub(env, binding, id)` | Get DO stub from env |

## Examples

### Testing DO Methods

```typescript
import { env } from 'cloudflare:test'
import {
  getTestDO,
  rpc,
  createCustomerInput,
  expectValidEntity
} from '@dotdo/test-utils'

describe('DO methods', () => {
  it('creates a customer', async () => {
    const stub = getTestDO(env)
    const input = createCustomerInput({ name: 'Alice' })
    const customer = await rpc(stub, 'things.create', [input])

    expectValidEntity(customer)
    expect(customer.$type).toBe('Customer')
    expect(customer.name).toBe('Alice')
  })

  it('handles errors gracefully', async () => {
    const stub = getTestDO(env)
    const { error } = await rpcMayFail(stub, 'things.get', ['invalid-id'])

    expect(error).toBeDefined()
    expectRPCErrorType(error, 'NotFound')
  })
})
```

### Testing with Factories

```typescript
import { createCustomerInput, createOrderInput } from '@dotdo/test-utils'

describe('Order processing', () => {
  it('processes an order', async () => {
    const customer = createCustomerInput({
      name: 'Bob',
      email: 'bob@example.com'
    })

    const order = createOrderInput({
      customerId: customer.$id,
      items: [{ sku: 'widget', quantity: 2 }],
      total: 50
    })

    const result = await processOrder(order)
    expect(result.status).toBe('confirmed')
  })
})
```

### Testing Async Operations

```typescript
import { waitFor, retry, sleep } from '@dotdo/test-utils'

describe('Async operations', () => {
  it('waits for processing', async () => {
    const job = await startJob()

    await waitFor(() => job.status === 'completed', {
      timeout: 10000,
      interval: 100
    })

    expect(job.result).toBeDefined()
  })

  it('retries on failure', async () => {
    const result = await retry(async () => {
      const data = await fetchUnstableAPI()
      if (!data.success) throw new Error('Retry')
      return data
    }, {
      maxAttempts: 3,
      delayMs: 500
    })

    expect(result.success).toBe(true)
  })
})
```

## Best Practices

### 1. Use Real DOs, No Mocks

Always use real Miniflare instances:

```typescript
// Good
const stub = getTestDO(env)
const result = await rpc(stub, 'things.create', [input])

// Avoid
const mockDO = { create: vi.fn() } // Don't mock!
```

### 2. Use Factories for Test Data

Keep tests clean with factories:

```typescript
// Good
const customer = createCustomerInput({ name: 'Alice' })

// Avoid
const customer = {
  $id: 'cust_xyz',
  $type: 'Customer',
  $createdAt: Date.now(),
  $updatedAt: Date.now(),
  name: 'Alice',
  email: 'alice@example.com'
}
```

### 3. Use Custom Assertions

Leverage built-in assertions:

```typescript
// Good
expectValidEntity(thing)
expectValidId(thing.$id)

// Avoid
expect(thing.$id).toBeDefined()
expect(typeof thing.$id).toBe('string')
expect(thing.$id.length).toBeGreaterThan(0)
```

## Related Packages

- [@dotdo/testing](/testing) - Custom Vitest matchers for entities
- [@dotdo/do](/do) - Durable Object base class
- [@dotdo/db](/db) - Storage layer

## License

MIT
