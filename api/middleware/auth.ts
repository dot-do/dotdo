import type { Context, MiddlewareHandler, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'
import * as jose from 'jose'

/**
 * Authentication Middleware
 *
 * Supports multiple authentication methods:
 * 1. JWT Bearer tokens (Authorization: Bearer <token>)
 * 2. Session cookies (via better-auth)
 * 3. API keys (X-API-Key header)
 *
 * Sets auth context for downstream handlers:
 * - c.get('user') - User info
 * - c.get('session') - Session info
 * - c.get('auth') - Full auth context
 */

// ============================================================================
// Types
// ============================================================================

export interface AuthContext {
  userId: string
  email?: string
  role: 'admin' | 'user'
  permissions?: string[]
  method: 'jwt' | 'session' | 'apikey'
}

export interface User {
  id: string
  email?: string
  name?: string
  role: 'admin' | 'user'
  permissions?: string[]
}

export interface Session {
  id: string
  userId: string
  expiresAt: Date
}

export interface JWTPayload {
  sub: string
  email?: string
  role?: 'admin' | 'user'
  permissions?: string[]
  iat?: number
  exp?: number
}

export interface AuthConfig {
  jwtSecret?: string
  jwksUrl?: string
  apiKeys?: Map<string, ApiKeyConfig>
  publicPaths?: string[]
  cookieName?: string
}

export interface ApiKeyConfig {
  userId: string
  role: 'admin' | 'user'
  permissions?: string[]
  name?: string
}

// ============================================================================
// Default Configuration
// ============================================================================

const defaultConfig: AuthConfig = {
  cookieName: 'session',
  publicPaths: ['/health', '/public'],
}

// In-memory API key store (should use KV in production)
const apiKeys = new Map<string, ApiKeyConfig>([
  ['test-api-key', { userId: 'api-user-1', role: 'user', name: 'Test API Key' }],
  ['admin-api-key', { userId: 'api-admin-1', role: 'admin', name: 'Admin API Key' }],
])

// ============================================================================
// JWT Verification
// ============================================================================

let jwks: jose.JWTVerifyGetKey | null = null

async function verifyJWT(token: string, config: AuthConfig): Promise<JWTPayload> {
  try {
    // Try JWKS first if configured
    if (config.jwksUrl) {
      if (!jwks) {
        jwks = jose.createRemoteJWKSet(new URL(config.jwksUrl))
      }
      const { payload } = await jose.jwtVerify(token, jwks)
      return payload as JWTPayload
    }

    // Fall back to symmetric secret
    if (config.jwtSecret) {
      const secret = new TextEncoder().encode(config.jwtSecret)
      const { payload } = await jose.jwtVerify(token, secret)
      return payload as JWTPayload
    }

    throw new Error('No JWT verification method configured')
  } catch (error) {
    if (error instanceof jose.errors.JWTExpired) {
      throw new HTTPException(401, { message: 'Token expired' })
    }
    if (error instanceof jose.errors.JWTInvalid) {
      throw new HTTPException(401, { message: 'Invalid token' })
    }
    throw new HTTPException(401, { message: 'Token verification failed' })
  }
}

// ============================================================================
// Token Extraction
// ============================================================================

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null
  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null
  return parts[1]
}

function extractApiKey(c: Context): string | null {
  return c.req.header('x-api-key') || null
}

function extractSessionCookie(c: Context, cookieName: string): string | null {
  const cookie = c.req.header('cookie')
  if (!cookie) return null

  const cookies = cookie.split(';').reduce(
    (acc, curr) => {
      const [key, value] = curr.trim().split('=')
      acc[key] = value
      return acc
    },
    {} as Record<string, string>,
  )

  return cookies[cookieName] || null
}

// ============================================================================
// Authentication Methods
// ============================================================================

async function authenticateJWT(token: string, config: AuthConfig): Promise<AuthContext> {
  const payload = await verifyJWT(token, config)

  return {
    userId: payload.sub,
    email: payload.email,
    role: payload.role || 'user',
    permissions: payload.permissions,
    method: 'jwt',
  }
}

async function authenticateApiKey(apiKey: string): Promise<AuthContext> {
  const keyConfig = apiKeys.get(apiKey)
  if (!keyConfig) {
    throw new HTTPException(401, { message: 'Invalid API key' })
  }

  return {
    userId: keyConfig.userId,
    role: keyConfig.role,
    permissions: keyConfig.permissions,
    method: 'apikey',
  }
}

async function authenticateSession(sessionToken: string, _config: AuthConfig): Promise<AuthContext> {
  // In a real implementation, this would validate the session with better-auth
  // For now, we'll just decode and trust the session token
  // This should be replaced with actual better-auth session validation

  // Mock session validation - in production, call better-auth API
  if (sessionToken === 'valid-session') {
    return {
      userId: 'session-user-1',
      role: 'user',
      method: 'session',
    }
  }

  throw new HTTPException(401, { message: 'Invalid session' })
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Main authentication middleware
 * Attempts to authenticate using JWT, API key, or session cookie
 */
export function authMiddleware(config: AuthConfig = {}): MiddlewareHandler {
  const mergedConfig = { ...defaultConfig, ...config }

  return async (c: Context, next: Next) => {
    const path = c.req.path

    // Skip auth for public paths
    if (mergedConfig.publicPaths?.some((p) => path.startsWith(p))) {
      return next()
    }

    let authContext: AuthContext | null = null

    // Try JWT Bearer token first
    const bearerToken = extractBearerToken(c.req.header('authorization'))
    if (bearerToken) {
      try {
        authContext = await authenticateJWT(bearerToken, mergedConfig)
      } catch (error) {
        if (error instanceof HTTPException) throw error
        // Continue to try other methods
      }
    }

    // Try API key
    if (!authContext) {
      const apiKey = extractApiKey(c)
      if (apiKey) {
        authContext = await authenticateApiKey(apiKey)
      }
    }

    // Try session cookie
    if (!authContext && mergedConfig.cookieName) {
      const sessionToken = extractSessionCookie(c, mergedConfig.cookieName)
      if (sessionToken) {
        try {
          authContext = await authenticateSession(sessionToken, mergedConfig)
        } catch {
          // Continue without auth
        }
      }
    }

    // Set context for downstream handlers
    if (authContext) {
      c.set('auth', authContext)
      c.set('user', {
        id: authContext.userId,
        email: authContext.email,
        role: authContext.role,
        permissions: authContext.permissions,
      } as User)
      c.set('session', { userId: authContext.userId } as Session)
    }

    return next()
  }
}

/**
 * Require authentication - returns 401 if not authenticated
 */
export function requireAuth(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth') as AuthContext | undefined
    if (!auth) {
      throw new HTTPException(401, { message: 'Authentication required' })
    }
    return next()
  }
}

/**
 * Require specific role - returns 403 if role doesn't match
 */
export function requireRole(role: 'admin' | 'user'): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth') as AuthContext | undefined
    if (!auth) {
      throw new HTTPException(401, { message: 'Authentication required' })
    }

    // Admin can access everything
    if (auth.role === 'admin') {
      return next()
    }

    // Check if user has required role
    if (auth.role !== role) {
      throw new HTTPException(403, { message: `Role '${role}' required` })
    }

    return next()
  }
}

/**
 * Require specific permission
 */
export function requirePermission(permission: string): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth') as AuthContext | undefined
    if (!auth) {
      throw new HTTPException(401, { message: 'Authentication required' })
    }

    // Admin has all permissions
    if (auth.role === 'admin') {
      return next()
    }

    if (!auth.permissions?.includes(permission)) {
      throw new HTTPException(403, { message: `Permission '${permission}' required` })
    }

    return next()
  }
}

// ============================================================================
// API Key Management (for runtime)
// ============================================================================

export function registerApiKey(key: string, config: ApiKeyConfig): void {
  apiKeys.set(key, config)
}

export function revokeApiKey(key: string): boolean {
  return apiKeys.delete(key)
}

export function validateApiKey(key: string): ApiKeyConfig | undefined {
  return apiKeys.get(key)
}

// ============================================================================
// JWT Token Generation (for testing/development)
// ============================================================================

export async function generateJWT(payload: Omit<JWTPayload, 'iat' | 'exp'>, secret: string, expiresIn: string = '1h'): Promise<string> {
  const secretKey = new TextEncoder().encode(secret)

  const jwt = await new jose.SignJWT(payload as jose.JWTPayload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(expiresIn).sign(secretKey)

  return jwt
}

export default authMiddleware
