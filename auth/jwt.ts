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
import {
  TokenValidationError,
  MissingSubjectError,
  mapJoseError,
  getWWWAuthenticateHeader,
} from './errors'
import { extractBearerToken, extractUserFromPayload } from './helpers'
import type { AuthUser } from './middleware'

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
 * Authenticated user extracted from JWT.
 * Extends AuthUser for compatibility with the shared auth context.
 */
export interface JWTUser extends AuthUser {
  // JWTUser currently has no additional fields beyond AuthUser.
  // This type alias exists for explicit JWT-specific typing.
}

// Note: ContextVariableMap is declared in middleware.ts
// This module uses AuthUser through JWTUser extension

/**
 * Verify a JWT token and return the payload.
 *
 * Uses jose's jwtVerify for signature validation and claim checking.
 * Supports HMAC (HS256) symmetric signatures.
 *
 * @param token - The JWT token string to verify
 * @param options - Verification options including secret and optional issuer/audience
 * @returns The verified JWT payload
 * @throws {TokenValidationError} If verification fails (with specific error type for debugging)
 *
 * @example
 * ```typescript
 * import { verifyJWT } from '@dotdo/auth/jwt'
 *
 * try {
 *   const payload = await verifyJWT(token, {
 *     secret: process.env.JWT_SECRET,
 *     issuer: 'id.org.ai',
 *     audience: 'dotdo.api'
 *   })
 *   console.log(payload.sub) // user ID
 * } catch (error) {
 *   if (error instanceof TokenExpiredError) {
 *     // Handle expired token - prompt for refresh
 *   } else if (error instanceof InvalidSignatureError) {
 *     // Handle tampered token
 *   }
 * }
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

  try {
    const { payload } = await jwtVerify(token, secretKey, verifyOptions)
    return payload
  } catch (error) {
    // Map jose errors to our specific error types for better debugging
    throw mapJoseError(error, {
      expectedIssuer: issuer,
      expectedAudience: audience,
    })
  }
}

// Token extraction is handled by shared helpers in ./helpers.ts

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

    // Extract token using shared helper
    const extractionResult = extractBearerToken(c.req.raw, cookieName)

    if (!extractionResult.token) {
      const error = extractionResult.error!
      c.header('WWW-Authenticate', getWWWAuthenticateHeader(error))
      throw new HTTPException(error.statusCode, {
        message: error.message,
        cause: error,
      })
    }

    const token = extractionResult.token

    try {
      // Verify JWT
      const payload = await verifyJWT(token, { secret, issuer, audience })

      // Extract user from payload using shared helper
      const user = extractUserFromPayload(payload)
      if (!user) {
        const error = new MissingSubjectError()
        c.header('WWW-Authenticate', getWWWAuthenticateHeader(error))
        throw new HTTPException(error.statusCode, {
          message: error.message,
          cause: error,
        })
      }

      c.set('user', user)
      c.set('token', token)

      return next()
    } catch (error) {
      // FAIL CLOSED - reject all invalid tokens
      if (error instanceof HTTPException) {
        throw error
      }

      // Convert to TokenValidationError if not already
      const tokenError = error instanceof TokenValidationError
        ? error
        : mapJoseError(error, {
            expectedIssuer: issuer,
            expectedAudience: audience,
          })

      c.header('WWW-Authenticate', getWWWAuthenticateHeader(tokenError))
      throw new HTTPException(tokenError.statusCode, {
        message: tokenError.message,
        cause: tokenError,
      })
    }
  }
}
