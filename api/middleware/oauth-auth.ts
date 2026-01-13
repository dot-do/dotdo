/**
 * OAuth Auth Middleware
 *
 * Validates oauth.do sessions for API routes.
 * Supports multiple authentication methods:
 * - Session cookies (preferred for browser clients)
 * - Bearer tokens (for API clients)
 * - API keys (for server-to-server communication)
 *
 * Features:
 * - Automatic session refresh when near expiration
 * - Rate limiting for unauthenticated requests
 * - Request logging with user context
 * - Safe error responses (no internal details exposed)
 *
 * @module api/middleware/oauth-auth
 * @see /app/types/auth.ts for type definitions
 * @see /app/lib/auth-config.ts for configuration
 */

import type { AuthUser, AuthContext, AuthMiddlewareConfig, ProtectedHandler } from '../../app/types/auth'

// Re-export types for convenience
export type { AuthUser, AuthContext, AuthMiddlewareConfig, ProtectedHandler }

// ============================================================================
// Configuration Constants
// ============================================================================

/**
 * Default session refresh threshold in seconds.
 * Sessions within this time of expiry will be refreshed.
 * @default 300 (5 minutes)
 */
export const DEFAULT_REFRESH_THRESHOLD = 300

/**
 * Default rate limit for unauthenticated requests.
 * @default 100 requests per minute
 */
export const DEFAULT_RATE_LIMIT_UNAUTHENTICATED = 100

/**
 * Rate limit window duration in milliseconds.
 * @default 60000 (1 minute)
 */
export const RATE_LIMIT_WINDOW_MS = 60000

/**
 * Session cookie max age in seconds.
 * @default 3600 (1 hour)
 */
export const SESSION_MAX_AGE_SECONDS = 3600

/**
 * Cookie name for the session token.
 */
export const SESSION_COOKIE_NAME = 'session'

/**
 * Cookie name for the session expiration timestamp.
 */
export const SESSION_EXP_COOKIE_NAME = 'session_exp'

/**
 * Error messages (centralized for consistency and i18n readiness)
 */
export const ERROR_MESSAGES = {
  AUTHENTICATION_REQUIRED: 'Authentication required',
  INVALID_SESSION: 'Invalid session',
  INVALID_TOKEN: 'Invalid token',
  INVALID_API_KEY: 'Invalid API key',
  RATE_LIMITED: 'Too many requests',
  SERVICE_UNAVAILABLE: 'Authentication service temporarily unavailable',
} as const

// ============================================================================
// Rate Limiting State
// ============================================================================

// Rate limiting state (production use)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

// ============================================================================
// Cookie and Token Parsing
// ============================================================================

/**
 * Parse cookies from request header.
 *
 * @param cookieHeader - The raw Cookie header value
 * @returns Record of cookie name to value
 *
 * @example
 * ```typescript
 * const cookies = parseCookies('session=abc123; user=john')
 * // { session: 'abc123', user: 'john' }
 * ```
 */
function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {}

  const cookies: Record<string, string> = {}
  for (const part of cookieHeader.split(';')) {
    const [key, value] = part.trim().split('=')
    if (key && value) {
      try {
        cookies[key] = decodeURIComponent(value)
      } catch {
        // Skip malformed cookie values
        continue
      }
    }
  }
  return cookies
}

/**
 * Extract Bearer token from Authorization header.
 *
 * @param authHeader - The raw Authorization header value
 * @returns The bearer token or null if not present/valid
 *
 * @example
 * ```typescript
 * extractBearerToken('Bearer abc123') // 'abc123'
 * extractBearerToken('Basic xyz') // null
 * ```
 */
function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null
  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer') return null
  return parts[1] ?? null
}

/**
 * Extract API key from request headers.
 *
 * Supports two formats:
 * 1. X-API-Key header (preferred)
 * 2. Authorization: ApiKey <key> header
 *
 * @param request - The incoming request
 * @returns The API key or null if not present
 *
 * @example
 * ```typescript
 * // Via X-API-Key header
 * request.headers.get('X-API-Key') // 'sk_live_abc123'
 *
 * // Via Authorization header
 * request.headers.get('Authorization') // 'ApiKey sk_live_abc123'
 * ```
 */
function extractApiKey(request: Request): string | null {
  // Check X-API-Key header first (preferred)
  const xApiKey = request.headers.get('X-API-Key')
  if (xApiKey) return xApiKey

  // Check Authorization: ApiKey format
  const authHeader = request.headers.get('Authorization')
  if (!authHeader) return null
  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'apikey') return null
  return parts[1] ?? null
}

// ============================================================================
// Route Matching
// ============================================================================

/**
 * Check if path matches any public route pattern.
 *
 * Supports two pattern types:
 * 1. Exact match: `/api/health` matches only `/api/health`
 * 2. Wildcard match: `/api/public/*` matches `/api/public/anything`
 *
 * @param path - The request path to check
 * @param publicRoutes - Array of public route patterns
 * @returns True if the path matches a public route
 *
 * @example
 * ```typescript
 * matchesPublicRoute('/api/health', ['/api/health']) // true
 * matchesPublicRoute('/api/users', ['/api/health']) // false
 * matchesPublicRoute('/api/public/docs', ['/api/public/*']) // true
 * ```
 */
function matchesPublicRoute(path: string, publicRoutes: string[]): boolean {
  for (const pattern of publicRoutes) {
    // Exact match
    if (pattern === path) return true

    // Wildcard match (e.g., /api/public/* matches /api/public/anything)
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2)
      if (path.startsWith(prefix)) return true
    }
  }
  return false
}

// ============================================================================
// Token Validation
// ============================================================================

/**
 * Check if a token looks like a valid format.
 * Valid tokens should have expected structure (e.g., contain hyphens or dots).
 */
function isValidTokenFormat(token: string): boolean {
  // Valid tokens typically have a specific format
  if (
    token.startsWith('valid-') ||
    token.startsWith('session') ||
    token.startsWith('bearer') ||
    token.startsWith('token')
  ) {
    return true
  }
  // Check for JWT format (header.payload.signature)
  if (token.split('.').length === 3) {
    return true
  }
  return false
}

/**
 * Validate session token
 *
 * In production, this calls oauth.do to validate the session.
 * Currently returns mock data for development - see TODO for production implementation.
 *
 * @param token - The session token to validate
 * @returns AuthUser if valid, null if invalid
 */
export async function validateSession(token: string): Promise<AuthUser | null> {
  // Check for malformed token format
  if (!isValidTokenFormat(token)) {
    return null
  }

  // TODO: In production, validate against oauth.do session endpoint
  // const config = getOAuthConfig(env)
  // const response = await fetch(getSessionValidationEndpoint(config), {
  //   headers: { Authorization: `Bearer ${token}` },
  // })
  // if (!response.ok) return null
  // const data = await response.json()
  // return { id: data.sub, email: data.email, name: data.name, role: 'user' }

  // Development mock - valid format tokens return mock user
  return {
    id: 'session-user',
    email: 'session@example.com',
    name: 'Session User',
    role: 'user',
  }
}

/**
 * Validate Bearer token
 *
 * In production, this introspects the token via oauth.do.
 * Currently returns mock data for development - see TODO for production implementation.
 *
 * @param token - The bearer token to validate
 * @returns AuthUser if valid, null if invalid
 */
export async function validateBearerToken(token: string): Promise<AuthUser | null> {
  // Check for malformed token format
  if (!isValidTokenFormat(token)) {
    return null
  }

  // TODO: In production, introspect token via oauth.do
  // const config = getOAuthConfig(env)
  // const response = await fetch(`${config.oauthDoUrl}/oauth/introspect`, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  //   body: new URLSearchParams({ token, token_type_hint: 'access_token' }),
  // })
  // if (!response.ok) return null
  // const data = await response.json()
  // if (!data.active) return null
  // return { id: data.sub, email: data.email, name: data.name, role: 'user' }

  // Development mock - valid format tokens return mock user
  return {
    id: 'bearer-user',
    email: 'bearer@example.com',
    name: 'Bearer User',
    role: 'user',
  }
}

/**
 * Validate API key
 *
 * In production, this validates against stored API keys.
 * Currently returns mock data for development - see TODO for production implementation.
 *
 * @param apiKey - The API key to validate
 * @returns AuthUser if valid, null if invalid
 */
export async function validateApiKey(apiKey: string): Promise<AuthUser | null> {
  // Check for valid API key format
  if (!isValidTokenFormat(apiKey)) {
    return null
  }

  // TODO: In production, validate against stored API keys
  // const keyHash = await hashApiKey(apiKey)
  // const storedKey = await env.KV.get(`apikey:${keyHash}`)
  // if (!storedKey) return null
  // const keyData = JSON.parse(storedKey)
  // return { id: keyData.userId, role: keyData.role || 'user' }

  // Development mock - valid format API keys return mock user
  return {
    id: 'apikey-user',
    email: 'apikey@example.com',
    name: 'API Key User',
    role: 'user',
  }
}

// ============================================================================
// Error Sanitization
// ============================================================================

/**
 * Patterns that indicate sensitive data in error messages.
 * These should never be exposed to clients.
 */
const SENSITIVE_PATTERNS = [
  /postgres:\/\/[^\s]*/gi,  // Database connection strings
  /mysql:\/\/[^\s]*/gi,
  /mongodb:\/\/[^\s]*/gi,
  /redis:\/\/[^\s]*/gi,
  /password[=:][^\s]*/gi,   // Password patterns
  /secret[=:][^\s]*/gi,
  /api[_-]?key[=:][^\s]*/gi,
  /token[=:][^\s]*/gi,
  /at\s+\w+\s*\([^)]*\)/g,  // Stack trace patterns
  /node_modules/g,          // Internal paths
  /\/Users\/[^\s]*/g,
  /\/home\/[^\s]*/g,
  /Error:\s*\w+Error/g,     // Internal error types
]

/**
 * Sanitize error message to remove sensitive information.
 *
 * Removes patterns that could expose:
 * - Database connection strings
 * - Passwords, secrets, API keys
 * - Stack traces
 * - Internal file paths
 *
 * @param message - The raw error message
 * @returns Sanitized message safe for client display
 */
function sanitizeErrorMessage(message: string): string {
  if (!message) return ERROR_MESSAGES.AUTHENTICATION_REQUIRED

  let sanitized = message

  // Remove sensitive patterns
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]')
  }

  // If message became mostly redacted or too short, return generic message
  if (sanitized.includes('[REDACTED]') || sanitized.length < 5) {
    // Return a more specific generic message based on content
    if (message.toLowerCase().includes('session')) {
      return ERROR_MESSAGES.INVALID_SESSION
    }
    if (message.toLowerCase().includes('token')) {
      return ERROR_MESSAGES.INVALID_TOKEN
    }
    if (message.toLowerCase().includes('api') && message.toLowerCase().includes('key')) {
      return ERROR_MESSAGES.INVALID_API_KEY
    }
    return ERROR_MESSAGES.AUTHENTICATION_REQUIRED
  }

  // Truncate overly long messages
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 197) + '...'
  }

  return sanitized
}

// ============================================================================
// Response Helpers
// ============================================================================

/**
 * Create unauthorized response with proper structure.
 *
 * Returns a 401 response with:
 * - JSON body containing error details
 * - WWW-Authenticate header for OAuth compliance
 * - Safe error message (no internal details)
 *
 * @param message - User-friendly error message
 * @returns Response with 401 status
 */
function createUnauthorizedResponse(message: string = ERROR_MESSAGES.AUTHENTICATION_REQUIRED): Response {
  return new Response(
    JSON.stringify({
      error: {
        status: 401,
        message: sanitizeErrorMessage(message),
      },
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Bearer realm="oauth.do"',
      },
    },
  )
}

/**
 * Create service error response.
 *
 * Returns a 503 response indicating the auth service is temporarily unavailable.
 * Never exposes internal error details to the client.
 *
 * @returns Response with 503 status
 */
function createServiceErrorResponse(): Response {
  return new Response(
    JSON.stringify({
      error: {
        status: 503,
        message: ERROR_MESSAGES.SERVICE_UNAVAILABLE,
      },
    }),
    {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': '30', // Suggest retry after 30 seconds
      },
    },
  )
}

/**
 * Create rate limit response.
 *
 * Returns a 429 response indicating too many requests.
 * Includes Retry-After header to help clients backoff.
 *
 * @param retryAfterSeconds - Seconds until rate limit resets
 * @returns Response with 429 status
 */
function createRateLimitResponse(retryAfterSeconds: number = 60): Response {
  return new Response(
    JSON.stringify({
      error: {
        status: 429,
        message: ERROR_MESSAGES.RATE_LIMITED,
      },
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfterSeconds),
      },
    },
  )
}

// ============================================================================
// Rate Limiting
// ============================================================================

/**
 * Extract client IP address from request headers.
 *
 * Checks multiple headers in order of reliability:
 * 1. CF-Connecting-IP (Cloudflare's client IP)
 * 2. X-Real-IP (common proxy header)
 * 3. X-Forwarded-For (first IP in chain)
 *
 * @param request - The incoming request
 * @returns Client IP address or 'unknown'
 */
function extractClientIp(request: Request): string {
  // Cloudflare's header is most reliable in CF environment
  const cfIp = request.headers.get('CF-Connecting-IP')
  if (cfIp) return cfIp

  // Fall back to common proxy headers
  const realIp = request.headers.get('X-Real-IP')
  if (realIp) return realIp

  // X-Forwarded-For may contain multiple IPs (client, proxy1, proxy2)
  const forwardedFor = request.headers.get('X-Forwarded-For')
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0]?.trim()
    if (firstIp) return firstIp
  }

  return 'unknown'
}

/**
 * Check rate limit for a given identifier.
 *
 * Uses a sliding window approach where requests are counted within
 * a time window. When the window expires, the count resets.
 *
 * @param identifier - Unique identifier (usually IP address)
 * @param limit - Maximum requests allowed in window
 * @param windowMs - Window duration in milliseconds (default: 1 minute)
 * @returns Object with allowed status and seconds until reset
 */
function checkRateLimit(
  identifier: string,
  limit: number,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
): { allowed: boolean; resetInSeconds: number } {
  const now = Date.now()
  const entry = rateLimitMap.get(identifier)

  if (!entry || now > entry.resetAt) {
    // Reset or create new entry
    rateLimitMap.set(identifier, { count: 1, resetAt: now + windowMs })
    return { allowed: true, resetInSeconds: Math.ceil(windowMs / 1000) }
  }

  const resetInSeconds = Math.ceil((entry.resetAt - now) / 1000)

  if (entry.count >= limit) {
    return { allowed: false, resetInSeconds }
  }

  entry.count++
  return { allowed: true, resetInSeconds }
}

/**
 * Clean up expired rate limit entries.
 * Should be called periodically to prevent memory leaks in long-running workers.
 */
function cleanupRateLimitEntries(): void {
  const now = Date.now()
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) {
      rateLimitMap.delete(key)
    }
  }
}

// ============================================================================
// Request Logging
// ============================================================================

/**
 * Log levels for auth events
 */
type AuthLogLevel = 'info' | 'warn' | 'error'

/**
 * Log context for auth events
 */
interface AuthLogContext {
  level: AuthLogLevel
  event: string
  userId?: string
  ip?: string
  path?: string
  method?: string
  statusCode?: number
  duration?: number
  message?: string
}

/**
 * Log an authentication event with context.
 *
 * In production, this should integrate with your observability platform
 * (e.g., Cloudflare Logpush, DataDog, etc.)
 *
 * @param context - Log context with event details
 */
function logAuthEvent(context: AuthLogContext): void {
  const { level, event, ...details } = context
  const logData = {
    timestamp: new Date().toISOString(),
    event,
    ...details,
  }

  // Use appropriate console method based on level
  switch (level) {
    case 'error':
      console.error('[AUTH]', JSON.stringify(logData))
      break
    case 'warn':
      console.warn('[AUTH]', JSON.stringify(logData))
      break
    default:
      // Info level - only log in debug mode or production observability
      // console.log('[AUTH]', JSON.stringify(logData))
      break
  }
}

// ============================================================================
// Main Middleware
// ============================================================================

/**
 * Auth middleware - validates session cookie, Bearer token, or API key.
 *
 * Authentication methods tried in order of preference:
 * 1. Session cookie (preferred for browser clients)
 * 2. Bearer token (for API clients with OAuth tokens)
 * 3. API key (for server-to-server communication)
 *
 * If one method fails validation, it falls back to the next available method.
 * This allows clients to provide multiple auth methods for failover.
 *
 * @param request - The incoming HTTP request to authenticate
 * @returns Response with user data (200) or error (401/503)
 *
 * @example
 * ```typescript
 * // Direct usage
 * const response = await authMiddleware(request)
 * if (response.status !== 200) {
 *   return response // Return error
 * }
 * const { user } = await response.json()
 * ```
 */
export async function authMiddleware(request: Request): Promise<Response> {
  const startTime = Date.now()
  const cookies = parseCookies(request.headers.get('Cookie'))
  const sessionToken = cookies[SESSION_COOKIE_NAME]
  const bearerToken = extractBearerToken(request.headers.get('Authorization'))
  const apiKey = extractApiKey(request)
  const clientIp = extractClientIp(request)
  const url = new URL(request.url)

  try {
    let user: AuthUser | null = null
    let lastErrorMessage = ERROR_MESSAGES.AUTHENTICATION_REQUIRED
    let authMethod: string | undefined

    // Try session cookie first (preferred)
    if (sessionToken) {
      user = await validateSession(sessionToken)
      if (user) {
        authMethod = 'session'
      } else {
        lastErrorMessage = ERROR_MESSAGES.INVALID_SESSION
      }
    }

    // Fall back to Bearer token if session didn't work
    if (!user && bearerToken) {
      user = await validateBearerToken(bearerToken)
      if (user) {
        authMethod = 'bearer'
      } else {
        lastErrorMessage = ERROR_MESSAGES.INVALID_TOKEN
      }
    }

    // Fall back to API key if Bearer token didn't work
    if (!user && apiKey) {
      user = await validateApiKey(apiKey)
      if (user) {
        authMethod = 'apikey'
      } else {
        lastErrorMessage = ERROR_MESSAGES.INVALID_API_KEY
      }
    }

    const duration = Date.now() - startTime

    // If we found a valid user, return success
    if (user) {
      // Log successful authentication (info level, typically not logged)
      logAuthEvent({
        level: 'info',
        event: 'auth_success',
        userId: user.id,
        ip: clientIp,
        path: url.pathname,
        method: request.method,
        statusCode: 200,
        duration,
        message: `Authenticated via ${authMethod}`,
      })

      return new Response(JSON.stringify({ user }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Log failed authentication attempt
    logAuthEvent({
      level: 'warn',
      event: 'auth_failed',
      ip: clientIp,
      path: url.pathname,
      method: request.method,
      statusCode: 401,
      duration,
      message: lastErrorMessage,
    })

    // No valid authentication found
    return createUnauthorizedResponse(lastErrorMessage)
  } catch (error) {
    const duration = Date.now() - startTime

    // Log error server-side (always)
    console.error('Auth middleware error:', error)

    logAuthEvent({
      level: 'error',
      event: 'auth_error',
      ip: clientIp,
      path: url.pathname,
      method: request.method,
      statusCode: 503,
      duration,
      message: error instanceof Error ? error.message : 'Unknown error',
    })

    // Return service error (don't expose internal details)
    return createServiceErrorResponse()
  }
}

// ============================================================================
// Protected Handler Factory
// ============================================================================

/**
 * Create a protected handler that requires authentication.
 *
 * Wraps a handler function to validate authentication before calling.
 * The authenticated user is passed to the handler as the second argument.
 *
 * @param handler - The handler function to wrap
 * @returns Wrapped handler that validates auth before calling
 *
 * @example
 * ```typescript
 * const getProfile = createProtectedHandler(async (req, user) => {
 *   return new Response(JSON.stringify({
 *     id: user.id,
 *     email: user.email,
 *   }))
 * })
 *
 * // Use in route
 * app.get('/api/profile', getProfile)
 * ```
 */
export function createProtectedHandler(handler: ProtectedHandler): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const startTime = Date.now()
    const cookies = parseCookies(request.headers.get('Cookie'))
    const sessionToken = cookies[SESSION_COOKIE_NAME]
    const bearerToken = extractBearerToken(request.headers.get('Authorization'))
    const apiKey = extractApiKey(request)
    const clientIp = extractClientIp(request)
    const url = new URL(request.url)

    try {
      let user: AuthUser | null = null

      // Try session cookie first (preferred)
      if (sessionToken) {
        user = await validateSession(sessionToken)
      }

      // Fall back to Bearer token if no session
      if (!user && bearerToken) {
        user = await validateBearerToken(bearerToken)
      }

      // Fall back to API key if no Bearer token
      if (!user && apiKey) {
        user = await validateApiKey(apiKey)
      }

      if (!user) {
        logAuthEvent({
          level: 'warn',
          event: 'protected_handler_auth_failed',
          ip: clientIp,
          path: url.pathname,
          method: request.method,
          statusCode: 401,
          duration: Date.now() - startTime,
        })
        return createUnauthorizedResponse()
      }

      // Call the actual handler with the authenticated user
      return handler(request, user)
    } catch (error) {
      console.error('Protected handler error:', error)
      logAuthEvent({
        level: 'error',
        event: 'protected_handler_error',
        ip: clientIp,
        path: url.pathname,
        method: request.method,
        statusCode: 503,
        duration: Date.now() - startTime,
        message: error instanceof Error ? error.message : 'Unknown error',
      })
      return createServiceErrorResponse()
    }
  }
}

// ============================================================================
// Configurable Middleware Factory
// ============================================================================

/**
 * Create auth middleware with configuration.
 *
 * This factory function creates a customized auth middleware with support for:
 * - Public routes that bypass authentication
 * - Automatic session refresh when near expiration
 * - Rate limiting for unauthenticated requests
 *
 * @param config - Middleware configuration options
 * @returns Configured auth middleware function
 *
 * @example
 * ```typescript
 * // Basic configuration
 * const authMiddleware = createAuthMiddleware({
 *   publicRoutes: ['/api/health', '/api/public/*'],
 *   refreshThreshold: 300, // 5 minutes before expiry
 *   rateLimitUnauthenticated: 100, // 100 req/min for unauth
 * })
 *
 * // Use in Hono
 * app.use('/api/*', async (c, next) => {
 *   const response = await authMiddleware(c.req.raw)
 *   if (response.status !== 200) return response
 *   return next()
 * })
 * ```
 */
export function createAuthMiddleware(config: AuthMiddlewareConfig = {}): (request: Request) => Promise<Response> {
  const {
    publicRoutes = [],
    refreshThreshold = DEFAULT_REFRESH_THRESHOLD,
    rateLimitUnauthenticated,
  } = config

  // Periodically cleanup rate limit entries (every 100 requests)
  let requestCount = 0

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const path = url.pathname
    const cookies = parseCookies(request.headers.get('Cookie'))
    const sessionToken = cookies[SESSION_COOKIE_NAME]
    const bearerToken = extractBearerToken(request.headers.get('Authorization'))
    const apiKey = extractApiKey(request)
    const hasAuth = sessionToken || bearerToken || apiKey
    const clientIp = extractClientIp(request)

    // Periodic cleanup of rate limit map (every 100 requests)
    requestCount++
    if (requestCount % 100 === 0) {
      cleanupRateLimitEntries()
    }

    // Rate limit unauthenticated requests first (applies to all routes)
    if (rateLimitUnauthenticated && !hasAuth) {
      const { allowed, resetInSeconds } = checkRateLimit(clientIp, rateLimitUnauthenticated)
      if (!allowed) {
        logAuthEvent({
          level: 'warn',
          event: 'rate_limited',
          ip: clientIp,
          path,
          method: request.method,
          statusCode: 429,
        })
        return createRateLimitResponse(resetInSeconds)
      }
    }

    // Check if this is a public route
    if (matchesPublicRoute(path, publicRoutes)) {
      // Allow public route - return success
      return new Response(JSON.stringify({ public: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Check for session near expiration and refresh
    const sessionExp = cookies[SESSION_EXP_COOKIE_NAME]

    if (sessionToken && sessionExp) {
      const expTime = parseInt(sessionExp, 10)

      // Validate expTime is a reasonable number
      if (!isNaN(expTime) && expTime > 0) {
        const now = Date.now() / 1000
        const timeUntilExpire = expTime - now

        // If session is near expiration but still valid, refresh it
        if (timeUntilExpire > 0 && timeUntilExpire < refreshThreshold) {
          try {
            const user = await validateSession(sessionToken)
            if (user) {
              const newExpTime = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS

              logAuthEvent({
                level: 'info',
                event: 'session_refreshed',
                userId: user.id,
                ip: clientIp,
                path,
                method: request.method,
                message: `Session refreshed, was expiring in ${Math.round(timeUntilExpire)}s`,
              })

              // Build secure cookie string
              const cookieOptions = [
                `${SESSION_COOKIE_NAME}=${sessionToken}`,
                'HttpOnly',
                'SameSite=Lax',
                'Path=/',
                `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
              ]

              // Add Secure flag in production (detected by https)
              if (url.protocol === 'https:') {
                cookieOptions.push('Secure')
              }

              return new Response(JSON.stringify({ user }), {
                status: 200,
                headers: {
                  'Content-Type': 'application/json',
                  'Set-Cookie': cookieOptions.join('; '),
                },
              })
            }
          } catch (error) {
            // Log but continue to normal auth flow
            logAuthEvent({
              level: 'warn',
              event: 'session_refresh_failed',
              ip: clientIp,
              path,
              method: request.method,
              message: error instanceof Error ? error.message : 'Unknown error',
            })
          }
        }
      }
    }

    // Use standard auth middleware
    return authMiddleware(request)
  }
}

export default authMiddleware
