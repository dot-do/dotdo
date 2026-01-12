/**
 * SessionDO - Session Management Durable Object
 *
 * Manages user sessions with JWT token generation and validation.
 * Each session has its own DO instance for isolation and fast access.
 *
 * Features:
 * - Session creation and storage
 * - JWT token generation (RS256)
 * - Token refresh with rotation
 * - Session revocation
 * - Activity tracking
 * - Device/client tracking
 * - Rate limiting per session
 *
 * @see https://clerk.com/docs/reference/backend-api/tag/Sessions
 */

import { DurableObject } from 'cloudflare:workers'
import { generateClerkId, generateToken } from './jwt'

// ============================================================================
// TYPES
// ============================================================================

export interface Env {
  SESSION_DO: DurableObjectNamespace
  USER_DO: DurableObjectNamespace
  CLERK_DO: DurableObjectNamespace
  ENVIRONMENT?: string
}

/** Clerk-compatible Session object */
export interface Session {
  id: string
  object: 'session'
  client_id: string
  user_id: string
  status: 'active' | 'ended' | 'revoked' | 'removed' | 'replaced' | 'expired' | 'abandoned'
  last_active_at: number
  last_active_organization_id: string | null
  actor: SessionActor | null
  expire_at: number
  abandon_at: number
  created_at: number
  updated_at: number
}

/** Session actor (impersonation) */
export interface SessionActor {
  sub: string
  name?: string
  role?: string
}

/** Session token */
export interface SessionToken {
  jwt: string
  expires_at: number
}

/** Client information */
export interface ClientInfo {
  id: string
  user_agent: string | null
  ip_address: string | null
  country: string | null
  city: string | null
  device_type: 'mobile' | 'desktop' | 'tablet' | null
  browser: string | null
  os: string | null
  last_seen_at: number
}

/** Session activity entry */
export interface SessionActivity {
  id: string
  timestamp: number
  action: string
  ip_address: string | null
  user_agent: string | null
  metadata: Record<string, unknown>
}

/** Stored session with additional data */
interface StoredSession {
  // Core session data
  id: string
  client_id: string
  user_id: string
  status: Session['status']
  last_active_at: number
  last_active_organization_id: string | null
  actor: SessionActor | null
  expire_at: number
  abandon_at: number
  created_at: number
  updated_at: number

  // Token data
  current_token_id: string | null
  token_version: number

  // Client info
  client_info: ClientInfo

  // Activity log
  activities: SessionActivity[]
}

/** Rate limit entry */
interface RateLimitEntry {
  count: number
  window_start: number
}

// ============================================================================
// CONSTANTS
// ============================================================================

const SESSION_EXPIRY = 7 * 24 * 60 * 60 * 1000 // 7 days
const SESSION_ABANDON = 30 * 24 * 60 * 60 * 1000 // 30 days
const TOKEN_EXPIRY = 60 * 1000 // 60 seconds (Clerk uses short-lived tokens)
const MAX_ACTIVITY_LOG = 100
const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute
const RATE_LIMIT_MAX = 100

// ============================================================================
// SESSION DURABLE OBJECT
// ============================================================================

export class SessionDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSION CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get session data
   */
  async getSession(): Promise<Session | null> {
    const stored = (await this.ctx.storage.get('session')) as StoredSession | null
    if (!stored) return null
    return this.toPublicSession(stored)
  }

  /**
   * Create session
   */
  async createSession(params: {
    user_id: string
    client_id?: string
    user_agent?: string
    ip_address?: string
    actor?: SessionActor
    expire_in?: number
  }): Promise<Session> {
    const now = Date.now()
    const sessionId = generateClerkId('sess')
    const clientId = params.client_id ?? generateClerkId('client')

    const session: StoredSession = {
      id: sessionId,
      client_id: clientId,
      user_id: params.user_id,
      status: 'active',
      last_active_at: now,
      last_active_organization_id: null,
      actor: params.actor ?? null,
      expire_at: now + (params.expire_in ?? SESSION_EXPIRY),
      abandon_at: now + SESSION_ABANDON,
      created_at: now,
      updated_at: now,
      current_token_id: null,
      token_version: 0,
      client_info: {
        id: clientId,
        user_agent: params.user_agent ?? null,
        ip_address: params.ip_address ?? null,
        country: null,
        city: null,
        device_type: this.parseDeviceType(params.user_agent),
        browser: this.parseBrowser(params.user_agent),
        os: this.parseOS(params.user_agent),
        last_seen_at: now,
      },
      activities: [],
    }

    await this.ctx.storage.put('session', session)
    await this.logActivity('session.created', params.ip_address, params.user_agent)

    return this.toPublicSession(session)
  }

  /**
   * End session (user sign out)
   */
  async endSession(): Promise<Session | null> {
    const session = (await this.ctx.storage.get('session')) as StoredSession | null
    if (!session) return null

    session.status = 'ended'
    session.updated_at = Date.now()

    await this.ctx.storage.put('session', session)
    await this.logActivity('session.ended')

    return this.toPublicSession(session)
  }

  /**
   * Revoke session (admin action)
   */
  async revokeSession(): Promise<Session | null> {
    const session = (await this.ctx.storage.get('session')) as StoredSession | null
    if (!session) return null

    session.status = 'revoked'
    session.updated_at = Date.now()

    await this.ctx.storage.put('session', session)
    await this.logActivity('session.revoked')

    return this.toPublicSession(session)
  }

  /**
   * Remove session (delete)
   */
  async removeSession(): Promise<{ deleted: boolean }> {
    const session = (await this.ctx.storage.get('session')) as StoredSession | null
    if (session) {
      session.status = 'removed'
      await this.ctx.storage.put('session', session)
      await this.logActivity('session.removed')
    }
    await this.ctx.storage.deleteAll()
    return { deleted: true }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TOKEN MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create session token (for JWT generation by ClerkDO)
   */
  async createToken(): Promise<{
    token_id: string
    version: number
    expires_at: number
  } | null> {
    const session = (await this.ctx.storage.get('session')) as StoredSession | null
    if (!session || session.status !== 'active') return null

    const now = Date.now()

    // Check if session expired
    if (session.expire_at < now) {
      session.status = 'expired'
      await this.ctx.storage.put('session', session)
      return null
    }

    // Generate new token ID
    const tokenId = generateClerkId('tok')
    session.current_token_id = tokenId
    session.token_version++
    session.last_active_at = now
    session.updated_at = now

    await this.ctx.storage.put('session', session)

    return {
      token_id: tokenId,
      version: session.token_version,
      expires_at: now + TOKEN_EXPIRY,
    }
  }

  /**
   * Verify token is current
   */
  async verifyToken(tokenId: string, version: number): Promise<boolean> {
    const session = (await this.ctx.storage.get('session')) as StoredSession | null
    if (!session || session.status !== 'active') return false

    return session.current_token_id === tokenId && session.token_version === version
  }

  /**
   * Refresh session (extend expiration)
   */
  async refresh(): Promise<Session | null> {
    const session = (await this.ctx.storage.get('session')) as StoredSession | null
    if (!session || session.status !== 'active') return null

    const now = Date.now()

    session.expire_at = now + SESSION_EXPIRY
    session.last_active_at = now
    session.updated_at = now

    await this.ctx.storage.put('session', session)
    await this.logActivity('session.refreshed')

    return this.toPublicSession(session)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSION STATE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if session is valid
   */
  async isValid(): Promise<boolean> {
    const session = (await this.ctx.storage.get('session')) as StoredSession | null
    if (!session) return false
    if (session.status !== 'active') return false
    if (session.expire_at < Date.now()) return false
    return true
  }

  /**
   * Touch session (update last active)
   */
  async touch(ip_address?: string, user_agent?: string): Promise<void> {
    const session = (await this.ctx.storage.get('session')) as StoredSession | null
    if (!session || session.status !== 'active') return

    const now = Date.now()
    session.last_active_at = now
    session.updated_at = now

    if (ip_address) session.client_info.ip_address = ip_address
    if (user_agent) session.client_info.user_agent = user_agent
    session.client_info.last_seen_at = now

    await this.ctx.storage.put('session', session)
  }

  /**
   * Set active organization
   */
  async setActiveOrganization(orgId: string | null): Promise<Session | null> {
    const session = (await this.ctx.storage.get('session')) as StoredSession | null
    if (!session || session.status !== 'active') return null

    session.last_active_organization_id = orgId
    session.updated_at = Date.now()

    await this.ctx.storage.put('session', session)
    await this.logActivity('session.org_changed', undefined, undefined, { org_id: orgId })

    return this.toPublicSession(session)
  }

  /**
   * Set session actor (for impersonation)
   */
  async setActor(actor: SessionActor | null): Promise<Session | null> {
    const session = (await this.ctx.storage.get('session')) as StoredSession | null
    if (!session || session.status !== 'active') return null

    session.actor = actor
    session.updated_at = Date.now()

    await this.ctx.storage.put('session', session)
    await this.logActivity('session.actor_changed', undefined, undefined, { actor })

    return this.toPublicSession(session)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLIENT INFO
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get client info
   */
  async getClientInfo(): Promise<ClientInfo | null> {
    const session = (await this.ctx.storage.get('session')) as StoredSession | null
    return session?.client_info ?? null
  }

  /**
   * Update client info
   */
  async updateClientInfo(info: Partial<ClientInfo>): Promise<ClientInfo | null> {
    const session = (await this.ctx.storage.get('session')) as StoredSession | null
    if (!session) return null

    Object.assign(session.client_info, info)
    session.client_info.last_seen_at = Date.now()
    session.updated_at = Date.now()

    await this.ctx.storage.put('session', session)

    return session.client_info
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIVITY LOGGING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Log activity
   */
  private async logActivity(
    action: string,
    ip_address?: string,
    user_agent?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const session = (await this.ctx.storage.get('session')) as StoredSession | null
    if (!session) return

    const activity: SessionActivity = {
      id: generateClerkId('act'),
      timestamp: Date.now(),
      action,
      ip_address: ip_address ?? session.client_info.ip_address,
      user_agent: user_agent ?? session.client_info.user_agent,
      metadata: metadata ?? {},
    }

    session.activities.push(activity)

    // Keep only last N activities
    if (session.activities.length > MAX_ACTIVITY_LOG) {
      session.activities = session.activities.slice(-MAX_ACTIVITY_LOG)
    }

    await this.ctx.storage.put('session', session)
  }

  /**
   * Get activity log
   */
  async getActivityLog(limit: number = 50): Promise<SessionActivity[]> {
    const session = (await this.ctx.storage.get('session')) as StoredSession | null
    if (!session) return []

    return session.activities.slice(-limit)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RATE LIMITING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check rate limit
   */
  async checkRateLimit(action: string = 'default'): Promise<{
    allowed: boolean
    remaining: number
    reset_at: number
  }> {
    const key = `rate_limit:${action}`
    const now = Date.now()

    let entry = (await this.ctx.storage.get(key)) as RateLimitEntry | undefined

    if (!entry || now - entry.window_start > RATE_LIMIT_WINDOW) {
      entry = { count: 0, window_start: now }
    }

    if (entry.count >= RATE_LIMIT_MAX) {
      return {
        allowed: false,
        remaining: 0,
        reset_at: entry.window_start + RATE_LIMIT_WINDOW,
      }
    }

    entry.count++
    await this.ctx.storage.put(key, entry)

    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX - entry.count,
      reset_at: entry.window_start + RATE_LIMIT_WINDOW,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Convert stored session to public session
   */
  private toPublicSession(stored: StoredSession): Session {
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
   * Parse device type from user agent
   */
  private parseDeviceType(userAgent?: string): 'mobile' | 'desktop' | 'tablet' | null {
    if (!userAgent) return null
    const ua = userAgent.toLowerCase()
    if (ua.includes('mobile') || ua.includes('iphone') || ua.includes('android')) {
      if (ua.includes('tablet') || ua.includes('ipad')) return 'tablet'
      return 'mobile'
    }
    return 'desktop'
  }

  /**
   * Parse browser from user agent
   */
  private parseBrowser(userAgent?: string): string | null {
    if (!userAgent) return null
    const ua = userAgent.toLowerCase()
    if (ua.includes('chrome')) return 'Chrome'
    if (ua.includes('firefox')) return 'Firefox'
    if (ua.includes('safari')) return 'Safari'
    if (ua.includes('edge')) return 'Edge'
    if (ua.includes('opera')) return 'Opera'
    return null
  }

  /**
   * Parse OS from user agent
   */
  private parseOS(userAgent?: string): string | null {
    if (!userAgent) return null
    const ua = userAgent.toLowerCase()
    if (ua.includes('windows')) return 'Windows'
    if (ua.includes('mac os') || ua.includes('macos')) return 'macOS'
    if (ua.includes('linux')) return 'Linux'
    if (ua.includes('android')) return 'Android'
    if (ua.includes('ios') || ua.includes('iphone') || ua.includes('ipad')) return 'iOS'
    return null
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSION STATS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get session statistics
   */
  async getStats(): Promise<{
    session_id: string | null
    user_id: string | null
    status: Session['status'] | null
    created_at: number | null
    last_active_at: number | null
    expire_at: number | null
    activity_count: number
    token_version: number
  }> {
    const session = (await this.ctx.storage.get('session')) as StoredSession | null

    return {
      session_id: session?.id ?? null,
      user_id: session?.user_id ?? null,
      status: session?.status ?? null,
      created_at: session?.created_at ?? null,
      last_active_at: session?.last_active_at ?? null,
      expire_at: session?.expire_at ?? null,
      activity_count: session?.activities.length ?? 0,
      token_version: session?.token_version ?? 0,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', service: 'SessionDO' })
    }

    if (url.pathname === '/rpc' && request.method === 'POST') {
      try {
        const body = (await request.json()) as {
          jsonrpc: string
          id: number
          method: string
          params?: unknown[]
        }
        const { method, params = [], id } = body

        const methodFn = (this as unknown as Record<string, (...args: unknown[]) => unknown>)[method]
        if (typeof methodFn !== 'function') {
          return Response.json(
            { jsonrpc: '2.0', id, error: { code: -32601, message: `Method '${method}' not found` } },
            { status: 400 }
          )
        }

        const result = await methodFn.apply(this, params)
        return Response.json({ jsonrpc: '2.0', id, result })
      } catch (error) {
        return Response.json(
          { jsonrpc: '2.0', id: 0, error: { code: -32603, message: String(error) } },
          { status: 500 }
        )
      }
    }

    return new Response('Not Found', { status: 404 })
  }
}
