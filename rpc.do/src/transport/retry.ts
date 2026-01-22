/**
 * @module rpc.do/transport/retry
 *
 * Retry transport with exponential backoff for resilient RPC communication.
 *
 * This module provides a {@link RetryTransport} that wraps any transport and
 * automatically retries failed requests with configurable exponential backoff
 * and jitter strategies.
 *
 * @example Basic usage
 * ```typescript
 * import { RetryTransport, FetchTransport } from 'rpc.do'
 *
 * const transport = new RetryTransport({
 *   transport: new FetchTransport({ url: 'https://api.example.com' }),
 *   maxRetries: 3,
 *   initialDelay: 100,
 *   backoffMultiplier: 2,
 * })
 *
 * // Requests will automatically retry on transient failures
 * const response = await transport.send({ method: 'users.get', args: ['123'] })
 * ```
 *
 * @example Using policy presets
 * ```typescript
 * import { RetryTransport, RetryPolicy, FetchTransport } from 'rpc.do'
 *
 * const transport = new RetryTransport({
 *   transport: new FetchTransport({ url: 'https://api.example.com' }),
 *   ...RetryPolicy.aggressive,
 * })
 * ```
 *
 * @example Custom retry logic
 * ```typescript
 * import { RetryTransport, FetchTransport } from 'rpc.do'
 *
 * const transport = new RetryTransport({
 *   transport: new FetchTransport({ url: 'https://api.example.com' }),
 *   maxRetries: 5,
 *   isRetryable: (error) => error.code === 'MY_CUSTOM_ERROR',
 *   onRetry: (attempt, delay, error) => {
 *     console.log(`Retry ${attempt} in ${delay}ms: ${error.message}`)
 *   },
 * })
 * ```
 */

import type { RPCMessage, RPCResponse, SerializedError } from '../types'
import type { Transport, TransportState, TransportEventListener } from './types'

/**
 * Jitter strategy for randomizing retry delays.
 *
 * Different strategies trade off between thundering herd prevention
 * and retry timing predictability:
 *
 * - `'none'` - No jitter, exact exponential backoff
 * - `'full'` - Full jitter: `random() * delay` (default, recommended)
 * - `'equal'` - Equal jitter: `delay/2 + random() * delay/2`
 * - `'decorrelated'` - Decorrelated: `min(maxDelay, random() * prevDelay * 3)`
 *
 * @see {@link https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/ | AWS Exponential Backoff and Jitter}
 */
export type JitterStrategy = 'none' | 'full' | 'equal' | 'decorrelated'

/**
 * Options for configuring the retry transport.
 */
export interface RetryOptions {
  /**
   * The underlying transport to wrap with retry logic.
   */
  transport: Transport

  /**
   * Maximum number of retry attempts (not including the initial attempt).
   * @default 3
   */
  maxRetries?: number

  /**
   * Initial delay in milliseconds before the first retry.
   * @default 100
   */
  initialDelay?: number

  /**
   * Maximum delay in milliseconds between retries.
   * @default 30000
   */
  maxDelay?: number

  /**
   * Multiplier for exponential backoff.
   * Each retry delay is multiplied by this factor.
   * @default 2
   */
  backoffMultiplier?: number

  /**
   * Jitter strategy for randomizing retry delays.
   * @default 'full'
   */
  jitter?: JitterStrategy

  /**
   * Custom function to determine if an error is retryable.
   * If not provided, uses the default retryable error codes.
   *
   * @param error - The serialized error from the response
   * @returns True if the request should be retried
   */
  isRetryable?: (error: SerializedError) => boolean

  /**
   * Callback invoked before each retry attempt.
   * Useful for logging or metrics.
   *
   * @param attempt - The retry attempt number (1-indexed)
   * @param delay - The delay in milliseconds before the retry
   * @param error - The error that triggered the retry
   */
  onRetry?: (attempt: number, delay: number, error: Error) => void
}

/**
 * Default error codes that are considered retryable.
 *
 * These codes typically indicate transient failures that may succeed on retry:
 * - `NETWORK_ERROR` - Network connectivity issues
 * - `TIMEOUT` - Request timeout
 * - `SERVICE_UNAVAILABLE` - Service temporarily unavailable (503)
 * - `RATE_LIMIT` - Rate limit exceeded (429)
 */
const DEFAULT_RETRYABLE_CODES = new Set([
  'NETWORK_ERROR',
  'TIMEOUT',
  'SERVICE_UNAVAILABLE',
  'RATE_LIMIT',
])

/**
 * Sleep for a specified duration.
 *
 * @param ms - Duration in milliseconds
 * @returns Promise that resolves after the delay
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Retry Transport - wraps any transport with automatic retry logic.
 *
 * This transport decorator adds exponential backoff with jitter to any
 * underlying transport. It automatically retries requests that fail with
 * transient errors while respecting configurable limits.
 *
 * Features:
 * - Exponential backoff with configurable multiplier
 * - Multiple jitter strategies to prevent thundering herd
 * - Custom retry predicates for application-specific logic
 * - Retry callbacks for logging and monitoring
 * - Full delegation of optional transport methods
 *
 * @example
 * ```typescript
 * const transport = new RetryTransport({
 *   transport: new FetchTransport({ url: 'https://api.example.com' }),
 *   maxRetries: 3,
 *   initialDelay: 100,
 *   backoffMultiplier: 2,
 *   jitter: 'full',
 *   onRetry: (attempt, delay, error) => {
 *     console.log(`Retry attempt ${attempt} in ${delay}ms: ${error.message}`)
 *   },
 * })
 * ```
 */
export class RetryTransport implements Transport {
  private readonly transport: Transport
  private readonly maxRetries: number
  private readonly initialDelay: number
  private readonly maxDelay: number
  private readonly backoffMultiplier: number
  private readonly jitter: JitterStrategy
  private readonly isRetryableFn?: (error: SerializedError) => boolean
  private readonly onRetryFn?: (attempt: number, delay: number, error: Error) => void

  /**
   * Track the previous delay for decorrelated jitter
   */
  private previousDelay: number

  constructor(options: RetryOptions) {
    this.transport = options.transport
    this.maxRetries = options.maxRetries ?? 3
    this.initialDelay = options.initialDelay ?? 100
    this.maxDelay = options.maxDelay ?? 30000
    this.backoffMultiplier = options.backoffMultiplier ?? 2
    this.jitter = options.jitter ?? 'full'
    if (options.isRetryable !== undefined) {
      this.isRetryableFn = options.isRetryable
    }
    if (options.onRetry !== undefined) {
      this.onRetryFn = options.onRetry
    }
    this.previousDelay = this.initialDelay
  }

  /**
   * Send an RPC message with automatic retry on transient failures.
   *
   * @param message - The RPC message to send
   * @returns Promise resolving to the RPC response
   */
  async send<T = unknown>(message: RPCMessage): Promise<RPCResponse<T>> {
    let lastError: Error | undefined
    let delay = this.initialDelay
    // Reset previousDelay for decorrelated jitter
    this.previousDelay = this.initialDelay

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.transport.send<T>(message)

        // Check if response has a retryable error
        if (response.error) {
          if (!this.isRetryableError(response.error)) {
            return response
          }
          lastError = new Error(response.error.message)
        } else {
          // Success!
          return response
        }
      } catch (error) {
        // Transport-level error (network failure, etc.)
        lastError = error instanceof Error ? error : new Error(String(error))
      }

      // Don't sleep after the last attempt
      if (attempt < this.maxRetries) {
        const jitteredDelay = this.applyJitter(delay)
        this.onRetryFn?.(attempt + 1, jitteredDelay, lastError!)
        await sleep(jitteredDelay)

        // Update delay for next iteration
        this.previousDelay = jitteredDelay
        delay = Math.min(delay * this.backoffMultiplier, this.maxDelay)
      }
    }

    // All retries exhausted
    const errorResponse: RPCResponse<T> = {
      error: {
        type: 'RetryExhaustedError',
        code: 'RETRY_EXHAUSTED',
        message: `Failed after ${this.maxRetries + 1} attempts: ${lastError?.message}`,
      },
    }
    if (message.correlationId !== undefined) {
      errorResponse.correlationId = message.correlationId
    }
    return errorResponse
  }

  /**
   * Apply jitter strategy to a delay value.
   *
   * @param delay - The base delay in milliseconds
   * @returns The jittered delay in milliseconds
   */
  private applyJitter(delay: number): number {
    switch (this.jitter) {
      case 'none':
        return delay

      case 'full':
        // Full jitter: random value between 0 and delay
        return Math.random() * delay

      case 'equal':
        // Equal jitter: half base delay plus random half
        return delay / 2 + Math.random() * (delay / 2)

      case 'decorrelated':
        // Decorrelated jitter: based on previous delay
        return Math.min(this.maxDelay, Math.random() * this.previousDelay * 3)
    }
  }

  /**
   * Check if an error should trigger a retry.
   *
   * @param error - The serialized error from the response
   * @returns True if the request should be retried
   */
  private isRetryableError(error: SerializedError): boolean {
    if (this.isRetryableFn) {
      return this.isRetryableFn(error)
    }
    return DEFAULT_RETRYABLE_CODES.has(error.code)
  }

  /**
   * Close the underlying transport.
   *
   * @returns Promise that resolves when the transport is closed
   */
  async close(): Promise<void> {
    if (this.transport.close) {
      return this.transport.close()
    }
  }

  /**
   * Get the state of the underlying transport.
   *
   * @returns The current transport state
   */
  getState(): TransportState {
    if (this.transport.getState) {
      return this.transport.getState()
    }
    return 'CONNECTED' as TransportState
  }

  /**
   * Add an event listener to the underlying transport.
   *
   * @param listener - The event listener function
   * @returns Function to remove the listener
   */
  addEventListener(listener: TransportEventListener): () => void {
    if (this.transport.addEventListener) {
      return this.transport.addEventListener(listener)
    }
    // Return no-op unsubscribe for transports without event support
    return () => {}
  }
}

/**
 * Predefined retry policy presets for common use cases.
 *
 * @example
 * ```typescript
 * import { RetryTransport, RetryPolicy, FetchTransport } from 'rpc.do'
 *
 * // Aggressive retry for critical paths
 * const aggressiveTransport = new RetryTransport({
 *   transport: new FetchTransport({ url: 'https://api.example.com' }),
 *   ...RetryPolicy.aggressive,
 * })
 *
 * // Conservative retry for less critical operations
 * const conservativeTransport = new RetryTransport({
 *   transport: new FetchTransport({ url: 'https://api.example.com' }),
 *   ...RetryPolicy.conservative,
 * })
 *
 * // No retries
 * const noRetryTransport = new RetryTransport({
 *   transport: new FetchTransport({ url: 'https://api.example.com' }),
 *   ...RetryPolicy.none,
 * })
 * ```
 */
export const RetryPolicy = {
  /**
   * Aggressive retry policy - more attempts with shorter initial delay.
   *
   * Best for:
   * - Critical operations where failure is costly
   * - Services with high transient failure rates
   * - Real-time applications requiring quick recovery
   */
  aggressive: {
    maxRetries: 5,
    initialDelay: 50,
    backoffMultiplier: 1.5,
    maxDelay: 5000,
    jitter: 'full' as JitterStrategy,
  },

  /**
   * Conservative retry policy - fewer attempts with longer delays.
   *
   * Best for:
   * - Background operations
   * - Services under load
   * - Operations where too many retries could cause issues
   */
  conservative: {
    maxRetries: 3,
    initialDelay: 500,
    backoffMultiplier: 2,
    maxDelay: 30000,
    jitter: 'full' as JitterStrategy,
  },

  /**
   * No retry policy - single attempt only.
   *
   * Best for:
   * - Operations that should fail fast
   * - Non-idempotent operations where retries are dangerous
   * - Testing or debugging
   */
  none: {
    maxRetries: 0,
    initialDelay: 0,
    backoffMultiplier: 1,
    maxDelay: 0,
    jitter: 'none' as JitterStrategy,
  },
} as const

/**
 * Create a retry transport (convenience factory function).
 *
 * This is a convenience wrapper around `new RetryTransport(options)` for
 * functional programming styles or dependency injection.
 *
 * @param options - Configuration options for the retry transport
 * @returns A new RetryTransport instance
 *
 * @example
 * ```typescript
 * import { createRetryTransport, createFetchTransport } from 'rpc.do'
 *
 * const transport = createRetryTransport({
 *   transport: createFetchTransport({ url: 'https://api.example.com' }),
 *   maxRetries: 3,
 *   initialDelay: 100,
 * })
 * ```
 */
export function createRetryTransport(options: RetryOptions): RetryTransport {
  return new RetryTransport(options)
}
