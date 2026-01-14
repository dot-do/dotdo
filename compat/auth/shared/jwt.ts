/**
 * @dotdo/auth - JWT Creation and Verification
 *
 * Edge-compatible JWT implementation using Web Crypto API.
 * Supports HS256/RS256/ES256 algorithms.
 *
 * @module
 */

import type { JWTClaims, JWTHeader, JWTTemplate, AuthError } from './types'
import { AuthenticationError } from './types'

// ============================================================================
// JWT OPTIONS
// ============================================================================

/**
 * Options for JWT creation
 */
export interface JWTCreateOptions {
  /** Signing key (secret for HMAC, private key for RSA/ECDSA) */
  secret: string | CryptoKey
  /** Algorithm to use (default: HS256) */
  algorithm?: JWTHeader['alg']
  /** Key ID for key rotation */
  kid?: string
  /** Token lifetime in seconds (default: 3600) */
  expiresIn?: number
  /** Issuer claim */
  issuer?: string
  /** Audience claim */
  audience?: string | string[]
  /** Subject claim (usually user ID) */
  subject?: string
  /** Not before time in seconds from now */
  notBefore?: number
  /** JWT ID (auto-generated if not provided) */
  jwtId?: string
}

/**
 * Options for JWT verification
 */
export interface JWTVerifyOptions {
  /** Signing key (secret for HMAC, public key for RSA/ECDSA) */
  secret: string | CryptoKey
  /** Expected algorithms (default: ['HS256']) */
  algorithms?: JWTHeader['alg'][]
  /** Expected issuer */
  issuer?: string | string[]
  /** Expected audience */
  audience?: string | string[]
  /** Clock tolerance in seconds (default: 0) */
  clockTolerance?: number
  /** Whether to ignore expiration (for testing) */
  ignoreExpiration?: boolean
  /** Whether to ignore not before (for testing) */
  ignoreNotBefore?: boolean
  /** Required claims */
  requiredClaims?: string[]
  /** Maximum age in seconds */
  maxAge?: number
}

/**
 * JWT verification result
 */
export interface JWTVerifyResult {
  valid: boolean
  claims?: JWTClaims
  header?: JWTHeader
  error?: AuthError
}

// ============================================================================
// JWT UTILITIES
// ============================================================================

/**
 * Base64URL encode
 */
function base64UrlEncode(data: string | Uint8Array): string {
  if (typeof data === 'string') {
    // For strings (JSON), use UTF-8 encoding via encodeURIComponent
    const base64 = btoa(unescape(encodeURIComponent(data)))
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  // For binary data (like signatures), convert bytes to base64
  let binary = ''
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i])
  }
  const base64 = btoa(binary)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Base64URL decode
 */
function base64UrlDecode(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padLength = (4 - (base64.length % 4)) % 4
  const padded = base64 + '='.repeat(padLength)
  // Decode UTF-8
  return decodeURIComponent(escape(atob(padded)))
}

/**
 * Base64URL decode to Uint8Array (for binary data like signatures)
 */
function base64UrlDecodeBytes(str: string): Uint8Array {
  // Convert base64url to standard base64
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padLength = (4 - (base64.length % 4)) % 4
  const padded = base64 + '='.repeat(padLength)
  // Decode binary directly without UTF-8 interpretation
  const binaryString = atob(padded)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

/**
 * Generate random JWT ID
 */
function generateJwtId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Get crypto algorithm params from JWT algorithm
 */
function getAlgorithmParams(alg: JWTHeader['alg']): { name: string; hash?: string } {
  switch (alg) {
    case 'HS256':
      return { name: 'HMAC', hash: 'SHA-256' }
    case 'HS384':
      return { name: 'HMAC', hash: 'SHA-384' }
    case 'HS512':
      return { name: 'HMAC', hash: 'SHA-512' }
    case 'RS256':
      return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
    case 'RS384':
      return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' }
    case 'RS512':
      return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' }
    case 'ES256':
      return { name: 'ECDSA', hash: 'SHA-256' }
    case 'ES384':
      return { name: 'ECDSA', hash: 'SHA-384' }
    case 'ES512':
      return { name: 'ECDSA', hash: 'SHA-512' }
    default:
      throw new AuthenticationError('invalid_algorithm', `Unsupported algorithm: ${alg}`)
  }
}

/**
 * Import signing key from secret string
 */
async function importKey(secret: string | CryptoKey, alg: JWTHeader['alg'], usage: 'sign' | 'verify'): Promise<CryptoKey> {
  if (typeof secret !== 'string') {
    return secret
  }

  const params = getAlgorithmParams(alg)
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)

  if (alg.startsWith('HS')) {
    return crypto.subtle.importKey('raw', keyData, { name: params.name, hash: params.hash }, false, [usage])
  }

  // For RSA/ECDSA, expect PEM format
  const pemHeader = usage === 'sign' ? '-----BEGIN PRIVATE KEY-----' : '-----BEGIN PUBLIC KEY-----'
  const pemFooter = usage === 'sign' ? '-----END PRIVATE KEY-----' : '-----END PUBLIC KEY-----'

  let pemContent = secret.trim()
  if (pemContent.includes(pemHeader)) {
    pemContent = pemContent.replace(pemHeader, '').replace(pemFooter, '').replace(/\s/g, '')
  }

  const binaryString = atob(pemContent)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }

  const format = usage === 'sign' ? 'pkcs8' : 'spki'
  const algorithm: RsaHashedImportParams | EcKeyImportParams = alg.startsWith('RS')
    ? { name: params.name, hash: params.hash! }
    : { name: params.name, namedCurve: alg === 'ES256' ? 'P-256' : alg === 'ES384' ? 'P-384' : 'P-521' }

  return crypto.subtle.importKey(format, bytes, algorithm, false, [usage])
}

// ============================================================================
// JWT CREATION
// ============================================================================

/**
 * Create a signed JWT
 */
export async function createJWT(claims: JWTClaims, options: JWTCreateOptions): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const algorithm = options.algorithm ?? 'HS256'

  // Build header
  const header: JWTHeader = {
    alg: algorithm,
    typ: 'JWT',
  }
  if (options.kid) {
    header.kid = options.kid
  }

  // Build claims
  const payload: JWTClaims = {
    ...claims,
    iat: claims.iat ?? now,
    jti: claims.jti ?? options.jwtId ?? generateJwtId(),
  }

  if (options.issuer) {
    payload.iss = options.issuer
  }
  if (options.audience) {
    payload.aud = options.audience
  }
  if (options.subject) {
    payload.sub = options.subject
  }
  if (options.expiresIn !== undefined) {
    payload.exp = now + options.expiresIn
  }
  if (options.notBefore !== undefined) {
    payload.nbf = now + options.notBefore
  }

  // Encode header and payload
  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`

  // Sign
  const key = await importKey(options.secret, algorithm, 'sign')
  const params = getAlgorithmParams(algorithm)

  let signatureParams: AlgorithmIdentifier | RsaPssParams | EcdsaParams = params.name
  if (algorithm.startsWith('ES')) {
    signatureParams = { name: params.name, hash: params.hash! }
  }

  const signature = await crypto.subtle.sign(signatureParams, key, new TextEncoder().encode(signingInput))

  const encodedSignature = base64UrlEncode(new Uint8Array(signature))

  return `${signingInput}.${encodedSignature}`
}

/**
 * Create JWT from a template
 */
export async function createJWTFromTemplate(
  template: JWTTemplate,
  user: { id: string; email?: string; name?: string; metadata?: Record<string, unknown> },
  options: JWTCreateOptions
): Promise<string> {
  const claims: JWTClaims = {
    ...template.claims,
    sub: user.id,
    email: user.email,
    name: user.name,
    metadata: { ...user.metadata, ...template.custom_claims },
  }

  const lifetime = template.lifetime ?? options.expiresIn ?? 3600

  return createJWT(claims, {
    ...options,
    expiresIn: lifetime,
  })
}

// ============================================================================
// JWT VERIFICATION
// ============================================================================

/**
 * Verify and decode a JWT
 */
export async function verifyJWT(token: string, options: JWTVerifyOptions): Promise<JWTVerifyResult> {
  try {
    // Split token
    const parts = token.split('.')
    if (parts.length !== 3) {
      return {
        valid: false,
        error: { code: 'invalid_token', message: 'Token must have 3 parts' },
      }
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts

    // Decode header
    let header: JWTHeader
    try {
      header = JSON.parse(base64UrlDecode(encodedHeader))
    } catch {
      return {
        valid: false,
        error: { code: 'invalid_header', message: 'Invalid token header' },
      }
    }

    // Check algorithm
    const allowedAlgorithms = options.algorithms ?? ['HS256']
    if (!allowedAlgorithms.includes(header.alg)) {
      return {
        valid: false,
        error: { code: 'invalid_algorithm', message: `Algorithm ${header.alg} not allowed` },
      }
    }

    // Decode payload
    let claims: JWTClaims
    try {
      claims = JSON.parse(base64UrlDecode(encodedPayload))
    } catch {
      return {
        valid: false,
        error: { code: 'invalid_payload', message: 'Invalid token payload' },
      }
    }

    // Verify signature
    const key = await importKey(options.secret, header.alg, 'verify')
    const params = getAlgorithmParams(header.alg)
    const signingInput = `${encodedHeader}.${encodedPayload}`
    const signature = base64UrlDecodeBytes(encodedSignature)

    let verifyParams: AlgorithmIdentifier | RsaPssParams | EcdsaParams = params.name
    if (header.alg.startsWith('ES')) {
      verifyParams = { name: params.name, hash: params.hash! }
    }

    const valid = await crypto.subtle.verify(verifyParams, key, signature, new TextEncoder().encode(signingInput))

    if (!valid) {
      return {
        valid: false,
        error: { code: 'invalid_signature', message: 'Invalid token signature' },
      }
    }

    // Verify claims
    const now = Math.floor(Date.now() / 1000)
    const clockTolerance = options.clockTolerance ?? 0

    // Check expiration
    if (!options.ignoreExpiration && claims.exp !== undefined) {
      if (now > claims.exp + clockTolerance) {
        return {
          valid: false,
          header,
          claims,
          error: { code: 'token_expired', message: 'Token has expired' },
        }
      }
    }

    // Check not before
    if (!options.ignoreNotBefore && claims.nbf !== undefined) {
      if (now < claims.nbf - clockTolerance) {
        return {
          valid: false,
          header,
          claims,
          error: { code: 'token_not_active', message: 'Token is not yet active' },
        }
      }
    }

    // Check issuer
    if (options.issuer !== undefined) {
      const expectedIssuers = Array.isArray(options.issuer) ? options.issuer : [options.issuer]
      if (!expectedIssuers.includes(claims.iss ?? '')) {
        return {
          valid: false,
          header,
          claims,
          error: { code: 'invalid_issuer', message: 'Invalid token issuer' },
        }
      }
    }

    // Check audience
    if (options.audience !== undefined) {
      const expectedAudiences = Array.isArray(options.audience) ? options.audience : [options.audience]
      const tokenAudiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud ?? '']
      const hasValidAudience = expectedAudiences.some((aud) => tokenAudiences.includes(aud))
      if (!hasValidAudience) {
        return {
          valid: false,
          header,
          claims,
          error: { code: 'invalid_audience', message: 'Invalid token audience' },
        }
      }
    }

    // Check required claims
    if (options.requiredClaims) {
      for (const claim of options.requiredClaims) {
        if (claims[claim] === undefined) {
          return {
            valid: false,
            header,
            claims,
            error: { code: 'missing_claim', message: `Missing required claim: ${claim}` },
          }
        }
      }
    }

    // Check max age
    if (options.maxAge !== undefined && claims.iat !== undefined) {
      const age = now - claims.iat
      if (age > options.maxAge) {
        return {
          valid: false,
          header,
          claims,
          error: { code: 'token_too_old', message: 'Token exceeds maximum age' },
        }
      }
    }

    return { valid: true, header, claims }
  } catch (error) {
    return {
      valid: false,
      error: {
        code: 'verification_error',
        message: error instanceof Error ? error.message : 'Unknown verification error',
      },
    }
  }
}

/**
 * Decode a JWT without verification (for debugging)
 */
export function decodeJWT(token: string): { header: JWTHeader; claims: JWTClaims } | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const header = JSON.parse(base64UrlDecode(parts[0])) as JWTHeader
    const claims = JSON.parse(base64UrlDecode(parts[1])) as JWTClaims

    return { header, claims }
  } catch {
    return null
  }
}

// ============================================================================
// JWT HELPERS
// ============================================================================

/**
 * Check if a token is expired
 */
export function isTokenExpired(token: string, clockTolerance = 0): boolean {
  const decoded = decodeJWT(token)
  if (!decoded || decoded.claims.exp === undefined) return true

  const now = Math.floor(Date.now() / 1000)
  return now > decoded.claims.exp + clockTolerance
}

/**
 * Get token expiration time
 */
export function getTokenExpiration(token: string): Date | null {
  const decoded = decodeJWT(token)
  if (!decoded || decoded.claims.exp === undefined) return null

  return new Date(decoded.claims.exp * 1000)
}

/**
 * Get time until token expires in seconds
 */
export function getTokenTTL(token: string): number {
  const decoded = decodeJWT(token)
  if (!decoded || decoded.claims.exp === undefined) return 0

  const now = Math.floor(Date.now() / 1000)
  return Math.max(0, decoded.claims.exp - now)
}

/**
 * Get the subject (user ID) from a token
 */
export function getTokenSubject(token: string): string | null {
  const decoded = decodeJWT(token)
  return decoded?.claims.sub ?? null
}
