/**
 * @dotdo/do - THE Durable Object for Digital Objects
 *
 * This module provides the base DO class that serves as the foundation for building
 * Durable Objects with built-in entity storage, event handling, WebSocket support,
 * and scheduling capabilities.
 *
 * @module @dotdo/do
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { createContext, type WorkflowContext } from './context'
import { createSQLiteErrorStore, createSQLiteRetryQueue, createEnhancedErrorStore } from './fire-and-forget-errors'
import { EntityManager } from './entities'
import { WebSocketManager } from './websocket'
import {
  HibernationManager,
  type ReconnectionConfig,
  type HibernationConfig,
} from './hibernation'
import type { ThingsStore, EventsStore, RelationshipsStore, AuditLogStore, AuditContext, QueryBuilder, SqlStorage } from '@dotdo/db'
import { IntegrationRegistry } from '@dotdo/integrations'
import { RPCError, NotFoundError, InternalError, serializeUnknownError } from '@dotdo/rpc'
import type { BatchRPCCall, BatchRPCResult, BatchRPCResponse } from '@dotdo/rpc'
import { logRPCError } from '@dotdo/rpc'
import { CORRELATION_ID_HEADER, generateCorrelationId } from '@dotdo/rpc'
import { createLogger } from '@dotdo/utils'
import {
  createAlarmStore,
  executeSchedules,
  executeOneTimeAlarms,
  calculateNextAlarmTime,
  serializeAlarmStore,
  deserializeAlarmStore,
  type AlarmStore,
} from './workflow/alarm'

const logger = createLogger('[DO]')

/** Storage key for persisted alarm metadata */
const ALARM_STORAGE_KEY = '_alarms'

/**
 * Base environment interface for DO instances.
 * For dynamic access to custom environment variables, use DOEnvWithDynamic.
 */
export interface DOEnv {
  // Common secret environment variables
  JWT_SECRET?: string
  JWKS_URL?: string
  DO_INTERNAL_SECRET?: string
}

/**
 * DOEnv with dynamic property access for custom environment variables.
 */
export type DOEnvWithDynamic = DOEnv & Record<string, unknown>

/**
 * Options for configuring a DO instance.
 */
export interface DOOptions {
  /** Whether to enable CORS middleware. Defaults to true. */
  cors?: boolean
  /** Enable WebSocket hibernation with reconnection protocol support */
  hibernation?: boolean | {
    /** Hibernation configuration */
    config?: Partial<HibernationConfig>
    /** Reconnection protocol configuration */
    reconnection?: Partial<ReconnectionConfig>
  }
}

/**
 * The base DO class - THE Durable Object for Digital Objects.
 *
 * DO = Durable Object = Digital Object
 *
 * This class provides a complete foundation for building Durable Objects with:
 * - **Entity Storage**: Built-in Things, Events, and Relationships stores with SQLite persistence
 * - **Workflow Context ($)**: Fluent API for event handlers, scheduling, and cross-DO RPC
 * - **WebSocket Support**: Real-time communication with connection management
 * - **Integration Registry**: Third-party service integrations
 * - **Audit Logging**: Automatic tracking of entity changes
 *
 * @example
 * ```typescript
 * import { DO } from '@dotdo/do'
 *
 * class MyDO extends DO {
 *   constructor(state: DurableObjectState, env: Env) {
 *     super(state, env)
 *
 *     // Register event handlers using WorkflowContext ($)
 *     this.$.on.Customer.signup(async (event) => {
 *       await this.$.send({ type: 'welcome-email', payload: event.payload })
 *     })
 *
 *     // Schedule recurring tasks
 *     this.$.every.day.at('9am')(async () => {
 *       await this.generateDailyReport()
 *     })
 *   }
 *
 *   // Add custom routes
 *   protected routes(app: Hono): void {
 *     app.get('/customers', async (c) => {
 *       const customers = await this.things.list({ type: 'Customer' })
 *       return c.json(customers)
 *     })
 *   }
 * }
 * ```
 *
 * @see {@link WorkflowContext} for the $ API documentation
 * @see {@link ThingsStore} for entity CRUD operations
 * @see {@link EventsStore} for event emission and querying
 */
export class DO implements DurableObject {
  protected app: Hono
  protected state: DurableObjectState
  protected env: DOEnv
  protected $!: WorkflowContext
  private routesInitialized = false
  private entityManager: EntityManager
  private websocketManager: WebSocketManager
  private _hibernationManager: HibernationManager | null = null
  private _integrations: IntegrationRegistry
  private alarmStore: AlarmStore
  private alarmInitialized = false

  constructor(state: DurableObjectState, env: DOEnv, options: DOOptions = {}) {
    this.state = state
    this.env = env
    this.app = new Hono()

    // Initialize hibernation manager if enabled
    if (options.hibernation) {
      const hibernationOpts = typeof options.hibernation === 'object' ? options.hibernation : {}
      this._hibernationManager = new HibernationManager(
        state,
        hibernationOpts.config,
        hibernationOpts.reconnection
      )
    }

    // Pass state to EntityManager for SQLite storage persistence (do-8m4e)
    this.entityManager = new EntityManager({ state })
    this.websocketManager = new WebSocketManager()
    this._integrations = new IntegrationRegistry()
    this.alarmStore = createAlarmStore()

    // Initialize WorkflowContext ($) for event handlers, scheduling, and cross-DO RPC
    // This provides the fluent API: $.send(), $.try(), $.do(), $.on.*, $.every.*
    // Use SQLite-backed error store and retry queue for persistence across DO restarts (do-f9xs)
    const sql = state.storage.sql as unknown as SqlStorage
    const errorStore = createSQLiteErrorStore(sql)
    const retryQueue = createSQLiteRetryQueue(sql, errorStore)
    const enhancedErrorStore = createEnhancedErrorStore(errorStore, retryQueue)
    this.$ = createContext(state, env, { errorStore: enhancedErrorStore })

    // Setup middleware
    if (options.cors !== false) {
      this.app.use('/*', cors())
    }

    // Setup default routes
    this.setupRoutes()
  }

  /**
   * WebSocket manager for real-time communication.
   * Provides connection handling, message routing, and broadcast capabilities.
   *
   * @example
   * ```typescript
   * // In your DO class
   * this.ws.broadcast({ type: 'update', data: newData })
   * ```
   */
  get ws(): WebSocketManager {
    return this.websocketManager
  }

  /**
   * Hibernation manager for WebSocket connections with reconnection support.
   * Only available when hibernation is enabled in DOOptions.
   *
   * Provides:
   * - Session management for reconnection
   * - Event buffering for replay on reconnect
   * - Protocol message handling (session.resume, heartbeat, etc.)
   *
   * @example
   * ```typescript
   * class MyDO extends DO {
   *   constructor(state, env) {
   *     super(state, env, { hibernation: true })
   *
   *     // Restore sessions on wake
   *     state.blockConcurrencyWhile(async () => {
   *       await this.hibernation?.restoreFromHibernation()
   *     })
   *   }
   *
   *   // Broadcast events with sequence tracking
   *   emitUpdate(data: unknown) {
   *     this.hibernation?.broadcastEvent('update', data)
   *   }
   * }
   * ```
   */
  get hibernation(): HibernationManager | null {
    return this._hibernationManager
  }

  /**
   * Integration registry for third-party services.
   * Register and access integrations like Stripe, SendGrid, etc.
   *
   * @example
   * ```typescript
   * // Register an integration
   * this.integrations.register('stripe', stripeIntegration)
   *
   * // Use an integration
   * const stripe = this.integrations.get('stripe')
   * ```
   */
  get integrations(): IntegrationRegistry {
    return this._integrations
  }

  /**
   * Things store for entity CRUD operations.
   * Provides create, read, update, delete, and list operations for typed entities.
   *
   * @example
   * ```typescript
   * // Create a customer
   * const customer = await this.things.create({
   *   $type: 'Customer',
   *   name: 'Alice',
   *   email: 'alice@example.com'
   * })
   *
   * // List all customers
   * const customers = await this.things.list({ type: 'Customer' })
   * ```
   */
  get things(): ThingsStore {
    return this.entityManager.things
  }

  /**
   * Events store for immutable event logging and querying.
   * Emit events and query the event history.
   *
   * @example
   * ```typescript
   * // Emit an event
   * await this.events.emit({
   *   type: 'Customer.signup',
   *   payload: { customerId: '123', plan: 'pro' }
   * })
   *
   * // Query events
   * const signups = await this.events.query({ type: 'Customer.signup' })
   * ```
   */
  get events(): EventsStore {
    return this.entityManager.events
  }

  /**
   * Relationships store for subject-predicate-object triples.
   * Create and query relationships between entities.
   *
   * @example
   * ```typescript
   * // Add a relationship
   * await this.relationships.add({
   *   subject: customerId,
   *   predicate: 'owns',
   *   object: orderId
   * })
   *
   * // Find related entities
   * const orders = await this.relationships.getRelated(customerId, 'owns')
   * ```
   */
  get relationships(): RelationshipsStore {
    return this.entityManager.relationships
  }

  /**
   * Audit log store for tracking entity changes.
   * Query the audit history of who changed what and when.
   *
   * @example
   * ```typescript
   * // Query audit logs for an entity
   * const logs = await this.auditLogs.query({ entityId: customerId })
   * ```
   */
  get auditLogs(): AuditLogStore {
    return this.entityManager.auditLogs
  }

  /**
   * Set the audit context for tracking who performed actions
   * Call this at the start of request handling
   */
  setAuditContext(context: AuditContext): void {
    this.entityManager.setAuditContext(context)
  }

  /**
   * Get the current audit context
   */
  getAuditContext(): AuditContext {
    return this.entityManager.getAuditContext()
  }

  /**
   * Create a query builder for cross-entity queries.
   * Enables complex queries with joins across Things, Events, and Relationships.
   *
   * @returns A QueryBuilder instance for constructing queries
   *
   * @example
   * ```typescript
   * const results = await this.query()
   *   .from('things')
   *   .where('$type', '=', 'Customer')
   *   .orderBy('$createdAt', 'desc')
   *   .limit(10)
   *   .execute()
   * ```
   */
  query(): QueryBuilder {
    return this.entityManager.query()
  }

  private setupRoutes() {
    // Health check
    this.app.get('/', (c) => c.json({
      status: 'ok',
      id: this.state.id.toString(),
    }))

    // RPC endpoint with enhanced error logging (do-grp5.5)
    this.app.post('/rpc', async (c) => {
      // Extract or generate correlation ID for request tracing
      const incomingCorrelationId = c.req.header(CORRELATION_ID_HEADER)
      const correlationId = incomingCorrelationId || generateCorrelationId()
      c.header(CORRELATION_ID_HEADER, correlationId)

      let method = ''
      let args: unknown[] = []

      try {
        const body = await c.req.json<{ method: string; args: unknown[] }>()
        method = body.method
        args = body.args

        // Navigate to method
        const parts = method.split('.')
        let current: Record<string, unknown> = this as unknown as Record<string, unknown>

        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i]!
          current = current[part] as Record<string, unknown>
          if (!current) {
            const error = new NotFoundError(`Method not found: ${method}`)
            return c.json({ ...error.toJSON(), correlationId }, error.httpStatus as ContentfulStatusCode)
          }
        }

        const fn = current[parts[parts.length - 1]!]
        if (typeof fn !== 'function') {
          const error = new NotFoundError(`Method not found: ${method}`)
          return c.json({ ...error.toJSON(), correlationId }, error.httpStatus as ContentfulStatusCode)
        }

        const result = await fn.apply(current, args)
        return c.json(result)
      } catch (error) {
        // Log RPC error with full context (sanitized args, correlation ID, timestamp, stack)
        logRPCError(error, method || 'unknown', args, correlationId)

        // Re-throw RPCErrors with proper formatting
        if (error instanceof RPCError) {
          return c.json({ ...error.toJSON(), correlationId }, error.httpStatus as ContentfulStatusCode)
        }
        // Wrap unknown errors in InternalError
        const wrappedError = InternalError.wrap(error)
        return c.json({ ...wrappedError.toJSON(), correlationId }, wrappedError.httpStatus as ContentfulStatusCode)
      }
    })

    // Batch RPC endpoint - execute multiple calls in parallel (do-rljr.7)
    this.app.post('/rpc/batch', async (c) => {
      // Extract or generate correlation ID for request tracing
      const incomingCorrelationId = c.req.header(CORRELATION_ID_HEADER)
      const correlationId = incomingCorrelationId || generateCorrelationId()
      c.header(CORRELATION_ID_HEADER, correlationId)

      try {
        const { calls } = await c.req.json<{ calls: BatchRPCCall[] }>()

        if (!Array.isArray(calls)) {
          const error = new NotFoundError('Invalid batch request: calls must be an array')
          return c.json({ ...error.toJSON(), correlationId }, error.httpStatus as ContentfulStatusCode)
        }

        // Execute all calls in parallel
        const results: BatchRPCResult[] = await Promise.all(
          calls.map(async (call, index): Promise<BatchRPCResult> => {
            const callId = call.id ?? `call-${index}`

            try {
              // Navigate to method
              const parts = call.method.split('.')
              let current: Record<string, unknown> = this as unknown as Record<string, unknown>

              for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i]!
                current = current[part] as Record<string, unknown>
                if (!current) {
                  return {
                    id: callId,
                    error: new NotFoundError(`Method not found: ${call.method}`).toJSON(),
                  }
                }
              }

              const fn = current[parts[parts.length - 1]!]
              if (typeof fn !== 'function') {
                return {
                  id: callId,
                  error: new NotFoundError(`Method not found: ${call.method}`).toJSON(),
                }
              }

              const result = await fn.apply(current, call.args ?? [])
              return { id: callId, result }
            } catch (error) {
              // Log individual call errors with context
              logRPCError(error, call.method, call.args ?? [], correlationId)
              // Serialize the error
              return {
                id: callId,
                error: serializeUnknownError(error),
              }
            }
          })
        )

        const response: BatchRPCResponse = {
          results,
          correlationId,
        }

        return c.json(response)
      } catch (error) {
        // Log batch RPC error with context
        logRPCError(error, 'batch', [], correlationId)

        // Handle request-level errors (e.g., invalid JSON)
        if (error instanceof RPCError) {
          return c.json({ ...error.toJSON(), correlationId }, error.httpStatus as ContentfulStatusCode)
        }
        const wrappedError = InternalError.wrap(error)
        return c.json({ ...wrappedError.toJSON(), correlationId }, wrappedError.httpStatus as ContentfulStatusCode)
      }
    })

    // Storage info
    this.app.get('/info', async (c) => {
      const stored = await this.state.storage.list()
      return c.json({
        id: this.state.id.toString(),
        keys: stored.size,
      })
    })
  }

  /**
   * Override this method to add custom routes to the DO's Hono app.
   * Called once before the first fetch request is processed.
   *
   * @param app - The Hono application instance to add routes to
   *
   * @example
   * ```typescript
   * protected routes(app: Hono): void {
   *   app.get('/customers/:id', async (c) => {
   *     const customer = await this.things.get(c.req.param('id'))
   *     return c.json(customer)
   *   })
   *
   *   app.post('/customers', async (c) => {
   *     const data = await c.req.json()
   *     const customer = await this.things.create({ $type: 'Customer', ...data })
   *     return c.json(customer)
   *   })
   * }
   * ```
   */
  protected routes(_app: Hono): void {
    // Override in subclass
  }

  /**
   * Handle incoming HTTP requests to this Durable Object.
   * Delegates to the internal Hono app after initializing routes.
   *
   * @param request - The incoming HTTP request
   * @returns A Promise resolving to the HTTP response
   */
  async fetch(request: Request): Promise<Response> {
    // Allow subclasses to add routes (only once)
    if (!this.routesInitialized) {
      this.routes(this.app)
      this.routesInitialized = true
    }
    return this.app.fetch(request)
  }

  /**
   * Alarm handler - processes scheduled work from $.every DSL
   *
   * This method is called by the Durable Object runtime when an alarm fires.
   * It executes all registered schedule handlers and one-time alarms,
   * then re-schedules recurring alarms.
   *
   * Subclasses can override this method but should call super.alarm()
   * to ensure scheduled work is processed.
   */
  async alarm(): Promise<void> {
    // Initialize alarm state if needed (restore from storage)
    await this.initializeAlarms()

    const schedules = this.$._schedules

    // Execute all registered schedules
    const scheduleResults = await executeSchedules(schedules, this.alarmStore)

    // Log any errors (but continue processing)
    for (const result of scheduleResults) {
      if (!result.success && result.error) {
        logger.error(`Schedule "${result.id}" failed:`, result.error.message)
      }
    }

    // Execute one-time alarms
    const oneTimeResults = await executeOneTimeAlarms(this.alarmStore)

    for (const result of oneTimeResults) {
      if (!result.success && result.error) {
        logger.error(`One-time alarm "${result.id}" failed:`, result.error.message)
      }
    }

    // Persist alarm state
    await this.persistAlarmState()

    // Re-schedule next alarm for recurring schedules
    await this.scheduleNextAlarm()
  }

  /**
   * Initialize alarms from storage (for DO restart recovery)
   */
  private async initializeAlarms(): Promise<void> {
    if (this.alarmInitialized) return
    this.alarmInitialized = true

    try {
      const stored = await this.state.storage.get<ReturnType<typeof serializeAlarmStore>>(ALARM_STORAGE_KEY)
      if (stored) {
        deserializeAlarmStore(stored, this.alarmStore)
      }
    } catch (error) {
      logger.error('Failed to restore alarm state:', error)
    }
  }

  /**
   * Persist alarm state to storage
   */
  private async persistAlarmState(): Promise<void> {
    try {
      const data = serializeAlarmStore(this.alarmStore)
      await this.state.storage.put(ALARM_STORAGE_KEY, data)
    } catch (error) {
      logger.error('Failed to persist alarm state:', error)
    }
  }

  /**
   * Schedule the next alarm based on registered schedules
   */
  protected async scheduleNextAlarm(): Promise<void> {
    const schedules = this.$._schedules

    if (schedules.size === 0 && this.alarmStore.oneTimeAlarms.size === 0) {
      return // No schedules to set alarm for
    }

    const nextTime = calculateNextAlarmTime(schedules, this.alarmStore)

    if (nextTime !== null) {
      try {
        await this.state.storage.setAlarm(nextTime)
      } catch (error) {
        logger.error('Failed to set alarm:', error)
      }
    }
  }

  /**
   * Schedule a one-time alarm to execute a handler after a delay
   *
   * LIMITATION: Handlers are NOT serialized and will be lost on DO restart
   *
   * This method schedules a one-time alarm with the following behavior:
   * - If the alarm fires before the DO restarts: ✓ Works normally
   * - If the DO restarts before the alarm fires: ✗ Handler is lost silently
   *
   * The alarm metadata (timing) IS persisted, but the handler function IS NOT
   * because JavaScript functions cannot be serialized to JSON.
   *
   * When a DO restarts:
   * 1. The alarm metadata is restored from storage
   * 2. The handler reference is gone (stored only in-memory)
   * 3. When the alarm fires, executeOneTimeAlarms() finds no handler
   * 4. The alarm is silently skipped with a warning log
   * 5. The work never executes
   *
   * RECOMMENDATIONS:
   * For critical work that must survive restarts:
   * - Use recurring schedules ($.every.X) instead
   * - Store work intent in persistent data (Thing, Entity, etc.)
   * - Implement a persistent job queue pattern
   * - Re-register handlers in DO initialization if needed
   * - Use $.do() with explicit retry logic for important operations
   *
   * This is safe for:
   * - Short-lived tasks that will complete before any likely restart
   * - Non-critical operations (e.g., cache invalidation, metrics)
   * - Tasks with external idempotency guarantees
   *
   * @param delayMs - Delay in milliseconds before execution
   * @param handler - The handler function to execute (not persisted)
   * @returns Promise that resolves when alarm is scheduled
   */
  protected async scheduleOneTimeAlarm(delayMs: number, handler: () => Promise<void>): Promise<void> {
    await this.initializeAlarms()

    const id = `one-time-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const runAt = Date.now() + delayMs

    // Store the alarm metadata (PERSISTED)
    this.alarmStore.oneTimeAlarms.set(id, {
      id,
      runAt,
      handlerRef: id,
    })

    // Store the handler reference (IN-MEMORY ONLY, not persisted)
    this.alarmStore.oneTimeHandlers.set(id, handler)

    // Persist and schedule
    await this.persistAlarmState()
    await this.scheduleNextAlarm()
  }

  /**
   * Clear all alarms (both recurring and one-time)
   */
  protected async clearAllAlarms(): Promise<void> {
    // Clear alarm store
    this.alarmStore.alarms.clear()
    this.alarmStore.oneTimeAlarms.clear()
    this.alarmStore.oneTimeHandlers.clear()

    // Delete the alarm
    try {
      await this.state.storage.deleteAlarm()
    } catch (error) {
      logger.error('Failed to delete alarm:', error)
    }

    // Clear persisted state
    try {
      await this.state.storage.delete(ALARM_STORAGE_KEY)
    } catch (error) {
      logger.error('Failed to clear alarm storage:', error)
    }
  }

  // WebSocket handlers - Override in subclass for custom behavior

  /**
   * Handle incoming WebSocket message.
   *
   * When hibernation is enabled, this method:
   * 1. First checks if the message is a reconnection protocol message
   * 2. If so, handles it automatically (session.resume, heartbeat, etc.)
   * 3. If not, routes to WebSocketManager handlers
   *
   * Override in subclass for custom behavior:
   *
   * @example
   * ```typescript
   * async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
   *   // Call super first to handle protocol messages
   *   await super.webSocketMessage(ws, message)
   *
   *   // Custom message handling
   *   const data = JSON.parse(message as string)
   *   // ...
   * }
   * ```
   */
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    // When hibernation is enabled, handle reconnection protocol messages first
    if (this._hibernationManager) {
      const handled = await this._hibernationManager.handleProtocolMessage(ws, message)
      if (handled) return
    }

    await this.websocketManager.handleMessage(ws, message)
  }

  /**
   * Handle WebSocket close event.
   *
   * When hibernation is enabled, the session is preserved for potential reconnection.
   * By default, cleans up WebSocket tracking.
   */
  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    // When hibernation is enabled, preserve session for reconnection
    if (this._hibernationManager) {
      this._hibernationManager.handleClose(ws)
    }

    this.websocketManager.cleanupWebSocket(ws)
  }

  /**
   * Handle WebSocket error event.
   * Override in subclass for custom error handling.
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    // Log with context - no silent catches
    const errorMessage = error instanceof Error ? error.message : 'Unknown WebSocket error'
    logger.error('WebSocket error:', errorMessage, error)

    // When hibernation is enabled, preserve session for reconnection
    if (this._hibernationManager) {
      this._hibernationManager.handleClose(ws)
    }

    this.websocketManager.cleanupWebSocket(ws)
  }

  /**
   * Handle WebSocket upgrade with optional hibernation and reconnection support.
   *
   * When hibernation is enabled, this creates a session and sends the session.init
   * message to the client. Call this from a route handler:
   *
   * @example
   * ```typescript
   * protected routes(app: Hono): void {
   *   app.get('/ws', (c) => {
   *     const clientId = c.req.query('clientId')
   *     return this.handleWebSocketUpgrade({ clientId })
   *   })
   * }
   * ```
   *
   * @param options - Upgrade options
   * @returns Response with 101 status and WebSocket
   */
  protected handleWebSocketUpgrade(options: {
    /** Optional client identifier for session tracking */
    clientId?: string
    /** Tags for connection filtering */
    tags?: string[]
    /** Whether this connection supports hibernation (default: true if hibernation enabled) */
    hibernatable?: boolean
    /** Additional metadata to attach to the session */
    metadata?: Record<string, unknown>
  } = {}): Response {
    const { clientId, tags = [], hibernatable = !!this._hibernationManager, metadata } = options

    // If hibernation is enabled, use the HibernationManager
    if (this._hibernationManager && hibernatable) {
      const pair = new WebSocketPair()
      const client = pair[0]
      const server = pair[1]

      // Accept with hibernation support
      this._hibernationManager.acceptWebSocket(server, {
        ...(clientId !== undefined && { clientId }),
        tags,
        ...(metadata !== undefined && { metadata }),
      })

      // Create session and send init message for reconnection protocol
      this._hibernationManager.handleNewConnection(server, clientId, metadata)

      return new Response(null, {
        status: 101,
        webSocket: client,
      })
    }

    // Fall back to standard WebSocket upgrade without hibernation
    return this.websocketManager.handleWebSocketUpgrade(
      this.state,
      tags,
      hibernatable,
      clientId
    )
  }

  /**
   * Broadcast an event to all WebSocket connections with sequence tracking.
   *
   * When hibernation is enabled, events include sequence numbers and are
   * buffered for replay on client reconnection.
   *
   * @param eventType - The type of event
   * @param payload - The event payload
   * @param tag - Optional tag to filter recipients
   * @returns Number of messages sent and failed
   */
  protected broadcastEvent(
    eventType: string,
    payload: unknown,
    tag?: string
  ): { sent: number; failed: number } {
    // When hibernation is enabled, use sequence-tracked events
    if (this._hibernationManager) {
      return this._hibernationManager.broadcastEvent(eventType, payload, tag)
    }

    // Fall back to standard broadcast
    return tag
      ? this.websocketManager.broadcast(this.state, tag, { type: eventType, data: payload })
      : this.websocketManager.broadcastAll(this.state, { type: eventType, data: payload })
  }

  /**
   * Send an event to a specific WebSocket with sequence tracking.
   *
   * When hibernation is enabled, the event includes a sequence number and is
   * buffered for replay on client reconnection.
   *
   * @param ws - The WebSocket to send to
   * @param eventType - The type of event
   * @param payload - The event payload
   * @returns true if sent, false on error
   */
  protected sendEvent(ws: WebSocket, eventType: string, payload: unknown): boolean {
    // When hibernation is enabled, use sequence-tracked events
    if (this._hibernationManager) {
      return this._hibernationManager.sendEvent(ws, eventType, payload)
    }

    // Fall back to standard send
    return this.websocketManager.send(ws, { type: eventType, data: payload })
  }
}
