/**
 * SessionManager Types - Comprehensive Session Management Primitives
 *
 * Provides types for session management:
 * - Session: Core session data structure
 * - SessionConfig: Configuration for session behavior
 * - SessionStore: Storage interface for persistence
 * - Token: Secure token generation and validation
 * - RollingSession: Auto-extending sessions on activity
 * - ConcurrentSessionLimiter: Limit sessions per user
 */

/**
 * Core session data that can be stored
 */
export type SessionData = Record<string, unknown>

/**
 * Session entity
 */
export interface Session<T extends SessionData = SessionData> {
  /** Unique session identifier */
  id: string
  /** User ID associated with the session */
  userId: string
  /** Arbitrary session data */
  data: T
  /** Session creation timestamp */
  createdAt: number
  /** Session expiration timestamp */
  expiresAt: number
  /** Last access timestamp */
  lastAccessedAt: number
}

/**
 * SameSite cookie attribute
 */
export type SameSiteAttribute = 'strict' | 'lax' | 'none'

/**
 * Session configuration
 */
export interface SessionConfig {
  /** Time-to-live in milliseconds */
  ttl: number
  /** Whether to extend TTL on each access (rolling session) */
  rolling?: boolean
  /** Secure cookie flag */
  secure?: boolean
  /** SameSite cookie attribute */
  sameSite?: SameSiteAttribute
}

/**
 * Session store interface for persistence
 */
export interface SessionStore<T extends SessionData = SessionData> {
  /** Get session by ID */
  get(sessionId: string): Promise<Session<T> | null>
  /** Set/update session */
  set(session: Session<T>): Promise<void>
  /** Delete session */
  delete(sessionId: string): Promise<void>
  /** Touch session (update lastAccessedAt) */
  touch(sessionId: string): Promise<void>
  /** Get all sessions for a user */
  getUserSessions(userId: string): Promise<Session<T>[]>
  /** Delete all sessions for a user */
  deleteUserSessions(userId: string): Promise<void>
  /** Get all sessions (for cleanup) */
  getAllSessions(): Promise<Session<T>[]>
}

/**
 * Session token containing ID and signature
 */
export interface SessionToken {
  /** Session ID */
  id: string
  /** Cryptographic signature */
  signature: string
}

/**
 * Session cookie options
 */
export interface SessionOptions {
  /** Max age in seconds */
  maxAge?: number
  /** HTTP-only flag */
  httpOnly?: boolean
  /** Cookie domain */
  domain?: string
  /** Cookie path */
  path?: string
  /** Secure flag */
  secure?: boolean
  /** SameSite attribute */
  sameSite?: SameSiteAttribute
}

/**
 * Session statistics
 */
export interface SessionStats {
  /** Number of active (non-expired) sessions */
  active: number
  /** Number of expired sessions pending cleanup */
  expired: number
  /** Total sessions in store */
  total: number
}

/**
 * Result of session creation
 */
export interface CreateSessionResult<T extends SessionData = SessionData> {
  /** The created session */
  session: Session<T>
  /** The generated token */
  token: string
}

/**
 * Token generator interface
 */
export interface ITokenGenerator {
  /** Generate a new session token */
  generate(sessionId: string): string
  /** Parse a token string into components */
  parse(token: string): SessionToken | null
  /** Validate a token signature */
  validate(token: string): boolean
}

/**
 * Session cleaner interface
 */
export interface ISessionCleaner<T extends SessionData = SessionData> {
  /** Clean expired sessions */
  cleanExpired(): Promise<number>
  /** Start automatic cleanup at interval */
  startAutoClean(intervalMs: number): void
  /** Stop automatic cleanup */
  stopAutoClean(): void
}

/**
 * Concurrent session limiter interface
 */
export interface IConcurrentSessionLimiter {
  /** Maximum sessions allowed per user */
  maxSessions: number
  /** Check if user can create new session */
  canCreateSession(userId: string): Promise<boolean>
  /** Enforce limit by removing oldest sessions */
  enforceLimit(userId: string): Promise<void>
}

/**
 * Rolling session handler interface
 */
export interface IRollingSession {
  /** TTL extension on activity in milliseconds */
  extensionTtl: number
  /** Extend session if it should be extended */
  maybeExtend(session: Session): Promise<Session>
}

/**
 * Session manager interface
 */
export interface ISessionManager<T extends SessionData = SessionData> {
  /** Create a new session */
  create(userId: string, data?: T): Promise<CreateSessionResult<T>>
  /** Get session by ID */
  get(sessionId: string): Promise<Session<T> | null>
  /** Update session data */
  update(sessionId: string, data: Partial<T>): Promise<Session<T> | null>
  /** Destroy a session */
  destroy(sessionId: string): Promise<void>
  /** Touch session (extend TTL for rolling sessions) */
  touch(sessionId: string): Promise<Session<T> | null>
  /** Get all sessions for a user */
  getUserSessions(userId: string): Promise<Session<T>[]>
  /** Destroy all sessions for a user */
  destroyUserSessions(userId: string): Promise<void>
  /** Get session statistics */
  getStats(): Promise<SessionStats>
  /** Validate a token and return session */
  validateToken(token: string): Promise<Session<T> | null>
}

/**
 * Memory store entry for TTL handling
 */
export interface MemoryStoreEntry<T extends SessionData> {
  session: Session<T>
  expiresAt: number
}
