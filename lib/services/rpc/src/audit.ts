/**
 * RPC.do Gateway Audit Logging
 *
 * Comprehensive audit logging for compliance and security:
 * - Request/response logging
 * - Authentication events
 * - Resource access tracking
 * - Error and security events
 *
 * @module services/rpc/audit
 */

import type { Context, MiddlewareHandler, Next } from 'hono'
import type { AuditLogEntry, AuthContext, GatewayRequest, GatewayResponse } from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Audit log event types
 */
export type AuditEventType =
  | 'request' // API request
  | 'auth.success' // Successful authentication
  | 'auth.failure' // Failed authentication
  | 'auth.token_expired' // Token expired
  | 'access.granted' // Resource access granted
  | 'access.denied' // Resource access denied
  | 'rate_limit' // Rate limit hit
  | 'error' // Error occurred
  | 'security' // Security-related event

/**
 * Audit log configuration
 */
export interface AuditConfig {
  /** Whether audit logging is enabled */
  enabled: boolean
  /** Log level (debug, info, warn, error) */
  level: 'debug' | 'info' | 'warn' | 'error'
  /** Whether to include request bodies */
  includeRequestBody: boolean
  /** Whether to include response bodies */
  includeResponseBody: boolean
  /** Maximum body size to log (bytes) */
  maxBodySize: number
  /** Paths to exclude from logging */
  excludePaths: string[]
  /** Fields to redact from logs */
  redactFields: string[]
  /** Whether to log to console */
  consoleOutput: boolean
}

/**
 * Audit log sink interface
 */
export interface AuditLogSink {
  /** Write audit log entries */
  write(entries: AuditLogEntry[]): Promise<void>
  /** Query audit logs (optional) */
  query?(filter: AuditLogFilter): Promise<AuditLogEntry[]>
}

/**
 * Audit log filter for queries
 */
export interface AuditLogFilter {
  /** Filter by tenant ID */
  tenantId?: string
  /** Filter by user ID */
  userId?: string
  /** Filter by action */
  action?: string
  /** Filter by service */
  service?: string
  /** Filter by status */
  status?: 'success' | 'error'
  /** Start time */
  from?: Date
  /** End time */
  to?: Date
  /** Maximum results */
  limit?: number
  /** Offset for pagination */
  offset?: number
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: AuditConfig = {
  enabled: true,
  level: 'info',
  includeRequestBody: false,
  includeResponseBody: false,
  maxBodySize: 10240, // 10KB
  excludePaths: ['/health', '/ready', '/metrics'],
  redactFields: ['password', 'secret', 'token', 'api_key', 'apiKey', 'authorization'],
  consoleOutput: false,
}

// ============================================================================
// Audit Log Sinks
// ============================================================================

/**
 * In-memory audit log sink for development/testing
 */
export class InMemoryAuditSink implements AuditLogSink {
  private entries: AuditLogEntry[] = []

  async write(entries: AuditLogEntry[]): Promise<void> {
    this.entries.push(...entries)
  }

  async query(filter: AuditLogFilter): Promise<AuditLogEntry[]> {
    let filtered = [...this.entries]

    if (filter.tenantId) {
      filtered = filtered.filter((e) => e.tenantId === filter.tenantId)
    }
    if (filter.userId) {
      filtered = filtered.filter((e) => e.userId === filter.userId)
    }
    if (filter.action) {
      filtered = filtered.filter((e) => e.action === filter.action)
    }
    if (filter.service) {
      filtered = filtered.filter((e) => e.service === filter.service)
    }
    if (filter.status) {
      filtered = filtered.filter((e) => e.status === filter.status)
    }
    if (filter.from) {
      filtered = filtered.filter((e) => e.timestamp >= filter.from!)
    }
    if (filter.to) {
      filtered = filtered.filter((e) => e.timestamp <= filter.to!)
    }

    // Sort by timestamp descending
    filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

    // Apply pagination
    const offset = filter.offset || 0
    const limit = filter.limit || 100
    return filtered.slice(offset, offset + limit)
  }

  /**
   * Get all entries
   */
  getAll(): AuditLogEntry[] {
    return [...this.entries]
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries = []
  }
}

/**
 * Console audit log sink
 */
export class ConsoleAuditSink implements AuditLogSink {
  async write(entries: AuditLogEntry[]): Promise<void> {
    for (const entry of entries) {
      const logLine = JSON.stringify({
        timestamp: entry.timestamp.toISOString(),
        action: entry.action,
        tenantId: entry.tenantId,
        userId: entry.userId,
        service: entry.service,
        method: entry.method,
        status: entry.status,
        durationMs: entry.durationMs,
        requestId: entry.requestId,
      })

      if (entry.status === 'error') {
        console.error(`[AUDIT] ${logLine}`)
      } else {
        console.log(`[AUDIT] ${logLine}`)
      }
    }
  }
}

/**
 * KV-backed audit log sink
 */
export class KVAuditSink implements AuditLogSink {
  constructor(private kv: KVNamespace) {}

  async write(entries: AuditLogEntry[]): Promise<void> {
    // Write entries to KV with time-based keys
    for (const entry of entries) {
      const key = `audit:${entry.tenantId}:${entry.timestamp.getTime()}:${entry.id}`
      await this.kv.put(key, JSON.stringify(entry), {
        expirationTtl: 90 * 24 * 60 * 60, // 90 days retention
      })
    }
  }

  async query(filter: AuditLogFilter): Promise<AuditLogEntry[]> {
    // KV list with prefix filtering
    const prefix = filter.tenantId ? `audit:${filter.tenantId}:` : 'audit:'
    const list = await this.kv.list({ prefix, limit: filter.limit || 100 })

    const entries: AuditLogEntry[] = []
    for (const key of list.keys) {
      const data = await this.kv.get(key.name, 'json')
      if (data) {
        entries.push(data as AuditLogEntry)
      }
    }

    return entries
  }
}

/**
 * Queue-backed audit log sink for reliable delivery
 */
export class QueueAuditSink implements AuditLogSink {
  constructor(private queue: { send: (body: unknown) => Promise<void> }) {}

  async write(entries: AuditLogEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.queue.send({
        type: 'audit_log',
        entry,
      })
    }
  }
}

/**
 * Composite sink that writes to multiple sinks
 */
export class CompositeAuditSink implements AuditLogSink {
  constructor(private sinks: AuditLogSink[]) {}

  async write(entries: AuditLogEntry[]): Promise<void> {
    await Promise.all(this.sinks.map((sink) => sink.write(entries)))
  }

  async query(filter: AuditLogFilter): Promise<AuditLogEntry[]> {
    // Query from first sink that supports it
    for (const sink of this.sinks) {
      if (sink.query) {
        return sink.query(filter)
      }
    }
    return []
  }
}

// ============================================================================
// Audit Logger
// ============================================================================

/**
 * Audit logger service
 */
export class AuditLogger {
  private config: AuditConfig
  private sink: AuditLogSink
  private buffer: AuditLogEntry[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(sink: AuditLogSink, config?: Partial<AuditConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.sink = sink
  }

  /**
   * Log an audit entry
   */
  async log(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): Promise<void> {
    if (!this.config.enabled) return

    const fullEntry: AuditLogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      ...entry,
    }

    // Redact sensitive fields
    if (fullEntry.context) {
      fullEntry.context = this.redactSensitiveFields(fullEntry.context)
    }

    // Console output if enabled
    if (this.config.consoleOutput) {
      this.logToConsole(fullEntry)
    }

    // Buffer entry
    this.buffer.push(fullEntry)

    // Flush if buffer is large enough
    if (this.buffer.length >= 100) {
      await this.flush()
    } else if (!this.flushTimer) {
      // Schedule flush after 5 seconds
      this.flushTimer = setTimeout(() => this.flush(), 5000)
    }
  }

  /**
   * Log a request event
   */
  async logRequest(
    request: GatewayRequest,
    response: GatewayResponse,
    auth?: AuthContext,
    context?: {
      ipHash?: string
      userAgent?: string
      durationMs: number
    }
  ): Promise<void> {
    await this.log({
      tenantId: auth?.tenantId || 'anonymous',
      userId: auth?.userId,
      agentId: auth?.agentId,
      action: `${request.service}.${request.method}`,
      resourceType: request.service,
      service: request.service,
      method: request.method,
      requestId: request.id,
      status: response.status,
      errorCode: response.error?.code,
      durationMs: context?.durationMs || response.meta?.durationMs || 0,
      ipHash: context?.ipHash,
      userAgent: context?.userAgent,
      context: this.config.includeRequestBody
        ? { request: request.params, response: response.result }
        : undefined,
    })
  }

  /**
   * Log an authentication event
   */
  async logAuth(
    type: 'success' | 'failure' | 'token_expired',
    details: {
      tenantId?: string
      userId?: string
      method: 'jwt' | 'api_key' | 'session'
      ipHash?: string
      userAgent?: string
      reason?: string
    }
  ): Promise<void> {
    await this.log({
      tenantId: details.tenantId || 'unknown',
      userId: details.userId,
      action: `auth.${type}`,
      resourceType: 'auth',
      service: 'gateway',
      method: details.method,
      requestId: crypto.randomUUID(),
      status: type === 'success' ? 'success' : 'error',
      errorCode: type !== 'success' ? `AUTH_${type.toUpperCase()}` : undefined,
      durationMs: 0,
      ipHash: details.ipHash,
      userAgent: details.userAgent,
      context: details.reason ? { reason: details.reason } : undefined,
    })
  }

  /**
   * Log an access control event
   */
  async logAccess(
    granted: boolean,
    details: {
      tenantId: string
      userId?: string
      resource: string
      resourceId?: string
      permission?: string
      ipHash?: string
    }
  ): Promise<void> {
    await this.log({
      tenantId: details.tenantId,
      userId: details.userId,
      action: granted ? 'access.granted' : 'access.denied',
      resourceType: details.resource,
      resourceId: details.resourceId,
      service: 'gateway',
      method: 'access_check',
      requestId: crypto.randomUUID(),
      status: granted ? 'success' : 'error',
      errorCode: granted ? undefined : 'ACCESS_DENIED',
      durationMs: 0,
      ipHash: details.ipHash,
      context: details.permission ? { permission: details.permission } : undefined,
    })
  }

  /**
   * Log a rate limit event
   */
  async logRateLimit(details: {
    tenantId: string
    userId?: string
    limitType: string
    service?: string
    ipHash?: string
  }): Promise<void> {
    await this.log({
      tenantId: details.tenantId,
      userId: details.userId,
      action: 'rate_limit',
      resourceType: 'rate_limit',
      service: details.service || 'gateway',
      method: 'rate_check',
      requestId: crypto.randomUUID(),
      status: 'error',
      errorCode: 'RATE_LIMITED',
      durationMs: 0,
      ipHash: details.ipHash,
      context: { limitType: details.limitType },
    })
  }

  /**
   * Log a security event
   */
  async logSecurity(details: {
    tenantId?: string
    userId?: string
    event: string
    severity: 'low' | 'medium' | 'high' | 'critical'
    ipHash?: string
    context?: Record<string, unknown>
  }): Promise<void> {
    await this.log({
      tenantId: details.tenantId || 'unknown',
      userId: details.userId,
      action: `security.${details.event}`,
      resourceType: 'security',
      service: 'gateway',
      method: 'security_event',
      requestId: crypto.randomUUID(),
      status: 'error',
      errorCode: `SECURITY_${details.severity.toUpperCase()}`,
      durationMs: 0,
      ipHash: details.ipHash,
      context: { ...details.context, severity: details.severity },
    })
  }

  /**
   * Flush buffered entries to sink
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    if (this.buffer.length === 0) return

    const entries = [...this.buffer]
    this.buffer = []

    try {
      await this.sink.write(entries)
    } catch (error) {
      // On error, log to console as fallback
      console.error('Failed to write audit logs:', error)
      for (const entry of entries) {
        console.error('[AUDIT FALLBACK]', JSON.stringify(entry))
      }
    }
  }

  /**
   * Query audit logs
   */
  async query(filter: AuditLogFilter): Promise<AuditLogEntry[]> {
    if (this.sink.query) {
      return this.sink.query(filter)
    }
    return []
  }

  /**
   * Redact sensitive fields from context
   */
  private redactSensitiveFields(obj: Record<string, unknown>): Record<string, unknown> {
    const redacted = { ...obj }

    for (const key of Object.keys(redacted)) {
      const lowerKey = key.toLowerCase()
      if (this.config.redactFields.some((f) => lowerKey.includes(f.toLowerCase()))) {
        redacted[key] = '[REDACTED]'
      } else if (typeof redacted[key] === 'object' && redacted[key] !== null) {
        redacted[key] = this.redactSensitiveFields(redacted[key] as Record<string, unknown>)
      }
    }

    return redacted
  }

  /**
   * Log to console
   */
  private logToConsole(entry: AuditLogEntry): void {
    const logData = {
      timestamp: entry.timestamp.toISOString(),
      action: entry.action,
      tenantId: entry.tenantId,
      userId: entry.userId,
      status: entry.status,
      durationMs: entry.durationMs,
    }

    if (entry.status === 'error') {
      console.error('[AUDIT]', JSON.stringify(logData))
    } else {
      console.log('[AUDIT]', JSON.stringify(logData))
    }
  }
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Audit middleware options
 */
export interface AuditMiddlewareOptions {
  /** Audit logger */
  logger: AuditLogger
  /** Paths to exclude */
  excludePaths?: string[]
  /** Whether to log request bodies */
  includeRequestBody?: boolean
  /** Whether to log response bodies */
  includeResponseBody?: boolean
}

/**
 * Create audit logging middleware
 */
export function auditMiddleware(options: AuditMiddlewareOptions): MiddlewareHandler {
  const { logger, excludePaths = [], includeRequestBody = false, includeResponseBody = false } =
    options

  return async (c: Context, next: Next) => {
    const path = c.req.path
    const startTime = performance.now()

    // Skip excluded paths
    if (excludePaths.some((p) => path.startsWith(p))) {
      return next()
    }

    // Get auth context
    const auth = c.get('auth') as AuthContext | undefined

    // Get request metadata
    const ipHash = await hashIp(
      c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || ''
    )
    const userAgent = c.req.header('user-agent')

    // Process request
    await next()

    // Calculate duration
    const durationMs = performance.now() - startTime

    // Get service and method from context
    const service = (c.get('service') as string) || 'unknown'
    const method = (c.get('method') as string) || c.req.method

    // Determine status
    const status = c.res.status >= 200 && c.res.status < 400 ? 'success' : 'error'

    // Log the request
    await logger.log({
      tenantId: auth?.tenantId || 'anonymous',
      userId: auth?.userId,
      agentId: auth?.agentId,
      action: `${service}.${method}`,
      resourceType: service,
      service,
      method,
      requestId: c.req.header('x-request-id') || crypto.randomUUID(),
      status,
      durationMs,
      ipHash,
      userAgent,
    })
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Hash IP address for privacy
 */
async function hashIp(ip: string): Promise<string> {
  if (!ip) return ''

  const encoder = new TextEncoder()
  const data = encoder.encode(ip)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray
    .slice(0, 8) // Only use first 8 bytes
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create audit logger with in-memory sink (for development)
 */
export function createDevAuditLogger(
  config?: Partial<AuditConfig>
): { logger: AuditLogger; sink: InMemoryAuditSink } {
  const sink = new InMemoryAuditSink()
  const logger = new AuditLogger(sink, config)
  return { logger, sink }
}

/**
 * Create audit logger with KV sink (for production)
 */
export function createKVAuditLogger(
  kv: KVNamespace,
  config?: Partial<AuditConfig>
): AuditLogger {
  const sink = new KVAuditSink(kv)
  return new AuditLogger(sink, config)
}

/**
 * Create audit logger with console output (for debugging)
 */
export function createConsoleAuditLogger(config?: Partial<AuditConfig>): AuditLogger {
  const sink = new ConsoleAuditSink()
  return new AuditLogger(sink, { ...config, consoleOutput: true })
}

/**
 * Create audit logger with multiple sinks
 */
export function createCompositeAuditLogger(
  sinks: AuditLogSink[],
  config?: Partial<AuditConfig>
): AuditLogger {
  const compositeSink = new CompositeAuditSink(sinks)
  return new AuditLogger(compositeSink, config)
}
