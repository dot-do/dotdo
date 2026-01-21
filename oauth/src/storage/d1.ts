/**
 * @dotdo/oauth D1 Session Store
 *
 * Cloudflare D1-backed session storage.
 * Best for strong consistency and complex queries.
 *
 * @module @dotdo/oauth/storage/d1
 */

import type { SessionData, SessionStore, SessionStoreOptions } from './interface'

/** Default TTL: 24 hours in milliseconds */
const DEFAULT_TTL = 24 * 60 * 60 * 1000

/** D1 store specific options */
export interface D1SessionStoreOptions extends SessionStoreOptions {
  /** Table name for sessions (default: 'sessions') */
  tableName?: string
}

/**
 * D1 session row structure.
 */
interface SessionRow {
  id: string
  user_id: string
  access_token: string
  refresh_token: string | null
  expires_at: number | null
  provider: string
  metadata: string | null
  created_at: number
  session_expires_at: number
}

/**
 * Cloudflare D1 session store implementation.
 *
 * Features:
 * - Strong consistency (SQLite-based)
 * - Complex query support
 * - Manual TTL expiration via cleanup()
 *
 * Required table schema:
 * ```sql
 * CREATE TABLE sessions (
 *   id TEXT PRIMARY KEY,
 *   user_id TEXT NOT NULL,
 *   access_token TEXT NOT NULL,
 *   refresh_token TEXT,
 *   expires_at INTEGER,
 *   provider TEXT NOT NULL,
 *   metadata TEXT,
 *   created_at INTEGER NOT NULL,
 *   session_expires_at INTEGER NOT NULL
 * );
 *
 * CREATE INDEX sessions_user_id ON sessions(user_id);
 * CREATE INDEX sessions_expires ON sessions(session_expires_at);
 * ```
 */
export class D1SessionStore implements SessionStore {
  private db: D1Database
  private tableName: string
  private defaultTTL: number

  constructor(db: D1Database, options: D1SessionStoreOptions = {}) {
    this.db = db
    this.tableName = options.tableName ?? 'sessions'
    this.defaultTTL = options.defaultTTL ?? DEFAULT_TTL
  }

  async get(sessionId: string): Promise<SessionData | null> {
    const query = `SELECT * FROM ${this.tableName} WHERE id = ? AND session_expires_at > ?`
    const now = Date.now()

    const row = await this.db
      .prepare(query)
      .bind(sessionId, now)
      .first<SessionRow>()

    if (!row) {
      return null
    }

    return this.rowToSessionData(row)
  }

  async set(sessionId: string, data: SessionData, ttl?: number): Promise<void> {
    const now = Date.now()
    const sessionExpiresAt = now + (ttl ?? this.defaultTTL)

    const query = `
      INSERT OR REPLACE INTO ${this.tableName}
      (id, user_id, access_token, refresh_token, expires_at, provider, metadata, created_at, session_expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `

    await this.db
      .prepare(query)
      .bind(
        sessionId,
        data.userId,
        data.accessToken,
        data.refreshToken ?? null,
        data.expiresAt ?? null,
        data.provider,
        data.metadata ? JSON.stringify(data.metadata) : null,
        now,
        sessionExpiresAt
      )
      .run()
  }

  async delete(sessionId: string): Promise<void> {
    const query = `DELETE FROM ${this.tableName} WHERE id = ?`
    await this.db.prepare(query).bind(sessionId).run()
  }

  async cleanup(): Promise<void> {
    const query = `DELETE FROM ${this.tableName} WHERE session_expires_at <= ?`
    await this.db.prepare(query).bind(Date.now()).run()
  }

  async rotate(oldSessionId: string, newSessionId: string): Promise<string | null> {
    const data = await this.get(oldSessionId)

    if (!data) {
      return null
    }

    // D1 supports transactions, but for simplicity we do sequential operations
    // In production, consider using batch operations for atomicity
    await this.set(newSessionId, data)
    await this.delete(oldSessionId)

    return newSessionId
  }

  private rowToSessionData(row: SessionRow): SessionData {
    const data: SessionData = {
      userId: row.user_id,
      accessToken: row.access_token,
      provider: row.provider,
    }

    // Only add optional properties if they have values
    // This satisfies exactOptionalPropertyTypes
    if (row.refresh_token !== null) {
      data.refreshToken = row.refresh_token
    }
    if (row.expires_at !== null) {
      data.expiresAt = row.expires_at
    }
    if (row.metadata !== null) {
      data.metadata = JSON.parse(row.metadata)
    }

    return data
  }
}

/**
 * SQL schema for D1 session table.
 * Call this once to initialize the database.
 */
export const D1_SESSION_SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at INTEGER,
  provider TEXT NOT NULL,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  session_expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(session_expires_at);
`
