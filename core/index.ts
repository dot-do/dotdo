import { DurableObject } from 'cloudflare:workers'
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'

export interface Env {
  DOCore: DurableObjectNamespace<DOCore>
}

interface ListOptions {
  prefix?: string
  start?: string
  end?: string
  limit?: number
  reverse?: boolean
}

interface TransactionOp {
  op: 'set' | 'delete' | 'error'
  key?: string
  value?: unknown
}

// Extended context type with our custom variables
type Variables = {
  middlewareExecuted: boolean
  requestId: string
  doState: DOCore
  env: Env
}

type HonoEnv = {
  Bindings: Env
  Variables: Variables
}

export class DOCore extends DurableObject<Env> {
  private app: Hono<HonoEnv>
  private started = false
  private wakeCount = 0
  private websocketTags = new Map<WebSocket, string[]>()
  private hibernatableWebSockets = new Set<WebSocket>()
  private lastWebSocketTags: string[] = []
  private lastWebSocketHibernatable = false

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Initialize SQLite table synchronously
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS state (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `)

    this.app = this.createApp()

    // Synchronous initialization - no async in constructor
    this.initSync()
  }

  private initSync(): void {
    if (this.started) return

    // Use synchronous SQL for lifecycle tracking
    const countResult = this.ctx.storage.sql
      .exec('SELECT value FROM state WHERE key = ?', '_lifecycle:onStartCount')
      .toArray()
    const count = countResult.length > 0 ? JSON.parse(countResult[0].value as string) : 0

    // Set lifecycle state synchronously
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)',
      '_lifecycle:onStart',
      'true'
    )
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)',
      '_lifecycle:onStartCount',
      JSON.stringify(count + 1)
    )
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)',
      '_initialized',
      'true'
    )

    this.started = true
  }

  private createApp(): Hono<HonoEnv> {
    const app = new Hono<HonoEnv>()

    // CORS middleware
    app.use('*', cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
    }))

    // Global middleware - adds version header and context vars
    app.use('*', async (c, next) => {
      c.set('middlewareExecuted', true)
      c.set('requestId', crypto.randomUUID())
      c.set('doState', this)
      c.set('env', this.env)
      c.header('X-DO-Version', '1.0.0')
      await next()
    })

    // Health endpoint
    app.get('/health', (c) => {
      return c.json({ path: '/health' })
    })

    // Ready endpoint
    app.get('/ready', (c) => {
      return c.json({ ready: this.started })
    })

    // Users with path params
    app.get('/users/:id', (c) => {
      return c.json({ params: { id: c.req.param('id') } })
    })

    // Users/:userId/posts/:postId
    app.get('/users/:userId/posts/:postId', (c) => {
      return c.json({
        params: {
          userId: c.req.param('userId'),
          postId: c.req.param('postId'),
        },
      })
    })

    // Wildcard files route
    app.get('/files/*', (c) => {
      const path = c.req.path
      const wildcard = path.replace('/files/', '')
      return c.json({ wildcard })
    })

    // Search with query params
    app.get('/search', (c) => {
      const q = c.req.query('q')
      const limit = c.req.query('limit')
      return c.json({ query: { q, limit } })
    })

    // API routes
    app.get('/api/items', (c) => c.json({ items: [] }))
    app.post('/api/items', async (c) => {
      const body = await c.req.json()
      return c.json({ created: body }, 201)
    })
    app.put('/api/items/:id', async (c) => {
      const body = await c.req.json()
      return c.json({ updated: body })
    })
    app.delete('/api/items/:id', (c) => c.json({ deleted: true }))
    app.patch('/api/items/:id', async (c) => {
      const body = await c.req.json()
      return c.json({ patched: body })
    })

    // API status
    app.get('/api/status', (c) => c.json({ status: 'ok' }))

    // Echo endpoint
    app.post('/api/echo', async (c) => {
      const body = await c.req.json()
      return c.json(body)
    })

    // Resource endpoints (for route chaining test)
    app.get('/api/resource', (c) => c.json({ method: 'GET' }))
    app.post('/api/resource', async (c) => c.json({ method: 'POST' }))

    // Admin group
    app.get('/admin/users', (c) => c.json({ users: [] }))

    // Protected route with auth middleware
    const authMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
      const auth = c.req.header('Authorization')
      if (!auth?.startsWith('Bearer ')) {
        return c.json({ error: 'Unauthorized' }, 401)
      }
      await next()
    }

    app.get('/protected/data', authMiddleware, (c) => {
      return c.json({ data: 'protected' })
    })

    // Context check
    app.get('/api/context-check', (c) => {
      return c.json({
        middlewareExecuted: c.get('middlewareExecuted'),
        requestId: c.get('requestId'),
      })
    })

    // Error trigger
    app.get('/api/error-trigger', (c) => {
      return c.json({ error: 'Internal Server Error' }, 500)
    })

    // State read from DO
    app.get('/api/state-read', async (c) => {
      const value = await this.get('ctx:value')
      return c.json({ value })
    })

    // Bindings check
    app.get('/api/bindings-check', (c) => {
      return c.json({ hasBindings: !!c.get('env') })
    })

    // Response helpers
    app.get('/api/json-response', (c) => c.json({ format: 'json' }))
    app.get('/api/text-response', (c) => c.text('plain text'))
    app.get('/api/html-response', (c) => c.html('<html><body>Hello</body></html>'))

    // WebSocket upgrade endpoint
    app.get('/ws', (c) => {
      const upgradeHeader = c.req.header('Upgrade')
      if (upgradeHeader !== 'websocket') {
        return c.json({ error: 'Upgrade Required' }, 426)
      }

      const room = c.req.query('room')
      const [client, server] = Object.values(new WebSocketPair())

      this.ctx.acceptWebSocket(server)

      const tags: string[] = []
      if (room) {
        tags.push(`room:${room}`)
      }
      this.websocketTags.set(server, tags)
      this.lastWebSocketTags = tags
      this.lastWebSocketHibernatable = false

      return new Response(null, {
        status: 101,
        webSocket: client,
      })
    })

    // Hibernatable WebSocket endpoint
    app.get('/ws/hibernatable', (c) => {
      const upgradeHeader = c.req.header('Upgrade')
      if (upgradeHeader !== 'websocket') {
        return c.json({ error: 'Upgrade Required' }, 426)
      }

      const [client, server] = Object.values(new WebSocketPair())

      // Use acceptWebSocket with hibernation tag
      this.ctx.acceptWebSocket(server, ['hibernatable'])
      this.hibernatableWebSockets.add(server)
      this.websocketTags.set(server, ['hibernatable'])
      this.lastWebSocketTags = ['hibernatable']
      this.lastWebSocketHibernatable = true

      return new Response(null, {
        status: 101,
        webSocket: client,
      })
    })

    // 404 handler
    app.notFound((c) => {
      return c.json({ error: 'Not Found' }, 404)
    })

    // Error handler
    app.onError((err, c) => {
      return c.json({ error: err.message }, 500)
    })

    return app
  }

  // =========================================================================
  // FETCH HANDLER
  // =========================================================================

  async fetch(request: Request): Promise<Response> {

    // Check for method not allowed on specific routes
    const url = new URL(request.url)
    if (url.pathname === '/health' && request.method !== 'GET' && request.method !== 'OPTIONS') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return this.app.fetch(request)
  }

  // =========================================================================
  // STATE MANAGEMENT (RPC methods)
  // =========================================================================

  async get(key: string): Promise<unknown> {
    const results = this.ctx.storage.sql
      .exec('SELECT value FROM state WHERE key = ?', key)
      .toArray()

    if (results.length === 0) return undefined

    const valueStr = results[0].value as string
    return JSON.parse(valueStr)
  }

  async set(key: string, value: unknown): Promise<boolean> {
    const valueStr = JSON.stringify(value)
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)',
      key,
      valueStr
    )
    return true
  }

  async delete(key: string): Promise<boolean> {
    this.ctx.storage.sql.exec('DELETE FROM state WHERE key = ?', key)
    return true
  }

  async setMany(entries: Record<string, unknown>): Promise<boolean> {
    for (const [key, value] of Object.entries(entries)) {
      await this.set(key, value)
    }
    return true
  }

  async deleteMany(keys: string[]): Promise<boolean> {
    for (const key of keys) {
      await this.delete(key)
    }
    return true
  }

  async list(options: ListOptions = {}): Promise<Record<string, unknown>> {
    const { prefix, start, end, limit, reverse } = options
    let query = 'SELECT key, value FROM state'
    const params: (string | number)[] = []
    const conditions: string[] = []

    if (prefix) {
      conditions.push('key LIKE ?')
      params.push(`${prefix}%`)
    }

    if (start) {
      conditions.push('key >= ?')
      params.push(start)
    }

    if (end) {
      conditions.push('key < ?')
      params.push(end)
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ')
    }

    query += ` ORDER BY key ${reverse ? 'DESC' : 'ASC'}`

    if (limit) {
      query += ' LIMIT ?'
      params.push(limit)
    }

    const results = this.ctx.storage.sql.exec(query, ...params).toArray()

    const entries: Record<string, unknown> = {}
    for (const row of results) {
      entries[row.key as string] = JSON.parse(row.value as string)
    }

    return entries
  }

  // =========================================================================
  // ALARM SCHEDULING (RPC methods)
  // =========================================================================

  async setAlarm(time: Date | number): Promise<void> {
    const timestamp = time instanceof Date ? time.getTime() : time
    await this.ctx.storage.setAlarm(timestamp)
  }

  async getAlarm(): Promise<Date | null> {
    const alarm = await this.ctx.storage.getAlarm()
    return alarm ? new Date(alarm) : null
  }

  async deleteAlarm(): Promise<void> {
    await this.ctx.storage.deleteAlarm()
  }

  // Alarm handler
  async alarm(): Promise<void> {
    await this.set('_alarm_triggered', true)
  }

  // =========================================================================
  // LIFECYCLE HOOKS (RPC methods)
  // =========================================================================

  async prepareHibernate(): Promise<void> {
    // Call onHibernate hook
    await this.set('_lifecycle:onHibernate', true)

    // Clean up temp state
    const entries = await this.list({ prefix: 'temp:' })
    await this.deleteMany(Object.keys(entries))
  }

  async wake(): Promise<void> {
    // Call onWake hook
    await this.set('_lifecycle:onWake', true)

    // Restore connections
    await this.set('_connections:restored', true)

    // Track wake count
    this.wakeCount++
    await this.set('_lifecycle:wakeCount', this.wakeCount)
  }

  // =========================================================================
  // RPC METHODS
  // =========================================================================

  ping(): string {
    return 'pong'
  }

  add(a: number, b: number): number {
    return a + b
  }

  async asyncOperation(input: string): Promise<{ status: string; input: string }> {
    return { status: 'complete', input }
  }

  throwError(): never {
    throw new Error('Intentional error')
  }

  // =========================================================================
  // TRANSACTION SUPPORT
  // =========================================================================

  async transaction(ops: TransactionOp[]): Promise<{ success: boolean; error?: string }> {
    // Store original values for rollback
    const originalValues = new Map<string, unknown>()

    try {
      for (const op of ops) {
        if (op.op === 'error') {
          throw new Error('Transaction error')
        }

        if (op.op === 'set' && op.key) {
          // Store original for rollback
          const original = await this.get(op.key)
          originalValues.set(op.key, original)
          await this.set(op.key, op.value)
        }

        if (op.op === 'delete' && op.key) {
          const original = await this.get(op.key)
          originalValues.set(op.key, original)
          await this.delete(op.key)
        }
      }

      return { success: true }
    } catch (err) {
      // Rollback
      for (const [key, value] of originalValues) {
        if (value === undefined) {
          await this.delete(key)
        } else {
          await this.set(key, value)
        }
      }

      return { success: false, error: (err as Error).message }
    }
  }

  // =========================================================================
  // RAW SQL QUERY
  // =========================================================================

  async query(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    const results = this.ctx.storage.sql.exec(sql, ...params).toArray()
    return results.map((row) => {
      const obj: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(row)) {
        if (key === 'value' && typeof value === 'string') {
          try {
            obj[key] = JSON.parse(value)
          } catch {
            obj[key] = value
          }
        } else {
          obj[key] = value
        }
      }
      return obj
    })
  }

  // =========================================================================
  // WEBSOCKET SUPPORT
  // =========================================================================

  // Note: WebSocket objects cannot be passed via RPC, so we use the last connected WebSocket's tags
  // In a real application, you would use connection IDs or other correlation mechanisms
  async getWebSocketTags(_ws?: WebSocket): Promise<string[]> {
    return this.lastWebSocketTags
  }

  async broadcast(tag: string, message: unknown): Promise<{ sent: number }> {
    let sent = 0
    const sockets = this.ctx.getWebSockets(tag)

    for (const ws of sockets) {
      try {
        ws.send(JSON.stringify(message))
        sent++
      } catch {
        // Socket may be closed
      }
    }

    return { sent }
  }

  // Note: WebSocket objects cannot be passed via RPC, so we use the last connected WebSocket's status
  async isWebSocketHibernatable(_ws?: WebSocket): Promise<boolean> {
    return this.lastWebSocketHibernatable
  }

  // WebSocket event handlers (for hibernation API)
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    // Handle incoming messages
  }

  webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): void {
    this.websocketTags.delete(ws)
    this.hibernatableWebSockets.delete(ws)
  }

  webSocketError(ws: WebSocket, error: unknown): void {
    this.websocketTags.delete(ws)
    this.hibernatableWebSockets.delete(ws)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')
    const ns = hostParts.length > 2 ? hostParts[0] : 'default'

    const id = env.DOCore.idFromName(ns)
    const stub = env.DOCore.get(id)

    return stub.fetch(request)
  },
}
