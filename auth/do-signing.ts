/**
 * DO-to-DO Authentication Signing
 *
 * Provides HMAC-based signing for secure DO-to-DO communication.
 * This module is used by @dotdo/rpc to sign requests between Durable Objects.
 *
 * Trust model:
 * - DO-to-DO calls are signed with HMAC-SHA256 using a shared secret
 * - Signatures include timestamp to prevent replay attacks
 * - The receiving DO verifies the signature before trusting the caller
 *
 * @module @dotdo/auth/do-signing
 */

// ============================================================================
// Header Constants
// These are defined here to avoid circular dependencies with @dotdo/rpc.
// They must match the values in @dotdo/rpc/headers.ts.
// ============================================================================

/**
 * Header indicating the request is from another DO
 */
export const DO_SOURCE_HEADER = 'X-DO-Source'

/**
 * Header containing the source DO's ID
 */
export const DO_SOURCE_ID_HEADER = 'X-DO-Source-ID'

/**
 * Header containing HMAC signature for DO-to-DO authentication
 * This prevents header spoofing by external clients
 */
export const DO_SIGNATURE_HEADER = 'X-DO-Signature'

/**
 * Header containing timestamp for signature validation (prevents replay attacks)
 */
export const DO_TIMESTAMP_HEADER = 'X-DO-Timestamp'

/** Header name for correlation ID */
export const CORRELATION_ID_HEADER = 'X-Correlation-ID'

// ============================================================================
// HMAC Signing for DO-to-DO Authentication
// ============================================================================

/**
 * Maximum age of a signature in milliseconds (5 minutes)
 */
export const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000

/**
 * Internal secret for DO-to-DO HMAC signing
 * This should be set via setDOInternalSecret() before use
 */
let doInternalSecret: string | null = null

/**
 * Set the internal secret used for DO-to-DO HMAC signing
 * This must be called during Worker/DO initialization with a secret from env
 *
 * @example
 * ```typescript
 * // In your Worker/DO initialization
 * setDOInternalSecret(env.DO_INTERNAL_SECRET)
 * ```
 */
export function setDOInternalSecret(secret: string): void {
  if (!secret || secret.length < 32) {
    throw new Error('DO_INTERNAL_SECRET must be at least 32 characters')
  }
  doInternalSecret = secret
}

/**
 * Get the current internal secret (for testing purposes)
 * @internal
 */
export function getDOInternalSecret(): string | null {
  return doInternalSecret
}

/**
 * Clear the internal secret (for testing purposes)
 * @internal
 */
export function clearDOInternalSecret(): void {
  doInternalSecret = null
}

/**
 * Generate HMAC-SHA256 signature for DO-to-DO request
 * @internal
 */
export async function generateHmacSignature(
  secret: string,
  sourceDoId: string,
  timestamp: string,
  targetPath?: string
): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  // Message format: sourceDoId|timestamp|targetPath
  const message = `${sourceDoId}|${timestamp}|${targetPath || ''}`
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))

  // Convert to base64
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
}

/**
 * Verify HMAC-SHA256 signature for DO-to-DO request
 * @internal
 */
export async function verifyHmacSignature(
  secret: string,
  sourceDoId: string,
  timestamp: string,
  signature: string,
  targetPath?: string
): Promise<boolean> {
  try {
    const expectedSignature = await generateHmacSignature(secret, sourceDoId, timestamp, targetPath)
    // Constant-time comparison to prevent timing attacks
    if (signature.length !== expectedSignature.length) {
      return false
    }
    let result = 0
    for (let i = 0; i < signature.length; i++) {
      result |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i)
    }
    return result === 0
  } catch {
    return false
  }
}

/**
 * Verify DO-to-DO request signature
 * Returns true if the request has a valid signature, false otherwise
 *
 * @param request - The incoming request to verify
 * @param logger - Optional logger for warning messages
 * @returns Promise<boolean> - true if signature is valid, false otherwise
 */
export async function verifyDOSignature(
  request: Request,
  logger?: { warn: (...args: unknown[]) => void }
): Promise<boolean> {
  if (!doInternalSecret) {
    logger?.warn('DO_INTERNAL_SECRET not configured - DO-to-DO verification disabled')
    return false
  }

  const signature = request.headers.get(DO_SIGNATURE_HEADER)
  const timestamp = request.headers.get(DO_TIMESTAMP_HEADER)
  const sourceDoId = request.headers.get(DO_SOURCE_ID_HEADER)

  if (!signature || !timestamp || !sourceDoId) {
    return false
  }

  // Check timestamp to prevent replay attacks
  const timestampMs = parseInt(timestamp, 10)
  if (isNaN(timestampMs)) {
    return false
  }

  const now = Date.now()
  if (Math.abs(now - timestampMs) > SIGNATURE_MAX_AGE_MS) {
    return false
  }

  // Extract path from URL for signature verification
  const url = new URL(request.url)
  const targetPath = url.pathname

  return verifyHmacSignature(doInternalSecret, sourceDoId, timestamp, signature, targetPath)
}

/**
 * Generate HMAC signature for DO-to-DO request headers
 * @internal
 */
async function signDORequest(
  sourceDoId: string,
  timestamp: string,
  targetPath?: string
): Promise<string> {
  if (!doInternalSecret) {
    throw new Error('DO_INTERNAL_SECRET not configured - call setDOInternalSecret() first')
  }

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(doInternalSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const message = `${sourceDoId}|${timestamp}|${targetPath || ''}`
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))

  return btoa(String.fromCharCode(...new Uint8Array(signature)))
}

/**
 * Add DO source headers to a request for cross-DO calls (with HMAC signature)
 * Call this when making requests from one DO to another
 *
 * @example
 * ```typescript
 * const headers = await addDOSourceHeaders(new Headers(), 'my-do-id', '/rpc')
 * const response = await otherDO.fetch('https://do/rpc', {
 *   headers,
 * })
 * ```
 *
 * @deprecated Use addDOSourceHeadersAsync for clarity - this function is now async
 */
export async function addDOSourceHeaders(
  headers: Headers,
  sourceDoId: string,
  targetPath?: string,
  logger?: { warn: (...args: unknown[]) => void }
): Promise<Headers> {
  const timestamp = Date.now().toString()

  headers.set(DO_SOURCE_HEADER, 'true')
  headers.set(DO_SOURCE_ID_HEADER, sourceDoId)
  headers.set(DO_TIMESTAMP_HEADER, timestamp)

  try {
    const signature = await signDORequest(sourceDoId, timestamp, targetPath)
    headers.set(DO_SIGNATURE_HEADER, signature)
  } catch (error) {
    logger?.warn('Failed to sign DO-to-DO request:', error)
    // Still set the headers without signature for backwards compatibility
    // but the receiver will reject it if DO_INTERNAL_SECRET is configured
  }

  return headers
}

/**
 * Add DO source headers to a request for cross-DO calls (with HMAC signature)
 * Async version with explicit naming
 *
 * @example
 * ```typescript
 * const headers = await addDOSourceHeadersAsync(new Headers(), 'my-do-id', '/rpc')
 * const response = await otherDO.fetch('https://do/rpc', {
 *   headers,
 * })
 * ```
 */
export async function addDOSourceHeadersAsync(
  headers: Headers,
  sourceDoId: string,
  targetPath?: string,
  logger?: { warn: (...args: unknown[]) => void }
): Promise<Headers> {
  return addDOSourceHeaders(headers, sourceDoId, targetPath, logger)
}

/**
 * Create headers for a DO-to-DO request (with HMAC signature)
 *
 * @example
 * ```typescript
 * const headers = await createDOToDoHeaders('source-do-123', '/rpc', 'corr-123')
 * const response = await otherDO.fetch('https://do/rpc', {
 *   method: 'POST',
 *   headers,
 *   body: JSON.stringify({ ... }),
 * })
 * ```
 */
export async function createDOToDoHeaders(
  sourceDoId: string,
  targetPath?: string,
  correlationId?: string,
  logger?: { warn: (...args: unknown[]) => void }
): Promise<Headers> {
  const timestamp = Date.now().toString()

  const headers = new Headers({
    'Content-Type': 'application/json',
    [DO_SOURCE_HEADER]: 'true',
    [DO_SOURCE_ID_HEADER]: sourceDoId,
    [DO_TIMESTAMP_HEADER]: timestamp,
  })

  try {
    const signature = await signDORequest(sourceDoId, timestamp, targetPath)
    headers.set(DO_SIGNATURE_HEADER, signature)
  } catch (error) {
    logger?.warn('Failed to sign DO-to-DO request:', error)
  }

  if (correlationId) {
    headers.set(CORRELATION_ID_HEADER, correlationId)
  }

  return headers
}
