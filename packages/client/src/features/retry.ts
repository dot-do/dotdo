/**
 * Retry feature for @dotdo/client
 *
 * Provides retry logic with configurable strategies.
 */

export interface RetryConfig {
  maxAttempts?: number
  baseDelay?: number
  maxDelay?: number
  shouldRetry?: (error: unknown, attempt: number) => boolean
}

const defaultConfig: Required<RetryConfig> = {
  maxAttempts: 3,
  baseDelay: 100,
  maxDelay: 5000,
  shouldRetry: () => true,
}

/**
 * Execute an async function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const opts = { ...defaultConfig, ...config }
  let lastError: unknown

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (attempt + 1 >= opts.maxAttempts) break
      if (!opts.shouldRetry(error, attempt)) break

      // Calculate delay with exponential backoff
      const delay = Math.min(opts.baseDelay * Math.pow(2, attempt), opts.maxDelay)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError
}

/**
 * HTTP-specific retry: retry on 5xx errors
 */
export function isRetryableHttpError(error: unknown): boolean {
  if (error instanceof Response) {
    return error.status >= 500
  }
  return false
}
