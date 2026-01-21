// Retry Logic for @dotdo/rpc
// Provides retry with exponential backoff and timeout utilities

import { TimeoutError } from './base'
import { isRetryableError } from './base'

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
export async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
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

      // Add jitter if requested (0-25% added to prevent thundering herd)
      if (jitter) {
        const jitterFactor = 0.25
        delay = delay * (1 + Math.random() * jitterFactor)
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError
}

/**
 * Wrap a promise with a timeout
 */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout>

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(TimeoutError.afterMs(timeoutMs))
    }, timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    clearTimeout(timeoutHandle!)
  }
}
