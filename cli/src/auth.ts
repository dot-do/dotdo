/**
 * CLI Authentication
 *
 * Handles authentication for CLI service commands.
 * Uses tokens stored by device-auth.ts (via oauth.do)
 */

import { getStoredToken } from '../device-auth'
import { AuthError as BaseAuthError } from '../utils/errors'

// Re-export AuthError for backward compatibility
export { AuthError } from '../utils/errors'

/**
 * Get the current access token or throw if not logged in
 */
export async function getAccessToken(): Promise<string> {
  const token = await getStoredToken()

  if (!token) {
    throw BaseAuthError.notLoggedIn()
  }

  // Check if token is expired (without refresh token)
  if (token.expires_at && token.expires_at < Date.now() && !token.refresh_token) {
    throw BaseAuthError.expired()
  }

  return token.access_token
}

/**
 * Get authorization headers for API requests
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken()
  return {
    Authorization: `Bearer ${token}`,
  }
}

/**
 * Check if user is logged in (without throwing)
 */
export async function isLoggedIn(): Promise<boolean> {
  try {
    await getAccessToken()
    return true
  } catch {
    return false
  }
}
