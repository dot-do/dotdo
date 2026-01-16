# dotdo Minimal Example

A complete, runnable example demonstrating core dotdo features in under 50 lines of core logic.

## Features Demonstrated

- **Durable Object with SQLite storage** - Persistent state across requests
- **CRUD operations via Hono routes** - RESTful API endpoints
- **RPC methods** - Direct method calls from worker to DO

## Quick Start

```bash
cd examples/minimal
npm install
npm run dev
```

Then open http://localhost:8787 in your browser.

## API Endpoints

### List Tasks
```bash
curl http://localhost:8787/tasks
```

### Create Task
```bash
curl -X POST http://localhost:8787/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "Learn dotdo"}'
```

### Get Task
```bash
curl http://localhost:8787/tasks/{id}
```

### Toggle Task Completion
```bash
curl -X PATCH http://localhost:8787/tasks/{id}/toggle
```

### Delete Task
```bash
curl -X DELETE http://localhost:8787/tasks/{id}
```

## RPC Methods

The worker demonstrates two ways to interact with the DO:

### 1. Pass-through to DO's Hono router
```typescript
// Request goes directly to DO's fetch handler
return stub.fetch(request)
```

### 2. Direct RPC method calls
```typescript
// Call DO method directly from worker
const result = await stub.ping()
const task = await stub.createTask('My task')
```

Test RPC endpoints:
```bash
# Ping
curl http://localhost:8787/rpc/ping

# Create via RPC
curl -X POST http://localhost:8787/rpc/create \
  -H "Content-Type: application/json" \
  -d '{"title": "Created via RPC"}'
```

## File Structure

```
examples/minimal/
├── README.md          # This file
├── package.json       # Dependencies
├── wrangler.toml      # Cloudflare config
├── tsconfig.json      # TypeScript config
└── src/
    └── index.ts       # DO + Worker (~150 lines)
```

## Key Concepts

### SQLite Storage
```typescript
// Initialize schema in constructor
this.ctx.storage.sql.exec(`
  CREATE TABLE IF NOT EXISTS tasks (...)
`)

// Query data
const rows = this.ctx.storage.sql.exec('SELECT * FROM tasks').toArray()
```

### Hono Routing
```typescript
this.app.get('/tasks', (c) => c.json({ tasks: this.listTasks() }))
this.app.post('/tasks', async (c) => { ... })
```

### RPC Methods
Any public method on the DO class can be called via RPC:
```typescript
// In DO class
ping(): string {
  return 'pong'
}

// From worker
const result = await stub.ping()
```

## Deploy

```bash
npm run deploy
```

## Next Steps

- See `/examples/redis.example.org.ai` for Redis-compatible caching
- See `/core/DOCore.ts` for the full DO base class with events, scheduling, and more
