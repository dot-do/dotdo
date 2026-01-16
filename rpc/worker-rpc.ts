/**
 * WorkerDO RPC Interface Mixin
 *
 * Provides a mixin pattern that adds RPC capabilities to any Durable Object class.
 * This enables BrokerDO to invoke methods on worker DOs via stub.rpcCall().
 *
 * Key features:
 * - Mixin pattern for flexibility - can be applied to any DO
 * - rpcCall() as the main entry point for BrokerDO
 * - Capability verification hook for subclasses
 * - /rpc POST endpoint for fetch-based RPC as alternative
 * - Proper error handling with descriptive messages
 */

import { DurableObject } from 'cloudflare:workers'
import {
  CallMessage,
  ReturnMessage,
  ErrorMessage,
  isCallMessage,
  generateBrokerMessageId,
} from './broker-protocol'

// =============================================================================
// Error Handling
// =============================================================================

/**
 * Standard RPC error codes
 */
export const RPC_ERROR_CODES = {
  METHOD_NOT_FOUND: 'METHOD_NOT_FOUND',
  CAPABILITY_INVALID: 'CAPABILITY_INVALID',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  INVALID_REQUEST: 'INVALID_REQUEST',
} as const

export type RpcErrorCode = (typeof RPC_ERROR_CODES)[keyof typeof RPC_ERROR_CODES]

/**
 * RPC-specific error class with error code
 */
export class RpcError extends Error {
  readonly code: RpcErrorCode

  constructor(message: string, code: RpcErrorCode) {
    super(message)
    this.name = 'RpcError'
    this.code = code
    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, RpcError.prototype)
  }
}

// =============================================================================
// Mixin Types
// =============================================================================

/**
 * Type for class constructor (minimal interface for testability)
 * Note: TypeScript mixin pattern requires any[] for constructor arguments
 * See: https://www.typescriptlang.org/docs/handbook/mixins.html
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T = object> = new (...args: any[]) => T

/**
 * Interface for RPC-enabled DO instances
 */
export interface RpcEnabled {
  /**
   * Generic RPC dispatcher - called by BrokerDO via stub.rpcCall()
   *
   * @param method - The method name to invoke
   * @param args - Arguments to pass to the method
   * @param capability - Optional capability token for authorization
   * @returns Promise resolving to the method's return value
   */
  rpcCall(method: string, args: unknown[], capability?: string): Promise<unknown>

  /**
   * Fetch handler for /rpc POST endpoint
   *
   * @param request - The incoming request with CallMessage in body
   * @returns Promise resolving to Response with ReturnMessage or ErrorMessage
   */
  handleRpcFetch(request: Request): Promise<Response>
}

// =============================================================================
// Core RPC Logic (Standalone for Testing)
// =============================================================================

/**
 * Core RPC handler that can be mixed into any class.
 * This is the testable core logic separated from the DurableObject dependency.
 */
export class RpcHandler implements RpcEnabled {
  /**
   * Generic RPC dispatcher - called by BrokerDO via stub.rpcCall()
   *
   * This is the main entry point for RPC calls. It:
   * 1. Verifies capability if provided
   * 2. Finds the method on this instance
   * 3. Calls and returns the result
   */
  async rpcCall(method: string, args: unknown[], capability?: string): Promise<unknown> {
    // 1. If capability provided, verify it
    if (capability) {
      this.verifyCapability(capability)
    }

    // 2. Find the method on this instance
    const fn = (this as unknown as Record<string, unknown>)[method]
    if (typeof fn !== 'function') {
      throw new RpcError(`Method not found: ${method}`, RPC_ERROR_CODES.METHOD_NOT_FOUND)
    }

    // 3. Call and return result (bind to preserve 'this' context)
    return fn.apply(this, args)
  }

  /**
   * Capability verification hook - subclasses override to implement actual verification
   *
   * Default implementation is a no-op, allowing public access.
   * Subclasses should throw RpcError with CAPABILITY_INVALID if verification fails.
   *
   * @param _token - The capability token to verify
   */
  protected verifyCapability(_token: string): void {
    // Default: no-op, subclasses implement actual verification
    // To require capabilities, override this method and throw on invalid tokens
  }

  /**
   * Fetch handler for /rpc POST endpoint
   *
   * Parses CallMessage from request body, invokes rpcCall, and returns
   * either ReturnMessage or ErrorMessage in the response.
   */
  async handleRpcFetch(request: Request): Promise<Response> {
    let messageId = generateBrokerMessageId()

    try {
      // Parse request body
      let body: unknown
      try {
        body = await request.json()
      } catch (_parseError) {
        return this.createErrorResponse(messageId, 'Invalid JSON in request body', RPC_ERROR_CODES.INVALID_REQUEST)
      }

      // Validate CallMessage structure
      if (!isCallMessage(body)) {
        return this.createErrorResponse(messageId, 'Invalid CallMessage structure', RPC_ERROR_CODES.INVALID_REQUEST)
      }

      // Use the message's ID for correlation
      messageId = body.id

      // Invoke the RPC call
      const result = await this.rpcCall(body.method, body.args, body.capability)

      // Return success response
      const returnMessage: ReturnMessage = {
        id: messageId,
        type: 'return',
        value: result,
      }

      return new Response(JSON.stringify(returnMessage), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      // Handle RpcError specially to preserve error code
      if (error instanceof RpcError) {
        return this.createErrorResponse(messageId, error.message, error.code)
      }

      // Handle generic errors
      const errorMessage = error instanceof Error ? error.message : String(error)
      return this.createErrorResponse(messageId, errorMessage, RPC_ERROR_CODES.INTERNAL_ERROR)
    }
  }

  /**
   * Helper to create error response
   */
  private createErrorResponse(id: string, error: string, code: RpcErrorCode): Response {
    const errorMessage: ErrorMessage = {
      id,
      type: 'error',
      error,
      code,
    }

    return new Response(JSON.stringify(errorMessage), {
      status: 200, // RPC errors return 200 with error in body
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

// =============================================================================
// Mixin Implementation
// =============================================================================

/**
 * Mixin that adds RPC methods to any class (including DurableObject subclasses)
 *
 * Usage:
 * ```typescript
 * class MyDO extends DurableObject {
 *   myMethod(arg: string): string {
 *     return `result: ${arg}`
 *   }
 * }
 *
 * const RpcEnabledDO = withRpcMethods(MyDO)
 * export { RpcEnabledDO as MyDO }
 * ```
 */
export function withRpcMethods<T extends Constructor>(Base: T) {
  return class RpcEnabledDO extends Base implements RpcEnabled {
    /**
     * Generic RPC dispatcher - called by BrokerDO via stub.rpcCall()
     */
    async rpcCall(method: string, args: unknown[], capability?: string): Promise<unknown> {
      // 1. If capability provided, verify it
      if (capability) {
        this.verifyCapability(capability)
      }

      // 2. Find the method on this instance
      const fn = (this as unknown as Record<string, unknown>)[method]
      if (typeof fn !== 'function') {
        throw new RpcError(`Method not found: ${method}`, RPC_ERROR_CODES.METHOD_NOT_FOUND)
      }

      // 3. Call and return result (bind to preserve 'this' context)
      return fn.apply(this, args)
    }

    /**
     * Capability verification hook - subclasses override to implement actual verification
     */
    protected verifyCapability(_token: string): void {
      // Default: no-op, subclasses implement actual verification
    }

    /**
     * Fetch handler for /rpc POST endpoint
     */
    async handleRpcFetch(request: Request): Promise<Response> {
      let messageId = generateBrokerMessageId()

      try {
        // Parse request body
        let body: unknown
        try {
          body = await request.json()
        } catch (_parseError) {
          return this.createErrorResponse(messageId, 'Invalid JSON in request body', RPC_ERROR_CODES.INVALID_REQUEST)
        }

        // Validate CallMessage structure
        if (!isCallMessage(body)) {
          return this.createErrorResponse(messageId, 'Invalid CallMessage structure', RPC_ERROR_CODES.INVALID_REQUEST)
        }

        // Use the message's ID for correlation
        messageId = body.id

        // Invoke the RPC call
        const result = await this.rpcCall(body.method, body.args, body.capability)

        // Return success response
        const returnMessage: ReturnMessage = {
          id: messageId,
          type: 'return',
          value: result,
        }

        return new Response(JSON.stringify(returnMessage), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        // Handle RpcError specially to preserve error code
        if (error instanceof RpcError) {
          return this.createErrorResponse(messageId, error.message, error.code)
        }

        // Handle generic errors
        const errorMessage = error instanceof Error ? error.message : String(error)
        return this.createErrorResponse(messageId, errorMessage, RPC_ERROR_CODES.INTERNAL_ERROR)
      }
    }

    /**
     * Helper to create error response
     */
    private createErrorResponse(id: string, error: string, code: RpcErrorCode): Response {
      const errorMessage: ErrorMessage = {
        id,
        type: 'error',
        error,
        code,
      }

      return new Response(JSON.stringify(errorMessage), {
        status: 200, // RPC errors return 200 with error in body
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }
}

// =============================================================================
// Standalone Class (DurableObject-based for production)
// =============================================================================

/**
 * Standalone RPC-enabled DO class for direct use
 *
 * Use this when you want to create a new DO class that has RPC support
 * without using the mixin pattern.
 *
 * Usage:
 * ```typescript
 * class MyWorker extends RpcWorkerDO {
 *   myMethod(): string {
 *     return 'result'
 *   }
 *
 *   protected verifyCapability(token: string): void {
 *     if (!this.isValidToken(token)) {
 *       throw new RpcError('Unauthorized', RPC_ERROR_CODES.CAPABILITY_INVALID)
 *     }
 *   }
 * }
 * ```
 */
export class RpcWorkerDO extends DurableObject implements RpcEnabled {
  /**
   * Generic RPC dispatcher - called by BrokerDO via stub.rpcCall()
   */
  async rpcCall(method: string, args: unknown[], capability?: string): Promise<unknown> {
    // 1. If capability provided, verify it
    if (capability) {
      this.verifyCapability(capability)
    }

    // 2. Find the method on this instance
    const fn = (this as unknown as Record<string, unknown>)[method]
    if (typeof fn !== 'function') {
      throw new RpcError(`Method not found: ${method}`, RPC_ERROR_CODES.METHOD_NOT_FOUND)
    }

    // 3. Call and return result
    return fn.apply(this, args)
  }

  /**
   * Capability verification hook - subclasses override to implement actual verification
   */
  protected verifyCapability(_token: string): void {
    // Default: no-op, subclasses implement
  }

  /**
   * Fetch handler for /rpc POST endpoint
   */
  async handleRpcFetch(request: Request): Promise<Response> {
    let messageId = generateBrokerMessageId()

    try {
      // Parse request body
      let body: unknown
      try {
        body = await request.json()
      } catch (_parseError) {
        return this.createErrorResponse(messageId, 'Invalid JSON in request body', RPC_ERROR_CODES.INVALID_REQUEST)
      }

      // Validate CallMessage structure
      if (!isCallMessage(body)) {
        return this.createErrorResponse(messageId, 'Invalid CallMessage structure', RPC_ERROR_CODES.INVALID_REQUEST)
      }

      // Use the message's ID for correlation
      messageId = body.id

      // Invoke the RPC call
      const result = await this.rpcCall(body.method, body.args, body.capability)

      // Return success response
      const returnMessage: ReturnMessage = {
        id: messageId,
        type: 'return',
        value: result,
      }

      return new Response(JSON.stringify(returnMessage), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      // Handle RpcError specially to preserve error code
      if (error instanceof RpcError) {
        return this.createErrorResponse(messageId, error.message, error.code)
      }

      // Handle generic errors
      const errorMessage = error instanceof Error ? error.message : String(error)
      return this.createErrorResponse(messageId, errorMessage, RPC_ERROR_CODES.INTERNAL_ERROR)
    }
  }

  /**
   * Helper to create error response
   */
  private createErrorResponse(id: string, error: string, code: RpcErrorCode): Response {
    const errorMessage: ErrorMessage = {
      id,
      type: 'error',
      error,
      code,
    }

    return new Response(JSON.stringify(errorMessage), {
      status: 200, // RPC errors return 200 with error in body
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
