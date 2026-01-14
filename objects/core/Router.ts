/**
 * @module Router
 * @description HTTP routing for Durable Objects
 *
 * Handles Hono app setup, REST routing, MCP handling, and sync engine.
 * Extracted from DOBase.
 */

import { Hono } from 'hono'
import type { UserContext } from '../../types/WorkflowContext'

/**
 * Interface for the Router component
 */
export interface IRouter {
  /** The Hono application instance */
  readonly app: Hono | undefined

  /** Handle an incoming HTTP request */
  handleFetch(request: Request): Promise<Response>

  /** Set the Hono app */
  setApp(app: Hono): void
}

/**
 * Dependencies required by Router
 */
export interface RouterDeps {
  /** Namespace URL */
  ns: string

  /** Type discriminator */
  $type: string

  /** Extract user from request headers */
  extractUser: (request: Request) => UserContext | null

  /** Handle health check */
  handleHealth: () => Response

  /** Handle resolve endpoint */
  handleResolve?: (request: Request) => Promise<Response>

  /** Handle MCP requests */
  handleMcp?: (request: Request) => Promise<Response>

  /** Handle WebSocket upgrade for sync */
  handleWebSocketUpgrade?: (request: Request) => Promise<Response>

  /** Handle REST requests */
  handleRest?: (request: Request) => Promise<Response>

  /** Handle CapnWeb RPC */
  handleCapnWeb?: (request: Request) => Promise<Response>

  /** Check if request is CapnWeb RPC */
  isCapnWebRequest?: (request: Request) => boolean

  /** Derive identity from request */
  deriveIdentity: (request: Request) => void

  /** Set user context */
  setUser: (user: UserContext | null) => void
}

/**
 * Router - Manages HTTP routing for DOs
 *
 * This class encapsulates all HTTP routing logic,
 * allowing it to be composed into DO classes rather than inherited.
 */
export class Router implements IRouter {
  private _app?: Hono
  private readonly deps: RouterDeps

  constructor(deps: RouterDeps) {
    this.deps = deps
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // APP ACCESSORS
  // ═══════════════════════════════════════════════════════════════════════════

  get app(): Hono | undefined {
    return this._app
  }

  setApp(app: Hono): void {
    this._app = app
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REQUEST HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle an incoming HTTP request
   */
  async handleFetch(request: Request): Promise<Response> {
    // Derive identity from request URL (sets ns from hostname subdomain)
    this.deps.deriveIdentity(request)

    // Extract user from X-User-* headers (set by RPC auth middleware)
    const user = this.deps.extractUser(request)
    this.deps.setUser(user)

    // Delegate to internal handler
    return this.handleFetchInternal(request)
  }

  /**
   * Internal fetch handler with routing logic
   */
  private async handleFetchInternal(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Handle WebSocket upgrade for sync
    if (url.pathname === '/sync' && request.headers.get('Upgrade') === 'websocket') {
      if (this.deps.handleWebSocketUpgrade) {
        return this.deps.handleWebSocketUpgrade(request)
      }
      return new Response('WebSocket sync not configured', { status: 501 })
    }

    // Health endpoint
    if (url.pathname === '/health') {
      return this.deps.handleHealth()
    }

    // Resolve endpoint for cross-DO resolution
    if (url.pathname === '/resolve' && this.deps.handleResolve) {
      return this.deps.handleResolve(request)
    }

    // MCP endpoint
    if (url.pathname.startsWith('/mcp') && this.deps.handleMcp) {
      return this.deps.handleMcp(request)
    }

    // CapnWeb RPC
    if (this.deps.isCapnWebRequest?.(request) && this.deps.handleCapnWeb) {
      return this.deps.handleCapnWeb(request)
    }

    // Use Hono app if configured
    if (this._app) {
      return this._app.fetch(request)
    }

    // REST fallback
    if (this.deps.handleRest) {
      return this.deps.handleRest(request)
    }

    // Default: 404 Not Found
    return new Response('Not Found', { status: 404 })
  }
}

/**
 * Factory function to create a Router instance
 */
export function createRouter(deps: RouterDeps): Router {
  return new Router(deps)
}

/**
 * Helper to extract user context from request headers
 */
export function extractUserFromRequest(request: Request): UserContext | null {
  const id = request.headers.get('X-User-ID')
  if (!id) {
    return null
  }

  const user: UserContext = { id }

  const email = request.headers.get('X-User-Email')
  if (email) {
    user.email = email
  }

  const role = request.headers.get('X-User-Role')
  if (role) {
    user.role = role
  }

  return user
}
