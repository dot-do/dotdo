// RPC Client - connects to Workers/DOs
// Implements typed proxy for remote method invocation via fetch-based RPC
// Supports pluggable transports for different communication backends
// Includes Cap'n Proto-style promise pipelining for efficient RPC chaining

import { deserializeError, isRPCError, TransportError, type SerializedError } from './errors'
import type { Transport, RPCMessage, RPCResponse } from './transport/types'
import { PipelineBuilder, type PipelineRequest, type PipelineResponse } from './pipeline'
import { generateCorrelationId, CORRELATION_ID_HEADER } from './headers'

// Re-export for backward compatibility
export { generateCorrelationId, CORRELATION_ID_HEADER }

/**
 * Handles error responses from RPC calls by parsing structured errors
 * or falling back to generic error messages.
 *
 * @param response - The HTTP response object
 * @param correlationId - The correlation ID for this request
 * @param errorPrefix - Optional prefix for the fallback error message
 * @throws Deserialized RPCError if response contains structured error
 * @throws Generic Error if response is not ok and no structured error found
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
      if (isRPCError(e)) {
        throw e
      }
    }
    // Fallback to generic error
    throw new Error(`${errorPrefix}: ${response.status} [${responseCorrelationId}]`)
  }
}

/**
 * Options for creating an RPC client.
 *
 * @stable
 * @since 1.0.0
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
 * Type for a proxy handler that can be both accessed and called.
 * The function signature uses `unknown` return type to accommodate both
 * async and callable proxy targets.
 */
type ProxyableFunction = ((...args: unknown[]) => unknown) & Record<string, unknown>

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
 * Internal helper to create a method invoker function
 * The generic parameter R allows the return type to flow through when known
 */
function createMethodInvoker<R = unknown>(
  url: string,
  timeout: number,
  methodPath: string[],
  baseCorrelationId?: string
): (...args: unknown[]) => Promise<R> {
  return async (...args: unknown[]): Promise<R> => {
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

    await handleErrorResponse(response, correlationId)
    return response.json() as Promise<R>
  }
}

/**
 * Create a nested proxy that tracks the property path
 * This supports both flat APIs (client.greet()) and nested APIs (client.users.create())
 *
 * @typeParam T - The expected type at this point in the path (used for type inference)
 */
function createNestedProxy<T = unknown>(
  url: string,
  timeout: number,
  path: string[] = [],
  correlationId?: string
): T {
  // Use a typed proxy target that can be both accessed as an object and called as a function
  const proxyTarget: ProxyableFunction = Object.assign(
    () => {},
    {}
  )

  return new Proxy(proxyTarget, {
    get(_target: ProxyableFunction, prop: string | symbol): unknown {
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

    apply(_target: ProxyableFunction, _thisArg: unknown, args: unknown[]): Promise<unknown> {
      // When called as a function, invoke the RPC method
      return createMethodInvoker(url, timeout, path, correlationId)(...args)
    },
  }) as T
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
 * The generic parameter R allows the return type to flow through when known
 */
function createTransportMethodInvoker<R = unknown>(
  transport: Transport,
  methodPath: string[],
  baseCorrelationId?: string
): (...args: unknown[]) => Promise<R> {
  return async (...args: unknown[]): Promise<R> => {
    const method = methodPath.join('.')
    const correlationId = baseCorrelationId || generateCorrelationId()

    const message: RPCMessage = { method, args, correlationId }
    const response = await transport.send<R>(message)

    if (response.error) {
      throw deserializeError(response.error)
    }

    return response.result as R
  }
}

/**
 * Create a nested proxy that tracks the property path for transport-based client
 *
 * @typeParam T - The expected type at this point in the path (used for type inference)
 */
function createTransportNestedProxy<T = unknown>(
  transport: Transport,
  path: string[] = [],
  correlationId?: string
): T {
  // Use a typed proxy target that can be both accessed as an object and called as a function
  const proxyTarget: ProxyableFunction = Object.assign(
    () => {},
    {}
  )

  return new Proxy(proxyTarget, {
    get(_target: ProxyableFunction, prop: string | symbol): unknown {
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

    apply(_target: ProxyableFunction, _thisArg: unknown, args: unknown[]): Promise<unknown> {
      // When called as a function, invoke the RPC method
      return createTransportMethodInvoker(transport, path, correlationId)(...args)
    },
  }) as T
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
): RPCClientType<T> {
  const doId = isDurableObjectId(id) ? id : binding.idFromName(id)
  const stub = binding.get(doId)
  const baseCorrelationId = options?.correlationId

  // Create a method invoker that preserves type inference
  const createMethodProxy = <M>(methodName: string): M => {
    return (async (...args: unknown[]): Promise<unknown> => {
      // Generate a correlation ID for each request, or use the provided base correlation ID
      const correlationId = baseCorrelationId || generateCorrelationId()

      let response: Response
      try {
        response = await stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [CORRELATION_ID_HEADER]: correlationId,
          },
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
  // Lazy import to avoid circular dependencies
  let createDOToDoHeaders: typeof import('../do/auth').createDOToDoHeaders | null = null

  const doId = isDurableObjectId(id) ? id : binding.idFromName(id)
  const stub = binding.get(doId)
  const { correlationId: baseCorrelationId, sourceDoId } = options

  // Create a method invoker that preserves type inference
  const createMethodProxy = <M>(methodName: string): M => {
    return (async (...args: unknown[]): Promise<unknown> => {
      // Lazy load the auth module
      if (!createDOToDoHeaders) {
        const authModule = await import('../do/auth')
        createDOToDoHeaders = authModule.createDOToDoHeaders
      }

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

// ============================================================================
// Promise Pipelining Support
// ============================================================================

/**
 * Options for creating a client with pipelining support
 */
export interface PipelineClientOptions {
  /** Base URL of the RPC endpoint */
  url: string
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Optional correlation ID to use for all requests */
  correlationId?: string
}

/**
 * Client with pipeline support - allows chaining RPC calls in a single round trip
 */
export type ClientWithPipeline<T extends object> = T & {
  /**
   * Start a pipeline from a method call
   * Enables Cap'n Proto-style promise pipelining where chained calls are batched
   *
   * @example
   * ```typescript
   * // Instead of 2 round trips:
   * const user = await client.getUser('123')
   * const profile = await user.getProfile()
   *
   * // Use 1 round trip with pipelining:
   * const profile = await client.pipeline('getUser', '123').call('getProfile')
   * ```
   */
  pipeline<K extends keyof T>(
    method: K,
    ...args: T[K] extends (...a: infer A) => unknown ? A : never[]
  ): PipelineBuilder<T[K] extends (...a: unknown[]) => infer R ? Awaited<R> : never>
}

/**
 * Creates a typed proxy client with Cap'n Proto-style promise pipelining.
 *
 * This client extends the standard RPC client with a `pipeline()` method
 * that enables chaining multiple RPC calls into a single network round trip.
 *
 * @example
 * ```typescript
 * interface UserAPI {
 *   getUser(id: string): Promise<User>
 * }
 *
 * interface User {
 *   getProfile(): Promise<Profile>
 *   getOrders(): Promise<Order[]>
 * }
 *
 * const client = createClientWithPipeline<UserAPI>({ url: 'https://api.example.com' })
 *
 * // Traditional approach (2 round trips):
 * const user = await client.getUser('123')
 * // user is a plain object, no methods
 *
 * // With pipelining (1 round trip):
 * const profile = await client.pipeline('getUser', '123')
 *   .call('getProfile')
 *
 * // Chain multiple operations:
 * const avatarUrl = await client.pipeline('getUser', '123')
 *   .call('getProfile')
 *   .get('avatar')
 *   .get('url')
 * ```
 *
 * @param options - Configuration options
 * @returns A typed proxy with pipeline support
 */
export function createClientWithPipeline<T extends object>(
  options: PipelineClientOptions
): ClientWithPipeline<T> {
  const { url, timeout = 30000, correlationId } = options

  type ProxyHandlerTarget = Record<string, unknown>

  return new Proxy({} as ProxyHandlerTarget, {
    get(_target: ProxyHandlerTarget, prop: string | symbol): unknown {
      if (typeof prop === 'symbol') {
        return undefined
      }

      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return undefined
      }

      // Special pipeline method - properly typed to return PipelineBuilder with correct generic
      if (prop === 'pipeline') {
        return <K extends keyof T>(
          method: K,
          ...args: T[K] extends (...a: infer A) => unknown ? A : never[]
        ): PipelineBuilder<T[K] extends (...a: unknown[]) => infer R ? Awaited<R> : never> => {
          const pipelineOpts: { correlationId?: string; timeout?: number } = { timeout }
          if (correlationId) {
            pipelineOpts.correlationId = correlationId
          }
          return new PipelineBuilder(
            url,
            String(method),
            args as unknown[],
            pipelineOpts
          )
        }
      }

      // Regular method - create method invoker
      return createMethodInvoker(url, timeout, [prop], correlationId)
    }
  }) as ClientWithPipeline<T>
}

/**
 * Options for creating a DO stub with pipeline support
 */
export interface DOStubWithPipelineOptions extends DOStubOptions {
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
}

/**
 * DO stub with pipeline support
 */
export type DOStubWithPipeline<T extends object> = T & {
  /**
   * Start a pipeline from a method call on the Durable Object
   */
  pipeline<K extends keyof T>(
    method: K,
    ...args: T[K] extends (...a: infer A) => unknown ? A : never[]
  ): PipelineBuilder<T[K] extends (...a: unknown[]) => infer R ? Awaited<R> : never>
}

/**
 * Creates a typed proxy for a Durable Object stub with pipeline support.
 *
 * This enables Cap'n Proto-style promise pipelining for DO-to-DO calls,
 * reducing latency by batching chained operations into single requests.
 *
 * @example
 * ```typescript
 * interface CustomerDO {
 *   getAccount(): Promise<Account>
 * }
 *
 * interface Account {
 *   getBalance(): Promise<number>
 *   getTransactions(): Promise<Transaction[]>
 * }
 *
 * const customer = createDOStubWithPipeline<CustomerDO>(env.CUSTOMER, 'cust-123')
 *
 * // With pipelining (1 round trip):
 * const balance = await customer.pipeline('getAccount').call('getBalance')
 * ```
 *
 * @param binding - The DurableObjectNamespace binding
 * @param id - Either a string name or a DurableObjectId
 * @param options - Optional configuration
 * @returns A typed proxy with pipeline support
 */
export function createDOStubWithPipeline<T extends object>(
  binding: DurableObjectNamespace,
  id: string | DurableObjectId,
  options?: DOStubWithPipelineOptions
): DOStubWithPipeline<T> {
  const doId = isDurableObjectId(id) ? id : binding.idFromName(id)
  const stub = binding.get(doId)
  const baseCorrelationId = options?.correlationId
  const timeout = options?.timeout ?? 30000

  // Create a transport-like interface for the DO stub
  const doTransport: Transport = {
    async send<R>(message: RPCMessage): Promise<RPCResponse<R>> {
      const correlationId = message.correlationId || generateCorrelationId()

      let response: Response
      try {
        response = await stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [CORRELATION_ID_HEADER]: correlationId,
          },
          body: JSON.stringify({ method: message.method, args: message.args }),
        })
      } catch (error) {
        // Handle transport-level errors (DO stub failures, network issues, etc.)
        const transportError = TransportError.stubFailed(error instanceof Error ? error : new Error(String(error)))
        return {
          error: {
            code: transportError.code,
            message: transportError.message,
            type: transportError.name,
          },
          correlationId,
        }
      }

      if (!response.ok) {
        const responseCorrelationId = response.headers.get(CORRELATION_ID_HEADER) || correlationId
        // Try to parse the structured error response
        try {
          const errorBody = await response.json() as SerializedError & { correlationId?: string }
          if (errorBody.code && errorBody.message) {
            return { error: errorBody, correlationId: responseCorrelationId }
          }
        } catch (_e) {
          // If JSON parsing fails, fall through to generic error
        }
        // Fallback to generic error
        return {
          error: {
            code: 'INTERNAL_ERROR',
            message: `DO RPC error: ${response.status} [${responseCorrelationId}]`,
            type: 'InternalError',
          },
          correlationId: responseCorrelationId,
        }
      }

      const result = await response.json()
      return { result: result as R, correlationId }
    }
  }

  // Create a method invoker that preserves type inference
  const createMethodProxy = <M>(methodName: string): M => {
    return (async (...args: unknown[]): Promise<unknown> => {
      const correlationId = baseCorrelationId || generateCorrelationId()

      let response: Response
      try {
        response = await stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [CORRELATION_ID_HEADER]: correlationId,
          },
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
    get<K extends keyof T>(_target: ProxyHandlerTarget, prop: string | symbol): unknown {
      if (typeof prop === 'symbol') {
        return undefined
      }

      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return undefined
      }

      // Special pipeline method - properly typed to return PipelineBuilder with correct generic
      if (prop === 'pipeline') {
        return <PK extends keyof T>(
          method: PK,
          ...args: T[PK] extends (...a: infer A) => unknown ? A : never[]
        ): PipelineBuilder<T[PK] extends (...a: unknown[]) => infer R ? Awaited<R> : never> => {
          const pipelineOpts: { correlationId?: string; timeout?: number } = { timeout }
          if (baseCorrelationId) {
            pipelineOpts.correlationId = baseCorrelationId
          }
          return new PipelineBuilder(
            doTransport,
            String(method),
            args as unknown[],
            pipelineOpts
          )
        }
      }

      // Regular method - returns properly typed function
      return createMethodProxy<T[K]>(prop as string)
    }
  }) as DOStubWithPipeline<T>
}
