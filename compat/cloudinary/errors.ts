/**
 * @dotdo/cloudinary/errors - Error Classes
 *
 * Cloudinary-compatible error types for the compat layer.
 */

// =============================================================================
// Base Error
// =============================================================================

export class CloudinaryError extends Error {
  public readonly code: string
  public readonly httpCode: number

  constructor(message: string, code: string, httpCode: number = 400) {
    super(message)
    this.name = 'CloudinaryError'
    this.code = code
    this.httpCode = httpCode
    Object.setPrototypeOf(this, CloudinaryError.prototype)
  }

  toJSON() {
    return {
      error: {
        message: this.message,
        code: this.code,
        http_code: this.httpCode,
      },
    }
  }
}

// =============================================================================
// Authentication Errors
// =============================================================================

export class AuthenticationError extends CloudinaryError {
  constructor(message: string = 'Invalid API credentials') {
    super(message, 'AUTHENTICATION_ERROR', 401)
    this.name = 'AuthenticationError'
    Object.setPrototypeOf(this, AuthenticationError.prototype)
  }
}

export class AuthorizationError extends CloudinaryError {
  constructor(message: string = 'Access denied') {
    super(message, 'AUTHORIZATION_ERROR', 403)
    this.name = 'AuthorizationError'
    Object.setPrototypeOf(this, AuthorizationError.prototype)
  }
}

// =============================================================================
// Resource Errors
// =============================================================================

export class NotFoundError extends CloudinaryError {
  public readonly resourceType: string
  public readonly publicId?: string

  constructor(message: string, resourceType: string = 'resource', publicId?: string) {
    super(message, 'NOT_FOUND', 404)
    this.name = 'NotFoundError'
    this.resourceType = resourceType
    this.publicId = publicId
    Object.setPrototypeOf(this, NotFoundError.prototype)
  }
}

export class ResourceNotFoundError extends NotFoundError {
  constructor(publicId: string, resourceType: string = 'image') {
    super(`Resource not found: ${publicId}`, resourceType, publicId)
    this.name = 'ResourceNotFoundError'
    Object.setPrototypeOf(this, ResourceNotFoundError.prototype)
  }
}

export class FolderNotFoundError extends NotFoundError {
  constructor(path: string) {
    super(`Folder not found: ${path}`, 'folder')
    this.name = 'FolderNotFoundError'
    Object.setPrototypeOf(this, FolderNotFoundError.prototype)
  }
}

// =============================================================================
// Validation Errors
// =============================================================================

export class ValidationError extends CloudinaryError {
  public readonly field?: string

  constructor(message: string, field?: string) {
    super(message, 'VALIDATION_ERROR', 400)
    this.name = 'ValidationError'
    this.field = field
    Object.setPrototypeOf(this, ValidationError.prototype)
  }
}

export class InvalidFormatError extends ValidationError {
  constructor(format: string) {
    super(`Invalid format: ${format}`, 'format')
    this.name = 'InvalidFormatError'
    Object.setPrototypeOf(this, InvalidFormatError.prototype)
  }
}

export class InvalidTransformationError extends ValidationError {
  constructor(transformation: string, reason?: string) {
    const message = reason
      ? `Invalid transformation "${transformation}": ${reason}`
      : `Invalid transformation: ${transformation}`
    super(message, 'transformation')
    this.name = 'InvalidTransformationError'
    Object.setPrototypeOf(this, InvalidTransformationError.prototype)
  }
}

export class InvalidPublicIdError extends ValidationError {
  constructor(publicId: string, reason?: string) {
    const message = reason
      ? `Invalid public_id "${publicId}": ${reason}`
      : `Invalid public_id: ${publicId}`
    super(message, 'public_id')
    this.name = 'InvalidPublicIdError'
    Object.setPrototypeOf(this, InvalidPublicIdError.prototype)
  }
}

export class FileTooLargeError extends ValidationError {
  public readonly maxSize: number
  public readonly actualSize: number

  constructor(maxSize: number, actualSize: number) {
    super(`File size ${actualSize} exceeds maximum allowed size ${maxSize}`)
    this.name = 'FileTooLargeError'
    this.maxSize = maxSize
    this.actualSize = actualSize
    Object.setPrototypeOf(this, FileTooLargeError.prototype)
  }
}

// =============================================================================
// Upload Errors
// =============================================================================

export class UploadError extends CloudinaryError {
  constructor(message: string, code: string = 'UPLOAD_ERROR') {
    super(message, code, 400)
    this.name = 'UploadError'
    Object.setPrototypeOf(this, UploadError.prototype)
  }
}

export class UnsupportedFileTypeError extends UploadError {
  public readonly fileType: string

  constructor(fileType: string) {
    super(`Unsupported file type: ${fileType}`, 'UNSUPPORTED_FILE_TYPE')
    this.name = 'UnsupportedFileTypeError'
    this.fileType = fileType
    Object.setPrototypeOf(this, UnsupportedFileTypeError.prototype)
  }
}

export class EmptyFileError extends UploadError {
  constructor() {
    super('File is empty', 'EMPTY_FILE')
    this.name = 'EmptyFileError'
    Object.setPrototypeOf(this, EmptyFileError.prototype)
  }
}

// =============================================================================
// Rate Limit Errors
// =============================================================================

export class RateLimitError extends CloudinaryError {
  public readonly retryAfter?: number

  constructor(message: string = 'Rate limit exceeded', retryAfter?: number) {
    super(message, 'RATE_LIMIT_EXCEEDED', 429)
    this.name = 'RateLimitError'
    this.retryAfter = retryAfter
    Object.setPrototypeOf(this, RateLimitError.prototype)
  }
}

// =============================================================================
// Server Errors
// =============================================================================

export class ServerError extends CloudinaryError {
  constructor(message: string = 'Internal server error') {
    super(message, 'SERVER_ERROR', 500)
    this.name = 'ServerError'
    Object.setPrototypeOf(this, ServerError.prototype)
  }
}

export class ServiceUnavailableError extends CloudinaryError {
  constructor(message: string = 'Service temporarily unavailable') {
    super(message, 'SERVICE_UNAVAILABLE', 503)
    this.name = 'ServiceUnavailableError'
    Object.setPrototypeOf(this, ServiceUnavailableError.prototype)
  }
}

// =============================================================================
// Validation Helpers
// =============================================================================

const VALID_PUBLIC_ID_REGEX = /^[a-zA-Z0-9_\-./]+$/
const MAX_PUBLIC_ID_LENGTH = 255

export function validatePublicId(publicId: string): void {
  if (!publicId || publicId.trim() === '') {
    throw new InvalidPublicIdError(publicId, 'public_id cannot be empty')
  }

  if (publicId.length > MAX_PUBLIC_ID_LENGTH) {
    throw new InvalidPublicIdError(publicId, `exceeds maximum length of ${MAX_PUBLIC_ID_LENGTH}`)
  }

  if (!VALID_PUBLIC_ID_REGEX.test(publicId)) {
    throw new InvalidPublicIdError(
      publicId,
      'contains invalid characters. Only alphanumeric, underscore, hyphen, slash, and dot are allowed'
    )
  }

  if (publicId.startsWith('/') || publicId.endsWith('/')) {
    throw new InvalidPublicIdError(publicId, 'cannot start or end with a slash')
  }

  if (publicId.includes('//')) {
    throw new InvalidPublicIdError(publicId, 'cannot contain consecutive slashes')
  }
}

const SUPPORTED_IMAGE_FORMATS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'bmp', 'tiff', 'tif',
  'ico', 'pdf', 'ai', 'eps', 'psd', 'raw', 'arw', 'cr2', 'nef', 'orf',
])

const SUPPORTED_VIDEO_FORMATS = new Set([
  'mp4', 'webm', 'mov', 'avi', 'wmv', 'flv', 'mkv', 'm4v', '3gp', 'ogv',
  'mpeg', 'mpg', 'm2v', 'm2ts', 'mxf', 'ts',
])

export function validateFormat(format: string, resourceType: 'image' | 'video' | 'raw' = 'image'): void {
  const normalizedFormat = format.toLowerCase()

  if (resourceType === 'image' && !SUPPORTED_IMAGE_FORMATS.has(normalizedFormat)) {
    throw new InvalidFormatError(format)
  }

  if (resourceType === 'video' && !SUPPORTED_VIDEO_FORMATS.has(normalizedFormat)) {
    throw new InvalidFormatError(format)
  }
  // 'raw' type accepts any format
}

export function validateFileSize(size: number, maxSize: number = 100 * 1024 * 1024): void {
  if (size === 0) {
    throw new EmptyFileError()
  }

  if (size > maxSize) {
    throw new FileTooLargeError(maxSize, size)
  }
}
