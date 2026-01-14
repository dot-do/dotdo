/**
 * @dotdo/auth - JWT Creation and Verification
 *
 * Edge-compatible JWT implementation using Web Crypto API.
 *
 * @module
 */

import type { JWTClaims, JWTHeader } from './types'
import { AuthError } from './error'

// ============================================================================
// JWT OPTIONS
// ============================================================================

export interface JWTCreateOptions {
  secret: string | CryptoKey
  algorithm?: JWTHeader['alg']
  kid?: string
  expiresIn?: number
  issuer?: string
  audience?: string | string[]
  subject?: string
  notBefore?: number
  jwtId?: string
}

export interface JWTVerifyOptions {
  secret: string | CryptoKey
  algorithms?: JWTHeader['alg'][]
  issuer?: string | string[]
  audience?: string | string[]
  clockTolerance?: number
  ignoreExpiration?: boolean
  ignoreNotBefore?: boolean
  requiredClaims?: string[]
  maxAge?: number
}

export interface JWTVerifyResult {
  valid: boolean
  claims?: JWTClaims
  header?: JWTHeader
  error?: { code: string; message: string }
}

// ============================================================================
// JWT UTILITIES
// ============================================================================

function base64UrlEncode(data: string | Uint8Array): string {
  if (typeof data === 'string') {
    const base64 = btoa(unescape(encodeURIComponent(data)))
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  let binary = ''
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i])
  }
  const base64 = btoa(binary)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padLength = (4 - (base64.length % 4)) % 4
  const padded = base64 + '='.repeat(padLength)
  return decodeURIComponent(escape(atob(padded)))
}

function base64UrlDecodeBytes(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padLength = (4 - (base64.length % 4)) % 4
  const padded = base64 + '='.repeat(padLength)
  const binaryString = atob(padded)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

function generateJwtId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

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
      throw new AuthError('invalid_algorithm', `Unsupported algorithm: ${alg}`)
  }
}

async function importKey(
  secret: string | CryptoKey,
  alg: JWTHeader['alg'],
  usage: 'sign' | 'verify'
): Promise<CryptoKey> {
  if (typeof secret !== 'string') {
    return secret
  }

  const params = getAlgorithmParams(alg)
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)

  if (alg.startsWith('HS')) {
    return crypto.subtle.importKey('raw', keyData, { name: params.name, hash: params.hash }, false, [usage])
  }

  throw new AuthError('not_implemented', 'RSA/ECDSA keys not yet supported in this package')
}

// ============================================================================
// JWT CREATION
// ============================================================================

export async function createJWT(claims: JWTClaims, options: JWTCreateOptions): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const algorithm = options.algorithm ?? 'HS256'

  const header: JWTHeader = {
    alg: algorithm,
    typ: 'JWT',
  }
  if (options.kid) {
    header.kid = options.kid
  }

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

  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`

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

// ============================================================================
// JWT VERIFICATION
// ============================================================================

export async function verifyJWT(token: string, options: JWTVerifyOptions): Promise<JWTVerifyResult> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) {
      return {
        valid: false,
        error: { code: 'invalid_token', message: 'Token must have 3 parts' },
      }
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts

    let header: JWTHeader
    try {
      header = JSON.parse(base64UrlDecode(encodedHeader))
    } catch {
      return {
        valid: false,
        error: { code: 'invalid_header', message: 'Invalid token header' },
      }
    }

    const allowedAlgorithms = options.algorithms ?? ['HS256']
    if (!allowedAlgorithms.includes(header.alg)) {
      return {
        valid: false,
        error: { code: 'invalid_algorithm', message: `Algorithm ${header.alg} not allowed` },
      }
    }

    let claims: JWTClaims
    try {
      claims = JSON.parse(base64UrlDecode(encodedPayload))
    } catch {
      return {
        valid: false,
        error: { code: 'invalid_payload', message: 'Invalid token payload' },
      }
    }

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

    const now = Math.floor(Date.now() / 1000)
    const clockTolerance = options.clockTolerance ?? 0

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

// ============================================================================
// JWT HELPERS
// ============================================================================

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

export function isTokenExpired(token: string, clockTolerance = 0): boolean {
  const decoded = decodeJWT(token)
  if (!decoded || decoded.claims.exp === undefined) return true

  const now = Math.floor(Date.now() / 1000)
  return now > decoded.claims.exp + clockTolerance
}

export function getTokenExpiration(token: string): Date | null {
  const decoded = decodeJWT(token)
  if (!decoded || decoded.claims.exp === undefined) return null

  return new Date(decoded.claims.exp * 1000)
}

export function getTokenTTL(token: string): number {
  const decoded = decodeJWT(token)
  if (!decoded || decoded.claims.exp === undefined) return 0

  const now = Math.floor(Date.now() / 1000)
  return Math.max(0, decoded.claims.exp - now)
}

export function getTokenSubject(token: string): string | null {
  const decoded = decodeJWT(token)
  return decoded?.claims.sub ?? null
}
