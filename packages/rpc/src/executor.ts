/**
 * @dotdo/rpc - Executor Implementations
 *
 * Provides different execution strategies for RPC calls.
 *
 * @module @dotdo/rpc/executor
 */

import type {
  Executor,
  MethodCall,
  CallResult,
  HTTPExecutorOptions,
} from './types.js'

// =============================================================================
// InMemoryExecutor
// =============================================================================

/**
 * In-memory executor that calls methods directly on a target object.
 *
 * Useful for testing and local development where no network is needed.
 *
 * @example
 * ```typescript
 * const target = {
 *   async getUser(id: string) {
 *     return { id, name: 'Alice' }
 *   }
 * }
 *
 * const executor = new InMemoryExecutor(target)
 * const proxy = createRpcProxy(executor)
 *
 * const user = await proxy.getUser('123')
 * // { id: '123', name: 'Alice' }
 * ```
 */
export class InMemoryExecutor implements Executor {
  private target: unknown

  constructor(target: unknown) {
    this.target = target
  }

  /**
   * Execute a method call by traversing the target object.
   */
  async execute(call: MethodCall): Promise<CallResult> {
    try {
      // Traverse the path to find the method
      let current: unknown = this.target
      const pathCopy = [...call.path]
      const methodName = pathCopy.pop()

      if (!methodName) {
        return {
          error: {
            code: 'INVALID_CALL',
            message: 'Method path cannot be empty',
          },
        }
      }

      // Navigate to the parent object
      for (const segment of pathCopy) {
        if (current == null || typeof current !== 'object') {
          return {
            error: {
              code: 'METHOD_NOT_FOUND',
              message: `Cannot access '${segment}' on ${typeof current}`,
            },
          }
        }
        current = (current as Record<string, unknown>)[segment]
      }

      // Get the method
      if (current == null || typeof current !== 'object') {
        return {
          error: {
            code: 'METHOD_NOT_FOUND',
            message: `Cannot access method '${methodName}' on ${typeof current}`,
          },
        }
      }

      const method = (current as Record<string, unknown>)[methodName]

      if (typeof method !== 'function') {
        return {
          error: {
            code: 'METHOD_NOT_FOUND',
            message: `'${call.path.join('.')}' is not a function (got ${typeof method})`,
          },
        }
      }

      // Call the method
      const result = await method.apply(current, call.args ?? [])

      return { result }
    } catch (error) {
      return {
        error: {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : String(error),
          data: error instanceof Error ? { stack: error.stack } : undefined,
        },
      }
    }
  }

  /**
   * Execute multiple calls (just runs them in parallel for in-memory).
   */
  async executeBatch(calls: MethodCall[]): Promise<CallResult[]> {
    return Promise.all(calls.map((call) => this.execute(call)))
  }
}

// =============================================================================
// HTTPExecutor
// =============================================================================

/**
 * HTTP executor that sends RPC calls to a remote endpoint.
 *
 * @example
 * ```typescript
 * const executor = new HTTPExecutor('https://api.example.com/rpc')
 * const proxy = createRpcProxy(executor)
 *
 * const user = await proxy.users.get('123')
 * ```
 */
export class HTTPExecutor implements Executor {
  private url: string
  private options: Required<HTTPExecutorOptions>

  constructor(url: string, options: HTTPExecutorOptions = {}) {
    this.url = url
    this.options = {
      fetch: options.fetch ?? globalThis.fetch,
      headers: options.headers ?? {},
      timeout: options.timeout ?? 30000,
    }
  }

  /**
   * Execute a single method call over HTTP.
   */
  async execute(call: MethodCall): Promise<CallResult> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.options.timeout
      )

      try {
        const response = await this.options.fetch(this.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...this.options.headers,
          },
          body: JSON.stringify(call),
          signal: controller.signal,
        })

        if (!response.ok) {
          return {
            error: {
              code: 'HTTP_ERROR',
              message: `HTTP ${response.status}: ${response.statusText}`,
              data: { status: response.status },
            },
          }
        }

        const result = await response.json()
        return result as CallResult
      } finally {
        clearTimeout(timeoutId)
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          error: {
            code: 'TIMEOUT',
            message: `Request timed out after ${this.options.timeout}ms`,
          },
        }
      }

      return {
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }

  /**
   * Execute multiple calls in a single HTTP request.
   */
  async executeBatch(calls: MethodCall[]): Promise<CallResult[]> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.options.timeout
      )

      try {
        const response = await this.options.fetch(this.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-RPC-Batch': 'true',
            ...this.options.headers,
          },
          body: JSON.stringify(calls),
          signal: controller.signal,
        })

        if (!response.ok) {
          const error = {
            code: 'HTTP_ERROR',
            message: `HTTP ${response.status}: ${response.statusText}`,
            data: { status: response.status },
          }
          return calls.map(() => ({ error }))
        }

        const results = await response.json()
        return results as CallResult[]
      } finally {
        clearTimeout(timeoutId)
      }
    } catch (error) {
      const errorResult = {
        error: {
          code: error instanceof Error && error.name === 'AbortError'
            ? 'TIMEOUT'
            : 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      }
      return calls.map(() => errorResult)
    }
  }
}
