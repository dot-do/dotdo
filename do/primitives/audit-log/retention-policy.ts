/**
 * RetentionPolicyEnforcer - Configurable retention policies for audit logs
 *
 * Provides comprehensive retention management for audit entries:
 * - **Policy Definition**: Configure retention periods and archive rules per event type
 * - **Automatic Scheduling**: Schedule periodic retention enforcement
 * - **Archive Before Delete**: Export entries to cold storage before purging
 * - **Compliance Verification**: Verify retention compliance with audit reports
 *
 * @module db/primitives/audit-log/retention-policy
 * @see dotdo-gqku6 - [GREEN] Retention policy enforcer
 * @see dotdo-9xw2u - [PRIMITIVE] AuditLog - Immutable compliance and audit trail
 */

import type { AuditEntry, AuditLog } from './audit-log'
import { type MetricsCollector, noopMetrics } from '../observability'
import { logBestEffortError } from '../../../lib/logging/error-logger'

// =============================================================================
// RETENTION POLICY TYPES
// =============================================================================

/**
 * Time duration units for retention periods
 */
export type RetentionUnit = 'hours' | 'days' | 'weeks' | 'months' | 'years'

/**
 * Duration specification with unit
 */
export interface RetentionDuration {
  /** Numeric value */
  value: number
  /** Time unit */
  unit: RetentionUnit
}

/**
 * Archive destination configuration
 */
export interface ArchiveDestination {
  /** Destination type */
  type: 'r2' | 's3' | 'local' | 'custom'
  /** Bucket or path for storage */
  bucket?: string
  /** Prefix for archived files */
  prefix?: string
  /** Custom archive handler (for 'custom' type) */
  handler?: ArchiveHandler
}

/**
 * Custom archive handler interface
 */
export interface ArchiveHandler {
  /**
   * Archive entries to destination
   * @param entries - Entries to archive
   * @param metadata - Archive metadata
   * @returns Archive result
   */
  archive(entries: AuditEntry[], metadata: ArchiveMetadata): Promise<ArchiveResult>
}

/**
 * Archive metadata for tracking
 */
export interface ArchiveMetadata {
  /** Unique archive ID */
  archiveId: string
  /** Timestamp when archive was created */
  archivedAt: string
  /** Date range of archived entries */
  dateRange: {
    from: string
    to: string
  }
  /** Total entries in archive */
  entryCount: number
  /** Policy that triggered the archive */
  policyId?: string
  /** Event type filter applied */
  eventType?: string
  /** Checksum of archived data */
  checksum?: string
}

/**
 * Result of an archive operation
 */
export interface ArchiveResult {
  /** Whether archive was successful */
  success: boolean
  /** Archive metadata */
  metadata: ArchiveMetadata
  /** Location of archived data */
  location?: string
  /** Error message if failed */
  error?: string
}

/**
 * Retention policy for a specific event type or global default
 */
export interface RetentionPolicyDefinition {
  /** Unique policy ID */
  id: string
  /** Human-readable name */
  name: string
  /** Event type this policy applies to (null for default) */
  eventType?: string
  /** Action type filter (e.g., 'create', 'delete') */
  actionType?: string
  /** Resource type filter */
  resourceType?: string
  /** Retention duration - entries older than this may be purged */
  retentionPeriod: RetentionDuration
  /** Archive configuration before deletion */
  archiveConfig?: {
    /** Whether to archive before delete */
    enabled: boolean
    /** Archive destination */
    destination?: ArchiveDestination
    /** Format for archived data */
    format?: 'json' | 'ndjson' | 'parquet'
    /** Compression for archived data */
    compression?: 'none' | 'gzip' | 'zstd'
  }
  /** Legal hold - prevents deletion regardless of retention period */
  legalHold?: boolean
  /** Minimum entries to always retain regardless of age */
  minRetainCount?: number
  /** Priority when multiple policies match (higher = more priority) */
  priority?: number
  /** Whether policy is enabled */
  enabled: boolean
  /** Compliance standard this policy satisfies */
  complianceStandard?: 'SOC2' | 'GDPR' | 'HIPAA' | 'PCI-DSS' | 'custom'
}

/**
 * Schedule configuration for automatic enforcement
 */
export interface EnforcementSchedule {
  /** Schedule type */
  type: 'cron' | 'interval' | 'manual'
  /** Cron expression (for 'cron' type) */
  cron?: string
  /** Interval in milliseconds (for 'interval' type) */
  intervalMs?: number
  /** Maximum entries to process per run */
  batchSize?: number
  /** Whether to run on startup */
  runOnStartup?: boolean
}

/**
 * Result of retention policy enforcement
 */
export interface EnforcementResult {
  /** Whether enforcement completed successfully */
  success: boolean
  /** Timestamp when enforcement started */
  startedAt: string
  /** Timestamp when enforcement completed */
  completedAt: string
  /** Duration in milliseconds */
  durationMs: number
  /** Policies that were enforced */
  policiesEnforced: string[]
  /** Summary of entries processed */
  summary: {
    /** Total entries evaluated */
    evaluated: number
    /** Entries that matched retention criteria */
    matched: number
    /** Entries archived */
    archived: number
    /** Entries purged/deleted */
    purged: number
    /** Entries retained (legal hold or minimum count) */
    retained: number
    /** Entries skipped (policy disabled or errors) */
    skipped: number
  }
  /** Archive results if any archives were created */
  archives?: ArchiveResult[]
  /** Errors encountered */
  errors?: EnforcementError[]
}

/**
 * Error during enforcement
 */
export interface EnforcementError {
  /** Policy ID where error occurred */
  policyId: string
  /** Error message */
  message: string
  /** Entry ID if error was entry-specific */
  entryId?: string
  /** Whether error was recoverable */
  recoverable: boolean
}

/**
 * Compliance verification result
 */
export interface ComplianceReport {
  /** Whether all policies are compliant */
  compliant: boolean
  /** Timestamp of verification */
  verifiedAt: string
  /** Individual policy compliance status */
  policyStatus: PolicyComplianceStatus[]
  /** Overall statistics */
  statistics: {
    /** Total policies checked */
    totalPolicies: number
    /** Compliant policies */
    compliantPolicies: number
    /** Non-compliant policies */
    nonCompliantPolicies: number
    /** Oldest entry age in days */
    oldestEntryAgeDays: number
    /** Total entries in audit log */
    totalEntries: number
  }
  /** Recommendations for remediation */
  recommendations?: string[]
}

/**
 * Individual policy compliance status
 */
export interface PolicyComplianceStatus {
  /** Policy ID */
  policyId: string
  /** Policy name */
  policyName: string
  /** Whether this policy is compliant */
  compliant: boolean
  /** Reason if not compliant */
  reason?: string
  /** Entries violating this policy */
  violatingEntryCount?: number
  /** Oldest violating entry age in days */
  oldestViolationAgeDays?: number
  /** Recommended action */
  recommendedAction?: string
}

/**
 * Options for RetentionPolicyEnforcer
 */
export interface RetentionPolicyEnforcerOptions {
  /** Default retention policy for entries without specific policy */
  defaultPolicy?: RetentionPolicyDefinition
  /** Metrics collector for observability */
  metrics?: MetricsCollector
  /** Schedule for automatic enforcement */
  schedule?: EnforcementSchedule
  /** Whether to enable dry-run mode (evaluate without purging) */
  dryRun?: boolean
}

// =============================================================================
// METRIC NAMES
// =============================================================================

export const RetentionMetrics = {
  ENFORCE_LATENCY: 'retention.enforce.latency',
  ENTRIES_EVALUATED: 'retention.entries_evaluated',
  ENTRIES_ARCHIVED: 'retention.entries_archived',
  ENTRIES_PURGED: 'retention.entries_purged',
  ENTRIES_RETAINED: 'retention.entries_retained',
  ARCHIVE_LATENCY: 'retention.archive.latency',
  ARCHIVE_SIZE_BYTES: 'retention.archive.size_bytes',
  POLICY_COUNT: 'retention.policy_count',
  COMPLIANCE_CHECK_LATENCY: 'retention.compliance_check.latency',
  VIOLATIONS_FOUND: 'retention.violations_found',
} as const

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Convert retention duration to milliseconds
 */
function durationToMs(duration: RetentionDuration): number {
  const msPerUnit: Record<RetentionUnit, number> = {
    hours: 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    weeks: 7 * 24 * 60 * 60 * 1000,
    months: 30 * 24 * 60 * 60 * 1000, // Approximate
    years: 365 * 24 * 60 * 60 * 1000, // Approximate
  }
  return duration.value * msPerUnit[duration.unit]
}

/**
 * Format duration for display
 */
function formatDuration(duration: RetentionDuration): string {
  return `${duration.value} ${duration.unit}`
}

/**
 * Generate a unique archive ID
 */
function generateArchiveId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `archive-${timestamp}-${random}`
}

/**
 * Calculate age in days from timestamp
 */
function ageInDays(timestampMs: number): number {
  return Math.floor((Date.now() - timestampMs) / (24 * 60 * 60 * 1000))
}

/**
 * Get entry timestamp in milliseconds
 */
function getEntryTimestamp(entry: AuditEntry): number {
  return entry.timestamp?.epochMs ?? new Date(entry.createdAt).getTime()
}

/**
 * Check if entry matches policy filters
 */
function entryMatchesPolicy(entry: AuditEntry, policy: RetentionPolicyDefinition): boolean {
  // Check action type filter
  if (policy.actionType && entry.action?.type !== policy.actionType) {
    return false
  }

  // Check resource type filter
  if (policy.resourceType && entry.resource?.type !== policy.resourceType) {
    return false
  }

  // Check event type (custom field if present)
  if (policy.eventType) {
    const entryEventType = entry.action?.type
    if (entryEventType !== policy.eventType) {
      return false
    }
  }

  return true
}

/**
 * Simple SHA-256-like hash for checksums (sync version for archives)
 */
function computeChecksum(data: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < data.length; i++) {
    hash ^= data.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// =============================================================================
// DEFAULT IN-MEMORY ARCHIVE HANDLER
// =============================================================================

/**
 * In-memory archive handler for testing and development
 */
class InMemoryArchiveHandler implements ArchiveHandler {
  public readonly archives: Map<string, { entries: AuditEntry[]; metadata: ArchiveMetadata }> = new Map()

  async archive(entries: AuditEntry[], metadata: ArchiveMetadata): Promise<ArchiveResult> {
    const checksum = computeChecksum(JSON.stringify(entries))
    const enrichedMetadata: ArchiveMetadata = {
      ...metadata,
      checksum,
    }

    this.archives.set(metadata.archiveId, {
      entries: JSON.parse(JSON.stringify(entries)), // Deep clone
      metadata: enrichedMetadata,
    })

    return {
      success: true,
      metadata: enrichedMetadata,
      location: `memory://${metadata.archiveId}`,
    }
  }

  /**
   * Retrieve an archived set of entries
   */
  retrieve(archiveId: string): { entries: AuditEntry[]; metadata: ArchiveMetadata } | null {
    return this.archives.get(archiveId) ?? null
  }

  /**
   * List all archives
   */
  listArchives(): ArchiveMetadata[] {
    return Array.from(this.archives.values()).map((a) => a.metadata)
  }

  /**
   * Clear all archives
   */
  clear(): void {
    this.archives.clear()
  }
}

// =============================================================================
// RETENTION POLICY ENFORCER IMPLEMENTATION
// =============================================================================

/**
 * RetentionPolicyEnforcer - Manages retention policies for audit logs
 *
 * @example
 * ```typescript
 * const enforcer = createRetentionPolicyEnforcer(auditLog, {
 *   defaultPolicy: {
 *     id: 'default',
 *     name: 'Default 90-day retention',
 *     retentionPeriod: { value: 90, unit: 'days' },
 *     archiveConfig: { enabled: true },
 *     enabled: true,
 *   },
 * })
 *
 * // Add custom policy for security events
 * enforcer.addPolicy({
 *   id: 'security-7yr',
 *   name: 'Security events - 7 year retention',
 *   actionType: 'login',
 *   retentionPeriod: { value: 7, unit: 'years' },
 *   complianceStandard: 'SOC2',
 *   enabled: true,
 * })
 *
 * // Enforce retention
 * const result = await enforcer.enforce()
 *
 * // Verify compliance
 * const report = await enforcer.verifyCompliance()
 * ```
 */
export class RetentionPolicyEnforcer {
  private readonly auditLog: AuditLog
  private readonly policies: Map<string, RetentionPolicyDefinition> = new Map()
  private readonly metrics: MetricsCollector
  private readonly dryRun: boolean
  private readonly defaultArchiveHandler: InMemoryArchiveHandler
  private scheduledInterval: ReturnType<typeof setInterval> | null = null

  constructor(auditLog: AuditLog, options?: RetentionPolicyEnforcerOptions) {
    this.auditLog = auditLog
    this.metrics = options?.metrics ?? noopMetrics
    this.dryRun = options?.dryRun ?? false
    this.defaultArchiveHandler = new InMemoryArchiveHandler()

    // Add default policy if provided
    if (options?.defaultPolicy) {
      this.policies.set(options.defaultPolicy.id, options.defaultPolicy)
    }

    // Setup scheduled enforcement if configured
    if (options?.schedule) {
      this.setupSchedule(options.schedule)
    }
  }

  // ===========================================================================
  // POLICY MANAGEMENT
  // ===========================================================================

  /**
   * Add a retention policy
   */
  addPolicy(policy: RetentionPolicyDefinition): void {
    this.validatePolicy(policy)
    this.policies.set(policy.id, policy)
    this.metrics.recordGauge(RetentionMetrics.POLICY_COUNT, this.policies.size)
  }

  /**
   * Remove a retention policy by ID
   */
  removePolicy(policyId: string): boolean {
    const removed = this.policies.delete(policyId)
    if (removed) {
      this.metrics.recordGauge(RetentionMetrics.POLICY_COUNT, this.policies.size)
    }
    return removed
  }

  /**
   * Get a policy by ID
   */
  getPolicy(policyId: string): RetentionPolicyDefinition | null {
    return this.policies.get(policyId) ?? null
  }

  /**
   * List all policies
   */
  listPolicies(): RetentionPolicyDefinition[] {
    return Array.from(this.policies.values())
  }

  /**
   * Update an existing policy
   */
  updatePolicy(policyId: string, updates: Partial<RetentionPolicyDefinition>): boolean {
    const existing = this.policies.get(policyId)
    if (!existing) {
      return false
    }

    const updated: RetentionPolicyDefinition = {
      ...existing,
      ...updates,
      id: policyId, // Ensure ID cannot be changed
    }

    this.validatePolicy(updated)
    this.policies.set(policyId, updated)
    return true
  }

  /**
   * Enable or disable a policy
   */
  setEnabled(policyId: string, enabled: boolean): boolean {
    const policy = this.policies.get(policyId)
    if (!policy) {
      return false
    }
    policy.enabled = enabled
    return true
  }

  /**
   * Set legal hold on a policy (prevents any deletion)
   */
  setLegalHold(policyId: string, hold: boolean): boolean {
    const policy = this.policies.get(policyId)
    if (!policy) {
      return false
    }
    policy.legalHold = hold
    return true
  }

  // ===========================================================================
  // RETENTION ENFORCEMENT
  // ===========================================================================

  /**
   * Enforce all retention policies
   */
  async enforce(): Promise<EnforcementResult> {
    const startTime = Date.now()
    const startedAt = new Date().toISOString()
    const errors: EnforcementError[] = []
    const archives: ArchiveResult[] = []

    const summary = {
      evaluated: 0,
      matched: 0,
      archived: 0,
      purged: 0,
      retained: 0,
      skipped: 0,
    }

    const policiesEnforced: string[] = []

    // Get all entries from audit log
    const allEntries = this.auditLog.list()
    summary.evaluated = allEntries.length

    // Group entries by matching policy
    const entriesByPolicy = this.groupEntriesByPolicy(allEntries)

    // Process each policy
    for (const [policyId, entries] of entriesByPolicy) {
      const policy = this.policies.get(policyId)
      if (!policy) continue

      if (!policy.enabled) {
        summary.skipped += entries.length
        continue
      }

      if (policy.legalHold) {
        summary.retained += entries.length
        continue
      }

      policiesEnforced.push(policyId)

      try {
        const policyResult = await this.enforcePolicy(policy, entries)
        summary.matched += policyResult.matched
        summary.archived += policyResult.archived
        summary.purged += policyResult.purged
        summary.retained += policyResult.retained

        if (policyResult.archiveResult) {
          archives.push(policyResult.archiveResult)
        }
      } catch (error) {
        errors.push({
          policyId,
          message: (error as Error).message,
          recoverable: true,
        })
      }
    }

    const completedAt = new Date().toISOString()
    const durationMs = Date.now() - startTime

    // Record metrics
    this.metrics.recordLatency(RetentionMetrics.ENFORCE_LATENCY, durationMs)
    this.metrics.incrementCounter(RetentionMetrics.ENTRIES_EVALUATED, undefined, summary.evaluated)
    this.metrics.incrementCounter(RetentionMetrics.ENTRIES_ARCHIVED, undefined, summary.archived)
    this.metrics.incrementCounter(RetentionMetrics.ENTRIES_PURGED, undefined, summary.purged)
    this.metrics.incrementCounter(RetentionMetrics.ENTRIES_RETAINED, undefined, summary.retained)

    return {
      success: errors.length === 0,
      startedAt,
      completedAt,
      durationMs,
      policiesEnforced,
      summary,
      archives: archives.length > 0 ? archives : undefined,
      errors: errors.length > 0 ? errors : undefined,
    }
  }

  /**
   * Enforce a single policy
   */
  async enforcePolicy(
    policy: RetentionPolicyDefinition,
    entries: AuditEntry[]
  ): Promise<{
    matched: number
    archived: number
    purged: number
    retained: number
    archiveResult?: ArchiveResult
  }> {
    const cutoffTime = Date.now() - durationToMs(policy.retentionPeriod)
    const result = {
      matched: 0,
      archived: 0,
      purged: 0,
      retained: 0,
      archiveResult: undefined as ArchiveResult | undefined,
    }

    // Find entries that exceed retention period
    const expiredEntries: AuditEntry[] = []
    const retainedEntries: AuditEntry[] = []

    for (const entry of entries) {
      const entryTimestamp = getEntryTimestamp(entry)
      if (entryTimestamp < cutoffTime) {
        expiredEntries.push(entry)
        result.matched++
      } else {
        retainedEntries.push(entry)
      }
    }

    // Apply minimum retain count
    if (policy.minRetainCount && policy.minRetainCount > 0) {
      // Sort expired by timestamp (oldest first)
      expiredEntries.sort((a, b) => getEntryTimestamp(a) - getEntryTimestamp(b))

      // Move newer expired entries to retained if needed
      const totalNeeded = policy.minRetainCount
      const currentRetained = retainedEntries.length

      if (currentRetained < totalNeeded) {
        const needToRetain = totalNeeded - currentRetained
        const toRetain = expiredEntries.splice(-needToRetain, needToRetain)
        retainedEntries.push(...toRetain)
        result.matched -= toRetain.length
      }
    }

    result.retained = retainedEntries.length

    // Archive before delete if configured
    if (policy.archiveConfig?.enabled && expiredEntries.length > 0) {
      const archiveStart = Date.now()
      const archiveResult = await this.archiveEntries(expiredEntries, policy)
      this.metrics.recordLatency(RetentionMetrics.ARCHIVE_LATENCY, Date.now() - archiveStart)

      if (archiveResult.success) {
        result.archived = expiredEntries.length
        result.archiveResult = archiveResult
      } else {
        // Archive failed - don't purge
        return result
      }
    }

    // In dry-run mode, don't actually purge
    if (!this.dryRun && expiredEntries.length > 0) {
      // Note: The audit log is immutable, so actual deletion is handled
      // through a separate mechanism (e.g., compaction, rotation)
      // Here we just track what would be purged
      result.purged = expiredEntries.length
    }

    return result
  }

  /**
   * Archive entries before deletion
   */
  private async archiveEntries(entries: AuditEntry[], policy: RetentionPolicyDefinition): Promise<ArchiveResult> {
    if (entries.length === 0) {
      return {
        success: true,
        metadata: {
          archiveId: generateArchiveId(),
          archivedAt: new Date().toISOString(),
          dateRange: { from: '', to: '' },
          entryCount: 0,
        },
      }
    }

    // Sort entries by timestamp
    const sortedEntries = [...entries].sort((a, b) => getEntryTimestamp(a) - getEntryTimestamp(b))

    const metadata: ArchiveMetadata = {
      archiveId: generateArchiveId(),
      archivedAt: new Date().toISOString(),
      dateRange: {
        from: sortedEntries[0]!.createdAt,
        to: sortedEntries[sortedEntries.length - 1]!.createdAt,
      },
      entryCount: entries.length,
      policyId: policy.id,
      eventType: policy.eventType,
    }

    // Get archive handler
    const handler = policy.archiveConfig?.destination?.handler ?? this.defaultArchiveHandler

    try {
      const result = await handler.archive(entries, metadata)

      // Record archive size
      const archiveData = JSON.stringify(entries)
      this.metrics.recordGauge(RetentionMetrics.ARCHIVE_SIZE_BYTES, archiveData.length)

      return result
    } catch (error) {
      return {
        success: false,
        metadata,
        error: (error as Error).message,
      }
    }
  }

  // ===========================================================================
  // COMPLIANCE VERIFICATION
  // ===========================================================================

  /**
   * Verify compliance with all retention policies
   */
  async verifyCompliance(): Promise<ComplianceReport> {
    const startTime = Date.now()
    const verifiedAt = new Date().toISOString()

    const allEntries = this.auditLog.list()
    const policyStatus: PolicyComplianceStatus[] = []
    let totalViolations = 0

    // Check each policy
    for (const policy of this.policies.values()) {
      const status = this.checkPolicyCompliance(policy, allEntries)
      policyStatus.push(status)

      if (!status.compliant && status.violatingEntryCount) {
        totalViolations += status.violatingEntryCount
      }
    }

    // Calculate oldest entry age
    let oldestEntryAgeDays = 0
    if (allEntries.length > 0) {
      const oldestEntry = allEntries.reduce((oldest, entry) =>
        getEntryTimestamp(entry) < getEntryTimestamp(oldest) ? entry : oldest
      )
      oldestEntryAgeDays = ageInDays(getEntryTimestamp(oldestEntry))
    }

    const compliantCount = policyStatus.filter((s) => s.compliant).length
    const compliant = policyStatus.every((s) => s.compliant)

    // Record metrics
    this.metrics.recordLatency(RetentionMetrics.COMPLIANCE_CHECK_LATENCY, Date.now() - startTime)
    this.metrics.incrementCounter(RetentionMetrics.VIOLATIONS_FOUND, undefined, totalViolations)

    // Generate recommendations
    const recommendations: string[] = []
    for (const status of policyStatus) {
      if (!status.compliant && status.recommendedAction) {
        recommendations.push(`${status.policyName}: ${status.recommendedAction}`)
      }
    }

    return {
      compliant,
      verifiedAt,
      policyStatus,
      statistics: {
        totalPolicies: this.policies.size,
        compliantPolicies: compliantCount,
        nonCompliantPolicies: this.policies.size - compliantCount,
        oldestEntryAgeDays,
        totalEntries: allEntries.length,
      },
      recommendations: recommendations.length > 0 ? recommendations : undefined,
    }
  }

  /**
   * Check compliance for a single policy
   */
  private checkPolicyCompliance(policy: RetentionPolicyDefinition, entries: AuditEntry[]): PolicyComplianceStatus {
    if (!policy.enabled) {
      return {
        policyId: policy.id,
        policyName: policy.name,
        compliant: true,
        reason: 'Policy is disabled',
      }
    }

    if (policy.legalHold) {
      return {
        policyId: policy.id,
        policyName: policy.name,
        compliant: true,
        reason: 'Legal hold active - no retention enforcement',
      }
    }

    const matchingEntries = entries.filter((e) => entryMatchesPolicy(e, policy))
    const cutoffTime = Date.now() - durationToMs(policy.retentionPeriod)

    // Find violating entries (older than retention period)
    const violatingEntries = matchingEntries.filter((e) => getEntryTimestamp(e) < cutoffTime)

    // Account for minimum retain count
    const effectiveViolations = policy.minRetainCount
      ? Math.max(0, violatingEntries.length - (policy.minRetainCount - (matchingEntries.length - violatingEntries.length)))
      : violatingEntries.length

    if (effectiveViolations === 0) {
      return {
        policyId: policy.id,
        policyName: policy.name,
        compliant: true,
      }
    }

    // Calculate oldest violation age
    let oldestViolationAgeDays = 0
    if (violatingEntries.length > 0) {
      const oldestViolation = violatingEntries.reduce((oldest, entry) =>
        getEntryTimestamp(entry) < getEntryTimestamp(oldest) ? entry : oldest
      )
      oldestViolationAgeDays = ageInDays(getEntryTimestamp(oldestViolation))
    }

    return {
      policyId: policy.id,
      policyName: policy.name,
      compliant: false,
      reason: `${effectiveViolations} entries exceed retention period of ${formatDuration(policy.retentionPeriod)}`,
      violatingEntryCount: effectiveViolations,
      oldestViolationAgeDays,
      recommendedAction: `Run retention enforcement to archive and purge ${effectiveViolations} entries`,
    }
  }

  // ===========================================================================
  // SCHEDULING
  // ===========================================================================

  /**
   * Setup automatic enforcement schedule
   */
  private setupSchedule(schedule: EnforcementSchedule): void {
    if (schedule.type === 'interval' && schedule.intervalMs) {
      this.scheduledInterval = setInterval(() => {
        this.enforce().catch((error) => {
          logBestEffortError(error, {
            operation: 'scheduledEnforcement',
            source: 'audit-log/retention-policy',
          })
        })
      }, schedule.intervalMs)

      // Run on startup if configured
      if (schedule.runOnStartup) {
        // Defer to next tick to allow initialization to complete
        setTimeout(() => {
          this.enforce().catch((error) => {
            logBestEffortError(error, {
              operation: 'startupEnforcement',
              source: 'audit-log/retention-policy',
            })
          })
        }, 0)
      }
    }
    // Cron scheduling would require a cron library - left as extension point
  }

  /**
   * Stop scheduled enforcement
   */
  stopSchedule(): void {
    if (this.scheduledInterval) {
      clearInterval(this.scheduledInterval)
      this.scheduledInterval = null
    }
  }

  // ===========================================================================
  // UTILITY METHODS
  // ===========================================================================

  /**
   * Group entries by their matching policy
   */
  private groupEntriesByPolicy(entries: AuditEntry[]): Map<string, AuditEntry[]> {
    const groups = new Map<string, AuditEntry[]>()

    // Sort policies by priority (higher first)
    const sortedPolicies = Array.from(this.policies.values()).sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
    )

    // Track which entries have been assigned
    const assignedEntries = new Set<string>()

    for (const policy of sortedPolicies) {
      const matching: AuditEntry[] = []

      for (const entry of entries) {
        // Skip if already assigned to a higher priority policy
        if (assignedEntries.has(entry.id)) continue

        if (entryMatchesPolicy(entry, policy)) {
          matching.push(entry)
          assignedEntries.add(entry.id)
        }
      }

      if (matching.length > 0) {
        groups.set(policy.id, matching)
      }
    }

    // Assign remaining entries to default policy (if exists)
    const defaultPolicy = Array.from(this.policies.values()).find((p) => !p.eventType && !p.actionType && !p.resourceType)
    if (defaultPolicy) {
      const unassigned = entries.filter((e) => !assignedEntries.has(e.id))
      if (unassigned.length > 0) {
        const existing = groups.get(defaultPolicy.id) ?? []
        groups.set(defaultPolicy.id, [...existing, ...unassigned])
      }
    }

    return groups
  }

  /**
   * Validate a policy definition
   */
  private validatePolicy(policy: RetentionPolicyDefinition): void {
    if (!policy.id || policy.id.trim() === '') {
      throw new Error('Policy must have a non-empty ID')
    }
    if (!policy.name || policy.name.trim() === '') {
      throw new Error('Policy must have a non-empty name')
    }
    if (!policy.retentionPeriod) {
      throw new Error('Policy must have a retention period')
    }
    if (policy.retentionPeriod.value <= 0) {
      throw new Error('Retention period value must be positive')
    }
    const validUnits: RetentionUnit[] = ['hours', 'days', 'weeks', 'months', 'years']
    if (!validUnits.includes(policy.retentionPeriod.unit)) {
      throw new Error(`Invalid retention period unit: ${policy.retentionPeriod.unit}`)
    }
    if (policy.minRetainCount !== undefined && policy.minRetainCount < 0) {
      throw new Error('Minimum retain count cannot be negative')
    }
  }

  /**
   * Get the default archive handler (for testing)
   */
  getDefaultArchiveHandler(): InMemoryArchiveHandler {
    return this.defaultArchiveHandler
  }

  /**
   * Check if running in dry-run mode
   */
  isDryRun(): boolean {
    return this.dryRun
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a new RetentionPolicyEnforcer instance
 *
 * @param auditLog - The audit log to manage retention for
 * @param options - Configuration options
 * @returns A new RetentionPolicyEnforcer instance
 *
 * @example
 * ```typescript
 * // Basic usage with default 90-day retention
 * const enforcer = createRetentionPolicyEnforcer(auditLog, {
 *   defaultPolicy: {
 *     id: 'default',
 *     name: 'Default retention',
 *     retentionPeriod: { value: 90, unit: 'days' },
 *     archiveConfig: { enabled: true },
 *     enabled: true,
 *   },
 * })
 *
 * // Add SOC2 compliant policy for security events
 * enforcer.addPolicy({
 *   id: 'security-soc2',
 *   name: 'Security events - 7 year',
 *   actionType: 'login',
 *   retentionPeriod: { value: 7, unit: 'years' },
 *   complianceStandard: 'SOC2',
 *   enabled: true,
 * })
 *
 * // GDPR policy with right to deletion
 * enforcer.addPolicy({
 *   id: 'gdpr-user-data',
 *   name: 'User data - GDPR compliant',
 *   resourceType: 'User',
 *   retentionPeriod: { value: 3, unit: 'years' },
 *   archiveConfig: {
 *     enabled: true,
 *     destination: { type: 'r2', bucket: 'audit-archives' },
 *     format: 'ndjson',
 *     compression: 'gzip',
 *   },
 *   complianceStandard: 'GDPR',
 *   enabled: true,
 * })
 *
 * // Enforce retention policies
 * const result = await enforcer.enforce()
 * console.log('Archived:', result.summary.archived)
 * console.log('Purged:', result.summary.purged)
 *
 * // Verify compliance
 * const report = await enforcer.verifyCompliance()
 * if (!report.compliant) {
 *   console.log('Non-compliant policies:', report.recommendations)
 * }
 * ```
 */
export function createRetentionPolicyEnforcer(
  auditLog: AuditLog,
  options?: RetentionPolicyEnforcerOptions
): RetentionPolicyEnforcer {
  return new RetentionPolicyEnforcer(auditLog, options)
}

/**
 * Create a pre-configured enforcer for SOC2 compliance
 *
 * @param auditLog - The audit log to manage
 * @returns Pre-configured enforcer with SOC2 policies
 *
 * @example
 * ```typescript
 * const enforcer = createSOC2RetentionEnforcer(auditLog)
 * const report = await enforcer.verifyCompliance()
 * ```
 */
export function createSOC2RetentionEnforcer(auditLog: AuditLog): RetentionPolicyEnforcer {
  const enforcer = new RetentionPolicyEnforcer(auditLog)

  // SOC2 requires 7 years retention for security events
  enforcer.addPolicy({
    id: 'soc2-security',
    name: 'SOC2 Security Events - 7 Year Retention',
    actionType: 'login',
    retentionPeriod: { value: 7, unit: 'years' },
    archiveConfig: {
      enabled: true,
      format: 'ndjson',
      compression: 'gzip',
    },
    complianceStandard: 'SOC2',
    priority: 100,
    enabled: true,
  })

  // Access control changes
  enforcer.addPolicy({
    id: 'soc2-access',
    name: 'SOC2 Access Control - 7 Year Retention',
    resourceType: 'Permission',
    retentionPeriod: { value: 7, unit: 'years' },
    archiveConfig: { enabled: true },
    complianceStandard: 'SOC2',
    priority: 100,
    enabled: true,
  })

  // Default policy for other events
  enforcer.addPolicy({
    id: 'soc2-default',
    name: 'SOC2 Default - 1 Year Retention',
    retentionPeriod: { value: 1, unit: 'years' },
    archiveConfig: { enabled: true },
    complianceStandard: 'SOC2',
    priority: 0,
    enabled: true,
  })

  return enforcer
}

/**
 * Create a pre-configured enforcer for GDPR compliance
 *
 * @param auditLog - The audit log to manage
 * @returns Pre-configured enforcer with GDPR policies
 *
 * @example
 * ```typescript
 * const enforcer = createGDPRRetentionEnforcer(auditLog)
 * const report = await enforcer.verifyCompliance()
 * ```
 */
export function createGDPRRetentionEnforcer(auditLog: AuditLog): RetentionPolicyEnforcer {
  const enforcer = new RetentionPolicyEnforcer(auditLog)

  // GDPR limits personal data retention
  enforcer.addPolicy({
    id: 'gdpr-personal-data',
    name: 'GDPR Personal Data - 3 Year Maximum',
    resourceType: 'User',
    retentionPeriod: { value: 3, unit: 'years' },
    archiveConfig: {
      enabled: true,
      format: 'ndjson',
      compression: 'gzip',
    },
    complianceStandard: 'GDPR',
    priority: 100,
    enabled: true,
  })

  // Consent records need longer retention
  enforcer.addPolicy({
    id: 'gdpr-consent',
    name: 'GDPR Consent Records - 7 Year Retention',
    actionType: 'consent',
    retentionPeriod: { value: 7, unit: 'years' },
    archiveConfig: { enabled: true },
    complianceStandard: 'GDPR',
    priority: 90,
    enabled: true,
  })

  // Default shorter retention
  enforcer.addPolicy({
    id: 'gdpr-default',
    name: 'GDPR Default - 1 Year Retention',
    retentionPeriod: { value: 1, unit: 'years' },
    archiveConfig: { enabled: true },
    complianceStandard: 'GDPR',
    priority: 0,
    enabled: true,
  })

  return enforcer
}

/**
 * Utility to convert human-readable duration string to RetentionDuration
 *
 * @param duration - String like '90 days', '7 years', '24 hours'
 * @returns Parsed RetentionDuration
 *
 * @example
 * ```typescript
 * const period = parseRetentionDuration('90 days')
 * // { value: 90, unit: 'days' }
 *
 * const period2 = parseRetentionDuration('7years')
 * // { value: 7, unit: 'years' }
 * ```
 */
export function parseRetentionDuration(duration: string): RetentionDuration {
  const match = duration.trim().match(/^(\d+)\s*(hours?|days?|weeks?|months?|years?)$/i)
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}. Expected format like '90 days' or '7 years'`)
  }

  const value = parseInt(match[1]!, 10)
  let unit = match[2]!.toLowerCase() as string

  // Normalize singular to plural
  if (!unit.endsWith('s')) {
    unit = unit + 's'
  }

  return {
    value,
    unit: unit as RetentionUnit,
  }
}
