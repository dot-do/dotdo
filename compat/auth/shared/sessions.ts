/**
 * @dotdo/auth - Session Management
 *
 * Session management using TemporalStore for time-aware storage.
 * Supports session creation, validation, refresh, and revocation.
 *
 * @module
 */

import { createTemporalStore, type TemporalStore } from '../../../db/primitives/temporal-store'
import type { Session, SessionRecord, TokenPair, DeviceInfo, User } from './types'
import { AuthenticationError } from './types'
import { createJWT, verifyJWT, type JWTCreateOptions, type JWTVerifyOptions } from './jwt'

// ============================================================================
// SESSION MANAGER OPTIONS
// ============================================================================

/**
 * Session manager configuration
 */
export interface SessionManagerOptions {
  /** JWT signing secret */
  jwtSecret: string
  /** JWT algorithm (default: HS256) */
  jwtAlgorithm?: 'HS256' | 'RS256' | 'ES256'
  /** Access token lifetime in seconds (default: 3600 = 1 hour) */
  accessTokenTTL?: number
  /** Refresh token lifetime in seconds (default: 604800 = 7 days) */
  refreshTokenTTL?: number
  /** Session lifetime in seconds (default: 2592000 = 30 days) */
  sessionTTL?: number
  /** JWT issuer */
  issuer?: string
  /** JWT audience */
  audience?: string
  /** Maximum sessions per user (0 = unlimited) */
  maxSessionsPerUser?: number
  /** Whether to rotate refresh tokens on use */
  rotateRefreshTokens?: boolean
  /** Sliding session window (extend session on activity) */
  slidingSession?: boolean
  /** Sliding window extension in seconds */
  slidingWindowExtension?: number
}

/**
 * Session creation options
 */
export interface CreateSessionOptions {
  /** Client ID (for OAuth flows) */
  clientId?: string
  /** IP address */
  ipAddress?: string
  /** User agent string */
  userAgent?: string
  /** Device information */
  deviceInfo?: DeviceInfo
  /** Custom claims to include in tokens */
  claims?: Record<string, unknown>
  /** Specific scopes for this session */
  scope?: string
}

/**
 * Session validation result
 */
export interface SessionValidationResult {
  valid: boolean
  session?: Session
  user?: User
  error?: string
}

// ============================================================================
// SESSION MANAGER
// ============================================================================

/**
 * Session manager with TemporalStore backend
 */
export class SessionManager {
  private options: Required<SessionManagerOptions>
  private sessionStore: TemporalStore<SessionRecord>
  private refreshTokenStore: TemporalStore<{ session_id: string; user_id: string; expires_at: string }>

  constructor(options: SessionManagerOptions) {
    this.options = {
      jwtSecret: options.jwtSecret,
      jwtAlgorithm: options.jwtAlgorithm ?? 'HS256',
      accessTokenTTL: options.accessTokenTTL ?? 3600,
      refreshTokenTTL: options.refreshTokenTTL ?? 604800,
      sessionTTL: options.sessionTTL ?? 2592000,
      issuer: options.issuer ?? '',
      audience: options.audience ?? '',
      maxSessionsPerUser: options.maxSessionsPerUser ?? 0,
      rotateRefreshTokens: options.rotateRefreshTokens ?? true,
      slidingSession: options.slidingSession ?? false,
      slidingWindowExtension: options.slidingWindowExtension ?? 3600,
    }

    // Create temporal stores for sessions and refresh tokens
    this.sessionStore = createTemporalStore<SessionRecord>({ enableTTL: true })
    this.refreshTokenStore = createTemporalStore<{ session_id: string; user_id: string; expires_at: string }>({
      enableTTL: true,
    })
  }

  /**
   * Create a new session for a user
   */
  async createSession(user: User, options: CreateSessionOptions = {}): Promise<{ session: Session; tokens: TokenPair }> {
    const now = new Date()
    const sessionId = this.generateId('sess')

    // Check max sessions per user
    if (this.options.maxSessionsPerUser > 0) {
      await this.enforceMaxSessions(user.id)
    }

    // Create session record
    const session: SessionRecord = {
      id: sessionId,
      user_id: user.id,
      client_id: options.clientId,
      status: 'active',
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      expires_at: new Date(now.getTime() + this.options.sessionTTL * 1000).toISOString(),
      last_active_at: now.toISOString(),
      ip_address: options.ipAddress,
      user_agent: options.userAgent,
      device_info: options.deviceInfo,
    }

    // Store session
    await this.sessionStore.put(`session:${sessionId}`, session, Date.now(), {
      ttl: this.options.sessionTTL * 1000,
    })

    // Add to user's session list
    await this.addUserSession(user.id, sessionId)

    // Generate tokens
    const tokens = await this.generateTokens(user, session, options)

    // Store refresh token mapping
    if (tokens.refresh_token) {
      const refreshTokenHash = await this.hashToken(tokens.refresh_token)
      await this.refreshTokenStore.put(
        `refresh:${refreshTokenHash}`,
        {
          session_id: sessionId,
          user_id: user.id,
          expires_at: new Date(now.getTime() + this.options.refreshTokenTTL * 1000).toISOString(),
        },
        Date.now(),
        { ttl: this.options.refreshTokenTTL * 1000 }
      )
    }

    return { session, tokens }
  }

  /**
   * Validate an access token and return session
   */
  async validateAccessToken(accessToken: string): Promise<SessionValidationResult> {
    const verifyOptions: JWTVerifyOptions = {
      secret: this.options.jwtSecret,
      algorithms: [this.options.jwtAlgorithm],
      issuer: this.options.issuer || undefined,
      audience: this.options.audience || undefined,
    }

    const result = await verifyJWT(accessToken, verifyOptions)

    if (!result.valid || !result.claims) {
      return { valid: false, error: result.error?.message ?? 'Invalid token' }
    }

    const sessionId = result.claims.sid as string
    if (!sessionId) {
      return { valid: false, error: 'Token missing session ID' }
    }

    // Get session
    const session = await this.sessionStore.get(`session:${sessionId}`)
    if (!session) {
      return { valid: false, error: 'Session not found' }
    }

    // Check session status
    if (session.status !== 'active') {
      return { valid: false, error: `Session is ${session.status}` }
    }

    // Check session expiration
    if (new Date(session.expires_at) < new Date()) {
      return { valid: false, error: 'Session expired' }
    }

    // Update last active (sliding session)
    if (this.options.slidingSession) {
      await this.touchSession(sessionId)
    }

    return {
      valid: true,
      session: {
        id: session.id,
        user_id: session.user_id,
        client_id: session.client_id,
        status: session.status,
        created_at: session.created_at,
        updated_at: session.updated_at,
        expires_at: session.expires_at,
        last_active_at: session.last_active_at,
        ip_address: session.ip_address,
        user_agent: session.user_agent,
        device_info: session.device_info,
      },
    }
  }

  /**
   * Refresh tokens using a refresh token
   */
  async refreshTokens(
    refreshToken: string,
    user: User,
    options: CreateSessionOptions = {}
  ): Promise<{ session: Session; tokens: TokenPair }> {
    const refreshTokenHash = await this.hashToken(refreshToken)
    const tokenData = await this.refreshTokenStore.get(`refresh:${refreshTokenHash}`)

    if (!tokenData) {
      throw new AuthenticationError('invalid_token', 'Invalid refresh token')
    }

    // Verify user matches
    if (tokenData.user_id !== user.id) {
      throw new AuthenticationError('invalid_token', 'Token does not belong to user')
    }

    // Check expiration
    if (new Date(tokenData.expires_at) < new Date()) {
      throw new AuthenticationError('token_expired', 'Refresh token expired')
    }

    // Get session
    const session = await this.sessionStore.get(`session:${tokenData.session_id}`)
    if (!session || session.status !== 'active') {
      throw new AuthenticationError('invalid_session', 'Session is not active')
    }

    // Rotate refresh token if configured
    if (this.options.rotateRefreshTokens) {
      // Invalidate old refresh token
      await this.refreshTokenStore.put(`refresh:${refreshTokenHash}`, null as never, Date.now())
    }

    // Generate new tokens
    const tokens = await this.generateTokens(user, session, options)

    // Store new refresh token
    if (tokens.refresh_token && this.options.rotateRefreshTokens) {
      const newRefreshTokenHash = await this.hashToken(tokens.refresh_token)
      await this.refreshTokenStore.put(
        `refresh:${newRefreshTokenHash}`,
        {
          session_id: session.id,
          user_id: user.id,
          expires_at: new Date(Date.now() + this.options.refreshTokenTTL * 1000).toISOString(),
        },
        Date.now(),
        { ttl: this.options.refreshTokenTTL * 1000 }
      )
    }

    // Update session
    const now = new Date()
    session.last_active_at = now.toISOString()
    session.updated_at = now.toISOString()
    await this.sessionStore.put(`session:${session.id}`, session, Date.now())

    return {
      session: {
        id: session.id,
        user_id: session.user_id,
        client_id: session.client_id,
        status: session.status,
        created_at: session.created_at,
        updated_at: session.updated_at,
        expires_at: session.expires_at,
        last_active_at: session.last_active_at,
        ip_address: session.ip_address,
        user_agent: session.user_agent,
        device_info: session.device_info,
      },
      tokens,
    }
  }

  /**
   * Revoke a session
   */
  async revokeSession(sessionId: string): Promise<void> {
    const session = await this.sessionStore.get(`session:${sessionId}`)
    if (!session) return

    session.status = 'revoked'
    session.updated_at = new Date().toISOString()
    await this.sessionStore.put(`session:${sessionId}`, session, Date.now())

    // Remove from user's session list
    await this.removeUserSession(session.user_id, sessionId)
  }

  /**
   * Revoke all sessions for a user
   */
  async revokeAllUserSessions(userId: string, exceptSessionId?: string): Promise<number> {
    const sessionIds = await this.getUserSessionIds(userId)
    let revokedCount = 0

    for (const sessionId of sessionIds) {
      if (sessionId !== exceptSessionId) {
        await this.revokeSession(sessionId)
        revokedCount++
      }
    }

    return revokedCount
  }

  /**
   * Get a session by ID
   */
  async getSession(sessionId: string): Promise<Session | null> {
    const session = await this.sessionStore.get(`session:${sessionId}`)
    if (!session) return null

    return {
      id: session.id,
      user_id: session.user_id,
      client_id: session.client_id,
      status: session.status,
      created_at: session.created_at,
      updated_at: session.updated_at,
      expires_at: session.expires_at,
      last_active_at: session.last_active_at,
      ip_address: session.ip_address,
      user_agent: session.user_agent,
      device_info: session.device_info,
    }
  }

  /**
   * List all sessions for a user
   */
  async listUserSessions(userId: string): Promise<Session[]> {
    const sessionIds = await this.getUserSessionIds(userId)
    const sessions: Session[] = []

    for (const sessionId of sessionIds) {
      const session = await this.getSession(sessionId)
      if (session && session.status === 'active') {
        sessions.push(session)
      }
    }

    return sessions
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Generate access and refresh tokens
   */
  private async generateTokens(user: User, session: SessionRecord, options: CreateSessionOptions): Promise<TokenPair> {
    const now = Date.now()

    const jwtOptions: JWTCreateOptions = {
      secret: this.options.jwtSecret,
      algorithm: this.options.jwtAlgorithm,
      issuer: this.options.issuer,
      audience: this.options.audience,
      subject: user.id,
      expiresIn: this.options.accessTokenTTL,
    }

    // Build claims
    const claims = {
      email: user.email,
      name: user.name,
      sid: session.id,
      ...options.claims,
    }

    if (options.scope) {
      (claims as Record<string, unknown>).scope = options.scope
    }

    const accessToken = await createJWT(claims, jwtOptions)

    // Generate refresh token (opaque token)
    const refreshToken = this.generateOpaqueToken()

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: this.options.accessTokenTTL,
      expires_at: Math.floor(now / 1000) + this.options.accessTokenTTL,
      scope: options.scope,
    }
  }

  /**
   * Generate a unique ID
   */
  private generateId(prefix: string): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return `${prefix}_${hex}`
  }

  /**
   * Generate an opaque refresh token
   */
  private generateOpaqueToken(): string {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  /**
   * Hash a token for storage
   */
  private async hashToken(token: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(token)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  /**
   * Touch session (update last_active_at)
   */
  private async touchSession(sessionId: string): Promise<void> {
    const session = await this.sessionStore.get(`session:${sessionId}`)
    if (!session) return

    const now = new Date()
    session.last_active_at = now.toISOString()
    session.updated_at = now.toISOString()

    // Extend session if sliding window is enabled
    if (this.options.slidingSession) {
      const newExpiry = new Date(now.getTime() + this.options.slidingWindowExtension * 1000)
      const currentExpiry = new Date(session.expires_at)
      if (newExpiry > currentExpiry) {
        session.expires_at = newExpiry.toISOString()
      }
    }

    await this.sessionStore.put(`session:${sessionId}`, session, Date.now())
  }

  /**
   * Get user's session IDs
   */
  private async getUserSessionIds(userId: string): Promise<string[]> {
    const data = await this.sessionStore.get(`user_sessions:${userId}`)
    return (data as unknown as string[] | null) ?? []
  }

  /**
   * Add session to user's session list
   */
  private async addUserSession(userId: string, sessionId: string): Promise<void> {
    const sessions = await this.getUserSessionIds(userId)
    if (!sessions.includes(sessionId)) {
      sessions.push(sessionId)
      await this.sessionStore.put(`user_sessions:${userId}`, sessions as unknown as SessionRecord, Date.now())
    }
  }

  /**
   * Remove session from user's session list
   */
  private async removeUserSession(userId: string, sessionId: string): Promise<void> {
    const sessions = await this.getUserSessionIds(userId)
    const index = sessions.indexOf(sessionId)
    if (index !== -1) {
      sessions.splice(index, 1)
      await this.sessionStore.put(`user_sessions:${userId}`, sessions as unknown as SessionRecord, Date.now())
    }
  }

  /**
   * Enforce maximum sessions per user
   */
  private async enforceMaxSessions(userId: string): Promise<void> {
    if (this.options.maxSessionsPerUser <= 0) return

    const sessions = await this.listUserSessions(userId)
    if (sessions.length >= this.options.maxSessionsPerUser) {
      // Revoke oldest session
      const sortedSessions = sessions.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
      const oldestSession = sortedSessions[0]
      if (oldestSession) {
        await this.revokeSession(oldestSession.id)
      }
    }
  }
}

/**
 * Create a session manager instance
 */
export function createSessionManager(options: SessionManagerOptions): SessionManager {
  return new SessionManager(options)
}
