/**
 * RPC utilities for Durable Objects
 *
 * Provides type-safe remote procedure calls with promise pipelining.
 *
 * @module @dotdo/workers/do
 */

/**
 * RPC request format
 */
export interface RPCRequest {
  method: string
  args: unknown[]
  id?: string
}

/**
 * RPC response format
 */
export interface RPCResponse {
  result?: unknown
  error?: {
    message: string
    code?: string
  }
  id?: string
}

/**
 * RPC client options
 */
export interface RPCClientOptions<T = unknown> {
  target: T
  timeout?: number
}

/**
 * Create a type-safe RPC client
 *
 * @param options - Client configuration
 * @returns Proxied client with type-safe method calls
 */
export function createRPCClient<T>(options: RPCClientOptions<T>): T {
  const { target, timeout } = options

  return new Proxy(target as object, {
    get(obj, prop) {
      const value = (obj as Record<string | symbol, unknown>)[prop]

      // If it's a function, wrap it to handle timeout
      if (typeof value === 'function') {
        return async (...args: unknown[]) => {
          if (timeout) {
            return Promise.race([
              value.apply(obj, args),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('RPC timeout')), timeout)
              ),
            ])
          }
          return value.apply(obj, args)
        }
      }

      return value
    },
  }) as T
}

/**
 * Send an RPC request
 *
 * @param stub - The DO stub to call
 * @param method - The method name
 * @param args - The arguments
 * @returns The response
 */
export async function sendRPCRequest(
  stub: unknown,
  method: string,
  args: unknown[]
): Promise<RPCResponse> {
  try {
    // If stub has the method, call it directly
    const stubObj = stub as Record<string, unknown>
    if (typeof stubObj[method] === 'function') {
      const result = await (stubObj[method] as Function)(...args)
      return { result }
    }

    // Otherwise, try to call via fetch
    if (typeof stubObj.fetch === 'function') {
      const request: RPCRequest = {
        method,
        args,
        id: `rpc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      }

      const response = await stubObj.fetch(
        new Request('https://internal/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        })
      )

      return response.json()
    }

    return { error: { message: `Method ${method} not found`, code: 'METHOD_NOT_FOUND' } }
  } catch (error) {
    return {
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        code: 'INTERNAL_ERROR',
      },
    }
  }
}
