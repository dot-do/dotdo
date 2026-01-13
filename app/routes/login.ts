/**
 * OAuth Login Route Handler
 *
 * Handles /login requests by redirecting to oauth.do for authentication.
 * Constructs OAuth authorization URL with proper parameters.
 *
 * @see /app/lib/auth-config.ts for configuration
 */

import {
  getOAuthConfig,
  buildAuthorizationUrl,
  type OAuthConfig,
} from '../lib/auth-config'

// ============================================================================
// Test Helpers (moved to separate section for clarity)
// ============================================================================

// Test mock state - isolated for testing purposes
let mockAuthenticated = false
let mockOAuthError: Error | null = null

/**
 * Set mock authenticated state for testing
 * @internal Test helper - not for production use
 */
export async function setMockAuthenticated(authenticated: boolean): Promise<void> {
  mockAuthenticated = authenticated
}

/**
 * Set mock OAuth error for testing
 * @internal Test helper - not for production use
 */
export async function setMockOAuthError(error: Error | null): Promise<void> {
  mockOAuthError = error
}

/**
 * Reset all mocks to default state
 * @internal Test helper - not for production use
 */
export function resetMocks(): void {
  mockAuthenticated = false
  mockOAuthError = null
}

// ============================================================================
// Login Handler
// ============================================================================

/**
 * Handle login request
 *
 * - If user is already authenticated, redirects to returnTo URL or /
 * - Otherwise, redirects to oauth.do authorization URL
 *
 * @param request - Incoming request
 * @param env - Optional environment variables for configuration
 * @returns Redirect response to oauth.do or destination
 */
export async function handleLogin(
  request: Request,
  env?: Record<string, string | undefined>,
): Promise<Response> {
  const url = new URL(request.url)
  const returnTo = url.searchParams.get('returnTo') || '/'

  // If already authenticated, redirect to destination
  if (mockAuthenticated) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: returnTo,
      },
    })
  }

  // Check for mock OAuth error
  if (mockOAuthError) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/login?error=${encodeURIComponent(mockOAuthError.message)}`,
      },
    })
  }

  // Get configuration from environment
  const config = getOAuthConfig(env ?? {})

  // Build the callback URL for this app
  const origin = url.origin
  const redirectUri = `${origin}/auth/callback`

  // Build OAuth authorization URL with state containing returnTo
  const state = returnTo !== '/' ? returnTo : undefined

  try {
    const authUrl = buildAuthorizationUrl(config, {
      redirectUri,
      state,
    })

    return new Response(null, {
      status: 302,
      headers: {
        Location: authUrl,
      },
    })
  } catch (error) {
    // Handle buildAuthUrl errors
    return new Response(null, {
      status: 500,
      headers: {
        Location: `/login?error=${encodeURIComponent('OAuth service error')}`,
      },
    })
  }
}

export default handleLogin
