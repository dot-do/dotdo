/**
 * @dotdo/client - Cap'n Web RPC Client SDK
 *
 * Two ways to connect to DOs:
 *
 * 1. `$Context(ns)` - Factory for explicit namespace URL
 * 2. `$` - Pre-configured from do.config.ts or local dev
 *
 * @example
 * ```typescript
 * // Option 1: Explicit namespace
 * import { $Context } from '@dotdo/client'
 * const $ = $Context('https://startups.studio')
 * await $.Customer('alice')
 *
 * // Option 2: Auto-configured (from do.config.ts or local dev)
 * import { $ } from '@dotdo/client'
 * await $.Customer('alice')
 * ```
 *
 * @module @dotdo/client
 */

import {
  newWebSocketRpcSession,
  newHttpBatchRpcSession,
  type SessionOptions,
} from './capnweb-compat.js'

// =============================================================================
// Types
// =============================================================================

/**
 * RPC error structure for backwards compatibility
 */
export interface RpcError {
  code: string
  message: string
  data?: unknown
}

/**
 * RpcClient - The type returned by $Context()
 * This is actually an RpcStub from capnweb with full pipelining support
 */
export type RpcClient = {
  // Allow arbitrary property access and method calls
  [key: string]: RpcClient & ((...args: unknown[]) => RpcClient)
} & PromiseLike<unknown> &
  Disposable & {
    dup(): RpcClient
    onRpcBroken(callback: (error: unknown) => void): void
  }

/**
 * RpcPromise - Re-export for backwards compatibility
 * In capnweb, stubs already behave as pipelined promises
 */
export type RpcPromise<T> = RpcClient & Promise<T>

/**
 * ChainStep - Kept for backwards compatibility but no longer used internally
 * @deprecated capnweb handles chaining internally
 */
export interface ChainStep {
  type: 'property' | 'call' | 'index'
  key?: string | symbol
  args?: unknown[]
}

// =============================================================================
// Session Management
// =============================================================================

/**
 * Active sessions keyed by namespace URL
 * Enables session reuse and proper disposal
 */
const sessions = new Map<string, RpcClient>()

/**
 * Create session options with production mode configuration
 * @param isProduction - Whether running in production mode
 */
function createSessionOptions(isProduction = false): SessionOptions {
  return {
    onSendError: (error) => {
      // Redact stack traces in production
      if (isProduction) {
        return new Error(error.message)
      }
      return error
    },
  }
}

/**
 * Session options for all connections (development mode by default)
 * For production, use $Context with isProduction option
 */
const defaultSessionOptions: SessionOptions = createSessionOptions(false)

/**
 * Context options for authenticated connections
 */
export interface ContextOptions {
  /** Authentication token (added as Bearer token in Authorization header) */
  token?: string
  /** Custom headers to include in requests */
  headers?: Record<string, string>
  /** Session options passed to capnweb */
  sessionOptions?: SessionOptions
}

/**
 * Generate a cache key for session lookup
 * Includes namespace and auth token to ensure different auth sessions are separate
 */
function getSessionKey(namespace: string, options?: ContextOptions): string {
  const parts = [namespace]
  if (options?.token) {
    // Include a hash of the token to differentiate authenticated sessions
    parts.push(`token:${options.token.slice(0, 8)}`)
  }
  return parts.join('|')
}

/**
 * Get or create a session for a namespace URL
 * Uses WebSocket-first with HTTP batch fallback
 */
function getOrCreateSession(namespace: string, options?: ContextOptions): RpcClient {
  const cacheKey = getSessionKey(namespace, options)

  // Check for existing session
  const existing = sessions.get(cacheKey)
  if (existing) {
    return existing
  }

  // Merge session options
  const sessionOptions: SessionOptions = {
    ...defaultSessionOptions,
    ...options?.sessionOptions,
  }

  // Build headers for authenticated requests
  const headers: Record<string, string> = {}
  if (options?.token) {
    headers['Authorization'] = `Bearer ${options.token}`
  }
  if (options?.headers) {
    Object.assign(headers, options.headers)
  }
  const hasCustomHeaders = Object.keys(headers).length > 0

  // Namespace IS the endpoint (no /rpc suffix)
  const wsUrl = namespace.replace(/^http/, 'ws')

  let stub: unknown

  // If we have custom headers, prefer HTTP batch since WebSocket in browsers
  // doesn't support custom headers. In Node.js, we could pass headers via
  // the WebSocket constructor options, but for consistency we use HTTP batch.
  if (hasCustomHeaders) {
    // Create a Request object with auth headers
    const request = new Request(namespace, {
      headers,
    })
    stub = newHttpBatchRpcSession(request as unknown as string, sessionOptions)
  } else if (typeof WebSocket !== 'undefined') {
    // WebSocket-first with HTTP batch fallback (no auth headers)
    // Note: In browser environments, WebSocket connection errors are async,
    // so we can't synchronously detect failure. The stub handles reconnection.
    try {
      stub = newWebSocketRpcSession(wsUrl, undefined, sessionOptions)
    } catch {
      // WebSocket not available or immediate failure, use HTTP batch
      stub = newHttpBatchRpcSession(namespace, sessionOptions)
    }
  } else {
    // No WebSocket support, use HTTP batch
    stub = newHttpBatchRpcSession(namespace, sessionOptions)
  }

  // Cache the session
  const client = stub as RpcClient
  sessions.set(cacheKey, client)

  // Set up broken connection handler to clean up cache
  client.onRpcBroken(() => {
    sessions.delete(cacheKey)
  })

  return client
}

/**
 * Dispose of a session for a namespace
 * Useful for cleanup in tests or when switching namespaces
 *
 * @param namespace - The namespace URL
 * @param options - Optional context options (must match those used to create the session)
 */
export function disposeSession(namespace: string, options?: ContextOptions): void {
  const cacheKey = getSessionKey(namespace, options)
  const session = sessions.get(cacheKey)
  if (session) {
    session[Symbol.dispose]()
    sessions.delete(cacheKey)
  }
}

/**
 * Dispose of all sessions
 */
export function disposeAllSessions(): void {
  sessions.forEach((session, namespace) => {
    session[Symbol.dispose]()
    sessions.delete(namespace)
  })
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * SDK configuration loaded from do.config.ts or environment
 */
export interface SdkConfig {
  /** Default namespace URL */
  namespace?: string
  /** Base URL for local development (default: http://localhost:8787) */
  localUrl?: string
  /** Whether we're in development mode */
  isDev?: boolean
}

// Global config cache
let _config: SdkConfig | null = null

/**
 * Get or load the SDK configuration
 */
function getConfig(): SdkConfig {
  if (_config) return _config

  // Check environment variables
  const namespace = typeof process !== 'undefined' ? process.env?.DOTDO_NAMESPACE : undefined
  const localUrl = typeof process !== 'undefined' ? process.env?.DOTDO_LOCAL_URL : undefined
  const isDev =
    typeof process !== 'undefined'
      ? process.env?.NODE_ENV === 'development' || process.env?.DOTDO_DEV === 'true'
      : false

  _config = {
    namespace,
    localUrl: localUrl || 'http://localhost:8787',
    isDev,
  }

  return _config
}

/**
 * Configure the SDK (call before using $)
 */
export function configure(config: SdkConfig): void {
  _config = { ...getConfig(), ...config }
}

/**
 * Get the effective namespace URL
 */
function getNamespace(): string {
  const config = getConfig()

  // In development, use local URL
  if (config.isDev) {
    return config.localUrl || 'http://localhost:8787'
  }

  // Use configured namespace
  if (config.namespace) {
    return config.namespace
  }

  // Fallback to local
  return config.localUrl || 'http://localhost:8787'
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Create an RPC client for a specific namespace URL.
 *
 * Uses WebSocket-first with HTTP batch fallback for optimal performance.
 * Cap'n Web provides automatic promise pipelining - multiple chained calls
 * execute in a single network round trip.
 *
 * @param namespace - The namespace URL (e.g., 'https://startups.studio')
 * @param options - Optional configuration including authentication
 * @returns An RPC stub with full pipelining support
 *
 * @example
 * ```typescript
 * import { $Context } from '@dotdo/client'
 *
 * // Create a client for a specific namespace
 * const $ = $Context('https://startups.studio')
 *
 * // Promise pipelining - single round trip!
 * const email = await $.Customer('alice').profile.email
 *
 * // Connect to multiple namespaces
 * const startup = $Context('https://startups.studio')
 * const platform = $Context('https://platform.do')
 *
 * // Authenticated connection
 * const authed = $Context('https://api.example.com', { token: 'my-auth-token' })
 *
 * // Custom headers
 * const custom = $Context('https://api.example.com', {
 *   headers: { 'X-Custom-Header': 'value' }
 * })
 * ```
 */
export function $Context(namespace: string, options?: ContextOptions): RpcClient {
  if (!namespace) {
    throw new Error('Namespace URL is required')
  }
  return getOrCreateSession(namespace, options)
}

/**
 * Pre-configured RPC client.
 *
 * Uses namespace from:
 * 1. do.config.ts (if present)
 * 2. DOTDO_NAMESPACE environment variable
 * 3. Local dev server (http://localhost:8787) in development
 *
 * Features automatic promise pipelining via Cap'n Web.
 *
 * @example
 * ```typescript
 * import { $ } from '@dotdo/client'
 *
 * // Promise pipelining - these all batch into one round trip
 * const [alice, bob] = await Promise.all([
 *   $.Customer('alice'),
 *   $.Customer('bob')
 * ])
 *
 * // Deep chaining with pipelining
 * await $.Customer('alice').orders.create({ product: 'widget' })
 * ```
 */
// Use a function as proxy target to support both property access and direct calls
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const $: RpcClient = new Proxy(function () {} as any, {
  get(_target, prop) {
    // Handle disposal
    if (prop === Symbol.dispose) {
      return () => {
        const namespace = getNamespace()
        disposeSession(namespace)
      }
    }

    // Lazily create/get the session on first property access
    const namespace = getNamespace()
    const client = getOrCreateSession(namespace)
    return client[prop as string]
  },
  apply(_target, _thisArg, args) {
    // Support $('CustomNamespace') as alias for $Context
    if (args.length === 1 && typeof args[0] === 'string') {
      return $Context(args[0])
    }
    throw new Error('$ must be called with a namespace URL or used as a property accessor')
  },
  has(_target, _prop) {
    // All properties potentially exist on the RPC stub
    return true
  },
})

// Default export - the pre-configured client
export default $

// =============================================================================
// Legacy Types - Preserved for backwards compatibility
// =============================================================================

/**
 * @deprecated Use RpcClient instead. These types are preserved for backwards
 * compatibility with the previous custom implementation.
 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed'

/**
 * @deprecated The capnweb-based implementation handles reconnection internally.
 */
export interface ReconnectConfig {
  maxAttempts?: number
  baseDelay?: number
  maxDelay?: number
  jitter?: number
}

/**
 * @deprecated Authentication is handled at the transport level by capnweb.
 */
export interface AuthConfig {
  token?: string
}

/**
 * @deprecated Use capnweb's native options instead. This interface is preserved
 * for backwards compatibility.
 */
export interface ClientConfig {
  timeout?: number
  batchWindow?: number
  maxBatchSize?: number
  batching?: boolean
  offlineQueueLimit?: number
  reconnect?: ReconnectConfig
  auth?: AuthConfig
}

/**
 * @deprecated Use RpcError instead.
 */
export interface RPCError {
  code: string
  message: string
  stage?: number
}

/**
 * @deprecated Subscriptions are handled differently in the capnweb implementation.
 */
export interface SubscriptionHandle {
  unsubscribe(): void
}

/**
 * @deprecated Pipelining is handled automatically by capnweb.
 */
export interface PipelineStep {
  method: string
  params: unknown[]
}

/**
 * @deprecated Use RpcClient instead. The DOClient type is preserved for
 * backwards compatibility with code that used the previous implementation.
 */
export type DOClient<TMethods, TEvents = Record<string, unknown>> = RpcClient

/**
 * @deprecated Use $Context instead. This function is preserved for backwards
 * compatibility with code that used the previous implementation.
 *
 * Note: The new implementation uses capnweb which provides true promise
 * pipelining. The config parameter is ignored as capnweb handles all
 * connection management internally.
 */
export function createClient<TMethods = Record<string, unknown>, TEvents = Record<string, unknown>>(
  url: string,
  _config?: ClientConfig
): DOClient<TMethods, TEvents> {
  return $Context(url) as DOClient<TMethods, TEvents>
}
