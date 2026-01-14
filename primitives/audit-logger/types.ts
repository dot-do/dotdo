/**
 * Audit Logger Types
 *
 * Comprehensive type definitions for audit logging in the dotdo platform.
 */

/**
 * Types of audit actions that can be logged
 */
export type AuditAction =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'login'
  | 'logout'
  | 'export'
  | 'custom'

/**
 * Actor types for audit events
 */
export type ActorType = 'user' | 'agent' | 'system' | 'api' | 'service'

/**
 * Represents the actor who performed an audited action
 */
export interface AuditActor {
  /** Type of actor */
  type: ActorType
  /** Unique identifier for the actor */
  id: string
  /** IP address of the actor (if applicable) */
  ip?: string
  /** User agent string (if applicable) */
  userAgent?: string
  /** Session identifier (if applicable) */
  session?: string
  /** Additional actor metadata */
  metadata?: Record<string, unknown>
}

/**
 * Represents the resource being acted upon
 */
export interface AuditResource {
  /** Type of resource (e.g., 'user', 'document', 'payment') */
  type: string
  /** Unique identifier for the resource */
  id: string
  /** Human-readable name for the resource */
  name?: string
  /** State before the action (for updates/deletes) */
  before?: Record<string, unknown>
  /** State after the action (for creates/updates) */
  after?: Record<string, unknown>
}

/**
 * Core audit event structure
 */
export interface AuditEvent {
  /** Unique event identifier */
  id: string
  /** Action performed */
  action: AuditAction
  /** Actor who performed the action */
  actor: AuditActor
  /** Resource acted upon */
  resource: AuditResource
  /** When the action occurred */
  timestamp: Date
  /** Additional event metadata */
  metadata?: Record<string, unknown>
  /** Custom action name (when action is 'custom') */
  customAction?: string
  /** Event outcome */
  outcome?: 'success' | 'failure' | 'partial'
  /** Error details if outcome is failure */
  error?: string
  /** Duration of the action in milliseconds */
  duration?: number
}

/**
 * Signed audit event with cryptographic proof
 */
export interface SignedAuditEvent extends AuditEvent {
  /** Cryptographic signature of the event */
  signature: string
  /** Hash of the previous event in the chain */
  previousHash?: string
  /** Hash of this event */
  hash: string
  /** Signing algorithm used */
  algorithm: string
}

/**
 * Date range for queries
 */
export interface DateRange {
  /** Start of date range (inclusive) */
  from?: Date
  /** End of date range (inclusive) */
  to?: Date
}

/**
 * Pagination options
 */
export interface Pagination {
  /** Number of results to skip */
  offset?: number
  /** Maximum number of results to return */
  limit?: number
  /** Sort field */
  sortBy?: keyof AuditEvent
  /** Sort direction */
  sortOrder?: 'asc' | 'desc'
}

/**
 * Query filters for audit events
 */
export interface AuditFilters {
  /** Filter by action types */
  actions?: AuditAction[]
  /** Filter by actor IDs */
  actorIds?: string[]
  /** Filter by actor types */
  actorTypes?: ActorType[]
  /** Filter by resource IDs */
  resourceIds?: string[]
  /** Filter by resource types */
  resourceTypes?: string[]
  /** Filter by outcome */
  outcomes?: ('success' | 'failure' | 'partial')[]
  /** Full-text search query */
  search?: string
}

/**
 * Complete query options for audit logs
 */
export interface AuditQuery {
  /** Filters to apply */
  filters?: AuditFilters
  /** Date range for the query */
  dateRange?: DateRange
  /** Pagination options */
  pagination?: Pagination
}

/**
 * Query result with pagination metadata
 */
export interface AuditQueryResult {
  /** Matching events */
  events: AuditEvent[]
  /** Total count of matching events */
  total: number
  /** Whether there are more results */
  hasMore: boolean
  /** Offset for next page */
  nextOffset?: number
}

/**
 * Retention policy configuration
 */
export interface RetentionPolicy {
  /** How long to keep events (in days) */
  retentionDays: number
  /** Whether to archive before deletion */
  archiveBeforeDelete?: boolean
  /** Archive destination */
  archiveDestination?: string
}

/**
 * Audit logger configuration
 */
export interface AuditConfig {
  /** Retention policy */
  retention?: RetentionPolicy
  /** Whether to sign events */
  signing?: boolean
  /** Signing key (for HMAC) */
  signingKey?: string
  /** Whether to encrypt sensitive data */
  encryption?: boolean
  /** Encryption key */
  encryptionKey?: string
  /** Fields to encrypt */
  encryptFields?: string[]
  /** Whether to enable chain verification */
  chainVerification?: boolean
}

/**
 * Summary statistics for compliance reports
 */
export interface ComplianceSummary {
  /** Total events in the period */
  totalEvents: number
  /** Events by action type */
  eventsByAction: Record<AuditAction, number>
  /** Events by actor type */
  eventsByActorType: Record<ActorType, number>
  /** Events by outcome */
  eventsByOutcome: Record<string, number>
  /** Unique actors */
  uniqueActors: number
  /** Unique resources */
  uniqueResources: number
  /** Failed events */
  failedEvents: number
  /** Average events per day */
  averageEventsPerDay: number
}

/**
 * Compliance report structure
 */
export interface ComplianceReport {
  /** Report identifier */
  id: string
  /** Report generation timestamp */
  generatedAt: Date
  /** Period covered by the report */
  period: DateRange
  /** Summary statistics */
  summary: ComplianceSummary
  /** Detailed events (optional, based on export options) */
  events?: AuditEvent[]
  /** Chain integrity status */
  chainIntegrity?: {
    verified: boolean
    brokenAt?: string
    message?: string
  }
}

/**
 * Export options for compliance reports
 */
export interface ExportOptions {
  /** Format for export */
  format?: 'json' | 'csv' | 'pdf'
  /** Whether to include detailed events */
  includeEvents?: boolean
  /** Whether to verify chain integrity */
  verifyChain?: boolean
  /** Date range for export */
  dateRange?: DateRange
  /** Additional filters */
  filters?: AuditFilters
}

/**
 * Verification result for chain integrity
 */
export interface ChainVerificationResult {
  /** Whether the chain is valid */
  valid: boolean
  /** Number of events verified */
  eventsVerified: number
  /** Index where chain broke (if invalid) */
  brokenAtIndex?: number
  /** Event ID where chain broke (if invalid) */
  brokenAtEvent?: string
  /** Error message (if invalid) */
  error?: string
}

/**
 * Input for creating a new audit event
 */
export interface AuditEventInput {
  /** Action performed */
  action: AuditAction
  /** Actor who performed the action */
  actor: AuditActor
  /** Resource acted upon */
  resource: AuditResource
  /** Additional event metadata */
  metadata?: Record<string, unknown>
  /** Custom action name (when action is 'custom') */
  customAction?: string
  /** Event outcome */
  outcome?: 'success' | 'failure' | 'partial'
  /** Error details if outcome is failure */
  error?: string
  /** Duration of the action in milliseconds */
  duration?: number
}

/**
 * Diff between two states
 */
export interface StateDiff {
  /** Fields that were added */
  added: Record<string, unknown>
  /** Fields that were removed */
  removed: Record<string, unknown>
  /** Fields that were changed (old -> new) */
  changed: Record<string, { old: unknown; new: unknown }>
}
