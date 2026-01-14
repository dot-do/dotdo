/**
 * Tamper Detection - Hash chain verification and anomaly detection for audit logs
 *
 * Provides comprehensive tamper detection capabilities:
 * - **Hash chain verification**: Validates cryptographic links between entries
 * - **Anomaly detection**: Identifies suspicious patterns (gaps, timestamps, actors)
 * - **Alert generation**: Configurable alerting for detected issues
 * - **Integrity reporting**: Comprehensive reports on log health
 *
 * @module db/primitives/audit-log/tamper-detection
 * @see dotdo-p2ulg - [REFACTOR] Tamper detection alerts
 * @see dotdo-9xw2u - [PRIMITIVE] AuditLog - Immutable compliance and audit trail
 */

import { type MetricsCollector, noopMetrics } from '../observability'

// =============================================================================
// PUBLIC TYPES
// =============================================================================

/**
 * Severity levels for detected issues
 */
export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

/**
 * Types of tampering or anomalies that can be detected
 */
export type TamperType =
  | 'hash_chain_broken'      // Hash chain link is invalid
  | 'hash_mismatch'          // Computed hash doesn't match stored hash
  | 'index_gap'              // Gap in sequential indices
  | 'index_duplicate'        // Duplicate index found
  | 'timestamp_anomaly'      // Timestamp out of expected order
  | 'timestamp_future'       // Timestamp in the future
  | 'actor_anomaly'          // Suspicious actor pattern
  | 'rate_anomaly'           // Unusual rate of entries
  | 'deletion_detected'      // Evidence of deleted entries
  | 'modification_detected'  // Evidence of modified entries

/**
 * A single detected issue/alert
 */
export interface TamperAlert {
  /** Unique identifier for this alert */
  id: string
  /** Type of tampering or anomaly detected */
  type: TamperType
  /** Severity level */
  severity: AlertSeverity
  /** Human-readable description */
  message: string
  /** Index where the issue was detected (if applicable) */
  index?: number
  /** Entry ID where the issue was detected (if applicable) */
  entryId?: string
  /** Expected value (for mismatches) */
  expected?: string
  /** Actual value found */
  actual?: string
  /** When the alert was generated */
  detectedAt: number
  /** Additional context */
  metadata?: Record<string, unknown>
}

/**
 * Result of hash chain verification
 */
export interface HashChainVerificationResult {
  /** Whether the entire chain is valid */
  valid: boolean
  /** Number of entries verified */
  entriesVerified: number
  /** List of all detected issues */
  alerts: TamperAlert[]
  /** Index of first invalid entry (if any) */
  firstInvalidIndex?: number
  /** Time taken to verify in milliseconds */
  verificationTimeMs: number
  /** Hash of the head entry */
  headHash?: string
}

/**
 * Result of anomaly detection
 */
export interface AnomalyDetectionResult {
  /** Whether any anomalies were detected */
  hasAnomalies: boolean
  /** List of detected anomalies */
  alerts: TamperAlert[]
  /** Statistics about the analysis */
  stats: AnomalyStats
}

/**
 * Statistics from anomaly detection
 */
export interface AnomalyStats {
  /** Total entries analyzed */
  entriesAnalyzed: number
  /** Average time between entries in ms */
  avgEntryIntervalMs: number
  /** Standard deviation of entry intervals */
  stdDevIntervalMs: number
  /** Number of unique actors seen */
  uniqueActors: number
  /** Most active actor */
  mostActiveActor?: string
  /** Rate of entries per minute (if applicable) */
  entriesPerMinute?: number
}

/**
 * Comprehensive integrity report
 */
export interface IntegrityReport {
  /** When the report was generated */
  generatedAt: number
  /** Overall health status */
  status: 'healthy' | 'degraded' | 'compromised'
  /** Hash chain verification results */
  hashChainVerification: HashChainVerificationResult
  /** Anomaly detection results */
  anomalyDetection: AnomalyDetectionResult
  /** All alerts from all checks */
  allAlerts: TamperAlert[]
  /** Summary statistics */
  summary: IntegritySummary
}

/**
 * Summary of integrity check
 */
export interface IntegritySummary {
  /** Total entries in the log */
  totalEntries: number
  /** Number of critical alerts */
  criticalAlerts: number
  /** Number of high severity alerts */
  highAlerts: number
  /** Number of medium severity alerts */
  mediumAlerts: number
  /** Number of low severity alerts */
  lowAlerts: number
  /** Total time to generate report */
  totalTimeMs: number
}

/**
 * Configuration for anomaly detection
 */
export interface AnomalyDetectionConfig {
  /** Maximum allowed gap between timestamps in ms (default: 1 hour) */
  maxTimestampGapMs?: number
  /** Maximum allowed rate of entries per minute (default: 1000) */
  maxEntriesPerMinute?: number
  /** Minimum entries required for statistical analysis (default: 10) */
  minEntriesForStats?: number
  /** Z-score threshold for rate anomaly detection (default: 3) */
  rateAnomalyZScore?: number
  /** Whether to check for future timestamps (default: true) */
  checkFutureTimestamps?: boolean
  /** Grace period for future timestamps in ms (default: 5000) */
  futureTimestampGraceMs?: number
  /** Actor patterns to flag as suspicious */
  suspiciousActorPatterns?: RegExp[]
}

/**
 * Alert handler callback type
 */
export type AlertHandler = (alert: TamperAlert) => void | Promise<void>

/**
 * Configuration for the tamper detector
 */
export interface TamperDetectorOptions {
  /** Anomaly detection configuration */
  anomalyConfig?: AnomalyDetectionConfig
  /** Alert handlers by severity */
  alertHandlers?: Partial<Record<AlertSeverity, AlertHandler[]>>
  /** Default handler for all alerts */
  defaultHandler?: AlertHandler
  /** Metrics collector */
  metrics?: MetricsCollector
}

/**
 * Entry interface required for tamper detection
 */
export interface VerifiableEntry {
  /** Entry identifier */
  id: string
  /** Sequential index */
  index: number
  /** Hash of this entry */
  hash: string
  /** Hash of the previous entry */
  prevHash: string
  /** Timestamp information */
  timestamp: { epochMs: number } | number
  /** Actor information */
  actor?: { userId?: string; id?: string; type?: string }
  /** Data to hash (for verification) */
  [key: string]: unknown
}

/**
 * Interface for audit log that can be verified
 */
export interface VerifiableAuditLog {
  /** Get total entry count */
  count(): number
  /** Get entry by index */
  getByIndex(index: number): VerifiableEntry | null
  /** Get entry by ID */
  get(id: string): VerifiableEntry | null
  /** List entries with pagination */
  list(options?: { limit?: number; offset?: number }): VerifiableEntry[]
}

// =============================================================================
// METRIC NAMES
// =============================================================================

export const TamperDetectionMetrics = {
  VERIFY_CHAIN_LATENCY: 'tamper_detection.verify_chain.latency',
  DETECT_ANOMALIES_LATENCY: 'tamper_detection.detect_anomalies.latency',
  INTEGRITY_REPORT_LATENCY: 'tamper_detection.integrity_report.latency',
  ALERTS_GENERATED: 'tamper_detection.alerts_generated',
  CHAIN_BREAKS_DETECTED: 'tamper_detection.chain_breaks_detected',
  ANOMALIES_DETECTED: 'tamper_detection.anomalies_detected',
} as const

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate a unique alert ID
 */
function generateAlertId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `alert-${timestamp}-${random}`
}

/**
 * Get timestamp in milliseconds from various formats
 */
function getTimestampMs(timestamp: { epochMs: number } | number): number {
  if (typeof timestamp === 'number') {
    return timestamp
  }
  return timestamp.epochMs
}

/**
 * Compute FNV-1a hash (same as in audit-log.ts for consistency)
 */
function computeHash(data: string): string {
  let hash = 0x811c9dc5 // FNV-1a offset basis
  for (let i = 0; i < data.length; i++) {
    hash ^= data.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) // FNV-1a prime
  }
  const hex1 = (hash >>> 0).toString(16).padStart(8, '0')
  let hash2 = 0xcbf29ce484222325n
  for (let i = 0; i < data.length; i++) {
    hash2 ^= BigInt(data.charCodeAt(i))
    hash2 = BigInt.asUintN(64, hash2 * 0x100000001b3n)
  }
  const hex2 = hash2.toString(16).padStart(16, '0')
  return (hex1 + hex2 + hex1 + hex2).slice(0, 64)
}

/**
 * Extract hashable data from an entry (excluding hash fields)
 */
function extractHashableData(entry: VerifiableEntry): object {
  const { hash, prevHash, index, id, ...rest } = entry
  return rest
}

/**
 * Compute entry hash for verification
 */
function computeEntryHash(prevHash: string, data: object, timestamp: number): string {
  const payload = `${prevHash}${JSON.stringify(data)}${timestamp}`
  return computeHash(payload)
}

/**
 * Calculate standard deviation
 */
function calculateStdDev(values: number[], mean: number): number {
  if (values.length < 2) return 0
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2))
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length
  return Math.sqrt(avgSquaredDiff)
}

/**
 * Get actor ID from various actor formats
 */
function getActorId(actor?: { userId?: string; id?: string; type?: string }): string | undefined {
  if (!actor) return undefined
  return actor.userId ?? actor.id
}

// =============================================================================
// TAMPER DETECTOR IMPLEMENTATION
// =============================================================================

/**
 * TamperDetector - Detects tampering and anomalies in audit logs
 */
export class TamperDetector {
  private readonly anomalyConfig: Required<AnomalyDetectionConfig>
  private readonly alertHandlers: Map<AlertSeverity, AlertHandler[]>
  private readonly defaultHandler?: AlertHandler
  private readonly metrics: MetricsCollector

  constructor(options?: TamperDetectorOptions) {
    this.anomalyConfig = {
      maxTimestampGapMs: options?.anomalyConfig?.maxTimestampGapMs ?? 60 * 60 * 1000, // 1 hour
      maxEntriesPerMinute: options?.anomalyConfig?.maxEntriesPerMinute ?? 1000,
      minEntriesForStats: options?.anomalyConfig?.minEntriesForStats ?? 10,
      rateAnomalyZScore: options?.anomalyConfig?.rateAnomalyZScore ?? 3,
      checkFutureTimestamps: options?.anomalyConfig?.checkFutureTimestamps ?? true,
      futureTimestampGraceMs: options?.anomalyConfig?.futureTimestampGraceMs ?? 5000,
      suspiciousActorPatterns: options?.anomalyConfig?.suspiciousActorPatterns ?? [],
    }

    this.alertHandlers = new Map()
    if (options?.alertHandlers) {
      for (const [severity, handlers] of Object.entries(options.alertHandlers)) {
        if (handlers) {
          this.alertHandlers.set(severity as AlertSeverity, handlers)
        }
      }
    }

    this.defaultHandler = options?.defaultHandler
    this.metrics = options?.metrics ?? noopMetrics
  }

  /**
   * Register an alert handler for a specific severity
   */
  onAlert(severity: AlertSeverity, handler: AlertHandler): void {
    const handlers = this.alertHandlers.get(severity) ?? []
    handlers.push(handler)
    this.alertHandlers.set(severity, handlers)
  }

  /**
   * Dispatch an alert to registered handlers
   */
  private async dispatchAlert(alert: TamperAlert): Promise<void> {
    this.metrics.incrementCounter(TamperDetectionMetrics.ALERTS_GENERATED, {
      type: alert.type,
      severity: alert.severity,
    })

    // Call severity-specific handlers
    const handlers = this.alertHandlers.get(alert.severity) ?? []
    for (const handler of handlers) {
      try {
        await handler(alert)
      } catch (error) {
        // Log but don't throw - alert handling shouldn't break detection
        console.error(`Alert handler error for ${alert.type}:`, error)
      }
    }

    // Call default handler if set
    if (this.defaultHandler) {
      try {
        await this.defaultHandler(alert)
      } catch (error) {
        console.error(`Default alert handler error for ${alert.type}:`, error)
      }
    }
  }

  /**
   * Verify the hash chain integrity of an audit log
   */
  async verifyHashChain(log: VerifiableAuditLog): Promise<HashChainVerificationResult> {
    const startTime = performance.now()
    const alerts: TamperAlert[] = []
    const count = log.count()

    if (count === 0) {
      return {
        valid: true,
        entriesVerified: 0,
        alerts: [],
        verificationTimeMs: performance.now() - startTime,
      }
    }

    let valid = true
    let firstInvalidIndex: number | undefined
    let headHash: string | undefined

    for (let i = 0; i < count; i++) {
      const entry = log.getByIndex(i)
      if (!entry) {
        const alert = this.createAlert('deletion_detected', 'critical', `Entry at index ${i} is missing`, {
          index: i,
        })
        alerts.push(alert)
        await this.dispatchAlert(alert)
        valid = false
        if (firstInvalidIndex === undefined) firstInvalidIndex = i
        continue
      }

      // Verify index matches
      if (entry.index !== i) {
        const alert = this.createAlert(
          'index_gap',
          'critical',
          `Index mismatch at position ${i}: expected ${i}, got ${entry.index}`,
          { index: i, expected: String(i), actual: String(entry.index), entryId: entry.id }
        )
        alerts.push(alert)
        await this.dispatchAlert(alert)
        valid = false
        if (firstInvalidIndex === undefined) firstInvalidIndex = i
      }

      // Verify previous hash link
      const expectedPrevHash = i > 0 ? log.getByIndex(i - 1)?.hash ?? '' : ''
      if (entry.prevHash !== expectedPrevHash) {
        const alert = this.createAlert(
          'hash_chain_broken',
          'critical',
          `Hash chain broken at index ${i}: prevHash mismatch`,
          { index: i, expected: expectedPrevHash, actual: entry.prevHash, entryId: entry.id }
        )
        alerts.push(alert)
        await this.dispatchAlert(alert)
        this.metrics.incrementCounter(TamperDetectionMetrics.CHAIN_BREAKS_DETECTED)
        valid = false
        if (firstInvalidIndex === undefined) firstInvalidIndex = i
      }

      // Verify entry hash
      const hashableData = extractHashableData(entry)
      const timestamp = getTimestampMs(entry.timestamp)
      const computedHash = computeEntryHash(entry.prevHash, hashableData, timestamp)

      if (entry.hash !== computedHash) {
        const alert = this.createAlert(
          'hash_mismatch',
          'critical',
          `Hash mismatch at index ${i}: entry may have been modified`,
          { index: i, expected: computedHash, actual: entry.hash, entryId: entry.id }
        )
        alerts.push(alert)
        await this.dispatchAlert(alert)
        valid = false
        if (firstInvalidIndex === undefined) firstInvalidIndex = i
      }

      // Track head hash
      if (i === count - 1) {
        headHash = entry.hash
      }
    }

    const verificationTimeMs = performance.now() - startTime
    this.metrics.recordLatency(TamperDetectionMetrics.VERIFY_CHAIN_LATENCY, verificationTimeMs)

    return {
      valid,
      entriesVerified: count,
      alerts,
      firstInvalidIndex,
      verificationTimeMs,
      headHash,
    }
  }

  /**
   * Detect anomalies in audit log patterns
   */
  async detectAnomalies(log: VerifiableAuditLog): Promise<AnomalyDetectionResult> {
    const startTime = performance.now()
    const alerts: TamperAlert[] = []
    const count = log.count()

    const stats: AnomalyStats = {
      entriesAnalyzed: count,
      avgEntryIntervalMs: 0,
      stdDevIntervalMs: 0,
      uniqueActors: 0,
    }

    if (count === 0) {
      return { hasAnomalies: false, alerts, stats }
    }

    // Collect data for analysis
    const timestamps: number[] = []
    const intervals: number[] = []
    const actorCounts = new Map<string, number>()
    const seenIndices = new Set<number>()
    const now = Date.now()

    for (let i = 0; i < count; i++) {
      const entry = log.getByIndex(i)
      if (!entry) continue

      const timestamp = getTimestampMs(entry.timestamp)
      timestamps.push(timestamp)

      // Check for duplicate indices
      if (seenIndices.has(entry.index)) {
        const alert = this.createAlert(
          'index_duplicate',
          'high',
          `Duplicate index detected: ${entry.index}`,
          { index: entry.index, entryId: entry.id }
        )
        alerts.push(alert)
        await this.dispatchAlert(alert)
      }
      seenIndices.add(entry.index)

      // Calculate intervals
      if (i > 0) {
        const prevTimestamp = timestamps[i - 1]!
        const interval = timestamp - prevTimestamp
        intervals.push(interval)

        // Check for timestamp anomalies (going backwards)
        if (interval < 0) {
          const alert = this.createAlert(
            'timestamp_anomaly',
            'high',
            `Timestamp out of order at index ${i}: entry is ${Math.abs(interval)}ms before previous entry`,
            { index: i, entryId: entry.id, metadata: { interval } }
          )
          alerts.push(alert)
          await this.dispatchAlert(alert)
        }

        // Check for large gaps
        if (interval > this.anomalyConfig.maxTimestampGapMs) {
          const alert = this.createAlert(
            'timestamp_anomaly',
            'medium',
            `Large timestamp gap detected at index ${i}: ${Math.round(interval / 1000 / 60)} minutes`,
            { index: i, entryId: entry.id, metadata: { intervalMs: interval } }
          )
          alerts.push(alert)
          await this.dispatchAlert(alert)
        }
      }

      // Check for future timestamps
      if (this.anomalyConfig.checkFutureTimestamps) {
        const futureBy = timestamp - now
        if (futureBy > this.anomalyConfig.futureTimestampGraceMs) {
          const alert = this.createAlert(
            'timestamp_future',
            'high',
            `Entry at index ${i} has future timestamp: ${Math.round(futureBy / 1000)}s ahead`,
            { index: i, entryId: entry.id, metadata: { futureByMs: futureBy } }
          )
          alerts.push(alert)
          await this.dispatchAlert(alert)
        }
      }

      // Track actor activity
      const actorId = getActorId(entry.actor)
      if (actorId) {
        actorCounts.set(actorId, (actorCounts.get(actorId) ?? 0) + 1)

        // Check for suspicious actor patterns
        for (const pattern of this.anomalyConfig.suspiciousActorPatterns) {
          if (pattern.test(actorId)) {
            const alert = this.createAlert(
              'actor_anomaly',
              'medium',
              `Suspicious actor pattern detected: ${actorId}`,
              { index: i, entryId: entry.id, metadata: { actorId, pattern: pattern.source } }
            )
            alerts.push(alert)
            await this.dispatchAlert(alert)
          }
        }
      }
    }

    // Calculate statistics
    if (intervals.length > 0) {
      const sum = intervals.reduce((a, b) => a + b, 0)
      stats.avgEntryIntervalMs = sum / intervals.length
      stats.stdDevIntervalMs = calculateStdDev(intervals, stats.avgEntryIntervalMs)
    }

    stats.uniqueActors = actorCounts.size

    // Find most active actor
    let maxCount = 0
    for (const [actorId, count] of actorCounts) {
      if (count > maxCount) {
        maxCount = count
        stats.mostActiveActor = actorId
      }
    }

    // Calculate entries per minute
    if (timestamps.length >= 2) {
      const timeSpanMs = timestamps[timestamps.length - 1]! - timestamps[0]!
      if (timeSpanMs > 0) {
        stats.entriesPerMinute = (count / timeSpanMs) * 60 * 1000
      }
    }

    // Check for rate anomalies (if enough data)
    if (
      intervals.length >= this.anomalyConfig.minEntriesForStats &&
      stats.stdDevIntervalMs > 0
    ) {
      // Look for bursts (unusually short intervals)
      for (let i = 0; i < intervals.length; i++) {
        const zScore = (stats.avgEntryIntervalMs - intervals[i]!) / stats.stdDevIntervalMs
        if (zScore > this.anomalyConfig.rateAnomalyZScore) {
          const alert = this.createAlert(
            'rate_anomaly',
            'low',
            `Unusual burst of activity at index ${i + 1}: interval ${Math.round(intervals[i]!)}ms is ${zScore.toFixed(1)} standard deviations below average`,
            { index: i + 1, metadata: { intervalMs: intervals[i], zScore } }
          )
          alerts.push(alert)
          await this.dispatchAlert(alert)
        }
      }
    }

    // Check overall rate
    if (stats.entriesPerMinute && stats.entriesPerMinute > this.anomalyConfig.maxEntriesPerMinute) {
      const alert = this.createAlert(
        'rate_anomaly',
        'medium',
        `High entry rate detected: ${Math.round(stats.entriesPerMinute)} entries/minute exceeds threshold of ${this.anomalyConfig.maxEntriesPerMinute}`,
        { metadata: { entriesPerMinute: stats.entriesPerMinute } }
      )
      alerts.push(alert)
      await this.dispatchAlert(alert)
    }

    const detectionTimeMs = performance.now() - startTime
    this.metrics.recordLatency(TamperDetectionMetrics.DETECT_ANOMALIES_LATENCY, detectionTimeMs)

    if (alerts.length > 0) {
      this.metrics.incrementCounter(TamperDetectionMetrics.ANOMALIES_DETECTED, undefined, alerts.length)
    }

    return {
      hasAnomalies: alerts.length > 0,
      alerts,
      stats,
    }
  }

  /**
   * Generate a comprehensive integrity report
   */
  async generateIntegrityReport(log: VerifiableAuditLog): Promise<IntegrityReport> {
    const startTime = performance.now()

    // Run all checks
    const hashChainVerification = await this.verifyHashChain(log)
    const anomalyDetection = await this.detectAnomalies(log)

    // Combine all alerts
    const allAlerts = [...hashChainVerification.alerts, ...anomalyDetection.alerts]

    // Calculate summary
    const summary: IntegritySummary = {
      totalEntries: log.count(),
      criticalAlerts: allAlerts.filter((a) => a.severity === 'critical').length,
      highAlerts: allAlerts.filter((a) => a.severity === 'high').length,
      mediumAlerts: allAlerts.filter((a) => a.severity === 'medium').length,
      lowAlerts: allAlerts.filter((a) => a.severity === 'low').length,
      totalTimeMs: performance.now() - startTime,
    }

    // Determine overall status
    let status: 'healthy' | 'degraded' | 'compromised' = 'healthy'
    if (summary.criticalAlerts > 0) {
      status = 'compromised'
    } else if (summary.highAlerts > 0 || summary.mediumAlerts > 0) {
      status = 'degraded'
    }

    this.metrics.recordLatency(TamperDetectionMetrics.INTEGRITY_REPORT_LATENCY, summary.totalTimeMs)

    return {
      generatedAt: Date.now(),
      status,
      hashChainVerification,
      anomalyDetection,
      allAlerts,
      summary,
    }
  }

  /**
   * Create an alert object
   */
  private createAlert(
    type: TamperType,
    severity: AlertSeverity,
    message: string,
    options?: {
      index?: number
      entryId?: string
      expected?: string
      actual?: string
      metadata?: Record<string, unknown>
    }
  ): TamperAlert {
    return {
      id: generateAlertId(),
      type,
      severity,
      message,
      index: options?.index,
      entryId: options?.entryId,
      expected: options?.expected,
      actual: options?.actual,
      detectedAt: Date.now(),
      metadata: options?.metadata,
    }
  }
}

// =============================================================================
// CONTINUOUS MONITORING
// =============================================================================

/**
 * Configuration for continuous monitoring
 */
export interface ContinuousMonitorConfig {
  /** Interval between full checks in milliseconds (default: 5 minutes) */
  fullCheckIntervalMs?: number
  /** Whether to verify new entries immediately (default: true) */
  verifyOnAppend?: boolean
  /** Maximum entries to verify per incremental check (default: 100) */
  incrementalBatchSize?: number
}

/**
 * Monitor state for tracking verification progress
 */
export interface MonitorState {
  /** Last fully verified index */
  lastVerifiedIndex: number
  /** Last full check timestamp */
  lastFullCheck: number
  /** Number of entries verified since last full check */
  entriesVerifiedSinceFullCheck: number
  /** Whether monitoring is active */
  isActive: boolean
}

/**
 * ContinuousMonitor - Monitors audit log integrity over time
 */
export class ContinuousMonitor {
  private readonly detector: TamperDetector
  private readonly config: Required<ContinuousMonitorConfig>
  private state: MonitorState
  private fullCheckTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    detector: TamperDetector,
    config?: ContinuousMonitorConfig
  ) {
    this.detector = detector
    this.config = {
      fullCheckIntervalMs: config?.fullCheckIntervalMs ?? 5 * 60 * 1000, // 5 minutes
      verifyOnAppend: config?.verifyOnAppend ?? true,
      incrementalBatchSize: config?.incrementalBatchSize ?? 100,
    }
    this.state = {
      lastVerifiedIndex: -1,
      lastFullCheck: 0,
      entriesVerifiedSinceFullCheck: 0,
      isActive: false,
    }
  }

  /**
   * Start continuous monitoring
   */
  start(log: VerifiableAuditLog): void {
    if (this.state.isActive) return

    this.state.isActive = true

    // Run initial full check
    this.runFullCheck(log).catch(console.error)

    // Schedule periodic full checks
    this.fullCheckTimer = setInterval(() => {
      this.runFullCheck(log).catch(console.error)
    }, this.config.fullCheckIntervalMs)
  }

  /**
   * Stop continuous monitoring
   */
  stop(): void {
    this.state.isActive = false
    if (this.fullCheckTimer) {
      clearInterval(this.fullCheckTimer)
      this.fullCheckTimer = null
    }
  }

  /**
   * Get current monitor state
   */
  getState(): MonitorState {
    return { ...this.state }
  }

  /**
   * Verify a single new entry (for use after append)
   */
  async verifyNewEntry(log: VerifiableAuditLog, index: number): Promise<TamperAlert[]> {
    if (!this.config.verifyOnAppend) return []

    const entry = log.getByIndex(index)
    if (!entry) {
      return [{
        id: generateAlertId(),
        type: 'deletion_detected',
        severity: 'critical',
        message: `Entry at index ${index} not found during verification`,
        index,
        detectedAt: Date.now(),
      }]
    }

    const alerts: TamperAlert[] = []

    // Verify hash chain link
    if (index > 0) {
      const prevEntry = log.getByIndex(index - 1)
      if (prevEntry && entry.prevHash !== prevEntry.hash) {
        alerts.push({
          id: generateAlertId(),
          type: 'hash_chain_broken',
          severity: 'critical',
          message: `New entry at index ${index} has invalid prevHash`,
          index,
          entryId: entry.id,
          expected: prevEntry.hash,
          actual: entry.prevHash,
          detectedAt: Date.now(),
        })
      }
    }

    // Update state
    if (alerts.length === 0) {
      this.state.lastVerifiedIndex = Math.max(this.state.lastVerifiedIndex, index)
      this.state.entriesVerifiedSinceFullCheck++
    }

    return alerts
  }

  /**
   * Run incremental verification (verify new entries since last check)
   */
  async runIncrementalCheck(log: VerifiableAuditLog): Promise<TamperAlert[]> {
    const count = log.count()
    const startIndex = this.state.lastVerifiedIndex + 1
    const endIndex = Math.min(startIndex + this.config.incrementalBatchSize, count)

    if (startIndex >= count) {
      return [] // Nothing new to verify
    }

    const alerts: TamperAlert[] = []

    for (let i = startIndex; i < endIndex; i++) {
      const entryAlerts = await this.verifyNewEntry(log, i)
      alerts.push(...entryAlerts)
    }

    return alerts
  }

  /**
   * Run full verification check
   */
  private async runFullCheck(log: VerifiableAuditLog): Promise<IntegrityReport> {
    const report = await this.detector.generateIntegrityReport(log)

    this.state.lastFullCheck = Date.now()
    this.state.entriesVerifiedSinceFullCheck = 0

    if (report.status === 'healthy') {
      this.state.lastVerifiedIndex = log.count() - 1
    }

    return report
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a new TamperDetector instance
 *
 * @example
 * ```typescript
 * // Basic usage
 * const detector = createTamperDetector()
 *
 * // Verify hash chain
 * const result = await detector.verifyHashChain(auditLog)
 * if (!result.valid) {
 *   console.error('Tampering detected!', result.alerts)
 * }
 *
 * // Generate full integrity report
 * const report = await detector.generateIntegrityReport(auditLog)
 * console.log('Status:', report.status)
 * ```
 *
 * @example
 * ```typescript
 * // With alert handlers
 * const detector = createTamperDetector({
 *   alertHandlers: {
 *     critical: [
 *       (alert) => sendPagerDutyAlert(alert),
 *       (alert) => notifySecurityTeam(alert),
 *     ],
 *     high: [(alert) => logToSIEM(alert)],
 *   },
 *   defaultHandler: (alert) => console.warn('Tamper alert:', alert),
 * })
 * ```
 *
 * @example
 * ```typescript
 * // With custom anomaly detection
 * const detector = createTamperDetector({
 *   anomalyConfig: {
 *     maxTimestampGapMs: 30 * 60 * 1000, // 30 minutes
 *     maxEntriesPerMinute: 500,
 *     suspiciousActorPatterns: [/^admin/, /system/],
 *   },
 * })
 * ```
 */
export function createTamperDetector(options?: TamperDetectorOptions): TamperDetector {
  return new TamperDetector(options)
}

/**
 * Create a continuous monitor for an audit log
 *
 * @example
 * ```typescript
 * const detector = createTamperDetector()
 * const monitor = createContinuousMonitor(detector, {
 *   fullCheckIntervalMs: 10 * 60 * 1000, // 10 minutes
 *   verifyOnAppend: true,
 * })
 *
 * monitor.start(auditLog)
 *
 * // Later...
 * monitor.stop()
 * ```
 */
export function createContinuousMonitor(
  detector: TamperDetector,
  config?: ContinuousMonitorConfig
): ContinuousMonitor {
  return new ContinuousMonitor(detector, config)
}
