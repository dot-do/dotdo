# Getting Started with dotdo

This guide provides a quick introduction to building applications with dotdo, the semantic runtime for Cloudflare Durable Objects.

## What is dotdo?

dotdo is a runtime framework (like Node.js) that lets you model your domain using semantic primitives instead of raw database tables. It provides:

- **DOCore** - Base Durable Object class with SQLite, Hono routing, and WebSocket support
- **WorkflowContext ($)** - Event handlers, scheduling DSL, and durable execution
- **Modules** - Extracted concerns (events, schedule, storage) as RPC-compatible targets
- **Cap'n Web RPC** - Type-safe remote procedure calls with promise pipelining

## Prerequisites

- Node.js 18+
- Cloudflare account (free tier works)
- Basic familiarity with TypeScript

## Quick Install

```bash
# Create a new project
mkdir my-do-app && cd my-do-app
npm init -y

# Install dependencies
npm install hono
npm install -D wrangler typescript @cloudflare/workers-types vitest @cloudflare/vitest-pool-workers
```

## Minimal Example

Here's a complete Durable Object with state management and HTTP routing:

```typescript
// src/index.ts
import { DurableObject } from 'cloudflare:workers'
import { Hono } from 'hono'

interface Env {
  Counter: DurableObjectNamespace<Counter>
}

export class Counter extends DurableObject<Env> {
  private app: Hono

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Initialize SQLite table
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS state (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `)

    this.app = new Hono()
      .get('/count', async (c) => {
        const count = await this.getCount()
        return c.json({ count })
      })
      .post('/increment', async (c) => {
        const count = await this.increment()
        return c.json({ count })
      })
  }

  // RPC method - callable directly from worker or other DOs
  async getCount(): Promise<number> {
    const result = this.ctx.storage.sql
      .exec('SELECT value FROM state WHERE key = ?', 'count')
      .toArray()
    return result.length > 0 ? JSON.parse(result[0].value as string) : 0
  }

  // RPC method
  async increment(): Promise<number> {
    const count = (await this.getCount()) + 1
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)',
      'count',
      JSON.stringify(count)
    )
    return count
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request)
  }
}

// Worker entry point
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.Counter.idFromName('default')
    const stub = env.Counter.get(id)
    return stub.fetch(request)
  },
}
```

### wrangler.toml

```toml
name = "my-do-app"
main = "src/index.ts"
compatibility_date = "2024-12-30"

[durable_objects]
bindings = [
  { name = "Counter", class_name = "Counter" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Counter"]
```

## Using DOCore

For more advanced features, extend `DOCore` from `@dotdo/core`:

```typescript
import { DOCore, type DOCoreEnv } from '@dotdo/core'

interface Env extends DOCoreEnv {
  MyDO: DurableObjectNamespace<MyDO>
}

export class MyDO extends DOCore {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Register event handlers
    this.on.Customer.created(async (event) => {
      console.log('Customer created:', event.data)
    })

    // Schedule recurring tasks
    this.every.day.at('9am')(async () => {
      console.log('Daily task running')
    })
  }

  // Your custom RPC methods
  async createCustomer(data: { name: string; email: string }) {
    return this.Customer().create(data)
  }

  async listCustomers() {
    return this.Customer().list()
  }
}
```

DOCore provides:

- **State management** - `this.get(key)`, `this.set(key, value)`, `this.delete(key)`, `this.list(options)`
- **Noun accessors** - `this.Customer()`, `this.Order()`, or `this.noun('AnyType')`
- **Event system** - `this.on.Noun.verb(handler)` with wildcard support
- **Scheduling** - `this.every.day.at('9am')(handler)`, `this.every(5).minutes(handler)`
- **Durable execution** - `this.send(event)`, `this.try(action)`, `this.do(action)`

## WorkflowContext ($)

The WorkflowContext provides a unified API for DO operations:

```typescript
import { createWorkflowContext } from '@dotdo/core'

const $ = createWorkflowContext()

// Event handlers with Noun.verb pattern
$.on.Order.placed(async (event) => {
  await $.Customer(event.data.customerId).notify('Order placed!')
})

// Wildcard handlers
$.on['*'].created(async (event) => {
  console.log('Something was created:', event.type)
})

// Scheduling DSL (compiles to CRON)
$.every.Monday.at9am(weeklyReport)          // "0 9 * * 1"
$.every.day.at('6pm')(dailyCleanup)         // "0 18 * * *"
$.every(15).minutes(healthCheck)            // "*/15 * * * *"

// Durable execution with three levels
$.send('Order.placed', data)                // Fire-and-forget
await $.try(() => processOrder())           // Single attempt
await $.do(() => chargePayment(), {         // Retry + replay protection
  stepId: 'payment-123',
  maxRetries: 3
})

// Cross-DO RPC
const customer = await $.Customer('alice').get()
await $.Order('order-123').ship()
```

## Testing (No Mocks Required)

Miniflare runs real Durable Objects with real SQLite locally:

```typescript
import { env } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'

describe('Counter', () => {
  it('increments count', async () => {
    const stub = env.Counter.get(env.Counter.idFromName('test'))

    // RPC call - direct method invocation
    const count1 = await stub.increment()
    expect(count1).toBe(1)

    const count2 = await stub.increment()
    expect(count2).toBe(2)
  })

  it('responds to HTTP requests', async () => {
    const stub = env.Counter.get(env.Counter.idFromName('http-test'))

    const response = await stub.fetch('http://test/count')
    const data = await response.json()

    expect(data.count).toBe(0)
  })
})
```

### vitest.config.ts

```typescript
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
})
```

## Development Commands

```bash
npm run dev          # Start wrangler dev server
npm test             # Run vitest in watch mode
npm run test:run     # Run tests once
npm run typecheck    # TypeScript check
npm run deploy       # Deploy to Cloudflare
```

## Next Steps

- [Core Concepts](./getting-started/concepts.mdx) - Understand semantic types (Nouns, Verbs, Things, Actions)
- [API Reference](./api/) - Full API documentation
- [Architecture](./architecture.md) - System design and ADRs
- [Examples](../examples/) - Complete example applications

## Multi-Tenancy

Each DO instance is isolated. Route by subdomain or path to create per-tenant DOs:

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Extract tenant from subdomain: tenant.api.example.com
    const hostParts = url.hostname.split('.')
    const tenant = hostParts.length > 2 ? hostParts[0] : 'default'

    // Each tenant gets isolated DO with own SQLite
    const id = env.DO.idFromName(tenant)
    const stub = env.DO.get(id)

    return stub.fetch(request)
  },
}
```

## Troubleshooting

### SQLite not available

Ensure your `wrangler.toml` includes the SQLite migration:

```toml
[[migrations]]
tag = "v1"
new_sqlite_classes = ["YourDOClass"]
```

### Memory issues with Vitest

Never run multiple Vitest instances in parallel. Kill orphan processes:

```bash
pkill -9 -f vitest; pkill -9 -f vite
```

### Module resolution errors

Check that `@cloudflare/workers-types` is in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["@cloudflare/workers-types"]
  }
}
```
