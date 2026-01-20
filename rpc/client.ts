// RPC Client - connects to Workers/DOs
// Implements typed proxy for remote method invocation via fetch-based RPC
// Supports pluggable transports for different communication backends

import { SerializedError, deserializeError, isRPCError } from './errors'
import type { Transport, RPCMessage, RPCResponse } from './transport/types'
import { FetchTransport } from './transport/fetch'
import { StubTransport } from './transport/stub'

/**
 * Generate a unique correlation ID for request tracing
 * Uses crypto.randomUUID() when available, otherwise falls back to a timestamp-based ID
 */
export function generateCorrelationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback for environments without crypto.randomUUID
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`
}

/** Header name for correlation ID */
export const CORRELATION_ID_HEADER = 'X-Correlation-ID'

/**
 * Options for creating an RPC client
 */
export interface RPCClientOptions {
  /** Base URL of the RPC endpoint */
  url: string
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Optional correlation ID to use for all requests (if not provided, one is generated per request) */
  correlationId?: string
}

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
    // Generate a correlation ID for each request, or use the provided base correlation ID
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
      const responseCorrelationId = response.headers.get(CORRELATION_ID_HEADER) || correlationId
      // Try to parse the structured error response
      try {
        const errorBody = await response.json() as SerializedError & { correlationId?: string }
        if (errorBody.code && errorBody.message) {
          throw deserializeError(errorBody)
        }
      } catch (e) {
        // If it's already an RPCError from deserialization, re-throw it
        if (isRPCError(e)) {
          throw e
        }
      }
      // Fallback to generic error
      throw new Error(`RPC error: ${response.status} [${responseCorrelationId}]`)
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

// ============================================================================
// Transport-Based Client API
// ============================================================================

/**
 * Options for creating a transport-based RPC client
 */
export interface TransportClientOptions {
  /** The transport to use for RPC communication */
  transport: Transport
  /** Optional correlation ID to use for all requests */
  correlationId?: string
}

/**
 * Internal helper to create a method invoker for transport-based client
 */
function createTransportMethodInvoker(
  transport: Transport,
  methodPath: string[],
  baseCorrelationId?: string
): (...args: unknown[]) => Promise<unknown> {
  return async (...args: unknown[]) => {
    const method = methodPath.join('.')
    const correlationId = baseCorrelationId || generateCorrelationId()

    const message: RPCMessage = { method, args, correlationId }
    const response = await transport.send(message)

    if (response.error) {
      throw deserializeError(response.error)
    }

    return response.result
  }
}

/**
 * Create a nested proxy that tracks the property path for transport-based client
 */
function createTransportNestedProxy(
  transport: Transport,
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

      // Special property to access the underlying transport
      if (prop === '$transport') {
        return transport
      }

      // Return a nested proxy for property access
      return createTransportNestedProxy(transport, [...path, prop], correlationId)
    },

    apply(_, __, args: unknown[]) {
      // When called as a function, invoke the RPC method
      return createTransportMethodInvoker(transport, path, correlationId)(...args)
    },
  })
}

/**
 * Creates a typed proxy client that uses a transport for RPC communication.
 *
 * This is the new transport-based API that separates the transport layer
 * from the RPC protocol. Use this when you need more control over the
 * communication backend.
 *
 * @example
 * ```typescript
 * import { createClientWithTransport, FetchTransport } from '@dotdo/rpc'
 *
 * interface MyAPI {
 *   greet(name: string): Promise<string>
 *   users: {
 *     create(user: User): Promise<{ id: string }>
 *   }
 * }
 *
 * // Using fetch transport
 * const transport = new FetchTransport({ url: 'https://api.example.com' })
 * const client = createClientWithTransport<MyAPI>({ transport })
 *
 * const greeting = await client.greet('World')
 * const user = await client.users.create({ name: 'Alice' })
 *
 * // Access the underlying transport
 * const state = client.$transport.getState?.()
 * await client.$transport.close?.()
 * ```
 *
 * @param options - Configuration options including the transport
 * @returns A typed proxy that forwards method calls via the transport
 */
export function createClientWithTransport<T extends object>(options: TransportClientOptions): T & { $transport: Transport } {
  const { transport, correlationId } = options
  return createTransportNestedProxy(transport, [], correlationId) as T & { $transport: Transport }
}

/**
 * Type guard to check if a value is a DurableObjectId
 */
function isDurableObjectId(id: unknown): id is DurableObjectId {
  return typeof id === 'object' && id !== null && 'toString' in id && typeof id !== 'string'
}

/**
 * Options for creating a DO stub
 */
export interface DOStubOptions {
  /** Optional correlation ID to use for all requests */
  correlationId?: string
}

/**
 * Options for creating a secure DO-to-DO stub
 */
export interface SecureDOStubOptions extends DOStubOptions {
  /** Source DO ID for HMAC signing */
  sourceDoId: string
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
 * @param options - Optional configuration including correlation ID
 * @returns A typed proxy that forwards method calls to the DO
 */
export function createDOStub<T extends object>(
  binding: DurableObjectNamespace,
  id: string | DurableObjectId,
  options?: DOStubOptions
): T {
  const doId = isDurableObjectId(id) ? id : binding.idFromName(id)
  const stub = binding.get(doId)
  const baseCorrelationId = options?.correlationId

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
        // Generate a correlation ID for each request, or use the provided base correlation ID
        const correlationId = baseCorrelationId || generateCorrelationId()

        const response = await stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [CORRELATION_ID_HEADER]: correlationId,
          },
          body: JSON.stringify({ method: prop, args }),
        })

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
            if (isRPCError(e)) {
              throw e
            }
          }
          // Fallback to generic error
          throw new Error(`DO RPC error: ${response.status} [${responseCorrelationId}]`)
        }

        return response.json()
      }
    }
  })
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
): T {
  // Lazy import to avoid circular dependencies
  let createDOToDoHeaders: typeof import('../do/auth').createDOToDoHeaders | null = null

  const doId = isDurableObjectId(id) ? id : binding.idFromName(id)
  const stub = binding.get(doId)
  const { correlationId: baseCorrelationId, sourceDoId } = options

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
        // Lazy load the auth module
        if (!createDOToDoHeaders) {
          const authModule = await import('../do/auth')
          createDOToDoHeaders = authModule.createDOToDoHeaders
        }

        // Generate a correlation ID for each request, or use the provided base correlation ID
        const correlationId = baseCorrelationId || generateCorrelationId()

        // Create secure headers with HMAC signature
        const headers = await createDOToDoHeaders(sourceDoId, '/rpc', correlationId)

        const response = await stub.fetch('https://do/rpc', {
          method: 'POST',
          headers,
          body: JSON.stringify({ method: prop, args }),
        })

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
            if (isRPCError(e)) {
              throw e
            }
          }
          // Fallback to generic error
          throw new Error(`DO RPC error: ${response.status} [${responseCorrelationId}]`)
        }

        return response.json()
      }
    }
  })
}
