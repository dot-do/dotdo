/**
 * @dotdo/s3/errors - S3 Error Classes
 *
 * AWS SDK v3 compatible error classes for S3 operations.
 *
 * @example
 * ```typescript
 * import { NoSuchBucket, NoSuchKey, S3ServiceException } from '@dotdo/s3'
 *
 * try {
 *   await client.send(new GetObjectCommand({ Bucket: 'missing', Key: 'file.txt' }))
 * } catch (error) {
 *   if (error instanceof NoSuchBucket) {
 *     console.log('Bucket does not exist')
 *   } else if (error instanceof NoSuchKey) {
 *     console.log('Object does not exist')
 *   }
 * }
 * ```
 */

import type { ResponseMetadata } from './types'

// =============================================================================
// Error Options
// =============================================================================

interface S3ErrorOptions {
  message?: string
  $metadata?: ResponseMetadata
}

// =============================================================================
// Base Exception
// =============================================================================

/**
 * Base exception class for all S3 service errors
 */
export class S3ServiceException extends Error {
  readonly $fault: 'client' | 'server' = 'client'
  readonly $metadata: ResponseMetadata
  override readonly name: string = 'S3ServiceException'

  constructor(options: S3ErrorOptions = {}) {
    super(options.message || 'An S3 error occurred')
    this.name = 'S3ServiceException'
    this.$metadata = options.$metadata || { httpStatusCode: 500 }
  }
}

// =============================================================================
// Bucket Errors
// =============================================================================

/**
 * The specified bucket does not exist
 */
export class NoSuchBucket extends S3ServiceException {
  override readonly name = 'NoSuchBucket'

  constructor(options: S3ErrorOptions = {}) {
    super({
      message: 'The specified bucket does not exist',
      $metadata: { httpStatusCode: 404 },
      ...options,
    })
    this.name = 'NoSuchBucket'
  }
}

/**
 * The requested bucket name is not available
 */
export class BucketAlreadyExists extends S3ServiceException {
  override readonly name = 'BucketAlreadyExists'

  constructor(options: S3ErrorOptions = {}) {
    super({
      message: 'The requested bucket name is not available',
      $metadata: { httpStatusCode: 409 },
      ...options,
    })
    this.name = 'BucketAlreadyExists'
  }
}

/**
 * A bucket already exists and is owned by you
 */
export class BucketAlreadyOwnedByYou extends S3ServiceException {
  override readonly name = 'BucketAlreadyOwnedByYou'

  constructor(options: S3ErrorOptions = {}) {
    super({
      message: 'A bucket with this name already exists and is owned by you',
      $metadata: { httpStatusCode: 409 },
      ...options,
    })
    this.name = 'BucketAlreadyOwnedByYou'
  }
}

/**
 * The bucket you tried to delete is not empty
 */
export class BucketNotEmpty extends S3ServiceException {
  override readonly name = 'BucketNotEmpty'

  constructor(options: S3ErrorOptions = {}) {
    super({
      message: 'The bucket you tried to delete is not empty',
      $metadata: { httpStatusCode: 409 },
      ...options,
    })
    this.name = 'BucketNotEmpty'
  }
}

// =============================================================================
// Object Errors
// =============================================================================

/**
 * The specified key does not exist
 */
export class NoSuchKey extends S3ServiceException {
  override readonly name = 'NoSuchKey'

  constructor(options: S3ErrorOptions = {}) {
    super({
      message: 'The specified key does not exist',
      $metadata: { httpStatusCode: 404 },
      ...options,
    })
    this.name = 'NoSuchKey'
  }
}

/**
 * Object is being restored
 */
export class ObjectNotInActiveTierError extends S3ServiceException {
  override readonly name = 'ObjectNotInActiveTierError'

  constructor(options: S3ErrorOptions = {}) {
    super({
      message: 'The source object of the COPY operation is not in the active tier',
      $metadata: { httpStatusCode: 403 },
      ...options,
    })
    this.name = 'ObjectNotInActiveTierError'
  }
}

/**
 * The specified object already exists (for conditional puts)
 */
export class ObjectAlreadyInActiveTierError extends S3ServiceException {
  override readonly name = 'ObjectAlreadyInActiveTierError'

  constructor(options: S3ErrorOptions = {}) {
    super({
      message: 'The restore request was accepted, and the object is being restored',
      $metadata: { httpStatusCode: 200 },
      ...options,
    })
    this.name = 'ObjectAlreadyInActiveTierError'
  }
}

// =============================================================================
// Multipart Upload Errors
// =============================================================================

/**
 * The specified multipart upload does not exist
 */
export class NoSuchUpload extends S3ServiceException {
  override readonly name = 'NoSuchUpload'

  constructor(options: S3ErrorOptions = {}) {
    super({
      message: 'The specified multipart upload does not exist',
      $metadata: { httpStatusCode: 404 },
      ...options,
    })
    this.name = 'NoSuchUpload'
  }
}

/**
 * One or more of the specified parts could not be found
 */
export class InvalidPart extends S3ServiceException {
  override readonly name = 'InvalidPart'

  constructor(options: S3ErrorOptions = {}) {
    super({
      message: 'One or more of the specified parts could not be found',
      $metadata: { httpStatusCode: 400 },
      ...options,
    })
    this.name = 'InvalidPart'
  }
}

/**
 * The list of parts was not in ascending order
 */
export class InvalidPartOrder extends S3ServiceException {
  override readonly name = 'InvalidPartOrder'

  constructor(options: S3ErrorOptions = {}) {
    super({
      message: 'The list of parts was not in ascending order',
      $metadata: { httpStatusCode: 400 },
      ...options,
    })
    this.name = 'InvalidPartOrder'
  }
}

/**
 * Entity too small error (part must be at least 5MB except last part)
 */
export class EntityTooSmall extends S3ServiceException {
  override readonly name = 'EntityTooSmall'

  constructor(options: S3ErrorOptions = {}) {
    super({
      message: 'Your proposed upload is smaller than the minimum allowed object size',
      $metadata: { httpStatusCode: 400 },
      ...options,
    })
    this.name = 'EntityTooSmall'
  }
}

/**
 * Entity too large error (single PUT limit is 5GB)
 */
export class EntityTooLarge extends S3ServiceException {
  override readonly name = 'EntityTooLarge'

  constructor(options: S3ErrorOptions = {}) {
    super({
      message: 'Your proposed upload exceeds the maximum allowed object size',
      $metadata: { httpStatusCode: 400 },
      ...options,
    })
    this.name = 'EntityTooLarge'
  }
}

// =============================================================================
// Access Errors
// =============================================================================

/**
 * Access denied
 */
export class AccessDenied extends S3ServiceException {
  override readonly name = 'AccessDenied'

  constructor(options: S3ErrorOptions = {}) {
    super({
      message: 'Access Denied',
      $metadata: { httpStatusCode: 403 },
      ...options,
    })
    this.name = 'AccessDenied'
  }
}

/**
 * Invalid access key ID
 */
export class InvalidAccessKeyId extends S3ServiceException {
  override readonly name = 'InvalidAccessKeyId'

  constructor(options: S3ErrorOptions = {}) {
    super({
      message: 'The AWS access key ID you provided does not exist in our records',
      $metadata: { httpStatusCode: 403 },
      ...options,
    })
    this.name = 'InvalidAccessKeyId'
  }
}

/**
 * Signature does not match
 */
export class SignatureDoesNotMatch extends S3ServiceException {
  override readonly name = 'SignatureDoesNotMatch'

  constructor(options: S3ErrorOptions = {}) {
    super({
      message: 'The request signature we calculated does not match the signature you provided',
      $metadata: { httpStatusCode: 403 },
      ...options,
    })
    this.name = 'SignatureDoesNotMatch'
  }
}

// =============================================================================
// Request Errors
// =============================================================================

/**
 * Invalid request
 */
export class InvalidRequest extends S3ServiceException {
  override readonly name = 'InvalidRequest'

  constructor(options: S3ErrorOptions = {}) {
    super({
      message: 'Invalid Request',
      $metadata: { httpStatusCode: 400 },
      ...options,
    })
    this.name = 'InvalidRequest'
  }
}

/**
 * Invalid bucket name
 */
export class InvalidBucketName extends S3ServiceException {
  override readonly name = 'InvalidBucketName'

  constructor(options: S3ErrorOptions = {}) {
    super({
      message: 'The specified bucket is not valid',
      $metadata: { httpStatusCode: 400 },
      ...options,
    })
    this.name = 'InvalidBucketName'
  }
}

/**
 * Invalid range
 */
export class InvalidRange extends S3ServiceException {
  override readonly name = 'InvalidRange'

  constructor(options: S3ErrorOptions = {}) {
    super({
      message: 'The requested range cannot be satisfied',
      $metadata: { httpStatusCode: 416 },
      ...options,
    })
    this.name = 'InvalidRange'
  }
}

/**
 * Precondition failed
 */
export class PreconditionFailed extends S3ServiceException {
  override readonly name = 'PreconditionFailed'

  constructor(options: S3ErrorOptions = {}) {
    super({
      message: 'At least one of the preconditions you specified did not hold',
      $metadata: { httpStatusCode: 412 },
      ...options,
    })
    this.name = 'PreconditionFailed'
  }
}

/**
 * Not modified
 */
export class NotModified extends S3ServiceException {
  override readonly name = 'NotModified'

  constructor(options: S3ErrorOptions = {}) {
    super({
      message: 'Not Modified',
      $metadata: { httpStatusCode: 304 },
      ...options,
    })
    this.name = 'NotModified'
  }
}

// =============================================================================
// Server Errors
// =============================================================================

/**
 * Internal error
 */
export class InternalError extends S3ServiceException {
  override readonly $fault: 'client' | 'server' = 'server'
  override readonly name = 'InternalError'

  constructor(options: S3ErrorOptions = {}) {
    super({
      message: 'We encountered an internal error. Please try again.',
      $metadata: { httpStatusCode: 500 },
      ...options,
    })
    this.name = 'InternalError'
  }
}

/**
 * Service unavailable
 */
export class ServiceUnavailable extends S3ServiceException {
  override readonly $fault: 'client' | 'server' = 'server'
  override readonly name = 'ServiceUnavailable'

  constructor(options: S3ErrorOptions = {}) {
    super({
      message: 'Service is unable to handle request',
      $metadata: { httpStatusCode: 503 },
      ...options,
    })
    this.name = 'ServiceUnavailable'
  }
}

/**
 * Slow down
 */
export class SlowDown extends S3ServiceException {
  override readonly $fault: 'client' | 'server' = 'server'
  override readonly name = 'SlowDown'

  constructor(options: S3ErrorOptions = {}) {
    super({
      message: 'Reduce your request rate',
      $metadata: { httpStatusCode: 503 },
      ...options,
    })
    this.name = 'SlowDown'
  }
}
