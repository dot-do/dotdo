/**
 * bashx.do Worker Entry Point
 *
 * Durable Object-based shell execution service with:
 * - AST-based command safety analysis
 * - Tiered execution (native, RPC, loader, sandbox)
 * - FsCapability integration via FSX service binding
 * - Extends dotdo's DO for AI capabilities and WorkflowContext
 *
 * @example
 * ```typescript
 * // RPC call
 * const response = await fetch(doStub, {
 *   method: 'POST',
 *   body: JSON.stringify({
 *     method: 'exec',
 *     params: { command: 'ls', args: ['-la'] }
 *   })
 * })
 * ```
 *
 * @module bashx/do/worker
 */

import { DurableObject } from 'cloudflare:workers'
import { Hono } from 'hono'
import { BashModule, TieredExecutor, type BashExecutor } from './index.js'
import type { BashResult, ExecOptions, FsCapability, TypedFsCapability } from '../types.js'
import { asTypedFs } from '../types.js'
import {
  TerminalRenderer,
  StreamingRenderer,
  createWebSocketCallback,
  type RenderTier,
} from './terminal-renderer.js'
import { AIGenerator, type AIGeneratorResult, type AIGeneratorOptions } from './ai-generator.js'
import { ErrorHandler } from '../errors/error-handler.js'
import { toContentfulStatus } from './utils/http.js'

// ============================================================================
// DOTDO INTEGRATION TYPES
// ============================================================================

/**
 * Import dotdo's DO class and withBash mixin dynamically.
 * This allows the module to work even if dotdo isn't available,
 * falling back to plain DurableObject.
 *
 * When dotdo is available, ShellDO will extend from withBash(DO, {...})
 * which provides:
 * - $.bash capability via bashx's TieredExecutor
 * - WorkflowContext ($) with event handlers and scheduling
 * - AI agent integration
 */
let DotdoDO: typeof DurableObject | null = null
let dotdoWithBash: ((base: typeof DurableObject, config: unknown) => typeof DurableObject) | null = null

try {
  // Attempt to load dotdo - will succeed if installed
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dotdo = require('dotdo') as {
    DO: typeof DurableObject
    withBash: (base: typeof DurableObject, config: unknown) => typeof DurableObject
  }
  DotdoDO = dotdo.DO
  dotdoWithBash = dotdo.withBash
} catch {
  // dotdo not available, will use plain DurableObject
}

// ============================================================================
// ENVIRONMENT TYPES
// ============================================================================

/**
 * Environment bindings for bashx-do
 */
export interface Env {
  /** Self-binding for ShellDO */
  BASHX: DurableObjectNamespace

  /** Service binding to fsx-do for filesystem operations (optional for tests) */
  FSX?: Fetcher

  /** Service binding to gitx-do for git operations (Tier 2) */
  GITX?: Fetcher

  /** Optional: Container service for Tier 4 sandbox execution */
  CONTAINER?: Fetcher

  /** Optional: AI binding for natural language command generation */
  AI?: Ai

  /** Optional: KV namespace for caching */
  KV?: KVNamespace

  /** Optional: R2 bucket for file storage */
  R2?: R2Bucket

  /** Allow additional dotdo-compatible bindings */
  [key: string]: unknown
}

// ============================================================================
// FSX SERVICE ADAPTER
// ============================================================================

/**
 * Partial implementation of FsCapability for FSX service binding.
 *
 * This allows BashModule to use native file operations via the FSX service
 * for commands like cat, ls, head, tail, etc.
 *
 * Note: This is a partial implementation - additional methods can be added as needed.
 */
class FsxServiceAdapter {
  constructor(private readonly fsx: Fetcher) {}

  async read(
    path: string,
    options?: { encoding?: string; start?: number; end?: number }
  ): Promise<string | Uint8Array> {
    const response = await this.fsx.fetch('https://fsx.do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'readFile',
        params: { path, encoding: options?.encoding },
      }),
    })

    if (!response.ok) {
      const error = await response.json() as { code?: string; message?: string }
      throw Object.assign(new Error(error.message || 'Read failed'), { code: error.code })
    }

    const result = await response.json() as { data: string | number[] }

    if (options?.encoding === 'utf-8' || options?.encoding === 'utf8') {
      return result.data as string
    }

    // Binary data comes as number array, convert to Uint8Array
    if (Array.isArray(result.data)) {
      return new Uint8Array(result.data)
    }

    return result.data as string
  }

  async write(
    path: string,
    data: string | Uint8Array,
    options?: { mode?: number; flag?: string }
  ): Promise<void> {
    const response = await this.fsx.fetch('https://fsx.do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'writeFile',
        params: { path, data, ...options },
      }),
    })

    if (!response.ok) {
      const error = await response.json() as { code?: string; message?: string }
      throw Object.assign(new Error(error.message || 'Write failed'), { code: error.code })
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path)
      return true
    } catch {
      return false
    }
  }

  async stat(path: string): Promise<{
    size: number
    mode: number
    atime: Date
    mtime: Date
    ctime: Date
    birthtime: Date
    isFile(): boolean
    isDirectory(): boolean
  }> {
    const response = await this.fsx.fetch('https://fsx.do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'stat',
        params: { path },
      }),
    })

    if (!response.ok) {
      const error = await response.json() as { code?: string; message?: string }
      throw Object.assign(new Error(error.message || 'Stat failed'), { code: error.code })
    }

    const result = await response.json() as {
      size: number
      mode: number
      mtime: number
      ctime: number
      atime?: number
      birthtime?: number
    }

    // Mode bits: S_IFDIR = 0o40000
    const isDir = (result.mode & 0o40000) === 0o40000
    const now = Date.now()

    return {
      size: result.size,
      mode: result.mode,
      atime: new Date(result.atime ?? result.mtime ?? now),
      mtime: new Date(result.mtime ?? now),
      ctime: new Date(result.ctime ?? result.mtime ?? now),
      birthtime: new Date(result.birthtime ?? result.ctime ?? result.mtime ?? now),
      isFile: () => !isDir,
      isDirectory: () => isDir,
    }
  }

  async list(
    path: string,
    options?: { withFileTypes?: boolean; recursive?: boolean }
  ): Promise<Array<string | { name: string; path?: string; isDirectory(): boolean; isFile(): boolean }>> {
    const response = await this.fsx.fetch('https://fsx.do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'readdir',
        params: { path, withFileTypes: options?.withFileTypes, recursive: options?.recursive },
      }),
    })

    if (!response.ok) {
      const error = await response.json() as { code?: string; message?: string }
      throw Object.assign(new Error(error.message || 'List failed'), { code: error.code })
    }

    const result = await response.json() as {
      entries: Array<string | { name: string; path?: string; type: string }>
    }

    if (options?.withFileTypes) {
      return (result.entries as Array<{ name: string; path?: string; type: string }>).map((e) => ({
        name: e.name,
        path: e.path,
        isDirectory: () => e.type === 'directory',
        isFile: () => e.type === 'file',
      }))
    }

    return result.entries as string[]
  }

  async unlink(path: string): Promise<void> {
    const response = await this.fsx.fetch('https://fsx.do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'unlink',
        params: { path },
      }),
    })

    if (!response.ok) {
      const error = await response.json() as { code?: string; message?: string }
      throw Object.assign(new Error(error.message || 'Unlink failed'), { code: error.code })
    }
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const response = await this.fsx.fetch('https://fsx.do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'mkdir',
        params: { path, ...options },
      }),
    })

    if (!response.ok) {
      const error = await response.json() as { code?: string; message?: string }
      throw Object.assign(new Error(error.message || 'Mkdir failed'), { code: error.code })
    }
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const response = await this.fsx.fetch('https://fsx.do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'rmdir',
        params: { path, ...options },
      }),
    })

    if (!response.ok) {
      const error = await response.json() as { code?: string; message?: string }
      throw Object.assign(new Error(error.message || 'Rmdir failed'), { code: error.code })
    }
  }

  /**
   * Remove a file or directory (rm command support)
   */
  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const response = await this.fsx.fetch('https://fsx.do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'rm',
        params: { path, ...options },
      }),
    })

    if (!response.ok) {
      const error = await response.json() as { code?: string; message?: string }
      // If force option is set and file doesn't exist, don't throw
      if (options?.force && error.code === 'ENOENT') {
        return
      }
      throw Object.assign(new Error(error.message || 'Rm failed'), { code: error.code })
    }
  }

  /**
   * Copy a file (cp command support)
   */
  async copyFile(src: string, dest: string, options?: { recursive?: boolean }): Promise<void> {
    const response = await this.fsx.fetch('https://fsx.do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'copyFile',
        params: { src, dest, ...options },
      }),
    })

    if (!response.ok) {
      const error = await response.json() as { code?: string; message?: string }
      throw Object.assign(new Error(error.message || 'Copy failed'), { code: error.code })
    }
  }

  /**
   * Rename/move a file or directory (mv command support)
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    const response = await this.fsx.fetch('https://fsx.do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'rename',
        params: { oldPath, newPath },
      }),
    })

    if (!response.ok) {
      const error = await response.json() as { code?: string; message?: string }
      throw Object.assign(new Error(error.message || 'Rename failed'), { code: error.code })
    }
  }

  /**
   * Update file timestamps (touch command support)
   */
  async utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void> {
    const response = await this.fsx.fetch('https://fsx.do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'utimes',
        params: {
          path,
          atime: atime instanceof Date ? atime.getTime() : atime,
          mtime: mtime instanceof Date ? mtime.getTime() : mtime,
        },
      }),
    })

    if (!response.ok) {
      const error = await response.json() as { code?: string; message?: string }
      throw Object.assign(new Error(error.message || 'Utimes failed'), { code: error.code })
    }
  }

  /**
   * Truncate a file to specified length (truncate command support)
   */
  async truncate(path: string, len?: number): Promise<void> {
    const response = await this.fsx.fetch('https://fsx.do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'truncate',
        params: { path, length: len ?? 0 },
      }),
    })

    if (!response.ok) {
      const error = await response.json() as { code?: string; message?: string }
      throw Object.assign(new Error(error.message || 'Truncate failed'), { code: error.code })
    }
  }

  /**
   * Read symbolic link target (readlink command support)
   */
  async readlink(path: string): Promise<string> {
    const response = await this.fsx.fetch('https://fsx.do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'readlink',
        params: { path },
      }),
    })

    if (!response.ok) {
      const error = await response.json() as { code?: string; message?: string }
      throw Object.assign(new Error(error.message || 'Readlink failed'), { code: error.code })
    }

    const result = await response.json() as { target: string }
    return result.target
  }

  /**
   * Create symbolic link (ln -s command support)
   */
  async symlink(target: string, path: string): Promise<void> {
    const response = await this.fsx.fetch('https://fsx.do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'symlink',
        params: { target, path },
      }),
    })

    if (!response.ok) {
      const error = await response.json() as { code?: string; message?: string }
      throw Object.assign(new Error(error.message || 'Symlink failed'), { code: error.code })
    }
  }

  /**
   * Create hard link (ln command support)
   */
  async link(existingPath: string, newPath: string): Promise<void> {
    const response = await this.fsx.fetch('https://fsx.do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'link',
        params: { existingPath, newPath },
      }),
    })

    if (!response.ok) {
      const error = await response.json() as { code?: string; message?: string }
      throw Object.assign(new Error(error.message || 'Link failed'), { code: error.code })
    }
  }

  /**
   * Change file permissions (chmod command support)
   */
  async chmod(path: string, mode: number): Promise<void> {
    const response = await this.fsx.fetch('https://fsx.do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'chmod',
        params: { path, mode },
      }),
    })

    if (!response.ok) {
      const error = await response.json() as { code?: string; message?: string }
      throw Object.assign(new Error(error.message || 'Chmod failed'), { code: error.code })
    }
  }

  /**
   * Change file ownership (chown command support)
   */
  async chown(path: string, uid: number, gid: number): Promise<void> {
    const response = await this.fsx.fetch('https://fsx.do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'chown',
        params: { path, uid, gid },
      }),
    })

    if (!response.ok) {
      const error = await response.json() as { code?: string; message?: string }
      throw Object.assign(new Error(error.message || 'Chown failed'), { code: error.code })
    }
  }
}

// ============================================================================
// SHELL DURABLE OBJECT BASE CLASS
// ============================================================================

/**
 * Create the base class for ShellDO.
 *
 * When dotdo is available, this uses withBash(DO, {...}) which provides:
 * - $.bash capability via bashx's TieredExecutor
 * - WorkflowContext ($) with event handlers and scheduling
 * - AI agent integration
 *
 * When dotdo is not available, falls back to plain DurableObject.
 */
function createShellDOBase(): typeof DurableObject<Env> {
  // If dotdo is available, use withBash mixin
  if (DotdoDO && dotdoWithBash) {
    return dotdoWithBash(DotdoDO as typeof DurableObject, {
      executor: (instance: { env: Env }): BashExecutor => {
        // Create FSX adapter for native file operations
        const fsAdapter = instance.env.FSX ? new FsxServiceAdapter(instance.env.FSX) : null
        const fs = fsAdapter ? asTypedFs(fsAdapter) : undefined

        // Create and return TieredExecutor as the bash executor
        return createExecutor(instance.env, fs)
      },
      fs: (instance: { env: Env }) => {
        // Provide FsCapability from FSX service if available
        if (instance.env.FSX) {
          return new FsxServiceAdapter(instance.env.FSX)
        }
        return undefined
      },
      useNativeOps: true,
    }) as typeof DurableObject<Env>
  }

  // Fallback to plain DurableObject
  return DurableObject as typeof DurableObject<Env>
}

const ShellDOBase = createShellDOBase()

// ============================================================================
// SHELL DURABLE OBJECT
// ============================================================================

/**
 * ShellDO - Durable Object for shell command execution
 *
 * Provides an HTTP/RPC API for executing shell commands with:
 * - AST-based safety analysis
 * - Tiered execution (native ops, RPC services, sandbox)
 * - FsCapability integration via FSX service binding
 *
 * When dotdo is available, also provides:
 * - Access to dotdo's WorkflowContext ($) and AI capabilities
 * - The $.bash capability powered by bashx's TieredExecutor
 *
 * @example
 * ```typescript
 * // Execute a command via $.bash (when dotdo is available)
 * const result = await shell.$.bash.exec('ls', ['-la'])
 *
 * // Or via RPC (always available)
 * const response = await fetch(doStub, {
 *   method: 'POST',
 *   body: JSON.stringify({
 *     method: 'exec',
 *     params: { command: 'git', args: ['status'] }
 *   })
 * })
 * ```
 */
export class ShellDO extends ShellDOBase {
  private app: Hono
  private bashModule: BashModule
  private fsAdapter: FsxServiceAdapter | null
  private aiGenerator: AIGenerator

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Create FSX adapter for native file operations (optional - may not be available in tests)
    this.fsAdapter = env.FSX ? new FsxServiceAdapter(env.FSX) : null

    // Create tiered executor with available bindings
    const fs = this.fsAdapter ? asTypedFs(this.fsAdapter) : undefined
    const executor = createExecutor(env, fs)

    // Create BashModule with FsCapability for native ops (only if FSX is available)
    // This is kept for backward compatibility with existing RPC methods
    this.bashModule = new BashModule(executor, {
      fs: this.fsAdapter as unknown as FsCapability | undefined,
      useNativeOps: !!this.fsAdapter,
    })

    // Create AI generator for natural language command generation
    this.aiGenerator = new AIGenerator()

    this.app = this.createApp()
  }

  private createApp(): Hono {
    const app = new Hono()

    // Health check
    app.get('/health', (c) => c.json({ status: 'ok', service: 'bashx-do' }))

    // RPC endpoint
    app.post('/rpc', async (c) => {
      const { method, params } = await c.req.json<{
        method: string
        params: Record<string, unknown>
      }>()

      try {
        const result = await this.handleMethod(method, params)
        return c.json(result)
      } catch (error: unknown) {
        const httpError = ErrorHandler.toHttpError(error)
        return c.json(httpError, toContentfulStatus(httpError.status))
      }
    })

    // Convenience endpoint for quick command execution
    app.post('/exec', async (c) => {
      const { command, args, options } = await c.req.json<{
        command: string
        args?: string[]
        options?: ExecOptions
      }>()

      try {
        const result = await this.bashModule.exec(command, args, options)
        return c.json(result)
      } catch (error: unknown) {
        const httpError = ErrorHandler.toHttpError(error)
        return c.json(httpError, toContentfulStatus(httpError.status))
      }
    })

    // Run script endpoint
    app.post('/run', async (c) => {
      const { script, options } = await c.req.json<{
        script: string
        options?: ExecOptions
      }>()

      try {
        const result = await this.bashModule.run(script, options)
        return c.json(result)
      } catch (error: unknown) {
        const err = error as { code?: string; message?: string }
        return c.json(
          {
            error: true,
            code: err.code || 'RUN_ERROR',
            message: err.message || 'Script execution failed',
          },
          400
        )
      }
    })

    // Safety analysis endpoint
    app.post('/analyze', async (c) => {
      const { input } = await c.req.json<{ input: string }>()

      try {
        const result = this.bashModule.analyze(input)
        return c.json(result)
      } catch (error: unknown) {
        const err = error as { message?: string }
        return c.json(
          {
            error: true,
            message: err.message || 'Analysis failed',
          },
          400
        )
      }
    })

    // AI-enhanced natural language command endpoint
    app.post('/do', async (c) => {
      const { input, options } = await c.req.json<{
        input: string
        options?: ExecOptions & AIGeneratorOptions
      }>()

      try {
        const result = await this.do(input, options)
        return c.json(result)
      } catch (error: unknown) {
        const err = error as { code?: string; message?: string }
        return c.json(
          {
            error: true,
            code: err.code || 'DO_ERROR',
            message: err.message || 'AI-enhanced execution failed',
          },
          400
        )
      }
    })

    // Generate command from natural language (without executing)
    app.post('/generate', async (c) => {
      const { intent, options } = await c.req.json<{
        intent: string
        options?: AIGeneratorOptions
      }>()

      try {
        const result = await this.aiGenerator.generate(intent, options)
        return c.json(result)
      } catch (error: unknown) {
        const err = error as { message?: string }
        return c.json(
          {
            error: true,
            message: err.message || 'Generation failed',
          },
          400
        )
      }
    })

    // Rendered output endpoint - returns terminal-rendered output based on Accept header
    app.post('/render', async (c) => {
      const { command, args, options } = await c.req.json<{
        command: string
        args?: string[]
        options?: ExecOptions
      }>()

      try {
        // Detect render tier from request
        const renderer = TerminalRenderer.fromRequest(c.req.raw)

        // Execute command
        const startTime = Date.now()
        const result = await this.bashModule.exec(command, args, options)
        const duration = Date.now() - startTime

        // Render output according to tier
        const rendered = renderer.renderCommandOutput({
          command: args?.length ? `${command} ${args.join(' ')}` : command,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          duration,
        })

        // Return appropriate content type
        const contentType = renderer.tier === 'markdown'
          ? 'text/markdown'
          : renderer.tier === 'ansi'
            ? 'text/x-ansi'
            : 'text/plain'

        return new Response(rendered, {
          headers: {
            'Content-Type': `${contentType}; charset=utf-8`,
            'X-Render-Tier': renderer.tier,
            'X-Exit-Code': String(result.exitCode),
            'X-Duration-Ms': String(duration),
          },
        })
      } catch (error: unknown) {
        const err = error as { code?: string; message?: string }
        return c.json(
          {
            error: true,
            code: err.code || 'RENDER_ERROR',
            message: err.message || 'Render failed',
          },
          400
        )
      }
    })

    // Table rendering endpoint - renders structured data as a table
    app.post('/table', async (c) => {
      const { data, options: tableOptions } = await c.req.json<{
        data: Record<string, unknown>[]
        options?: {
          columns?: Array<{ header: string; key: string; width?: number; align?: 'left' | 'center' | 'right' }>
          showHeaders?: boolean
          maxRows?: number
        }
      }>()

      try {
        const renderer = TerminalRenderer.fromRequest(c.req.raw)
        const rendered = renderer.renderTable(data, tableOptions)

        const contentType = renderer.tier === 'markdown'
          ? 'text/markdown'
          : renderer.tier === 'ansi'
            ? 'text/x-ansi'
            : 'text/plain'

        return new Response(rendered, {
          headers: {
            'Content-Type': `${contentType}; charset=utf-8`,
            'X-Render-Tier': renderer.tier,
          },
        })
      } catch (error: unknown) {
        const err = error as { message?: string }
        return c.json(
          {
            error: true,
            message: err.message || 'Table render failed',
          },
          400
        )
      }
    })

    // WebSocket endpoint for streaming command output
    app.get('/stream', async (c) => {
      // Upgrade to WebSocket
      const upgradeHeader = c.req.header('Upgrade')
      if (upgradeHeader !== 'websocket') {
        return c.text('Expected WebSocket upgrade', 426)
      }

      // Get render tier from query params
      const tier = (c.req.query('tier') || 'text') as RenderTier

      // Create WebSocket pair
      const webSocketPair = new WebSocketPair()
      const [client, server] = Object.values(webSocketPair)

      // Accept the WebSocket
      this.ctx.acceptWebSocket(server)

      // Store tier preference for this connection
      ;(server as unknown as { tier: RenderTier }).tier = tier

      return new Response(null, {
        status: 101,
        webSocket: client,
      })
    })

    return app
  }

  /**
   * Handle WebSocket messages for streaming execution
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') {
      ws.send(JSON.stringify({ type: 'error', message: 'Binary messages not supported' }))
      return
    }

    try {
      const { action, command, args, options } = JSON.parse(message) as {
        action: 'exec' | 'run'
        command?: string
        args?: string[]
        options?: ExecOptions
      }

      // Get tier from WebSocket attachment
      const tier = ((ws as unknown as { tier?: RenderTier }).tier || 'text') as RenderTier

      // Create streaming renderer
      const renderer = new StreamingRenderer({ tier }, createWebSocketCallback(ws))

      if (action === 'exec' && command) {
        const fullCommand = args?.length ? `${command} ${args.join(' ')}` : command

        // Signal start
        renderer.start(fullCommand)

        // Execute command
        const startTime = Date.now()
        const result = await this.bashModule.exec(command, args, options)
        const duration = Date.now() - startTime

        // Stream output
        if (result.stdout) {
          renderer.output(result.stdout, 'stdout')
        }
        if (result.stderr) {
          renderer.output(result.stderr, 'stderr')
        }

        // Signal completion
        renderer.end(result.exitCode, duration)
      } else if (action === 'run' && command) {
        // Signal start
        renderer.start(command)

        // Execute script
        const startTime = Date.now()
        const result = await this.bashModule.run(command, options)
        const duration = Date.now() - startTime

        // Stream output
        if (result.stdout) {
          renderer.output(result.stdout, 'stdout')
        }
        if (result.stderr) {
          renderer.output(result.stderr, 'stderr')
        }

        // Signal completion
        renderer.end(result.exitCode, duration)
      } else {
        renderer.error('Invalid action or missing command')
      }
    } catch (error: unknown) {
      const err = error as { message?: string }
      ws.send(JSON.stringify({
        type: 'error',
        message: err.message || 'Execution failed',
      }))
    }
  }

  /**
   * Handle WebSocket close
   */
  async webSocketClose(_ws: WebSocket): Promise<void> {
    // Cleanup if needed
  }

  /**
   * AI-enhanced natural language command execution.
   *
   * This method accepts either a direct bash command or a natural language
   * description of what the user wants to do. When given natural language,
   * it uses AI (via dotdo's agent SDK) to generate the appropriate bash
   * command, then runs it through bashx's safety analysis before execution.
   *
   * @param input - Command or natural language description
   * @param options - Execution options
   * @returns Execution result with generated command and safety analysis
   *
   * @example
   * ```typescript
   * // Direct command
   * const result = await shellDO.do('ls -la')
   *
   * // Natural language
   * const result = await shellDO.do('list all typescript files')
   * // Generated: find . -name '*.ts'
   *
   * // With options
   * const result = await shellDO.do('delete all temp files', { confirm: true })
   * ```
   */
  async do(input: string, options?: ExecOptions & AIGeneratorOptions): Promise<BashResult> {
    // First, try to determine if this is a direct command or natural language
    const isLikelyCommand = this.isLikelyCommand(input)

    if (isLikelyCommand) {
      // Execute directly as a command
      return this.bashModule.run(input, options)
    }

    // Use AI generator to convert natural language to command
    const generatorResult = await this.aiGenerator.generate(input, options)

    if (!generatorResult.success) {
      // Generation failed - return error result
      return {
        input,
        command: generatorResult.command || '',
        valid: false,
        generated: true,
        stdout: '',
        stderr: generatorResult.error || 'Failed to generate command from intent',
        exitCode: 1,
        intent: {
          commands: [],
          reads: [],
          writes: [],
          deletes: [],
          network: false,
          elevated: false,
        },
        classification: generatorResult.classification || {
          type: 'read',
          impact: 'none',
          reversible: true,
          reason: 'Generation failed',
        },
        blocked: generatorResult.blocked,
        blockReason: generatorResult.error,
        suggestions: generatorResult.alternatives,
      }
    }

    // Check if the generated command requires confirmation
    if (generatorResult.requiresConfirmation && !options?.confirm) {
      return {
        input,
        command: generatorResult.command,
        valid: true,
        generated: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
        intent: generatorResult.semanticIntent || {
          commands: [],
          reads: [],
          writes: [],
          deletes: [],
          network: false,
          elevated: false,
        },
        classification: generatorResult.classification || {
          type: 'mixed',
          impact: 'high',
          reversible: false,
          reason: generatorResult.warning || 'Command requires confirmation',
        },
        blocked: true,
        requiresConfirm: true,
        blockReason: generatorResult.warning || 'Generated command requires confirmation to execute',
        suggestions: generatorResult.alternatives,
      }
    }

    // Execute the generated command
    const execResult = await this.bashModule.run(generatorResult.command, options)

    // Augment result with generation metadata
    return {
      ...execResult,
      input,
      generated: true,
      suggestions: generatorResult.alternatives,
    }
  }

  /**
   * Heuristic to determine if input looks like a bash command vs natural language.
   */
  private isLikelyCommand(input: string): boolean {
    // Common command prefixes
    const commandPrefixes = [
      /^(ls|cd|cat|rm|cp|mv|mkdir|touch|chmod|chown|find|grep|sed|awk|sort|uniq|wc|head|tail|echo|pwd|env|export|alias|which|whereis|man|help|curl|wget|git|npm|yarn|pnpm|docker|kubectl|make|cmake|cargo|go|python|python3|node|ruby|perl|bash|sh|zsh)\b/,
      /^\.\//, // Relative paths
      /^\//, // Absolute paths
      /^\$\(/, // Command substitution
      /^[A-Z_]+=/, // Variable assignment
    ]

    // Check for command prefixes
    for (const prefix of commandPrefixes) {
      if (prefix.test(input.trim())) {
        return true
      }
    }

    // Check for pipe, redirect, or semicolon operators
    if (/[|;&]/.test(input)) {
      return true
    }

    // Check for flags (short or long)
    if (/\s-[a-zA-Z]|\s--[a-zA-Z]/.test(input)) {
      return true
    }

    // Natural language indicators
    const naturalLanguagePatterns = [
      /^(please|can you|could you|i want|i need|show me|help me|list|find|search|create|delete|remove|copy|move|rename|check|get|fetch|display|print|run|execute|what|how|why|where|when|do)/i,
    ]

    for (const pattern of naturalLanguagePatterns) {
      if (pattern.test(input.trim())) {
        return false
      }
    }

    // Default to treating as command if short and no spaces beyond arguments
    const words = input.trim().split(/\s+/)
    if (words.length <= 5 && words[0] && /^[a-z_-]+$/.test(words[0])) {
      return true
    }

    return false
  }

  /**
   * Handle RPC method calls
   */
  private async handleMethod(
    method: string,
    params: Record<string, unknown>
  ): Promise<BashResult | AIGeneratorResult | { classification: unknown; intent: unknown } | { dangerous: boolean; reason?: string }> {
    switch (method) {
      case 'exec':
        return this.bashModule.exec(
          params.command as string,
          params.args as string[] | undefined,
          params.options as ExecOptions | undefined
        )

      case 'run':
        return this.bashModule.run(
          params.script as string,
          params.options as ExecOptions | undefined
        )

      case 'analyze':
        return this.bashModule.analyze(params.input as string)

      case 'isDangerous':
        return this.bashModule.isDangerous(params.input as string)

      case 'do':
        return this.do(
          params.input as string,
          params.options as (ExecOptions & AIGeneratorOptions) | undefined
        )

      case 'generate':
        return this.aiGenerator.generate(
          params.intent as string,
          params.options as AIGeneratorOptions | undefined
        )

      default:
        throw new Error(`Unknown method: ${method}`)
    }
  }

  /**
   * Handle incoming HTTP requests
   */
  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request)
  }
}

// ============================================================================
// EXECUTOR FACTORY
// ============================================================================

/**
 * Git commands supported by gitx.do service binding.
 * These are routed to Tier 2 via the GITX service binding when available.
 */
const GITX_COMMANDS = ['git']

/**
 * Create the appropriate executor based on available environment bindings
 */
function createExecutor(env: Env, fs?: TypedFsCapability): BashExecutor {
  // Build RPC bindings based on available service bindings
  const rpcBindings: Record<string, { name: string; endpoint: string | { fetch: typeof fetch }; commands: string[] }> = {}

  // Add gitx binding if GITX service is available
  // This routes git commands to gitx.do via service binding (Tier 2)
  if (env.GITX) {
    rpcBindings.gitx = {
      name: 'gitx',
      endpoint: env.GITX as { fetch: typeof fetch },
      commands: GITX_COMMANDS,
    }
  }

  // Create tiered executor with FSX integration (if available)
  return new TieredExecutor({
    fs,
    // RPC bindings for Tier 2 services
    rpcBindings,
    // Sandbox binding if available for Tier 4 execution
    sandbox: env.CONTAINER
      ? {
          execute: async (command: string, options?: ExecOptions): Promise<BashResult> => {
            const response = await env.CONTAINER!.fetch('https://container/exec', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ command, options }),
            })
            return response.json() as Promise<BashResult>
          },
        }
      : undefined,
  })
}

// ============================================================================
// WORKER HANDLER
// ============================================================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Route to DO based on path or use default
    const namespace = url.pathname.split('/')[1] || 'default'
    const id = env.BASHX.idFromName(namespace)
    const stub = env.BASHX.get(id)

    // Forward request to DO, stripping the namespace from path
    const doUrl = new URL(request.url)
    doUrl.pathname = url.pathname.replace(`/${namespace}`, '') || '/'

    return stub.fetch(new Request(doUrl, request))
  },
}
