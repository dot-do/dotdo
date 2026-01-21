# Getting Started with dotdo

A comprehensive step-by-step guide to building production-ready Durable Objects with dotdo.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Create Your First Durable Object](#create-your-first-durable-object)
4. [Adding Storage with SQLite](#adding-storage-with-sqlite)
5. [Adding RPC Methods](#adding-rpc-methods)
6. [Adding WebSocket Support](#adding-websocket-support)
7. [Local Development](#local-development)
8. [Deployment to Cloudflare](#deployment-to-cloudflare)
9. [Common Gotchas and Solutions](#common-gotchas-and-solutions)
10. [Next Steps](#next-steps)

---

## Prerequisites

Before you begin, ensure you have the following installed and configured.

### Node.js (v18.0 or later)

dotdo requires Node.js 18.0+. Node.js 20+ is recommended for the best experience.

```bash
# Check your Node version
node --version

# Install via nvm (recommended)
nvm install 20
nvm use 20
```

### Wrangler CLI

Wrangler is Cloudflare's official CLI for Workers and Durable Objects development.

```bash
# Install globally
npm install -g wrangler

# Verify installation
wrangler --version
```

### Cloudflare Account

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com)
2. A **Workers Paid plan** ($5/month) is required for Durable Objects
3. Authenticate Wrangler with your account:

```bash
wrangler login
```

This opens a browser for OAuth authentication. After authorizing, Wrangler stores your credentials locally.

### Verify Your Setup

```bash
node --version    # Should be v18.0.0 or higher
wrangler --version # Should be v4.0.0 or higher
wrangler whoami   # Should show your Cloudflare account
```

---

## Installation

### Option 1: Create a New Project with CLI (Recommended)

The fastest way to start:

```bash
npx dotdo init my-app
cd my-app
npm install
```

This scaffolds a complete project with:
- TypeScript configuration
- Wrangler configuration with DO bindings
- Example DO class using dotdo
- Vitest test setup with Miniflare

### Option 2: Add dotdo to an Existing Project

```bash
# Using npm
npm install dotdo hono

# Using pnpm
pnpm add dotdo hono

# Install dev dependencies
npm install -D typescript wrangler @cloudflare/workers-types vitest @cloudflare/vitest-pool-workers
```

### Option 3: Manual Setup from Scratch

Create a new directory and initialize:

```bash
mkdir my-app && cd my-app
npm init -y
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
    "esModuleInterop": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

Create `wrangler.toml`:

```toml
name = "my-app"
main = "src/index.ts"
compatibility_date = "2024-12-30"

[durable_objects]
bindings = [
  { name = "MY_DO", class_name = "MyDO" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["MyDO"]
```

Create the source directory:

```bash
mkdir -p src
```

---

## Create Your First Durable Object

### Understanding the DO Class

The `DO` class from dotdo is a feature-rich base class that provides:
- Built-in Hono router with CORS support
- Entity management (Things, Events, Relationships)
- WebSocket handling
- Audit logging
- RPC endpoint at `/rpc`

### Basic Example

Create `src/my-do.ts`:

```typescript
import { DO } from 'dotdo'

// Define your environment bindings
export interface Env {
  MY_DO: DurableObjectNamespace<MyDO>
}

export class MyDO extends DO {
  // The DO base class sets up everything automatically
  // You just need to add your routes and methods

  // Add custom routes by overriding routes()
  protected routes(app: typeof this.app): void {
    app.get('/hello', (c) => {
      return c.json({ message: 'Hello from MyDO!' })
    })
  }

  // Add RPC-callable methods as public methods
  async greet(name: string): Promise<string> {
    return `Hello, ${name}!`
  }
}
```

Create `src/index.ts`:

```typescript
import { MyDO } from './my-do'
import type { Env } from './my-do'

// Export the DO class for Cloudflare to use
export { MyDO }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Route: /:name/*
    const match = url.pathname.match(/^\/([^\/]+)(.*)$/)
    if (match) {
      const [, name, rest] = match

      // Get or create a DO instance with this name
      const id = env.MY_DO.idFromName(name)
      const stub = env.MY_DO.get(id)

      // Forward the request to the DO
      const doUrl = new URL(request.url)
      doUrl.pathname = rest || '/'

      return stub.fetch(new Request(doUrl, request))
    }

    return new Response('Not found', { status: 404 })
  }
}
```

### Test It

```bash
# Start the dev server
wrangler dev

# In another terminal, test your DO
curl http://localhost:8787/my-instance/hello
# {"message":"Hello from MyDO!"}

curl http://localhost:8787/my-instance/
# {"status":"ok","id":"..."}
```

---

## Adding Storage with SQLite

Durable Objects have built-in SQLite storage. dotdo provides entity stores for common patterns.

### Using Entity Stores

The `DO` class includes pre-configured entity stores accessible via properties:

- `this.things` - Store for entities/documents
- `this.events` - Store for event sourcing
- `this.relationships` - Store for graph relationships
- `this.auditLogs` - Store for audit trail

Create `src/task-do.ts`:

```typescript
import { DO } from 'dotdo'

export interface Env {
  TASK_DO: DurableObjectNamespace<TaskDO>
}

interface Task {
  $id: string
  $type: string
  title: string
  completed: boolean
  createdAt: number
}

export class TaskDO extends DO {
  protected routes(app: typeof this.app): void {
    // List all tasks
    app.get('/tasks', async (c) => {
      const tasks = await this.things.list({ $type: 'Task' })
      return c.json({ tasks })
    })

    // Create a task
    app.post('/tasks', async (c) => {
      const body = await c.req.json<{ title: string }>()

      const task = await this.things.create({
        $type: 'Task',
        title: body.title,
        completed: false,
        createdAt: Date.now()
      })

      return c.json(task, 201)
    })

    // Get a task
    app.get('/tasks/:id', async (c) => {
      const id = c.req.param('id')
      const task = await this.things.get(id)

      if (!task) {
        return c.json({ error: 'Task not found' }, 404)
      }

      return c.json(task)
    })

    // Update a task
    app.patch('/tasks/:id', async (c) => {
      const id = c.req.param('id')
      const body = await c.req.json<Partial<Task>>()

      const task = await this.things.update(id, body)

      if (!task) {
        return c.json({ error: 'Task not found' }, 404)
      }

      return c.json(task)
    })

    // Delete a task
    app.delete('/tasks/:id', async (c) => {
      const id = c.req.param('id')
      const deleted = await this.things.delete(id)

      if (!deleted) {
        return c.json({ error: 'Task not found' }, 404)
      }

      return c.json({ deleted: true })
    })

    // Mark task complete
    app.post('/tasks/:id/complete', async (c) => {
      const id = c.req.param('id')

      const task = await this.things.update(id, {
        completed: true
      })

      if (!task) {
        return c.json({ error: 'Task not found' }, 404)
      }

      // Record an event for event sourcing
      await this.events.emit({
        type: 'Task.completed',
        payload: { taskId: id }
      })

      return c.json(task)
    })
  }

  // RPC methods for direct access
  async createTask(title: string): Promise<Task> {
    return this.things.create({
      $type: 'Task',
      title,
      completed: false,
      createdAt: Date.now()
    }) as Promise<Task>
  }

  async getTasks(): Promise<Task[]> {
    return this.things.list({ $type: 'Task' }) as Promise<Task[]>
  }

  async completeTask(id: string): Promise<Task | null> {
    return this.things.update(id, { completed: true }) as Promise<Task | null>
  }
}
```

Update `wrangler.toml`:

```toml
name = "my-app"
main = "src/index.ts"
compatibility_date = "2024-12-30"

[durable_objects]
bindings = [
  { name = "TASK_DO", class_name = "TaskDO" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["TaskDO"]
```

### Direct SQLite Access

For advanced use cases, you can access SQLite directly:

```typescript
export class CustomDO extends DO {
  private initialized = false

  private ensureSchema(): void {
    if (this.initialized) return

    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS counters (
        name TEXT PRIMARY KEY,
        value INTEGER DEFAULT 0
      )
    `)

    this.initialized = true
  }

  async incrementCounter(name: string): Promise<number> {
    this.ensureSchema()

    this.state.storage.sql.exec(
      'INSERT OR REPLACE INTO counters (name, value) VALUES (?, COALESCE((SELECT value FROM counters WHERE name = ?), 0) + 1)',
      name, name
    )

    const rows = this.state.storage.sql
      .exec('SELECT value FROM counters WHERE name = ?', name)
      .toArray()

    return rows[0]?.value as number
  }
}
```

---

## Adding RPC Methods

RPC (Remote Procedure Call) allows efficient communication between Workers and Durable Objects, and between DOs themselves.

### Public Methods as RPC

Any public method on your DO class is automatically callable via RPC:

```typescript
import { DO } from 'dotdo'

export class CalculatorDO extends DO {
  private result = 0

  // These methods are callable via RPC
  async add(n: number): Promise<number> {
    this.result += n
    return this.result
  }

  async subtract(n: number): Promise<number> {
    this.result -= n
    return this.result
  }

  async multiply(n: number): Promise<number> {
    this.result *= n
    return this.result
  }

  async divide(n: number): Promise<number> {
    if (n === 0) throw new Error('Division by zero')
    this.result /= n
    return this.result
  }

  async getResult(): Promise<number> {
    return this.result
  }

  async reset(): Promise<number> {
    this.result = 0
    return this.result
  }
}
```

### Calling RPC from a Worker

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Get the calculator DO
    const id = env.CALCULATOR.idFromName('main')
    const calc = env.CALCULATOR.get(id)

    // Call RPC methods directly
    if (url.pathname === '/add') {
      const n = parseInt(url.searchParams.get('n') || '0')
      const result = await calc.add(n)
      return Response.json({ result })
    }

    if (url.pathname === '/result') {
      const result = await calc.getResult()
      return Response.json({ result })
    }

    return new Response('Not found', { status: 404 })
  }
}
```

### Using the Built-in /rpc Endpoint

The DO base class exposes a POST `/rpc` endpoint for HTTP-based RPC:

```bash
# Call the add method
curl -X POST http://localhost:8787/calculator/rpc \
  -H "Content-Type: application/json" \
  -d '{"method": "add", "args": [5]}'
# {"result": 5}

# Call nested methods (e.g., this.things.list)
curl -X POST http://localhost:8787/my-do/rpc \
  -H "Content-Type: application/json" \
  -d '{"method": "things.list", "args": [{"$type": "Task"}]}'
```

### DO-to-DO Communication

Use the `$` context for cross-DO RPC with caching and retries:

```typescript
import { DO, createContext } from 'dotdo'

export class OrderDO extends DO {
  private $!: ReturnType<typeof createContext>

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    this.$ = createContext(state, env)
  }

  async createOrder(customerId: string, items: string[]): Promise<void> {
    // Store the order
    await this.things.create({
      $type: 'Order',
      customerId,
      items,
      status: 'pending'
    })

    // Notify the customer DO via RPC
    // $.Customer(id) returns a cached stub with retry logic
    await this.$.Customer(customerId).notify({
      type: 'order.created',
      items
    })
  }
}
```

---

## Adding WebSocket Support

dotdo provides a `WebSocketManager` for handling real-time connections.

### Basic WebSocket Setup

```typescript
import { DO, WebSocketManager } from 'dotdo'

export class ChatDO extends DO {
  protected routes(app: typeof this.app): void {
    // WebSocket upgrade endpoint
    app.get('/ws', (c) => {
      const upgradeHeader = c.req.header('Upgrade')

      if (upgradeHeader !== 'websocket') {
        return c.text('Expected WebSocket', 426)
      }

      // Handle WebSocket upgrade with tags for filtering
      return this.ws.handleWebSocketUpgrade(
        this.state,
        ['chat'],  // Tags for this connection
        true       // Enable hibernation for efficiency
      )
    })

    // REST API for sending messages (broadcasts to all connected)
    app.post('/message', async (c) => {
      const body = await c.req.json<{ text: string; user: string }>()

      // Broadcast to all WebSockets tagged with 'chat'
      const result = this.ws.broadcast(this.state, 'chat', {
        type: 'message',
        data: body
      })

      return c.json({
        sent: result.sent,
        failed: result.failed
      })
    })

    // Get connection count
    app.get('/connections', (c) => {
      const count = this.ws.getConnectionCount(this.state, 'chat')
      return c.json({ connections: count })
    })
  }

  // Handle incoming WebSocket messages (overrides DO base method)
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    // Parse the message
    if (typeof message !== 'string') {
      return // Handle binary messages differently if needed
    }

    let parsed: { type: string; data?: unknown }
    try {
      parsed = JSON.parse(message)
    } catch {
      ws.send(JSON.stringify({ type: 'error', data: 'Invalid JSON' }))
      return
    }

    // Handle different message types
    switch (parsed.type) {
      case 'message':
        // Broadcast to all other connections
        this.ws.broadcastAll(this.state, {
          type: 'message',
          data: parsed.data
        })
        break

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }))
        break
    }
  }

  // Handle WebSocket close
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    this.ws.cleanupWebSocket(ws)

    // Notify others that someone left
    this.ws.broadcastAll(this.state, {
      type: 'system',
      data: { message: 'A user has left the chat' }
    })
  }
}
```

### WebSocket Client Example

```javascript
// Browser or Node.js client
const ws = new WebSocket('wss://my-app.workers.dev/chat-room/ws')

ws.onopen = () => {
  console.log('Connected!')

  // Send a message
  ws.send(JSON.stringify({
    type: 'message',
    data: { user: 'Alice', text: 'Hello!' }
  }))
}

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  console.log('Received:', msg)
}

ws.onclose = () => {
  console.log('Disconnected')
}
```

### Advanced: Message Handlers

Register handlers for specific message types:

```typescript
export class GameDO extends DO {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env)

    // Register message handlers
    this.ws.on('move', async (ws, data) => {
      const { x, y } = data as { x: number; y: number }
      // Process move and broadcast to others
      this.ws.broadcastAll(this.state, {
        type: 'move',
        data: { x, y }
      })
    })

    this.ws.on('chat', async (ws, data) => {
      // Handle chat messages
      this.ws.broadcastAll(this.state, {
        type: 'chat',
        data
      })
    })

    // Wildcard handler for all messages
    this.ws.on('*', async (ws, data) => {
      console.log('Received message:', data)
    })
  }
}
```

---

## Local Development

### Start the Dev Server

```bash
# Basic development
wrangler dev

# With custom port
wrangler dev --port 3000

# Enable local persistence (keeps data between restarts)
wrangler dev --persist
```

### Testing

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
            TASK_DO: 'TaskDO'
          }
        }
      }
    }
  }
})
```

Create `tests/task-do.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    TASK_DO: DurableObjectNamespace
  }
}

describe('TaskDO', () => {
  function getTaskDO(name = `test-${Date.now()}`) {
    const id = env.TASK_DO.idFromName(name)
    return env.TASK_DO.get(id)
  }

  it('should create and retrieve tasks', async () => {
    const taskDO = getTaskDO()

    // Create a task via RPC
    const task = await taskDO.createTask('Buy groceries')

    expect(task.$id).toBeDefined()
    expect(task.title).toBe('Buy groceries')
    expect(task.completed).toBe(false)
  })

  it('should complete a task', async () => {
    const taskDO = getTaskDO()

    // Create and complete
    const task = await taskDO.createTask('Test task')
    const completed = await taskDO.completeTask(task.$id)

    expect(completed?.completed).toBe(true)
  })

  it('should list tasks via HTTP', async () => {
    const taskDO = getTaskDO()

    // Create tasks
    await taskDO.createTask('Task 1')
    await taskDO.createTask('Task 2')

    // List via fetch
    const response = await taskDO.fetch(new Request('https://test/tasks'))
    const data = await response.json() as { tasks: unknown[] }

    expect(response.status).toBe(200)
    expect(data.tasks).toHaveLength(2)
  })
})
```

Run tests:

```bash
# Run all tests
npm test

# Run tests once (CI mode)
npx vitest run

# Run specific test file
npx vitest run tests/task-do.test.ts

# Watch mode
npx vitest
```

### Add Scripts to package.json

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "test": "vitest",
    "test:run": "vitest run",
    "typecheck": "tsc --noEmit",
    "deploy": "wrangler deploy"
  }
}
```

---

## Deployment to Cloudflare

### Prepare for Production

1. Ensure your `wrangler.toml` is configured:

```toml
name = "my-app"
main = "src/index.ts"
compatibility_date = "2024-12-30"

# Required: Durable Objects need a paid plan
# account_id = "your-account-id"  # Optional, Wrangler auto-detects

[durable_objects]
bindings = [
  { name = "TASK_DO", class_name = "TaskDO" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["TaskDO"]

# Optional: Custom domain
# routes = [
#   { pattern = "api.example.com.ai/*", zone_name = "example.com.ai" }
# ]

# Optional: Environment variables
# [vars]
# ENVIRONMENT = "production"
```

2. Run checks:

```bash
# Type checking
npm run typecheck

# Run tests
npm run test:run
```

### Deploy

```bash
# Deploy to Cloudflare
npm run deploy
# or
wrangler deploy
```

Output:

```
Uploaded my-app (2.34 sec)
Published my-app (0.89 sec)
  https://my-app.your-subdomain.workers.dev
```

### Test Production

```bash
export WORKER_URL="https://my-app.your-subdomain.workers.dev"

# Test endpoints
curl $WORKER_URL/my-tasks/tasks
curl -X POST $WORKER_URL/my-tasks/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "Production test"}'
```

### View Logs

```bash
# Tail production logs
wrangler tail

# Filter by status
wrangler tail --status error
```

### Managing Migrations

When you modify your DO, add migrations:

```toml
# Initial creation
[[migrations]]
tag = "v1"
new_sqlite_classes = ["TaskDO"]

# Renaming a class
[[migrations]]
tag = "v2"
renamed_classes = [{ from = "TaskDO", to = "TaskManager" }]

# Deleting a class
[[migrations]]
tag = "v3"
deleted_classes = ["OldDO"]
```

---

## Common Gotchas and Solutions

### 1. "Durable Object not found" Error

**Cause:** The DO class is not exported from your main entry point.

**Solution:** Ensure you export the class:

```typescript
// src/index.ts
import { MyDO } from './my-do'
export { MyDO }  // This is required!

export default { fetch(request, env) { ... } }
```

### 2. "SQLite: no such table" Error

**Cause:** The `new_sqlite_classes` migration was not added.

**Solution:** Add the migration in `wrangler.toml`:

```toml
[[migrations]]
tag = "v1"
new_sqlite_classes = ["MyDO"]
```

### 3. State Not Persisting Locally

**Cause:** Wrangler dev doesn't persist by default.

**Solution:** Use the `--persist` flag:

```bash
wrangler dev --persist
```

### 4. WebSocket Connections Dropping

**Cause:** Durable Objects hibernate when idle, closing non-hibernatable WebSockets.

**Solution:** Enable hibernation:

```typescript
// Use hibernatable: true in handleWebSocketUpgrade
this.ws.handleWebSocketUpgrade(this.state, ['tag'], true)
```

### 5. RPC Method "Not Found"

**Cause:** Method is private or not async.

**Solution:** Ensure methods are public and async:

```typescript
// Wrong
private async doSomething() { ... }

// Correct
async doSomething() { ... }
```

### 6. CORS Errors in Browser

**Cause:** CORS middleware not applied.

**Solution:** The DO base class enables CORS by default. If you disabled it:

```typescript
export class MyDO extends DO {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, { cors: true })  // Enable CORS
  }
}
```

### 7. Memory Issues with Vitest

**Cause:** Multiple Vitest instances or watch mode consuming memory.

**Solution:**
- Never run multiple Vitest instances in parallel
- Use `npx vitest run` instead of watch mode for CI
- Kill orphan processes: `pkill -9 -f vitest`

### 8. TypeScript Types Not Working

**Cause:** Missing `@cloudflare/workers-types`.

**Solution:** Install and configure:

```bash
npm install -D @cloudflare/workers-types
```

In `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["@cloudflare/workers-types"]
  }
}
```

---

## Next Steps

Congratulations! You now have a solid foundation for building with dotdo.

### Learn More

- **Event Handlers**: Use `$.on.Noun.verb()` for event-driven architecture
- **Scheduling**: Use `$.every.monday.at('9am')()` for cron-like scheduling
- **Cross-DO RPC**: Use `$.Customer(id).method()` for DO-to-DO communication
- **Entity Relationships**: Build graph structures with `this.relationships`
- **Audit Logging**: Track changes with `this.auditLogs`

### Explore the Packages

| Package | Description |
|---------|-------------|
| `@dotdo/do` | The DO base class with $ context |
| `@dotdo/db` | Storage layer for entities |
| `@dotdo/rpc` | Cap'n Web RPC with promise pipelining |
| `@dotdo/api` | Self-describing REST API layer |
| `@dotdo/auth` | Authentication middleware |
| `@dotdo/ai` | AI routing and template literals |
| `@dotdo/mcp` | Model Context Protocol server |

### Documentation

- [README.md](/README.md) - Full project overview
- [CLAUDE.md](/CLAUDE.md) - Architecture details for AI assistants
- [ARCHITECTURE.md](/ARCHITECTURE.md) - In-depth system design
- [TROUBLESHOOTING.md](/docs/TROUBLESHOOTING.md) - Common issues and solutions

### Community

- [GitHub Issues](https://github.com/dot-do/dotdo/issues): Report bugs and request features

---

## Quick Reference

### Essential Commands

```bash
# Development
wrangler dev              # Start dev server
wrangler dev --persist    # With persistence
npm test                  # Run tests (watch)
npx vitest run            # Run tests once

# Deployment
wrangler deploy           # Deploy to Cloudflare
wrangler tail             # View production logs

# Debugging
wrangler dev --log-level debug  # Verbose logging
```

### Project Structure

```
my-app/
  src/
    index.ts          # Worker entry point
    my-do.ts          # Your DO class
  tests/
    my-do.test.ts     # Tests
  package.json
  tsconfig.json
  wrangler.toml       # Cloudflare config
  vitest.config.ts    # Test config
```

### Key Patterns

```typescript
// Get DO by name
const id = env.MY_DO.idFromName('unique-name')
const stub = env.MY_DO.get(id)

// HTTP passthrough
return stub.fetch(request)

// RPC call
const result = await stub.myMethod(args)

// Entity stores
await this.things.create({ $type: 'Type', ...data })
await this.things.get(id)
await this.things.update(id, data)
await this.things.delete(id)
await this.things.list({ $type: 'Type' })

// WebSocket
this.ws.handleWebSocketUpgrade(state, ['tag'], true)
this.ws.broadcast(state, 'tag', { type: 'event', data })
this.ws.broadcastAll(state, { type: 'event', data })
```
