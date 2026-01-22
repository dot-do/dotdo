/**
 * Retry Logic for R2 Operations
 *
 * Provides retry wrappers for Cloudflare R2 operations with exponential backoff,
 * configurable max retries, and automatic error classification.
 */

import { getRetryDelay, delay, type BackoffOptions } from './backoff';
import { isRetryableError } from './error-classifier';

/**
 * Retry configuration options for R2 operations
 */
export interface RetryOptions extends BackoffOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Overall timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Whether to return retry statistics instead of the raw value */
  returnStats?: boolean;
}

/**
 * Result of a retried operation with statistics
 */
export interface RetryResult<T> {
  /** The result value if successful */
  value?: T;
  /** Whether the operation succeeded */
  success: boolean;
  /** Number of attempts made */
  attempts: number;
  /** Total time taken in milliseconds */
  totalTimeMs: number;
  /** The error if failed */
  error?: Error;
}

/**
 * Default retry options for R2 operations
 */
export const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  timeoutMs: 30000,
  jitter: true,
  returnStats: false,
};

/**
 * Error thrown when a retry operation times out
 */
export class RetryTimeoutError extends Error {
  public readonly attempts: number;
  public readonly timeoutMs: number;
  public readonly totalTimeMs: number;

  constructor(message: string, attempts: number, timeoutMs: number, totalTimeMs: number) {
    super(message);
    this.name = 'RetryTimeoutError';
    this.attempts = attempts;
    this.timeoutMs = timeoutMs;
    this.totalTimeMs = totalTimeMs;
  }
}

/**
 * Error thrown when max retries are exhausted
 */
export class MaxRetriesExceededError extends Error {
  public readonly attempts: number;
  public readonly lastError: Error;

  constructor(message: string, attempts: number, lastError: Error) {
    super(message);
    this.name = 'MaxRetriesExceededError';
    this.attempts = attempts;
    this.lastError = lastError;
    // Preserve attempts count for tests
    (this as Error & { attempts: number }).attempts = attempts;
  }
}

/**
 * Execute an R2 operation with automatic retry on transient failures.
 *
 * This function will:
 * - Retry on 5xx errors and 429 (rate limiting)
 * - Retry on network errors (ECONNRESET, ETIMEDOUT, Failed to fetch)
 * - NOT retry on 4xx client errors (except 429)
 * - Use exponential backoff with optional jitter
 * - Respect overall timeout
 *
 * @typeParam T - The return type of the operation
 * @param operation - The async operation to execute
 * @param options - Retry configuration options
 * @returns The result of the operation (with or without stats based on returnStats)
 *
 * @example
 * ```ts
 * // Basic usage
 * const result = await withR2Retry(() => bucket.get('key'));
 *
 * // With custom options
 * const result = await withR2Retry(
 *   () => bucket.put('key', data),
 *   { maxRetries: 5, initialDelayMs: 200 }
 * );
 *
 * // With stats
 * const result = await withR2Retry(
 *   () => bucket.get('key'),
 *   { returnStats: true }
 * ) as RetryResult<R2Object>;
 * console.log(`Succeeded after ${result.attempts} attempts`);
 * ```
 */
export async function withR2Retry<T>(
  operation: () => Promise<T>,
  options?: RetryOptions
): Promise<T | RetryResult<T>> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const { maxRetries, timeoutMs, returnStats } = opts;

  const startTime = Date.now();
  let attempts = 0;
  let lastError: Error | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  // Create a timeout promise with cleanup capability
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const elapsed = Date.now() - startTime;
      reject(
        new RetryTimeoutError(
          `Operation timed out after ${timeoutMs}ms`,
          attempts,
          timeoutMs,
          elapsed
        )
      );
    }, timeoutMs);
  });

  // Cleanup function to clear the timeout
  const clearTimeoutIfSet = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
  };

  const executeWithRetry = async (): Promise<T> => {
    while (attempts <= maxRetries) {
      attempts++;

      try {
        const result = await operation();
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        lastError = error;

        // Check if this is a retryable error
        if (!isRetryableError(error)) {
          // Non-retryable error - throw immediately
          if (returnStats) {
            const enrichedError = error as Error & { attempts: number };
            enrichedError.attempts = attempts;
            throw enrichedError;
          }
          throw error;
        }

        // Check if we have retries remaining
        if (attempts > maxRetries) {
          // No more retries - throw the last error
          if (returnStats) {
            const enrichedError = error as Error & { attempts: number };
            enrichedError.attempts = attempts;
            throw enrichedError;
          }
          throw new MaxRetriesExceededError(
            `Max retries (${maxRetries}) exceeded`,
            attempts,
            error
          );
        }

        // Calculate delay and wait before next retry
        const retryDelay = getRetryDelay(attempts - 1, opts);
        await delay(retryDelay);
      }
    }

    // This should not be reached, but handle edge case
    const error = lastError ?? new Error('Unknown error');
    throw new MaxRetriesExceededError(
      `Max retries (${maxRetries}) exceeded`,
      attempts,
      error
    );
  };

  try {
    // Race between operation with retries and timeout
    const result = await Promise.race([executeWithRetry(), timeoutPromise]);

    // Clear the timeout since operation completed successfully
    clearTimeoutIfSet();

    if (returnStats) {
      return {
        value: result,
        success: true,
        attempts,
        totalTimeMs: Date.now() - startTime,
      };
    }

    return result;
  } catch (err) {
    // Clear the timeout on error as well
    clearTimeoutIfSet();

    if (err instanceof RetryTimeoutError) {
      throw err;
    }

    // For other errors, preserve attempts count if returnStats is true
    throw err;
  }
}
