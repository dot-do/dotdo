/**
 * @dotdo/supabase/storage/errors - Supabase Storage Error Classes
 *
 * Error classes matching Supabase Storage API error responses.
 */

import type { StorageError } from './types'

// =============================================================================
// Base Error Class
// =============================================================================

export class StorageApiError extends Error implements StorageError {
  readonly statusCode?: string
  readonly error?: string

  constructor(message: string, statusCode?: string, error?: string) {
    super(message)
    this.name = 'StorageApiError'
    this.statusCode = statusCode
    this.error = error
  }

  toJSON(): StorageError {
    return {
      message: this.message,
      statusCode: this.statusCode,
      error: this.error,
    }
  }
}

// =============================================================================
// Bucket Errors
// =============================================================================

export class BucketNotFoundError extends StorageApiError {
  constructor(bucketId: string) {
    super(`Bucket not found: ${bucketId}`, '404', 'Bucket not found')
    this.name = 'BucketNotFoundError'
  }
}

export class BucketAlreadyExistsError extends StorageApiError {
  constructor(bucketId: string) {
    super(`Bucket already exists: ${bucketId}`, '409', 'Bucket already exists')
    this.name = 'BucketAlreadyExistsError'
  }
}

export class BucketNotEmptyError extends StorageApiError {
  constructor(bucketId: string) {
    super(`Bucket not empty: ${bucketId}`, '409', 'Bucket not empty')
    this.name = 'BucketNotEmptyError'
  }
}

// =============================================================================
// File Errors
// =============================================================================

export class FileNotFoundError extends StorageApiError {
  constructor(path: string) {
    super(`Object not found: ${path}`, '404', 'Object not found')
    this.name = 'FileNotFoundError'
  }
}

export class FileAlreadyExistsError extends StorageApiError {
  constructor(path: string) {
    super(`Object already exists: ${path}`, '409', 'Object already exists')
    this.name = 'FileAlreadyExistsError'
  }
}

export class InvalidFileTypeError extends StorageApiError {
  constructor(contentType: string, allowed: string[]) {
    super(
      `Invalid file type: ${contentType}. Allowed types: ${allowed.join(', ')}`,
      '415',
      'Invalid file type'
    )
    this.name = 'InvalidFileTypeError'
  }
}

export class FileTooLargeError extends StorageApiError {
  constructor(size: number, limit: number) {
    super(
      `File size ${size} exceeds limit ${limit}`,
      '413',
      'File too large'
    )
    this.name = 'FileTooLargeError'
  }
}

// =============================================================================
// Auth Errors
// =============================================================================

export class UnauthorizedError extends StorageApiError {
  constructor(message = 'Unauthorized') {
    super(message, '401', 'Unauthorized')
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends StorageApiError {
  constructor(message = 'Forbidden') {
    super(message, '403', 'Forbidden')
    this.name = 'ForbiddenError'
  }
}

// =============================================================================
// Validation Errors
// =============================================================================

export class InvalidPathError extends StorageApiError {
  constructor(path: string) {
    super(`Invalid path: ${path}`, '400', 'Invalid path')
    this.name = 'InvalidPathError'
  }
}

export class InvalidBucketNameError extends StorageApiError {
  constructor(name: string) {
    super(`Invalid bucket name: ${name}`, '400', 'Invalid bucket name')
    this.name = 'InvalidBucketNameError'
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Validate bucket name according to Supabase rules
 * - 3-63 characters
 * - Lowercase letters, numbers, hyphens
 * - Must start with letter or number
 * - Cannot end with hyphen
 */
export function validateBucketName(name: string): void {
  if (!name || name.length < 3 || name.length > 63) {
    throw new InvalidBucketNameError(name)
  }

  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(name)) {
    throw new InvalidBucketNameError(name)
  }

  if (name.includes('--')) {
    throw new InvalidBucketNameError(name)
  }
}

/**
 * Validate file path
 * - Cannot be empty
 * - Cannot start with /
 * - Cannot contain ..
 */
export function validatePath(path: string): void {
  if (!path || path.startsWith('/') || path.includes('..')) {
    throw new InvalidPathError(path)
  }
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof StorageApiError) {
    const code = error.statusCode ? parseInt(error.statusCode) : 0
    return code >= 500 || code === 429
  }
  return false
}

/**
 * Convert unknown error to StorageApiError
 */
export function toStorageError(error: unknown): StorageApiError {
  if (error instanceof StorageApiError) {
    return error
  }

  if (error instanceof Error) {
    return new StorageApiError(error.message)
  }

  return new StorageApiError(String(error))
}
