// Auth middleware for Hono
import type { MiddlewareHandler, Context } from 'hono'
import { HTTPException } from 'hono/http-exception'

export interface AuthOptions {
  issuer?: string
  audience?: string
  secret?: string
  publicKey?: string
  skipPaths?: string[]
}

export interface AuthUser {
  id: string
  email?: string
  roles?: string[]
  scopes?: string[]
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser
    token: string
  }
}

export function authMiddleware(options: AuthOptions = {}): MiddlewareHandler {
  const { skipPaths = [] } = options

  return async (c, next) => {
    // Skip auth for specified paths
    if (skipPaths.some(path => c.req.path.startsWith(path))) {
      return next()
    }

    // Get token from header
    const authHeader = c.req.header('Authorization')
    if (!authHeader) {
      throw new HTTPException(401, { message: 'Authorization header required' })
    }

    const [scheme, token] = authHeader.split(' ')
    if (scheme !== 'Bearer' || !token) {
      throw new HTTPException(401, { message: 'Bearer token required' })
    }

    // For now, simple token validation (JWT validation in do-7rf.3.2)
    // This is a placeholder - real implementation would verify JWT
    try {
      // Decode token (base64 JSON for testing, JWT in production)
      const payload = decodeToken(token)

      const user: AuthUser = {
        id: String(payload.sub ?? payload.id ?? ''),
        email: payload.email as string | undefined,
        roles: (payload.roles as string[] | undefined) ?? [],
        scopes: (payload.scopes as string[] | undefined) ?? []
      }

      c.set('user', user)
      c.set('token', token)

      return next()
    } catch (error) {
      throw new HTTPException(401, { message: 'Invalid token' })
    }
  }
}

export function apiKeyMiddleware(options: { header?: string } = {}): MiddlewareHandler {
  const { header = 'X-API-Key' } = options

  return async (c, next) => {
    const apiKey = c.req.header(header)
    if (!apiKey) {
      throw new HTTPException(401, { message: `${header} header required` })
    }

    // For now, just pass the key - validation happens elsewhere
    // Real implementation would validate against stored keys
    c.set('token', apiKey)

    // Create minimal user from API key
    c.set('user', {
      id: `apikey:${apiKey.slice(0, 8)}`,
      roles: ['api'],
      scopes: ['api:*']
    })

    return next()
  }
}

// Simple token decoder (for testing - real impl uses jose)
function decodeToken(token: string): Record<string, unknown> {
  try {
    // Try base64 JSON first (for testing)
    const decoded = atob(token)
    return JSON.parse(decoded)
  } catch {
    // If not base64 JSON, assume it's a simple token
    // Real implementation would validate JWT here
    return { sub: token.slice(0, 16) }
  }
}
