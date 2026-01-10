/**
 * Cap'n Web RPC Client for TanStack DB
 *
 * Provides promise pipelining and efficient RPC for dotdo TanStack DB integration.
 * Cap'n Web enables multiple agent calls to execute in a single network round trip.
 *
 * @module db/tanstack/rpc
 */

import type { MutationResponse, QueryOptions } from './protocol'

/**
 * Configuration for the RPC client
 */
export interface RPCClientConfig {
  /** RPC server URL */
  url: string
  /** Authentication token */
  token?: string
  /** Request timeout in ms (default: 30000) */
  timeout?: number
}

/**
 * Mutation operation for batch execution
 */
export interface MutationOperation {
  type: 'insert' | 'update' | 'delete'
  collection: string
  key: string
  data?: Record<string, unknown>
}

/**
 * Query operation for batch execution
 */
export interface QueryOperation {
  collection: string
  options?: QueryOptions
}

/**
 * Cap'n Web RPC client for dotdo TanStack DB integration.
 *
 * Enables promise pipelining where multiple operations can be
 * batched into a single network round trip.
 *
 * @example
 * ```ts
 * const rpc = new RPCClient({ url: 'https://api.example.com/rpc' })
 *
 * // Single mutation
 * const result = await rpc.mutate({
 *   type: 'insert',
 *   collection: 'Task',
 *   key: 'task-1',
 *   data: { title: 'New task' }
 * })
 *
 * // Batch operations (single round trip)
 * const results = await rpc.batch([
 *   { type: 'insert', collection: 'Task', key: 'task-1', data: { ... } },
 *   { type: 'update', collection: 'Task', key: 'task-2', data: { ... } },
 * ])
 * ```
 */
export class RPCClient {
  private _config: RPCClientConfig

  constructor(config: RPCClientConfig) {
    this._config = config
  }

  /**
   * Execute a single mutation
   */
  async mutate(_operation: MutationOperation): Promise<MutationResponse> {
    // STUB: Implementation will be added in GREEN issue
    throw new Error('RPCClient.mutate not yet implemented - see GREEN issue for implementation')
  }

  /**
   * Execute multiple operations in a single round trip
   */
  async batch(_operations: MutationOperation[]): Promise<MutationResponse[]> {
    // STUB: Implementation will be added in GREEN issue
    throw new Error('RPCClient.batch not yet implemented - see GREEN issue for implementation')
  }

  /**
   * Execute a query
   */
  async query<T = unknown>(_operation: QueryOperation): Promise<T[]> {
    // STUB: Implementation will be added in GREEN issue
    throw new Error('RPCClient.query not yet implemented - see GREEN issue for implementation')
  }

  /**
   * Get a single item by key
   */
  async get<T = unknown>(_collection: string, _key: string): Promise<T | null> {
    // STUB: Implementation will be added in GREEN issue
    throw new Error('RPCClient.get not yet implemented - see GREEN issue for implementation')
  }
}

/**
 * Create an RPC client instance
 */
export function createRPCClient(config: RPCClientConfig): RPCClient {
  return new RPCClient(config)
}
