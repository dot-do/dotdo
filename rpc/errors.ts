// Error Handling and Retries for @dotdo/rpc
// Provides robust error handling with retry logic, circuit breaker, and timeout support

/**
 * Standard RPC error codes
 */
export enum RPCErrorCode {
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  INVALID_PARAMS = 'INVALID_PARAMS',
  TIMEOUT = 'TIMEOUT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  RATE_LIMIT = 'RATE_LIMIT',
  CIRCUIT_OPEN = 'CIRCUIT_OPEN',
}

/**
 * RPC Error class with code, message, and optional details
 */
export class RPCError extends Error {
  constructor(
    public code: RPCErrorCode,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'RPCError'
    Object.setPrototypeOf(this, RPCError.prototype)
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      stack: this.stack,
    }
  }
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof RPCError)) {
    return false
  }

  // These error types are retryable
  const retryableCodes = [
    RPCErrorCode.NETWORK_ERROR,
    RPCErrorCode.TIMEOUT,
    RPCErrorCode.RATE_LIMIT,
  ]

  return retryableCodes.includes(error.code)
}

/**
 * Options for retry with backoff
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number
  /** Initial delay in milliseconds (default: 1000) */
  initialDelay?: number
  /** Backoff multiplier (default: 2) */
  backoffFactor?: number
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelay?: number
  /** Add random jitter to delays (default: false) */
  jitter?: boolean
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    backoffFactor = 2,
    maxDelay = 30000,
    jitter = false,
  } = options

  let lastError: unknown
  let attempt = 0

  while (attempt <= maxRetries) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      attempt++

      // Don't retry if not retryable or if we've exhausted retries
      if (!isRetryableError(error) || attempt > maxRetries) {
        throw error
      }

      // Calculate delay with exponential backoff
      let delay = Math.min(initialDelay * Math.pow(backoffFactor, attempt - 1), maxDelay)

      // Add jitter if requested
      if (jitter) {
        delay = delay * (0.5 + Math.random() * 0.5)
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError
}

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
  private resetTimer: ReturnType<typeof setTimeout> | null = null

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
      throw new RPCError(
        RPCErrorCode.CIRCUIT_OPEN,
        'Circuit breaker is open',
        {
          state: this.state,
          failures: this.consecutiveFailures,
          lastFailureTime: this.lastFailureTime,
        }
      )
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
      this.scheduleReset()
    } else if (this.state === CircuitState.CLOSED) {
      if (this.consecutiveFailures >= this.failureThreshold) {
        this.state = CircuitState.OPEN
        this.scheduleReset()
      }
    }
  }

  /**
   * Schedule automatic transition to half-open state
   */
  private scheduleReset(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer)
    }
    // Note: Timer will be checked on next execute() call
    // We don't actively schedule here to avoid timer issues in tests
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
    if (this.resetTimer) {
      clearTimeout(this.resetTimer)
      this.resetTimer = null
    }
  }
}

/**
 * Wrap a promise with a timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout>

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(
        new RPCError(
          RPCErrorCode.TIMEOUT,
          `Request timed out after ${timeoutMs}ms`,
          { timeout: timeoutMs }
        )
      )
    }, timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    clearTimeout(timeoutHandle!)
  }
}

/**
 * Serialized error format for transmission across boundaries
 */
export interface SerializedError {
  name: string
  message: string
  code?: RPCErrorCode
  details?: Record<string, unknown>
  stack?: string
}

/**
 * Serialize an error for transmission across boundaries
 */
export function serializeError(error: Error | RPCError): SerializedError {
  const serialized: SerializedError = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  }

  if (error instanceof RPCError) {
    serialized.code = error.code
    serialized.details = error.details
  }

  return serialized
}

/**
 * Deserialize an error received from across boundaries
 */
export function deserializeError(serialized: SerializedError): Error | RPCError {
  if (serialized.name === 'RPCError' && serialized.code) {
    const error = new RPCError(serialized.code, serialized.message, serialized.details)
    if (serialized.stack) {
      error.stack = serialized.stack
    }
    return error
  }

  const error = new Error(serialized.message)
  error.name = serialized.name
  if (serialized.stack) {
    error.stack = serialized.stack
  }
  return error
}
