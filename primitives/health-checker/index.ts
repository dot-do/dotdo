/**
 * HealthChecker - Comprehensive Health Monitoring Primitives
 *
 * Provides health monitoring capabilities:
 * - HealthChecker: Central health check orchestrator
 * - HTTPChecker: HTTP endpoint health checks
 * - DatabaseChecker: Database connectivity checks
 * - DiskChecker: Disk space checks
 * - MemoryChecker: Memory usage checks
 * - CustomChecker: Custom check functions
 * - AlertManager: Alert on unhealthy states
 * - HistoryTracker: Track health over time
 */

export * from './types'

import type {
  HealthCheck,
  HealthReport,
  CheckResult,
  HealthStatus,
  StatusChangeEvent,
  AlertConfig,
  AlertChannel,
  HTTPCheckerConfig,
  DatabaseCheckerConfig,
  DiskCheckerConfig,
  MemoryCheckerConfig,
  CustomCheckerFn,
  IHealthChecker,
  IAlertManager,
  IHistoryTracker,
  HealthTrend,
  HealthHistory,
  TrendDirection,
} from './types'

// =============================================================================
// HealthChecker Options
// =============================================================================

export interface HealthCheckerOptions {
  /** Default timeout for checks in milliseconds */
  defaultTimeout?: number
  /** Version string for reports */
  version?: string
}

// =============================================================================
// HealthChecker Implementation
// =============================================================================

export class HealthChecker implements IHealthChecker {
  private checks = new Map<string, HealthCheck>()
  private lastReport: HealthReport | null = null
  private currentStatus: HealthStatus = 'healthy'
  private statusChangeCallbacks: Array<(event: StatusChangeEvent) => void> = []
  private running = false
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map()
  private defaultInterval = 30000

  constructor(private options: HealthCheckerOptions = {}) {}

  register(check: HealthCheck): void {
    if (this.checks.has(check.name)) {
      throw new Error(`Check with name "${check.name}" already exists`)
    }
    this.checks.set(check.name, check)
  }

  unregister(name: string): void {
    this.checks.delete(name)
    const timer = this.timers.get(name)
    if (timer) {
      clearInterval(timer)
      this.timers.delete(name)
    }
  }

  async check(): Promise<HealthReport> {
    const startTime = Date.now()
    const results: CheckResult[] = []
    const checkResults = new Map<string, CheckResult>()

    // Run checks in dependency order
    const pendingChecks = new Set(this.checks.keys())

    while (pendingChecks.size > 0) {
      const batch: string[] = []

      for (const name of pendingChecks) {
        const check = this.checks.get(name)!
        const deps = check.dependencies ?? []

        // Check if all dependencies are resolved
        const depsResolved = deps.every(dep => checkResults.has(dep))
        if (depsResolved) {
          batch.push(name)
        }
      }

      // If no checks can run, break to avoid infinite loop
      if (batch.length === 0) {
        // Mark remaining checks as failed due to missing deps
        for (const name of pendingChecks) {
          const check = this.checks.get(name)!
          results.push({
            name,
            status: 'unhealthy',
            duration: 0,
            message: 'Missing or circular dependency',
            timestamp: Date.now(),
          })
          checkResults.set(name, results[results.length - 1])
        }
        break
      }

      // Run batch of checks
      for (const name of batch) {
        pendingChecks.delete(name)
        const check = this.checks.get(name)!
        const deps = check.dependencies ?? []

        // Check if any dependency failed
        const depFailed = deps.some(dep => {
          const depResult = checkResults.get(dep)
          return depResult?.status === 'unhealthy'
        })

        if (depFailed) {
          const result: CheckResult = {
            name,
            status: 'unhealthy',
            duration: 0,
            message: 'Skipped: dependency unhealthy',
            timestamp: Date.now(),
          }
          results.push(result)
          checkResults.set(name, result)
          continue
        }

        // Run the check
        const result = await this.runCheck(check)
        results.push(result)
        checkResults.set(name, result)
      }
    }

    const overallStatus = this.calculateOverallStatus(results)
    const previousStatus = this.currentStatus

    const report: HealthReport = {
      status: overallStatus,
      checks: results,
      timestamp: Date.now(),
      duration: Date.now() - startTime,
      version: this.options.version,
    }

    this.lastReport = report
    this.currentStatus = overallStatus

    // Emit status change event if status changed
    if (previousStatus !== overallStatus) {
      const triggeredBy = results.find(r => r.status !== 'healthy')?.name
      const event: StatusChangeEvent = {
        previousStatus,
        newStatus: overallStatus,
        timestamp: Date.now(),
        triggeredBy,
        report,
      }
      this.statusChangeCallbacks.forEach(cb => cb(event))
    }

    return report
  }

  async checkOne(name: string): Promise<CheckResult> {
    const check = this.checks.get(name)
    if (!check) {
      throw new Error(`Check with name "${name}" not found`)
    }
    return this.runCheck(check)
  }

  getStatus(): HealthStatus {
    return this.currentStatus
  }

  getReport(): HealthReport {
    return this.lastReport ?? {
      status: 'healthy',
      checks: [],
      timestamp: Date.now(),
    }
  }

  start(interval?: number): void {
    if (this.running) return
    this.running = true

    const defaultInterval = interval ?? this.defaultInterval

    for (const [name, check] of this.checks) {
      const checkInterval = check.interval ?? defaultInterval
      const timer = setInterval(async () => {
        try {
          const result = await this.runCheck(check)
          // Update cached report with this check's result
          if (this.lastReport) {
            const idx = this.lastReport.checks.findIndex(c => c.name === name)
            if (idx >= 0) {
              this.lastReport.checks[idx] = result
            } else {
              this.lastReport.checks.push(result)
            }
            this.lastReport.status = this.calculateOverallStatus(this.lastReport.checks)
          }
        } catch {
          // Ignore errors in background monitoring
        }
      }, checkInterval)
      this.timers.set(name, timer)
    }
  }

  stop(): void {
    this.running = false
    for (const timer of this.timers.values()) {
      clearInterval(timer)
    }
    this.timers.clear()
  }

  onStatusChange(callback: (event: StatusChangeEvent) => void): () => void {
    this.statusChangeCallbacks.push(callback)
    return () => {
      const idx = this.statusChangeCallbacks.indexOf(callback)
      if (idx >= 0) {
        this.statusChangeCallbacks.splice(idx, 1)
      }
    }
  }

  getChecks(): string[] {
    return Array.from(this.checks.keys())
  }

  isRunning(): boolean {
    return this.running
  }

  private async runCheck(check: HealthCheck): Promise<CheckResult> {
    const startTime = Date.now()
    const timeout = check.timeout ?? this.options.defaultTimeout ?? 30000

    try {
      const result = await Promise.race([
        Promise.resolve(check.checker()),
        new Promise<CheckResult>((_, reject) => {
          setTimeout(() => reject(new Error('Check timeout')), timeout)
        }),
      ])

      return {
        ...result,
        timestamp: Date.now(),
        duration: Date.now() - startTime,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return {
        name: check.name,
        status: 'unhealthy',
        duration: Date.now() - startTime,
        message: message.includes('timeout') ? `Check timed out after ${timeout}ms` : message,
        timestamp: Date.now(),
      }
    }
  }

  private calculateOverallStatus(results: CheckResult[]): HealthStatus {
    let hasDegraded = false

    for (const result of results) {
      const check = this.checks.get(result.name)
      const isCritical = check?.critical ?? false

      if (result.status === 'unhealthy') {
        if (isCritical) {
          return 'unhealthy'
        }
        hasDegraded = true
      } else if (result.status === 'degraded') {
        hasDegraded = true
      }
    }

    return hasDegraded ? 'degraded' : 'healthy'
  }
}

// =============================================================================
// HTTPChecker Implementation
// =============================================================================

export class HTTPChecker {
  constructor(private config: HTTPCheckerConfig) {}

  async check(): Promise<CheckResult> {
    const startTime = Date.now()
    const method = this.config.method ?? 'GET'
    const expectedStatus = this.config.expectedStatus ?? [200]

    try {
      const response = await fetch(this.config.url, {
        method,
        headers: this.config.headers,
        body: this.config.body,
        signal: this.config.timeout
          ? AbortSignal.timeout(this.config.timeout)
          : undefined,
      })

      const status = response.status
      const isHealthy = expectedStatus.includes(status)

      return {
        name: 'http-check',
        status: isHealthy ? 'healthy' : 'unhealthy',
        duration: Date.now() - startTime,
        message: isHealthy ? 'OK' : `Unexpected status code: ${status}`,
        details: {
          statusCode: status,
          url: this.config.url,
        },
      }
    } catch (error) {
      return {
        name: 'http-check',
        status: 'unhealthy',
        duration: Date.now() - startTime,
        message: error instanceof Error ? error.message : 'Unknown error',
        details: {
          url: this.config.url,
        },
      }
    }
  }

  toHealthCheck(name: string): HealthCheck {
    return {
      name,
      checker: () => this.check(),
    }
  }
}

// =============================================================================
// DatabaseChecker Implementation
// =============================================================================

interface DiskStats {
  total: number
  used: number
  free: number
}

interface MemoryStats {
  total: number
  used: number
  free: number
  heapTotal?: number
  heapUsed?: number
}

export class DatabaseChecker {
  private queryFn: ((query: string) => Promise<unknown[]>) | null = null

  constructor(private config: DatabaseCheckerConfig) {}

  setQueryFn(fn: (query: string) => Promise<unknown[]>): void {
    this.queryFn = fn
  }

  async check(): Promise<CheckResult> {
    const startTime = Date.now()
    const query = this.config.query ?? 'SELECT 1'

    try {
      if (!this.queryFn) {
        throw new Error('Query function not set')
      }

      await this.queryFn(query)

      return {
        name: 'database-check',
        status: 'healthy',
        duration: Date.now() - startTime,
        message: 'Database connection healthy',
      }
    } catch (error) {
      return {
        name: 'database-check',
        status: 'unhealthy',
        duration: Date.now() - startTime,
        message: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  toHealthCheck(name: string): HealthCheck {
    return {
      name,
      checker: () => this.check(),
    }
  }
}

// =============================================================================
// DiskChecker Implementation
// =============================================================================

export class DiskChecker {
  private statsFn: (() => Promise<DiskStats>) | null = null

  constructor(private config: DiskCheckerConfig) {}

  setStatsFn(fn: () => Promise<DiskStats>): void {
    this.statsFn = fn
  }

  async check(): Promise<CheckResult> {
    const startTime = Date.now()
    const warningThreshold = this.config.warningThreshold ?? 80
    const criticalThreshold = this.config.criticalThreshold ?? 90

    try {
      if (!this.statsFn) {
        throw new Error('Stats function not set')
      }

      const stats = await this.statsFn()
      const percentUsed = (stats.used / stats.total) * 100

      let status: HealthStatus = 'healthy'
      if (percentUsed >= criticalThreshold) {
        status = 'unhealthy'
      } else if (percentUsed >= warningThreshold) {
        status = 'degraded'
      }

      return {
        name: 'disk-check',
        status,
        duration: Date.now() - startTime,
        message: `Disk usage: ${percentUsed.toFixed(1)}%`,
        details: {
          percentUsed,
          total: stats.total,
          used: stats.used,
          free: stats.free,
          path: this.config.path,
        },
      }
    } catch (error) {
      return {
        name: 'disk-check',
        status: 'unhealthy',
        duration: Date.now() - startTime,
        message: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  toHealthCheck(name: string): HealthCheck {
    return {
      name,
      checker: () => this.check(),
    }
  }
}

// =============================================================================
// MemoryChecker Implementation
// =============================================================================

export class MemoryChecker {
  private statsFn: (() => Promise<MemoryStats>) | null = null

  constructor(private config: MemoryCheckerConfig = {}) {}

  setStatsFn(fn: () => Promise<MemoryStats>): void {
    this.statsFn = fn
  }

  async check(): Promise<CheckResult> {
    const startTime = Date.now()
    const warningThreshold = this.config.warningThreshold ?? 80
    const criticalThreshold = this.config.criticalThreshold ?? 90

    try {
      if (!this.statsFn) {
        throw new Error('Stats function not set')
      }

      const stats = await this.statsFn()
      const percentUsed = (stats.used / stats.total) * 100

      let status: HealthStatus = 'healthy'
      if (percentUsed >= criticalThreshold) {
        status = 'unhealthy'
      } else if (percentUsed >= warningThreshold) {
        status = 'degraded'
      }

      const details: Record<string, unknown> = {
        percentUsed,
        total: stats.total,
        used: stats.used,
        free: stats.free,
      }

      if (this.config.includeHeapDetails && stats.heapTotal !== undefined) {
        details.heapTotal = stats.heapTotal
        details.heapUsed = stats.heapUsed
      }

      return {
        name: 'memory-check',
        status,
        duration: Date.now() - startTime,
        message: `Memory usage: ${percentUsed.toFixed(1)}%`,
        details,
      }
    } catch (error) {
      return {
        name: 'memory-check',
        status: 'unhealthy',
        duration: Date.now() - startTime,
        message: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  toHealthCheck(name: string): HealthCheck {
    return {
      name,
      checker: () => this.check(),
    }
  }
}

// =============================================================================
// CustomChecker Implementation
// =============================================================================

export class CustomChecker {
  constructor(private checkerFn: CustomCheckerFn) {}

  async check(): Promise<CheckResult> {
    const startTime = Date.now()

    try {
      const result = await Promise.resolve(this.checkerFn())
      return {
        ...result,
        duration: Date.now() - startTime,
      }
    } catch (error) {
      return {
        name: 'custom-check',
        status: 'unhealthy',
        duration: Date.now() - startTime,
        message: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  toHealthCheck(name: string): HealthCheck {
    return {
      name,
      checker: () => this.check(),
    }
  }
}

// =============================================================================
// AlertManager Implementation
// =============================================================================

interface AlertState {
  failureCount: number
  lastAlertTime: number
}

export class AlertManager implements IAlertManager {
  private config: AlertConfig | null = null
  private state = new Map<string, AlertState>()

  configure(config: AlertConfig): void {
    this.config = config
  }

  getConfig(): AlertConfig | null {
    return this.config
  }

  async process(result: CheckResult): Promise<void> {
    if (!this.config) return

    // Check if this check should be monitored
    if (this.config.checks && !this.config.checks.includes(result.name)) {
      return
    }

    // Check if this status should trigger alerts
    if (this.config.statuses && !this.config.statuses.includes(result.status)) {
      return
    }

    const state = this.state.get(result.name) ?? { failureCount: 0, lastAlertTime: 0 }

    if (result.status === 'healthy') {
      state.failureCount = 0
      this.state.set(result.name, state)
      return
    }

    state.failureCount++
    this.state.set(result.name, state)

    // Check if threshold reached
    if (state.failureCount >= this.config.threshold) {
      // Check cooldown
      const now = Date.now()
      if (now - state.lastAlertTime >= this.config.cooldown) {
        await this.sendAlerts(result)
        state.lastAlertTime = now
        this.state.set(result.name, state)
      }
    }
  }

  async alert(message: string, details?: Record<string, unknown>): Promise<void> {
    if (!this.config) return

    for (const channel of this.config.channels) {
      if (channel.type === 'custom' && typeof channel.config.handler === 'function') {
        await (channel.config.handler as (data: unknown) => Promise<void>)({
          message,
          details,
          timestamp: Date.now(),
        })
      }
    }
  }

  reset(name: string): void {
    this.state.set(name, { failureCount: 0, lastAlertTime: 0 })
  }

  getFailureCounts(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const [name, state] of this.state) {
      counts[name] = state.failureCount
    }
    return counts
  }

  private async sendAlerts(result: CheckResult): Promise<void> {
    if (!this.config) return

    for (const channel of this.config.channels) {
      if (channel.type === 'custom' && typeof channel.config.handler === 'function') {
        await (channel.config.handler as (data: unknown) => Promise<void>)({
          check: result.name,
          status: result.status,
          message: result.message,
          timestamp: Date.now(),
        })
      }
      // Additional channel types can be implemented here
    }
  }
}

// =============================================================================
// HistoryTracker Implementation
// =============================================================================

export class HistoryTracker implements IHistoryTracker {
  private history = new Map<string, CheckResult[]>()
  private maxSize = 100

  record(result: CheckResult): void {
    const existing = this.history.get(result.name) ?? []
    existing.push({
      ...result,
      timestamp: result.timestamp ?? Date.now(),
    })

    // Trim to max size
    if (existing.length > this.maxSize) {
      existing.splice(0, existing.length - this.maxSize)
    }

    this.history.set(result.name, existing)
  }

  getHistory(name: string, limit?: number): CheckResult[] {
    const results = this.history.get(name) ?? []
    if (limit !== undefined) {
      return results.slice(-limit)
    }
    return results
  }

  getTrends(): HealthTrend[] {
    const trends: HealthTrend[] = []
    for (const name of this.history.keys()) {
      const trend = this.getTrend(name)
      if (trend) {
        trends.push(trend)
      }
    }
    return trends
  }

  getTrend(name: string): HealthTrend | null {
    const results = this.history.get(name)
    if (!results || results.length === 0) {
      return null
    }

    const successCount = results.filter(r => r.status === 'healthy').length
    const successRate = successCount / results.length

    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0)
    const avgDuration = totalDuration / results.length

    const direction = this.calculateTrendDirection(results)

    return {
      name,
      direction,
      successRate,
      avgDuration,
      sampleCount: results.length,
    }
  }

  getFullHistory(): HealthHistory {
    const allResults: CheckResult[] = []
    let startTime = Infinity
    let endTime = 0

    for (const results of this.history.values()) {
      for (const result of results) {
        allResults.push(result)
        const ts = result.timestamp ?? 0
        if (ts < startTime) startTime = ts
        if (ts > endTime) endTime = ts
      }
    }

    return {
      results: allResults,
      trends: this.getTrends(),
      startTime: startTime === Infinity ? 0 : startTime,
      endTime,
    }
  }

  clear(name: string): void {
    this.history.delete(name)
  }

  clearAll(): void {
    this.history.clear()
  }

  setMaxSize(size: number): void {
    this.maxSize = size
    // Trim existing histories
    for (const [name, results] of this.history) {
      if (results.length > size) {
        this.history.set(name, results.slice(-size))
      }
    }
  }

  private calculateTrendDirection(results: CheckResult[]): TrendDirection {
    if (results.length < 2) {
      return 'stable'
    }

    // Split into halves
    const midpoint = Math.floor(results.length / 2)
    const firstHalf = results.slice(0, midpoint)
    const secondHalf = results.slice(midpoint)

    const firstSuccessRate = firstHalf.filter(r => r.status === 'healthy').length / firstHalf.length
    const secondSuccessRate = secondHalf.filter(r => r.status === 'healthy').length / secondHalf.length

    const threshold = 0.2 // 20% difference threshold

    if (secondSuccessRate - firstSuccessRate > threshold) {
      return 'improving'
    } else if (firstSuccessRate - secondSuccessRate > threshold) {
      return 'degrading'
    }

    return 'stable'
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a health checker instance
 */
export function createHealthChecker(options?: HealthCheckerOptions): HealthChecker {
  return new HealthChecker(options)
}

/**
 * Create an HTTP checker instance
 */
export function createHTTPChecker(config: HTTPCheckerConfig): HTTPChecker {
  return new HTTPChecker(config)
}

/**
 * Create a custom checker instance
 */
export function createCustomChecker(fn: CustomCheckerFn): CustomChecker {
  return new CustomChecker(fn)
}

/**
 * Create a database checker instance
 */
export function createDatabaseChecker(config: DatabaseCheckerConfig): DatabaseChecker {
  return new DatabaseChecker(config)
}

/**
 * Create a disk checker instance
 */
export function createDiskChecker(config: DiskCheckerConfig): DiskChecker {
  return new DiskChecker(config)
}

/**
 * Create a memory checker instance
 */
export function createMemoryChecker(config?: MemoryCheckerConfig): MemoryChecker {
  return new MemoryChecker(config)
}

/**
 * Create an alert manager instance
 */
export function createAlertManager(): AlertManager {
  return new AlertManager()
}

/**
 * Create a history tracker instance
 */
export function createHistoryTracker(): HistoryTracker {
  return new HistoryTracker()
}
