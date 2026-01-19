// RPC Client - connects to Workers/DOs
// Implements typed proxy for remote method invocation via fetch-based RPC

/**
 * Options for creating an RPC client
 */
export interface RPCClientOptions {
  /** Base URL of the RPC endpoint */
  url: string
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
}

/**
 * Internal helper to create a method invoker function
 */
function createMethodInvoker(
  url: string,
  timeout: number,
  methodPath: string[]
): (...args: unknown[]) => Promise<unknown> {
  return async (...args: unknown[]) => {
    const method = methodPath.join('.')
    const response = await fetch(`${url}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  path: string[] = []
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
      return createNestedProxy(url, timeout, [...path, prop])
    },

    apply(_, __, args: unknown[]) {
      // When called as a function, invoke the RPC method
      return createMethodInvoker(url, timeout, path)(...args)
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
  const { url, timeout = 30000 } = options

  return createNestedProxy(url, timeout) as T
}

/**
 * Type guard to check if a value is a DurableObjectId
 */
function isDurableObjectId(id: unknown): id is DurableObjectId {
  return typeof id === 'object' && id !== null && 'toString' in id && typeof id !== 'string'
}

/**
 * Creates a typed proxy for a Durable Object stub.
 *
 * This helper wraps a DurableObject binding and provides a typed interface
 * for calling methods on the DO via fetch-based RPC.
 *
 * @example
 * ```typescript
 * interface CounterDO {
 *   increment(): Promise<number>
 *   getValue(): Promise<number>
 * }
 *
 * // In a Worker
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     const counter = createDOStub<CounterDO>(env.COUNTER, 'my-counter')
 *     const value = await counter.increment()
 *     return new Response(`Count: ${value}`)
 *   }
 * }
 * ```
 *
 * @param binding - The DurableObjectNamespace binding
 * @param id - Either a string name or a DurableObjectId
 * @returns A typed proxy that forwards method calls to the DO
 */
export function createDOStub<T extends object>(
  binding: DurableObjectNamespace,
  id: string | DurableObjectId
): T {
  const doId = isDurableObjectId(id) ? id : binding.idFromName(id)
  const stub = binding.get(doId)

  return new Proxy({} as T, {
    get(_, prop: string | symbol) {
      // Don't intercept symbols or promise methods
      if (typeof prop === 'symbol') {
        return undefined
      }

      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return undefined
      }

      return async (...args: unknown[]) => {
        const response = await stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: prop, args }),
        })

        if (!response.ok) {
          throw new Error(`DO RPC error: ${response.status}`)
        }

        return response.json()
      }
    }
  })
}
