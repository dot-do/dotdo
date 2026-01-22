/**
 * @dotdo/oauth PKCE Implementation
 *
 * Proof Key for Code Exchange (PKCE) as defined in RFC 7636.
 * Uses Web Crypto API for Workers compatibility - zero Node.js dependencies.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7636
 * @module @dotdo/oauth/pkce
 */

import type { PKCEMethod, PKCEPair } from './types'

/**
 * Encode a Uint8Array to base64url string (no padding).
 *
 * @param buffer - The buffer to encode
 * @returns Base64url encoded string
 */
function base64urlEncode(buffer: Uint8Array): string {
  // Convert to base64
  let binary = ''
  for (let i = 0; i < buffer.length; i++) {
    // We know buffer[i] exists because i < buffer.length
    binary += String.fromCharCode(buffer[i]!)
  }
  const base64 = btoa(binary)

  // Convert to base64url (replace + with -, / with _, remove padding)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Generate a cryptographically random code verifier.
 *
 * Per RFC 7636:
 * - MUST be between 43 and 128 characters
 * - MUST use only [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
 *
 * We generate 32 bytes of random data and base64url encode it,
 * resulting in a 43-character verifier (perfect minimum length).
 *
 * @param byteLength - Number of random bytes (default 32, resulting in 43 chars)
 * @returns Promise resolving to the code verifier
 */
export async function generateVerifier(byteLength: number = 32): Promise<string> {
  // Validate byte length (43-128 chars = 32-96 bytes approximately)
  const minBytes = 32 // Results in 43 chars
  const maxBytes = 96 // Results in 128 chars

  const actualBytes = Math.max(minBytes, Math.min(maxBytes, byteLength))

  const array = new Uint8Array(actualBytes)
  crypto.getRandomValues(array)

  return base64urlEncode(array)
}

/**
 * Create a code challenge from a verifier using the specified method.
 *
 * Per RFC 7636:
 * - S256: BASE64URL(SHA256(code_verifier))
 * - plain: code_verifier (NOT recommended, only for backwards compatibility)
 *
 * @param verifier - The code verifier
 * @param method - The challenge method ('S256' or 'plain')
 * @returns Promise resolving to the code challenge
 */
export async function createChallenge(
  verifier: string,
  method: PKCEMethod = 'S256'
): Promise<string> {
  if (method === 'plain') {
    return verifier
  }

  // S256: SHA-256 hash of the verifier, base64url encoded
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)

  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer)

  return base64urlEncode(hashArray)
}

/**
 * Generate a complete PKCE pair (verifier + challenge).
 *
 * This is the primary function for initiating an OAuth 2.1 authorization flow.
 * Store the verifier securely and send the challenge with the authorization request.
 *
 * @param method - The challenge method (default 'S256')
 * @returns Promise resolving to the PKCE pair
 *
 * @example
 * ```typescript
 * const { verifier, challenge, method } = await generatePKCE()
 *
 * // Store verifier securely (e.g., session storage)
 * sessionStorage.setItem('pkce_verifier', verifier)
 *
 * // Send challenge with authorization request
 * const authUrl = new URL('/authorize', provider)
 * authUrl.searchParams.set('code_challenge', challenge)
 * authUrl.searchParams.set('code_challenge_method', method)
 * ```
 */
export async function generatePKCE(method: PKCEMethod = 'S256'): Promise<PKCEPair> {
  const verifier = await generateVerifier()
  const challenge = await createChallenge(verifier, method)

  return {
    verifier,
    challenge,
    method,
  }
}

/**
 * Validate a PKCE code verifier against a stored challenge.
 *
 * This is used by the authorization server to verify the token request.
 *
 * @param verifier - The code verifier from the token request
 * @param challenge - The stored code challenge from the authorization request
 * @param method - The challenge method used
 * @returns Promise resolving to true if valid, false otherwise
 *
 * @example
 * ```typescript
 * const isValid = await validatePKCE(
 *   request.code_verifier,
 *   storedChallenge,
 *   'S256'
 * )
 *
 * if (!isValid) {
 *   throw new Error('Invalid PKCE verifier')
 * }
 * ```
 */
export async function validatePKCE(
  verifier: string,
  challenge: string,
  method: PKCEMethod
): Promise<boolean> {
  // Reject empty inputs
  if (!verifier || !challenge) {
    return false
  }

  // Compute the expected challenge from the verifier
  const expectedChallenge = await createChallenge(verifier, method)

  // Constant-time comparison to prevent timing attacks
  return timingSafeEqual(expectedChallenge, challenge)
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
  // Remember original lengths before any manipulation
  const aLen = a.length
  const bLen = b.length

  // Use the longer length for comparison (prevents early exit)
  const maxLen = Math.max(aLen, bLen)

  let result = 0

  // Compare characters up to maxLen
  for (let i = 0; i < maxLen; i++) {
    const charA = i < aLen ? a.charCodeAt(i) : 0
    const charB = i < bLen ? b.charCodeAt(i) : 0
    result |= charA ^ charB
  }

  // Include length comparison in result
  result |= aLen ^ bLen

  return result === 0
}

// Re-export types
export type { PKCEMethod, PKCEPair }
