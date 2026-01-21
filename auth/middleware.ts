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
import { jwtVerify, importSPKI } from 'jose'
import type { CryptoKey, KeyObject } from 'jose'

/** Type alias for jose key types */
type KeyLike = CryptoKey | KeyObject
import { validateSecretPresent } from './validation'
import { ApiKeyAuth, type ApiKey, type ApiKeyManagerInterface } from './apikey'
import {
  TokenValidationError,
  MissingTokenError,
  InvalidAuthHeaderError,
  MissingSubjectError,
  mapJoseError,
  getWWWAuthenticateHeader,
} from './errors'

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
 * Authenticated user information extracted from JWT claims or API key.
 */
export interface AuthUser {
  /** User ID from the JWT subject (sub) claim or API key ID. */
  id: string
  /** User email from the email claim. */
  email?: string | undefined
  /** User roles from the roles claim. */
  roles?: string[] | undefined
  /** OAuth scopes from the scopes claim. */
  scopes?: string[] | undefined
  /** Additional metadata from API keys. */
  metadata?: Record<string, unknown> | undefined
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser
    token: string
    apiKey?: ApiKey
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
 * \`\`\`typescript
 * import { Hono } from 'hono'
 * import { authMiddleware } from '@dotdo/auth'
 *
 * const app = new Hono()
 *
 * // Option 1: HMAC secret (symmetric)
 * app.use('/*', authMiddleware({
 *   secret: process.env.JWT_SECRET,
 *   issuer: 'https://auth.example.com',
 *   audience: 'my-api',
 *   skipPaths: ['/health']
 * }))
 *
 * // Option 2: RSA/EC public key (asymmetric)
 * app.use('/*', authMiddleware({
 *   publicKey: process.env.JWT_PUBLIC_KEY,  // PEM-encoded public key
 *   issuer: 'https://auth.example.com',
 *   audience: 'my-api',
 *   skipPaths: ['/health']
 * }))
 *
 * app.get('/me', (c) => {
 *   const user = c.get('user')
 *   return c.json({ userId: user.id, email: user.email })
 * })
 * \`\`\`
 */
export function authMiddleware(options: AuthOptions = {}): MiddlewareHandler {
  const { skipPaths = [], secret, publicKey, issuer, audience } = options

  // Require either secret or publicKey for JWT validation
  if (!secret && !publicKey) {
    throw new Error('Either secret or publicKey is required for JWT validation in authMiddleware')
  }

  // Validate that at least one key is properly provided
  if (secret) {
    validateSecretPresent(secret, 'secret', 'JWT validation in authMiddleware')
  }
  if (publicKey) {
    validateSecretPresent(publicKey, 'publicKey', 'JWT validation in authMiddleware')
  }

  // Convert string secret to Uint8Array if needed (for HMAC)
  const secretKey = secret
    ? typeof secret === 'string'
      ? new TextEncoder().encode(secret)
      : secret
    : null

  // Cache for imported public key (lazy initialization)
  let cachedPublicKey: KeyLike | null = null

  /**
   * Get the verification key - either HMAC secret or asymmetric public key
   */
  async function getVerificationKey(): Promise<Uint8Array | KeyLike> {
    // Prefer public key for asymmetric verification if provided
    if (publicKey) {
      if (!cachedPublicKey) {
        // Import PEM-encoded public key. We try RS256 first as it's most common,
        // but jose will auto-detect the algorithm from the key itself.
        try {
          cachedPublicKey = await importSPKI(publicKey, 'RS256')
        } catch {
          // Try ES256 if RS256 fails
          cachedPublicKey = await importSPKI(publicKey, 'ES256')
        }
      }
      return cachedPublicKey
    }

    // Fall back to HMAC secret
    return secretKey!
  }

  return async (c, next) => {
    // Skip auth for specified paths
    if (skipPaths.some(path => c.req.path.startsWith(path))) {
      return next()
    }

    // Get token from header with detailed error handling
    const authHeader = c.req.header('Authorization')
    if (!authHeader) {
      const error = new MissingTokenError('header')
      c.header('WWW-Authenticate', getWWWAuthenticateHeader(error))
      throw new HTTPException(error.statusCode, {
        message: error.message,
        cause: error,
      })
    }

    const parts = authHeader.trim().split(/\s+/)
    const scheme = parts[0]
    const token = parts[1]

    if (!scheme) {
      const error = new InvalidAuthHeaderError('missing_scheme')
      c.header('WWW-Authenticate', getWWWAuthenticateHeader(error))
      throw new HTTPException(error.statusCode, {
        message: error.message,
        cause: error,
      })
    }

    if (scheme !== 'Bearer') {
      const error = new InvalidAuthHeaderError('wrong_scheme')
      c.header('WWW-Authenticate', getWWWAuthenticateHeader(error))
      throw new HTTPException(error.statusCode, {
        message: error.message,
        cause: error,
      })
    }

    if (!token) {
      const error = new InvalidAuthHeaderError('missing_token')
      c.header('WWW-Authenticate', getWWWAuthenticateHeader(error))
      throw new HTTPException(error.statusCode, {
        message: error.message,
        cause: error,
      })
    }

    try {
      // Build verify options, only including defined values
      const verifyOptions: { issuer?: string; audience?: string } = {}
      if (issuer) verifyOptions.issuer = issuer
      if (audience) verifyOptions.audience = audience

      // Get the appropriate verification key (HMAC secret or public key)
      const verificationKey = await getVerificationKey()

      // Verify JWT signature and claims - FAIL CLOSED
      const { payload } = await jwtVerify(token, verificationKey, verifyOptions)

      // Strict claim validation - subject is required
      if (!payload.sub) {
        const error = new MissingSubjectError()
        c.header('WWW-Authenticate', getWWWAuthenticateHeader(error))
        throw new HTTPException(error.statusCode, {
          message: error.message,
          cause: error,
        })
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

      // Convert to TokenValidationError for detailed error messages
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

/**
 * Options for configuring API key authentication middleware.
 */
export interface ApiKeyMiddlewareOptions {
  /** The ApiKeyManager or DurableApiKeyManager instance for key validation */
  manager: ApiKeyManagerInterface
  /** Header name for API key (default: 'X-API-Key') */
  header?: string
  /** Scopes required to access the route (any of these grants access) */
  requireScopes?: string[]
  /** Whether to enforce rate limiting (default: true) */
  enforceRateLimit?: boolean
}

/**
 * Create API key authentication middleware for Hono.
 *
 * This middleware validates API keys using an ApiKeyManager and supports
 * scope-based authorization and rate limiting.
 *
 * **Security:** Fails closed - invalid/missing keys result in 401 responses.
 * Unauthorized scopes result in 403 responses.
 *
 * @param options - Configuration options including the ApiKeyManager
 * @returns Hono middleware handler
 *
 * @example
 * \`\`\`typescript
 * import { Hono } from 'hono'
 * import { apiKeyMiddleware, ApiKeyManager } from '@dotdo/auth'
 *
 * const app = new Hono()
 * const manager = new ApiKeyManager()
 *
 * // Basic usage - validates key format and existence
 * app.use('/api/*', apiKeyMiddleware({ manager }))
 *
 * // With required scopes
 * app.use('/api/admin/*', apiKeyMiddleware({
 *   manager,
 *   requireScopes: ['admin:read', 'admin:write']
 * }))
 *
 * app.get('/api/data', (c) => {
 *   const apiKey = c.get('apiKey')  // The validated ApiKey object
 *   return c.json({ data: 'sensitive', scopes: apiKey?.scopes })
 * })
 * \`\`\`
 */
export function apiKeyMiddleware(options: ApiKeyMiddlewareOptions): MiddlewareHandler {
  const { manager, header = 'X-API-Key', requireScopes = [], enforceRateLimit = true } = options

  return async (c, next) => {
    const key = c.req.header(header)

    // FAIL CLOSED: Require API key header
    if (!key) {
      throw new HTTPException(401, { message: `${header} header required` })
    }

    // Step 1: Verify key format before any expensive operations
    if (!ApiKeyAuth.isValidFormat(key)) {
      throw new HTTPException(401, { message: 'Invalid API key format' })
    }

    // Step 2: Validate against stored keys (checks existence, active status, expiration)
    const result = await manager.validate(key)

    if (!result.valid || !result.apiKey) {
      // FAIL CLOSED: Return generic error to avoid information leakage
      throw new HTTPException(401, { message: result.error || 'Invalid API key' })
    }

    const apiKey = result.apiKey

    // Step 3: Validate permissions/scopes
    if (requireScopes.length > 0) {
      const hasRequiredScope = requireScopes.some(scope =>
        ApiKeyAuth.hasScope(apiKey, scope)
      )

      if (!hasRequiredScope) {
        throw new HTTPException(403, {
          message: `Insufficient permissions. Required scope: ${requireScopes.join(' or ')}`
        })
      }
    }

    // Step 4: Check rate limit
    if (enforceRateLimit) {
      const rateLimitOk = await manager.checkRateLimit(apiKey.id)

      if (!rateLimitOk) {
        throw new HTTPException(429, { message: 'Rate limit exceeded' })
      }
    }

    // Set context variables for downstream handlers
    c.set('apiKey', apiKey)
    c.set('token', key)
    c.set('user', {
      id: `apikey:${apiKey.id}`,
      roles: ['api'],
      scopes: apiKey.scopes
    })

    return next()
  }
}
