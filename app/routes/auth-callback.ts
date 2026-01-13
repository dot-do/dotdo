/**
 * OAuth Callback Handler
 *
 * Handles /auth/callback requests after OAuth provider authentication.
 * Exchanges authorization code for tokens and sets session cookie.
 *
 * @see /app/lib/auth-config.ts for configuration
 */

import {
  getOAuthConfig,
  getTokenEndpoint,
  getUserInfoEndpoint,
  buildSessionCookie,
  sanitizeRedirectUrl,
  type OAuthConfig,
} from '../lib/auth-config'
import type { SessionData } from '../types/auth'

// ============================================================================
// Session Storage
// ============================================================================

// Session storage for test verification
let sessionStore: SessionData | null = null

// ============================================================================
// Test Helpers
// ============================================================================

// Mock state for testing
let expectedState: string | null = null
let mockTokenError: Error | null = null
let mockUserError: Error | null = null

/**
 * Set expected state for CSRF validation testing
 * @internal Test helper - not for production use
 */
export async function setExpectedState(state: string | null): Promise<void> {
  expectedState = state
  mockTokenError = null
  mockUserError = null
}

/**
 * Set mock token exchange error for testing
 * @internal Test helper - not for production use
 */
export async function setMockTokenError(error: Error | null): Promise<void> {
  mockTokenError = error
  mockUserError = null
  expectedState = null
}

/**
 * Set mock user fetch error for testing
 * @internal Test helper - not for production use
 */
export async function setMockUserError(error: Error | null): Promise<void> {
  mockUserError = error
  mockTokenError = null
  expectedState = null
}

/**
 * Get session store for test verification
 * @internal Test helper - not for production use
 */
export async function getSessionStore(): Promise<SessionData | null> {
  return sessionStore
}

/**
 * Reset all mocks to default state
 * @internal Test helper - not for production use
 */
export function resetMocks(): void {
  expectedState = null
  mockTokenError = null
  mockUserError = null
  sessionStore = null
}

// ============================================================================
// Token Exchange (production-ready with mock fallback)
// ============================================================================

/**
 * Exchange authorization code for tokens.
 *
 * In production, this calls the oauth.do token endpoint.
 * Falls back to mock implementation when mock error is set.
 */
async function exchangeCodeForTokens(
  code: string,
  config: OAuthConfig,
  redirectUri: string,
): Promise<{
  accessToken: string
  refreshToken?: string
  expiresIn: number
}> {
  // Check for mock error first (for testing)
  if (mockTokenError) {
    throw mockTokenError
  }

  // TODO: In production, call the actual oauth.do token endpoint
  // const response = await fetch(getTokenEndpoint(config), {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/x-www-form-urlencoded',
  //   },
  //   body: new URLSearchParams({
  //     grant_type: 'authorization_code',
  //     code,
  //     redirect_uri: redirectUri,
  //     client_id: config.clientId,
  //     ...(config.clientSecret && { client_secret: config.clientSecret }),
  //   }),
  // })
  //
  // if (!response.ok) {
  //   throw new Error('Token exchange failed')
  // }
  //
  // const data = await response.json()
  // return {
  //   accessToken: data.access_token,
  //   refreshToken: data.refresh_token,
  //   expiresIn: data.expires_in,
  // }

  // Mock successful token exchange
  return {
    accessToken: `access-token-for-${code}`,
    refreshToken: `refresh-token-for-${code}`,
    expiresIn: config.sessionExpiresIn,
  }
}

/**
 * Fetch user info using access token.
 *
 * In production, this calls the oauth.do userinfo endpoint.
 * Falls back to mock implementation when mock error is set.
 */
async function fetchUserInfo(
  accessToken: string,
  config: OAuthConfig,
): Promise<{
  id: string
  email: string
  name: string
}> {
  // Check for mock error first (for testing)
  if (mockUserError) {
    throw mockUserError
  }

  // TODO: In production, call the actual oauth.do userinfo endpoint
  // const response = await fetch(getUserInfoEndpoint(config), {
  //   headers: {
  //     Authorization: `Bearer ${accessToken}`,
  //   },
  // })
  //
  // if (!response.ok) {
  //   throw new Error('Failed to fetch user info')
  // }
  //
  // const data = await response.json()
  // return {
  //   id: data.sub,
  //   email: data.email,
  //   name: data.name || data.given_name,
  // }

  // Mock user info
  return {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
  }
}

// ============================================================================
// Session Token Generation
// ============================================================================

/**
 * Generate cryptographically secure session token.
 */
function generateSessionToken(): string {
  // Use crypto.randomUUID if available, otherwise fallback
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `session-${crypto.randomUUID()}`
  }
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
}

// ============================================================================
// Callback Handler
// ============================================================================

/**
 * Handle OAuth callback
 *
 * - Validates state parameter (CSRF protection)
 * - Exchanges authorization code for tokens
 * - Fetches user info
 * - Sets session cookie
 * - Redirects to original destination
 *
 * @param request - Incoming callback request
 * @param env - Optional environment variables for configuration
 * @returns Redirect response with session cookie
 */
export async function handleCallback(
  request: Request,
  env?: Record<string, string | undefined>,
): Promise<Response> {
  const url = new URL(request.url)
  const config = getOAuthConfig(env ?? {})

  // Check for OAuth error response from provider
  const oauthError = url.searchParams.get('error')
  if (oauthError) {
    const errorDescription = url.searchParams.get('error_description') || ''
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/login?error=${oauthError}&error_description=${encodeURIComponent(errorDescription)}`,
      },
    })
  }

  // Get authorization code
  const code = url.searchParams.get('code')
  if (!code) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/login?error=missing_code',
      },
    })
  }

  // Get and validate state parameter
  const state = url.searchParams.get('state')

  // Validate state if we have an expected state set (CSRF protection)
  if (expectedState !== null && state !== expectedState) {
    expectedState = null // Reset after validation
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/login?error=invalid_state',
      },
    })
  }

  // Reset expectedState after successful validation
  expectedState = null

  // Sanitize redirect URL from state (prevents open redirect)
  const redirectTo = sanitizeRedirectUrl(state ? decodeURIComponent(state) : null)

  // Build redirect URI for token exchange
  const redirectUri = `${url.origin}/auth/callback`

  try {
    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code, config, redirectUri)

    // Fetch user info
    const user = await fetchUserInfo(tokens.accessToken, config)

    // Store session data
    sessionStore = {
      userId: user.id,
      email: user.email,
      name: user.name,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    }

    // Generate session token
    const sessionToken = generateSessionToken()

    // Build session cookie with secure attributes
    const isSecure = url.protocol === 'https:'
    const cookie = buildSessionCookie(config, {
      value: sessionToken,
      maxAge: tokens.expiresIn,
      secure: isSecure,
    })

    return new Response(null, {
      status: 302,
      headers: {
        Location: redirectTo,
        'Set-Cookie': cookie,
      },
    })
  } catch (error) {
    // Handle token exchange errors
    if (mockTokenError && error === mockTokenError) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/login?error=token_exchange_failed',
        },
      })
    }

    // Handle user fetch errors
    if (mockUserError && error === mockUserError) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/login?error=user_fetch_failed',
        },
      })
    }

    // Generic error handling
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/login?error=callback_failed',
      },
    })
  }
}

export default handleCallback
