/**
 * @dotdo/rpc/secure - Secure DO-to-DO RPC with HMAC signing
 *
 * This module provides secure RPC stubs that include HMAC signatures for
 * DO-to-DO calls. It is a separate entrypoint because it depends on @dotdo/auth.
 *
 * Layer architecture:
 * - @dotdo/rpc (Layer 0): Core RPC functionality, no auth dependency
 * - @dotdo/rpc/secure (Layer 0.5): RPC + Auth integration
 * - @dotdo/auth (Layer 1): Authentication utilities
 *
 * @module @dotdo/rpc/secure
 *
 * @example
 * ```typescript
 * import { createSecureDOStub } from '@dotdo/rpc/secure'
 *
 * // In a Durable Object
 * class MyDO extends DurableObject {
 *   async doWork() {
 *     const other = createSecureDOStub<OtherDO>(
 *       this.env.OTHER_DO,
 *       'target-id',
 *       { sourceDoId: this.ctx.id.toString() }
 *     )
 *     return await other.process({ key: 'value' })
 *   }
 * }
 * ```
 */

import { deserializeError, TransportError } from './errors'
import type { SerializedError } from './errors'
import { generateCorrelationId, CORRELATION_ID_HEADER } from './headers'
import { createDOToDoHeaders } from '@dotdo/auth'

/**
 * Type guard to check if a value is a DurableObjectId.
 *
 * Uses multiple checks to ensure the value is a real DurableObjectId:
 * 1. Must be a non-null object
 * 2. Must have an `equals` method (unique to DurableObjectId)
 * 3. Must have a `toString` method
 * 4. Must have a `name` property (present on all DurableObjectIds)
 * 5. The `toString()` result must be a non-empty string (real IDs return hex strings)
 */
function isDurableObjectId(id: unknown): id is DurableObjectId {
  if (typeof id !== 'object' || id === null) {
    return false
  }

  const candidate = id as DurableObjectId

  // Check required methods exist
  if (typeof candidate.equals !== 'function' || typeof candidate.toString !== 'function') {
    return false
  }

  // Real DurableObjectIds have a 'name' property (may be undefined but property exists)
  if (!('name' in candidate)) {
    return false
  }

  // Additional validation: toString() should return a non-empty string
  // Real DurableObjectIds return 64-character hex strings
  try {
    const str = candidate.toString()
    if (typeof str !== 'string' || str.length === 0) {
      return false
    }
  } catch {
    // If toString() throws, it's not a valid DurableObjectId
    return false
  }

  return true
}

/**
 * Helper type that maps an interface to its RPC-callable methods.
 * Preserves method signatures for proper type inference in proxies.
 */
type RPCMethods<T> = {
  [K in keyof T as T[K] extends (...args: infer _A) => Promise<infer _R> ? K : never]:
    T[K] extends (...args: infer A) => Promise<infer R>
      ? (...args: A) => Promise<R>
      : never
}

/**
 * Helper type that extracts nested namespaces from an interface.
 * Used for supporting nested API structures like client.users.create()
 */
type RPCNested<T> = {
  [K in keyof T as T[K] extends (...args: unknown[]) => unknown
    ? never
    : T[K] extends object
      ? K
      : never]: T[K] extends object ? RPCMethods<T[K]> & RPCNested<T[K]> : never
}

/**
 * Combined RPC client type that includes both methods and nested namespaces
 */
type RPCClientType<T> = RPCMethods<T> & RPCNested<T>

/**
 * Options for creating a secure DO-to-DO stub
 */
export interface SecureDOStubOptions {
  /** Source DO ID for HMAC signing */
  sourceDoId: string
  /** Optional correlation ID to use for all requests */
  correlationId?: string
}

/**
 * Handles error responses from RPC calls by parsing structured errors
 * or falling back to generic error messages.
 */
async function handleErrorResponse(
  response: Response,
  correlationId: string,
  errorPrefix = 'RPC error'
): Promise<void> {
  if (!response.ok) {
    const responseCorrelationId = response.headers.get(CORRELATION_ID_HEADER) || correlationId
    // Try to parse the structured error response
    try {
      const errorBody = await response.json() as SerializedError & { correlationId?: string }
      if (errorBody.code && errorBody.message) {
        throw deserializeError(errorBody)
      }
    } catch (e) {
      // If it's already an RPCError from deserialization, re-throw it
      if (e && typeof e === 'object' && 'code' in e) {
        throw e
      }
    }
    // Fallback to typed error with correlation context
    throw new Error(`${errorPrefix}: ${response.status} [${responseCorrelationId}]`)
  }
}

/**
 * Creates a secure typed proxy for DO-to-DO calls with HMAC signing.
 *
 * This version of createDOStub includes HMAC signatures in all requests,
 * which prevents header spoofing attacks. The receiving DO must have
 * DO_INTERNAL_SECRET configured and will verify the signature.
 *
 * @example
 * ```typescript
 * interface OtherDO {
 *   process(data: Data): Promise<Result>
 * }
 *
 * // In a Durable Object
 * class MyDO extends DurableObject {
 *   async doWork() {
 *     const other = createSecureDOStub<OtherDO>(
 *       this.env.OTHER_DO,
 *       'target-id',
 *       { sourceDoId: this.ctx.id.toString() }
 *     )
 *     return await other.process({ key: 'value' })
 *   }
 * }
 * ```
 *
 * @param binding - The DurableObjectNamespace binding
 * @param id - Either a string name or a DurableObjectId
 * @param options - Configuration including source DO ID for signing
 * @returns A typed proxy that forwards method calls to the DO with HMAC signing
 */
export function createSecureDOStub<T extends object>(
  binding: DurableObjectNamespace,
  id: string | DurableObjectId,
  options: SecureDOStubOptions
): RPCClientType<T> {
  const doId = isDurableObjectId(id) ? id : binding.idFromName(id)
  const stub = binding.get(doId)
  const { correlationId: baseCorrelationId, sourceDoId } = options

  // Create a method invoker that preserves type inference
  const createMethodProxy = <M>(methodName: string): M => {
    return (async (...args: unknown[]): Promise<unknown> => {
      // Generate a correlation ID for each request, or use the provided base correlation ID
      const correlationId = baseCorrelationId || generateCorrelationId()

      // Create secure headers with HMAC signature
      const headers = await createDOToDoHeaders(sourceDoId, '/rpc', correlationId)

      let response: Response
      try {
        response = await stub.fetch('https://do/rpc', {
          method: 'POST',
          headers,
          body: JSON.stringify({ method: methodName, args }),
        })
      } catch (error) {
        // Handle transport-level errors (DO stub failures, network issues, etc.)
        throw TransportError.stubFailed(error instanceof Error ? error : new Error(String(error)))
      }

      await handleErrorResponse(response, correlationId, 'DO RPC error')
      return response.json()
    }) as M
  }

  type ProxyHandlerTarget = Record<string, unknown>

  return new Proxy({} as ProxyHandlerTarget, {
    get<K extends keyof T>(_target: ProxyHandlerTarget, prop: string | symbol): T[K] | undefined {
      // Don't intercept symbols or promise methods
      if (typeof prop === 'symbol') {
        return undefined
      }

      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return undefined
      }

      return createMethodProxy<T[K]>(prop)
    }
  }) as RPCClientType<T>
}
