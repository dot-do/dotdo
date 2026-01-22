# Interactive Tutorial: Building with dotdo

Welcome to the dotdo interactive tutorial! This guide will walk you through building a complete application step-by-step, from your first Durable Object to production deployment.

## Table of Contents

1. [Introduction](#introduction)
2. [Step 1: Your First Durable Object](#step-1-your-first-durable-object)
3. [Step 2: Adding Storage with SQLite](#step-2-adding-storage-with-sqlite)
4. [Step 3: Working with Events](#step-3-working-with-events)
5. [Step 4: Adding WebSocket Support](#step-4-adding-websocket-support)
6. [Step 5: Scheduled Tasks](#step-5-scheduled-tasks)
7. [Step 6: Cross-DO Communication](#step-6-cross-do-communication)
8. [Step 7: Testing Your DO](#step-7-testing-your-do)
9. [Step 8: Deploying to Production](#step-8-deploying-to-production)
10. [Summary and Next Steps](#summary-and-next-steps)

---

## Introduction

dotdo is a framework for building Durable Objects on Cloudflare Workers. It provides:

- **Built-in SQLite storage** with entity management (Things, Events, Relationships)
- **WorkflowContext ($)** for event handling and scheduling
- **WebSocket support** with hibernation
- **RPC-first communication** between DOs
- **Hono-based routing** for HTTP endpoints

### What You'll Build

By the end of this tutorial, you'll have built a task management system with:

- CRUD operations for tasks
- Event-driven architecture
- Real-time updates via WebSockets
- Scheduled cleanup jobs
- Cross-DO communication

### Prerequisites

Make sure you have:

```bash
# Node.js 18+ installed
node --version  # v18.0.0 or higher

# Wrangler CLI installed
npm install -g wrangler
wrangler --version  # v4.0.0 or higher

# Cloudflare account with Workers Paid plan
wrangler login
wrangler whoami
```

---

## Step 1: Your First Durable Object

Let's start by creating a simple Durable Object that responds to HTTP requests.

### 1.1 Create Project Structure

```bash
mkdir my-dotdo-app && cd my-dotdo-app
npm init -y
npm install dotdo hono
npm install -D typescript wrangler @cloudflare/workers-types vitest @cloudflare/vitest-pool-workers
```

### 1.2 Configure TypeScript

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

### 1.3 Configure Wrangler

Create `wrangler.toml`:

```toml
name = "my-dotdo-app"
main = "src/index.ts"
compatibility_date = "2024-12-30"

[durable_objects]
bindings = [
  { name = "TASKS", class_name = "TasksDO" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["TasksDO"]
```

### 1.4 Create Your First DO

Create `src/tasks-do.ts`:

```typescript
import { Hono } from 'hono'
import { DO, type DOEnv } from 'dotdo'

export interface Env extends DOEnv {
  TASKS: DurableObjectNamespace<TasksDO>
}

export class TasksDO extends DO {
  // Override the routes method to add your endpoints
  protected routes(app: Hono): void {
    // Simple hello endpoint
    app.get('/hello', (c) => {
      return c.json({ message: 'Hello from TasksDO!' })
    })

    // Echo endpoint
    app.post('/echo', async (c) => {
      const body = await c.req.json()
      return c.json({ received: body })
    })
  }
}
```

### 1.5 Create the Worker Entry Point

Create `src/index.ts`:

```typescript
import { TasksDO } from './tasks-do'
import type { Env } from './tasks-do'

// Export the DO class for Cloudflare
export { TasksDO }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Route: /:namespace/* -> Forward to DO instance
    const match = url.pathname.match(/^\/([^\/]+)(.*)$/)
    if (match) {
      const [, namespace, rest] = match

      // Get or create a DO instance with this namespace
      const id = env.TASKS.idFromName(namespace)
      const stub = env.TASKS.get(id)

      // Forward the request to the DO
      const doUrl = new URL(request.url)
      doUrl.pathname = rest || '/'

      return stub.fetch(new Request(doUrl, request))
    }

    return new Response('Not found', { status: 404 })
  }
}
```

### 1.6 Test It Locally

```bash
# Start the dev server
wrangler dev

# In another terminal, test your endpoints
curl http://localhost:8787/my-tasks/hello
# {"message":"Hello from TasksDO!"}

curl http://localhost:8787/my-tasks/echo \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
# {"received":{"test":true}}

# The root endpoint shows DO status
curl http://localhost:8787/my-tasks/
# {"status":"ok","id":"..."}
```

**What you learned:**

- How to extend the `DO` base class
- How to add routes using Hono
- How namespace-based routing works

---

## Step 2: Adding Storage with SQLite

Now let's add persistent storage for tasks using dotdo's built-in entity stores.

### 2.1 Define Task Types

Update `src/tasks-do.ts`:

```typescript
import { Hono } from 'hono'
import { DO, type DOEnv } from 'dotdo'

export interface Env extends DOEnv {
  TASKS: DurableObjectNamespace<TasksDO>
}

// Define task interface
interface Task {
  $id: string      // Auto-generated ID
  $type: string    // Entity type marker
  title: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed'
  priority: 'low' | 'medium' | 'high'
  createdAt: string
  updatedAt?: string
}

export class TasksDO extends DO {
  protected routes(app: Hono): void {
    // ===========================================
    // LIST: Get all tasks
    // ===========================================
    app.get('/tasks', async (c) => {
      // Use the built-in things store
      const tasks = await this.things.list({ type: 'Task' })

      return c.json({
        tasks,
        total: tasks.length
      })
    })

    // ===========================================
    // CREATE: Add a new task
    // ===========================================
    app.post('/tasks', async (c) => {
      const body = await c.req.json<{
        title: string
        description?: string
        priority?: Task['priority']
      }>()

      // Validate required fields
      if (!body.title || body.title.trim() === '') {
        return c.json({ error: 'Title is required' }, 400)
      }

      // Create task using things store
      const task = await this.things.create({
        $type: 'Task',
        title: body.title.trim(),
        description: body.description,
        status: 'pending',
        priority: body.priority || 'medium',
        createdAt: new Date().toISOString()
      })

      return c.json(task, 201)
    })

    // ===========================================
    // READ: Get a single task
    // ===========================================
    app.get('/tasks/:id', async (c) => {
      const id = c.req.param('id')
      const task = await this.things.get(id)

      if (!task || task.$type !== 'Task') {
        return c.json({ error: 'Task not found' }, 404)
      }

      return c.json(task)
    })

    // ===========================================
    // UPDATE: Modify a task
    // ===========================================
    app.patch('/tasks/:id', async (c) => {
      const id = c.req.param('id')
      const body = await c.req.json<Partial<Task>>()

      const existing = await this.things.get(id)
      if (!existing || existing.$type !== 'Task') {
        return c.json({ error: 'Task not found' }, 404)
      }

      // Update with timestamp
      const updated = await this.things.update(id, {
        ...body,
        updatedAt: new Date().toISOString()
      })

      return c.json(updated)
    })

    // ===========================================
    // DELETE: Remove a task
    // ===========================================
    app.delete('/tasks/:id', async (c) => {
      const id = c.req.param('id')

      const existing = await this.things.get(id)
      if (!existing || existing.$type !== 'Task') {
        return c.json({ error: 'Task not found' }, 404)
      }

      await this.things.delete(id)

      return c.body(null, 204)
    })

    // ===========================================
    // Convenience: Mark task as complete
    // ===========================================
    app.post('/tasks/:id/complete', async (c) => {
      const id = c.req.param('id')

      const existing = await this.things.get(id)
      if (!existing || existing.$type !== 'Task') {
        return c.json({ error: 'Task not found' }, 404)
      }

      const updated = await this.things.update(id, {
        status: 'completed',
        updatedAt: new Date().toISOString()
      })

      return c.json(updated)
    })
  }
}
```

### 2.2 Test the CRUD Operations

```bash
# Create tasks
curl -X POST http://localhost:8787/my-tasks/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "Learn dotdo", "priority": "high"}'

curl -X POST http://localhost:8787/my-tasks/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "Build something awesome", "description": "A real-time app"}'

# List all tasks
curl http://localhost:8787/my-tasks/tasks

# Get a specific task (use the $id from the response above)
curl http://localhost:8787/my-tasks/tasks/TASK_ID_HERE

# Update a task
curl -X PATCH http://localhost:8787/my-tasks/tasks/TASK_ID_HERE \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress"}'

# Complete a task
curl -X POST http://localhost:8787/my-tasks/tasks/TASK_ID_HERE/complete

# Delete a task
curl -X DELETE http://localhost:8787/my-tasks/tasks/TASK_ID_HERE
```

### 2.3 Understanding Entity Stores

dotdo provides several built-in stores:

| Store | Purpose | Methods |
|-------|---------|---------|
| `this.things` | General entities | `create`, `get`, `update`, `delete`, `list` |
| `this.events` | Event sourcing | `emit`, `list`, `replay` |
| `this.relationships` | Graph relationships | `add`, `remove`, `getRelated`, `getSubjects` |
| `this.auditLogs` | Audit trail | `log`, `list` |

**What you learned:**

- How to use the `things` store for CRUD operations
- Entity structure with `$id` and `$type`
- How SQLite storage persists across requests

---

## Step 3: Working with Events

dotdo's WorkflowContext (`$`) provides a powerful event system for reactive programming.

### 3.1 Add Event Handlers

Update `src/tasks-do.ts` to add event handling:

```typescript
import { Hono } from 'hono'
import { DO, type DOEnv, createContext, type WorkflowContext } from 'dotdo'

export interface Env extends DOEnv {
  TASKS: DurableObjectNamespace<TasksDO>
}

interface Task {
  $id: string
  $type: string
  title: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed'
  priority: 'low' | 'medium' | 'high'
  createdAt: string
  updatedAt?: string
}

export class TasksDO extends DO {
  // WorkflowContext for events, scheduling, and cross-DO RPC
  private $: WorkflowContext

  constructor(state: DurableObjectState, env: DOEnv) {
    super(state, env)

    // Initialize the WorkflowContext
    this.$ = createContext(state, env)

    // =========================================
    // Register Event Handlers
    // Uses $.on.Noun.verb pattern (infinite combinations via Proxy)
    // =========================================

    // Handle task creation
    this.$.on.Task.created(async (event) => {
      const { taskId, title } = event.payload as { taskId: string; title: string }
      console.log(`[Event] Task created: "${title}" (${taskId})`)

      // You could send notifications, update analytics, etc.
    })

    // Handle task completion
    this.$.on.Task.completed(async (event) => {
      const { taskId, title } = event.payload as { taskId: string; title: string }
      console.log(`[Event] Task completed: "${title}" (${taskId})`)

      // Store the event in the events store for history
      await this.events.emit({
        type: 'Task.completed',
        payload: { taskId, title, completedAt: new Date().toISOString() }
      })
    })

    // Handle task updates
    this.$.on.Task.updated(async (event) => {
      const { taskId, changes } = event.payload as { taskId: string; changes: string[] }
      console.log(`[Event] Task updated: ${taskId}, changed: ${changes.join(', ')}`)
    })

    // Wildcard handler for all Task events (great for logging/auditing)
    this.$.on.Task['*'](async (event) => {
      console.log(`[Audit] Task event: ${event.type}`, event.payload)
    })
  }

  protected routes(app: Hono): void {
    // LIST
    app.get('/tasks', async (c) => {
      const tasks = await this.things.list({ type: 'Task' })
      return c.json({ tasks, total: tasks.length })
    })

    // CREATE - Now with events!
    app.post('/tasks', async (c) => {
      const body = await c.req.json<{
        title: string
        description?: string
        priority?: Task['priority']
      }>()

      if (!body.title?.trim()) {
        return c.json({ error: 'Title is required' }, 400)
      }

      const task = await this.things.create({
        $type: 'Task',
        title: body.title.trim(),
        description: body.description,
        status: 'pending',
        priority: body.priority || 'medium',
        createdAt: new Date().toISOString()
      })

      // Fire the event (fire-and-forget)
      this.$.send({
        type: 'Task.created',
        payload: { taskId: task.$id, title: task.title }
      })

      return c.json(task, 201)
    })

    // READ
    app.get('/tasks/:id', async (c) => {
      const task = await this.things.get(c.req.param('id'))
      if (!task || task.$type !== 'Task') {
        return c.json({ error: 'Task not found' }, 404)
      }
      return c.json(task)
    })

    // UPDATE - Now with events!
    app.patch('/tasks/:id', async (c) => {
      const id = c.req.param('id')
      const body = await c.req.json<Partial<Task>>()

      const existing = await this.things.get(id)
      if (!existing || existing.$type !== 'Task') {
        return c.json({ error: 'Task not found' }, 404)
      }

      // Track what changed
      const changes = Object.keys(body).filter(
        key => body[key as keyof Task] !== existing[key as keyof typeof existing]
      )

      const updated = await this.things.update(id, {
        ...body,
        updatedAt: new Date().toISOString()
      })

      // Fire update event
      if (changes.length > 0) {
        this.$.send({
          type: 'Task.updated',
          payload: { taskId: id, changes }
        })
      }

      return c.json(updated)
    })

    // COMPLETE - Dedicated completion action
    app.post('/tasks/:id/complete', async (c) => {
      const id = c.req.param('id')
      const existing = await this.things.get(id) as Task | null

      if (!existing || existing.$type !== 'Task') {
        return c.json({ error: 'Task not found' }, 404)
      }

      const updated = await this.things.update(id, {
        status: 'completed',
        updatedAt: new Date().toISOString()
      })

      // Fire completion event
      this.$.send({
        type: 'Task.completed',
        payload: { taskId: id, title: existing.title }
      })

      return c.json(updated)
    })

    // DELETE
    app.delete('/tasks/:id', async (c) => {
      const id = c.req.param('id')
      const existing = await this.things.get(id)

      if (!existing || existing.$type !== 'Task') {
        return c.json({ error: 'Task not found' }, 404)
      }

      await this.things.delete(id)

      // Fire deletion event
      this.$.send({
        type: 'Task.deleted',
        payload: { taskId: id }
      })

      return c.body(null, 204)
    })

    // Get event history
    app.get('/events', async (c) => {
      const events = await this.events.list({ limit: 50 })
      return c.json({ events })
    })
  }
}
```

### 3.2 Test Events

```bash
# Start wrangler dev and watch the console output

# Create a task - you'll see the created event fire
curl -X POST http://localhost:8787/my-tasks/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "Test events"}'

# Update the task - you'll see the updated event fire
curl -X PATCH http://localhost:8787/my-tasks/tasks/TASK_ID \
  -H "Content-Type: application/json" \
  -d '{"priority": "high"}'

# Complete the task - you'll see the completed event fire
curl -X POST http://localhost:8787/my-tasks/tasks/TASK_ID/complete

# Check event history
curl http://localhost:8787/my-tasks/events
```

### 3.3 Event Durability Levels

dotdo provides different durability levels for events:

```typescript
// Fire-and-forget (fast, no guarantees)
this.$.send(event)

// Single attempt (throws on failure)
await this.$.try(event)

// Durable with retries (guaranteed delivery)
await this.$.do(event)
```

**What you learned:**

- How to set up event handlers with `$.on.Noun.verb`
- The wildcard pattern for catching all events
- Different durability levels for events

---

## Step 4: Adding WebSocket Support

Let's add real-time updates using WebSockets with automatic hibernation support.

### 4.1 Add WebSocket Routes

Update `src/tasks-do.ts` to add WebSocket support:

```typescript
import { Hono } from 'hono'
import { DO, type DOEnv, createContext, type WorkflowContext } from 'dotdo'

export interface Env extends DOEnv {
  TASKS: DurableObjectNamespace<TasksDO>
}

interface Task {
  $id: string
  $type: string
  title: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed'
  priority: 'low' | 'medium' | 'high'
  createdAt: string
  updatedAt?: string
}

export class TasksDO extends DO {
  private $: WorkflowContext

  constructor(state: DurableObjectState, env: DOEnv) {
    super(state, env)
    this.$ = createContext(state, env)

    // Event handlers
    this.$.on.Task.created(async (event) => {
      const { taskId, title } = event.payload as { taskId: string; title: string }
      console.log(`[Event] Task created: "${title}"`)

      // Broadcast to all connected WebSocket clients
      this.broadcastUpdate('task:created', { taskId, title })
    })

    this.$.on.Task.completed(async (event) => {
      const { taskId, title } = event.payload as { taskId: string; title: string }
      console.log(`[Event] Task completed: "${title}"`)

      // Broadcast to all connected clients
      this.broadcastUpdate('task:completed', { taskId, title })
    })

    this.$.on.Task.updated(async (event) => {
      const { taskId, changes } = event.payload as { taskId: string; changes: string[] }

      // Broadcast update
      this.broadcastUpdate('task:updated', { taskId, changes })
    })

    this.$.on.Task.deleted(async (event) => {
      const { taskId } = event.payload as { taskId: string }

      // Broadcast deletion
      this.broadcastUpdate('task:deleted', { taskId })
    })

    // =========================================
    // WebSocket Message Handlers
    // =========================================

    // Handle ping messages
    this.ws.on('ping', (ws, _data) => {
      this.ws.send(ws, { type: 'pong', timestamp: Date.now() })
    })

    // Handle subscription requests
    this.ws.on('subscribe', (ws, data) => {
      const { filter } = data as { filter?: string }
      console.log(`Client subscribed with filter: ${filter || 'all'}`)
      this.ws.send(ws, { type: 'subscribed', filter })
    })
  }

  // Helper: Broadcast updates to all connected clients
  private broadcastUpdate(type: string, data: unknown): void {
    this.ws.broadcastAll(this.state, {
      type,
      data,
      timestamp: Date.now()
    })
  }

  protected routes(app: Hono): void {
    // =========================================
    // WebSocket Endpoint
    // =========================================
    app.get('/ws', async (c) => {
      const upgradeHeader = c.req.header('Upgrade')

      if (upgradeHeader !== 'websocket') {
        return c.json({ error: 'Expected WebSocket upgrade' }, 426)
      }

      // Accept WebSocket with hibernation enabled
      // Tags can be used to filter broadcasts
      return this.ws.handleWebSocketUpgrade(
        this.state,
        ['tasks'],  // Tags for this connection
        true        // Enable hibernation (recommended for production)
      )
    })

    // Connection count endpoint
    app.get('/connections', (c) => {
      const count = this.ws.getConnectionCount(this.state, 'tasks')
      return c.json({ connections: count })
    })

    // =========================================
    // REST API (same as before)
    // =========================================
    app.get('/tasks', async (c) => {
      const tasks = await this.things.list({ type: 'Task' })
      return c.json({ tasks, total: tasks.length })
    })

    app.post('/tasks', async (c) => {
      const body = await c.req.json<{
        title: string
        description?: string
        priority?: Task['priority']
      }>()

      if (!body.title?.trim()) {
        return c.json({ error: 'Title is required' }, 400)
      }

      const task = await this.things.create({
        $type: 'Task',
        title: body.title.trim(),
        description: body.description,
        status: 'pending',
        priority: body.priority || 'medium',
        createdAt: new Date().toISOString()
      })

      this.$.send({
        type: 'Task.created',
        payload: { taskId: task.$id, title: task.title }
      })

      return c.json(task, 201)
    })

    app.get('/tasks/:id', async (c) => {
      const task = await this.things.get(c.req.param('id'))
      if (!task || task.$type !== 'Task') {
        return c.json({ error: 'Task not found' }, 404)
      }
      return c.json(task)
    })

    app.patch('/tasks/:id', async (c) => {
      const id = c.req.param('id')
      const body = await c.req.json<Partial<Task>>()

      const existing = await this.things.get(id)
      if (!existing || existing.$type !== 'Task') {
        return c.json({ error: 'Task not found' }, 404)
      }

      const changes = Object.keys(body)
      const updated = await this.things.update(id, {
        ...body,
        updatedAt: new Date().toISOString()
      })

      this.$.send({
        type: 'Task.updated',
        payload: { taskId: id, changes }
      })

      return c.json(updated)
    })

    app.post('/tasks/:id/complete', async (c) => {
      const id = c.req.param('id')
      const existing = await this.things.get(id) as Task | null

      if (!existing || existing.$type !== 'Task') {
        return c.json({ error: 'Task not found' }, 404)
      }

      const updated = await this.things.update(id, {
        status: 'completed',
        updatedAt: new Date().toISOString()
      })

      this.$.send({
        type: 'Task.completed',
        payload: { taskId: id, title: existing.title }
      })

      return c.json(updated)
    })

    app.delete('/tasks/:id', async (c) => {
      const id = c.req.param('id')
      const existing = await this.things.get(id)

      if (!existing || existing.$type !== 'Task') {
        return c.json({ error: 'Task not found' }, 404)
      }

      await this.things.delete(id)

      this.$.send({
        type: 'Task.deleted',
        payload: { taskId: id }
      })

      return c.body(null, 204)
    })
  }

  // Handle WebSocket close event
  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ): Promise<void> {
    console.log(`WebSocket closed: code=${code}, reason=${reason}`)
    await super.webSocketClose(ws, code, reason, wasClean)
  }
}
```

### 4.2 Test WebSockets

You can test WebSockets using a browser console or a tool like `wscat`:

```bash
# Install wscat
npm install -g wscat

# Connect to the WebSocket endpoint
wscat -c ws://localhost:8787/my-tasks/ws
```

Once connected, you'll receive real-time updates when tasks change. In another terminal:

```bash
# Create a task - the WebSocket client will receive the update
curl -X POST http://localhost:8787/my-tasks/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "Real-time task"}'

# You should see: {"type":"task:created","data":{...},"timestamp":...}
```

### 4.3 Browser Client Example

```html
<!DOCTYPE html>
<html>
<head>
  <title>Task Manager</title>
</head>
<body>
  <h1>Tasks</h1>
  <ul id="tasks"></ul>

  <script>
    const ws = new WebSocket('ws://localhost:8787/my-tasks/ws')

    ws.onopen = () => {
      console.log('Connected!')
      // Subscribe to updates
      ws.send(JSON.stringify({ type: 'subscribe', filter: 'all' }))
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      console.log('Received:', msg)

      // Handle different message types
      switch (msg.type) {
        case 'task:created':
          addTask(msg.data)
          break
        case 'task:completed':
          markComplete(msg.data.taskId)
          break
        case 'task:deleted':
          removeTask(msg.data.taskId)
          break
      }
    }

    ws.onclose = () => console.log('Disconnected')

    // Placeholder functions
    function addTask(task) {
      const li = document.createElement('li')
      li.id = task.taskId
      li.textContent = task.title
      document.getElementById('tasks').appendChild(li)
    }

    function markComplete(taskId) {
      const li = document.getElementById(taskId)
      if (li) li.style.textDecoration = 'line-through'
    }

    function removeTask(taskId) {
      const li = document.getElementById(taskId)
      if (li) li.remove()
    }
  </script>
</body>
</html>
```

**What you learned:**

- How to set up WebSocket endpoints with `ws.handleWebSocketUpgrade`
- Using message handlers with `ws.on('type', handler)`
- Broadcasting to all clients with `ws.broadcastAll`
- WebSocket hibernation for cost-effective scaling

---

## Step 5: Scheduled Tasks

dotdo supports scheduling using a fluent DSL that converts to cron patterns.

### 5.1 Add Scheduled Cleanup

Update your constructor to add scheduled tasks:

```typescript
constructor(state: DurableObjectState, env: DOEnv) {
  super(state, env)
  this.$ = createContext(state, env)

  // =========================================
  // Scheduled Tasks
  // =========================================

  // Clean up completed tasks older than 7 days - runs daily at 2 AM
  this.$.every.day.at('2am')(async () => {
    console.log('[Scheduled] Running daily cleanup...')

    const tasks = await this.things.list({ type: 'Task' }) as Task[]
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000)
    let deletedCount = 0

    for (const task of tasks) {
      if (task.status === 'completed') {
        const updatedAt = task.updatedAt
          ? new Date(task.updatedAt).getTime()
          : new Date(task.createdAt).getTime()

        if (updatedAt < sevenDaysAgo) {
          await this.things.delete(task.$id)
          deletedCount++
        }
      }
    }

    console.log(`[Scheduled] Cleanup complete: ${deletedCount} tasks deleted`)
  })

  // Generate daily report - runs every weekday at 9 AM
  this.$.every.weekday.at('9am')(async () => {
    console.log('[Scheduled] Generating daily report...')

    const tasks = await this.things.list({ type: 'Task' }) as Task[]
    const pending = tasks.filter(t => t.status === 'pending').length
    const inProgress = tasks.filter(t => t.status === 'in_progress').length
    const completed = tasks.filter(t => t.status === 'completed').length

    console.log(`[Report] Pending: ${pending}, In Progress: ${inProgress}, Completed: ${completed}`)

    // You could send this via email, Slack, etc.
  })

  // Quick check every hour
  this.$.every.hour(async () => {
    const count = this.ws.getConnectionCount(this.state, 'tasks')
    console.log(`[Scheduled] Active WebSocket connections: ${count}`)
  })

  // Event handlers...
  this.$.on.Task.created(async (event) => { /* ... */ })
  this.$.on.Task.completed(async (event) => { /* ... */ })
}
```

### 5.2 Schedule DSL Reference

dotdo's scheduling DSL provides an intuitive way to define cron patterns:

```typescript
// Time-based
this.$.every.minute(handler)
this.$.every.hour(handler)
this.$.every.day.at('9am')(handler)
this.$.every.day.at('14:30')(handler)  // 24-hour format

// Day-based
this.$.every.Monday.at('9am')(handler)
this.$.every.Friday.at('5pm')(handler)
this.$.every.weekday.at('8am')(handler)  // Mon-Fri
this.$.every.weekend.at('10am')(handler) // Sat-Sun

// Custom intervals
this.$.every(15).minutes(handler)  // Every 15 minutes
this.$.every(2).hours(handler)     // Every 2 hours
this.$.every(3).days(handler)      // Every 3 days
```

**What you learned:**

- How to use the scheduling DSL
- Running cleanup tasks
- Generating periodic reports

---

## Step 6: Cross-DO Communication

When you need to split functionality across multiple DOs, use cross-DO RPC.

### 6.1 Create a Notification DO

Create `src/notifications-do.ts`:

```typescript
import { Hono } from 'hono'
import { DO, type DOEnv } from 'dotdo'

export interface NotificationEnv extends DOEnv {
  NOTIFICATIONS: DurableObjectNamespace<NotificationsDO>
}

interface Notification {
  $id: string
  $type: string
  userId: string
  message: string
  read: boolean
  createdAt: string
}

export class NotificationsDO extends DO {
  protected routes(app: Hono): void {
    // List notifications for a user
    app.get('/notifications', async (c) => {
      const notifications = await this.things.list({ type: 'Notification' })
      return c.json({ notifications })
    })

    // Mark notification as read
    app.post('/notifications/:id/read', async (c) => {
      const id = c.req.param('id')
      const updated = await this.things.update(id, { read: true })
      return c.json(updated)
    })
  }

  // RPC method: Create a notification
  async notify(params: { userId: string; message: string }): Promise<Notification> {
    const notification = await this.things.create({
      $type: 'Notification',
      userId: params.userId,
      message: params.message,
      read: false,
      createdAt: new Date().toISOString()
    })

    console.log(`[Notification] Created: "${params.message}" for user ${params.userId}`)

    return notification as unknown as Notification
  }

  // RPC method: Get unread count
  async getUnreadCount(userId: string): Promise<number> {
    const all = await this.things.list({ type: 'Notification' }) as Notification[]
    return all.filter(n => n.userId === userId && !n.read).length
  }
}
```

### 6.2 Update Wrangler Config

Update `wrangler.toml`:

```toml
name = "my-dotdo-app"
main = "src/index.ts"
compatibility_date = "2024-12-30"

[durable_objects]
bindings = [
  { name = "TASKS", class_name = "TasksDO" },
  { name = "NOTIFICATIONS", class_name = "NotificationsDO" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["TasksDO", "NotificationsDO"]
```

### 6.3 Call Notifications from Tasks

Update `src/tasks-do.ts` to call the Notifications DO:

```typescript
import { Hono } from 'hono'
import { DO, type DOEnv, createContext, type WorkflowContext } from 'dotdo'

export interface Env extends DOEnv {
  TASKS: DurableObjectNamespace<TasksDO>
  NOTIFICATIONS: DurableObjectNamespace  // Add this binding
}

// ... interface definitions ...

export class TasksDO extends DO {
  private $: WorkflowContext
  private notificationStub: DurableObjectStub | null = null

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    this.$ = createContext(state, env)

    // Get a stub for the notifications DO
    // We use a single instance for all notifications
    const notifId = (env as Env).NOTIFICATIONS.idFromName('global')
    this.notificationStub = (env as Env).NOTIFICATIONS.get(notifId)

    // Send notification when task is completed
    this.$.on.Task.completed(async (event) => {
      const { taskId, title } = event.payload as { taskId: string; title: string }

      // Call the notification DO via RPC
      if (this.notificationStub) {
        await this.notificationStub.notify({
          userId: 'default-user',  // In a real app, get from auth context
          message: `Task completed: "${title}"`
        })
      }

      // Broadcast to WebSocket clients
      this.broadcastUpdate('task:completed', { taskId, title })
    })

    // ... other event handlers ...
  }

  // ... rest of the implementation ...
}
```

### 6.4 Using the $ Context for Cross-DO RPC

For type-safe cross-DO calls, use the `$` context:

```typescript
// In your constructor
this.$.on.Task.completed(async (event) => {
  const { taskId, title } = event.payload as { taskId: string; title: string }

  // Using $ context - provides caching and retry logic
  await this.$.Notifications('global').notify({
    userId: 'default-user',
    message: `Task completed: "${title}"`
  })
})
```

### 6.5 Update the Worker Entry Point

Update `src/index.ts`:

```typescript
import { TasksDO } from './tasks-do'
import { NotificationsDO } from './notifications-do'
import type { Env } from './tasks-do'

// Export both DO classes
export { TasksDO, NotificationsDO }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Route: /notifications/* -> NotificationsDO
    if (url.pathname.startsWith('/notifications')) {
      const id = env.NOTIFICATIONS.idFromName('global')
      const stub = env.NOTIFICATIONS.get(id)
      return stub.fetch(request)
    }

    // Route: /tasks/* or /:namespace/* -> TasksDO
    const match = url.pathname.match(/^\/([^\/]+)(.*)$/)
    if (match) {
      const [, namespace, rest] = match
      const id = env.TASKS.idFromName(namespace)
      const stub = env.TASKS.get(id)

      const doUrl = new URL(request.url)
      doUrl.pathname = rest || '/'
      return stub.fetch(new Request(doUrl, request))
    }

    return new Response('Not found', { status: 404 })
  }
}
```

**What you learned:**

- How to create multiple DO classes
- Cross-DO communication via RPC
- Using `$` context for typed RPC calls

---

## Step 7: Testing Your DO

dotdo embraces a **NO MOCKS** philosophy - use real miniflare instances with real SQLite.

### 7.1 Configure Vitest

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
            TASKS: 'TasksDO',
            NOTIFICATIONS: 'NotificationsDO'
          }
        }
      }
    }
  }
})
```

### 7.2 Write Tests

Create `tests/tasks-do.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

// Declare the test environment types
declare module 'cloudflare:test' {
  interface ProvidedEnv {
    TASKS: DurableObjectNamespace
    NOTIFICATIONS: DurableObjectNamespace
  }
}

describe('TasksDO', () => {
  // Helper to get a fresh DO instance for each test
  function getTasksDO(name = `test-${Date.now()}-${Math.random()}`) {
    const id = env.TASKS.idFromName(name)
    return env.TASKS.get(id)
  }

  describe('CRUD Operations', () => {
    it('should create a task', async () => {
      const tasksDO = getTasksDO()

      // Create via HTTP
      const res = await tasksDO.fetch(
        new Request('https://test/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Test task', priority: 'high' })
        })
      )

      expect(res.status).toBe(201)

      const task = await res.json() as { $id: string; title: string }
      expect(task.$id).toBeDefined()
      expect(task.title).toBe('Test task')
    })

    it('should list tasks', async () => {
      const tasksDO = getTasksDO()

      // Create some tasks
      await tasksDO.fetch(
        new Request('https://test/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Task 1' })
        })
      )
      await tasksDO.fetch(
        new Request('https://test/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Task 2' })
        })
      )

      // List tasks
      const res = await tasksDO.fetch(new Request('https://test/tasks'))
      expect(res.status).toBe(200)

      const data = await res.json() as { tasks: unknown[]; total: number }
      expect(data.tasks).toHaveLength(2)
      expect(data.total).toBe(2)
    })

    it('should update a task', async () => {
      const tasksDO = getTasksDO()

      // Create a task
      const createRes = await tasksDO.fetch(
        new Request('https://test/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Original title' })
        })
      )
      const created = await createRes.json() as { $id: string }

      // Update it
      const updateRes = await tasksDO.fetch(
        new Request(`https://test/tasks/${created.$id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Updated title', status: 'in_progress' })
        })
      )

      expect(updateRes.status).toBe(200)

      const updated = await updateRes.json() as { title: string; status: string }
      expect(updated.title).toBe('Updated title')
      expect(updated.status).toBe('in_progress')
    })

    it('should complete a task', async () => {
      const tasksDO = getTasksDO()

      // Create a task
      const createRes = await tasksDO.fetch(
        new Request('https://test/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Task to complete' })
        })
      )
      const created = await createRes.json() as { $id: string }

      // Complete it
      const completeRes = await tasksDO.fetch(
        new Request(`https://test/tasks/${created.$id}/complete`, {
          method: 'POST'
        })
      )

      expect(completeRes.status).toBe(200)

      const completed = await completeRes.json() as { status: string }
      expect(completed.status).toBe('completed')
    })

    it('should delete a task', async () => {
      const tasksDO = getTasksDO()

      // Create a task
      const createRes = await tasksDO.fetch(
        new Request('https://test/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Task to delete' })
        })
      )
      const created = await createRes.json() as { $id: string }

      // Delete it
      const deleteRes = await tasksDO.fetch(
        new Request(`https://test/tasks/${created.$id}`, {
          method: 'DELETE'
        })
      )

      expect(deleteRes.status).toBe(204)

      // Verify it's gone
      const getRes = await tasksDO.fetch(
        new Request(`https://test/tasks/${created.$id}`)
      )
      expect(getRes.status).toBe(404)
    })
  })

  describe('Error Handling', () => {
    it('should return 400 for missing title', async () => {
      const tasksDO = getTasksDO()

      const res = await tasksDO.fetch(
        new Request('https://test/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})  // No title
        })
      )

      expect(res.status).toBe(400)
      const error = await res.json() as { error: string }
      expect(error.error).toContain('Title')
    })

    it('should return 404 for non-existent task', async () => {
      const tasksDO = getTasksDO()

      const res = await tasksDO.fetch(
        new Request('https://test/tasks/non-existent-id')
      )

      expect(res.status).toBe(404)
    })
  })

  describe('Persistence', () => {
    it('should persist tasks across requests', async () => {
      // Use the same name to get the same DO instance
      const doName = `persistence-test-${Date.now()}`

      // First request: create a task
      const do1 = getTasksDO(doName)
      await do1.fetch(
        new Request('https://test/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Persistent task' })
        })
      )

      // Second request: same DO, should still have the task
      const do2 = getTasksDO(doName)
      const res = await do2.fetch(new Request('https://test/tasks'))
      const data = await res.json() as { tasks: { title: string }[] }

      expect(data.tasks).toHaveLength(1)
      expect(data.tasks[0].title).toBe('Persistent task')
    })
  })
})
```

### 7.3 Run Tests

```bash
# Run all tests
npm test

# Run tests once (for CI)
npx vitest run

# Run specific test file
npx vitest run tests/tasks-do.test.ts

# Run with verbose output
npx vitest run --reporter=verbose
```

### 7.4 Add Test Scripts to package.json

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

**What you learned:**

- How to configure Vitest with miniflare
- Testing DOs with real SQLite (no mocks!)
- Testing CRUD operations, error handling, and persistence

---

## Step 8: Deploying to Production

### 8.1 Pre-deployment Checklist

```bash
# 1. Run type checks
npm run typecheck

# 2. Run all tests
npm run test:run

# 3. Make sure you're logged in
wrangler whoami
```

### 8.2 Deploy

```bash
# Deploy to Cloudflare
wrangler deploy
```

Output:

```
Uploaded my-dotdo-app (2.34 sec)
Published my-dotdo-app (0.89 sec)
  https://my-dotdo-app.your-subdomain.workers.dev
```

### 8.3 Test Production

```bash
export WORKER_URL="https://my-dotdo-app.your-subdomain.workers.dev"

# Test the health endpoint
curl $WORKER_URL/my-tasks/
# {"status":"ok","id":"..."}

# Create a task
curl -X POST $WORKER_URL/my-tasks/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "Production task!", "priority": "high"}'

# List tasks
curl $WORKER_URL/my-tasks/tasks
```

### 8.4 View Logs

```bash
# Tail production logs
wrangler tail

# Filter by status
wrangler tail --status error

# Filter by method
wrangler tail --search "POST"
```

### 8.5 Production CORS Configuration

For production, configure explicit CORS origins:

```typescript
export class TasksDO extends DO {
  constructor(state: DurableObjectState, env: DOEnv) {
    super(state, env, {
      cors: {
        allowedOrigins: [
          'https://your-app.com',
          'https://staging.your-app.com'
        ],
        allowedMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
        credentials: true,
        maxAge: 86400
      }
    })

    // ... rest of constructor
  }
}
```

**What you learned:**

- How to deploy to Cloudflare
- Monitoring production with `wrangler tail`
- Configuring CORS for production

---

## Summary and Next Steps

Congratulations! You've built a complete task management system with:

- CRUD operations using SQLite storage
- Event-driven architecture with `$.on.Noun.verb`
- Real-time updates via WebSockets
- Scheduled cleanup and reporting jobs
- Cross-DO communication
- Comprehensive tests
- Production deployment

### Key Concepts Recap

| Concept | What You Learned |
|---------|------------------|
| **DO Class** | Extend `DO` from dotdo, override `routes()` for endpoints |
| **Entity Stores** | Use `this.things`, `this.events`, `this.relationships` for storage |
| **Events** | Fire with `$.send()`, handle with `$.on.Noun.verb()` |
| **WebSockets** | Use `ws.handleWebSocketUpgrade()`, `ws.broadcast()` |
| **Scheduling** | Use `$.every.day.at('9am')()` DSL |
| **Cross-DO RPC** | Call methods directly on DO stubs |
| **Testing** | Use real miniflare instances, no mocks |

### Next Steps

1. **Add Authentication**: Check out `@dotdo/auth` for JWT-based auth
2. **Build a Frontend**: Use `@dotdo/app` with TanStack Start
3. **Add AI Features**: Explore `@dotdo/ai` for template literal AI
4. **Read the ADRs**: Understand architectural decisions in `/docs/adr/`

### Resources

- [GETTING_STARTED.md](/docs/GETTING_STARTED.md) - Detailed setup guide
- [TROUBLESHOOTING.md](/docs/TROUBLESHOOTING.md) - Common issues
- [Examples](/examples/) - Complete example applications
- [ADRs](/docs/adr/) - Architecture Decision Records

---

## Quick Reference Card

### Project Structure

```
my-dotdo-app/
  src/
    index.ts          # Worker entry point
    tasks-do.ts       # Your DO class
    notifications-do.ts
  tests/
    tasks-do.test.ts  # Tests
  package.json
  tsconfig.json
  wrangler.toml       # Cloudflare config
  vitest.config.ts    # Test config
```

### Essential Commands

```bash
wrangler dev              # Start dev server
wrangler dev --persist    # With persistence
npm test                  # Run tests (watch)
npx vitest run            # Run tests once
npm run typecheck         # Type check
wrangler deploy           # Deploy to production
wrangler tail             # View logs
```

### Key Patterns

```typescript
// Entity CRUD
await this.things.create({ $type: 'Task', title: 'New' })
await this.things.get(id)
await this.things.update(id, { status: 'done' })
await this.things.delete(id)
await this.things.list({ type: 'Task' })

// Events
this.$.on.Task.created(handler)
this.$.send({ type: 'Task.created', payload: {...} })

// Scheduling
this.$.every.day.at('9am')(handler)
this.$.every.hour(handler)

// WebSockets
this.ws.handleWebSocketUpgrade(state, ['tag'], true)
this.ws.broadcast(state, 'tag', message)
this.ws.broadcastAll(state, message)

// Cross-DO RPC
const stub = env.OTHER_DO.get(env.OTHER_DO.idFromName('id'))
await stub.methodName(args)
```

---

Happy building with dotdo!
