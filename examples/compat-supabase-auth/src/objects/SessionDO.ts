/**
 * SessionDO - Session Management Durable Object
 *
 * Manages user sessions separately from the main auth DO.
 * This allows for distributed session storage keyed by session ID,
 * enabling faster session lookups and independent session management.
 *
 * Features:
 * - Session storage by ID
 * - Token rotation
 * - Session invalidation
 * - Rate limiting per session
 * - Activity tracking
 *
 * @see https://supabase.com/docs/guides/auth/sessions
 */

import { DurableObject } from 'cloudflare:workers'

// ============================================================================
// TYPES
// ============================================================================

export interface Env {
  SESSION_DO: DurableObjectNamespace
  AUTH_DO: DurableObjectNamespace
  AUTH_JWT_SECRET?: string
  ENVIRONMENT?: string
}

/** Session data stored in the DO */
export interface SessionData {
  id: string
  user_id: string
  access_token: string
  refresh_token: string
  token_type: string
  expires_at: number
  refresh_expires_at: number
  ip_address?: string
  user_agent?: string
  country?: string
  city?: string
  created_at: string
  updated_at: string
  last_activity_at: string
  is_active: boolean
}

/** Session activity log */
export interface SessionActivity {
  timestamp: string
  action: string
  ip_address?: string
  user_agent?: string
  metadata?: Record<string, unknown>
}

/** Rate limit entry */
interface RateLimitEntry {
  count: number
  window_start: number
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_ACTIVITY_LOG = 100
const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 60 // 60 requests per minute

// ============================================================================
// SESSION DURABLE OBJECT
// ============================================================================

export class SessionDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get session data
   */
  async getSession(): Promise<SessionData | null> {
    return (await this.ctx.storage.get('session')) as SessionData | null
  }

  /**
   * Create or update session
   */
  async setSession(session: SessionData): Promise<void> {
    await this.ctx.storage.put('session', session)
    await this.logActivity('session.created', session.ip_address, session.user_agent)
  }

  /**
   * Update session with new tokens
   */
  async updateTokens(
    accessToken: string,
    refreshToken: string,
    expiresAt: number,
    refreshExpiresAt: number
  ): Promise<SessionData | null> {
    const session = await this.getSession()
    if (!session) return null

    const now = new Date().toISOString()
    session.access_token = accessToken
    session.refresh_token = refreshToken
    session.expires_at = expiresAt
    session.refresh_expires_at = refreshExpiresAt
    session.updated_at = now

    await this.ctx.storage.put('session', session)
    await this.logActivity('tokens.refreshed')

    return session
  }

  /**
   * Update last activity timestamp
   */
  async touch(ip_address?: string, user_agent?: string): Promise<void> {
    const session = await this.getSession()
    if (!session) return

    session.last_activity_at = new Date().toISOString()
    if (ip_address) session.ip_address = ip_address
    if (user_agent) session.user_agent = user_agent

    await this.ctx.storage.put('session', session)
  }

  /**
   * Invalidate session
   */
  async invalidate(reason?: string): Promise<void> {
    const session = await this.getSession()
    if (session) {
      session.is_active = false
      session.updated_at = new Date().toISOString()
      await this.ctx.storage.put('session', session)
      await this.logActivity('session.invalidated', undefined, undefined, { reason })
    }
  }

  /**
   * Delete session completely
   */
  async destroy(): Promise<void> {
    await this.logActivity('session.destroyed')
    await this.ctx.storage.deleteAll()
  }

  /**
   * Check if session is valid
   */
  async isValid(): Promise<boolean> {
    const session = await this.getSession()
    if (!session) return false
    if (!session.is_active) return false
    if (session.refresh_expires_at < Date.now()) return false
    return true
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIVITY LOGGING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Log session activity
   */
  private async logActivity(
    action: string,
    ip_address?: string,
    user_agent?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const activities =
      ((await this.ctx.storage.get('activities')) as SessionActivity[] | undefined) ?? []

    activities.push({
      timestamp: new Date().toISOString(),
      action,
      ip_address,
      user_agent,
      metadata,
    })

    // Keep only the last MAX_ACTIVITY_LOG entries
    if (activities.length > MAX_ACTIVITY_LOG) {
      activities.splice(0, activities.length - MAX_ACTIVITY_LOG)
    }

    await this.ctx.storage.put('activities', activities)
  }

  /**
   * Get activity log
   */
  async getActivityLog(limit: number = 50): Promise<SessionActivity[]> {
    const activities =
      ((await this.ctx.storage.get('activities')) as SessionActivity[] | undefined) ?? []
    return activities.slice(-limit)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RATE LIMITING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check rate limit and increment counter
   */
  async checkRateLimit(action: string = 'default'): Promise<{
    allowed: boolean
    remaining: number
    reset_at: number
  }> {
    const key = `rate_limit:${action}`
    const now = Date.now()

    let entry = (await this.ctx.storage.get(key)) as RateLimitEntry | undefined

    // Start new window if expired or not exists
    if (!entry || now - entry.window_start > RATE_LIMIT_WINDOW) {
      entry = { count: 0, window_start: now }
    }

    // Check if limit exceeded
    if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
      return {
        allowed: false,
        remaining: 0,
        reset_at: entry.window_start + RATE_LIMIT_WINDOW,
      }
    }

    // Increment counter
    entry.count++
    await this.ctx.storage.put(key, entry)

    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX_REQUESTS - entry.count,
      reset_at: entry.window_start + RATE_LIMIT_WINDOW,
    }
  }

  /**
   * Reset rate limit
   */
  async resetRateLimit(action: string = 'default'): Promise<void> {
    await this.ctx.storage.delete(`rate_limit:${action}`)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // METADATA STORAGE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Store arbitrary metadata for the session
   */
  async setMetadata(key: string, value: unknown): Promise<void> {
    const metadata =
      ((await this.ctx.storage.get('metadata')) as Record<string, unknown> | undefined) ?? {}
    metadata[key] = value
    await this.ctx.storage.put('metadata', metadata)
  }

  /**
   * Get metadata value
   */
  async getMetadata(key: string): Promise<unknown> {
    const metadata =
      ((await this.ctx.storage.get('metadata')) as Record<string, unknown> | undefined) ?? {}
    return metadata[key]
  }

  /**
   * Get all metadata
   */
  async getAllMetadata(): Promise<Record<string, unknown>> {
    return (
      ((await this.ctx.storage.get('metadata')) as Record<string, unknown> | undefined) ?? {}
    )
  }

  /**
   * Delete metadata key
   */
  async deleteMetadata(key: string): Promise<void> {
    const metadata =
      ((await this.ctx.storage.get('metadata')) as Record<string, unknown> | undefined) ?? {}
    delete metadata[key]
    await this.ctx.storage.put('metadata', metadata)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DEVICE TRACKING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Update device info
   */
  async updateDeviceInfo(info: {
    ip_address?: string
    user_agent?: string
    country?: string
    city?: string
  }): Promise<void> {
    const session = await this.getSession()
    if (!session) return

    if (info.ip_address) session.ip_address = info.ip_address
    if (info.user_agent) session.user_agent = info.user_agent
    if (info.country) session.country = info.country
    if (info.city) session.city = info.city
    session.updated_at = new Date().toISOString()

    await this.ctx.storage.put('session', session)
    await this.logActivity('device.updated', info.ip_address, info.user_agent, {
      country: info.country,
      city: info.city,
    })
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
    created_at: string | null
    last_activity_at: string | null
    is_active: boolean
    activity_count: number
    metadata_keys: string[]
  }> {
    const session = await this.getSession()
    const activities =
      ((await this.ctx.storage.get('activities')) as SessionActivity[] | undefined) ?? []
    const metadata =
      ((await this.ctx.storage.get('metadata')) as Record<string, unknown> | undefined) ?? {}

    return {
      session_id: session?.id ?? null,
      user_id: session?.user_id ?? null,
      created_at: session?.created_at ?? null,
      last_activity_at: session?.last_activity_at ?? null,
      is_active: session?.is_active ?? false,
      activity_count: activities.length,
      metadata_keys: Object.keys(metadata),
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Health check
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', service: 'SessionDO' })
    }

    // RPC endpoint
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
