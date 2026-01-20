// DO Stub Transport - Durable Object stub-based RPC transport
// Used for Worker-to-DO and DO-to-DO communication within Cloudflare Workers

import { generateCorrelationId, CORRELATION_ID_HEADER } from '../client'
import { isSerializedError, type SerializedError } from '../errors'
import type { Transport, TransportOptions, RPCMessage, RPCResponse, TransportState } from './types'

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

// DO auth headers (matching cross-do.ts)
const DO_SOURCE_HEADER = 'X-DO-Source'
const DO_SOURCE_ID_HEADER = 'X-DO-Source-ID'

/**
 * Type guard to check if a value is a DurableObjectId
 */
function isDurableObjectId(id: unknown): id is DurableObjectId {
  return typeof id === 'object' && id !== null && 'toString' in id && typeof id !== 'string'
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
  }

  /**
   * Send an RPC message via DO stub fetch
   */
  async send<T = unknown>(message: RPCMessage): Promise<RPCResponse<T>> {
    const correlationId = message.correlationId ?? this.baseCorrelationId ?? generateCorrelationId()

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

    const response = await this.stub.fetch(`${this.baseUrl}/rpc`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        method: message.method,
        args: message.args,
      }),
    })

    const responseCorrelationId = response.headers.get(CORRELATION_ID_HEADER) ?? correlationId

    if (!response.ok) {
      // Try to parse structured error response
      try {
        const errorBody = await response.json() as SerializedError & { correlationId?: string }
        if (isSerializedError(errorBody)) {
          return {
            error: errorBody,
            correlationId: responseCorrelationId,
          }
        }
      } catch {
        // Failed to parse as JSON
      }

      // Return generic error response
      return {
        error: {
          type: 'RPCError',
          code: 'INTERNAL_ERROR',
          message: `DO RPC error: ${response.status}`,
          httpStatus: response.status,
        },
        correlationId: responseCorrelationId,
      }
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
