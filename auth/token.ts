// JWT token validation for @dotdo/auth
import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { jwtVerify, type JWTPayload } from 'jose'
import type { AuthUser } from './middleware'
import type { TokenRevocationStore, TokenRevocationChecker } from './revocation'

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
  /** Token revocation store for checking if tokens have been revoked */
  revocationStore?: TokenRevocationStore
  /** Custom revocation checker function (alternative to revocationStore) */
  revocationChecker?: TokenRevocationChecker
}

export interface TokenExtractionOptions {
  cookieName?: string | undefined
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
 * Extract Bearer token from Authorization header or cookies
 */
export function extractToken(request: Request, options: TokenExtractionOptions = {}): string | null {
  const { cookieName = 'auth_token' } = options

  // Try Authorization header first
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const trimmed = authHeader.trim()
    const parts = trimmed.split(/\s+/) // Split on any whitespace
    const scheme = parts[0]
    const token = parts[1]
    if (parts.length === 2 && scheme === 'Bearer' && token) {
      return token.trim()
    }
    return null
  }

  // Try cookie
  const cookieHeader = request.headers.get('Cookie')
  if (cookieHeader) {
    const cookies = parseCookies(cookieHeader)
    const token = cookies[cookieName]
    return token ? token.trim() : null
  }

  return null
}

/**
 * Parse cookies from Cookie header
 */
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const cookie of cookieHeader.split(';')) {
    const [name, ...rest] = cookie.split('=')
    if (name && rest.length > 0) {
      const value = rest.join('=').trim()
      // Decode URL-encoded cookie values
      try {
        cookies[name.trim()] = decodeURIComponent(value)
      } catch {
        // If decoding fails, use the original value
        cookies[name.trim()] = value
      }
    }
  }
  return cookies
}

/**
 * Verify JWT signature and validate claims
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
    const { payload } = await jwtVerify(token, secretKey, {
      issuer,
      audience,
    })

    return payload as TokenPayload
  } catch (error) {
    // Re-throw with more specific error message
    if (error instanceof Error) {
      throw new Error(error.message)
    }
    throw error
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
 * Check if a token has been revoked
 */
async function isTokenRevoked(
  jti: string | undefined,
  revocationStore?: TokenRevocationStore,
  revocationChecker?: TokenRevocationChecker
): Promise<boolean> {
  if (!jti) return false

  if (revocationChecker) {
    return revocationChecker(jti)
  }

  if (revocationStore) {
    return revocationStore.isTokenRevoked(jti)
  }

  return false
}

/**
 * Hono middleware for JWT token validation
 */
export function validateToken(options: TokenValidationOptions): MiddlewareHandler {
  const {
    secret,
    issuer,
    audience,
    cookieName,
    skipPaths = [],
    refreshThreshold = 300,
    revocationStore,
    revocationChecker,
  } = options

  return async (c, next) => {
    // Skip validation for specified paths
    if (skipPaths.some((path) => c.req.path.startsWith(path))) {
      return next()
    }

    // Extract token
    const token = extractToken(c.req.raw, { cookieName })

    if (!token) {
      c.header('WWW-Authenticate', 'Bearer realm="dotdo", error="invalid_token"')
      throw new HTTPException(401, { message: 'Authorization required' })
    }

    try {
      // Verify signature and claims
      const payload = await verifyTokenSignature(token, {
        secret,
        issuer,
        audience,
      })

      // Check expiration
      const expCheck = checkTokenExpiration(payload, { refreshThreshold })

      if (expCheck.expired) {
        c.header('WWW-Authenticate', 'Bearer realm="dotdo", error="invalid_token"')
        throw new HTTPException(401, { message: 'Token expired' })
      }

      // Check if token has been revoked (requires jti claim)
      if (await isTokenRevoked(payload.jti, revocationStore, revocationChecker)) {
        c.header('WWW-Authenticate', 'Bearer realm="dotdo", error="invalid_token"')
        throw new HTTPException(401, { message: 'Token has been revoked' })
      }

      // Set refresh hint header if token is close to expiration
      if (expCheck.shouldRefresh) {
        c.header('X-Token-Refresh-Hint', 'true')
      }

      // Set user and token in context
      const user = payloadToAuthUser(payload)
      c.set('user', user)
      c.set('token', token)

      return next()
    } catch (error) {
      // Handle validation errors
      if (error instanceof HTTPException) {
        throw error
      }

      c.header('WWW-Authenticate', 'Bearer realm="dotdo", error="invalid_token"')

      const message = error instanceof Error ? error.message : 'Invalid token'
      throw new HTTPException(401, { message })
    }
  }
}
