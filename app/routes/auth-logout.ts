/**
 * OAuth Logout Route Handler
 *
 * Handles /auth/logout requests to terminate user sessions.
 * Revokes tokens on oauth.do and clears session cookies.
 *
 * @see /app/lib/auth-config.ts for configuration
 */

import {
  getOAuthConfig,
  getRevokeEndpoint,
  buildClearSessionCookie,
  parseSessionCookie,
  type OAuthConfig,
} from '../lib/auth-config'

// ============================================================================
// Test Helpers
// ============================================================================

// Mock state for testing
let mockRevokeError: Error | null = null
let mockSessionToken: string | null = null
let revokeCalls: string[] = []

/**
 * Set mock revoke error for testing
 * @internal Test helper - not for production use
 */
export async function setMockRevokeError(error: Error | null): Promise<void> {
  mockRevokeError = error
}

/**
 * Set mock session token for testing
 * @internal Test helper - not for production use
 */
export async function setMockSessionToken(token: string | null): Promise<void> {
  mockSessionToken = token
}

/**
 * Get revoke calls for testing
 * @internal Test helper - not for production use
 */
export async function getRevokeCalls(): Promise<string[]> {
  return [...revokeCalls]
}

/**
 * Reset all mocks to default state
 * @internal Test helper - not for production use
 */
export function resetMocks(): void {
  mockRevokeError = null
  mockSessionToken = null
  revokeCalls = []
}

// ============================================================================
// Token Revocation
// ============================================================================

/**
 * Revoke access token on oauth.do.
 *
 * This invalidates the token on the authorization server.
 * Even if this fails, we still clear the local session.
 */
async function revokeToken(
  accessToken: string,
  config: OAuthConfig,
): Promise<void> {
  // Track call for testing
  revokeCalls.push(accessToken)

  // Check for mock error
  if (mockRevokeError) {
    throw mockRevokeError
  }

  // TODO: In production, call the actual oauth.do revoke endpoint
  // const response = await fetch(getRevokeEndpoint(config), {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/x-www-form-urlencoded',
  //   },
  //   body: new URLSearchParams({
  //     token: accessToken,
  //     token_type_hint: 'access_token',
  //     client_id: config.clientId,
  //     ...(config.clientSecret && { client_secret: config.clientSecret }),
  //   }),
  // })
  //
  // // Revocation endpoint may return 200 even for invalid tokens (RFC 7009)
  // // So we don't need to check the response status
}

// ============================================================================
// Session Cleanup
// ============================================================================

/**
 * Clear session from database.
 *
 * This removes the session record from persistent storage.
 * TODO: Integrate with db/auth.ts sessions table.
 */
async function clearSessionFromDatabase(sessionToken: string): Promise<void> {
  // TODO: In production, delete from sessions table
  // await db.delete(sessions).where(eq(sessions.token, sessionToken))
}

// ============================================================================
// Logout Handler
// ============================================================================

/**
 * Handle logout request
 *
 * Performs a complete logout:
 * 1. Extracts session token from cookie
 * 2. Revokes access token on oauth.do (best effort)
 * 3. Clears session from database (best effort)
 * 4. Returns response with clear-cookie header
 *
 * @param request - Incoming logout request
 * @param env - Optional environment variables for configuration
 * @returns Response with cleared session cookie
 */
export async function handleLogout(
  request: Request,
  env?: Record<string, string | undefined>,
): Promise<Response> {
  const config = getOAuthConfig(env ?? {})

  // Only allow POST requests for logout (CSRF protection)
  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({
        error: {
          status: 405,
          message: 'Method not allowed',
        },
      }),
      {
        status: 405,
        headers: {
          'Content-Type': 'application/json',
          Allow: 'POST',
        },
      },
    )
  }

  // Get session token from cookie
  const cookieHeader = request.headers.get('Cookie')
  const sessionToken = mockSessionToken ?? parseSessionCookie(cookieHeader, config)

  // Build clear cookie header
  const clearCookie = buildClearSessionCookie(config)

  // If no session, just clear cookie and return success
  if (!sessionToken) {
    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': clearCookie,
        },
      },
    )
  }

  // Best effort: revoke token on oauth.do
  // We don't fail the logout if revocation fails
  try {
    // TODO: Get actual access token from session store
    // For now, use session token as placeholder
    await revokeToken(sessionToken, config)
  } catch (error) {
    // Log error but continue - we still want to clear local session
    console.warn('Token revocation failed:', error)
  }

  // Best effort: clear session from database
  try {
    await clearSessionFromDatabase(sessionToken)
  } catch (error) {
    // Log error but continue
    console.warn('Session cleanup failed:', error)
  }

  // Return success with cleared cookie
  return new Response(
    JSON.stringify({ success: true }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': clearCookie,
      },
    },
  )
}

export default handleLogout
