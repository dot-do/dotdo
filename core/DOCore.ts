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

import { DurableObject } from 'cloudflare:workers'
import { Hono, type Context } from 'hono'
import { WebSocketRpcHandler, type RpcMessage } from '../rpc/websocket-rpc'
import { PipelineExecutor, type ExecutorPipelineStep } from '../rpc/pipeline-executor'
import { deserializePipeline, type SerializedPipeline } from '../rpc/pipeline-serialization'
import {
  verifyCapabilityToken,
  CapabilityError,
  type CapabilityPayload,
} from '../rpc/capability-token'
import {
  requireAuth,
  requireAdmin,
  type HonoAuthEnv,
  type AuthContext,
} from '../lib/auth-middleware'
import {
  assertValidCreateThingInput,
  ThingValidationError,
} from '../lib/validation/thing-validation'
import {
  validateWhereClause,
  matchesWhere,
  buildSqlWhereClause,
  QueryValidationError,
} from './query-validation'
import {
  validateSqlQuery,
  sanitizeSqlError,
  SqlSecurityError,
} from './sql-security'
import type { ActionLogEntry } from './durable-execution'
import { validatePath } from '../lib/validation'
import { emitDeprecationWarning } from '../lib/deprecation'
import type { ThingData } from '../types'
import {
  MigrationRunner,
  type MigrationResult,
  type PendingMigration,
} from '../db/migrations'
import { LRUCache } from './lru-cache'

// ============================================================================
// Import extracted modules
// ============================================================================

import {
  HTTP_STATUS,
  VERSION_HEADER,
  VERSION,
  getCorsPolicy,
  buildCorsHeaders,
  getAllowedOrigins,
  type CorsEnv,
} from './http-router'
import { WebSocketManager, WEBSOCKET_STATUS } from './websocket-manager'
import { STATE_KEYS, StateManager, StateAccessor } from './state-manager'
import {
  generateEventId,
  generateThingId,
  createOnProxy as createOnProxyFromEventSystem,
  type Event,
  type EventHandler,
  type OnProxy,
} from './event-system'
import {
  DAY_MAP,
  parseTime,
  type ScheduleHandler,
  type ScheduleEntry,
  type TimeBuilder,
  type ScheduleBuilder,
  type IntervalBuilder,
} from './schedule-manager'
import {
  NounAccessor,
  NounInstanceAccessor,
  type ThingStorageInterface,
  type NounInstanceRPC,
  type NounAccessorRPC,
} from './noun-accessors'

// Re-export from extracted modules for external consumers
export { HTTP_STATUS, VERSION_HEADER, VERSION } from './http-router'
export { STATE_KEYS } from './state-manager'
export type { Event, EventHandler } from './event-system'
export type { ScheduleHandler } from './schedule-manager'

// ============================================================================
// Workflow context constants
// ============================================================================

const DEFAULT_MAX_RETRIES = 3
const MAX_BACKOFF_MS = 10000
const EXPONENTIAL_BACKOFF_BASE = 2
const DEFAULT_THINGS_CACHE_SIZE = 1000

// ============================================================================
// Types
// ============================================================================

/**
 * CrossDOStub - Type-safe interface for cross-DO RPC communication
 *
 * This interface defines the RPC contract for communicating between Durable Objects.
 * It replaces unsafe double casts like `as unknown as DOCore` with a well-defined
 * interface that documents the actual methods used in cross-DO calls.
 *
 * @example
 * ```typescript
 * // Instead of:
 * const targetStub = doBinding.get(targetId) as unknown as DOCore
 *
 * // Use:
 * const targetStub = doBinding.get(targetId) as CrossDOStub
 * await targetStub.rpcCall('someMethod', [arg1, arg2])
 * ```
 */
export interface CrossDOStub {
  /**
   * Execute an RPC call on the target DO
   * @param method - The method name to call
   * @param args - Arguments to pass to the method
   * @param capability - Optional capability token for authorization
   * @returns The result of the RPC call
   */
  rpcCall(method: string, args: unknown[], capability?: string): Promise<unknown>

  /**
   * Get a noun accessor for CRUD operations on the target DO
   *
   * The return type is `unknown` because cross-DO RPC wraps the result in
   * Cloudflare's Stub<T> type which has special Promise-like semantics.
   * The actual runtime behavior provides NounAccessor/NounInstanceAccessor
   * methods but wrapped in the RPC proxy.
   *
   * @param noun - The noun type (e.g., 'Customer', 'Order')
   * @param id - Optional ID for instance-level access
   * @returns RPC-wrapped accessor (behaves like NounAccessor | NounInstanceAccessor)
   */
  getNounAccessor(noun: string, id?: string): unknown
}

/**
 * Environment bindings for DOCore and related DO classes
 */
/**
 * Base environment for DO classes.
 * Each subclass env should extend this and make its own binding required.
 * Generic parameters allow proper typing when extended.
 *
 * Extends CorsEnv for CORS configuration via environment variables:
 * - ALLOWED_ORIGINS: Comma-separated list of allowed origins
 * - ENVIRONMENT: 'production' | 'staging' | 'development'
 *
 * @example
 * ```toml
 * # wrangler.toml
 * [vars]
 * ALLOWED_ORIGINS = "https://app.example.com,https://api.example.com"
 * ENVIRONMENT = "production"
 * ```
 */
export interface DOCoreEnv extends CorsEnv {
  DOCore: DurableObjectNamespace<DOCore>
  // These are optional at the base level - subclasses override with required
  // Using DOCore as base type since all DO classes extend DOCore
  DOSemantic?: DurableObjectNamespace<DOCore>
  DOStorage?: DurableObjectNamespace<DOCore>
  DOWorkflow?: DurableObjectNamespace<DOCore>
  DOFull?: DurableObjectNamespace<DOCore>
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
  auth: AuthContext
}

type HonoEnv = {
  Bindings: DOCoreEnv
  Variables: Variables
}

// Helper to create the on proxy structure for RPC compatibility
// Uses the imported createOnProxy signature but needs local DOCore reference
function createOnProxy(eventHandlers: Map<string, EventHandler[]>): OnProxy {
  return createOnProxyFromEventSystem(eventHandlers)
}

// ============================================================================
// DOCore Class
// ============================================================================

export class DOCore extends DurableObject<DOCoreEnv> {
  protected app: Hono<HonoEnv>
  protected started = false
  private wakeCount = 0

  // Extracted module instances
  private wsManager = new WebSocketManager()
  private stateManager: StateManager

  // WebSocket RPC handler for bidirectional callbacks
  protected rpcHandler = new WebSocketRpcHandler()

  // Workflow context state
  private eventHandlers: Map<string, EventHandler[]> = new Map()
  private schedules: Map<string, ScheduleEntry> = new Map()
  private actionLog: ActionLogEntry[] = []
  // LRU cache for things with configurable max size (default 1000 entries)
  // Evicted entries are still available from SQLite, this is just a hot cache
  private things = new LRUCache<ThingData>({ maxSize: DEFAULT_THINGS_CACHE_SIZE })

  // =========================================================================
  // NOUN ACCESSORS
  // =========================================================================
  // Supports BOTH patterns via optional id parameter:
  // - Noun() -> NounAccessor with create(), list()
  // - Noun('id') -> NounInstanceAccessor with update(), delete(), etc.
  //
  // All noun methods use the shared factory: getNounAccessor()

  /**
   * Get a ThingStorageInterface adapter for this DOCore instance.
   * This adapts DOCore's methods to the interface expected by NounAccessor classes.
   */
  private getStorageAdapter(): ThingStorageInterface {
    return {
      create: (type: string, data: Record<string, unknown>) => this.createThingInternal(type, data),
      list: (type: string, query?: { where?: Record<string, unknown>; limit?: number; offset?: number }) => this.listThingsPublic(type, query),
      getById: (id: string) => this.getThingById(id),
      updateById: (id: string, updates: Record<string, unknown>) => this.updateThingById(id, updates),
      deleteById: (id: string) => this.deleteThingById(id),
    }
  }

  /**
   * Generic factory for noun accessors - creates NounAccessor or NounInstanceAccessor
   * @param noun The noun type (e.g., 'Customer', 'Order')
   * @param id Optional ID for instance access
   */
  getNounAccessor(noun: string, id?: string): NounAccessor | NounInstanceAccessor {
    const storage = this.getStorageAdapter()
    return id
      ? new NounInstanceAccessor(storage, noun, id)
      : new NounAccessor(storage, noun)
  }

  /**
   * Dynamic noun accessor - ergonomic alias for getNounAccessor()
   *
   * This is the preferred method for accessing arbitrary noun types via RPC.
   * It works with any PascalCase noun name without requiring code changes.
   *
   * @example
   * ```typescript
   * // Create a new thing
   * const vehicle = await doInstance.noun('Vehicle').create({ make: 'Tesla' })
   *
   * // Access an existing thing by ID
   * const updated = await doInstance.noun('Vehicle', vehicle.$id).update({ color: 'red' })
   *
   * // List all things of a type
   * const vehicles = await doInstance.noun('Vehicle').list()
   * ```
   *
   * @param nounType The noun type (e.g., 'Customer', 'Vehicle', 'BlogPost')
   * @param id Optional ID for instance access
   * @returns NounAccessor (if no id) or NounInstanceAccessor (if id provided)
   */
  noun(nounType: string, id?: string): NounAccessor | NounInstanceAccessor {
    return this.getNounAccessor(nounType, id)
  }

  // Standard noun accessor methods - use factory pattern
  Customer(id?: string): NounAccessor | NounInstanceAccessor { return this.getNounAccessor('Customer', id) }
  Order(id?: string): NounAccessor | NounInstanceAccessor { return this.getNounAccessor('Order', id) }
  Product(id?: string): NounAccessor | NounInstanceAccessor { return this.getNounAccessor('Product', id) }
  Payment(id?: string): NounAccessor | NounInstanceAccessor { return this.getNounAccessor('Payment', id) }
  Invoice(id?: string): NounAccessor | NounInstanceAccessor { return this.getNounAccessor('Invoice', id) }
  User(id?: string): NounAccessor | NounInstanceAccessor { return this.getNounAccessor('User', id) }
  Item(id?: string): NounAccessor | NounInstanceAccessor { return this.getNounAccessor('Item', id) }
  Temp(id?: string): NounAccessor | NounInstanceAccessor { return this.getNounAccessor('Temp', id) }

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

    // Run schema migrations (versioned, idempotent)
    // This replaces inline CREATE TABLE statements with tracked migrations
    const runner = new MigrationRunner(this.ctx.storage.sql)
    const migrationResult = runner.migrate()
    if (!migrationResult.success) {
      console.error('[DOCore] Migration failed:', migrationResult.error)
    }

    // Initialize state manager
    this.stateManager = new StateManager(this.ctx)

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

    // Get allowed origins from environment configuration
    // This enables runtime configuration via ALLOWED_ORIGINS env var
    const allowedOrigins = getAllowedOrigins(this.env)

    // Secure CORS middleware - validates origins against environment-configured allowlist
    // and applies route-specific policies (public, protected, admin)
    app.use('*', async (c, next) => {
      const origin = c.req.header('Origin')
      const pathname = new URL(c.req.url).pathname
      const policy = getCorsPolicy(pathname)

      // Handle preflight OPTIONS requests
      if (c.req.method === 'OPTIONS') {
        const requestedHeaders = c.req.header('Access-Control-Request-Headers')
        const corsHeaders = buildCorsHeaders(origin, allowedOrigins, policy, requestedHeaders)

        // Return 204 with appropriate CORS headers (or lack thereof for invalid origins)
        return new Response(null, {
          status: 204,
          headers: corsHeaders,
        })
      }

      // For actual requests, process and add CORS headers to response
      await next()

      // Add CORS headers to the response
      const corsHeaders = buildCorsHeaders(origin, allowedOrigins, policy)
      for (const [key, value] of corsHeaders.entries()) {
        c.res.headers.set(key, value)
      }
    })

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

    // Wildcard files route - with path validation
    app.get('/files/*', (c) => {
      const path = c.req.path
      const wildcard = path.replace('/files/', '')

      // Validate path to prevent path traversal attacks
      const validation = validatePath(wildcard)
      if (!validation.valid) {
        return c.json({ error: validation.error }, 400)
      }

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

    // RPC Pipeline endpoint - handles Cap'n Web style promise pipelining
    // POST /rpc/pipeline - Execute a pipeline against this DO
    app.post('/rpc/pipeline', async (c) => {
      try {
        const body = await c.req.json()

        // Handle both single pipeline and batch requests
        const isBatch = Array.isArray(body)
        const requests = isBatch ? body : [body]

        const executor = new PipelineExecutor()
        const results = await Promise.all(
          requests.map(async (req: { id?: string; pipeline: SerializedPipeline }) => {
            try {
              // Deserialize the wire format pipeline
              const { target, steps } = deserializePipeline(req.pipeline)

              // Execute the pipeline against this DO instance
              // The pipeline targets a noun accessor on this DO
              const nounAccessor = this.getNounAccessor(target.noun, target.id)
              const result = await executor.execute(nounAccessor, steps as ExecutorPipelineStep[])

              return { id: req.id, result }
            } catch (err) {
              return { id: req.id, error: (err as Error).message }
            }
          })
        )

        // Return single result or batch based on input
        return c.json(isBatch ? results : results[0])
      } catch (err) {
        return c.json({ error: (err as Error).message }, HTTP_STATUS.BAD_REQUEST)
      }
    })

    // Admin group - requires admin authentication
    // Uses standardized requireAdmin middleware from lib/auth-middleware
    app.get('/admin/users', requireAdmin, (c) => c.json({ users: [] }))

    // Protected route with auth middleware (requires any valid auth)
    app.get('/protected/data', requireAuth, (c) => {
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

    // State read from DO - requires authentication
    // Internal state access should be protected
    app.get('/api/state-read', requireAuth, async (c) => {
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

    // RPC WebSocket endpoint - enables bidirectional callbacks via Cap'n Web style RPC
    app.get('/ws/rpc', (c) => {
      if (!this.isWebSocketUpgradeRequest(c)) {
        return c.json({ error: 'Upgrade required' }, HTTP_STATUS.UPGRADE_REQUIRED)
      }

      return this.handleWebSocketUpgrade(c, ['rpc', 'hibernatable'], true)
    })

    // Event subscription WebSocket endpoint
    app.get('/ws/events', (c) => {
      if (!this.isWebSocketUpgradeRequest(c)) {
        return c.json({ error: 'Upgrade required' }, HTTP_STATUS.UPGRADE_REQUIRED)
      }

      return this.handleWebSocketUpgrade(c, ['events', 'hibernatable'], true)
    })
  }

  // =========================================================================
  // WEBSOCKET HELPERS - Delegated to WebSocketManager
  // =========================================================================

  /**
   * Check if a request is a valid WebSocket upgrade request
   */
  private isWebSocketUpgradeRequest(c: Context<HonoEnv>): boolean {
    return this.wsManager.isWebSocketUpgradeRequest(c)
  }

  /**
   * Handle WebSocket upgrade and connection setup
   */
  private handleWebSocketUpgrade(c: Context<HonoEnv>, tags: string[], hibernatable: boolean): Response {
    return this.wsManager.handleWebSocketUpgrade(this.ctx, tags, hibernatable)
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

  // =========================================================================
  // EVALUATE RPC HANDLER
  // =========================================================================

  /**
   * Options for the evaluate RPC call
   */
  private static DEFAULT_TIMEOUT = 5000

  /**
   * Result structure returned from evaluate RPC handler
   */
  private formatError(error: unknown): { message: string; name?: string; stack?: string } {
    if (error instanceof Error) {
      // Sanitize stack to remove internal paths
      let stack = error.stack
      if (stack) {
        stack = stack.split('\n')
          .filter(line => !line.includes('node_modules'))
          .join('\n')
      }
      return {
        message: error.message,
        name: error.name,
        stack,
      }
    }
    if (typeof error === 'string') {
      return { message: error }
    }
    if (typeof error === 'number') {
      return { message: String(error) }
    }
    if (error && typeof error === 'object') {
      return { message: JSON.stringify(error) }
    }
    return { message: String(error) }
  }

  /**
   * Evaluate code in a sandboxed environment with the DO instance as workflow context ($)
   *
   * Architecture:
   * - CLI sends code string via RPC
   * - DO runs code with $ = this (DO instance)
   * - Results include { success, value, error, logs, duration }
   *
   * Key invariants:
   * 1. $ === this inside the sandbox (DO instance is the context)
   * 2. Flat namespace: globalThis.Customer === $.Customer
   * 3. Logs are captured and returned in result
   * 4. Errors are properly formatted and returned
   * 5. Timeouts are enforced (configurable)
   *
   * @param code The code to evaluate
   * @param options Evaluation options (timeout, captureLogs)
   * @returns EvaluateResult with success, value, error, logs, duration
   */
  async evaluate(
    code: string,
    options?: { timeout?: number; captureLogs?: boolean }
  ): Promise<{
    success: boolean
    value?: unknown
    error?: { message: string; name?: string; stack?: string }
    logs: string[]
    duration: number
  }> {
    const start = Date.now()
    const timeout = options?.timeout ?? DOCore.DEFAULT_TIMEOUT
    const captureLogs = options?.captureLogs !== false
    const logs: string[] = []

    // Create console interceptors for log capture
    const createConsoleInterceptor = () => {
      return {
        log: (...args: unknown[]) => {
          if (captureLogs) {
            logs.push(args.map(arg =>
              typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
            ).join(' '))
          }
        },
        warn: (...args: unknown[]) => {
          if (captureLogs) {
            logs.push('[WARN] ' + args.map(arg =>
              typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
            ).join(' '))
          }
        },
        error: (...args: unknown[]) => {
          if (captureLogs) {
            logs.push('[ERROR] ' + args.map(arg =>
              typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
            ).join(' '))
          }
        },
        info: (...args: unknown[]) => {
          if (captureLogs) {
            logs.push(args.map(arg =>
              typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
            ).join(' '))
          }
        },
        debug: (...args: unknown[]) => {
          if (captureLogs) {
            logs.push(args.map(arg =>
              typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
            ).join(' '))
          }
        },
      }
    }

    // Create noun accessor factory for flat namespace
    const createNounFactory = (noun: string) => {
      return (id?: string) => this.getNounAccessor(noun, id)
    }

    try {
      // Build the sandbox globals
      const sandboxConsole = createConsoleInterceptor()
      const $ = this

      // Create flat namespace globals
      const Customer = createNounFactory('Customer')
      const Order = createNounFactory('Order')
      const Product = createNounFactory('Product')
      const Payment = createNounFactory('Payment')
      const Invoice = createNounFactory('Invoice')
      const User = createNounFactory('User')
      const Item = createNounFactory('Item')

      // Bind send and other context methods
      const send = this.send.bind(this)
      const on = this.on
      const every = this.every

      // Handle empty or whitespace-only code
      const trimmedCode = code.trim()
      if (!trimmedCode) {
        return {
          success: true,
          value: undefined,
          logs,
          duration: Date.now() - start,
        }
      }

      // Wrap code in an async function for execution
      // The code is expected to use 'return' statements for values
      const wrappedCode = `
        return (async () => {
          ${trimmedCode}
        })()
      `

      // Create the function with sandbox globals
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function(
        'console',
        '$',
        'Customer',
        'Order',
        'Product',
        'Payment',
        'Invoice',
        'User',
        'Item',
        'send',
        'on',
        'every',
        'globalThis',
        wrappedCode
      )

      // Create a sandboxed globalThis with our globals
      const sandboxGlobalThis = {
        $,
        Customer,
        Order,
        Product,
        Payment,
        Invoice,
        User,
        Item,
        send,
        on,
        every,
        console: sandboxConsole,
        // Block dangerous globals
        process: undefined,
        require: undefined,
        // Allow basic JS globals
        Promise,
        Array,
        Object,
        String,
        Number,
        Boolean,
        Date,
        Math,
        JSON,
        Map,
        Set,
        RegExp,
        Error,
        TypeError,
        ReferenceError,
        SyntaxError,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
      }

      // Execute with timeout
      const executeWithTimeout = async (): Promise<unknown> => {
        return new Promise((resolve, reject) => {
          let timeoutId: ReturnType<typeof setTimeout> | undefined
          let settled = false

          const settle = (fn: () => void) => {
            if (!settled) {
              settled = true
              if (timeoutId) clearTimeout(timeoutId)
              fn()
            }
          }

          // Set timeout
          timeoutId = setTimeout(() => {
            settle(() => reject(new Error('Execution timeout exceeded')))
          }, timeout)

          // Execute the code
          try {
            const result = fn(
              sandboxConsole,
              $,
              Customer,
              Order,
              Product,
              Payment,
              Invoice,
              User,
              Item,
              send,
              on,
              every,
              sandboxGlobalThis
            )

            // Handle promise results
            if (result && typeof result.then === 'function') {
              result.then(
                (value: unknown) => settle(() => resolve(value)),
                (error: unknown) => settle(() => reject(error))
              )
            } else {
              settle(() => resolve(result))
            }
          } catch (error) {
            settle(() => reject(error))
          }
        })
      }

      const value = await executeWithTimeout()

      return {
        success: true,
        value,
        logs,
        duration: Date.now() - start,
      }
    } catch (error) {
      return {
        success: false,
        error: this.formatError(error),
        logs,
        duration: Date.now() - start,
      }
    }
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
  // SCHEMA MIGRATION METHODS (RPC)
  // =========================================================================

  /**
   * Get the current schema migration version
   * @returns The current version number (0 if no migrations applied)
   */
  getMigrationVersion(): number {
    const runner = new MigrationRunner(this.ctx.storage.sql)
    return runner.getCurrentVersion()
  }

  /**
   * Get list of migrations that haven't been applied yet
   * @returns Array of pending migration info
   */
  getPendingMigrations(): PendingMigration[] {
    const runner = new MigrationRunner(this.ctx.storage.sql)
    return runner.getPendingMigrations()
  }

  /**
   * Run all pending schema migrations (or up to target version)
   * @param targetVersion Optional maximum version to migrate to
   * @returns Migration result with details
   */
  runMigrations(targetVersion?: number): MigrationResult {
    const runner = new MigrationRunner(this.ctx.storage.sql)
    return runner.migrate(targetVersion)
  }

  // =========================================================================
  // BROKER INTEGRATION - rpcCall() for three-party handoff
  // =========================================================================

  /**
   * Secret for capability verification.
   * In production, this would come from env.CAPABILITY_SECRET.
   * When null, capability verification is skipped (development mode).
   */
  protected capabilitySecret: string | null = null

  /**
   * Set the capability secret for verification.
   * Called by subclasses or via configuration.
   * @param secret The shared secret for HMAC verification
   */
  protected setCapabilitySecret(secret: string): void {
    this.capabilitySecret = secret
  }

  /**
   * Set capability secret for testing purposes.
   * This is a public RPC method to allow tests to configure the secret.
   * @param secret The shared secret for HMAC verification
   */
  setCapabilitySecretForTest(secret: string): void {
    this.capabilitySecret = secret
  }

  /**
   * RPC call handler - called by BrokerDO via stub.rpcCall()
   *
   * This enables the three-party handoff pattern:
   * 1. Client requests via BrokerDO
   * 2. BrokerDO routes to appropriate worker via rpcCall()
   * 3. Worker verifies capability and executes method
   *
   * @param method The method name to call on this DO instance
   * @param args Array of arguments to pass to the method
   * @param capability Optional capability token for authorization
   * @returns The result of the method call
   * @throws Error if method not found or capability verification fails
   */
  async rpcCall(method: string, args: unknown[], capability?: string): Promise<unknown> {
    // 1. Verify capability if provided
    if (capability) {
      await this.verifyCapability(capability, method)
    }

    // 2. Find the method on this instance
    const fn = (this as unknown as Record<string, unknown>)[method]
    if (typeof fn !== 'function') {
      throw new Error(`Method not found: ${method}`)
    }

    // 3. Call and return result
    return (fn as (...args: unknown[]) => unknown).apply(this, args)
  }

  /**
   * Verify capability token for a method call.
   *
   * SECURITY: When a token is provided, it MUST be verified. If no secret is
   * configured, verification fails because we cannot validate the token's
   * authenticity. This prevents attackers from bypassing security by simply
   * providing any token when the secret is not configured.
   *
   * Development mode: Call rpcCall() WITHOUT a capability token - the check
   * at line 910 (if capability) will skip verification entirely.
   *
   * Override in subclasses for custom verification logic.
   *
   * @param token The capability token to verify
   * @param method The method being called
   * @returns The verified capability payload
   * @throws CapabilityError if verification fails or secret is not configured
   */
  protected async verifyCapability(token: string, method: string): Promise<CapabilityPayload> {
    // SECURITY FIX (do-zy3f): When a token is provided, we MUST verify it.
    // If no secret is configured, we cannot verify - this is an error.
    // The old code returned wildcard admin access here, which was a critical security bug.
    if (!this.capabilitySecret) {
      throw new CapabilityError(
        'Capability secret is required to verify tokens. Configure CAPABILITY_SECRET or call setCapabilitySecret().',
        'SECRET_REQUIRED'
      )
    }

    const payload = await verifyCapabilityToken(token, this.capabilitySecret)

    // Check if method is allowed
    if (!payload.methods.includes('*') && !payload.methods.includes(method)) {
      throw new CapabilityError(`Method not allowed: ${method}`, 'INSUFFICIENT_SCOPE')
    }

    return payload
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
  // RAW SQL QUERY (Protected - Read-Only)
  // =========================================================================

  /**
   * Execute a raw SQL query against the state storage
   *
   * SECURITY: This method is protected by SQL validation:
   * - Only SELECT queries are allowed (read-only)
   * - Multi-statement injection is blocked
   * - SQL comments are blocked
   * - Administrative commands (PRAGMA, VACUUM, etc.) are blocked
   * - Error messages are sanitized to prevent SQL structure leakage
   *
   * @param sql SQL SELECT query string with ? placeholders for parameters
   * @param params Parameter values for the query
   * @returns Array of rows matching the query
   * @throws SqlSecurityError if the query violates security policies
   */
  async query(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    // Validate the SQL query for security
    try {
      validateSqlQuery(sql)
    } catch (error) {
      // Re-throw security errors as-is
      if (error instanceof SqlSecurityError) {
        throw error
      }
      throw sanitizeSqlError(error)
    }

    // Execute the validated query
    try {
      const results = this.ctx.storage.sql.exec(sql, ...params).toArray()
      return results.map((row) => this.parseQueryRow(row))
    } catch (error) {
      // Sanitize any SQL errors to prevent information leakage
      throw sanitizeSqlError(error)
    }
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
          // Value is not valid JSON - use raw string value
          obj[key] = value
        }
      } else {
        obj[key] = value
      }
    }
    return obj
  }

  // =========================================================================
  // WEBSOCKET SUPPORT - Delegated to WebSocketManager
  // =========================================================================

  /**
   * Get the tags attached to the last connected WebSocket
   * Note: WebSocket objects cannot be passed via RPC, so we use the last connected WebSocket's tags
   */
  async getWebSocketTags(_ws?: WebSocket): Promise<string[]> {
    return this.wsManager.getWebSocketTags(_ws)
  }

  /**
   * Broadcast a message to all WebSockets with the specified tag
   * @param tag The tag to filter WebSocket recipients
   * @param message The message to broadcast (will be JSON-stringified)
   * @returns Object with sent count and failed count
   */
  async broadcast(tag: string, message: unknown): Promise<{ sent: number; failed: number }> {
    return this.wsManager.broadcast(this.ctx, tag, message)
  }

  /**
   * Check if the last connected WebSocket supports hibernation
   */
  async isWebSocketHibernatable(_ws?: WebSocket): Promise<boolean> {
    return this.wsManager.isWebSocketHibernatable(_ws)
  }

  // =========================================================================
  // WEBSOCKET EVENT HANDLERS
  // =========================================================================

  /**
   * Handle incoming WebSocket messages. Routes RPC messages to the handler.
   */
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    // Check if this is an RPC WebSocket (has 'rpc' tag)
    const tags = this.wsManager.getTagsForWebSocket(ws)
    const isRpcWebSocket = tags.includes('rpc') || tags.includes('events')

    if (isRpcWebSocket) {
      // Route to RPC handler
      this.rpcHandler.handleRpcMessage(ws, message, this)
      return
    }

    // Default handling for non-RPC WebSockets can be added by subclasses
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
    this.wsManager.cleanupWebSocket(ws)
    // Also clean up RPC subscriptions
    this.rpcHandler.cleanupWebSocketRpc(ws)
  }

  // =========================================================================
  // WORKFLOW CONTEXT: EVENT METHODS (this.send, this.on)
  // =========================================================================

  /**
   * Fire-and-forget event emission
   * Dispatches event to all matching handlers and WebSocket subscribers
   * Returns immediately with event ID
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

    // Fire-and-forget dispatch to local handlers (don't await, don't throw)
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

    // Broadcast to WebSocket subscribers (Cap'n Web style)
    this.rpcHandler.broadcastEvent(this.ctx, eventType, event)

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
    return createOnProxy(this.eventHandlers)
  }

  // =========================================================================
  // STATE ACCESSOR (RPC-compatible state access)
  // =========================================================================

  // Cached StateAccessor instance for RPC access
  private _stateAccessor: StateAccessor | null = null

  /**
   * State accessor for RPC-compatible state operations
   *
   * Note: Cloudflare Workers RPC supports both getter and method patterns for
   * returning RpcTarget objects. The getter allows property-style access:
   *   await stub.state.get('myKey')
   *   await stub.state.set('myKey', 'value')
   *
   * @returns StateAccessor instance for RPC access
   */
  get state(): StateAccessor {
    if (!this._stateAccessor) {
      this._stateAccessor = new StateAccessor(this.stateManager)
    }
    return this._stateAccessor
  }

  /**
   * State accessor method for RPC-compatible state operations
   *
   * This method provides an alternative to the getter for cases where
   * method call syntax is preferred:
   *   await stub.getState().get('myKey')
   *   await stub.getState().set('myKey', 'value')
   *   await stub.getState().delete('myKey')
   *   await stub.getState().list({ prefix: 'user:' })
   *
   * @returns StateAccessor instance for RPC access
   */
  getState(): StateAccessor {
    if (!this._stateAccessor) {
      this._stateAccessor = new StateAccessor(this.stateManager)
    }
    return this._stateAccessor
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
  // EVICTION SIMULATION & RECOVERY (RPC methods for testing)
  // =========================================================================

  /**
   * Clear in-memory caches to simulate DO eviction.
   * This is used for testing to simulate what happens when a DO is evicted:
   * - Memory is released (things, eventHandlers, schedules maps cleared)
   * - SQLite state remains (actionLog, things table, state table persist)
   *
   * After calling this, the DO should be able to recover state from SQLite.
   */
  clearMemoryCache(): void {
    // Clear in-memory caches
    this.things.clear()
    this.eventHandlers.clear()
    this.schedules.clear()

    // Track recovery metrics
    this.lastRecoveryTimestamp = Date.now()
    this.recoverySource = 'memory_cleared'

    // Note: actionLog is NOT cleared - it represents durable state loaded from SQLite
    // Note: SQLite tables are NOT cleared - they represent durable state
  }

  // Recovery tracking state
  private lastRecoveryTimestamp: number = 0
  private recoverySource: string = 'empty'

  /**
   * Get recovery statistics after eviction simulation.
   * Returns information about what was recovered from SQLite.
   */
  async getRecoveryStats(): Promise<{
    thingsRecovered: number
    stateEntriesRecovered: number
    lastRecoveryTimestamp: number
  }> {
    // Count things in SQLite
    const thingsCountResult = this.ctx.storage.sql
      .exec('SELECT COUNT(*) as count FROM things')
      .toArray()
    const thingsRecovered = (thingsCountResult[0]?.count as number) ?? 0

    // Count state entries in SQLite
    const stateCountResult = this.ctx.storage.sql
      .exec('SELECT COUNT(*) as count FROM state')
      .toArray()
    const stateEntriesRecovered = (stateCountResult[0]?.count as number) ?? 0

    return {
      thingsRecovered,
      stateEntriesRecovered,
      lastRecoveryTimestamp: this.lastRecoveryTimestamp || Date.now(),
    }
  }

  /**
   * Get cold start metrics for monitoring eviction/recovery behavior.
   * Returns information about the last cold start recovery.
   */
  async getColdStartMetrics(): Promise<{
    source: 'sqlite' | 'empty' | 'iceberg'
    thingsLoaded: number
    durationMs: number
  }> {
    // Count things that could be loaded from SQLite
    const thingsCountResult = this.ctx.storage.sql
      .exec('SELECT COUNT(*) as count FROM things')
      .toArray()
    const thingsLoaded = (thingsCountResult[0]?.count as number) ?? 0

    // Determine source based on what's available
    let source: 'sqlite' | 'empty' | 'iceberg' = 'empty'
    if (thingsLoaded > 0) {
      source = 'sqlite'
    }

    return {
      source,
      thingsLoaded,
      durationMs: 0, // Would be measured during actual cold start
    }
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
              return (handler: ScheduleHandler): (() => void) => {
                const { hour, minute } = parseTime(time)
                return self.registerSchedule(`${minute} ${hour} * * ${dow}`, handler)
              }
            }
          }

          if (shortcuts[prop]) {
            return (handler: ScheduleHandler): (() => void) => {
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
      hour: (handler: ScheduleHandler): (() => void) => self.registerSchedule('0 * * * *', handler),
      minute: (handler: ScheduleHandler): (() => void) => self.registerSchedule('* * * * *', handler),
    }

    const everyFn = (n: number): IntervalBuilder => {
      return {
        minutes: (handler: ScheduleHandler): (() => void) => self.registerSchedule(`*/${n} * * * *`, handler),
        hours: (handler: ScheduleHandler): (() => void) => self.registerSchedule(`0 */${n} * * *`, handler),
        seconds: (handler: ScheduleHandler): (() => void) => self.registerSchedule(`every:${n}s`, handler),
      }
    }

    return Object.assign(everyFn, scheduleBuilder) as ScheduleBuilder & ((n: number) => IntervalBuilder)
  }

  private registerSchedule(cron: string, handler: ScheduleHandler): () => void {
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
  getSchedule(cron: string): { handler: ScheduleHandler } | undefined {
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
    // Validate input
    const inputForValidation = { $type: type, ...data }
    assertValidCreateThingInput(inputForValidation)

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

    // Track if we have any in-memory-only operators that need post-filtering
    let remainingWhere: Record<string, unknown> | null = null

    // Build SQL WHERE clause from query operators (pushdown optimization)
    if (query?.where) {
      // Validate the where clause first - throws QueryValidationError if invalid
      const validatedWhere = validateWhereClause(query.where)

      // Build SQL WHERE clause for operators that can be pushed to SQLite
      const sqlWhere = buildSqlWhereClause(validatedWhere)

      if (sqlWhere.sql) {
        sql += ' AND ' + sqlWhere.sql
        params.push(...sqlWhere.params)
      }

      // Keep track of operators that need in-memory filtering ($regex, $exists)
      remainingWhere = sqlWhere.remainingWhere
    }

    // Apply LIMIT before OFFSET for proper pagination
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

    // Apply in-memory filtering for operators that couldn't be pushed to SQL ($regex, $exists)
    if (remainingWhere) {
      results = results.filter((thing) => matchesWhere(thing, remainingWhere!))
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
   * Get a thing by ID - can be overridden by subclasses like DOStorage
   * This is the method that NounAccessors use to retrieve thing data
   */
  getThingById(id: string): Promise<ThingData | null> {
    return Promise.resolve(this.getThing(id))
  }

  /**
   * Get a thing (public wrapper for RpcTarget)
   * @deprecated Use getThingById instead
   */
  getThingPublic(id: string): ThingData | null {
    emitDeprecationWarning('DOCore.getThingPublic', 'getThingById')
    return this.getThing(id)
  }

  /**
   * Update a thing - can be overridden by subclasses like DOStorage
   * This is the method that NounAccessors use to update things
   */
  updateThingById(id: string, updates: Record<string, unknown>): Promise<ThingData> {
    // Get the existing thing to find its type
    const existing = this.getThing(id)
    if (!existing) {
      return Promise.reject(new Error(`Thing not found: ${id}`))
    }
    return this.updateThing(existing.$type, id, updates)
  }

  /**
   * Delete a thing - can be overridden by subclasses like DOStorage
   * This is the method that NounAccessors use to delete things
   */
  deleteThingById(id: string): Promise<boolean> {
    // Get the existing thing to find its type
    const existing = this.getThing(id)
    if (!existing) {
      return Promise.resolve(false)
    }
    return this.deleteThing(existing.$type, id)
  }

  /**
   * Update a thing (public wrapper for RpcTarget)
   * @deprecated Use updateThingById instead
   */
  updateThingInternal(type: string, id: string, updates: Record<string, unknown>): Promise<ThingData> {
    emitDeprecationWarning('DOCore.updateThingInternal', 'updateThingById')
    return this.updateThing(type, id, updates)
  }

  /**
   * Delete a thing (public wrapper for RpcTarget)
   * @deprecated Use deleteThingById instead
   */
  deleteThingInternal(type: string, id: string): Promise<boolean> {
    emitDeprecationWarning('DOCore.deleteThingInternal', 'deleteThingById')
    return this.deleteThing(type, id)
  }

  // =========================================================================
  // CROSS-DO RPC METHODS
  // =========================================================================

  /**
   * Make a remote RPC call to another DO instance.
   *
   * This enables cross-DO communication by:
   * 1. Getting a stub for the target DO by namespace
   * 2. Calling the specified method with arguments
   * 3. Returning the result
   *
   * @param namespace - The namespace (idFromName) of the target DO
   * @param method - The method name to call on the target DO
   * @param args - Arguments to pass to the method
   * @returns The result of the remote method call
   *
   * @example
   * ```typescript
   * // From source DO, call ping() on target DO
   * const result = await this.remoteCall('target-namespace', 'ping', [])
   * // result === 'pong'
   *
   * // Get a value from another DO
   * const value = await this.remoteCall('other-do', 'get', ['my-key'])
   * ```
   */
  async remoteCall(namespace: string, method: string, args: unknown[]): Promise<unknown> {
    // Get the DOCore namespace binding from environment
    const doBinding = this.env.DOCore
    if (!doBinding) {
      throw new Error('DOCore binding not available in environment')
    }

    // Get a stub for the target DO by namespace
    const targetId = doBinding.idFromName(namespace)
    const targetStub = doBinding.get(targetId) as CrossDOStub

    // Use the rpcCall method which is already implemented in DOCore
    // This is the standard pattern for cross-DO RPC calls
    return targetStub.rpcCall(method, args)
  }

  /**
   * Get a remote stub for another DO instance.
   *
   * This provides a more ergonomic API for cross-DO calls by returning
   * a proxy that can be used like a local object.
   *
   * @param noun - The noun type (e.g., 'Customer', 'Order')
   * @param namespace - The namespace of the target DO
   * @param id - Optional ID for instance-level access
   * @returns A proxy that forwards calls to the remote DO
   *
   * @example
   * ```typescript
   * // Get a remote customer stub
   * const customer = await this.remote('Customer', 'other-namespace', 'cust-123')
   * ```
   */
  async remote(noun: string, namespace: string, id?: string): Promise<unknown> {
    // Get the DOCore namespace binding from environment
    const doBinding = this.env.DOCore
    if (!doBinding) {
      throw new Error('DOCore binding not available in environment')
    }

    // Get a stub for the target DO by namespace
    const targetId = doBinding.idFromName(namespace)
    const targetStub = doBinding.get(targetId) as CrossDOStub

    // If no id provided, return the noun accessor from the target DO
    if (!id) {
      return targetStub.getNounAccessor(noun)
    }

    // Return the noun instance accessor from the target DO
    return targetStub.getNounAccessor(noun, id)
  }

  /**
   * Get a remote DO stub by namespace.
   *
   * This is the lowest-level cross-DO method. It returns the raw stub
   * for the target DO, allowing any RPC method to be called.
   *
   * @param namespace - The namespace (idFromName) of the target DO
   * @returns The DurableObjectStub for the target DO
   *
   * @example
   * ```typescript
   * // Get a raw stub for another DO
   * const targetStub = this.getRemoteStub('other-namespace')
   *
   * // Call any method on it
   * const result = await targetStub.ping()
   * ```
   */
  getRemoteStub(namespace: string): DurableObjectStub {
    const doBinding = this.env.DOCore
    if (!doBinding) {
      throw new Error('DOCore binding not available in environment')
    }

    const targetId = doBinding.idFromName(namespace)
    return doBinding.get(targetId)
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
