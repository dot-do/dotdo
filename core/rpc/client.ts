/**
 * RPC Client Factory
 *
 * Creates RPC clients for communicating with Durable Objects.
 * Supports both Cap'n Web RPC (WebSocket/HTTP batch) and standard
 * Cloudflare Workers RPC via stubs.
 *
 * Features:
 * - Promise pipelining (multiple calls in single round-trip)
 * - Session management and caching
 * - Authentication support
 * - WebSocket-first with HTTP batch fallback
 *
 * @module @dotdo/core/rpc/client
 */

// ============================================================================
// CAPNWEB COMPATIBILITY
// ============================================================================

/**
 * Session options for Cap'n Web RPC
 */
export type SessionOptions = {
  onSendError?: (error: Error) => Error | void
}

/**
 * Minimal type interface for capnweb functions.
 * This avoids importing capnweb's recursive types directly.
 */
interface CapnWebModule {
  newWebSocketRpcSession(webSocket: WebSocket | string, localMain?: unknown, options?: SessionOptions): unknown
  newHttpBatchRpcSession(url: string, options?: SessionOptions): unknown
}

// Dynamic import to avoid bundling issues in environments without capnweb
let capnweb: CapnWebModule | null = null

async function getCapnWeb(): Promise<CapnWebModule> {
  if (!capnweb) {
    try {
      const module = await import('capnweb')
      capnweb = module as unknown as CapnWebModule
    } catch {
      throw new Error('capnweb is required for RPC client functionality')
    }
  }
  return capnweb
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * RPC error structure
 */
export interface RpcError {
  code: string
  message: string
  data?: unknown
}

/**
 * RpcClient type - a Cap'n Web stub with full pipelining support
 */
export type RpcClient = {
  [key: string]: RpcClient & ((...args: unknown[]) => RpcClient)
} & PromiseLike<unknown> &
  Disposable & {
    dup(): RpcClient
    onRpcBroken(callback: (error: unknown) => void): void
  }

/**
 * RpcPromise - stub that also behaves as a pipelined promise
 */
export type RpcPromise<T> = RpcClient & Promise<T>

/**
 * Client options for authenticated connections
 */
export interface ClientOptions {
  /** Authentication token (added as Bearer token in Authorization header) */
  token?: string
  /** Custom headers to include in requests */
  headers?: Record<string, string>
  /** Session options passed to capnweb */
  sessionOptions?: SessionOptions
}

/**
 * SDK configuration
 */
export interface ClientConfig {
  /** Default namespace URL */
  namespace?: string
  /** Base URL for local development */
  localUrl?: string
  /** Whether we're in development mode */
  isDev?: boolean
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

/**
 * Active sessions keyed by namespace URL
 */
const sessions = new Map<string, RpcClient>()

/**
 * Default session options
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
 * Generate a cache key for session lookup
 */
function getSessionKey(namespace: string, options?: ClientOptions): string {
  const parts = [namespace]
  if (options?.token) {
    // Include a hash of the token to differentiate authenticated sessions
    parts.push(`token:${options.token.slice(0, 8)}`)
  }
  return parts.join('|')
}

/**
 * Get or create a session for a namespace URL
 */
async function getOrCreateSession(namespace: string, options?: ClientOptions): Promise<RpcClient> {
  const cacheKey = getSessionKey(namespace, options)

  // Check for existing session
  const existing = sessions.get(cacheKey)
  if (existing) {
    return existing
  }

  const capnwebModule = await getCapnWeb()

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
  // doesn't support custom headers
  if (hasCustomHeaders) {
    const request = new Request(namespace, { headers })
    stub = capnwebModule.newHttpBatchRpcSession(request as unknown as string, sessionOptions)
  } else if (typeof WebSocket !== 'undefined') {
    // WebSocket-first with HTTP batch fallback
    try {
      stub = capnwebModule.newWebSocketRpcSession(wsUrl, undefined, sessionOptions)
    } catch {
      stub = capnwebModule.newHttpBatchRpcSession(namespace, sessionOptions)
    }
  } else {
    // No WebSocket support, use HTTP batch
    stub = capnwebModule.newHttpBatchRpcSession(namespace, sessionOptions)
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
 *
 * @param namespace - The namespace URL
 * @param options - Optional client options (must match those used to create the session)
 */
export function disposeSession(namespace: string, options?: ClientOptions): void {
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
  sessions.forEach((session) => {
    session[Symbol.dispose]()
  })
  sessions.clear()
}

// ============================================================================
// CLIENT FACTORY
// ============================================================================

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
 * import { createClient } from '@dotdo/core/rpc'
 *
 * // Create a client for a specific namespace
 * const client = await createClient('https://startups.studio')
 *
 * // Promise pipelining - single round trip!
 * const email = await client.Customer('alice').profile.email
 *
 * // Authenticated connection
 * const authed = await createClient('https://api.example.com', { token: 'my-auth-token' })
 *
 * // Custom headers
 * const custom = await createClient('https://api.example.com', {
 *   headers: { 'X-Custom-Header': 'value' }
 * })
 * ```
 */
export async function createClient(namespace: string, options?: ClientOptions): Promise<RpcClient> {
  if (!namespace) {
    throw new Error('Namespace URL is required')
  }
  return getOrCreateSession(namespace, options)
}

/**
 * Synchronous client factory for use in environments where capnweb is pre-loaded.
 * Falls back to async initialization if capnweb is not yet loaded.
 *
 * Note: This returns a proxy that will lazily initialize the actual client.
 *
 * @param namespace - The namespace URL
 * @param options - Optional configuration
 * @returns An RPC client proxy
 */
export function createClientSync(namespace: string, options?: ClientOptions): RpcClient {
  if (!namespace) {
    throw new Error('Namespace URL is required')
  }

  // Create a lazy proxy that initializes on first access
  let clientPromise: Promise<RpcClient> | null = null
  let resolvedClient: RpcClient | null = null

  const initClient = async (): Promise<RpcClient> => {
    if (clientPromise === null) {
      clientPromise = getOrCreateSession(namespace, options)
    }
    const client = (await clientPromise) as RpcClient
    resolvedClient = client
    return client
  }

  // Return a proxy that forwards to the real client
  return new Proxy(function () {} as unknown as RpcClient, {
    get(_target, prop) {
      // Handle disposal
      if (prop === Symbol.dispose) {
        return () => disposeSession(namespace, options)
      }

      // Handle special properties
      if (prop === 'then') {
        return (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => {
          initClient().then(resolve, reject)
        }
      }

      if (prop === 'onRpcBroken') {
        return (callback: (error: unknown) => void) => {
          void initClient().then((client) => client.onRpcBroken(callback))
        }
      }

      if (prop === 'dup') {
        return async (): Promise<RpcClient> => {
          const client = await initClient() as RpcClient
          return client.dup()
        }
      }

      // If client is resolved, forward to it
      if (resolvedClient) {
        return resolvedClient[prop as string]
      }

      // Otherwise, create a chained proxy that waits for initialization
      return createChainedProxy(initClient, [prop as string])
    },

    apply(_target, _thisArg, args) {
      // Support direct call as alias for createClient
      if (args.length === 1 && typeof args[0] === 'string') {
        return createClientSync(args[0])
      }
      throw new Error('Client must be called with a namespace URL or used as a property accessor')
    },

    has() {
      return true
    },
  })
}

/**
 * Create a chained proxy for property access before client initialization
 */
function createChainedProxy(
  initClient: () => Promise<RpcClient>,
  chain: string[]
): RpcClient {
  return new Proxy(function () {} as unknown as RpcClient, {
    get(_target, prop) {
      if (prop === 'then') {
        // Resolve the chain when awaited
        return (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => {
          initClient()
            .then((client) => {
              let result: unknown = client
              for (const key of chain) {
                result = (result as Record<string, unknown>)[key]
                if (typeof result === 'function') {
                  result = result.bind(client)
                }
              }
              return result
            })
            .then(resolve, reject)
        }
      }

      return createChainedProxy(initClient, [...chain, prop as string])
    },

    apply(_target, _thisArg, args) {
      // Method call in chain - return a promise that resolves to the result
      const methodName = chain[chain.length - 1]!
      const objectChain = chain.slice(0, -1)

      return new Promise((resolve, reject) => {
        initClient()
          .then((client) => {
            let target: unknown = client
            for (const key of objectChain) {
              target = (target as Record<string, unknown>)[key]
            }
            const method = (target as Record<string, unknown>)[methodName]
            if (typeof method === 'function') {
              return method.apply(target, args)
            }
            throw new Error(`${methodName} is not a function`)
          })
          .then(resolve, reject)
      }) as unknown as RpcClient
    },

    has() {
      return true
    },
  })
}

// ============================================================================
// WORKERS RPC HELPERS
// ============================================================================

/**
 * Type for Durable Object stub with RPC methods
 */
export type DOStub<T = Record<string, unknown>> = DurableObjectStub & T

/**
 * Get a typed stub for calling DO RPC methods
 *
 * @param namespace - The DO namespace binding
 * @param id - The DO ID (string name or DurableObjectId)
 * @returns Typed DO stub
 *
 * @example
 * ```typescript
 * interface CustomerDO {
 *   getProfile(): Promise<{ name: string }>
 *   updateProfile(data: { name: string }): Promise<void>
 * }
 *
 * const stub = getStub<CustomerDO>(env.CUSTOMER_DO, 'alice')
 * const profile = await stub.getProfile()
 * ```
 */
export function getStub<T = Record<string, unknown>>(
  namespace: DurableObjectNamespace,
  id: string | DurableObjectId
): DOStub<T> {
  const doId = typeof id === 'string' ? namespace.idFromName(id) : id
  return namespace.get(doId) as DOStub<T>
}

/**
 * Get a stub by unique ID
 */
export function getStubById<T = Record<string, unknown>>(
  namespace: DurableObjectNamespace,
  hexId: string
): DOStub<T> {
  const doId = namespace.idFromString(hexId)
  return namespace.get(doId) as DOStub<T>
}

/**
 * Create a new unique DO and get its stub
 */
export function createStub<T = Record<string, unknown>>(
  namespace: DurableObjectNamespace
): DOStub<T> {
  const doId = namespace.newUniqueId()
  return namespace.get(doId) as DOStub<T>
}

// ============================================================================
// TYPE DECLARATIONS FOR CLOUDFLARE
// ============================================================================

// These are declared to avoid needing @cloudflare/workers-types as a dependency
declare global {
  interface DurableObjectStub {
    fetch(input: RequestInfo, init?: RequestInit): Promise<Response>
  }

  interface DurableObjectId {
    toString(): string
    equals(other: DurableObjectId): boolean
    name?: string
  }

  interface DurableObjectNamespace {
    idFromName(name: string): DurableObjectId
    idFromString(hexId: string): DurableObjectId
    newUniqueId(): DurableObjectId
    get(id: DurableObjectId): DurableObjectStub
  }
}
