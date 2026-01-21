/**
 * Body Size Limit Middleware for Hono
 *
 * Provides request body size validation to prevent memory exhaustion attacks.
 * Rejects requests with oversized bodies before they are fully consumed.
 *
 * Features:
 * - Configurable maximum body size
 * - Content-Length header validation (fast path)
 * - Streaming body size validation (for chunked encoding)
 * - Proper 413 Payload Too Large responses
 * - Skip paths configuration
 * - Per-method limits (optional)
 *
 * @module api/middleware/body-size-limit
 * @issue do-23wa - Add request size limits
 */

import type { Context, MiddlewareHandler, Next } from 'hono'
import { PayloadTooLargeError } from '../../rpc/errors'

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default maximum body size in bytes (1 MB)
 */
export const DEFAULT_MAX_BODY_SIZE = 1024 * 1024 // 1 MB

/**
 * Maximum allowed body size in bytes (100 MB)
 * This is an absolute upper limit to prevent misconfiguration
 */
export const MAX_ALLOWED_BODY_SIZE = 100 * 1024 * 1024 // 100 MB

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration options for body size limit middleware
 */
export interface BodySizeLimitConfig {
  /**
   * Maximum allowed body size in bytes
   * @default 1048576 (1 MB)
   */
  maxSize?: number

  /**
   * Paths to skip body size validation
   * Supports prefix matching (e.g., '/health' matches '/health' and '/health/check')
   */
  skipPaths?: string[]

  /**
   * HTTP methods to skip body size validation
   * By default, GET, HEAD, and OPTIONS are skipped as they typically don't have bodies
   * @default ['GET', 'HEAD', 'OPTIONS']
   */
  skipMethods?: string[]

  /**
   * Per-method size limits (optional)
   * Overrides the default maxSize for specific methods
   */
  methodLimits?: Record<string, number>

  /**
   * Whether to validate streaming bodies (chunked encoding without Content-Length)
   * When true, the middleware will wrap the body stream to count bytes
   * @default true
   */
  validateStreaming?: boolean
}

/**
 * Result from body size validation
 */
export interface BodySizeValidationResult {
  /** Whether the request passed validation */
  valid: boolean
  /** The declared or actual body size in bytes (if known) */
  size?: number
  /** Whether the request used chunked encoding (no Content-Length) */
  isChunked: boolean
  /** Error details if validation failed */
  error?: PayloadTooLargeError
}

// ============================================================================
// BODY SIZE VALIDATOR
// ============================================================================

/**
 * Body Size Validator
 *
 * Validates request body sizes against configured limits.
 */
export class BodySizeValidator {
  private readonly config: Required<BodySizeLimitConfig>

  constructor(config: BodySizeLimitConfig = {}) {
    const maxSize = config.maxSize ?? DEFAULT_MAX_BODY_SIZE

    // Validate maxSize is reasonable
    if (maxSize <= 0) {
      throw new Error('maxSize must be positive')
    }
    if (maxSize > MAX_ALLOWED_BODY_SIZE) {
      throw new Error(`maxSize cannot exceed ${MAX_ALLOWED_BODY_SIZE} bytes (100 MB)`)
    }

    this.config = {
      maxSize,
      skipPaths: config.skipPaths ?? [],
      skipMethods: config.skipMethods ?? ['GET', 'HEAD', 'OPTIONS'],
      methodLimits: config.methodLimits ?? {},
      validateStreaming: config.validateStreaming ?? true,
    }
  }

  /**
   * Check if a request should be validated
   */
  shouldValidate(request: Request): boolean {
    const method = request.method.toUpperCase()

    // Skip if method is in skip list
    if (this.config.skipMethods.includes(method)) {
      return false
    }

    // Skip if path matches skip paths
    const url = new URL(request.url)
    const path = url.pathname
    if (this.config.skipPaths.some((skipPath) => path.startsWith(skipPath))) {
      return false
    }

    // Check if request has a body (Content-Length > 0 or chunked encoding)
    const contentLength = request.headers.get('Content-Length')
    const transferEncoding = request.headers.get('Transfer-Encoding')

    // No body indicators - skip validation
    if (!contentLength && !transferEncoding) {
      return false
    }

    return true
  }

  /**
   * Get the maximum allowed size for a request
   */
  getMaxSizeForRequest(request: Request): number {
    const method = request.method.toUpperCase()
    return this.config.methodLimits[method] ?? this.config.maxSize
  }

  /**
   * Validate request body size using Content-Length header (fast path)
   */
  validateContentLength(request: Request): BodySizeValidationResult {
    const contentLength = request.headers.get('Content-Length')
    const transferEncoding = request.headers.get('Transfer-Encoding')

    // Check for chunked encoding (no Content-Length)
    if (!contentLength || transferEncoding?.includes('chunked')) {
      return {
        valid: true,
        isChunked: true,
      }
    }

    const size = parseInt(contentLength, 10)
    if (isNaN(size)) {
      return {
        valid: true,
        isChunked: false,
      }
    }

    const maxSize = this.getMaxSizeForRequest(request)

    if (size > maxSize) {
      return {
        valid: false,
        size,
        isChunked: false,
        error: PayloadTooLargeError.exceededReadable({
          sizeBytes: size,
          maxSizeBytes: maxSize,
        }),
      }
    }

    return {
      valid: true,
      size,
      isChunked: false,
    }
  }

  /**
   * Create a wrapped body stream that validates size during consumption
   * This is used for chunked encoding where Content-Length is not available
   */
  createValidatingStream(
    body: ReadableStream<Uint8Array>,
    maxSize: number
  ): { stream: ReadableStream<Uint8Array>; getSize: () => number } {
    let totalSize = 0
    let aborted = false

    const reader = body.getReader()

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (aborted) {
          controller.close()
          return
        }

        try {
          const { done, value } = await reader.read()

          if (done) {
            controller.close()
            return
          }

          totalSize += value.byteLength

          if (totalSize > maxSize) {
            aborted = true
            reader.cancel()
            controller.error(
              PayloadTooLargeError.exceededReadable({
                sizeBytes: totalSize,
                maxSizeBytes: maxSize,
              })
            )
            return
          }

          controller.enqueue(value)
        } catch (error) {
          controller.error(error)
        }
      },

      cancel() {
        reader.cancel()
      },
    })

    return {
      stream,
      getSize: () => totalSize,
    }
  }
}

// ============================================================================
// HONO MIDDLEWARE
// ============================================================================

/**
 * Create body size limit middleware for Hono
 *
 * @param config - Body size limit configuration
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * import { bodySizeLimitMiddleware } from './middleware/body-size-limit'
 *
 * // Default 1MB limit
 * app.use('*', bodySizeLimitMiddleware())
 *
 * // Custom 10MB limit
 * app.use('/api/upload/*', bodySizeLimitMiddleware({
 *   maxSize: 10 * 1024 * 1024, // 10MB
 * }))
 *
 * // Skip certain paths
 * app.use('*', bodySizeLimitMiddleware({
 *   skipPaths: ['/health', '/metrics'],
 * }))
 * ```
 */
export function bodySizeLimitMiddleware(config: BodySizeLimitConfig = {}): MiddlewareHandler {
  const validator = new BodySizeValidator(config)

  return async (c: Context, next: Next): Promise<Response | void> => {
    // Check if we should validate this request
    if (!validator.shouldValidate(c.req.raw)) {
      return next()
    }

    // Fast path: validate Content-Length header
    const result = validator.validateContentLength(c.req.raw)

    if (!result.valid && result.error) {
      return c.json(result.error.toJSON(), result.error.httpStatus)
    }

    // For chunked encoding, we need to wrap the stream to validate during consumption
    // This is only done if validateStreaming is enabled
    if (result.isChunked && config.validateStreaming !== false) {
      const body = c.req.raw.body
      if (body) {
        const maxSize = validator.getMaxSizeForRequest(c.req.raw)
        const { stream } = validator.createValidatingStream(body, maxSize)

        // Create new request with validating stream
        const headers = new Headers(c.req.raw.headers)
        const newRequest = new Request(c.req.raw.url, {
          method: c.req.raw.method,
          headers,
          body: stream,
          // duplex is required for streaming bodies in newer fetch implementations
          // @ts-expect-error - duplex is not in the type definition but is required
          duplex: 'half',
        })

        // Replace the request in context
        // Note: This is a bit hacky but necessary for Hono
        Object.defineProperty(c.req, 'raw', {
          value: newRequest,
          writable: true,
        })
      }
    }

    // Continue to next middleware/handler
    await next()
  }
}

/**
 * Create a body size validator instance (for use outside middleware)
 */
export function createBodySizeValidator(config: BodySizeLimitConfig = {}): BodySizeValidator {
  return new BodySizeValidator(config)
}

export default bodySizeLimitMiddleware
