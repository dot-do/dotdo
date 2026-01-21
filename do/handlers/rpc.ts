/**
 * RPC Handler
 *
 * Handles all RPC-related operations for a DO:
 * - /rpc endpoint for method calls
 * - Method resolution via dot notation
 * - Error handling and logging
 * - Authentication for sensitive methods (_eval, etc)
 *
 * @module do/handlers/rpc
 */

import type { Hono } from 'hono'
import { RPCError, NotFoundError, InternalError, AuthenticationError } from '@dotdo/rpc'
import { createLogger } from '../../utils/logger'
import type { DOHandler } from './registry'
import { extractCallerInfoWithVerification } from '../auth'

const logger = createLogger('[RPCHandler]')

/**
 * Methods that require authentication
 * These are privileged operations that should not be called anonymously
 */
const AUTH_REQUIRED_METHODS = new Set(['_eval'])

/**
 * Options for creating an RPCHandler
 */
export interface RPCHandlerOptions {
  /** Custom RPC endpoint path (default: '/rpc') */
  rpcPath?: string
  /** Enable debug logging */
  debug?: boolean
}

/**
 * Context object for RPC method resolution
 */
export interface RPCContext {
  /** The target object to resolve methods on */
  target: Record<string, unknown>
}

/**
 * Handler for all RPC operations in a DO.
 *
 * Sets up RPC endpoints on a Hono app and handles method resolution.
 *
 * @example
 * ```typescript
 * const handler = new RPCHandler({ rpcPath: '/rpc' })
 *
 * // Setup routes on Hono app
 * handler.setupRoutes(app, { target: this })
 * ```
 */
export class RPCHandler implements DOHandler {
  readonly name = 'rpc'
  private rpcPath: string
  private debug: boolean

  constructor(options: RPCHandlerOptions = {}) {
    this.rpcPath = options.rpcPath ?? '/rpc'
    this.debug = options.debug ?? false
  }

  /**
   * Setup RPC routes on a Hono app.
   *
   * @param app - The Hono app to add routes to
   * @param context - The RPC context for method resolution
   */
  setupRoutes(app: Hono, context: RPCContext): void {
    app.post(this.rpcPath, async (c) => {
      let method = ''
      let args: unknown[] = []

      try {
        const body = await c.req.json<{ method: string; args: unknown[] }>()
        method = body.method
        args = body.args

        if (this.debug) {
          logger.debug(`Calling ${method} with args:`, args)
        }

        // Check if method requires authentication
        if (AUTH_REQUIRED_METHODS.has(method)) {
          const callerInfo = await extractCallerInfoWithVerification(c.req.raw)

          // Reject unauthenticated/untrusted callers
          if (callerInfo.type === 'unknown' || !callerInfo.trusted) {
            // For user type, they might have a valid token but just haven't been verified yet
            if (callerInfo.type !== 'user') {
              throw new AuthenticationError(`Method ${method} requires authentication`)
            }
          }

          // For methods that accept request as second arg (like _eval), pass it
          if (method === '_eval') {
            args = [args[0], c.req.raw]
          }
        }

        const result = await this.resolveAndCall(context.target, method, args)

        if (this.debug) {
          logger.debug(`${method} returned:`, result)
        }

        return c.json(result)
      } catch (error) {
        if (this.debug) {
          logger.error('RPC error:', error)
        }

        if (error instanceof RPCError) {
          return c.json(error.toJSON(), error.httpStatus)
        }

        const wrappedError = InternalError.wrap(error)
        logger.error('RPC error:', error)
        return c.json(wrappedError.toJSON(), wrappedError.httpStatus)
      }
    })
  }

  /**
   * Resolve a method by dot notation and call it.
   *
   * @param target - The object to resolve the method on
   * @param method - The method name (supports dot notation like "things.create")
   * @param args - The arguments to pass to the method
   * @returns The result of the method call
   * @throws NotFoundError if the method is not found
   */
  private async resolveAndCall(
    target: Record<string, unknown>,
    method: string,
    args: unknown[]
  ): Promise<unknown> {
    const parts = method.split('.')
    let current = target as Record<string, unknown>

    // Navigate to the parent object
    for (let i = 0; i < parts.length - 1; i++) {
      const next = current[parts[i]]
      if (!next || typeof next !== 'object') {
        throw new NotFoundError(`Method not found: ${method}`)
      }
      current = next as Record<string, unknown>
    }

    // Get the final method
    const fn = current[parts[parts.length - 1]]
    if (typeof fn !== 'function') {
      throw new NotFoundError(`Method not found: ${method}`)
    }

    return (fn as Function).apply(current, args)
  }
}
