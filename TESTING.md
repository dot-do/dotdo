# Testing Guide for dotdo

This document outlines the testing philosophy, patterns, and conventions used in the dotdo monorepo.

## Philosophy: NO MOCKS

**Durable Objects require NO MOCKING.** Miniflare runs real DOs with real SQLite locally.

The fundamental testing principle in dotdo is to test against **real** Cloudflare Workers runtime behavior, not mock implementations. This approach:

- Tests actual DO behavior including concurrency handling
- Tests real storage persistence
- Tests real SQLite operations
- Tests real WebSocket hibernation
- Tests real DO-to-DO communication
- Eliminates false positives from mock implementation differences

### Why No Mocks?

Mock-based testing for Durable Objects introduces significant risks:

```typescript
// BAD - Mock-based pattern (DON'T DO THIS)
const mockState = {
  storage: {
    get: vi.fn(),
    put: vi.fn(),
  },
  blockConcurrencyWhile: vi.fn((fn) => fn()),  // WRONG! Real behavior is different
  waitUntil: vi.fn(),
}
const doInstance = new DO(mockState, {})
```

Problems with mocks:
1. `blockConcurrencyWhile` doesn't actually block in mocks
2. Storage operations don't test real persistence behavior
3. SQLite operations are entirely skipped
4. Concurrency bugs slip through to production

### The Right Way: Real Miniflare Instances

```typescript
// GOOD - Real vitest-pool-workers pattern
import { env } from 'cloudflare:test'

describe('DO Class', () => {
  it('should respond to GET /', async () => {
    const id = env.DO.idFromName('test')
    const stub = env.DO.get(id)

    const response = await stub.fetch('https://do/')

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.status).toBe('ok')
  })
})
```

## Quick Start

### Running Tests

```bash
# Run all tests (watch mode)
npm test

# Run all tests once
npm run test:run

# Run tests for a specific package
npm run test:do        # Durable Objects tests
npm run test:db        # Database layer tests
npm run test:mcp       # MCP tools tests
npm run test:api       # API worker tests

# Run tests via project filter
npx vitest --project=objects     # Only DO tests
npx vitest --project=workers     # Only Workers tests

# Run a specific test file
npx vitest run do/tests/DO.test.ts
npx vitest run api/tests/hateoas.test.ts

# Run tests with coverage
npm run test:coverage
npm run test:coverage:do
npm run test:coverage:db
npm run test:coverage:api
```

### Test Configuration

The root `vitest.config.ts` uses `@cloudflare/vitest-pool-workers` to run tests inside the Cloudflare Workers runtime:

```typescript
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    // Critical: Limit concurrency for memory-intensive miniflare
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,

    poolOptions: {
      workers: {
        wrangler: {
          configPath: './wrangler.jsonc',
        },
        singleWorker: true,
        isolatedStorage: false,  // Required for SQLite WAL
        miniflare: {
          durableObjectsPersist: false,  // In-memory for tests (faster)
        },
      },
    },
  },
})
```

## Test File Conventions

### File Naming

- Test files: `*.test.ts`
- Location: `{package}/tests/` directory
- Example: `do/tests/DO.test.ts`, `api/tests/hateoas.test.ts`

### Test File Structure

```typescript
/**
 * Feature Name Tests
 *
 * Brief description of what is being tested.
 *
 * @module {package}/tests/{feature}.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { env } from 'cloudflare:test'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface HealthResponse {
  status: string
  id: string
}

// ============================================================================
// HELPERS
// ============================================================================

function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function getStub(name?: string) {
  const testName = name ?? generateTestId()
  const id = env.DO.idFromName(testName)
  return env.DO.get(id)
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Feature Name', () => {
  describe('sub-feature', () => {
    it('should do something specific', async () => {
      // Arrange
      const stub = getStub()

      // Act
      const response = await stub.fetch('https://do/')

      // Assert
      expect(response.status).toBe(200)
    })
  })
})
```

### Test ID Generation

Always use unique test IDs to ensure test isolation:

```typescript
function generateTestId(prefix = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// Each test gets its own isolated DO instance
it('test 1', async () => {
  const stub = getStub('instance-a-' + generateTestId())
  // ...
})

it('test 2', async () => {
  const stub = getStub('instance-b-' + generateTestId())
  // ...
})
```

## Test Patterns

### 1. Basic DO Testing via Fetch

The most common pattern - test DO behavior via HTTP requests:

```typescript
import { env } from 'cloudflare:test'

it('should handle health check', async () => {
  const id = env.DO.idFromName(generateTestId())
  const stub = env.DO.get(id)

  const response = await stub.fetch('https://do/')

  expect(response.status).toBe(200)
  const json = await response.json() as HealthResponse
  expect(json.status).toBe('ok')
  expect(json.id).toBeDefined()
})
```

### 2. RPC Testing

Test RPC endpoints for method invocations:

```typescript
it('should call RPC methods', async () => {
  const stub = getStub()

  const response = await stub.fetch('https://do/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'things.create', args: [{ $type: 'Customer', name: 'Alice' }] }),
  })

  expect(response.status).toBe(200)
  const result = await response.json()
  expect(result.$id).toBeDefined()
})
```

### 3. Storage Persistence Testing

Test that data persists across requests:

```typescript
it('should persist data across requests', async () => {
  const testName = generateTestId()

  // First request - store data
  const stub1 = getStub(testName)
  await stub1.fetch('https://do/storage/put', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'test', value: 'hello' }),
  })

  // Second request - same DO instance, should see the data
  const stub2 = getStub(testName)
  const response = await stub2.fetch('https://do/storage/get?key=test')
  const json = await response.json()

  expect(json.value).toBe('hello')
})
```

### 4. Concurrent Access Testing

Test the DO's single-threaded execution model:

```typescript
it('should handle concurrent requests correctly', async () => {
  const stub = getStub()

  // Fire multiple concurrent requests
  const requests = Array.from({ length: 10 }, () =>
    stub.fetch('https://do/counter/increment', { method: 'POST' })
  )

  await Promise.all(requests)

  // Check final counter value - should be exactly 10
  const response = await stub.fetch('https://do/counter/get')
  const json = await response.json() as { counter: number }

  expect(json.counter).toBe(10)
})
```

### 5. SQLite Operations Testing

Test real SQLite operations:

```typescript
it('should persist SQLite data', async () => {
  const stub = getStub()

  // Insert via SQLite
  const insertResponse = await stub.fetch('https://do/sql/insert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'test-key', value: 'test-value' }),
  })

  const insertJson = await insertResponse.json() as { id: number }
  expect(insertJson.id).toBeGreaterThan(0)

  // Query via SQLite
  const getResponse = await stub.fetch('https://do/sql/get?key=test-key')
  const getJson = await getResponse.json() as { row: { key: string; value: string } }

  expect(getJson.row.key).toBe('test-key')
  expect(getJson.row.value).toBe('test-value')
})
```

### 6. DO-to-DO Communication Testing

Test cross-DO RPC calls:

```typescript
it('should forward requests between DOs', async () => {
  const coordinator = getCoordinatorStub()
  const target = getTestDOStub('target-' + generateTestId())

  // Initialize target with data
  await target.fetch('https://do/storage/put', {
    method: 'POST',
    body: JSON.stringify({ key: 'data', value: 'from-target' }),
  })

  // Forward request via coordinator
  const response = await coordinator.fetch('https://do/forward', {
    method: 'POST',
    body: JSON.stringify({
      targetName: 'target',
      targetPath: '/storage/get?key=data',
    }),
  })

  const json = await response.json()
  expect(json.result.value).toBe('from-target')
})
```

### 7. Error Handling Testing

Test error scenarios without mocks:

```typescript
it('should return 404 for unknown routes', async () => {
  const stub = getStub()
  const response = await stub.fetch('https://do/nonexistent')

  expect(response.status).toBe(404)
})

it('should handle invalid JSON gracefully', async () => {
  const stub = getStub()

  const response = await stub.fetch('https://do/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not valid json',
  })

  expect(response.status).toBeGreaterThanOrEqual(400)
})
```

### 8. CORS Testing

Test CORS headers on actual responses:

```typescript
it('should include CORS headers', async () => {
  const stub = getStub()

  const response = await stub.fetch('https://do/', {
    method: 'OPTIONS',
    headers: {
      'Origin': 'https://example.com',
      'Access-Control-Request-Method': 'GET',
    },
  })

  expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy()
})
```

## Test Utilities

The `@dotdo/test-utils` package provides shared utilities:

### DO Stub Helpers

```typescript
import { getTestDO, generateTestId, rpc } from '@dotdo/test-utils'
import { env } from 'cloudflare:test'

// Get a fresh DO stub with auto-generated name
const stub = getTestDO(env)

// Get a stub with a specific name
const stub = getTestDO(env, 'my-specific-instance')

// Make RPC calls easily
const thing = await rpc<Thing>(stub, 'things.create', [
  { $type: 'Customer', name: 'Alice' }
])
```

### Test Data Factories

```typescript
import { createCustomerInput, createOrderInput } from '@dotdo/test-utils'

// Create test data with sensible defaults
const customer = createCustomerInput({ name: 'Alice' })
// { $type: 'Customer', name: 'Alice', email: 'alice@test.com', ... }

const order = createOrderInput({ customerId: customer.$id })
```

### Async Utilities

```typescript
import { waitFor, retry, sleep } from '@dotdo/test-utils'

// Wait for a condition
await waitFor(async () => {
  const response = await stub.fetch('https://do/counter/get')
  const { counter } = await response.json()
  return counter >= 10
}, { timeout: 5000, message: 'Counter did not reach 10' })

// Retry with exponential backoff
const result = await retry(async () => {
  const response = await stub.fetch('https://do/flaky')
  if (!response.ok) throw new Error('Failed')
  return response.json()
}, { maxAttempts: 3, baseDelay: 100 })
```

### Custom Assertions

```typescript
import { expectValidEntity, expectValidTimestamp, expectJsonResponse } from '@dotdo/test-utils'

// Assert entity structure
expectValidEntity(thing)

// Assert timestamp is valid
expectValidTimestamp(thing.$createdAt)

// Assert JSON response structure
await expectJsonResponse(response, { status: 200 })
```

## Package-Specific Testing

### @dotdo/do (Durable Objects)

Tests for the core DO class use the `do/vitest.config.ts` configuration:

```bash
npm run test:do
# or
npx vitest --config do/vitest.config.ts
```

Location: `do/tests/`

Key test files:
- `DO.test.ts` - Core DO class tests
- `entities.test.ts` - Entity CRUD operations
- `events.test.ts` - Event system tests
- `websocket.test.ts` - WebSocket handling
- `alarm.test.ts` - Alarm scheduling
- `concurrency.test.ts` - Concurrent access patterns

### @dotdo/db (Database Layer)

Tests for the database layer:

```bash
npm run test:db
```

Location: `db/tests/`

These tests can run with or without full DO bindings since the storage layer is more abstract.

### @dotdo/api (API Worker)

Tests for the Hono-based API worker:

```bash
npm run test:api
```

Location: `api/tests/`

Key test files:
- `hateoas.test.ts` - HATEOAS response format
- `openapi.test.ts` - OpenAPI schema generation
- `rate-limit.test.ts` - Rate limiting middleware

### @dotdo/auth (Authentication)

Tests for JWT-based authentication:

Location: `auth/tests/`

These tests verify JWT signing/verification using the jose library.

## Process Management

**Vitest and Miniflare consume significant memory.** Guidelines:

1. Never run multiple vitest instances in parallel
2. Use `npx vitest run` (not watch mode) for CI
3. Kill orphan processes if needed:
   ```bash
   pkill -9 -f vitest
   pkill -9 -f vite
   ```
4. **For subagents:** Run ONE test file at a time

## Coverage Thresholds

The project maintains minimum coverage thresholds:

```typescript
coverage: {
  thresholds: {
    statements: 65,
    branches: 60,
    functions: 60,
    lines: 65,
  },
}
```

Generate coverage reports:

```bash
npm run test:coverage        # All packages
npm run test:coverage:do     # DO package only
npm run test:coverage:db     # DB package only
```

## Tips and Best Practices

1. **Always consume response bodies** - When firing multiple concurrent requests, always consume the response body to avoid connection issues:
   ```typescript
   const responses = await Promise.all(requests)
   for (const response of responses) {
     await response.text()  // or response.json()
   }
   ```

2. **Use unique test names** - Generate unique DO names for each test to ensure complete isolation.

3. **Test real scenarios** - Don't test mocked behavior; test what actually happens in production.

4. **Clean up resources** - When using direct Miniflare instances, always call `mf.dispose()` in `afterAll`.

5. **Keep tests focused** - Each test should verify one specific behavior.

6. **Type your responses** - Define interfaces for response structures to catch type errors early.

7. **Use descriptive test names** - Test names should describe the expected behavior:
   ```typescript
   it('should return 404 for unknown routes')  // Good
   it('tests 404')  // Bad
   ```

## Miniflare Direct Integration

For complex scenarios requiring explicit Miniflare control (multiple DO types, custom scripts), use direct Miniflare instantiation:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Miniflare } from 'miniflare'

// Define inline DO script for testing
const TEST_DO_SCRIPT = `
export class TestDO {
  constructor(state, env) {
    this.state = state
    this.storage = state.storage
    this.sql = state.storage.sql

    this.state.blockConcurrencyWhile(async () => {
      this.sql.exec(\`
        CREATE TABLE IF NOT EXISTS items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL UNIQUE,
          value TEXT,
          created_at INTEGER DEFAULT (unixepoch())
        )
      \`)
    })
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', id: this.state.id.toString() })
    }
    if (url.pathname === '/sql/insert' && request.method === 'POST') {
      const { key, value } = await request.json()
      const result = this.sql.exec(
        'INSERT INTO items (key, value) VALUES (?, ?) RETURNING id',
        key, value
      )
      return Response.json({ success: true, id: result.toArray()[0].id })
    }
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
}

export default {
  async fetch(request, env) {
    const id = env.TEST_DO.idFromName('default')
    return env.TEST_DO.get(id).fetch(request)
  }
}
`

describe('Miniflare Direct Integration', () => {
  let mf: Miniflare

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: TEST_DO_SCRIPT,
      durableObjects: {
        TEST_DO: 'TestDO',
      },
      durableObjectsPersist: false,  // In-memory for tests
    })
  })

  afterAll(async () => {
    await mf.dispose()
  })

  it('creates a DO instance with SQLite', async () => {
    const ns = await mf.getDurableObjectNamespace('TEST_DO')
    const id = ns.idFromName('test-instance')
    const stub = ns.get(id)

    // Test SQLite insert
    const insertResponse = await stub.fetch('http://fake/sql/insert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'test', value: 'hello' }),
    })

    const json = await insertResponse.json()
    expect(json.success).toBe(true)
    expect(json.id).toBeGreaterThan(0)
  })
})
```

### Multiple DO Types

Testing cross-DO communication requires multiple DO bindings:

```typescript
const MULTI_DO_SCRIPT = `
export class CustomerDO {
  constructor(state, env) {
    this.state = state
    this.storage = state.storage
    this.env = env
  }

  async fetch(request) {
    // ... implementation
  }
}

export class OrderDO {
  constructor(state, env) {
    this.state = state
    this.env = env
  }

  async fetch(request) {
    // Can call CustomerDO via this.env.CUSTOMER_DO
    const customerId = this.env.CUSTOMER_DO.idFromName('customer-1')
    const customerStub = this.env.CUSTOMER_DO.get(customerId)
    return customerStub.fetch(request)
  }
}

export default {
  async fetch(request, env) {
    // Worker entry point
  }
}
`

const mf = new Miniflare({
  modules: true,
  script: MULTI_DO_SCRIPT,
  durableObjects: {
    CUSTOMER_DO: 'CustomerDO',
    ORDER_DO: 'OrderDO',
  },
  durableObjectsPersist: false,
})
```

## WebSocket Testing

Test WebSocket hibernation and messaging:

```typescript
it('accepts WebSocket connections', async () => {
  const stub = getStub()

  const response = await stub.fetch('http://fake/websocket', {
    headers: { Upgrade: 'websocket' },
  })

  // Miniflare returns 101 for WebSocket upgrade
  expect(response.status).toBe(101)
  expect(response.webSocket).toBeDefined()
})

it('tracks WebSocket connections via hibernation API', async () => {
  const stub = getStub()

  // Connect multiple WebSockets
  await stub.fetch('http://fake/websocket', { headers: { Upgrade: 'websocket' } })
  await stub.fetch('http://fake/websocket', { headers: { Upgrade: 'websocket' } })

  // Check connection count
  const response = await stub.fetch('http://fake/websocket/connections')
  const json = await response.json()

  expect(json.totalConnections).toBe(2)
})

it('broadcasts to all connected WebSockets', async () => {
  const stub = getStub()

  // Connect a WebSocket
  const wsResponse = await stub.fetch('http://fake/websocket', {
    headers: { Upgrade: 'websocket' },
  })
  expect(wsResponse.webSocket).toBeDefined()

  // Broadcast
  const broadcastResponse = await stub.fetch('http://fake/websocket/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Hello everyone!' }),
  })

  const json = await broadcastResponse.json()
  expect(json.sent).toBeGreaterThanOrEqual(0)
})
```

## Alarm Testing

Test DO alarm scheduling:

```typescript
it('schedules an alarm for future execution', async () => {
  const stub = getStub()

  const scheduleResponse = await stub.fetch('http://fake/alarm/schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delayMs: 1000 }),
  })

  const json = await scheduleResponse.json()
  expect(json.scheduled).toBe(true)
  expect(json.scheduledTime).toBeGreaterThan(Date.now())
})

it('cancels a scheduled alarm', async () => {
  const stub = getStub()

  // Schedule
  await stub.fetch('http://fake/alarm/schedule', {
    method: 'POST',
    body: JSON.stringify({ delayMs: 60000 }),
  })

  // Cancel
  const cancelResponse = await stub.fetch('http://fake/alarm/cancel', { method: 'POST' })
  expect((await cancelResponse.json()).cancelled).toBe(true)

  // Verify cancelled
  const statusResponse = await stub.fetch('http://fake/alarm/status')
  expect((await statusResponse.json()).scheduled).toBe(false)
})
```

## Transaction Testing

Test SQLite transactions via blockConcurrencyWhile:

```typescript
it('commits on successful transaction', async () => {
  const stub = getStub()

  const txResponse = await stub.fetch('http://fake/sql/transaction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operations: [
        { type: 'insert', key: 'tx-1', value: 'first' },
        { type: 'insert', key: 'tx-2', value: 'second' },
        { type: 'insert', key: 'tx-3', value: 'third' },
      ],
    }),
  })

  const json = await txResponse.json()
  expect(json.success).toBe(true)
  expect(json.results).toHaveLength(3)

  // Verify all items exist
  const countResponse = await stub.fetch('http://fake/sql/count')
  expect((await countResponse.json()).count).toBe(3)
})

it('rollbacks on transaction error', async () => {
  const stub = getStub()

  // First, add some data
  await stub.fetch('http://fake/sql/insert', {
    method: 'POST',
    body: JSON.stringify({ key: 'original', value: 'data' }),
  })

  // Try a failing transaction
  const txResponse = await stub.fetch('http://fake/sql/transaction', {
    method: 'POST',
    body: JSON.stringify({
      operations: [
        { type: 'insert', key: 'new-1', value: 'a' },
        { type: 'insert', key: 'original', value: 'duplicate' }, // Will fail UNIQUE
      ],
    }),
  })

  expect(txResponse.status).toBe(500)

  // new-1 should not exist (rolled back)
  const getResponse = await stub.fetch('http://fake/sql/get?key=new-1')
  expect((await getResponse.json()).row).toBeNull()
})
```

## Example Test File

Here's a complete example demonstrating the patterns:

```typescript
/**
 * Customer Entity Tests
 *
 * Tests CRUD operations for Customer entities using real DO instances.
 *
 * @module do/tests/customer.test
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface Customer {
  $id: string
  $type: 'Customer'
  $createdAt: number
  $updatedAt: number
  name: string
  email?: string
}

// ============================================================================
// HELPERS
// ============================================================================

function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function getStub(name?: string) {
  const testName = name ?? generateTestId()
  const id = env.DO.idFromName(testName)
  return env.DO.get(id)
}

async function createCustomer(stub: DurableObjectStub, data: Partial<Customer>): Promise<Customer> {
  const response = await stub.fetch('https://do/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'things.create',
      args: [{ $type: 'Customer', ...data }]
    }),
  })
  return response.json() as Promise<Customer>
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Customer Entity', () => {
  describe('create', () => {
    it('should create a customer with auto-generated ID', async () => {
      const stub = getStub()

      const customer = await createCustomer(stub, { name: 'Alice' })

      expect(customer.$id).toBeDefined()
      expect(customer.$type).toBe('Customer')
      expect(customer.name).toBe('Alice')
      expect(customer.$createdAt).toBeDefined()
    })

    it('should preserve email when provided', async () => {
      const stub = getStub()

      const customer = await createCustomer(stub, {
        name: 'Bob',
        email: 'bob@example.com'
      })

      expect(customer.email).toBe('bob@example.com')
    })
  })

  describe('isolation', () => {
    it('should isolate data between DO instances', async () => {
      const stub1 = getStub('customer-1-' + generateTestId())
      const stub2 = getStub('customer-2-' + generateTestId())

      const customer1 = await createCustomer(stub1, { name: 'Alice' })
      const customer2 = await createCustomer(stub2, { name: 'Bob' })

      // Different DO instances have different IDs
      expect(customer1.$id).not.toBe(customer2.$id)
    })
  })
})
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run test:run
```

### Key CI Settings

For CI environments, always use these settings to prevent resource exhaustion:

```typescript
test: {
  maxConcurrency: 1,
  maxWorkers: 1,
  fileParallelism: false,
  poolOptions: {
    workers: {
      singleWorker: true,
      isolatedStorage: false,
    },
  },
}
```

## Common Pitfalls

### 1. Mocking Storage (Never Do This)

```typescript
// BAD - Never mock DO storage
const mockStorage = new Map()
vi.spyOn(doInstance.state.storage, 'get')

// GOOD - Use real miniflare
const stub = env.DO.get(env.DO.idFromName('test'))
```

### 2. Not Consuming Response Bodies

```typescript
// BAD - Leaves response body unconsumed, can cause issues
const response = await stub.fetch('https://do/')
expect(response.status).toBe(200)

// GOOD - Always consume the body
const response = await stub.fetch('https://do/')
expect(response.status).toBe(200)
await response.text()  // or .json()
```

### 3. Sharing State Between Tests

```typescript
// BAD - Shared state leaks between tests
const stub = getStub('shared-instance')

// GOOD - Fresh instance per test using unique ID
const stub = getStub(generateTestId())
```

### 4. Not Awaiting Async Operations

```typescript
// BAD - Fire-and-forget
stub.fetch('http://fake/action', { method: 'POST' })

// GOOD - Always await
await stub.fetch('http://fake/action', { method: 'POST' })
```

### 5. Running Multiple Vitest Instances

```bash
# BAD - Multiple parallel vitest processes
npm test & npm run test:do & npm run test:api

# GOOD - Sequential execution
npm run test:run
```

## Summary

1. **Never mock Durable Objects** - Use real Miniflare instances
2. **Use `env` from `cloudflare:test`** - Preferred way to get DO stubs
3. **Generate unique test IDs** - Isolate test data between tests
4. **Limit concurrency** - Miniflare is memory-intensive
5. **Always consume response bodies** - Prevents hanging tests
6. **Test concurrent access** - Verify DO serialization works correctly
7. **Use direct Miniflare** - For complex multi-DO scenarios
8. **Clean up resources** - Call `mf.dispose()` in `afterAll`
