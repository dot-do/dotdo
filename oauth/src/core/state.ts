/**
 * @dotdo/oauth State Token Implementation
 *
 * State parameter utilities for OAuth 2.1 CSRF protection.
 * Uses Web Crypto API for Workers compatibility - zero Node.js dependencies.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-10.12
 * @module @dotdo/oauth/state
 */

import type { StateMetadata } from './types'

/**
 * Encode a Uint8Array to base64url string (no padding).
 *
 * @param buffer - The buffer to encode
 * @returns Base64url encoded string
 */
function base64urlEncode(buffer: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < buffer.length; i++) {
    // We know buffer[i] exists because i < buffer.length
    binary += String.fromCharCode(buffer[i]!)
  }
  const base64 = btoa(binary)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Decode a base64url string to Uint8Array.
 *
 * @param str - The base64url string to decode
 * @returns Decoded Uint8Array
 */
function base64urlDecode(str: string): Uint8Array {
  // Add padding if needed
  const padding = '='.repeat((4 - (str.length % 4)) % 4)
  // Convert base64url to base64
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/') + padding
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Generate a cryptographically random state token.
 *
 * The state parameter is used to prevent CSRF attacks during OAuth flows.
 * It should be stored server-side and validated when the callback is received.
 *
 * @param byteLength - Number of random bytes (default 32, resulting in 43 chars)
 * @returns Promise resolving to the state token
 *
 * @example
 * ```typescript
 * const state = await generateState()
 *
 * // Store state in session
 * session.set('oauth_state', state)
 *
 * // Include in authorization URL
 * authUrl.searchParams.set('state', state)
 * ```
 */
export async function generateState(byteLength: number = 32): Promise<string> {
  const array = new Uint8Array(byteLength)
  crypto.getRandomValues(array)
  return base64urlEncode(array)
}

/**
 * Validate that the received state matches the expected state.
 *
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * @param received - The state received in the callback
 * @param expected - The state stored in the session
 * @returns true if states match, false otherwise
 *
 * @example
 * ```typescript
 * const expectedState = session.get('oauth_state')
 * const receivedState = url.searchParams.get('state')
 *
 * if (!validateState(receivedState, expectedState)) {
 *   throw new Error('Invalid state parameter - possible CSRF attack')
 * }
 * ```
 */
export function validateState(received: string, expected: string): boolean {
  // Reject empty inputs
  if (!received || !expected) {
    return false
  }

  return timingSafeEqual(received, expected)
}

/**
 * Perform a timing-safe string comparison.
 *
 * This prevents timing attacks by ensuring the comparison takes
 * the same amount of time regardless of where the strings differ.
 *
 * @param a - First string
 * @param b - Second string
 * @returns true if strings are equal, false otherwise
 */
function timingSafeEqual(a: string, b: string): boolean {
  // Get the longer length for comparison
  const length = Math.max(a.length, b.length)

  let result = 0

  // Compare each character
  for (let i = 0; i < length; i++) {
    const charA = i < a.length ? a.charCodeAt(i) : 0
    const charB = i < b.length ? b.charCodeAt(i) : 0
    result |= charA ^ charB
  }

  // Also compare lengths
  result |= a.length ^ b.length

  return result === 0
}

/**
 * Create a state token with embedded metadata.
 *
 * The metadata is base64url encoded and can be extracted later.
 * A random nonce is automatically included for uniqueness.
 *
 * @param metadata - Custom metadata to embed
 * @returns Promise resolving to the state token with metadata
 *
 * @example
 * ```typescript
 * const state = await createStateWithMetadata({
 *   redirectUri: '/dashboard',
 *   provider: 'github'
 * })
 * ```
 */
export async function createStateWithMetadata(
  metadata: Record<string, unknown>
): Promise<string> {
  // Generate a random nonce for uniqueness
  const nonceArray = new Uint8Array(16)
  crypto.getRandomValues(nonceArray)
  const nonce = base64urlEncode(nonceArray)

  // Add nonce to metadata
  const fullMetadata: StateMetadata = {
    ...metadata,
    _nonce: nonce,
  }

  // Encode metadata to JSON then base64url
  const json = JSON.stringify(fullMetadata)
  const encoder = new TextEncoder()
  const bytes = encoder.encode(json)

  return base64urlEncode(bytes)
}

/**
 * Parse metadata from a state token.
 *
 * @param state - The state token
 * @returns The parsed metadata, or null if invalid
 *
 * @example
 * ```typescript
 * const metadata = parseStateMetadata(state)
 * if (metadata) {
 *   redirect(metadata.redirectUri)
 * }
 * ```
 */
export function parseStateMetadata(state: string): StateMetadata | null {
  try {
    const bytes = base64urlDecode(state)
    const decoder = new TextDecoder()
    const json = decoder.decode(bytes)
    const metadata = JSON.parse(json)

    // Validate it's an object with a nonce
    if (typeof metadata !== 'object' || metadata === null || !metadata._nonce) {
      return null
    }

    return metadata as StateMetadata
  } catch {
    return null
  }
}

/**
 * Create a state token with an expiration timestamp.
 *
 * @param expiresInSeconds - Seconds until expiration
 * @returns Promise resolving to the state token with expiration
 *
 * @example
 * ```typescript
 * // State expires in 5 minutes
 * const state = await createStateWithExpiry(300)
 * ```
 */
export async function createStateWithExpiry(
  expiresInSeconds: number
): Promise<string> {
  const expiresAt = Date.now() + expiresInSeconds * 1000

  return createStateWithMetadata({
    _exp: expiresAt,
  })
}

/**
 * Check if a state token has expired.
 *
 * Returns true for invalid state formats (fail-safe behavior).
 *
 * @param state - The state token to check
 * @returns true if expired or invalid, false if still valid
 *
 * @example
 * ```typescript
 * if (isStateExpired(state)) {
 *   throw new Error('State token has expired')
 * }
 * ```
 */
export function isStateExpired(state: string): boolean {
  const metadata = parseStateMetadata(state)

  // Invalid state is considered expired (fail-safe)
  if (!metadata) {
    return true
  }

  // No expiration set means not expired
  if (typeof metadata._exp !== 'number') {
    return false
  }

  return Date.now() > metadata._exp
}

// Re-export types
export type { StateMetadata }
