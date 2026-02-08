/**
 * @dotdo/do - THE Durable Object for Digital Objects
 *
 * This module provides the base DO class that serves as the foundation for building
 * Durable Objects with built-in entity storage, event handling, WebSocket support,
 * and scheduling capabilities.
 *
 * ## Architecture
 *
 * The DO class uses composition over inheritance by delegating to specialized handlers:
 *
 * - **StorageHandler**: Entity management (things, events, relationships)
 * - **RPCHandler**: RPC endpoint handling (/rpc)
 * - **AlarmHandler**: Alarm management and scheduling
 * - **WebSocketHandler**: WebSocket connection management
 *
 * This design reduces the "God Object" anti-pattern while maintaining a clean facade API.
 *
 * @module @dotdo/do
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createContext } from './context'
import type { WorkflowContext } from './context'
import type { ThingsStore, EventsStore, RelationshipsStore, AuditLogStore, AuditContext, QueryBuilder } from '@dotdo/db'
import { IntegrationRegistry } from '@dotdo/integrations'
import { createScopedLogger, LogLevel } from '@dotdo/utils'

// Import handlers for composition
import { StorageHandler } from './handlers/storage'
import { RPCHandler } from './handlers/rpc'
import { WebSocketHandler } from './handlers/websocket'
import { AlarmHandler } from './handlers/alarm'
import { DOHandlerRegistry } from './handlers/registry'

// Import WebSocket event streaming (do-9zknf)
import { createWebSocketEventStreaming } from './websocket-streaming'
import type { WebSocketEventStreaming } from './websocket-streaming'

// Import type generation
import { generateTypes } from './types-gen'
import type { TypeGenOptions, TypeGenResult } from './types-gen'

// Import script interpreter for _eval
import { ScriptInterpreter, createSandboxConsole } from './eval'

// Import auth utilities
import { extractCallerInfoWithVerification } from './auth'
import type { CallerInfo } from './auth'

// Import CORS utilities
import {
  buildHonoCorsOptions,
  isProductionEnvironment,
  DEFAULT_CORS_METHODS,
  DEFAULT_CORS_HEADERS,
  DEFAULT_EXPOSE_HEADERS
} from './utils/cors'

// Import storage limit utilities for paginated list (CF DO list() returns max 1000 keys)
import { StorageGuard } from './storage-limits'

// Import observability for metrics collection
import {
  createDOObservability,
  extractDOContextFromHeaders,
} from '@dotdo/observability'

// Import configuration types from dedicated module
import type {
  EvalOptions,
  EvalLogEntry,
  EvalResult,
  DOEnv,
  CORSOptions,
  DOMetricsConfig,
  DOOptions,
} from './types/config'

// Re-export types for public API compatibility
export type { EvalOptions, EvalLogEntry, EvalResult, DOEnv, CORSOptions, DOMetricsConfig, DOOptions }

const logger = createScopedLogger({ level: LogLevel.INFO, prefix: '[DO]' })

/**
 * The base DO class - THE Durable Object for Digital Objects.
 *
 * DO = Durable Object = Digital Object
 *
 * Uses composition over inheritance by delegating to specialized handlers.
 *
 * ## Cloudflare Durable Object Limits
 *
 * All DOs are subject to the following hard limits:
 * - **128 MB** memory per isolate (exceeding terminates the instance)
 * - **10 GB** persistent storage per DO
 * - **128 KB** max value size per `state.storage.put()` call
 * - **2 KB** max key size
 * - **1000** max entries per `state.storage.list()` call
 * - **128** max keys per batch `get()`/`put()` call
 *
 * Use the {@link StorageGuard} utility to validate storage operations
 * and {@link StorageGuard.paginatedList} for list() calls that may
 * exceed the 1000-entry batch limit.
 *
 * @see https://developers.cloudflare.com/durable-objects/platform/limits/
 * @stable
 * @since 1.0.0
 */
export class DO implements DurableObject {
  protected app: Hono
  protected state: DurableObjectState
  protected env: DOEnv
  protected $!: WorkflowContext
  private routesInitialized = false

  // Handler registry for composition
  private readonly handlers: DOHandlerRegistry

  // Direct handler references for performance
  private readonly storageHandler: StorageHandler
  private readonly rpcHandler: RPCHandler
  private readonly websocketHandler: WebSocketHandler
  private readonly alarmHandler: AlarmHandler

  // WebSocket event streaming for remote $ context subscriptions (do-9zknf)
  private readonly wsEventStreaming: WebSocketEventStreaming

  // Integration registry
  private _integrations: IntegrationRegistry

  // Observability system for metrics, tracing, and logging
  private readonly observability: ReturnType<typeof createDOObservability> | null

  constructor(state: DurableObjectState, env: DOEnv, options: DOOptions = {}) {
    this.state = state
    this.env = env
    this.app = new Hono()

    const debug = options.debug ?? false

    // Initialize observability if metrics are enabled
    this.observability = this.initializeObservability(state, options.metrics)

    // Initialize handler registry
    this.handlers = new DOHandlerRegistry({ debug })

    // Initialize handlers with composition
    this.storageHandler = new StorageHandler()
    this.rpcHandler = new RPCHandler({ debug })
    this.websocketHandler = new WebSocketHandler({ debug })
    this.alarmHandler = new AlarmHandler({ debug })

    // Set state on alarm handler for storage access
    this.alarmHandler.setState(state)

    // Register handlers
    this.handlers.register(this.storageHandler)
    this.handlers.register(this.rpcHandler)
    this.handlers.register(this.websocketHandler)
    this.handlers.register(this.alarmHandler)

    // Initialize integration registry
    this._integrations = new IntegrationRegistry()

    // Initialize WorkflowContext ($) for event handlers, scheduling, and cross-DO RPC
    // Pass onScheduleRegistered callback to trigger alarm scheduling when schedules are registered (do-7td2u.1)
    this.$ = createContext(state, env, {
      onScheduleRegistered: () => {
        // Schedule the next alarm when a schedule is registered
        // This runs asynchronously to avoid blocking the constructor
        this.alarmHandler.scheduleNextAlarm(this.$._schedules).catch((err) => {
          logger.error('Failed to schedule initial alarm:', err)
        })
      },
    })

    // Initialize WebSocket event streaming for remote $ context subscriptions (do-9zknf)
    // This connects the WebSocket manager to the events store for automatic event pushing
    this.wsEventStreaming = createWebSocketEventStreaming(
      this.websocketHandler.getManager(),
      this.storageHandler.events
    )

    // Setup CORS middleware with validation
    this.setupCORS(options.cors)

    // Setup default routes
    this.setupRoutes()
  }

  /**
   * Initialize the observability system based on configuration.
   */
  private initializeObservability(
    state: DurableObjectState,
    metricsConfig?: boolean | DOMetricsConfig
  ): ReturnType<typeof createDOObservability> | null {
    // Metrics disabled by default
    if (!metricsConfig) {
      return null
    }

    // Simple boolean: enable with defaults
    if (metricsConfig === true) {
      return createDOObservability({
        doId: state.id,
        doClassName: this.constructor.name,
        enableMetrics: true,
        enableTracing: true,
        enableLogging: true,
      })
    }

    // Full configuration object
    if (!metricsConfig.enabled) {
      return null
    }

    return createDOObservability({
      serviceName: metricsConfig.serviceName,
      doId: state.id,
      doClassName: this.constructor.name,
      enableMetrics: true,
      enableTracing: metricsConfig.enableTracing ?? true,
      enableLogging: metricsConfig.enableLogging ?? true,
    })
  }

  /**
   * Setup CORS middleware with validation and security warnings
   *
   * @param corsOption - CORS configuration from DOOptions
   */
  private setupCORS(corsOption: boolean | CORSOptions | undefined): void {
    // CORS disabled
    if (corsOption === false) {
      return
    }

    const isProduction = isProductionEnvironment()

    // CORS enabled with default wildcard (backward compatible, but warns in production)
    if (corsOption === true || corsOption === undefined) {
      if (isProduction) {
        logger.warn(
          'CORS is enabled with wildcard origin (*) in production. ' +
          'This is a security risk. Configure explicit allowedOrigins: ' +
          'new DO(state, env, { cors: { allowedOrigins: ["https://your-app.com"] } })'
        )
      }

      this.app.use('/*', cors({
        origin: '*',
        allowMethods: [...DEFAULT_CORS_METHODS],
        allowHeaders: [...DEFAULT_CORS_HEADERS],
        exposeHeaders: [...DEFAULT_EXPOSE_HEADERS],
        credentials: false, // Cannot use credentials with wildcard
        maxAge: 86400
      }))
      return
    }

    // CORS with explicit configuration
    const honoCorsOptions = buildHonoCorsOptions(corsOption, isProduction)

    this.app.use('/*', cors(honoCorsOptions))
  }

  /**
   * Access the handler registry for advanced use cases.
   */
  protected getHandlerRegistry(): DOHandlerRegistry {
    return this.handlers
  }

  // WebSocket manager accessor - delegates to WebSocketHandler
  get ws() {
    return this.websocketHandler.getManager()
  }

  // Integration registry accessor
  get integrations(): IntegrationRegistry {
    return this._integrations
  }

  // Entity store accessors - delegate to StorageHandler
  get things(): ThingsStore {
    return this.storageHandler.things
  }

  get events(): EventsStore {
    return this.storageHandler.events
  }

  get relationships(): RelationshipsStore {
    return this.storageHandler.relationships
  }

  get auditLogs(): AuditLogStore {
    return this.storageHandler.auditLogs
  }

  /**
   * Set the audit context for tracking who performed actions
   * Call this at the start of request handling
   */
  setAuditContext(context: AuditContext): void {
    this.storageHandler.setAuditContext(context)
  }

  /**
   * Get the current audit context
   */
  getAuditContext(): AuditContext {
    return this.storageHandler.getAuditContext()
  }

  query(): QueryBuilder {
    return this.storageHandler.query()
  }

  /**
   * Execute a function within an atomic transaction (do-9mrsg).
   *
   * All store operations (things, events, relationships) performed inside the
   * callback will either all succeed or all be rolled back if an error occurs.
   * If the DO crashes mid-transaction or the callback throws, all changes are
   * reverted to the pre-transaction state.
   *
   * @param fn - The function to execute within the transaction
   * @returns The result of the function
   * @throws TransactionError on failure (changes are rolled back)
   *
   * @example
   * ```typescript
   * // Inside a DO subclass:
   * await this.withTransaction(async () => {
   *   const customer = await this.things.create({ $type: 'Customer', name: 'Alice' })
   *   await this.relationships.add({
   *     subject: customer.$id,
   *     predicate: 'belongs_to',
   *     object: orgId
   *   })
   *   await this.things.update(existingId, { status: 'active' })
   * })
   * ```
   */
  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.storageHandler.withTransaction(fn)
  }

  private setupRoutes() {
    // Health check
    this.app.get('/', (c) => c.json({
      status: 'ok',
      id: this.state.id.toString(),
    }))

    // Delegate RPC routes to RPCHandler
    this.rpcHandler.setupRoutes(this.app, { target: this as unknown as Record<string, unknown> })

    // Storage info
    // Uses paginated list to handle DOs with >1000 keys (CF DO list() limit)
    this.app.get('/info', async (c) => {
      const stored = await StorageGuard.paginatedList(this.state.storage)
      return c.json({
        id: this.state.id.toString(),
        keys: stored.size,
      })
    })
  }

  // Subclasses can override to add routes
  protected routes(_app: Hono): void {
    // Override in subclass
  }

  async fetch(request: Request): Promise<Response> {
    // Allow subclasses to add routes (only once)
    if (!this.routesInitialized) {
      this.routes(this.app)
      this.routesInitialized = true
    }

    // Extract observability context from incoming request headers
    const incomingContext = this.observability
      ? extractDOContextFromHeaders(request.headers)
      : undefined

    // Create request context for tracing and correlation
    const requestContext = this.observability?.createRequestContext(
      incomingContext?.correlationId,
      incomingContext?.traceContext
    )

    // Track the request with metrics if enabled
    const response = this.observability
      ? await this.observability.wrapMethod(
          'fetch',
          async () => this.app.fetch(request),
          requestContext
        )
      : await this.app.fetch(request)

    // Add telemetry headers
    // X-DO-Colo: The Cloudflare colo where this DO instance is located
    const colo = this.getColoFromRequest(request)
    const headers = new Headers(response.headers)
    headers.set('X-DO-Colo', colo)

    // Add correlation ID header for request tracing
    if (requestContext?.correlationId) {
      headers.set('X-Correlation-ID', requestContext.correlationId)
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }

  /**
   * Extract the Cloudflare colo from the request.
   * In production, this comes from request.cf.colo.
   * In local testing (miniflare), returns 'local'.
   */
  private getColoFromRequest(request: Request): string {
    // Cloudflare's cf object contains colo information
    // TypeScript needs the cf property to be typed
    const cf = (request as Request & { cf?: { colo?: string } }).cf
    if (cf?.colo) {
      return cf.colo
    }
    // Fallback for local development/testing
    return 'local'
  }

  // Alarm handler (for scheduling and auto-retry)
  async alarm(): Promise<void> {
    const startTime = Date.now()
    let success = true

    try {
      // Execute alarm processing with optional metrics wrapping
      // Pass fire-and-forget error store for auto-retry integration
      if (this.observability) {
        await this.observability.wrapMethod('alarm', async () => {
          await this.alarmHandler.processAlarm(this.$._schedules, this.$._fireAndForgetErrors)
        })
      } else {
        await this.alarmHandler.processAlarm(this.$._schedules, this.$._fireAndForgetErrors)
      }
    } catch (error) {
      success = false
      logger.error('Alarm execution failed:', error)
      throw error
    } finally {
      if (this.observability) {
        const duration = Date.now() - startTime
        this.observability.trackAlarmExecution(success, duration)
      }
    }
  }

  /**
   * Schedule a one-time alarm to execute a handler after a delay.
   *
   * @param delayMs - Delay in milliseconds before execution
   * @param handler - The handler function to execute
   * @protected
   */
  protected async scheduleOneTimeAlarm(
    delayMs: number,
    handler: () => Promise<void>
  ): Promise<void> {
    await this.alarmHandler.scheduleOneTimeAlarm(delayMs, handler, this.$._schedules)
  }

  /**
   * Clear all alarms (both recurring and one-time).
   * @protected
   */
  protected async clearAllAlarms(): Promise<void> {
    await this.alarmHandler.clearAllAlarms()
  }

  /**
   * RPC handler for type generation
   *
   * Returns TypeScript .d.ts definitions for the DO's interface.
   * Used by SDK/CLI auto-generation tools.
   *
   * @param options - Optional generation options
   * @returns TypeGenResult with types, version, and timestamp
   */
  _types(options?: TypeGenOptions): TypeGenResult {
    return generateTypes(options)
  }

  /**
   * RPC handler for secure code evaluation inside DO context
   *
   * Provides a sandboxed JavaScript execution environment with access to
   * the DO's $ context (things, events, etc). Uses ai-evaluate for isolation.
   *
   * Security:
   * - Requires authentication (worker/user/DO)
   * - Runs in isolated V8 sandbox (no network/filesystem by default)
   * - $ context respects caller permissions
   * - Timeouts enforced to prevent resource exhaustion
   *
   * @param options - Evaluation options (script, module, tests, timeout)
   * @param request - The incoming request (for auth extraction)
   * @returns EvalResult with success, value, logs, error, duration
   *
   * @example
   * ```typescript
   * // Via RPC
   * const result = await doStub._eval({
   *   script: `
   *     const items = await $.things.list();
   *     return items.length;
   *   `
   * });
   * // { success: true, value: 5, logs: [], duration: 12 }
   * ```
   */
  async _eval(options: EvalOptions, request?: Request): Promise<EvalResult> {
    const start = Date.now()
    const logs: EvalLogEntry[] = []
    const timeout = options.timeout ?? 5000

    try {
      // Extract caller info for permission scoping
      let callerInfo: CallerInfo | undefined
      if (request) {
        callerInfo = await extractCallerInfoWithVerification(request)
      }

      // Build the sandboxed $ context with DO stores
      const sandboxContext = this.buildSandboxContext(callerInfo)

      // Create sandboxed console
      const sandboxConsole = createSandboxConsole(logs)

      // Execute the code using the extracted interpreter
      const interpreter = new ScriptInterpreter(timeout)
      const result = await interpreter.execute(options, sandboxContext, sandboxConsole)

      return {
        success: true,
        value: result,
        logs,
        duration: Date.now() - start,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Check if it's a timeout error
      if (errorMessage.includes('Timeout') || errorMessage.includes('timeout')) {
        return {
          success: false,
          logs,
          error: `Timeout: Script execution exceeded ${timeout}ms`,
          duration: Date.now() - start,
        }
      }

      return {
        success: false,
        logs,
        error: errorMessage,
        duration: Date.now() - start,
      }
    }
  }

  /**
   * Build a sandboxed $ context for _eval
   * Provides access to DO stores while respecting caller permissions
   */
  private buildSandboxContext(callerInfo?: CallerInfo): Record<string, unknown> {
    // Create a proxy wrapper around stores that can enforce permissions
    const $ = {
      things: this.things,
      events: this.events,
      relationships: this.relationships,
      // Include caller info for permission-aware code
      caller: callerInfo ? {
        type: callerInfo.type,
        id: callerInfo.id,
        roles: callerInfo.auth?.roles,
        scopes: callerInfo.auth?.scopes,
      } : undefined,
    }

    return { $ }
  }

  // WebSocket handlers - delegate to WebSocketHandler

  /**
   * Handle incoming WebSocket message
   * By default, routes to WebSocketHandler.
   * Also checks for event subscription messages (do-9zknf).
   */
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    const handleMsg = async () => {
      // Check if this is an event subscription message (do-9zknf)
      // Only string messages can be subscription messages
      if (typeof message === 'string' && this.wsEventStreaming.handleMessage(ws, message)) {
        // Message was handled as subscription message, don't process further
        return
      }

      // Otherwise, route to WebSocketHandler for normal message handling
      await this.websocketHandler.handleMessage(ws, message)
    }

    if (this.observability) {
      await this.observability.wrapMethod('webSocketMessage', handleMsg)
    } else {
      await handleMsg()
    }
  }

  /**
   * Handle WebSocket close event
   * By default, cleans up WebSocket tracking
   */
  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    this.websocketHandler.handleClose(ws)

    // Track WebSocket disconnection
    if (this.observability) {
      this.observability.updateWebSocketCount(-1)
    }
  }

  /**
   * Handle WebSocket error event
   * Override in subclass for custom error handling
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    // Log with context - no silent catches
    const errorMessage = error instanceof Error ? error.message : 'Unknown WebSocket error'
    logger.error('WebSocket error:', errorMessage, error)
    this.websocketHandler.handleError(ws, error)

    // Track WebSocket disconnection on error
    if (this.observability) {
      this.observability.updateWebSocketCount(-1)
    }
  }

  /**
   * Track a new WebSocket connection.
   * Call this when accepting a new WebSocket connection.
   *
   * @protected
   */
  protected trackWebSocketConnection(): void {
    if (this.observability) {
      this.observability.updateWebSocketCount(1)
    }
  }

  /**
   * Track a storage operation for metrics.
   * Call this when performing storage operations.
   *
   * @param operation - The operation type ('get', 'put', 'delete', 'list', 'transaction')
   * @param attributes - Optional additional attributes
   * @protected
   */
  protected trackStorageOperation(
    operation: string,
    attributes?: Record<string, string | number | boolean>
  ): void {
    if (this.observability) {
      this.observability.trackStorageOperation(operation, attributes)
    }
  }

  /**
   * Get the collected metrics for export/inspection.
   * Only available when metrics are enabled.
   *
   * @returns Collected metrics or undefined if metrics disabled
   */
  getMetrics(): ReturnType<ReturnType<typeof createDOObservability>['meter']['collect']> | undefined {
    return this.observability?.meter.collect()
  }

  /**
   * Get the WebSocket event streaming manager (do-9zknf).
   *
   * This provides access to the event streaming system for:
   * - Monitoring active subscriptions
   * - Manually pushing events to WebSocket clients
   * - Checking subscription status
   *
   * @returns WebSocketEventStreaming instance
   *
   * @example
   * ```typescript
   * // Get active subscription count
   * const count = this.eventStreaming.getSubscriptionCount()
   *
   * // Check if an event pattern has subscribers
   * if (this.eventStreaming.hasSubscribers('Customer.signup')) {
   *   // Do something
   * }
   * ```
   */
  get eventStreaming(): WebSocketEventStreaming {
    return this.wsEventStreaming
  }
}
