/**
 * npmx.do Worker Entry Point
 *
 * Durable Object-based npm/npx service with:
 * - Package installation and resolution
 * - npx binary execution via esm.sh
 * - Integration with fsx.do for filesystem
 * - Integration with bashx.do for complex execution
 *
 * @example
 * ```typescript
 * // Install a package
 * const response = await fetch('https://npmx.do/rpc', {
 *   method: 'POST',
 *   body: JSON.stringify({
 *     method: 'install',
 *     params: { packages: [{ name: 'lodash' }] }
 *   })
 * })
 *
 * // Execute npx
 * const response = await fetch('https://npmx.do/rpc', {
 *   method: 'POST',
 *   body: JSON.stringify({
 *     method: 'exec',
 *     params: { command: 'cowsay', args: ['hello'] }
 *   })
 * })
 * ```
 *
 * @module npmx/do/worker
 */

import { DurableObject } from 'cloudflare:workers'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { NpmDO, type NpmEnv, type ExecResult, type PackageMetadata } from './NpmDO.js'
import type { InstallResult } from '../types.js'
import { validateNamespace } from './namespace.js'

// ============================================================================
// ENVIRONMENT TYPES
// ============================================================================

/**
 * Environment bindings for npmx-do
 * Re-exported from NpmDO for convenience
 */
export type Env = NpmEnv

// ============================================================================
// RE-EXPORT NpmDO for wrangler
// ============================================================================

export { NpmDO }

// ============================================================================
// HONO TYPE DEFINITIONS
// ============================================================================

/**
 * Hono app type with environment bindings
 */
type NpmxApp = Hono<{ Bindings: Env }>

/**
 * Context type for route handlers with typed env access
 */
export type NpmxContext = Context<{ Bindings: Env }>

// ============================================================================
// HTTP API WRAPPER
// ============================================================================

/**
 * NpmDOWrapper - HTTP API wrapper for NpmDO
 *
 * Provides REST/RPC endpoints for npm/npx operations
 */
export class NpmDOWrapper extends DurableObject<Env> {
  private app: NpmxApp
  private npmDO: NpmDO

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.npmDO = new NpmDO(ctx, env)
    this.app = this.createApp()
  }

  private createApp(): NpmxApp {
    const app = new Hono<{ Bindings: Env }>()

    // Health check
    app.get('/health', (c) => c.json({ status: 'ok', service: 'npmx-do' }))

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
        const err = error as { code?: string; message?: string; status?: number }
        return c.json(
          {
            error: true,
            code: err.code ?? 'UNKNOWN',
            message: err.message ?? 'Unknown error',
          },
          400 as const
        )
      }
    })

    // Convenience endpoints

    // GET /info/:package - Get package metadata
    app.get('/info/:package', async (c) => {
      const packageName = c.req.param('package')
      const version = c.req.query('version')

      try {
        const metadata = await this.npmDO.getPackageMetadata(packageName, version)
        return c.json(metadata)
      } catch (error) {
        const err = error as { message?: string }
        return c.json({ error: err.message ?? 'Package not found' }, 404 as const)
      }
    })

    // GET /search?q=query - Search packages
    app.get('/search', async (c) => {
      const query = c.req.query('q') ?? ''
      const limit = parseInt(c.req.query('limit') ?? '20', 10)

      try {
        const results = await this.npmDO.search(query, limit)
        return c.json({ results })
      } catch (error) {
        const err = error as { message?: string }
        return c.json({ error: err.message ?? 'Search failed' }, 500 as const)
      }
    })

    // POST /install - Install packages
    app.post('/install', async (c) => {
      const { packages, dev, exact } = await c.req.json<{
        packages: Array<{ name: string; version?: string }>
        dev?: boolean
        exact?: boolean
      }>()

      try {
        const options: { dev?: boolean; exact?: boolean } = {}
        if (dev !== undefined) options.dev = dev
        if (exact !== undefined) options.exact = exact
        const result = await this.npmDO.install(packages, options)
        return c.json(result)
      } catch (error) {
        const err = error as { message?: string }
        return c.json({ error: err.message ?? 'Install failed' }, 500 as const)
      }
    })

    // POST /exec - Execute npx command
    app.post('/exec', async (c) => {
      const { command, args, env: execEnv } = await c.req.json<{
        command: string
        args?: string[]
        env?: Record<string, string>
      }>()

      try {
        const options: { env?: Record<string, string> } = {}
        if (execEnv !== undefined) options.env = execEnv
        const result = await this.npmDO.exec(command, args, options)
        return c.json(result)
      } catch (error) {
        const err = error as { message?: string }
        return c.json({ error: err.message ?? 'Exec failed' }, 500 as const)
      }
    })

    // POST /run - Run package.json script
    app.post('/run', async (c) => {
      const { script, args, env: scriptEnv } = await c.req.json<{
        script: string
        args?: string[]
        env?: Record<string, string>
      }>()

      try {
        const options: { env?: Record<string, string> } = {}
        if (scriptEnv !== undefined) options.env = scriptEnv
        const result = await this.npmDO.runScript(script, args, options)
        return c.json(result)
      } catch (error) {
        const err = error as { message?: string }
        return c.json({ error: err.message ?? 'Script run failed' }, 500 as const)
      }
    })

    // GET /list - List installed packages
    app.get('/list', async (c) => {
      const packages = await this.npmDO.listInstalled()
      return c.json({ packages })
    })

    return app
  }

  /**
   * Handle RPC method calls
   */
  private async handleMethod(
    method: string,
    params: Record<string, unknown>
  ): Promise<
    | InstallResult
    | ExecResult
    | PackageMetadata
    | Array<{ name: string; version: string; description?: string | undefined }>
    | Array<{ name: string; version: string }>
    | { cleared: boolean }
  > {
    switch (method) {
      case 'install': {
        const options: { dev?: boolean; exact?: boolean } = {}
        const rawOptions = params.options as { dev?: boolean; exact?: boolean } | undefined
        if (rawOptions?.dev !== undefined) options.dev = rawOptions.dev
        if (rawOptions?.exact !== undefined) options.exact = rawOptions.exact
        return this.npmDO.install(
          params.packages as Array<{ name: string; version?: string }>,
          options
        )
      }

      case 'exec': {
        const options: { env?: Record<string, string> } = {}
        const rawOptions = params.options as { env?: Record<string, string> } | undefined
        if (rawOptions?.env !== undefined) options.env = rawOptions.env
        return this.npmDO.exec(
          params.command as string,
          params.args as string[] | undefined,
          options
        )
      }

      case 'runScript': {
        const options: { env?: Record<string, string> } = {}
        const rawOptions = params.options as { env?: Record<string, string> } | undefined
        if (rawOptions?.env !== undefined) options.env = rawOptions.env
        return this.npmDO.runScript(
          params.script as string,
          params.args as string[] | undefined,
          options
        )
      }

      case 'getPackageMetadata':
        return this.npmDO.getPackageMetadata(
          params.name as string,
          params.version as string | undefined
        )

      case 'search':
        return this.npmDO.search(
          params.query as string,
          params.limit as number | undefined
        )

      case 'listInstalled':
        return this.npmDO.listInstalled()

      case 'clearCache':
        this.npmDO.clearCache()
        return { cleared: true }

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
// WORKER HANDLER
// ============================================================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Extract namespace from path (first path segment) or use default
    const pathSegment = url.pathname.split('/')[1] ?? ''
    const namespace = pathSegment || 'default'

    // Security: Validate namespace to prevent path traversal and injection attacks
    // This blocks malicious namespaces like "../admin", extremely long strings,
    // or strings with special characters that could cause issues
    if (!validateNamespace(namespace)) {
      return new Response(
        JSON.stringify({
          error: 'Invalid namespace',
          message: 'Namespace must be 1-64 characters, alphanumeric with hyphens and underscores only',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Route to DO with validated namespace
    const id = env.NPMX.idFromName(namespace)
    const stub = env.NPMX.get(id)

    // Forward request to DO, stripping the namespace from path
    const doUrl = new URL(request.url)
    doUrl.pathname = url.pathname.replace(`/${namespace}`, '') || '/'

    return stub.fetch(new Request(doUrl, request))
  },
}
