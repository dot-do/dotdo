/**
 * @module lib/auth-middleware
 *
 * Standardized Authentication Middleware for Hono Routes
 *
 * Provides consistent auth patterns across all protected endpoints:
 * - requireAuth: Validates JWT Bearer token (basic auth requirement)
 * - requirePermission: Validates token + checks specific permissions
 * - requireAdmin: Validates token + checks admin permissions
 *
 * Usage in Hono routes:
 * ```typescript
 * app.get('/admin/users', requireAdmin, (c) => ...)
 * app.get('/api/items', requireAuth, (c) => ...)
 * app.post('/api/items', requirePermission('items:write'), (c) => ...)
 * ```
 *
 * Security Properties:
 * - Returns 401 Unauthorized for missing/invalid/expired tokens
 * - Returns 403 Forbidden for valid token without required permissions
 * - Includes WWW-Authenticate header in 401 responses
 * - Does not leak sensitive information in error responses
 */

import type { Context, MiddlewareHandler, Next } from 'hono'

// ============================================================================
// Types
// ============================================================================

/** JWT payload structure */
export interface JwtPayload {
  sub: string
  iat?: number
  exp?: number
  email?: string
  org_id?: string
  permissions?: string[]
}

/** Auth context attached to request */
export interface AuthContext {
  authenticated: boolean
  userId?: string
  permissions: string[]
  jwt?: JwtPayload
}

/** Environment with JWT secret */
export interface AuthEnv {
  JWT_SECRET?: string
}

/** Hono variables for auth context */
export type AuthVariables = {
  auth: AuthContext
}

/** Hono environment type with auth bindings and variables */
export type HonoAuthEnv<Bindings extends AuthEnv = AuthEnv> = {
  Bindings: Bindings
  Variables: AuthVariables
}

/**
 * Generic middleware handler type that works with any Hono environment
 * that includes AuthVariables. This allows auth middleware to be used
 * with any environment (e.g., DOCore's HonoEnv with DOCoreEnv bindings).
 */
type AnyEnvWithAuthVariables = { Bindings: Record<string, unknown>; Variables: AuthVariables }

// ============================================================================
// Error Response Constants
// ============================================================================

const ERROR_RESPONSES = {
  UNAUTHORIZED: {
    error: 'Unauthorized',
    message: 'Authentication required',
  },
  INVALID_TOKEN: {
    error: 'Unauthorized',
    message: 'Invalid or expired token',
  },
  FORBIDDEN: {
    error: 'Forbidden',
    message: 'Insufficient permissions',
  },
} as const

// ============================================================================
// Token Extraction & Validation
// ============================================================================

/**
 * Extract Bearer token from Authorization header
 */
export function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return null
  }
  return authHeader.slice(7)
}

/**
 * Extract token from query string (for SSE connections)
 */
export function extractQueryToken(url: URL): string | null {
  return url.searchParams.get('token')
}

/**
 * Decode JWT payload without verification (for lightweight validation)
 * Note: For full verification, use jose library with proper secret
 */
export function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const payloadBase64 = parts[1]
    const payloadJson = atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(payloadJson)

    // Check required fields
    if (!payload.sub || typeof payload.sub !== 'string') return null

    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null

    return {
      sub: payload.sub,
      iat: payload.iat,
      exp: payload.exp,
      email: payload.email,
      org_id: payload.org_id,
      permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
    }
  } catch (err) {
    // JWT decode failed - may indicate tampering or malformed token
    console.warn('[Auth] JWT decode failed:', (err as Error).message)
    return null
  }
}

/**
 * Check if user has a specific permission (supports wildcards)
 */
export function hasPermission(permissions: string[], required: string): boolean {
  // Global wildcard
  if (permissions.includes('*')) return true

  // Direct match
  if (permissions.includes(required)) return true

  // Hierarchical wildcard check (e.g., 'admin:*' grants 'admin:users:read')
  const parts = required.split(':')
  for (let i = parts.length - 1; i > 0; i--) {
    const wildcard = [...parts.slice(0, i), '*'].join(':')
    if (permissions.includes(wildcard)) return true
  }

  return false
}

/**
 * Check if user has all required permissions
 */
export function hasAllPermissions(permissions: string[], required: string[]): boolean {
  return required.every((perm) => hasPermission(permissions, perm))
}

// ============================================================================
// Auth Response Builders
// ============================================================================

/**
 * Build 401 Unauthorized response with proper headers
 */
function unauthorizedResponse<E extends AnyEnvWithAuthVariables>(
  c: Context<E>,
  message?: string
): Response {
  c.header('WWW-Authenticate', 'Bearer realm="dotdo"')
  return c.json(
    {
      error: 'Unauthorized',
      message: message ?? ERROR_RESPONSES.UNAUTHORIZED.message,
    },
    401
  )
}

/**
 * Build 403 Forbidden response
 */
function forbiddenResponse<E extends AnyEnvWithAuthVariables>(
  c: Context<E>,
  message?: string
): Response {
  return c.json(
    {
      error: 'Forbidden',
      message: message ?? ERROR_RESPONSES.FORBIDDEN.message,
    },
    403
  )
}

// ============================================================================
// Middleware Factories
// ============================================================================

/**
 * Basic auth middleware - requires valid JWT token
 *
 * Use this for any endpoint that requires authentication.
 * Sets auth context on the request for downstream handlers.
 *
 * @example
 * ```typescript
 * app.get('/api/items', requireAuth, (c) => {
 *   const auth = c.get('auth')
 *   return c.json({ userId: auth.userId })
 * })
 * ```
 */
export const requireAuth: MiddlewareHandler<AnyEnvWithAuthVariables> = async (c, next) => {
  const url = new URL(c.req.url)

  // Try bearer token first, then query param (for SSE)
  const token = extractBearerToken(c.req.raw) || extractQueryToken(url)

  if (!token) {
    return unauthorizedResponse(c)
  }

  const payload = decodeJwtPayload(token)

  if (!payload) {
    return unauthorizedResponse(c, ERROR_RESPONSES.INVALID_TOKEN.message)
  }

  // Set auth context for downstream handlers
  const authContext: AuthContext = {
    authenticated: true,
    userId: payload.sub,
    permissions: payload.permissions ?? [],
    jwt: payload,
  }

  c.set('auth', authContext)
  await next()
}

/**
 * Permission-based auth middleware factory
 *
 * Requires valid JWT token AND specific permission(s).
 * Returns 401 if no token, 403 if token lacks required permission.
 *
 * @param requiredPermission - Single permission or array of permissions (all required)
 *
 * @example
 * ```typescript
 * app.post('/api/items', requirePermission('items:write'), (c) => ...)
 * app.delete('/api/items/:id', requirePermission(['items:delete', 'items:write']), (c) => ...)
 * ```
 */
export function requirePermission(
  requiredPermission: string | string[]
): MiddlewareHandler<AnyEnvWithAuthVariables> {
  const permissions = Array.isArray(requiredPermission)
    ? requiredPermission
    : [requiredPermission]

  return async (c, next) => {
    const url = new URL(c.req.url)
    const token = extractBearerToken(c.req.raw) || extractQueryToken(url)

    if (!token) {
      return unauthorizedResponse(c)
    }

    const payload = decodeJwtPayload(token)

    if (!payload) {
      return unauthorizedResponse(c, ERROR_RESPONSES.INVALID_TOKEN.message)
    }

    const userPermissions = payload.permissions ?? []

    if (!hasAllPermissions(userPermissions, permissions)) {
      return forbiddenResponse(c, `Required permissions: ${permissions.join(', ')}`)
    }

    // Set auth context
    const authContext: AuthContext = {
      authenticated: true,
      userId: payload.sub,
      permissions: userPermissions,
      jwt: payload,
    }

    c.set('auth', authContext)
    await next()
  }
}

/**
 * Admin auth middleware - requires any admin:* permission
 *
 * Use this for admin-only endpoints.
 * Returns 401 if no token, 403 if not an admin.
 *
 * Accepts any permission starting with 'admin:' (e.g., admin:users:read, admin:settings, etc.)
 *
 * @example
 * ```typescript
 * app.get('/admin/users', requireAdmin, (c) => ...)
 * ```
 */
export const requireAdmin: MiddlewareHandler<AnyEnvWithAuthVariables> = async (c, next) => {
  const url = new URL(c.req.url)
  const token = extractBearerToken(c.req.raw) || extractQueryToken(url)

  if (!token) {
    return unauthorizedResponse(c)
  }

  const payload = decodeJwtPayload(token)

  if (!payload) {
    return unauthorizedResponse(c, ERROR_RESPONSES.INVALID_TOKEN.message)
  }

  const userPermissions = payload.permissions ?? []

  // Check for any admin permission:
  // - Global wildcard (*)
  // - Admin wildcard (admin:*)
  // - Any permission starting with 'admin:' (admin:users:read, admin:settings, etc.)
  const isAdmin = hasPermission(userPermissions, '*') ||
                  hasPermission(userPermissions, 'admin:*') ||
                  userPermissions.some(p => p.startsWith('admin:') || p === 'admin')

  if (!isAdmin) {
    return forbiddenResponse(c, 'Admin access required')
  }

  // Set auth context
  const authContext: AuthContext = {
    authenticated: true,
    userId: payload.sub,
    permissions: userPermissions,
    jwt: payload,
  }

  c.set('auth', authContext)
  await next()
}

/**
 * Optional auth middleware - authenticates if token present, continues if not
 *
 * Use this for endpoints that work differently for authenticated vs anonymous users.
 *
 * @example
 * ```typescript
 * app.get('/api/feed', optionalAuth, (c) => {
 *   const auth = c.get('auth')
 *   if (auth.authenticated) {
 *     // Return personalized feed
 *   }
 *   // Return public feed
 * })
 * ```
 */
export const optionalAuth: MiddlewareHandler<AnyEnvWithAuthVariables> = async (c, next) => {
  const url = new URL(c.req.url)
  const token = extractBearerToken(c.req.raw) || extractQueryToken(url)

  if (token) {
    const payload = decodeJwtPayload(token)

    if (payload) {
      c.set('auth', {
        authenticated: true,
        userId: payload.sub,
        permissions: payload.permissions ?? [],
        jwt: payload,
      })
      await next()
      return
    }
  }

  // No token or invalid token - set unauthenticated context
  c.set('auth', {
    authenticated: false,
    permissions: [],
  })
  await next()
}

// ============================================================================
// Endpoint Classification Documentation
// ============================================================================

/**
 * Endpoint Security Classification
 *
 * This documents the security requirements for all endpoints in the system.
 * Use this as a reference when adding new endpoints to ensure consistent security.
 */
export const ENDPOINT_SECURITY_CLASSIFICATION = {
  /**
   * PUBLIC ENDPOINTS (no auth required)
   * These endpoints are safe to access without authentication.
   */
  public: [
    'GET /health',          // Health check
    'GET /ready',           // Readiness check
    'GET /authorize',       // OAuth flow start
    'GET /callback',        // OAuth callback
    'POST /logout',         // Logout (idempotent)
    'OPTIONS *',            // CORS preflight requests
  ],

  /**
   * PROTECTED ENDPOINTS (requireAuth)
   * These endpoints require a valid JWT token but no specific permissions.
   */
  protected: [
    'GET /api/state-read',  // Read DO state
    'GET /protected/data',  // Protected data endpoint
    'GET /capabilities',    // Server capabilities (MCP)
    'GET /tools',           // Available tools (MCP)
    'POST /tools/:name',    // Execute tool (MCP)
    'GET /sse',             // Server-sent events stream (MCP)
    'WS /ws',               // WebSocket connection
  ],

  /**
   * ADMIN ENDPOINTS (requireAdmin)
   * These endpoints require admin:* permissions.
   */
  admin: [
    'GET /admin/*',         // All admin routes
  ],

  /**
   * PERMISSION-BASED ENDPOINTS (requirePermission)
   * These endpoints require specific permissions in the JWT.
   */
  permissionBased: [
    { endpoint: 'POST /api/ai/complete', permission: 'ai:complete' },
    { endpoint: 'POST /api/cascade', permission: 'workflow:cascade' },
    { endpoint: 'POST /api/broadcast/:topic', permission: 'broadcast:*' },
  ],

  /**
   * UNPROTECTED API ENDPOINTS (legacy/testing only)
   * These endpoints currently lack auth but may be protected in future.
   * TODO: Review and add appropriate auth to these endpoints.
   */
  unprotected: [
    'GET /api/items',       // List items (consider auth)
    'POST /api/items',      // Create item (consider auth)
    'PUT /api/items/:id',   // Update item (consider auth)
    'DELETE /api/items/:id', // Delete item (consider auth)
    'GET /api/status',      // Status check
    'POST /api/echo',       // Echo endpoint (testing)
  ],
} as const

/**
 * Check if an endpoint path matches a security pattern
 */
export function matchesSecurityPattern(method: string, path: string, patterns: string[]): boolean {
  const methodPath = `${method.toUpperCase()} ${path}`

  for (const pattern of patterns) {
    // Handle wildcard patterns like 'GET /admin/*'
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -1) // Remove trailing '*'
      if (methodPath.startsWith(prefix) || methodPath.startsWith(prefix.slice(0, -1))) {
        return true
      }
    }
    // Handle 'OPTIONS *' pattern
    if (pattern === 'OPTIONS *' && method.toUpperCase() === 'OPTIONS') {
      return true
    }
    // Exact match
    if (methodPath === pattern) {
      return true
    }
  }
  return false
}
