/**
 * CORS Validation Utilities for @dotdo/do package
 *
 * Provides validation and configuration helpers for CORS handling
 * with security-conscious defaults and production warnings.
 *
 * @module do/utils/cors
 */

import { createLogger } from '../../utils/logger'

const logger = createLogger('[CORS]')

/**
 * Standard HTTP methods for CORS
 */
export const DEFAULT_CORS_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const

/**
 * Standard headers for CORS
 */
export const DEFAULT_CORS_HEADERS = ['Content-Type', 'Authorization', 'X-Request-ID', 'X-API-Key'] as const

/**
 * Headers to expose to clients
 */
export const DEFAULT_EXPOSE_HEADERS = ['X-Request-ID', 'X-DO-Colo'] as const

/**
 * Valid HTTP methods for CORS validation
 */
export const VALID_HTTP_METHODS = new Set([
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'TRACE', 'CONNECT'
])

/**
 * Result of origin validation
 */
export interface OriginValidationResult {
  /** Whether the origin is valid */
  valid: boolean
  /** The matched origin (for responding) or null if invalid */
  matchedOrigin: string | null
  /** Warning message if any (e.g., wildcard in production) */
  warning?: string
}

/**
 * Validate an incoming origin against allowed origins
 *
 * @param requestOrigin - The Origin header from the request
 * @param allowedOrigins - Configured allowed origins
 * @param isProduction - Whether running in production environment
 * @returns Validation result with matched origin or rejection
 *
 * @example
 * ```typescript
 * const result = validateOrigin('https://app.example.com', ['https://app.example.com'])
 * // { valid: true, matchedOrigin: 'https://app.example.com' }
 *
 * const result2 = validateOrigin('https://evil.com', ['https://app.example.com'])
 * // { valid: false, matchedOrigin: null }
 * ```
 */
export function validateOrigin(
  requestOrigin: string | null,
  allowedOrigins: string[] | '*' | undefined,
  isProduction: boolean = false
): OriginValidationResult {
  // No origin header - not a CORS request, allow through
  if (!requestOrigin) {
    return { valid: true, matchedOrigin: null }
  }

  // No allowed origins configured - reject all cross-origin requests
  if (allowedOrigins === undefined) {
    return { valid: false, matchedOrigin: null }
  }

  // Wildcard origin
  if (allowedOrigins === '*' || (Array.isArray(allowedOrigins) && allowedOrigins.includes('*'))) {
    const result: OriginValidationResult = { valid: true, matchedOrigin: '*' }
    if (isProduction) {
      result.warning = 'Wildcard CORS origin (*) is enabled in production. This is a security risk. Configure explicit allowedOrigins instead.'
    }
    return result
  }

  // Check against allowed list
  if (Array.isArray(allowedOrigins)) {
    // Normalize origins for comparison (lowercase)
    const normalizedRequest = requestOrigin.toLowerCase()
    const match = allowedOrigins.find(origin =>
      origin.toLowerCase() === normalizedRequest
    )

    if (match) {
      return { valid: true, matchedOrigin: requestOrigin }
    }
  }

  return { valid: false, matchedOrigin: null }
}

/**
 * Validate HTTP methods for CORS configuration
 *
 * @param methods - Array of HTTP methods to validate
 * @returns Object with valid methods and any invalid ones found
 *
 * @example
 * ```typescript
 * const result = validateMethods(['GET', 'POST', 'INVALID'])
 * // { valid: ['GET', 'POST'], invalid: ['INVALID'] }
 * ```
 */
export function validateMethods(methods: string[]): { valid: string[]; invalid: string[] } {
  const valid: string[] = []
  const invalid: string[] = []

  for (const method of methods) {
    const normalized = method.toUpperCase()
    if (VALID_HTTP_METHODS.has(normalized)) {
      valid.push(normalized)
    } else {
      invalid.push(method)
    }
  }

  return { valid, invalid }
}

/**
 * Validate origin format (basic URL validation)
 *
 * @param origin - Origin string to validate
 * @returns Whether the origin is a valid URL format
 */
export function isValidOriginFormat(origin: string): boolean {
  if (origin === '*') return true

  try {
    const url = new URL(origin)
    // Origin should only have protocol and host (no path, query, or hash)
    return url.origin === origin
  } catch {
    return false
  }
}

/**
 * Validate an array of origins for configuration
 *
 * @param origins - Origins to validate
 * @returns Object with valid origins and any malformed ones
 */
export function validateOriginConfig(
  origins: string[] | '*' | undefined
): { valid: string[]; malformed: string[] } {
  if (origins === undefined || origins === '*') {
    return { valid: origins === '*' ? ['*'] : [], malformed: [] }
  }

  const valid: string[] = []
  const malformed: string[] = []

  for (const origin of origins) {
    if (isValidOriginFormat(origin)) {
      valid.push(origin)
    } else {
      malformed.push(origin)
    }
  }

  return { valid, malformed }
}

/**
 * Log warnings for CORS configuration issues
 *
 * @param options - CORS validation results to check for warnings
 */
export function logCORSWarnings(options: {
  isWildcard: boolean
  isProduction: boolean
  malformedOrigins?: string[]
  invalidMethods?: string[]
}): void {
  const { isWildcard, isProduction, malformedOrigins = [], invalidMethods = [] } = options

  if (isWildcard && isProduction) {
    logger.warn(
      'SECURITY WARNING: Wildcard CORS origin (*) is enabled in production. ' +
      'This allows any website to make cross-origin requests to your DO. ' +
      'Configure explicit allowedOrigins for production use.'
    )
  }

  if (malformedOrigins.length > 0) {
    logger.warn(
      `Malformed CORS origins detected and ignored: ${malformedOrigins.join(', ')}. ` +
      'Origins should be in the format: https://example.com (no path, query, or hash)'
    )
  }

  if (invalidMethods.length > 0) {
    logger.warn(
      `Invalid HTTP methods detected and ignored: ${invalidMethods.join(', ')}. ` +
      `Valid methods are: ${Array.from(VALID_HTTP_METHODS).join(', ')}`
    )
  }
}

/**
 * Detect if running in production environment
 *
 * Uses multiple signals to detect production:
 * 1. ENVIRONMENT env var
 * 2. NODE_ENV env var
 * 3. Cloudflare Workers environment detection
 *
 * @returns Whether the environment appears to be production
 */
export function isProductionEnvironment(): boolean {
  // Check common environment variables (these would come from wrangler.toml or env)
  // In Durable Objects, we typically don't have access to process.env
  // but we can check for certain runtime characteristics

  // If we're in a test environment, it's not production
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as unknown as Record<string, unknown>
    // Vitest sets import.meta.vitest or vi is globally available
    if (g['__vitest_worker__'] || g['vi']) {
      return false
    }
  }

  // In workers, check if we're running in a known development context
  // miniflare sets certain properties we can detect
  try {
    // If we can access process.env.NODE_ENV, use it
    if (typeof process !== 'undefined' && process.env) {
      const env = process.env['NODE_ENV'] || process.env['ENVIRONMENT']
      return env === 'production'
    }
  } catch {
    // process is not defined - likely in Workers runtime
  }

  // Default to assuming production in Workers runtime for safety
  // Better to show warnings than to miss security issues
  return true
}

/**
 * Build a Hono cors() options object from our CORSOptions
 *
 * @param options - Our CORS configuration
 * @param isProduction - Whether in production (for warnings)
 * @returns Options object for Hono's cors() middleware
 */
export function buildHonoCorsOptions(
  options: {
    allowedOrigins?: string[] | '*'
    allowedMethods?: string[]
    allowedHeaders?: string[]
    exposeHeaders?: string[]
    credentials?: boolean
    maxAge?: number
  },
  isProduction: boolean = false
): {
  origin: string | string[] | ((origin: string, c: unknown) => string | undefined | null)
  allowMethods: string[]
  allowHeaders: string[]
  exposeHeaders: string[]
  credentials: boolean
  maxAge: number
} {
  const {
    allowedOrigins,
    allowedMethods = [...DEFAULT_CORS_METHODS],
    allowedHeaders: allowHeaders = [...DEFAULT_CORS_HEADERS],
    exposeHeaders = [...DEFAULT_EXPOSE_HEADERS],
    credentials,
    maxAge = 86400
  } = options

  // Validate and log warnings
  const originConfig = validateOriginConfig(allowedOrigins)
  const methodConfig = validateMethods(allowedMethods)

  const isWildcard = allowedOrigins === '*' ||
    (Array.isArray(allowedOrigins) && allowedOrigins.includes('*'))

  logCORSWarnings({
    isWildcard,
    isProduction,
    malformedOrigins: originConfig.malformed,
    invalidMethods: methodConfig.invalid
  })

  // Determine origin handling
  let origin: string | string[] | ((origin: string, c: unknown) => string | undefined | null)

  if (allowedOrigins === undefined) {
    // No origins configured - reject all (return empty function)
    origin = () => null
  } else if (isWildcard) {
    origin = '*'
  } else if (Array.isArray(allowedOrigins) && originConfig.valid.length > 0) {
    // Multiple origins - use dynamic function
    origin = (requestOrigin: string) => {
      const normalizedRequest = requestOrigin.toLowerCase()
      const match = originConfig.valid.find(o => o.toLowerCase() === normalizedRequest)
      return match ? requestOrigin : null
    }
  } else {
    // Fallback - reject all
    origin = () => null
  }

  // Credentials: default to true for specific origins, false for wildcard
  const effectiveCredentials = credentials ?? !isWildcard

  return {
    origin,
    allowMethods: methodConfig.valid.length > 0 ? methodConfig.valid : [...DEFAULT_CORS_METHODS],
    allowHeaders,
    exposeHeaders,
    credentials: effectiveCredentials,
    maxAge
  }
}
