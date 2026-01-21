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
import type { WorkflowContext } from './context'
import type { ThingsStore, EventsStore, RelationshipsStore, AuditLogStore, AuditContext, QueryBuilder } from '../db'
import { IntegrationRegistry } from '../integrations'
import { createLogger } from '../utils/logger'

// Import handlers for composition
import { StorageHandler } from './handlers/storage'
import { RPCHandler } from './handlers/rpc'
import { WebSocketHandler } from './handlers/websocket'
import { DOHandlerRegistry } from './handlers/registry'

const logger = createLogger('[DO]')

export interface DOEnv {
  [key: string]: unknown
}

export interface DOOptions {
  /** Whether to enable CORS middleware. Defaults to true. */
  cors?: boolean
  /** Enable debug logging for handlers */
  debug?: boolean
}

/**
 * The base DO class - THE Durable Object for Digital Objects.
 *
 * DO = Durable Object = Digital Object
 *
 * Uses composition over inheritance by delegating to specialized handlers.
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

  // Integration registry
  private _integrations: IntegrationRegistry

  constructor(state: DurableObjectState, env: DOEnv, options: DOOptions = {}) {
    this.state = state
    this.env = env
    this.app = new Hono()

    const debug = options.debug ?? false

    // Initialize handler registry
    this.handlers = new DOHandlerRegistry({ debug })

    // Initialize handlers with composition
    this.storageHandler = new StorageHandler()
    this.rpcHandler = new RPCHandler({ debug })
    this.websocketHandler = new WebSocketHandler({ debug })

    // Register handlers
    this.handlers.register(this.storageHandler)
    this.handlers.register(this.rpcHandler)
    this.handlers.register(this.websocketHandler)

    // Initialize integration registry
    this._integrations = new IntegrationRegistry()

    // Setup middleware
    if (options.cors !== false) {
      this.app.use('/*', cors())
    }

    // Setup default routes
    this.setupRoutes()
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

  private setupRoutes() {
    // Health check
    this.app.get('/', (c) => c.json({
      status: 'ok',
      id: this.state.id.toString(),
    }))

    // Delegate RPC routes to RPCHandler
    this.rpcHandler.setupRoutes(this.app, { target: this as unknown as Record<string, unknown> })

    // Storage info
    this.app.get('/info', async (c) => {
      const stored = await this.state.storage.list()
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
    return this.app.fetch(request)
  }

  // Alarm handler (for scheduling)
  async alarm(): Promise<void> {
    // Override in subclass or use $ scheduling
  }

  // WebSocket handlers - delegate to WebSocketHandler

  /**
   * Handle incoming WebSocket message
   * By default, routes to WebSocketHandler
   */
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    await this.websocketHandler.handleMessage(ws, message)
  }

  /**
   * Handle WebSocket close event
   * By default, cleans up WebSocket tracking
   */
  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    this.websocketHandler.handleClose(ws)
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
  }
}
