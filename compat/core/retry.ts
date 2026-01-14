/**
 * @dotdo/compat/core - Retry/Backoff Infrastructure
 *
 * Unified retry/backoff infrastructure for compat SDKs including:
 * - Exponential backoff with jitter
 * - Retry decisions based on HTTP status codes
 * - Retry-After header handling
 * - Circuit breaker pattern
 * - Retry context and observability
 */

// =============================================================================
// Interfaces
// =============================================================================

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number
  /** Initial delay in milliseconds (default: 1000) */
  initialDelay: number
  /** Maximum delay cap in milliseconds (default: 32000) */
  maxDelay: number
  /** Backoff multiplier (default: 2) */
  multiplier: number
  /** Jitter factor 0-1 (default: 0.25 for +/-25%) */
  jitter: number
  /** Total timeout budget in milliseconds (default: 60000) */
  timeoutBudget: number
  /** Optional circuit breaker config */
  circuitBreaker?: CircuitBreakerConfig
}

/**
 * Context passed to retry decision functions
 */
export interface RetryContext {
  /** Current attempt number (1-based) */
  attempt: number
  /** Total elapsed time in milliseconds */
  elapsedTime: number
  /** The error that caused the retry */
  error: Error | Response
  /** Configuration being used */
  config: RetryConfig
}

/**
 * Event emitted during retry operations
 */
export interface RetryEvent {
  type: 'retry' | 'success' | 'exhausted' | 'circuit-open'
  attempt: number
  delay?: number
  error?: Error
  elapsedTime: number
}

/**
 * Circuit breaker states
 */
export type CircuitState = 'closed' | 'open' | 'half-open'

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of consecutive failures to open circuit (default: 5) */
  failureThreshold: number
  /** Cooldown period in milliseconds before half-open (default: 30000) */
  cooldownPeriod: number
  /** Number of successes in half-open to close circuit (default: 1) */
  successThreshold: number
}

/**
 * Circuit breaker interface
 */
export interface ICircuitBreaker {
  getState(): CircuitState
  isRequestAllowed(): boolean
  recordSuccess(): void
  recordFailure(): void
}

/**
 * Main retry handler interface
 */
export interface RetryHandler {
  /** Execute a function with retry logic */
  execute<T>(fn: () => Promise<T>): Promise<T>
  /** Execute a fetch request with retry logic */
  fetch(url: string, options?: RequestInit): Promise<Response>
  /** Check if a response should be retried */
  shouldRetry(response: Response): boolean
  /** Calculate delay for next retry */
  calculateDelay(attempt: number, retryAfter?: number): number
  /** Subscribe to retry events */
  onRetry(handler: (event: RetryEvent) => void): () => void
  /** Get current circuit breaker state */
  getCircuitState(): CircuitState
}

// =============================================================================
// Default Configuration
// =============================================================================

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 32000,
  multiplier: 2,
  jitter: 0.25,
  timeoutBudget: 60000,
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Determine if an HTTP status code is retryable
 */
export function isRetryableStatus(status: number): boolean {
  // Retry on rate limiting and server errors
  const retryableStatuses = [429, 500, 502, 503, 504]
  return retryableStatuses.includes(status)
}

/**
 * Parse Retry-After header value
 * @param headers Response headers
 * @param maxDelay Optional maximum delay cap
 * @returns Delay in milliseconds or undefined if header not present/invalid
 */
export function parseRetryAfter(headers: Headers, maxDelay?: number): number | undefined {
  const retryAfter = headers.get('Retry-After')
  if (!retryAfter) {
    return undefined
  }

  let delayMs: number | undefined

  // Try parsing as seconds (integer)
  const seconds = parseInt(retryAfter, 10)
  if (!isNaN(seconds) && String(seconds) === retryAfter.trim()) {
    delayMs = seconds * 1000
  } else {
    // Try parsing as HTTP date
    const date = Date.parse(retryAfter)
    if (!isNaN(date)) {
      delayMs = Math.max(0, date - Date.now())
    }
  }

  if (delayMs === undefined) {
    return undefined
  }

  // Apply max delay cap if provided
  if (maxDelay !== undefined && delayMs > maxDelay) {
    return maxDelay
  }

  return delayMs
}

/**
 * Calculate exponential backoff delay with optional jitter
 * @param attempt Current attempt number (1-based)
 * @param config Retry configuration
 * @returns Delay in milliseconds
 */
export function calculateExponentialBackoff(attempt: number, config: RetryConfig): number {
  // Calculate base delay: initialDelay * multiplier^(attempt-1)
  const baseDelay = config.initialDelay * Math.pow(config.multiplier, attempt - 1)

  // Apply max delay cap
  const cappedDelay = Math.min(baseDelay, config.maxDelay)

  // Apply jitter if configured
  if (config.jitter > 0) {
    // Random value between -jitter and +jitter
    const jitterFactor = 1 + (Math.random() * 2 - 1) * config.jitter
    return Math.round(cappedDelay * jitterFactor)
  }

  return cappedDelay
}

// =============================================================================
// Circuit Breaker Implementation
// =============================================================================

export class CircuitBreaker implements ICircuitBreaker {
  private state: CircuitState = 'closed'
  private failureCount: number = 0
  private successCount: number = 0
  private lastFailureTime: number = 0
  private config: CircuitBreakerConfig

  constructor(config: CircuitBreakerConfig) {
    this.config = config
  }

  getState(): CircuitState {
    // Check if we should transition from open to half-open
    if (this.state === 'open') {
      const now = Date.now()
      if (now - this.lastFailureTime >= this.config.cooldownPeriod) {
        this.state = 'half-open'
        this.successCount = 0
      }
    }
    return this.state
  }

  isRequestAllowed(): boolean {
    const currentState = this.getState()
    return currentState === 'closed' || currentState === 'half-open'
  }

  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount++
      if (this.successCount >= this.config.successThreshold) {
        this.state = 'closed'
        this.failureCount = 0
        this.successCount = 0
      }
    } else if (this.state === 'closed') {
      // Reset failure count on success in closed state
      this.failureCount = 0
    }
  }

  recordFailure(): void {
    if (this.state === 'half-open') {
      // Immediately open circuit on failure in half-open state
      this.state = 'open'
      this.lastFailureTime = Date.now()
      this.failureCount = this.config.failureThreshold
    } else if (this.state === 'closed') {
      this.failureCount++
      if (this.failureCount >= this.config.failureThreshold) {
        this.state = 'open'
        this.lastFailureTime = Date.now()
      }
    }
  }
}

// =============================================================================
// Retry Handler Implementation
// =============================================================================

class RetryHandlerImpl implements RetryHandler {
  private config: RetryConfig
  private circuitBreaker: CircuitBreaker | null
  private eventHandlers: Set<(event: RetryEvent) => void> = new Set()

  constructor(config: RetryConfig) {
    this.config = config
    this.circuitBreaker = config.circuitBreaker
      ? new CircuitBreaker(config.circuitBreaker)
      : null
  }

  shouldRetry(response: Response): boolean {
    return isRetryableStatus(response.status)
  }

  calculateDelay(attempt: number, retryAfter?: number): number {
    // Prefer Retry-After if provided
    if (retryAfter !== undefined) {
      return Math.min(retryAfter, this.config.maxDelay)
    }
    return calculateExponentialBackoff(attempt, this.config)
  }

  onRetry(handler: (event: RetryEvent) => void): () => void {
    this.eventHandlers.add(handler)
    return () => {
      this.eventHandlers.delete(handler)
    }
  }

  getCircuitState(): CircuitState {
    return this.circuitBreaker?.getState() ?? 'closed'
  }

  private emitEvent(event: RetryEvent): void {
    for (const handler of this.eventHandlers) {
      handler(event)
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const startTime = Date.now()
    let attempt = 0
    let lastError: Error | undefined

    while (attempt <= this.config.maxRetries) {
      attempt++
      const elapsedTime = Date.now() - startTime

      // Check circuit breaker
      if (this.circuitBreaker && !this.circuitBreaker.isRequestAllowed()) {
        this.emitEvent({
          type: 'circuit-open',
          attempt,
          elapsedTime,
          error: lastError,
        })
        throw lastError ?? new Error('Circuit breaker is open')
      }

      // Check timeout budget (but allow at least the first attempt)
      if (attempt > 1 && elapsedTime >= this.config.timeoutBudget) {
        this.emitEvent({
          type: 'exhausted',
          attempt: attempt - 1,
          elapsedTime,
          error: lastError,
        })
        throw lastError ?? new Error('Timeout budget exceeded')
      }

      try {
        const result = await fn()
        this.circuitBreaker?.recordSuccess()

        // Emit success event if this was a retry and we succeeded
        // Success event is emitted to indicate recovery after failure(s)
        if (attempt > 1) {
          this.emitEvent({
            type: 'success',
            attempt,
            elapsedTime: Date.now() - startTime,
          })
        }

        return result
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        this.circuitBreaker?.recordFailure()

        // Check if circuit opened
        if (this.circuitBreaker?.getState() === 'open') {
          this.emitEvent({
            type: 'circuit-open',
            attempt,
            elapsedTime: Date.now() - startTime,
            error: lastError,
          })
        }

        // Check if we've exhausted retries
        if (attempt > this.config.maxRetries) {
          this.emitEvent({
            type: 'exhausted',
            attempt,
            elapsedTime: Date.now() - startTime,
            error: lastError,
          })
          throw lastError
        }

        // Check if we'll exceed timeout budget with next delay
        const delay = this.calculateDelay(attempt)
        const nextElapsedTime = Date.now() - startTime + delay

        if (nextElapsedTime >= this.config.timeoutBudget) {
          this.emitEvent({
            type: 'exhausted',
            attempt,
            elapsedTime: Date.now() - startTime,
            error: lastError,
          })
          throw lastError
        }

        // Emit retry event
        this.emitEvent({
          type: 'retry',
          attempt,
          delay,
          elapsedTime: Date.now() - startTime,
          error: lastError,
        })

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }

    // Should not reach here, but just in case
    throw lastError ?? new Error('Retries exhausted')
  }

  async fetch(url: string, options?: RequestInit): Promise<Response> {
    const startTime = Date.now()
    let attempt = 0
    let lastError: Error | undefined
    let lastResponse: Response | undefined

    while (attempt <= this.config.maxRetries) {
      attempt++
      const elapsedTime = Date.now() - startTime

      // Check circuit breaker
      if (this.circuitBreaker && !this.circuitBreaker.isRequestAllowed()) {
        this.emitEvent({
          type: 'circuit-open',
          attempt,
          elapsedTime,
          error: lastError,
        })
        throw lastError ?? new Error('Circuit breaker is open')
      }

      // Check timeout budget (but allow at least the first attempt)
      if (attempt > 1 && elapsedTime >= this.config.timeoutBudget) {
        this.emitEvent({
          type: 'exhausted',
          attempt: attempt - 1,
          elapsedTime,
          error: lastError,
        })
        if (lastResponse && !this.shouldRetry(lastResponse)) {
          return lastResponse
        }
        throw lastError ?? new Error('Timeout budget exceeded')
      }

      try {
        const response = await globalThis.fetch(url, options)
        lastResponse = response

        // Check if response is retryable
        if (!this.shouldRetry(response)) {
          this.circuitBreaker?.recordSuccess()

          // Emit success event if this was a retry (attempt > 1)
          if (attempt > 1) {
            this.emitEvent({
              type: 'success',
              attempt,
              elapsedTime: Date.now() - startTime,
            })
          }

          return response
        }

        // Response indicates a retryable error
        this.circuitBreaker?.recordFailure()

        // Check if circuit opened
        if (this.circuitBreaker?.getState() === 'open') {
          this.emitEvent({
            type: 'circuit-open',
            attempt,
            elapsedTime: Date.now() - startTime,
          })
        }

        // Check if we've exhausted retries
        if (attempt > this.config.maxRetries) {
          this.emitEvent({
            type: 'exhausted',
            attempt,
            elapsedTime: Date.now() - startTime,
          })
          throw new Error(`Request failed with status ${response.status} after ${attempt} attempts`)
        }

        // Calculate delay, preferring Retry-After header
        const retryAfter = parseRetryAfter(response.headers, this.config.maxDelay)
        const delay = this.calculateDelay(attempt, retryAfter)
        const nextElapsedTime = Date.now() - startTime + delay

        if (nextElapsedTime >= this.config.timeoutBudget) {
          this.emitEvent({
            type: 'exhausted',
            attempt,
            elapsedTime: Date.now() - startTime,
          })
          throw new Error(`Request failed with status ${response.status} - timeout budget exceeded`)
        }

        // Emit retry event
        this.emitEvent({
          type: 'retry',
          attempt,
          delay,
          elapsedTime: Date.now() - startTime,
        })

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, delay))
      } catch (error) {
        if (error instanceof Error && error.message.includes('Request failed with status')) {
          throw error
        }

        lastError = error instanceof Error ? error : new Error(String(error))
        this.circuitBreaker?.recordFailure()

        // Check if circuit opened
        if (this.circuitBreaker?.getState() === 'open') {
          this.emitEvent({
            type: 'circuit-open',
            attempt,
            elapsedTime: Date.now() - startTime,
            error: lastError,
          })
        }

        // Check if we've exhausted retries
        if (attempt > this.config.maxRetries) {
          this.emitEvent({
            type: 'exhausted',
            attempt,
            elapsedTime: Date.now() - startTime,
            error: lastError,
          })
          throw lastError
        }

        // Calculate delay
        const delay = this.calculateDelay(attempt)
        const nextElapsedTime = Date.now() - startTime + delay

        if (nextElapsedTime >= this.config.timeoutBudget) {
          this.emitEvent({
            type: 'exhausted',
            attempt,
            elapsedTime: Date.now() - startTime,
            error: lastError,
          })
          throw lastError
        }

        // Emit retry event
        this.emitEvent({
          type: 'retry',
          attempt,
          delay,
          elapsedTime: Date.now() - startTime,
          error: lastError,
        })

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }

    // Should not reach here, but just in case
    throw lastError ?? new Error('Retries exhausted')
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createRetryHandler(config?: Partial<RetryConfig>): RetryHandler {
  return new RetryHandlerImpl({
    ...DEFAULT_RETRY_CONFIG,
    ...config,
  })
}
