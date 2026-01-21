/**
 * Session Management for @dotdo/auth
 *
 * Provides session creation, retrieval, invalidation, and refresh operations.
 * Sessions support sliding window expiration, session rotation, and per-user
 * session tracking.
 *
 * @module @dotdo/auth/session
 *
 * @example
 * ```typescript
 * import { createSession, getSession, invalidateSession } from '@dotdo/auth'
 *
 * // Create a new session
 * const session = await createSession(userId, { theme: 'dark' })
 *
 * // Retrieve session (returns null if expired)
 * const current = await getSession(session.id)
 *
 * // Invalidate on logout
 * await invalidateSession(session.id)
 *
 * // Logout from all devices
 * await invalidateSession(null, userId)
 * ```
 */

export interface Session {
  /** Unique session identifier */
  id: string
  /** User ID associated with this session */
  userId: string
  /** Custom data stored in the session */
  data: Record<string, unknown>
  /** Unix timestamp when session was created */
  createdAt: number
  /** Unix timestamp when session expires */
  expiresAt: number
  /** Unix timestamp of last access (updated on every retrieval) */
  lastAccessedAt: number
  /** Optional metadata (IP, user agent, device info) */
  metadata?: SessionMetadata | undefined
}

export interface SessionMetadata {
  ip?: string
  userAgent?: string
  device?: string
  [key: string]: unknown
}

export interface SessionOptions {
  maxAge?: number // in seconds, default 3600 (1 hour)
  secure?: boolean
  httpOnly?: boolean
  sameSite?: 'strict' | 'lax' | 'none'
  metadata?: SessionMetadata
  rotate?: boolean // for session rotation
  slidingWindow?: boolean // extend expiry on access, default true
}

// In-memory session storage (will be replaced with DO storage in production)
const sessions = new Map<string, Session>()
const userSessions = new Map<string, Set<string>>() // userId -> sessionIds

// Default options
const DEFAULT_MAX_AGE = 3600 // 1 hour
const DEFAULT_SLIDING_WINDOW = true

/**
 * Generate a unique session ID using cryptographic randomization.
 * @internal
 */
function generateSessionId(): string {
  // Use crypto.randomUUID if available, otherwise fallback
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  // Fallback for environments without crypto.randomUUID
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
}

/**
 * Create a new session for a user.
 *
 * Creates a session with a unique ID, optional initial data, and metadata.
 * Sessions use sliding window expiration by default (expiry extends on access).
 *
 * @param userId - The user ID to create the session for
 * @param data - Optional initial session data (default: empty object)
 * @param options - Session configuration options
 * @returns The created session object
 *
 * @example
 * ```typescript
 * const session = await createSession('user-123', {
 *   preferences: { theme: 'dark' }
 * }, {
 *   maxAge: 7200,  // 2 hours
 *   metadata: {
 *     ip: '192.168.1.1',
 *     userAgent: 'Mozilla/5.0...'
 *   }
 * })
 *
 * // Save session.id to a cookie for the client
 * res.setCookie('sessionId', session.id, { httpOnly: true })
 * ```
 */
export async function createSession(
  userId: string,
  data: Record<string, unknown> = {},
  options: SessionOptions = {}
): Promise<Session> {
  const maxAge = options.maxAge ?? DEFAULT_MAX_AGE
  const now = Date.now()

  const session: Session = {
    id: generateSessionId(),
    userId,
    data,
    createdAt: now,
    expiresAt: now + maxAge * 1000,
    lastAccessedAt: now,
    metadata: options.metadata,
  }

  // Store session
  sessions.set(session.id, session)

  // Track session by user
  if (!userSessions.has(userId)) {
    userSessions.set(userId, new Set())
  }
  userSessions.get(userId)!.add(session.id)

  return session
}

/**
 * Retrieve a session by ID with automatic expiration and refresh.
 *
 * Fetches a session by ID and returns null if the session doesn't exist or
 * has expired. Updates the lastAccessedAt timestamp on successful retrieval.
 * If sliding window expiration is enabled (default), extends the session
 * expiry based on the maxAge option.
 *
 * @param sessionId - The session ID to retrieve
 * @param options - Session options for sliding window configuration
 * @returns The session object or null if not found/expired
 *
 * @example
 * ```typescript
 * const sessionId = req.getCookie('sessionId')
 * const session = await getSession(sessionId)
 *
 * if (!session) {
 *   // Session doesn't exist or expired
 *   return redirectToLogin()
 * }
 *
 * // Use session data
 * console.log(session.data)
 * ```
 */
export async function getSession(
  sessionId: string,
  options: SessionOptions = {}
): Promise<Session | null> {
  const session = sessions.get(sessionId)

  if (!session) {
    return null
  }

  const now = Date.now()

  // Check if expired
  if (session.expiresAt <= now) {
    // Remove expired session
    await invalidateSession(sessionId)
    return null
  }

  // Update last accessed time
  session.lastAccessedAt = now

  // Implement sliding window expiration
  const slidingWindow = options.slidingWindow ?? DEFAULT_SLIDING_WINDOW
  if (slidingWindow) {
    const maxAge = options.maxAge ?? DEFAULT_MAX_AGE
    session.expiresAt = now + maxAge * 1000
  }

  return session
}

/**
 * Invalidate a session or all sessions for a user.
 *
 * Removes a session or all sessions for a user from the session store.
 * This is typically used for logout operations.
 *
 * @param sessionId - Specific session ID to invalidate, or null to invalidate by userId
 * @param userId - User ID to invalidate all sessions for (used when sessionId is null)
 * @returns true if a single session was invalidated, count of invalidated sessions for userId, or false if nothing invalidated
 *
 * @example
 * ```typescript
 * // Logout from current session
 * await invalidateSession(sessionId)
 *
 * // Logout from all devices
 * const invalidatedCount = await invalidateSession(null, userId)
 * console.log(`Logged out from ${invalidatedCount} devices`)
 * ```
 */
export async function invalidateSession(
  sessionId: string | null,
  userId?: string
): Promise<boolean | number> {
  if (sessionId) {
    // Invalidate specific session
    const session = sessions.get(sessionId)
    if (!session) {
      return false
    }

    // Remove from sessions
    sessions.delete(sessionId)

    // Remove from user sessions
    const userSessionSet = userSessions.get(session.userId)
    if (userSessionSet) {
      userSessionSet.delete(sessionId)
      if (userSessionSet.size === 0) {
        userSessions.delete(session.userId)
      }
    }

    return true
  }

  if (userId) {
    // Invalidate all sessions for user
    const userSessionSet = userSessions.get(userId)
    if (!userSessionSet) {
      return 0
    }

    let count = 0
    for (const sid of userSessionSet) {
      if (sessions.delete(sid)) {
        count++
      }
    }

    userSessions.delete(userId)
    return count
  }

  return false
}

/**
 * Refresh a session, extending its expiry and optionally updating data.
 *
 * Updates an existing session's expiration time and optionally merges new data
 * or metadata. Can also perform session rotation (create new session ID while
 * invalidating the old one) for additional security during privilege escalation.
 *
 * @param sessionId - The session ID to refresh
 * @param data - Optional data to merge into the session
 * @param options - Session options including rotate flag for ID rotation
 * @returns The updated session object or null if not found/expired
 *
 * @example
 * ```typescript
 * // Simple refresh to extend expiry
 * const refreshed = await refreshSession(sessionId)
 *
 * // Update session data
 * const updated = await refreshSession(sessionId, {
 *   roles: ['admin']  // Merge with existing data
 * })
 *
 * // Rotate session ID after login
 * const rotated = await refreshSession(sessionId, {}, {
 *   rotate: true
 * })
 * if (rotated) {
 *   res.setCookie('sessionId', rotated.id)
 * }
 * ```
 */
export async function refreshSession(
  sessionId: string,
  data?: Record<string, unknown>,
  options: SessionOptions = {}
): Promise<Session | null> {
  const session = sessions.get(sessionId)

  if (!session) {
    return null
  }

  const now = Date.now()

  // Check if already expired
  if (session.expiresAt <= now) {
    await invalidateSession(sessionId)
    return null
  }

  // Update session data if provided
  if (data !== undefined) {
    session.data = { ...session.data, ...data }
  }

  // Update metadata if provided
  if (options.metadata) {
    session.metadata = { ...session.metadata, ...options.metadata }
  }

  // Extend expiry
  const maxAge = options.maxAge ?? DEFAULT_MAX_AGE
  session.expiresAt = now + maxAge * 1000
  session.lastAccessedAt = now

  // Handle session rotation
  if (options.rotate) {
    // Create new session with rotated ID
    const newSession: Session = {
      ...session,
      id: generateSessionId(),
      createdAt: now,
      lastAccessedAt: now,
    }

    // Remove old session
    await invalidateSession(sessionId)

    // Store new session
    sessions.set(newSession.id, newSession)

    // Track new session by user
    if (!userSessions.has(newSession.userId)) {
      userSessions.set(newSession.userId, new Set())
    }
    userSessions.get(newSession.userId)!.add(newSession.id)

    return newSession
  }

  return session
}

/**
 * Clean up all expired sessions from storage.
 *
 * Removes sessions that have expired. This should be called periodically
 * to prevent unbounded session store growth. Can be triggered on a schedule
 * or on-demand.
 *
 * @returns The number of sessions that were removed
 *
 * @example
 * ```typescript
 * // Run cleanup on a schedule (e.g., every hour)
 * setInterval(async () => {
 *   const removed = await cleanupExpiredSessions()
 *   logger.info(`Cleaned up ${removed} expired sessions`)
 * }, 3600000)
 * ```
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const now = Date.now()
  let removed = 0

  for (const [sessionId, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      await invalidateSession(sessionId)
      removed++
    }
  }

  return removed
}

/**
 * Get all active sessions for a user.
 *
 * Retrieves all non-expired sessions associated with a user. Useful for
 * displaying active sessions or implementing "logout from all devices".
 *
 * @param userId - The user ID to get sessions for
 * @returns Array of active session objects (excludes expired sessions)
 *
 * @example
 * ```typescript
 * const sessions = await getUserSessions(userId)
 * for (const session of sessions) {
 *   console.log(`Session ${session.id} last accessed: ${session.lastAccessedAt}`)
 * }
 * ```
 */
export async function getUserSessions(userId: string): Promise<Session[]> {
  const userSessionSet = userSessions.get(userId)
  if (!userSessionSet) {
    return []
  }

  const now = Date.now()
  const result: Session[] = []

  for (const sessionId of userSessionSet) {
    const session = sessions.get(sessionId)
    if (session && session.expiresAt > now) {
      result.push(session)
    }
  }

  return result
}

/**
 * Clear all sessions from storage (for testing purposes).
 *
 * Completely empties the session store. Should only be used in test environments.
 *
 * @example
 * ```typescript
 * // In test teardown
 * afterEach(async () => {
 *   await clearAllSessions()
 * })
 * ```
 */
export async function clearAllSessions(): Promise<void> {
  sessions.clear()
  userSessions.clear()
}
