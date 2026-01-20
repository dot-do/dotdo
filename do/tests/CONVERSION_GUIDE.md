# Converting vi.fn() Mocks to vitest-pool-workers

This guide documents how to convert existing mock-based DO tests to use real Durable Objects via `@cloudflare/vitest-pool-workers`.

## Why Convert?

Mock-based tests using `vi.fn()` have several problems:

1. **Incorrect concurrency behavior**: `blockConcurrencyWhile: vi.fn((fn) => fn())` executes synchronously, missing real DO serialization behavior
2. **No storage persistence testing**: Mocked storage doesn't test real persistence, limits, or transactions
3. **No SQLite testing**: Mock storage can't test `state.storage.sql` operations
4. **No WebSocket hibernation**: Mock WebSocket APIs don't match real hibernation behavior
5. **No DO-to-DO communication**: Mock namespaces don't test real stub behavior
6. **False positives**: Tests pass but real behavior fails

## Quick Start

### 1. Setup vitest config

```typescript
// do/vitest.config.ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    include: ['tests/*.integration.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
      },
    },
  },
})
```

### 2. Run tests with the workers config

```bash
npx vitest run --config do/vitest.config.ts
```

## Conversion Patterns

### Pattern 1: Basic DO Instantiation

**BEFORE (Mocked):**
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DO } from '../DO'

function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()
  return {
    id: { toString: () => 'test-do-id' } as DurableObjectId,
    storage: {
      get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
      put: vi.fn((key: string, value: unknown) => {
        storage.set(key, value)
        return Promise.resolve()
      }),
      delete: vi.fn((key: string) => {
        storage.delete(key)
        return Promise.resolve(true)
      }),
      list: vi.fn(() => Promise.resolve(storage)),
    },
    blockConcurrencyWhile: vi.fn((fn) => fn()),
    waitUntil: vi.fn(),
  } as unknown as DurableObjectState
}

describe('DO Class', () => {
  let doInstance: DO
  let mockState: DurableObjectState

  beforeEach(() => {
    mockState = createMockState()
    doInstance = new DO(mockState, {})
  })

  it('should respond to GET /', async () => {
    const request = new Request('https://do/')
    const response = await doInstance.fetch(request)
    expect(response.status).toBe(200)
  })
})
```

**AFTER (Real):**
```typescript
import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'

describe('DO Class', () => {
  it('should respond to GET /', async () => {
    const id = env.DO.idFromName('test-' + Date.now())
    const stub = env.DO.get(id)

    const response = await stub.fetch('https://do/')

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.status).toBe('ok')
  })
})
```

### Pattern 2: Storage Operations

**BEFORE (Mocked):**
```typescript
it('should store and retrieve data', async () => {
  const mockState = createMockState()
  const doInstance = new DO(mockState, {})

  // Directly manipulate mock storage
  await mockState.storage.put('key', 'value')
  const value = await mockState.storage.get('key')

  expect(value).toBe('value')
  expect(mockState.storage.put).toHaveBeenCalledWith('key', 'value')
})
```

**AFTER (Real):**
```typescript
it('should store and retrieve data', async () => {
  const id = env.DO.idFromName('storage-test-' + Date.now())
  const stub = env.DO.get(id)

  // Test storage through DO's HTTP endpoints
  // (Your DO should expose storage operations via endpoints)
  await stub.fetch('https://do/storage/put', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'test', value: 'hello' }),
  })

  const response = await stub.fetch('https://do/storage/get?key=test')
  const data = await response.json()

  expect(data.value).toBe('hello')
})
```

### Pattern 3: RPC Method Calls

**BEFORE (Mocked):**
```typescript
it('should call DO methods via /rpc', async () => {
  const mockState = createMockState()
  const doInstance = new DO(mockState, {})

  // Monkey-patch method onto DO instance
  ;(doInstance as any).greet = (name: string) => `Hello, ${name}!`

  const request = new Request('https://do/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'greet', args: ['World'] }),
  })

  const response = await doInstance.fetch(request)
  expect(await response.json()).toBe('Hello, World!')
})
```

**AFTER (Real):**
```typescript
it('should call DO methods via /rpc', async () => {
  const id = env.DO.idFromName('rpc-test-' + Date.now())
  const stub = env.DO.get(id)

  // Call a real method that exists on the DO
  const response = await stub.fetch('https://do/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'getData', args: [] }),
  })

  // Test the actual response
  expect(response.ok).toBe(true)
})
```

### Pattern 4: Concurrency Testing

**BEFORE (Mocked - BROKEN):**
```typescript
it('handles concurrent operations', async () => {
  const mockState = createMockState()
  const doInstance = new DO(mockState, {})

  // This doesn't actually test concurrency!
  // blockConcurrencyWhile mock executes synchronously
  const promises = [
    doInstance.fetch(new Request('https://do/increment')),
    doInstance.fetch(new Request('https://do/increment')),
  ]

  await Promise.all(promises)
  // Mock might show 2, but real DO behavior could differ
})
```

**AFTER (Real):**
```typescript
it('handles concurrent operations correctly', async () => {
  const id = env.DO.idFromName('concurrent-test-' + Date.now())
  const stub = env.DO.get(id)

  // Fire concurrent requests - REAL DO will serialize them
  const promises = Array.from({ length: 10 }, () =>
    stub.fetch('https://do/counter/increment', { method: 'POST' })
  )

  await Promise.all(promises)

  // Get final counter value
  const response = await stub.fetch('https://do/counter/get')
  const { counter } = await response.json()

  // Real DO guarantees this will be exactly 10
  expect(counter).toBe(10)
})
```

### Pattern 5: WebSocket Testing

**BEFORE (Mocked):**
```typescript
function createMockState() {
  const webSockets: WebSocket[] = []
  return {
    // ...
    acceptWebSocket: vi.fn((ws, tags) => {
      webSockets.push(ws)
    }),
    getWebSockets: vi.fn((tag) => webSockets),
  }
}

it('accepts WebSocket connections', async () => {
  const mockWs = { send: vi.fn(), close: vi.fn() }
  mockState.acceptWebSocket(mockWs as any, ['tag'])
  expect(mockState.acceptWebSocket).toHaveBeenCalled()
})
```

**AFTER (Real):**
```typescript
it('accepts WebSocket connections', async () => {
  const id = env.DO.idFromName('ws-test-' + Date.now())
  const stub = env.DO.get(id)

  // Real WebSocket upgrade request
  const response = await stub.fetch('https://do/websocket', {
    headers: { Upgrade: 'websocket' },
  })

  expect(response.status).toBe(101)
  expect(response.webSocket).toBeDefined()
})
```

### Pattern 6: Cross-DO Communication

**BEFORE (Mocked):**
```typescript
const createMockNamespace = (name: string): DurableObjectNamespace => {
  return {
    idFromName: vi.fn((id: string) => ({
      toString: () => `${name}:${id}`,
    })),
    get: vi.fn((doId: any) => ({
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }))),
    })),
  } as unknown as DurableObjectNamespace
}

it('calls another DO', async () => {
  const mockEnv = { Customer: createMockNamespace('Customer') }
  // ...
  expect(mockEnv.Customer.idFromName).toHaveBeenCalledWith('customer-123')
})
```

**AFTER (Real):**
```typescript
// Requires wrangler.jsonc with multiple DO bindings:
// { "name": "CUSTOMER_DO", "class_name": "CustomerDO" }
// { "name": "ORDER_DO", "class_name": "OrderDO" }

it('Order DO calls Customer DO on ship', async () => {
  const customerId = 'customer-' + Date.now()
  const orderId = 'order-' + Date.now()

  // Setup customer
  const customerStub = env.CUSTOMER_DO.get(env.CUSTOMER_DO.idFromName(customerId))
  await customerStub.fetch('https://do/setup', {
    method: 'POST',
    body: JSON.stringify({ id: customerId, balance: 100 }),
  })

  // Setup order
  const orderStub = env.ORDER_DO.get(env.ORDER_DO.idFromName(orderId))
  await orderStub.fetch('https://do/setup', {
    method: 'POST',
    body: JSON.stringify({ id: orderId, customerId }),
  })

  // Ship order - Order DO will call Customer DO internally
  const response = await orderStub.fetch('https://do/ship', { method: 'POST' })
  const result = await response.json()

  expect(result.customerNotified).toBe(true)
})
```

## File Organization

Recommended structure:

```
do/
├── vitest.config.ts          # Workers pool config for integration tests
├── tests/
│   ├── DO.test.ts            # Keep as unit tests (fast, some mocks OK)
│   ├── DO.integration.test.ts # NEW: Real DO tests
│   ├── entities.test.ts       # Keep as unit tests
│   ├── entities.integration.test.ts # NEW: Real tests
│   └── ...
└── wrangler.jsonc            # DO bindings configuration
```

## Running Tests

```bash
# Run unit tests (fast, mocked)
npx vitest run

# Run integration tests (workers pool, real DOs)
npx vitest run --config do/vitest.config.ts

# Run specific integration test
npx vitest run --config do/vitest.config.ts tests/DO.integration.test.ts
```

## Checklist for Conversion

- [ ] Remove `createMockState()` function
- [ ] Remove `vi.fn()` for storage methods
- [ ] Remove `vi.mock()` calls for DO namespaces
- [ ] Import `{ env }` from `'cloudflare:test'`
- [ ] Use `env.DO.idFromName()` and `env.DO.get()` for DO access
- [ ] Test behavior through HTTP endpoints, not internal state
- [ ] Use unique test IDs (`Date.now()`) for test isolation
- [ ] Add to workers pool vitest config include list
- [ ] Verify tests pass with real runtime

## Reference

- [@cloudflare/vitest-pool-workers docs](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Miniflare v3 API](https://github.com/cloudflare/workers-sdk/tree/main/packages/miniflare)
- [DO testing patterns](https://developers.cloudflare.com/durable-objects/best-practices/testing/)
