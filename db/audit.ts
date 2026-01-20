// Audit Logging - Comprehensive audit trail for security and compliance (do-xebw)

import type { SqlStorage, SQLiteAdapter } from './sqlite'
import { createMigration, type Migration } from './migrations'

/**
 * Audit log levels for categorizing log severity
 */
export type AuditLogLevel = 'info' | 'warn' | 'error' | 'security'

/**
 * Standard audit actions
 */
export type AuditAction =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'auth_success'
  | 'auth_failed'
  | 'access_denied'
  | 'export'
  | 'import'
  | 'admin_action'
  | string // Allow custom actions

/**
 * Audit log entry
 */
export interface AuditLog {
  /** Unique identifier for this log entry */
  $id: string
  /** Timestamp when the action occurred */
  $timestamp: number
  /** Who performed the action (user ID, system, API key ID) */
  actor: string
  /** What action was performed */
  action: AuditAction
  /** Type of resource affected (e.g., Customer, Order) */
  resource: string
  /** Specific resource ID (optional) */
  resourceId?: string
  /** Log level for filtering and alerting */
  level: AuditLogLevel
  /** Additional context about the action */
  details?: Record<string, unknown>
  /** Correlation ID for tracing related operations */
  correlationId?: string
}

/**
 * Query options for audit logs
 */
export interface AuditLogQueryOptions {
  actor?: string
  action?: AuditAction
  resource?: string
  resourceId?: string
  level?: AuditLogLevel
  since?: number
  until?: number
  limit?: number
  offset?: number
}

/**
 * Audit log store interface
 */
export interface AuditLogStore {
  /**
   * Log an audit entry
   */
  log(entry: Omit<AuditLog, '$id' | '$timestamp'>): Promise<AuditLog>

  /**
   * Get a specific audit log by ID
   */
  get(id: string): Promise<AuditLog | null>

  /**
   * Query audit logs with filters
   */
  query(options?: AuditLogQueryOptions): Promise<AuditLog[]>

  /**
   * Count audit logs matching filters
   */
  count(options?: AuditLogQueryOptions): Promise<number>

  /**
   * Delete logs older than the specified timestamp (for retention policy)
   * Returns the number of deleted logs
   */
  deleteOlderThan(timestamp: number): Promise<number>

  /**
   * Delete all audit logs (use with caution!)
   * Returns the number of deleted logs
   */
  deleteAll(): Promise<number>
}

/**
 * Generate unique audit log ID
 */
function generateAuditId(): string {
  return `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Create an in-memory audit log store
 * For testing and development; use SQLite store for production
 */
export function createAuditLogStore(): AuditLogStore {
  const logs: AuditLog[] = []

  return {
    async log(entry) {
      const log: AuditLog = {
        ...entry,
        $id: generateAuditId(),
        $timestamp: Date.now()
      }
      logs.push(log)
      return log
    },

    async get(id: string) {
      return logs.find(l => l.$id === id) ?? null
    },

    async query(options = {}) {
      const { actor, action, resource, resourceId, level, since, until, limit = 100, offset = 0 } = options

      let results = logs.filter(l => {
        if (actor && l.actor !== actor) return false
        if (action && l.action !== action) return false
        if (resource && l.resource !== resource) return false
        if (resourceId && l.resourceId !== resourceId) return false
        if (level && l.level !== level) return false
        if (since && l.$timestamp < since) return false
        if (until && l.$timestamp > until) return false
        return true
      })

      // Sort by timestamp descending (newest first)
      results.sort((a, b) => b.$timestamp - a.$timestamp)

      return results.slice(offset, offset + limit)
    },

    async count(options = {}) {
      const results = await this.query({ ...options, limit: Number.MAX_SAFE_INTEGER })
      return results.length
    },

    async deleteOlderThan(timestamp: number) {
      const before = logs.length
      const toKeep = logs.filter(l => l.$timestamp >= timestamp)
      logs.length = 0
      logs.push(...toKeep)
      return before - toKeep.length
    },

    async deleteAll() {
      const count = logs.length
      logs.length = 0
      return count
    }
  }
}

/**
 * Configuration options for audit logging
 */
export interface AuditLogConfig {
  /** Enable/disable audit logging */
  enabled: boolean
  /** Log level threshold (logs at or above this level are recorded) */
  minLevel: AuditLogLevel
  /** Retention period in days (0 = keep forever) */
  retentionDays: number
  /** Fields to mask in details (for PII protection) */
  maskFields: string[]
}

/**
 * Default audit log configuration
 */
export const defaultAuditConfig: AuditLogConfig = {
  enabled: true,
  minLevel: 'info',
  retentionDays: 90,
  maskFields: ['password', 'token', 'secret', 'apiKey', 'ssn', 'creditCard']
}

/**
 * Log level priority for filtering
 */
export const LOG_LEVEL_PRIORITY: Record<AuditLogLevel, number> = {
  info: 0,
  warn: 1,
  error: 2,
  security: 3
}

/**
 * Check if a log level meets the minimum threshold
 */
export function meetsLogLevel(level: AuditLogLevel, minLevel: AuditLogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLevel]
}

/**
 * Mask sensitive fields in an object
 */
export function maskSensitiveFields(
  data: Record<string, unknown>,
  fieldsToMask: string[]
): Record<string, unknown> {
  const masked: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(data)) {
    if (fieldsToMask.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
      masked[key] = '***REDACTED***'
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      masked[key] = maskSensitiveFields(value as Record<string, unknown>, fieldsToMask)
    } else {
      masked[key] = value
    }
  }

  return masked
}

/**
 * Generate unique audit log ID
 */
function generateAuditIdForSQLite(): string {
  return `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * SQLite-backed AuditLogStore for production use
 */
export function createSQLiteAuditLogStore(adapter: SQLiteAdapter): AuditLogStore {
  const sql = adapter.getSql()

  return {
    async log(entry) {
      const log: AuditLog = {
        ...entry,
        $id: generateAuditIdForSQLite(),
        $timestamp: Date.now()
      }

      const detailsJson = entry.details ? JSON.stringify(entry.details) : null

      await sql
        .prepare(
          `INSERT INTO audit_logs (id, timestamp, actor, action, resource, resource_id, level, details, correlation_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          log.$id,
          log.$timestamp,
          log.actor,
          log.action,
          log.resource,
          log.resourceId || null,
          log.level,
          detailsJson,
          log.correlationId || null
        )
        .run()

      return log
    },

    async get(id: string) {
      const row = await sql
        .prepare(
          `SELECT id, timestamp, actor, action, resource, resource_id, level, details, correlation_id
           FROM audit_logs WHERE id = ?`
        )
        .bind(id)
        .first()

      if (!row) return null

      return {
        $id: row.id as string,
        $timestamp: row.timestamp as number,
        actor: row.actor as string,
        action: row.action as AuditAction,
        resource: row.resource as string,
        resourceId: (row.resource_id as string) || undefined,
        level: row.level as AuditLogLevel,
        details: row.details ? JSON.parse(row.details as string) : undefined,
        correlationId: (row.correlation_id as string) || undefined
      }
    },

    async query(options = {}) {
      const { actor, action, resource, resourceId, level, since, until, limit = 100, offset = 0 } = options

      let query = `
        SELECT id, timestamp, actor, action, resource, resource_id, level, details, correlation_id
        FROM audit_logs WHERE 1=1
      `
      const params: unknown[] = []

      if (actor) {
        query += ' AND actor = ?'
        params.push(actor)
      }

      if (action) {
        query += ' AND action = ?'
        params.push(action)
      }

      if (resource) {
        query += ' AND resource = ?'
        params.push(resource)
      }

      if (resourceId) {
        query += ' AND resource_id = ?'
        params.push(resourceId)
      }

      if (level) {
        query += ' AND level = ?'
        params.push(level)
      }

      if (since) {
        query += ' AND timestamp >= ?'
        params.push(since)
      }

      if (until) {
        query += ' AND timestamp <= ?'
        params.push(until)
      }

      query += ' ORDER BY timestamp DESC'
      query += ' LIMIT ? OFFSET ?'
      params.push(limit, offset)

      const result = await sql.prepare(query).bind(...params).all()

      return result.results.map((row) => ({
        $id: row.id as string,
        $timestamp: row.timestamp as number,
        actor: row.actor as string,
        action: row.action as AuditAction,
        resource: row.resource as string,
        resourceId: (row.resource_id as string) || undefined,
        level: row.level as AuditLogLevel,
        details: row.details ? JSON.parse(row.details as string) : undefined,
        correlationId: (row.correlation_id as string) || undefined
      }))
    },

    async count(options = {}) {
      const { actor, action, resource, resourceId, level, since, until } = options

      let query = 'SELECT COUNT(*) as count FROM audit_logs WHERE 1=1'
      const params: unknown[] = []

      if (actor) {
        query += ' AND actor = ?'
        params.push(actor)
      }

      if (action) {
        query += ' AND action = ?'
        params.push(action)
      }

      if (resource) {
        query += ' AND resource = ?'
        params.push(resource)
      }

      if (resourceId) {
        query += ' AND resource_id = ?'
        params.push(resourceId)
      }

      if (level) {
        query += ' AND level = ?'
        params.push(level)
      }

      if (since) {
        query += ' AND timestamp >= ?'
        params.push(since)
      }

      if (until) {
        query += ' AND timestamp <= ?'
        params.push(until)
      }

      const row = await sql.prepare(query).bind(...params).first()
      return (row?.count as number) || 0
    },

    async deleteOlderThan(timestamp: number) {
      // First count how many will be deleted
      const countRow = await sql
        .prepare('SELECT COUNT(*) as count FROM audit_logs WHERE timestamp < ?')
        .bind(timestamp)
        .first()
      const count = (countRow?.count as number) || 0

      // Then delete
      await sql
        .prepare('DELETE FROM audit_logs WHERE timestamp < ?')
        .bind(timestamp)
        .run()

      return count
    },

    async deleteAll() {
      // First count
      const countRow = await sql
        .prepare('SELECT COUNT(*) as count FROM audit_logs')
        .bind()
        .first()
      const count = (countRow?.count as number) || 0

      // Then delete
      await sql.prepare('DELETE FROM audit_logs').bind().run()

      return count
    }
  }
}

/**
 * Migration for audit_logs table
 */
export const auditLogMigration: Migration = createMigration({
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
})

/**
 * Context for audit logging - can be passed through request lifecycle
 */
export interface AuditContext {
  actor: string
  correlationId?: string
}

/**
 * Create audit context from HTTP request
 */
export function createAuditContextFromRequest(request: Request, userId?: string): AuditContext {
  const correlationId = request.headers.get('x-correlation-id') ||
    request.headers.get('x-request-id') ||
    `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

  return {
    actor: userId || 'anonymous',
    correlationId
  }
}
