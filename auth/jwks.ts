// JWKS support for @dotdo/auth
// Implements JWT validation with JWKS endpoint fetching and caching

import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { jwtVerify, importJWK, decodeProtectedHeader, type JWK } from 'jose'
import { extractToken, checkTokenExpiration, type TokenPayload } from './token'
import type { AuthUser } from './middleware'

/**
 * JWKS (JSON Web Key Set) structure
 */
export interface Jwks {
  keys: JWK[]
}

/**
 * Options for creating a JWKS client
 */
export interface JwksClientOptions {
  /** URL to fetch JWKS from (e.g., https://id.org.ai/.well-known/jwks.json) */
  jwksUri: string
  /** Cache TTL in seconds (default: 600 = 10 minutes) */
  cacheTtl?: number
  /** Whether to refetch JWKS when a key ID is not found in cache (default: true) */
  refetchOnMissingKey?: boolean
  /** Minimum seconds between refetch attempts for missing keys (default: 30) */
  refetchCooldown?: number
  /** Allow insecure HTTP for localhost/127.0.0.1 (for local development only, default: false) */
  allowInsecureLocalhost?: boolean
}

/**
 * Options for verifying tokens with JWKS
 */
export interface JwksVerifyOptions {
  /** Expected issuer(s) */
  issuer?: string | string[] | undefined
  /** Expected audience(s) */
  audience?: string | string[] | undefined
  /** Algorithms to allow (default: RS256, RS384, RS512, ES256, ES384, ES512) */
  algorithms?: string[] | undefined
}

/**
 * Options for the JWKS validation middleware
 */
export interface JwksValidationOptions extends JwksVerifyOptions {
  /** JWKS client instance */
  jwksClient: JwksClient
  /** Cookie name to extract token from (optional) */
  cookieName?: string
  /** Paths to skip validation for */
  skipPaths?: string[]
  /** Seconds before expiration to suggest refresh (default: 300 = 5 minutes) */
  refreshThreshold?: number
}

/**
 * JWKS client interface for fetching and caching keys
 */
export interface JwksClient {
  /** Get a public key by key ID */
  getKey(kid: string): Promise<CryptoKey>
  /** Clear the cache */
  clearCache(): void
}

/**
 * Internal cache entry structure
 */
interface CacheEntry {
  jwks: Jwks
  keys: Map<string, CryptoKey>
  fetchedAt: number
}

/**
 * Validate that a JWKS URI uses HTTPS for security
 * @param uri The JWKS URI to validate
 * @param allowInsecureLocalhost Allow HTTP for localhost/127.0.0.1 (for development)
 * @throws Error if the URI does not use HTTPS (unless localhost exception applies)
 */
export function validateJwksUri(uri: string, allowInsecureLocalhost = false): void {
  const url = new URL(uri)

  // Check if using HTTPS
  if (url.protocol === 'https:') {
    return // HTTPS is always allowed
  }

  // HTTP is only allowed for localhost if explicitly enabled
  if (url.protocol === 'http:') {
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'

    if (isLocalhost && allowInsecureLocalhost) {
      return // Allow HTTP for localhost in development
    }

    throw new Error(
      'JWKS URI must use HTTPS for security. ' +
        'HTTP is not allowed as it exposes keys to man-in-the-middle attacks.'
    )
  }

  throw new Error(`JWKS URI must use HTTPS. Unsupported protocol: ${url.protocol}`)
}

/**
 * Fetch JWKS from a URL
 */
export async function fetchJwks(jwksUri: string, allowInsecureLocalhost = false): Promise<Jwks> {
  // Validate HTTPS requirement
  validateJwksUri(jwksUri, allowInsecureLocalhost)

  const response = await fetch(jwksUri)

  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS: ${response.status} ${response.statusText}`)
  }

  const jwks = await response.json()

  if (!jwks || !Array.isArray(jwks.keys)) {
    throw new Error('Invalid JWKS: missing keys array')
  }

  return jwks as Jwks
}

/**
 * Create a JWKS client with caching support
 */
export function createJwksClient(options: JwksClientOptions): JwksClient {
  const {
    jwksUri,
    cacheTtl = 600,
    refetchOnMissingKey = true,
    refetchCooldown = 30,
    allowInsecureLocalhost = false,
  } = options

  // Validate JWKS URI uses HTTPS (security requirement)
  validateJwksUri(jwksUri, allowInsecureLocalhost)

  let cache: CacheEntry | null = null
  let lastRefetchAttempt = 0

  /**
   * Check if cache is still valid
   */
  function isCacheValid(): boolean {
    if (!cache) return false
    const now = Date.now() / 1000
    return now - cache.fetchedAt < cacheTtl
  }

  /**
   * Fetch and cache JWKS
   */
  async function fetchAndCache(): Promise<CacheEntry> {
    const jwks = await fetchJwks(jwksUri, allowInsecureLocalhost)
    const keys = new Map<string, CryptoKey>()

    cache = {
      jwks,
      keys,
      fetchedAt: Date.now() / 1000,
    }

    return cache
  }

  /**
   * Import a JWK and cache the CryptoKey
   */
  async function importAndCacheKey(jwk: JWK): Promise<CryptoKey> {
    if (!jwk.kid) {
      throw new Error('JWK missing kid')
    }

    const key = await importJWK(jwk, jwk.alg)

    if (cache) {
      cache.keys.set(jwk.kid, key as CryptoKey)
    }

    return key as CryptoKey
  }

  return {
    async getKey(kid: string): Promise<CryptoKey> {
      // Check if we have a valid cached key
      if (cache && isCacheValid()) {
        const cachedKey = cache.keys.get(kid)
        if (cachedKey) {
          return cachedKey
        }

        // Key not in cache - check if we have the JWK
        const jwk = cache.jwks.keys.find((k) => k.kid === kid)
        if (jwk) {
          return importAndCacheKey(jwk)
        }
      }

      // Cache miss or expired - fetch fresh JWKS
      if (!isCacheValid()) {
        await fetchAndCache()

        // Try to find the key now
        const jwk = cache!.jwks.keys.find((k) => k.kid === kid)
        if (jwk) {
          return importAndCacheKey(jwk)
        }
      }

      // Key not found - possibly key rotation
      if (refetchOnMissingKey) {
        const now = Date.now() / 1000

        // Check cooldown
        if (now - lastRefetchAttempt >= refetchCooldown) {
          lastRefetchAttempt = now

          // Force refetch
          await fetchAndCache()

          const jwk = cache!.jwks.keys.find((k) => k.kid === kid)
          if (jwk) {
            return importAndCacheKey(jwk)
          }
        }
      }

      throw new Error(`Key with kid "${kid}" not found in JWKS`)
    },

    clearCache(): void {
      cache = null
      lastRefetchAttempt = 0
    },
  }
}

/**
 * Default allowed algorithms for JWKS verification (asymmetric only)
 */
const DEFAULT_ALGORITHMS = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512']

/**
 * Verify a JWT token using JWKS
 */
export async function verifyTokenWithJwks(
  token: string,
  client: JwksClient,
  options: JwksVerifyOptions = {}
): Promise<TokenPayload> {
  const { issuer, audience, algorithms = DEFAULT_ALGORITHMS } = options

  // Decode header to get kid
  let header: { alg?: string; kid?: string }
  try {
    header = decodeProtectedHeader(token)
  } catch {
    throw new Error('Invalid token: failed to decode header')
  }

  if (!header.kid) {
    throw new Error('Token missing kid in header')
  }

  // Check algorithm is allowed
  if (!header.alg || !algorithms.includes(header.alg)) {
    throw new Error(`Algorithm "${header.alg}" not allowed`)
  }

  // Get the public key
  const key = await client.getKey(header.kid)

  // Verify the token
  const { payload } = await jwtVerify(token, key, {
    issuer,
    audience,
    algorithms,
  })

  return payload as TokenPayload
}

/**
 * Convert token payload to AuthUser
 */
function payloadToAuthUser(payload: TokenPayload): AuthUser {
  return {
    id: payload.sub ?? '',
    email: payload.email as string | undefined,
    roles: Array.isArray(payload.roles) ? payload.roles : [],
    scopes: Array.isArray(payload.scopes) ? payload.scopes : [],
  }
}

/**
 * Hono middleware for JWT validation with JWKS
 */
export function validateTokenWithJwks(options: JwksValidationOptions): MiddlewareHandler {
  const {
    jwksClient,
    issuer,
    audience,
    algorithms,
    cookieName,
    skipPaths = [],
    refreshThreshold = 300,
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
      // Verify token with JWKS
      const payload = await verifyTokenWithJwks(token, jwksClient, {
        issuer,
        audience,
        algorithms,
      })

      // Check expiration
      const expCheck = checkTokenExpiration(payload, { refreshThreshold })

      if (expCheck.expired) {
        c.header('WWW-Authenticate', 'Bearer realm="dotdo", error="invalid_token"')
        throw new HTTPException(401, { message: 'Token expired' })
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

/**
 * Create a JWKS client from an issuer URL
 * Automatically constructs the .well-known/jwks.json URL
 */
export function createJwksClientFromIssuer(
  issuer: string,
  options: Omit<JwksClientOptions, 'jwksUri'> = {}
): JwksClient {
  const normalizedIssuer = issuer.replace(/\/$/, '')
  const jwksUri = `${normalizedIssuer}/.well-known/jwks.json`

  return createJwksClient({
    ...options,
    jwksUri,
  })
}
