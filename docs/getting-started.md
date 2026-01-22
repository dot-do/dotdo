# Getting Started with dotdo

This comprehensive guide walks you through building production-ready Durable Objects with dotdo. By the end, you will have built a fully functional counter application with HTTP endpoints, RPC methods, persistence, and tests.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Project Setup](#project-setup)
3. [Your First DO: Counter](#your-first-do-counter)
4. [Adding HTTP Routes with Hono](#adding-http-routes-with-hono)
5. [RPC Communication](#rpc-communication)
6. [Testing with Miniflare](#testing-with-miniflare)
7. [Deployment](#deployment)
8. [Next Steps](#next-steps)

---

## Prerequisites

Before starting, ensure you have the following installed and configured.

### Node.js

dotdo requires Node.js 18.0 or later (Node.js 20+ recommended).

```bash
# Check your Node version
node --version

# Install via nvm (recommended)
nvm install 20
nvm use 20
```

### Wrangler CLI

Wrangler is Cloudflare's CLI for Workers development.

```bash
# Install globally
npm install -g wrangler

# Verify installation
wrangler --version
```

### Cloudflare Account

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com)
2. Authenticate Wrangler with your account:

```bash
wrangler login
```

This opens a browser window for OAuth authentication. After authorizing, Wrangler stores your credentials locally.

### Verify Setup

Run these commands to confirm everything is ready:

```bash
node --version    # Should be v18.0.0 or higher
wrangler --version # Should be v3.0.0 or higher
wrangler whoami   # Should show your Cloudflare account
```

---

## Project Setup

### Option 1: Using dotdo init (Recommended)

The fastest way to start a new project:

```bash
npx dotdo init my-counter-app
cd my-counter-app
npm install
```

This scaffolds a complete project with:
- TypeScript configuration
- Wrangler configuration
- Example DO class
- Test setup with Vitest

### Option 2: Manual Setup

For more control, create the project manually:

```bash
mkdir my-counter-app
cd my-counter-app
npm init -y
```

Install dependencies:

```bash
npm install dotdo hono
npm install -D typescript wrangler @cloudflare/workers-types vitest @cloudflare/vitest-pool-workers
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

Create `wrangler.toml`:

```toml
name = "my-counter-app"
main = "src/index.ts"
compatibility_date = "2024-12-30"

[durable_objects]
bindings = [
  { name = "COUNTER", class_name = "Counter" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Counter"]
```

### Project Structure

Your project should look like this:

```
my-counter-app/
├── src/
│   ├── index.ts          # Worker entry point
│   └── counter.ts        # Counter DO class
├── tests/
│   └── counter.test.ts   # Tests
├── package.json
├── tsconfig.json
├── wrangler.toml
└── vitest.config.ts
```

Create the `src` directory:

```bash
mkdir -p src tests
```

---

## Your First DO: Counter

Let's build a counter Durable Object that demonstrates the core concepts: state management, SQLite persistence, and the DO lifecycle.

### Understanding Durable Objects

A Durable Object is a JavaScript class that:

1. **Has a unique ID** - Each instance is globally unique and addressable
2. **Has persistent storage** - SQLite database survives restarts
3. **Is single-threaded** - No concurrent access, no locks needed
4. **Lives globally** - Runs closest to where it's accessed

### Create the Counter DO

Create `src/counter.ts`:

```typescript
import { DurableObject } from 'cloudflare:workers'

// Type definitions
export interface Env {
  COUNTER: DurableObjectNamespace<Counter>
}

interface CounterState {
  value: number
  lastUpdated: string
}

export class Counter extends DurableObject<Env> {
  private initialized = false

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  // Initialize SQLite schema on first access
  private ensureInitialized(): void {
    if (this.initialized) return

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)

    this.initialized = true
  }

  // State helpers
  private getState<T>(key: string, defaultValue: T): T {
    this.ensureInitialized()

    const results = this.ctx.storage.sql
      .exec('SELECT value FROM state WHERE key = ?', key)
      .toArray()

    if (results.length === 0) return defaultValue
    return JSON.parse(results[0].value as string)
  }

  private setState(key: string, value: unknown): void {
    this.ensureInitialized()

    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)',
      key,
      JSON.stringify(value)
    )
  }

  // Counter methods
  async getValue(): Promise<CounterState> {
    return this.getState<CounterState>('counter', {
      value: 0,
      lastUpdated: new Date().toISOString()
    })
  }

  async increment(amount: number = 1): Promise<CounterState> {
    const current = await this.getValue()
    const updated: CounterState = {
      value: current.value + amount,
      lastUpdated: new Date().toISOString()
    }
    this.setState('counter', updated)
    return updated
  }

  async decrement(amount: number = 1): Promise<CounterState> {
    return this.increment(-amount)
  }

  async reset(): Promise<CounterState> {
    const state: CounterState = {
      value: 0,
      lastUpdated: new Date().toISOString()
    }
    this.setState('counter', state)
    return state
  }

  // HTTP handler (we'll expand this next)
  async fetch(request: Request): Promise<Response> {
    const state = await this.getValue()
    return new Response(JSON.stringify(state), {
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
```

### Create the Worker Entry Point

Create `src/index.ts`:

```typescript
import { Counter } from './counter'
import type { Env } from './counter'

// Export the DO class for Cloudflare
export { Counter }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Route: /counter/:name
    const match = url.pathname.match(/^\/counter\/([^\/]+)(.*)$/)
    if (match) {
      const [, name, rest] = match

      // Get or create a counter with this name
      const id = env.COUNTER.idFromName(name)
      const stub = env.COUNTER.get(id)

      // Forward to the DO with rewritten path
      const doUrl = new URL(request.url)
      doUrl.pathname = rest || '/'

      return stub.fetch(new Request(doUrl, request))
    }

    // Default: list available endpoints
    return new Response(JSON.stringify({
      endpoints: {
        'GET /counter/:name': 'Get counter value',
        'POST /counter/:name/increment': 'Increment counter',
        'POST /counter/:name/decrement': 'Decrement counter',
        'POST /counter/:name/reset': 'Reset counter to 0',
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
```

### Test It Locally

Start the development server:

```bash
npm run dev
# or
wrangler dev
```

Test with curl:

```bash
# Get counter value (creates new counter if doesn't exist)
curl http://localhost:8787/counter/my-counter
# {"value":0,"lastUpdated":"2024-01-20T12:00:00.000Z"}
```

---

## Adding HTTP Routes with Hono

The basic `fetch` handler works, but real applications need proper routing, middleware, and error handling. Hono provides these with minimal overhead.

### Update the Counter DO

Replace the content of `src/counter.ts`:

```typescript
import { DurableObject } from 'cloudflare:workers'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

export interface Env {
  COUNTER: DurableObjectNamespace<Counter>
}

interface CounterState {
  value: number
  lastUpdated: string
}

export class Counter extends DurableObject<Env> {
  private app: Hono
  private initialized = false

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.app = this.createApp()
  }

  // Initialize SQLite schema
  private ensureInitialized(): void {
    if (this.initialized) return

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)

    this.initialized = true
  }

  // State helpers
  private getState<T>(key: string, defaultValue: T): T {
    this.ensureInitialized()

    const results = this.ctx.storage.sql
      .exec('SELECT value FROM state WHERE key = ?', key)
      .toArray()

    if (results.length === 0) return defaultValue
    return JSON.parse(results[0].value as string)
  }

  private setState(key: string, value: unknown): void {
    this.ensureInitialized()

    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)',
      key,
      JSON.stringify(value)
    )
  }

  // Counter operations
  async getValue(): Promise<CounterState> {
    return this.getState<CounterState>('counter', {
      value: 0,
      lastUpdated: new Date().toISOString()
    })
  }

  async increment(amount: number = 1): Promise<CounterState> {
    const current = await this.getValue()
    const updated: CounterState = {
      value: current.value + amount,
      lastUpdated: new Date().toISOString()
    }
    this.setState('counter', updated)
    return updated
  }

  async decrement(amount: number = 1): Promise<CounterState> {
    return this.increment(-amount)
  }

  async reset(): Promise<CounterState> {
    const state: CounterState = {
      value: 0,
      lastUpdated: new Date().toISOString()
    }
    this.setState('counter', state)
    return state
  }

  // Create Hono app with routes
  private createApp(): Hono {
    const app = new Hono()

    // Middleware
    app.use('/*', cors())

    // Error handling
    app.onError((err, c) => {
      console.error('Counter error:', err)
      return c.json({ error: err.message }, 500)
    })

    // GET / - Get current counter value
    app.get('/', async (c) => {
      const state = await this.getValue()
      return c.json({
        ...state,
        id: this.ctx.id.toString()
      })
    })

    // POST /increment - Increment counter
    app.post('/increment', async (c) => {
      let amount = 1

      // Support optional amount in body
      try {
        const body = await c.req.json()
        if (typeof body.amount === 'number') {
          amount = body.amount
        }
      } catch {
        // No body or invalid JSON, use default
      }

      const state = await this.increment(amount)
      return c.json(state)
    })

    // POST /decrement - Decrement counter
    app.post('/decrement', async (c) => {
      let amount = 1

      try {
        const body = await c.req.json()
        if (typeof body.amount === 'number') {
          amount = body.amount
        }
      } catch {
        // Use default
      }

      const state = await this.decrement(amount)
      return c.json(state)
    })

    // POST /reset - Reset counter to 0
    app.post('/reset', async (c) => {
      const state = await this.reset()
      return c.json(state)
    })

    // GET /history - Get operation history (bonus feature)
    app.get('/history', async (c) => {
      const history = this.getState<string[]>('history', [])
      return c.json({ history })
    })

    return app
  }

  // Handle all HTTP requests
  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request)
  }
}
```

### Test the Routes

```bash
# Start dev server
npm run dev

# Get value
curl http://localhost:8787/counter/my-counter

# Increment by 1
curl -X POST http://localhost:8787/counter/my-counter/increment

# Increment by 5
curl -X POST http://localhost:8787/counter/my-counter/increment \
  -H "Content-Type: application/json" \
  -d '{"amount": 5}'

# Decrement
curl -X POST http://localhost:8787/counter/my-counter/decrement

# Reset
curl -X POST http://localhost:8787/counter/my-counter/reset
```

---

## RPC Communication

HTTP is great for external clients, but for Worker-to-DO and DO-to-DO communication, RPC is more efficient. Public methods on your DO class are automatically exposed as RPC methods.

### Calling DO Methods via RPC

Update `src/index.ts` to demonstrate RPC:

```typescript
import { Counter } from './counter'
import type { Env } from './counter'

export { Counter }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // RPC example: /rpc/:name/:method
    const rpcMatch = url.pathname.match(/^\/rpc\/([^\/]+)\/(\w+)$/)
    if (rpcMatch) {
      const [, name, method] = rpcMatch

      const id = env.COUNTER.idFromName(name)
      const stub = env.COUNTER.get(id)

      // Call DO methods directly via RPC (no HTTP overhead)
      try {
        let result: unknown

        switch (method) {
          case 'getValue':
            result = await stub.getValue()
            break
          case 'increment':
            // Parse amount from query string
            const incAmount = parseInt(url.searchParams.get('amount') || '1')
            result = await stub.increment(incAmount)
            break
          case 'decrement':
            const decAmount = parseInt(url.searchParams.get('amount') || '1')
            result = await stub.decrement(decAmount)
            break
          case 'reset':
            result = await stub.reset()
            break
          default:
            return new Response(JSON.stringify({ error: `Unknown method: ${method}` }), {
              status: 404,
              headers: { 'Content-Type': 'application/json' }
            })
        }

        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' }
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'RPC error'
        return new Response(JSON.stringify({ error: message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    }

    // HTTP passthrough: /counter/:name/*
    const httpMatch = url.pathname.match(/^\/counter\/([^\/]+)(.*)$/)
    if (httpMatch) {
      const [, name, rest] = httpMatch

      const id = env.COUNTER.idFromName(name)
      const stub = env.COUNTER.get(id)

      const doUrl = new URL(request.url)
      doUrl.pathname = rest || '/'

      return stub.fetch(new Request(doUrl, request))
    }

    // API documentation
    return new Response(JSON.stringify({
      http: {
        'GET /counter/:name': 'Get counter value',
        'POST /counter/:name/increment': 'Increment (body: {amount?: number})',
        'POST /counter/:name/decrement': 'Decrement (body: {amount?: number})',
        'POST /counter/:name/reset': 'Reset to 0',
      },
      rpc: {
        'GET /rpc/:name/getValue': 'Get counter value via RPC',
        'GET /rpc/:name/increment?amount=N': 'Increment via RPC',
        'GET /rpc/:name/decrement?amount=N': 'Decrement via RPC',
        'GET /rpc/:name/reset': 'Reset via RPC',
      }
    }, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
```

### RPC vs HTTP

| Aspect | HTTP (fetch) | RPC (direct call) |
|--------|-------------|-------------------|
| Use case | External clients, REST APIs | Worker-to-DO, DO-to-DO |
| Overhead | Request/response serialization | Minimal, direct method call |
| Error handling | HTTP status codes | JavaScript exceptions |
| Best for | Public APIs | Internal communication |

### Test RPC

```bash
# RPC: Get value
curl http://localhost:8787/rpc/my-counter/getValue

# RPC: Increment by 10
curl "http://localhost:8787/rpc/my-counter/increment?amount=10"

# Compare: Same operation via HTTP
curl -X POST http://localhost:8787/counter/my-counter/increment \
  -H "Content-Type: application/json" \
  -d '{"amount": 10}'
```

---

## Testing with Miniflare

Durable Objects require real testing environments. Miniflare provides a local simulation of Cloudflare Workers with real SQLite storage.

### Configure Vitest

Create `vitest.config.ts`:

```typescript
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          durableObjects: {
            COUNTER: 'Counter'
          }
        }
      }
    }
  }
})
```

### Write Tests

Create `tests/counter.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

// Type the env for TypeScript
declare module 'cloudflare:test' {
  interface ProvidedEnv {
    COUNTER: DurableObjectNamespace
  }
}

describe('Counter DO', () => {
  // Helper to get a fresh counter for each test
  function getCounter(name: string = `test-${Date.now()}-${Math.random()}`) {
    const id = env.COUNTER.idFromName(name)
    return env.COUNTER.get(id)
  }

  describe('initial state', () => {
    it('should start at 0', async () => {
      const counter = getCounter()
      const state = await counter.getValue()

      expect(state.value).toBe(0)
      expect(state.lastUpdated).toBeDefined()
    })
  })

  describe('increment', () => {
    it('should increment by 1 by default', async () => {
      const counter = getCounter()

      const state = await counter.increment()

      expect(state.value).toBe(1)
    })

    it('should increment by specified amount', async () => {
      const counter = getCounter()

      const state = await counter.increment(5)

      expect(state.value).toBe(5)
    })

    it('should accumulate increments', async () => {
      const counter = getCounter()

      await counter.increment(3)
      await counter.increment(2)
      const state = await counter.getValue()

      expect(state.value).toBe(5)
    })
  })

  describe('decrement', () => {
    it('should decrement by 1 by default', async () => {
      const counter = getCounter()
      await counter.increment(5)

      const state = await counter.decrement()

      expect(state.value).toBe(4)
    })

    it('should allow negative values', async () => {
      const counter = getCounter()

      const state = await counter.decrement(10)

      expect(state.value).toBe(-10)
    })
  })

  describe('reset', () => {
    it('should reset to 0', async () => {
      const counter = getCounter()
      await counter.increment(100)

      const state = await counter.reset()

      expect(state.value).toBe(0)
    })
  })

  describe('persistence', () => {
    it('should persist state across calls', async () => {
      // Use same name to get same DO instance
      const name = 'persistence-test'

      const counter1 = getCounter(name)
      await counter1.increment(42)

      // Get the same counter again
      const counter2 = getCounter(name)
      const state = await counter2.getValue()

      expect(state.value).toBe(42)
    })
  })

  describe('HTTP endpoints', () => {
    it('should respond to GET /', async () => {
      const counter = getCounter()

      const response = await counter.fetch(new Request('https://test/'))

      expect(response.status).toBe(200)
      const json = await response.json() as { value: number }
      expect(json.value).toBe(0)
    })

    it('should increment via POST /increment', async () => {
      const counter = getCounter()

      const response = await counter.fetch(new Request('https://test/increment', {
        method: 'POST'
      }))

      expect(response.status).toBe(200)
      const json = await response.json() as { value: number }
      expect(json.value).toBe(1)
    })

    it('should accept amount in POST body', async () => {
      const counter = getCounter()

      const response = await counter.fetch(new Request('https://test/increment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 10 })
      }))

      const json = await response.json() as { value: number }
      expect(json.value).toBe(10)
    })
  })

  describe('isolation', () => {
    it('should isolate counters by name', async () => {
      const counter1 = getCounter('counter-a')
      const counter2 = getCounter('counter-b')

      await counter1.increment(100)
      await counter2.increment(1)

      const state1 = await counter1.getValue()
      const state2 = await counter2.getValue()

      expect(state1.value).toBe(100)
      expect(state2.value).toBe(1)
    })
  })
})
```

### Run Tests

```bash
# Run all tests
npm test

# Run tests once (CI mode)
npm run test:run
# or
npx vitest run

# Run specific test file
npx vitest run tests/counter.test.ts

# Watch mode for development
npx vitest
```

### Test Best Practices

1. **Use unique names per test** - Prevents state leakage between tests
2. **Test both RPC and HTTP** - They may behave differently
3. **Test persistence** - Verify state survives across calls
4. **Test isolation** - Ensure DOs with different IDs are independent
5. **Never mock SQLite** - Use real Miniflare, it's fast enough

---

## Deployment

### Prepare for Production

1. Update `wrangler.toml` with production settings:

```toml
name = "my-counter-app"
main = "src/index.ts"
compatibility_date = "2024-12-30"

# Workers Paid plan required for Durable Objects
# account_id = "your-account-id"  # Optional, Wrangler can detect

[durable_objects]
bindings = [
  { name = "COUNTER", class_name = "Counter" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Counter"]

# Optional: Custom domain
# routes = [
#   { pattern = "counter.example.com/*", zone_name = "example.com" }
# ]

# Optional: Environment variables
# [vars]
# ENVIRONMENT = "production"
```

2. Run type checking:

```bash
npm run typecheck
# or
npx tsc --noEmit
```

### Deploy

```bash
# Deploy to Cloudflare
npm run deploy
# or
wrangler deploy
```

Output will show your worker URL:

```
Uploaded my-counter-app (1.23 sec)
Published my-counter-app (0.45 sec)
  https://my-counter-app.your-subdomain.workers.dev
```

### Test Production

```bash
# Replace with your actual URL
export WORKER_URL="https://my-counter-app.your-subdomain.workers.dev"

# Test endpoints
curl $WORKER_URL/counter/production-test
curl -X POST $WORKER_URL/counter/production-test/increment
curl $WORKER_URL/rpc/production-test/getValue
```

### Migrations

When you change your DO schema, add a new migration:

```toml
# wrangler.toml

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Counter"]

# Future schema changes:
# [[migrations]]
# tag = "v2"
# renamed_classes = [{ from = "Counter", to = "CounterV2" }]
```

Deploy with migrations:

```bash
wrangler deploy
```

---

## Next Steps

You have built a complete Durable Object application. Here's where to go next:

### Learn More Concepts

- **WorkflowContext ($)** - Event handling, scheduling, cross-DO RPC
- **Entity Stores** - Things, Relationships, Events for graph-based data
- **WebSocket Support** - Real-time communication
- **Authentication** - JWT auth with @dotdo/auth

### Explore the Codebase

- `@dotdo/do` - The DO base class with $ context
- `@dotdo/db` - Storage layer for entities
- `@dotdo/rpc` - Cap'n Web RPC with promise pipelining
- `@dotdo/api` - Self-describing REST API layer

### Example Applications

Check out the examples in the repository:

- **Task Manager** - CRUD operations with persistence
- **Chat Room** - WebSocket-based real-time chat
- **E-commerce** - Shopping cart with inventory
- **Workflow Engine** - Event-driven state machines

### Documentation

- [CLAUDE.md](/CLAUDE.md) - Detailed architecture and patterns
- [README.md](/README.md) - Full feature overview
- [Cloudflare Durable Objects Docs](https://developers.cloudflare.com/durable-objects/)

---

## Quick Reference

### Commands

```bash
# Development
npm run dev          # Start local dev server
npm test             # Run tests in watch mode
npm run test:run     # Run tests once
npm run typecheck    # TypeScript checking

# Deployment
npm run deploy       # Deploy to Cloudflare
wrangler tail        # View live logs
```

### Project Files

| File | Purpose |
|------|---------|
| `wrangler.toml` | Cloudflare configuration |
| `tsconfig.json` | TypeScript configuration |
| `vitest.config.ts` | Test configuration |
| `src/index.ts` | Worker entry point |
| `src/*.ts` | DO classes |

### Key Patterns

```typescript
// Get DO instance by name
const id = env.DO_BINDING.idFromName('unique-name')
const stub = env.DO_BINDING.get(id)

// HTTP passthrough
return stub.fetch(request)

// RPC call
const result = await stub.methodName(args)

// SQLite storage
this.ctx.storage.sql.exec('SELECT ...', params)
```

---

Congratulations! You now have the foundation to build production Durable Object applications with dotdo.
