/**
 * @module rpc.do/transport/fetch
 *
 * HTTP/fetch-based RPC transport for client-to-worker communication.
 *
 * This module provides a stateless HTTP transport that sends RPC messages
 * as JSON POST requests. It's ideal for browser-to-server and server-to-server
 * communication.
 *
 * @example
 * ```typescript
 * import { FetchTransport, createFetchTransport } from 'rpc.do'
 *
 * // Using the class
 * const transport = new FetchTransport({
 *   url: 'https://api.example.com',
 *   timeout: 5000,
 * })
 *
 * // Or using the factory function
 * const transport = createFetchTransport({ url: 'https://api.example.com' })
 *
 * const response = await transport.send({
 *   method: 'users.create',
 *   args: [{ name: 'Alice' }],
 * })
 * ```
 */

import type { RPCMessage, RPCResponse, SerializedError } from '../types'
import type { Transport, TransportOptions, TransportState } from './types'

/**
 * HTTP header name for correlation ID.
 *
 * This header is used for request tracing and debugging across service boundaries.
 * The correlation ID is automatically generated if not provided and echoed back
 * in responses.
 *
 * @example
 * ```typescript
 * // The header is automatically set by FetchTransport
 * // Response includes: X-Correlation-ID: <uuid>
 * ```
 */
export const CORRELATION_ID_HEADER = 'X-Correlation-ID'

/**
 * Generate a unique correlation ID for request tracing.
 *
 * Uses `crypto.randomUUID()` when available (modern browsers and Node.js 19+),
 * with a fallback for older environments.
 *
 * @returns A unique correlation ID string (UUID format when crypto is available)
 *
 * @example
 * ```typescript
 * const correlationId = generateCorrelationId()
 * // => "550e8400-e29b-41d4-a716-446655440000" (UUID)
 * // or "ln5x2...9dk3" (fallback format)
 * ```
 */
export function generateCorrelationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback for environments without crypto.randomUUID
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`
}

/**
 * Check if a value is a serialized error
 */
function isSerializedError(value: unknown): value is SerializedError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    typeof (value as SerializedError).code === 'string' &&
    typeof (value as SerializedError).message === 'string'
  )
}

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
 *   throw new Error(response.error.message)
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

    let response: Response
    try {
      response = await this.fetchImpl(`${this.url}/rpc`, {
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
    } catch (error) {
      // Handle transport-level errors (network failures, timeouts, DNS resolution, etc.)
      return {
        error: {
          type: 'TransportError',
          code: 'TRANSPORT_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
        correlationId,
      }
    }

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
 * Create a fetch transport (convenience factory function).
 *
 * This is a convenience wrapper around `new FetchTransport(options)` for
 * functional programming styles or dependency injection.
 *
 * @param options - Configuration options for the transport
 * @returns A new FetchTransport instance
 *
 * @example
 * ```typescript
 * import { createFetchTransport, createClient } from 'rpc.do'
 *
 * const transport = createFetchTransport({
 *   url: 'https://api.example.com',
 *   timeout: 10000,
 *   headers: { 'X-API-Key': 'secret' },
 * })
 *
 * const client = createClient<MyAPI>('https://api.example.com', { transport })
 * ```
 */
export function createFetchTransport(options: FetchTransportOptions): FetchTransport {
  return new FetchTransport(options)
}
