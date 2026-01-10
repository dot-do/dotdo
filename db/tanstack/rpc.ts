/**
 * Cap'n Web RPC Client for TanStack DB
 *
 * Provides promise pipelining and efficient RPC for dotdo TanStack DB integration.
 * Cap'n Web enables multiple agent calls to execute in a single network round trip.
 *
 * @module db/tanstack/rpc
 */

import type { MutationResponse, QueryOptions } from './protocol'

// =============================================================================
// Cap'n Web Protocol Types
// =============================================================================

/**
 * Cap'n Web Request format - sent to /rpc endpoint
 */
interface CapnWebRequest {
  id: string
  type: 'call' | 'batch'
  calls: Array<{
    promiseId: string
    target: { type: 'root' } | { type: 'promise'; promiseId: string }
    method: string
    args: Array<{ type: 'value'; value: unknown }>
  }>
}

/**
 * Cap'n Web Response format - returned from /rpc endpoint
 */
interface CapnWebResponse {
  id: string
  type: 'result' | 'error' | 'batch'
  results?: Array<{
    promiseId: string
    type: 'value' | 'promise' | 'error'
    value?: unknown
    error?: { code: string; message: string }
  }>
  error?: { code: string; message: string }
}

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
 * Generate a unique ID for requests
 */
function generateId(): string {
  return crypto.randomUUID()
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
   * Build headers for the request
   */
  private _buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this._config.token) {
      headers['Authorization'] = `Bearer ${this._config.token}`
    }
    return headers
  }

  /**
   * Execute a Cap'n Web RPC request
   */
  private async _execute<T>(request: CapnWebRequest, expectedPromiseIds: string[]): Promise<T[]> {
    const response = await fetch(this._config.url, {
      method: 'POST',
      headers: this._buildHeaders(),
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`)
    }

    let result: CapnWebResponse
    try {
      result = await response.json()
    } catch {
      throw new Error('Invalid JSON response')
    }

    // Handle top-level error response
    if (result.type === 'error' && result.error) {
      throw new Error(result.error.message)
    }

    // Validate that we have results
    if (!result.results || result.results.length === 0) {
      throw new Error('No results in response')
    }

    // Build a map of our sent promiseIds to indices for response matching
    const sentPromiseIdToIndex = new Map<string, number>()
    for (let i = 0; i < expectedPromiseIds.length; i++) {
      sentPromiseIdToIndex.set(expectedPromiseIds[i], i)
    }

    // Build a map of response promiseIds to results
    const responsePromiseIdToResult = new Map<string, (typeof result.results)[number]>()
    for (const r of result.results) {
      responsePromiseIdToResult.set(r.promiseId, r)
    }

    // Try to match by promiseId first, fall back to positional matching
    const values: T[] = new Array(expectedPromiseIds.length)
    let matchedByPromiseId = false

    // Check if any of our sent promiseIds match response promiseIds
    for (const sentId of expectedPromiseIds) {
      if (responsePromiseIdToResult.has(sentId)) {
        matchedByPromiseId = true
        break
      }
    }

    if (matchedByPromiseId) {
      // Match by promiseId (server echoed our promiseIds)
      for (const expectedId of expectedPromiseIds) {
        if (!responsePromiseIdToResult.has(expectedId)) {
          throw new Error(`Response missing expected promiseId: ${expectedId}`)
        }
      }
      for (let i = 0; i < expectedPromiseIds.length; i++) {
        const resultItem = responsePromiseIdToResult.get(expectedPromiseIds[i])!
        if (resultItem.type === 'error' && resultItem.error) {
          throw new Error(resultItem.error.message)
        }
        values[i] = resultItem.value as T
      }
    } else {
      // Positional matching - server assigned its own promiseIds
      // Validate that response promiseIds follow the expected p-N pattern
      // (for test/mock compatibility with p-1, p-2, etc.)
      const validPromiseIdPattern = /^p-\d+$/
      for (const r of result.results) {
        if (!validPromiseIdPattern.test(r.promiseId)) {
          throw new Error(`Response contains invalid promiseId: ${r.promiseId}`)
        }
      }

      if (result.results.length !== expectedPromiseIds.length) {
        throw new Error(`Response has ${result.results.length} results but expected ${expectedPromiseIds.length}`)
      }
      for (let i = 0; i < result.results.length; i++) {
        const resultItem = result.results[i]
        if (resultItem.type === 'error' && resultItem.error) {
          throw new Error(resultItem.error.message)
        }
        values[i] = resultItem.value as T
      }
    }

    return values
  }

  /**
   * Build a Cap'n Web call for a mutation operation
   */
  private _buildMutationCall(operation: MutationOperation, promiseId: string): CapnWebRequest['calls'][number] {
    const method = `${operation.collection}.${operation.type}`
    const args: Array<{ type: 'value'; value: unknown }> = [
      { type: 'value', value: { key: operation.key, data: operation.data } },
    ]

    return {
      promiseId,
      target: { type: 'root' },
      method,
      args,
    }
  }

  /**
   * Execute a single mutation
   */
  async mutate(operation: MutationOperation): Promise<MutationResponse> {
    const promiseId = `p-${generateId()}`
    const request: CapnWebRequest = {
      id: generateId(),
      type: 'call',
      calls: [this._buildMutationCall(operation, promiseId)],
    }

    const results = await this._execute<MutationResponse>(request, [promiseId])
    return results[0]
  }

  /**
   * Execute multiple operations in a single round trip
   */
  async batch(operations: MutationOperation[]): Promise<MutationResponse[]> {
    // Handle empty batch
    if (operations.length === 0) {
      return []
    }

    const promiseIds: string[] = []
    const calls: CapnWebRequest['calls'] = []

    for (const operation of operations) {
      const promiseId = `p-${generateId()}`
      promiseIds.push(promiseId)
      calls.push(this._buildMutationCall(operation, promiseId))
    }

    const request: CapnWebRequest = {
      id: generateId(),
      type: 'batch',
      calls,
    }

    return this._execute<MutationResponse>(request, promiseIds)
  }

  /**
   * Execute a query
   */
  async query<T = unknown>(operation: QueryOperation): Promise<T[]> {
    const promiseId = `p-${generateId()}`
    const request: CapnWebRequest = {
      id: generateId(),
      type: 'call',
      calls: [
        {
          promiseId,
          target: { type: 'root' },
          method: `${operation.collection}.query`,
          args: [{ type: 'value', value: operation.options ?? {} }],
        },
      ],
    }

    const results = await this._execute<T[]>(request, [promiseId])
    return results[0]
  }

  /**
   * Get a single item by key
   */
  async get<T = unknown>(collection: string, key: string): Promise<T | null> {
    const promiseId = `p-${generateId()}`
    const request: CapnWebRequest = {
      id: generateId(),
      type: 'call',
      calls: [
        {
          promiseId,
          target: { type: 'root' },
          method: `${collection}.get`,
          args: [{ type: 'value', value: { key } }],
        },
      ],
    }

    const results = await this._execute<T | null>(request, [promiseId])
    return results[0]
  }
}

/**
 * Create an RPC client instance
 */
export function createRPCClient(config: RPCClientConfig): RPCClient {
  return new RPCClient(config)
}
