# @dotdo/rpc

Cap'n Web RPC layer for dotdo. Type-safe remote procedure calls using Proxy-based method invocation.

## Overview

`@dotdo/rpc` handles all communication patterns in dotdo:
- Client → Worker
- Worker → Worker
- Worker → DO (Durable Object)
- DO → Worker
- DO → DO

Built on top of [Cap'n Web](https://capnweb.org), it provides a zero-config RPC solution with full TypeScript support.

## Installation

```bash
npm install @dotdo/rpc
```

## Quick Start

### Server

Create an RPC server that exposes methods via HTTP:

```typescript
import { createServer } from '@dotdo/rpc'

const api = {
  async greet(name: string) {
    return `Hello, ${name}!`
  },
  users: {
    async create(user: { name: string; email: string }) {
      return { id: '123', ...user }
    },
    async list() {
      return [{ id: '123', name: 'Alice' }]
    }
  }
}

export default createServer({ target: api })
```

### Client

Connect to the RPC server with full type safety:

```typescript
import { createClient } from '@dotdo/rpc'

interface API {
  greet(name: string): Promise<string>
  users: {
    create(user: { name: string; email: string }): Promise<{ id: string }>
    list(): Promise<Array<{ id: string; name: string }>>
  }
}

const client = createClient<API>({
  url: 'https://my-worker.dev'
})

// Fully typed method calls
const greeting = await client.greet('World')
const user = await client.users.create({
  name: 'Alice',
  email: 'alice@example.com'
})
```

## API Reference

### `createClient<T>(options)`

Creates a typed proxy client that forwards method calls via RPC.

**Options:**
- `url` (string): Base URL of the RPC endpoint
- `timeout` (number, optional): Request timeout in milliseconds (default: 30000)

**Returns:** Typed proxy of type `T`

**Example:**
```typescript
const client = createClient<MyAPI>({
  url: 'https://api.example.com',
  timeout: 10000
})
```

### `createDOStub<T>(binding, id)`

Creates a typed proxy for a Durable Object stub.

**Parameters:**
- `binding` (DurableObjectNamespace): The DO namespace binding
- `id` (string | DurableObjectId): Either a string name or a DurableObjectId

**Returns:** Typed proxy of type `T`

**Example:**
```typescript
interface CounterDO {
  increment(): Promise<number>
  getValue(): Promise<number>
}

// In a Worker
export default {
  async fetch(request: Request, env: Env) {
    const counter = createDOStub<CounterDO>(env.COUNTER, 'my-counter')
    const value = await counter.increment()
    return new Response(`Count: ${value}`)
  }
}
```

### `createServer(options)`

Creates an RPC server using Hono that exposes methods via HTTP.

**Options:**
- `target` (object): Object containing methods to expose

**Returns:** Hono app instance

**Example:**
```typescript
const server = createServer({
  target: {
    async hello() { return 'world' }
  }
})
```

### `createWorkerFromTarget(target)`

Convenience helper to create a Cloudflare Worker from a target object.

**Parameters:**
- `target` (object): Object containing methods to expose

**Returns:** Worker-compatible object with `fetch` method

**Example:**
```typescript
export default createWorkerFromTarget({
  async greet(name: string) {
    return `Hello, ${name}!`
  }
})
```

## Advanced Usage

### Nested APIs

The proxy supports arbitrary nesting:

```typescript
const client = createClient<{
  v1: {
    customers: {
      orders: {
        list(customerId: string): Promise<Order[]>
      }
    }
  }
}>({ url: 'https://api.example.com' })

const orders = await client.v1.customers.orders.list('customer-123')
```

### Error Handling

The RPC layer provides typed errors that are preserved across DO boundaries:

```typescript
import {
  RPCError,
  RPCErrorCode,
  NotFoundError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  isNotFoundError,
  isValidationError,
  isRPCError,
} from '@dotdo/rpc'

try {
  await client.someMethod()
} catch (error) {
  // Type guards for specific error handling
  if (isNotFoundError(error)) {
    console.error(`Resource not found: ${error.details?.resourceId}`)
  } else if (isValidationError(error)) {
    console.error(`Validation failed: ${error.details?.errors}`)
  } else if (isRPCError(error)) {
    // Handle any RPC error
    console.error(`RPC error [${error.code}]: ${error.message}`)
  }
}
```

**Built-in Error Types:**

| Error Type | Code | HTTP Status | Use Case |
|------------|------|-------------|----------|
| `NotFoundError` | `NOT_FOUND` | 404 | Resource not found |
| `ValidationError` | `VALIDATION_ERROR` | 400 | Invalid input |
| `AuthenticationError` | `AUTHENTICATION_ERROR` | 401 | Auth required |
| `AuthorizationError` | `AUTHORIZATION_ERROR` | 403 | Access denied |
| `ConflictError` | `CONFLICT` | 409 | Resource conflict |
| `RateLimitError` | `RATE_LIMIT` | 429 | Rate limit exceeded |
| `TimeoutError` | `TIMEOUT` | 504 | Request timeout |
| `NetworkError` | `NETWORK_ERROR` | 503 | Network failure |
| `InternalError` | `INTERNAL_ERROR` | 500 | Server error |
| `CircuitOpenError` | `CIRCUIT_OPEN` | 503 | Circuit breaker open |

**Creating Errors on the Server:**

```typescript
import { NotFoundError, ValidationError } from '@dotdo/rpc'

async function getUser(id: string) {
  const user = await db.users.get(id)
  if (!user) {
    throw NotFoundError.forResource('User', id)
  }
  return user
}

async function createUser(data: UserInput) {
  const errors = validate(data)
  if (errors.length > 0) {
    throw ValidationError.withErrors(errors)
  }
  return db.users.create(data)
}
```

**Known Limitations:**

1. **Custom error subclasses**: Custom RPCError subclasses will fall back to base RPCError when crossing boundaries. Use built-in error types with rich `details` instead.

2. **Error cause chains**: The `cause` property is not serialized. Include relevant cause info in the error message or `details` field.

### Custom Timeout

```typescript
const client = createClient<API>({
  url: 'https://slow-api.example.com',
  timeout: 60000 // 60 seconds
})
```

## How It Works

### Client Side

The client uses JavaScript Proxies to intercept method calls and convert them to RPC requests:

1. Property access builds a path (e.g., `users.create` → `["users", "create"]`)
2. Function call triggers a POST to `/rpc` with `{ method: "users.create", args: [...] }`
3. Response is automatically parsed and returned

### Server Side

The server receives RPC requests and dispatches them to the target object:

1. Parses incoming `{ method, args }` from request body
2. Navigates the method path on the target object
3. Calls the function with provided arguments
4. Returns JSON-serialized result

### Protocol

**Request:**
```json
POST /rpc
{
  "method": "users.create",
  "args": [{ "name": "Alice", "email": "alice@example.com" }]
}
```

**Response:**
```json
{
  "id": "123",
  "name": "Alice",
  "email": "alice@example.com"
}
```

## TypeScript Support

Full type safety with TypeScript generics:

```typescript
// Define your API interface
interface MyAPI {
  greet(name: string): Promise<string>
  add(a: number, b: number): Promise<number>
}

// Client is fully typed
const client = createClient<MyAPI>({ url: '...' })

// TypeScript knows these are valid
await client.greet('World')  // ✓
await client.add(1, 2)       // ✓

// TypeScript catches errors
await client.greet(123)      // ✗ Type error
await client.unknown()       // ✗ Type error
```

## Examples

### Worker-to-Worker RPC

```typescript
// worker-1.ts
export default createWorkerFromTarget({
  async processData(data: string) {
    return data.toUpperCase()
  }
})

// worker-2.ts
export default {
  async fetch(request: Request, env: Env) {
    const worker1 = createClient<{ processData(data: string): Promise<string> }>({
      url: 'https://worker-1.example.workers.dev'
    })

    const result = await worker1.processData('hello')
    return new Response(result) // "HELLO"
  }
}
```

### Worker-to-DO Communication

```typescript
// counter-do.ts
export class CounterDO {
  private count = 0

  async increment() {
    return ++this.count
  }

  async getValue() {
    return this.count
  }
}

// worker.ts
export default {
  async fetch(request: Request, env: Env) {
    const counter = createDOStub<{
      increment(): Promise<number>
      getValue(): Promise<number>
    }>(env.COUNTER, 'global')

    const value = await counter.increment()
    return new Response(`Count: ${value}`)
  }
}
```

### DO-to-DO Communication

```typescript
// In a Durable Object
import { createDOStub } from '@dotdo/rpc'

export class OrderDO {
  async ship(orderId: string) {
    // Call another DO
    const inventory = createDOStub<InventoryDO>(
      this.env.INVENTORY,
      'warehouse-1'
    )

    await inventory.decrementStock(orderId)
    return { status: 'shipped' }
  }
}
```

## Related Packages

- [@dotdo/do](/do) - Durable Object base class with built-in RPC support
- [@dotdo/api](/api) - Self-describing API layer built on RPC

## License

MIT
