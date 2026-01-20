// Base DO class - THE Durable Object for Digital Objects
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { WorkflowContext } from './context'
import { EntityManager } from './entities'
import { WebSocketManager } from './websocket'
import type { ThingsStore, EventsStore, RelationshipsStore, AuditLogStore, AuditContext, QueryBuilder } from '../db'
import { IntegrationRegistry } from '../integrations'
import { RPCError, NotFoundError, InternalError, serializeUnknownError } from '../rpc/errors'
import type { BatchRPCCall, BatchRPCResult, BatchRPCResponse } from '../rpc/batch-rpc'
import { createLogger } from '../utils/logger'

const logger = createLogger('[DO]')

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

export interface DOOptions {
  cors?: boolean
}

export class DO implements DurableObject {
  protected app: Hono
  protected state: DurableObjectState
  protected env: DOEnv
  protected $!: WorkflowContext
  private routesInitialized = false
  private entityManager: EntityManager
  private websocketManager: WebSocketManager
  private _integrations: IntegrationRegistry

  constructor(state: DurableObjectState, env: DOEnv, options: DOOptions = {}) {
    this.state = state
    this.env = env
    this.app = new Hono()
    this.entityManager = new EntityManager()
    this.websocketManager = new WebSocketManager()
    this._integrations = new IntegrationRegistry()

    // Setup middleware
    if (options.cors !== false) {
      this.app.use('/*', cors())
    }

    // Setup default routes
    this.setupRoutes()
  }

  // WebSocket manager accessor
  get ws(): WebSocketManager {
    return this.websocketManager
  }

  // Integration registry accessor
  get integrations(): IntegrationRegistry {
    return this._integrations
  }

  // Entity store accessors
  get things(): ThingsStore {
    return this.entityManager.things
  }

  get events(): EventsStore {
    return this.entityManager.events
  }

  get relationships(): RelationshipsStore {
    return this.entityManager.relationships
  }

  // Audit logging accessors (do-xebw)
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

  query(): QueryBuilder {
    return this.entityManager.query()
  }

  private setupRoutes() {
    // Health check
    this.app.get('/', (c) => c.json({
      status: 'ok',
      id: this.state.id.toString(),
    }))

    // RPC endpoint
    this.app.post('/rpc', async (c) => {
      try {
        const { method, args } = await c.req.json<{ method: string; args: unknown[] }>()

        // Navigate to method
        const parts = method.split('.')
        let current: any = this

        for (let i = 0; i < parts.length - 1; i++) {
          current = current[parts[i]]
          if (!current) {
            const error = new NotFoundError(`Method not found: ${method}`)
            return c.json(error.toJSON(), error.httpStatus)
          }
        }

        const fn = current[parts[parts.length - 1]]
        if (typeof fn !== 'function') {
          const error = new NotFoundError(`Method not found: ${method}`)
          return c.json(error.toJSON(), error.httpStatus)
        }

        const result = await fn.apply(current, args)
        return c.json(result)
      } catch (error) {
        // Re-throw RPCErrors with proper formatting
        if (error instanceof RPCError) {
          return c.json(error.toJSON(), error.httpStatus)
        }
        // Wrap unknown errors in InternalError
        const wrappedError = InternalError.wrap(error)
        logger.error('RPC error:', error)
        return c.json(wrappedError.toJSON(), wrappedError.httpStatus)
      }
    })

    // Batch RPC endpoint - execute multiple calls in parallel (do-rljr.7)
    this.app.post('/rpc/batch', async (c) => {
      const correlationId = c.req.header('X-Correlation-ID')

      try {
        const { calls } = await c.req.json<{ calls: BatchRPCCall[] }>()

        if (!Array.isArray(calls)) {
          const error = new NotFoundError('Invalid batch request: calls must be an array')
          return c.json(error.toJSON(), error.httpStatus)
        }

        // Execute all calls in parallel
        const results: BatchRPCResult[] = await Promise.all(
          calls.map(async (call, index): Promise<BatchRPCResult> => {
            const callId = call.id ?? `call-${index}`

            try {
              // Navigate to method
              const parts = call.method.split('.')
              let current: any = this

              for (let i = 0; i < parts.length - 1; i++) {
                current = current[parts[i]]
                if (!current) {
                  return {
                    id: callId,
                    error: new NotFoundError(`Method not found: ${call.method}`).toJSON(),
                  }
                }
              }

              const fn = current[parts[parts.length - 1]]
              if (typeof fn !== 'function') {
                return {
                  id: callId,
                  error: new NotFoundError(`Method not found: ${call.method}`).toJSON(),
                }
              }

              const result = await fn.apply(current, call.args ?? [])
              return { id: callId, result }
            } catch (error) {
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
          correlationId: correlationId ?? undefined,
        }

        return c.json(response)
      } catch (error) {
        // Handle request-level errors (e.g., invalid JSON)
        if (error instanceof RPCError) {
          return c.json(error.toJSON(), error.httpStatus)
        }
        const wrappedError = InternalError.wrap(error)
        logger.error('Batch RPC error:', error)
        return c.json(wrappedError.toJSON(), wrappedError.httpStatus)
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

  // WebSocket handlers - Override in subclass for custom behavior

  /**
   * Handle incoming WebSocket message
   * By default, routes to WebSocketManager handlers
   */
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    await this.websocketManager.handleMessage(ws, message)
  }

  /**
   * Handle WebSocket close event
   * By default, cleans up WebSocket tracking
   */
  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    this.websocketManager.cleanupWebSocket(ws)
  }

  /**
   * Handle WebSocket error event
   * Override in subclass for custom error handling
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    // Log with context - no silent catches
    const errorMessage = error instanceof Error ? error.message : 'Unknown WebSocket error'
    logger.error('WebSocket error:', errorMessage, error)
    this.websocketManager.cleanupWebSocket(ws)
  }
}
