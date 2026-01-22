/**
 * Retry Logic for Durable Object Operations
 *
 * Provides retry wrappers for Cloudflare Durable Object operations with
 * exponential backoff, configurable max retries, and automatic error classification.
 */

import { getRetryDelay, delay, type BackoffOptions } from './backoff';
import { isRetryableError } from './error-classifier';

/**
 * Retry configuration options for DO operations
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
 * Default retry options for DO operations
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
    (this as Error & { attempts: number }).attempts = attempts;
  }
}

/**
 * Determine if a DO error is retryable.
 *
 * DO-specific retryable errors include:
 * - Transient DO unavailability
 * - CPU time limit exceeded (transient)
 * - Storage operation failures
 * - Errors with `retryable: true` property
 *
 * Non-retryable DO errors include:
 * - Validation errors
 * - DO not found errors
 * - Errors with `retryable: false` property
 */
function isDORetryableError(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const err = error as Error & { retryable?: boolean };

  // Explicit retryable property takes precedence
  if (typeof err.retryable === 'boolean') {
    return err.retryable;
  }

  const message = err.message.toLowerCase();

  // Non-retryable DO errors
  if (message.includes('does not exist')) {
    return false;
  }
  if (message.includes('invalid input')) {
    return false;
  }

  // Retryable DO errors
  if (message.includes('not available')) {
    return true;
  }
  if (message.includes('cpu time limit') || message.includes('exceeded cpu')) {
    return true;
  }
  if (message.includes('storage operation failed')) {
    return true;
  }
  if (message.includes('transient')) {
    return true;
  }

  // Fall back to general error classifier
  return isRetryableError(error);
}

/**
 * Execute a Durable Object operation with automatic retry on transient failures.
 *
 * This function will:
 * - Retry on DO unavailability errors
 * - Retry on CPU time limit exceeded
 * - Retry on storage operation failures
 * - Retry on errors with `retryable: true` property
 * - NOT retry on validation errors or DO not found errors
 * - Use exponential backoff with optional jitter
 * - Respect overall timeout
 *
 * @typeParam T - The return type of the operation
 * @param operation - The async operation to execute
 * @param options - Retry configuration options
 * @returns The result of the operation
 *
 * @example
 * ```ts
 * // Basic usage
 * const result = await withDORetry(() => stub.fetch(request));
 *
 * // With custom options
 * const result = await withDORetry(
 *   () => storage.get('key'),
 *   { maxRetries: 5, initialDelayMs: 200 }
 * );
 * ```
 */
export async function withDORetry<T>(
  operation: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const { maxRetries, timeoutMs } = opts;

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
        if (!isDORetryableError(error)) {
          // Non-retryable error - throw immediately
          throw error;
        }

        // Check if we have retries remaining
        if (attempts > maxRetries) {
          // No more retries - throw the last error
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

  // Race between operation with retries and timeout
  try {
    const result = await Promise.race([executeWithRetry(), timeoutPromise]);
    // Clear the timeout since operation completed successfully
    clearTimeoutIfSet();
    return result;
  } catch (err) {
    // Clear the timeout on error as well
    clearTimeoutIfSet();
    throw err;
  }
}
