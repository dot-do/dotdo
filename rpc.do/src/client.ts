// RPC Client - creates typed proxy clients for remote method invocation
// Supports pluggable transports for different communication backends

import type { RPCClientOptions } from './types'
import { generateCorrelationId, CORRELATION_ID_HEADER } from './transport/fetch'

/**
 * Internal helper to create a method invoker function
 */
function createMethodInvoker(
  url: string,
  timeout: number,
  methodPath: string[],
  baseCorrelationId?: string
): (...args: unknown[]) => Promise<unknown> {
  return async (...args: unknown[]) => {
    const method = methodPath.join('.')
    const correlationId = baseCorrelationId || generateCorrelationId()

    const response = await fetch(`${url}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [CORRELATION_ID_HEADER]: correlationId,
      },
      body: JSON.stringify({ method, args }),
      signal: AbortSignal.timeout(timeout),
    })

    if (!response.ok) {
      throw new Error(`RPC error: ${response.status}`)
    }

    return response.json()
  }
}

/**
 * Create a nested proxy that tracks the property path
 * This supports both flat APIs (client.greet()) and nested APIs (client.users.create())
 */
function createNestedProxy(
  url: string,
  timeout: number,
  path: string[] = [],
  correlationId?: string
): unknown {
  return new Proxy(() => {}, {
    get(_, prop: string | symbol) {
      // Don't intercept symbols or promise methods (client should not be thenable)
      if (typeof prop === 'symbol') {
        return undefined
      }

      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return undefined // Not a promise
      }

      // Return a nested proxy for property access
      return createNestedProxy(url, timeout, [...path, prop], correlationId)
    },

    apply(_, __, args: unknown[]) {
      // When called as a function, invoke the RPC method
      return createMethodInvoker(url, timeout, path, correlationId)(...args)
    },
  })
}

/**
 * Creates a typed proxy client that forwards method calls via RPC.
 *
 * The client intercepts method calls and sends them as JSON-RPC requests to the
 * specified URL. It supports:
 * - Flat APIs: `client.greet('World')`
 * - Nested APIs: `client.users.create({ name: 'Alice' })`
 * - Configurable timeout via AbortSignal
 *
 * @example
 * ```typescript
 * interface MyAPI {
 *   greet(name: string): Promise<string>
 *   users: {
 *     create(user: User): Promise<{ id: string }>
 *   }
 * }
 *
 * const client = createClient<MyAPI>({ url: 'https://api.example.com' })
 * const greeting = await client.greet('World')
 * const user = await client.users.create({ name: 'Alice' })
 * ```
 *
 * @param options - Configuration options including URL and optional timeout
 * @returns A typed proxy that forwards method calls via RPC
 */
export function createClient<T extends object>(options: RPCClientOptions): T {
  const { url, timeout = 30000, correlationId } = options
  return createNestedProxy(url, timeout, [], correlationId) as T
}

/**
 * Creates a generic proxy that wraps a handler function.
 *
 * This is a low-level utility for creating RPC-like proxies where each
 * property access and method call is handled by the provided handler.
 *
 * @example
 * ```typescript
 * const proxy = createProxy((path, args) => {
 *   console.log(`Called ${path.join('.')} with`, args)
 *   return Promise.resolve({ success: true })
 * })
 *
 * await proxy.users.create({ name: 'Alice' })
 * // Logs: Called users.create with [{ name: 'Alice' }]
 * ```
 *
 * @param handler - Function to handle method calls
 * @returns A proxy object
 */
export function createProxy(
  handler: (path: string[], args: unknown[]) => Promise<unknown>
): object {
  function createNestedHandler(path: string[] = []): unknown {
    return new Proxy(() => {}, {
      get(_, prop: string | symbol) {
        if (typeof prop === 'symbol') {
          return undefined
        }

        if (prop === 'then' || prop === 'catch' || prop === 'finally') {
          return undefined
        }

        return createNestedHandler([...path, prop])
      },

      apply(_, __, args: unknown[]) {
        return handler(path, args)
      },
    })
  }

  return createNestedHandler() as object
}
