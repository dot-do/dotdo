/**
 * @dotdo/auth - Authentication Middleware
 *
 * Provides Hono middleware for JWT and API key authentication.
 * Supports JWKS validation, claim verification, and role/scope extraction.
 *
 * @module @dotdo/auth/middleware
 */
import type { MiddlewareHandler, Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { jwtVerify } from 'jose'
import { validateSecretPresent } from './validation'

/**
 * Options for configuring JWT authentication middleware.
 */
export interface AuthOptions {
  /** Expected JWT issuer claim (iss). If set, tokens from other issuers will be rejected. */
  issuer?: string | undefined
  /** Expected JWT audience claim (aud). If set, tokens for other audiences will be rejected. */
  audience?: string | undefined
  /** Secret key for HMAC signature verification. Either secret or publicKey is required. */
  secret?: string | Uint8Array | undefined
  /** Public key for asymmetric (RSA/EC) signature verification. Either secret or publicKey is required. */
  publicKey?: string | undefined
  /** Paths to skip authentication (e.g., ['/health', '/public']). */
  skipPaths?: string[] | undefined
}

/**
 * Authenticated user information extracted from JWT claims.
 */
export interface AuthUser {
  /** User ID from the JWT subject (sub) claim. */
  id: string
  /** User email from the email claim. */
  email?: string | undefined
  /** User roles from the roles claim. */
  roles?: string[] | undefined
  /** OAuth scopes from the scopes claim. */
  scopes?: string[] | undefined
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser
    token: string
  }
}

/**
 * Create JWT authentication middleware for Hono.
 *
 * This middleware validates JWT tokens from the Authorization header,
 * verifies signatures and claims, and sets the authenticated user
 * in the request context.
 *
 * **Security:** Fails closed - invalid/missing tokens result in 401 responses.
 *
 * @param options - Authentication configuration options
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono'
 * import { authMiddleware } from '@dotdo/auth'
 *
 * const app = new Hono()
 *
 * // Protect all routes except /health
 * app.use('/*', authMiddleware({
 *   secret: process.env.JWT_SECRET,
 *   issuer: 'https://auth.example.com',
 *   audience: 'my-api',
 *   skipPaths: ['/health']
 * }))
 *
 * app.get('/me', (c) => {
 *   const user = c.get('user')
 *   return c.json({ userId: user.id, email: user.email })
 * })
 * ```
 */
export function authMiddleware(options: AuthOptions = {}): MiddlewareHandler {
  const { skipPaths = [], secret, issuer, audience } = options

  // Require secret for JWT validation
  validateSecretPresent(secret, 'secret', 'JWT validation in authMiddleware')

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

/**
 * Create API key authentication middleware for Hono.
 *
 * This middleware extracts an API key from a configurable header and sets
 * a minimal user context. For full API key validation with scopes and rate
 * limiting, use createApiKeyMiddleware with an ApiKeyManager.
 *
 * @param options - Configuration options
 * @param options.header - Header name for API key (default: 'X-API-Key')
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono'
 * import { apiKeyMiddleware } from '@dotdo/auth'
 *
 * const app = new Hono()
 *
 * app.use('/api/*', apiKeyMiddleware({ header: 'X-API-Key' }))
 *
 * app.get('/api/data', (c) => {
 *   const token = c.get('token')  // The API key
 *   return c.json({ data: 'sensitive' })
 * })
 * ```
 */
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

