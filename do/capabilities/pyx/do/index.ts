/**
 * PythonModule Durable Object
 *
 * Main Durable Object class for Python execution on Cloudflare Workers.
 * Provides HTTP API for executing Python code with persistent sessions.
 */

import { Hono, type Context, type Next } from 'hono'
import { cors } from 'hono/cors'

import type { ExecResult, PythonBackend } from '../core/backend.js'
import { PyodideBackend, createPyodideBackend } from './pyodide-backend.js'
import {
  SessionManager,
  createSessionManager,
  type SessionState,
  type SnapshotMetadata,
  type DurableObjectStorage,
} from './session.js'

// =============================================================================
// Cloudflare Workers Types (inline to avoid dependency issues)
// =============================================================================

/**
 * Cloudflare Workers Request type
 */
type CFRequest = Request

/**
 * Cloudflare Workers Response type
 */
type CFResponse = Response

/**
 * Durable Object state
 */
interface DurableObjectState {
  storage: DurableObjectStorage
  id: { toString(): string }
  waitUntil(promise: Promise<unknown>): void
}

/**
 * Execution context for workers
 */
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

/**
 * KV Namespace binding
 */
interface KVNamespace {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

/**
 * R2 Bucket binding
 */
interface R2Bucket {
  get(key: string): Promise<R2Object | null>
  put(key: string, value: ReadableStream | ArrayBuffer | string): Promise<R2Object>
  delete(key: string): Promise<void>
}

interface R2Object {
  key: string
  body: ReadableStream
}

// =============================================================================
// Types
// =============================================================================

/**
 * Service binding interface for worker-to-worker communication
 */
interface ServiceBinding {
  fetch(request: Request): Promise<Response>
}

/**
 * Environment bindings for the worker
 */
export interface Env {
  /** Durable Object namespace for Python modules */
  PYTHON_MODULE?: DurableObjectNamespace

  /** KV namespace for caching */
  CACHE?: KVNamespace

  /** R2 bucket for snapshot storage */
  SNAPSHOTS?: R2Bucket

  /** Python module binding (if using Cloudflare's Python binding) */
  PYTHON?: unknown

  /** API key for authentication (optional) */
  API_KEY?: string

  /** FSX service binding for filesystem operations (script storage) */
  FSX?: ServiceBinding

  /** NPMX service binding for package installation */
  NPMX?: ServiceBinding
}

/**
 * Request body for exec endpoint
 */
interface ExecRequest {
  code: string
  timeout?: number
  globals?: Record<string, unknown>
}

/**
 * Request body for session operations
 */
interface SessionRequest {
  packages?: string[]
  metadata?: Record<string, unknown>
}

/**
 * Request body for snapshot operations
 */
interface SnapshotRequest {
  description?: string
}

/**
 * API response wrapper
 */
interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

// =============================================================================
// PythonModule Durable Object
// =============================================================================

/**
 * PythonModule Durable Object
 *
 * Provides:
 * - Stateless Python code execution
 * - Persistent session management
 * - Memory snapshots for fast cold starts
 * - Package installation and management
 */
export class PythonModule {
  private readonly storage: DurableObjectStorage
  private readonly env: Env
  private readonly app: Hono

  private backend: PythonBackend | null = null
  private session: SessionManager | null = null
  private initialized = false

  constructor(state: DurableObjectState, env: Env) {
    this.storage = state.storage
    this.env = env
    this.app = this.createApp()
  }

  /**
   * Handle incoming HTTP requests
   */
  async fetch(request: CFRequest): Promise<CFResponse> {
    // Initialize backend if needed
    if (!this.initialized) {
      await this.initialize()
    }

    // Route through Hono
    return this.app.fetch(request)
  }

  /**
   * Handle WebSocket upgrade for interactive sessions
   */
  async webSocketMessage(
    _ws: WebSocket,
    _message: string | ArrayBuffer
  ): Promise<void> {
    // TODO: Implement WebSocket handling for interactive REPL
  }

  /**
   * Handle WebSocket close
   */
  async webSocketClose(
    _ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean
  ): Promise<void> {
    // Cleanup WebSocket session
  }

  /**
   * Handle scheduled alarms (cleanup, etc.)
   */
  async alarm(): Promise<void> {
    // Cleanup expired sessions
    await this.cleanupExpiredSessions()
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Initialize the Python backend
   */
  private async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    // Create Pyodide backend
    // In production with Cloudflare's Python binding, this would use that instead
    this.backend = createPyodideBackend()

    // Try to initialize (will fail without actual Pyodide runtime)
    try {
      await (this.backend as PyodideBackend).initialize()
    } catch {
      // Expected in development - backend methods will throw until
      // Pyodide runtime is available
    }

    this.initialized = true
  }

  /**
   * Get or create session manager
   */
  private getSessionManager(): SessionManager {
    if (!this.session && this.backend) {
      this.session = createSessionManager(this.storage, this.backend)
    }

    if (!this.session) {
      throw new Error('Session manager not available')
    }

    return this.session
  }

  /**
   * Create Hono app with routes
   */
  private createApp(): Hono {
    const app = new Hono()

    // Middleware
    app.use('*', cors())

    // Optional API key authentication
    if (this.env.API_KEY) {
      app.use('*', async (c: Context, next: Next) => {
        const authHeader = c.req.header('Authorization')
        const apiKey = authHeader?.replace('Bearer ', '')

        if (apiKey !== this.env.API_KEY) {
          return c.json(
            { success: false, error: 'Unauthorized' } satisfies ApiResponse<never>,
            401
          )
        }

        await next()
      })
    }

    // Health check
    app.get('/health', (c: Context) => {
      return c.json({
        success: true,
        data: {
          status: 'ok',
          initialized: this.initialized,
        },
      } satisfies ApiResponse<{ status: string; initialized: boolean }>)
    })

    // ==========================
    // Execution Endpoints
    // ==========================

    /**
     * Execute Python code (stateless)
     * POST /exec
     */
    app.post('/exec', async (c: Context) => {
      try {
        const body = await c.req.json<ExecRequest>()

        if (!body.code) {
          return c.json(
            { success: false, error: 'Missing code field' } satisfies ApiResponse<never>,
            400
          )
        }

        if (!this.backend) {
          return c.json(
            { success: false, error: 'Backend not initialized' } satisfies ApiResponse<never>,
            500
          )
        }

        const result = await this.backend.exec(body.code, {
          timeout: body.timeout,
          globals: body.globals,
        })

        return c.json({
          success: true,
          data: result,
        } satisfies ApiResponse<ExecResult>)
      } catch (err) {
        const error = err as Error
        return c.json(
          { success: false, error: error.message } satisfies ApiResponse<never>,
          500
        )
      }
    })

    // ==========================
    // Session Endpoints
    // ==========================

    /**
     * Create a new session
     * POST /sessions
     */
    app.post('/sessions', async (c: Context) => {
      try {
        const body = await c.req.json<SessionRequest>().catch((): SessionRequest => ({}))

        const sessionManager = this.getSessionManager()
        const state = await sessionManager.init()

        // Install packages if specified
        if (body.packages) {
          for (const pkg of body.packages) {
            await sessionManager.installPackage(pkg)
          }
        }

        return c.json({
          success: true,
          data: state,
        } satisfies ApiResponse<SessionState>)
      } catch (err) {
        const error = err as Error
        return c.json(
          { success: false, error: error.message } satisfies ApiResponse<never>,
          500
        )
      }
    })

    /**
     * Get session state
     * GET /sessions/:id
     */
    app.get('/sessions/:id', async (c: Context) => {
      try {
        const sessionId = c.req.param('id')

        const state = await this.storage.get<SessionState>(`session:${sessionId}`)

        if (!state) {
          return c.json(
            { success: false, error: 'Session not found' } satisfies ApiResponse<never>,
            404
          )
        }

        return c.json({
          success: true,
          data: state,
        } satisfies ApiResponse<SessionState>)
      } catch (err) {
        const error = err as Error
        return c.json(
          { success: false, error: error.message } satisfies ApiResponse<never>,
          500
        )
      }
    })

    /**
     * Execute code in session
     * POST /sessions/:id/exec
     */
    app.post('/sessions/:id/exec', async (c: Context) => {
      try {
        const sessionId = c.req.param('id')
        const body = await c.req.json<ExecRequest>()

        if (!body.code) {
          return c.json(
            { success: false, error: 'Missing code field' } satisfies ApiResponse<never>,
            400
          )
        }

        const sessionManager = this.getSessionManager()
        await sessionManager.init(sessionId)

        if (!sessionManager.isActive()) {
          return c.json(
            { success: false, error: 'Session not active' } satisfies ApiResponse<never>,
            400
          )
        }

        const result = await sessionManager.exec(body.code)

        return c.json({
          success: true,
          data: result,
        } satisfies ApiResponse<ExecResult>)
      } catch (err) {
        const error = err as Error
        return c.json(
          { success: false, error: error.message } satisfies ApiResponse<never>,
          500
        )
      }
    })

    /**
     * Get session variables
     * GET /sessions/:id/variables
     */
    app.get('/sessions/:id/variables', async (c: Context) => {
      try {
        const sessionId = c.req.param('id')

        const sessionManager = this.getSessionManager()
        await sessionManager.init(sessionId)

        if (!sessionManager.isActive()) {
          return c.json(
            { success: false, error: 'Session not active' } satisfies ApiResponse<never>,
            400
          )
        }

        const variables = await sessionManager.getVariables()

        return c.json({
          success: true,
          data: variables,
        } satisfies ApiResponse<Record<string, unknown>>)
      } catch (err) {
        const error = err as Error
        return c.json(
          { success: false, error: error.message } satisfies ApiResponse<never>,
          500
        )
      }
    })

    /**
     * Close session
     * DELETE /sessions/:id
     */
    app.delete('/sessions/:id', async (c: Context) => {
      try {
        const sessionId = c.req.param('id')

        const sessionManager = this.getSessionManager()
        await sessionManager.init(sessionId)
        await sessionManager.close()

        return c.json({
          success: true,
          data: { closed: true },
        } satisfies ApiResponse<{ closed: boolean }>)
      } catch (err) {
        const error = err as Error
        return c.json(
          { success: false, error: error.message } satisfies ApiResponse<never>,
          500
        )
      }
    })

    // ==========================
    // Snapshot Endpoints
    // ==========================

    /**
     * Create a snapshot
     * POST /sessions/:id/snapshots
     */
    app.post('/sessions/:id/snapshots', async (c: Context) => {
      try {
        const sessionId = c.req.param('id')
        const body = await c.req.json<SnapshotRequest>().catch((): SnapshotRequest => ({}))

        const sessionManager = this.getSessionManager()
        await sessionManager.init(sessionId)

        if (!sessionManager.isActive()) {
          return c.json(
            { success: false, error: 'Session not active' } satisfies ApiResponse<never>,
            400
          )
        }

        const metadata = await sessionManager.createSnapshot(body.description)

        return c.json({
          success: true,
          data: metadata,
        } satisfies ApiResponse<SnapshotMetadata>)
      } catch (err) {
        const error = err as Error
        return c.json(
          { success: false, error: error.message } satisfies ApiResponse<never>,
          500
        )
      }
    })

    /**
     * List snapshots for session
     * GET /sessions/:id/snapshots
     */
    app.get('/sessions/:id/snapshots', async (c: Context) => {
      try {
        const sessionId = c.req.param('id')

        const sessionManager = this.getSessionManager()
        await sessionManager.init(sessionId)

        const snapshots = await sessionManager.listSnapshots()

        return c.json({
          success: true,
          data: snapshots,
        } satisfies ApiResponse<SnapshotMetadata[]>)
      } catch (err) {
        const error = err as Error
        return c.json(
          { success: false, error: error.message } satisfies ApiResponse<never>,
          500
        )
      }
    })

    /**
     * Restore from snapshot
     * POST /sessions/:id/snapshots/:snapshotId/restore
     */
    app.post('/sessions/:id/snapshots/:snapshotId/restore', async (c: Context) => {
      try {
        const sessionId = c.req.param('id')
        const snapshotId = c.req.param('snapshotId')

        const sessionManager = this.getSessionManager()
        await sessionManager.init(sessionId)

        await sessionManager.restoreSnapshot(snapshotId)

        return c.json({
          success: true,
          data: { restored: true },
        } satisfies ApiResponse<{ restored: boolean }>)
      } catch (err) {
        const error = err as Error
        return c.json(
          { success: false, error: error.message } satisfies ApiResponse<never>,
          500
        )
      }
    })

    /**
     * Delete snapshot
     * DELETE /sessions/:id/snapshots/:snapshotId
     */
    app.delete('/sessions/:id/snapshots/:snapshotId', async (c: Context) => {
      try {
        const sessionId = c.req.param('id')
        const snapshotId = c.req.param('snapshotId')

        const sessionManager = this.getSessionManager()
        await sessionManager.init(sessionId)

        await sessionManager.deleteSnapshot(snapshotId)

        return c.json({
          success: true,
          data: { deleted: true },
        } satisfies ApiResponse<{ deleted: boolean }>)
      } catch (err) {
        const error = err as Error
        return c.json(
          { success: false, error: error.message } satisfies ApiResponse<never>,
          500
        )
      }
    })

    // ==========================
    // Package Endpoints
    // ==========================

    /**
     * Install package
     * POST /packages
     *
     * If NPMX service is available, uses it for package resolution and caching.
     * Falls back to direct micropip installation via backend.
     */
    app.post('/packages', async (c: Context) => {
      try {
        const body = await c.req.json<{ name: string; version?: string; useNpmx?: boolean }>()

        if (!body.name) {
          return c.json(
            { success: false, error: 'Missing name field' } satisfies ApiResponse<never>,
            400
          )
        }

        // Try NPMX first if available and requested (or by default when available)
        const useNpmx = body.useNpmx !== false && this.env.NPMX !== undefined

        if (useNpmx) {
          try {
            await this.installPackageViaNpmx(body.name, body.version)
            return c.json({
              success: true,
              data: { installed: true, source: 'npmx' },
            } satisfies ApiResponse<{ installed: boolean; source: string }>)
          } catch {
            // Fall through to backend installation
          }
        }

        // Fall back to direct backend installation
        if (!this.backend) {
          return c.json(
            { success: false, error: 'Backend not initialized' } satisfies ApiResponse<never>,
            500
          )
        }

        await this.backend.installPackage(body.name, body.version)

        return c.json({
          success: true,
          data: { installed: true, source: 'micropip' },
        } satisfies ApiResponse<{ installed: boolean; source: string }>)
      } catch (err) {
        const error = err as Error
        return c.json(
          { success: false, error: error.message } satisfies ApiResponse<never>,
          500
        )
      }
    })

    /**
     * Get package info from NPMX
     * GET /packages/:name/info
     */
    app.get('/packages/:name/info', async (c: Context) => {
      try {
        const name = c.req.param('name')
        const info = await this.getPackageInfo(name)

        return c.json({
          success: true,
          data: info,
        } satisfies ApiResponse<Record<string, unknown>>)
      } catch (err) {
        const error = err as Error
        return c.json(
          { success: false, error: error.message } satisfies ApiResponse<never>,
          500
        )
      }
    })

    /**
     * List installed packages
     * GET /packages
     */
    app.get('/packages', async (c: Context) => {
      try {
        if (!this.backend) {
          return c.json(
            { success: false, error: 'Backend not initialized' } satisfies ApiResponse<never>,
            500
          )
        }

        const packages = await this.backend.listPackages()

        return c.json({
          success: true,
          data: packages,
        } satisfies ApiResponse<typeof packages>)
      } catch (err) {
        const error = err as Error
        return c.json(
          { success: false, error: error.message } satisfies ApiResponse<never>,
          500
        )
      }
    })

    // ==========================
    // Script Endpoints (FSX Integration)
    // ==========================

    /**
     * Save a Python script
     * PUT /scripts/:name
     */
    app.put('/scripts/:name', async (c: Context) => {
      try {
        const name = c.req.param('name')
        const content = await c.req.text()

        if (!content) {
          return c.json(
            { success: false, error: 'Missing script content' } satisfies ApiResponse<never>,
            400
          )
        }

        const result = await this.saveScript(name, content)

        return c.json({
          success: true,
          data: result,
        } satisfies ApiResponse<{ path: string }>)
      } catch (err) {
        const error = err as Error
        return c.json(
          { success: false, error: error.message } satisfies ApiResponse<never>,
          500
        )
      }
    })

    /**
     * Get a Python script
     * GET /scripts/:name
     */
    app.get('/scripts/:name', async (c: Context) => {
      try {
        const name = c.req.param('name')
        const content = await this.loadScript(name)

        return c.json({
          success: true,
          data: { name, content },
        } satisfies ApiResponse<{ name: string; content: string }>)
      } catch (err) {
        const error = err as Error
        const status = error.message.includes('not found') ? 404 : 500
        return c.json(
          { success: false, error: error.message } satisfies ApiResponse<never>,
          status
        )
      }
    })

    /**
     * List all saved scripts
     * GET /scripts
     */
    app.get('/scripts', async (c: Context) => {
      try {
        const scripts = await this.listScripts()

        return c.json({
          success: true,
          data: scripts,
        } satisfies ApiResponse<string[]>)
      } catch (err) {
        const error = err as Error
        return c.json(
          { success: false, error: error.message } satisfies ApiResponse<never>,
          500
        )
      }
    })

    /**
     * Delete a Python script
     * DELETE /scripts/:name
     */
    app.delete('/scripts/:name', async (c: Context) => {
      try {
        const name = c.req.param('name')
        await this.deleteScript(name)

        return c.json({
          success: true,
          data: { deleted: true },
        } satisfies ApiResponse<{ deleted: boolean }>)
      } catch (err) {
        const error = err as Error
        return c.json(
          { success: false, error: error.message } satisfies ApiResponse<never>,
          500
        )
      }
    })

    /**
     * Execute a saved script
     * POST /scripts/:name/exec
     */
    app.post('/scripts/:name/exec', async (c: Context) => {
      try {
        const name = c.req.param('name')
        const body = await c.req.json<{ globals?: Record<string, unknown> }>().catch(
          (): { globals?: Record<string, unknown> } => ({})
        )

        // Load script from FSX
        const code = await this.loadScript(name)

        if (!this.backend) {
          return c.json(
            { success: false, error: 'Backend not initialized' } satisfies ApiResponse<never>,
            500
          )
        }

        // Execute the script
        const result = await this.backend.exec(code, { globals: body.globals })

        return c.json({
          success: true,
          data: result,
        } satisfies ApiResponse<ExecResult>)
      } catch (err) {
        const error = err as Error
        const status = error.message.includes('not found') ? 404 : 500
        return c.json(
          { success: false, error: error.message } satisfies ApiResponse<never>,
          status
        )
      }
    })

    // 404 handler
    app.notFound((c: Context) => {
      return c.json(
        { success: false, error: 'Not found' } satisfies ApiResponse<never>,
        404
      )
    })

    // Error handler
    app.onError((err: Error, c: Context) => {
      console.error('Unhandled error:', err)
      return c.json(
        { success: false, error: 'Internal server error' } satisfies ApiResponse<never>,
        500
      )
    })

    return app
  }

  /**
   * Cleanup expired sessions
   */
  private async cleanupExpiredSessions(): Promise<void> {
    const now = Date.now()
    const timeout = 30 * 60 * 1000 // 30 minutes

    // List all sessions
    const entries = await this.storage.list<SessionState>({ prefix: 'session:' })

    for (const [key, session] of entries) {
      // Skip if it's not a main session entry (not snapshots, history, etc.)
      if (key.includes(':snapshots') || key.includes(':history')) {
        continue
      }

      // Check if expired
      if (now - session.lastActivityAt > timeout && !session.closed) {
        // Mark as closed
        session.closed = true
        await this.storage.put(key, session)
      }
    }
  }

  // ===========================================================================
  // FSX Integration (Script Storage)
  // ===========================================================================

  /**
   * Save a Python script to FSX storage
   */
  async saveScript(name: string, content: string): Promise<{ path: string }> {
    if (!this.env.FSX) {
      throw new Error('FSX service binding not configured')
    }

    const path = `/scripts/${name}.py`
    const response = await this.env.FSX.fetch(
      new Request(`https://fsx.internal${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/x-python' },
        body: content,
      })
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to save script: ${error}`)
    }

    return { path }
  }

  /**
   * Load a Python script from FSX storage
   */
  async loadScript(name: string): Promise<string> {
    if (!this.env.FSX) {
      throw new Error('FSX service binding not configured')
    }

    const path = `/scripts/${name}.py`
    const response = await this.env.FSX.fetch(
      new Request(`https://fsx.internal${path}`, {
        method: 'GET',
      })
    )

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Script not found: ${name}`)
      }
      const error = await response.text()
      throw new Error(`Failed to load script: ${error}`)
    }

    return response.text()
  }

  /**
   * Delete a Python script from FSX storage
   */
  async deleteScript(name: string): Promise<void> {
    if (!this.env.FSX) {
      throw new Error('FSX service binding not configured')
    }

    const path = `/scripts/${name}.py`
    const response = await this.env.FSX.fetch(
      new Request(`https://fsx.internal${path}`, {
        method: 'DELETE',
      })
    )

    if (!response.ok && response.status !== 404) {
      const error = await response.text()
      throw new Error(`Failed to delete script: ${error}`)
    }
  }

  /**
   * List all saved Python scripts
   */
  async listScripts(): Promise<string[]> {
    if (!this.env.FSX) {
      throw new Error('FSX service binding not configured')
    }

    const response = await this.env.FSX.fetch(
      new Request('https://fsx.internal/scripts/', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to list scripts: ${error}`)
    }

    const files = await response.json() as string[]
    return files
      .filter((f: string) => f.endsWith('.py'))
      .map((f: string) => f.replace(/\.py$/, ''))
  }

  // ===========================================================================
  // NPMX Integration (Package Installation)
  // ===========================================================================

  /**
   * Install a Python package via NPMX service
   * NPMX provides a unified package manager interface
   */
  async installPackageViaNpmx(name: string, version?: string): Promise<void> {
    if (!this.env.NPMX) {
      throw new Error('NPMX service binding not configured')
    }

    const packageSpec = version ? `${name}@${version}` : name
    const response = await this.env.NPMX.fetch(
      new Request('https://npmx.internal/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          package: packageSpec,
          type: 'python', // Specify Python package ecosystem
        }),
      })
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to install package via NPMX: ${error}`)
    }
  }

  /**
   * Get package info from NPMX
   */
  async getPackageInfo(name: string): Promise<Record<string, unknown>> {
    if (!this.env.NPMX) {
      throw new Error('NPMX service binding not configured')
    }

    const response = await this.env.NPMX.fetch(
      new Request(`https://npmx.internal/info/${name}?type=python`, {
        method: 'GET',
      })
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to get package info: ${error}`)
    }

    return response.json()
  }
}

// =============================================================================
// Worker Entry Point
// =============================================================================

/**
 * Durable Object namespace interface
 */
interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub
}

interface DurableObjectId {
  toString(): string
}

interface DurableObjectStub {
  fetch(request: CFRequest): Promise<CFResponse>
}

/**
 * Worker that routes requests to PythonModule Durable Objects
 */
export default {
  async fetch(
    request: CFRequest,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<CFResponse> {
    const url = new URL(request.url)

    // Extract namespace from URL or headers
    // Default to 'default' for single-tenant usage
    const namespace = url.hostname.split('.')[0] ?? 'default'

    // Get DO stub
    if (!env.PYTHON_MODULE) {
      return new Response('PYTHON_MODULE binding not configured', { status: 500 })
    }

    const id = env.PYTHON_MODULE.idFromName(namespace)
    const stub = env.PYTHON_MODULE.get(id)

    // Forward request to DO
    return stub.fetch(request)
  },
}
