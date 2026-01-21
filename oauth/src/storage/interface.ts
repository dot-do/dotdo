/**
 * @dotdo/oauth Session Storage Interface
 *
 * Defines the contract for session storage implementations.
 * Supports KV, D1, and in-memory storage backends.
 *
 * @module @dotdo/oauth/storage/interface
 */

/**
 * Session data stored for authenticated users.
 */
export interface SessionData {
  /** User identifier */
  userId: string
  /** OAuth access token */
  accessToken: string
  /** OAuth refresh token (if issued) */
  refreshToken?: string
  /** Token expiration timestamp (Unix milliseconds) */
  expiresAt?: number
  /** OAuth provider name (e.g., 'github', 'google') */
  provider: string
  /** Additional session metadata */
  metadata?: Record<string, unknown>
}

/**
 * Session store interface for OAuth session persistence.
 *
 * All methods are async to support both sync and async backends.
 * Implementations MUST handle TTL expiration.
 */
export interface SessionStore {
  /**
   * Get a session by ID.
   * Returns null if session does not exist or has expired.
   */
  get(sessionId: string): Promise<SessionData | null>

  /**
   * Set/update a session.
   * @param sessionId - Unique session identifier
   * @param data - Session data to store
   * @param ttl - Time-to-live in milliseconds (optional, uses default if not provided)
   */
  set(sessionId: string, data: SessionData, ttl?: number): Promise<void>

  /**
   * Delete a session by ID.
   */
  delete(sessionId: string): Promise<void>

  /**
   * Optional: Clean up expired sessions.
   * Useful for memory-based stores to prevent unbounded growth.
   */
  cleanup?(): Promise<void>

  /**
   * Optional: Rotate a session to a new ID.
   * Used for security after privilege changes (login, logout, etc.).
   * Returns the new session ID, or null if the old session doesn't exist.
   */
  rotate?(oldSessionId: string, newSessionId: string): Promise<string | null>
}

/**
 * Options for session store configuration.
 */
export interface SessionStoreOptions {
  /** Default TTL for sessions in milliseconds (default: 24 hours) */
  defaultTTL?: number
}
