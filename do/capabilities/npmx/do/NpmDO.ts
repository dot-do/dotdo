/**
 * NpmDO - Durable Object for npm/npx operations
 *
 * Provides a stateful package management environment per namespace with:
 * - Package installation and resolution
 * - npx binary execution via esm.sh
 * - Cached package metadata and tarballs
 * - WorkflowContext ($) for event handling, scheduling, and cross-DO RPC
 *
 * Extends dotdo's DO base class for full WorkflowContext integration:
 * - $.on.Package.installed(handler) - Event handlers
 * - $.every.hour(handler) - Scheduling
 * - $.send/$.try/$.do - Execution modes
 * - $.Package(id).method() - Cross-DO RPC
 *
 * @module npmx/do/NpmDO
 */

import { DO, type Env as BaseEnv } from '../../../../objects/DO'
import type { InstallResult } from '../types.js'
import {
  PackageNotFoundError,
  FetchError,
  TarballError,
  ExecError,
  SecurityError,
} from '../../core/errors/index.js'
import { encodePackageName } from '../../core/package/name.js'
import { LRUCache, type CacheStats } from '../../core/cache/lru.js'
import {
  SecurityPolicy,
  type NpmSecurityConfig,
} from '../../core/security/policy.js'
import {
  fetchWithTimeout,
  FetchTimeoutError,
  DEFAULT_FETCH_TIMEOUT,
} from './fetch-timeout.js'

// ============================================================================
// CAP'N WEB RPC CLIENT TYPES
// ============================================================================

/**
 * RPC error with structured information for debugging
 */
export class RpcError extends Error {
  readonly code: string
  readonly stage?: number

  constructor(code: string, message: string, stage?: number) {
    super(message)
    this.name = 'RpcError'
    this.code = code
    this.stage = stage
  }
}

/**
 * Symbol to identify pipeline promises
 */
const PIPELINE_PROMISE_SYMBOL = Symbol('PipelinePromise')

/**
 * Pipeline promise that supports property access and method chaining
 * on unresolved values - Cap'n Web style promise pipelining.
 */
export interface PipelinePromise<T> extends Promise<T> {
  [PIPELINE_PROMISE_SYMBOL]: true
  /** Access nested properties on the future result */
  [key: string]: unknown
  /** Map over array results (magic map pattern) */
  map<U>(fn: (item: T extends Array<infer I> ? I : never) => U): PipelinePromise<U[]>
  /** Filter array results */
  filter(fn: (item: T extends Array<infer I> ? I : never) => boolean): PipelinePromise<T>
  /** Parse JSON result */
  parse(): PipelinePromise<unknown>
}

/**
 * RPC client for FSX (filesystem) operations with promise pipelining support.
 *
 * Provides typed methods that wrap RPC calls to the fsx.do service.
 * All methods return promises that can be awaited or pipelined.
 */
export interface FsxRpcClient {
  /** Read file contents from the virtual filesystem */
  readFile(path: string, options?: { encoding?: string }): PipelinePromise<string>

  /** Write content to a file in the virtual filesystem */
  writeFile(path: string, content: string, options?: { encoding?: string }): PipelinePromise<void>

  /** Extract a tarball to a destination directory */
  extractTarball(data: Uint8Array | number[], dest: string): PipelinePromise<void>

  /** Read directory contents */
  readdir(path: string, options?: { withFileTypes?: boolean }): PipelinePromise<Array<{ name: string; type: string }>>
}

/**
 * RPC client for BASHX (shell execution) operations with promise pipelining support.
 *
 * Provides typed methods that wrap RPC calls to the bashx.do service.
 */
export interface BashxRpcClient {
  /** Execute a command with arguments */
  exec(command: string, args: string[], options?: { env?: Record<string, string> }): PipelinePromise<{
    exitCode: number
    stdout: string
    stderr: string
  }>

  /** Run a shell script */
  run(script: string, options?: { env?: Record<string, string> }): PipelinePromise<{
    exitCode: number
    stdout: string
    stderr: string
  }>
}

/**
 * Pending operation for batching multiple RPC calls
 */
interface PendingOperation {
  method: string
  params: unknown
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/**
 * Batch manager that handles operation queueing and flushing.
 * Uses a short timer delay to allow Promise.all to collect all promises
 * before flushing the batch.
 */
class BatchManager {
  private pending: PendingOperation[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private fetcher: Fetcher
  private endpoint: string

  // Batch window in milliseconds - allows Promise.all to collect promises
  private static readonly BATCH_WINDOW_MS = 0

  constructor(fetcher: Fetcher, endpoint: string) {
    this.fetcher = fetcher
    this.endpoint = endpoint
  }

  /**
   * Queue an operation for batching.
   * Returns a promise that resolves when the operation completes.
   */
  call<T>(method: string, params: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      this.pending.push({ method, params, resolve: resolve as (v: unknown) => void, reject })
      this.scheduleFlush()
    })
  }

  /**
   * Schedule a flush using setTimeout with a small delay.
   * This allows Promise.all to collect all promises synchronously
   * before the flush occurs.
   */
  private scheduleFlush(): void {
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => this.flush(), BatchManager.BATCH_WINDOW_MS)
    }
  }

  /**
   * Flush all pending operations in a single batch request.
   */
  private async flush(): Promise<void> {
    this.flushTimer = null

    if (this.pending.length === 0) return

    const batch = [...this.pending]
    this.pending = []

    try {
      // If single operation, send as single request for compatibility
      const payload = batch.length === 1
        ? { method: batch[0].method, params: batch[0].params }
        : batch.map(op => ({ method: op.method, params: op.params }))

      const response = await this.fetcher.fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorData = await response.json() as { error?: { code?: string; message?: string; stage?: number } }
        const error = errorData.error || {}
        const rpcError = new RpcError(
          error.code || 'RPC_ERROR',
          error.message || `RPC call failed with status ${response.status}`,
          error.stage
        )
        batch.forEach(op => op.reject(rpcError))
        return
      }

      const result = await response.json() as { data?: unknown } | Array<{ data?: unknown; error?: { code: string; message: string; stage?: number } }>

      if (Array.isArray(result)) {
        // Batch response
        result.forEach((res, i) => {
          if (res.error) {
            batch[i].reject(new RpcError(res.error.code, res.error.message, res.error.stage))
          } else {
            batch[i].resolve(res.data)
          }
        })
      } else {
        // Single response
        batch[0].resolve(result.data)
      }
    } catch (error) {
      batch.forEach(op => op.reject(error as Error))
    }
  }
}

/**
 * Create a pipeline promise that supports property access on unresolved values.
 * This enables Cap'n Web style promise pipelining.
 */
function createPipelinePromise<T>(promise: Promise<T>): PipelinePromise<T> {
  // Create a proxy over the promise that intercepts property access
  const proxy = new Proxy(promise, {
    get(target, prop, receiver) {
      // Handle promise methods
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        const method = target[prop as keyof Promise<T>] as Function
        return method.bind(target)
      }

      // Handle pipeline promise symbol
      if (prop === PIPELINE_PROMISE_SYMBOL) {
        return true
      }

      // Handle Symbol.toStringTag for proper [object Promise] behavior
      if (prop === Symbol.toStringTag) {
        return 'Promise'
      }

      // Handle map (magic map pattern)
      if (prop === 'map') {
        return (fn: (item: unknown) => unknown) => {
          const mappedPromise = target.then((value: T) => {
            if (Array.isArray(value)) {
              return value.map(fn)
            }
            throw new TypeError('map can only be called on array results')
          })
          return createPipelinePromise(mappedPromise)
        }
      }

      // Handle filter
      if (prop === 'filter') {
        return (fn: (item: unknown) => boolean) => {
          const filteredPromise = target.then((value: T) => {
            if (Array.isArray(value)) {
              return value.filter(fn)
            }
            throw new TypeError('filter can only be called on array results')
          })
          return createPipelinePromise(filteredPromise)
        }
      }

      // Handle parse (for JSON parsing)
      if (prop === 'parse') {
        return () => {
          const parsedPromise = target.then((value: T) => {
            if (typeof value === 'string') {
              return JSON.parse(value)
            }
            return value
          })
          return createPipelinePromise(parsedPromise)
        }
      }

      // For other properties, chain a .then that accesses the property
      if (typeof prop === 'string') {
        const chainedPromise = target.then((value: T) => {
          if (value === null || value === undefined) {
            return undefined
          }
          return (value as Record<string, unknown>)[prop]
        })
        return createPipelinePromise(chainedPromise)
      }

      return Reflect.get(target, prop, receiver)
    },
  }) as PipelinePromise<T>

  return proxy
}

/**
 * Create an FSX RPC client that wraps a Fetcher with promise pipelining.
 *
 * The client queues operations during the same event loop tick and batches them
 * into a single fetch call, reducing network round trips.
 *
 * @param fetcher - The Fetcher binding to the FSX service
 * @returns Typed FSX client with pipelining support
 */
export function createFsxRpcClient(fetcher: Fetcher): FsxRpcClient {
  const batchManager = new BatchManager(fetcher, 'https://fsx.do/rpc')

  return {
    readFile(path: string, options?: { encoding?: string }): PipelinePromise<string> {
      const promise = batchManager.call<string>('readFile', { path, encoding: options?.encoding || 'utf-8' })
      return createPipelinePromise(promise)
    },

    writeFile(path: string, content: string, options?: { encoding?: string }): PipelinePromise<void> {
      const promise = batchManager.call<void>('writeFile', { path, content, encoding: options?.encoding || 'utf-8' })
      return createPipelinePromise(promise)
    },

    extractTarball(data: Uint8Array | number[], dest: string): PipelinePromise<void> {
      const dataArray = data instanceof Uint8Array ? Array.from(data) : data
      const promise = batchManager.call<void>('extractTarball', { data: dataArray, dest })
      return createPipelinePromise(promise)
    },

    readdir(path: string, options?: { withFileTypes?: boolean }): PipelinePromise<Array<{ name: string; type: string }>> {
      const promise = batchManager.call<Array<{ name: string; type: string }>>('readdir', { path, withFileTypes: options?.withFileTypes ?? true })
      return createPipelinePromise(promise)
    },
  }
}

/**
 * Create a BASHX RPC client that wraps a Fetcher with promise pipelining.
 *
 * @param fetcher - The Fetcher binding to the BASHX service
 * @returns Typed BASHX client with pipelining support
 */
export function createBashxRpcClient(fetcher: Fetcher): BashxRpcClient {
  const batchManager = new BatchManager(fetcher, 'https://bashx.do/rpc')

  return {
    exec(command: string, args: string[], options?: { env?: Record<string, string> }): PipelinePromise<{
      exitCode: number
      stdout: string
      stderr: string
    }> {
      const promise = batchManager.call<{ exitCode: number; stdout: string; stderr: string }>('exec', { command, args, options: { env: options?.env } })
      return createPipelinePromise(promise)
    },

    run(script: string, options?: { env?: Record<string, string> }): PipelinePromise<{
      exitCode: number
      stdout: string
      stderr: string
    }> {
      const promise = batchManager.call<{ exitCode: number; stdout: string; stderr: string }>('run', { script, options: { env: options?.env } })
      return createPipelinePromise(promise)
    },
  }
}

/**
 * Extended environment for NpmDO with npm-specific bindings
 */
export interface NpmEnv extends BaseEnv {
  /** Self-binding for NpmDO */
  NPMX?: DurableObjectNamespace

  /** Service binding to fsx-do for filesystem operations */
  FSX?: Fetcher

  /** Service binding to bashx-do for shell execution */
  BASHX?: Fetcher

  /** Security configuration for package installation */
  NPM_SECURITY_CONFIG?: string // JSON-serialized NpmSecurityConfig
}

/**
 * Options for NpmDO construction
 */
export interface NpmDOOptions {
  /** Security policy configuration */
  securityConfig?: NpmSecurityConfig
}

// ============================================================================
// SHELL ESCAPING (SECURITY)
// ============================================================================

/**
 * Characters that are safe in shell without quoting.
 * Includes: alphanumeric, underscore, hyphen, period, forward slash, colon, equals, at
 */
const SAFE_CHARS_REGEX = /^[\x20-\x7E]*$/
const SAFE_UNQUOTED_REGEX = /^[a-zA-Z0-9_\-./:=@]+$/

/**
 * Escape a single argument for safe shell use.
 * Uses POSIX-compliant single-quote escaping which preserves all characters literally.
 *
 * This prevents command injection attacks where user-provided args like '; rm -rf /'
 * could be executed as shell commands.
 *
 * @param value - Value to escape (will be converted to string)
 * @returns Shell-safe escaped string
 *
 * @example
 * ```typescript
 * shellEscapeArg('hello world')     // => 'hello world'
 * shellEscapeArg("it's fine")       // => 'it'"'"'s fine'
 * shellEscapeArg('file; rm -rf /') // => 'file; rm -rf /'
 * shellEscapeArg('simple')         // => simple (no quotes needed)
 * ```
 */
function shellEscapeArg(value: unknown): string {
  const str = String(value)

  // Empty string needs explicit quoting
  if (str === '') {
    return "''"
  }

  // If only safe ASCII characters that don't need quoting, return as-is
  if (SAFE_CHARS_REGEX.test(str) && SAFE_UNQUOTED_REGEX.test(str)) {
    return str
  }

  // Use single quotes - they're the safest for shell escaping
  // Single quotes preserve everything literally except single quotes themselves
  // To include a single quote: end quote, add escaped quote, start quote again
  return "'" + str.replace(/'/g, "'\"'\"'") + "'"
}

/**
 * Default maximum size for the package metadata cache.
 * Prevents OOM in long-running DOs by limiting unbounded growth.
 */
const DEFAULT_CACHE_SIZE = 100

/**
 * Registry fetch timeout configuration.
 * Prevents indefinite hangs when registry is slow/unresponsive.
 * Includes retry with exponential backoff for transient failures.
 */
const REGISTRY_TIMEOUT = DEFAULT_FETCH_TIMEOUT // 30 seconds
const REGISTRY_RETRIES = 2 // Try 3 times total (initial + 2 retries)
const REGISTRY_BACKOFF = 1000 // 1 second base backoff (1s, 2s, 4s)

/**
 * Package metadata from registry
 */
export interface PackageMetadata {
  name: string
  version: string
  description?: string
  main?: string
  bin?: Record<string, string> | string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

// InstallResult is imported from ../types.js
export type { InstallResult } from '../types.js'

/**
 * Execution result from npx
 */
export interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
  duration: number
}

/**
 * NpmDO - Durable Object for npm/npx operations
 *
 * Each instance represents a package management context (like a project directory).
 * State is persisted across requests.
 *
 * Extends DO to gain WorkflowContext ($) with:
 * - Event handlers: $.on.Package.installed(handler)
 * - Scheduling: $.every.hour(handler)
 * - Execution modes: $.send(), $.try(), $.do()
 * - Cross-DO RPC: $.Package(id).resolve()
 */
export class NpmDO extends DO<NpmEnv> {
  /**
   * Static $type property - the class type discriminator
   */
  static readonly $type: string = 'NpmDO'

  /**
   * LRU cache of resolved packages.
   * Bounded to prevent OOM in long-running DOs.
   * Default max size: 100 entries (configurable via setCacheSize).
   */
  private packageCache: LRUCache<string, PackageMetadata> = new LRUCache({
    maxSize: DEFAULT_CACHE_SIZE,
  })

  /** Registry URL */
  private registry: string = 'https://registry.npmjs.org'

  /**
   * Security policy for package installation.
   * Enforces allowlist/blocklist, license requirements, and vulnerability thresholds.
   */
  private securityPolicy: SecurityPolicy | null = null

  /**
   * RPC client for fsx operations with promise pipelining.
   * Batches multiple filesystem calls into single network round trips.
   */
  private fsxClient: FsxRpcClient | null = null

  /**
   * RPC client for bashx operations with promise pipelining.
   * Batches multiple shell execution calls into single network round trips.
   */
  private bashxClient: BashxRpcClient | null = null

  constructor(ctx: DurableObjectState, env: NpmEnv, options?: NpmDOOptions) {
    super(ctx, env)

    // Initialize RPC clients for cross-DO calls with pipelining
    if (env.FSX) {
      this.fsxClient = createFsxRpcClient(env.FSX)
    }
    if (env.BASHX) {
      this.bashxClient = createBashxRpcClient(env.BASHX)
    }

    // Initialize security policy from options or environment
    if (options?.securityConfig) {
      this.securityPolicy = new SecurityPolicy(options.securityConfig)
    } else if (env.NPM_SECURITY_CONFIG) {
      try {
        const config = JSON.parse(env.NPM_SECURITY_CONFIG) as NpmSecurityConfig
        this.securityPolicy = new SecurityPolicy(config)
      } catch {
        console.warn('Failed to parse NPM_SECURITY_CONFIG, using no security policy')
      }
    }
  }

  // ============================================================================
  // SECURITY
  // ============================================================================

  /**
   * Set the security policy for this NpmDO instance.
   * This allows per-agent or per-workspace security configurations.
   */
  setSecurityPolicy(config: NpmSecurityConfig): void {
    this.securityPolicy = new SecurityPolicy(config)
  }

  /**
   * Use a preset security policy.
   * @param preset - 'restricted' (most limiting), 'standard' (common packages), or 'permissive' (minimal restrictions)
   */
  useSecurityPreset(preset: 'restricted' | 'standard' | 'permissive'): void {
    this.securityPolicy = SecurityPolicy.preset(preset)
  }

  /**
   * Get the current security policy (for inspection/debugging)
   */
  getSecurityPolicy(): NpmSecurityConfig | null {
    return this.securityPolicy?.toJSON() ?? null
  }

  /**
   * Check if a package is allowed by the security policy.
   * Does not throw, returns check result.
   */
  checkPackageSecurity(packageName: string): { allowed: boolean; reason?: string } {
    if (!this.securityPolicy) {
      return { allowed: true }
    }

    const result = this.securityPolicy.check(packageName)
    if (!result.allowed) {
      return {
        allowed: false,
        reason: result.violations.map((v) => v.message).join('; '),
      }
    }
    return { allowed: true }
  }

  /**
   * Assert that a package is allowed by security policy.
   * Throws SecurityError if not allowed.
   */
  private assertPackageSecurity(packageName: string): void {
    if (!this.securityPolicy) {
      return // No policy = allow all
    }
    this.securityPolicy.assert(packageName)
  }

  // ============================================================================
  // PACKAGE METADATA
  // ============================================================================

  /**
   * Fetch package metadata from registry
   */
  async getPackageMetadata(name: string, version?: string): Promise<PackageMetadata> {
    const cacheKey = version ? `${name}@${version}` : name

    // Check cache first
    const cached = this.packageCache.get(cacheKey)
    if (cached) {
      return cached
    }

    // Fetch from registry with timeout protection
    // Encode package name for URL (scoped packages need %2F encoding)
    const encodedName = encodePackageName(name)
    const url = version
      ? `${this.registry}/${encodedName}/${version}`
      : `${this.registry}/${encodedName}/latest`

    let response: Response
    try {
      response = await fetchWithTimeout(
        url,
        { headers: { Accept: 'application/json' } },
        { timeout: REGISTRY_TIMEOUT, retries: REGISTRY_RETRIES, retryBackoff: REGISTRY_BACKOFF }
      )
    } catch (error) {
      if (error instanceof FetchTimeoutError) {
        throw new FetchError(`Registry timeout fetching ${name}: ${error.message}`, {
          status: 0,
          registry: this.registry,
        })
      }
      throw error
    }

    if (!response.ok) {
      throw new PackageNotFoundError(name, version)
    }

    const metadata = (await response.json()) as PackageMetadata

    // Cache the result
    this.packageCache.set(cacheKey, metadata)

    return metadata
  }

  /**
   * Search packages in registry
   */
  async search(query: string, limit = 20): Promise<Array<{ name: string; version: string; description?: string | undefined }>> {
    const url = `${this.registry}/-/v1/search?text=${encodeURIComponent(query)}&size=${limit}`

    let response: Response
    try {
      response = await fetchWithTimeout(
        url,
        { headers: { Accept: 'application/json' } },
        { timeout: REGISTRY_TIMEOUT, retries: REGISTRY_RETRIES, retryBackoff: REGISTRY_BACKOFF }
      )
    } catch (error) {
      if (error instanceof FetchTimeoutError) {
        throw new FetchError(`Registry timeout during search: ${error.message}`, {
          status: 0,
          registry: this.registry,
        })
      }
      throw error
    }

    if (!response.ok) {
      throw new FetchError(`Search failed: ${response.statusText}`, {
        status: response.status,
        registry: this.registry,
      })
    }

    const data = (await response.json()) as {
      objects: Array<{
        package: { name: string; version: string; description?: string }
      }>
    }

    return data.objects.map((obj) => {
      const result: { name: string; version: string; description?: string | undefined } = {
        name: obj.package.name,
        version: obj.package.version,
      }
      if (obj.package.description !== undefined) {
        result.description = obj.package.description
      }
      return result
    })
  }

  // ============================================================================
  // PACKAGE INSTALLATION
  // ============================================================================

  /**
   * Install packages to the virtual node_modules
   *
   * Uses fsx.do for filesystem operations and stores package contents
   */
  async install(
    packages: Array<{ name: string; version?: string }>,
    _options?: { dev?: boolean; exact?: boolean }
  ): Promise<InstallResult> {
    const start = Date.now()
    const installed: Array<{ name: string; version: string }> = []
    let resolved = 0
    let cached = 0

    for (const pkg of packages) {
      try {
        // SECURITY: Check if package is allowed by security policy
        this.assertPackageSecurity(pkg.name)

        // Resolve package metadata
        const metadata = await this.getPackageMetadata(pkg.name, pkg.version)
        resolved++

        // Check if already installed via fsx
        const installedVersion = await this.getInstalledVersion(pkg.name)
        if (installedVersion === metadata.version) {
          cached++
          continue
        }

        // Download and extract tarball via fsx
        await this.downloadAndExtract(metadata)

        installed.push({ name: metadata.name, version: metadata.version })
      } catch (error) {
        console.error(`Failed to install ${pkg.name}:`, error)
        throw error
      }
    }

    return {
      installed,
      removed: [],
      updated: [],
      stats: {
        resolved,
        cached,
        duration: Date.now() - start,
      },
    }
  }

  /**
   * Get the installed version of a package
   */
  private async getInstalledVersion(name: string): Promise<string | null> {
    if (!this.env.FSX) return null

    try {
      const response = await this.env.FSX.fetch('https://fsx.do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'readFile',
          params: { path: `/node_modules/${name}/package.json`, encoding: 'utf-8' },
        }),
      })

      if (!response.ok) return null

      const result = (await response.json()) as { data: string }
      const pkg = JSON.parse(result.data) as { version: string }
      return pkg.version
    } catch {
      return null
    }
  }

  /**
   * Download and extract a package tarball
   */
  private async downloadAndExtract(metadata: PackageMetadata): Promise<void> {
    // Get tarball URL from registry
    const registryMeta = (await this.fetchPackageJson(metadata.name, metadata.version)) as {
      dist: { tarball: string }
    }

    const tarballUrl = registryMeta.dist.tarball

    // Fetch tarball with timeout protection
    let tarballResponse: Response
    try {
      tarballResponse = await fetchWithTimeout(
        tarballUrl,
        {},
        { timeout: REGISTRY_TIMEOUT, retries: REGISTRY_RETRIES, retryBackoff: REGISTRY_BACKOFF }
      )
    } catch (error) {
      if (error instanceof FetchTimeoutError) {
        throw new TarballError(
          `Tarball download timeout: ${error.message}`,
          metadata.name
        )
      }
      throw error
    }
    if (!tarballResponse.ok) {
      throw new TarballError(
        `Failed to download tarball: ${tarballResponse.statusText}`,
        metadata.name
      )
    }

    const tarballBuffer = await tarballResponse.arrayBuffer()

    // Use fsx to extract - fsx handles the decompression and extraction
    if (this.env.FSX) {
      await this.env.FSX.fetch('https://fsx.do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'extractTarball',
          params: {
            data: Array.from(new Uint8Array(tarballBuffer)),
            dest: `/node_modules/${metadata.name}`,
          },
        }),
      })
    }
  }

  /**
   * Fetch raw package.json from registry (includes dist info)
   */
  private async fetchPackageJson(name: string, version: string): Promise<unknown> {
    // Encode package name for URL (scoped packages need %2F encoding)
    const encodedName = encodePackageName(name)
    const url = `${this.registry}/${encodedName}/${version}`

    let response: Response
    try {
      response = await fetchWithTimeout(
        url,
        { headers: { Accept: 'application/json' } },
        { timeout: REGISTRY_TIMEOUT, retries: REGISTRY_RETRIES, retryBackoff: REGISTRY_BACKOFF }
      )
    } catch (error) {
      if (error instanceof FetchTimeoutError) {
        throw new FetchError(`Registry timeout fetching package.json for ${name}@${version}: ${error.message}`, {
          status: 0,
          registry: this.registry,
        })
      }
      throw error
    }

    return response.json()
  }

  // ============================================================================
  // NPX EXECUTION
  // ============================================================================

  /**
   * Execute a package binary (npx-style)
   *
   * For Tier 1 packages (pure ESM), uses esm.sh + dynamic import
   * For Tier 2+ packages, delegates to bashx
   */
  async exec(command: string, args: string[] = [], options?: { env?: Record<string, string> }): Promise<ExecResult> {
    const start = Date.now()

    try {
      // SECURITY: Check if package is allowed by security policy
      // For npx, the command name is typically the package name
      this.assertPackageSecurity(command)

      // Resolve the command to a package
      const { packageName, binPath } = await this.resolveCommand(command)

      // Try esm.sh first (Tier 1)
      const esmResult = await this.execViaEsmSh(packageName, binPath, args, options)
      if (esmResult) {
        return {
          ...esmResult,
          duration: Date.now() - start,
        }
      }

      // Fall back to bashx (Tier 2+)
      if (this.env.BASHX) {
        const bashResult = await this.execViaBashx(command, args, options)
        return {
          ...bashResult,
          duration: Date.now() - start,
        }
      }

      throw new ExecError(`Cannot execute ${command}: no execution runtime available`, {
        package: command,
      })
    } catch (error) {
      const err = error as Error
      return {
        exitCode: 1,
        stdout: '',
        stderr: err.message,
        duration: Date.now() - start,
      }
    }
  }

  /**
   * Resolve a command to its package and binary path
   */
  private async resolveCommand(command: string): Promise<{ packageName: string; binPath: string }> {
    const packageName = command

    // Get package metadata to find bin
    const metadata = await this.getPackageMetadata(packageName)

    let binPath: string
    if (typeof metadata.bin === 'string') {
      binPath = metadata.bin
    } else if (metadata.bin && typeof metadata.bin === 'object') {
      // Use the command name or the package name as the bin key
      const binKey = command.split('/').pop() ?? command
      const binValue = metadata.bin[binKey] ?? Object.values(metadata.bin)[0]
      binPath = binValue ?? 'index.js'
    } else if (metadata.main) {
      binPath = metadata.main
    } else {
      binPath = 'index.js'
    }

    return { packageName, binPath }
  }

  /**
   * Execute via esm.sh (for pure ESM packages)
   */
  private async execViaEsmSh(
    packageName: string,
    _binPath: string,
    args: string[],
    options?: { env?: Record<string, string> }
  ): Promise<{ exitCode: number; stdout: string; stderr: string } | null> {
    // Build esm.sh URL
    const esmUrl = `https://esm.sh/${packageName}?target=es2022`

    try {
      // Dynamic import from esm.sh
      const module = await import(/* @vite-ignore */ esmUrl) as {
        default?: (args: string[], options?: { env?: Record<string, string> }) => unknown | Promise<unknown>
        run?: (args: string[], options?: { env?: Record<string, string> }) => unknown | Promise<unknown>
        main?: (args: string[], options?: { env?: Record<string, string> }) => unknown | Promise<unknown>
      }

      // Look for common entry points
      const entryPoint = module.default || module.run || module.main

      if (typeof entryPoint === 'function') {
        const result = await entryPoint(args, options)
        return {
          exitCode: 0,
          stdout: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          stderr: '',
        }
      }

      // Module loaded but no runnable entry point
      return null
    } catch {
      // esm.sh failed, fall back to other methods
      return null
    }
  }

  /**
   * Execute via bashx (for Tier 2+ packages)
   */
  private async execViaBashx(
    command: string,
    args: string[],
    options?: { env?: Record<string, string> }
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const response = await this.env.BASHX!.fetch('https://bashx.do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'exec',
        params: {
          command: 'npx',
          args: [command, ...args],
          options: { env: options?.env },
        },
      }),
    })

    if (!response.ok) {
      const error = (await response.json()) as { message?: string }
      return {
        exitCode: 1,
        stdout: '',
        stderr: error.message || 'Execution failed',
      }
    }

    return response.json() as Promise<{ exitCode: number; stdout: string; stderr: string }>
  }

  // ============================================================================
  // SCRIPT RUNNING
  // ============================================================================

  /**
   * Run a package.json script
   */
  async runScript(
    script: string,
    args: string[] = [],
    options?: { env?: Record<string, string> }
  ): Promise<ExecResult> {
    const start = Date.now()

    // Read package.json to get scripts
    if (!this.env.FSX) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'FSX service not available',
        duration: Date.now() - start,
      }
    }

    try {
      const response = await this.env.FSX.fetch('https://fsx.do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'readFile',
          params: { path: '/package.json', encoding: 'utf-8' },
        }),
      })

      if (!response.ok) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'package.json not found',
          duration: Date.now() - start,
        }
      }

      const result = (await response.json()) as { data: string }
      const pkg = JSON.parse(result.data) as { scripts?: Record<string, string> }

      const scriptCommand = pkg.scripts?.[script]
      if (!scriptCommand) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `Script "${script}" not found in package.json`,
          duration: Date.now() - start,
        }
      }

      // Execute via bashx
      if (!this.env.BASHX) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'BASHX service not available',
          duration: Date.now() - start,
        }
      }

      // SECURITY: Escape all user-provided args to prevent command injection
      // Issue: dotdo-8y5m8 - args like '; rm -rf /' could execute arbitrary commands
      const escapedArgs = args.length > 0
        ? ' ' + args.map(shellEscapeArg).join(' ')
        : ''

      const bashResponse = await this.env.BASHX.fetch('https://bashx.do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'run',
          params: {
            script: `${scriptCommand}${escapedArgs}`,
            options: { env: options?.env },
          },
        }),
      })

      const bashResult = (await bashResponse.json()) as { stdout?: string; stderr?: string; exitCode?: number }

      return {
        exitCode: bashResult.exitCode ?? 0,
        stdout: bashResult.stdout ?? '',
        stderr: bashResult.stderr ?? '',
        duration: Date.now() - start,
      }
    } catch (error) {
      const err = error as Error
      return {
        exitCode: 1,
        stdout: '',
        stderr: err.message,
        duration: Date.now() - start,
      }
    }
  }

  // ============================================================================
  // UTILITY
  // ============================================================================

  /**
   * List installed packages
   */
  async listInstalled(): Promise<Array<{ name: string; version: string }>> {
    if (!this.env.FSX) return []

    try {
      const response = await this.env.FSX.fetch('https://fsx.do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'readdir',
          params: { path: '/node_modules', withFileTypes: true },
        }),
      })

      if (!response.ok) return []

      const result = (await response.json()) as {
        entries: Array<{ name: string; type: string }>
      }

      const packages: Array<{ name: string; version: string }> = []

      for (const entry of result.entries) {
        if (entry.type === 'directory' && !entry.name.startsWith('.')) {
          const version = await this.getInstalledVersion(entry.name)
          if (version) {
            packages.push({ name: entry.name, version })
          }
        }
      }

      return packages
    } catch {
      return []
    }
  }

  /**
   * Clear package cache
   */
  clearCache(): void {
    this.packageCache.clear()
  }

  /**
   * Get cache statistics for monitoring.
   * Useful for debugging and monitoring cache effectiveness.
   *
   * @returns Cache statistics including hits, misses, evictions, and hit rate
   */
  getCacheStats(): CacheStats {
    return this.packageCache.getStats()
  }

  /**
   * Resize the package cache.
   * Use this to adjust cache size under memory pressure or increased load.
   *
   * @param maxSize - New maximum number of entries
   */
  setCacheSize(maxSize: number): void {
    this.packageCache.resize(maxSize)
  }

  /**
   * Reset cache statistics without clearing cached data.
   * Useful for starting a new measurement period.
   */
  resetCacheStats(): void {
    this.packageCache.resetStats()
  }

  // ============================================================================
  // CROSS-DO RESOLUTION
  // ============================================================================

  /**
   * Override createWorkflowContext to extend the base with a `resolve` method
   * for accessing cross-DO services with promise pipelining support.
   *
   * @example
   * ```typescript
   * const fsx = this.$.resolve('fsx.do')
   * const content = await fsx.fs.read('/package.json')
   * ```
   */
  protected override createWorkflowContext() {
    const baseContext = super.createWorkflowContext()
    const self = this

    // List of known properties for hasOwnProperty checks
    const knownProperties = new Set(['resolve'])

    // Create a proxy that extends the base context with resolve
    return new Proxy(baseContext, {
      get(target, prop, receiver) {
        if (prop === 'resolve') {
          // Return our resolve function that delegates to resolveService
          return (service: string) => self.resolveService(service)
        }
        // Delegate to base context
        return Reflect.get(target, prop, receiver)
      },
      has(target, prop) {
        if (knownProperties.has(String(prop))) {
          return true
        }
        return Reflect.has(target, prop)
      },
    })
  }

  /**
   * Resolve a cross-DO service by name.
   *
   * Returns a proxy object that captures method calls for promise pipelining.
   * The proxy builds up operation chains that can be batched into single
   * network round trips.
   *
   * @param service - Service name (e.g., 'fsx.do', 'bashx.do')
   * @returns Proxy object for the service
   */
  private resolveService(service: string): unknown {
    // For fsx.do, return a proxy that provides fs operations
    if (service === 'fsx.do' && this.fsxClient) {
      return {
        fs: {
          read: (path: string) => this.fsxClient!.readFile(path),
          write: (path: string, content: string) => this.fsxClient!.writeFile(path, content),
          readdir: (path: string) => this.fsxClient!.readdir(path),
        },
      }
    }

    // For bashx.do, return a proxy that provides shell operations
    if (service === 'bashx.do' && this.bashxClient) {
      return {
        exec: (command: string, args: string[]) => this.bashxClient!.exec(command, args),
        run: (script: string) => this.bashxClient!.run(script),
      }
    }

    // Return empty proxy for unknown services
    return {}
  }
}
