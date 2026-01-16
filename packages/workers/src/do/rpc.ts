/**
 * RPC utilities for Durable Objects
 *
 * Provides type-safe remote procedure calls with promise pipelining.
 *
 * @module @dotdo/workers/do
 */

/**
 * RPC request format
 */
export interface RPCRequest {
  method: string
  args: unknown[]
  id?: string
}

/**
 * RPC response format
 */
export interface RPCResponse {
  result?: unknown
  error?: {
    message: string
    code?: string
  }
  id?: string
}

/**
 * RPC client options
 */
export interface RPCClientOptions<T = unknown> {
  target: T
  timeout?: number
}

/**
 * Create a type-safe RPC client
 *
 * @param options - Client configuration
 * @returns Proxied client with type-safe method calls
 */
export function createRPCClient<T>(_options: RPCClientOptions<T>): T {
  throw new Error('createRPCClient not implemented yet')
}

/**
 * Send an RPC request
 *
 * @param stub - The DO stub to call
 * @param method - The method name
 * @param args - The arguments
 * @returns The response
 */
export async function sendRPCRequest(
  _stub: unknown,
  _method: string,
  _args: unknown[]
): Promise<RPCResponse> {
  throw new Error('sendRPCRequest not implemented yet')
}
