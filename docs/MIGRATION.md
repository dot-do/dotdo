# Migration Guide: Node.js/Express to dotdo

This guide helps developers migrate from traditional Node.js/Express applications to dotdo and Cloudflare Workers with Durable Objects. It covers conceptual differences, pattern mappings, and practical code transformations.

## Table of Contents

1. [Conceptual Differences](#conceptual-differences)
2. [Express Routes to Hono Routes](#express-routes-to-hono-routes)
3. [Session Storage to DO State](#session-storage-to-do-state)
4. [Database Patterns](#database-patterns)
5. [Middleware Patterns](#middleware-patterns)
6. [WebSocket Differences](#websocket-differences)
7. [Gotchas and Pitfalls](#gotchas-and-pitfalls)

---

## Conceptual Differences

### Stateless vs Stateful Edge

| Aspect | Node.js/Express | dotdo/Durable Objects |
|--------|-----------------|----------------------|
| **Architecture** | Stateless servers behind load balancer | Stateful objects at the edge |
| **Scaling** | Horizontal (add more servers) | Automatic (DOs scale per-object) |
| **State** | External (Redis, PostgreSQL) | Built-in (SQLite per DO) |
| **Location** | Fixed data center | Runs closest to user |
| **Concurrency** | Multiple concurrent requests | Single-threaded per DO |
| **Cold starts** | Process startup + connections | Milliseconds (hibernation wake) |

### Mental Model Shift

**Express (Request-Response Cycle):**
```
Request -> Middleware -> Route Handler -> Database -> Response
                              |
                    (Stateless, any instance)
```

**dotdo (Object-Oriented Edge):**
```
Request -> Worker -> DO Instance -> Hono Routes -> SQLite -> Response
                          |
              (Stateful, same instance per ID)
```

### Key Insight

In Express, you manage state externally and any server handles any request. In dotdo, **the state is the instance**. Each Durable Object is a stateful singleton identified by its ID. When you call `env.DO.idFromName('user-123')`, you always get the same instance with its own SQLite database.

---

## Express Routes to Hono Routes

Hono is a lightweight, Express-like framework designed for edge runtimes. Most Express patterns translate directly.

### Basic Route Mapping

**Express:**
```typescript
import express from 'express'

const app = express()

app.get('/users', (req, res) => {
  res.json({ users: [] })
})

app.get('/users/:id', (req, res) => {
  const { id } = req.params
  res.json({ user: { id } })
})

app.post('/users', express.json(), (req, res) => {
  const user = req.body
  res.status(201).json(user)
})

app.listen(3000)
```

**Hono (in dotdo):**
```typescript
import { Hono } from 'hono'
import { DurableObject } from 'cloudflare:workers'

export class UserDO extends DurableObject {
  private app: Hono

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.app = this.createApp()
  }

  private createApp(): Hono {
    const app = new Hono()

    app.get('/users', (c) => {
      return c.json({ users: [] })
    })

    app.get('/users/:id', (c) => {
      const id = c.req.param('id')
      return c.json({ user: { id } })
    })

    app.post('/users', async (c) => {
      const user = await c.req.json()
      return c.json(user, 201)
    })

    return app
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request)
  }
}
```

### Key Differences

| Express | Hono |
|---------|------|
| `req.params.id` | `c.req.param('id')` |
| `req.query.page` | `c.req.query('page')` |
| `req.body` | `await c.req.json()` |
| `res.json(data)` | `return c.json(data)` |
| `res.status(201).json()` | `return c.json(data, 201)` |
| `res.send(text)` | `return c.text(text)` |
| `res.redirect(url)` | `return c.redirect(url)` |
| `next()` | `await next()` |

### Router Grouping

**Express:**
```typescript
const router = express.Router()
router.get('/', listUsers)
router.post('/', createUser)
router.get('/:id', getUser)
app.use('/api/users', router)
```

**Hono:**
```typescript
const users = new Hono()
users.get('/', listUsers)
users.post('/', createUser)
users.get('/:id', getUser)
app.route('/api/users', users)
```

---

## Session Storage to DO State

Traditional session management with Redis or databases is replaced by Durable Object state.

### Express Session with Redis

**Before (Express + Redis):**
```typescript
import session from 'express-session'
import RedisStore from 'connect-redis'
import { createClient } from 'redis'

const redisClient = createClient({ url: process.env.REDIS_URL })
await redisClient.connect()

app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: true, maxAge: 86400000 }
}))

app.get('/profile', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' })
  }
  res.json({ userId: req.session.userId })
})

app.post('/login', async (req, res) => {
  const { email, password } = req.body
  const user = await validateCredentials(email, password)
  if (user) {
    req.session.userId = user.id
    req.session.save()
    res.json({ success: true })
  }
})
```

### dotdo Session with DO State

**After (dotdo):**
```typescript
import { DurableObject } from 'cloudflare:workers'
import { Hono } from 'hono'

interface SessionData {
  userId: string
  createdAt: number
  lastAccess: number
}

export class SessionDO extends DurableObject {
  private app: Hono
  private initialized = false

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.app = this.createApp()
  }

  private ensureInitialized(): void {
    if (this.initialized) return
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_access INTEGER NOT NULL,
        data TEXT
      )
    `)
    this.initialized = true
  }

  // Session methods exposed via RPC
  async getSession(sessionId: string): Promise<SessionData | null> {
    this.ensureInitialized()
    const rows = this.ctx.storage.sql
      .exec('SELECT * FROM sessions WHERE id = ?', sessionId)
      .toArray()

    if (rows.length === 0) return null

    // Update last access
    const now = Date.now()
    this.ctx.storage.sql.exec(
      'UPDATE sessions SET last_access = ? WHERE id = ?',
      now, sessionId
    )

    return {
      userId: rows[0].user_id as string,
      createdAt: rows[0].created_at as number,
      lastAccess: now
    }
  }

  async createSession(userId: string): Promise<string> {
    this.ensureInitialized()
    const sessionId = crypto.randomUUID()
    const now = Date.now()

    this.ctx.storage.sql.exec(
      'INSERT INTO sessions (id, user_id, created_at, last_access) VALUES (?, ?, ?, ?)',
      sessionId, userId, now, now
    )

    return sessionId
  }

  async destroySession(sessionId: string): Promise<void> {
    this.ensureInitialized()
    this.ctx.storage.sql.exec('DELETE FROM sessions WHERE id = ?', sessionId)
  }

  private createApp(): Hono {
    const app = new Hono()

    app.get('/profile', async (c) => {
      const sessionId = c.req.header('X-Session-ID')
      if (!sessionId) {
        return c.json({ error: 'Not authenticated' }, 401)
      }

      const session = await this.getSession(sessionId)
      if (!session) {
        return c.json({ error: 'Session expired' }, 401)
      }

      return c.json({ userId: session.userId })
    })

    app.post('/login', async (c) => {
      const { email, password } = await c.req.json()
      const user = await this.validateCredentials(email, password)

      if (user) {
        const sessionId = await this.createSession(user.id)
        return c.json({ success: true, sessionId })
      }

      return c.json({ error: 'Invalid credentials' }, 401)
    })

    return app
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request)
  }
}
```

### Session Architecture Pattern

In dotdo, you have two main patterns for sessions:

**Pattern 1: Session per User DO**
Each user has their own DO containing their session data. Session ID is derived from user ID.

```typescript
// Worker entry point
const id = env.SESSION.idFromName(`user:${userId}`)
const sessionDO = env.SESSION.get(id)
await sessionDO.validateSession(sessionToken)
```

**Pattern 2: Centralized Session DO**
A single DO manages all sessions (simpler but less scalable).

```typescript
// Worker entry point
const id = env.SESSION.idFromName('sessions')
const sessionDO = env.SESSION.get(id)
await sessionDO.getSession(sessionId)
```

---

## Database Patterns

### Sequelize to Things/Relationships

Traditional ORMs like Sequelize map to a graph-based data model in dotdo.

**Express + Sequelize:**
```typescript
import { Sequelize, DataTypes, Model } from 'sequelize'

const sequelize = new Sequelize(process.env.DATABASE_URL)

class User extends Model {
  declare id: string
  declare name: string
  declare email: string
}

User.init({
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false, unique: true }
}, { sequelize, tableName: 'users' })

class Post extends Model {
  declare id: string
  declare title: string
  declare content: string
  declare authorId: string
}

Post.init({
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  title: { type: DataTypes.STRING, allowNull: false },
  content: { type: DataTypes.TEXT },
  authorId: { type: DataTypes.UUID, references: { model: User, key: 'id' } }
}, { sequelize, tableName: 'posts' })

User.hasMany(Post, { foreignKey: 'authorId' })
Post.belongsTo(User, { foreignKey: 'authorId' })

// Usage
const users = await User.findAll({ include: Post })
const userWithPosts = await User.findByPk(userId, { include: Post })
```

**dotdo with Things/Relationships:**
```typescript
import { DurableObject } from 'cloudflare:workers'

interface Thing {
  id: string
  type: string
  data: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

interface Relationship {
  id: string
  fromId: string
  toId: string
  type: string
  data?: Record<string, unknown>
  createdAt: number
}

export class GraphDO extends DurableObject {
  private initialized = false

  private ensureInitialized(): void {
    if (this.initialized) return

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS things (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_things_type ON things(type);

      CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        type TEXT NOT NULL,
        data TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (from_id) REFERENCES things(id),
        FOREIGN KEY (to_id) REFERENCES things(id)
      );

      CREATE INDEX IF NOT EXISTS idx_rel_from ON relationships(from_id);
      CREATE INDEX IF NOT EXISTS idx_rel_to ON relationships(to_id);
      CREATE INDEX IF NOT EXISTS idx_rel_type ON relationships(type);
    `)

    this.initialized = true
  }

  // Create a Thing (like a Sequelize model instance)
  async createThing(type: string, data: Record<string, unknown>): Promise<Thing> {
    this.ensureInitialized()
    const id = crypto.randomUUID()
    const now = Date.now()

    this.ctx.storage.sql.exec(
      'INSERT INTO things (id, type, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      id, type, JSON.stringify(data), now, now
    )

    return { id, type, data, createdAt: now, updatedAt: now }
  }

  // Create a relationship (like Sequelize associations)
  async relate(fromId: string, toId: string, type: string, data?: Record<string, unknown>): Promise<Relationship> {
    this.ensureInitialized()
    const id = crypto.randomUUID()
    const now = Date.now()

    this.ctx.storage.sql.exec(
      'INSERT INTO relationships (id, from_id, to_id, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id, fromId, toId, type, data ? JSON.stringify(data) : null, now
    )

    return { id, fromId, toId, type, data, createdAt: now }
  }

  // Find things by type (like User.findAll())
  async findByType(type: string): Promise<Thing[]> {
    this.ensureInitialized()
    const rows = this.ctx.storage.sql
      .exec('SELECT * FROM things WHERE type = ? ORDER BY created_at DESC', type)
      .toArray()

    return rows.map(row => ({
      id: row.id as string,
      type: row.type as string,
      data: JSON.parse(row.data as string),
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number
    }))
  }

  // Find with relationships (like include: [Post])
  async findWithRelated(id: string, relationType: string): Promise<{ thing: Thing, related: Thing[] }> {
    this.ensureInitialized()

    // Get the main thing
    const thingRows = this.ctx.storage.sql
      .exec('SELECT * FROM things WHERE id = ?', id)
      .toArray()

    if (thingRows.length === 0) {
      throw new Error('Thing not found')
    }

    const thing: Thing = {
      id: thingRows[0].id as string,
      type: thingRows[0].type as string,
      data: JSON.parse(thingRows[0].data as string),
      createdAt: thingRows[0].created_at as number,
      updatedAt: thingRows[0].updated_at as number
    }

    // Get related things
    const relatedRows = this.ctx.storage.sql.exec(`
      SELECT t.* FROM things t
      JOIN relationships r ON t.id = r.to_id
      WHERE r.from_id = ? AND r.type = ?
    `, id, relationType).toArray()

    const related = relatedRows.map(row => ({
      id: row.id as string,
      type: row.type as string,
      data: JSON.parse(row.data as string),
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number
    }))

    return { thing, related }
  }
}

// Usage in routes
app.post('/users', async (c) => {
  const { name, email } = await c.req.json()
  const user = await this.createThing('User', { name, email })
  return c.json(user, 201)
})

app.post('/users/:userId/posts', async (c) => {
  const userId = c.req.param('userId')
  const { title, content } = await c.req.json()

  const post = await this.createThing('Post', { title, content })
  await this.relate(userId, post.id, 'authored')

  return c.json(post, 201)
})

app.get('/users/:userId', async (c) => {
  const userId = c.req.param('userId')
  const { thing: user, related: posts } = await this.findWithRelated(userId, 'authored')

  return c.json({ ...user.data, id: user.id, posts })
})
```

### Key Differences

| Sequelize | dotdo Things/Relationships |
|-----------|---------------------------|
| Centralized PostgreSQL | Distributed SQLite per DO |
| Model classes | Generic Thing with type |
| Foreign keys | Relationship table |
| `include: [Model]` | `findWithRelated(id, type)` |
| Migrations | Schema in `ensureInitialized()` |
| Connection pooling | No connections needed |

---

## Middleware Patterns

Express middleware translates to Hono middleware with minor syntax differences.

### Authentication Middleware

**Express:**
```typescript
import jwt from 'jsonwebtoken'

const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1]

  if (!token) {
    return res.status(401).json({ error: 'No token provided' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = decoded
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

app.use('/api', authenticate)
```

**Hono:**
```typescript
import { createMiddleware } from 'hono/factory'
import { jwt } from 'hono/jwt'

// Option 1: Built-in JWT middleware
app.use('/api/*', jwt({ secret: env.JWT_SECRET }))

// Option 2: Custom middleware
const authenticate = createMiddleware(async (c, next) => {
  const token = c.req.header('Authorization')?.split(' ')[1]

  if (!token) {
    return c.json({ error: 'No token provided' }, 401)
  }

  try {
    // Using RPC to JOSE worker for JWT operations
    const decoded = await c.env.JOSE.verify(token)
    c.set('user', decoded)
    await next()
  } catch (err) {
    return c.json({ error: 'Invalid token' }, 401)
  }
})

app.use('/api/*', authenticate)
```

### Error Handling Middleware

**Express:**
```typescript
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message
  })
})
```

**Hono:**
```typescript
app.onError((err, c) => {
  console.error('Error:', err.message)
  return c.json({
    error: c.env.ENVIRONMENT === 'production'
      ? 'Internal server error'
      : err.message
  }, 500)
})

// Not found handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404)
})
```

### Request Logging Middleware

**Express:**
```typescript
import morgan from 'morgan'
app.use(morgan('combined'))
```

**Hono:**
```typescript
import { logger } from 'hono/logger'
app.use(logger())

// Or custom logging
app.use(async (c, next) => {
  const start = Date.now()
  await next()
  const ms = Date.now() - start
  console.log(`${c.req.method} ${c.req.url} - ${ms}ms`)
})
```

### CORS Middleware

**Express:**
```typescript
import cors from 'cors'
app.use(cors({
  origin: ['https://example.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}))
```

**Hono:**
```typescript
import { cors } from 'hono/cors'
app.use('/*', cors({
  origin: ['https://example.com'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}))
```

---

## WebSocket Differences

WebSocket handling in dotdo uses Cloudflare's hibernatable WebSockets, which are fundamentally different from traditional WebSocket libraries.

### Express + ws Library

**Before:**
```typescript
import WebSocket, { WebSocketServer } from 'ws'
import http from 'http'

const server = http.createServer(app)
const wss = new WebSocketServer({ server })

const clients = new Map<string, WebSocket>()

wss.on('connection', (ws, req) => {
  const userId = req.url?.split('?userId=')[1]
  clients.set(userId, ws)

  ws.on('message', (data) => {
    const message = JSON.parse(data.toString())

    // Broadcast to all clients
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message))
      }
    })
  })

  ws.on('close', () => {
    clients.delete(userId)
  })

  // Ping/pong for keepalive
  const interval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping()
    }
  }, 30000)

  ws.on('close', () => clearInterval(interval))
})

server.listen(3000)
```

### dotdo Hibernatable WebSockets

**After:**
```typescript
import { DurableObject } from 'cloudflare:workers'

interface WebSocketMessage {
  type: string
  data?: unknown
}

export class ChatRoomDO extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/websocket') {
      return this.handleWebSocket(request)
    }

    return new Response('Not found', { status: 404 })
  }

  private async handleWebSocket(request: Request): Promise<Response> {
    // Upgrade the request to WebSocket
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    // Accept the WebSocket with hibernation support
    // Tags allow grouping for broadcast
    const userId = new URL(request.url).searchParams.get('userId') || 'anonymous'
    this.ctx.acceptWebSocket(server, [userId, 'all'])

    return new Response(null, {
      status: 101,
      webSocket: client
    })
  }

  // Called when WebSocket receives a message (survives hibernation)
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const data = JSON.parse(message as string) as WebSocketMessage

    switch (data.type) {
      case 'chat':
        // Broadcast to all connected clients
        this.ctx.getWebSockets('all').forEach(socket => {
          socket.send(JSON.stringify({
            type: 'chat',
            data: data.data,
            timestamp: Date.now()
          }))
        })
        break

      case 'private':
        // Send to specific user
        const targetId = (data.data as { targetId: string }).targetId
        this.ctx.getWebSockets(targetId).forEach(socket => {
          socket.send(JSON.stringify(data))
        })
        break
    }
  }

  // Called when WebSocket closes
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    // Cleanup if needed
    ws.close(code, reason)
  }

  // Called on WebSocket error
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('WebSocket error:', error)
    ws.close(1011, 'Internal error')
  }
}
```

### Key WebSocket Differences

| Express/ws | dotdo/Cloudflare |
|------------|------------------|
| `new WebSocketServer()` | `new WebSocketPair()` |
| `ws.on('connection')` | `fetch()` with upgrade |
| `ws.on('message')` | `webSocketMessage()` |
| `ws.on('close')` | `webSocketClose()` |
| Manual ping/pong | Automatic (hibernatable) |
| In-memory client map | `ctx.getWebSockets(tag)` |
| Broadcast manually | `ctx.getWebSockets('tag').forEach()` |
| Process stays running | DO hibernates, wakes on message |

### Hibernation Advantage

With traditional WebSockets, your server must stay running to maintain connections. With hibernatable WebSockets, the DO can hibernate (saving resources) and wake up when a message arrives. The WebSocket connections are maintained by Cloudflare's infrastructure.

---

## Gotchas and Pitfalls

### 1. No Global State Between Requests

**Problem:**
```typescript
// Express - This works (same process)
let requestCount = 0
app.get('/count', (req, res) => {
  requestCount++
  res.json({ count: requestCount })
})
```

**In dotdo:**
```typescript
// WRONG - instance variable may be lost after hibernation
let requestCount = 0

// CORRECT - use storage
async getValue(): Promise<number> {
  const result = this.ctx.storage.sql
    .exec('SELECT value FROM counters WHERE key = ?', 'requestCount')
    .toArray()
  return result.length > 0 ? (result[0].value as number) : 0
}
```

### 2. No `require()` or Dynamic Imports

**Problem:**
```typescript
// Node.js - Works
const config = require(`./config/${env}.json`)
```

**Solution:**
```typescript
// dotdo - Use static imports and env vars
import { Env } from './types'

// Configuration via environment variables
const apiKey = env.API_KEY
```

### 3. No File System Access

**Problem:**
```typescript
// Node.js
import fs from 'fs'
const data = fs.readFileSync('./data.json')
```

**Solution:**
```typescript
// dotdo - Use R2 for file storage
const data = await env.R2_BUCKET.get('data.json')
const content = await data?.text()
```

### 4. Different Module Resolution

**Problem:**
```typescript
// Node.js - Works with CommonJS
const { something } = require('some-package')
```

**Solution:**
```typescript
// dotdo - ESM only
import { something } from 'some-package'

// For Cloudflare-specific imports
import { DurableObject } from 'cloudflare:workers'
```

### 5. No Long-Running Background Tasks

**Problem:**
```typescript
// Express - Background processing
setInterval(async () => {
  await processQueue()
}, 60000)
```

**Solution:**
```typescript
// dotdo - Use Durable Object alarms
export class WorkerDO extends DurableObject {
  async scheduleProcessing(): Promise<void> {
    // Schedule alarm for 60 seconds from now
    await this.ctx.storage.setAlarm(Date.now() + 60000)
  }

  async alarm(): Promise<void> {
    await this.processQueue()
    // Reschedule for next run
    await this.ctx.storage.setAlarm(Date.now() + 60000)
  }
}
```

### 6. Request Body Size Limits

**Problem:**
```typescript
// Express - Can configure large body limits
app.use(express.json({ limit: '50mb' }))
```

**Reality in dotdo:**
- Workers have a 100MB request body limit
- But practical limits are lower for performance
- Large uploads should go directly to R2

**Solution:**
```typescript
// Use presigned URLs for large uploads
app.post('/upload-url', async (c) => {
  const { filename } = await c.req.json()
  // Generate presigned URL for direct R2 upload
  const url = await generatePresignedUrl(c.env.R2_BUCKET, filename)
  return c.json({ uploadUrl: url })
})
```

### 7. No Native Node.js APIs

**Problem:**
```typescript
// Node.js
import crypto from 'crypto'
const hash = crypto.createHash('sha256').update(data).digest('hex')
```

**Solution:**
```typescript
// dotdo - Use Web Crypto API
const encoder = new TextEncoder()
const data = encoder.encode('hello')
const hashBuffer = await crypto.subtle.digest('SHA-256', data)
const hashArray = Array.from(new Uint8Array(hashBuffer))
const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
```

### 8. SQLite is Not PostgreSQL

**Common Sequelize patterns that need adjustment:**

```typescript
// PostgreSQL - ILIKE for case-insensitive
WHERE name ILIKE '%john%'

// SQLite - Use LIKE with COLLATE NOCASE
WHERE name LIKE '%john%' COLLATE NOCASE

// PostgreSQL - Array columns
SELECT * FROM users WHERE 'admin' = ANY(roles)

// SQLite - JSON arrays
SELECT * FROM users WHERE json_array_contains(roles, 'admin')

// PostgreSQL - RETURNING
INSERT INTO users (name) VALUES ('John') RETURNING *

// SQLite - Separate SELECT after INSERT
INSERT INTO users (name) VALUES ('John');
SELECT * FROM users WHERE rowid = last_insert_rowid();
```

### 9. Cold Starts vs Hibernation Wake

**Understanding the difference:**

- **Cold Start**: First request to a new DO instance. Schema initialization runs.
- **Hibernation Wake**: DO was sleeping, wakes up. Instance variables may be reset, but storage persists.

```typescript
export class MyDO extends DurableObject {
  private initialized = false  // Reset on hibernation wake!

  private ensureInitialized(): void {
    if (this.initialized) return

    // This runs on EVERY wake from hibernation
    // Keep it fast - check schema, don't recreate
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS ...  -- Idempotent!
    `)

    this.initialized = true
  }
}
```

### 10. Testing Requires Workers Runtime

**Problem:**
```typescript
// Jest/Mocha - Works in Node.js
describe('UserService', () => {
  it('creates user', async () => {
    const user = await userService.create({ name: 'John' })
    expect(user.id).toBeDefined()
  })
})
```

**Solution:**
```typescript
// Vitest with Cloudflare Workers pool
// vitest.config.ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' }
      }
    }
  }
})

// Test file
import { env } from 'cloudflare:test'

describe('UserDO', () => {
  it('creates user', async () => {
    const id = env.USER.idFromName('test-user')
    const stub = env.USER.get(id)
    const user = await stub.createUser({ name: 'John' })
    expect(user.id).toBeDefined()
  })
})
```

---

## Migration Checklist

Use this checklist when migrating an Express application:

- [ ] **Project Setup**
  - [ ] Initialize with `wrangler init` or `npm create cloudflare`
  - [ ] Configure `wrangler.toml` with DO bindings
  - [ ] Set up TypeScript with `@cloudflare/workers-types`
  - [ ] Configure Vitest with Workers pool

- [ ] **Routes**
  - [ ] Convert Express routes to Hono routes
  - [ ] Update request/response patterns
  - [ ] Convert route parameters syntax

- [ ] **Middleware**
  - [ ] Convert authentication middleware
  - [ ] Convert error handling
  - [ ] Convert logging/monitoring

- [ ] **State Management**
  - [ ] Replace Redis sessions with DO state
  - [ ] Convert Sequelize models to Things/Relationships
  - [ ] Migrate data to SQLite schemas

- [ ] **External Services**
  - [ ] Replace file system with R2
  - [ ] Replace background jobs with DO alarms
  - [ ] Update API clients for edge compatibility

- [ ] **Testing**
  - [ ] Convert Jest/Mocha tests to Vitest
  - [ ] Configure Miniflare for integration tests
  - [ ] Add Workers-specific test utilities

- [ ] **Deployment**
  - [ ] Configure wrangler secrets
  - [ ] Set up CI/CD with Wrangler
  - [ ] Configure custom domains

---

## Further Reading

- [Getting Started Guide](/docs/getting-started.md)
- [Troubleshooting Guide](/docs/TROUBLESHOOTING.md)
- [Cloudflare Durable Objects Documentation](https://developers.cloudflare.com/durable-objects/)
- [Hono Documentation](https://hono.dev/)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
