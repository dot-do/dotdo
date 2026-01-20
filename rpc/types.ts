// RPC Type Utilities - provides typed RPC clients with method inference
// These types extract callable methods from interfaces and preserve their signatures

/**
 * A function that returns a Promise (async method)
 */
export type AsyncFunction = (...args: unknown[]) => Promise<unknown>

/**
 * Extract only the methods (functions that return Promises) from a type T.
 *
 * This filters out:
 * - Non-function properties (strings, numbers, objects, etc.)
 * - Synchronous functions (those not returning Promise)
 * - Nested objects (use RPCClientNested for those)
 *
 * For each method, it preserves:
 * - Parameter types (via infer A)
 * - Return type (via infer R, including the Promise wrapper)
 *
 * @example
 * ```typescript
 * interface CustomerDO {
 *   name: string                              // Excluded: not a function
 *   getProfile(): Promise<Profile>            // Included
 *   updateEmail(email: string): Promise<void> // Included
 *   computeSync(): number                     // Excluded: not async
 * }
 *
 * type Client = RPCClientMethods<CustomerDO>
 * // Result: { getProfile: () => Promise<Profile>, updateEmail: (email: string) => Promise<void> }
 * ```
 */
export type RPCClientMethods<T> = {
  [K in keyof T as T[K] extends (...args: infer _A) => Promise<infer _R> ? K : never]:
    T[K] extends (...args: infer A) => Promise<infer R>
      ? (...args: A) => Promise<R>
      : never
}

/**
 * Extract nested namespaces from a type T.
 *
 * This includes only non-function object properties that might contain methods.
 * Each nested object is recursively transformed into an RPCClient.
 *
 * @example
 * ```typescript
 * interface API {
 *   users: {
 *     create(data: UserData): Promise<User>
 *     delete(id: string): Promise<void>
 *   }
 *   posts: {
 *     list(): Promise<Post[]>
 *   }
 * }
 *
 * // client.users.create(...) and client.posts.list() are typed
 * ```
 */
export type RPCClientNested<T> = {
  [K in keyof T as T[K] extends (...args: unknown[]) => unknown
    ? never
    : T[K] extends object
      ? K
      : never
  ]: T[K] extends object ? RPCClient<T[K]> : never
}

/**
 * Complete RPC client type that combines:
 * 1. Direct async methods
 * 2. Nested namespaces with their own methods
 *
 * This provides full type inference for:
 * - Method names (autocomplete in IDE)
 * - Parameter types
 * - Return types
 *
 * @example
 * ```typescript
 * interface CustomerDO {
 *   getProfile(): Promise<Profile>
 *   updateEmail(email: string): Promise<void>
 *   orders: {
 *     list(): Promise<Order[]>
 *     get(id: string): Promise<Order>
 *   }
 * }
 *
 * const client: RPCClient<CustomerDO> = createRPCClient(stub)
 *
 * const profile = await client.getProfile()           // Typed as Profile
 * await client.updateEmail('new@example.com')         // Typed as void
 * const orders = await client.orders.list()           // Typed as Order[]
 * const order = await client.orders.get('order-123')  // Typed as Order
 * ```
 */
export type RPCClient<T> = RPCClientMethods<T> & RPCClientNested<T>

/**
 * Utility type to extract the return type from an async method.
 * Unwraps the Promise to get the inner type.
 *
 * @example
 * ```typescript
 * type Profile = AsyncReturnType<() => Promise<{ name: string }>>
 * // Result: { name: string }
 * ```
 */
export type AsyncReturnType<T extends (...args: unknown[]) => Promise<unknown>> =
  T extends (...args: unknown[]) => Promise<infer R> ? R : never

/**
 * Utility type to extract parameter types from a method.
 *
 * @example
 * ```typescript
 * type Params = MethodParams<(name: string, age: number) => Promise<void>>
 * // Result: [string, number]
 * ```
 */
export type MethodParams<T extends (...args: unknown[]) => unknown> =
  T extends (...args: infer P) => unknown ? P : never

/**
 * Type guard to check if a property key is a method key of T
 */
export type MethodKeys<T> = {
  [K in keyof T]: T[K] extends (...args: unknown[]) => Promise<unknown> ? K : never
}[keyof T]

/**
 * Type guard to check if a property key is a nested namespace key of T
 */
export type NestedKeys<T> = {
  [K in keyof T]: T[K] extends (...args: unknown[]) => unknown
    ? never
    : T[K] extends object
      ? K
      : never
}[keyof T]

/**
 * Helper type for defining DO interfaces that will be used with RPC.
 *
 * Use this to define the public RPC interface of a Durable Object.
 * All methods should return Promises.
 *
 * @example
 * ```typescript
 * interface MyDO extends DOInterface {
 *   getProfile(): Promise<Profile>
 *   updateEmail(email: string): Promise<void>
 * }
 * ```
 */
export interface DOInterface {
  [key: string]: ((...args: unknown[]) => Promise<unknown>) | DOInterface
}

/**
 * Branded type for correlation IDs
 */
export type CorrelationId = string & { readonly __brand: 'CorrelationId' }

/**
 * RPC call options that can be passed to individual method calls
 */
export interface RPCCallOptions {
  /** Timeout in milliseconds for this specific call */
  timeout?: number
  /** Correlation ID for request tracing */
  correlationId?: string
  /** Custom headers to include in the request */
  headers?: Record<string, string>
}

/**
 * Extended RPC client that supports call options.
 * Use $call() to make RPC calls with custom options.
 *
 * @example
 * ```typescript
 * const client = createRPCClient<MyDO>(stub)
 *
 * // Simple call
 * await client.getProfile()
 *
 * // Call with options
 * await client.$call('getProfile', [], { timeout: 5000 })
 * ```
 */
export interface RPCClientWithOptions<T> extends RPCClient<T> {
  /**
   * Make an RPC call with custom options
   * @param method - The method name to call
   * @param args - Arguments to pass to the method
   * @param options - Call options (timeout, correlation ID, etc.)
   */
  $call<K extends MethodKeys<T>>(
    method: K,
    args: T[K] extends (...args: infer A) => unknown ? A : never,
    options?: RPCCallOptions
  ): T[K] extends (...args: unknown[]) => Promise<infer R> ? Promise<R> : never

  /**
   * Get the underlying stub for advanced operations
   */
  $stub: DurableObjectStub
}
