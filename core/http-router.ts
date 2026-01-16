/**
 * HTTP Router Module - CORS, routing utilities, and HTTP constants
 *
 * This module contains:
 * - HTTP status code constants
 * - Secure CORS configuration with explicit origin allowlist
 * - CORS header building utilities
 * - Route-specific CORS policies
 */

// ============================================================================
// HTTP Status Constants
// ============================================================================

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  UPGRADE_REQUIRED: 426,
  INTERNAL_SERVER_ERROR: 500,
} as const

export type HttpStatusCode = (typeof HTTP_STATUS)[keyof typeof HTTP_STATUS]

// ============================================================================
// Version Header
// ============================================================================

export const VERSION_HEADER = 'X-DO-Version'
export const VERSION = '1.0.0'

// ============================================================================
// SECURE CORS CONFIGURATION
// ============================================================================

/** Explicit allowlist of trusted origins - SECURITY: Never use wildcards */
export const ALLOWED_ORIGINS = [
  'https://dotdo.dev',
  'https://api.dotdo.dev',
  'http://localhost:3000',
  'http://localhost:5173',
] as const

/** Route-specific CORS policies for different security levels */
export const CORS_POLICIES = {
  /** Public routes - read-only methods, no credentials */
  public: {
    allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    allowCredentials: false,
  },
  /** Protected routes - standard CRUD, strict origin validation */
  protected: {
    allowedMethods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    allowCredentials: true,
  },
  /** Admin routes - no CORS (same-origin only) */
  admin: {
    allowedMethods: [] as string[],
    allowedHeaders: [] as string[],
    allowCredentials: false,
  },
} as const

export type CorsPolicyType = keyof typeof CORS_POLICIES

// ============================================================================
// CORS Utility Functions
// ============================================================================

/**
 * Determine the CORS policy type based on the request path
 * @param pathname The request pathname
 * @returns The appropriate CORS policy type
 */
export function getCorsPolicy(pathname: string): CorsPolicyType {
  if (pathname.startsWith('/admin')) {
    return 'admin'
  }
  if (pathname.startsWith('/protected')) {
    return 'protected'
  }
  return 'protected'
}

/**
 * Validate if an origin is in the allowed list
 * @param origin The origin header value
 * @returns The validated origin or null if invalid
 */
export function validateOrigin(origin: string | null | undefined): string | null {
  if (!origin) return null
  if ((ALLOWED_ORIGINS as readonly string[]).includes(origin)) {
    return origin
  }
  return null
}

/**
 * Build CORS headers for a response based on policy and origin validation
 * @param origin The request origin
 * @param policy The CORS policy type to apply
 * @param requestedHeaders Optional Access-Control-Request-Headers value
 * @returns Headers object with appropriate CORS headers
 */
export function buildCorsHeaders(
  origin: string | null | undefined,
  policy: CorsPolicyType,
  requestedHeaders?: string | null | undefined
): Headers {
  const headers = new Headers()
  const policyConfig = CORS_POLICIES[policy]

  // Always set Vary: Origin for cache safety
  headers.set('Vary', 'Origin')

  // Admin routes - no CORS headers at all
  if (policy === 'admin') {
    return headers
  }

  // Validate origin against allowlist
  const validatedOrigin = validateOrigin(origin)
  if (!validatedOrigin) {
    return headers
  }

  // Set the validated origin (never wildcard)
  headers.set('Access-Control-Allow-Origin', validatedOrigin)

  // Set allowed methods
  if (policyConfig.allowedMethods.length > 0) {
    headers.set('Access-Control-Allow-Methods', policyConfig.allowedMethods.join(','))
  }

  // Set allowed headers - filter to only policy-approved headers
  if (policyConfig.allowedHeaders.length > 0) {
    if (requestedHeaders) {
      const requested = requestedHeaders.split(',').map((h) => h.trim())
      const allowed = requested.filter((h) =>
        policyConfig.allowedHeaders.some((ah) => ah.toLowerCase() === h.toLowerCase())
      )
      if (allowed.length > 0) {
        headers.set('Access-Control-Allow-Headers', allowed.join(','))
      }
    } else {
      headers.set('Access-Control-Allow-Headers', policyConfig.allowedHeaders.join(','))
    }
  }

  // Set credentials header only if policy allows it
  if (policyConfig.allowCredentials) {
    headers.set('Access-Control-Allow-Credentials', 'true')
  }

  // Set max age for preflight caching
  headers.set('Access-Control-Max-Age', '86400')

  return headers
}
