/**
 * Cryptographic utilities for OAuth 2.0 Authorization Server
 *
 * Handles:
 * - RSA key pair generation for JWT signing
 * - JWKS generation
 * - Token generation (authorization codes, access tokens, refresh tokens)
 * - PKCE verification
 * - Client secret hashing
 */

import * as jose from 'jose'

// ============================================================================
// Key Management
// ============================================================================

/**
 * RSA key pair for JWT signing
 */
export interface JWKKeyPair {
  kid: string
  privateKey: jose.KeyLike
  publicKey: jose.KeyLike
  publicJWK: jose.JWK
}

/**
 * Key storage - cached key pairs
 */
const keyCache = new Map<string, JWKKeyPair>()

/**
 * Generate or retrieve RSA key pair for JWT signing
 */
export async function getSigningKey(seed: string): Promise<JWKKeyPair> {
  const cacheKey = `rsa:${seed}`

  if (keyCache.has(cacheKey)) {
    return keyCache.get(cacheKey)!
  }

  // Generate a deterministic key ID from the seed
  const kid = await generateKid(seed)

  // Generate RSA key pair
  // In production, you'd want to store this and load from KV/D1
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256', {
    extractable: true,
  })

  // Export public key as JWK
  const publicJWK = await jose.exportJWK(publicKey)
  publicJWK.kid = kid
  publicJWK.alg = 'RS256'
  publicJWK.use = 'sig'

  const keyPair: JWKKeyPair = {
    kid,
    privateKey,
    publicKey,
    publicJWK,
  }

  keyCache.set(cacheKey, keyPair)
  return keyPair
}

/**
 * Generate a key ID from a seed string
 */
async function generateKid(seed: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(seed)
  const hash = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hash)
  return Array.from(hashArray.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Get JWKS (JSON Web Key Set)
 */
export async function getJWKS(seed: string): Promise<{ keys: jose.JWK[] }> {
  const keyPair = await getSigningKey(seed)
  return {
    keys: [keyPair.publicJWK],
  }
}

// ============================================================================
// Token Generation
// ============================================================================

/**
 * Generate a secure random token
 */
export function generateToken(length: number = 32): string {
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Generate an authorization code
 */
export function generateAuthorizationCode(): string {
  return generateToken(32)
}

/**
 * Generate an access token
 */
export function generateAccessToken(): string {
  return generateToken(48)
}

/**
 * Generate a refresh token
 */
export function generateRefreshToken(): string {
  return generateToken(64)
}

/**
 * Generate a client ID
 */
export function generateClientId(): string {
  return 'cl_' + generateToken(16)
}

/**
 * Generate a client secret
 */
export function generateClientSecret(): string {
  return 'cs_' + generateToken(32)
}

// ============================================================================
// JWT Generation
// ============================================================================

export interface JWTClaims {
  sub: string
  aud: string
  iss: string
  exp?: number
  iat?: number
  nbf?: number
  nonce?: string
  email?: string
  email_verified?: boolean
  name?: string
  picture?: string
  scope?: string
  client_id?: string
  [key: string]: unknown
}

/**
 * Sign a JWT with the signing key
 */
export async function signJWT(
  claims: JWTClaims,
  signingKey: string,
  expiresIn: string = '1h'
): Promise<string> {
  const keyPair = await getSigningKey(signingKey)

  const jwt = new jose.SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: keyPair.kid })
    .setIssuedAt()
    .setExpirationTime(expiresIn)

  return jwt.sign(keyPair.privateKey)
}

/**
 * Generate an ID token (OpenID Connect)
 */
export async function generateIdToken(
  options: {
    issuer: string
    subject: string
    audience: string
    nonce?: string
    email?: string
    emailVerified?: boolean
    name?: string
    picture?: string
    expiresIn?: string
  },
  signingKey: string
): Promise<string> {
  const claims: JWTClaims = {
    iss: options.issuer,
    sub: options.subject,
    aud: options.audience,
  }

  if (options.nonce) {
    claims.nonce = options.nonce
  }

  if (options.email) {
    claims.email = options.email
  }

  if (options.emailVerified !== undefined) {
    claims.email_verified = options.emailVerified
  }

  if (options.name) {
    claims.name = options.name
  }

  if (options.picture) {
    claims.picture = options.picture
  }

  return signJWT(claims, signingKey, options.expiresIn || '1h')
}

/**
 * Verify a JWT
 */
export async function verifyJWT(
  token: string,
  signingKey: string
): Promise<jose.JWTPayload | null> {
  try {
    const keyPair = await getSigningKey(signingKey)
    const { payload } = await jose.jwtVerify(token, keyPair.publicKey)
    return payload
  } catch {
    return null
  }
}

// ============================================================================
// PKCE (RFC 7636)
// ============================================================================

/**
 * Verify PKCE code challenge
 */
export async function verifyCodeChallenge(
  codeVerifier: string,
  codeChallenge: string,
  method: string = 'S256'
): Promise<boolean> {
  if (method === 'plain') {
    return codeVerifier === codeChallenge
  }

  if (method === 'S256') {
    const encoder = new TextEncoder()
    const data = encoder.encode(codeVerifier)
    const hash = await crypto.subtle.digest('SHA-256', data)
    const computed = btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    return computed === codeChallenge
  }

  return false
}

// ============================================================================
// Client Secret Hashing
// ============================================================================

/**
 * Hash a client secret for storage
 */
export async function hashSecret(secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(secret)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Verify a client secret against stored hash
 */
export async function verifySecret(
  secret: string,
  hash: string
): Promise<boolean> {
  const computed = await hashSecret(secret)
  // Constant-time comparison to prevent timing attacks
  if (computed.length !== hash.length) return false
  let result = 0
  for (let i = 0; i < computed.length; i++) {
    result |= computed.charCodeAt(i) ^ hash.charCodeAt(i)
  }
  return result === 0
}
