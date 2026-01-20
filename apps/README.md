# dotdo Example Applications

This directory contains example applications demonstrating dotdo capabilities with Cloudflare Workers and Durable Objects.

## Examples

| Example | Description | Key Features |
|---------|-------------|--------------|
| [todo-app](./todo-app) | Simple CRUD todo list | DO storage, Hono routing, SQLite |
| [auth-api](./auth-api) | JWT authentication API | Password hashing, JWT tokens, protected routes |
| [realtime-chat](./realtime-chat) | WebSocket chat rooms | Real-time messaging, hibernation, broadcast |
| [dashboard](./dashboard) | Operator dashboard | DO monitoring, metrics, events, state inspection |

## Quick Start

Each example is self-contained. To run any example:

```bash
cd apps/<example-name>
npm install
npm run dev
```

## Architecture Patterns

### 1. Worker + Durable Object Split

```
Worker (stateless)          Durable Object (stateful)
    |                           |
    +-> Routes requests  --->   +-> Handles business logic
    +-> JWT verification        +-> SQLite storage
    +-> CORS, logging           +-> WebSocket connections
```

### 2. Namespace-Based Routing

```typescript
// Route to DO based on user ID, room name, etc.
const id = env.MY_DO.idFromName(namespace)
const stub = env.MY_DO.get(id)
return stub.fetch(request)
```

### 3. Internal Hono App

```typescript
export class MyDO implements DurableObject {
  private app = new Hono()

  constructor(state, env) {
    // Setup routes inside DO
    this.app.get('/data', (c) => c.json(this.getData()))
    this.app.post('/data', async (c) => { /* ... */ })
  }

  fetch(request) {
    return this.app.fetch(request)
  }
}
```

### 4. SQLite Storage

```typescript
// Initialize schema
this.sql.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  )
`)

// Query with type safety
const cursor = this.sql.exec<ItemRow>(
  'SELECT * FROM items WHERE id = ?',
  id
)
const rows = [...cursor]
```

## Common Patterns

### Error Handling

```typescript
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status)
  }
  return c.json({ error: 'Internal error' }, 500)
})
```

### Type-Safe Requests

```typescript
interface CreateRequest {
  title: string
  completed?: boolean
}

app.post('/items', async (c) => {
  const body = await c.req.json<CreateRequest>()
  // body is typed!
})
```

### WebSocket Handling

```typescript
// In DO constructor
this.state.acceptWebSocket(server)

// Handler methods
async webSocketMessage(ws, message) { /* ... */ }
async webSocketClose(ws, code, reason) { /* ... */ }
```

## Development Tips

1. **Use `wrangler dev`** for local development with real DO behavior
2. **Check SQLite queries** with `this.sql.exec()` returning cursors
3. **Spread cursors** to arrays: `const rows = [...cursor]`
4. **Use hibernation** for WebSockets to reduce costs

## Deployment

Deploy any example to Cloudflare:

```bash
cd apps/<example-name>
npm run deploy
```

For production secrets:

```bash
wrangler secret put JWT_SECRET
wrangler secret put API_KEY
```

## Learn More

- [dotdo Documentation](../README.md)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Hono Framework](https://hono.dev/)
