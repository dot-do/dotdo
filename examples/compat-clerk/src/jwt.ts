/**
 * JWT Utilities for Clerk-compatible Authentication
 *
 * Implements RS256 (RSA-SHA256) JWT signing and verification,
 * which is the algorithm used by Clerk for session tokens.
 *
 * Features:
 * - RS256 key pair generation
 * - JWT signing with RSA private key
 * - JWT verification with RSA public key
 * - Clerk-compatible claims structure
 * - JWKS (JSON Web Key Set) support
 */

// ============================================================================
// TYPES
// ============================================================================

export interface JWTHeader {
  alg: 'RS256'
  typ: 'JWT'
  kid?: string
}

export interface JWTPayload {
  // Standard claims
  iss?: string // Issuer
  sub?: string // Subject (user ID)
  aud?: string | string[] // Audience
  exp?: number // Expiration time
  nbf?: number // Not before
  iat?: number // Issued at
  jti?: string // JWT ID

  // Clerk-specific claims
  azp?: string // Authorized party
  sid?: string // Session ID
  org_id?: string // Organization ID
  org_role?: string // Organization role
  org_slug?: string // Organization slug
  org_permissions?: string[] // Organization permissions

  // Custom claims
  [key: string]: unknown
}

export interface JWK {
  kty: 'RSA'
  use: 'sig'
  alg: 'RS256'
  kid: string
  n: string // Modulus
  e: string // Exponent
}

export interface JWKS {
  keys: JWK[]
}

export interface KeyPair {
  publicKey: CryptoKey
  privateKey: CryptoKey
  publicKeyPem: string
  privateKeyPem: string
  kid: string
  jwk: JWK
}

// ============================================================================
// BASE64URL ENCODING
// ============================================================================

/**
 * Encode bytes to base64url
 */
function base64UrlEncode(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Decode base64url to bytes
 */
function base64UrlDecode(str: string): Uint8Array {
  // Restore standard base64
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  // Add padding
  while (base64.length % 4 !== 0) {
    base64 += '='
  }
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Encode string to base64url
 */
function stringToBase64Url(str: string): string {
  const encoder = new TextEncoder()
  return base64UrlEncode(encoder.encode(str))
}

// ============================================================================
// KEY GENERATION AND CONVERSION
// ============================================================================

/**
 * Generate an RSA key pair for RS256 signing
 */
export async function generateKeyPair(): Promise<KeyPair> {
  // Generate RSA-PSS key pair (2048 bits is Clerk's default)
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]), // 65537
      hash: 'SHA-256',
    },
    true, // extractable
    ['sign', 'verify']
  )

  // Generate key ID
  const kid = crypto.randomUUID()

  // Export public key in JWK format
  const publicKeyJwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as JsonWebKey

  // Export keys in SPKI/PKCS8 format for PEM
  const publicKeySpki = await crypto.subtle.exportKey('spki', keyPair.publicKey)
  const privateKeyPkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)

  // Convert to PEM format
  const publicKeyPem = arrayBufferToPem(publicKeySpki, 'PUBLIC KEY')
  const privateKeyPem = arrayBufferToPem(privateKeyPkcs8, 'PRIVATE KEY')

  // Create JWK for JWKS endpoint
  const jwk: JWK = {
    kty: 'RSA',
    use: 'sig',
    alg: 'RS256',
    kid,
    n: publicKeyJwk.n!,
    e: publicKeyJwk.e!,
  }

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    publicKeyPem,
    privateKeyPem,
    kid,
    jwk,
  }
}

/**
 * Convert ArrayBuffer to PEM format
 */
function arrayBufferToPem(buffer: ArrayBuffer, type: string): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
  const lines = base64.match(/.{1,64}/g) ?? []
  return `-----BEGIN ${type}-----\n${lines.join('\n')}\n-----END ${type}-----`
}

/**
 * Parse PEM format to ArrayBuffer
 */
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN .*-----/, '')
    .replace(/-----END .*-----/, '')
    .replace(/\s/g, '')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

/**
 * Import RSA private key from PEM
 */
export async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const buffer = pemToArrayBuffer(pem)
  return crypto.subtle.importKey(
    'pkcs8',
    buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
}

/**
 * Import RSA public key from PEM
 */
export async function importPublicKey(pem: string): Promise<CryptoKey> {
  const buffer = pemToArrayBuffer(pem)
  return crypto.subtle.importKey(
    'spki',
    buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  )
}

/**
 * Import RSA public key from JWK
 */
export async function importPublicKeyFromJwk(jwk: JWK): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e,
      alg: 'RS256',
      use: 'sig',
    },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  )
}

// ============================================================================
// JWT SIGNING
// ============================================================================

/**
 * Sign a JWT with RS256
 */
export async function signJwt(
  payload: JWTPayload,
  privateKey: CryptoKey,
  options?: { kid?: string; expiresIn?: number }
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)

  // Build header
  const header: JWTHeader = {
    alg: 'RS256',
    typ: 'JWT',
    ...(options?.kid && { kid: options.kid }),
  }

  // Build payload with standard claims
  const fullPayload: JWTPayload = {
    ...payload,
    iat: payload.iat ?? now,
    exp: payload.exp ?? (options?.expiresIn ? now + options.expiresIn : now + 3600),
    jti: payload.jti ?? crypto.randomUUID(),
  }

  // Encode header and payload
  const headerB64 = stringToBase64Url(JSON.stringify(header))
  const payloadB64 = stringToBase64Url(JSON.stringify(fullPayload))
  const message = `${headerB64}.${payloadB64}`

  // Sign
  const encoder = new TextEncoder()
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    privateKey,
    encoder.encode(message)
  )

  const signatureB64 = base64UrlEncode(signature)

  return `${message}.${signatureB64}`
}

// ============================================================================
// JWT VERIFICATION
// ============================================================================

export interface VerifyResult {
  valid: boolean
  payload?: JWTPayload
  header?: JWTHeader
  error?: string
}

/**
 * Verify a JWT with RS256
 */
export async function verifyJwt(token: string, publicKey: CryptoKey): Promise<VerifyResult> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid token format' }
    }

    const [headerB64, payloadB64, signatureB64] = parts

    // Decode header
    const headerJson = new TextDecoder().decode(base64UrlDecode(headerB64))
    const header = JSON.parse(headerJson) as JWTHeader

    // Verify algorithm
    if (header.alg !== 'RS256') {
      return { valid: false, error: `Unsupported algorithm: ${header.alg}` }
    }

    // Verify signature
    const message = `${headerB64}.${payloadB64}`
    const encoder = new TextEncoder()
    const signature = base64UrlDecode(signatureB64)

    const valid = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      publicKey,
      signature,
      encoder.encode(message)
    )

    if (!valid) {
      return { valid: false, error: 'Invalid signature' }
    }

    // Decode payload
    const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadB64))
    const payload = JSON.parse(payloadJson) as JWTPayload

    // Check expiration
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp && payload.exp < now) {
      return { valid: false, error: 'Token expired' }
    }

    // Check not before
    if (payload.nbf && payload.nbf > now) {
      return { valid: false, error: 'Token not yet valid' }
    }

    return { valid: true, payload, header }
  } catch (error) {
    return { valid: false, error: `Verification failed: ${(error as Error).message}` }
  }
}

/**
 * Verify JWT with JWKS (fetch public key by kid)
 */
export async function verifyJwtWithJwks(token: string, jwks: JWKS): Promise<VerifyResult> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid token format' }
    }

    const [headerB64] = parts
    const headerJson = new TextDecoder().decode(base64UrlDecode(headerB64))
    const header = JSON.parse(headerJson) as JWTHeader

    // Find matching key
    const jwk = jwks.keys.find((k) => k.kid === header.kid)
    if (!jwk) {
      return { valid: false, error: `Key not found: ${header.kid}` }
    }

    // Import public key
    const publicKey = await importPublicKeyFromJwk(jwk)

    return verifyJwt(token, publicKey)
  } catch (error) {
    return { valid: false, error: `JWKS verification failed: ${(error as Error).message}` }
  }
}

/**
 * Decode JWT without verification (for debugging)
 */
export function decodeJwt(token: string): { header: JWTHeader; payload: JWTPayload } | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [headerB64, payloadB64] = parts
    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64))) as JWTHeader
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64))) as JWTPayload

    return { header, payload }
  } catch {
    return null
  }
}

// ============================================================================
// CLERK-SPECIFIC JWT FUNCTIONS
// ============================================================================

/**
 * Create a Clerk-compatible session token
 */
export async function createSessionToken(
  privateKey: CryptoKey,
  options: {
    userId: string
    sessionId: string
    issuer: string
    audience?: string | string[]
    expiresIn?: number
    orgId?: string
    orgRole?: string
    orgSlug?: string
    orgPermissions?: string[]
    azp?: string
    kid?: string
    claims?: Record<string, unknown>
  }
): Promise<string> {
  const payload: JWTPayload = {
    sub: options.userId,
    sid: options.sessionId,
    iss: options.issuer,
    aud: options.audience,
    azp: options.azp,
    org_id: options.orgId,
    org_role: options.orgRole,
    org_slug: options.orgSlug,
    org_permissions: options.orgPermissions,
    ...options.claims,
  }

  return signJwt(payload, privateKey, {
    kid: options.kid,
    expiresIn: options.expiresIn ?? 60, // Default 60 seconds for session tokens
  })
}

/**
 * Verify a Clerk session token
 */
export async function verifySessionToken(
  token: string,
  publicKey: CryptoKey,
  options?: {
    issuer?: string
    audience?: string | string[]
    authorizedParty?: string
  }
): Promise<VerifyResult> {
  const result = await verifyJwt(token, publicKey)
  if (!result.valid || !result.payload) return result

  // Verify issuer
  if (options?.issuer && result.payload.iss !== options.issuer) {
    return { valid: false, error: `Invalid issuer: expected ${options.issuer}` }
  }

  // Verify audience
  if (options?.audience) {
    const audiences = Array.isArray(result.payload.aud)
      ? result.payload.aud
      : [result.payload.aud].filter(Boolean)
    const expectedAudiences = Array.isArray(options.audience)
      ? options.audience
      : [options.audience]
    const hasValidAudience = expectedAudiences.some((aud) => audiences.includes(aud))
    if (!hasValidAudience) {
      return { valid: false, error: 'Invalid audience' }
    }
  }

  // Verify authorized party
  if (options?.authorizedParty && result.payload.azp !== options.authorizedParty) {
    return { valid: false, error: `Invalid authorized party: expected ${options.authorizedParty}` }
  }

  return result
}

// ============================================================================
// TOKEN GENERATION HELPERS
// ============================================================================

/**
 * Generate a secure random token
 */
export function generateToken(length: number = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Generate a 6-digit TOTP code (for testing)
 */
export function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

/**
 * Generate a Clerk-style ID with prefix
 */
export function generateClerkId(prefix: string): string {
  return `${prefix}_${generateToken(16)}`
}

// ID generators for different Clerk entities
export const generateUserId = () => generateClerkId('user')
export const generateSessionId = () => generateClerkId('sess')
export const generateOrgId = () => generateClerkId('org')
export const generateInvitationId = () => generateClerkId('inv')
export const generateMembershipId = () => generateClerkId('mem')
export const generateJwtTemplateId = () => generateClerkId('jwt')
