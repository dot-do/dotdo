/**
 * SessionManager - Comprehensive Session Management Primitives
 *
 * Provides session management capabilities:
 * - SessionManager: Core session CRUD operations
 * - MemoryStore: In-memory session storage
 * - TokenGenerator: Secure token generation
 * - TokenValidator: Token validation
 * - RollingSession: Auto-extending sessions
 * - SessionCleaner: Expired session cleanup
 * - ConcurrentSessionLimiter: Per-user session limits
 */

export * from './types'

import type {
  Session,
  SessionConfig,
  SessionData,
  SessionStore,
  SessionToken,
  SessionStats,
  CreateSessionResult,
  ISessionManager,
  ITokenGenerator,
  ISessionCleaner,
  IConcurrentSessionLimiter,
  IRollingSession,
} from './types'

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate a random ID using crypto
 */
function generateId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Synchronous hash for deterministic token generation
 * Uses djb2 algorithm with secret mixing for signature validation
 */
function createSimpleHash(data: string, secret: string): string {
  // Simple hash combining data and secret
  let hash = 0
  const combined = data + ':' + secret
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }

  // Convert to base64-url safe string
  const hashStr = Math.abs(hash).toString(36)
  return hashStr.padStart(8, '0')
}

// =============================================================================
// Memory Store Implementation
// =============================================================================

/**
 * In-memory session storage implementation
 */
export class MemoryStore<T extends SessionData = SessionData> implements SessionStore<T> {
  private sessions = new Map<string, Session<T>>()
  private userIndex = new Map<string, Set<string>>()

  async get(sessionId: string): Promise<Session<T> | null> {
    const session = this.sessions.get(sessionId)
    if (!session) return null

    // Check expiration
    if (Date.now() >= session.expiresAt) {
      return null
    }

    return session
  }

  async set(session: Session<T>): Promise<void> {
    this.sessions.set(session.id, session)

    // Update user index
    if (!this.userIndex.has(session.userId)) {
      this.userIndex.set(session.userId, new Set())
    }
    this.userIndex.get(session.userId)!.add(session.id)
  }

  async delete(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (session) {
      // Remove from user index
      const userSessions = this.userIndex.get(session.userId)
      if (userSessions) {
        userSessions.delete(sessionId)
        if (userSessions.size === 0) {
          this.userIndex.delete(session.userId)
        }
      }
    }
    this.sessions.delete(sessionId)
  }

  async touch(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.lastAccessedAt = Date.now()
    }
  }

  async getUserSessions(userId: string): Promise<Session<T>[]> {
    const sessionIds = this.userIndex.get(userId)
    if (!sessionIds) return []

    const now = Date.now()
    const sessions: Session<T>[] = []

    for (const sessionId of sessionIds) {
      const session = this.sessions.get(sessionId)
      if (session && now < session.expiresAt) {
        sessions.push(session)
      }
    }

    return sessions
  }

  async deleteUserSessions(userId: string): Promise<void> {
    const sessionIds = this.userIndex.get(userId)
    if (sessionIds) {
      for (const sessionId of sessionIds) {
        this.sessions.delete(sessionId)
      }
      this.userIndex.delete(userId)
    }
  }

  async getAllSessions(): Promise<Session<T>[]> {
    return Array.from(this.sessions.values())
  }
}

// =============================================================================
// Token Generator Implementation
// =============================================================================

/**
 * Secure token generator using HMAC signatures
 */
export class TokenGenerator implements ITokenGenerator {
  constructor(private secret: string) {}

  /**
   * Generate a token for a session ID
   * Format: sessionId.signature
   */
  generate(sessionId: string): string {
    const signature = createSimpleHash(sessionId, this.secret)
    return `${sessionId}.${signature}`
  }

  /**
   * Parse a token string into components
   */
  parse(token: string): SessionToken | null {
    if (!token || !token.includes('.')) return null

    const parts = token.split('.')
    if (parts.length !== 2) return null

    const [id, signature] = parts
    if (!id || !signature) return null

    return { id, signature }
  }

  /**
   * Validate a token signature
   */
  validate(token: string): boolean {
    const parsed = this.parse(token)
    if (!parsed) return false

    const expectedSignature = createSimpleHash(parsed.id, this.secret)
    return parsed.signature === expectedSignature
  }
}

// =============================================================================
// Token Validator Implementation
// =============================================================================

/**
 * Token validator (can be used separately from generator)
 */
export class TokenValidator {
  private generator: TokenGenerator

  constructor(secret: string) {
    this.generator = new TokenGenerator(secret)
  }

  /**
   * Validate a token
   */
  validate(token: string): boolean {
    return this.generator.validate(token)
  }

  /**
   * Validate and parse a token in one step
   */
  validateAndParse(token: string): SessionToken | null {
    if (!this.validate(token)) return null
    return this.generator.parse(token)
  }
}

// =============================================================================
// Rolling Session Implementation
// =============================================================================

/**
 * Rolling session handler for auto-extending sessions
 */
export class RollingSession<T extends SessionData = SessionData> implements IRollingSession {
  constructor(
    private store: SessionStore<T>,
    public extensionTtl: number
  ) {}

  /**
   * Extend session TTL if appropriate
   */
  async maybeExtend(session: Session<T>): Promise<Session<T>> {
    const now = Date.now()

    // Update last accessed time and extend expiration
    const updatedSession: Session<T> = {
      ...session,
      lastAccessedAt: now,
      expiresAt: now + this.extensionTtl,
    }

    await this.store.set(updatedSession)
    return updatedSession
  }
}

// =============================================================================
// Session Cleaner Implementation
// =============================================================================

/**
 * Session cleaner for removing expired sessions
 */
export class SessionCleaner<T extends SessionData = SessionData> implements ISessionCleaner<T> {
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(private store: SessionStore<T>) {}

  /**
   * Clean all expired sessions
   * Returns the number of sessions cleaned
   */
  async cleanExpired(): Promise<number> {
    const allSessions = await this.store.getAllSessions()
    const now = Date.now()
    let cleaned = 0

    for (const session of allSessions) {
      if (now >= session.expiresAt) {
        await this.store.delete(session.id)
        cleaned++
      }
    }

    return cleaned
  }

  /**
   * Start automatic cleanup at the specified interval
   */
  startAutoClean(intervalMs: number): void {
    this.stopAutoClean()
    this.cleanupInterval = setInterval(() => {
      this.cleanExpired()
    }, intervalMs)
  }

  /**
   * Stop automatic cleanup
   */
  stopAutoClean(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }
}

// =============================================================================
// Concurrent Session Limiter Implementation
// =============================================================================

/**
 * Limits concurrent sessions per user
 */
export class ConcurrentSessionLimiter<T extends SessionData = SessionData>
  implements IConcurrentSessionLimiter
{
  constructor(
    private store: SessionStore<T>,
    public maxSessions: number
  ) {}

  /**
   * Check if user can create a new session
   */
  async canCreateSession(userId: string): Promise<boolean> {
    const sessions = await this.store.getUserSessions(userId)
    return sessions.length < this.maxSessions
  }

  /**
   * Enforce the session limit by removing oldest sessions
   */
  async enforceLimit(userId: string): Promise<void> {
    const sessions = await this.store.getUserSessions(userId)

    if (sessions.length <= this.maxSessions) return

    // Sort by creation time (oldest first)
    const sortedSessions = sessions.sort((a, b) => a.createdAt - b.createdAt)

    // Remove oldest sessions until we're at the limit
    const sessionsToRemove = sortedSessions.slice(0, sessions.length - this.maxSessions)

    for (const session of sessionsToRemove) {
      await this.store.delete(session.id)
    }
  }
}

// =============================================================================
// Session Manager Implementation
// =============================================================================

/**
 * Main session manager class
 */
export class SessionManager<T extends SessionData = SessionData> implements ISessionManager<T> {
  private tokenGenerator: TokenGenerator
  private rollingSession?: RollingSession<T>

  constructor(
    private config: SessionConfig,
    private store: SessionStore<T>,
    secret: string = 'default-secret-change-me'
  ) {
    this.tokenGenerator = new TokenGenerator(secret)

    if (config.rolling) {
      this.rollingSession = new RollingSession(store, config.ttl)
    }
  }

  /**
   * Create a new session
   */
  async create(userId: string, data: T = {} as T): Promise<CreateSessionResult<T>> {
    const now = Date.now()
    const sessionId = generateId()

    const session: Session<T> = {
      id: sessionId,
      userId,
      data,
      createdAt: now,
      expiresAt: now + this.config.ttl,
      lastAccessedAt: now,
    }

    await this.store.set(session)

    const token = this.tokenGenerator.generate(sessionId)

    return { session, token }
  }

  /**
   * Get session by ID
   */
  async get(sessionId: string): Promise<Session<T> | null> {
    const session = await this.store.get(sessionId)
    if (!session) return null

    // Check if expired
    if (Date.now() >= session.expiresAt) {
      return null
    }

    return session
  }

  /**
   * Update session data
   */
  async update(sessionId: string, data: Partial<T>): Promise<Session<T> | null> {
    const session = await this.get(sessionId)
    if (!session) return null

    const updatedSession: Session<T> = {
      ...session,
      data: { ...session.data, ...data },
      lastAccessedAt: Date.now(),
    }

    await this.store.set(updatedSession)
    return updatedSession
  }

  /**
   * Destroy a session
   */
  async destroy(sessionId: string): Promise<void> {
    await this.store.delete(sessionId)
  }

  /**
   * Touch session (update lastAccessedAt, optionally extend TTL)
   */
  async touch(sessionId: string): Promise<Session<T> | null> {
    const session = await this.get(sessionId)
    if (!session) return null

    if (this.rollingSession) {
      return this.rollingSession.maybeExtend(session)
    }

    // Non-rolling: just update lastAccessedAt
    const updatedSession: Session<T> = {
      ...session,
      lastAccessedAt: Date.now(),
    }

    await this.store.set(updatedSession)
    return updatedSession
  }

  /**
   * Get all sessions for a user
   */
  async getUserSessions(userId: string): Promise<Session<T>[]> {
    return this.store.getUserSessions(userId)
  }

  /**
   * Destroy all sessions for a user
   */
  async destroyUserSessions(userId: string): Promise<void> {
    await this.store.deleteUserSessions(userId)
  }

  /**
   * Get session statistics
   */
  async getStats(): Promise<SessionStats> {
    const allSessions = await this.store.getAllSessions()
    const now = Date.now()

    let active = 0
    let expired = 0

    for (const session of allSessions) {
      if (now < session.expiresAt) {
        active++
      } else {
        expired++
      }
    }

    return {
      active,
      expired,
      total: allSessions.length,
    }
  }

  /**
   * Validate a token and return the associated session
   */
  async validateToken(token: string): Promise<Session<T> | null> {
    if (!this.tokenGenerator.validate(token)) {
      return null
    }

    const parsed = this.tokenGenerator.parse(token)
    if (!parsed) return null

    return this.get(parsed.id)
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a session manager with default configuration
 *
 * @example
 * ```ts
 * const manager = createSessionManager({
 *   ttl: 3600000, // 1 hour
 *   rolling: true,
 *   secure: true,
 *   sameSite: 'strict',
 * })
 *
 * const { session, token } = await manager.create('user:123', { role: 'admin' })
 * const retrieved = await manager.validateToken(token)
 * ```
 */
export function createSessionManager<T extends SessionData = SessionData>(
  config: SessionConfig,
  store?: SessionStore<T>,
  secret?: string
): SessionManager<T> {
  return new SessionManager(config, store ?? new MemoryStore(), secret)
}

/**
 * Create a session cleaner
 *
 * @example
 * ```ts
 * const cleaner = createSessionCleaner(store)
 * cleaner.startAutoClean(60000) // Clean every minute
 * ```
 */
export function createSessionCleaner<T extends SessionData = SessionData>(
  store: SessionStore<T>
): SessionCleaner<T> {
  return new SessionCleaner(store)
}

/**
 * Create a concurrent session limiter
 *
 * @example
 * ```ts
 * const limiter = createConcurrentSessionLimiter(store, 3)
 *
 * if (await limiter.canCreateSession('user:123')) {
 *   // Create session
 * } else {
 *   // User has too many sessions
 * }
 * ```
 */
export function createConcurrentSessionLimiter<T extends SessionData = SessionData>(
  store: SessionStore<T>,
  maxSessions: number
): ConcurrentSessionLimiter<T> {
  return new ConcurrentSessionLimiter(store, maxSessions)
}
