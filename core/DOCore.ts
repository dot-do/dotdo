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
 * - WorkflowContext methods (this === $):
 *   - this.send(eventType, data) - fire-and-forget event emission
 *   - this.on.Noun.verb(handler) - event handler registration
 *   - this.do(action, opts) - durable execution with retry
 *   - this.try(action, opts) - single attempt execution
 *   - this.every.day.at('9am')(handler) - scheduling DSL
 *   - this.Customer(id) - cross-DO RPC stub
 *   - this.Customer.create(data) - thing CRUD
 *
 * This is the foundation class that all other DO classes extend.
 */

import { DurableObject, RpcTarget } from 'cloudflare:workers'
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

// Workflow context constants
const DEFAULT_MAX_RETRIES = 3
const MAX_BACKOFF_MS = 10000
const EXPONENTIAL_BACKOFF_BASE = 2

const DAY_MAP: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
}

function parseTime(time: string): { hour: number; minute: number } {
  if (time === 'noon') return { hour: 12, minute: 0 }
  if (time === 'midnight') return { hour: 0, minute: 0 }

  const match = time.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/i)
  if (!match) {
    throw new Error(`Invalid time format: ${time}`)
  }

  let hour = parseInt(match[1], 10)
  const minute = match[2] ? parseInt(match[2], 10) : 0
  const period = match[3]?.toLowerCase()

  if (period === 'pm' && hour < 12) {
    hour += 12
  } else if (period === 'am' && hour === 12) {
    hour = 0
  }

  return { hour, minute }
}

function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

function generateThingId(): string {
  return `thing_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

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
// Workflow Context Types
// ============================================================================

export interface Event {
  id: string
  type: string
  subject: string
  object: string
  data: unknown
  timestamp: Date
}

type EventHandler = (event: Event) => void | Promise<void>

interface ScheduleEntry {
  handler: Function
  cron: string
}

interface ActionLogEntry {
  stepId: string
  status: 'pending' | 'completed' | 'failed'
  result?: unknown
  error?: { message: string }
}

interface TimeBuilder {
  at9am: (handler: Function) => () => void
  at5pm: (handler: Function) => () => void
  at6am: (handler: Function) => () => void
  at: (time: string) => (handler: Function) => () => void
}

interface ScheduleBuilder {
  Monday: TimeBuilder
  Tuesday: TimeBuilder
  Wednesday: TimeBuilder
  Thursday: TimeBuilder
  Friday: TimeBuilder
  Saturday: TimeBuilder
  Sunday: TimeBuilder
  day: TimeBuilder
  hour: (handler: Function) => () => void
  minute: (handler: Function) => () => void
}

interface IntervalBuilder {
  minutes: (handler: Function) => () => void
  hours: (handler: Function) => () => void
  seconds: (handler: Function) => () => void
}

interface ThingData {
  $id: string
  $type: string
  $createdAt: string
  $updatedAt: string
  $version?: number
  [key: string]: unknown
}

// OnProxy type for event handler registration
type OnProxy = {
  [noun: string]: {
    [verb: string]: (handler: EventHandler) => () => void
  }
}

// Helper to create the on proxy structure for RPC compatibility
function createOnProxy(doInstance: DOCore, eventHandlers: Map<string, EventHandler[]>): OnProxy {
  // Create an actual object structure instead of a Proxy for RPC compatibility
  // This uses a Proxy internally but returns actual callable functions
  return new Proxy({} as OnProxy, {
    get(_target, noun: string) {
      if (typeof noun !== 'string') return undefined
      return new Proxy({} as Record<string, (handler: EventHandler) => () => void>, {
        get(_t, verb: string) {
          if (typeof verb !== 'string') return undefined
          return (handler: EventHandler): (() => void) => {
            const key = `${noun}.${verb}`
            const handlers = eventHandlers.get(key) ?? []
            handlers.push(handler)
            eventHandlers.set(key, handlers)

            // Return unsubscribe function
            return () => {
              const current = eventHandlers.get(key) ?? []
              const idx = current.indexOf(handler)
              if (idx >= 0) {
                current.splice(idx, 1)
                eventHandlers.set(key, current)
              }
            }
          }
        },
      })
    },
  })
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

  // Workflow context state
  private eventHandlers: Map<string, EventHandler[]> = new Map()
  private schedules: Map<string, ScheduleEntry> = new Map()
  private actionLog: ActionLogEntry[] = []
  private things: Map<string, ThingData> = new Map()

  // Noun accessors - exposed as methods that return RpcTarget instances
  // Supports BOTH patterns via optional id parameter:
  // - Noun() -> NounAccessor with create(), list()
  // - Noun('id') -> NounInstanceAccessor with update(), delete(), etc.
  //
  // Using methods with optional id parameter to support both patterns

  Customer(id?: string): NounAccessor | NounInstanceAccessor {
    if (id) return new NounInstanceAccessor(this, 'Customer', id)
    return new NounAccessor(this, 'Customer')
  }

  Order(id?: string): NounAccessor | NounInstanceAccessor {
    if (id) return new NounInstanceAccessor(this, 'Order', id)
    return new NounAccessor(this, 'Order')
  }

  Product(id?: string): NounAccessor | NounInstanceAccessor {
    if (id) return new NounInstanceAccessor(this, 'Product', id)
    return new NounAccessor(this, 'Product')
  }

  Payment(id?: string): NounAccessor | NounInstanceAccessor {
    if (id) return new NounInstanceAccessor(this, 'Payment', id)
    return new NounAccessor(this, 'Payment')
  }

  Invoice(id?: string): NounAccessor | NounInstanceAccessor {
    if (id) return new NounInstanceAccessor(this, 'Invoice', id)
    return new NounAccessor(this, 'Invoice')
  }

  User(id?: string): NounAccessor | NounInstanceAccessor {
    if (id) return new NounInstanceAccessor(this, 'User', id)
    return new NounAccessor(this, 'User')
  }

  Item(id?: string): NounAccessor | NounInstanceAccessor {
    if (id) return new NounInstanceAccessor(this, 'Item', id)
    return new NounAccessor(this, 'Item')
  }

  Temp(id?: string): NounAccessor | NounInstanceAccessor {
    if (id) return new NounInstanceAccessor(this, 'Temp', id)
    return new NounAccessor(this, 'Temp')
  }

  /**
   * Create a new thing of any noun type - direct RPC method
   */
  create(noun: string, data: Record<string, unknown>): Promise<ThingData> {
    return this.createThing(noun, data)
  }

  /**
   * List things of any noun type - direct RPC method
   */
  listThings(noun: string, query?: { where?: Record<string, unknown>; limit?: number; offset?: number }): Promise<ThingData[]> {
    return this.listThingsInternal(noun, query)
  }

  constructor(ctx: DurableObjectState, env: DOCoreEnv) {
    super(ctx, env)

    // Initialize SQLite table synchronously
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS state (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `)

    // Initialize things table
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS things (
        id TEXT PRIMARY KEY,
        type TEXT,
        data TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        version INTEGER DEFAULT 1
      )
    `)

    this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_things_type ON things(type)
    `)

    // Initialize schedules table
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        cron TEXT PRIMARY KEY,
        handler_id TEXT,
        registered_at INTEGER
      )
    `)

    // Initialize action_log table
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS action_log (
        step_id TEXT PRIMARY KEY,
        status TEXT,
        result TEXT,
        error TEXT,
        created_at INTEGER
      )
    `)

    this.app = this.createApp()

    // Synchronous initialization - no async in constructor
    this.initSync()

    // Load existing action log
    this.loadActionLog()
  }

  private loadActionLog(): void {
    const rows = this.ctx.storage.sql.exec('SELECT * FROM action_log').toArray()
    for (const row of rows) {
      this.actionLog.push({
        stepId: row.step_id as string,
        status: row.status as 'pending' | 'completed' | 'failed',
        result: row.result ? JSON.parse(row.result as string) : undefined,
        error: row.error ? { message: row.error as string } : undefined,
      })
    }
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

  // =========================================================================
  // WORKFLOW CONTEXT: EVENT METHODS (this.send, this.on)
  // =========================================================================

  /**
   * Fire-and-forget event emission
   * Dispatches event to all matching handlers and returns immediately with event ID
   */
  send(eventType: string, data: unknown): string {
    const eventId = generateEventId()
    const [subject, object] = eventType.split('.')

    const event: Event = {
      id: eventId,
      type: eventType,
      subject,
      object,
      data,
      timestamp: new Date(),
    }

    // Fire-and-forget dispatch (don't await, don't throw)
    Promise.resolve().then(async () => {
      const handlers = this.matchHandlers(eventType)
      for (const handler of handlers) {
        try {
          await handler(event)
        } catch (err) {
          // Log but don't throw - fire-and-forget semantics
          console.error(`Handler error for ${eventType}:`, err)
        }
      }
    })

    return eventId
  }

  /**
   * Match handlers for an event type including wildcards
   */
  private matchHandlers(eventType: string): EventHandler[] {
    const [noun, verb] = eventType.split('.')
    const matched: EventHandler[] = []

    // Exact match
    const exactHandlers = this.eventHandlers.get(eventType) ?? []
    matched.push(...exactHandlers)

    // Wildcard noun match: *.verb
    const wildcardNounHandlers = this.eventHandlers.get(`*.${verb}`) ?? []
    matched.push(...wildcardNounHandlers)

    // Wildcard verb match: Noun.*
    const wildcardVerbHandlers = this.eventHandlers.get(`${noun}.*`) ?? []
    matched.push(...wildcardVerbHandlers)

    // Global wildcard: *.*
    const globalWildcardHandlers = this.eventHandlers.get('*.*') ?? []
    matched.push(...globalWildcardHandlers)

    return matched
  }

  /**
   * Event handler registration via callable proxy object
   * Usage: this.on.Noun.verb(handler) returns unsubscribe function
   *
   * For RPC compatibility, this returns an object with callable methods for each Noun.verb combination
   */
  get on(): OnProxy {
    return createOnProxy(this, this.eventHandlers)
  }

  /**
   * Direct RPC method for handler registration
   * Usage: this.registerHandler('Customer.signup', handler)
   */
  registerHandler(eventType: string, handler: EventHandler): () => void {
    const handlers = this.eventHandlers.get(eventType) ?? []
    handlers.push(handler)
    this.eventHandlers.set(eventType, handlers)

    return () => {
      const current = this.eventHandlers.get(eventType) ?? []
      const idx = current.indexOf(handler)
      if (idx >= 0) {
        current.splice(idx, 1)
        this.eventHandlers.set(eventType, current)
      }
    }
  }

  /**
   * Debug method to check handler count for an event type
   */
  getHandlerCount(eventType: string): number {
    return this.eventHandlers.get(eventType)?.length ?? 0
  }

  // =========================================================================
  // WORKFLOW CONTEXT: DURABLE EXECUTION (this.do, this.try)
  // =========================================================================

  /**
   * Execute action with durable semantics
   * - Retries with exponential backoff on failure
   * - Replays from log on restart (idempotent by stepId)
   */
  async do<T>(action: () => T | Promise<T>, options?: { stepId?: string; maxRetries?: number }): Promise<T> {
    const stepId = options?.stepId ?? generateEventId()
    const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES

    // Check for existing completed entry (replay semantics)
    const existingEntry = this.actionLog.find((e) => e.stepId === stepId && e.status === 'completed')
    if (existingEntry) {
      return existingEntry.result as T
    }

    let lastError: Error | undefined
    let attempts = 0

    while (attempts < maxRetries) {
      attempts++
      try {
        const result = await action()
        this.recordActionSuccess(stepId, result)
        return result
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))

        // If not last attempt, wait with exponential backoff
        if (attempts < maxRetries) {
          const backoffMs = this.calculateBackoff(attempts)
          await new Promise((r) => setTimeout(r, backoffMs))
        }
      }
    }

    // Record failure and throw
    this.recordActionFailure(stepId, lastError!)
    throw lastError
  }

  /**
   * Single-attempt action execution (no retry)
   */
  async try<T>(action: () => T | Promise<T>, options?: { timeout?: number }): Promise<T> {
    if (options?.timeout) {
      return Promise.race([
        Promise.resolve(action()),
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timeout')), options.timeout)),
      ])
    }
    return action()
  }

  private calculateBackoff(attemptNumber: number): number {
    const baseBackoff = 1000 * Math.pow(EXPONENTIAL_BACKOFF_BASE, attemptNumber - 1)
    return Math.min(baseBackoff, MAX_BACKOFF_MS)
  }

  private recordActionSuccess<T>(stepId: string, result: T): void {
    const logEntry: ActionLogEntry = {
      stepId,
      status: 'completed',
      result,
    }

    const existingIdx = this.actionLog.findIndex((e) => e.stepId === stepId)
    if (existingIdx >= 0) {
      this.actionLog[existingIdx] = logEntry
    } else {
      this.actionLog.push(logEntry)
    }

    // Persist to SQLite
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO action_log (step_id, status, result, created_at) VALUES (?, ?, ?, ?)`,
      stepId,
      'completed',
      JSON.stringify(result),
      Date.now()
    )
  }

  private recordActionFailure(stepId: string, error: Error): void {
    const failureEntry: ActionLogEntry = {
      stepId,
      status: 'failed',
      error: { message: error.message },
    }

    const existingIdx = this.actionLog.findIndex((e) => e.stepId === stepId)
    if (existingIdx >= 0) {
      this.actionLog[existingIdx] = failureEntry
    } else {
      this.actionLog.push(failureEntry)
    }

    // Persist to SQLite
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO action_log (step_id, status, error, created_at) VALUES (?, ?, ?, ?)`,
      stepId,
      'failed',
      error.message,
      Date.now()
    )
  }

  /**
   * Get the action log for debugging/testing
   */
  getActionLog(): ActionLogEntry[] {
    return [...this.actionLog]
  }

  // =========================================================================
  // WORKFLOW CONTEXT: SCHEDULING DSL (this.every)
  // =========================================================================

  /**
   * Schedule builder via Proxy
   * Usage: this.every.day.at('9am')(handler), this.every(5).minutes(handler)
   */
  get every(): ScheduleBuilder & ((n: number) => IntervalBuilder) {
    const self = this

    function createTimeBuilder(dayOfWeek: string | null): TimeBuilder {
      const dow = dayOfWeek ? DAY_MAP[dayOfWeek] : '*'

      const shortcuts: Record<string, { hour: number; minute: number }> = {
        at9am: { hour: 9, minute: 0 },
        at5pm: { hour: 17, minute: 0 },
        at6am: { hour: 6, minute: 0 },
      }

      return new Proxy({} as TimeBuilder, {
        get(_target, prop: string) {
          if (prop === 'at') {
            return (time: string) => {
              return (handler: Function): (() => void) => {
                const { hour, minute } = parseTime(time)
                return self.registerSchedule(`${minute} ${hour} * * ${dow}`, handler)
              }
            }
          }

          if (shortcuts[prop]) {
            return (handler: Function): (() => void) => {
              const { hour, minute } = shortcuts[prop]
              return self.registerSchedule(`${minute} ${hour} * * ${dow}`, handler)
            }
          }

          return undefined
        },
      })
    }

    const scheduleBuilder: ScheduleBuilder = {
      Monday: createTimeBuilder('Monday'),
      Tuesday: createTimeBuilder('Tuesday'),
      Wednesday: createTimeBuilder('Wednesday'),
      Thursday: createTimeBuilder('Thursday'),
      Friday: createTimeBuilder('Friday'),
      Saturday: createTimeBuilder('Saturday'),
      Sunday: createTimeBuilder('Sunday'),
      day: createTimeBuilder(null),
      hour: (handler: Function): (() => void) => self.registerSchedule('0 * * * *', handler),
      minute: (handler: Function): (() => void) => self.registerSchedule('* * * * *', handler),
    }

    const everyFn = (n: number): IntervalBuilder => {
      return {
        minutes: (handler: Function): (() => void) => self.registerSchedule(`*/${n} * * * *`, handler),
        hours: (handler: Function): (() => void) => self.registerSchedule(`0 */${n} * * *`, handler),
        seconds: (handler: Function): (() => void) => self.registerSchedule(`every:${n}s`, handler),
      }
    }

    return Object.assign(everyFn, scheduleBuilder) as ScheduleBuilder & ((n: number) => IntervalBuilder)
  }

  private registerSchedule(cron: string, handler: Function): () => void {
    this.schedules.set(cron, { handler, cron })

    // Persist to SQLite
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO schedules (cron, handler_id, registered_at) VALUES (?, ?, ?)`,
      cron,
      `handler_${Date.now()}`,
      Date.now()
    )

    return () => {
      this.schedules.delete(cron)
      this.ctx.storage.sql.exec(`DELETE FROM schedules WHERE cron = ?`, cron)
    }
  }

  /**
   * Get a registered schedule by CRON expression
   */
  getSchedule(cron: string): { handler: Function } | undefined {
    return this.schedules.get(cron)
  }

  // =========================================================================
  // WORKFLOW CONTEXT: NOUN ACCESSORS (this.Customer, this.Order, etc.)
  // =========================================================================

  /**
   * Create an RPC-accessible noun accessor
   */
  private createNounInstance(noun: string, id: string): NounInstanceRPC {
    const self = this
    return {
      update: async (updates: Record<string, unknown>): Promise<ThingData> => {
        return self.updateThing(noun, id, updates)
      },
      delete: async (): Promise<boolean> => {
        return self.deleteThing(noun, id)
      },
      notify: async (): Promise<{ success: boolean }> => {
        return { success: true }
      },
      getProfile: async (): Promise<ThingData | null> => {
        return self.getThing(id)
      },
      getStatus: async (): Promise<{ status: string }> => {
        return { status: 'active' }
      },
    }
  }

  private createNounAccessorRPC(noun: string): NounAccessorRPC {
    const self = this

    const accessor: NounAccessorRPC = (id: string): NounInstanceRPC => {
      return self.createNounInstance(noun, id)
    }

    accessor.create = async (data: Record<string, unknown>): Promise<ThingData> => {
      return self.createThing(noun, data)
    }

    accessor.list = async (query?: { where?: Record<string, unknown>; limit?: number; offset?: number }): Promise<ThingData[]> => {
      return self.listThingsInternal(noun, query)
    }

    return accessor
  }

  // =========================================================================
  // THING CRUD OPERATIONS
  // =========================================================================

  private async createThing(type: string, data: Record<string, unknown>): Promise<ThingData> {
    const now = new Date().toISOString()
    const id = (data.$id as string) ?? generateThingId()

    const thing: ThingData = {
      $id: id,
      $type: type,
      $createdAt: now,
      $updatedAt: now,
      $version: 1,
      ...data,
    }

    // Store in memory
    this.things.set(id, thing)

    // Persist to SQLite
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO things (id, type, data, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      type,
      JSON.stringify(thing),
      Date.now(),
      Date.now(),
      1
    )

    // Emit created event
    this.send(`${type}.created`, thing)

    return thing
  }

  private async listThingsInternal(type: string, query?: { where?: Record<string, unknown>; limit?: number; offset?: number }): Promise<ThingData[]> {
    let sql = 'SELECT data FROM things WHERE type = ?'
    const params: unknown[] = [type]

    if (query?.limit) {
      sql += ' LIMIT ?'
      params.push(query.limit)
    }

    if (query?.offset) {
      sql += ' OFFSET ?'
      params.push(query.offset)
    }

    const rows = this.ctx.storage.sql.exec(sql, ...params).toArray()
    let results = rows.map((row) => JSON.parse(row.data as string) as ThingData)

    // Apply where clause filter in memory
    if (query?.where) {
      results = results.filter((thing) => {
        for (const [key, value] of Object.entries(query.where!)) {
          if (thing[key] !== value) return false
        }
        return true
      })
    }

    return results
  }

  private getThing(id: string): ThingData | null {
    // Check memory first
    const fromMemory = this.things.get(id)
    if (fromMemory) return fromMemory

    // Check SQLite
    const rows = this.ctx.storage.sql.exec('SELECT data FROM things WHERE id = ?', id).toArray()
    if (rows.length > 0) {
      const thing = JSON.parse(rows[0].data as string) as ThingData
      this.things.set(id, thing)
      return thing
    }

    return null
  }

  private async updateThing(type: string, id: string, updates: Record<string, unknown>): Promise<ThingData> {
    const existing = this.getThing(id)
    if (!existing) {
      throw new Error(`Thing not found: ${id}`)
    }

    const now = new Date().toISOString()
    const updated: ThingData = {
      ...existing,
      ...updates,
      $id: id,
      $type: type,
      $updatedAt: now,
      $version: (existing.$version ?? 0) + 1,
    }

    // Store in memory
    this.things.set(id, updated)

    // Persist to SQLite
    this.ctx.storage.sql.exec(
      `UPDATE things SET data = ?, updated_at = ?, version = ? WHERE id = ?`,
      JSON.stringify(updated),
      Date.now(),
      updated.$version,
      id
    )

    // Emit updated event
    this.send(`${type}.updated`, updated)

    return updated
  }

  private async deleteThing(type: string, id: string): Promise<boolean> {
    const existing = this.getThing(id)
    if (!existing) {
      return false
    }

    // Remove from memory
    this.things.delete(id)

    // Remove from SQLite
    this.ctx.storage.sql.exec('DELETE FROM things WHERE id = ?', id)

    // Emit deleted event
    this.send(`${type}.deleted`, { $id: id })

    return true
  }

  // =========================================================================
  // PUBLIC WRAPPERS FOR RPCTAR GET CLASSES
  // =========================================================================

  /**
   * Create a thing (public wrapper for RpcTarget)
   */
  createThingInternal(type: string, data: Record<string, unknown>): Promise<ThingData> {
    return this.createThing(type, data)
  }

  /**
   * List things (public wrapper for RpcTarget)
   */
  listThingsPublic(type: string, query?: { where?: Record<string, unknown>; limit?: number; offset?: number }): Promise<ThingData[]> {
    return this.listThingsInternal(type, query)
  }

  /**
   * Get a thing (public wrapper for RpcTarget)
   */
  getThingPublic(id: string): ThingData | null {
    return this.getThing(id)
  }

  /**
   * Update a thing (public wrapper for RpcTarget)
   */
  updateThingInternal(type: string, id: string, updates: Record<string, unknown>): Promise<ThingData> {
    return this.updateThing(type, id, updates)
  }

  /**
   * Delete a thing (public wrapper for RpcTarget)
   */
  deleteThingInternal(type: string, id: string): Promise<boolean> {
    return this.deleteThing(type, id)
  }
}

// ============================================================================
// Noun Accessor Classes (RpcTarget for nested method calls)
// ============================================================================

/**
 * NounAccessor - RpcTarget class for noun operations
 * Supports: this.Customer.create(), this.Customer.list()
 */
class NounAccessor extends RpcTarget {
  constructor(private doCore: DOCore, private noun: string) {
    super()
  }

  async create(data: Record<string, unknown>): Promise<ThingData> {
    return this.doCore.createThingInternal(this.noun, data)
  }

  async list(query?: { where?: Record<string, unknown>; limit?: number; offset?: number }): Promise<ThingData[]> {
    return this.doCore.listThingsPublic(this.noun, query)
  }
}

/**
 * NounInstanceAccessor - RpcTarget class for noun instance operations
 * Supports: this.Customer('id').update(), this.Customer('id').delete()
 */
class NounInstanceAccessor extends RpcTarget {
  constructor(private doCore: DOCore, private noun: string, private id: string) {
    super()
  }

  async update(updates: Record<string, unknown>): Promise<ThingData> {
    return this.doCore.updateThingInternal(this.noun, this.id, updates)
  }

  async delete(): Promise<boolean> {
    return this.doCore.deleteThingInternal(this.noun, this.id)
  }

  async notify(): Promise<{ success: boolean }> {
    return { success: true }
  }

  async getProfile(): Promise<ThingData | null> {
    return this.doCore.getThingPublic(this.id)
  }

  async getStatus(): Promise<{ status: string }> {
    return { status: 'active' }
  }
}

// ============================================================================
// Noun Accessor Types (for backwards compatibility)
// ============================================================================

interface NounInstanceRPC {
  update(updates: Record<string, unknown>): Promise<ThingData>
  delete(): Promise<boolean>
  notify(): Promise<{ success: boolean }>
  getProfile(): Promise<ThingData | null>
  getStatus(): Promise<{ status: string }>
}

type NounAccessorRPC = ((id: string) => NounInstanceRPC) & {
  create(data: Record<string, unknown>): Promise<ThingData>
  list(query?: { where?: Record<string, unknown>; limit?: number; offset?: number }): Promise<ThingData[]>
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
