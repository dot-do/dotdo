// Fetch Transport - HTTP/fetch-based RPC transport
// Used for client-to-worker communication over HTTP

import { generateCorrelationId, CORRELATION_ID_HEADER } from '../headers'
import { isSerializedError, type SerializedError } from '../errors'
import { validateRPCMessage } from '../validation'
import type { Transport, TransportOptions, RPCMessage, RPCResponse, TransportState, ErrorInterceptor } from './types'
import {
  createTransportErrorFromCatch,
  createValidationErrorResponse,
  createServerErrorFromStatus,
  createTransportErrorResponse,
  createErrorContext,
  applyErrorInterceptor,
} from './error-utils'
import { DEFAULT_RPC_TIMEOUT_MS } from '@dotdo/utils'

/**
 * Options for the fetch transport
 */
export interface FetchTransportOptions extends TransportOptions {
  /** Base URL of the RPC endpoint */
  url: string
  /** Custom fetch implementation (for testing or polyfills) */
  fetch?: typeof globalThis.fetch
  /**
   * Enable validation of RPC messages before sending.
   * When enabled, validates method names and checks for circular references.
   * @default false (for backward compatibility)
   */
  validateMessages?: boolean
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
  private readonly validateMessages: boolean
  private readonly onError?: ErrorInterceptor

  constructor(options: FetchTransportOptions) {
    this.url = options.url
    this.timeout = options.timeout ?? DEFAULT_RPC_TIMEOUT_MS
    if (options.correlationId !== undefined) {
      this.baseCorrelationId = options.correlationId
    }
    this.headers = options.headers ?? {}
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.validateMessages = options.validateMessages ?? false
    this.onError = options.onError
  }

  /**
   * Send an RPC message via HTTP POST
   */
  async send<T = unknown>(message: RPCMessage): Promise<RPCResponse<T>> {
    const correlationId = message.correlationId ?? this.baseCorrelationId ?? generateCorrelationId()
    const startTime = Date.now()

    // Validate message if validation is enabled
    if (this.validateMessages) {
      try {
        validateRPCMessage(message)
      } catch (error) {
        // Return validation error without making network request
        const errorMessage = error instanceof Error ? error.message : 'Validation failed'
        const validationError = createValidationErrorResponse(errorMessage, correlationId)

        return createTransportErrorResponse({
          error: validationError,
          correlationId,
          transportType: 'fetch',
          message,
          endpoint: this.url,
          startTime,
          onError: this.onError,
        })
      }
    }

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
      const transportError = createTransportErrorFromCatch(error, 'fetch', this.url)

      return createTransportErrorResponse({
        error: transportError,
        correlationId,
        transportType: 'fetch',
        message,
        endpoint: this.url,
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
            transportType: 'fetch',
            message,
            correlationId: responseCorrelationId,
            error: errorBody,
            endpoint: this.url,
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
      const serverError = createServerErrorFromStatus(response.status, 'fetch', response.statusText)

      return createTransportErrorResponse({
        error: serverError,
        correlationId: responseCorrelationId,
        transportType: 'fetch',
        message,
        endpoint: this.url,
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
