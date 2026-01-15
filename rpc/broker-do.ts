/**
 * BrokerDO - Base Class for WebSocket RPC Routing
 *
 * This module provides a base Durable Object class that acts as a broker for
 * routing RPC calls from WebSocket clients to target Durable Objects.
 *
 * Key features:
 * - Hibernatable WebSocket connections for cost efficiency
 * - CallMessage routing to target DOs via resolveTarget()
 * - BatchMessage handling with parallel execution
 * - Capability token forwarding (opaque pass-through)
 * - Graceful error handling with proper error codes
 *
 * Subclasses must implement resolveTarget() to provide target DO resolution.
 */

import { Hono } from 'hono'
import type {
  CallMessage,
  ReturnMessage,
  ErrorMessage,
  BatchMessage,
  BatchReturnMessage,
  BrokerMessage,
} from './broker-protocol'
import { isCallMessage, isBatchMessage } from './broker-protocol'

// =============================================================================
// Types
// =============================================================================

/**
 * Environment type for BrokerDO
 * Subclasses should extend this with their specific DO namespace bindings
 */
export interface BrokerEnv {
  // Subclasses configure worker DO namespaces here
}

/**
 * Interface for target DOs that support RPC calls
 */
export interface RpcTarget {
  rpcCall(method: string, args: unknown[], capability?: string): Promise<unknown>
}

/**
 * Configuration options for BrokerDO
 */
export interface BrokerDOOptions {
  /** Timeout for individual RPC calls in milliseconds (default: 5000) */
  rpcTimeout?: number
  /** Enable debug logging (default: false) */
  debug?: boolean
  /** Enable hibernation recovery with SQLite persistence (default: false) */
  enableHibernationRecovery?: boolean
  /** Timeout for stale in-flight requests in milliseconds (default: 30000) */
  staleRequestTimeout?: number
}

/**
 * Interface for DurableObjectState needed by BrokerDO
 */
export interface BrokerDOState {
  acceptWebSocket(ws: WebSocket, tags?: string[]): void
  getWebSockets(tag?: string): WebSocket[]
}

/**
 * Extended interface for DurableObjectState with hibernation support
 */
export interface HibernationBrokerDOState extends BrokerDOState {
  /** SQLite storage for persistence */
  storage: {
    sql: {
      exec(sql: string, ...params: unknown[]): { toArray(): unknown[] }
    }
  }
  /** Get tags for a WebSocket */
  getTags(ws: WebSocket): string[]
}

/**
 * In-flight request tracking entry
 */
export interface InFlightRequest {
  clientId: string
  startedAt: number
}

// =============================================================================
// BrokerDO Base Class
// =============================================================================

/**
 * Base class for WebSocket RPC brokers.
 *
 * Provides:
 * - WebSocket connection handling with hibernation support
 * - RPC message routing (CallMessage, BatchMessage)
 * - Error handling with proper error codes
 * - Hono router for HTTP/WS endpoints
 *
 * Subclasses must implement:
 * - resolveTarget(target: string): RpcTarget | null
 *
 * This class does NOT extend DurableObject directly to allow for flexible
 * composition and easier testing. Use it as a mixin in your DO class.
 */
export class BrokerDO<E extends BrokerEnv = BrokerEnv> {
  /** Hono router for HTTP endpoints */
  public app: Hono

  /** DurableObject state reference */
  public ctx: BrokerDOState

  /** Environment bindings */
  protected env: E

  /** Configuration options */
  protected options: Required<BrokerDOOptions>

  /** Mock stubs for testing - subclasses can use this */
  public mockStubs: Map<string, RpcTarget> = new Map()

  /** In-flight requests map for hibernation recovery */
  private inFlight: Map<string, InFlightRequest> = new Map()

  /** Stale request timeout in milliseconds */
  private static readonly STALE_TIMEOUT = 30000

  constructor(ctx: BrokerDOState, env: E, options: BrokerDOOptions = {}) {
    this.ctx = ctx
    this.env = env

    this.options = {
      rpcTimeout: options.rpcTimeout ?? 5000,
      debug: options.debug ?? false,
      enableHibernationRecovery: options.enableHibernationRecovery ?? false,
      staleRequestTimeout: options.staleRequestTimeout ?? BrokerDO.STALE_TIMEOUT,
    }

    this.app = new Hono()
    this.registerBrokerRoutes()

    // Initialize SQLite schema if hibernation recovery is enabled
    if (this.options.enableHibernationRecovery) {
      this.initializeHibernationSchema()
    }
  }

  // ===========================================================================
  // Hibernation Recovery
  // ===========================================================================

  /**
   * Initialize SQLite schema for hibernation recovery
   */
  private initializeHibernationSchema(): void {
    const ctx = this.ctx as HibernationBrokerDOState
    if (!ctx.storage?.sql) {
      return
    }

    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS broker_in_flight (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        target TEXT NOT NULL,
        method TEXT NOT NULL,
        args TEXT NOT NULL,
        capability TEXT,
        started_at INTEGER NOT NULL
      )
    `)
  }

  /**
   * Persist an in-flight request to SQLite before forwarding
   */
  private persistInFlight(msg: CallMessage, clientId: string): void {
    if (!this.options.enableHibernationRecovery) {
      return
    }

    const ctx = this.ctx as HibernationBrokerDOState
    if (!ctx.storage?.sql) {
      return
    }

    const startedAt = Date.now()
    ctx.storage.sql.exec(
      `INSERT INTO broker_in_flight (id, client_id, target, method, args, capability, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      msg.id,
      clientId,
      msg.target,
      msg.method,
      JSON.stringify(msg.args),
      msg.capability ?? null,
      startedAt
    )

    // Also track in memory
    this.inFlight.set(msg.id, { clientId, startedAt })
  }

  /**
   * Clear an in-flight request from SQLite after response
   */
  private clearInFlight(id: string): void {
    // Remove from memory
    this.inFlight.delete(id)

    if (!this.options.enableHibernationRecovery) {
      return
    }

    const ctx = this.ctx as HibernationBrokerDOState
    if (!ctx.storage?.sql) {
      return
    }

    ctx.storage.sql.exec('DELETE FROM broker_in_flight WHERE id = ?', id)
  }

  /**
   * Restore in-flight requests from SQLite on wake from hibernation.
   * Cleans up stale requests that have been pending too long.
   */
  private restoreInFlightRequests(): void {
    if (!this.options.enableHibernationRecovery) {
      return
    }

    const ctx = this.ctx as HibernationBrokerDOState
    if (!ctx.storage?.sql) {
      return
    }

    const rows = ctx.storage.sql.exec('SELECT * FROM broker_in_flight').toArray()
    const now = Date.now()
    const staleTimeout = this.options.staleRequestTimeout

    for (const row of rows as Array<Record<string, unknown>>) {
      const startedAt = row.started_at as number
      const id = row.id as string

      if (now - startedAt > staleTimeout) {
        // Clean up stale request
        this.clearInFlight(id)
        if (this.options.debug) {
          console.log(`[BrokerDO] Cleaned up stale in-flight request: ${id}`)
        }
        continue
      }

      // Restore to in-flight map for pending response handling
      this.inFlight.set(id, {
        clientId: row.client_id as string,
        startedAt,
      })
    }
  }

  /**
   * Called when the Durable Object starts (including wake from hibernation).
   * Restores in-flight requests from SQLite.
   */
  async onStart(): Promise<void> {
    this.restoreInFlightRequests()
  }

  /**
   * Get the in-flight requests map (for testing/debugging)
   */
  getInFlightRequests(): Map<string, InFlightRequest> {
    return this.inFlight
  }

  /**
   * Find a WebSocket by client ID tag
   */
  getWebSocketForClient(clientId: string): WebSocket | undefined {
    const ctx = this.ctx as HibernationBrokerDOState
    const sockets = ctx.getWebSockets(clientId)
    return sockets[0]
  }

  // ===========================================================================
  // Abstract Methods (Override in Subclasses)
  // ===========================================================================

  /**
   * Resolve a target string to an RPC-capable object.
   *
   * Override this method in subclasses to implement target resolution logic.
   * Return null if the target cannot be resolved.
   *
   * @param target - Target identifier from the CallMessage
   * @returns RpcTarget or null if not found
   */
  protected resolveTarget(target: string): RpcTarget | null {
    // Check mock stubs first (for testing)
    const mockStub = this.mockStubs.get(target)
    if (mockStub) {
      return mockStub
    }

    // Subclasses implement this to resolve targets to DO stubs
    return null
  }

  /**
   * Add a mock target for testing
   */
  addMockTarget(target: string, stub: RpcTarget): void {
    this.mockStubs.set(target, stub)
  }

  // ===========================================================================
  // Route Registration
  // ===========================================================================

  /**
   * Register broker-specific routes on the Hono app
   */
  protected registerBrokerRoutes(): void {
    // WebSocket upgrade endpoint
    this.app.get('/ws/broker', (c) => {
      const upgradeHeader = c.req.header('Upgrade')
      if (upgradeHeader !== 'websocket') {
        return c.json({ error: 'Upgrade Required' }, 426)
      }

      // Create WebSocket pair
      const [client, server] = Object.values(new WebSocketPair())

      // Generate client ID for tracking
      const clientId = c.req.query('clientId') ?? `client_${crypto.randomUUID().slice(0, 8)}`

      // Accept the WebSocket with hibernation support and tag with client ID
      this.ctx.acceptWebSocket(server, [`client:${clientId}`])

      // Send connected acknowledgment
      server.send(
        JSON.stringify({
          type: 'connected',
          clientId,
          timestamp: Date.now(),
        })
      )

      if (this.options.debug) {
        console.log(`[BrokerDO] Client connected: ${clientId}`)
      }

      return new Response(null, {
        status: 101,
        webSocket: client,
      })
    })

    // Health check endpoint
    this.app.get('/health', (c) => {
      const sockets = this.ctx.getWebSockets()
      return c.json({
        status: 'ok',
        connections: sockets.length,
        timestamp: Date.now(),
      })
    })
  }

  // ===========================================================================
  // HTTP Fetch Handler
  // ===========================================================================

  /**
   * Handle HTTP requests via Hono router
   */
  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request)
  }

  // ===========================================================================
  // WebSocket Message Handling
  // ===========================================================================

  /**
   * Handle incoming WebSocket messages.
   *
   * Called by Cloudflare runtime for hibernatable WebSockets.
   * Parses the message and routes to appropriate handler.
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Parse the message
    let parsed: unknown
    try {
      const messageStr = typeof message === 'string' ? message : new TextDecoder().decode(message)
      parsed = JSON.parse(messageStr)
    } catch (_err) {
      this.sendError(ws, {
        id: 'parse_error',
        error: 'Failed to parse message as JSON',
        code: 'PARSE_ERROR',
      })
      return
    }

    if (this.options.debug) {
      console.log('[BrokerDO] Received message:', parsed)
    }

    // Route based on message type
    if (isCallMessage(parsed)) {
      await this.handleCallMessage(ws, parsed)
    } else if (isBatchMessage(parsed)) {
      await this.handleBatchMessage(ws, parsed)
    } else {
      // Unknown message type
      const msg = parsed as { id?: string; type?: string }
      this.sendError(ws, {
        id: msg.id ?? 'unknown',
        error: `Unknown or invalid message type: ${msg.type}`,
        code: 'INVALID_MESSAGE_TYPE',
      })
    }
  }

  /**
   * Handle a single RPC call message
   */
  private async handleCallMessage(ws: WebSocket, call: CallMessage): Promise<void> {
    // Get client ID from WebSocket tags for hibernation tracking
    const clientId = this.getClientIdFromWebSocket(ws)

    // Persist in-flight request before forwarding (if hibernation recovery enabled)
    if (clientId) {
      this.persistInFlight(call, clientId)
    }

    try {
      const result = await this.forwardCall(call)
      ws.send(JSON.stringify(result))
    } finally {
      // Always clear in-flight request after response (success or error)
      this.clearInFlight(call.id)
    }
  }

  /**
   * Get the client ID from a WebSocket's tags
   */
  private getClientIdFromWebSocket(ws: WebSocket): string | undefined {
    const ctx = this.ctx as HibernationBrokerDOState
    if (!ctx.getTags) {
      return undefined
    }

    const tags = ctx.getTags(ws)
    const clientTag = tags.find((t) => t.startsWith('client:'))
    return clientTag
  }

  /**
   * Handle a batch of RPC calls
   */
  private async handleBatchMessage(ws: WebSocket, batch: BatchMessage): Promise<void> {
    const result = await this.forwardBatch(batch)
    ws.send(JSON.stringify(result))
  }

  // ===========================================================================
  // RPC Forwarding
  // ===========================================================================

  /**
   * Forward a single RPC call to the target DO
   */
  private async forwardCall(call: CallMessage): Promise<ReturnMessage | ErrorMessage> {
    const { id, target, method, args, capability } = call

    // Resolve the target
    const stub = this.resolveTarget(target)
    if (!stub) {
      return {
        id,
        type: 'error',
        error: `Target not found: ${target}`,
        code: 'TARGET_NOT_FOUND',
      }
    }

    try {
      // Create a timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('RPC call timeout')), this.options.rpcTimeout)
      })

      // Execute the RPC call with timeout
      const rpcPromise = stub.rpcCall(method, args, capability)
      const result = await Promise.race([rpcPromise, timeoutPromise])

      return {
        id,
        type: 'return',
        value: result,
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      const isTimeout = errorMessage.toLowerCase().includes('timeout')

      return {
        id,
        type: 'error',
        error: errorMessage,
        code: isTimeout ? 'TIMEOUT' : 'RPC_ERROR',
      }
    }
  }

  /**
   * Forward a batch of RPC calls in parallel
   */
  private async forwardBatch(batch: BatchMessage): Promise<BatchReturnMessage> {
    const { id, calls } = batch

    // Execute all calls in parallel using Promise.all
    const results = await Promise.all(calls.map((call) => this.forwardCall(call)))

    return {
      id,
      type: 'batch_return',
      results,
    }
  }

  // ===========================================================================
  // WebSocket Lifecycle Handlers
  // ===========================================================================

  /**
   * Handle WebSocket close event.
   *
   * Called when a client disconnects. Override in subclasses for custom cleanup.
   */
  webSocketClose(
    _ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean
  ): void {
    if (this.options.debug) {
      console.log(`[BrokerDO] WebSocket closed: code=${code}, reason=${reason}`)
    }
    // Cleanup is handled automatically by Cloudflare runtime
  }

  /**
   * Handle WebSocket error event.
   *
   * Called when an error occurs on the WebSocket. Override for custom handling.
   */
  webSocketError(_ws: WebSocket, error: unknown): void {
    if (this.options.debug) {
      console.error('[BrokerDO] WebSocket error:', error)
    }
    // Log error but don't crash
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Send an error message to a WebSocket client
   */
  private sendError(
    ws: WebSocket,
    error: { id: string; error: string; code: string }
  ): void {
    const errorMsg: ErrorMessage = {
      id: error.id,
      type: 'error',
      error: error.error,
      code: error.code,
    }
    ws.send(JSON.stringify(errorMsg))
  }

  /**
   * Get all connected WebSocket clients
   */
  protected getConnectedClients(tag?: string): WebSocket[] {
    return this.ctx.getWebSockets(tag)
  }

  /**
   * Broadcast a message to all connected clients
   */
  protected broadcastToClients(
    message: BrokerMessage,
    filterTag?: string
  ): { sent: number; failed: number } {
    const sockets = this.getConnectedClients(filterTag)
    let sent = 0
    let failed = 0

    const messageStr = JSON.stringify(message)

    for (const ws of sockets) {
      try {
        ws.send(messageStr)
        sent++
      } catch {
        failed++
      }
    }

    return { sent, failed }
  }
}

