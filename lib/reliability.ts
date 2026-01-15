/**
 * @module lib/reliability
 *
 * Standardized Reliability Patterns for dotdo
 *
 * This module provides a unified interface for reliability patterns across the codebase:
 * - Timeout protection
 * - Retry with configurable backoff (linear, exponential, jitter)
 * - Circuit breaker protection
 * - Combined reliability wrappers
 *
 * Critical paths that should use these patterns:
 * - Cross-DO RPC calls
 * - External API calls (AI, R2, Pipeline)
 * - Storage operations
 * - Long-running workflows
 * - MCP tool execution
 *
 * @example
 * ```typescript
 * import { withReliability, withTimeout, withRetry, CircuitBreaker } from './reliability'
 *
 * // Combined reliability wrapper
 * const result = await withReliability(
 *   () => externalApiCall(),
 *   { timeout: 5000, retries: 3, backoff: 'exponential' }
 * )
 *
 * // Individual utilities
 * const timedResult = await withTimeout(fetch(url), 3000)
 * const retriedResult = await withRetry(() => flakeyOperation(), { maxAttempts: 3 })
 * ```
 */

// Re-export CircuitBreaker types and class from existing implementation
import {
  CircuitBreaker as CircuitBreakerClass,
  type CircuitBreakerConfig,
  type CircuitBreakerStats,
  type CircuitBreakerState,
} from './circuit-breaker'

// Export for external use
export {
  CircuitBreakerClass as CircuitBreaker,
  type CircuitBreakerConfig,
  type CircuitBreakerStats,
  type CircuitBreakerState,
}

// ============================================================================
// CONSTANTS - Shared across the codebase
// ============================================================================

/** Default timeout for operations (30 seconds) */
export const DEFAULT_TIMEOUT_MS = 30000

/** Default timeout for RPC calls */
export const DEFAULT_RPC_TIMEOUT_MS = 30000

/** Default maximum retry attempts */
export const DEFAULT_MAX_RETRIES = 3

/** Default base backoff in milliseconds */
export const DEFAULT_BACKOFF_BASE_MS = 1000

/** Maximum backoff cap to prevent excessive delays */
export const MAX_BACKOFF_MS = 10000

/** Exponential backoff multiplier */
export const EXPONENTIAL_BACKOFF_BASE = 2

/** Default circuit breaker failure threshold */
export const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 5

/** Default circuit breaker reset timeout */
export const DEFAULT_CIRCUIT_RESET_TIMEOUT_MS = 60000

// ============================================================================
// TYPES
// ============================================================================

/**
 * Backoff strategy for retries
 */
export type BackoffStrategy = 'none' | 'linear' | 'exponential' | 'exponential-jitter'

/**
 * Options for timeout wrapper
 */
export interface TimeoutOptions {
  /** Timeout in milliseconds */
  timeout: number
  /** Custom error message on timeout */
  message?: string
  /** AbortController for cancellation */
  abortController?: AbortController
}

/**
 * Options for retry wrapper
 */
export interface RetryOptions {
  /** Maximum number of attempts (including first try) */
  maxAttempts?: number
  /** Backoff strategy */
  backoff?: BackoffStrategy
  /** Base delay in ms for backoff calculation */
  baseDelay?: number
  /** Maximum delay cap */
  maxDelay?: number
  /** Custom retry condition - return true to retry */
  shouldRetry?: (error: Error, attempt: number) => boolean
  /** Callback on each retry */
  onRetry?: (error: Error, attempt: number, delayMs: number) => void
}

/**
 * Combined reliability options
 */
export interface ReliabilityOptions {
  /** Timeout in milliseconds */
  timeout?: number
  /** Number of retry attempts (0 = no retry) */
  retries?: number
  /** Backoff strategy for retries */
  backoff?: BackoffStrategy
  /** Base delay for backoff */
  baseDelay?: number
  /** Maximum delay cap */
  maxDelay?: number
  /** Circuit breaker configuration */
  circuitBreaker?: CircuitBreakerConfig
  /** Custom retry condition */
  shouldRetry?: (error: Error, attempt: number) => boolean
  /** Callback on retry */
  onRetry?: (error: Error, attempt: number) => void
  /** Callback on timeout */
  onTimeout?: (timeoutMs: number) => void
  /** Callback on final failure */
  onFailure?: (error: Error, attempts: number) => void
}

/**
 * Result with timing metadata
 */
export interface TimedResult<T> {
  result: T
  duration: number
  timedOut: boolean
}

/**
 * Retry result with attempt information
 */
export interface RetryResult<T> {
  result: T
  attempts: number
  totalDuration: number
  errors: Error[]
}

// ============================================================================
// TIMEOUT UTILITIES
// ============================================================================

/**
 * Execute a promise with timeout protection
 *
 * @param promise - The promise to execute
 * @param timeoutMs - Timeout in milliseconds
 * @param message - Optional custom error message
 * @returns The promise result
 * @throws Error if timeout is exceeded
 *
 * @example
 * ```typescript
 * // Simple usage
 * const result = await withTimeout(fetch(url), 5000)
 *
 * // With custom message
 * const data = await withTimeout(
 *   fetchData(),
 *   3000,
 *   'Data fetch timed out'
 * )
 * ```
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = 'Timeout'
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    clearTimeout(timeoutId!)
  }
}

/**
 * Execute a promise with timeout and return metadata
 *
 * Unlike withTimeout, this does not throw on timeout - it returns
 * a result object with timedOut flag.
 *
 * @param promise - The promise to execute
 * @param timeoutMs - Timeout in milliseconds
 * @param fallback - Optional fallback value on timeout
 * @returns TimedResult with duration and timeout status
 *
 * @example
 * ```typescript
 * const { result, timedOut, duration } = await withTimeoutMetadata(
 *   slowOperation(),
 *   5000,
 *   'default-value'
 * )
 *
 * if (timedOut) {
 *   console.log(`Operation timed out after ${duration}ms, using fallback`)
 * }
 * ```
 */
export async function withTimeoutMetadata<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback?: T
): Promise<TimedResult<T | undefined>> {
  const start = Date.now()

  const timeoutPromise = new Promise<{ timedOut: true }>((resolve) =>
    setTimeout(() => resolve({ timedOut: true }), timeoutMs)
  )

  try {
    const result = await Promise.race([
      promise.then((value) => ({ value, timedOut: false as const })),
      timeoutPromise,
    ])

    const duration = Date.now() - start

    if ('timedOut' in result && result.timedOut === true) {
      return { result: fallback, timedOut: true, duration }
    }

    return { result: (result as { value: T; timedOut: false }).value, timedOut: false, duration }
  } catch (error) {
    // Re-throw non-timeout errors with duration info
    const duration = Date.now() - start
    throw Object.assign(error as Error, { duration })
  }
}

/**
 * Execute a function with timeout protection and abort signal
 *
 * Provides an AbortSignal to the function for cooperative cancellation.
 *
 * @param fn - Function that receives an AbortSignal
 * @param timeoutMs - Timeout in milliseconds
 * @param message - Optional custom error message
 * @returns The function result
 *
 * @example
 * ```typescript
 * const result = await withTimeoutAbortable(
 *   async (signal) => {
 *     const response = await fetch(url, { signal })
 *     return response.json()
 *   },
 *   5000,
 *   'Request cancelled due to timeout'
 * )
 * ```
 */
export async function withTimeoutAbortable<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  message = 'Timeout'
): Promise<T> {
  const controller = new AbortController()

  const timeoutId = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  try {
    return await Promise.race([
      fn(controller.signal),
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timeoutId)
  }
}

// ============================================================================
// BACKOFF UTILITIES
// ============================================================================

/**
 * Calculate backoff delay based on strategy
 *
 * @param attempt - Current attempt number (1-based)
 * @param strategy - Backoff strategy
 * @param baseDelay - Base delay in milliseconds
 * @param maxDelay - Maximum delay cap
 * @returns Delay in milliseconds
 */
export function calculateBackoff(
  attempt: number,
  strategy: BackoffStrategy,
  baseDelay = DEFAULT_BACKOFF_BASE_MS,
  maxDelay = MAX_BACKOFF_MS
): number {
  switch (strategy) {
    case 'none':
      return 0

    case 'linear':
      return Math.min(baseDelay * attempt, maxDelay)

    case 'exponential':
      return Math.min(baseDelay * Math.pow(EXPONENTIAL_BACKOFF_BASE, attempt - 1), maxDelay)

    case 'exponential-jitter': {
      const exponential = baseDelay * Math.pow(EXPONENTIAL_BACKOFF_BASE, attempt - 1)
      const capped = Math.min(exponential, maxDelay)
      // Add random jitter (0-100% of calculated delay)
      const jitter = Math.random() * capped
      return capped + jitter
    }

    default:
      return baseDelay
  }
}

/**
 * Sleep for a specified duration
 *
 * @param ms - Duration in milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// RETRY UTILITIES
// ============================================================================

/**
 * Default retry condition - retry on any error
 */
const defaultShouldRetry = (): boolean => true

/**
 * Execute a function with retry logic
 *
 * @param fn - The function to execute
 * @param options - Retry options
 * @returns The function result
 * @throws Last error if all retries exhausted
 *
 * @example
 * ```typescript
 * // Simple retry
 * const result = await withRetry(
 *   () => flakeyOperation(),
 *   { maxAttempts: 3 }
 * )
 *
 * // With exponential backoff
 * const data = await withRetry(
 *   () => fetchExternalAPI(),
 *   {
 *     maxAttempts: 5,
 *     backoff: 'exponential',
 *     baseDelay: 1000,
 *     shouldRetry: (error) => !error.message.includes('not found')
 *   }
 * )
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = DEFAULT_MAX_RETRIES,
    backoff = 'exponential',
    baseDelay = DEFAULT_BACKOFF_BASE_MS,
    maxDelay = MAX_BACKOFF_MS,
    shouldRetry = defaultShouldRetry,
    onRetry,
  } = options

  let lastError: Error | undefined
  let attempt = 0

  while (attempt < maxAttempts) {
    attempt++

    try {
      return await fn()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))

      // Check if we should retry
      if (attempt >= maxAttempts || !shouldRetry(lastError, attempt)) {
        throw lastError
      }

      // Calculate and apply backoff
      const delayMs = calculateBackoff(attempt, backoff, baseDelay, maxDelay)

      // Notify retry callback
      onRetry?.(lastError, attempt, delayMs)

      // Wait before next attempt
      if (delayMs > 0) {
        await sleep(delayMs)
      }
    }
  }

  throw lastError || new Error('Retry exhausted without error')
}

/**
 * Execute a function with retry logic and return detailed metadata
 *
 * @param fn - The function to execute
 * @param options - Retry options
 * @returns RetryResult with attempt information
 *
 * @example
 * ```typescript
 * const { result, attempts, errors } = await withRetryMetadata(
 *   () => unreliableOperation(),
 *   { maxAttempts: 3 }
 * )
 *
 * console.log(`Succeeded after ${attempts} attempts`)
 * if (errors.length > 0) {
 *   console.log('Previous errors:', errors.map(e => e.message))
 * }
 * ```
 */
export async function withRetryMetadata<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const {
    maxAttempts = DEFAULT_MAX_RETRIES,
    backoff = 'exponential',
    baseDelay = DEFAULT_BACKOFF_BASE_MS,
    maxDelay = MAX_BACKOFF_MS,
    shouldRetry = defaultShouldRetry,
    onRetry,
  } = options

  const errors: Error[] = []
  const start = Date.now()
  let attempt = 0

  while (attempt < maxAttempts) {
    attempt++

    try {
      const result = await fn()
      return {
        result,
        attempts: attempt,
        totalDuration: Date.now() - start,
        errors,
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      errors.push(error)

      // Check if we should retry
      if (attempt >= maxAttempts || !shouldRetry(error, attempt)) {
        throw Object.assign(error, {
          attempts: attempt,
          totalDuration: Date.now() - start,
          previousErrors: errors.slice(0, -1),
        })
      }

      // Calculate and apply backoff
      const delayMs = calculateBackoff(attempt, backoff, baseDelay, maxDelay)

      // Notify retry callback
      onRetry?.(error, attempt, delayMs)

      // Wait before next attempt
      if (delayMs > 0) {
        await sleep(delayMs)
      }
    }
  }

  throw Object.assign(new Error('Retry exhausted without error'), {
    attempts: attempt,
    totalDuration: Date.now() - start,
    previousErrors: errors,
  })
}

// ============================================================================
// COMBINED RELIABILITY WRAPPER
// ============================================================================

/**
 * Execute a function with combined reliability patterns
 *
 * Combines timeout, retry, and optionally circuit breaker in a single wrapper.
 * This is the recommended approach for critical paths.
 *
 * @param fn - The function to execute
 * @param options - Combined reliability options
 * @returns The function result
 *
 * @example
 * ```typescript
 * import { withReliability, CircuitBreaker } from './reliability'
 *
 * // Basic usage
 * const result = await withReliability(
 *   () => callExternalAPI(),
 *   {
 *     timeout: 5000,
 *     retries: 3,
 *     backoff: 'exponential'
 *   }
 * )
 *
 * // With circuit breaker
 * const breaker = new CircuitBreaker({
 *   failureThreshold: 5,
 *   resetTimeout: 30000
 * })
 *
 * const data = await withReliability(
 *   () => unreliableService(),
 *   {
 *     timeout: 3000,
 *     retries: 2,
 *     backoff: 'exponential-jitter',
 *     circuitBreaker: breaker
 *   }
 * )
 * ```
 */
export async function withReliability<T>(
  fn: () => Promise<T>,
  options: ReliabilityOptions & { circuitBreaker?: CircuitBreakerClass } = {}
): Promise<T> {
  const {
    timeout = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_MAX_RETRIES,
    backoff = 'exponential',
    baseDelay = DEFAULT_BACKOFF_BASE_MS,
    maxDelay = MAX_BACKOFF_MS,
    circuitBreaker,
    shouldRetry,
    onRetry,
    onTimeout,
    onFailure,
  } = options

  // If circuit breaker is provided and open, fail fast
  if (circuitBreaker?.state === 'open') {
    const error = new Error('Circuit is open')
    onFailure?.(error, 0)
    throw error
  }

  const executeWithTimeout = async (): Promise<T> => {
    if (timeout > 0) {
      try {
        return await withTimeout(fn(), timeout)
      } catch (error) {
        if ((error as Error).message === 'Timeout') {
          onTimeout?.(timeout)
        }
        throw error
      }
    }
    return fn()
  }

  const executeWithRetry = async (): Promise<T> => {
    if (retries <= 1) {
      return executeWithTimeout()
    }

    return withRetry(executeWithTimeout, {
      maxAttempts: retries,
      backoff,
      baseDelay,
      maxDelay,
      shouldRetry,
      onRetry: (error, attempt) => {
        onRetry?.(error, attempt)
      },
    })
  }

  // Execute with or without circuit breaker
  if (circuitBreaker) {
    try {
      const result = await circuitBreaker.execute(() => executeWithRetry())
      return result
    } catch (error) {
      onFailure?.(error as Error, retries)
      throw error
    }
  }

  try {
    return await executeWithRetry()
  } catch (error) {
    onFailure?.(error as Error, retries)
    throw error
  }
}

// ============================================================================
// HELPER PREDICATES FOR RETRY CONDITIONS
// ============================================================================

/**
 * Create a retry condition that only retries on specific error types
 */
export function retryOnErrors(...errorClasses: Array<new (...args: unknown[]) => Error>) {
  return (error: Error): boolean => {
    return errorClasses.some((ErrorClass) => error instanceof ErrorClass)
  }
}

/**
 * Create a retry condition that does not retry on specific error types
 */
export function skipRetryOnErrors(...errorClasses: Array<new (...args: unknown[]) => Error>) {
  return (error: Error): boolean => {
    return !errorClasses.some((ErrorClass) => error instanceof ErrorClass)
  }
}

/**
 * Create a retry condition based on error message patterns
 */
export function retryOnMessagePatterns(...patterns: Array<string | RegExp>) {
  return (error: Error): boolean => {
    return patterns.some((pattern) => {
      if (typeof pattern === 'string') {
        return error.message.includes(pattern)
      }
      return pattern.test(error.message)
    })
  }
}

/**
 * Create a retry condition that excludes certain message patterns
 */
export function skipRetryOnMessagePatterns(...patterns: Array<string | RegExp>) {
  return (error: Error): boolean => {
    return !patterns.some((pattern) => {
      if (typeof pattern === 'string') {
        return error.message.includes(pattern)
      }
      return pattern.test(error.message)
    })
  }
}

/**
 * Combine multiple retry conditions with AND logic
 */
export function retryWhenAll(
  ...conditions: Array<(error: Error, attempt: number) => boolean>
) {
  return (error: Error, attempt: number): boolean => {
    return conditions.every((condition) => condition(error, attempt))
  }
}

/**
 * Combine multiple retry conditions with OR logic
 */
export function retryWhenAny(
  ...conditions: Array<(error: Error, attempt: number) => boolean>
) {
  return (error: Error, attempt: number): boolean => {
    return conditions.some((condition) => condition(error, attempt))
  }
}

// ============================================================================
// COMMON RETRY POLICIES
// ============================================================================

/**
 * Retry policy for transient network errors
 */
export const TRANSIENT_NETWORK_POLICY: RetryOptions = {
  maxAttempts: 3,
  backoff: 'exponential-jitter',
  baseDelay: 1000,
  maxDelay: 10000,
  shouldRetry: skipRetryOnMessagePatterns(
    'not found',
    '404',
    'unauthorized',
    '401',
    'forbidden',
    '403',
    'bad request',
    '400'
  ),
}

/**
 * Retry policy for external API calls
 */
export const EXTERNAL_API_POLICY: RetryOptions = {
  maxAttempts: 3,
  backoff: 'exponential',
  baseDelay: 500,
  maxDelay: 5000,
}

/**
 * Retry policy for cross-DO RPC calls
 */
export const CROSS_DO_RPC_POLICY: RetryOptions = {
  maxAttempts: 2,
  backoff: 'linear',
  baseDelay: 100,
  maxDelay: 1000,
}

/**
 * Retry policy for storage operations
 */
export const STORAGE_OPERATION_POLICY: RetryOptions = {
  maxAttempts: 3,
  backoff: 'exponential',
  baseDelay: 200,
  maxDelay: 2000,
  shouldRetry: skipRetryOnMessagePatterns('constraint', 'unique', 'duplicate'),
}

// ============================================================================
// RELIABILITY PRESETS
// ============================================================================

/**
 * Reliability preset for cross-DO RPC calls
 */
export const RPC_RELIABILITY: ReliabilityOptions = {
  timeout: 30000,
  retries: 2,
  backoff: 'linear',
  baseDelay: 100,
  maxDelay: 1000,
}

/**
 * Reliability preset for external API calls
 */
export const EXTERNAL_API_RELIABILITY: ReliabilityOptions = {
  timeout: 30000,
  retries: 3,
  backoff: 'exponential',
  baseDelay: 500,
  maxDelay: 5000,
}

/**
 * Reliability preset for AI/LLM calls
 */
export const AI_LLM_RELIABILITY: ReliabilityOptions = {
  timeout: 60000, // AI calls can be slow
  retries: 2,
  backoff: 'exponential-jitter',
  baseDelay: 1000,
  maxDelay: 10000,
}

/**
 * Reliability preset for storage operations
 */
export const STORAGE_RELIABILITY: ReliabilityOptions = {
  timeout: 10000,
  retries: 3,
  backoff: 'exponential',
  baseDelay: 100,
  maxDelay: 2000,
}

/**
 * Reliability preset for pipeline/streaming operations
 */
export const PIPELINE_RELIABILITY: ReliabilityOptions = {
  timeout: 30000,
  retries: 3,
  backoff: 'exponential-jitter',
  baseDelay: 500,
  maxDelay: 5000,
}
