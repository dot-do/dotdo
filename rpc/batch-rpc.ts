/**
 * Batch RPC - Execute multiple RPC calls in a single request
 *
 * Reduces network round trips by batching multiple independent RPC calls
 * into a single HTTP request. Each call in the batch is executed in parallel
 * on the server, and results are returned in the same order.
 *
 * @module rpc/batch-rpc
 */

import { SerializedError, deserializeError, isRPCError, RPCErrorCode } from './errors'
import { generateCorrelationId, CORRELATION_ID_HEADER } from './client'

/**
 * A single RPC call in a batch request
 */
export interface BatchRPCCall {
  /** Method name (supports dot notation for nested access) */
  method: string
  /** Arguments to pass to the method */
  args: unknown[]
  /** Optional unique ID to identify this call in responses (auto-generated if not provided) */
  id?: string
}

/**
 * A single result from a batch RPC response
 */
export interface BatchRPCResult<T = unknown> {
  /** The call ID (matches the id from BatchRPCCall, or auto-generated index) */
  id: string
  /** The result if successful */
  result?: T
  /** Error information if failed */
  error?: SerializedError
}

/**
 * Batch RPC request body
 */
export interface BatchRPCRequest {
  /** Array of RPC calls to execute */
  calls: BatchRPCCall[]
}

/**
 * Batch RPC response body
 */
export interface BatchRPCResponse {
  /** Array of results in the same order as the calls */
  results: BatchRPCResult[]
  /** Overall correlation ID for the batch request */
  correlationId?: string
}

/**
 * Options for batch RPC execution
 */
export interface BatchRPCOptions {
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Correlation ID for request tracing */
  correlationId?: string
  /** Whether to throw on first error or collect all results (default: false = collect all) */
  throwOnError?: boolean
}

/**
 * Type-safe batch builder for constructing batch RPC calls
 *
 * @example
 * ```typescript
 * const batch = new BatchRPCBuilder<MyAPI>('https://api.example.com')
 *   .add('things.get', ['id1'])
 *   .add('things.get', ['id2'])
 *   .add('events.list', [{ limit: 10 }])
 *
 * const results = await batch.execute()
 * // results[0] is the result of things.get('id1')
 * // results[1] is the result of things.get('id2')
 * // results[2] is the result of events.list({ limit: 10 })
 * ```
 */
export class BatchRPCBuilder<T extends object = object> {
  private calls: BatchRPCCall[] = []
  private url: string
  private options: BatchRPCOptions

  constructor(url: string, options: BatchRPCOptions = {}) {
    this.url = url
    this.options = options
  }

  /**
   * Add an RPC call to the batch
   *
   * @param method - Method name (supports dot notation)
   * @param args - Arguments for the method
   * @param id - Optional unique ID for this call
   * @returns this for chaining
   */
  add(method: string, args: unknown[] = [], id?: string): this {
    this.calls.push({
      method,
      args,
      id: id ?? `call-${this.calls.length}`,
    })
    return this
  }

  /**
   * Get the current number of calls in the batch
   */
  get size(): number {
    return this.calls.length
  }

  /**
   * Check if the batch is empty
   */
  get isEmpty(): boolean {
    return this.calls.length === 0
  }

  /**
   * Clear all calls from the batch
   */
  clear(): this {
    this.calls = []
    return this
  }

  /**
   * Execute all calls in the batch
   *
   * @returns Array of results in the same order as the calls
   * @throws If throwOnError is true and any call fails
   */
  async execute(): Promise<BatchRPCResult[]> {
    if (this.calls.length === 0) {
      return []
    }

    return executeBatchRPC(this.url, this.calls, this.options)
  }

  /**
   * Execute and extract just the successful results (throws on any error)
   *
   * @returns Array of result values (not BatchRPCResult objects)
   * @throws If any call in the batch fails
   */
  async executeStrict<R = unknown>(): Promise<R[]> {
    const results = await this.execute()

    const values: R[] = []
    for (const result of results) {
      if (result.error) {
        throw deserializeError(result.error)
      }
      values.push(result.result as R)
    }

    return values
  }
}

/**
 * Execute a batch of RPC calls
 *
 * @param url - Base URL of the RPC endpoint
 * @param calls - Array of RPC calls to execute
 * @param options - Execution options
 * @returns Array of results in the same order as the calls
 */
export async function executeBatchRPC(
  url: string,
  calls: BatchRPCCall[],
  options: BatchRPCOptions = {}
): Promise<BatchRPCResult[]> {
  const { timeout = 30000, correlationId, throwOnError = false } = options

  if (calls.length === 0) {
    return []
  }

  // Ensure all calls have IDs
  const normalizedCalls = calls.map((call, index) => ({
    ...call,
    id: call.id ?? `call-${index}`,
  }))

  const requestCorrelationId = correlationId ?? generateCorrelationId()

  const response = await fetch(`${url}/rpc/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [CORRELATION_ID_HEADER]: requestCorrelationId,
    },
    body: JSON.stringify({ calls: normalizedCalls }),
    signal: AbortSignal.timeout(timeout),
  })

  if (!response.ok) {
    const responseCorrelationId =
      response.headers.get(CORRELATION_ID_HEADER) || requestCorrelationId

    // Try to parse error response
    try {
      const errorBody = (await response.json()) as SerializedError
      if (errorBody.code && errorBody.message) {
        throw deserializeError(errorBody)
      }
    } catch (e) {
      if (isRPCError(e)) {
        throw e
      }
    }

    throw new Error(`Batch RPC error: ${response.status} [${responseCorrelationId}]`)
  }

  const batchResponse = (await response.json()) as BatchRPCResponse

  // If throwOnError, check for any errors and throw the first one
  if (throwOnError) {
    for (const result of batchResponse.results) {
      if (result.error) {
        throw deserializeError(result.error)
      }
    }
  }

  return batchResponse.results
}

/**
 * Create a batch RPC builder for a URL
 *
 * @param url - Base URL of the RPC endpoint
 * @param options - Default options for batch execution
 * @returns A new BatchRPCBuilder instance
 *
 * @example
 * ```typescript
 * const results = await createBatchRPC('https://api.example.com')
 *   .add('things.get', ['id1'])
 *   .add('things.get', ['id2'])
 *   .add('events.list', [{ limit: 10 }])
 *   .execute()
 * ```
 */
export function createBatchRPC<T extends object = object>(
  url: string,
  options: BatchRPCOptions = {}
): BatchRPCBuilder<T> {
  return new BatchRPCBuilder<T>(url, options)
}

/**
 * Execute a batch of RPC calls on a Durable Object stub
 *
 * @param stub - The Durable Object stub
 * @param calls - Array of RPC calls to execute
 * @param options - Execution options
 * @returns Array of results in the same order as the calls
 */
export async function executeBatchDORPC(
  stub: DurableObjectStub,
  calls: BatchRPCCall[],
  options: BatchRPCOptions = {}
): Promise<BatchRPCResult[]> {
  const { timeout = 30000, correlationId, throwOnError = false } = options

  if (calls.length === 0) {
    return []
  }

  // Ensure all calls have IDs
  const normalizedCalls = calls.map((call, index) => ({
    ...call,
    id: call.id ?? `call-${index}`,
  }))

  const requestCorrelationId = correlationId ?? generateCorrelationId()

  const response = await stub.fetch('https://do/rpc/batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [CORRELATION_ID_HEADER]: requestCorrelationId,
    },
    body: JSON.stringify({ calls: normalizedCalls }),
  })

  if (!response.ok) {
    const responseCorrelationId =
      response.headers.get(CORRELATION_ID_HEADER) || requestCorrelationId

    // Try to parse error response
    try {
      const errorBody = (await response.json()) as SerializedError
      if (errorBody.code && errorBody.message) {
        throw deserializeError(errorBody)
      }
    } catch (e) {
      if (isRPCError(e)) {
        throw e
      }
    }

    throw new Error(`Batch DO RPC error: ${response.status} [${responseCorrelationId}]`)
  }

  const batchResponse = (await response.json()) as BatchRPCResponse

  // If throwOnError, check for any errors and throw the first one
  if (throwOnError) {
    for (const result of batchResponse.results) {
      if (result.error) {
        throw deserializeError(result.error)
      }
    }
  }

  return batchResponse.results
}

/**
 * Create a batch RPC builder for a Durable Object stub
 *
 * @param stub - The Durable Object stub
 * @param options - Default options for batch execution
 * @returns A new BatchDORPCBuilder instance
 *
 * @example
 * ```typescript
 * const stub = env.DO.get(env.DO.idFromName('my-do'))
 *
 * const results = await createBatchDORPC(stub)
 *   .add('things.get', ['id1'])
 *   .add('things.get', ['id2'])
 *   .execute()
 * ```
 */
export function createBatchDORPC<T extends object = object>(
  stub: DurableObjectStub,
  options: BatchRPCOptions = {}
): BatchDORPCBuilder<T> {
  return new BatchDORPCBuilder<T>(stub, options)
}

/**
 * Batch builder for Durable Object RPC calls
 */
export class BatchDORPCBuilder<T extends object = object> {
  private calls: BatchRPCCall[] = []
  private stub: DurableObjectStub
  private options: BatchRPCOptions

  constructor(stub: DurableObjectStub, options: BatchRPCOptions = {}) {
    this.stub = stub
    this.options = options
  }

  /**
   * Add an RPC call to the batch
   */
  add(method: string, args: unknown[] = [], id?: string): this {
    this.calls.push({
      method,
      args,
      id: id ?? `call-${this.calls.length}`,
    })
    return this
  }

  /**
   * Get the current number of calls in the batch
   */
  get size(): number {
    return this.calls.length
  }

  /**
   * Check if the batch is empty
   */
  get isEmpty(): boolean {
    return this.calls.length === 0
  }

  /**
   * Clear all calls from the batch
   */
  clear(): this {
    this.calls = []
    return this
  }

  /**
   * Execute all calls in the batch
   */
  async execute(): Promise<BatchRPCResult[]> {
    if (this.calls.length === 0) {
      return []
    }

    return executeBatchDORPC(this.stub, this.calls, this.options)
  }

  /**
   * Execute and extract just the successful results (throws on any error)
   */
  async executeStrict<R = unknown>(): Promise<R[]> {
    const results = await this.execute()

    const values: R[] = []
    for (const result of results) {
      if (result.error) {
        throw deserializeError(result.error)
      }
      values.push(result.result as R)
    }

    return values
  }
}
