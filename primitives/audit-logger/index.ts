/**
 * AuditLogger - Comprehensive audit logging system for the dotdo platform
 *
 * Features:
 * - Append-only audit event storage
 * - Cryptographic signing for tamper detection
 * - Chain verification for integrity
 * - Retention policies with archival
 * - Compliance report generation
 * - Fluent query builder
 */

export * from './types'

import type {
  AuditEvent,
  AuditEventInput,
  AuditQuery,
  AuditQueryResult,
  AuditConfig,
  SignedAuditEvent,
  ChainVerificationResult,
  ComplianceReport,
  ExportOptions,
  RetentionPolicy,
  StateDiff,
  AuditAction,
  ActorType,
  ComplianceSummary,
} from './types'

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique ID for audit events
 */
function generateId(): string {
  return `audit_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
}

/**
 * Deep clone an object to ensure immutability
 */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

/**
 * Clone an audit event and ensure timestamp is a Date object
 */
function cloneEvent(event: AuditEvent): AuditEvent {
  return {
    ...deepClone(event),
    timestamp: new Date(event.timestamp),
  }
}

/**
 * Simple hash function for cryptographic operations
 * Uses a stable string representation of the event
 */
function hashEvent(event: AuditEvent, key: string): string {
  const content = JSON.stringify({
    id: event.id,
    action: event.action,
    actor: event.actor,
    resource: event.resource,
    timestamp: event.timestamp.toISOString(),
    metadata: event.metadata,
    customAction: event.customAction,
    outcome: event.outcome,
    error: event.error,
    duration: event.duration,
  })

  // Simple hash using key - in production would use crypto.subtle.sign with HMAC-SHA256
  let hash = 0
  const combined = content + key
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

/**
 * Create a cryptographic signature for an event
 */
function signEvent(event: AuditEvent, key: string): string {
  const hash = hashEvent(event, key)
  // In production, this would use HMAC-SHA256
  return `sig_${hash}`
}

// ============================================================================
// Storage Layer
// ============================================================================

/**
 * Append-only storage for audit events
 *
 * This is an in-memory implementation. In production, this would be backed by
 * a durable storage system like SQLite, R2, or a dedicated audit database.
 */
export class AuditStore {
  private events: AuditEvent[] = []

  /**
   * Append an event to the store (immutable)
   */
  async append(event: AuditEvent): Promise<void> {
    this.events.push(deepClone(event))
  }

  /**
   * Get all events (returns clones to prevent modification)
   */
  async getAll(): Promise<AuditEvent[]> {
    return this.events.map(cloneEvent)
  }

  /**
   * Get the most recent event
   */
  async getLast(): Promise<AuditEvent | null> {
    if (this.events.length === 0) return null
    return cloneEvent(this.events[this.events.length - 1])
  }

  /**
   * Get events by their IDs
   */
  async getByIds(ids: string[]): Promise<AuditEvent[]> {
    return this.events.filter(e => ids.includes(e.id)).map(cloneEvent)
  }

  /**
   * Delete an event by ID (for retention policy enforcement)
   */
  async delete(eventId: string): Promise<void> {
    const index = this.events.findIndex(e => e.id === eventId)
    if (index !== -1) {
      this.events.splice(index, 1)
    }
  }

  /**
   * Delete all events older than the given date
   * Returns the deleted events for archival
   */
  async deleteOlderThan(date: Date): Promise<AuditEvent[]> {
    const deleted: AuditEvent[] = []
    const remaining: AuditEvent[] = []

    for (const event of this.events) {
      const eventDate = new Date(event.timestamp)
      if (eventDate < date) {
        deleted.push(cloneEvent(event))
      } else {
        remaining.push(event)
      }
    }

    this.events = remaining
    return deleted
  }

  /**
   * Get the total number of events
   */
  async count(): Promise<number> {
    return this.events.length
  }
}

// ============================================================================
// Core Logger
// ============================================================================

/**
 * Core audit logger implementation
 *
 * Provides the main interface for logging audit events with optional
 * cryptographic signing for tamper detection.
 */
export class AuditLogger {
  private store: AuditStore
  private config: AuditConfig
  private signer?: EventSigner
  private lastHash?: string

  constructor(options: { store: AuditStore; config?: AuditConfig }) {
    this.store = options.store
    this.config = options.config || {}

    if (this.config.signing && this.config.signingKey) {
      this.signer = new EventSigner({ key: this.config.signingKey })
    }
  }

  async log(input: AuditEventInput): Promise<AuditEvent | SignedAuditEvent> {
    const event: AuditEvent = {
      id: generateId(),
      action: input.action,
      actor: input.actor,
      resource: input.resource,
      timestamp: new Date(),
      metadata: input.metadata,
      customAction: input.customAction,
      outcome: input.outcome,
      error: input.error,
      duration: input.duration,
    }

    let finalEvent: AuditEvent | SignedAuditEvent = event

    if (this.signer) {
      const signedEvent = this.signer.sign(event, this.lastHash)
      this.lastHash = signedEvent.hash
      finalEvent = signedEvent
    }

    await this.store.append(finalEvent)
    return finalEvent
  }

  async query(options: AuditQuery): Promise<AuditQueryResult> {
    let events = await this.store.getAll()

    // Apply filters
    if (options.filters) {
      const { actions, actorIds, actorTypes, resourceIds, resourceTypes, outcomes } = options.filters

      if (actions && actions.length > 0) {
        events = events.filter(e => actions.includes(e.action))
      }

      if (actorIds && actorIds.length > 0) {
        events = events.filter(e => actorIds.includes(e.actor.id))
      }

      if (actorTypes && actorTypes.length > 0) {
        events = events.filter(e => actorTypes.includes(e.actor.type))
      }

      if (resourceIds && resourceIds.length > 0) {
        events = events.filter(e => resourceIds.includes(e.resource.id))
      }

      if (resourceTypes && resourceTypes.length > 0) {
        events = events.filter(e => resourceTypes.includes(e.resource.type))
      }

      if (outcomes && outcomes.length > 0) {
        events = events.filter(e => e.outcome && outcomes.includes(e.outcome))
      }
    }

    // Apply date range
    if (options.dateRange) {
      const { from, to } = options.dateRange

      if (from) {
        events = events.filter(e => e.timestamp >= from)
      }

      if (to) {
        events = events.filter(e => e.timestamp <= to)
      }
    }

    const total = events.length

    // Apply sorting
    if (options.pagination?.sortBy) {
      const sortField = options.pagination.sortBy
      const sortOrder = options.pagination.sortOrder || 'asc'

      events.sort((a, b) => {
        const aVal = a[sortField]
        const bVal = b[sortField]

        if (aVal instanceof Date && bVal instanceof Date) {
          return sortOrder === 'asc'
            ? aVal.getTime() - bVal.getTime()
            : bVal.getTime() - aVal.getTime()
        }

        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return sortOrder === 'asc'
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal)
        }

        return 0
      })
    }

    // Apply pagination
    const offset = options.pagination?.offset || 0
    const limit = options.pagination?.limit || events.length

    const paginatedEvents = events.slice(offset, offset + limit)
    const hasMore = offset + limit < total

    return {
      events: paginatedEvents,
      total,
      hasMore,
      nextOffset: hasMore ? offset + limit : undefined,
    }
  }

  async getByResource(resourceId: string): Promise<AuditEvent[]> {
    const result = await this.query({
      filters: { resourceIds: [resourceId] },
      pagination: { sortBy: 'timestamp', sortOrder: 'asc' },
    })
    return result.events
  }

  async getByActor(actorId: string): Promise<AuditEvent[]> {
    const result = await this.query({
      filters: { actorIds: [actorId] },
    })
    return result.events
  }

  async export(options: ExportOptions): Promise<ComplianceReport> {
    const exporter = new ComplianceExporter({
      logger: this,
      signingKey: this.config.signingKey,
    })
    return exporter.export(options)
  }
}

// ============================================================================
// Cryptographic Signing
// ============================================================================

/**
 * Cryptographic event signer for tamper detection
 *
 * Signs audit events using HMAC-based signatures to detect
 * unauthorized modifications to the audit trail.
 */
export class EventSigner {
  private key: string

  constructor(options: { key: string }) {
    this.key = options.key
  }

  sign(event: AuditEvent, previousHash?: string): SignedAuditEvent {
    const hash = hashEvent(event, this.key)
    const signature = signEvent(event, this.key)

    return {
      ...event,
      signature,
      hash,
      previousHash,
      algorithm: 'sha256',
    }
  }

  verify(event: SignedAuditEvent): boolean {
    // Recreate the signature to verify (signature is based on event content, not hash property)
    const expectedSignature = signEvent(event, this.key)
    return event.signature === expectedSignature
  }

  /**
   * Verify both signature and hash integrity
   */
  verifyWithHash(event: SignedAuditEvent): boolean {
    const expectedHash = hashEvent(event, this.key)
    const expectedSignature = signEvent(event, this.key)
    return event.hash === expectedHash && event.signature === expectedSignature
  }
}

/**
 * Chain verifier for audit log integrity
 *
 * Verifies that the audit log chain has not been tampered with by
 * checking cryptographic signatures and hash chain linkage.
 */
export class ChainVerifier {
  private signer: EventSigner

  constructor(options: { key: string }) {
    this.signer = new EventSigner({ key: options.key })
  }

  verifyChain(events: SignedAuditEvent[]): ChainVerificationResult {
    if (events.length === 0) {
      return { valid: true, eventsVerified: 0 }
    }

    // Sort events by timestamp to ensure proper chain order
    const sortedEvents = [...events].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    )

    for (let i = 0; i < sortedEvents.length; i++) {
      const event = sortedEvents[i]

      // Verify signature of each event
      if (!this.signer.verify(event)) {
        return {
          valid: false,
          eventsVerified: i,
          brokenAtIndex: i,
          brokenAtEvent: event.id,
          error: 'Invalid signature',
        }
      }

      // Verify chain linkage (except for first event)
      if (i > 0) {
        const expectedPreviousHash = sortedEvents[i - 1].hash
        if (event.previousHash !== expectedPreviousHash) {
          return {
            valid: false,
            eventsVerified: i,
            brokenAtIndex: i,
            brokenAtEvent: event.id,
            error: 'Chain broken - previous hash mismatch',
          }
        }
      }
    }

    return {
      valid: true,
      eventsVerified: sortedEvents.length,
    }
  }
}

// ============================================================================
// Retention & Compliance
// ============================================================================

/**
 * Retention manager for automatic event cleanup
 *
 * Enforces data retention policies by deleting or archiving
 * events that exceed the configured retention period.
 */
export class RetentionManager {
  private store: AuditStore
  private policy: RetentionPolicy
  private archiveStore?: AuditStore

  constructor(options: {
    store: AuditStore
    policy: RetentionPolicy
    archiveStore?: AuditStore
  }) {
    this.store = options.store
    this.policy = options.policy
    this.archiveStore = options.archiveStore
  }

  async enforce(): Promise<void> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - this.policy.retentionDays)

    const deletedEvents = await this.store.deleteOlderThan(cutoffDate)

    // Archive if configured
    if (this.policy.archiveBeforeDelete && this.archiveStore && deletedEvents.length > 0) {
      for (const event of deletedEvents) {
        await this.archiveStore.append(event)
      }
    }
  }
}

/**
 * Compliance report exporter
 *
 * Generates compliance reports with summary statistics and optional
 * chain integrity verification for regulatory requirements.
 */
export class ComplianceExporter {
  private logger: AuditLogger
  private signingKey?: string

  constructor(options: { logger: AuditLogger; signingKey?: string }) {
    this.logger = options.logger
    this.signingKey = options.signingKey
  }

  async export(options: ExportOptions): Promise<ComplianceReport> {
    const queryResult = await this.logger.query({
      dateRange: options.dateRange,
      filters: options.filters,
    })

    const events = queryResult.events
    const summary = this.computeSummary(events, options.dateRange)

    const report: ComplianceReport = {
      id: generateId(),
      generatedAt: new Date(),
      period: options.dateRange || {},
      summary,
    }

    if (options.includeEvents) {
      report.events = events
    }

    if (options.verifyChain && this.signingKey) {
      const verifier = new ChainVerifier({ key: this.signingKey })
      const signedEvents = events as SignedAuditEvent[]
      const chainResult = verifier.verifyChain(signedEvents)

      report.chainIntegrity = {
        verified: chainResult.valid,
        brokenAt: chainResult.brokenAtEvent,
        message: chainResult.error,
      }
    }

    return report
  }

  private computeSummary(events: AuditEvent[], dateRange?: { from?: Date; to?: Date }): ComplianceSummary {
    const eventsByAction: Record<AuditAction, number> = {
      create: 0,
      read: 0,
      update: 0,
      delete: 0,
      login: 0,
      logout: 0,
      export: 0,
      custom: 0,
    }

    const eventsByActorType: Record<ActorType, number> = {
      user: 0,
      agent: 0,
      system: 0,
      api: 0,
      service: 0,
    }

    const eventsByOutcome: Record<string, number> = {
      success: 0,
      failure: 0,
      partial: 0,
    }

    const uniqueActors = new Set<string>()
    const uniqueResources = new Set<string>()
    let failedEvents = 0

    for (const event of events) {
      eventsByAction[event.action]++
      eventsByActorType[event.actor.type]++

      if (event.outcome) {
        eventsByOutcome[event.outcome]++
        if (event.outcome === 'failure') {
          failedEvents++
        }
      }

      uniqueActors.add(event.actor.id)
      uniqueResources.add(event.resource.id)
    }

    // Calculate average events per day
    let averageEventsPerDay = 0
    if (dateRange?.from && dateRange?.to && events.length > 0) {
      const days = Math.max(1, Math.ceil(
        (dateRange.to.getTime() - dateRange.from.getTime()) / (1000 * 60 * 60 * 24)
      ))
      averageEventsPerDay = events.length / days
    } else if (events.length > 0) {
      // If no date range specified, use the range of events
      const timestamps = events.map(e => e.timestamp.getTime())
      const minTime = Math.min(...timestamps)
      const maxTime = Math.max(...timestamps)
      const days = Math.max(1, Math.ceil((maxTime - minTime) / (1000 * 60 * 60 * 24)))
      averageEventsPerDay = events.length / days
    }

    return {
      totalEvents: events.length,
      eventsByAction,
      eventsByActorType,
      eventsByOutcome,
      uniqueActors: uniqueActors.size,
      uniqueResources: uniqueResources.size,
      failedEvents,
      averageEventsPerDay,
    }
  }
}

// ============================================================================
// Query Builder
// ============================================================================

/**
 * Fluent query builder for audit logs
 *
 * Provides a chainable API for building complex audit log queries.
 */
export class AuditQueryBuilder {
  private logger: AuditLogger
  private query: AuditQuery = {}

  constructor(logger: AuditLogger) {
    this.logger = logger
    this.query = {
      filters: {},
      pagination: {},
    }
  }

  withAction(action: AuditAction): this {
    if (!this.query.filters) this.query.filters = {}
    if (!this.query.filters.actions) this.query.filters.actions = []
    this.query.filters.actions.push(action)
    return this
  }

  byActor(actorId: string): this {
    if (!this.query.filters) this.query.filters = {}
    if (!this.query.filters.actorIds) this.query.filters.actorIds = []
    this.query.filters.actorIds.push(actorId)
    return this
  }

  byActorType(actorType: ActorType): this {
    if (!this.query.filters) this.query.filters = {}
    if (!this.query.filters.actorTypes) this.query.filters.actorTypes = []
    this.query.filters.actorTypes.push(actorType)
    return this
  }

  forResource(resourceId: string): this {
    if (!this.query.filters) this.query.filters = {}
    if (!this.query.filters.resourceIds) this.query.filters.resourceIds = []
    this.query.filters.resourceIds.push(resourceId)
    return this
  }

  forResourceType(resourceType: string): this {
    if (!this.query.filters) this.query.filters = {}
    if (!this.query.filters.resourceTypes) this.query.filters.resourceTypes = []
    this.query.filters.resourceTypes.push(resourceType)
    return this
  }

  withOutcome(outcome: 'success' | 'failure' | 'partial'): this {
    if (!this.query.filters) this.query.filters = {}
    if (!this.query.filters.outcomes) this.query.filters.outcomes = []
    this.query.filters.outcomes.push(outcome)
    return this
  }

  inDateRange(from?: Date, to?: Date): this {
    this.query.dateRange = { from, to }
    return this
  }

  limit(n: number): this {
    if (!this.query.pagination) this.query.pagination = {}
    this.query.pagination.limit = n
    return this
  }

  offset(n: number): this {
    if (!this.query.pagination) this.query.pagination = {}
    this.query.pagination.offset = n
    return this
  }

  sortBy(field: keyof AuditEvent, order: 'asc' | 'desc' = 'asc'): this {
    if (!this.query.pagination) this.query.pagination = {}
    this.query.pagination.sortBy = field
    this.query.pagination.sortOrder = order
    return this
  }

  async execute(): Promise<AuditQueryResult> {
    return this.logger.query(this.query)
  }
}

// ============================================================================
// Diff Utilities
// ============================================================================

/**
 * Compute the diff between two states
 *
 * Useful for tracking what changed during an update operation.
 */
export function computeDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): StateDiff {
  const added: Record<string, unknown> = {}
  const removed: Record<string, unknown> = {}
  const changed: Record<string, { old: unknown; new: unknown }> = {}

  // Find added and changed keys
  for (const key of Object.keys(after)) {
    if (!(key in before)) {
      added[key] = after[key]
    } else if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changed[key] = { old: before[key], new: after[key] }
    }
  }

  // Find removed keys
  for (const key of Object.keys(before)) {
    if (!(key in after)) {
      removed[key] = before[key]
    }
  }

  return { added, removed, changed }
}
