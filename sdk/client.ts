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

// =============================================================================
// Types
// =============================================================================

/**
 * A single step in the RPC chain.
 * - 'property': Property access like .profile
 * - 'call': Method call like .Customer('alice')
 * - 'index': Array index access like [0]
 */
export interface ChainStep {
  type: 'property' | 'call' | 'index'
  key?: string | symbol
  args?: unknown[]
}

/**
 * RPC request body sent to the /rpc endpoint
 */
interface RpcRequest {
  chain: ChainStep[]
}

/**
 * RPC response from the /rpc endpoint
 */
interface RpcResponse<T = unknown> {
  result?: T
  error?: RpcError
}

/**
 * RPC error structure
 */
export interface RpcError {
  code: string
  message: string
  data?: unknown
}

/**
 * RpcPromise - A thenable that executes the RPC chain on await
 */
export interface RpcPromise<T> extends PromiseLike<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2>

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null
  ): Promise<T | TResult>

  finally(onfinally?: (() => void) | null): Promise<T>
}

/**
 * RpcClient - The proxy returned by $()
 * Supports arbitrary property access and method calls
 */
export type RpcClient = {
  [key: string]: RpcClient & ((...args: unknown[]) => RpcClient & RpcPromise<unknown>)
} & RpcPromise<unknown>

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create an RPC proxy chain that tracks property accesses and method calls
 */
function createChainProxy(namespace: string, chain: ChainStep[]): RpcClient {
  // Create the thenable implementation
  const thenable: RpcPromise<unknown> = {
    then(onfulfilled, onrejected) {
      return executeChain(namespace, chain).then(onfulfilled, onrejected)
    },
    catch(onrejected) {
      return executeChain(namespace, chain).catch(onrejected)
    },
    finally(onfinally) {
      return executeChain(namespace, chain).finally(onfinally)
    },
  }

  // Create the proxy
  const proxy = new Proxy(function () {} as unknown as RpcClient, {
    // Property access: .profile, .email, etc.
    get(_target, prop) {
      // Handle Promise methods
      if (prop === 'then') {
        return thenable.then.bind(thenable)
      }
      if (prop === 'catch') {
        return thenable.catch.bind(thenable)
      }
      if (prop === 'finally') {
        return thenable.finally.bind(thenable)
      }

      // Handle Symbol properties gracefully
      if (typeof prop === 'symbol') {
        // Return appropriate values for well-known symbols
        if (prop === Symbol.toStringTag) {
          return 'RpcClient'
        }
        if (prop === Symbol.toPrimitive) {
          // Return a function that provides string representation
          return (hint: string) => {
            if (hint === 'string' || hint === 'default') {
              return '[RpcClient]'
            }
            if (hint === 'number') {
              return NaN
            }
            return null
          }
        }
        // For Symbol.iterator and others, return undefined
        return undefined
      }

      // Create a new chain with property access
      const newChain: ChainStep[] = [...chain, { type: 'property', key: prop }]
      return createChainProxy(namespace, newChain)
    },

    // Method call: .Customer('alice'), .update({ name: 'Bob' }), etc.
    apply(_target, _thisArg, args) {
      // If we have a property step at the end, convert it to a call
      if (chain.length > 0) {
        const lastStep = chain[chain.length - 1]
        if (lastStep.type === 'property') {
          // Convert the last property access to a call with args
          const newChain: ChainStep[] = [
            ...chain.slice(0, -1),
            { type: 'call', key: lastStep.key, args },
          ]
          return createChainProxy(namespace, newChain)
        }
      }

      // If the last step is already a call, this is a continuation
      // This shouldn't happen in normal usage, but handle gracefully
      const newChain: ChainStep[] = [...chain, { type: 'call', key: undefined, args }]
      return createChainProxy(namespace, newChain)
    },

    // Handle has checks (for 'then' in proxy, etc.)
    has(_target, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return true
      }
      return true // Allow all property checks
    },
  })

  return proxy
}

/**
 * Execute the RPC chain by sending it to the /rpc endpoint
 */
async function executeChain(namespace: string, chain: ChainStep[]): Promise<unknown> {
  const rpcUrl = `${namespace}/rpc`

  const request: RpcRequest = {
    chain: chain.map((step) => ({
      type: step.type,
      key: typeof step.key === 'symbol' ? step.key.toString() : step.key,
      args: step.args,
    })),
  }

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  const data = (await response.json()) as RpcResponse

  if (data.error) {
    throw data.error
  }

  return data.result
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
 * Use this when you need to explicitly specify the namespace,
 * or when connecting to multiple different DOs.
 *
 * @param namespace - The namespace URL (e.g., 'https://startups.studio')
 * @returns An RPC client proxy
 *
 * @example
 * ```typescript
 * import { $Context } from 'dotdo'
 *
 * // Create a client for a specific namespace
 * const $ = $Context('https://startups.studio')
 *
 * // Chain RPC calls
 * await $.Customer('alice').update({ name: 'Alice' })
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
  return createChainProxy(namespace, [])
}

/**
 * Pre-configured RPC client.
 *
 * Uses namespace from:
 * 1. do.config.ts (if present)
 * 2. DOTDO_NAMESPACE environment variable
 * 3. Local dev server (http://localhost:8787) in development
 *
 * @example
 * ```typescript
 * import { $ } from 'dotdo'
 *
 * // Automatically connects to configured namespace
 * await $.Customer('alice')
 * await $.things.create({ $type: 'Order', total: 100 })
 * ```
 */
export const $: RpcClient = new Proxy({} as RpcClient, {
  get(_target, prop) {
    // Lazily create the client on first property access
    const namespace = getNamespace()
    const client = createChainProxy(namespace, [])
    return (client as any)[prop]
  },
  apply(_target, _thisArg, args) {
    // Support $('CustomNamespace') as alias for $Context
    if (args.length === 1 && typeof args[0] === 'string') {
      return $Context(args[0])
    }
    throw new Error('$ must be called with a namespace URL or used as a property accessor')
  },
  has(_target, prop) {
    return true
  },
})

// Default export - the pre-configured client
export default $
