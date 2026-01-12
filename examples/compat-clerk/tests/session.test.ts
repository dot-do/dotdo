/**
 * SessionDO Tests
 *
 * Tests for the Clerk-compatible Session Durable Object.
 * Covers session lifecycle, token management, activity tracking,
 * rate limiting, and client info handling.
 *
 * @see https://clerk.com/docs/reference/backend-api/tag/Sessions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// Mock Types (matching SessionDO types)
// ============================================================================

interface Session {
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

interface SessionActor {
  sub: string
  name?: string
  role?: string
}

interface ClientInfo {
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

interface SessionActivity {
  id: string
  timestamp: number
  action: string
  ip_address: string | null
  user_agent: string | null
  metadata: Record<string, unknown>
}

// ============================================================================
// Mock Storage
// ============================================================================

class MockStorage {
  private data = new Map<string, unknown>()

  async get(key: string): Promise<unknown> {
    return this.data.get(key)
  }

  async put(key: string, value: unknown): Promise<void> {
    this.data.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key)
  }

  async deleteAll(): Promise<void> {
    this.data.clear()
  }

  async list(): Promise<Map<string, unknown>> {
    return new Map(this.data)
  }
}

// ============================================================================
// Mock SessionDO (in-memory implementation for testing)
// ============================================================================

const SESSION_EXPIRY = 7 * 24 * 60 * 60 * 1000 // 7 days
const SESSION_ABANDON = 30 * 24 * 60 * 60 * 1000 // 30 days
const TOKEN_EXPIRY = 60 * 1000 // 60 seconds
const MAX_ACTIVITY_LOG = 100
const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute
const RATE_LIMIT_MAX = 100

interface StoredSession {
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
  current_token_id: string | null
  token_version: number
  client_info: ClientInfo
  activities: SessionActivity[]
}

interface RateLimitEntry {
  count: number
  window_start: number
}

function generateClerkId(prefix: string): string {
  const chars = '0123456789abcdef'
  let id = ''
  for (let i = 0; i < 32; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return `${prefix}_${id}`
}

class MockSessionDO {
  private storage = new MockStorage()

  async getSession(): Promise<Session | null> {
    const stored = (await this.storage.get('session')) as StoredSession | null
    if (!stored) return null
    return this.toPublicSession(stored)
  }

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

    await this.storage.put('session', session)
    await this.logActivity('session.created', params.ip_address, params.user_agent)

    return this.toPublicSession(session)
  }

  async endSession(): Promise<Session | null> {
    const session = (await this.storage.get('session')) as StoredSession | null
    if (!session) return null

    session.status = 'ended'
    session.updated_at = Date.now()

    await this.storage.put('session', session)
    await this.logActivity('session.ended')

    return this.toPublicSession(session)
  }

  async revokeSession(): Promise<Session | null> {
    const session = (await this.storage.get('session')) as StoredSession | null
    if (!session) return null

    session.status = 'revoked'
    session.updated_at = Date.now()

    await this.storage.put('session', session)
    await this.logActivity('session.revoked')

    return this.toPublicSession(session)
  }

  async removeSession(): Promise<{ deleted: boolean }> {
    const session = (await this.storage.get('session')) as StoredSession | null
    if (session) {
      session.status = 'removed'
      await this.storage.put('session', session)
      await this.logActivity('session.removed')
    }
    await this.storage.deleteAll()
    return { deleted: true }
  }

  async createToken(): Promise<{
    token_id: string
    version: number
    expires_at: number
  } | null> {
    const session = (await this.storage.get('session')) as StoredSession | null
    if (!session || session.status !== 'active') return null

    const now = Date.now()

    if (session.expire_at < now) {
      session.status = 'expired'
      await this.storage.put('session', session)
      return null
    }

    const tokenId = generateClerkId('tok')
    session.current_token_id = tokenId
    session.token_version++
    session.last_active_at = now
    session.updated_at = now

    await this.storage.put('session', session)

    return {
      token_id: tokenId,
      version: session.token_version,
      expires_at: now + TOKEN_EXPIRY,
    }
  }

  async verifyToken(tokenId: string, version: number): Promise<boolean> {
    const session = (await this.storage.get('session')) as StoredSession | null
    if (!session || session.status !== 'active') return false

    return session.current_token_id === tokenId && session.token_version === version
  }

  async refresh(): Promise<Session | null> {
    const session = (await this.storage.get('session')) as StoredSession | null
    if (!session || session.status !== 'active') return null

    const now = Date.now()

    session.expire_at = now + SESSION_EXPIRY
    session.last_active_at = now
    session.updated_at = now

    await this.storage.put('session', session)
    await this.logActivity('session.refreshed')

    return this.toPublicSession(session)
  }

  async isValid(): Promise<boolean> {
    const session = (await this.storage.get('session')) as StoredSession | null
    if (!session) return false
    if (session.status !== 'active') return false
    if (session.expire_at < Date.now()) return false
    return true
  }

  async touch(ip_address?: string, user_agent?: string): Promise<void> {
    const session = (await this.storage.get('session')) as StoredSession | null
    if (!session || session.status !== 'active') return

    const now = Date.now()
    session.last_active_at = now
    session.updated_at = now

    if (ip_address) session.client_info.ip_address = ip_address
    if (user_agent) session.client_info.user_agent = user_agent
    session.client_info.last_seen_at = now

    await this.storage.put('session', session)
  }

  async setActiveOrganization(orgId: string | null): Promise<Session | null> {
    const session = (await this.storage.get('session')) as StoredSession | null
    if (!session || session.status !== 'active') return null

    session.last_active_organization_id = orgId
    session.updated_at = Date.now()

    await this.storage.put('session', session)
    await this.logActivity('session.org_changed', undefined, undefined, { org_id: orgId })

    return this.toPublicSession(session)
  }

  async setActor(actor: SessionActor | null): Promise<Session | null> {
    const session = (await this.storage.get('session')) as StoredSession | null
    if (!session || session.status !== 'active') return null

    session.actor = actor
    session.updated_at = Date.now()

    await this.storage.put('session', session)
    await this.logActivity('session.actor_changed', undefined, undefined, { actor })

    return this.toPublicSession(session)
  }

  async getClientInfo(): Promise<ClientInfo | null> {
    const session = (await this.storage.get('session')) as StoredSession | null
    return session?.client_info ?? null
  }

  async updateClientInfo(info: Partial<ClientInfo>): Promise<ClientInfo | null> {
    const session = (await this.storage.get('session')) as StoredSession | null
    if (!session) return null

    Object.assign(session.client_info, info)
    session.client_info.last_seen_at = Date.now()
    session.updated_at = Date.now()

    await this.storage.put('session', session)

    return session.client_info
  }

  private async logActivity(
    action: string,
    ip_address?: string,
    user_agent?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const session = (await this.storage.get('session')) as StoredSession | null
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

    if (session.activities.length > MAX_ACTIVITY_LOG) {
      session.activities = session.activities.slice(-MAX_ACTIVITY_LOG)
    }

    await this.storage.put('session', session)
  }

  async getActivityLog(limit: number = 50): Promise<SessionActivity[]> {
    const session = (await this.storage.get('session')) as StoredSession | null
    if (!session) return []

    return session.activities.slice(-limit)
  }

  async checkRateLimit(action: string = 'default'): Promise<{
    allowed: boolean
    remaining: number
    reset_at: number
  }> {
    const key = `rate_limit:${action}`
    const now = Date.now()

    let entry = (await this.storage.get(key)) as RateLimitEntry | undefined

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
    await this.storage.put(key, entry)

    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX - entry.count,
      reset_at: entry.window_start + RATE_LIMIT_WINDOW,
    }
  }

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
    const session = (await this.storage.get('session')) as StoredSession | null

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

  private parseDeviceType(userAgent?: string): 'mobile' | 'desktop' | 'tablet' | null {
    if (!userAgent) return null
    const ua = userAgent.toLowerCase()
    if (ua.includes('mobile') || ua.includes('iphone') || ua.includes('android')) {
      if (ua.includes('tablet') || ua.includes('ipad')) return 'tablet'
      return 'mobile'
    }
    return 'desktop'
  }

  private parseBrowser(userAgent?: string): string | null {
    if (!userAgent) return null
    const ua = userAgent.toLowerCase()
    // Check Edge before Chrome (Edge UA contains 'chrome')
    if (ua.includes('edg')) return 'Edge'
    if (ua.includes('chrome')) return 'Chrome'
    if (ua.includes('firefox')) return 'Firefox'
    if (ua.includes('safari')) return 'Safari'
    if (ua.includes('opera')) return 'Opera'
    return null
  }

  private parseOS(userAgent?: string): string | null {
    if (!userAgent) return null
    const ua = userAgent.toLowerCase()
    if (ua.includes('windows')) return 'Windows'
    // Check Android before Linux (Android UA contains 'linux')
    if (ua.includes('android')) return 'Android'
    // Check iOS before macOS (iOS UA contains 'like Mac OS X')
    if (ua.includes('iphone') || ua.includes('ipad') || (ua.includes('ios') && !ua.includes('macos'))) return 'iOS'
    if (ua.includes('mac os') || ua.includes('macos')) return 'macOS'
    if (ua.includes('linux')) return 'Linux'
    return null
  }
}

// ============================================================================
// Session Creation Tests
// ============================================================================

describe('SessionDO - Creation', () => {
  let sessionDO: MockSessionDO

  beforeEach(() => {
    sessionDO = new MockSessionDO()
  })

  it('creates a new session with minimal params', async () => {
    const session = await sessionDO.createSession({
      user_id: 'user_123',
    })

    expect(session).toBeDefined()
    expect(session.id).toMatch(/^sess_/)
    expect(session.object).toBe('session')
    expect(session.user_id).toBe('user_123')
    expect(session.status).toBe('active')
    expect(session.client_id).toMatch(/^client_/)
    expect(session.actor).toBeNull()
    expect(session.last_active_organization_id).toBeNull()
  })

  it('creates a session with custom client_id', async () => {
    const session = await sessionDO.createSession({
      user_id: 'user_123',
      client_id: 'client_custom',
    })

    expect(session.client_id).toBe('client_custom')
  })

  it('creates a session with actor (impersonation)', async () => {
    const actor: SessionActor = {
      sub: 'admin_456',
      name: 'Admin User',
      role: 'admin',
    }

    const session = await sessionDO.createSession({
      user_id: 'user_123',
      actor,
    })

    expect(session.actor).toEqual(actor)
  })

  it('creates a session with custom expiration', async () => {
    const now = Date.now()
    const customExpiry = 1000 * 60 * 60 // 1 hour

    const session = await sessionDO.createSession({
      user_id: 'user_123',
      expire_in: customExpiry,
    })

    expect(session.expire_at).toBeGreaterThanOrEqual(now + customExpiry)
    expect(session.expire_at).toBeLessThan(now + customExpiry + 1000)
  })

  it('sets timestamps correctly on creation', async () => {
    const before = Date.now()
    const session = await sessionDO.createSession({ user_id: 'user_123' })
    const after = Date.now()

    expect(session.created_at).toBeGreaterThanOrEqual(before)
    expect(session.created_at).toBeLessThanOrEqual(after)
    expect(session.updated_at).toBe(session.created_at)
    expect(session.last_active_at).toBe(session.created_at)
  })

  it('logs session.created activity', async () => {
    await sessionDO.createSession({
      user_id: 'user_123',
      ip_address: '192.168.1.1',
      user_agent: 'TestAgent/1.0',
    })

    const activities = await sessionDO.getActivityLog()
    expect(activities).toHaveLength(1)
    expect(activities[0].action).toBe('session.created')
    expect(activities[0].ip_address).toBe('192.168.1.1')
    expect(activities[0].user_agent).toBe('TestAgent/1.0')
  })
})

// ============================================================================
// Session Retrieval Tests
// ============================================================================

describe('SessionDO - Retrieval', () => {
  let sessionDO: MockSessionDO

  beforeEach(() => {
    sessionDO = new MockSessionDO()
  })

  it('returns null for non-existent session', async () => {
    const session = await sessionDO.getSession()
    expect(session).toBeNull()
  })

  it('retrieves an existing session', async () => {
    const created = await sessionDO.createSession({ user_id: 'user_123' })
    const retrieved = await sessionDO.getSession()

    expect(retrieved).toEqual(created)
  })

  it('returns session with object type set', async () => {
    await sessionDO.createSession({ user_id: 'user_123' })
    const session = await sessionDO.getSession()

    expect(session?.object).toBe('session')
  })
})

// ============================================================================
// Session Lifecycle Tests
// ============================================================================

describe('SessionDO - Lifecycle', () => {
  let sessionDO: MockSessionDO

  beforeEach(async () => {
    sessionDO = new MockSessionDO()
    await sessionDO.createSession({ user_id: 'user_123' })
  })

  it('ends a session (user sign out)', async () => {
    const ended = await sessionDO.endSession()

    expect(ended).toBeDefined()
    expect(ended?.status).toBe('ended')
    expect(ended?.updated_at).toBeGreaterThanOrEqual(ended?.created_at ?? 0)

    const activities = await sessionDO.getActivityLog()
    expect(activities.some((a) => a.action === 'session.ended')).toBe(true)
  })

  it('revokes a session (admin action)', async () => {
    const revoked = await sessionDO.revokeSession()

    expect(revoked).toBeDefined()
    expect(revoked?.status).toBe('revoked')

    const activities = await sessionDO.getActivityLog()
    expect(activities.some((a) => a.action === 'session.revoked')).toBe(true)
  })

  it('removes a session (delete)', async () => {
    const result = await sessionDO.removeSession()

    expect(result).toEqual({ deleted: true })

    const session = await sessionDO.getSession()
    expect(session).toBeNull()
  })

  it('returns null when ending non-existent session', async () => {
    const freshDO = new MockSessionDO()
    const ended = await freshDO.endSession()

    expect(ended).toBeNull()
  })

  it('returns null when revoking non-existent session', async () => {
    const freshDO = new MockSessionDO()
    const revoked = await freshDO.revokeSession()

    expect(revoked).toBeNull()
  })
})

// ============================================================================
// Session Validity Tests
// ============================================================================

describe('SessionDO - Validity', () => {
  let sessionDO: MockSessionDO

  beforeEach(() => {
    sessionDO = new MockSessionDO()
  })

  it('returns true for active session', async () => {
    await sessionDO.createSession({ user_id: 'user_123' })
    const isValid = await sessionDO.isValid()

    expect(isValid).toBe(true)
  })

  it('returns false for non-existent session', async () => {
    const isValid = await sessionDO.isValid()

    expect(isValid).toBe(false)
  })

  it('returns false for ended session', async () => {
    await sessionDO.createSession({ user_id: 'user_123' })
    await sessionDO.endSession()
    const isValid = await sessionDO.isValid()

    expect(isValid).toBe(false)
  })

  it('returns false for revoked session', async () => {
    await sessionDO.createSession({ user_id: 'user_123' })
    await sessionDO.revokeSession()
    const isValid = await sessionDO.isValid()

    expect(isValid).toBe(false)
  })

  it('returns false for expired session', async () => {
    await sessionDO.createSession({
      user_id: 'user_123',
      expire_in: -1000, // Already expired
    })
    const isValid = await sessionDO.isValid()

    expect(isValid).toBe(false)
  })
})

// ============================================================================
// Token Management Tests
// ============================================================================

describe('SessionDO - Token Management', () => {
  let sessionDO: MockSessionDO

  beforeEach(async () => {
    sessionDO = new MockSessionDO()
    await sessionDO.createSession({ user_id: 'user_123' })
  })

  it('creates a token for active session', async () => {
    const token = await sessionDO.createToken()

    expect(token).toBeDefined()
    expect(token?.token_id).toMatch(/^tok_/)
    expect(token?.version).toBe(1)
    expect(token?.expires_at).toBeGreaterThan(Date.now())
  })

  it('increments token version on each creation', async () => {
    const token1 = await sessionDO.createToken()
    const token2 = await sessionDO.createToken()
    const token3 = await sessionDO.createToken()

    expect(token1?.version).toBe(1)
    expect(token2?.version).toBe(2)
    expect(token3?.version).toBe(3)
  })

  it('updates last_active_at when creating token', async () => {
    const session1 = await sessionDO.getSession()
    const originalLastActive = session1?.last_active_at

    // Wait a bit to ensure timestamp changes
    await new Promise((resolve) => setTimeout(resolve, 10))

    await sessionDO.createToken()
    const session2 = await sessionDO.getSession()

    expect(session2?.last_active_at).toBeGreaterThan(originalLastActive ?? 0)
  })

  it('returns null when creating token for ended session', async () => {
    await sessionDO.endSession()
    const token = await sessionDO.createToken()

    expect(token).toBeNull()
  })

  it('returns null when creating token for expired session', async () => {
    // Create session that expires immediately
    const freshDO = new MockSessionDO()
    await freshDO.createSession({
      user_id: 'user_123',
      expire_in: -1000,
    })
    const token = await freshDO.createToken()

    expect(token).toBeNull()
  })

  it('verifies valid token', async () => {
    const token = await sessionDO.createToken()
    const isValid = await sessionDO.verifyToken(token!.token_id, token!.version)

    expect(isValid).toBe(true)
  })

  it('rejects token with wrong token_id', async () => {
    await sessionDO.createToken()
    const isValid = await sessionDO.verifyToken('tok_invalid', 1)

    expect(isValid).toBe(false)
  })

  it('rejects token with wrong version', async () => {
    const token = await sessionDO.createToken()
    const isValid = await sessionDO.verifyToken(token!.token_id, 999)

    expect(isValid).toBe(false)
  })

  it('rejects old token after new token created', async () => {
    const token1 = await sessionDO.createToken()
    await sessionDO.createToken()

    const isValid = await sessionDO.verifyToken(token1!.token_id, token1!.version)

    expect(isValid).toBe(false)
  })

  it('rejects token for ended session', async () => {
    const token = await sessionDO.createToken()
    await sessionDO.endSession()
    const isValid = await sessionDO.verifyToken(token!.token_id, token!.version)

    expect(isValid).toBe(false)
  })
})

// ============================================================================
// Session Refresh Tests
// ============================================================================

describe('SessionDO - Refresh', () => {
  let sessionDO: MockSessionDO

  beforeEach(async () => {
    sessionDO = new MockSessionDO()
    await sessionDO.createSession({
      user_id: 'user_123',
      expire_in: 1000 * 60 * 60, // 1 hour
    })
  })

  it('extends session expiration', async () => {
    const original = await sessionDO.getSession()
    const originalExpire = original?.expire_at ?? 0

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 10))

    await sessionDO.refresh()
    const refreshed = await sessionDO.getSession()

    expect(refreshed?.expire_at).toBeGreaterThan(originalExpire)
  })

  it('updates last_active_at on refresh', async () => {
    const original = await sessionDO.getSession()
    const originalLastActive = original?.last_active_at ?? 0

    await new Promise((resolve) => setTimeout(resolve, 10))

    await sessionDO.refresh()
    const refreshed = await sessionDO.getSession()

    expect(refreshed?.last_active_at).toBeGreaterThan(originalLastActive)
  })

  it('logs session.refreshed activity', async () => {
    await sessionDO.refresh()

    const activities = await sessionDO.getActivityLog()
    expect(activities.some((a) => a.action === 'session.refreshed')).toBe(true)
  })

  it('returns null when refreshing ended session', async () => {
    await sessionDO.endSession()
    const refreshed = await sessionDO.refresh()

    expect(refreshed).toBeNull()
  })

  it('returns null when refreshing non-existent session', async () => {
    const freshDO = new MockSessionDO()
    const refreshed = await freshDO.refresh()

    expect(refreshed).toBeNull()
  })
})

// ============================================================================
// Session Touch Tests
// ============================================================================

describe('SessionDO - Touch', () => {
  let sessionDO: MockSessionDO

  beforeEach(async () => {
    sessionDO = new MockSessionDO()
    await sessionDO.createSession({
      user_id: 'user_123',
      ip_address: '192.168.1.1',
      user_agent: 'OldAgent/1.0',
    })
  })

  it('updates last_active_at', async () => {
    const original = await sessionDO.getSession()
    const originalLastActive = original?.last_active_at ?? 0

    await new Promise((resolve) => setTimeout(resolve, 10))

    await sessionDO.touch()
    const touched = await sessionDO.getSession()

    expect(touched?.last_active_at).toBeGreaterThan(originalLastActive)
  })

  it('updates client IP address', async () => {
    await sessionDO.touch('10.0.0.1')

    const clientInfo = await sessionDO.getClientInfo()
    expect(clientInfo?.ip_address).toBe('10.0.0.1')
  })

  it('updates client user agent', async () => {
    await sessionDO.touch(undefined, 'NewAgent/2.0')

    const clientInfo = await sessionDO.getClientInfo()
    expect(clientInfo?.user_agent).toBe('NewAgent/2.0')
  })

  it('updates both IP and user agent', async () => {
    await sessionDO.touch('10.0.0.1', 'NewAgent/2.0')

    const clientInfo = await sessionDO.getClientInfo()
    expect(clientInfo?.ip_address).toBe('10.0.0.1')
    expect(clientInfo?.user_agent).toBe('NewAgent/2.0')
  })

  it('does nothing for ended session', async () => {
    await sessionDO.endSession()
    const before = await sessionDO.getSession()

    await sessionDO.touch('10.0.0.1', 'NewAgent/2.0')
    const after = await sessionDO.getSession()

    expect(after?.last_active_at).toBe(before?.last_active_at)
  })
})

// ============================================================================
// Organization Tests
// ============================================================================

describe('SessionDO - Organization', () => {
  let sessionDO: MockSessionDO

  beforeEach(async () => {
    sessionDO = new MockSessionDO()
    await sessionDO.createSession({ user_id: 'user_123' })
  })

  it('sets active organization', async () => {
    const session = await sessionDO.setActiveOrganization('org_456')

    expect(session?.last_active_organization_id).toBe('org_456')
  })

  it('clears active organization', async () => {
    await sessionDO.setActiveOrganization('org_456')
    const session = await sessionDO.setActiveOrganization(null)

    expect(session?.last_active_organization_id).toBeNull()
  })

  it('logs org_changed activity', async () => {
    await sessionDO.setActiveOrganization('org_456')

    const activities = await sessionDO.getActivityLog()
    const orgChange = activities.find((a) => a.action === 'session.org_changed')

    expect(orgChange).toBeDefined()
    expect(orgChange?.metadata).toEqual({ org_id: 'org_456' })
  })

  it('returns null for ended session', async () => {
    await sessionDO.endSession()
    const session = await sessionDO.setActiveOrganization('org_456')

    expect(session).toBeNull()
  })
})

// ============================================================================
// Actor (Impersonation) Tests
// ============================================================================

describe('SessionDO - Actor', () => {
  let sessionDO: MockSessionDO

  beforeEach(async () => {
    sessionDO = new MockSessionDO()
    await sessionDO.createSession({ user_id: 'user_123' })
  })

  it('sets session actor', async () => {
    const actor: SessionActor = {
      sub: 'admin_456',
      name: 'Admin User',
      role: 'super_admin',
    }

    const session = await sessionDO.setActor(actor)

    expect(session?.actor).toEqual(actor)
  })

  it('clears session actor', async () => {
    await sessionDO.setActor({
      sub: 'admin_456',
      name: 'Admin User',
    })
    const session = await sessionDO.setActor(null)

    expect(session?.actor).toBeNull()
  })

  it('logs actor_changed activity', async () => {
    const actor: SessionActor = { sub: 'admin_456' }
    await sessionDO.setActor(actor)

    const activities = await sessionDO.getActivityLog()
    const actorChange = activities.find((a) => a.action === 'session.actor_changed')

    expect(actorChange).toBeDefined()
    expect(actorChange?.metadata).toEqual({ actor })
  })

  it('returns null for ended session', async () => {
    await sessionDO.endSession()
    const session = await sessionDO.setActor({ sub: 'admin_456' })

    expect(session).toBeNull()
  })
})

// ============================================================================
// Client Info Tests
// ============================================================================

describe('SessionDO - Client Info', () => {
  let sessionDO: MockSessionDO

  beforeEach(async () => {
    sessionDO = new MockSessionDO()
    await sessionDO.createSession({
      user_id: 'user_123',
      user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
      ip_address: '192.168.1.1',
    })
  })

  it('returns client info', async () => {
    const info = await sessionDO.getClientInfo()

    expect(info).toBeDefined()
    expect(info?.ip_address).toBe('192.168.1.1')
    expect(info?.user_agent).toContain('Chrome')
  })

  it('parses browser from user agent', async () => {
    const info = await sessionDO.getClientInfo()

    expect(info?.browser).toBe('Chrome')
  })

  it('parses OS from user agent', async () => {
    const info = await sessionDO.getClientInfo()

    expect(info?.os).toBe('Windows')
  })

  it('parses device type from user agent', async () => {
    const info = await sessionDO.getClientInfo()

    expect(info?.device_type).toBe('desktop')
  })

  it('detects mobile device', async () => {
    const mobileDO = new MockSessionDO()
    await mobileDO.createSession({
      user_id: 'user_123',
      user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile Safari/605.1',
    })

    const info = await mobileDO.getClientInfo()
    expect(info?.device_type).toBe('mobile')
  })

  it('detects tablet device', async () => {
    const tabletDO = new MockSessionDO()
    await tabletDO.createSession({
      user_id: 'user_123',
      user_agent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Mobile Safari/605.1',
    })

    const info = await tabletDO.getClientInfo()
    expect(info?.device_type).toBe('tablet')
  })

  it('updates client info', async () => {
    const updated = await sessionDO.updateClientInfo({
      country: 'US',
      city: 'New York',
    })

    expect(updated?.country).toBe('US')
    expect(updated?.city).toBe('New York')
    // Original values should be preserved
    expect(updated?.ip_address).toBe('192.168.1.1')
  })

  it('returns null for non-existent session', async () => {
    const freshDO = new MockSessionDO()
    const info = await freshDO.getClientInfo()

    expect(info).toBeNull()
  })
})

// ============================================================================
// Activity Logging Tests
// ============================================================================

describe('SessionDO - Activity Logging', () => {
  let sessionDO: MockSessionDO

  beforeEach(async () => {
    sessionDO = new MockSessionDO()
    await sessionDO.createSession({ user_id: 'user_123' })
  })

  it('logs creation activity', async () => {
    const activities = await sessionDO.getActivityLog()

    expect(activities).toHaveLength(1)
    expect(activities[0].action).toBe('session.created')
  })

  it('accumulates activities', async () => {
    await sessionDO.refresh()
    await sessionDO.setActiveOrganization('org_123')
    await sessionDO.endSession()

    const activities = await sessionDO.getActivityLog()

    expect(activities.length).toBeGreaterThanOrEqual(4)
    expect(activities.map((a) => a.action)).toContain('session.created')
    expect(activities.map((a) => a.action)).toContain('session.refreshed')
    expect(activities.map((a) => a.action)).toContain('session.org_changed')
    expect(activities.map((a) => a.action)).toContain('session.ended')
  })

  it('limits activity log entries', async () => {
    // Create many activities
    for (let i = 0; i < 120; i++) {
      await sessionDO.refresh()
    }

    const activities = await sessionDO.getActivityLog()

    expect(activities.length).toBeLessThanOrEqual(MAX_ACTIVITY_LOG)
  })

  it('respects limit parameter', async () => {
    for (let i = 0; i < 10; i++) {
      await sessionDO.refresh()
    }

    const activities = await sessionDO.getActivityLog(5)

    expect(activities.length).toBe(5)
  })

  it('returns empty array for non-existent session', async () => {
    const freshDO = new MockSessionDO()
    const activities = await freshDO.getActivityLog()

    expect(activities).toEqual([])
  })

  it('activity entries have required fields', async () => {
    const activities = await sessionDO.getActivityLog()
    const activity = activities[0]

    expect(activity.id).toMatch(/^act_/)
    expect(typeof activity.timestamp).toBe('number')
    expect(typeof activity.action).toBe('string')
    expect(activity.metadata).toBeDefined()
  })
})

// ============================================================================
// Rate Limiting Tests
// ============================================================================

describe('SessionDO - Rate Limiting', () => {
  let sessionDO: MockSessionDO

  beforeEach(async () => {
    sessionDO = new MockSessionDO()
    await sessionDO.createSession({ user_id: 'user_123' })
  })

  it('allows requests under limit', async () => {
    const result = await sessionDO.checkRateLimit('api')

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(RATE_LIMIT_MAX - 1)
    expect(result.reset_at).toBeGreaterThan(Date.now())
  })

  it('decrements remaining count', async () => {
    const result1 = await sessionDO.checkRateLimit('api')
    const result2 = await sessionDO.checkRateLimit('api')
    const result3 = await sessionDO.checkRateLimit('api')

    expect(result1.remaining).toBe(RATE_LIMIT_MAX - 1)
    expect(result2.remaining).toBe(RATE_LIMIT_MAX - 2)
    expect(result3.remaining).toBe(RATE_LIMIT_MAX - 3)
  })

  it('blocks when limit exceeded', async () => {
    // Exhaust the limit
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      await sessionDO.checkRateLimit('api')
    }

    const result = await sessionDO.checkRateLimit('api')

    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('tracks different actions separately', async () => {
    for (let i = 0; i < 10; i++) {
      await sessionDO.checkRateLimit('action1')
    }

    const result1 = await sessionDO.checkRateLimit('action1')
    const result2 = await sessionDO.checkRateLimit('action2')

    expect(result1.remaining).toBe(RATE_LIMIT_MAX - 11)
    expect(result2.remaining).toBe(RATE_LIMIT_MAX - 1)
  })

  it('provides reset_at timestamp', async () => {
    const result = await sessionDO.checkRateLimit('api')
    const now = Date.now()

    expect(result.reset_at).toBeGreaterThan(now)
    expect(result.reset_at).toBeLessThanOrEqual(now + RATE_LIMIT_WINDOW + 100)
  })
})

// ============================================================================
// Session Stats Tests
// ============================================================================

describe('SessionDO - Stats', () => {
  let sessionDO: MockSessionDO

  beforeEach(() => {
    sessionDO = new MockSessionDO()
  })

  it('returns null values for non-existent session', async () => {
    const stats = await sessionDO.getStats()

    expect(stats.session_id).toBeNull()
    expect(stats.user_id).toBeNull()
    expect(stats.status).toBeNull()
    expect(stats.created_at).toBeNull()
    expect(stats.activity_count).toBe(0)
    expect(stats.token_version).toBe(0)
  })

  it('returns stats for existing session', async () => {
    await sessionDO.createSession({ user_id: 'user_123' })
    const stats = await sessionDO.getStats()

    expect(stats.session_id).toMatch(/^sess_/)
    expect(stats.user_id).toBe('user_123')
    expect(stats.status).toBe('active')
    expect(stats.created_at).toBeDefined()
    expect(stats.last_active_at).toBeDefined()
    expect(stats.expire_at).toBeDefined()
    expect(stats.activity_count).toBe(1) // session.created
    expect(stats.token_version).toBe(0)
  })

  it('updates stats after token creation', async () => {
    await sessionDO.createSession({ user_id: 'user_123' })
    await sessionDO.createToken()
    await sessionDO.createToken()

    const stats = await sessionDO.getStats()

    expect(stats.token_version).toBe(2)
  })

  it('updates stats after activities', async () => {
    await sessionDO.createSession({ user_id: 'user_123' })
    await sessionDO.refresh()
    await sessionDO.setActiveOrganization('org_123')

    const stats = await sessionDO.getStats()

    expect(stats.activity_count).toBe(3)
  })

  it('reflects status changes', async () => {
    await sessionDO.createSession({ user_id: 'user_123' })
    await sessionDO.endSession()

    const stats = await sessionDO.getStats()

    expect(stats.status).toBe('ended')
  })
})

// ============================================================================
// User Agent Parsing Tests
// ============================================================================

describe('SessionDO - User Agent Parsing', () => {
  it('detects Chrome browser', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({
      user_id: 'user_123',
      user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
    })
    const info = await sessionDO.getClientInfo()
    expect(info?.browser).toBe('Chrome')
  })

  it('detects Firefox browser', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({
      user_id: 'user_123',
      user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    })
    const info = await sessionDO.getClientInfo()
    expect(info?.browser).toBe('Firefox')
  })

  it('detects Safari browser', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({
      user_id: 'user_123',
      user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 Safari/605.1.15',
    })
    const info = await sessionDO.getClientInfo()
    expect(info?.browser).toBe('Safari')
  })

  it('detects Edge browser', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({
      user_id: 'user_123',
      user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/120.0.0.0',
    })
    const info = await sessionDO.getClientInfo()
    expect(info?.browser).toBe('Edge')
  })

  it('detects Windows OS', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({
      user_id: 'user_123',
      user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
    })
    const info = await sessionDO.getClientInfo()
    expect(info?.os).toBe('Windows')
  })

  it('detects macOS', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({
      user_id: 'user_123',
      user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) Safari/605.1.15',
    })
    const info = await sessionDO.getClientInfo()
    expect(info?.os).toBe('macOS')
  })

  it('detects Linux OS', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({
      user_id: 'user_123',
      user_agent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0',
    })
    const info = await sessionDO.getClientInfo()
    expect(info?.os).toBe('Linux')
  })

  it('detects Android OS', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({
      user_id: 'user_123',
      user_agent: 'Mozilla/5.0 (Linux; Android 14) Mobile Chrome/120.0.0.0',
    })
    const info = await sessionDO.getClientInfo()
    expect(info?.os).toBe('Android')
    expect(info?.device_type).toBe('mobile')
  })

  it('detects iOS', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({
      user_id: 'user_123',
      user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) Mobile/15E148',
    })
    const info = await sessionDO.getClientInfo()
    expect(info?.os).toBe('iOS')
    expect(info?.device_type).toBe('mobile')
  })

  it('returns null for missing user agent', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({
      user_id: 'user_123',
    })
    const info = await sessionDO.getClientInfo()
    expect(info?.browser).toBeNull()
    expect(info?.os).toBeNull()
    expect(info?.device_type).toBeNull()
  })
})

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('SessionDO - Edge Cases', () => {
  let sessionDO: MockSessionDO

  beforeEach(() => {
    sessionDO = new MockSessionDO()
  })

  it('handles multiple sessions being created (only last survives)', async () => {
    await sessionDO.createSession({ user_id: 'user_1' })
    await sessionDO.createSession({ user_id: 'user_2' })

    const session = await sessionDO.getSession()
    expect(session?.user_id).toBe('user_2')
  })

  it('handles empty metadata in activities', async () => {
    await sessionDO.createSession({ user_id: 'user_123' })
    const activities = await sessionDO.getActivityLog()

    expect(activities[0].metadata).toEqual({})
  })

  it('preserves session data through multiple operations', async () => {
    await sessionDO.createSession({
      user_id: 'user_123',
      actor: { sub: 'admin_1' },
    })

    await sessionDO.setActiveOrganization('org_1')
    await sessionDO.refresh()
    await sessionDO.touch('10.0.0.1')

    const session = await sessionDO.getSession()
    expect(session?.user_id).toBe('user_123')
    expect(session?.actor).toEqual({ sub: 'admin_1' })
    expect(session?.last_active_organization_id).toBe('org_1')
  })

  it('generates unique IDs', async () => {
    const ids = new Set<string>()

    for (let i = 0; i < 100; i++) {
      const freshDO = new MockSessionDO()
      const session = await freshDO.createSession({ user_id: `user_${i}` })
      ids.add(session.id)
    }

    expect(ids.size).toBe(100)
  })

  it('handles special characters in user_id', async () => {
    const session = await sessionDO.createSession({
      user_id: 'user_with-special.chars@example.com',
    })

    expect(session.user_id).toBe('user_with-special.chars@example.com')
  })

  it('handles very long user agent strings', async () => {
    const longUserAgent = 'Mozilla/5.0 '.repeat(100)

    await sessionDO.createSession({
      user_id: 'user_123',
      user_agent: longUserAgent,
    })

    const info = await sessionDO.getClientInfo()
    expect(info?.user_agent).toBe(longUserAgent)
  })

  it('handles sequential token creation correctly', async () => {
    await sessionDO.createSession({ user_id: 'user_123' })

    // Sequential token creation
    const token1 = await sessionDO.createToken()
    const token2 = await sessionDO.createToken()
    const token3 = await sessionDO.createToken()

    // All should succeed with incrementing versions
    expect(token1).toBeDefined()
    expect(token2).toBeDefined()
    expect(token3).toBeDefined()

    expect(token1?.version).toBe(1)
    expect(token2?.version).toBe(2)
    expect(token3?.version).toBe(3)

    // Only latest token should be verifiable
    expect(await sessionDO.verifyToken(token1!.token_id, token1!.version)).toBe(false)
    expect(await sessionDO.verifyToken(token2!.token_id, token2!.version)).toBe(false)
    expect(await sessionDO.verifyToken(token3!.token_id, token3!.version)).toBe(true)
  })
})

// ============================================================================
// Session Expiration Tests
// ============================================================================

describe('SessionDO - Expiration Handling', () => {
  it('creates session with default 7-day expiry', async () => {
    const sessionDO = new MockSessionDO()
    const session = await sessionDO.createSession({ user_id: 'user_123' })

    const now = Date.now()
    const sevenDays = 7 * 24 * 60 * 60 * 1000

    expect(session.expire_at).toBeGreaterThan(now + sevenDays - 1000)
    expect(session.expire_at).toBeLessThan(now + sevenDays + 1000)
  })

  it('creates session with default 30-day abandon time', async () => {
    const sessionDO = new MockSessionDO()
    const session = await sessionDO.createSession({ user_id: 'user_123' })

    const now = Date.now()
    const thirtyDays = 30 * 24 * 60 * 60 * 1000

    expect(session.abandon_at).toBeGreaterThan(now + thirtyDays - 1000)
    expect(session.abandon_at).toBeLessThan(now + thirtyDays + 1000)
  })

  it('token has 60 second expiry', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({ user_id: 'user_123' })
    const token = await sessionDO.createToken()

    const now = Date.now()
    const sixtySeconds = 60 * 1000

    expect(token?.expires_at).toBeGreaterThan(now + sixtySeconds - 1000)
    expect(token?.expires_at).toBeLessThan(now + sixtySeconds + 1000)
  })

  it('marks session expired when creating token after expiry', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({
      user_id: 'user_123',
      expire_in: -1, // Already expired
    })

    const token = await sessionDO.createToken()
    expect(token).toBeNull()

    const session = await sessionDO.getSession()
    expect(session?.status).toBe('expired')
  })
})

// ============================================================================
// Session State Transitions Tests
// ============================================================================

describe('SessionDO - State Transitions', () => {
  it('starts in active state', async () => {
    const sessionDO = new MockSessionDO()
    const session = await sessionDO.createSession({ user_id: 'user_123' })

    expect(session.status).toBe('active')
  })

  it('transitions from active to ended', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({ user_id: 'user_123' })
    const ended = await sessionDO.endSession()

    expect(ended?.status).toBe('ended')
  })

  it('transitions from active to revoked', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({ user_id: 'user_123' })
    const revoked = await sessionDO.revokeSession()

    expect(revoked?.status).toBe('revoked')
  })

  it('transitions from active to removed', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({ user_id: 'user_123' })
    await sessionDO.removeSession()
    const session = await sessionDO.getSession()

    expect(session).toBeNull()
  })

  it('cannot refresh ended session', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({ user_id: 'user_123' })
    await sessionDO.endSession()
    const refreshed = await sessionDO.refresh()

    expect(refreshed).toBeNull()
  })

  it('cannot create token for revoked session', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({ user_id: 'user_123' })
    await sessionDO.revokeSession()
    const token = await sessionDO.createToken()

    expect(token).toBeNull()
  })

  it('cannot modify organization for ended session', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({ user_id: 'user_123' })
    await sessionDO.endSession()
    const result = await sessionDO.setActiveOrganization('org_123')

    expect(result).toBeNull()
  })

  it('cannot modify actor for revoked session', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({ user_id: 'user_123' })
    await sessionDO.revokeSession()
    const result = await sessionDO.setActor({ sub: 'admin' })

    expect(result).toBeNull()
  })
})

// ============================================================================
// Session Security Tests
// ============================================================================

describe('SessionDO - Security', () => {
  it('generates unique session IDs', async () => {
    const ids = new Set<string>()

    for (let i = 0; i < 50; i++) {
      const sessionDO = new MockSessionDO()
      const session = await sessionDO.createSession({ user_id: 'user' })
      ids.add(session.id)
    }

    expect(ids.size).toBe(50)
  })

  it('generates unique token IDs', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({ user_id: 'user_123' })

    const tokenIds = new Set<string>()

    for (let i = 0; i < 50; i++) {
      const token = await sessionDO.createToken()
      if (token) tokenIds.add(token.token_id)
    }

    expect(tokenIds.size).toBe(50)
  })

  it('generates unique activity IDs', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({ user_id: 'user_123' })

    for (let i = 0; i < 20; i++) {
      await sessionDO.refresh()
    }

    const activities = await sessionDO.getActivityLog()
    const activityIds = activities.map((a) => a.id)

    expect(new Set(activityIds).size).toBe(activityIds.length)
  })

  it('invalidates old tokens when new one is created', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({ user_id: 'user_123' })

    const oldToken = await sessionDO.createToken()
    const newToken = await sessionDO.createToken()

    expect(await sessionDO.verifyToken(oldToken!.token_id, oldToken!.version)).toBe(false)
    expect(await sessionDO.verifyToken(newToken!.token_id, newToken!.version)).toBe(true)
  })

  it('rejects token verification for wrong session state', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({ user_id: 'user_123' })
    const token = await sessionDO.createToken()

    await sessionDO.endSession()

    expect(await sessionDO.verifyToken(token!.token_id, token!.version)).toBe(false)
  })
})

// ============================================================================
// Clerk API Compatibility Tests
// ============================================================================

describe('SessionDO - Clerk API Compatibility', () => {
  it('returns Clerk-compatible session object', async () => {
    const sessionDO = new MockSessionDO()
    const session = await sessionDO.createSession({ user_id: 'user_123' })

    // Verify all Clerk session fields are present
    expect(session).toHaveProperty('id')
    expect(session).toHaveProperty('object', 'session')
    expect(session).toHaveProperty('client_id')
    expect(session).toHaveProperty('user_id')
    expect(session).toHaveProperty('status')
    expect(session).toHaveProperty('last_active_at')
    expect(session).toHaveProperty('last_active_organization_id')
    expect(session).toHaveProperty('actor')
    expect(session).toHaveProperty('expire_at')
    expect(session).toHaveProperty('abandon_at')
    expect(session).toHaveProperty('created_at')
    expect(session).toHaveProperty('updated_at')
  })

  it('uses correct ID prefixes', async () => {
    const sessionDO = new MockSessionDO()
    const session = await sessionDO.createSession({ user_id: 'user_123' })

    expect(session.id).toMatch(/^sess_/)
    expect(session.client_id).toMatch(/^client_/)
  })

  it('supports actor for impersonation flow', async () => {
    const sessionDO = new MockSessionDO()
    const session = await sessionDO.createSession({
      user_id: 'user_123',
      actor: {
        sub: 'admin_456',
        name: 'Admin User',
        role: 'super_admin',
      },
    })

    expect(session.actor).toBeDefined()
    expect(session.actor?.sub).toBe('admin_456')
    expect(session.actor?.name).toBe('Admin User')
    expect(session.actor?.role).toBe('super_admin')
  })

  it('supports organization context', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({ user_id: 'user_123' })
    const session = await sessionDO.setActiveOrganization('org_abc123')

    expect(session?.last_active_organization_id).toBe('org_abc123')
  })

  it('tracks timestamps in milliseconds', async () => {
    const sessionDO = new MockSessionDO()
    const before = Date.now()
    const session = await sessionDO.createSession({ user_id: 'user_123' })
    const after = Date.now()

    expect(session.created_at).toBeGreaterThanOrEqual(before)
    expect(session.created_at).toBeLessThanOrEqual(after)
    expect(session.created_at).toBeGreaterThan(1700000000000) // Sanity check: after 2023
  })
})

// ============================================================================
// Activity Audit Trail Tests
// ============================================================================

describe('SessionDO - Audit Trail', () => {
  it('creates audit trail for full session lifecycle', async () => {
    const sessionDO = new MockSessionDO()

    // Session lifecycle
    await sessionDO.createSession({ user_id: 'user_123' })
    await sessionDO.setActiveOrganization('org_1')
    await sessionDO.setActor({ sub: 'admin' })
    await sessionDO.refresh()
    await sessionDO.endSession()

    const activities = await sessionDO.getActivityLog()
    const actions = activities.map((a) => a.action)

    expect(actions).toContain('session.created')
    expect(actions).toContain('session.org_changed')
    expect(actions).toContain('session.actor_changed')
    expect(actions).toContain('session.refreshed')
    expect(actions).toContain('session.ended')
  })

  it('preserves activity order', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({ user_id: 'user_123' })
    await sessionDO.refresh()
    await sessionDO.setActiveOrganization('org_1')

    const activities = await sessionDO.getActivityLog()

    expect(activities[0].action).toBe('session.created')
    expect(activities[1].action).toBe('session.refreshed')
    expect(activities[2].action).toBe('session.org_changed')

    // Timestamps should be in order
    for (let i = 1; i < activities.length; i++) {
      expect(activities[i].timestamp).toBeGreaterThanOrEqual(activities[i - 1].timestamp)
    }
  })

  it('includes IP and user agent in activities', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({
      user_id: 'user_123',
      ip_address: '192.168.1.100',
      user_agent: 'TestBrowser/1.0',
    })

    const activities = await sessionDO.getActivityLog()

    expect(activities[0].ip_address).toBe('192.168.1.100')
    expect(activities[0].user_agent).toBe('TestBrowser/1.0')
  })

  it('stores metadata with activities', async () => {
    const sessionDO = new MockSessionDO()
    await sessionDO.createSession({ user_id: 'user_123' })
    await sessionDO.setActiveOrganization('org_test')

    const activities = await sessionDO.getActivityLog()
    const orgChange = activities.find((a) => a.action === 'session.org_changed')

    expect(orgChange?.metadata).toEqual({ org_id: 'org_test' })
  })
})
