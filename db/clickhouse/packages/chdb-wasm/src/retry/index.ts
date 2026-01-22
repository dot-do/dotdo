/**
 * Retry Logic for R2 and Durable Object Operations
 *
 * This module provides retry utilities for Cloudflare R2 and Durable Object
 * operations, including:
 * - Automatic retry on transient failures
 * - Exponential backoff with jitter
 * - Configurable timeouts and max retries
 * - Error classification
 *
 * @example
 * ```ts
 * import { withR2Retry, withDORetry, createRetryableR2Bucket } from './retry';
 *
 * // Wrap individual operations
 * const result = await withR2Retry(() => bucket.get('key'));
 *
 * // Or create a retryable bucket wrapper
 * const retryableBucket = createRetryableR2Bucket(bucket);
 * const result = await retryableBucket.get('key'); // automatically retries
 * ```
 */

export { withR2Retry, RetryTimeoutError, type RetryOptions, type RetryResult } from './r2-retry';
export { withDORetry, RetryTimeoutError as DORetryTimeoutError } from './do-retry';
export { isRetryableError, getErrorStatusCode, getErrorCode } from './error-classifier';
export { getRetryDelay, delay, type BackoffOptions, DEFAULT_BACKOFF_OPTIONS } from './backoff';

import { withR2Retry, type RetryOptions } from './r2-retry';
import { withDORetry } from './do-retry';

/**
 * Create a proxy around an R2Bucket that automatically retries operations.
 *
 * This creates a transparent wrapper that intercepts all method calls on the
 * bucket and wraps them with retry logic.
 *
 * @param bucket - The original R2Bucket to wrap
 * @param options - Retry configuration options
 * @returns A proxy R2Bucket with automatic retry behavior
 *
 * @example
 * ```ts
 * const bucket = env.MY_R2_BUCKET;
 * const retryableBucket = createRetryableR2Bucket(bucket, { maxRetries: 5 });
 *
 * // All operations will automatically retry on transient failures
 * const obj = await retryableBucket.get('my-key');
 * await retryableBucket.put('another-key', data);
 * ```
 */
export function createRetryableR2Bucket<T extends object>(
  bucket: T,
  options?: RetryOptions
): T {
  return new Proxy(bucket, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      // If the property is not a function, return it as-is
      if (typeof value !== 'function') {
        return value;
      }

      // Wrap the function with retry logic
      return async (...args: unknown[]) => {
        return withR2Retry(() => value.apply(target, args), options);
      };
    },
  });
}

/**
 * Create a proxy around a DurableObjectNamespace that returns retryable stubs.
 *
 * This creates a transparent wrapper that intercepts stub creation and wraps
 * the stub's fetch method with retry logic.
 *
 * @param namespace - The original DurableObjectNamespace to wrap
 * @param options - Retry configuration options
 * @returns A proxy DurableObjectNamespace with automatic retry behavior
 *
 * @example
 * ```ts
 * const namespace = env.MY_DURABLE_OBJECT;
 * const retryableNamespace = createRetryableDONamespace(namespace, { maxRetries: 5 });
 *
 * const id = retryableNamespace.idFromName('my-do');
 * const stub = retryableNamespace.get(id);
 * // fetch calls will automatically retry on transient failures
 * const response = await stub.fetch(new Request('https://internal/api'));
 * ```
 */
export function createRetryableDONamespace<T extends object>(
  namespace: T,
  options?: RetryOptions
): T {
  return new Proxy(namespace, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      // If the property is not a function, return it as-is
      if (typeof value !== 'function') {
        return value;
      }

      // Intercept the 'get' method to wrap the returned stub
      if (prop === 'get') {
        return (...args: unknown[]) => {
          const stub = value.apply(target, args);
          return createRetryableDOStub(stub, options);
        };
      }

      // Return other functions as-is (like idFromName)
      return value.bind(target);
    },
  });
}

/**
 * Create a proxy around a DurableObjectStub that retries fetch operations.
 *
 * @param stub - The original DurableObjectStub to wrap
 * @param options - Retry configuration options
 * @returns A proxy DurableObjectStub with automatic retry behavior
 */
function createRetryableDOStub<T extends object>(
  stub: T,
  options?: RetryOptions
): T {
  return new Proxy(stub, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      // If the property is not a function, return it as-is
      if (typeof value !== 'function') {
        return value;
      }

      // Wrap fetch with retry logic
      if (prop === 'fetch') {
        return async (...args: unknown[]) => {
          return withDORetry(() => value.apply(target, args), options);
        };
      }

      // Return other functions as-is
      return value.bind(target);
    },
  });
}
