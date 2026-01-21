// Session management for @dotdo/auth
// Implements session creation, retrieval, invalidation, and refresh
// In-memory session storage (will be replaced with DO storage in production)
const sessions = new Map();
const userSessions = new Map(); // userId -> sessionIds
// Default options
const DEFAULT_MAX_AGE = 3600; // 1 hour
const DEFAULT_SLIDING_WINDOW = true;
/**
 * Generate a unique session ID
 */
function generateSessionId() {
    // Use crypto.randomUUID if available, otherwise fallback
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback for environments without crypto.randomUUID
    return `session-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}
/**
 * Create a new session
 */
export async function createSession(userId, data = {}, options = {}) {
    const maxAge = options.maxAge ?? DEFAULT_MAX_AGE;
    const now = Date.now();
    const session = {
        id: generateSessionId(),
        userId,
        data,
        createdAt: now,
        expiresAt: now + maxAge * 1000,
        lastAccessedAt: now,
        metadata: options.metadata,
    };
    // Store session
    sessions.set(session.id, session);
    // Track session by user
    if (!userSessions.has(userId)) {
        userSessions.set(userId, new Set());
    }
    const userSessionSet = userSessions.get(userId);
    if (userSessionSet) {
        userSessionSet.add(session.id);
    }
    return session;
}
/**
 * Retrieve a session by ID
 * Returns null if session doesn't exist or is expired
 * Updates lastAccessedAt and extends expiry if sliding window is enabled
 */
export async function getSession(sessionId, options = {}) {
    const session = sessions.get(sessionId);
    if (!session) {
        return null;
    }
    const now = Date.now();
    // Check if expired
    if (session.expiresAt <= now) {
        // Remove expired session
        await invalidateSession(sessionId);
        return null;
    }
    // Update last accessed time
    session.lastAccessedAt = now;
    // Implement sliding window expiration
    const slidingWindow = options.slidingWindow ?? DEFAULT_SLIDING_WINDOW;
    if (slidingWindow) {
        const maxAge = options.maxAge ?? DEFAULT_MAX_AGE;
        session.expiresAt = now + maxAge * 1000;
    }
    return session;
}
/**
 * Invalidate a session or all sessions for a user
 * If sessionId is provided, invalidates that specific session
 * If userId is provided (and sessionId is null), invalidates all sessions for that user
 * Returns true if successful (for single session) or count of invalidated sessions (for user)
 */
export async function invalidateSession(sessionId, userId) {
    if (sessionId) {
        // Invalidate specific session
        const session = sessions.get(sessionId);
        if (!session) {
            return false;
        }
        // Remove from sessions
        sessions.delete(sessionId);
        // Remove from user sessions
        const userSessionSet = userSessions.get(session.userId);
        if (userSessionSet) {
            userSessionSet.delete(sessionId);
            if (userSessionSet.size === 0) {
                userSessions.delete(session.userId);
            }
        }
        return true;
    }
    if (userId) {
        // Invalidate all sessions for user
        const userSessionSet = userSessions.get(userId);
        if (!userSessionSet) {
            return 0;
        }
        let count = 0;
        for (const sid of userSessionSet) {
            if (sessions.delete(sid)) {
                count++;
            }
        }
        userSessions.delete(userId);
        return count;
    }
    return false;
}
/**
 * Refresh a session, extending its expiry
 * Optionally updates session data
 * Optionally rotates session ID for security
 * Returns the updated session or null if not found/expired
 */
export async function refreshSession(sessionId, data, options = {}) {
    const session = sessions.get(sessionId);
    if (!session) {
        return null;
    }
    const now = Date.now();
    // Check if already expired
    if (session.expiresAt <= now) {
        await invalidateSession(sessionId);
        return null;
    }
    // Update session data if provided
    if (data !== undefined) {
        session.data = { ...session.data, ...data };
    }
    // Update metadata if provided
    if (options.metadata) {
        session.metadata = { ...session.metadata, ...options.metadata };
    }
    // Extend expiry
    const maxAge = options.maxAge ?? DEFAULT_MAX_AGE;
    session.expiresAt = now + maxAge * 1000;
    session.lastAccessedAt = now;
    // Handle session rotation
    if (options.rotate) {
        // Create new session with rotated ID
        const newSession = {
            ...session,
            id: generateSessionId(),
            createdAt: now,
            lastAccessedAt: now,
        };
        // Remove old session
        await invalidateSession(sessionId);
        // Store new session
        sessions.set(newSession.id, newSession);
        // Track new session by user
        if (!userSessions.has(newSession.userId)) {
            userSessions.set(newSession.userId, new Set());
        }
        const newUserSessionSet = userSessions.get(newSession.userId);
        if (newUserSessionSet) {
            newUserSessionSet.add(newSession.id);
        }
        return newSession;
    }
    return session;
}
/**
 * Clean up expired sessions
 * Returns the number of sessions removed
 */
export async function cleanupExpiredSessions() {
    const now = Date.now();
    let removed = 0;
    for (const [sessionId, session] of sessions.entries()) {
        if (session.expiresAt <= now) {
            await invalidateSession(sessionId);
            removed++;
        }
    }
    return removed;
}
/**
 * Get all sessions for a user
 */
export async function getUserSessions(userId) {
    const userSessionSet = userSessions.get(userId);
    if (!userSessionSet) {
        return [];
    }
    const now = Date.now();
    const result = [];
    for (const sessionId of userSessionSet) {
        const session = sessions.get(sessionId);
        if (session && session.expiresAt > now) {
            result.push(session);
        }
    }
    return result;
}
/**
 * Clear all sessions (for testing)
 */
export async function clearAllSessions() {
    sessions.clear();
    userSessions.clear();
}
//# sourceMappingURL=session.js.map