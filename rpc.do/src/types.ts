// RPC Type Definitions for rpc.do
// Core types for RPC communication

/**
 * Standard RPC message format sent over any transport
 */
export interface RPCMessage {
  /** The method to invoke (supports dot notation for nested methods) */
  method: string
  /** Arguments to pass to the method */
  args: unknown[]
  /** Optional correlation ID for request tracing */
  correlationId?: string
}

/**
 * Serialized error format for RPC responses
 */
export interface SerializedError {
  /** Error type name */
  type: string
  /** Error code */
  code: string
  /** Human-readable message */
  message: string
  /** Optional additional details */
  details?: Record<string, unknown>
  /** HTTP status code if applicable */
  httpStatus?: number
}

/**
 * RPC response from the server
 */
export interface RPCResponse<T = unknown> {
  /** The result of the RPC call (undefined if error) */
  result?: T
  /** Error if the call failed */
  error?: SerializedError
  /** Correlation ID echoed back for request tracing */
  correlationId?: string
}

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
 * A function that returns a Promise (async method)
 */
export type AsyncFunction = (...args: unknown[]) => Promise<unknown>

/**
 * Extract only the methods (functions that return Promises) from a type T.
 */
export type RPCClientMethods<T> = {
  [K in keyof T as T[K] extends (...args: infer _A) => Promise<infer _R> ? K : never]:
    T[K] extends (...args: infer A) => Promise<infer R>
      ? (...args: A) => Promise<R>
      : never
}

/**
 * Extract nested namespaces from a type T.
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
 */
export type RPCClient<T> = RPCClientMethods<T> & RPCClientNested<T>
