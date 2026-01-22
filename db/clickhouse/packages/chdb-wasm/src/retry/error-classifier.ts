/**
 * Error Classification for Retry Logic
 *
 * Provides utilities to determine whether an error is retryable based on
 * error type, status code, and other properties.
 */

/**
 * Network error codes that are considered retryable
 */
const RETRYABLE_NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ENETUNREACH',
  'EAI_AGAIN',
]);

/**
 * HTTP status codes that are considered retryable
 */
const RETRYABLE_STATUS_CODES = new Set([
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
  507, // Insufficient Storage
  520, // Web server returns an unknown error (Cloudflare)
  521, // Web server is down (Cloudflare)
  522, // Connection timed out (Cloudflare)
  523, // Origin is unreachable (Cloudflare)
  524, // A timeout occurred (Cloudflare)
  525, // SSL handshake failed (Cloudflare)
  526, // Invalid SSL certificate (Cloudflare)
  527, // Railgun Listener to Origin error (Cloudflare)
  530, // Origin DNS error (Cloudflare)
]);

/**
 * Error messages that indicate a network-level failure that is retryable
 */
const RETRYABLE_ERROR_MESSAGES = [
  'Failed to fetch',
  'NetworkError',
  'Network request failed',
  'fetch failed',
  'socket hang up',
  'ECONNRESET',
  'ETIMEDOUT',
  'network error',
];

/**
 * Error messages that indicate non-retryable errors (permanent failures)
 */
const NON_RETRYABLE_ERROR_MESSAGES = [
  'does not exist',
  'Invalid input',
  'Invalid request',
  'Validation error',
  'not found',
  'permission denied',
  'unauthorized',
  'forbidden',
];

/**
 * Interface for errors that may have a status code property
 */
interface ErrorWithStatusCode extends Error {
  statusCode?: number;
  status?: number;
  code?: string;
  retryable?: boolean;
}

/**
 * Determine if an error is retryable based on its properties.
 *
 * Retryable errors include:
 * - 5xx server errors (500, 502, 503, 504, etc.)
 * - 429 Too Many Requests
 * - Network errors (ECONNRESET, ETIMEDOUT, etc.)
 * - Errors with `retryable: true` property
 *
 * Non-retryable errors include:
 * - 4xx client errors (except 429)
 * - Errors with `retryable: false` property
 * - Validation errors, not found errors, permission errors
 *
 * @param error - The error to classify
 * @returns true if the error is retryable, false otherwise
 *
 * @example
 * ```ts
 * isRetryableError(new Error('ECONNRESET')) // true
 * isRetryableError(new R2Error('Service unavailable', 503)) // true
 * isRetryableError(new Error('Not found', 404)) // false
 * ```
 */
export function isRetryableError(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false;
  }

  // Handle non-Error objects
  if (!(error instanceof Error)) {
    return false;
  }

  const err = error as ErrorWithStatusCode;

  // Explicit retryable property takes precedence
  if (typeof err.retryable === 'boolean') {
    return err.retryable;
  }

  // Check status code (works for R2 errors and HTTP errors)
  const statusCode = err.statusCode ?? err.status;
  if (statusCode !== undefined) {
    // 4xx errors are NOT retryable, except for 429
    if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
      return false;
    }
    // Check if status is in retryable set
    if (RETRYABLE_STATUS_CODES.has(statusCode)) {
      return true;
    }
  }

  // Check error code (network errors)
  if (err.code && RETRYABLE_NETWORK_ERROR_CODES.has(err.code)) {
    return true;
  }

  // Check error message for network-related patterns
  const message = err.message.toLowerCase();

  // Check for non-retryable error messages first
  for (const pattern of NON_RETRYABLE_ERROR_MESSAGES) {
    if (message.includes(pattern.toLowerCase())) {
      return false;
    }
  }

  // Check for retryable error messages
  for (const pattern of RETRYABLE_ERROR_MESSAGES) {
    if (message.includes(pattern.toLowerCase())) {
      return true;
    }
  }

  // TypeError with 'Failed to fetch' is a network error
  if (error instanceof TypeError && message.includes('failed to fetch')) {
    return true;
  }

  // By default, unknown errors are not retryable to prevent infinite retries
  return false;
}

/**
 * Extract status code from an error if present.
 *
 * @param error - The error to extract status code from
 * @returns The status code if found, undefined otherwise
 */
export function getErrorStatusCode(error: unknown): number | undefined {
  if (error === null || error === undefined) {
    return undefined;
  }

  if (error instanceof Error) {
    const err = error as ErrorWithStatusCode;
    return err.statusCode ?? err.status;
  }

  return undefined;
}

/**
 * Extract error code from an error if present.
 *
 * @param error - The error to extract code from
 * @returns The error code if found, undefined otherwise
 */
export function getErrorCode(error: unknown): string | undefined {
  if (error === null || error === undefined) {
    return undefined;
  }

  if (error instanceof Error) {
    return (error as ErrorWithStatusCode).code;
  }

  return undefined;
}
