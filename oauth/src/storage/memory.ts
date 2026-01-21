/**
 * @dotdo/oauth Memory Session Store
 *
 * In-memory session storage for testing and development.
 * NOT recommended for production use - sessions are lost on restart.
 *
 * @module @dotdo/oauth/storage/memory
 */

import type { SessionData, SessionStore, SessionStoreOptions } from './interface'

/** Default TTL: 24 hours in milliseconds */
const DEFAULT_TTL = 24 * 60 * 60 * 1000

interface StoredSession {
  data: SessionData
  expiresAt: number
}

/**
 * In-memory session store implementation.
 *
 * Features:
 * - TTL-based expiration with lazy cleanup
 * - Session rotation support
 * - Cleanup method for manual garbage collection
 */
export class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, StoredSession>()
  private defaultTTL: number

  constructor(options: SessionStoreOptions = {}) {
    this.defaultTTL = options.defaultTTL ?? DEFAULT_TTL
  }

  async get(sessionId: string): Promise<SessionData | null> {
    const stored = this.sessions.get(sessionId)

    if (!stored) {
      return null
    }

    // Check expiration
    if (Date.now() > stored.expiresAt) {
      this.sessions.delete(sessionId)
      return null
    }

    return stored.data
  }

  async set(sessionId: string, data: SessionData, ttl?: number): Promise<void> {
    const expiresAt = Date.now() + (ttl ?? this.defaultTTL)
    this.sessions.set(sessionId, { data, expiresAt })
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId)
  }

  async cleanup(): Promise<void> {
    const now = Date.now()
    for (const [sessionId, stored] of this.sessions) {
      if (now > stored.expiresAt) {
        this.sessions.delete(sessionId)
      }
    }
  }

  async rotate(oldSessionId: string, newSessionId: string): Promise<string | null> {
    const stored = this.sessions.get(oldSessionId)

    if (!stored) {
      return null
    }

    // Check expiration
    if (Date.now() > stored.expiresAt) {
      this.sessions.delete(oldSessionId)
      return null
    }

    // Move session to new ID
    this.sessions.set(newSessionId, stored)
    this.sessions.delete(oldSessionId)

    return newSessionId
  }
}
