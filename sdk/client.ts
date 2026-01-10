/**
 * dotdo Client SDK - Cap'n Web RPC Client
 *
 * Two ways to connect to DOs:
 *
 * 1. `$Context(ns)` - Factory for explicit namespace URL
 * 2. `$` - Pre-configured from do.config.ts or local dev
 *
 * @example
 * ```typescript
 * // Option 1: Explicit namespace
 * import { $Context } from 'dotdo'
 * const $ = $Context('https://startups.studio')
 * await $.Customer('alice')
 *
 * // Option 2: Auto-configured (from do.config.ts or local dev)
 * import { $ } from 'dotdo'
 * await $.Customer('alice')
 * ```
 *
 * @module sdk/client
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
 * Session options for all connections
 */
const defaultSessionOptions: SessionOptions = {
  onSendError: (error) => {
    // Redact stack traces in production
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
      return new Error(error.message)
    }
    return error
  },
}

/**
 * Get or create a session for a namespace URL
 * Uses WebSocket-first with HTTP batch fallback
 */
function getOrCreateSession(namespace: string): RpcClient {
  // Check for existing session
  const existing = sessions.get(namespace)
  if (existing) {
    return existing
  }

  // Namespace IS the endpoint (no /rpc suffix)
  const wsUrl = namespace.replace(/^http/, 'ws')

  let stub: unknown

  // WebSocket-first with HTTP batch fallback
  // Note: In browser environments, WebSocket connection errors are async,
  // so we can't synchronously detect failure. The stub handles reconnection.
  if (typeof WebSocket !== 'undefined') {
    try {
      stub = newWebSocketRpcSession(wsUrl, undefined, defaultSessionOptions)
    } catch {
      // WebSocket not available or immediate failure, use HTTP batch
      stub = newHttpBatchRpcSession(namespace, defaultSessionOptions)
    }
  } else {
    // No WebSocket support, use HTTP batch
    stub = newHttpBatchRpcSession(namespace, defaultSessionOptions)
  }

  // Cache the session
  const client = stub as RpcClient
  sessions.set(namespace, client)

  // Set up broken connection handler to clean up cache
  client.onRpcBroken(() => {
    sessions.delete(namespace)
  })

  return client
}

/**
 * Dispose of a session for a namespace
 * Useful for cleanup in tests or when switching namespaces
 */
export function disposeSession(namespace: string): void {
  const session = sessions.get(namespace)
  if (session) {
    session[Symbol.dispose]()
    sessions.delete(namespace)
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
 * @returns An RPC stub with full pipelining support
 *
 * @example
 * ```typescript
 * import { $Context } from 'dotdo'
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
 * ```
 */
export function $Context(namespace: string): RpcClient {
  if (!namespace) {
    throw new Error('Namespace URL is required')
  }
  return getOrCreateSession(namespace)
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
 * import { $ } from 'dotdo'
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
