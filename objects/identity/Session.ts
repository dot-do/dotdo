/**
 * @module Session
 * @description Session Durable Object for authentication session management
 *
 * Session provides secure session management for authenticated identities.
 * Each session has a unique token, expiration time, and reference to the
 * identity it belongs to. Sessions can be refreshed, revoked, and validated.
 *
 * **Session Fields:**
 * | Field | Type | Description |
 * |-------|------|-------------|
 * | identityId | string | Reference to the authenticated identity |
 * | token | string | Secure session token |
 * | expiresAt | string | ISO 8601 expiration timestamp |
 * | metadata | object | Optional session metadata (user agent, IP, etc.) |
 *
 * **Events Emitted:**
 * | Event | When |
 * |-------|------|
 * | `session.created` | Session created |
 * | `session.refreshed` | Session expiration extended |
 * | `session.revoked` | Session invalidated |
 * | `session.expired` | Session has expired |
 *
 * @example Creating a Session
 * ```typescript
 * const stub = env.Session.get(env.Session.idFromName(sessionId))
 * const session = await stub.createSession({
 *   identityId: 'https://schema.org.ai/users/user-123',
 *   metadata: { userAgent: 'Mozilla/5.0...', ip: '192.168.1.1' }
 * })
 * ```
 *
 * @example Validating a Session
 * ```typescript
 * const isValid = await stub.isValid()
 * if (!isValid) {
 *   // Redirect to login
 * }
 * ```
 *
 * @example Refreshing a Session
 * ```typescript
 * const refreshedSession = await stub.refresh()
 * // Session expiration extended by default duration (24 hours)
 * ```
 *
 * @see Identity - Base identity class
 * @see User - Human user identity
 */

import { DO, type Env } from '../core/DO'
import type { Session as SessionType } from 'id.org.ai'
import { Session as SessionNoun } from '../../nouns/identity/Session'

/**
 * Session data stored in the DO
 */
export interface SessionData {
  /** Unique identifier URI (JSON-LD @id) */
  $id: string
  /** Type discriminator (JSON-LD @type) */
  $type: 'https://schema.org.ai/Session'
  /** Reference to the authenticated identity */
  identityId: string
  /** Secure session token */
  token: string
  /** ISO 8601 timestamp when the session expires */
  expiresAt: string
  /** ISO 8601 timestamp when the session was created */
  createdAt: string
  /** ISO 8601 timestamp when the session was last refreshed */
  refreshedAt?: string
  /** Optional metadata about the session */
  metadata?: Record<string, unknown>
  /** Whether the session has been revoked */
  revoked?: boolean
  /** ISO 8601 timestamp when the session was revoked */
  revokedAt?: string
}

/**
 * Options for creating a session
 */
export interface CreateSessionOptions {
  /** Reference to the authenticated identity (required) */
  identityId: string
  /** Custom session token (auto-generated if not provided) */
  token?: string
  /** Custom expiration (defaults to 24 hours from now) */
  expiresAt?: string
  /** Session duration in milliseconds (alternative to expiresAt) */
  durationMs?: number
  /** Optional session metadata */
  metadata?: Record<string, unknown>
}

/**
 * Options for refreshing a session
 */
export interface RefreshSessionOptions {
  /** New expiration time (defaults to 24 hours from now) */
  expiresAt?: string
  /** Duration to extend in milliseconds (alternative to expiresAt) */
  durationMs?: number
  /** Update metadata on refresh */
  metadata?: Record<string, unknown>
}

/**
 * Session validation result
 */
export interface SessionValidation {
  /** Whether the session is valid */
  valid: boolean
  /** Reason if invalid */
  reason?: 'not_found' | 'expired' | 'revoked'
  /** The session data if valid */
  session?: SessionData
  /** Time remaining in milliseconds (if valid) */
  remainingMs?: number
}

/** Default session duration: 24 hours */
const DEFAULT_SESSION_DURATION_MS = 24 * 60 * 60 * 1000

/**
 * Session - Durable Object for authentication session management
 *
 * Provides session lifecycle management including creation, validation,
 * refresh, and revocation. Sessions are automatically tracked with
 * expiration times and can store arbitrary metadata.
 */
export class Session extends DO {
  static override readonly $type: string = SessionNoun.$type
  static readonly noun = SessionNoun

  /** Storage key for session data */
  protected static readonly SESSION_KEY = 'session'

  /** Cached session data */
  private _sessionData: SessionData | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Generate a secure random token
   */
  private generateToken(): string {
    return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    const uuid = crypto.randomUUID()
    return `https://schema.org.ai/sessions/${uuid}`
  }

  /**
   * Get the session data
   */
  async getSession(): Promise<SessionData | null> {
    if (this._sessionData) {
      return this._sessionData
    }

    this._sessionData = await this.ctx.storage.get<SessionData>(Session.SESSION_KEY) ?? null
    return this._sessionData
  }

  /**
   * Create a new session
   *
   * @param options - Session creation options
   * @returns The created session data
   */
  async createSession(options: CreateSessionOptions): Promise<SessionData> {
    const existing = await this.getSession()
    if (existing && !existing.revoked) {
      throw new Error('Session already exists')
    }

    if (!options.identityId) {
      throw new Error('identityId is required')
    }

    const now = new Date()
    const nowIso = now.toISOString()

    // Calculate expiration
    let expiresAt: string
    if (options.expiresAt) {
      expiresAt = options.expiresAt
    } else if (options.durationMs) {
      expiresAt = new Date(now.getTime() + options.durationMs).toISOString()
    } else {
      expiresAt = new Date(now.getTime() + DEFAULT_SESSION_DURATION_MS).toISOString()
    }

    const sessionData: SessionData = {
      $id: this.generateSessionId(),
      $type: 'https://schema.org.ai/Session',
      identityId: options.identityId,
      token: options.token ?? this.generateToken(),
      expiresAt,
      createdAt: nowIso,
      metadata: options.metadata,
    }

    await this.ctx.storage.put(Session.SESSION_KEY, sessionData)
    this._sessionData = sessionData

    await this.emit('session.created', {
      session: {
        $id: sessionData.$id,
        identityId: sessionData.identityId,
        expiresAt: sessionData.expiresAt,
      },
    })

    return sessionData
  }

  /**
   * Check if the session is valid (exists, not expired, not revoked)
   */
  async isValid(): Promise<boolean> {
    const validation = await this.validate()
    return validation.valid
  }

  /**
   * Validate the session and return detailed status
   */
  async validate(): Promise<SessionValidation> {
    const session = await this.getSession()

    if (!session) {
      return { valid: false, reason: 'not_found' }
    }

    if (session.revoked) {
      return { valid: false, reason: 'revoked', session }
    }

    const now = Date.now()
    const expiresAt = new Date(session.expiresAt).getTime()

    if (expiresAt < now) {
      await this.emit('session.expired', {
        session: {
          $id: session.$id,
          identityId: session.identityId,
          expiresAt: session.expiresAt,
        },
      })
      return { valid: false, reason: 'expired', session }
    }

    return {
      valid: true,
      session,
      remainingMs: expiresAt - now,
    }
  }

  /**
   * Refresh the session, extending its expiration
   *
   * @param options - Refresh options
   * @returns The refreshed session data
   */
  async refresh(options: RefreshSessionOptions = {}): Promise<SessionData> {
    const session = await this.getSession()
    if (!session) {
      throw new Error('Session not found')
    }
    if (session.revoked) {
      throw new Error('Cannot refresh revoked session')
    }

    const now = new Date()
    const nowIso = now.toISOString()

    // Check if expired
    if (new Date(session.expiresAt).getTime() < now.getTime()) {
      throw new Error('Cannot refresh expired session')
    }

    // Calculate new expiration
    let newExpiresAt: string
    if (options.expiresAt) {
      newExpiresAt = options.expiresAt
    } else if (options.durationMs) {
      newExpiresAt = new Date(now.getTime() + options.durationMs).toISOString()
    } else {
      newExpiresAt = new Date(now.getTime() + DEFAULT_SESSION_DURATION_MS).toISOString()
    }

    const updatedSession: SessionData = {
      ...session,
      expiresAt: newExpiresAt,
      refreshedAt: nowIso,
      ...(options.metadata && {
        metadata: {
          ...session.metadata,
          ...options.metadata,
        },
      }),
    }

    await this.ctx.storage.put(Session.SESSION_KEY, updatedSession)
    this._sessionData = updatedSession

    await this.emit('session.refreshed', {
      session: {
        $id: updatedSession.$id,
        identityId: updatedSession.identityId,
        expiresAt: updatedSession.expiresAt,
        previousExpiresAt: session.expiresAt,
      },
    })

    return updatedSession
  }

  /**
   * Revoke the session, making it invalid
   *
   * @param reason - Optional reason for revocation
   * @returns The revoked session data
   */
  async revoke(reason?: string): Promise<SessionData> {
    const session = await this.getSession()
    if (!session) {
      throw new Error('Session not found')
    }
    if (session.revoked) {
      throw new Error('Session already revoked')
    }

    const now = new Date().toISOString()
    const revokedSession: SessionData = {
      ...session,
      revoked: true,
      revokedAt: now,
      metadata: {
        ...session.metadata,
        ...(reason && { revokeReason: reason }),
      },
    }

    await this.ctx.storage.put(Session.SESSION_KEY, revokedSession)
    this._sessionData = revokedSession

    await this.emit('session.revoked', {
      session: {
        $id: revokedSession.$id,
        identityId: revokedSession.identityId,
      },
      reason,
    })

    return revokedSession
  }

  /**
   * Get the identity ID associated with this session
   */
  async getIdentityId(): Promise<string | null> {
    const session = await this.getSession()
    return session?.identityId ?? null
  }

  /**
   * Get the session token
   */
  async getToken(): Promise<string | null> {
    const session = await this.getSession()
    return session?.token ?? null
  }

  /**
   * Verify a token matches this session
   */
  async verifyToken(token: string): Promise<boolean> {
    const session = await this.getSession()
    if (!session || session.revoked) {
      return false
    }
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      return false
    }
    return session.token === token
  }

  /**
   * Handle HTTP requests with REST routes
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // GET /session - Get session data
    if (url.pathname === '/session' && request.method === 'GET') {
      const session = await this.getSession()
      if (!session) {
        return new Response(JSON.stringify({ error: 'Session not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      // Don't expose the token in GET responses
      const { token, ...safeSession } = session
      return new Response(JSON.stringify(safeSession), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // POST /session - Create session
    if (url.pathname === '/session' && request.method === 'POST') {
      try {
        const options = await request.json() as CreateSessionOptions
        const session = await this.createSession(options)
        return new Response(JSON.stringify(session), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        return new Response(JSON.stringify({ error: (error as Error).message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // GET /session/validate - Validate session
    if (url.pathname === '/session/validate' && request.method === 'GET') {
      const validation = await this.validate()
      return new Response(JSON.stringify(validation), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // POST /session/refresh - Refresh session
    if (url.pathname === '/session/refresh' && request.method === 'POST') {
      try {
        const options = await request.json().catch(() => ({})) as RefreshSessionOptions
        const session = await this.refresh(options)
        // Don't expose the token in refresh responses
        const { token, ...safeSession } = session
        return new Response(JSON.stringify(safeSession), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        return new Response(JSON.stringify({ error: (error as Error).message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // POST /session/revoke - Revoke session
    if (url.pathname === '/session/revoke' && request.method === 'POST') {
      try {
        const { reason } = await request.json().catch(() => ({})) as { reason?: string }
        const session = await this.revoke(reason)
        // Don't expose the token in revoke responses
        const { token, ...safeSession } = session
        return new Response(JSON.stringify(safeSession), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        return new Response(JSON.stringify({ error: (error as Error).message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // POST /session/verify - Verify token
    if (url.pathname === '/session/verify' && request.method === 'POST') {
      try {
        const { token } = await request.json() as { token: string }
        if (!token) {
          return new Response(JSON.stringify({ error: 'Token is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        const valid = await this.verifyToken(token)
        return new Response(JSON.stringify({ valid }), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        return new Response(JSON.stringify({ error: (error as Error).message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // Delegate to parent for other routes
    return super.fetch(request)
  }
}

export default Session
