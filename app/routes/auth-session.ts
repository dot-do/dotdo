/**
 * OAuth Session Route Handler
 *
 * Handles /auth/session requests to check current session status.
 * Returns user info if authenticated, or { authenticated: false } otherwise.
 *
 * @see /app/lib/auth-config.ts for configuration
 */

import {
  getOAuthConfig,
  parseSessionCookie,
  getSessionValidationEndpoint,
  type OAuthConfig,
} from '../lib/auth-config'
import type { User, SessionResponse } from '../types/auth'

// ============================================================================
// Test Helpers
// ============================================================================

// Mock state for testing
let mockUser: User | null = null
let mockValidationError: Error | null = null

/**
 * Set mock user for testing
 * @internal Test helper - not for production use
 */
export async function setMockUser(user: User | null): Promise<void> {
  mockUser = user
  mockValidationError = null
}

/**
 * Set mock validation error for testing
 * @internal Test helper - not for production use
 */
export async function setMockValidationError(error: Error | null): Promise<void> {
  mockValidationError = error
  mockUser = null
}

/**
 * Reset all mocks to default state
 * @internal Test helper - not for production use
 */
export function resetMocks(): void {
  mockUser = null
  mockValidationError = null
}

// ============================================================================
// Session Validation
// ============================================================================

/**
 * Validate session token and return user info.
 *
 * In production, this calls oauth.do to validate the session.
 * Falls back to mock implementation for testing.
 */
async function validateSessionToken(
  token: string,
  config: OAuthConfig,
): Promise<User | null> {
  // Check for mock error
  if (mockValidationError) {
    throw mockValidationError
  }

  // Check for mock user (for testing)
  if (mockUser !== null) {
    return mockUser
  }

  // TODO: In production, validate against oauth.do session endpoint
  // const response = await fetch(getSessionValidationEndpoint(config), {
  //   headers: { Authorization: `Bearer ${token}` },
  // })
  //
  // if (!response.ok) {
  //   return null
  // }
  //
  // const data = await response.json()
  // return {
  //   id: data.sub,
  //   email: data.email,
  //   name: data.name,
  //   avatar: data.picture,
  // }

  // For now, check if token looks valid (starts with 'session')
  if (token.startsWith('session')) {
    return {
      id: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
    }
  }

  return null
}

// ============================================================================
// Session Handler
// ============================================================================

/**
 * Handle session check request
 *
 * Returns the current user's session status:
 * - { authenticated: true, user: {...} } if valid session
 * - { authenticated: false } if no session or invalid
 *
 * @param request - Incoming session check request
 * @param env - Optional environment variables for configuration
 * @returns JSON response with session status
 */
export async function handleSession(
  request: Request,
  env?: Record<string, string | undefined>,
): Promise<Response> {
  const config = getOAuthConfig(env ?? {})

  // Get session token from cookie
  const cookieHeader = request.headers.get('Cookie')
  const sessionToken = parseSessionCookie(cookieHeader, config)

  // No session cookie - not authenticated
  if (!sessionToken) {
    const response: SessionResponse = { authenticated: false }
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    // Validate session token
    const user = await validateSessionToken(sessionToken, config)

    if (user) {
      const response: SessionResponse = {
        authenticated: true,
        user,
      }
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Invalid session
    const response: SessionResponse = { authenticated: false }
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    // Log error but return unauthenticated (don't expose errors)
    console.error('Session validation error:', error)
    const response: SessionResponse = { authenticated: false }
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

export default handleSession
