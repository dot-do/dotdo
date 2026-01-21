// Typed RPC Client - provides full type inference for DO method calls
// Uses TypeScript utility types to infer methods, parameters, and return types from DO classes

import { generateCorrelationId, CORRELATION_ID_HEADER } from './headers'
import { deserializeError, isRPCError, type SerializedError } from './errors'
import type {
  RPCClient,
  RPCClientWithOptions,
  RPCCallOptions,
  MethodKeys,
} from './types'

/**
 * Options for creating a typed RPC client
 */
export interface TypedClientOptions {
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Optional base correlation ID to use for all requests */
  correlationId?: string
  /** Base URL for fetch-based RPC (optional, used when not using a DO stub) */
  url?: string
}

/**
 * Internal helper to make RPC calls via a DO stub
 */
async function invokeViaStub(
  stub: DurableObjectStub,
  method: string,
  args: unknown[],
  options: { timeout?: number; correlationId?: string; headers?: Record<string, string> }
): Promise<unknown> {
  const correlationId = options.correlationId || generateCorrelationId()
  const timeout = options.timeout ?? 30000

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    [CORRELATION_ID_HEADER]: correlationId,
    ...options.headers,
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await stub.fetch('https://do/rpc', {
      method: 'POST',
      headers,
      body: JSON.stringify({ method, args }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const responseCorrelationId = response.headers.get(CORRELATION_ID_HEADER) || correlationId
      // Try to parse the structured error response
      try {
        const errorBody = (await response.json()) as SerializedError & { correlationId?: string }
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
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Internal helper to make RPC calls via fetch
 */
async function invokeViaFetch(
  url: string,
  methodPath: string[],
  args: unknown[],
  options: { timeout?: number; correlationId?: string; headers?: Record<string, string> }
): Promise<unknown> {
  const method = methodPath.join('.')
  const correlationId = options.correlationId || generateCorrelationId()
  const timeout = options.timeout ?? 30000

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    [CORRELATION_ID_HEADER]: correlationId,
    ...options.headers,
  }

  const response = await fetch(`${url}/rpc`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ method, args }),
    signal: AbortSignal.timeout(timeout),
  })

  if (!response.ok) {
    const responseCorrelationId = response.headers.get(CORRELATION_ID_HEADER) || correlationId
    // Try to parse the structured error response
    try {
      const errorBody = (await response.json()) as SerializedError & { correlationId?: string }
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

/**
 * Creates a nested proxy for property path tracking (for nested APIs)
 */
function createNestedProxyForFetch(
  url: string,
  path: string[],
  options: TypedClientOptions
): unknown {
  return new Proxy(() => {}, {
    get(_, prop: string | symbol) {
      // Don't intercept symbols or promise methods
      if (typeof prop === 'symbol') return undefined
      if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined

      return createNestedProxyForFetch(url, [...path, prop], options)
    },

    apply(_, __, args: unknown[]) {
      // Build options object without undefined values (for exactOptionalPropertyTypes)
      const invokeOptions: { timeout?: number; correlationId?: string } = {}
      if (options.timeout !== undefined) invokeOptions.timeout = options.timeout
      if (options.correlationId !== undefined) invokeOptions.correlationId = options.correlationId
      return invokeViaFetch(url, path, args, invokeOptions)
    },
  })
}

/**
 * Creates a typed RPC client from a DurableObjectStub.
 *
 * This function provides full type inference for:
 * - Available method names (autocomplete in IDE)
 * - Method parameter types
 * - Method return types
 *
 * The client infers methods directly from the DO class type parameter,
 * providing compile-time type safety for all RPC calls.
 *
 * @example
 * ```typescript
 * // Define your DO with typed methods
 * class CustomerDO {
 *   async getProfile(id: string): Promise<Profile> { ... }
 *   async updateEmail(id: string, email: string): Promise<void> { ... }
 *   async listOrders(limit?: number): Promise<Order[]> { ... }
 * }
 *
 * // Get the stub
 * const stub = env.CUSTOMER.get(env.CUSTOMER.idFromName('customer-123'))
 *
 * // Create typed client - methods are inferred from CustomerDO
 * const client = createTypedClient<CustomerDO>(stub)
 *
 * // All calls are fully typed:
 * const profile = await client.getProfile('123')        // Returns Profile
 * await client.updateEmail('123', 'new@email.com')      // Type-checked params
 * const orders = await client.listOrders(10)            // Returns Order[]
 *
 * // TypeScript errors on invalid calls:
 * await client.getProfile()                   // Error: missing argument
 * await client.updateEmail('123', 42)         // Error: number is not string
 * await client.nonExistent()                  // Error: method doesn't exist
 * ```
 *
 * @param stub - The DurableObjectStub to wrap
 * @param options - Optional configuration (timeout, correlationId)
 * @returns A typed proxy client with full method inference
 */
export function createTypedClient<T extends object>(
  stub: DurableObjectStub,
  options: TypedClientOptions = {}
): RPCClientWithOptions<T> {
  const { timeout = 30000, correlationId: baseCorrelationId } = options

  // Create the $call function for making calls with options
  const $call = async <K extends MethodKeys<T>>(
    method: K,
    args: T[K] extends (...args: infer A) => unknown ? A : never,
    callOptions?: RPCCallOptions
  ): Promise<T[K] extends (...args: unknown[]) => Promise<infer R> ? R : never> => {
    // Build options object without undefined values (for exactOptionalPropertyTypes)
    const invokeOptions: { timeout?: number; correlationId?: string; headers?: Record<string, string> } = {
      timeout: callOptions?.timeout ?? timeout,
    }
    const effectiveCorrelationId = callOptions?.correlationId ?? baseCorrelationId
    if (effectiveCorrelationId !== undefined) invokeOptions.correlationId = effectiveCorrelationId
    if (callOptions?.headers !== undefined) invokeOptions.headers = callOptions.headers

    return invokeViaStub(stub, method as string, args as unknown[], invokeOptions) as Promise<
      T[K] extends (...args: unknown[]) => Promise<infer R> ? R : never
    >
  }

  // Create the proxy for method calls
  return new Proxy({} as RPCClientWithOptions<T>, {
    get(_, prop: string | symbol) {
      // Don't intercept symbols or promise methods
      if (typeof prop === 'symbol') return undefined
      if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined

      // Handle special $call method
      if (prop === '$call') return $call

      // Handle special $stub property
      if (prop === '$stub') return stub

      // Return method invoker
      return async (...args: unknown[]) => {
        // Build options object without undefined values (for exactOptionalPropertyTypes)
        const invokeOptions: { timeout?: number; correlationId?: string } = { timeout }
        if (baseCorrelationId !== undefined) invokeOptions.correlationId = baseCorrelationId
        return invokeViaStub(stub, prop as string, args, invokeOptions)
      }
    },
  })
}

/**
 * Creates a typed RPC client from a URL endpoint.
 *
 * This is useful for client-side applications that need to call
 * remote RPC endpoints over HTTP.
 *
 * @example
 * ```typescript
 * interface MyAPI {
 *   users: {
 *     create(data: UserData): Promise<User>
 *     get(id: string): Promise<User>
 *   }
 *   posts: {
 *     list(limit?: number): Promise<Post[]>
 *   }
 * }
 *
 * const client = createTypedClientFromUrl<MyAPI>('https://api.example.com')
 *
 * const user = await client.users.create({ name: 'Alice' })
 * const posts = await client.posts.list(10)
 * ```
 *
 * @param url - The base URL for RPC endpoints
 * @param options - Optional configuration (timeout, correlationId)
 * @returns A typed proxy client with full method inference
 */
export function createTypedClientFromUrl<T extends object>(
  url: string,
  options: Omit<TypedClientOptions, 'url'> = {}
): RPCClient<T> {
  return createNestedProxyForFetch(url, [], { ...options, url }) as RPCClient<T>
}

/**
 * Type guard to check if a value is a DurableObjectId
 */
function isDurableObjectId(id: unknown): id is DurableObjectId {
  return typeof id === 'object' && id !== null && 'toString' in id && typeof id !== 'string'
}

/**
 * Options for creating a typed client from a DO binding
 */
export interface TypedClientBindingOptions extends TypedClientOptions {
  /** Source DO ID for trust chain headers */
  sourceDoId?: string
}

/**
 * Creates a typed RPC client from a DurableObjectNamespace binding.
 *
 * This is a convenience function that combines getting the stub and
 * creating the typed client in one step.
 *
 * @example
 * ```typescript
 * class CustomerDO {
 *   async getProfile(): Promise<Profile> { ... }
 *   async charge(amount: number): Promise<Receipt> { ... }
 * }
 *
 * // In a Worker
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     const customer = createTypedClientFromBinding<CustomerDO>(
 *       env.CUSTOMER,
 *       'customer-123'
 *     )
 *
 *     const profile = await customer.getProfile()
 *     const receipt = await customer.charge(100)
 *
 *     return Response.json({ profile, receipt })
 *   }
 * }
 * ```
 *
 * @param binding - The DurableObjectNamespace binding
 * @param id - Either a string name or a DurableObjectId
 * @param options - Optional configuration (timeout, correlationId, sourceDoId)
 * @returns A typed proxy client with full method inference
 */
export function createTypedClientFromBinding<T extends object>(
  binding: DurableObjectNamespace,
  id: string | DurableObjectId,
  options: TypedClientBindingOptions = {}
): RPCClientWithOptions<T> {
  const doId = isDurableObjectId(id) ? id : binding.idFromName(id)
  const stub = binding.get(doId)
  return createTypedClient<T>(stub, options)
}

// ============================================================================
// Advanced Type Utilities
// ============================================================================

/**
 * Extracts all method names from a type as a union.
 *
 * @example
 * ```typescript
 * class MyDO {
 *   async getProfile(): Promise<Profile> {}
 *   async updateEmail(email: string): Promise<void> {}
 *   name: string // excluded - not a method
 * }
 *
 * type Methods = ExtractMethodNames<MyDO>
 * // Result: 'getProfile' | 'updateEmail'
 * ```
 */
export type ExtractMethodNames<T> = {
  [K in keyof T]: T[K] extends (...args: unknown[]) => Promise<unknown> ? K : never
}[keyof T]

/**
 * Extracts the parameter types for a specific method.
 *
 * @example
 * ```typescript
 * class MyDO {
 *   async updateEmail(id: string, email: string): Promise<void> {}
 * }
 *
 * type Params = ExtractMethodParams<MyDO, 'updateEmail'>
 * // Result: [id: string, email: string]
 * ```
 */
export type ExtractMethodParams<T, K extends keyof T> = T[K] extends (...args: infer P) => unknown
  ? P
  : never

/**
 * Extracts the return type for a specific method (unwrapped from Promise).
 *
 * @example
 * ```typescript
 * class MyDO {
 *   async getProfile(id: string): Promise<Profile> {}
 * }
 *
 * type Return = ExtractMethodReturn<MyDO, 'getProfile'>
 * // Result: Profile
 * ```
 */
export type ExtractMethodReturn<T, K extends keyof T> = T[K] extends (
  ...args: unknown[]
) => Promise<infer R>
  ? R
  : never

/**
 * Creates a type representing the signature of a method.
 *
 * @example
 * ```typescript
 * class MyDO {
 *   async updateEmail(id: string, email: string): Promise<void> {}
 * }
 *
 * type Sig = MethodSignature<MyDO, 'updateEmail'>
 * // Result: (id: string, email: string) => Promise<void>
 * ```
 */
export type MethodSignature<T, K extends keyof T> = T[K] extends (
  ...args: infer A
) => Promise<infer R>
  ? (...args: A) => Promise<R>
  : never

/**
 * Creates a partial client type where all methods are optional.
 * Useful for mocking in tests.
 *
 * @example
 * ```typescript
 * class MyDO {
 *   async getProfile(): Promise<Profile> {}
 *   async updateEmail(email: string): Promise<void> {}
 * }
 *
 * // In tests
 * const mockClient: PartialClient<MyDO> = {
 *   getProfile: vi.fn().mockResolvedValue({ name: 'Test' })
 *   // updateEmail is optional
 * }
 * ```
 */
export type PartialClient<T> = {
  [K in keyof T as T[K] extends (...args: unknown[]) => Promise<unknown> ? K : never]?: T[K]
}

/**
 * Verifies that a type T is a valid RPC interface (all methods return Promises).
 * Useful as a compile-time check.
 *
 * @example
 * ```typescript
 * interface ValidAPI {
 *   getProfile(): Promise<Profile>
 *   updateEmail(email: string): Promise<void>
 * }
 *
 * // This will type-check
 * type _check = AssertValidRPCInterface<ValidAPI>
 *
 * interface InvalidAPI {
 *   syncMethod(): string // Not async!
 * }
 *
 * // This will fail type-check
 * type _check2 = AssertValidRPCInterface<InvalidAPI>
 * ```
 */
export type AssertValidRPCInterface<T> = {
  [K in keyof T]: T[K] extends (...args: unknown[]) => Promise<unknown>
    ? T[K]
    : T[K] extends object
      ? AssertValidRPCInterface<T[K]>
      : never
}

/**
 * Batch call result type for multiple parallel RPC calls
 */
export type BatchCallResult<T extends readonly unknown[]> = {
  [K in keyof T]: T[K] extends Promise<infer R> ? R : never
}

/**
 * Creates a batch caller for making multiple typed RPC calls in parallel.
 *
 * @example
 * ```typescript
 * class CustomerDO {
 *   async getProfile(id: string): Promise<Profile> {}
 *   async getOrders(id: string): Promise<Order[]> {}
 *   async getBalance(id: string): Promise<number> {}
 * }
 *
 * const client = createTypedClient<CustomerDO>(stub)
 *
 * // Make all calls in parallel
 * const [profile, orders, balance] = await batchCalls(
 *   client.getProfile('123'),
 *   client.getOrders('123'),
 *   client.getBalance('123')
 * )
 * ```
 *
 * @param calls - Array of RPC call promises
 * @returns Promise resolving to array of results
 */
export async function batchCalls<T extends readonly Promise<unknown>[]>(
  ...calls: T
): Promise<BatchCallResult<T>> {
  return Promise.all(calls) as Promise<BatchCallResult<T>>
}
