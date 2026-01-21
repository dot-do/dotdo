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
