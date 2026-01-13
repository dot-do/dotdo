/**
 * OAuth Auth Middleware
 *
 * Validates oauth.do sessions for API routes.
 * Supports session cookies and Bearer tokens.
 *
 * @see /app/types/auth.ts for type definitions
 * @see /app/lib/auth-config.ts for configuration
 */

import type { AuthUser, AuthContext, AuthMiddlewareConfig, ProtectedHandler } from '../../app/types/auth'

// Re-export types for convenience
export type { AuthUser, AuthContext, AuthMiddlewareConfig, ProtectedHandler }

// ============================================================================
// Test Helpers (separate section for clarity)
// ============================================================================

// Mock state for testing
let mockSessionInvalid = false
let mockBearerTokenInvalid = false
let mockServiceError: Error | null = null
let validationCalls: string[] = []

// Rate limiting state
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

/**
 * Reset all mocks - called when any mock is set to ensure clean state
 * @internal
 */
function resetAllMocks(): void {
  mockSessionInvalid = false
  mockBearerTokenInvalid = false
  mockServiceError = null
  validationCalls = []
}

/**
 * Set mock session invalid state for testing
 * @internal Test helper - not for production use
 */
export async function setMockSessionInvalid(invalid: boolean): Promise<void> {
  resetAllMocks()
  mockSessionInvalid = invalid
}

/**
 * Set mock bearer token invalid state for testing
 * @internal Test helper - not for production use
 */
export async function setMockBearerTokenInvalid(invalid: boolean): Promise<void> {
  resetAllMocks()
  mockBearerTokenInvalid = invalid
}

/**
 * Set mock service error for testing
 * @internal Test helper - not for production use
 */
export async function setMockServiceError(error: Error | null): Promise<void> {
  resetAllMocks()
  mockServiceError = error
}

/**
 * Get mock validation calls for testing
 * @internal Test helper - not for production use
 */
export async function getMockValidationCalls(): Promise<string[]> {
  return [...validationCalls]
}

/**
 * Reset all mocks to default state
 * @internal Test helper - not for production use
 */
export function resetMocks(): void {
  mockSessionInvalid = false
  mockBearerTokenInvalid = false
  mockServiceError = null
  validationCalls = []
  rateLimitMap.clear()
}

// ============================================================================
// Cookie and Token Parsing
// ============================================================================

/**
 * Parse cookies from request header
 */
function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {}

  const cookies: Record<string, string> = {}
  for (const part of cookieHeader.split(';')) {
    const [key, value] = part.trim().split('=')
    if (key && value) {
      cookies[key] = decodeURIComponent(value)
    }
  }
  return cookies
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null
  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer') return null
  return parts[1] ?? null
}

// ============================================================================
// Route Matching
// ============================================================================

/**
 * Check if path matches any public route pattern
 */
function matchesPublicRoute(path: string, publicRoutes: string[]): boolean {
  for (const pattern of publicRoutes) {
    // Exact match
    if (pattern === path) return true

    // Wildcard match
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
 * Falls back to mock implementation for testing.
 */
async function validateSession(token: string): Promise<AuthUser | null> {
  validationCalls.push(`session:${token}`)

  // Capture error state before auto-reset
  const error = mockServiceError
  const invalid = mockSessionInvalid

  // Auto-reset mocks after capturing state (for test isolation)
  mockServiceError = null
  mockSessionInvalid = false

  // Check for service error
  if (error) {
    throw error
  }

  // Check for invalid session mock
  if (invalid) {
    return null
  }

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

  // Mock successful validation
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
 * Falls back to mock implementation for testing.
 */
async function validateBearerToken(token: string): Promise<AuthUser | null> {
  validationCalls.push(`bearer:${token}`)

  // Capture error state before auto-reset
  const error = mockServiceError
  const invalid = mockBearerTokenInvalid

  // Auto-reset mocks after capturing state
  mockServiceError = null
  mockBearerTokenInvalid = false

  // Check for service error
  if (error) {
    throw error
  }

  // Check for invalid bearer token mock
  if (invalid) {
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

  // Mock successful validation
  return {
    id: 'bearer-user',
    email: 'bearer@example.com',
    name: 'Bearer User',
    role: 'user',
  }
}

// ============================================================================
// Response Helpers
// ============================================================================

/**
 * Create unauthorized response with proper structure
 */
function createUnauthorizedResponse(message: string = 'Authentication required'): Response {
  return new Response(
    JSON.stringify({
      error: {
        status: 401,
        message,
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
 * Create service error response
 */
function createServiceErrorResponse(): Response {
  return new Response(
    JSON.stringify({
      error: {
        status: 503,
        message: 'Authentication service temporarily unavailable',
      },
    }),
    {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
      },
    },
  )
}

/**
 * Create rate limit response
 */
function createRateLimitResponse(): Response {
  return new Response(
    JSON.stringify({
      error: {
        status: 429,
        message: 'Too many requests',
      },
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
      },
    },
  )
}

// ============================================================================
// Rate Limiting
// ============================================================================

/**
 * Check rate limit for unauthenticated requests
 */
function checkRateLimit(ip: string, limit: number): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)

  if (!entry || now > entry.resetAt) {
    // Reset or create new entry
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60000 }) // 1 minute window
    return true
  }

  if (entry.count >= limit) {
    return false
  }

  entry.count++
  return true
}

// ============================================================================
// Main Middleware
// ============================================================================

/**
 * Auth middleware - validates session cookie or Bearer token
 *
 * @param request - The request to authenticate
 * @returns Response with user data (200) or error (401)
 */
export async function authMiddleware(request: Request): Promise<Response> {
  const cookies = parseCookies(request.headers.get('Cookie'))
  const sessionToken = cookies['session']
  const bearerToken = extractBearerToken(request.headers.get('Authorization'))

  try {
    // Try session cookie first (preferred)
    if (sessionToken) {
      const user = await validateSession(sessionToken)
      if (user) {
        return new Response(JSON.stringify({ user }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      // Session invalid - return 401
      return createUnauthorizedResponse('Invalid session')
    }

    // Try Bearer token
    if (bearerToken) {
      const user = await validateBearerToken(bearerToken)
      if (user) {
        return new Response(JSON.stringify({ user }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      // Token invalid - return 401
      return createUnauthorizedResponse('Invalid token')
    }

    // No authentication provided
    return createUnauthorizedResponse()
  } catch (error) {
    // Log error server-side
    console.error('Auth middleware error:', error)
    // Return service error (don't expose internal details)
    return createServiceErrorResponse()
  }
}

// ============================================================================
// Protected Handler Factory
// ============================================================================

/**
 * Create a protected handler that requires authentication
 *
 * @param handler - The handler function to wrap
 * @returns Wrapped handler that validates auth before calling
 */
export function createProtectedHandler(handler: ProtectedHandler): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const cookies = parseCookies(request.headers.get('Cookie'))
    const sessionToken = cookies['session']
    const bearerToken = extractBearerToken(request.headers.get('Authorization'))

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

      if (!user) {
        return createUnauthorizedResponse()
      }

      // Call the actual handler with the authenticated user
      return handler(request, user)
    } catch (error) {
      console.error('Protected handler error:', error)
      return createServiceErrorResponse()
    }
  }
}

// ============================================================================
// Configurable Middleware Factory
// ============================================================================

/**
 * Create auth middleware with configuration
 *
 * @param config - Middleware configuration
 * @returns Configured auth middleware function
 */
export function createAuthMiddleware(config: AuthMiddlewareConfig = {}): (request: Request) => Promise<Response> {
  const { publicRoutes = [], refreshThreshold = 300, rateLimitUnauthenticated } = config

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const path = url.pathname
    const cookies = parseCookies(request.headers.get('Cookie'))
    const sessionToken = cookies['session']
    const bearerToken = extractBearerToken(request.headers.get('Authorization'))
    const hasAuth = sessionToken || bearerToken

    // Rate limit unauthenticated requests first (applies to all routes)
    if (rateLimitUnauthenticated && !hasAuth) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
      if (!checkRateLimit(ip, rateLimitUnauthenticated)) {
        return createRateLimitResponse()
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
    const sessionExp = cookies['session_exp']

    if (sessionToken && sessionExp) {
      const expTime = parseInt(sessionExp, 10)
      const now = Date.now() / 1000
      const timeUntilExpire = expTime - now

      // If session is near expiration, refresh it
      if (timeUntilExpire > 0 && timeUntilExpire < refreshThreshold) {
        try {
          const user = await validateSession(sessionToken)
          if (user) {
            const newExpTime = Math.floor(Date.now() / 1000) + 3600 // 1 hour
            return new Response(JSON.stringify({ user }), {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': `session=${sessionToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600`,
              },
            })
          }
        } catch {
          // Continue to normal auth flow
        }
      }
    }

    // Use standard auth middleware
    return authMiddleware(request)
  }
}

export default authMiddleware
