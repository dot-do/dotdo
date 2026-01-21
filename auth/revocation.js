// JWT Token Revocation for @dotdo/auth
// Provides token blacklist management with SQLite storage
/**
 * Create a migration object
 */
export function createMigration(options) {
    return options;
}
/**
 * Migration for the revoked_tokens table
 * Add this to your migrations array when initializing the database
 */
export const tokenRevocationMigration = createMigration({
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
});
/**
 * Create an in-memory token revocation store
 * Useful for testing or single-instance deployments
 */
export function createInMemoryRevocationStore() {
    const revocations = new Map();
    return {
        async revokeToken(jti, expiresAt, reason) {
            revocations.set(jti, {
                jti,
                revokedAt: Date.now(),
                expiresAt,
                reason,
            });
        },
        async isTokenRevoked(jti) {
            return revocations.has(jti);
        },
        async getRevocation(jti) {
            return revocations.get(jti) || null;
        },
        async cleanupExpiredRevocations() {
            const now = Date.now();
            let cleaned = 0;
            for (const [jti, revocation] of revocations) {
                if (revocation.expiresAt < now) {
                    revocations.delete(jti);
                    cleaned++;
                }
            }
            return cleaned;
        },
        async listRevocations(options = {}) {
            const { reason, revokedAfter, limit = 100, offset = 0 } = options;
            let results = Array.from(revocations.values());
            if (reason) {
                results = results.filter((r) => r.reason === reason);
            }
            if (revokedAfter) {
                results = results.filter((r) => r.revokedAt >= revokedAfter);
            }
            // Sort by revokedAt descending
            results.sort((a, b) => b.revokedAt - a.revokedAt);
            return results.slice(offset, offset + limit);
        },
        async countRevocations(includeExpired = false) {
            if (includeExpired) {
                return revocations.size;
            }
            const now = Date.now();
            let count = 0;
            for (const revocation of revocations.values()) {
                if (revocation.expiresAt >= now) {
                    count++;
                }
            }
            return count;
        },
    };
}
/**
 * Create a SQLite-backed token revocation store
 * @param sql - SQLite storage instance
 */
export function createSQLiteRevocationStore(sql) {
    return {
        async revokeToken(jti, expiresAt, reason) {
            const revokedAt = Date.now();
            await sql
                .prepare(`INSERT OR REPLACE INTO revoked_tokens (jti, revoked_at, expires_at, reason)
           VALUES (?, ?, ?, ?)`)
                .bind(jti, revokedAt, expiresAt, reason || null)
                .run();
        },
        async isTokenRevoked(jti) {
            const row = await sql
                .prepare('SELECT jti FROM revoked_tokens WHERE jti = ?')
                .bind(jti)
                .first();
            return row !== null;
        },
        async getRevocation(jti) {
            const row = await sql
                .prepare('SELECT jti, revoked_at, expires_at, reason FROM revoked_tokens WHERE jti = ?')
                .bind(jti)
                .first();
            if (!row)
                return null;
            return {
                jti: row['jti'],
                revokedAt: row['revoked_at'],
                expiresAt: row['expires_at'],
                reason: row['reason'] || undefined,
            };
        },
        async cleanupExpiredRevocations() {
            const now = Date.now();
            // Get count before deletion for return value
            const countResult = await sql
                .prepare('SELECT COUNT(*) as count FROM revoked_tokens WHERE expires_at < ?')
                .bind(now)
                .first();
            const count = countResult?.['count'] ?? 0;
            if (count > 0) {
                await sql.prepare('DELETE FROM revoked_tokens WHERE expires_at < ?').bind(now).run();
            }
            return count;
        },
        async listRevocations(options = {}) {
            const { reason, revokedAfter, limit = 100, offset = 0 } = options;
            let query = 'SELECT jti, revoked_at, expires_at, reason FROM revoked_tokens WHERE 1=1';
            const params = [];
            if (reason) {
                query += ' AND reason = ?';
                params.push(reason);
            }
            if (revokedAfter) {
                query += ' AND revoked_at >= ?';
                params.push(revokedAfter);
            }
            query += ' ORDER BY revoked_at DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);
            const result = await sql.prepare(query).bind(...params).all();
            return result.results.map((row) => ({
                jti: row['jti'],
                revokedAt: row['revoked_at'],
                expiresAt: row['expires_at'],
                reason: row['reason'] || undefined,
            }));
        },
        async countRevocations(includeExpired = false) {
            let query = 'SELECT COUNT(*) as count FROM revoked_tokens';
            if (!includeExpired) {
                query += ' WHERE expires_at >= ?';
                const result = await sql.prepare(query).bind(Date.now()).first();
                return result?.['count'] ?? 0;
            }
            const result = await sql.prepare(query).bind().first();
            return result?.['count'] ?? 0;
        },
    };
}
/**
 * Create a revocation checker from a store
 * Returns a simple function that checks if a token is revoked
 */
export function createRevocationChecker(store) {
    return (jti) => store.isTokenRevoked(jti);
}
/**
 * Check if a token should be considered revoked
 * Returns true if revoked, false otherwise
 */
export async function checkRevocation(jti, options) {
    // If no JTI, we can't check revocation
    if (!jti) {
        return false;
    }
    // Use custom checker if provided
    if (options.revocationChecker) {
        return options.revocationChecker(jti);
    }
    // Use store if provided
    if (options.revocationStore) {
        return options.revocationStore.isTokenRevoked(jti);
    }
    // No revocation checking configured
    return false;
}
//# sourceMappingURL=revocation.js.map