// Audit Logging - Comprehensive audit trail for security and compliance (do-xebw)
import { createMigration } from './migrations';
/**
 * Generate unique audit log ID
 */
function generateAuditId() {
    return `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
/**
 * Create an in-memory audit log store
 * For testing and development; use SQLite store for production
 */
export function createAuditLogStore() {
    const logs = [];
    return {
        async log(entry) {
            const log = {
                ...entry,
                $id: generateAuditId(),
                $timestamp: Date.now()
            };
            logs.push(log);
            return log;
        },
        async get(id) {
            return logs.find(l => l.$id === id) ?? null;
        },
        async query(options = {}) {
            const { actor, action, resource, resourceId, level, since, until, limit = 100, offset = 0 } = options;
            let results = logs.filter(l => {
                if (actor && l.actor !== actor)
                    return false;
                if (action && l.action !== action)
                    return false;
                if (resource && l.resource !== resource)
                    return false;
                if (resourceId && l.resourceId !== resourceId)
                    return false;
                if (level && l.level !== level)
                    return false;
                if (since && l.$timestamp < since)
                    return false;
                if (until && l.$timestamp > until)
                    return false;
                return true;
            });
            // Sort by timestamp descending (newest first)
            results.sort((a, b) => b.$timestamp - a.$timestamp);
            return results.slice(offset, offset + limit);
        },
        async count(options = {}) {
            const results = await this.query({ ...options, limit: Number.MAX_SAFE_INTEGER });
            return results.length;
        },
        async deleteOlderThan(timestamp) {
            const before = logs.length;
            const toKeep = logs.filter(l => l.$timestamp >= timestamp);
            logs.length = 0;
            logs.push(...toKeep);
            return before - toKeep.length;
        },
        async deleteAll() {
            const count = logs.length;
            logs.length = 0;
            return count;
        }
    };
}
/**
 * Default audit log configuration
 *
 * maskFields patterns use case-insensitive substring matching.
 * A field like "userPassword" will match "password", "accessToken" will match "token", etc.
 */
export const defaultAuditConfig = {
    enabled: true,
    minLevel: 'info',
    retentionDays: 90,
    maskFields: [
        // Authentication & Authorization
        'password',
        'passwd',
        'pwd',
        'token',
        'accesstoken',
        'refreshtoken',
        'bearer',
        'jwt',
        'session',
        'cookie',
        'auth',
        'credential',
        'secret',
        'apikey',
        'api_key',
        'privatekey',
        'private_key',
        'publickey', // Sometimes sensitive in context
        'signingkey',
        'encryptionkey',
        'masterkey',
        // Personal Identifiable Information (PII)
        'ssn',
        'socialsecurity',
        'social_security',
        'nationalid',
        'national_id',
        'taxid',
        'tax_id',
        'driverslicense',
        'drivers_license',
        'passport',
        'dob',
        'dateofbirth',
        'date_of_birth',
        'birthdate',
        // Financial Data
        'creditcard',
        'credit_card',
        'cardnumber',
        'card_number',
        'cvv',
        'cvc',
        'securitycode',
        'security_code',
        'expiry',
        'expiration',
        'bankaccount',
        'bank_account',
        'accountnumber',
        'account_number',
        'routingnumber',
        'routing_number',
        'iban',
        'swift',
        'bic',
        'pin',
        // Contact Information (optionally sensitive)
        'phone',
        'mobile',
        'cellphone',
        'email', // Often logged but consider masking in some contexts
        // Healthcare (HIPAA)
        'healthrecord',
        'health_record',
        'medicalrecord',
        'medical_record',
        'diagnosis',
        'prescription',
        'patientid',
        'patient_id',
        // OAuth & Third-party
        'clientsecret',
        'client_secret',
        'appsecret',
        'app_secret',
        'consumerkey',
        'consumer_key',
        'consumersecret',
        'consumer_secret',
        'oauthtoken',
        'oauth_token',
        // Encryption & Security
        'salt',
        'hash',
        'cipher',
        'nonce',
        'iv', // Initialization vector
        // Database & Infrastructure
        'connectionstring',
        'connection_string',
        'dbpassword',
        'db_password'
    ]
};
/**
 * Log level priority for filtering
 */
export const LOG_LEVEL_PRIORITY = {
    info: 0,
    warn: 1,
    error: 2,
    security: 3
};
/**
 * Check if a log level meets the minimum threshold
 */
export function meetsLogLevel(level, minLevel) {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLevel];
}
/**
 * Mask sensitive fields in an object
 */
export function maskSensitiveFields(data, fieldsToMask) {
    const masked = {};
    for (const [key, value] of Object.entries(data)) {
        if (fieldsToMask.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
            masked[key] = '***REDACTED***';
        }
        else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            masked[key] = maskSensitiveFields(value, fieldsToMask);
        }
        else {
            masked[key] = value;
        }
    }
    return masked;
}
/**
 * Generate unique audit log ID
 */
function generateAuditIdForSQLite() {
    return `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
/**
 * SQLite-backed AuditLogStore for production use
 */
export function createSQLiteAuditLogStore(adapter) {
    const sql = adapter.getSql();
    return {
        async log(entry) {
            const log = {
                ...entry,
                $id: generateAuditIdForSQLite(),
                $timestamp: Date.now()
            };
            const detailsJson = entry.details ? JSON.stringify(entry.details) : null;
            await sql
                .prepare(`INSERT INTO audit_logs (id, timestamp, actor, action, resource, resource_id, level, details, correlation_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .bind(log.$id, log.$timestamp, log.actor, log.action, log.resource, log.resourceId || null, log.level, detailsJson, log.correlationId || null)
                .run();
            return log;
        },
        async get(id) {
            const row = await sql
                .prepare(`SELECT id, timestamp, actor, action, resource, resource_id, level, details, correlation_id
           FROM audit_logs WHERE id = ?`)
                .bind(id)
                .first();
            if (!row)
                return null;
            const log = {
                $id: row['id'],
                $timestamp: row['timestamp'],
                actor: row['actor'],
                action: row['action'],
                resource: row['resource'],
                level: row['level'],
            };
            if (row['resource_id'])
                log.resourceId = row['resource_id'];
            if (row['details'])
                log.details = JSON.parse(row['details']);
            if (row['correlation_id'])
                log.correlationId = row['correlation_id'];
            return log;
        },
        async query(options = {}) {
            const { actor, action, resource, resourceId, level, since, until, limit = 100, offset = 0 } = options;
            let query = `
        SELECT id, timestamp, actor, action, resource, resource_id, level, details, correlation_id
        FROM audit_logs WHERE 1=1
      `;
            const params = [];
            if (actor) {
                query += ' AND actor = ?';
                params.push(actor);
            }
            if (action) {
                query += ' AND action = ?';
                params.push(action);
            }
            if (resource) {
                query += ' AND resource = ?';
                params.push(resource);
            }
            if (resourceId) {
                query += ' AND resource_id = ?';
                params.push(resourceId);
            }
            if (level) {
                query += ' AND level = ?';
                params.push(level);
            }
            if (since) {
                query += ' AND timestamp >= ?';
                params.push(since);
            }
            if (until) {
                query += ' AND timestamp <= ?';
                params.push(until);
            }
            query += ' ORDER BY timestamp DESC';
            query += ' LIMIT ? OFFSET ?';
            params.push(limit, offset);
            const result = await sql.prepare(query).bind(...params).all();
            return result.results.map((row) => {
                const log = {
                    $id: row['id'],
                    $timestamp: row['timestamp'],
                    actor: row['actor'],
                    action: row['action'],
                    resource: row['resource'],
                    level: row['level'],
                };
                if (row['resource_id'])
                    log.resourceId = row['resource_id'];
                if (row['details'])
                    log.details = JSON.parse(row['details']);
                if (row['correlation_id'])
                    log.correlationId = row['correlation_id'];
                return log;
            });
        },
        async count(options = {}) {
            const { actor, action, resource, resourceId, level, since, until } = options;
            let query = 'SELECT COUNT(*) as count FROM audit_logs WHERE 1=1';
            const params = [];
            if (actor) {
                query += ' AND actor = ?';
                params.push(actor);
            }
            if (action) {
                query += ' AND action = ?';
                params.push(action);
            }
            if (resource) {
                query += ' AND resource = ?';
                params.push(resource);
            }
            if (resourceId) {
                query += ' AND resource_id = ?';
                params.push(resourceId);
            }
            if (level) {
                query += ' AND level = ?';
                params.push(level);
            }
            if (since) {
                query += ' AND timestamp >= ?';
                params.push(since);
            }
            if (until) {
                query += ' AND timestamp <= ?';
                params.push(until);
            }
            const row = await sql.prepare(query).bind(...params).first();
            return row?.['count'] || 0;
        },
        async deleteOlderThan(timestamp) {
            // First count how many will be deleted
            const countRow = await sql
                .prepare('SELECT COUNT(*) as count FROM audit_logs WHERE timestamp < ?')
                .bind(timestamp)
                .first();
            const count = countRow?.['count'] || 0;
            // Then delete
            await sql
                .prepare('DELETE FROM audit_logs WHERE timestamp < ?')
                .bind(timestamp)
                .run();
            return count;
        },
        async deleteAll() {
            // First count
            const countRow = await sql
                .prepare('SELECT COUNT(*) as count FROM audit_logs')
                .bind()
                .first();
            const count = countRow?.['count'] || 0;
            // Then delete
            await sql.prepare('DELETE FROM audit_logs').bind().run();
            return count;
        }
    };
}
/**
 * Migration for audit_logs table
 */
export const auditLogMigration = createMigration({
    version: 4,
    name: 'create_audit_logs_table',
    up: `
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      resource_id TEXT,
      level TEXT NOT NULL,
      details TEXT,
      correlation_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_level ON audit_logs(level);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_correlation_id ON audit_logs(correlation_id);
  `,
    down: `
    DROP INDEX IF EXISTS idx_audit_logs_correlation_id;
    DROP INDEX IF EXISTS idx_audit_logs_level;
    DROP INDEX IF EXISTS idx_audit_logs_resource;
    DROP INDEX IF EXISTS idx_audit_logs_action;
    DROP INDEX IF EXISTS idx_audit_logs_actor;
    DROP INDEX IF EXISTS idx_audit_logs_timestamp;
    DROP TABLE IF EXISTS audit_logs;
  `
});
/**
 * Create audit context from HTTP request
 */
export function createAuditContextFromRequest(request, userId) {
    const correlationId = request.headers.get('x-correlation-id') ||
        request.headers.get('x-request-id') ||
        `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    return {
        actor: userId || 'anonymous',
        correlationId
    };
}
//# sourceMappingURL=audit.js.map