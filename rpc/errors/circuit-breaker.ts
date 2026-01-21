// Circuit Breaker for @dotdo/rpc
// Prevents cascading failures by stopping requests when a threshold is reached

import { CircuitOpenError } from './base'
import { RetryOptions, retryWithBackoff } from './retry'
import { isRetryableError } from './base'

/**
 * Circuit breaker states
 */
export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * Circuit breaker options
 */
export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening circuit (default: 5) */
  failureThreshold?: number
  /** Number of successful requests to close circuit from half-open (default: 2) */
  successThreshold?: number
  /** Time in milliseconds before attempting to close circuit (default: 60000) */
  timeout?: number
}

/**
 * Circuit breaker metrics
 */
export interface CircuitMetrics {
  state: CircuitState
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  consecutiveFailures: number
  lastFailureTime: number | null
}

/**
 * Circuit Breaker pattern implementation
 * Prevents cascading failures by stopping requests when a threshold is reached
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED
  private failureCount = 0
  private successCount = 0
  private consecutiveFailures = 0
  private lastFailureTime: number | null = null
  private totalRequests = 0
  private successfulRequests = 0
  private failedRequests = 0

  private readonly failureThreshold: number
  private readonly successThreshold: number
  private readonly timeout: number

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5
    this.successThreshold = options.successThreshold ?? 2
    this.timeout = options.timeout ?? 60000
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalRequests++

    // Check if circuit should transition from OPEN to HALF_OPEN
    if (
      this.state === CircuitState.OPEN &&
      this.lastFailureTime &&
      Date.now() - this.lastFailureTime >= this.timeout
    ) {
      this.state = CircuitState.HALF_OPEN
      this.successCount = 0
    }

    // Reject immediately if circuit is open
    if (this.state === CircuitState.OPEN) {
      this.failedRequests++
      throw CircuitOpenError.withMetrics({
        consecutiveFailures: this.consecutiveFailures,
        lastFailureTime: this.lastFailureTime,
        resetTimeMs: this.timeout,
      })
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.successfulRequests++
    this.consecutiveFailures = 0

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++
      if (this.successCount >= this.successThreshold) {
        this.state = CircuitState.CLOSED
        this.failureCount = 0
        this.successCount = 0
      }
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(): void {
    this.failedRequests++
    this.failureCount++
    this.consecutiveFailures++
    this.lastFailureTime = Date.now()

    if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in half-open reopens the circuit
      this.state = CircuitState.OPEN
    } else if (this.state === CircuitState.CLOSED) {
      if (this.consecutiveFailures >= this.failureThreshold) {
        this.state = CircuitState.OPEN
      }
    }
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state
  }

  /**
   * Get circuit breaker metrics
   */
  getMetrics(): CircuitMetrics {
    return {
      state: this.state,
      totalRequests: this.totalRequests,
      successfulRequests: this.successfulRequests,
      failedRequests: this.failedRequests,
      consecutiveFailures: this.consecutiveFailures,
      lastFailureTime: this.lastFailureTime,
    }
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.state = CircuitState.CLOSED
    this.failureCount = 0
    this.successCount = 0
    this.consecutiveFailures = 0
    this.lastFailureTime = null
  }
}

/**
 * Options for retry with circuit breaker
 */
export interface RetryWithCircuitBreakerOptions {
  /** Retry options */
  retry?: RetryOptions
  /** Circuit breaker options */
  circuitBreaker?: CircuitBreakerOptions
  /** Optional callback for observing state transitions */
  onStateChange?: (newState: CircuitState, metrics: CircuitMetrics) => void
}

/**
 * Combined retry and circuit breaker metrics
 */
export interface RetryCircuitBreakerMetrics extends CircuitMetrics {
  /** Total number of retry attempts across all requests */
  totalRetryAttempts: number
  /** Last retry delay used */
  lastRetryDelayMs: number | null
}

/**
 * Combines retry with exponential backoff and circuit breaker patterns.
 *
 * This class provides a robust error handling strategy for distributed systems:
 * - Retries transient failures with exponential backoff and jitter
 * - Opens circuit after consecutive failures to fail fast
 * - Transitions to half-open state after timeout to test recovery
 * - Closes circuit after successful requests in half-open state
 *
 * The circuit breaker wraps the retry logic, so:
 * 1. If circuit is OPEN, requests fail immediately with CircuitOpenError
 * 2. If circuit is CLOSED or HALF_OPEN, retries are attempted
 * 3. After all retries fail, failure is recorded and circuit may open
 *
 * @example
 * ```typescript
 * const resilientClient = new RetryWithCircuitBreaker({
 *   retry: {
 *     maxRetries: 3,
 *     initialDelay: 100,
 *     maxDelay: 5000,
 *     jitter: true,
 *   },
 *   circuitBreaker: {
 *     failureThreshold: 5,
 *     successThreshold: 2,
 *     timeout: 30000, // 30 seconds
 *   },
 *   onStateChange: (state, metrics) => {
 *     console.log(`Circuit state changed to ${state}`, metrics)
 *   },
 * })
 *
 * // Use for RPC calls
 * const result = await resilientClient.execute(() => rpcClient.someMethod())
 * ```
 */
export class RetryWithCircuitBreaker {
  private readonly circuitBreaker: CircuitBreaker
  private readonly retryOptions: Required<RetryOptions>
  private readonly onStateChange?: (newState: CircuitState, metrics: CircuitMetrics) => void
  private lastState: CircuitState = CircuitState.CLOSED
  private totalRetryAttempts = 0
  private lastRetryDelayMs: number | null = null

  constructor(options: RetryWithCircuitBreakerOptions = {}) {
    this.circuitBreaker = new CircuitBreaker(options.circuitBreaker)
    this.retryOptions = {
      maxRetries: options.retry?.maxRetries ?? 3,
      initialDelay: options.retry?.initialDelay ?? 1000,
      backoffFactor: options.retry?.backoffFactor ?? 2,
      maxDelay: options.retry?.maxDelay ?? 30000,
      jitter: options.retry?.jitter ?? true, // Default to true for distributed systems
    }
    if (options.onStateChange !== undefined) {
      this.onStateChange = options.onStateChange
    }
  }

  /**
   * Execute a function with retry and circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check for state change before execution
    this.checkStateChange()

    try {
      // Circuit breaker wraps the retry logic
      const result = await this.circuitBreaker.execute(async () => {
        return this.executeWithRetry(fn)
      })
      // Check for state change after success
      this.checkStateChange()
      return result
    } catch (error) {
      // Check for state change after failure (circuit may have opened)
      this.checkStateChange()
      throw error
    }
  }

  /**
   * Internal retry logic with exponential backoff
   */
  private async executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    const { maxRetries, initialDelay, backoffFactor, maxDelay, jitter } = this.retryOptions

    let lastError: unknown
    let attempt = 0

    while (attempt <= maxRetries) {
      try {
        const result = await fn()
        // Check for state change after success
        this.checkStateChange()
        return result
      } catch (error) {
        lastError = error
        attempt++
        this.totalRetryAttempts++

        // Don't retry if not retryable or if we've exhausted retries
        if (!isRetryableError(error) || attempt > maxRetries) {
          // Check for state change after final failure
          this.checkStateChange()
          throw error
        }

        // Calculate delay with exponential backoff
        let delay = Math.min(initialDelay * Math.pow(backoffFactor, attempt - 1), maxDelay)

        // Add jitter if requested (0-25% added to prevent thundering herd)
        if (jitter) {
          const jitterFactor = 0.25
          delay = delay * (1 + Math.random() * jitterFactor)
        }

        this.lastRetryDelayMs = delay

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    throw lastError
  }

  /**
   * Check and notify state changes
   */
  private checkStateChange(): void {
    const currentState = this.circuitBreaker.getState()
    if (currentState !== this.lastState) {
      this.lastState = currentState
      this.onStateChange?.(currentState, this.circuitBreaker.getMetrics())
    }
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.circuitBreaker.getState()
  }

  /**
   * Get combined metrics
   */
  getMetrics(): RetryCircuitBreakerMetrics {
    return {
      ...this.circuitBreaker.getMetrics(),
      totalRetryAttempts: this.totalRetryAttempts,
      lastRetryDelayMs: this.lastRetryDelayMs,
    }
  }

  /**
   * Manually reset the circuit breaker and retry metrics
   */
  reset(): void {
    this.circuitBreaker.reset()
    this.totalRetryAttempts = 0
    this.lastRetryDelayMs = null
    this.lastState = CircuitState.CLOSED
  }

  /**
   * Check if circuit is currently allowing requests
   */
  isAllowingRequests(): boolean {
    const state = this.circuitBreaker.getState()
    return state === CircuitState.CLOSED || state === CircuitState.HALF_OPEN
  }
}
