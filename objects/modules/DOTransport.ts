/**
 * DOTransport Module - REST, MCP, CapnWeb handlers
 *
 * This module extracts transport-related functionality from DOBase:
 * - fetch() HTTP request routing
 * - handleRestRequest() for REST API
 * - handleMcp() for MCP protocol
 * - handleCapnWebRpc() for Cap'n Web RPC
 * - handleSyncWebSocket() for TanStack DB sync
 * - handleIntrospectRoute() endpoint
 * - SyncEngine for WebSocket broadcasts
 *
 * @module DOTransport
 */

import type { ThingsStore } from '../../db/stores'
import {
  handleCapnWebRpc,
  isCapnWebRequest,
  isInternalMember,
  type CapnWebOptions,
} from '../transport/capnweb-target'
import {
  handleRestRequest,
  handleGetIndex,
  type RestRouterContext,
} from '../transport/rest-router'
import { SyncEngine } from '../transport/sync-engine'
import {
  createMcpHandler,
  type McpSession,
  type McpConfig,
} from '../transport/mcp-server'
import type { UserContext } from '../../types/WorkflowContext'
import type { AuthContext } from '../transport/auth-layer'
import type { DOSchema, VisibilityRole } from '../../types/introspect'

/**
 * Transport context interface for request handling
 */
export interface TransportContext {
  ns: string
  things: ThingsStore
  parent?: string
  nouns: Array<{ noun: string; plural: string }>
  doType: string
  env: Record<string, unknown>
  $mcp?: McpConfig
  handleIntrospect: (authContext?: AuthContext) => Promise<DOSchema>
}

// Re-export TransportContext type
export type { AuthContext }

/**
 * DOTransport - Manages HTTP request routing and protocol handling
 */
export class DOTransport {
  private readonly _context: TransportContext

  // MCP session storage
  private _mcpSessions: Map<string, McpSession> = new Map()

  // Cached MCP handler
  private _mcpHandler?: (
    instance: { ns: string; [key: string]: unknown },
    request: Request,
    sessions: Map<string, McpSession>
  ) => Promise<Response>

  // SyncEngine for WebSocket sync protocol
  _syncEngine?: SyncEngine

  constructor(context: TransportContext) {
    this._context = context
  }

  /**
   * Get the SyncEngine instance (lazy initialized)
   */
  get syncEngine(): SyncEngine {
    if (!this._syncEngine) {
      this._syncEngine = new SyncEngine(this._context.things)
    }
    return this._syncEngine
  }

  /**
   * Check if a method is exposed via RPC.
   * Uses capnweb's isInternalMember to determine if a method should be hidden.
   */
  isRpcExposed(method: string): boolean {
    return !isInternalMember(method)
  }

  /**
   * Handle an incoming HTTP request
   */
  async handleRequest(request: Request, target?: object): Promise<Response> {
    const url = new URL(request.url)

    // Health endpoint
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', ns: this._context.ns })
    }

    // Root endpoint (/) - Cap'n Web RPC or JSON-LD index
    if (url.pathname === '/') {
      // Handle Cap'n Web RPC (POST or WebSocket upgrade)
      if (isCapnWebRequest(request)) {
        return this.handleCapnWebRpc(request, target)
      }

      // GET request - return JSON-LD index with collections
      if (request.method === 'GET') {
        const restCtx = this.getRestRouterContext()
        return handleGetIndex(restCtx, request)
      }

      // Other methods not supported at root
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { 'Allow': 'GET, POST' },
      })
    }

    // Handle /$introspect endpoint for schema discovery
    if (url.pathname === '/$introspect') {
      return this.handleIntrospectRoute(request)
    }

    // Handle /mcp endpoint for MCP transport
    if (url.pathname === '/mcp') {
      return this.handleMcp(request)
    }

    // Handle /sync endpoint for WebSocket sync protocol (TanStack DB)
    if (url.pathname === '/sync') {
      return this.handleSyncWebSocket(request)
    }

    // REST API routes (/:type and /:type/:id)
    const restCtx = this.getRestRouterContext()
    const restResponse = await handleRestRequest(request, restCtx)
    if (restResponse) {
      return restResponse
    }

    // Default: 404 Not Found
    return new Response('Not Found', { status: 404 })
  }

  /**
   * Get REST router context for handling REST API requests
   */
  private getRestRouterContext(): RestRouterContext {
    return {
      things: this._context.things,
      ns: this._context.ns,
      parent: this._context.parent,
      nouns: this._context.nouns,
      doType: this._context.doType,
    }
  }

  /**
   * Handle Cap'n Web RPC requests
   */
  private async handleCapnWebRpc(request: Request, target?: object): Promise<Response> {
    const options: CapnWebOptions = {
      includeStackTraces: this._context.env.ENVIRONMENT !== 'production',
    }
    return handleCapnWebRpc(request, target ?? {}, options)
  }

  /**
   * Handle MCP (Model Context Protocol) requests
   */
  async handleMcp(request: Request): Promise<Response> {
    // Initialize MCP handler if not already done
    if (!this._mcpHandler) {
      const DOClass = {
        $mcp: this._context.$mcp,
        prototype: {},
      }
      this._mcpHandler = createMcpHandler(DOClass as unknown as {
        new (...args: unknown[]): { ns: string; [key: string]: unknown }
        $mcp?: McpConfig
        prototype: Record<string, unknown>
      })
    }

    const instance = { ns: this._context.ns }
    return this._mcpHandler(instance, request, this._mcpSessions)
  }

  /**
   * Handle WebSocket sync requests for TanStack DB integration
   */
  async handleSyncWebSocket(request: Request): Promise<Response> {
    // Check for WebSocket upgrade
    const upgradeHeader = request.headers.get('upgrade')

    if (upgradeHeader?.toLowerCase() !== 'websocket') {
      return Response.json(
        { error: 'WebSocket upgrade required for /sync endpoint' },
        {
          status: 426,
          headers: { 'Upgrade': 'websocket' },
        }
      )
    }

    // Extract token from Sec-WebSocket-Protocol: "capnp-rpc, bearer.{token}"
    const protocols = request.headers.get('Sec-WebSocket-Protocol')
    const token = this.extractBearerTokenFromProtocol(protocols)

    if (!token) {
      return Response.json(
        { error: 'Missing auth token. Use Sec-WebSocket-Protocol: capnp-rpc, bearer.{token}' },
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Validate the token
    let session: { user: UserContext } | null = null
    try {
      session = await this.validateSyncAuthToken(token)
    } catch {
      session = null
    }

    if (!session) {
      return Response.json(
        { error: 'Invalid auth token' },
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Create WebSocket pair
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    // Accept the server side
    server!.accept()

    // Register with sync engine (pass user context for future use)
    this.syncEngine.accept(server!, session.user)

    // Return the client side to the caller with accepted protocol header
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: {
        'Sec-WebSocket-Protocol': 'capnp-rpc',
      },
    })
  }

  /**
   * Extract bearer token from Sec-WebSocket-Protocol header
   */
  extractBearerTokenFromProtocol(protocols: string | null): string | null {
    if (!protocols) {
      return null
    }

    const protocolList = protocols.split(',').map((p) => p.trim())
    const bearerProtocol = protocolList.find((p) => p.startsWith('bearer.'))

    if (!bearerProtocol) {
      return null
    }

    const token = bearerProtocol.slice(7) // Remove 'bearer.' prefix
    return token || null
  }

  /**
   * Validate a sync auth token and return user context
   */
  async validateSyncAuthToken(token: string): Promise<{ user: UserContext } | null> {
    // Default implementation: require a token but don't validate it
    if (!token) {
      return null
    }

    // In production, this should validate the token and extract user info
    return {
      user: {
        id: 'anonymous',
      },
    }
  }

  /**
   * Handle the /$introspect HTTP route
   */
  private async handleIntrospectRoute(request: Request): Promise<Response> {
    // Only allow GET requests
    if (request.method !== 'GET') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }

    // Check for Authorization header
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) {
      return Response.json({ error: 'Authentication required' }, { status: 401 })
    }

    // Parse JWT from Bearer token
    if (!authHeader.startsWith('Bearer ')) {
      return Response.json({ error: 'Invalid authorization header' }, { status: 401 })
    }

    const token = authHeader.slice(7)

    try {
      const parts = token.split('.')
      if (parts.length !== 3) {
        return Response.json({ error: 'Invalid token format' }, { status: 401 })
      }

      const payload = JSON.parse(atob(parts[1]!)) as {
        sub?: string
        email?: string
        name?: string
        roles?: string[]
        permissions?: string[]
        exp?: number
      }

      // Check expiration
      const now = Math.floor(Date.now() / 1000)
      if (payload.exp && payload.exp < now) {
        return Response.json({ error: 'Token expired' }, { status: 401 })
      }

      // Build auth context from JWT claims
      const authContext: AuthContext = {
        authenticated: true,
        user: {
          id: payload.sub || 'anonymous',
          email: payload.email,
          name: payload.name,
          roles: payload.roles || [],
          permissions: payload.permissions || [],
        },
        token: {
          type: 'jwt',
          expiresAt: payload.exp ? new Date(payload.exp * 1000) : new Date(Date.now() + 3600000),
        },
      }

      // Call $introspect with auth context
      const schema = await this._context.handleIntrospect(authContext)
      return Response.json(schema)
    } catch (error) {
      return Response.json({ error: 'Invalid token' }, { status: 401 })
    }
  }
}
