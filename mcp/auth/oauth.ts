/**
 * OAuth Callback Handler
 *
 * Handles OAuth authorization flow with WorkOS AuthKit.
 * Implements PKCE (Proof Key for Code Exchange) for security.
 */

import type { McpEnv, OAuthState, KVStore } from '../types'
import {
  exchangeCodeForTokens,
  createSession,
  createSessionJwt,
  storeSession,
  getSession,
  getSessionByUserId,
  deleteSession,
} from './authkit'
import { extractBearerToken, decodeJwt } from './jwt'

// ============================================================================
// Constants
// ============================================================================

/** WorkOS authorization URL */
const WORKOS_AUTH_URL = 'https://api.workos.com/user_management/authorize'

/** OAuth state expiration (10 minutes) */
const STATE_EXPIRATION = 10 * 60 * 1000

// ============================================================================
// PKCE Utilities
// ============================================================================

/**
 * Generate a cryptographically random code verifier
 */
export function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return base64UrlEncode(array)
}

/**
 * Generate code challenge from code verifier (S256 method)
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(new Uint8Array(digest))
}

/**
 * Base64 URL encode (RFC 4648)
 */
function base64UrlEncode(buffer: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i])
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Generate a random state parameter
 */
export function generateState(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return base64UrlEncode(array)
}

// ============================================================================
// OAuth State Management
// ============================================================================

/**
 * Store OAuth state in KV
 */
export async function storeOAuthState(
  state: OAuthState,
  kv: KVStore
): Promise<void> {
  const ttl = Math.floor(STATE_EXPIRATION / 1000)
  await kv.put(
    `oauth_state:${state.state}`,
    JSON.stringify(state),
    { expirationTtl: ttl }
  )
}

/**
 * Get and delete OAuth state from KV (one-time use)
 */
export async function consumeOAuthState(
  state: string,
  kv: KVStore
): Promise<OAuthState | null> {
  const key = `oauth_state:${state}`
  const data = await kv.get(key)

  if (!data) return null

  // Delete state immediately (one-time use)
  await kv.delete(key)

  try {
    const oauthState = JSON.parse(data) as OAuthState

    // Verify state hasn't expired
    if (Date.now() - oauthState.createdAt > STATE_EXPIRATION) {
      return null
    }

    return oauthState
  } catch (err) {
    // Log the JSON parse error for security monitoring
    // Invalid state could indicate tampering or corruption
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(
      '[oauth] OAuth state JSON parse failed for state:',
      state,
      'error:', errMsg,
      'dataPreview:', data?.substring(0, 50) + (data?.length > 50 ? '...' : '')
    )
    return null
  }
}

// ============================================================================
// OAuth Flow Handlers
// ============================================================================

/**
 * Generate authorization URL for OAuth flow
 */
export async function getAuthorizationUrl(
  env: Pick<McpEnv, 'WORKOS_CLIENT_ID' | 'OAUTH_REDIRECT_URI' | 'OAUTH_KV'>,
  options: { provider?: string; connection?: string } = {}
): Promise<{ url: string; state: string; codeVerifier: string }> {
  const state = generateState()
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)

  // Build authorization URL
  const params = new URLSearchParams({
    client_id: env.WORKOS_CLIENT_ID,
    redirect_uri: env.OAUTH_REDIRECT_URI,
    response_type: 'code',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })

  // Add optional parameters
  if (options.provider) {
    params.set('provider', options.provider)
  }
  if (options.connection) {
    params.set('connection', options.connection)
  }

  // Store state for callback verification
  const oauthState: OAuthState = {
    state,
    codeVerifier,
    redirectUri: env.OAUTH_REDIRECT_URI,
    createdAt: Date.now(),
  }
  await storeOAuthState(oauthState, env.OAUTH_KV)

  return {
    url: `${WORKOS_AUTH_URL}?${params.toString()}`,
    state,
    codeVerifier,
  }
}

/**
 * Handle OAuth callback
 */
export async function handleOAuthCallback(
  request: Request,
  env: McpEnv
): Promise<Response> {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')
  const errorDescription = url.searchParams.get('error_description')

  // Handle OAuth errors
  if (error) {
    return new Response(
      JSON.stringify({
        error: 'oauth_error',
        message: errorDescription || error,
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  // Validate required parameters
  if (!code || !state) {
    return new Response(
      JSON.stringify({
        error: 'invalid_request',
        message: 'Missing code or state parameter',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  // Verify and consume state
  const oauthState = await consumeOAuthState(state, env.OAUTH_KV)
  if (!oauthState) {
    return new Response(
      JSON.stringify({
        error: 'invalid_state',
        message: 'Invalid or expired state parameter',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  // Exchange code for tokens
  const tokens = await exchangeCodeForTokens(
    code,
    oauthState.codeVerifier,
    oauthState.redirectUri,
    env
  )

  if (!tokens) {
    return new Response(
      JSON.stringify({
        error: 'token_exchange_failed',
        message: 'Failed to exchange authorization code for tokens',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  // Create session
  const session = await createSession(
    tokens.user,
    tokens.accessToken,
    tokens.refreshToken,
    env
  )

  // Store session in KV
  await storeSession(session, env.OAUTH_KV)

  // Create JWT for client
  const jwt = await createSessionJwt(session, env)

  // Return success response with JWT
  return new Response(
    JSON.stringify({
      success: true,
      token: jwt,
      user: {
        id: tokens.user.id,
        email: tokens.user.email,
        firstName: tokens.user.firstName,
        lastName: tokens.user.lastName,
      },
      expiresAt: session.expiresAt,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    }
  )
}

/**
 * Handle authorization request (start OAuth flow)
 */
export async function handleAuthorizeRequest(
  request: Request,
  env: McpEnv
): Promise<Response> {
  const url = new URL(request.url)
  const provider = url.searchParams.get('provider') || undefined
  const connection = url.searchParams.get('connection') || undefined

  const { url: authUrl } = await getAuthorizationUrl(env, {
    provider,
    connection,
  })

  // Redirect to WorkOS authorization
  return Response.redirect(authUrl, 302)
}

/**
 * Handle logout request
 *
 * Security: Properly invalidates the session by deleting from KV storage.
 * This ensures the session cannot be reused after logout.
 *
 * Note: The JWT will remain cryptographically valid until expiry, but
 * any server-side session validation will fail after logout.
 */
export async function handleLogoutRequest(
  request: Request,
  env: McpEnv
): Promise<Response> {
  try {
    // Extract JWT token from Authorization header
    const token = extractBearerToken(request)

    if (token) {
      // Decode JWT to get user ID (we need this to find the session)
      const payload = decodeJwt(token)

      if (payload?.sub) {
        // Find and delete the session by user ID
        const session = await getSessionByUserId(payload.sub, env.OAUTH_KV)

        if (session) {
          // Delete both session and user_session index from KV
          await deleteSession(session, env.OAUTH_KV)
          console.log(
            '[oauth] Session invalidated for user:',
            payload.sub,
            'sessionId:', session.id
          )
        }
      }
    }

    // Always return success - logout is idempotent
    // Even if no session was found, the logout operation is considered successful
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Logged out successfully',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (err) {
    // Log error but still return success - logout should be idempotent
    // and should never fail from the client's perspective
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[oauth] Logout error (non-fatal):', errMsg)

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Logged out successfully',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
