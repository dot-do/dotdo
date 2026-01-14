/**
 * @dotdo/gcs/errors - GCS Error Classes
 *
 * Google Cloud Storage compatible error classes for storage operations.
 *
 * @example
 * ```typescript
 * import { ApiError, NotFoundError, PreconditionFailedError } from '@dotdo/gcs'
 *
 * try {
 *   const [content] = await file.download()
 * } catch (error) {
 *   if (error instanceof NotFoundError) {
 *     console.log('File does not exist')
 *   } else if (error instanceof ApiError) {
 *     console.log('API error:', error.code, error.message)
 *   }
 * }
 * ```
 *
 * @see https://cloud.google.com/storage/docs/json_api/v1/status-codes
 */

// =============================================================================
// Error Options
// =============================================================================

export interface ApiErrorConfig {
  /** HTTP status code */
  code: number
  /** Error message */
  message: string
  /** Detailed errors */
  errors?: ApiErrorDetail[]
  /** Response body */
  response?: {
    body?: unknown
    headers?: Record<string, string>
    statusCode?: number
    statusMessage?: string
    request?: {
      uri?: string
      method?: string
    }
  }
}

export interface ApiErrorDetail {
  /** Error reason */
  reason: string
  /** Error message */
  message: string
  /** Domain */
  domain?: string
  /** Location */
  location?: string
  /** Location type */
  locationType?: string
  /** Extended help */
  extendedHelp?: string
}

// =============================================================================
// Base Exception
// =============================================================================

/**
 * Base exception class for all GCS API errors
 *
 * Compatible with @google-cloud/common ApiError
 */
export class ApiError extends Error {
  readonly code: number
  readonly errors?: ApiErrorDetail[]
  readonly response?: ApiErrorConfig['response']

  constructor(config: ApiErrorConfig | string) {
    if (typeof config === 'string') {
      super(config)
      this.code = 500
    } else {
      super(config.message)
      this.code = config.code
      this.errors = config.errors
      this.response = config.response
    }
    this.name = 'ApiError'
  }

  /**
   * Create an ApiError from a response object
   */
  static fromResponse(response: {
    statusCode: number
    body?: { error?: { message?: string; errors?: ApiErrorDetail[] } }
  }): ApiError {
    const body = response.body?.error
    return new ApiError({
      code: response.statusCode,
      message: body?.message || `Request failed with status ${response.statusCode}`,
      errors: body?.errors,
      response: {
        statusCode: response.statusCode,
        body: response.body,
      },
    })
  }
}

// =============================================================================
// Specific Error Classes
// =============================================================================

/**
 * Resource not found (404)
 */
export class NotFoundError extends ApiError {
  constructor(message = 'The requested resource was not found') {
    super({
      code: 404,
      message,
      errors: [{ reason: 'notFound', message }],
    })
    this.name = 'NotFoundError'
  }
}

/**
 * Bucket not found (404)
 */
export class BucketNotFoundError extends NotFoundError {
  readonly bucketName: string

  constructor(bucketName: string) {
    super(`Bucket ${bucketName} does not exist`)
    this.name = 'BucketNotFoundError'
    this.bucketName = bucketName
  }
}

/**
 * File/Object not found (404)
 */
export class FileNotFoundError extends NotFoundError {
  readonly bucketName: string
  readonly fileName: string

  constructor(bucketName: string, fileName: string) {
    super(`No such object: ${bucketName}/${fileName}`)
    this.name = 'FileNotFoundError'
    this.bucketName = bucketName
    this.fileName = fileName
  }
}

/**
 * Resource already exists (409)
 */
export class ConflictError extends ApiError {
  constructor(message = 'The requested resource already exists') {
    super({
      code: 409,
      message,
      errors: [{ reason: 'conflict', message }],
    })
    this.name = 'ConflictError'
  }
}

/**
 * Bucket already exists (409)
 */
export class BucketAlreadyExistsError extends ConflictError {
  readonly bucketName: string

  constructor(bucketName: string) {
    super(`Bucket ${bucketName} already exists`)
    this.name = 'BucketAlreadyExistsError'
    this.bucketName = bucketName
  }
}

/**
 * Bucket not empty (409)
 */
export class BucketNotEmptyError extends ConflictError {
  readonly bucketName: string

  constructor(bucketName: string) {
    super(`Cannot delete bucket ${bucketName}: bucket is not empty`)
    this.name = 'BucketNotEmptyError'
    this.bucketName = bucketName
  }
}

/**
 * Precondition failed (412)
 */
export class PreconditionFailedError extends ApiError {
  constructor(message = 'At least one of the preconditions you specified did not hold') {
    super({
      code: 412,
      message,
      errors: [{ reason: 'conditionNotMet', message }],
    })
    this.name = 'PreconditionFailedError'
  }
}

/**
 * Generation mismatch (412)
 */
export class GenerationMismatchError extends PreconditionFailedError {
  readonly expectedGeneration?: number
  readonly actualGeneration?: number

  constructor(expectedGeneration?: number, actualGeneration?: number) {
    super(`Generation mismatch: expected ${expectedGeneration}, got ${actualGeneration}`)
    this.name = 'GenerationMismatchError'
    this.expectedGeneration = expectedGeneration
    this.actualGeneration = actualGeneration
  }
}

/**
 * Bad request (400)
 */
export class BadRequestError extends ApiError {
  constructor(message = 'Bad request') {
    super({
      code: 400,
      message,
      errors: [{ reason: 'invalid', message }],
    })
    this.name = 'BadRequestError'
  }
}

/**
 * Invalid bucket name (400)
 */
export class InvalidBucketNameError extends BadRequestError {
  readonly bucketName: string

  constructor(bucketName: string, reason?: string) {
    super(reason || `Invalid bucket name: ${bucketName}`)
    this.name = 'InvalidBucketNameError'
    this.bucketName = bucketName
  }
}

/**
 * Invalid argument (400)
 */
export class InvalidArgumentError extends BadRequestError {
  readonly argument: string

  constructor(argument: string, message?: string) {
    super(message || `Invalid argument: ${argument}`)
    this.name = 'InvalidArgumentError'
    this.argument = argument
  }
}

/**
 * Unauthorized (401)
 */
export class UnauthorizedError extends ApiError {
  constructor(message = 'Authentication required') {
    super({
      code: 401,
      message,
      errors: [{ reason: 'authError', message }],
    })
    this.name = 'UnauthorizedError'
  }
}

/**
 * Forbidden (403)
 */
export class ForbiddenError extends ApiError {
  constructor(message = 'Access denied. You do not have permission to access this resource.') {
    super({
      code: 403,
      message,
      errors: [{ reason: 'forbidden', message }],
    })
    this.name = 'ForbiddenError'
  }
}

/**
 * Access denied to bucket (403)
 */
export class BucketAccessDeniedError extends ForbiddenError {
  readonly bucketName: string

  constructor(bucketName: string) {
    super(`Access denied to bucket ${bucketName}`)
    this.name = 'BucketAccessDeniedError'
    this.bucketName = bucketName
  }
}

/**
 * Access denied to object (403)
 */
export class ObjectAccessDeniedError extends ForbiddenError {
  readonly bucketName: string
  readonly objectName: string

  constructor(bucketName: string, objectName: string) {
    super(`Access denied to object ${bucketName}/${objectName}`)
    this.name = 'ObjectAccessDeniedError'
    this.bucketName = bucketName
    this.objectName = objectName
  }
}

/**
 * Request timeout (408)
 */
export class RequestTimeoutError extends ApiError {
  constructor(message = 'The request timed out') {
    super({
      code: 408,
      message,
      errors: [{ reason: 'requestTimeout', message }],
    })
    this.name = 'RequestTimeoutError'
  }
}

/**
 * Gone - resource no longer available (410)
 */
export class GoneError extends ApiError {
  constructor(message = 'The requested resource is no longer available') {
    super({
      code: 410,
      message,
      errors: [{ reason: 'gone', message }],
    })
    this.name = 'GoneError'
  }
}

/**
 * Upload expired (410)
 */
export class ResumableUploadExpiredError extends GoneError {
  readonly uploadId: string

  constructor(uploadId: string) {
    super(`Resumable upload ${uploadId} has expired`)
    this.name = 'ResumableUploadExpiredError'
    this.uploadId = uploadId
  }
}

/**
 * Range not satisfiable (416)
 */
export class RangeNotSatisfiableError extends ApiError {
  constructor(message = 'The requested range cannot be satisfied') {
    super({
      code: 416,
      message,
      errors: [{ reason: 'requestedRangeNotSatisfiable', message }],
    })
    this.name = 'RangeNotSatisfiableError'
  }
}

/**
 * Too many requests (429)
 */
export class TooManyRequestsError extends ApiError {
  readonly retryAfter?: number

  constructor(message = 'Too many requests. Please try again later.', retryAfter?: number) {
    super({
      code: 429,
      message,
      errors: [{ reason: 'rateLimitExceeded', message }],
    })
    this.name = 'TooManyRequestsError'
    this.retryAfter = retryAfter
  }
}

/**
 * Internal server error (500)
 */
export class InternalError extends ApiError {
  constructor(message = 'Internal server error') {
    super({
      code: 500,
      message,
      errors: [{ reason: 'internalError', message }],
    })
    this.name = 'InternalError'
  }
}

/**
 * Service unavailable (503)
 */
export class ServiceUnavailableError extends ApiError {
  readonly retryAfter?: number

  constructor(message = 'Service temporarily unavailable', retryAfter?: number) {
    super({
      code: 503,
      message,
      errors: [{ reason: 'backendError', message }],
    })
    this.name = 'ServiceUnavailableError'
    this.retryAfter = retryAfter
  }
}

/**
 * Checksum mismatch error
 */
export class ChecksumMismatchError extends ApiError {
  readonly expected: string
  readonly received: string

  constructor(expected: string, received: string) {
    super({
      code: 400,
      message: `Checksum mismatch: expected ${expected}, received ${received}`,
      errors: [{ reason: 'invalid', message: 'Checksum mismatch' }],
    })
    this.name = 'ChecksumMismatchError'
    this.expected = expected
    this.received = received
  }
}

/**
 * Notification not found
 */
export class NotificationNotFoundError extends NotFoundError {
  readonly bucketName: string
  readonly notificationId: string

  constructor(bucketName: string, notificationId: string) {
    super(`Notification ${notificationId} not found in bucket ${bucketName}`)
    this.name = 'NotificationNotFoundError'
    this.bucketName = bucketName
    this.notificationId = notificationId
  }
}

/**
 * Resumable upload not found
 */
export class ResumableUploadNotFoundError extends NotFoundError {
  readonly uploadUri: string

  constructor(uploadUri: string) {
    super(`Resumable upload not found: ${uploadUri}`)
    this.name = 'ResumableUploadNotFoundError'
    this.uploadUri = uploadUri
  }
}

/**
 * ACL not found
 */
export class AclNotFoundError extends NotFoundError {
  readonly entity: string

  constructor(entity: string) {
    super(`ACL entry not found for entity: ${entity}`)
    this.name = 'AclNotFoundError'
    this.entity = entity
  }
}

// =============================================================================
// Bucket Name Validation
// =============================================================================

/**
 * Validates a GCS bucket name according to Google Cloud naming rules.
 *
 * Rules:
 * - Must be between 3 and 63 characters (or up to 222 for domain names)
 * - Must start and end with a letter or number
 * - Can contain lowercase letters, numbers, hyphens, underscores, and periods
 * - Cannot contain consecutive periods
 * - Cannot be a valid IP address
 * - Cannot start with "goog" or contain "google" variants
 *
 * @param name - The bucket name to validate
 * @returns true if valid
 * @throws InvalidBucketNameError if the name is invalid
 *
 * @see https://cloud.google.com/storage/docs/naming-buckets
 */
export function validateBucketName(name: string): boolean {
  // Check minimum length
  if (name.length < 3) {
    throw new InvalidBucketNameError(name, 'Bucket name must be at least 3 characters long')
  }

  // Check maximum length
  if (name.length > 63) {
    // Allow up to 222 for dot-separated domain names
    if (name.length > 222) {
      throw new InvalidBucketNameError(name, 'Bucket name must be no more than 222 characters long')
    }
    // Domain-style names must contain at least one dot
    if (!name.includes('.')) {
      throw new InvalidBucketNameError(name, 'Bucket names over 63 characters must be dot-separated components')
    }
  }

  // Check for valid characters
  if (!/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(name) && name.length > 2) {
    if (!/^[a-z0-9]$/.test(name)) {
      throw new InvalidBucketNameError(
        name,
        'Bucket name must start and end with a letter or number and contain only lowercase letters, numbers, hyphens, underscores, and periods'
      )
    }
  }

  // Single or two character names just need to be alphanumeric
  if (name.length <= 2 && !/^[a-z0-9]+$/.test(name)) {
    throw new InvalidBucketNameError(name, 'Short bucket names must contain only lowercase letters and numbers')
  }

  // Check for consecutive periods
  if (name.includes('..')) {
    throw new InvalidBucketNameError(name, 'Bucket name must not contain consecutive periods')
  }

  // Check for IP address format
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name)) {
    throw new InvalidBucketNameError(name, 'Bucket name must not be formatted as an IP address')
  }

  // Check for goog prefix
  if (name.toLowerCase().startsWith('goog')) {
    throw new InvalidBucketNameError(name, 'Bucket name must not start with "goog"')
  }

  // Check for google in name
  if (/google/i.test(name.replace(/[0o]/gi, 'o'))) {
    throw new InvalidBucketNameError(name, 'Bucket name must not contain "google" or close misspellings')
  }

  return true
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof ApiError) {
    // 5xx errors are generally retryable
    if (error.code >= 500 && error.code < 600) {
      return true
    }
    // 429 Too Many Requests is retryable
    if (error.code === 429) {
      return true
    }
    // 408 Request Timeout is retryable
    if (error.code === 408) {
      return true
    }
  }
  return false
}

/**
 * Check if an error indicates a not-found condition
 */
export function isNotFoundError(error: unknown): boolean {
  if (error instanceof NotFoundError) {
    return true
  }
  if (error instanceof ApiError && error.code === 404) {
    return true
  }
  return false
}

/**
 * Check if an error indicates a conflict condition
 */
export function isConflictError(error: unknown): boolean {
  if (error instanceof ConflictError) {
    return true
  }
  if (error instanceof ApiError && error.code === 409) {
    return true
  }
  return false
}
