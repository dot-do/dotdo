// DO Stub Transport - Durable Object stub-based RPC transport
// Used for Worker-to-DO and DO-to-DO communication within Cloudflare Workers

import { isSerializedError, type SerializedError } from '../errors'
import { generateCorrelationId, CORRELATION_ID_HEADER, DO_SOURCE_HEADER, DO_SOURCE_ID_HEADER } from '../headers'
import type { Transport, TransportOptions, RPCMessage, RPCResponse, TransportState, ErrorInterceptor } from './types'
import {
  createTransportErrorFromCatch,
  createServerErrorFromStatus,
  createErrorResponse,
  createErrorContext,
  applyErrorInterceptor,
} from './error-utils'

/**
 * Options for the stub transport
 */
export interface StubTransportOptions extends TransportOptions {
  /** The DO stub to communicate with */
  stub: DurableObjectStub
  /** Base URL for the RPC endpoint (default: 'https://do') */
  baseUrl?: string
  /** Source DO ID for trust chain (do-nuwe) */
  sourceDoId?: string
}

/**
 * Options for creating a stub transport from a binding
 */
export interface StubTransportBindingOptions extends TransportOptions {
  /** The DurableObjectNamespace binding */
  binding: DurableObjectNamespace
  /** The DO ID (string name or DurableObjectId) */
  id: string | DurableObjectId
  /** Base URL for the RPC endpoint (default: 'https://do') */
  baseUrl?: string
  /** Source DO ID for trust chain (do-nuwe) */
  sourceDoId?: string
}

/**
 * Type guard to check if a value is a DurableObjectId.
 *
 * Uses multiple checks to ensure the value is a real DurableObjectId:
 * 1. Must be a non-null object
 * 2. Must have an `equals` method (unique to DurableObjectId)
 * 3. Must have a `toString` method
 * 4. Must have a `name` property (present on all DurableObjectIds)
 * 5. The `toString()` result must be a non-empty string (real IDs return hex strings)
 *
 * This is more robust than just checking for method existence, which could be
 * spoofed by any object with matching method signatures.
 */
function isDurableObjectId(id: unknown): id is DurableObjectId {
  if (typeof id !== 'object' || id === null) {
    return false
  }

  const candidate = id as DurableObjectId

  // Check required methods exist
  if (typeof candidate.equals !== 'function' || typeof candidate.toString !== 'function') {
    return false
  }

  // Real DurableObjectIds have a 'name' property (may be undefined but property exists)
  if (!('name' in candidate)) {
    return false
  }

  // Additional validation: toString() should return a non-empty string
  // Real DurableObjectIds return 64-character hex strings
  try {
    const str = candidate.toString()
    if (typeof str !== 'string' || str.length === 0) {
      return false
    }
  } catch {
    // If toString() throws, it's not a valid DurableObjectId
    return false
  }

  return true
}

/**
 * Stub Transport - sends RPC messages via DO stub fetch
 *
 * This transport is ideal for:
 * - Worker-to-DO communication
 * - DO-to-DO communication
 * - Internal Cloudflare Workers RPC
 *
 * Features:
 * - Direct stub access (no HTTP overhead)
 * - Correlation ID propagation
 * - Source DO trust chain support
 * - Structured error handling
 *
 * @example
 * ```typescript
 * // From a Worker
 * const stub = env.MY_DO.get(env.MY_DO.idFromName('my-instance'))
 * const transport = new StubTransport({ stub })
 *
 * const response = await transport.send({
 *   method: 'process',
 *   args: [{ data: 'value' }],
 * })
 *
 * // From another DO (with trust chain)
 * const transport = new StubTransport({
 *   stub,
 *   sourceDoId: this.ctx.id.toString(),
 * })
 * ```
 */
export class StubTransport implements Transport {
  private readonly stub: DurableObjectStub
  private readonly baseUrl: string
  private readonly baseCorrelationId?: string
  private readonly headers: Record<string, string>
  private readonly sourceDoId?: string
  private readonly onError?: ErrorInterceptor

  constructor(options: StubTransportOptions) {
    this.stub = options.stub
    this.baseUrl = options.baseUrl ?? 'https://do'
    if (options.correlationId !== undefined) {
      this.baseCorrelationId = options.correlationId
    }
    this.headers = options.headers ?? {}
    if (options.sourceDoId !== undefined) {
      this.sourceDoId = options.sourceDoId
    }
    this.onError = options.onError
  }

  /**
   * Send an RPC message via DO stub fetch
   */
  async send<T = unknown>(message: RPCMessage): Promise<RPCResponse<T>> {
    const correlationId = message.correlationId ?? this.baseCorrelationId ?? generateCorrelationId()
    const startTime = Date.now()
    const endpoint = `${this.baseUrl}/rpc`

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [CORRELATION_ID_HEADER]: correlationId,
      ...this.headers,
    }

    // Add DO source headers for trust chain
    if (this.sourceDoId) {
      headers[DO_SOURCE_HEADER] = 'true'
      headers[DO_SOURCE_ID_HEADER] = this.sourceDoId
    }

    let response: Response
    try {
      response = await this.stub.fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          method: message.method,
          args: message.args,
        }),
      })
    } catch (error) {
      // Handle transport-level errors (DO stub failures, network issues, etc.)
      const transportError = createTransportErrorFromCatch(error, 'stub', endpoint)

      return createErrorResponse({
        error: transportError,
        correlationId,
        transportType: 'stub',
        message,
        endpoint,
        startTime,
        onError: this.onError,
      })
    }

    const responseCorrelationId = response.headers.get(CORRELATION_ID_HEADER) ?? correlationId

    if (!response.ok) {
      // Try to parse structured error response
      try {
        const errorBody = await response.json() as SerializedError & { correlationId?: string }
        if (isSerializedError(errorBody)) {
          // Apply error interceptor even for server-returned errors
          const context = createErrorContext({
            transportType: 'stub',
            message,
            correlationId: responseCorrelationId,
            error: errorBody,
            endpoint,
            startTime,
          })
          const finalError = applyErrorInterceptor(errorBody, context, this.onError)

          return {
            error: finalError,
            correlationId: responseCorrelationId,
          }
        }
      } catch {
        // Failed to parse as JSON
      }

      // Return generic error response
      const serverError = createServerErrorFromStatus(response.status, 'stub', response.statusText)

      return createErrorResponse({
        error: serverError,
        correlationId: responseCorrelationId,
        transportType: 'stub',
        message,
        endpoint,
        startTime,
        onError: this.onError,
      })
    }

    // Parse successful response
    const result = await response.json() as T
    return {
      result,
      correlationId: responseCorrelationId,
    }
  }

  /**
   * Stub transport is stateless - no close needed
   */
  async close(): Promise<void> {
    // No-op for stateless stub transport
  }

  /**
   * Stub transport is always "connected"
   */
  getState(): TransportState {
    return 'CONNECTED' as TransportState
  }

  /**
   * Get the underlying stub for advanced operations
   */
  getStub(): DurableObjectStub {
    return this.stub
  }
}

/**
 * Create a stub transport from a binding and ID (convenience function)
 *
 * @example
 * ```typescript
 * const transport = createStubTransport({
 *   binding: env.MY_DO,
 *   id: 'my-instance',
 * })
 * ```
 */
export function createStubTransport(options: StubTransportBindingOptions): StubTransport {
  const { binding, id, ...rest } = options
  const doId = isDurableObjectId(id) ? id : binding.idFromName(id)
  const stub = binding.get(doId)
  return new StubTransport({ stub, ...rest })
}

/**
 * Create a stub transport directly from a stub (convenience function)
 *
 * @example
 * ```typescript
 * const stub = env.MY_DO.get(env.MY_DO.idFromName('my-instance'))
 * const transport = createStubTransportFromStub({ stub })
 * ```
 */
export function createStubTransportFromStub(options: StubTransportOptions): StubTransport {
  return new StubTransport(options)
}
