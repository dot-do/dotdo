/**
 * Token Extraction Utilities
 *
 * Functions to extract authentication credentials from HTTP headers.
 * Supports multiple authentication methods:
 * - Session cookies (Better Auth session tokens)
 * - Bearer tokens (JWT or opaque tokens)
 * - API keys (X-API-Key header)
 */

// ============================================================================
// Constants
// ============================================================================

/** Default Better Auth session cookie name */
const SESSION_COOKIE_NAME = 'better-auth.session_token'

/** Default API key header name */
const API_KEY_HEADER = 'x-api-key'

// ============================================================================
// Credential Types
// ============================================================================

/**
 * Extracted credentials with type discrimination.
 */
export type ExtractedCredentials =
  | { type: 'session'; token: string }
  | { type: 'bearer'; token: string }
  | { type: 'apiKey'; token: string }

// ============================================================================
// Cookie Parsing
// ============================================================================

/**
 * Parse a cookie header string into key-value pairs.
 * Handles URL-encoded values.
 *
 * @param cookieHeader - The Cookie header value
 * @returns Map of cookie name to value
 */
function parseCookies(cookieHeader: string): Map<string, string> {
  const cookies = new Map<string, string>()

  const pairs = cookieHeader.split(';')
  for (const pair of pairs) {
    const trimmed = pair.trim()
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex > 0) {
      const name = trimmed.substring(0, eqIndex)
      const value = trimmed.substring(eqIndex + 1)
      cookies.set(name, value)
    }
  }

  return cookies
}

// ============================================================================
// Session Cookie Extraction
// ============================================================================

/**
 * Extract session token from cookie header.
 * Looks for the Better Auth session cookie (better-auth.session_token).
 * Handles URL-encoded tokens.
 *
 * @param headers - HTTP Headers object
 * @returns Session token if found, null otherwise
 *
 * @example
 * ```ts
 * const headers = new Headers({ cookie: 'better-auth.session_token=abc123' })
 * const token = extractSessionFromCookie(headers)
 * // token === 'abc123'
 * ```
 */
export function extractSessionFromCookie(headers: Headers): string | null {
  const cookieHeader = headers.get('cookie')
  if (!cookieHeader) {
    return null
  }

  const cookies = parseCookies(cookieHeader)
  const sessionToken = cookies.get(SESSION_COOKIE_NAME)

  if (!sessionToken) {
    return null
  }

  // Decode URL-encoded values (e.g., %20 -> space)
  try {
    return decodeURIComponent(sessionToken)
  } catch {
    // If decoding fails, return the raw value
    return sessionToken
  }
}

// ============================================================================
// Bearer Token Extraction
// ============================================================================

/**
 * Extract bearer token from Authorization header.
 * Case-insensitive "Bearer" prefix matching.
 * Returns null for empty tokens or non-Bearer auth schemes.
 *
 * @param headers - HTTP Headers object
 * @returns Bearer token if found, null otherwise
 *
 * @example
 * ```ts
 * const headers = new Headers({ authorization: 'Bearer xyz789' })
 * const token = extractBearerToken(headers)
 * // token === 'xyz789'
 * ```
 */
export function extractBearerToken(headers: Headers): string | null {
  const authHeader = headers.get('authorization')
  if (!authHeader) {
    return null
  }

  // Check for Bearer prefix (case-insensitive)
  const lowerAuth = authHeader.toLowerCase()
  if (!lowerAuth.startsWith('bearer ')) {
    return null
  }

  // Extract token after "Bearer " (7 characters)
  const token = authHeader.substring(7)

  // Return null for empty tokens
  if (!token || token.trim() === '') {
    return null
  }

  return token
}

// ============================================================================
// API Key Extraction
// ============================================================================

/**
 * Extract API key from X-API-Key header.
 * Header name is case-insensitive.
 * Returns null for empty API keys.
 *
 * @param headers - HTTP Headers object
 * @returns API key if found, null otherwise
 *
 * @example
 * ```ts
 * const headers = new Headers({ 'x-api-key': 'key_abc123' })
 * const key = extractApiKey(headers)
 * // key === 'key_abc123'
 * ```
 */
export function extractApiKey(headers: Headers): string | null {
  const apiKey = headers.get(API_KEY_HEADER)

  // Return null for missing or empty API keys
  if (!apiKey || apiKey === '') {
    return null
  }

  return apiKey
}

// ============================================================================
// Combined Credential Extraction
// ============================================================================

/**
 * Extract credentials from headers using multiple methods.
 * Tries extraction methods in order:
 * 1. Session cookie (better-auth.session_token)
 * 2. Bearer token (Authorization: Bearer)
 * 3. API key (X-API-Key)
 *
 * Returns the first successful extraction with type discrimination.
 *
 * @param headers - HTTP Headers object
 * @returns Credentials with type, or null if none found
 *
 * @example
 * ```ts
 * const headers = new Headers({
 *   cookie: 'better-auth.session_token=session123',
 *   authorization: 'Bearer jwt456',
 * })
 * const creds = extractCredentials(headers)
 * // creds === { type: 'session', token: 'session123' }
 * ```
 */
export function extractCredentials(headers: Headers): ExtractedCredentials | null {
  // Try session cookie first
  const sessionToken = extractSessionFromCookie(headers)
  if (sessionToken) {
    return { type: 'session', token: sessionToken }
  }

  // Try bearer token second
  const bearerToken = extractBearerToken(headers)
  if (bearerToken) {
    return { type: 'bearer', token: bearerToken }
  }

  // Try API key last
  const apiKey = extractApiKey(headers)
  if (apiKey) {
    return { type: 'apiKey', token: apiKey }
  }

  // No credentials found
  return null
}
