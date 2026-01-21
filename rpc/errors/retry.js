// Retry Logic for @dotdo/rpc
// Provides retry with exponential backoff and timeout utilities
import { TimeoutError } from './base';
import { isRetryableError } from './base';
/**
 * Calculate jitter-adjusted delay based on strategy
 *
 * @param baseDelay - The calculated exponential backoff delay
 * @param jitter - Jitter strategy to apply
 * @param initialDelay - Initial delay for decorrelated jitter
 * @param previousDelay - Previous delay for decorrelated jitter
 * @returns The jitter-adjusted delay
 */
export function calculateJitteredDelay(baseDelay, jitter, initialDelay, previousDelay) {
    // Normalize jitter option: true -> 'full', false -> 'none'
    const strategy = jitter === true ? 'full' : jitter === false ? 'none' : jitter;
    switch (strategy) {
        case 'none':
            return baseDelay;
        case 'full':
            // Full jitter: random value in [0, baseDelay]
            // Best for preventing thundering herd - provides maximum distribution
            return Math.random() * baseDelay;
        case 'equal':
            // Equal jitter: baseDelay/2 + random value in [0, baseDelay/2]
            // Guarantees at least half the delay while adding randomness
            return baseDelay / 2 + Math.random() * (baseDelay / 2);
        case 'decorrelated':
            // Decorrelated jitter: random value in [initialDelay, previousDelay * 3]
            // Good for long retry sequences as it breaks correlation between retries
            const minDelay = initialDelay;
            const maxJitteredDelay = Math.min(previousDelay * 3, baseDelay);
            return minDelay + Math.random() * (maxJitteredDelay - minDelay);
        default:
            return baseDelay;
    }
}
/**
 * Retry a function with exponential backoff
 *
 * Implements retry with configurable exponential backoff and jitter strategies.
 * The jitter parameter accepts:
 * - boolean: true for 'full' jitter, false for no jitter
 * - JitterStrategy: 'none', 'full', 'equal', or 'decorrelated'
 *
 * Full jitter is recommended for distributed systems to prevent thundering herd.
 *
 * @example
 * ```typescript
 * // Basic usage with full jitter
 * const result = await retryWithBackoff(fetchData, {
 *   maxRetries: 3,
 *   initialDelay: 100,
 *   jitter: 'full',
 * })
 *
 * // With equal jitter for guaranteed minimum delay
 * const result = await retryWithBackoff(fetchData, {
 *   maxRetries: 5,
 *   initialDelay: 200,
 *   jitter: 'equal',
 * })
 * ```
 */
export async function retryWithBackoff(fn, options = {}) {
    const { maxRetries = 3, initialDelay = 1000, backoffFactor = 2, maxDelay = 30000, jitter = false, } = options;
    let lastError;
    let attempt = 0;
    let previousDelay = initialDelay;
    while (attempt <= maxRetries) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            attempt++;
            // Don't retry if not retryable or if we've exhausted retries
            if (!isRetryableError(error) || attempt > maxRetries) {
                throw error;
            }
            // Calculate base delay with exponential backoff
            const baseDelay = Math.min(initialDelay * Math.pow(backoffFactor, attempt - 1), maxDelay);
            // Apply jitter strategy to prevent thundering herd
            const delay = calculateJitteredDelay(baseDelay, jitter, initialDelay, previousDelay);
            previousDelay = delay > 0 ? delay : initialDelay;
            // Wait before retrying
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}
/**
 * Wrap a promise with a timeout
 */
export async function withTimeout(promise, timeoutMs) {
    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
            reject(TimeoutError.afterMs(timeoutMs));
        }, timeoutMs);
    });
    // Prevent unhandled rejection if the main promise resolves before timeout
    // (the rejection is still thrown if timeout wins the race)
    timeoutPromise.catch(() => { });
    try {
        return await Promise.race([promise, timeoutPromise]);
    }
    finally {
        clearTimeout(timeoutHandle);
    }
}
//# sourceMappingURL=retry.js.map