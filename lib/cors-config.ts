/**
 * Centralized CORS Configuration Module
 *
 * This module externalizes CORS configuration to allow environment-based
 * customization while maintaining secure defaults.
 *
 * Configuration via environment variables:
 * - ALLOWED_ORIGINS: Comma-separated list of allowed origins
 * - ENVIRONMENT: 'production' | 'staging' | 'development'
 *
 * @example
 * ```toml
 * # wrangler.toml
 * [vars]
 * ALLOWED_ORIGINS = "https://app.example.com,https://api.example.com"
 * ENVIRONMENT = "production"
 * ```
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Environment variables for CORS configuration
 */
export interface CorsEnv {
  /** Comma-separated list of allowed origins */
  ALLOWED_ORIGINS?: string
  /** Environment: production, staging, or development */
  ENVIRONMENT?: 'production' | 'staging' | 'development' | string
}

/**
 * CORS policy configuration for different route types
 */
export interface CorsPolicy {
  /** HTTP methods allowed for this policy */
  allowedMethods: readonly string[]
  /** HTTP headers allowed in requests */
  allowedHeaders: readonly string[]
  /** Whether to include credentials (cookies, auth headers) */
  allowCredentials: boolean
}

/**
 * Full CORS configuration including origins and policies
 */
export interface CorsConfig {
  /** List of allowed origins */
  allowedOrigins: string[]
  /** Max age for preflight cache in seconds */
  maxAge: number
  /** Route-specific policies */
  policies: {
    public: CorsPolicy
    protected: CorsPolicy
    admin: CorsPolicy
  }
}

// ============================================================================
// Default Origins by Environment
// ============================================================================

/**
 * Production allowed origins - strict list of trusted domains
 */
export const PRODUCTION_ORIGINS: readonly string[] = [
  'https://dotdo.dev',
  'https://api.dotdo.dev',
  'https://app.dotdo.dev',
] as const

/**
 * Staging allowed origins - includes preview/staging domains
 */
export const STAGING_ORIGINS: readonly string[] = [
  'https://staging.dotdo.dev',
  'https://preview.dotdo.dev',
  ...PRODUCTION_ORIGINS,
] as const

/**
 * Development allowed origins - includes localhost
 */
export const DEVELOPMENT_ORIGINS: readonly string[] = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8787',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:8787',
] as const

// ============================================================================
// CORS Policies
// ============================================================================

/**
 * Route-specific CORS policies for different security levels
 */
export const CORS_POLICIES = {
  /**
   * Public routes - read-only methods, no credentials
   * Use for: health checks, public API documentation, etc.
   */
  public: {
    allowedMethods: ['GET', 'HEAD', 'OPTIONS'] as const,
    allowedHeaders: ['Content-Type'] as const,
    allowCredentials: false,
  },

  /**
   * Protected routes - standard CRUD operations, strict origin validation
   * Use for: authenticated API endpoints
   */
  protected: {
    allowedMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const,
    allowedHeaders: ['Content-Type', 'Authorization'] as const,
    allowCredentials: true,
  },

  /**
   * Admin routes - no CORS (same-origin only)
   * Use for: admin dashboards, internal tools
   */
  admin: {
    allowedMethods: [] as const,
    allowedHeaders: [] as const,
    allowCredentials: false,
  },
} as const

export type CorsPolicyType = keyof typeof CORS_POLICIES

// ============================================================================
// Configuration Functions
// ============================================================================

/**
 * Parse allowed origins from environment variable
 *
 * @param originsStr - Comma-separated string of origins
 * @returns Array of trimmed origin strings
 *
 * @example
 * parseOriginsFromEnv('https://a.com, https://b.com')
 * // => ['https://a.com', 'https://b.com']
 */
export function parseOriginsFromEnv(originsStr: string | undefined): string[] {
  if (!originsStr) return []

  return originsStr
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
}

/**
 * Validate that an origin string is well-formed
 *
 * @param origin - Origin string to validate
 * @returns true if the origin is valid
 */
export function isValidOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    // Origin must be a URL with protocol and host, no path/query/hash
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.host.length > 0 &&
      (url.pathname === '/' || url.pathname === '') &&
      url.search === '' &&
      url.hash === ''
    )
  } catch {
    return false
  }
}

/**
 * Get the default origins for an environment
 *
 * @param environment - The deployment environment
 * @returns Array of default allowed origins
 */
export function getDefaultOrigins(
  environment: string | undefined
): string[] {
  switch (environment) {
    case 'production':
      return [...PRODUCTION_ORIGINS]
    case 'staging':
      return [...STAGING_ORIGINS]
    case 'development':
    default:
      return [...DEVELOPMENT_ORIGINS]
  }
}

/**
 * Get allowed origins from environment, with sensible defaults
 *
 * Priority:
 * 1. ALLOWED_ORIGINS env var (if set and non-empty)
 * 2. Default origins based on ENVIRONMENT
 *
 * @param env - Environment bindings containing CORS config
 * @returns Array of allowed origin strings
 *
 * @example
 * // With env var
 * getAllowedOrigins({ ALLOWED_ORIGINS: 'https://custom.com' })
 * // => ['https://custom.com']
 *
 * // Without env var, production
 * getAllowedOrigins({ ENVIRONMENT: 'production' })
 * // => ['https://dotdo.dev', 'https://api.dotdo.dev', ...]
 *
 * // Without env var, development (default)
 * getAllowedOrigins({})
 * // => ['http://localhost:3000', 'http://localhost:5173', ...]
 */
export function getAllowedOrigins(env: CorsEnv): string[] {
  // Check for explicit ALLOWED_ORIGINS configuration
  const explicitOrigins = parseOriginsFromEnv(env.ALLOWED_ORIGINS)
  if (explicitOrigins.length > 0) {
    // Validate all origins
    const validOrigins = explicitOrigins.filter(isValidOrigin)
    if (validOrigins.length > 0) {
      return validOrigins
    }
    // If all origins are invalid, fall through to defaults
    console.warn('[CORS] All ALLOWED_ORIGINS are invalid, using defaults')
  }

  // Fall back to environment-based defaults
  return getDefaultOrigins(env.ENVIRONMENT)
}

/**
 * Get the complete CORS configuration from environment
 *
 * @param env - Environment bindings
 * @returns Full CORS configuration object
 */
export function getCorsConfig(env: CorsEnv): CorsConfig {
  return {
    allowedOrigins: getAllowedOrigins(env),
    maxAge: 86400, // 24 hours
    policies: CORS_POLICIES,
  }
}

// ============================================================================
// Origin Validation
// ============================================================================

/**
 * Validate if an origin is in the allowed list
 *
 * @param origin - The Origin header value from the request
 * @param allowedOrigins - List of allowed origins
 * @returns The validated origin if allowed, null otherwise
 */
export function validateOrigin(
  origin: string | null | undefined,
  allowedOrigins: string[]
): string | null {
  if (!origin) return null
  if (allowedOrigins.includes(origin)) {
    return origin
  }
  return null
}

// ============================================================================
// CORS Header Building
// ============================================================================

/**
 * Determine the CORS policy type based on the request path
 *
 * @param pathname - The request pathname
 * @returns The appropriate CORS policy type
 */
export function getCorsPolicy(pathname: string): CorsPolicyType {
  if (pathname.startsWith('/admin')) {
    return 'admin'
  }
  // Default to protected for most routes
  return 'protected'
}

/**
 * Build CORS headers for a response based on policy and origin validation
 *
 * @param origin - The request Origin header
 * @param allowedOrigins - List of allowed origins
 * @param policy - The CORS policy type to apply
 * @param requestedHeaders - Optional Access-Control-Request-Headers value (for preflight)
 * @param maxAge - Max age for preflight cache
 * @returns Headers object with appropriate CORS headers
 */
export function buildCorsHeaders(
  origin: string | null | undefined,
  allowedOrigins: string[],
  policy: CorsPolicyType,
  requestedHeaders?: string | null | undefined,
  maxAge: number = 86400
): Headers {
  const headers = new Headers()
  const policyConfig = CORS_POLICIES[policy]

  // Always set Vary: Origin for cache safety
  headers.set('Vary', 'Origin')

  // Admin routes - no CORS headers at all (same-origin only)
  if (policy === 'admin') {
    return headers
  }

  // Validate origin against allowlist
  const validatedOrigin = validateOrigin(origin, allowedOrigins)
  if (!validatedOrigin) {
    return headers
  }

  // Set the validated origin (never wildcard)
  headers.set('Access-Control-Allow-Origin', validatedOrigin)

  // Set allowed methods
  if (policyConfig.allowedMethods.length > 0) {
    headers.set(
      'Access-Control-Allow-Methods',
      policyConfig.allowedMethods.join(',')
    )
  }

  // Set allowed headers - filter to only policy-approved headers
  if (policyConfig.allowedHeaders.length > 0) {
    if (requestedHeaders) {
      const requested = requestedHeaders.split(',').map((h) => h.trim())
      const allowed = requested.filter((h) =>
        policyConfig.allowedHeaders.some(
          (ah) => ah.toLowerCase() === h.toLowerCase()
        )
      )
      if (allowed.length > 0) {
        headers.set('Access-Control-Allow-Headers', allowed.join(','))
      }
    } else {
      headers.set(
        'Access-Control-Allow-Headers',
        policyConfig.allowedHeaders.join(',')
      )
    }
  }

  // Set credentials header only if policy allows it
  if (policyConfig.allowCredentials) {
    headers.set('Access-Control-Allow-Credentials', 'true')
  }

  // Set max age for preflight caching
  headers.set('Access-Control-Max-Age', maxAge.toString())

  return headers
}

// ============================================================================
// Convenience Exports
// ============================================================================

/**
 * Create a CORS middleware configuration object for use with Hono
 * (if using Hono's built-in cors() middleware instead of custom implementation)
 */
export function createHonoCorsConfig(env: CorsEnv) {
  const allowedOrigins = getAllowedOrigins(env)

  return {
    origin: (origin: string) =>
      allowedOrigins.includes(origin) ? origin : null,
    allowMethods: [...CORS_POLICIES.protected.allowedMethods],
    allowHeaders: [...CORS_POLICIES.protected.allowedHeaders],
    credentials: true,
    maxAge: 86400,
  }
}
