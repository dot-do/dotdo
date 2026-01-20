// Session management for @dotdo/auth
// Implements session creation, retrieval, invalidation, and refresh
// Persists to StorageAdapter for DO storage support (do-qy75)

import type { StorageAdapter } from '../db/storage'
import { createMemoryStorageAdapter } from '../db/adapters/memory'

export interface Session {
  id: string
  userId: string
  data: Record<string, unknown>
  createdAt: number
  expiresAt: number
  lastAccessedAt: number
  metadata?: SessionMetadata
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

/**
 * Session storage configuration
 * Allows injecting a storage adapter for persistence
 */
export interface SessionStorageConfig {
  adapter: StorageAdapter
}

// Storage adapter instance - defaults to in-memory for backward compatibility
let storageAdapter: StorageAdapter = createMemoryStorageAdapter()

// Key prefixes for storage
const SESSION_PREFIX = 'session:'
const USER_SESSION_PREFIX = 'user_sessions:'

// Default options
const DEFAULT_MAX_AGE = 3600 // 1 hour
const DEFAULT_SLIDING_WINDOW = true

/**
 * Configure the session storage adapter
 * Call this with a StorageAdapter backed by DO/SQLite for persistence
 *
 * @example
 * // In DO initialization
 * import { SQLiteStorageAdapter } from '@dotdo/db'
 * import { configureSessionStorage } from '@dotdo/auth'
 *
 * configureSessionStorage({
 *   adapter: new SQLiteStorageAdapter(this.state.storage.sql, { namespace: 'sessions' })
 * })
 */
export function configureSessionStorage(config: SessionStorageConfig): void {
  storageAdapter = config.adapter
}

/**
 * Get the current storage adapter (for testing)
 */
export function getSessionStorageAdapter(): StorageAdapter {
  return storageAdapter
}

/**
 * Reset storage to default in-memory adapter (for testing)
 */
export function resetSessionStorage(): void {
  storageAdapter = createMemoryStorageAdapter()
}

/**
 * Generate a unique session ID
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
 * Get user sessions set from storage
 */
async function getUserSessionIds(userId: string): Promise<Set<string>> {
  const key = `${USER_SESSION_PREFIX}${userId}`
  const sessionIds = await storageAdapter.get<string[]>(key)
  return new Set(sessionIds ?? [])
}

/**
 * Save user sessions set to storage
 */
async function saveUserSessionIds(userId: string, sessionIds: Set<string>): Promise<void> {
  const key = `${USER_SESSION_PREFIX}${userId}`
  if (sessionIds.size === 0) {
    await storageAdapter.delete(key)
  } else {
    await storageAdapter.put(key, Array.from(sessionIds))
  }
}

/**
 * Create a new session
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
  await storageAdapter.put(`${SESSION_PREFIX}${session.id}`, session)

  // Track session by user
  const userSessionIds = await getUserSessionIds(userId)
  userSessionIds.add(session.id)
  await saveUserSessionIds(userId, userSessionIds)

  return session
}

/**
 * Retrieve a session by ID
 * Returns null if session doesn't exist or is expired
 * Updates lastAccessedAt and extends expiry if sliding window is enabled
 */
export async function getSession(
  sessionId: string,
  options: SessionOptions = {}
): Promise<Session | null> {
  const session = await storageAdapter.get<Session>(`${SESSION_PREFIX}${sessionId}`)

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

  // Save updated session
  await storageAdapter.put(`${SESSION_PREFIX}${sessionId}`, session)

  return session
}

/**
 * Invalidate a session or all sessions for a user
 * If sessionId is provided, invalidates that specific session
 * If userId is provided (and sessionId is null), invalidates all sessions for that user
 * Returns true if successful (for single session) or count of invalidated sessions (for user)
 */
export async function invalidateSession(
  sessionId: string | null,
  userId?: string
): Promise<boolean | number> {
  if (sessionId) {
    // Invalidate specific session
    const session = await storageAdapter.get<Session>(`${SESSION_PREFIX}${sessionId}`)
    if (!session) {
      return false
    }

    // Remove from sessions
    await storageAdapter.delete(`${SESSION_PREFIX}${sessionId}`)

    // Remove from user sessions
    const userSessionIds = await getUserSessionIds(session.userId)
    userSessionIds.delete(sessionId)
    await saveUserSessionIds(session.userId, userSessionIds)

    return true
  }

  if (userId) {
    // Invalidate all sessions for user
    const userSessionIds = await getUserSessionIds(userId)
    if (userSessionIds.size === 0) {
      return 0
    }

    let count = 0
    for (const sid of userSessionIds) {
      const exists = await storageAdapter.has(`${SESSION_PREFIX}${sid}`)
      if (exists) {
        await storageAdapter.delete(`${SESSION_PREFIX}${sid}`)
        count++
      }
    }

    // Clear user sessions index
    await storageAdapter.delete(`${USER_SESSION_PREFIX}${userId}`)
    return count
  }

  return false
}

/**
 * Refresh a session, extending its expiry
 * Optionally updates session data
 * Optionally rotates session ID for security
 * Returns the updated session or null if not found/expired
 */
export async function refreshSession(
  sessionId: string,
  data?: Record<string, unknown>,
  options: SessionOptions = {}
): Promise<Session | null> {
  const session = await storageAdapter.get<Session>(`${SESSION_PREFIX}${sessionId}`)

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
    await storageAdapter.put(`${SESSION_PREFIX}${newSession.id}`, newSession)

    // Track new session by user
    const userSessionIds = await getUserSessionIds(newSession.userId)
    userSessionIds.add(newSession.id)
    await saveUserSessionIds(newSession.userId, userSessionIds)

    return newSession
  }

  // Save updated session
  await storageAdapter.put(`${SESSION_PREFIX}${sessionId}`, session)

  return session
}

/**
 * Clean up expired sessions
 * Returns the number of sessions removed
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const now = Date.now()
  let removed = 0

  // List all sessions
  const result = await storageAdapter.list<Session>({
    prefix: SESSION_PREFIX,
    includeValues: true
  })

  for (const [key, session] of result.entries) {
    if (session && session.expiresAt <= now) {
      // Extract session ID from key (remove prefix)
      const sessionId = key.replace(SESSION_PREFIX, '')
      await invalidateSession(sessionId)
      removed++
    }
  }

  return removed
}

/**
 * Get all sessions for a user
 */
export async function getUserSessions(userId: string): Promise<Session[]> {
  const userSessionIds = await getUserSessionIds(userId)
  if (userSessionIds.size === 0) {
    return []
  }

  const now = Date.now()
  const result: Session[] = []

  for (const sessionId of userSessionIds) {
    const session = await storageAdapter.get<Session>(`${SESSION_PREFIX}${sessionId}`)
    if (session && session.expiresAt > now) {
      result.push(session)
    }
  }

  return result
}

/**
 * Clear all sessions (for testing)
 */
export async function clearAllSessions(): Promise<void> {
  await storageAdapter.clear()
}
