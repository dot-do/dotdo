/**
 * Universal Command Executor
 *
 * Execute commands locally or remotely with a simple template literal syntax.
 *
 * @example
 * ```typescript
 * import { $, $Context } from 'dotdo'
 *
 * // Use default context (local DO)
 * await $`ls -la`
 * await $`git status`
 *
 * // Create a remote context
 * const startup = $Context('https://startups.studio')
 * await startup`git pull`
 * await startup`npm run build`
 *
 * // Multiple contexts
 * const { prod, staging } = $Contexts({
 *   prod: 'https://api.example.com.ai',
 *   staging: 'https://staging.example.com.ai'
 * })
 *
 * // Parallel execution
 * await $All([prod, staging])`git status`
 * ```
 *
 * @module dotdo/$
 */

// ============================================================================
// TYPES
// ============================================================================

export interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
  command: string
  duration: number
}

export interface CommandOptions {
  cwd?: string
  env?: Record<string, string>
  stdin?: string
  timeout?: number
  quiet?: boolean
}

export interface ContextOptions {
  /** API endpoint URL (omit for local DO) */
  endpoint?: string
  /** Authentication token */
  token?: string
  /** Timeout in ms */
  timeout?: number
  /** Namespace/workspace ID */
  namespace?: string
  /** Headers to include in requests */
  headers?: Record<string, string>
}

export interface Dollar {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<CommandResult>
  quiet: Dollar
  cd: (dir: string) => Dollar
  env: (env: Record<string, string>) => Dollar
  ns: (namespace: string) => Dollar
  api: DollarAPI
  context: ContextOptions
}

interface DollarAPI {
  exec(command: string, options?: CommandOptions): Promise<CommandResult>
  read(path: string): Promise<string>
  write(path: string, content: string): Promise<void>
  list(path: string): Promise<string[]>
  git(args: string[]): Promise<CommandResult>
  mcp<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
}

// ============================================================================
// CONTEXT IMPLEMENTATION
// ============================================================================

let currentContext: ContextOptions = {}

/**
 * Create an execution context
 *
 * @example
 * ```typescript
 * // Local execution (spawns DO)
 * const $ = $Context()
 *
 * // Remote execution
 * const $ = $Context('https://startups.studio')
 *
 * // With options
 * const $ = $Context('https://api.example.com.ai', { token: 'xxx' })
 *
 * // With namespace
 * const $ = $Context('https://dotdo.dev').ns('my-workspace')
 * ```
 */
export function $Context(
  endpoint?: string,
  options: Partial<ContextOptions> = {}
): Dollar {
  const config: ContextOptions = {
    endpoint: endpoint?.replace(/\/$/, ''),
    timeout: 30000,
    ...options
  }

  let cwd = '/'
  let env: Record<string, string> = {}

  // API client
  const api: DollarAPI = {
    async exec(command: string, opts?: CommandOptions): Promise<CommandResult> {
      const url = config.endpoint || currentContext.endpoint
      if (!url) {
        // Local execution - will be handled by DO stub
        throw new Error('No endpoint configured. Use $Context(url) or set default context.')
      }

      const response = await fetch(`${url}/api/bash`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.token ? { 'Authorization': `Bearer ${config.token}` } : {}),
          ...(config.namespace ? { 'X-Namespace': config.namespace } : {}),
          ...config.headers
        },
        body: JSON.stringify({
          command,
          cwd: opts?.cwd || cwd,
          env: { ...env, ...opts?.env },
          stdin: opts?.stdin,
          timeout: opts?.timeout || config.timeout
        })
      })

      if (!response.ok) {
        const text = await response.text()
        return {
          stdout: '',
          stderr: `HTTP ${response.status}: ${text}`,
          exitCode: 1,
          command,
          duration: 0
        }
      }

      return response.json()
    },

    async read(path: string): Promise<string> {
      const url = config.endpoint || currentContext.endpoint
      if (!url) throw new Error('No endpoint configured')

      const response = await fetch(`${url}/api/fs/read`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.token ? { 'Authorization': `Bearer ${config.token}` } : {}),
          ...(config.namespace ? { 'X-Namespace': config.namespace } : {}),
          ...config.headers
        },
        body: JSON.stringify({ path })
      })

      if (!response.ok) {
        throw new Error(`Failed to read ${path}: ${response.status}`)
      }

      const result = await response.json() as { content: string }
      return result.content
    },

    async write(path: string, content: string): Promise<void> {
      const url = config.endpoint || currentContext.endpoint
      if (!url) throw new Error('No endpoint configured')

      const response = await fetch(`${url}/api/fs/write`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.token ? { 'Authorization': `Bearer ${config.token}` } : {}),
          ...(config.namespace ? { 'X-Namespace': config.namespace } : {}),
          ...config.headers
        },
        body: JSON.stringify({ path, content })
      })

      if (!response.ok) {
        throw new Error(`Failed to write ${path}: ${response.status}`)
      }
    },

    async list(path: string): Promise<string[]> {
      const url = config.endpoint || currentContext.endpoint
      if (!url) throw new Error('No endpoint configured')

      const response = await fetch(`${url}/api/fs/list`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.token ? { 'Authorization': `Bearer ${config.token}` } : {}),
          ...(config.namespace ? { 'X-Namespace': config.namespace } : {}),
          ...config.headers
        },
        body: JSON.stringify({ path })
      })

      if (!response.ok) {
        throw new Error(`Failed to list ${path}: ${response.status}`)
      }

      const result = await response.json() as { entries: { name: string }[] }
      return result.entries.map((e) => e.name)
    },

    async git(args: string[]): Promise<CommandResult> {
      const url = config.endpoint || currentContext.endpoint
      if (!url) throw new Error('No endpoint configured')

      const response = await fetch(`${url}/api/git`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.token ? { 'Authorization': `Bearer ${config.token}` } : {}),
          ...(config.namespace ? { 'X-Namespace': config.namespace } : {}),
          ...config.headers
        },
        body: JSON.stringify({ args, cwd })
      })

      if (!response.ok) {
        const text = await response.text()
        return {
          stdout: '',
          stderr: `HTTP ${response.status}: ${text}`,
          exitCode: 1,
          command: `git ${args.join(' ')}`,
          duration: 0
        }
      }

      return response.json()
    },

    async mcp<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
      const url = config.endpoint || currentContext.endpoint
      if (!url) throw new Error('No endpoint configured')

      const response = await fetch(`${url}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.token ? { 'Authorization': `Bearer ${config.token}` } : {}),
          ...(config.namespace ? { 'X-Namespace': config.namespace } : {}),
          ...config.headers
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params
        })
      })

      if (!response.ok) {
        throw new Error(`MCP call failed: ${response.status}`)
      }

      const result = await response.json() as { error?: { message: string }; result: T }
      if (result.error) {
        throw new Error(result.error.message)
      }
      return result.result
    }
  }

  // Main $ function
  async function $(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<CommandResult> {
    // Build command string from template
    let command = strings[0]
    for (let i = 0; i < values.length; i++) {
      const value = String(values[i])
      const escaped = value.includes(' ') || value.includes('"')
        ? `"${value.replace(/"/g, '\\"')}"`
        : value
      command += escaped + strings[i + 1]
    }

    command = command.trim()

    // Route git commands to git API
    if (command.startsWith('git ')) {
      const args = command.slice(4).split(/\s+/)
      return api.git(args)
    }

    return api.exec(command)
  }

  // Add chainable methods
  const dollar = $ as Dollar

  dollar.quiet = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    return $(strings, ...values)
  }) as Dollar

  dollar.cd = (dir: string) => {
    cwd = dir.startsWith('/') ? dir : `${cwd}/${dir}`.replace(/\/+/g, '/')
    return dollar
  }

  dollar.env = (newEnv: Record<string, string>) => {
    env = { ...env, ...newEnv }
    return dollar
  }

  dollar.ns = (namespace: string) => {
    return $Context(config.endpoint, { ...config, namespace })
  }

  dollar.api = api
  dollar.context = config

  return dollar
}

// ============================================================================
// DEFAULT $ (uses current context)
// ============================================================================

/**
 * Default $ using current context
 *
 * @example
 * ```typescript
 * import { $ } from 'dotdo'
 * await $`git status`
 * ```
 */
export const $: Dollar = $Context()

/**
 * Set the default context
 */
export function setContext(options: ContextOptions): void {
  currentContext = options
}

// ============================================================================
// MULTI-CONTEXT HELPERS
// ============================================================================

/**
 * Create multiple named contexts
 *
 * @example
 * ```typescript
 * const { prod, staging, dev } = $Contexts({
 *   prod: 'https://api.example.com.ai',
 *   staging: 'https://staging.example.com.ai',
 *   dev: 'http://localhost:8787'
 * })
 * ```
 */
export function $Contexts<T extends Record<string, string>>(
  endpoints: T,
  options: Partial<ContextOptions> = {}
): { [K in keyof T]: Dollar } {
  const result = {} as { [K in keyof T]: Dollar }
  for (const [name, endpoint] of Object.entries(endpoints)) {
    result[name as keyof T] = $Context(endpoint, options)
  }
  return result
}

/**
 * Execute on multiple contexts in parallel
 *
 * @example
 * ```typescript
 * const results = await $All([prod, staging])`git status`
 * ```
 */
export function $All(contexts: Dollar[]) {
  return async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<CommandResult[]> => {
    return Promise.all(
      contexts.map(ctx => ctx(strings, ...values))
    )
  }
}

/**
 * Execute on contexts sequentially
 */
export function $Seq(contexts: Dollar[]) {
  return async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<CommandResult[]> => {
    const results: CommandResult[] = []
    for (const ctx of contexts) {
      results.push(await ctx(strings, ...values))
    }
    return results
  }
}

// ============================================================================
// HELPERS
// ============================================================================

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function retry<T>(n: number, fn: () => Promise<T>): Promise<T> {
  let lastError: Error | undefined
  for (let i = 0; i < n; i++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (i < n - 1) await sleep(1000 * (i + 1))
    }
  }
  throw lastError
}
