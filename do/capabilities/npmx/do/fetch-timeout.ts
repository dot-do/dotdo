/**
 * Fetch with Timeout
 *
 * Provides a timeout-enabled wrapper around the native fetch API.
 * Prevents indefinite hangs when registry calls are slow or unresponsive.
 *
 * @module npmx/do/fetch-timeout
 */

/**
 * Default timeout for fetch operations (30 seconds)
 */
export const DEFAULT_FETCH_TIMEOUT = 30000

/**
 * Options for fetch with timeout
 */
export interface FetchTimeoutOptions {
  /**
   * Timeout in milliseconds (default: 30000ms)
   */
  timeout?: number

  /**
   * Number of retries on timeout (default: 0)
   */
  retries?: number

  /**
   * Base backoff time in milliseconds for exponential backoff (default: 0 - no backoff)
   * Backoff doubles with each retry: backoff, backoff*2, backoff*4, etc.
   */
  retryBackoff?: number
}

/**
 * Error thrown when a fetch request times out
 */
export class FetchTimeoutError extends Error {
  public readonly name = 'FetchTimeoutError'
  public readonly code = 'ETIMEDOUT'
  public readonly url: string
  public readonly timeout: number

  constructor(url: string, timeout: number) {
    super(`Fetch to ${url} timed out after ${timeout}ms`)
    this.url = url
    this.timeout = timeout

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, FetchTimeoutError.prototype)
  }
}

/**
 * Perform a fetch request with configurable timeout and retry support
 *
 * @param url - The URL to fetch
 * @param init - Standard fetch options (method, headers, body, etc.)
 * @param options - Timeout and retry options
 * @returns Promise resolving to the Response
 * @throws {FetchTimeoutError} When the request times out after all retries
 *
 * @example
 * ```typescript
 * // Basic usage with default 30s timeout
 * const response = await fetchWithTimeout('https://registry.npmjs.org/lodash')
 *
 * // Custom timeout
 * const response = await fetchWithTimeout(url, {}, { timeout: 5000 })
 *
 * // With retries and exponential backoff
 * const response = await fetchWithTimeout(url, {}, {
 *   timeout: 5000,
 *   retries: 3,
 *   retryBackoff: 100  // 100ms, 200ms, 400ms between retries
 * })
 * ```
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  options: FetchTimeoutOptions = {}
): Promise<Response> {
  const { timeout = DEFAULT_FETCH_TIMEOUT, retries = 0, retryBackoff = 0 } = options

  return fetchWithRetry(url, init, timeout, retries, retryBackoff, 0)
}

/**
 * Internal recursive function for fetch with retry logic
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  timeout: number,
  retriesRemaining: number,
  retryBackoff: number,
  retryAttempt: number
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  // Merge the abort signal with any existing signal from init
  const mergedSignal = init.signal
    ? mergeAbortSignals(init.signal, controller.signal)
    : controller.signal

  try {
    const response = await fetch(url, {
      ...init,
      signal: mergedSignal,
    })
    clearTimeout(timeoutId)
    return response
  } catch (error) {
    clearTimeout(timeoutId)

    // Check if this was an abort due to our timeout
    if (controller.signal.aborted) {
      // Handle retry logic
      if (retriesRemaining > 0) {
        // Calculate backoff delay with exponential increase
        const backoffDelay = retryBackoff * Math.pow(2, retryAttempt)
        if (backoffDelay > 0) {
          await sleep(backoffDelay)
        }
        return fetchWithRetry(
          url,
          init,
          timeout,
          retriesRemaining - 1,
          retryBackoff,
          retryAttempt + 1
        )
      }
      throw new FetchTimeoutError(url, timeout)
    }

    // Re-throw non-timeout errors (network errors, etc.)
    throw error
  }
}

/**
 * Merge two AbortSignals into one
 * Returns a signal that aborts when either input signal aborts
 */
function mergeAbortSignals(signal1: AbortSignal, signal2: AbortSignal): AbortSignal {
  const controller = new AbortController()

  const abort = () => {
    controller.abort()
  }

  // Abort if either signal is already aborted
  if (signal1.aborted || signal2.aborted) {
    controller.abort()
    return controller.signal
  }

  signal1.addEventListener('abort', abort, { once: true })
  signal2.addEventListener('abort', abort, { once: true })

  return controller.signal
}

/**
 * Sleep for the specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
