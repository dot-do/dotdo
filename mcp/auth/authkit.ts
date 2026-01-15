/**
 * WorkOS AuthKit Integration
 *
 * Integration with WorkOS AuthKit for user authentication.
 * Handles user profile fetching, organization membership, and permission mapping.
 */

import type { McpEnv, WorkOSUser, Session } from '../types'
import { createJwt } from './jwt'

// ============================================================================
// Constants
// ============================================================================

/** WorkOS API base URL */
const WORKOS_API_URL = 'https://api.workos.com'

/** Session duration (24 hours) */
const SESSION_DURATION = 24 * 60 * 60 * 1000

/** Default permissions for authenticated users */
const DEFAULT_PERMISSIONS = ['tools:read', 'resources:read']

// ============================================================================
// WorkOS API Client
// ============================================================================

/**
 * Fetch user profile from WorkOS
 */
export async function getWorkOSUser(
  accessToken: string,
  env: Pick<McpEnv, 'WORKOS_API_KEY'>
): Promise<WorkOSUser | null> {
  try {
    const response = await fetch(`${WORKOS_API_URL}/user_management/users/me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      console.error('Failed to fetch WorkOS user:', response.status)
      return null
    }

    const data = await response.json() as WorkOSUser
    return data
  } catch (err) {
    console.error('Error fetching WorkOS user:', err)
    return null
  }
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string,
  env: Pick<McpEnv, 'WORKOS_API_KEY' | 'WORKOS_CLIENT_ID'>
): Promise<{
  accessToken: string
  refreshToken?: string
  user: WorkOSUser
} | null> {
  try {
    const response = await fetch(`${WORKOS_API_URL}/user_management/authenticate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: env.WORKOS_CLIENT_ID,
        client_secret: env.WORKOS_API_KEY,
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('Token exchange failed:', error)
      return null
    }

    const data = await response.json() as {
      access_token: string
      refresh_token?: string
      user: WorkOSUser
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      user: data.user,
    }
  } catch (err) {
    console.error('Error exchanging code for tokens:', err)
    return null
  }
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(
  refreshToken: string,
  env: Pick<McpEnv, 'WORKOS_API_KEY' | 'WORKOS_CLIENT_ID'>
): Promise<{
  accessToken: string
  refreshToken?: string
} | null> {
  try {
    const response = await fetch(`${WORKOS_API_URL}/user_management/authenticate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: env.WORKOS_CLIENT_ID,
        client_secret: env.WORKOS_API_KEY,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    })

    if (!response.ok) {
      console.error('Token refresh failed:', response.status)
      return null
    }

    const data = await response.json() as {
      access_token: string
      refresh_token?: string
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
    }
  } catch (err) {
    console.error('Error refreshing token:', err)
    return null
  }
}

// ============================================================================
// Permission Mapping
// ============================================================================

/**
 * Map WorkOS user roles to MCP permissions
 */
export function mapRolesToPermissions(user: WorkOSUser): string[] {
  const permissions = [...DEFAULT_PERMISSIONS]

  // Check organization memberships for role-based permissions
  if (user.organizationMemberships) {
    for (const membership of user.organizationMemberships) {
      const roleSlug = membership.role?.slug

      switch (roleSlug) {
        case 'admin':
        case 'owner':
          // Admins get full access
          permissions.push('*')
          break
        case 'member':
          // Members get tool execution
          permissions.push('tools:execute')
          break
        case 'viewer':
          // Viewers get read-only access (already default)
          break
        default:
          // Unknown roles get basic permissions
          break
      }
    }
  }

  // Deduplicate permissions
  return [...new Set(permissions)]
}

/**
 * Extract primary organization ID from user
 */
export function getPrimaryOrgId(user: WorkOSUser): string | undefined {
  if (!user.organizationMemberships?.length) {
    return undefined
  }
  // Return the first organization membership
  return user.organizationMemberships[0].organizationId
}

// ============================================================================
// Session Management
// ============================================================================

/**
 * Create a new session from WorkOS authentication
 */
export async function createSession(
  user: WorkOSUser,
  accessToken: string,
  refreshToken: string | undefined,
  env: Pick<McpEnv, 'JWT_SECRET'>
): Promise<Session> {
  const now = Date.now()
  const sessionId = crypto.randomUUID()
  const permissions = mapRolesToPermissions(user)
  const orgId = getPrimaryOrgId(user)

  return {
    id: sessionId,
    userId: user.id,
    accessToken,
    refreshToken,
    email: user.email,
    orgId,
    permissions,
    createdAt: now,
    expiresAt: now + SESSION_DURATION,
  }
}

/**
 * Create JWT from session
 */
export async function createSessionJwt(
  session: Session,
  env: Pick<McpEnv, 'JWT_SECRET'>
): Promise<string> {
  return createJwt(
    {
      sub: session.userId,
      email: session.email,
      org_id: session.orgId,
      permissions: session.permissions,
    },
    env.JWT_SECRET,
    { expiresIn: '24h' }
  )
}

// ============================================================================
// KV Session Storage
// ============================================================================

/**
 * Store session in KV
 */
export async function storeSession(
  session: Session,
  kv: KVNamespace
): Promise<void> {
  const ttl = Math.floor((session.expiresAt - Date.now()) / 1000)

  await kv.put(
    `session:${session.id}`,
    JSON.stringify(session),
    { expirationTtl: Math.max(ttl, 60) }
  )

  // Also index by user ID for lookup
  await kv.put(
    `user_session:${session.userId}`,
    session.id,
    { expirationTtl: Math.max(ttl, 60) }
  )
}

/**
 * Get session from KV
 */
export async function getSession(
  sessionId: string,
  kv: KVNamespace
): Promise<Session | null> {
  const data = await kv.get(`session:${sessionId}`)
  if (!data) return null

  try {
    return JSON.parse(data) as Session
  } catch {
    return null
  }
}

/**
 * Get session by user ID
 */
export async function getSessionByUserId(
  userId: string,
  kv: KVNamespace
): Promise<Session | null> {
  const sessionId = await kv.get(`user_session:${userId}`)
  if (!sessionId) return null

  return getSession(sessionId, kv)
}

/**
 * Delete session from KV
 */
export async function deleteSession(
  session: Session,
  kv: KVNamespace
): Promise<void> {
  await Promise.all([
    kv.delete(`session:${session.id}`),
    kv.delete(`user_session:${session.userId}`),
  ])
}

/**
 * Check if session is valid (not expired)
 */
export function isSessionValid(session: Session): boolean {
  return session.expiresAt > Date.now()
}
