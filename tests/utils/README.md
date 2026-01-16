# Shared Test Utilities - Wave 2 REFACTOR [do-q7hy]

Centralized test utilities module for use across all test files in the dotdo project.

## Overview

`tests/utils/index.ts` provides shared test utilities and fixtures to reduce code duplication and standardize test setup across the codebase:

- **Auth fixtures**: JWT tokens, API keys, test users
- **DO test helpers**: Instance creation, data seeding, cleanup
- **HTTP test helpers**: Mock requests, Hono context creation
- **Common fixtures**: Pre-defined test data (customers, orders, products)

## Quick Start

```typescript
import {
  // Auth
  createTestJwt,
  createExpiredJwt,
  createSimpleTestJwt,
  mockApiKey,
  createTestUser,
  TEST_USERS,

  // DO helpers
  createTestDO,
  seedThings,
  cleanupThings,

  // HTTP helpers
  createMockRequest,
  createMockRequestWithAuth,
  createMockRequestWithApiKey,
  createMockHonoContext,

  // Fixtures
  testCustomers,
  testOrders,
  testProducts,
} from '../utils'
```

## Auth Fixtures

### JWT Tokens

#### `createTestJwt(payload?, secret?)`

Creates a properly signed JWT token using the jose library. Useful for testing authentication that validates signatures.

**Parameters:**
- `payload`: JWT payload options (sub, email, org_id, permissions, expiresIn, issuedAt)
- `secret`: Secret key for signing (defaults to safe test secret)

**Returns:** Promise<string> - JWT token

**Example:**
```typescript
import { createTestJwt } from '../utils'

// Default token
const token = await createTestJwt()

// Admin token
const adminToken = await createTestJwt({
  permissions: ['admin:users:read', 'admin:users:write']
})

// Custom subject and organization
const customToken = await createTestJwt({
  sub: 'user-456',
  org_id: 'org-789',
  permissions: ['read', 'write']
})
```

#### `createExpiredJwt(secret?)`

Creates an expired JWT token (expired 1 hour ago). Useful for testing token expiration handling.

**Parameters:**
- `secret`: Secret key for signing (defaults to safe test secret)

**Returns:** Promise<string> - Expired JWT token

**Example:**
```typescript
const expiredToken = await createExpiredJwt()

// Test that middleware rejects expired tokens
const response = await fetch('/protected', {
  headers: { Authorization: `Bearer ${expiredToken}` }
})

expect(response.status).toBe(401)
```

#### `createSimpleTestJwt(options?)`

Creates a simple JWT token synchronously without cryptographic signing. Useful for middleware that only decodes payloads without verifying signatures.

**Parameters:**
- `options`: JWT options (sub, permissions, exp, iat)

**Returns:** string - JWT token

**Example:**
```typescript
const token = createSimpleTestJwt({
  sub: 'test-user',
  permissions: ['read', 'write']
})
```

#### `createInvalidSignatureJwt()`

Creates a JWT token with a tampered signature. Useful for testing signature validation.

**Returns:** string - JWT with invalid signature

#### `TEST_USERS`

Predefined test users for common scenarios:
- `admin`: Full permissions
- `standardUser`: Read/write permissions
- `readOnlyUser`: Read-only permissions

**Example:**
```typescript
import { TEST_USERS } from '../utils'

const adminToken = await createTestJwt({
  sub: TEST_USERS.admin.id,
  permissions: TEST_USERS.admin.permissions
})
```

### API Keys

#### `mockApiKey(options?)`

Generates a mock API key for testing API key authentication.

**Parameters:**
- `options`: API key options (prefix, length)

**Returns:** string - Mock API key

**Example:**
```typescript
const apiKey = mockApiKey()
// -> 'sk_test_abcdef123456...'

const customKey = mockApiKey({
  prefix: 'test_',
  length: 32
})
```

### Test Users

#### `createTestUser(overrides?)`

Creates a test user object with optional overrides.

**Parameters:**
- `overrides`: Properties to override defaults

**Returns:** TestUser object

**Example:**
```typescript
const user = createTestUser()
const adminUser = createTestUser({
  role: 'admin',
  permissions: ['*']
})
```

## DO Test Helpers

### Instance Creation

#### `createTestDO(binding?, name?)`

Creates a test DO instance with unique or specified name.

**Parameters:**
- `binding`: DO binding from env (defaults to env.DOCore)
- `name`: Optional name (auto-generates if not provided)

**Returns:** DOCoreTestInstance

**Example:**
```typescript
// Auto-generated unique name
const doInstance = createTestDO()

// Specific binding
const doInstance = createTestDO(env.DOCore)

// Specific name
const namedDO = createTestDO(env.DOCore, 'my-test-instance')
```

### Data Seeding

#### `seedThings(stub, type, items)`

Seeds multiple test items into a DO instance.

**Parameters:**
- `stub`: DO stub instance
- `type`: Noun type (e.g., 'Customer', 'Order')
- `items`: Array of item data

**Returns:** Promise<ThingData[]> - Created items

**Example:**
```typescript
const customers = await seedThings(doInstance, 'Customer', [
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob', email: 'bob@example.com' },
  { name: 'Charlie', email: 'charlie@example.com' }
])

expect(customers).toHaveLength(3)
```

### Cleanup

#### `cleanupThings(stub, type)`

Cleans up all test data of a specified type.

**Parameters:**
- `stub`: DO stub instance
- `type`: Noun type to clean

**Returns:** Promise<number> - Number of items deleted

**Example:**
```typescript
const deletedCount = await cleanupThings(doInstance, 'Customer')
```

## HTTP Test Helpers

### Request Creation

#### `createMockRequest(path, options?)`

Creates a mock HTTP Request object for testing.

**Parameters:**
- `path`: Request path (e.g., '/api/users')
- `options`: Request options (method, headers, body, query, auth)

**Returns:** Request

**Example:**
```typescript
// GET request
const getReq = createMockRequest('/api/users')

// POST with body
const postReq = createMockRequest('/api/users', {
  method: 'POST',
  body: JSON.stringify({ name: 'Alice' }),
  headers: { 'Content-Type': 'application/json' }
})

// With query parameters
const queryReq = createMockRequest('/api/users', {
  query: { page: '1', limit: '10' }
})
```

#### `createMockRequestWithAuth(path, token, options?)`

Creates a mock request with Bearer token authorization.

**Parameters:**
- `path`: Request path
- `token`: JWT token
- `options`: Additional request options

**Returns:** Request

**Example:**
```typescript
const token = await createTestJwt()
const req = createMockRequestWithAuth('/protected', token)
```

#### `createMockRequestWithApiKey(path, apiKey, options?)`

Creates a mock request with API key authorization.

**Parameters:**
- `path`: Request path
- `apiKey`: API key
- `options`: Additional request options

**Returns:** Request

**Example:**
```typescript
const apiKey = mockApiKey()
const req = createMockRequestWithApiKey('/api/data', apiKey)
```

### Hono Context

#### `createMockHonoContext(path?, options?)`

Creates a mock Hono context for testing handlers.

**Parameters:**
- `path`: Request path (defaults to '/')
- `options`: Request options

**Returns:** Mock Hono context object

**Example:**
```typescript
const ctx = createMockHonoContext('/api/users')

// Use in handler test
const response = await userHandler(ctx)
expect(response.status).toBe(200)
```

## Common Fixtures

Pre-defined test data for bulk testing:

### `testCustomers`

Array of 4 sample customer objects with varied data:
- Alice Johnson (premium, VIP)
- Bob Smith (standard)
- Charlie Brown (new)
- Diana Prince (premium, verified)

**Example:**
```typescript
import { testCustomers } from '../utils'

for (const customer of testCustomers) {
  await doInstance.create('Customer', customer)
}
```

### `testOrders`

Array of 3 sample order objects:
- Alice's order (pending)
- Bob's order (processing)
- Charlie's order (shipped)

**Example:**
```typescript
import { testOrders } from '../utils'

const orders = await seedThings(doInstance, 'Order', testOrders)
```

### `testProducts`

Array of 4 sample product objects:
- Premium Widget
- Basic Widget
- Advanced Gadget
- Pro Gadget

## Migration Guide

### Before (Duplicated Code)

```typescript
// In multiple test files
async function createTestJwt(options = {}) {
  const secretKey = new TextEncoder().encode('test-secret')
  return await new jose.SignJWT({
    sub: options.sub || 'test-user-123',
    permissions: options.permissions || [],
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secretKey)
}

function getCore(name = 'test') {
  const id = env.DOCore.idFromName(name)
  return env.DOCore.get(id)
}
```

### After (Using Shared Utilities)

```typescript
import { createTestJwt, createTestDO } from '../utils'

const token = await createTestJwt()
const doInstance = createTestDO(env.DOCore, 'test-name')
```

## Integration Examples

### Authentication Test

```typescript
import { createTestJwt, createMockRequestWithAuth } from '../utils'

it('should accept valid auth token', async () => {
  const token = await createTestJwt({
    permissions: ['users:read']
  })

  const req = createMockRequestWithAuth('/protected', token)
  const response = await handler(req)

  expect(response.status).toBe(200)
})
```

### DO Integration Test

```typescript
import { createTestDO, seedThings, testCustomers } from '../utils'

it('should list all customers', async () => {
  const doInstance = createTestDO()

  const customers = await seedThings(
    doInstance,
    'Customer',
    testCustomers
  )

  expect(customers).toHaveLength(testCustomers.length)
})
```

### HTTP Handler Test

```typescript
import {
  createMockHonoContext,
  createTestJwt,
  TEST_USERS
} from '../utils'

it('should handle authenticated requests', async () => {
  const adminToken = await createTestJwt({
    sub: TEST_USERS.admin.id,
    permissions: TEST_USERS.admin.permissions
  })

  const ctx = createMockHonoContext('/admin/users', {
    auth: `Bearer ${adminToken}`
  })

  const response = await adminHandler(ctx)
  expect(response.status).toBe(200)
})
```

## Best Practices

1. **Use async `createTestJwt` for signature validation tests** - Use async version when testing middleware that validates JWT signatures.

2. **Use synchronous `createSimpleTestJwt` for payload-only tests** - Use for middleware that only decodes payloads without signature verification.

3. **Import only what you need** - Don't import the entire utils module if testing only auth:
   ```typescript
   import { createTestJwt, createExpiredJwt } from '../utils'
   ```

4. **Use predefined fixtures for consistency** - Use `testCustomers`, `testOrders`, etc. instead of creating custom data for common scenarios.

5. **Clean up after tests** - Use `cleanupThings()` in test teardown to prevent state pollution:
   ```typescript
   afterEach(async () => {
     await cleanupThings(doInstance, 'Customer')
   })
   ```

6. **Name DO instances descriptively** - Use meaningful names for test isolation:
   ```typescript
   const doInstance = createTestDO(env.DOCore, 'list-pagination-test-1')
   ```

## Testing the Test Utilities

The test utilities themselves are validated in:
- `/tests/helpers/do-test-utils.test.ts` - DO helper tests
- `/core/core.test.ts` - Core DO tests using utilities
- `/tests/hierarchy.test.ts` - Hierarchy tests using utilities
- `/tests/security/endpoint-auth.test.ts` - Security tests using utilities

## Files Modified

- **Created:** `/tests/utils/index.ts` - Main utilities module
- **Updated:** `/core/core.test.ts` - Uses `createTestDO`, `createSimpleTestJwt`
- **Updated:** `/tests/hierarchy.test.ts` - Uses `createTestDO`
- **Updated:** `/tests/security/endpoint-auth.test.ts` - Uses auth utilities

## Related Issues

- Wave 2 REFACTOR [do-q7hy] - Create shared test utilities
- Previous helpers available at `/tests/helpers/do-test-utils.ts`
