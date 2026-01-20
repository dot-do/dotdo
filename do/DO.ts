// Base DO class - THE Durable Object for Digital Objects
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { WorkflowContext } from './context'
import { EntityManager } from './entities'
import { WebSocketManager } from './websocket'
import type { ThingsStore, EventsStore, RelationshipsStore, QueryBuilder } from '../db'

export interface DOEnv {
  [key: string]: unknown
}

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

  constructor(state: DurableObjectState, env: DOEnv, options: DOOptions = {}) {
    this.state = state
    this.env = env
    this.app = new Hono()
    this.entityManager = new EntityManager()
    this.websocketManager = new WebSocketManager()

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
            return c.json({ error: `Method not found: ${method}` }, 404)
          }
        }

        const fn = current[parts[parts.length - 1]]
        if (typeof fn !== 'function') {
          return c.json({ error: `Method not found: ${method}` }, 404)
        }

        const result = await fn.apply(current, args)
        return c.json(result)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return c.json({ error: message }, 500)
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
  protected routes(app: Hono): void {
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
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    this.websocketManager.cleanupWebSocket(ws)
  }

  /**
   * Handle WebSocket error event
   * Override in subclass for custom error handling
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('[DO] WebSocket error:', error)
    this.websocketManager.cleanupWebSocket(ws)
  }
}
