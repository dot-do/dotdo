/**
 * Request Limiters
 *
 * Utilities for limiting request sizes and preventing DoS attacks:
 * - Body size limits
 * - JSON nesting depth limits
 *
 * @module lib/security/request-limiter
 */

// ============================================================================
// REQUEST LIMITER
// ============================================================================

/**
 * Request Size Limiter
 * Validates request bodies against size and complexity limits
 */
export class RequestLimiter {
  static readonly MAX_BODY_SIZE = 1024 * 1024 // 1MB default
  static readonly MAX_JSON_DEPTH = 20

  /**
   * Check if request body size is within limits
   *
   * @param body - Request body as string or Buffer
   * @param maxSize - Maximum allowed size in bytes
   * @throws Error if body exceeds the limit
   */
  static checkBodySize(body: string | Buffer, maxSize: number = this.MAX_BODY_SIZE): void {
    const size = typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.length
    if (size > maxSize) {
      throw new Error(`Request body too large: ${size} bytes exceeds limit of ${maxSize} bytes`)
    }
  }

  /**
   * Check if JSON nesting depth is within limits
   *
   * @param obj - Parsed JSON object
   * @param maxDepth - Maximum allowed nesting depth
   * @param currentDepth - Current depth (internal use)
   * @throws Error if nesting exceeds the limit
   */
  static checkJsonDepth(
    obj: unknown,
    maxDepth: number = this.MAX_JSON_DEPTH,
    currentDepth: number = 0
  ): void {
    if (currentDepth > maxDepth) {
      throw new Error(`JSON too deeply nested: exceeds maximum depth of ${maxDepth}`)
    }

    if (obj === null || typeof obj !== 'object') {
      return
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        this.checkJsonDepth(item, maxDepth, currentDepth + 1)
      }
    } else {
      for (const value of Object.values(obj)) {
        this.checkJsonDepth(value, maxDepth, currentDepth + 1)
      }
    }
  }

  /**
   * Validate both body size and JSON depth
   *
   * @param body - Request body string
   * @param options - Validation options
   * @returns Parsed and validated JSON object
   * @throws Error if validation fails
   */
  static validateJsonBody<T = unknown>(
    body: string,
    options: {
      maxSize?: number
      maxDepth?: number
    } = {}
  ): T {
    const { maxSize = this.MAX_BODY_SIZE, maxDepth = this.MAX_JSON_DEPTH } = options

    // Check size first (cheaper operation)
    this.checkBodySize(body, maxSize)

    // Parse JSON
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch (e) {
      throw new Error(`Invalid JSON: ${(e as Error).message}`)
    }

    // Check depth
    this.checkJsonDepth(parsed, maxDepth)

    return parsed as T
  }

  /**
   * Get body size in bytes
   */
  static getBodySize(body: string | Buffer): number {
    return typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.length
  }

  /**
   * Get JSON nesting depth
   */
  static getJsonDepth(obj: unknown, currentDepth: number = 0): number {
    if (obj === null || typeof obj !== 'object') {
      return currentDepth
    }

    let maxChildDepth = currentDepth

    if (Array.isArray(obj)) {
      for (const item of obj) {
        maxChildDepth = Math.max(maxChildDepth, this.getJsonDepth(item, currentDepth + 1))
      }
    } else {
      for (const value of Object.values(obj)) {
        maxChildDepth = Math.max(maxChildDepth, this.getJsonDepth(value, currentDepth + 1))
      }
    }

    return maxChildDepth
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

/**
 * Parse a size string to bytes
 * @example '1MB' -> 1048576, '512KB' -> 524288
 */
export function parseSize(size: string): number {
  const match = size.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i)
  if (!match) {
    throw new Error(`Invalid size format: ${size}`)
  }

  const value = parseFloat(match[1])
  const unit = match[2].toUpperCase()

  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
  }

  return Math.floor(value * multipliers[unit])
}
