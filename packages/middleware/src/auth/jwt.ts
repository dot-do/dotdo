/**
 * JWT middleware and utilities
 *
 * JWT verification using jose library with support for:
 * - Symmetric secrets (HS256, HS384, HS512)
 * - JWKS (RS256, RS384, RS512, ES256, ES384, ES512)
 */

import type { MiddlewareHandler, Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'
import * as jose from 'jose'

// ============================================================================
// Types
// ============================================================================

export interface JWTPayload {
  sub: string
  email?: string
  role?: 'admin' | 'user'
  permissions?: string[]
  iat?: number
  exp?: number
}

export interface JWTConfig {
  secret?: string
  jwksUrl?: string
  algorithms?: string[]
}

// ============================================================================
// JWKS Cache
// ============================================================================

let jwks: jose.JWTVerifyGetKey | null = null

/**
 * Reset the cached JWKS. Useful for testing.
 */
export function resetJWKSCache(): void {
  jwks = null
}

// ============================================================================
// JWT Verification
// ============================================================================

/**
 * Verify a JWT token and return the payload.
 *
 * @param token - The JWT token to verify
 * @param config - JWT configuration (secret or jwksUrl)
 * @returns The decoded JWT payload
 * @throws HTTPException if verification fails
 */
export async function verifyJWT(token: string, config: JWTConfig): Promise<JWTPayload> {
  try {
    // Try JWKS first if configured
    if (config.jwksUrl) {
      if (!jwks) {
        jwks = jose.createRemoteJWKSet(new URL(config.jwksUrl))
      }
      const { payload } = await jose.jwtVerify(token, jwks, {
        algorithms: (config.algorithms as jose.JWTVerifyOptions['algorithms']) || ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'],
      })
      return payload as JWTPayload
    }

    // Fall back to symmetric secret
    if (config.secret) {
      const secret = new TextEncoder().encode(config.secret)
      const { payload } = await jose.jwtVerify(token, secret, {
        algorithms: (config.algorithms as jose.JWTVerifyOptions['algorithms']) || ['HS256', 'HS384', 'HS512'],
      })
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
// JWT Generation
// ============================================================================

/**
 * Generate a JWT token.
 *
 * @param payload - The payload to include in the token
 * @param secret - The secret key for signing
 * @param expiresIn - Token expiration time (default: '1h')
 * @returns The signed JWT token
 */
export async function generateJWT(
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  secret: string,
  expiresIn: string = '1h',
): Promise<string> {
  const secretKey = new TextEncoder().encode(secret)

  const jwt = await new jose.SignJWT(payload as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey)

  return jwt
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Extract bearer token from Authorization header.
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null
  const trimmed = authHeader.trim()
  if (!trimmed) return null

  // Handle extra whitespace between "Bearer" and token
  const parts = trimmed.split(/\s+/)
  if (parts.length !== 2 || parts[0]!.toLowerCase() !== 'bearer') return null
  const token = parts[1]
  if (!token || token.trim() === '') return null
  return token
}

/**
 * JWT middleware for Hono.
 *
 * Verifies JWT tokens from the Authorization header and sets the payload
 * in the context under 'jwtPayload'.
 *
 * @param config - JWT configuration
 * @returns Hono middleware handler
 */
export function jwtMiddleware(config?: JWTConfig): MiddlewareHandler {
  const mergedConfig: JWTConfig = {
    ...config,
  }

  return async (c: Context, next: Next) => {
    const authHeader = c.req.header('authorization')
    const token = extractBearerToken(authHeader)

    if (!token) {
      throw new HTTPException(401, { message: 'No token provided' })
    }

    const payload = await verifyJWT(token, mergedConfig)
    c.set('jwtPayload', payload)

    return next()
  }
}

export default jwtMiddleware
