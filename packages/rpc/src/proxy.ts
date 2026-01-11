/**
 * @dotdo/rpc - Core Proxy Implementation
 *
 * Creates a recursive proxy that captures method calls and property accesses,
 * forwarding them to an executor for processing.
 *
 * @module @dotdo/rpc/proxy
 */

import type { Executor, MethodCall, ProxyConfig, CallResult, RpcError } from './types.js'

// =============================================================================
// RPC Error Class
// =============================================================================

/**
 * Error class for RPC failures with error code support.
 */
export class RpcProxyError extends Error {
  code: string
  data?: unknown

  constructor(code: string, message: string, data?: unknown) {
    super(message)
    this.name = 'RpcProxyError'
    this.code = code
    this.data = data
  }

  static fromRpcError(error: RpcError): RpcProxyError {
    return new RpcProxyError(error.code, error.message, error.data)
  }
}

// =============================================================================
// ID Generation
// =============================================================================

let callIdCounter = 0

/**
 * Generate a unique call ID.
 */
function generateCallId(): string {
  return String(++callIdCounter)
}

/**
 * Reset the call ID counter (useful for testing).
 */
export function resetCallIdCounter(): void {
  callIdCounter = 0
}

// =============================================================================
// Batching Support
// =============================================================================

interface PendingCall {
  call: MethodCall
  resolve: (result: unknown) => void
  reject: (error: Error) => void
}

/**
 * Manages batching of method calls.
 */
class BatchManager {
  private pending: PendingCall[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly executor: Executor
  private readonly windowMs: number
  private readonly maxSize: number

  constructor(executor: Executor, windowMs: number, maxSize: number) {
    this.executor = executor
    this.windowMs = windowMs
    this.maxSize = maxSize
  }

  /**
   * Add a call to the batch queue.
   */
  add(call: MethodCall): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending.push({ call, resolve, reject })

      // Flush if we hit max size
      if (this.pending.length >= this.maxSize) {
        this.flush()
        return
      }

      // Start timer if not already running
      if (!this.timer) {
        this.timer = setTimeout(() => this.flush(), this.windowMs)
      }
    })
  }

  /**
   * Flush all pending calls.
   */
  private async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    const batch = this.pending
    this.pending = []

    if (batch.length === 0) return

    try {
      const calls = batch.map((p) => p.call)
      const results = this.executor.executeBatch
        ? await this.executor.executeBatch(calls)
        : await Promise.all(calls.map((c) => this.executor.execute(c)))

      // Resolve each pending call
      for (let i = 0; i < batch.length; i++) {
        const { resolve, reject } = batch[i]
        const result = results[i]

        if (result.error) {
          reject(RpcProxyError.fromRpcError(result.error))
        } else {
          resolve(result.result)
        }
      }
    } catch (error) {
      // Reject all pending calls on batch failure
      const err = error instanceof Error ? error : new Error(String(error))
      for (const { reject } of batch) {
        reject(err)
      }
    }
  }
}

// =============================================================================
// Core Proxy Creation
// =============================================================================

/**
 * Create an RPC proxy that wraps method calls and forwards them to an executor.
 *
 * @typeParam T - The interface to proxy
 * @param executor - The executor that handles method calls
 * @param config - Optional configuration
 * @returns A proxy that implements the interface T
 *
 * @example
 * ```typescript
 * interface UserService {
 *   getUser(id: string): Promise<User>
 *   users: {
 *     list(): Promise<User[]>
 *   }
 * }
 *
 * const proxy = createRpcProxy<UserService>(executor)
 * const user = await proxy.getUser('123')
 * const users = await proxy.users.list()
 * ```
 */
export function createRpcProxy<T>(
  executor: Executor,
  config: ProxyConfig = {}
): T {
  const {
    maxDepth = 20,
    batching,
    generateId = generateCallId,
  } = config

  // Create batch manager if batching is enabled
  const batchManager = batching?.enabled
    ? new BatchManager(executor, batching.windowMs ?? 10, batching.maxSize ?? 100)
    : null

  /**
   * Execute a method call.
   */
  async function executeCall(call: MethodCall): Promise<unknown> {
    if (batchManager) {
      return batchManager.add(call)
    }

    try {
      const result = await executor.execute(call)

      if (result.error) {
        throw RpcProxyError.fromRpcError(result.error)
      }

      return result.result
    } catch (error) {
      if (error instanceof RpcProxyError) {
        throw error
      }
      throw new RpcProxyError(
        'EXECUTION_ERROR',
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  /**
   * Create a proxy node at a given path.
   */
  function createProxyNode(path: string[], depth: number): unknown {
    if (depth > maxDepth) {
      throw new Error(`Maximum proxy depth (${maxDepth}) exceeded`)
    }

    // Create a function target so we can intercept both property access and calls
    const target = function () {}

    return new Proxy(target, {
      /**
       * Handle property access - return nested proxy.
       */
      get(_target, prop): unknown {
        // Handle special properties
        if (prop === 'then' || prop === 'catch' || prop === 'finally') {
          // Not a promise - return undefined to allow async/await detection
          return undefined
        }

        if (typeof prop === 'symbol') {
          return undefined
        }

        // Create nested proxy for the property
        return createProxyNode([...path, String(prop)], depth + 1)
      },

      /**
       * Handle method calls - execute the RPC call.
       */
      apply(_target, _thisArg, args): Promise<unknown> {
        const call: MethodCall = {
          id: generateId(),
          path,
          args,
        }

        return executeCall(call)
      },

      /**
       * Support 'in' operator.
       */
      has(): boolean {
        return true
      },
    })
  }

  // Start with empty path at depth 0
  return createProxyNode([], 0) as T
}
