// Auth middleware for Hono
import type { MiddlewareHandler, Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { jwtVerify, type JWTPayload } from 'jose'

export interface AuthOptions {
  issuer?: string
  audience?: string
  secret?: string | Uint8Array
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
  const { skipPaths = [], secret, issuer, audience } = options

  // Require secret for JWT validation
  if (!secret) {
    throw new Error('authMiddleware requires a secret for JWT validation')
  }

  // Convert string secret to Uint8Array if needed
  const secretKey = typeof secret === 'string' ? new TextEncoder().encode(secret) : secret

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

    try {
      // Build verify options, only including defined values
      const verifyOptions: { issuer?: string; audience?: string } = {}
      if (issuer) verifyOptions.issuer = issuer
      if (audience) verifyOptions.audience = audience

      // Verify JWT signature and claims - FAIL CLOSED
      const { payload } = await jwtVerify(token, secretKey, verifyOptions)

      // Strict claim validation - subject is required
      if (!payload.sub) {
        throw new HTTPException(401, { message: 'Token missing subject claim' })
      }

      // Extract claims safely using index signature access
      const email = payload['email'] as string | undefined
      const roles = payload['roles']
      const scopes = payload['scopes']

      const user: AuthUser = {
        id: payload.sub,
        email,
        roles: Array.isArray(roles) ? roles : [],
        scopes: Array.isArray(scopes) ? scopes : []
      }

      c.set('user', user)
      c.set('token', token)

      return next()
    } catch (error) {
      // FAIL CLOSED - never allow invalid tokens through
      if (error instanceof HTTPException) {
        throw error
      }
      // All other errors (invalid signature, expired, malformed) reject the request
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

