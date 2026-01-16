/**
 * Capability Token System
 *
 * HMAC-signed capability tokens for three-party handoff scenarios:
 * - Auth service creates token with shared secret
 * - Broker passes token opaquely (cannot verify or forge)
 * - Worker verifies token with shared secret
 *
 * Token format: base64(payload).base64(signature)
 * - payload: JSON with target, methods, scope, exp, sub, iat
 * - signature: HMAC-SHA256(payload, secret)
 *
 * This complements the object-based capability system in capability.ts
 * for distributed scenarios where capabilities must be transferred as opaque tokens.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Capability payload - the data contained in a capability token
 */
export interface CapabilityPayload {
  /** Worker ID this grants access to */
  target: string
  /** Allowed methods ('*' for all) */
  methods: string[]
  /** Permission scope: read < write < admin */
  scope: 'read' | 'write' | 'admin'
  /** Expiry timestamp (ms since epoch) */
  exp: number
  /** Subject (user ID or service ID) */
  sub?: string
  /** Issued at timestamp (ms since epoch) */
  iat?: number
}

/**
 * Error codes for capability token failures
 */
export type CapabilityErrorCode =
  | 'EXPIRED'
  | 'INVALID_SIGNATURE'
  | 'WRONG_TARGET'
  | 'INSUFFICIENT_SCOPE'
  | 'SECRET_REQUIRED'  // No capability secret configured to verify tokens

/**
 * Custom error class for capability token failures
 */
export class CapabilityError extends Error {
  constructor(
    message: string,
    public readonly code: CapabilityErrorCode
  ) {
    super(message)
    this.name = 'CapabilityError'
    // Maintain proper stack trace in V8 environments
    const ErrorWithStackTrace = Error as typeof Error & {
      captureStackTrace?: (targetObject: object, constructorOpt?: Function) => void
    }
    if (ErrorWithStackTrace.captureStackTrace) {
      ErrorWithStackTrace.captureStackTrace(this, CapabilityError)
    }
  }
}

// =============================================================================
// Scope Hierarchy
// =============================================================================

/**
 * Scope levels for permission comparison
 * Higher number = more permissions
 */
const SCOPE_LEVELS: Record<'read' | 'write' | 'admin', number> = {
  read: 1,
  write: 2,
  admin: 3,
}

// =============================================================================
// Web Crypto Helpers
// =============================================================================

const encoder = new TextEncoder()

/**
 * Import a secret key for HMAC operations
 */
async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

/**
 * Create HMAC-SHA256 signature
 */
async function signHmac(data: string, key: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.sign('HMAC', key, encoder.encode(data))
}

/**
 * Verify HMAC-SHA256 signature
 */
async function verifyHmac(
  data: string,
  signature: ArrayBuffer,
  key: CryptoKey
): Promise<boolean> {
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(data))
}

/**
 * Convert ArrayBuffer to base64url string
 */
function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  // Convert to base64url (URL-safe base64)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/**
 * Convert base64url string to ArrayBuffer
 */
function base64UrlToArrayBuffer(base64url: string): ArrayBuffer {
  // Convert from base64url to standard base64
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  // Add padding if needed
  while (base64.length % 4) {
    base64 += '='
  }
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

/**
 * Encode payload to base64url
 */
function encodePayload(payload: CapabilityPayload): string {
  const json = JSON.stringify(payload)
  // Convert to base64url
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/**
 * Decode payload from base64url
 */
function decodePayload(encoded: string): CapabilityPayload {
  // Convert from base64url to standard base64
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  // Add padding if needed
  while (base64.length % 4) {
    base64 += '='
  }
  const json = atob(base64)
  return JSON.parse(json) as CapabilityPayload
}

// =============================================================================
// Token Operations
// =============================================================================

/**
 * Create a capability token with HMAC-SHA256 signature
 *
 * @param payload - Capability payload (target, methods, scope, exp, etc.)
 * @param secret - Shared secret for HMAC signing
 * @returns Token string: base64url(payload).base64url(signature)
 */
export async function createCapabilityToken(
  payload: CapabilityPayload,
  secret: string
): Promise<string> {
  // Add iat (issued at) if not provided
  const fullPayload: CapabilityPayload = {
    ...payload,
    iat: payload.iat ?? Date.now(),
  }

  // Encode payload
  const encodedPayload = encodePayload(fullPayload)

  // Create signature
  const key = await importHmacKey(secret)
  const signature = await signHmac(encodedPayload, key)
  const encodedSignature = arrayBufferToBase64Url(signature)

  return `${encodedPayload}.${encodedSignature}`
}

/**
 * Verify a capability token and return the payload
 *
 * @param token - Token string to verify
 * @param secret - Shared secret for HMAC verification
 * @returns Verified capability payload
 * @throws CapabilityError if token is invalid, expired, or tampered
 */
export async function verifyCapabilityToken(
  token: string,
  secret: string
): Promise<CapabilityPayload> {
  // Split token into parts
  const parts = token.split('.')
  if (parts.length !== 2) {
    throw new CapabilityError(
      'Invalid token format: expected payload.signature',
      'INVALID_SIGNATURE'
    )
  }

  const [encodedPayload, encodedSignature] = parts

  if (!encodedPayload || !encodedSignature) {
    throw new CapabilityError(
      'Invalid token format: empty payload or signature',
      'INVALID_SIGNATURE'
    )
  }

  // Verify signature first
  const key = await importHmacKey(secret)
  let signatureBuffer: ArrayBuffer
  try {
    signatureBuffer = base64UrlToArrayBuffer(encodedSignature)
  } catch (err) {
    // Signature decode failed - may indicate tampering
    console.warn('[RPC/Token] Malformed signature in capability token:', (err as Error).message)
    throw new CapabilityError(
      'Invalid token format: malformed signature',
      'INVALID_SIGNATURE'
    )
  }

  const isValid = await verifyHmac(encodedPayload, signatureBuffer, key)
  if (!isValid) {
    throw new CapabilityError(
      'Token signature verification failed',
      'INVALID_SIGNATURE'
    )
  }

  // Parse payload
  let payload: CapabilityPayload
  try {
    payload = decodePayload(encodedPayload)
  } catch (err) {
    // Payload decode failed after signature verified - may indicate corruption
    console.warn('[RPC/Token] Malformed payload in capability token:', (err as Error).message)
    throw new CapabilityError(
      'Invalid token format: malformed payload',
      'INVALID_SIGNATURE'
    )
  }

  // Check expiry
  if (payload.exp < Date.now()) {
    throw new CapabilityError('Token has expired', 'EXPIRED')
  }

  return payload
}

/**
 * Attenuate a capability token (reduce permissions)
 *
 * Creates a new token with reduced permissions. The new token:
 * - Cannot have more methods than the original
 * - Cannot have higher scope than the original
 * - Cannot have later expiry than the original
 *
 * @param token - Original capability token
 * @param secret - Shared secret for verification and signing
 * @param restrictions - Restrictions to apply (can only reduce, not expand)
 * @returns New attenuated token
 * @throws CapabilityError if attempting to escalate privileges
 */
export async function attenuateCapability(
  token: string,
  secret: string,
  restrictions: Partial<Pick<CapabilityPayload, 'methods' | 'scope' | 'exp'>>
): Promise<string> {
  // Verify the original token first
  const original = await verifyCapabilityToken(token, secret)

  // Validate restrictions don't escalate
  if (restrictions.methods) {
    // Check all requested methods are in original
    for (const method of restrictions.methods) {
      if (method !== '*' && !original.methods.includes(method) && !original.methods.includes('*')) {
        throw new CapabilityError(
          `Cannot attenuate: method '${method}' exceeds parent permissions`,
          'INSUFFICIENT_SCOPE'
        )
      }
    }
  }

  if (restrictions.scope) {
    // Check scope is not escalating
    if (SCOPE_LEVELS[restrictions.scope] > SCOPE_LEVELS[original.scope]) {
      throw new CapabilityError(
        `Cannot attenuate: scope '${restrictions.scope}' exceeds parent scope '${original.scope}'`,
        'INSUFFICIENT_SCOPE'
      )
    }
  }

  if (restrictions.exp !== undefined) {
    // Check expiry is not being extended
    if (restrictions.exp > original.exp) {
      throw new CapabilityError(
        'Cannot attenuate: expiry cannot be extended',
        'INSUFFICIENT_SCOPE'
      )
    }
  }

  // Create new payload with restrictions applied
  const attenuatedPayload: CapabilityPayload = {
    target: original.target,
    methods: restrictions.methods ?? original.methods,
    scope: restrictions.scope ?? original.scope,
    exp: restrictions.exp ?? original.exp,
    sub: original.sub,
    iat: Date.now(), // New iat for the attenuated token
  }

  return createCapabilityToken(attenuatedPayload, secret)
}

// =============================================================================
// Authorization Helpers
// =============================================================================

/**
 * Check if a method is allowed by the capability
 *
 * @param capability - Capability payload
 * @param method - Method name to check
 * @returns true if method is allowed
 */
export function isMethodAllowed(capability: CapabilityPayload, method: string): boolean {
  // Wildcard allows all methods
  if (capability.methods.includes('*')) {
    return true
  }
  return capability.methods.includes(method)
}

/**
 * Check if the capability's scope allows the required operation
 *
 * Scope hierarchy: read < write < admin
 * - read: can only perform read operations
 * - write: can perform read and write operations
 * - admin: can perform all operations
 *
 * @param capability - Capability payload
 * @param requiredScope - Minimum required scope for the operation
 * @returns true if scope is sufficient
 */
export function isScopeAllowed(
  capability: CapabilityPayload,
  requiredScope: 'read' | 'write' | 'admin'
): boolean {
  return SCOPE_LEVELS[capability.scope] >= SCOPE_LEVELS[requiredScope]
}
