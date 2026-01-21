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
 * Extract Bearer token from Authorization header or cookies.
 *
 * Attempts to extract a JWT token from either the Authorization header
 * (Bearer scheme) or a cookie. Checks the Authorization header first,
 * then falls back to cookies.
 *
 * @param request - The HTTP request object
 * @param options - Extraction options
 * @param options.cookieName - Name of the cookie containing the token (default: 'auth_token')
 * @returns The token string, or null if not found
 *
 * @example
 * ```typescript
 * // From Authorization header
 * // Authorization: Bearer eyJhbGc...
 * const token = extractToken(request)
 *
 * // From cookie
 * // Cookie: auth_token=eyJhbGc...
 * const token = extractToken(request, { cookieName: 'auth_token' })
 * ```
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
 * Parse cookies from Cookie header string into a key-value map.
 * @internal
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
 * Verify JWT signature and validate claims.
 *
 * Validates a JWT token's cryptographic signature using HMAC or asymmetric
 * keys and optionally validates issuer and audience claims.
 *
 * @param token - The JWT token string to verify
 * @param options - Verification options
 * @param options.secret - HMAC secret (string or Uint8Array) for verification
 * @param options.issuer - Expected issuer claim (optional)
 * @param options.audience - Expected audience claim (optional)
 * @returns The decoded token payload
 * @throws Error if signature is invalid, token is malformed, or claims don't match
 *
 * @example
 * ```typescript
 * try {
 *   const payload = await verifyTokenSignature(token, {
 *     secret: process.env.JWT_SECRET,
 *     issuer: 'https://auth.example.com',
 *     audience: 'my-app'
 *   })
 *   console.log('Token valid, user ID:', payload.sub)
 * } catch (error) {
 *   console.error('Invalid token:', error.message)
 * }
 * ```
 */
export async function verifyTokenSignature(
  token: string,
  options: {
    secret: Uint8Array | string
    issuer?: string | undefined
    audience?: string | undefined
  }
): Promise<TokenPayload> {
  const { secret, issuer, audience } = options

  // Convert string secret to Uint8Array if needed
  const secretKey = typeof secret === 'string' ? new TextEncoder().encode(secret) : secret

  // Build verify options, only including defined values to satisfy exactOptionalPropertyTypes
  const verifyOptions: { issuer?: string; audience?: string } = {}
  if (issuer !== undefined) verifyOptions.issuer = issuer
  if (audience !== undefined) verifyOptions.audience = audience

  try {
    const { payload } = await jwtVerify(token, secretKey, verifyOptions)

    return payload as TokenPayload
  } catch (error) {
    // Re-throw the original error to preserve error type, stack trace, and additional properties
    // jose provides specific error types (JWTExpired, JWTClaimValidationFailed, etc.) that callers may need
    throw error
  }
}

/**
 * Check token expiration and determine if refresh is needed.
 *
 * Examines the token's exp (expiration) claim and determines if the token
 * has expired, how long until expiration, and whether refresh is recommended.
 *
 * @param payload - The decoded token payload
 * @param options - Check options
 * @param options.refreshThreshold - Seconds before expiration to suggest refresh (default: 300 = 5 minutes)
 * @returns Object with expiration status and timing
 *
 * @example
 * ```typescript
 * const expCheck = checkTokenExpiration(payload, { refreshThreshold: 300 })
 *
 * if (expCheck.expired) {
 *   console.log('Token is expired')
 * } else if (expCheck.shouldRefresh) {
 *   console.log(`Token expires in ${expCheck.expiresIn} seconds - refresh recommended`)
 * }
 * ```
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
 * Convert token payload to AuthUser context object.
 * @internal
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
 * Check if a token has been revoked using the provided store or checker.
 * @internal
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
 * Hono middleware for JWT token validation and authentication.
 *
 * This middleware validates JWT tokens from either the Authorization header
 * or cookies, verifies signatures and claims, checks expiration and revocation,
 * and sets the authenticated user in the request context.
 *
 * **Security:** Fails closed - invalid/missing tokens result in 401 responses.
 *
 * @param options - Validation configuration options
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono'
 * import { validateToken } from '@dotdo/auth'
 *
 * const app = new Hono()
 *
 * // Protect all routes with token validation
 * app.use('/*', validateToken({
 *   secret: process.env.JWT_SECRET,
 *   issuer: 'https://auth.example.com',
 *   audience: 'my-api',
 *   skipPaths: ['/health', '/status'],
 *   refreshThreshold: 300  // 5 minutes before expiration
 * }))
 *
 * app.get('/api/me', (c) => {
 *   const user = c.get('user')
 *   const token = c.get('token')
 *   return c.json({ userId: user.id, email: user.email })
 * })
 * ```
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
