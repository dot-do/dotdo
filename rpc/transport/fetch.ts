// Fetch Transport - HTTP/fetch-based RPC transport
// Used for client-to-worker communication over HTTP

import { generateCorrelationId, CORRELATION_ID_HEADER } from '../client'
import { deserializeError, isSerializedError, type SerializedError } from '../errors'
import type { Transport, TransportOptions, RPCMessage, RPCResponse, TransportState } from './types'

/**
 * Options for the fetch transport
 */
export interface FetchTransportOptions extends TransportOptions {
  /** Base URL of the RPC endpoint */
  url: string
  /** Custom fetch implementation (for testing or polyfills) */
  fetch?: typeof globalThis.fetch
}

/**
 * Fetch Transport - sends RPC messages via HTTP POST
 *
 * This transport is ideal for:
 * - Browser-to-server RPC
 * - Server-to-server RPC
 * - Any environment with HTTP connectivity
 *
 * Features:
 * - Configurable timeout via AbortSignal
 * - Correlation ID propagation
 * - Structured error handling
 *
 * @example
 * ```typescript
 * const transport = new FetchTransport({
 *   url: 'https://api.example.com',
 *   timeout: 5000,
 * })
 *
 * const response = await transport.send({
 *   method: 'users.create',
 *   args: [{ name: 'Alice' }],
 * })
 *
 * if (response.error) {
 *   throw deserializeError(response.error)
 * }
 * console.log(response.result)
 * ```
 */
export class FetchTransport implements Transport {
  private readonly url: string
  private readonly timeout: number
  private readonly baseCorrelationId?: string
  private readonly headers: Record<string, string>
  private readonly fetchImpl: typeof globalThis.fetch

  constructor(options: FetchTransportOptions) {
    this.url = options.url
    this.timeout = options.timeout ?? 30000
    if (options.correlationId !== undefined) {
      this.baseCorrelationId = options.correlationId
    }
    this.headers = options.headers ?? {}
    this.fetchImpl = options.fetch ?? globalThis.fetch
  }

  /**
   * Send an RPC message via HTTP POST
   */
  async send<T = unknown>(message: RPCMessage): Promise<RPCResponse<T>> {
    const correlationId = message.correlationId ?? this.baseCorrelationId ?? generateCorrelationId()

    const response = await this.fetchImpl(`${this.url}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [CORRELATION_ID_HEADER]: correlationId,
        ...this.headers,
      },
      body: JSON.stringify({
        method: message.method,
        args: message.args,
      }),
      signal: AbortSignal.timeout(this.timeout),
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
          message: `RPC error: ${response.status}`,
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
   * Fetch transport is stateless - no close needed
   */
  async close(): Promise<void> {
    // No-op for stateless HTTP transport
  }

  /**
   * Fetch transport is always "connected"
   */
  getState(): TransportState {
    return 'CONNECTED' as TransportState
  }
}

/**
 * Create a fetch transport (convenience function)
 */
export function createFetchTransport(options: FetchTransportOptions): FetchTransport {
  return new FetchTransport(options)
}
