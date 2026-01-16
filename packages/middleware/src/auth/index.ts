/**
 * Auth middleware
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

import type { Context, MiddlewareHandler, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'
import * as jose from 'jose'
import { registerApiKey as apiKeyRegister, getApiKeyLoader, type ApiKeyConfig } from './api-key'
import type { SessionValidator } from './session'

// Re-export from submodules
export { jwtMiddleware, generateJWT, verifyJWT, resetJWKSCache } from './jwt'
export type { JWTPayload, JWTConfig } from './jwt'
export { apiKeyMiddleware, loadApiKeysFromEnv, revokeApiKey, validateApiKey, clearApiKeys } from './api-key'
export type { ApiKeyMiddlewareConfig } from './api-key'
export { sessionMiddleware, clearSessionMemoryCache, MemoryCache } from './session'
export type { SessionConfig, SessionValidator } from './session'

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

export interface JWTPayloadInternal {
  sub: string
  email?: string
  role?: 'admin' | 'user'
  permissions?: string[]
  iat?: number
  exp?: number
}

// SessionValidator is re-exported from './session' above

export interface AuthConfig {
  jwtSecret?: string
  jwksUrl?: string
  apiKeys?: Map<string, ApiKeyConfig>
  publicPaths?: string[]
  cookieName?: string
  validateSession?: SessionValidator
  sessionCache?: KVNamespace
  sessionCacheTtl?: number
  enableMemoryCache?: boolean
  memoryCacheMaxSize?: number
}

// Re-export ApiKeyConfig from api-key
export type { ApiKeyConfig } from './api-key'

// ============================================================================
// Default Configuration
// ============================================================================

const defaultConfig: AuthConfig = {
  cookieName: 'session',
  publicPaths: ['/health', '/public'],
}

// ============================================================================
// JWKS Cache
// ============================================================================

let jwks: jose.JWTVerifyGetKey | null = null

// ============================================================================
// Token Extraction
// ============================================================================

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null
  const trimmed = authHeader.trim()
  if (!trimmed) return null

  const parts = trimmed.split(/\s+/)
  if (parts.length !== 2 || parts[0]!.toLowerCase() !== 'bearer') return null
  const token = parts[1]
  if (!token || token.trim() === '') return null
  return token
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
      if (key) acc[key] = value ?? ''
      return acc
    },
    {} as Record<string, string>,
  )

  return cookies[cookieName] || null
}

// ============================================================================
// JWT Verification
// ============================================================================

async function verifyJWTInternal(token: string, config: AuthConfig): Promise<JWTPayloadInternal> {
  try {
    // Try JWKS first if configured
    if (config.jwksUrl) {
      if (!jwks) {
        jwks = jose.createRemoteJWKSet(new URL(config.jwksUrl))
      }
      const { payload } = await jose.jwtVerify(token, jwks, {
        algorithms: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'],
      })
      return payload as JWTPayloadInternal
    }

    // Fall back to symmetric secret
    if (config.jwtSecret) {
      const secret = new TextEncoder().encode(config.jwtSecret)
      const { payload } = await jose.jwtVerify(token, secret, {
        algorithms: ['HS256', 'HS384', 'HS512'],
      })
      return payload as JWTPayloadInternal
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
// Authentication Methods
// ============================================================================

async function authenticateJWT(token: string, config: AuthConfig): Promise<AuthContext> {
  const payload = await verifyJWTInternal(token, config)

  if (!payload.sub) {
    throw new HTTPException(401, { message: 'Invalid token: missing required claims' })
  }

  return {
    userId: payload.sub,
    email: payload.email,
    role: payload.role || 'user',
    permissions: payload.permissions,
    method: 'jwt',
  }
}

const MIN_API_KEY_LENGTH = 10

async function authenticateApiKey(
  apiKey: string,
  loader: (key: string) => Promise<ApiKeyConfig | undefined>,
): Promise<AuthContext> {
  if (!apiKey || apiKey.length < MIN_API_KEY_LENGTH) {
    throw new HTTPException(401, { message: 'Invalid API key format' })
  }

  const keyConfig = await loader(apiKey)
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

interface CachedSession {
  userId: string
  email?: string
  role: 'admin' | 'user'
  expiresAt?: string
}

async function authenticateSession(sessionToken: string, config: AuthConfig): Promise<AuthContext> {
  if (!config.validateSession) {
    throw new HTTPException(401, { message: 'Session validation not configured' })
  }

  const session = await config.validateSession(sessionToken)

  if (!session) {
    throw new HTTPException(401, { message: 'Invalid session' })
  }

  if (session.expiresAt && session.expiresAt <= new Date()) {
    throw new HTTPException(401, { message: 'Session expired' })
  }

  return {
    userId: session.userId,
    email: session.email,
    role: session.role || 'user',
    method: 'session',
  }
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Main authentication middleware.
 * Attempts to authenticate using JWT, API key, or session cookie.
 */
export function authMiddleware(config: AuthConfig = {}): MiddlewareHandler {
  const mergedConfig = { ...defaultConfig, ...config }

  return async (c: Context, next: Next) => {
    const path = c.req.path

    // Skip auth for public paths
    if (mergedConfig.publicPaths?.some((p) => path.startsWith(p))) {
      return next()
    }

    // Get environment bindings for API key loading
    const env = c.env as Record<string, unknown> | undefined
    const apiKeyLoader = getApiKeyLoader(mergedConfig.apiKeys, env)

    let authContext: AuthContext | null = null
    let jwtError: HTTPException | null = null

    // Try JWT Bearer token first
    const bearerToken = extractBearerToken(c.req.header('authorization'))
    if (bearerToken) {
      try {
        authContext = await authenticateJWT(bearerToken, mergedConfig)
      } catch (error) {
        if (error instanceof HTTPException) {
          jwtError = error
        }
      }
    }

    // Try API key
    if (!authContext) {
      const apiKey = extractApiKey(c)
      if (apiKey) {
        try {
          authContext = await authenticateApiKey(apiKey, apiKeyLoader)
          jwtError = null
        } catch (apiKeyError) {
          if (jwtError) throw jwtError
          throw apiKeyError
        }
      } else if (jwtError) {
        throw jwtError
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
      c.header('WWW-Authenticate', 'Bearer realm="dotdo", charset="UTF-8"')
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
      c.header('WWW-Authenticate', 'Bearer realm="dotdo", charset="UTF-8"')
      throw new HTTPException(401, { message: 'Authentication required' })
    }

    // Admin can access everything
    if (auth.role === 'admin') {
      return next()
    }

    if (auth.role !== role) {
      throw new HTTPException(403, { message: `Insufficient permission: role '${role}' required` })
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
      c.header('WWW-Authenticate', 'Bearer realm="dotdo", charset="UTF-8"')
      throw new HTTPException(401, { message: 'Authentication required' })
    }

    // Admin has all permissions
    if (auth.role === 'admin') {
      return next()
    }

    if (!auth.permissions?.includes(permission)) {
      throw new HTTPException(403, { message: `Insufficient permission: '${permission}' required` })
    }

    return next()
  }
}

// ============================================================================
// API Key Management (delegated to api-key module)
// ============================================================================

/**
 * Register an API key at runtime.
 */
export function registerApiKey(key: string, config: ApiKeyConfig): void {
  apiKeyRegister(key, config)
}

export default authMiddleware
