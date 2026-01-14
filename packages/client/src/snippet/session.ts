/**
 * Session ID Management
 *
 * Manages browser session IDs for trace correlation.
 * Persists session ID in sessionStorage for consistency across page navigation.
 *
 * @module @dotdo/client/snippet/session
 */

/** Storage key for the session ID */
const SESSION_STORAGE_KEY = 'dotdo_session_id'

/**
 * Gets or creates a session ID.
 *
 * Retrieves the session ID from sessionStorage if it exists,
 * otherwise generates a new UUID and stores it.
 *
 * Session IDs persist across page navigation within the same browser tab
 * but are cleared when the tab is closed.
 *
 * @returns The session ID
 *
 * @example
 * ```typescript
 * const sessionId = getOrCreateSessionId()
 * // => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
 *
 * // Same ID returned on subsequent calls
 * const sameId = getOrCreateSessionId()
 * // => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
 * ```
 */
export function getOrCreateSessionId(): string {
  // Check if we're in a browser environment with sessionStorage
  if (typeof sessionStorage === 'undefined') {
    // Fallback for non-browser environments: generate a new ID each time
    return crypto.randomUUID()
  }

  let sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY)

  if (!sessionId) {
    sessionId = crypto.randomUUID()
    sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId)
  }

  return sessionId
}

/**
 * Gets the current session ID without creating a new one.
 *
 * Returns null if no session has been established yet.
 *
 * @returns The session ID or null if not set
 *
 * @example
 * ```typescript
 * const sessionId = getSessionId()
 * if (sessionId) {
 *   console.log('Active session:', sessionId)
 * } else {
 *   console.log('No active session')
 * }
 * ```
 */
export function getSessionId(): string | null {
  if (typeof sessionStorage === 'undefined') {
    return null
  }

  return sessionStorage.getItem(SESSION_STORAGE_KEY)
}

/**
 * Clears the current session ID.
 *
 * Removes the session ID from sessionStorage. A new ID will be
 * generated on the next call to getOrCreateSessionId().
 *
 * @example
 * ```typescript
 * clearSessionId()
 * // Next getOrCreateSessionId() will generate a new ID
 * ```
 */
export function clearSessionId(): void {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(SESSION_STORAGE_KEY)
  }
}

/**
 * Sets a specific session ID.
 *
 * Useful for scenarios where you want to use a server-provided
 * session ID or synchronize sessions across contexts.
 *
 * @param sessionId - The session ID to set
 *
 * @example
 * ```typescript
 * // Use a server-provided session ID
 * setSessionId('server-session-123')
 *
 * // All subsequent calls return this ID
 * const id = getOrCreateSessionId()
 * // => 'server-session-123'
 * ```
 */
export function setSessionId(sessionId: string): void {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId)
  }
}

/**
 * Checks if a session ID exists.
 *
 * @returns true if a session ID exists, false otherwise
 *
 * @example
 * ```typescript
 * if (hasSessionId()) {
 *   // Continue with existing session
 * } else {
 *   // Initialize new session
 * }
 * ```
 */
export function hasSessionId(): boolean {
  if (typeof sessionStorage === 'undefined') {
    return false
  }

  return sessionStorage.getItem(SESSION_STORAGE_KEY) !== null
}
