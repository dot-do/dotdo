/**
 * @dotdo/auth JWT Verification
 *
 * Lightweight JWT verification using jose only.
 * Provides a simple, focused API for JWT validation.
 *
 * @module @dotdo/auth/jwt
 */
import { jwtVerify, type JWTPayload } from 'jose'
import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'

/**
 * Options for JWT verification
 */
export interface VerifyJWTOptions {
  /** Secret key for HMAC signature verification (string or Uint8Array) */
  secret: string | Uint8Array
  /** Expected JWT issuer claim (iss) */
  issuer?: string | undefined
  /** Expected JWT audience claim (aud) */
  audience?: string | undefined
}

/**
 * Options for JWT middleware
 */
export interface JWTMiddlewareOptions extends VerifyJWTOptions {
  /** Paths to skip authentication */
  skipPaths?: string[]
  /** Cookie name for extracting token (default: uses Authorization header) */
  cookieName?: string
}

/**
 * Authenticated user extracted from JWT
 */
export interface JWTUser {
  /** User ID from the JWT subject (sub) claim */
  id: string
  /** User email from the email claim */
  email?: string | undefined
  /** User roles from the roles claim */
  roles?: string[] | undefined
  /** OAuth scopes from the scopes claim */
  scopes?: string[] | undefined
}

// Extend Hono context types
declare module 'hono' {
  interface ContextVariableMap {
    user: JWTUser
    token: string
  }
}

/**
 * Verify a JWT token and return the payload.
 *
 * Uses jose's jwtVerify for signature validation and claim checking.
 * Supports HMAC (HS256) symmetric signatures.
 *
 * @param token - The JWT token string to verify
 * @param options - Verification options including secret and optional issuer/audience
 * @returns The verified JWT payload
 * @throws Error if verification fails (invalid signature, expired, wrong issuer/audience)
 *
 * @example
 * ```typescript
 * import { verifyJWT } from '@dotdo/auth/jwt'
 *
 * const payload = await verifyJWT(token, {
 *   secret: process.env.JWT_SECRET,
 *   issuer: 'id.org.ai',
 *   audience: 'dotdo.api'
 * })
 *
 * console.log(payload.sub) // user ID
 * ```
 */
export async function verifyJWT(
  token: string,
  options: VerifyJWTOptions
): Promise<JWTPayload> {
  const { secret, issuer, audience } = options

  // Convert string secret to Uint8Array if needed
  const secretKey = typeof secret === 'string'
    ? new TextEncoder().encode(secret)
    : secret

  // Build verify options, only including defined values
  const verifyOptions: { issuer?: string; audience?: string } = {}
  if (issuer !== undefined) verifyOptions.issuer = issuer
  if (audience !== undefined) verifyOptions.audience = audience

  const { payload } = await jwtVerify(token, secretKey, verifyOptions)
  return payload
}

/**
 * Extract Bearer token from Authorization header or cookies.
 *
 * @param request - The incoming request
 * @param cookieName - Optional cookie name to check
 * @returns The extracted token or null
 */
function extractBearerToken(request: Request, cookieName?: string): string | null {
  // Try Authorization header first
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const trimmed = authHeader.trim()
    const parts = trimmed.split(/\s+/)
    if (parts.length === 2 && parts[0] === 'Bearer' && parts[1]) {
      return parts[1].trim()
    }
    return null
  }

  // Try cookie if specified
  if (cookieName) {
    const cookieHeader = request.headers.get('Cookie')
    if (cookieHeader) {
      for (const cookie of cookieHeader.split(';')) {
        const [name, ...rest] = cookie.split('=')
        if (name && name.trim() === cookieName && rest.length > 0) {
          return rest.join('=').trim()
        }
      }
    }
  }

  return null
}

/**
 * Create Hono middleware for JWT authentication.
 *
 * Validates JWT tokens from the Authorization header (Bearer scheme).
 * Sets authenticated user in the request context.
 *
 * **Security:** Fails closed - invalid/missing tokens result in 401 responses.
 *
 * @param options - Middleware configuration
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono'
 * import { createJWTMiddleware } from '@dotdo/auth/jwt'
 *
 * const app = new Hono()
 *
 * app.use('/*', createJWTMiddleware({
 *   secret: process.env.JWT_SECRET,
 *   issuer: 'id.org.ai',
 *   skipPaths: ['/health', '/public']
 * }))
 *
 * app.get('/me', (c) => {
 *   const user = c.get('user')
 *   return c.json({ userId: user.id })
 * })
 * ```
 */
export function createJWTMiddleware(options: JWTMiddlewareOptions): MiddlewareHandler {
  const { secret, issuer, audience, skipPaths = [], cookieName } = options

  return async (c, next) => {
    // Skip auth for specified paths
    if (skipPaths.some(path => c.req.path.startsWith(path))) {
      return next()
    }

    // Extract token
    const token = extractBearerToken(c.req.raw, cookieName)

    if (!token) {
      throw new HTTPException(401, { message: 'Authorization required' })
    }

    try {
      // Verify JWT
      const payload = await verifyJWT(token, { secret, issuer, audience })

      // Require subject claim
      if (!payload.sub) {
        throw new HTTPException(401, { message: 'Token missing subject claim' })
      }

      // Extract user info from payload
      const email = payload['email'] as string | undefined
      const roles = payload['roles']
      const scopes = payload['scopes']

      const user: JWTUser = {
        id: payload.sub,
        email,
        roles: Array.isArray(roles) ? roles : [],
        scopes: Array.isArray(scopes) ? scopes : []
      }

      c.set('user', user)
      c.set('token', token)

      return next()
    } catch (error) {
      // FAIL CLOSED - reject all invalid tokens
      if (error instanceof HTTPException) {
        throw error
      }
      throw new HTTPException(401, { message: 'Invalid token' })
    }
  }
}
