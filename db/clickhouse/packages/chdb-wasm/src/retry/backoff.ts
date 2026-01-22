/**
 * Exponential Backoff Calculation for Retry Logic
 *
 * Provides functions for calculating retry delays with exponential backoff
 * and optional jitter to prevent thundering herd problems.
 */

/**
 * Options for calculating retry delays
 */
export interface BackoffOptions {
  /** Initial delay in milliseconds for exponential backoff (default: 100) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds (default: 5000) */
  maxDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Whether to add jitter to delays (default: true) */
  jitter?: boolean;
}

/**
 * Default backoff options
 */
export const DEFAULT_BACKOFF_OPTIONS: Required<BackoffOptions> = {
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Calculate the delay for a given retry attempt using exponential backoff.
 *
 * @param attempt - The retry attempt number (0-indexed, so attempt 0 is the first retry)
 * @param options - Backoff configuration options
 * @returns The delay in milliseconds before the next retry
 *
 * @example
 * ```ts
 * // With default options (initial=100, multiplier=2)
 * getRetryDelay(0, options) // 100ms (first retry)
 * getRetryDelay(1, options) // 200ms (second retry)
 * getRetryDelay(2, options) // 400ms (third retry)
 * ```
 */
export function getRetryDelay(attempt: number, options: BackoffOptions): number {
  const opts = { ...DEFAULT_BACKOFF_OPTIONS, ...options };
  const { initialDelayMs, maxDelayMs, backoffMultiplier, jitter } = opts;

  // Calculate base delay using exponential backoff: initialDelay * multiplier^attempt
  const baseDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt);

  // Cap at maximum delay
  const cappedDelay = Math.min(baseDelay, maxDelayMs);

  // Apply jitter if enabled (random value between 50% and 150% of base delay)
  if (jitter) {
    // Generate random factor between 0.5 and 1.5
    const jitterFactor = 0.5 + Math.random();
    return Math.round(cappedDelay * jitterFactor);
  }

  return cappedDelay;
}

/**
 * Create a promise that resolves after a specified delay.
 *
 * @param ms - Delay in milliseconds
 * @returns A promise that resolves after the delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
