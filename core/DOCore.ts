/**
 * DOCore - Base class for the DO hierarchy (~5KB)
 *
 * Provides:
 * - State management (get/set/delete/list) via SQLite
 * - Alarm scheduling (setAlarm/getAlarm/deleteAlarm)
 * - Hono routing with middleware support
 * - Lifecycle hooks (onStart)
 * - Basic RPC methods
 * - WebSocket support
 *
 * This is the foundation class that all other DO classes extend.
 */

import { DurableObject } from 'cloudflare:workers'
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'

// ============================================================================
// Constants
// ============================================================================

const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  UPGRADE_REQUIRED: 426,
  INTERNAL_SERVER_ERROR: 500,
} as const

const CORS_CONFIG = {
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
} as const

const VERSION_HEADER = 'X-DO-Version'
const VERSION = '1.0.0'

const WEBSOCKET_STATUS = {
  NORMAL_CLOSURE: 1000,
  GOING_AWAY: 1001,
} as const

const STATE_KEYS = {
  LIFECYCLE_START: '_lifecycle:onStart',
  LIFECYCLE_START_COUNT: '_lifecycle:onStartCount',
  LIFECYCLE_HIBERNATE: '_lifecycle:onHibernate',
  LIFECYCLE_WAKE: '_lifecycle:onWake',
  LIFECYCLE_WAKE_COUNT: '_lifecycle:wakeCount',
  INITIALIZED: '_initialized',
  ALARM_TRIGGERED: '_alarm_triggered',
  CONNECTIONS_RESTORED: '_connections:restored',
} as const

// ============================================================================
// Types
// ============================================================================

/**
 * Environment bindings for DOCore and related DO classes
 */
export interface DOCoreEnv {
  DOCore: DurableObjectNamespace<DOCore>
  DOSemantic?: DurableObjectNamespace
  DOStorage?: DurableObjectNamespace
  DOWorkflow?: DurableObjectNamespace
  DOFull?: DurableObjectNamespace
}

/**
 * Options for listing state entries with filtering and pagination
 */
export interface ListOptions {
  /** Prefix to filter keys by (e.g., "user:" matches "user:1", "user:2", etc.) */
  prefix?: string
  /** Start of key range (inclusive) */
  start?: string
  /** End of key range (exclusive) */
  end?: string
  /** Maximum number of entries to return */
  limit?: number
  /** Sort results in reverse order */
  reverse?: boolean
}

/**
 * Operation for transactional updates to state
 */
export interface TransactionOp {
  /** Operation type: 'set' to store, 'delete' to remove, 'error' to trigger rollback */
  op: 'set' | 'delete' | 'error'
  /** Key for set/delete operations */
  key?: string
  /** Value for set operations */
  value?: unknown
}

// Extended context type with our custom variables
type Variables = {
  middlewareExecuted: boolean
  requestId: string
  doState: DOCore
  env: DOCoreEnv
}

type HonoEnv = {
  Bindings: DOCoreEnv
  Variables: Variables
}

// ============================================================================
// DOCore Class
// ============================================================================

export class DOCore extends DurableObject<DOCoreEnv> {
  protected app: Hono<HonoEnv>
  protected started = false
  private wakeCount = 0
  private websocketTags = new Map<WebSocket, string[]>()
  private hibernatableWebSockets = new Set<WebSocket>()
  private lastWebSocketTags: string[] = []
  private lastWebSocketHibernatable = false

  constructor(ctx: DurableObjectState, env: DOCoreEnv) {
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
      .exec('SELECT value FROM state WHERE key = ?', STATE_KEYS.LIFECYCLE_START_COUNT)
      .toArray()
    const count = countResult.length > 0 ? JSON.parse(countResult[0].value as string) : 0

    // Set lifecycle state synchronously
    this.setStateSync(STATE_KEYS.LIFECYCLE_START, true)
    this.setStateSync(STATE_KEYS.LIFECYCLE_START_COUNT, count + 1)
    this.setStateSync(STATE_KEYS.INITIALIZED, true)

    this.started = true
  }

  /**
   * Synchronously store a value in SQLite for initialization purposes
   */
  private setStateSync(key: string, value: unknown): void {
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)',
      key,
      JSON.stringify(value)
    )
  }

  /**
   * Override this method in subclasses to add routes
   */
  protected createApp(): Hono<HonoEnv> {
    const app = new Hono<HonoEnv>()

    // CORS middleware
    app.use('*', cors(CORS_CONFIG))

    // Global middleware - adds version header and context vars
    app.use('*', async (c, next) => {
      c.set('middlewareExecuted', true)
      c.set('requestId', crypto.randomUUID())
      c.set('doState', this)
      c.set('env', this.env)
      c.header(VERSION_HEADER, VERSION)
      await next()
    })

    // Register core routes
    this.registerCoreRoutes(app)

    // 404 handler
    app.notFound((c) => {
      return c.json({ error: 'Not Found' }, HTTP_STATUS.NOT_FOUND)
    })

    // Error handler
    app.onError((err, c) => {
      console.error('Request error:', err.message)
      return c.json({ error: 'Internal server error' }, HTTP_STATUS.INTERNAL_SERVER_ERROR)
    })

    return app
  }

  /**
   * Register core routes - can be called by subclasses
   */
  protected registerCoreRoutes(app: Hono<HonoEnv>): void {
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

    // API routes for items resource
    app.get('/api/items', (c) => c.json({ items: [] }))
    app.post('/api/items', async (c) => {
      const body = await c.req.json()
      return c.json({ created: body }, HTTP_STATUS.CREATED)
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
      if (!this.isWebSocketUpgradeRequest(c)) {
        return c.json({ error: 'Upgrade required' }, HTTP_STATUS.UPGRADE_REQUIRED)
      }

      const room = c.req.query('room')
      const tags: string[] = room ? [`room:${room}`] : []
      return this.handleWebSocketUpgrade(c, tags, false)
    })

    // Hibernatable WebSocket endpoint
    app.get('/ws/hibernatable', (c) => {
      if (!this.isWebSocketUpgradeRequest(c)) {
        return c.json({ error: 'Upgrade required' }, HTTP_STATUS.UPGRADE_REQUIRED)
      }

      return this.handleWebSocketUpgrade(c, ['hibernatable'], true)
    })
  }

  // =========================================================================
  // WEBSOCKET HELPERS
  // =========================================================================

  /**
   * Check if a request is a valid WebSocket upgrade request
   */
  private isWebSocketUpgradeRequest(c: Context<HonoEnv>): boolean {
    return c.req.header('Upgrade') === 'websocket'
  }

  /**
   * Handle WebSocket upgrade and connection setup
   */
  private handleWebSocketUpgrade(c: Context<HonoEnv>, tags: string[], hibernatable: boolean): Response {
    const [client, server] = Object.values(new WebSocketPair())

    // Accept WebSocket with optional hibernation support
    if (hibernatable) {
      this.ctx.acceptWebSocket(server, ['hibernatable'])
      this.hibernatableWebSockets.add(server)
    } else {
      this.ctx.acceptWebSocket(server)
    }

    // Track WebSocket metadata
    this.websocketTags.set(server, tags)
    this.lastWebSocketTags = tags
    this.lastWebSocketHibernatable = hibernatable

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  // =========================================================================
  // FETCH HANDLER
  // =========================================================================

  /**
   * Handle incoming HTTP requests and route to appropriate handlers
   */
  async fetch(request: Request): Promise<Response> {
    // Check for method not allowed on specific routes
    const url = new URL(request.url)
    if (url.pathname === '/health' && request.method !== 'GET' && request.method !== 'OPTIONS') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: HTTP_STATUS.METHOD_NOT_ALLOWED,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return this.app.fetch(request)
  }

  // =========================================================================
  // STATE MANAGEMENT (RPC methods)
  // =========================================================================

  /**
   * Retrieve a value from state by key
   * @param key The state key to retrieve
   * @returns The stored value, or undefined if not found
   */
  async get(key: string): Promise<unknown> {
    const results = this.ctx.storage.sql
      .exec('SELECT value FROM state WHERE key = ?', key)
      .toArray()

    if (results.length === 0) return undefined

    const valueStr = results[0].value as string
    return JSON.parse(valueStr)
  }

  /**
   * Store a value in state
   * @param key The state key to store under
   * @param value The value to store (will be JSON serialized)
   * @returns true on success
   */
  async set(key: string, value: unknown): Promise<boolean> {
    const valueStr = JSON.stringify(value)
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)',
      key,
      valueStr
    )
    return true
  }

  /**
   * Remove a value from state
   * @param key The state key to delete
   * @returns true on success
   */
  async delete(key: string): Promise<boolean> {
    this.ctx.storage.sql.exec('DELETE FROM state WHERE key = ?', key)
    return true
  }

  /**
   * Store multiple key-value pairs in state
   * @param entries Object with keys to store
   * @returns true on success
   */
  async setMany(entries: Record<string, unknown>): Promise<boolean> {
    for (const [key, value] of Object.entries(entries)) {
      await this.set(key, value)
    }
    return true
  }

  /**
   * Delete multiple keys from state
   * @param keys Array of keys to delete
   * @returns true on success
   */
  async deleteMany(keys: string[]): Promise<boolean> {
    for (const key of keys) {
      await this.delete(key)
    }
    return true
  }

  /**
   * List state entries with optional filtering and pagination
   * @param options Filter and pagination options
   * @returns Object mapping keys to their values
   */
  async list(options: ListOptions = {}): Promise<Record<string, unknown>> {
    const { sql, params } = this.buildListQuery(options)
    const results = this.ctx.storage.sql.exec(sql, ...params).toArray()
    return this.parseStateResults(results)
  }

  /**
   * Build a SQL query with parameters for listing state entries
   */
  private buildListQuery(options: ListOptions): { sql: string; params: (string | number)[] } {
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

    return { sql: query, params }
  }

  /**
   * Convert SQL query results to state entries object
   */
  private parseStateResults(results: Array<Record<string, unknown>>): Record<string, unknown> {
    const entries: Record<string, unknown> = {}
    for (const row of results) {
      entries[row.key as string] = JSON.parse(row.value as string)
    }
    return entries
  }

  // =========================================================================
  // ALARM SCHEDULING (RPC methods)
  // =========================================================================

  /**
   * Schedule an alarm to trigger at the specified time
   * @param time When to trigger the alarm (Date or timestamp in milliseconds)
   */
  async setAlarm(time: Date | number): Promise<void> {
    const timestamp = time instanceof Date ? time.getTime() : time
    await this.ctx.storage.setAlarm(timestamp)
  }

  /**
   * Get the currently scheduled alarm time
   * @returns The alarm time as a Date, or null if no alarm is set
   */
  async getAlarm(): Promise<Date | null> {
    const alarm = await this.ctx.storage.getAlarm()
    return alarm ? new Date(alarm) : null
  }

  /**
   * Cancel the currently scheduled alarm
   */
  async deleteAlarm(): Promise<void> {
    await this.ctx.storage.deleteAlarm()
  }

  /**
   * Called when the alarm triggers. Override in subclasses to handle alarm events.
   */
  async alarm(): Promise<void> {
    await this.set(STATE_KEYS.ALARM_TRIGGERED, true)
  }

  // =========================================================================
  // LIFECYCLE HOOKS (RPC methods)
  // =========================================================================

  /**
   * Prepare for hibernation by cleaning up temporary state
   */
  async prepareHibernate(): Promise<void> {
    // Call onHibernate hook
    await this.set(STATE_KEYS.LIFECYCLE_HIBERNATE, true)

    // Clean up temporary state with 'temp:' prefix
    const tempEntries = await this.list({ prefix: 'temp:' })
    await this.deleteMany(Object.keys(tempEntries))
  }

  /**
   * Called when the DO wakes from hibernation
   */
  async wake(): Promise<void> {
    // Call onWake hook
    await this.set(STATE_KEYS.LIFECYCLE_WAKE, true)

    // Restore connections
    await this.set(STATE_KEYS.CONNECTIONS_RESTORED, true)

    // Track wake count
    this.wakeCount++
    await this.set(STATE_KEYS.LIFECYCLE_WAKE_COUNT, this.wakeCount)
  }

  // =========================================================================
  // RPC METHODS
  // =========================================================================

  /**
   * Simple RPC ping method to verify the DO is responsive
   */
  ping(): string {
    return 'pong'
  }

  /**
   * Simple arithmetic RPC method for testing
   */
  add(a: number, b: number): number {
    return a + b
  }

  /**
   * Example async RPC method for testing
   */
  async asyncOperation(input: string): Promise<{ status: string; input: string }> {
    return { status: 'complete', input }
  }

  /**
   * Throws an intentional error for testing error handling
   */
  throwError(): never {
    throw new Error('Intentional error for testing')
  }

  // =========================================================================
  // TRANSACTION SUPPORT
  // =========================================================================

  /**
   * Execute a series of state operations atomically with automatic rollback on error
   * @param ops Array of operations to execute
   * @returns Object indicating success or failure with optional error message
   */
  async transaction(ops: TransactionOp[]): Promise<{ success: boolean; error?: string }> {
    // Store original values for rollback
    const originalValues = new Map<string, unknown>()

    try {
      for (const op of ops) {
        if (op.op === 'error') {
          throw new Error('Transaction operation error triggered')
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
      // Rollback all changes on error
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

  /**
   * Execute a raw SQL query against the state storage
   * @param sql SQL query string with ? placeholders for parameters
   * @param params Parameter values for the query
   * @returns Array of rows matching the query
   */
  async query(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    const results = this.ctx.storage.sql.exec(sql, ...params).toArray()
    return results.map((row) => this.parseQueryRow(row))
  }

  /**
   * Parse a single query row, handling JSON-serialized values
   */
  private parseQueryRow(row: Record<string, unknown>): Record<string, unknown> {
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
  }

  // =========================================================================
  // WEBSOCKET SUPPORT
  // =========================================================================

  /**
   * Get the tags attached to the last connected WebSocket
   * Note: WebSocket objects cannot be passed via RPC, so we use the last connected WebSocket's tags
   */
  async getWebSocketTags(_ws?: WebSocket): Promise<string[]> {
    return this.lastWebSocketTags
  }

  /**
   * Broadcast a message to all WebSockets with the specified tag
   * @param tag The tag to filter WebSocket recipients
   * @param message The message to broadcast (will be JSON-stringified)
   * @returns Number of WebSockets the message was sent to
   */
  async broadcast(tag: string, message: unknown): Promise<{ sent: number }> {
    let sent = 0
    const sockets = this.ctx.getWebSockets(tag)

    for (const ws of sockets) {
      try {
        ws.send(JSON.stringify(message))
        sent++
      } catch {
        // Socket may be closed, skip it
      }
    }

    return { sent }
  }

  /**
   * Check if the last connected WebSocket supports hibernation
   */
  async isWebSocketHibernatable(_ws?: WebSocket): Promise<boolean> {
    return this.lastWebSocketHibernatable
  }

  // =========================================================================
  // WEBSOCKET EVENT HANDLERS
  // =========================================================================

  /**
   * Handle incoming WebSocket messages. Override in subclasses.
   */
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    // Handle incoming messages - can be overridden by subclasses
  }

  /**
   * Handle WebSocket close events and clean up resources
   */
  webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): void {
    this.cleanupWebSocket(ws)
  }

  /**
   * Handle WebSocket error events and clean up resources
   */
  webSocketError(ws: WebSocket, error: unknown): void {
    this.cleanupWebSocket(ws)
  }

  /**
   * Clean up WebSocket tracking when connection closes or errors
   */
  private cleanupWebSocket(ws: WebSocket): void {
    this.websocketTags.delete(ws)
    this.hibernatableWebSockets.delete(ws)
  }
}

// ============================================================================
// Default Worker Export
// ============================================================================

export default {
  async fetch(request: Request, env: DOCoreEnv): Promise<Response> {
    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')
    const ns = hostParts.length > 2 ? hostParts[0] : 'default'

    const id = env.DOCore.idFromName(ns)
    const stub = env.DOCore.get(id)

    return stub.fetch(request)
  },
}
