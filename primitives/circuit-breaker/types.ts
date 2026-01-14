/**
 * Circuit Breaker Types
 *
 * Comprehensive type definitions for the circuit breaker pattern implementation.
 */

/**
 * The three states a circuit breaker can be in:
 * - 'closed': Normal operation, requests pass through
 * - 'open': Circuit is tripped, requests are rejected immediately
 * - 'half-open': Testing if the service has recovered
 */
export type CircuitState = 'closed' | 'open' | 'half-open'

/**
 * Configuration options for the circuit breaker
 */
export interface CircuitConfig {
  /** Number of failures before opening the circuit */
  failureThreshold: number
  /** Time in ms to wait before transitioning from open to half-open */
  resetTimeout: number
  /** Number of requests to allow through in half-open state */
  halfOpenRequests: number
  /** Optional name for identification in registry */
  name?: string
  /** Optional sliding window configuration */
  slidingWindow?: SlidingWindowConfig
  /** Optional fallback configuration */
  fallback?: FallbackConfig
  /** Optional health check configuration */
  healthCheck?: HealthCheckConfig
  /** Optional bulkhead configuration */
  bulkhead?: BulkheadConfig
  /** Optional retry policy configuration */
  retryPolicy?: RetryPolicyConfig
}

/**
 * Statistics about the circuit breaker state
 */
export interface CircuitStats {
  /** Current number of consecutive failures */
  failures: number
  /** Current number of consecutive successes */
  successes: number
  /** Timestamp of the last failure */
  lastFailure: number | null
  /** Current circuit state */
  state: CircuitState
  /** Total number of requests */
  totalRequests: number
  /** Total number of successful requests */
  totalSuccesses: number
  /** Total number of failed requests */
  totalFailures: number
  /** Total number of rejected requests (when open) */
  totalRejected: number
  /** Total number of fallback executions */
  totalFallbacks: number
}

/**
 * Events emitted by the circuit breaker
 */
export type CircuitEvent = 'success' | 'failure' | 'open' | 'close' | 'half-open' | 'rejected' | 'fallback'

/**
 * Configuration for fallback behavior
 */
export interface FallbackConfig {
  /** Handler function to execute when circuit is open */
  handler: <T>() => T | Promise<T>
  /** Timeout for fallback execution in ms */
  timeout?: number
}

/**
 * Configuration for health checking
 */
export interface HealthCheckConfig {
  /** Interval in ms between health checks */
  interval: number
  /** Function to check if the service is healthy */
  checker: () => boolean | Promise<boolean>
}

/**
 * Configuration for bulkhead pattern (concurrency limiting)
 */
export interface BulkheadConfig {
  /** Maximum number of concurrent executions */
  maxConcurrent: number
  /** Maximum queue size for waiting requests */
  queueSize?: number
  /** Timeout for queued requests in ms */
  queueTimeout?: number
}

/**
 * Configuration for sliding window failure tracking
 */
export interface SlidingWindowConfig {
  /** Size of the sliding window in ms */
  windowSize: number
  /** Minimum number of requests before tripping */
  minRequests?: number
}

/**
 * Configuration for retry policy
 */
export interface RetryPolicyConfig {
  /** Maximum number of retries before recording failure */
  maxRetries: number
  /** Base delay between retries in ms */
  baseDelay?: number
  /** Maximum delay between retries in ms */
  maxDelay?: number
  /** Exponential backoff multiplier */
  backoffMultiplier?: number
  /** Function to determine if error is retryable */
  retryableErrors?: (error: Error) => boolean
}

/**
 * State change callback type
 */
export type StateChangeCallback = (
  previousState: CircuitState,
  currentState: CircuitState,
  stats: CircuitStats
) => void

/**
 * Event callback type
 */
export type EventCallback = (event: CircuitEvent, data?: unknown) => void

/**
 * Error thrown when circuit is open
 */
export class CircuitOpenError extends Error {
  constructor(
    message: string = 'Circuit is open',
    public readonly circuitName?: string
  ) {
    super(message)
    this.name = 'CircuitOpenError'
  }
}

/**
 * Error thrown when bulkhead is full
 */
export class BulkheadFullError extends Error {
  constructor(message: string = 'Bulkhead is full') {
    super(message)
    this.name = 'BulkheadFullError'
  }
}

/**
 * Error thrown when queue timeout is exceeded
 */
export class QueueTimeoutError extends Error {
  constructor(message: string = 'Queue timeout exceeded') {
    super(message)
    this.name = 'QueueTimeoutError'
  }
}

/**
 * Sliding window entry for tracking failures
 */
export interface SlidingWindowEntry {
  timestamp: number
  success: boolean
}
