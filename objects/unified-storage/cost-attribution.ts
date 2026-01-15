/**
 * Cost Attribution - Per-Tenant Cost Tracking for UnifiedStoreDO
 *
 * Provides comprehensive cost tracking across all storage operations:
 * - Write tracking per tenant with operation and entity type breakdown
 * - Read tracking with cache hit/miss differentiation
 * - Pipeline event tracking by event type
 * - SQLite operation tracking including checkpoint counts
 * - Cost calculation based on configurable pricing model
 * - Cost alerts with warning/critical thresholds
 * - Historical data retention with hourly/daily summaries
 * - Prometheus metrics export for cost monitoring
 *
 * @module objects/unified-storage/cost-attribution
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Cost alert configuration for a tenant
 */
export interface CostAlertConfig {
  tenantId: string
  thresholds: {
    warning: number
    critical: number
  }
  enabled: boolean
}

/**
 * Cost alert event emitted when threshold exceeded
 */
export interface CostAlertEvent {
  tenantId: string
  level: 'warning' | 'critical'
  threshold: number
  currentCost: number
  timestamp: number
}

/**
 * Write metrics for a tenant
 */
export interface WriteMetrics {
  count: number
  bytes: number
  cost: number
  byOperationType: {
    create: number
    update: number
    delete: number
  }
  byEntityType: Record<string, number>
}

/**
 * Read metrics for a tenant
 */
export interface ReadMetrics {
  count: number
  bytes: number
  cost: number
  cacheHits: number
  cacheMisses: number
  byEntityType: Record<string, number>
}

/**
 * Pipeline metrics for a tenant
 */
export interface PipelineMetrics {
  eventsEmitted: number
  bytesEmitted: number
  cost: number
  byEventType: Record<string, number>
}

/**
 * SQLite metrics for a tenant
 */
export interface SqliteMetrics {
  queryCount: number
  rowsAffected: number
  storageBytes: number
  checkpointCount: number
  cost: number
}

/**
 * Complete tenant cost report
 */
export interface TenantCostReport {
  tenantId: string
  totalCost: number
  writes: WriteMetrics
  reads: ReadMetrics
  pipeline: PipelineMetrics
  sqlite: SqliteMetrics
  period: {
    start: string
    end: string
  }
}

/**
 * Historical cost record for retention
 */
export interface HistoricalCostRecord {
  period: string
  tenantId: string
  totalCost: number
  writes: WriteMetrics
  reads: ReadMetrics
  pipeline: PipelineMetrics
  sqlite: SqliteMetrics
}

/**
 * Time-filtered cost metrics entry
 */
interface TimestampedMetric {
  timestamp: number
  bytes: number
  entityType?: string
  operationType?: 'create' | 'update' | 'delete'
  eventType?: string
  cacheHit?: boolean
}

/**
 * Alert callback type
 */
type AlertCallback = (event: CostAlertEvent) => void

/**
 * Retention policy configuration
 */
export interface RetentionPolicy {
  hourly: number // days to retain hourly data
  daily: number // days to retain daily data
}

/**
 * Historical data options
 */
export interface HistoricalDataOptions {
  start?: Date
  end?: Date
}

// ============================================================================
// PRICING MODEL
// ============================================================================

/**
 * Default pricing model (per-operation costs)
 */
const DEFAULT_PRICING = {
  // Write costs
  writePerOperation: 0.000001, // $0.000001 per write
  writePerByte: 0.00000001, // $0.00000001 per byte written

  // Read costs
  readPerOperation: 0.0000001, // $0.0000001 per read
  readPerByte: 0.000000001, // $0.000000001 per byte read

  // Pipeline costs
  pipelinePerEvent: 0.00001, // $0.00001 per event
  pipelinePerByte: 0.0000001, // $0.0000001 per byte

  // SQLite costs
  sqlitePerQuery: 0.000001, // $0.000001 per query
  sqlitePerRow: 0.0000001, // $0.0000001 per row
  sqlitePerByteStored: 0.000000001, // $0.000000001 per byte stored
  sqlitePerCheckpoint: 0.00001, // $0.00001 per checkpoint
}

// ============================================================================
// COST METRICS COLLECTOR
// ============================================================================

/**
 * CostMetricsCollector - Per-tenant cost tracking
 *
 * Tracks all storage operations and calculates costs based on a pricing model.
 * Supports alerts, historical data, and Prometheus metrics export.
 *
 * @example
 * ```typescript
 * const collector = new CostMetricsCollector('tenant-1')
 *
 * // Track operations
 * collector.trackWrite('create', 'Customer', 1024)
 * collector.trackRead('Customer', 512, true) // cache hit
 * collector.trackPipelineEvent('thing.created', 256)
 * collector.trackSqliteOp(1, 1024)
 *
 * // Get cost report
 * const report = collector.getTenantReport('tenant-1')
 * console.log(report.totalCost)
 * ```
 */
export class CostMetricsCollector {
  private tenantId: string
  private pricing = DEFAULT_PRICING

  // Current period metrics
  private writes: TimestampedMetric[] = []
  private reads: TimestampedMetric[] = []
  private pipelineEvents: TimestampedMetric[] = []
  private sqliteOps: Array<{
    timestamp: number
    queryCount: number
    rows: number
    bytes: number
    isCheckpoint: boolean
  }> = []

  // Alert configuration
  private alertConfig: CostAlertConfig | null = null
  private alertCallbacks: AlertCallback[] = []
  private alertsTriggered: Set<'warning' | 'critical'> = new Set()

  // Historical data
  private hourlyHistory: HistoricalCostRecord[] = []
  private dailyHistory: HistoricalCostRecord[] = []
  private retentionPolicy: RetentionPolicy = { hourly: 7, daily: 90 }

  // Period tracking
  private periodStart: number

  // Track entities that have been read (for cache hit/miss tracking)
  private readHistory: Set<string> = new Set()

  // Track the current hour/day for period-based snapshots
  private currentHourKey: string = ''
  private currentDayKey: string = ''

  constructor(tenantId: string) {
    this.tenantId = tenantId
    this.periodStart = Date.now()
    this.updateTimeKeys()
  }

  /**
   * Update time keys and snapshot if period changed
   */
  private updateTimeKeys(): void {
    const now = new Date()
    const newHourKey = now.toISOString().slice(0, 13) + ':00:00.000Z'
    const newDayKey = now.toISOString().slice(0, 10) + 'T00:00:00.000Z'

    // If hour changed, snapshot previous hour's data
    if (this.currentHourKey && this.currentHourKey !== newHourKey) {
      this.snapshotHour(this.currentHourKey)
    }

    // If day changed, snapshot previous day's data
    if (this.currentDayKey && this.currentDayKey !== newDayKey) {
      this.snapshotDay(this.currentDayKey)
    }

    this.currentHourKey = newHourKey
    this.currentDayKey = newDayKey
  }

  /**
   * Snapshot metrics for a specific hour
   */
  private snapshotHour(hourKey: string): void {
    const report = this.buildCurrentReport()
    if (!report) return

    const record: HistoricalCostRecord = {
      period: hourKey,
      tenantId: this.tenantId,
      totalCost: report.totalCost,
      writes: { ...report.writes },
      reads: { ...report.reads },
      pipeline: { ...report.pipeline },
      sqlite: { ...report.sqlite },
    }

    // Check if record for this hour exists
    const existingIndex = this.hourlyHistory.findIndex((r) => r.period === hourKey)
    if (existingIndex >= 0) {
      this.hourlyHistory[existingIndex] = record
    } else {
      this.hourlyHistory.push(record)
    }
  }

  /**
   * Snapshot metrics for a specific day
   */
  private snapshotDay(dayKey: string): void {
    const report = this.buildCurrentReport()
    if (!report) return

    const record: HistoricalCostRecord = {
      period: dayKey,
      tenantId: this.tenantId,
      totalCost: report.totalCost,
      writes: { ...report.writes },
      reads: { ...report.reads },
      pipeline: { ...report.pipeline },
      sqlite: { ...report.sqlite },
    }

    // Check if record for this day exists
    const existingIndex = this.dailyHistory.findIndex((r) => r.period === dayKey)
    if (existingIndex >= 0) {
      this.dailyHistory[existingIndex] = record
    } else {
      this.dailyHistory.push(record)
    }
  }

  /**
   * Build current report without time filtering
   */
  private buildCurrentReport(): TenantCostReport | null {
    const writeMetrics = this.buildWriteMetrics(this.writes)
    const readMetrics = this.buildReadMetrics(this.reads)
    const pipelineMetrics = this.buildPipelineMetrics(this.pipelineEvents)
    const sqliteMetrics = this.buildSqliteMetrics(this.sqliteOps)

    const totalCost = writeMetrics.cost + readMetrics.cost + pipelineMetrics.cost + sqliteMetrics.cost

    return {
      tenantId: this.tenantId,
      totalCost,
      writes: writeMetrics,
      reads: readMetrics,
      pipeline: pipelineMetrics,
      sqlite: sqliteMetrics,
      period: {
        start: new Date(this.periodStart).toISOString(),
        end: new Date().toISOString(),
      },
    }
  }

  // ==========================================================================
  // TRACKING METHODS
  // ==========================================================================

  /**
   * Track a write operation
   */
  trackWrite(operationType: 'create' | 'update' | 'delete', entityType: string, bytes: number): void {
    // Check if time period changed and snapshot if needed
    this.updateTimeKeys()

    this.writes.push({
      timestamp: Date.now(),
      bytes,
      entityType,
      operationType,
    })

    this.checkAlerts()
  }

  /**
   * Track a read operation
   */
  trackRead(entityType: string, bytes: number, cacheHit: boolean): void {
    // Check if time period changed and snapshot if needed
    this.updateTimeKeys()

    this.reads.push({
      timestamp: Date.now(),
      bytes,
      entityType,
      cacheHit,
    })

    this.checkAlerts()
  }

  /**
   * Track a pipeline event
   */
  trackPipelineEvent(eventType: string, bytes: number): void {
    // Check if time period changed and snapshot if needed
    this.updateTimeKeys()

    this.pipelineEvents.push({
      timestamp: Date.now(),
      bytes,
      eventType,
    })

    this.checkAlerts()
  }

  /**
   * Track a SQLite operation
   */
  trackSqliteOp(rows: number, bytes: number, queryCount: number = 1, isCheckpoint: boolean = false): void {
    // Check if time period changed and snapshot if needed
    this.updateTimeKeys()

    this.sqliteOps.push({
      timestamp: Date.now(),
      queryCount,
      rows,
      bytes,
      isCheckpoint,
    })

    this.checkAlerts()
  }

  /**
   * Track a checkpoint operation
   */
  trackCheckpoint(rows: number, bytes: number): void {
    this.trackSqliteOp(rows, bytes, 1, true)
  }

  // ==========================================================================
  // COST CALCULATION
  // ==========================================================================

  /**
   * Calculate write cost
   */
  private calculateWriteCost(metrics: TimestampedMetric[]): number {
    return metrics.reduce((total, m) => {
      return total + this.pricing.writePerOperation + m.bytes * this.pricing.writePerByte
    }, 0)
  }

  /**
   * Calculate read cost
   */
  private calculateReadCost(metrics: TimestampedMetric[]): number {
    return metrics.reduce((total, m) => {
      return total + this.pricing.readPerOperation + m.bytes * this.pricing.readPerByte
    }, 0)
  }

  /**
   * Calculate pipeline cost
   */
  private calculatePipelineCost(metrics: TimestampedMetric[]): number {
    return metrics.reduce((total, m) => {
      return total + this.pricing.pipelinePerEvent + m.bytes * this.pricing.pipelinePerByte
    }, 0)
  }

  /**
   * Calculate SQLite cost
   */
  private calculateSqliteCost(
    ops: Array<{ queryCount: number; rows: number; bytes: number; isCheckpoint: boolean }>
  ): number {
    return ops.reduce((total, op) => {
      let cost = op.queryCount * this.pricing.sqlitePerQuery
      cost += op.rows * this.pricing.sqlitePerRow
      cost += op.bytes * this.pricing.sqlitePerByteStored
      if (op.isCheckpoint) {
        cost += this.pricing.sqlitePerCheckpoint
      }
      return total + cost
    }, 0)
  }

  // ==========================================================================
  // REPORT GENERATION
  // ==========================================================================

  /**
   * Get tenant cost report
   */
  getTenantReport(tenantId: string, options?: { start?: Date; end?: Date }): TenantCostReport | null {
    if (tenantId !== this.tenantId) {
      return null
    }

    // Filter by time range if provided
    const start = options?.start?.getTime() ?? this.periodStart
    const end = options?.end?.getTime() ?? Date.now()

    const filteredWrites = this.writes.filter((m) => m.timestamp >= start && m.timestamp <= end)
    const filteredReads = this.reads.filter((m) => m.timestamp >= start && m.timestamp <= end)
    const filteredPipeline = this.pipelineEvents.filter((m) => m.timestamp >= start && m.timestamp <= end)
    const filteredSqlite = this.sqliteOps.filter((op) => op.timestamp >= start && op.timestamp <= end)

    // Calculate write metrics
    const writeMetrics = this.buildWriteMetrics(filteredWrites)

    // Calculate read metrics
    const readMetrics = this.buildReadMetrics(filteredReads)

    // Calculate pipeline metrics
    const pipelineMetrics = this.buildPipelineMetrics(filteredPipeline)

    // Calculate SQLite metrics
    const sqliteMetrics = this.buildSqliteMetrics(filteredSqlite)

    // Calculate total cost
    const totalCost = writeMetrics.cost + readMetrics.cost + pipelineMetrics.cost + sqliteMetrics.cost

    return {
      tenantId: this.tenantId,
      totalCost,
      writes: writeMetrics,
      reads: readMetrics,
      pipeline: pipelineMetrics,
      sqlite: sqliteMetrics,
      period: {
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
      },
    }
  }

  /**
   * Build write metrics from raw data
   */
  private buildWriteMetrics(writes: TimestampedMetric[]): WriteMetrics {
    const byOperationType = { create: 0, update: 0, delete: 0 }
    const byEntityType: Record<string, number> = {}
    let totalBytes = 0

    for (const w of writes) {
      if (w.operationType) {
        byOperationType[w.operationType]++
      }
      if (w.entityType) {
        byEntityType[w.entityType] = (byEntityType[w.entityType] ?? 0) + 1
      }
      totalBytes += w.bytes
    }

    return {
      count: writes.length,
      bytes: totalBytes,
      cost: this.calculateWriteCost(writes),
      byOperationType,
      byEntityType,
    }
  }

  /**
   * Build read metrics from raw data
   */
  private buildReadMetrics(reads: TimestampedMetric[]): ReadMetrics {
    const byEntityType: Record<string, number> = {}
    let totalBytes = 0
    let cacheHits = 0
    let cacheMisses = 0

    for (const r of reads) {
      if (r.entityType) {
        byEntityType[r.entityType] = (byEntityType[r.entityType] ?? 0) + 1
      }
      totalBytes += r.bytes
      if (r.cacheHit) {
        cacheHits++
      } else {
        cacheMisses++
      }
    }

    return {
      count: reads.length,
      bytes: totalBytes,
      cost: this.calculateReadCost(reads),
      cacheHits,
      cacheMisses,
      byEntityType,
    }
  }

  /**
   * Build pipeline metrics from raw data
   */
  private buildPipelineMetrics(events: TimestampedMetric[]): PipelineMetrics {
    const byEventType: Record<string, number> = {}
    let totalBytes = 0

    for (const e of events) {
      if (e.eventType) {
        byEventType[e.eventType] = (byEventType[e.eventType] ?? 0) + 1
      }
      totalBytes += e.bytes
    }

    return {
      eventsEmitted: events.length,
      bytesEmitted: totalBytes,
      cost: this.calculatePipelineCost(events),
      byEventType,
    }
  }

  /**
   * Build SQLite metrics from raw data
   */
  private buildSqliteMetrics(
    ops: Array<{ queryCount: number; rows: number; bytes: number; isCheckpoint: boolean }>
  ): SqliteMetrics {
    let queryCount = 0
    let rowsAffected = 0
    let storageBytes = 0
    let checkpointCount = 0

    for (const op of ops) {
      queryCount += op.queryCount
      rowsAffected += op.rows
      storageBytes += op.bytes
      if (op.isCheckpoint) {
        checkpointCount++
      }
    }

    return {
      queryCount,
      rowsAffected,
      storageBytes,
      checkpointCount,
      cost: this.calculateSqliteCost(ops),
    }
  }

  // ==========================================================================
  // ALERTS
  // ==========================================================================

  /**
   * Set alert configuration for the tenant
   */
  setAlertConfig(config: CostAlertConfig): void {
    if (config.tenantId === this.tenantId) {
      this.alertConfig = config
      this.alertsTriggered.clear() // Reset triggered alerts
    }
  }

  /**
   * Get alert configuration
   */
  getAlertConfig(tenantId: string): CostAlertConfig | null {
    if (tenantId !== this.tenantId) return null
    return this.alertConfig
  }

  /**
   * Register alert callback
   */
  onAlert(callback: AlertCallback): void {
    this.alertCallbacks.push(callback)
  }

  /**
   * Check if alerts should be triggered
   */
  private checkAlerts(): void {
    if (!this.alertConfig || !this.alertConfig.enabled) {
      return
    }

    const report = this.getTenantReport(this.tenantId)
    if (!report) return

    const currentCost = report.totalCost

    // Check critical threshold first
    if (currentCost >= this.alertConfig.thresholds.critical && !this.alertsTriggered.has('critical')) {
      this.alertsTriggered.add('critical')
      this.emitAlert('critical', this.alertConfig.thresholds.critical, currentCost)
    }
    // Check warning threshold
    else if (currentCost >= this.alertConfig.thresholds.warning && !this.alertsTriggered.has('warning')) {
      this.alertsTriggered.add('warning')
      this.emitAlert('warning', this.alertConfig.thresholds.warning, currentCost)
    }
  }

  /**
   * Emit an alert event
   */
  private emitAlert(level: 'warning' | 'critical', threshold: number, currentCost: number): void {
    const event: CostAlertEvent = {
      tenantId: this.tenantId,
      level,
      threshold,
      currentCost,
      timestamp: Date.now(),
    }

    for (const callback of this.alertCallbacks) {
      callback(event)
    }
  }

  // ==========================================================================
  // HISTORICAL DATA
  // ==========================================================================

  /**
   * Get historical cost data
   */
  getHistoricalData(
    tenantId: string,
    granularity: 'hourly' | 'daily',
    options?: HistoricalDataOptions
  ): HistoricalCostRecord[] {
    if (tenantId !== this.tenantId) return []

    // Snapshot current data to ensure we have the latest
    this.snapshotCurrentPeriod()

    const history = granularity === 'hourly' ? [...this.hourlyHistory] : [...this.dailyHistory]

    // Sort by period
    history.sort((a, b) => a.period.localeCompare(b.period))

    if (!options?.start && !options?.end) {
      return history
    }

    const start = options.start?.getTime() ?? 0
    const end = options.end?.getTime() ?? Infinity

    return history.filter((record) => {
      const recordTime = new Date(record.period).getTime()
      return recordTime >= start && recordTime <= end
    })
  }

  /**
   * Snapshot current period's data to history
   */
  private snapshotCurrentPeriod(): void {
    // First update time keys to current time
    const now = new Date()
    this.currentHourKey = now.toISOString().slice(0, 13) + ':00:00.000Z'
    this.currentDayKey = now.toISOString().slice(0, 10) + 'T00:00:00.000Z'

    // Snapshot current hour and day
    if (this.currentHourKey) {
      this.snapshotHour(this.currentHourKey)
    }
    if (this.currentDayKey) {
      this.snapshotDay(this.currentDayKey)
    }
  }

  /**
   * Set retention policy
   */
  setRetentionPolicy(policy: RetentionPolicy): void {
    this.retentionPolicy = policy
  }

  /**
   * Clean up old historical data based on retention policy
   */
  async cleanupOldData(): Promise<void> {
    const now = Date.now()
    const hourlyRetentionMs = this.retentionPolicy.hourly * 24 * 60 * 60 * 1000
    const dailyRetentionMs = this.retentionPolicy.daily * 24 * 60 * 60 * 1000

    this.hourlyHistory = this.hourlyHistory.filter((record) => {
      const recordTime = new Date(record.period).getTime()
      return now - recordTime <= hourlyRetentionMs
    })

    this.dailyHistory = this.dailyHistory.filter((record) => {
      const recordTime = new Date(record.period).getTime()
      return now - recordTime <= dailyRetentionMs
    })
  }

  // ==========================================================================
  // PROMETHEUS EXPORT
  // ==========================================================================

  /**
   * Export cost metrics in Prometheus format
   */
  exportPrometheusMetrics(): string {
    const report = this.getTenantReport(this.tenantId)
    if (!report) return ''

    const lines: string[] = []
    const ns = this.tenantId

    // Total cost gauge
    lines.push('# HELP dotdo_tenant_cost_total Total cost incurred by tenant in dollars')
    lines.push('# TYPE dotdo_tenant_cost_total gauge')
    lines.push(`dotdo_tenant_cost_total{namespace="${ns}"} ${report.totalCost}`)

    // Writes cost gauge
    lines.push('# HELP dotdo_tenant_writes_cost Cost of write operations in dollars')
    lines.push('# TYPE dotdo_tenant_writes_cost gauge')
    lines.push(`dotdo_tenant_writes_cost{namespace="${ns}"} ${report.writes.cost}`)

    // Reads cost gauge
    lines.push('# HELP dotdo_tenant_reads_cost Cost of read operations in dollars')
    lines.push('# TYPE dotdo_tenant_reads_cost gauge')
    lines.push(`dotdo_tenant_reads_cost{namespace="${ns}"} ${report.reads.cost}`)

    // Pipeline cost gauge
    lines.push('# HELP dotdo_tenant_pipeline_cost Cost of pipeline events in dollars')
    lines.push('# TYPE dotdo_tenant_pipeline_cost gauge')
    lines.push(`dotdo_tenant_pipeline_cost{namespace="${ns}"} ${report.pipeline.cost}`)

    // SQLite cost gauge
    lines.push('# HELP dotdo_tenant_sqlite_cost Cost of SQLite operations in dollars')
    lines.push('# TYPE dotdo_tenant_sqlite_cost gauge')
    lines.push(`dotdo_tenant_sqlite_cost{namespace="${ns}"} ${report.sqlite.cost}`)

    // Writes total counter
    lines.push('# HELP dotdo_tenant_writes_total Total write operations by tenant')
    lines.push('# TYPE dotdo_tenant_writes_total counter')
    lines.push(`dotdo_tenant_writes_total{namespace="${ns}"} ${report.writes.count}`)

    // Reads total counter
    lines.push('# HELP dotdo_tenant_reads_total Total read operations by tenant')
    lines.push('# TYPE dotdo_tenant_reads_total counter')
    lines.push(`dotdo_tenant_reads_total{namespace="${ns}"} ${report.reads.count}`)

    // Operation cost histogram
    this.exportOperationCostHistogram(lines, ns)

    return lines.join('\n')
  }

  /**
   * Export operation cost histogram
   */
  private exportOperationCostHistogram(lines: string[], namespace: string): void {
    lines.push('# HELP dotdo_tenant_operation_cost Cost distribution of operations')
    lines.push('# TYPE dotdo_tenant_operation_cost histogram')

    // Calculate cost per operation for buckets
    const operationCosts: number[] = []

    for (const w of this.writes) {
      const cost = this.pricing.writePerOperation + w.bytes * this.pricing.writePerByte
      operationCosts.push(cost)
    }

    for (const r of this.reads) {
      const cost = this.pricing.readPerOperation + r.bytes * this.pricing.readPerByte
      operationCosts.push(cost)
    }

    for (const e of this.pipelineEvents) {
      const cost = this.pricing.pipelinePerEvent + e.bytes * this.pricing.pipelinePerByte
      operationCosts.push(cost)
    }

    // Define buckets for cost histogram (in dollars)
    const buckets = [0.000001, 0.00001, 0.0001, 0.001, 0.01, 0.1, 1]
    let cumulative = 0
    let sum = 0

    for (const bucket of buckets) {
      const count = operationCosts.filter((c) => c <= bucket).length
      lines.push(`dotdo_tenant_operation_cost_bucket{namespace="${namespace}",le="${bucket}"} ${count}`)
      cumulative = count
    }

    // +Inf bucket
    lines.push(`dotdo_tenant_operation_cost_bucket{namespace="${namespace}",le="+Inf"} ${operationCosts.length}`)

    // Sum and count
    sum = operationCosts.reduce((a, b) => a + b, 0)
    lines.push(`dotdo_tenant_operation_cost_sum{namespace="${namespace}"} ${sum}`)
    lines.push(`dotdo_tenant_operation_cost_count{namespace="${namespace}"} ${operationCosts.length}`)
  }

  // ==========================================================================
  // PERSISTENCE
  // ==========================================================================

  /**
   * Serialize state for persistence (hibernation survival)
   */
  serialize(): string {
    return JSON.stringify({
      tenantId: this.tenantId,
      periodStart: this.periodStart,
      writes: this.writes,
      reads: this.reads,
      pipelineEvents: this.pipelineEvents,
      sqliteOps: this.sqliteOps,
      alertConfig: this.alertConfig,
      alertsTriggered: Array.from(this.alertsTriggered),
      hourlyHistory: this.hourlyHistory,
      dailyHistory: this.dailyHistory,
      retentionPolicy: this.retentionPolicy,
    })
  }

  /**
   * Deserialize state from persistence
   */
  deserialize(data: string): void {
    try {
      const parsed = JSON.parse(data)

      if (parsed.tenantId === this.tenantId) {
        this.periodStart = parsed.periodStart ?? this.periodStart
        this.writes = parsed.writes ?? []
        this.reads = parsed.reads ?? []
        this.pipelineEvents = parsed.pipelineEvents ?? []
        this.sqliteOps = parsed.sqliteOps ?? []
        this.alertConfig = parsed.alertConfig ?? null
        this.alertsTriggered = new Set(parsed.alertsTriggered ?? [])
        this.hourlyHistory = parsed.hourlyHistory ?? []
        this.dailyHistory = parsed.dailyHistory ?? []
        this.retentionPolicy = parsed.retentionPolicy ?? { hourly: 7, daily: 90 }
      }
    } catch {
      // Ignore deserialization errors, start fresh
    }
  }

  /**
   * Reset all metrics for a new period
   */
  reset(): void {
    this.writes = []
    this.reads = []
    this.pipelineEvents = []
    this.sqliteOps = []
    this.alertsTriggered.clear()
    this.periodStart = Date.now()
  }
}
