/**
 * @dotdo/clerk - Sessions API
 *
 * Clerk Sessions Backend API compatible implementation.
 * Provides session management, token handling, claims management,
 * and session lifecycle events.
 *
 * @see https://clerk.com/docs/reference/backend-api/tag/Sessions
 * @module
 */

import { createTemporalStore, type TemporalStore } from '../../../db/primitives/temporal-store'
import { createJWT, verifyJWT, decodeJWT, type JWTCreateOptions, type JWTVerifyOptions } from '../shared/jwt'
import type { UserManager } from '../shared/users'
import { ClerkAPIError } from './types'
import type {
  ClerkSession,
  ClerkSessionActor,
  ClerkSessionClaims,
  ClerkPaginatedList,
  ClerkDeletedObject,
  ClerkJWTTemplate,
} from './types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Extended session with additional fields for internal storage
 */
export interface StoredSession {
  id: string
  client_id: string
  user_id: string
  status: 'active' | 'revoked' | 'ended' | 'expired' | 'removed' | 'replaced' | 'abandoned'
  last_active_at: number
  last_active_organization_id: string | null
  actor: ClerkSessionActor | null
  expire_at: number
  abandon_at: number
  created_at: number
  updated_at: number
  // Extended fields
  public_metadata: Record<string, unknown>
  private_metadata: Record<string, unknown>
  ip_address?: string
  user_agent?: string
  device_info?: SessionDeviceInfo
  // Token tracking
  current_token_id?: string
  token_rotated_at?: number
}

/**
 * Device information for session
 */
export interface SessionDeviceInfo {
  device_type?: 'desktop' | 'mobile' | 'tablet' | 'unknown'
  os?: string
  os_version?: string
  browser?: string
  browser_version?: string
  is_mobile?: boolean
}

/**
 * Session token with claims
 */
export interface SessionToken {
  id: string
  session_id: string
  user_id: string
  jwt: string
  template_id?: string
  claims: ClerkSessionClaims & Record<string, unknown>
  created_at: number
  expires_at: number
}

/**
 * Session event types
 */
export type SessionEventType = 'session.created' | 'session.revoked' | 'session.expired' | 'session.ended' | 'session.token_rotated'

/**
 * Session event handler
 */
export type SessionEventHandler = (event: SessionEvent) => void | Promise<void>

/**
 * Session event
 */
export interface SessionEvent {
  type: SessionEventType
  session: ClerkSession
  timestamp: number
  metadata?: Record<string, unknown>
}

/**
 * Session list parameters
 */
export interface ListSessionsParams {
  userId?: string
  clientId?: string
  status?: 'active' | 'revoked' | 'ended' | 'expired' | 'removed' | 'replaced' | 'abandoned'
  limit?: number
  offset?: number
  order_by?: string
}

/**
 * Create session parameters
 */
export interface CreateSessionParams {
  userId: string
  clientId?: string
  actor?: ClerkSessionActor
  expiresInSeconds?: number
  publicMetadata?: Record<string, unknown>
  privateMetadata?: Record<string, unknown>
  ipAddress?: string
  userAgent?: string
}

/**
 * Create session token parameters
 */
export interface CreateSessionTokenParams {
  templateName?: string
  expiresInSeconds?: number
  claims?: Record<string, unknown>
}

/**
 * Sessions manager options
 */
export interface SessionsManagerOptions {
  /** User manager instance */
  userManager: UserManager
  /** JWT signing secret */
  jwtSecret: string
  /** JWT algorithm */
  jwtAlgorithm?: 'HS256' | 'RS256' | 'ES256'
  /** JWT issuer */
  issuer?: string
  /** Default session duration in seconds (default: 7 days) */
  defaultSessionDuration?: number
  /** Default token duration in seconds (default: 60 seconds) */
  defaultTokenDuration?: number
  /** Session abandon time after expiry in seconds (default: 1 day) */
  abandonAfterExpiry?: number
  /** Enable single session mode */
  singleSessionMode?: boolean
  /** Maximum sessions per user (0 = unlimited) */
  maxSessionsPerUser?: number
}

// ============================================================================
// SESSIONS API INTERFACE
// ============================================================================

/**
 * Sessions API manager
 */
export interface SessionsAPI {
  // Session Management
  getSession(sessionId: string): Promise<ClerkSession>
  listSessions(params?: ListSessionsParams): Promise<ClerkPaginatedList<ClerkSession>>
  createSession(params: CreateSessionParams): Promise<ClerkSession>
  revokeSession(sessionId: string): Promise<ClerkSession>
  revokeSessions(userId: string, exceptSessionId?: string): Promise<ClerkPaginatedList<ClerkSession>>
  endSession(sessionId: string): Promise<ClerkSession>

  // Session Token Management
  createSessionToken(sessionId: string, params?: CreateSessionTokenParams): Promise<{ jwt: string; object: 'token' }>
  verifySessionToken(token: string, options?: { authorizedParties?: string[] }): Promise<{
    userId: string
    sessionId: string
    claims: ClerkSessionClaims & Record<string, unknown>
  }>
  refreshSession(sessionId: string): Promise<ClerkSession>

  // Session Claims
  getSessionClaims(sessionId: string): Promise<Record<string, unknown>>
  updateSessionClaims(
    sessionId: string,
    claims: { publicMetadata?: Record<string, unknown>; privateMetadata?: Record<string, unknown> }
  ): Promise<ClerkSession>

  // Multi-session Support
  getSingleSessionToken(userId: string): Promise<{ jwt: string; sessionId: string } | null>
  rotateSessionToken(sessionId: string): Promise<{ jwt: string; object: 'token' }>

  // Session Events
  onSessionCreated(handler: SessionEventHandler): () => void
  onSessionRevoked(handler: SessionEventHandler): () => void
  onSessionExpired(handler: SessionEventHandler): () => void
  onSessionEnded(handler: SessionEventHandler): () => void

  // JWT Template Management
  setJWTTemplate(templateId: string, template: ClerkJWTTemplate): Promise<void>
  getJWTTemplate(templateId: string): Promise<ClerkJWTTemplate | null>
}

// ============================================================================
// SESSIONS MANAGER IMPLEMENTATION
// ============================================================================

/**
 * Create Sessions API manager
 */
export function createSessionsManager(options: SessionsManagerOptions): SessionsAPI {
  const {
    userManager,
    jwtSecret,
    jwtAlgorithm = 'HS256',
    issuer = 'https://clerk.com',
    defaultSessionDuration = 604800, // 7 days
    defaultTokenDuration = 60, // 60 seconds
    abandonAfterExpiry = 86400, // 1 day
    singleSessionMode = false,
    maxSessionsPerUser = 0,
  } = options

  // Storage
  const sessionStore = createTemporalStore<StoredSession>({ enableTTL: true })
  const tokenStore = createTemporalStore<SessionToken>({ enableTTL: true })
  const jwtTemplateStore = createTemporalStore<ClerkJWTTemplate>()
  const userSessionsStore = createTemporalStore<string[]>() // user_id -> session_ids
  const clientSessionsStore = createTemporalStore<string[]>() // client_id -> session_ids

  // Event handlers
  const eventHandlers: Map<SessionEventType, Set<SessionEventHandler>> = new Map([
    ['session.created', new Set()],
    ['session.revoked', new Set()],
    ['session.expired', new Set()],
    ['session.ended', new Set()],
    ['session.token_rotated', new Set()],
  ])

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  /**
   * Generate a unique ID
   */
  function generateId(prefix: string): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return `${prefix}_${hex}`
  }

  /**
   * Emit session event
   */
  async function emitEvent(type: SessionEventType, session: ClerkSession, metadata?: Record<string, unknown>): Promise<void> {
    const handlers = eventHandlers.get(type)
    if (!handlers) return

    const event: SessionEvent = {
      type,
      session,
      timestamp: Date.now(),
      metadata,
    }

    for (const handler of handlers) {
      try {
        await handler(event)
      } catch (error) {
        // Log error but don't throw
        console.error(`Session event handler error for ${type}:`, error)
      }
    }
  }

  /**
   * Convert stored session to Clerk session format
   */
  function toClerkSession(stored: StoredSession): ClerkSession {
    return {
      id: stored.id,
      object: 'session',
      client_id: stored.client_id,
      user_id: stored.user_id,
      status: stored.status,
      last_active_at: stored.last_active_at,
      last_active_organization_id: stored.last_active_organization_id,
      actor: stored.actor,
      expire_at: stored.expire_at,
      abandon_at: stored.abandon_at,
      created_at: stored.created_at,
      updated_at: stored.updated_at,
    }
  }

  /**
   * Check if session is expired
   */
  function isSessionExpired(session: StoredSession): boolean {
    return Date.now() >= session.expire_at
  }

  /**
   * Check if session is abandoned
   */
  function isSessionAbandoned(session: StoredSession): boolean {
    return Date.now() >= session.abandon_at
  }

  /**
   * Update session status if expired
   */
  async function checkAndUpdateExpiry(session: StoredSession): Promise<StoredSession> {
    if (session.status === 'active' && isSessionExpired(session)) {
      session.status = 'expired'
      session.updated_at = Date.now()
      await sessionStore.put(`session:${session.id}`, session, Date.now())
      await emitEvent('session.expired', toClerkSession(session))
    }
    return session
  }

  /**
   * Add session to user's session list
   */
  async function addUserSession(userId: string, sessionId: string): Promise<void> {
    const sessions = (await userSessionsStore.get(`user_sessions:${userId}`)) ?? []
    if (!sessions.includes(sessionId)) {
      sessions.push(sessionId)
      await userSessionsStore.put(`user_sessions:${userId}`, sessions, Date.now())
    }
  }

  /**
   * Remove session from user's session list
   */
  async function removeUserSession(userId: string, sessionId: string): Promise<void> {
    const sessions = (await userSessionsStore.get(`user_sessions:${userId}`)) ?? []
    const index = sessions.indexOf(sessionId)
    if (index !== -1) {
      sessions.splice(index, 1)
      await userSessionsStore.put(`user_sessions:${userId}`, sessions, Date.now())
    }
  }

  /**
   * Add session to client's session list
   */
  async function addClientSession(clientId: string, sessionId: string): Promise<void> {
    const sessions = (await clientSessionsStore.get(`client_sessions:${clientId}`)) ?? []
    if (!sessions.includes(sessionId)) {
      sessions.push(sessionId)
      await clientSessionsStore.put(`client_sessions:${clientId}`, sessions, Date.now())
    }
  }

  /**
   * Enforce max sessions per user
   */
  async function enforceMaxSessions(userId: string): Promise<void> {
    if (maxSessionsPerUser <= 0 && !singleSessionMode) return

    const sessionIds = (await userSessionsStore.get(`user_sessions:${userId}`)) ?? []
    const activeSessions: StoredSession[] = []

    for (const sessionId of sessionIds) {
      const session = await sessionStore.get(`session:${sessionId}`)
      if (session && session.status === 'active') {
        activeSessions.push(session)
      }
    }

    const limit = singleSessionMode ? 1 : maxSessionsPerUser

    if (activeSessions.length >= limit) {
      // Sort by created_at and revoke oldest
      const sortedSessions = activeSessions.sort((a, b) => a.created_at - b.created_at)
      const sessionsToRevoke = sortedSessions.slice(0, sortedSessions.length - limit + 1)

      for (const session of sessionsToRevoke) {
        session.status = singleSessionMode ? 'replaced' : 'revoked'
        session.updated_at = Date.now()
        await sessionStore.put(`session:${session.id}`, session, Date.now())
        await emitEvent('session.revoked', toClerkSession(session))
      }
    }
  }

  // ============================================================================
  // API IMPLEMENTATION
  // ============================================================================

  return {
    // ═══════════════════════════════════════════════════════════════════════════
    // SESSION MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    async getSession(sessionId: string): Promise<ClerkSession> {
      const session = await sessionStore.get(`session:${sessionId}`)
      if (!session) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Session not found' }])
      }

      // Check and update expiry status
      const checkedSession = await checkAndUpdateExpiry(session)

      return toClerkSession(checkedSession)
    },

    async listSessions(params?: ListSessionsParams): Promise<ClerkPaginatedList<ClerkSession>> {
      const { userId, clientId, status, limit = 10, offset = 0 } = params ?? {}

      let sessionIds: string[] = []

      if (userId) {
        sessionIds = (await userSessionsStore.get(`user_sessions:${userId}`)) ?? []
      } else if (clientId) {
        sessionIds = (await clientSessionsStore.get(`client_sessions:${clientId}`)) ?? []
      }

      const sessions: ClerkSession[] = []

      for (const sessionId of sessionIds) {
        const session = await sessionStore.get(`session:${sessionId}`)
        if (session) {
          // Check and update expiry
          const checkedSession = await checkAndUpdateExpiry(session)

          // Filter by status if provided
          if (!status || checkedSession.status === status) {
            sessions.push(toClerkSession(checkedSession))
          }
        }
      }

      // Sort by created_at descending (most recent first)
      sessions.sort((a, b) => b.created_at - a.created_at)

      return {
        data: sessions.slice(offset, offset + limit),
        total_count: sessions.length,
      }
    },

    async createSession(params: CreateSessionParams): Promise<ClerkSession> {
      const { userId, clientId, actor, expiresInSeconds, publicMetadata, privateMetadata, ipAddress, userAgent } = params

      // Verify user exists
      const user = await userManager.getUser(userId)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      // Enforce max sessions
      await enforceMaxSessions(userId)

      const now = Date.now()
      const sessionId = generateId('sess')
      const sessionClientId = clientId ?? generateId('client')
      const duration = (expiresInSeconds ?? defaultSessionDuration) * 1000
      const expireAt = now + duration
      const abandonAt = expireAt + abandonAfterExpiry * 1000

      const session: StoredSession = {
        id: sessionId,
        client_id: sessionClientId,
        user_id: userId,
        status: 'active',
        last_active_at: now,
        last_active_organization_id: null,
        actor: actor ?? null,
        expire_at: expireAt,
        abandon_at: abandonAt,
        created_at: now,
        updated_at: now,
        public_metadata: publicMetadata ?? {},
        private_metadata: privateMetadata ?? {},
        ip_address: ipAddress,
        user_agent: userAgent,
      }

      await sessionStore.put(`session:${sessionId}`, session, now, {
        ttl: abandonAt - now,
      })

      await addUserSession(userId, sessionId)
      await addClientSession(sessionClientId, sessionId)

      const clerkSession = toClerkSession(session)
      await emitEvent('session.created', clerkSession)

      return clerkSession
    },

    async revokeSession(sessionId: string): Promise<ClerkSession> {
      const session = await sessionStore.get(`session:${sessionId}`)
      if (!session) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Session not found' }])
      }

      if (session.status !== 'active') {
        throw new ClerkAPIError(422, [{ code: 'session_not_active', message: 'Session is not active' }])
      }

      session.status = 'revoked'
      session.updated_at = Date.now()

      await sessionStore.put(`session:${sessionId}`, session, Date.now())

      const clerkSession = toClerkSession(session)
      await emitEvent('session.revoked', clerkSession)

      return clerkSession
    },

    async revokeSessions(userId: string, exceptSessionId?: string): Promise<ClerkPaginatedList<ClerkSession>> {
      const sessionIds = (await userSessionsStore.get(`user_sessions:${userId}`)) ?? []
      const revokedSessions: ClerkSession[] = []

      for (const sessionId of sessionIds) {
        if (sessionId === exceptSessionId) continue

        const session = await sessionStore.get(`session:${sessionId}`)
        if (session && session.status === 'active') {
          session.status = 'revoked'
          session.updated_at = Date.now()

          await sessionStore.put(`session:${sessionId}`, session, Date.now())

          const clerkSession = toClerkSession(session)
          revokedSessions.push(clerkSession)
          await emitEvent('session.revoked', clerkSession)
        }
      }

      return {
        data: revokedSessions,
        total_count: revokedSessions.length,
      }
    },

    async endSession(sessionId: string): Promise<ClerkSession> {
      const session = await sessionStore.get(`session:${sessionId}`)
      if (!session) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Session not found' }])
      }

      session.status = 'ended'
      session.updated_at = Date.now()

      await sessionStore.put(`session:${sessionId}`, session, Date.now())
      await removeUserSession(session.user_id, sessionId)

      const clerkSession = toClerkSession(session)
      await emitEvent('session.ended', clerkSession)

      return clerkSession
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // SESSION TOKEN MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    async createSessionToken(
      sessionId: string,
      params?: CreateSessionTokenParams
    ): Promise<{ jwt: string; object: 'token' }> {
      const session = await sessionStore.get(`session:${sessionId}`)
      if (!session) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Session not found' }])
      }

      if (session.status !== 'active') {
        throw new ClerkAPIError(401, [{ code: 'session_not_active', message: 'Session is not active' }])
      }

      // Check expiry
      if (isSessionExpired(session)) {
        session.status = 'expired'
        session.updated_at = Date.now()
        await sessionStore.put(`session:${sessionId}`, session, Date.now())
        await emitEvent('session.expired', toClerkSession(session))
        throw new ClerkAPIError(401, [{ code: 'session_expired', message: 'Session has expired' }])
      }

      const user = await userManager.getUser(session.user_id)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      const now = Date.now()
      const tokenId = generateId('tok')

      // Get template claims if template is specified
      let templateClaims: Record<string, unknown> = {}
      let tokenLifetime = params?.expiresInSeconds ?? defaultTokenDuration

      if (params?.templateName) {
        const template = await jwtTemplateStore.get(`jwt_template:${params.templateName}`)
        if (template) {
          templateClaims = { ...template.claims }
          tokenLifetime = template.lifetime
        }
      }

      // Build token claims
      const claims: ClerkSessionClaims & Record<string, unknown> = {
        azp: session.client_id,
        exp: Math.floor(now / 1000) + tokenLifetime,
        iat: Math.floor(now / 1000),
        iss: issuer,
        nbf: Math.floor(now / 1000),
        sid: session.id,
        sub: session.user_id,
        // User data
        email: user.email,
        name: user.name,
        // Template claims
        ...templateClaims,
        // Custom claims
        ...params?.claims,
        // Session metadata
        ...session.public_metadata,
      }

      // Handle actor for impersonation
      if (session.actor) {
        claims.act = session.actor
      }

      const jwtOptions: JWTCreateOptions = {
        secret: jwtSecret,
        algorithm: jwtAlgorithm,
        issuer,
        subject: session.user_id,
        expiresIn: tokenLifetime,
      }

      const jwt = await createJWT(claims, jwtOptions)

      // Store token for tracking
      const token: SessionToken = {
        id: tokenId,
        session_id: sessionId,
        user_id: session.user_id,
        jwt,
        template_id: params?.templateName,
        claims,
        created_at: now,
        expires_at: now + tokenLifetime * 1000,
      }

      await tokenStore.put(`token:${tokenId}`, token, now, {
        ttl: tokenLifetime * 1000,
      })

      // Update session's current token
      session.current_token_id = tokenId
      session.last_active_at = now
      session.updated_at = now
      await sessionStore.put(`session:${sessionId}`, session, now)

      return { jwt, object: 'token' }
    },

    async verifySessionToken(
      token: string,
      options?: { authorizedParties?: string[] }
    ): Promise<{
      userId: string
      sessionId: string
      claims: ClerkSessionClaims & Record<string, unknown>
    }> {
      const verifyOptions: JWTVerifyOptions = {
        secret: jwtSecret,
        algorithms: [jwtAlgorithm],
        issuer,
      }

      const result = await verifyJWT(token, verifyOptions)

      if (!result.valid || !result.claims) {
        throw new ClerkAPIError(401, [
          { code: 'session_token_invalid', message: result.error?.message ?? 'Invalid session token' },
        ])
      }

      const claims = result.claims as ClerkSessionClaims & Record<string, unknown>

      // Verify authorized parties if provided
      if (options?.authorizedParties && claims.azp) {
        if (!options.authorizedParties.includes(claims.azp)) {
          throw new ClerkAPIError(401, [{ code: 'unauthorized_party', message: 'Unauthorized party' }])
        }
      }

      // Verify session still exists and is active
      const sessionId = claims.sid
      if (!sessionId) {
        throw new ClerkAPIError(401, [{ code: 'session_token_invalid', message: 'Token missing session ID' }])
      }

      const session = await sessionStore.get(`session:${sessionId}`)
      if (!session) {
        throw new ClerkAPIError(401, [{ code: 'session_not_found', message: 'Session not found' }])
      }

      if (session.status !== 'active') {
        throw new ClerkAPIError(401, [{ code: 'session_not_active', message: `Session is ${session.status}` }])
      }

      // Update last active
      session.last_active_at = Date.now()
      session.updated_at = Date.now()
      await sessionStore.put(`session:${sessionId}`, session, Date.now())

      return {
        userId: claims.sub ?? session.user_id,
        sessionId,
        claims,
      }
    },

    async refreshSession(sessionId: string): Promise<ClerkSession> {
      const session = await sessionStore.get(`session:${sessionId}`)
      if (!session) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Session not found' }])
      }

      if (session.status !== 'active') {
        throw new ClerkAPIError(401, [{ code: 'session_not_active', message: 'Session is not active' }])
      }

      // Extend session expiry
      const now = Date.now()
      const newExpiry = now + defaultSessionDuration * 1000
      const newAbandon = newExpiry + abandonAfterExpiry * 1000

      session.expire_at = newExpiry
      session.abandon_at = newAbandon
      session.last_active_at = now
      session.updated_at = now

      await sessionStore.put(`session:${sessionId}`, session, now)

      return toClerkSession(session)
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // SESSION CLAIMS
    // ═══════════════════════════════════════════════════════════════════════════

    async getSessionClaims(sessionId: string): Promise<Record<string, unknown>> {
      const session = await sessionStore.get(`session:${sessionId}`)
      if (!session) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Session not found' }])
      }

      return {
        public_metadata: session.public_metadata,
        private_metadata: session.private_metadata,
        actor: session.actor,
        last_active_organization_id: session.last_active_organization_id,
      }
    },

    async updateSessionClaims(
      sessionId: string,
      claims: { publicMetadata?: Record<string, unknown>; privateMetadata?: Record<string, unknown> }
    ): Promise<ClerkSession> {
      const session = await sessionStore.get(`session:${sessionId}`)
      if (!session) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Session not found' }])
      }

      const now = Date.now()

      if (claims.publicMetadata !== undefined) {
        session.public_metadata = { ...session.public_metadata, ...claims.publicMetadata }
      }

      if (claims.privateMetadata !== undefined) {
        session.private_metadata = { ...session.private_metadata, ...claims.privateMetadata }
      }

      session.updated_at = now

      await sessionStore.put(`session:${sessionId}`, session, now)

      return toClerkSession(session)
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // MULTI-SESSION SUPPORT
    // ═══════════════════════════════════════════════════════════════════════════

    async getSingleSessionToken(userId: string): Promise<{ jwt: string; sessionId: string } | null> {
      const sessionIds = (await userSessionsStore.get(`user_sessions:${userId}`)) ?? []

      // Find the most recent active session
      let latestSession: StoredSession | null = null

      for (const sessionId of sessionIds) {
        const session = await sessionStore.get(`session:${sessionId}`)
        if (session && session.status === 'active') {
          if (!latestSession || session.created_at > latestSession.created_at) {
            // Check expiry
            if (!isSessionExpired(session)) {
              latestSession = session
            }
          }
        }
      }

      if (!latestSession) {
        return null
      }

      // Generate token for the session
      const { jwt } = await this.createSessionToken(latestSession.id)

      return {
        jwt,
        sessionId: latestSession.id,
      }
    },

    async rotateSessionToken(sessionId: string): Promise<{ jwt: string; object: 'token' }> {
      const session = await sessionStore.get(`session:${sessionId}`)
      if (!session) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Session not found' }])
      }

      if (session.status !== 'active') {
        throw new ClerkAPIError(401, [{ code: 'session_not_active', message: 'Session is not active' }])
      }

      // Invalidate current token if exists
      if (session.current_token_id) {
        await tokenStore.put(`token:${session.current_token_id}`, null as unknown as SessionToken, Date.now())
      }

      // Generate new token
      const result = await this.createSessionToken(sessionId)

      // Update rotation timestamp
      session.token_rotated_at = Date.now()
      await sessionStore.put(`session:${sessionId}`, session, Date.now())

      await emitEvent('session.token_rotated', toClerkSession(session))

      return result
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // SESSION EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    onSessionCreated(handler: SessionEventHandler): () => void {
      const handlers = eventHandlers.get('session.created')!
      handlers.add(handler)
      return () => handlers.delete(handler)
    },

    onSessionRevoked(handler: SessionEventHandler): () => void {
      const handlers = eventHandlers.get('session.revoked')!
      handlers.add(handler)
      return () => handlers.delete(handler)
    },

    onSessionExpired(handler: SessionEventHandler): () => void {
      const handlers = eventHandlers.get('session.expired')!
      handlers.add(handler)
      return () => handlers.delete(handler)
    },

    onSessionEnded(handler: SessionEventHandler): () => void {
      const handlers = eventHandlers.get('session.ended')!
      handlers.add(handler)
      return () => handlers.delete(handler)
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // JWT TEMPLATE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    async setJWTTemplate(templateId: string, template: ClerkJWTTemplate): Promise<void> {
      await jwtTemplateStore.put(`jwt_template:${templateId}`, template, Date.now())
      // Also index by name
      await jwtTemplateStore.put(`jwt_template:${template.name}`, template, Date.now())
    },

    async getJWTTemplate(templateId: string): Promise<ClerkJWTTemplate | null> {
      return jwtTemplateStore.get(`jwt_template:${templateId}`)
    },
  }
}

// ============================================================================
// CONVENIENCE EXPORTS
// ============================================================================

export type { ClerkSession, ClerkSessionActor, ClerkSessionClaims }
