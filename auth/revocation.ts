// JWT Token Revocation for @dotdo/auth
// Provides token blacklist management with SQLite storage

import type { SqlStorage } from '../db/sqlite'
import { createMigration, type Migration } from '../db/migrations'

/**
 * Represents a revoked JWT token
 */
export interface TokenRevocation {
  /** JWT ID (jti claim) */
  jti: string
  /** Timestamp when token was revoked */
  revokedAt: number
  /** When the token would have expired (for cleanup) */
  expiresAt: number
  /** Optional reason for revocation */
  reason?: string | undefined
}

/**
 * Options for querying revoked tokens
 */
export interface RevocationQueryOptions {
  /** Filter by reason */
  reason?: string
  /** Only return tokens revoked after this timestamp */
  revokedAfter?: number
  /** Maximum number of results */
  limit?: number
  /** Offset for pagination */
  offset?: number
}

/**
 * Token revocation store interface
 */
export interface TokenRevocationStore {
  /**
   * Revoke a token by its JTI
   * @param jti - JWT ID from the token
   * @param expiresAt - When the token would have expired
   * @param reason - Optional reason for revocation
   */
  revokeToken(jti: string, expiresAt: number, reason?: string): Promise<void>

  /**
   * Check if a token has been revoked
   * @param jti - JWT ID to check
   * @returns true if the token is revoked
   */
  isTokenRevoked(jti: string): Promise<boolean>

  /**
   * Get revocation details for a token
   * @param jti - JWT ID to look up
   * @returns Revocation record or null if not revoked
   */
  getRevocation(jti: string): Promise<TokenRevocation | null>

  /**
   * Remove expired revocations from the blacklist
   * This should be called periodically to keep the blacklist size manageable
   * @returns Number of entries cleaned up
   */
  cleanupExpiredRevocations(): Promise<number>

  /**
   * List all revoked tokens (with optional filtering)
   * @param options - Query options
   */
  listRevocations(options?: RevocationQueryOptions): Promise<TokenRevocation[]>

  /**
   * Count revoked tokens
   * @param includeExpired - Whether to include expired revocations
   */
  countRevocations(includeExpired?: boolean): Promise<number>

  /**
   * Revoke all tokens for a subject (user logout from all devices)
   * Note: This requires knowing all JTIs for the subject, which typically
   * means tracking active tokens. This is a convenience method for stores
   * that support it.
   * @param subject - The subject (user ID) to revoke all tokens for
   * @param reason - Optional reason for revocation
   */
  revokeAllForSubject?(subject: string, reason?: string): Promise<number>
}

/**
 * Migration for the revoked_tokens table
 * Add this to your migrations array when initializing the database
 */
export const tokenRevocationMigration: Migration = createMigration({
  version: 7,
  name: 'create_revoked_tokens_table',
  up: `
    CREATE TABLE IF NOT EXISTS revoked_tokens (
      jti TEXT PRIMARY KEY,
      revoked_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires_at ON revoked_tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_revoked_tokens_revoked_at ON revoked_tokens(revoked_at DESC);
  `,
  down: `
    DROP INDEX IF EXISTS idx_revoked_tokens_revoked_at;
    DROP INDEX IF EXISTS idx_revoked_tokens_expires_at;
    DROP TABLE IF EXISTS revoked_tokens;
  `,
})

/**
 * Create an in-memory token revocation store
 * Useful for testing or single-instance deployments
 */
export function createInMemoryRevocationStore(): TokenRevocationStore {
  const revocations = new Map<string, TokenRevocation>()

  return {
    async revokeToken(jti: string, expiresAt: number, reason?: string): Promise<void> {
      revocations.set(jti, {
        jti,
        revokedAt: Date.now(),
        expiresAt,
        reason,
      })
    },

    async isTokenRevoked(jti: string): Promise<boolean> {
      return revocations.has(jti)
    },

    async getRevocation(jti: string): Promise<TokenRevocation | null> {
      return revocations.get(jti) || null
    },

    async cleanupExpiredRevocations(): Promise<number> {
      const now = Date.now()
      let cleaned = 0

      for (const [jti, revocation] of revocations) {
        if (revocation.expiresAt < now) {
          revocations.delete(jti)
          cleaned++
        }
      }

      return cleaned
    },

    async listRevocations(options: RevocationQueryOptions = {}): Promise<TokenRevocation[]> {
      const { reason, revokedAfter, limit = 100, offset = 0 } = options
      let results = Array.from(revocations.values())

      if (reason) {
        results = results.filter((r) => r.reason === reason)
      }

      if (revokedAfter) {
        results = results.filter((r) => r.revokedAt >= revokedAfter)
      }

      // Sort by revokedAt descending
      results.sort((a, b) => b.revokedAt - a.revokedAt)

      return results.slice(offset, offset + limit)
    },

    async countRevocations(includeExpired = false): Promise<number> {
      if (includeExpired) {
        return revocations.size
      }

      const now = Date.now()
      let count = 0
      for (const revocation of revocations.values()) {
        if (revocation.expiresAt >= now) {
          count++
        }
      }
      return count
    },
  }
}

/**
 * Create a SQLite-backed token revocation store
 * @param sql - SQLite storage instance
 */
export function createSQLiteRevocationStore(sql: SqlStorage): TokenRevocationStore {
  return {
    async revokeToken(jti: string, expiresAt: number, reason?: string): Promise<void> {
      const revokedAt = Date.now()

      await sql
        .prepare(
          `INSERT OR REPLACE INTO revoked_tokens (jti, revoked_at, expires_at, reason)
           VALUES (?, ?, ?, ?)`
        )
        .bind(jti, revokedAt, expiresAt, reason || null)
        .run()
    },

    async isTokenRevoked(jti: string): Promise<boolean> {
      const row = await sql
        .prepare('SELECT jti FROM revoked_tokens WHERE jti = ?')
        .bind(jti)
        .first()

      return row !== null
    },

    async getRevocation(jti: string): Promise<TokenRevocation | null> {
      const row = await sql
        .prepare('SELECT jti, revoked_at, expires_at, reason FROM revoked_tokens WHERE jti = ?')
        .bind(jti)
        .first()

      if (!row) return null

      return {
        jti: row.jti as string,
        revokedAt: row.revoked_at as number,
        expiresAt: row.expires_at as number,
        reason: (row.reason as string) || undefined,
      }
    },

    async cleanupExpiredRevocations(): Promise<number> {
      const now = Date.now()

      // Get count before deletion for return value
      const countResult = await sql
        .prepare('SELECT COUNT(*) as count FROM revoked_tokens WHERE expires_at < ?')
        .bind(now)
        .first()

      const count = (countResult?.count as number) ?? 0

      if (count > 0) {
        await sql.prepare('DELETE FROM revoked_tokens WHERE expires_at < ?').bind(now).run()
      }

      return count
    },

    async listRevocations(options: RevocationQueryOptions = {}): Promise<TokenRevocation[]> {
      const { reason, revokedAfter, limit = 100, offset = 0 } = options

      let query = 'SELECT jti, revoked_at, expires_at, reason FROM revoked_tokens WHERE 1=1'
      const params: unknown[] = []

      if (reason) {
        query += ' AND reason = ?'
        params.push(reason)
      }

      if (revokedAfter) {
        query += ' AND revoked_at >= ?'
        params.push(revokedAfter)
      }

      query += ' ORDER BY revoked_at DESC LIMIT ? OFFSET ?'
      params.push(limit, offset)

      const result = await sql.prepare(query).bind(...params).all()

      return result.results.map((row): TokenRevocation => ({
        jti: row.jti as string,
        revokedAt: row.revoked_at as number,
        expiresAt: row.expires_at as number,
        reason: (row.reason as string | undefined) || undefined,
      }))
    },

    async countRevocations(includeExpired = false): Promise<number> {
      let query = 'SELECT COUNT(*) as count FROM revoked_tokens'

      if (!includeExpired) {
        query += ' WHERE expires_at >= ?'
        const result = await sql.prepare(query).bind(Date.now()).first()
        return (result?.count as number) ?? 0
      }

      const result = await sql.prepare(query).first()
      return (result?.count as number) ?? 0
    },
  }
}

/**
 * Token revocation checker function type
 * Used to integrate with token validation middleware
 */
export type TokenRevocationChecker = (jti: string) => Promise<boolean>

/**
 * Create a revocation checker from a store
 * Returns a simple function that checks if a token is revoked
 */
export function createRevocationChecker(store: TokenRevocationStore): TokenRevocationChecker {
  return (jti: string) => store.isTokenRevoked(jti)
}

/**
 * Options for token validation with revocation checking
 */
export interface RevocationAwareValidationOptions {
  /** Revocation store to check against */
  revocationStore?: TokenRevocationStore
  /** Custom revocation checker function */
  revocationChecker?: TokenRevocationChecker
}

/**
 * Check if a token should be considered revoked
 * Returns true if revoked, false otherwise
 */
export async function checkRevocation(
  jti: string | undefined,
  options: RevocationAwareValidationOptions
): Promise<boolean> {
  // If no JTI, we can't check revocation
  if (!jti) {
    return false
  }

  // Use custom checker if provided
  if (options.revocationChecker) {
    return options.revocationChecker(jti)
  }

  // Use store if provided
  if (options.revocationStore) {
    return options.revocationStore.isTokenRevoked(jti)
  }

  // No revocation checking configured
  return false
}
