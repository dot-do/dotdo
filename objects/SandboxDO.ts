/**
 * SandboxDO - Durable Object for code execution sandboxes
 *
 * Provides HTTP routes for interacting with Cloudflare Sandbox:
 * - POST /create - Create sandbox session
 * - POST /exec - Execute command
 * - POST /exec/stream - Execute command with SSE streaming
 * - POST /file/write - Write file
 * - GET /file/read - Read file
 * - POST /port/expose - Expose port
 * - GET /ports - List exposed ports
 * - GET /state - Get session state
 * - POST /destroy - Destroy sandbox
 * - GET /terminal - WebSocket terminal upgrade
 *
 * Terminal WebSocket Protocol:
 * Client -> Server:
 *   { type: 'input', data: string }     - Send input to stdin
 *   { type: 'resize', cols: number, rows: number } - Resize terminal
 *   { type: 'execute', command: string } - Execute command
 * Server -> Client:
 *   { type: 'output', data: string }    - stdout output
 *   { type: 'error', data: string }     - stderr output (with ANSI codes)
 *   { type: 'exit', code: number }      - Process exit
 *   { type: 'connected', sessionId: string } - Connection established
 */

import { Hono } from 'hono'
import { DO, type Env } from './DO'
import {
  getSandbox,
  type DotdoSandbox,
  type SandboxConfig,
  type ExecResult,
  type ExposedPort,
} from '../sandbox'

// ============================================================================
// New Session Lifecycle Types
// ============================================================================

export type SessionStatus = 'idle' | 'running' | 'stopped' | 'error'

export interface ExtendedSandboxConfig extends SandboxConfig {
  /** Timeout in milliseconds before session auto-destroys */
  timeoutMs?: number
}

export interface SessionState {
  status: SessionStatus
  sandboxId: string
  config: ExtendedSandboxConfig
  createdAt: Date
  lastActivityAt: Date
  error?: string
}

export interface CreateSessionOptions {
  sandboxId: string
  config?: ExtendedSandboxConfig
}

export interface SandboxEnv extends Env {
  Sandbox?: DurableObjectNamespace
}

// ============================================================================
// Legacy Types (backward compatibility)
// ============================================================================

interface LegacySandboxState {
  status: 'idle' | 'running' | 'stopped'
  exposedPorts: ExposedPort[]
  createdAt: string
}

interface CreateRequest {
  sleepAfter?: string
  keepAlive?: boolean
}

interface ExecRequest {
  command: string
}

interface WriteFileRequest {
  path: string
  content: string
  encoding?: 'utf-8' | 'base64'
}

interface ExposePortRequest {
  port: number
  name?: string
}

// Terminal WebSocket types
interface TerminalMessage {
  type: 'input' | 'resize' | 'execute'
  data?: string
  command?: string
  cols?: number
  rows?: number
}

interface TerminalSession {
  sessionId: string
  clients: Set<WebSocket>
  outputBuffer: RingBuffer
  cols: number
  rows: number
}

// ============================================================================
// Ring Buffer for Output Preservation (64KB max)
// ============================================================================

/**
 * Ring buffer that preserves last 64KB of output for reconnection
 */
class RingBuffer {
  private buffer: string[] = []
  private totalSize = 0
  private readonly maxSize: number

  constructor(maxSize: number = 64 * 1024) {
    this.maxSize = maxSize
  }

  push(data: string): void {
    this.buffer.push(data)
    this.totalSize += data.length

    // Evict oldest entries if over size limit
    while (this.totalSize > this.maxSize && this.buffer.length > 0) {
      const removed = this.buffer.shift()!
      this.totalSize -= removed.length
    }
  }

  getAll(): string {
    return this.buffer.join('')
  }

  clear(): void {
    this.buffer = []
    this.totalSize = 0
  }

  get size(): number {
    return this.totalSize
  }
}

// ============================================================================
// SandboxDO Class
// ============================================================================

export class SandboxDO extends DO<SandboxEnv> {
  static readonly $type = 'Sandbox'

  private sandbox: DotdoSandbox | null = null
  private legacySessionId: string | null = null
  private legacyCreatedAt: string | null = null
  private legacySessionStatus: 'idle' | 'running' | 'stopped' = 'idle'

  // New session state for lifecycle API
  private session: SessionState | null = null

  // Terminal WebSocket state
  private terminalSessions: Map<string, TerminalSession> = new Map()

  protected app: Hono

  constructor(ctx: DurableObjectState, env: SandboxEnv) {
    super(ctx, env)
    this.app = this.createRoutes()
    // Load persisted session on construction
    this.loadSession()
  }

  // --------------------------------------------------------------------------
  // New Session Lifecycle API (TDD)
  // --------------------------------------------------------------------------

  /**
   * Create a new sandbox session
   */
  async create(options: CreateSessionOptions): Promise<SessionState> {
    // Check if Sandbox namespace is configured
    if (!this.env.Sandbox) {
      throw new Error('Sandbox namespace not configured')
    }

    // Check if session already exists
    if (this.session && this.session.status !== 'stopped') {
      throw new Error('Session already exists')
    }

    const { sandboxId, config = {} } = options
    const now = new Date()

    // Create the underlying sandbox
    this.sandbox = getSandbox(
      this.env.Sandbox as unknown as DurableObjectNamespace,
      sandboxId,
      'sandbox.do',
      {
        sleepAfter: config.sleepAfter ?? '10m',
        keepAlive: config.keepAlive ?? false,
        normalizeId: config.normalizeId ?? true,
      }
    )

    // Create session state
    this.session = {
      status: 'running',
      sandboxId,
      config,
      createdAt: now,
      lastActivityAt: now,
    }

    // Update legacy fields for backward compatibility
    this.legacySessionId = sandboxId
    this.legacyCreatedAt = now.toISOString()
    this.legacySessionStatus = 'running'

    // Persist to storage
    await this.persistSession()

    // Schedule timeout alarm if configured
    if (config.timeoutMs) {
      await this.scheduleTimeout(config.timeoutMs)
    }

    // Emit lifecycle event
    await this.emitEvent('sandbox.created', {
      sandboxId,
      config,
    })

    return this.session
  }

  /**
   * Destroy the sandbox session
   */
  async destroy(): Promise<void> {
    if (!this.session || !this.sandbox) {
      throw new Error('No active session')
    }

    const { sandboxId } = this.session

    // Destroy the underlying sandbox
    await this.sandbox.destroy()

    // Update session status
    this.session.status = 'stopped'

    // Emit lifecycle event
    await this.emitEvent('sandbox.destroyed', { sandboxId })

    // Clear session from storage
    await this.ctx.storage.delete('session')

    // Cancel any scheduled alarms
    await this.ctx.storage.deleteAlarm()

    // Clear in-memory state
    this.session = null
    this.sandbox = null
    this.legacySessionId = null
    this.legacySessionStatus = 'stopped'
  }

  /**
   * Get the current session state
   */
  async getState(): Promise<SessionState | null> {
    // Try to load from storage if not in memory
    if (!this.session) {
      await this.loadSession()
    }
    return this.session
  }

  /**
   * Execute a command in the sandbox
   */
  async exec(command: string): Promise<ExecResult> {
    if (!this.session || !this.sandbox) {
      throw new Error('No active session')
    }

    try {
      // Execute the command
      const result = await this.sandbox.exec(command)

      // Update activity timestamp
      await this.updateActivity()

      return result
    } catch (error) {
      // Update session to error state
      this.session.status = 'error'
      this.session.error = error instanceof Error ? error.message : 'Unknown error'
      await this.persistSession()

      // Emit error event
      await this.emitEvent('sandbox.error', {
        sandboxId: this.session.sandboxId,
        error: this.session.error,
      })

      throw error
    }
  }

  /**
   * Handle DO alarm - checks for session timeout
   */
  async alarm(): Promise<void> {
    // Call parent alarm handler first
    await super.alarm()

    if (!this.session) {
      return
    }

    const config = this.session.config
    const timeoutMs = config.timeoutMs

    if (!timeoutMs) {
      return
    }

    // Check if session has timed out
    const now = Date.now()
    const lastActivity = new Date(this.session.lastActivityAt).getTime()
    const elapsed = now - lastActivity

    if (elapsed >= timeoutMs) {
      // Session has timed out - emit event and destroy
      await this.emitEvent('sandbox.timeout', {
        sandboxId: this.session.sandboxId,
        elapsed,
        timeoutMs,
      })

      await this.destroy()
    } else {
      // Reschedule alarm for remaining time
      const remaining = timeoutMs - elapsed
      await this.scheduleTimeout(remaining)
    }
  }

  // --------------------------------------------------------------------------
  // Private Session Helpers
  // --------------------------------------------------------------------------

  /**
   * Load session state from storage
   */
  private async loadSession(): Promise<void> {
    const stored = await this.ctx.storage.get<SessionState>('session')
    if (stored) {
      this.session = stored

      // Update legacy fields for backward compatibility
      this.legacySessionId = stored.sandboxId
      this.legacyCreatedAt = new Date(stored.createdAt).toISOString()
      this.legacySessionStatus = stored.status === 'error' ? 'stopped' : stored.status

      // Recreate sandbox instance if session is running
      if (stored.status === 'running' && this.env.Sandbox) {
        this.sandbox = getSandbox(
          this.env.Sandbox as unknown as DurableObjectNamespace,
          stored.sandboxId,
          'sandbox.do',
          stored.config
        )
      }
    }
  }

  /**
   * Persist session state to storage
   */
  private async persistSession(): Promise<void> {
    if (this.session) {
      await this.ctx.storage.put('session', this.session)
    }
  }

  /**
   * Update last activity timestamp and reschedule timeout
   */
  private async updateActivity(): Promise<void> {
    if (!this.session) {
      return
    }

    this.session.lastActivityAt = new Date()
    await this.persistSession()

    // Reschedule timeout if configured
    if (this.session.config.timeoutMs) {
      await this.scheduleTimeout(this.session.config.timeoutMs)
    }
  }

  /**
   * Schedule a timeout alarm
   */
  private async scheduleTimeout(ms: number): Promise<void> {
    const scheduledTime = Date.now() + ms
    await this.ctx.storage.setAlarm(scheduledTime)
  }

  // --------------------------------------------------------------------------
  // Routes
  // --------------------------------------------------------------------------

  private createRoutes(): Hono {
    const app = new Hono()

    // Error handler middleware
    app.onError((err, c) => {
      console.error('SandboxDO error:', err)
      return c.json({ error: err.message || 'Internal server error' }, 500)
    })

    // JSON body validation middleware for POST requests
    app.use('*', async (c, next) => {
      if (c.req.method === 'POST') {
        const contentType = c.req.header('content-type')
        if (contentType?.includes('application/json')) {
          try {
            // Try to parse JSON body
            const text = await c.req.text()
            if (text) {
              try {
                const body = JSON.parse(text)
                c.set('body', body)
              } catch {
                return c.json({ error: 'Invalid JSON body' }, 400)
              }
            } else {
              c.set('body', {})
            }
          } catch {
            return c.json({ error: 'Failed to read request body' }, 400)
          }
        }
      }
      await next()
    })

    // GET /health - Health check
    app.get('/health', (c) => {
      return c.json({ status: 'ok', ns: this.ns, type: this.$type })
    })

    // --------------------------------------------------------------------------
    // New Session Lifecycle Routes
    // --------------------------------------------------------------------------

    // POST /session - Create sandbox session (new API)
    app.post('/session', async (c) => {
      try {
        const body = c.get('body') as CreateSessionOptions || {}
        // Use provided sandboxId or generate one
        const options: CreateSessionOptions = {
          sandboxId: body.sandboxId || crypto.randomUUID(),
          config: body.config,
        }
        const result = await this.create(options)
        return c.json(result, 201)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create session'
        return c.json({ error: message }, 400)
      }
    })

    // DELETE /session - Destroy sandbox session (new API)
    app.delete('/session', async (c) => {
      try {
        await this.destroy()
        return c.json({ success: true })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to destroy session'
        return c.json({ error: message }, 400)
      }
    })

    // GET /session/state - Get session state (new API)
    app.get('/session/state', async (c) => {
      const state = await this.getState()
      if (!state) {
        return c.json({ error: 'No active session' }, 404)
      }
      return c.json(state)
    })

    // --------------------------------------------------------------------------
    // Legacy Routes (backward compatibility)
    // --------------------------------------------------------------------------

    // POST /create - Create sandbox session (legacy)
    app.post('/create', async (c) => {
      if (this.sandbox !== null) {
        return c.json({ error: 'Session already exists' }, 409)
      }

      const body = c.get('body') as CreateRequest || {}
      const config: ExtendedSandboxConfig = {
        sleepAfter: body.sleepAfter,
        keepAlive: body.keepAlive,
      }

      try {
        const sandboxId = crypto.randomUUID()
        const hostname = new URL(c.req.url).hostname

        this.sandbox = getSandbox(
          this.env.Sandbox as unknown as DurableObjectNamespace,
          sandboxId,
          hostname,
          config
        )

        this.legacySessionId = sandboxId
        this.legacyCreatedAt = new Date().toISOString()
        this.legacySessionStatus = 'running'

        // Also create new session state
        this.session = {
          status: 'running',
          sandboxId,
          config,
          createdAt: new Date(),
          lastActivityAt: new Date(),
        }
        await this.persistSession()

        return c.json({
          sessionId: sandboxId,
          status: 'created',
        })
      } catch (err) {
        this.sandbox = null
        this.legacySessionId = null
        throw err
      }
    })

    // POST /exec - Execute command (uses new API internally)
    app.post('/exec', async (c) => {
      if (!this.sandbox) {
        return c.json({ error: 'No active session' }, 400)
      }

      const body = c.get('body') as ExecRequest || {}
      if (!body.command) {
        return c.json({ error: 'Missing required field: command' }, 400)
      }

      try {
        const result = await this.exec(body.command)
        return c.json(result)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Execution failed'
        return c.json({ error: message }, 500)
      }
    })

    // POST /exec/stream - Execute command with streaming
    app.post('/exec/stream', async (c) => {
      if (!this.sandbox) {
        return c.json({ error: 'No active session' }, 400)
      }

      const body = c.get('body') as ExecRequest || {}
      if (!body.command) {
        return c.json({ error: 'Missing required field: command' }, 400)
      }

      try {
        const stream = await this.sandbox.execStream(body.command)

        return new Response(
          new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder()
              try {
                for await (const event of stream) {
                  const sseData = `data: ${JSON.stringify(event)}\n\n`
                  controller.enqueue(encoder.encode(sseData))
                }
                controller.close()
              } catch (err) {
                controller.error(err)
              }
            },
          }),
          {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            },
          }
        )
      } catch (err) {
        throw err
      }
    })

    // POST /file/write - Write file
    app.post('/file/write', async (c) => {
      if (!this.sandbox) {
        return c.json({ error: 'No active session' }, 400)
      }

      const body = c.get('body') as WriteFileRequest || {}
      if (!body.path) {
        return c.json({ error: 'Missing required field: path' }, 400)
      }
      if (body.content === undefined || body.content === null) {
        return c.json({ error: 'Missing required field: content' }, 400)
      }

      try {
        await this.sandbox.writeFile(body.path, body.content, {
          encoding: body.encoding || 'utf-8',
        })
        return c.json({ success: true })
      } catch (err) {
        throw err
      }
    })

    // GET /file/read - Read file
    app.get('/file/read', async (c) => {
      if (!this.sandbox) {
        return c.json({ error: 'No active session' }, 400)
      }

      const path = c.req.query('path')
      if (!path) {
        return c.json({ error: 'Missing required query parameter: path' }, 400)
      }

      try {
        const result = await this.sandbox.readFile(path)
        return c.json(result)
      } catch (err) {
        if (err instanceof Error && err.message.includes('not found')) {
          return c.json({ error: 'File not found' }, 404)
        }
        throw err
      }
    })

    // POST /port/expose - Expose port
    app.post('/port/expose', async (c) => {
      if (!this.sandbox) {
        return c.json({ error: 'No active session' }, 400)
      }

      const body = c.get('body') as ExposePortRequest || {}
      if (body.port === undefined || body.port === null) {
        return c.json({ error: 'Missing required field: port' }, 400)
      }
      if (typeof body.port !== 'number' || body.port < 1 || body.port > 65535) {
        return c.json({ error: 'Invalid port number' }, 400)
      }

      try {
        const result = await this.sandbox.exposePort(body.port, {
          name: body.name,
        })
        return c.json(result)
      } catch (err) {
        throw err
      }
    })

    // GET /ports - List exposed ports
    app.get('/ports', async (c) => {
      if (!this.sandbox) {
        return c.json({ error: 'No active session' }, 400)
      }

      try {
        const ports = await this.sandbox.getExposedPorts()
        return c.json(ports)
      } catch (err) {
        throw err
      }
    })

    // GET /state - Get session state (legacy)
    app.get('/state', async (c) => {
      const state: LegacySandboxState = {
        status: this.legacySessionStatus,
        exposedPorts: [],
        createdAt: this.legacyCreatedAt || '',
      }

      if (this.sandbox && this.legacySessionStatus === 'running') {
        try {
          state.exposedPorts = await this.sandbox.getExposedPorts()
        } catch {
          // Ignore errors getting ports
        }
      }

      return c.json(state)
    })

    // POST /destroy - Destroy sandbox (legacy)
    app.post('/destroy', async (c) => {
      if (!this.sandbox) {
        return c.json({ error: 'No active session' }, 400)
      }

      try {
        await this.sandbox.destroy()
        this.sandbox = null
        this.legacySessionId = null
        this.legacySessionStatus = 'stopped'
        this.session = null
        await this.ctx.storage.delete('session')
        return c.json({ success: true })
      } catch (err) {
        throw err
      }
    })

    // GET /terminal - WebSocket upgrade
    // Note: WebSocket upgrade is handled in fetch() method, not via Hono
    app.get('/terminal', async (c) => {
      if (!this.sandbox) {
        return c.json({ error: 'No active session' }, 400)
      }

      const upgradeHeader = c.req.header('Upgrade')
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return c.json({ error: 'WebSocket upgrade required' }, 426)
      }

      // WebSocket handling is done in fetch() method before routing to Hono
      // This should not be reached for valid WebSocket requests
      return c.json({ error: 'WebSocket upgrade required' }, 426)
    })

    // Method not allowed handler for known routes
    app.all('/create', (c) => c.json({ error: 'Method not allowed' }, 405))
    app.all('/exec', (c) => c.json({ error: 'Method not allowed' }, 405))
    app.all('/exec/stream', (c) => c.json({ error: 'Method not allowed' }, 405))
    app.all('/file/write', (c) => c.json({ error: 'Method not allowed' }, 405))
    app.all('/file/read', (c) => c.json({ error: 'Method not allowed' }, 405))
    app.all('/port/expose', (c) => c.json({ error: 'Method not allowed' }, 405))
    app.all('/ports', (c) => c.json({ error: 'Method not allowed' }, 405))
    app.all('/destroy', (c) => c.json({ error: 'Method not allowed' }, 405))
    app.all('/terminal', (c) => c.json({ error: 'Method not allowed' }, 405))

    // 404 handler
    app.notFound((c) => c.json({ error: 'Not found' }, 404))

    return app
  }

  // --------------------------------------------------------------------------
  // Fetch Handler
  // --------------------------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    // Check for WebSocket upgrade on /terminal path
    const url = new URL(request.url)
    if (url.pathname === '/terminal' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      return this.handleTerminalWebSocket(request)
    }

    return this.app.fetch(request, this.env)
  }

  // --------------------------------------------------------------------------
  // Terminal WebSocket Handling
  // --------------------------------------------------------------------------

  /**
   * Handle WebSocket upgrade for terminal connections
   */
  private handleTerminalWebSocket(request: Request): Response {
    if (!this.sandbox) {
      return new Response(JSON.stringify({ error: 'No active session' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Create WebSocket pair
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    // Accept the server socket
    server.accept()

    // Generate terminal session ID
    const terminalSessionId = crypto.randomUUID()

    // Get initial dimensions from query params
    const url = new URL(request.url)
    const cols = parseInt(url.searchParams.get('cols') || '80', 10)
    const rows = parseInt(url.searchParams.get('rows') || '24', 10)

    // Create terminal session
    const session: TerminalSession = {
      sessionId: terminalSessionId,
      clients: new Set([server]),
      outputBuffer: new RingBuffer(64 * 1024), // 64KB buffer
      cols: Math.max(1, cols),
      rows: Math.max(1, rows),
    }
    this.terminalSessions.set(terminalSessionId, session)

    // Send connected message
    server.send(JSON.stringify({
      type: 'connected',
      sessionId: terminalSessionId,
    }))

    // Send buffered output for reconnection (if any)
    const bufferedOutput = session.outputBuffer.getAll()
    if (bufferedOutput) {
      server.send(JSON.stringify({
        type: 'output',
        data: bufferedOutput,
      }))
    }

    // Handle incoming messages
    server.addEventListener('message', async (event) => {
      try {
        const msg = JSON.parse(event.data as string) as TerminalMessage
        await this.handleTerminalMessage(session, server, msg)
      } catch (e) {
        server.send(JSON.stringify({
          type: 'error',
          data: `\x1b[31mError: ${(e as Error).message}\x1b[0m`,
        }))
      }
    })

    // Handle close
    server.addEventListener('close', () => {
      session.clients.delete(server)
      // Don't destroy session on disconnect - keep for reconnection
    })

    // Handle error
    server.addEventListener('error', () => {
      session.clients.delete(server)
    })

    // Return WebSocket upgrade response (Cloudflare Workers specific)
    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  /**
   * Handle incoming terminal WebSocket message
   */
  private async handleTerminalMessage(
    session: TerminalSession,
    client: WebSocket,
    msg: TerminalMessage
  ): Promise<void> {
    switch (msg.type) {
      case 'input':
        // Input is handled by exec/execStream
        // In a full PTY implementation, this would go to stdin
        break

      case 'execute':
        if (msg.command) {
          await this.executeTerminalCommand(session, msg.command)
        }
        break

      case 'resize':
        if (msg.cols && msg.rows && msg.cols > 0 && msg.rows > 0) {
          session.cols = msg.cols
          session.rows = msg.rows
          // In real implementation, would send SIGWINCH to process
        }
        break
    }
  }

  /**
   * Execute a command in the sandbox and stream output to terminal clients
   */
  private async executeTerminalCommand(session: TerminalSession, command: string): Promise<void> {
    if (!this.sandbox) {
      this.broadcastToTerminal(session, {
        type: 'error',
        data: '\x1b[31mNo active sandbox session\x1b[0m',
      })
      return
    }

    try {
      // Use execStream for streaming output
      const stream = await this.sandbox.execStream(command)

      for await (const event of stream) {
        let message: { type: string; data?: string; code?: number }

        switch (event.type) {
          case 'stdout':
            message = { type: 'output', data: event.data }
            // Buffer output for reconnection
            if (event.data) {
              session.outputBuffer.push(event.data)
            }
            break

          case 'stderr':
            // Include ANSI color codes for errors (red)
            const errorData = `\x1b[31m${event.data}\x1b[0m`
            message = { type: 'error', data: errorData }
            // Buffer error output too
            if (event.data) {
              session.outputBuffer.push(errorData)
            }
            break

          case 'complete':
            message = { type: 'exit', code: event.exitCode ?? 0 }
            break

          case 'error':
            const errMessage = `\x1b[31m${event.message}\x1b[0m`
            message = { type: 'error', data: errMessage }
            break

          default:
            continue
        }

        // Broadcast to all connected clients
        this.broadcastToTerminal(session, message)
      }
    } catch (error) {
      this.broadcastToTerminal(session, {
        type: 'error',
        data: `\x1b[31mExecution error: ${(error as Error).message}\x1b[0m`,
      })
    }
  }

  /**
   * Broadcast message to all clients in a terminal session
   */
  private broadcastToTerminal(session: TerminalSession, message: unknown): void {
    const data = JSON.stringify(message)
    for (const client of session.clients) {
      try {
        client.send(data)
      } catch {
        // Client disconnected, will be removed on close event
      }
    }
  }

  /**
   * Get terminal session by ID (for testing)
   */
  getTerminalSession(sessionId: string): TerminalSession | undefined {
    return this.terminalSessions.get(sessionId)
  }
}

export default SandboxDO
