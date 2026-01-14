/**
 * Auth Utility
 *
 * Provides authentication utilities for CLI operations including
 * session management and token access.
 */

import { getStoredToken, type StoredToken } from '../device-auth'

// ============================================================================
// Types
// ============================================================================

/**
 * Represents an authenticated user session
 */
export interface Session {
  /** Unique user identifier */
  userId: string
  /** User's email address */
  email: string
  /** Access token for API calls */
  accessToken: string
  /** ISO 8601 timestamp when the session expires */
  expiresAt: string
  /** Optional refresh token */
  refreshToken?: string
  /** Granted scopes */
  scope?: string
}

/**
 * Result of a session check
 */
export interface SessionResult {
  authenticated: boolean
  session?: Session
  error?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Decode a JWT token to extract claims (without verification)
 * Note: This only decodes, it does not verify the signature
 */
function decodeJWT(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const payload = parts[1]
    // Handle base64url decoding
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const decoded = Buffer.from(padded, 'base64').toString('utf-8')

    return JSON.parse(decoded)
  } catch {
    return null
  }
}

/**
 * Extract user information from a stored token
 */
function extractUserFromToken(token: StoredToken): { userId: string; email: string } | null {
  // Try to decode the access token as a JWT
  const claims = decodeJWT(token.access_token)

  if (claims) {
    return {
      userId: (claims.sub as string) || (claims.user_id as string) || 'unknown',
      email: (claims.email as string) || 'unknown@unknown.com',
    }
  }

  // Fallback: If not a JWT, generate a placeholder
  return {
    userId: 'user_' + token.access_token.slice(-8),
    email: 'user@example.com',
  }
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Get the current access token if available
 *
 * @returns The access token or null if not authenticated
 */
export async function getAccessToken(): Promise<string | null> {
  const token = await getStoredToken()
  return token?.access_token ?? null
}

/**
 * Check if the user is currently authenticated
 *
 * @returns True if the user has a valid session
 */
export async function isAuthenticated(): Promise<boolean> {
  const token = await getStoredToken()
  if (!token) return false

  // Check if token is expired
  if (token.expires_at && token.expires_at < Date.now()) {
    // Token expired, but might have refresh token
    if (!token.refresh_token) {
      return false
    }
    // Has refresh token, consider still authenticated (will refresh on use)
  }

  return true
}

/**
 * Get the current user session
 *
 * @returns The session if authenticated, null otherwise
 */
export async function getSession(): Promise<Session | null> {
  const token = await getStoredToken()
  if (!token) return null

  const userInfo = extractUserFromToken(token)
  if (!userInfo) return null

  // Calculate expiration
  let expiresAt: string
  if (token.expires_at) {
    expiresAt = new Date(token.expires_at).toISOString()
  } else {
    // Default to 1 hour from now if no expiration
    expiresAt = new Date(Date.now() + 3600000).toISOString()
  }

  return {
    userId: userInfo.userId,
    email: userInfo.email,
    accessToken: token.access_token,
    expiresAt,
    refreshToken: token.refresh_token,
    scope: token.scope,
  }
}

/**
 * Check session and return detailed result
 *
 * @returns Session result with authentication status
 */
export async function checkSession(): Promise<SessionResult> {
  try {
    const session = await getSession()

    if (!session) {
      return {
        authenticated: false,
        error: 'No active session. Please login first.',
      }
    }

    // Check if session is expired
    const expiresAt = new Date(session.expiresAt).getTime()
    if (expiresAt <= Date.now()) {
      if (session.refreshToken) {
        // Session expired but has refresh token
        return {
          authenticated: true,
          session,
          error: 'Session expired. Token refresh may be required.',
        }
      }
      return {
        authenticated: false,
        error: 'Session expired. Please login again.',
      }
    }

    return {
      authenticated: true,
      session,
    }
  } catch (error) {
    return {
      authenticated: false,
      error: error instanceof Error ? error.message : 'Failed to check session',
    }
  }
}

/**
 * Get session or throw if not authenticated
 *
 * @throws Error if not authenticated
 * @returns The current session
 */
export async function requireSession(): Promise<Session> {
  const result = await checkSession()

  if (!result.authenticated || !result.session) {
    throw new Error(result.error || 'Not authenticated. Please login first.')
  }

  return result.session
}
