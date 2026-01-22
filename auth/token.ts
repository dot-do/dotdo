// JWT token validation for @dotdo/auth
import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { jwtVerify, type JWTPayload } from 'jose'
import { parseCookies } from '@dotdo/utils/cookies'
import type { AuthUser } from './middleware'
import {
  TokenValidationError,
  MissingTokenError,
  InvalidAuthHeaderError,
  MissingSubjectError,
  TokenExpiredError,
  mapJoseError,
  getWWWAuthenticateHeader,
} from './errors'

export interface TokenPayload extends JWTPayload {
  sub: string
  email?: string
  roles?: string[]
  scopes?: string[]
  [key: string]: unknown
}

export interface TokenValidationOptions {
  secret: Uint8Array | string
  issuer?: string
  audience?: string
  cookieName?: string
  skipPaths?: string[]
  refreshThreshold?: number // seconds before expiration to suggest refresh
}

export interface TokenExtractionOptions {
  cookieName?: string
}

export interface ExpirationCheckResult {
  expired: boolean
  expiresIn: number | null // seconds until expiration (null if no exp claim)
  shouldRefresh?: boolean
}

export interface ExpirationCheckOptions {
  refreshThreshold?: number // seconds before expiration to suggest refresh
}

/**
 * Result of token extraction with detailed error information
 */
export interface TokenExtractionResult {
  /** The extracted token, or null if extraction failed */
  token: string | null
  /** Error details if extraction failed */
  error?: TokenValidationError
}

/**
 * Extract Bearer token from Authorization header or cookies.
 *
 * @param request - The incoming request
 * @param options - Extraction options (cookie name)
 * @returns The extracted token or null
 */
export function extractToken(
  request: Request,
  options: TokenExtractionOptions = {}
): string | null {
  const result = extractTokenWithError(request, options)
  return result.token
}

/**
 * Extract Bearer token with detailed error information.
 * Use this when you need to know why extraction failed.
 *
 * @param request - The incoming request
 * @param options - Extraction options (cookie name)
 * @returns Result with token and optional error details
 */
export function extractTokenWithError(
  request: Request,
  options: TokenExtractionOptions = {}
): TokenExtractionResult {
  const { cookieName = 'auth_token' } = options

  // Try Authorization header first
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const trimmed = authHeader.trim()
    const parts = trimmed.split(/\s+/) // Split on any whitespace

    if (parts.length === 0 || !parts[0]) {
      return {
        token: null,
        error: new InvalidAuthHeaderError('missing_scheme'),
      }
    }

    const scheme = parts[0]
    if (scheme !== 'Bearer') {
      return {
        token: null,
        error: new InvalidAuthHeaderError('wrong_scheme'),
      }
    }

    if (parts.length < 2 || !parts[1]) {
      return {
        token: null,
        error: new InvalidAuthHeaderError('missing_token'),
      }
    }

    const token = parts[1].trim()
    return { token }
  }

  // Try cookie
  const cookieHeader = request.headers.get('Cookie')
  if (cookieHeader) {
    const cookies = parseCookies(cookieHeader)
    const token = cookies[cookieName]
    if (token) {
      return { token: token.trim() }
    }
  }

  return {
    token: null,
    error: new MissingTokenError(cookieName ? 'both' : 'header'),
  }
}


/**
 * Verify JWT signature and validate claims.
 *
 * @param token - The JWT string to verify
 * @param options - Verification options including secret and expected claims
 * @returns The verified token payload
 * @throws {TokenValidationError} If verification fails (with specific error type)
 */
export async function verifyTokenSignature(
  token: string,
  options: {
    secret: Uint8Array | string
    issuer?: string
    audience?: string
  }
): Promise<TokenPayload> {
  const { secret, issuer, audience } = options

  // Convert string secret to Uint8Array if needed
  const secretKey = typeof secret === 'string' ? new TextEncoder().encode(secret) : secret

  try {
    const verifyOptions: Parameters<typeof jwtVerify>[2] = {}
    if (issuer !== undefined) verifyOptions.issuer = issuer
    if (audience !== undefined) verifyOptions.audience = audience

    const { payload } = await jwtVerify(token, secretKey, verifyOptions)

    return payload as TokenPayload
  } catch (error) {
    // Map jose errors to our specific error types for better debugging
    throw mapJoseError(error, {
      expectedIssuer: issuer,
      expectedAudience: audience,
    })
  }
}

/**
 * Check token expiration and determine if refresh is needed
 */
export function checkTokenExpiration(
  payload: TokenPayload,
  options: ExpirationCheckOptions = {}
): ExpirationCheckResult {
  const { refreshThreshold = 300 } = options // default 5 minutes

  // If no exp claim, treat as never expires
  if (!payload.exp) {
    return {
      expired: false,
      expiresIn: null,
      shouldRefresh: false,
    }
  }

  const now = Math.floor(Date.now() / 1000)
  const expiresIn = payload.exp - now

  return {
    expired: expiresIn <= 0,
    expiresIn,
    shouldRefresh: expiresIn > 0 && expiresIn <= refreshThreshold,
  }
}

/**
 * Convert token payload to AuthUser
 */
function payloadToAuthUser(payload: TokenPayload): AuthUser {
  return {
    id: payload.sub,
    email: payload.email,
    roles: Array.isArray(payload.roles) ? payload.roles : [],
    scopes: Array.isArray(payload.scopes) ? payload.scopes : [],
  }
}

/**
 * Hono middleware for JWT token validation.
 *
 * Validates JWT tokens from Authorization header or cookies.
 * Provides detailed error messages for debugging while remaining secure.
 *
 * @param options - Middleware configuration options
 * @returns Hono middleware handler
 */
export function validateToken(options: TokenValidationOptions): MiddlewareHandler {
  const {
    secret,
    issuer,
    audience,
    cookieName,
    skipPaths = [],
    refreshThreshold = 300,
  } = options

  return async (c, next) => {
    // Skip validation for specified paths
    if (skipPaths.some((path) => c.req.path.startsWith(path))) {
      return next()
    }

    // Extract token with detailed error information
    const extractionResult = extractTokenWithError(c.req.raw, {
      ...(cookieName !== undefined && { cookieName }),
    })

    if (!extractionResult.token) {
      const error = extractionResult.error || new MissingTokenError('header')
      c.header('WWW-Authenticate', getWWWAuthenticateHeader(error))
      throw new HTTPException(error.statusCode, {
        message: error.message,
        cause: error,
      })
    }

    const token = extractionResult.token

    try {
      // Verify signature and claims
      const payload = await verifyTokenSignature(token, {
        secret,
        ...(issuer !== undefined && { issuer }),
        ...(audience !== undefined && { audience }),
      })

      // Check expiration (double-check since jose may have clock tolerance)
      const expCheck = checkTokenExpiration(payload, { refreshThreshold })

      if (expCheck.expired) {
        const error = new TokenExpiredError(payload.exp)
        c.header('WWW-Authenticate', getWWWAuthenticateHeader(error))
        throw new HTTPException(error.statusCode, {
          message: error.message,
          cause: error,
        })
      }

      // Set refresh hint header if token is close to expiration
      if (expCheck.shouldRefresh) {
        c.header('X-Token-Refresh-Hint', 'true')
        if (expCheck.expiresIn !== null) {
          c.header('X-Token-Expires-In', String(expCheck.expiresIn))
        }
      }

      // Set user and token in context
      const user = payloadToAuthUser(payload)
      c.set('user', user)
      c.set('token', token)

      return next()
    } catch (error) {
      // Re-throw HTTPExceptions as-is
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
