/**
 * @dotdo/auth - Session Management
 *
 * Session creation, validation, and revocation.
 *
 * @module
 */

import type { User, Session, SessionRecord, TokenPair, DeviceInfo, AuthConfig } from './types'
import { AuthError, AuthErrors } from './error'
import { IndexedStorage } from './storage'
import { createJWT, verifyJWT, type JWTCreateOptions, type JWTVerifyOptions } from './jwt'

// ============================================================================
// SESSION MANAGER OPTIONS
// ============================================================================

export interface CreateSessionOptions {
  clientId?: string
  ipAddress?: string
  userAgent?: string
  deviceInfo?: DeviceInfo
  claims?: Record<string, unknown>
  scope?: string
}

export interface SessionValidationResult {
  valid: boolean
  session?: Session
  user?: User
  error?: string
}

// ============================================================================
// SESSION MANAGER
// ============================================================================

export class SessionManager {
  private storage: IndexedStorage
  private jwtSecret: string
  private jwtAlgorithm: 'HS256' | 'RS256' | 'ES256'
  private accessTokenTTL: number
  private refreshTokenTTL: number
  private sessionTTL: number
  private issuer: string
  private audience: string | string[] | undefined
  private maxSessionsPerUser: number
  private rotateRefreshTokens: boolean

  constructor(storage: IndexedStorage, config: AuthConfig) {
    this.storage = storage
    this.jwtSecret = config.jwtSecret
    this.jwtAlgorithm = config.jwtAlgorithm ?? 'HS256'
    this.accessTokenTTL = config.accessTokenTTL ?? 3600
    this.refreshTokenTTL = config.refreshTokenTTL ?? 604800
    this.sessionTTL = config.sessionTTL ?? 2592000
    this.issuer = config.issuer ?? ''
    this.audience = config.audience
    this.maxSessionsPerUser = config.maxSessionsPerUser ?? 0
    this.rotateRefreshTokens = config.rotateRefreshTokens ?? true
  }

  /**
   * Create a new session for a user
   */
  async create(user: User, options: CreateSessionOptions = {}): Promise<{ session: Session; tokens: TokenPair }> {
    const now = new Date()
    const sessionId = this.generateId('sess')

    // Check max sessions per user
    if (this.maxSessionsPerUser > 0) {
      await this.enforceMaxSessions(user.id)
    }

    const session: SessionRecord = {
      id: sessionId,
      user_id: user.id,
      client_id: options.clientId,
      status: 'active',
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      expires_at: new Date(now.getTime() + this.sessionTTL * 1000).toISOString(),
      last_active_at: now.toISOString(),
      ip_address: options.ipAddress,
      user_agent: options.userAgent,
      device_info: options.deviceInfo,
    }

    // Store session
    await this.storage.put(`session:${sessionId}`, session, {
      ttl: this.sessionTTL * 1000,
    })

    // Add to user's session list
    await this.addUserSession(user.id, sessionId)

    // Generate tokens
    const tokens = await this.generateTokens(user, session, options)

    // Store refresh token mapping
    if (tokens.refresh_token) {
      const refreshTokenHash = await this.hashToken(tokens.refresh_token)
      await this.storage.put(
        `refresh:${refreshTokenHash}`,
        {
          session_id: sessionId,
          user_id: user.id,
          expires_at: new Date(now.getTime() + this.refreshTokenTTL * 1000).toISOString(),
        },
        { ttl: this.refreshTokenTTL * 1000 }
      )
    }

    return { session: this.toPublicSession(session), tokens }
  }

  /**
   * Validate an access token
   */
  async validate(accessToken: string): Promise<SessionValidationResult> {
    const verifyOptions: JWTVerifyOptions = {
      secret: this.jwtSecret,
      algorithms: [this.jwtAlgorithm],
      issuer: this.issuer || undefined,
      audience: this.audience,
    }

    const result = await verifyJWT(accessToken, verifyOptions)

    if (!result.valid || !result.claims) {
      return { valid: false, error: result.error?.message ?? 'Invalid token' }
    }

    const sessionId = result.claims.sid as string
    if (!sessionId) {
      return { valid: false, error: 'Token missing session ID' }
    }

    const session = await this.storage.get<SessionRecord>(`session:${sessionId}`)
    if (!session) {
      return { valid: false, error: 'Session not found' }
    }

    if (session.status !== 'active') {
      return { valid: false, error: `Session is ${session.status}` }
    }

    if (new Date(session.expires_at) < new Date()) {
      return { valid: false, error: 'Session expired' }
    }

    return {
      valid: true,
      session: this.toPublicSession(session),
    }
  }

  /**
   * Refresh tokens using a refresh token
   */
  async refresh(refreshToken: string, user: User, options: CreateSessionOptions = {}): Promise<{ session: Session; tokens: TokenPair }> {
    const refreshTokenHash = await this.hashToken(refreshToken)
    const tokenData = await this.storage.get<{ session_id: string; user_id: string; expires_at: string }>(`refresh:${refreshTokenHash}`)

    if (!tokenData) {
      throw AuthErrors.invalidToken()
    }

    if (tokenData.user_id !== user.id) {
      throw new AuthError('invalid_token', 'Token does not belong to user', 401)
    }

    if (new Date(tokenData.expires_at) < new Date()) {
      throw AuthErrors.tokenExpired()
    }

    const session = await this.storage.get<SessionRecord>(`session:${tokenData.session_id}`)
    if (!session || session.status !== 'active') {
      throw AuthErrors.sessionRevoked()
    }

    // Rotate refresh token if configured
    if (this.rotateRefreshTokens) {
      await this.storage.delete(`refresh:${refreshTokenHash}`)
    }

    // Generate new tokens
    const tokens = await this.generateTokens(user, session, options)

    // Store new refresh token
    if (tokens.refresh_token && this.rotateRefreshTokens) {
      const newRefreshTokenHash = await this.hashToken(tokens.refresh_token)
      await this.storage.put(
        `refresh:${newRefreshTokenHash}`,
        {
          session_id: session.id,
          user_id: user.id,
          expires_at: new Date(Date.now() + this.refreshTokenTTL * 1000).toISOString(),
        },
        { ttl: this.refreshTokenTTL * 1000 }
      )
    }

    // Update session
    const now = new Date()
    session.last_active_at = now.toISOString()
    session.updated_at = now.toISOString()
    await this.storage.put(`session:${session.id}`, session)

    return {
      session: this.toPublicSession(session),
      tokens,
    }
  }

  /**
   * Revoke a session
   */
  async revoke(sessionId: string): Promise<void> {
    const session = await this.storage.get<SessionRecord>(`session:${sessionId}`)
    if (!session) return

    session.status = 'revoked'
    session.updated_at = new Date().toISOString()
    await this.storage.put(`session:${sessionId}`, session)

    await this.removeUserSession(session.user_id, sessionId)
  }

  /**
   * Revoke all sessions for a user
   */
  async revokeAll(userId: string, exceptSessionId?: string): Promise<number> {
    const sessionIds = await this.getUserSessionIds(userId)
    let revokedCount = 0

    for (const sessionId of sessionIds) {
      if (sessionId !== exceptSessionId) {
        await this.revoke(sessionId)
        revokedCount++
      }
    }

    return revokedCount
  }

  /**
   * Get a session by ID
   */
  async get(sessionId: string): Promise<Session | null> {
    const session = await this.storage.get<SessionRecord>(`session:${sessionId}`)
    if (!session) return null
    return this.toPublicSession(session)
  }

  /**
   * List all active sessions for a user
   */
  async list(userId: string): Promise<Session[]> {
    const sessionIds = await this.getUserSessionIds(userId)
    const sessions: Session[] = []

    for (const sessionId of sessionIds) {
      const session = await this.get(sessionId)
      if (session && session.status === 'active') {
        sessions.push(session)
      }
    }

    return sessions
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private async generateTokens(user: User, session: SessionRecord, options: CreateSessionOptions): Promise<TokenPair> {
    const now = Date.now()

    const jwtOptions: JWTCreateOptions = {
      secret: this.jwtSecret,
      algorithm: this.jwtAlgorithm,
      issuer: this.issuer,
      audience: this.audience,
      subject: user.id,
      expiresIn: this.accessTokenTTL,
    }

    const claims: Record<string, unknown> = {
      email: user.email,
      name: user.name,
      sid: session.id,
      ...options.claims,
    }

    if (options.scope) {
      claims.scope = options.scope
    }

    const accessToken = await createJWT(claims, jwtOptions)
    const refreshToken = this.generateOpaqueToken()

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: this.accessTokenTTL,
      expires_at: Math.floor(now / 1000) + this.accessTokenTTL,
      scope: options.scope,
    }
  }

  private generateId(prefix: string): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return `${prefix}_${hex}`
  }

  private generateOpaqueToken(): string {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private async hashToken(token: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(token)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private async getUserSessionIds(userId: string): Promise<string[]> {
    const data = await this.storage.get<string[]>(`user_sessions:${userId}`)
    return data ?? []
  }

  private async addUserSession(userId: string, sessionId: string): Promise<void> {
    const sessions = await this.getUserSessionIds(userId)
    if (!sessions.includes(sessionId)) {
      sessions.push(sessionId)
      await this.storage.put(`user_sessions:${userId}`, sessions)
    }
  }

  private async removeUserSession(userId: string, sessionId: string): Promise<void> {
    const sessions = await this.getUserSessionIds(userId)
    const index = sessions.indexOf(sessionId)
    if (index !== -1) {
      sessions.splice(index, 1)
      await this.storage.put(`user_sessions:${userId}`, sessions)
    }
  }

  private async enforceMaxSessions(userId: string): Promise<void> {
    if (this.maxSessionsPerUser <= 0) return

    const sessions = await this.list(userId)
    if (sessions.length >= this.maxSessionsPerUser) {
      const sortedSessions = sessions.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
      const oldestSession = sortedSessions[0]
      if (oldestSession) {
        await this.revoke(oldestSession.id)
      }
    }
  }

  private toPublicSession(record: SessionRecord): Session {
    return {
      id: record.id,
      user_id: record.user_id,
      client_id: record.client_id,
      status: record.status,
      created_at: record.created_at,
      updated_at: record.updated_at,
      expires_at: record.expires_at,
      last_active_at: record.last_active_at,
      ip_address: record.ip_address,
      user_agent: record.user_agent,
      device_info: record.device_info,
    }
  }
}
