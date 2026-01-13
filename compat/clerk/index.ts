/**
 * @dotdo/clerk - Clerk SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for the Clerk Backend SDK that runs on Cloudflare Workers
 * with edge-optimized performance. Implements the Clerk Backend API.
 *
 * @example Basic Usage
 * ```typescript
 * import { Clerk } from '@dotdo/clerk'
 *
 * const clerk = new Clerk({ secretKey: 'sk_test_xxx' })
 *
 * // Get a session
 * const session = await clerk.sessions.getSession('sess_xxx')
 *
 * // List sessions for a user
 * const { data, total_count } = await clerk.sessions.listSessions({
 *   userId: 'user_xxx',
 * })
 *
 * // Revoke a session
 * await clerk.sessions.revokeSession('sess_xxx')
 * ```
 *
 * @see https://clerk.com/docs/reference/backend-api
 * @module
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Session status enum matching Clerk API
 */
export type SessionStatus =
  | 'active'
  | 'expired'
  | 'revoked'
  | 'abandoned'
  | 'removed'
  | 'replaced'
  | 'ended'

/**
 * Actor information for impersonation sessions
 */
export interface SessionActor {
  sub: string
  actor_id?: string
}

/**
 * Clerk session object matching the Clerk API response format
 */
export interface Session {
  id: string
  object: 'session'
  client_id: string
  user_id: string
  status: SessionStatus
  last_active_at: number
  expire_at: number
  abandon_at: number
  created_at: number
  updated_at: number
  last_active_organization_id?: string
  actor?: SessionActor
}

/**
 * Session list response with pagination info
 */
export interface SessionList {
  data: Session[]
  total_count: number
}

/**
 * Session token response
 */
export interface SessionToken {
  object: 'token'
  jwt: string
}

/**
 * Parameters for creating a session
 */
export interface CreateSessionParams {
  userId: string
  expireAt?: number
  actor?: {
    sub: string
  }
}

/**
 * Parameters for revoking a session
 */
export interface RevokeSessionParams {
  sessionId: string
}

/**
 * Parameters for listing sessions
 */
export interface ListSessionsParams {
  userId?: string
  clientId?: string
  status?: SessionStatus
  limit?: number
  offset?: number
}

/**
 * Parameters for verifying a session
 */
export interface VerifySessionOptions {
  token: string
}

/**
 * Parameters for getting a session token
 */
export interface GetSessionTokenParams {
  template?: string
}

/**
 * Clerk client configuration options
 */
export interface ClerkOptions {
  secretKey: string
  publishableKey?: string
  apiUrl?: string
  apiVersion?: string
}

/**
 * Clerk API error structure
 */
export interface ClerkError {
  code: string
  message: string
  long_message?: string
  meta?: Record<string, unknown>
}

// ============================================================================
// ERROR CLASS
// ============================================================================

/**
 * Custom error class for Clerk API errors
 */
export class ClerkAPIError extends Error {
  code: string
  status: number
  errors: ClerkError[]
  meta?: Record<string, unknown>

  constructor(response: { errors: ClerkError[] }, status: number) {
    const firstError = response.errors[0]
    super(firstError?.message || 'Unknown Clerk API error')
    this.name = 'ClerkAPIError'
    this.code = firstError?.code || 'unknown_error'
    this.status = status
    this.errors = response.errors
    this.meta = firstError?.meta
  }
}

// ============================================================================
// SESSIONS RESOURCE
// ============================================================================

/**
 * Sessions resource for managing Clerk sessions
 */
class SessionsResource {
  private client: Clerk

  constructor(client: Clerk) {
    this.client = client
  }

  /**
   * Create a new session for a user
   */
  async createSession(params: CreateSessionParams): Promise<Session> {
    const body: Record<string, unknown> = {
      user_id: params.userId,
    }
    if (params.expireAt !== undefined) {
      body.expire_at = params.expireAt
    }
    if (params.actor !== undefined) {
      body.actor = params.actor
    }

    return this.client.request<Session>('/v1/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  /**
   * Get a session by ID
   */
  async getSession(sessionId: string): Promise<Session> {
    return this.client.request<Session>(`/v1/sessions/${sessionId}`, {
      method: 'GET',
    })
  }

  /**
   * Revoke a session by ID
   */
  async revokeSession(sessionId: string): Promise<Session> {
    return this.client.request<Session>(`/v1/sessions/${sessionId}/revoke`, {
      method: 'POST',
    })
  }

  /**
   * List sessions with optional filters
   */
  async listSessions(params?: ListSessionsParams): Promise<SessionList> {
    const searchParams = new URLSearchParams()

    if (params?.userId) {
      searchParams.set('user_id', params.userId)
    }
    if (params?.clientId) {
      searchParams.set('client_id', params.clientId)
    }
    if (params?.status) {
      searchParams.set('status', params.status)
    }
    if (params?.limit !== undefined) {
      searchParams.set('limit', String(params.limit))
    }
    if (params?.offset !== undefined) {
      searchParams.set('offset', String(params.offset))
    }

    const queryString = searchParams.toString()
    const path = queryString ? `/v1/sessions?${queryString}` : '/v1/sessions'

    return this.client.request<SessionList>(path, {
      method: 'GET',
    })
  }

  /**
   * Verify a session token
   */
  async verifySession(sessionId: string, token: string): Promise<SessionToken> {
    return this.client.request<SessionToken>(`/v1/sessions/${sessionId}/verify`, {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
  }

  /**
   * Get a new token for a session
   */
  async getSessionToken(sessionId: string, params?: GetSessionTokenParams): Promise<SessionToken> {
    const body: Record<string, unknown> = {}
    if (params?.template) {
      body.template = params.template
    }

    return this.client.request<SessionToken>(`/v1/sessions/${sessionId}/tokens`, {
      method: 'POST',
      body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
    })
  }
}

// ============================================================================
// MAIN CLIENT
// ============================================================================

/**
 * Clerk Backend API client
 *
 * @example
 * ```typescript
 * const clerk = new Clerk({ secretKey: 'sk_test_xxx' })
 *
 * const session = await clerk.sessions.getSession('sess_xxx')
 * ```
 */
export class Clerk {
  private secretKey: string
  private publishableKey?: string
  private apiUrl: string
  private apiVersion: string

  sessions: SessionsResource

  constructor(options: ClerkOptions) {
    if (!options.secretKey) {
      throw new Error('Clerk secret key is required')
    }

    this.secretKey = options.secretKey
    this.publishableKey = options.publishableKey
    this.apiUrl = options.apiUrl || 'https://api.clerk.com'
    this.apiVersion = options.apiVersion || 'v1'

    // Initialize resources
    this.sessions = new SessionsResource(this)
  }

  /**
   * Make an authenticated request to the Clerk API
   * @internal
   */
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.apiUrl}${path}`

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.secretKey}`,
      'Clerk-SDK': '@dotdo/clerk@1.0.0',
      ...(init.headers as Record<string, string>),
    }

    // Add Content-Type for requests with body
    if (init.body) {
      headers['Content-Type'] = 'application/json'
    }

    const response = await fetch(url, {
      ...init,
      headers,
    })

    const data = await response.json()

    if (!response.ok) {
      throw new ClerkAPIError(data as { errors: ClerkError[] }, response.status)
    }

    return data as T
  }
}
