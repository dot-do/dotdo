/**
 * @dotdo/rpc - Type Definitions
 *
 * Core types for the universal SDK wrapper.
 *
 * @module @dotdo/rpc/types
 */

// =============================================================================
// Method Call Types
// =============================================================================

/**
 * Represents a single method call captured by the proxy.
 *
 * @example
 * ```typescript
 * // For client.users.get('123')
 * const call: MethodCall = {
 *   id: 'call_1',
 *   path: ['users', 'get'],
 *   args: ['123']
 * }
 * ```
 */
export interface MethodCall {
  /** Unique identifier for this call (used for batching and correlation) */
  id: string
  /** Path of property accesses leading to the method (e.g., ['users', 'get']) */
  path: string[]
  /** Arguments passed to the method */
  args?: unknown[]
  /** Optional metadata for tracing/debugging */
  meta?: Record<string, unknown>
}

/**
 * Result of executing a method call.
 */
export interface CallResult<T = unknown> {
  /** The result value on success */
  result?: T
  /** Error details on failure */
  error?: RpcError
}

/**
 * Results from a batch execution.
 */
export interface BatchResult<T = unknown> {
  /** Results in the same order as the input calls */
  results: CallResult<T>[]
  /** Any batch-level errors (e.g., network failure) */
  errors?: RpcError[]
}

/**
 * RPC error structure.
 */
export interface RpcError {
  /** Error code for programmatic handling */
  code: string
  /** Human-readable error message */
  message: string
  /** Additional error data */
  data?: unknown
}

// =============================================================================
// Executor Types
// =============================================================================

/**
 * Executor interface for processing method calls.
 *
 * Implementers handle the actual execution of RPC calls,
 * whether in-memory, over HTTP, or via other transports.
 *
 * @example
 * ```typescript
 * const executor: Executor = {
 *   async execute(call) {
 *     const response = await fetch('/rpc', {
 *       method: 'POST',
 *       body: JSON.stringify(call)
 *     })
 *     return response.json()
 *   }
 * }
 * ```
 */
export interface Executor {
  /**
   * Execute a single method call.
   *
   * @param call - The method call to execute
   * @returns The result of the call
   */
  execute(call: MethodCall): Promise<CallResult>

  /**
   * Execute multiple method calls in a batch.
   *
   * Optional - if not implemented, calls will be executed individually.
   *
   * @param calls - Array of method calls to execute
   * @returns Array of results in the same order as input
   */
  executeBatch?(calls: MethodCall[]): Promise<CallResult[]>
}

// =============================================================================
// Proxy Configuration
// =============================================================================

/**
 * Configuration options for the RPC proxy.
 */
export interface ProxyConfig {
  /**
   * Maximum depth for recursive proxy creation.
   * Prevents infinite loops and limits memory usage.
   * @default 20
   */
  maxDepth?: number

  /**
   * Batching configuration for grouping multiple calls.
   */
  batching?: BatchingConfig

  /**
   * Custom ID generator for method calls.
   * @default Auto-incrementing integer
   */
  generateId?: () => string

  /**
   * Timeout for individual calls in milliseconds.
   * @default 30000
   */
  timeout?: number
}

/**
 * Configuration for call batching.
 */
export interface BatchingConfig {
  /**
   * Whether batching is enabled.
   * @default false
   */
  enabled: boolean

  /**
   * Time window in milliseconds to collect calls before sending.
   * @default 10
   */
  windowMs?: number

  /**
   * Maximum number of calls per batch.
   * @default 100
   */
  maxSize?: number
}

// =============================================================================
// Serialization Types
// =============================================================================

/**
 * Type marker for serialized special values.
 */
export interface SerializedValue {
  /** Type identifier */
  __rpc_type__: string
  /** Serialized data */
  value: unknown
}

/**
 * Marker for function references.
 */
export interface FunctionReference {
  /** Marks this as an RPC function reference */
  __rpc_fn__: true
  /** Optional function name */
  name?: string
}

// =============================================================================
// HTTP Executor Types
// =============================================================================

/**
 * Options for the HTTP executor.
 */
export interface HTTPExecutorOptions {
  /**
   * Custom fetch implementation (useful for testing or custom transports).
   * @default globalThis.fetch
   */
  fetch?: typeof fetch

  /**
   * Additional headers to include in requests.
   */
  headers?: Record<string, string>

  /**
   * Request timeout in milliseconds.
   * @default 30000
   */
  timeout?: number
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Deep partial type for nested optional properties.
 */
export type DeepPartial<T> = T extends object
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T

/**
 * Extract method names from an interface.
 */
export type MethodNames<T> = {
  [K in keyof T]: T[K] extends (...args: unknown[]) => unknown ? K : never
}[keyof T]

/**
 * Make all methods in an interface return promises.
 */
export type Promisify<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : T[K] extends object
      ? Promisify<T[K]>
      : T[K]
}
