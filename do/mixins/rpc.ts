/**
 * RPC Mixin for Durable Objects
 *
 * Provides composable RPC functionality including:
 * - JSON-RPC style method invocation
 * - Cross-DO RPC via stub caching
 * - Error handling with proper RPC error types
 * - Method routing via dot notation
 *
 * @example
 * ```typescript
 * class MyDO extends WithRPC(BaseDO) {
 *   // Methods exposed via RPC
 *   async getProfile(userId: string) {
 *     return { id: userId, name: 'Alice' }
 *   }
 *
 *   // Call other DOs
 *   async notifyUser(userId: string) {
 *     const userDO = this.getDOStub('User', userId)
 *     return userDO.notify({ message: 'Hello!' })
 *   }
 * }
 * ```
 *
 * @module do/mixins/rpc
 */

import { Hono } from 'hono'
import { RPCError, NotFoundError, InternalError } from '@dotdo/rpc'
import {
  createDOAccessor,
  createDORPCProxy,
  type DOStubProxy,
  type DOStubFactory,
  type CrossDORPCConfig
} from '../workflow/rpc'
import type { Constructor } from './storage'
import { createLogger } from '../../utils/logger'

const logger = createLogger('[WithRPC]')

// =============================================================================
// Types
// =============================================================================

/**
 * Interface for classes that have RPC capabilities
 */
export interface HasRPC {
  /** Get a cached DO stub for cross-DO RPC */
  getDOStub(bindingName: string, id: string | DurableObjectId): DOStubProxy
  /** Check if a stub exists in cache */
  hasStub(bindingName: string, id: string | DurableObjectId): boolean
  /** Clear a specific stub from cache */
  clearStub(bindingName: string, id: string | DurableObjectId): boolean
  /** Clear all cached stubs */
  clearAllStubs(): void
  /** Get the number of cached stubs */
  getStubCount(): number
}

/**
 * Options for the WithRPC mixin
 */
export interface WithRPCOptions {
  /** Custom RPC endpoint path (default: '/rpc') */
  rpcPath?: string
  /** Enable debug logging for RPC calls */
  debug?: boolean
}

/**
 * RPC request body structure
 */
export interface RPCRequest {
  /** Method name (supports dot notation for nested access) */
  method: string
  /** Arguments to pass to the method */
  args: unknown[]
}

/**
 * RPC response structure
 */
export interface RPCResponse<T = unknown> {
  /** Result of the RPC call (if successful) */
  result?: T
  /** Error information (if failed) */
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

// =============================================================================
// Mixin Implementation
// =============================================================================

/**
 * RPC mixin that adds JSON-RPC style method invocation to a Durable Object.
 *
 * This mixin provides:
 * - RPC endpoint at `/rpc` (configurable)
 * - Cross-DO RPC via cached stubs
 * - Automatic method routing via dot notation
 * - Proper error handling with RPC error types
 *
 * @template TBase - The base class constructor type
 * @param Base - The base class to extend
 * @param options - Optional configuration for RPC behavior
 * @returns A new class with RPC capabilities
 *
 * @example
 * ```typescript
 * // Basic usage
 * class MyDO extends WithRPC(BaseDO) {
 *   // Public RPC methods
 *   async getData(key: string) {
 *     return this.storage.get(key)
 *   }
 *
 *   // Nested objects work too
 *   math = {
 *     add: (a: number, b: number) => a + b,
 *     multiply: (a: number, b: number) => a * b
 *   }
 * }
 *
 * // Client calls:
 * // POST /rpc { "method": "getData", "args": ["myKey"] }
 * // POST /rpc { "method": "math.add", "args": [1, 2] }
 *
 * // Cross-DO RPC
 * class OrderDO extends WithRPC(BaseDO) {
 *   async processOrder(orderId: string, customerId: string) {
 *     // Call another DO
 *     const customerStub = this.getDOStub('Customer', customerId)
 *     const customer = await customerStub.getProfile()
 *
 *     return { orderId, customer }
 *   }
 * }
 *
 * // Composing with other mixins
 * class FullFeatureDO extends WithRPC(WithStorage(BaseDO)) {
 *   // Has both RPC and storage capabilities
 * }
 * ```
 */
export function WithRPC<TBase extends Constructor>(
  Base: TBase,
  options: WithRPCOptions = {}
) {
  const { rpcPath = '/rpc', debug = false } = options

  return class RPCMixin extends Base implements HasRPC {
    private _stubCache: Map<string, DOStubProxy>
    private _rpcConfig: CrossDORPCConfig | null = null

    // Mixin constructors must use `any[]` to accept arbitrary base class constructor args
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)
      this._stubCache = new Map()
    }

    /**
     * Get the RPC configuration, lazily initialized with env
     */
    private getRPCConfig(env: unknown): CrossDORPCConfig {
      if (!this._rpcConfig) {
        this._rpcConfig = {
          env,
          stubCache: this._stubCache
        }
      }
      return this._rpcConfig
    }

    /**
     * Get a cached DO stub for cross-DO RPC calls.
     *
     * The stub proxies method calls to the target DO via RPC.
     * Stubs are cached to avoid creating multiple stubs for the same DO instance.
     *
     * @param bindingName - The DO binding name (e.g., 'Customer', 'Order')
     * @param id - The DO instance ID
     * @returns A proxy that forwards method calls to the target DO
     *
     * @example
     * ```typescript
     * // Get a stub for Customer DO
     * const customer = this.getDOStub('Customer', 'user-123')
     *
     * // Call methods on the remote DO
     * const profile = await customer.getProfile()
     * await customer.updateBalance({ amount: 100 })
     * ```
     */
    getDOStub(bindingName: string, id: string | DurableObjectId): DOStubProxy {
      // Get env from instance if available
      const env = (this as any).env ?? (this as any)._env
      if (!env) {
        throw new Error('Environment not available for RPC. Ensure env is passed to constructor.')
      }

      const config = this.getRPCConfig(env)
      const factory = createDOAccessor(config, bindingName)
      return factory(id)
    }

    /**
     * Check if a stub exists in the cache
     */
    hasStub(bindingName: string, id: string | DurableObjectId): boolean {
      const cacheKey = `${bindingName}:${typeof id === 'string' ? id : id.toString()}`
      return this._stubCache.has(cacheKey)
    }

    /**
     * Clear a specific stub from the cache
     */
    clearStub(bindingName: string, id: string | DurableObjectId): boolean {
      const cacheKey = `${bindingName}:${typeof id === 'string' ? id : id.toString()}`
      return this._stubCache.delete(cacheKey)
    }

    /**
     * Clear all cached stubs
     */
    clearAllStubs(): void {
      this._stubCache.clear()
    }

    /**
     * Get the number of cached stubs
     */
    getStubCount(): number {
      return this._stubCache.size
    }

    /**
     * Setup RPC routes on a Hono app.
     * Call this in your routes() method or constructor.
     *
     * @param app - The Hono app to add routes to
     *
     * @example
     * ```typescript
     * protected routes(app: Hono) {
     *   // Add RPC endpoint
     *   this.setupRPCRoutes(app)
     *
     *   // Add other routes
     *   app.get('/health', (c) => c.json({ status: 'ok' }))
     * }
     * ```
     */
    protected setupRPCRoutes(app: Hono): void {
      app.post(rpcPath, async (c) => {
        try {
          const { method, args } = await c.req.json<RPCRequest>()

          if (debug) {
            logger.debug(`Calling ${method} with args:`, args)
          }

          // Navigate to method using dot notation (e.g., "math.add" -> this.math.add)
          const parts = method.split('.')
          // Dynamic method lookup requires `any` for traversing arbitrary object properties
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let current: any = this

          for (let i = 0; i < parts.length - 1; i++) {
            current = current[parts[i]]
            if (!current) {
              const error = new NotFoundError(`Method not found: ${method}`)
              return c.json(error.toJSON(), error.httpStatus)
            }
          }

          const fn = current[parts[parts.length - 1]]
          if (typeof fn !== 'function') {
            const error = new NotFoundError(`Method not found: ${method}`)
            return c.json(error.toJSON(), error.httpStatus)
          }

          const result = await fn.apply(current, args)

          if (debug) {
            logger.debug(`${method} returned:`, result)
          }

          return c.json(result)
        } catch (error) {
          if (debug) {
            logger.debug('Error:', error)
          }

          // Re-throw RPCErrors with proper formatting
          if (error instanceof RPCError) {
            return c.json(error.toJSON(), error.httpStatus)
          }

          // Wrap unknown errors in InternalError
          const wrappedError = InternalError.wrap(error)
          logger.error('RPC error:', error)
          return c.json(wrappedError.toJSON(), wrappedError.httpStatus)
        }
      })
    }
  }
}

// =============================================================================
// Re-exports
// =============================================================================

export {
  createDOAccessor,
  createDORPCProxy,
  type DOStubProxy,
  type DOStubFactory,
  type CrossDORPCConfig
}

export { RPCError, NotFoundError, InternalError } from '@dotdo/rpc'
