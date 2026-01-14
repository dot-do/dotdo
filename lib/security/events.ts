/**
 * Security Event Logging
 *
 * Provides a security event system for logging and monitoring security-related events:
 * - Authentication failures
 * - Authorization violations
 * - Rate limit exceeded
 * - Input validation failures
 * - Suspicious activity detection
 *
 * @module lib/security/events
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Security event types
 */
export enum SecurityEventType {
  // Authentication events
  AUTH_SUCCESS = 'auth.success',
  AUTH_FAILURE = 'auth.failure',
  AUTH_LOCKOUT = 'auth.lockout',

  // Authorization events
  AUTHZ_DENIED = 'authz.denied',
  AUTHZ_ESCALATION_ATTEMPT = 'authz.escalation_attempt',

  // Rate limiting events
  RATE_LIMIT_EXCEEDED = 'rate_limit.exceeded',
  RATE_LIMIT_WARNING = 'rate_limit.warning',

  // Input validation events
  VALIDATION_FAILURE = 'validation.failure',
  SQL_INJECTION_ATTEMPT = 'validation.sql_injection',
  XSS_ATTEMPT = 'validation.xss',
  PATH_TRAVERSAL_ATTEMPT = 'validation.path_traversal',

  // CSRF events
  CSRF_INVALID = 'csrf.invalid',
  CSRF_EXPIRED = 'csrf.expired',
  CSRF_MISSING = 'csrf.missing',

  // Suspicious activity
  SUSPICIOUS_ACTIVITY = 'suspicious.activity',
  BRUTE_FORCE_DETECTED = 'suspicious.brute_force',
  ANOMALY_DETECTED = 'suspicious.anomaly',

  // Header/Request events
  HEADER_INJECTION_ATTEMPT = 'request.header_injection',
  OVERSIZED_REQUEST = 'request.oversized',
  MALFORMED_REQUEST = 'request.malformed',
}

/**
 * Security event severity levels
 */
export enum SecurityEventSeverity {
  /** Informational - routine security events */
  INFO = 'info',
  /** Warning - potential security concern */
  WARNING = 'warning',
  /** Error - security violation */
  ERROR = 'error',
  /** Critical - serious security incident */
  CRITICAL = 'critical',
}

/**
 * A security event
 */
export interface SecurityEvent {
  /** Event type */
  type: SecurityEventType
  /** Event timestamp */
  timestamp: number
  /** Event severity */
  severity?: SecurityEventSeverity
  /** Source IP address */
  ip?: string
  /** User identifier */
  userId?: string
  /** Request path */
  path?: string
  /** HTTP method */
  method?: string
  /** Additional event details */
  details?: Record<string, unknown>
  /** Correlation ID for tracing */
  correlationId?: string
}

/**
 * Security event listener function
 */
export type SecurityEventListener = (event: SecurityEvent) => void | Promise<void>

/**
 * Aggregated security metrics
 */
export interface SecurityMetrics {
  /** Total events by type */
  eventCounts: Record<SecurityEventType, number>
  /** Events by severity */
  severityCounts: Record<SecurityEventSeverity, number>
  /** Top offending IPs */
  topIps: Array<{ ip: string; count: number }>
  /** Rate limit metrics */
  rateLimits: {
    exceeded: number
    blocked: number
  }
  /** Time window for metrics */
  window: {
    start: number
    end: number
  }
}

// ============================================================================
// SECURITY EVENT EMITTER
// ============================================================================

/**
 * Security Event Emitter
 *
 * Provides a pub/sub system for security events with:
 * - Type-safe event handling
 * - Async listener support
 * - Event aggregation and metrics
 *
 * @example
 * ```typescript
 * const emitter = new SecurityEventEmitter()
 *
 * emitter.on(SecurityEventType.AUTH_FAILURE, (event) => {
 *   console.log(`Auth failure from ${event.ip}`)
 * })
 *
 * emitter.emit({
 *   type: SecurityEventType.AUTH_FAILURE,
 *   timestamp: Date.now(),
 *   ip: '192.168.1.1',
 *   details: { reason: 'invalid_password' }
 * })
 * ```
 */
export class SecurityEventEmitter {
  private listeners: Map<SecurityEventType | '*', Set<SecurityEventListener>> = new Map()
  private events: SecurityEvent[] = []
  private maxEvents: number = 10000
  private ipCounts: Map<string, number> = new Map()

  constructor(options?: { maxEvents?: number }) {
    this.maxEvents = options?.maxEvents ?? 10000
  }

  /**
   * Subscribe to a specific event type
   */
  on(type: SecurityEventType | '*', listener: SecurityEventListener): () => void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)

    // Return unsubscribe function
    return () => {
      listeners.delete(listener)
    }
  }

  /**
   * Subscribe to all events
   */
  onAll(listener: SecurityEventListener): () => void {
    return this.on('*', listener)
  }

  /**
   * Emit a security event
   */
  async emit(event: SecurityEvent): Promise<void> {
    // Add default severity if not provided
    if (!event.severity) {
      event.severity = this.getSeverityForType(event.type)
    }

    // Store event
    this.events.push(event)
    if (this.events.length > this.maxEvents) {
      this.events.shift()
    }

    // Track IP counts
    if (event.ip) {
      this.ipCounts.set(event.ip, (this.ipCounts.get(event.ip) ?? 0) + 1)
    }

    // Notify type-specific listeners
    const typeListeners = this.listeners.get(event.type)
    if (typeListeners) {
      for (const listener of typeListeners) {
        try {
          await listener(event)
        } catch (error) {
          console.error(`Security event listener error:`, error)
        }
      }
    }

    // Notify global listeners
    const globalListeners = this.listeners.get('*')
    if (globalListeners) {
      for (const listener of globalListeners) {
        try {
          await listener(event)
        } catch (error) {
          console.error(`Security event listener error:`, error)
        }
      }
    }
  }

  /**
   * Get aggregated metrics
   */
  getMetrics(windowMs: number = 60 * 60 * 1000): SecurityMetrics {
    const now = Date.now()
    const windowStart = now - windowMs
    const windowEvents = this.events.filter(e => e.timestamp >= windowStart)

    // Count by type
    const eventCounts = {} as Record<SecurityEventType, number>
    for (const type of Object.values(SecurityEventType)) {
      eventCounts[type] = 0
    }

    // Count by severity
    const severityCounts = {
      [SecurityEventSeverity.INFO]: 0,
      [SecurityEventSeverity.WARNING]: 0,
      [SecurityEventSeverity.ERROR]: 0,
      [SecurityEventSeverity.CRITICAL]: 0,
    }

    let rateLimitExceeded = 0

    for (const event of windowEvents) {
      eventCounts[event.type]++
      if (event.severity) {
        severityCounts[event.severity]++
      }
      if (event.type === SecurityEventType.RATE_LIMIT_EXCEEDED) {
        rateLimitExceeded++
      }
    }

    // Get top IPs
    const ipEntries = Array.from(this.ipCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([ip, count]) => ({ ip, count }))

    return {
      eventCounts,
      severityCounts,
      topIps: ipEntries,
      rateLimits: {
        exceeded: rateLimitExceeded,
        blocked: rateLimitExceeded, // Same for now
      },
      window: {
        start: windowStart,
        end: now,
      },
    }
  }

  /**
   * Get recent events
   */
  getEvents(options?: {
    type?: SecurityEventType
    severity?: SecurityEventSeverity
    limit?: number
  }): SecurityEvent[] {
    let filtered = this.events

    if (options?.type) {
      filtered = filtered.filter(e => e.type === options.type)
    }

    if (options?.severity) {
      filtered = filtered.filter(e => e.severity === options.severity)
    }

    if (options?.limit) {
      filtered = filtered.slice(-options.limit)
    }

    return filtered
  }

  /**
   * Clear all events
   */
  clear(): void {
    this.events = []
    this.ipCounts.clear()
  }

  /**
   * Get default severity for event type
   */
  private getSeverityForType(type: SecurityEventType): SecurityEventSeverity {
    // Critical events
    if ([
      SecurityEventType.BRUTE_FORCE_DETECTED,
      SecurityEventType.AUTH_LOCKOUT,
      SecurityEventType.AUTHZ_ESCALATION_ATTEMPT,
    ].includes(type)) {
      return SecurityEventSeverity.CRITICAL
    }

    // Error events
    if ([
      SecurityEventType.AUTH_FAILURE,
      SecurityEventType.AUTHZ_DENIED,
      SecurityEventType.SQL_INJECTION_ATTEMPT,
      SecurityEventType.XSS_ATTEMPT,
      SecurityEventType.PATH_TRAVERSAL_ATTEMPT,
      SecurityEventType.HEADER_INJECTION_ATTEMPT,
      SecurityEventType.CSRF_INVALID,
    ].includes(type)) {
      return SecurityEventSeverity.ERROR
    }

    // Warning events
    if ([
      SecurityEventType.RATE_LIMIT_EXCEEDED,
      SecurityEventType.RATE_LIMIT_WARNING,
      SecurityEventType.SUSPICIOUS_ACTIVITY,
      SecurityEventType.CSRF_EXPIRED,
      SecurityEventType.OVERSIZED_REQUEST,
    ].includes(type)) {
      return SecurityEventSeverity.WARNING
    }

    // Default to info
    return SecurityEventSeverity.INFO
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

/**
 * Global security event emitter instance
 */
export const securityEvents = new SecurityEventEmitter()
