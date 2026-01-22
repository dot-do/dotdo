# @dotdo/rpc

> Type-safe RPC for Cloudflare Workers and Durable Objects

[![npm version](https://img.shields.io/npm/v/@dotdo/rpc.svg)](https://www.npmjs.com/package/@dotdo/rpc)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

## The Problem

Calling between Workers and Durable Objects is verbose:

- **Fetch ceremony** - Every call requires URL construction, JSON serialization, response parsing
- **No type safety** - TypeScript can't help you when everything is `fetch()` and `JSON.parse()`
- **Manual error handling** - HTTP status codes, network errors, timeout handling for each call
- **Lost intellisense** - No autocomplete, no method signatures, no refactoring support

```typescript
// Without RPC - painful
const response = await stub.fetch(new Request('https://do/api/users/create', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Alice', email: 'alice@example.com' })
}))
const data = await response.json()
```

## The Solution

Call remote methods like local functions:

```typescript
import { createClient, createDOStub } from '@dotdo/rpc'

// Type-safe client
const client = createClient<MyAPI>({ url: 'https://api.example.com' })
const user = await client.users.create({ name: 'Alice', email: 'alice@example.com' })

// Type-safe DO stub
const counter = createDOStub<CounterDO>(env.COUNTER, 'my-counter')
const value = await counter.increment()
```

Full TypeScript support. Zero boilerplate.

## Quick Start

### Installation

```bash
npm install @dotdo/rpc
```

### Create an RPC Server

```typescript
import { createServer } from '@dotdo/rpc'

const api = {
  async greet(name: string) {
    return `Hello, ${name}!`
  },
  users: {
    async create(user: { name: string; email: string }) {
      return { id: crypto.randomUUID(), ...user }
    },
    async list() {
      return [{ id: '1', name: 'Alice' }]
    }
  }
}

export default createServer({ target: api })
```

### Create a Typed Client

```typescript
import { createClient } from '@dotdo/rpc'

interface API {
  greet(name: string): Promise<string>
  users: {
    create(user: { name: string; email: string }): Promise<{ id: string }>
    list(): Promise<Array<{ id: string; name: string }>>
  }
}

const client = createClient<API>({ url: 'https://my-worker.dev' })

// Fully typed - autocomplete works!
const greeting = await client.greet('World')
const user = await client.users.create({ name: 'Alice', email: 'alice@example.com' })
```

## Features

### Nested APIs

Support for arbitrary nesting depth:

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

### Durable Object Stubs

Type-safe DO communication:

```typescript
import { createDOStub } from '@dotdo/rpc'

interface CounterDO {
  increment(): Promise<number>
  getValue(): Promise<number>
  reset(): Promise<void>
}

export default {
  async fetch(request: Request, env: Env) {
    const counter = createDOStub<CounterDO>(env.COUNTER, 'global')
    const value = await counter.increment()
    return new Response(`Count: ${value}`)
  }
}
```

### Error Handling

Structured error propagation:

```typescript
try {
  await client.users.delete('non-existent')
} catch (error) {
  if (error.message.includes('RPC error: 404')) {
    console.error('User not found')
  } else if (error.message.includes('RPC error: 500')) {
    console.error('Server error')
  }
}
```

### Custom Timeout

Configure request timeouts:

```typescript
const client = createClient<API>({
  url: 'https://slow-api.example.com',
  timeout: 60000 // 60 seconds
})
```

## API Reference

### `createClient<T>(options)`

Creates a typed proxy client for RPC calls.

```typescript
interface ClientOptions {
  url: string        // Base URL of the RPC endpoint
  timeout?: number   // Request timeout in ms (default: 30000)
}

const client = createClient<MyAPI>({
  url: 'https://api.example.com',
  timeout: 10000
})
```

### `createDOStub<T>(binding, id)`

Creates a typed proxy for a Durable Object stub.

```typescript
const stub = createDOStub<MyDO>(
  env.MY_DO,           // DurableObjectNamespace binding
  'instance-id'        // String name or DurableObjectId
)
```

### `createServer(options)`

Creates an RPC server using Hono.

```typescript
const server = createServer({
  target: {
    async hello() { return 'world' }
  }
})
```

### `createWorkerFromTarget(target)`

Convenience helper for Worker creation.

```typescript
export default createWorkerFromTarget({
  async greet(name: string) {
    return `Hello, ${name}!`
  }
})
```

## Protocol

### Request Format

```json
POST /rpc
{
  "method": "users.create",
  "args": [{ "name": "Alice", "email": "alice@example.com" }]
}
```

### Response Format

```json
{
  "id": "123",
  "name": "Alice",
  "email": "alice@example.com"
}
```

## Examples

### Worker-to-Worker RPC

```typescript
// worker-1.ts (server)
export default createWorkerFromTarget({
  async processData(data: string) {
    return data.toUpperCase()
  }
})

// worker-2.ts (client)
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

### DO-to-DO Communication

```typescript
import { createDOStub } from '@dotdo/rpc'

export class OrderDO {
  constructor(private state: DurableObjectState, private env: Env) {}

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

### Full API Example

```typescript
// types.ts
export interface MyAPI {
  health(): Promise<{ status: string }>
  users: {
    get(id: string): Promise<User | null>
    create(input: CreateUserInput): Promise<User>
    update(id: string, input: UpdateUserInput): Promise<User>
    delete(id: string): Promise<boolean>
    list(options?: ListOptions): Promise<User[]>
  }
  orders: {
    place(input: OrderInput): Promise<Order>
    getStatus(id: string): Promise<OrderStatus>
  }
}

// server.ts
const api: MyAPI = {
  async health() {
    return { status: 'ok' }
  },
  users: {
    async get(id) { /* ... */ },
    async create(input) { /* ... */ },
    async update(id, input) { /* ... */ },
    async delete(id) { /* ... */ },
    async list(options) { /* ... */ }
  },
  orders: {
    async place(input) { /* ... */ },
    async getStatus(id) { /* ... */ }
  }
}

export default createServer({ target: api })

// client.ts
const client = createClient<MyAPI>({ url: 'https://api.example.com' })
const user = await client.users.create({ name: 'Alice', email: 'alice@example.com' })
const order = await client.orders.place({ userId: user.id, items: [...] })
```

## How It Works

### Client Side

1. Property access builds a method path (`users.create` -> `["users", "create"]`)
2. Function call triggers POST to `/rpc` with `{ method, args }`
3. Response is parsed and returned

### Server Side

1. Parses incoming `{ method, args }` from request body
2. Navigates method path on target object
3. Calls function with provided arguments
4. Returns JSON-serialized result

## Related Packages

| Package | Description |
|---------|-------------|
| [@dotdo/do](/do) | Durable Object with built-in RPC support |
| [@dotdo/api](/api) | Self-describing Hono API |
| [@dotdo/db](/db) | Abstract storage layer |

## License

MIT
