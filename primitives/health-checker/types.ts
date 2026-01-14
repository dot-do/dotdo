/**
 * HealthChecker Types - Comprehensive Health Monitoring Primitives
 *
 * Provides types for health monitoring:
 * - HealthStatus: Overall health state
 * - HealthCheck: Individual check configuration
 * - HealthReport: Full health report with all checks
 * - CheckResult: Result of a single health check
 * - AlertConfig: Alert configuration for unhealthy states
 * - DependencyHealth: Health status of dependencies
 * - HealthHistory: Historical health data and trends
 */

/**
 * Overall health status
 */
export type HealthStatus = 'healthy' | 'unhealthy' | 'degraded'

/**
 * Health check configuration
 */
export interface HealthCheck {
  /** Unique name for this check */
  name: string
  /** Function that performs the health check */
  checker: () => Promise<CheckResult> | CheckResult
  /** Check interval in milliseconds */
  interval?: number
  /** Timeout for the check in milliseconds */
  timeout?: number
  /** Whether this check is critical (affects overall health) */
  critical?: boolean
  /** Tags for categorizing checks */
  tags?: string[]
  /** Dependencies that must be healthy for this check to run */
  dependencies?: string[]
}

/**
 * Result of a single health check
 */
export interface CheckResult {
  /** Name of the check */
  name: string
  /** Status of the check */
  status: HealthStatus
  /** Duration of the check in milliseconds */
  duration: number
  /** Human-readable message */
  message?: string
  /** Additional details */
  details?: Record<string, unknown>
  /** Timestamp of the check */
  timestamp?: number
}

/**
 * Full health report
 */
export interface HealthReport {
  /** Overall status */
  status: HealthStatus
  /** Individual check results */
  checks: CheckResult[]
  /** Report timestamp */
  timestamp: number
  /** Version of the health checker */
  version?: string
  /** Total duration to run all checks */
  duration?: number
}

/**
 * Alert channel configuration
 */
export interface AlertChannel {
  /** Channel type (webhook, email, slack, etc.) */
  type: string
  /** Channel-specific configuration */
  config: Record<string, unknown>
}

/**
 * Alert configuration
 */
export interface AlertConfig {
  /** Number of consecutive failures before alerting */
  threshold: number
  /** Alert channels to notify */
  channels: AlertChannel[]
  /** Cooldown period between alerts in milliseconds */
  cooldown: number
  /** Only alert for specific checks */
  checks?: string[]
  /** Only alert for specific statuses */
  statuses?: HealthStatus[]
}

/**
 * Dependency type
 */
export type DependencyType = 'database' | 'cache' | 'api' | 'queue' | 'storage' | 'other'

/**
 * Health status of a dependency
 */
export interface DependencyHealth {
  /** Dependency name */
  name: string
  /** Type of dependency */
  type: DependencyType
  /** Current status */
  status: HealthStatus
  /** Last check timestamp */
  lastCheck?: number
  /** Response time in milliseconds */
  responseTime?: number
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Trend direction
 */
export type TrendDirection = 'improving' | 'stable' | 'degrading'

/**
 * Health trend data
 */
export interface HealthTrend {
  /** Check name */
  name: string
  /** Trend direction */
  direction: TrendDirection
  /** Success rate (0-1) */
  successRate: number
  /** Average duration in milliseconds */
  avgDuration: number
  /** Number of samples */
  sampleCount: number
}

/**
 * Historical health data and trends
 */
export interface HealthHistory {
  /** Historical check results */
  results: CheckResult[]
  /** Calculated trends */
  trends: HealthTrend[]
  /** Start of history window */
  startTime: number
  /** End of history window */
  endTime: number
}

/**
 * Status change event
 */
export interface StatusChangeEvent {
  /** Previous status */
  previousStatus: HealthStatus
  /** New status */
  newStatus: HealthStatus
  /** Timestamp of change */
  timestamp: number
  /** Check that triggered the change (if applicable) */
  triggeredBy?: string
  /** Full report at time of change */
  report: HealthReport
}

/**
 * HTTP checker configuration
 */
export interface HTTPCheckerConfig {
  /** URL to check */
  url: string
  /** HTTP method (default: GET) */
  method?: string
  /** Expected status codes (default: [200]) */
  expectedStatus?: number[]
  /** Request headers */
  headers?: Record<string, string>
  /** Request body */
  body?: string
  /** Timeout in milliseconds */
  timeout?: number
  /** Whether to follow redirects */
  followRedirects?: boolean
}

/**
 * Database checker configuration
 */
export interface DatabaseCheckerConfig {
  /** Connection string or config */
  connection: string | Record<string, unknown>
  /** Query to execute for health check */
  query?: string
  /** Timeout in milliseconds */
  timeout?: number
}

/**
 * Disk checker configuration
 */
export interface DiskCheckerConfig {
  /** Path to check */
  path: string
  /** Warning threshold (percentage used) */
  warningThreshold?: number
  /** Critical threshold (percentage used) */
  criticalThreshold?: number
}

/**
 * Memory checker configuration
 */
export interface MemoryCheckerConfig {
  /** Warning threshold (percentage used) */
  warningThreshold?: number
  /** Critical threshold (percentage used) */
  criticalThreshold?: number
  /** Include heap details */
  includeHeapDetails?: boolean
}

/**
 * Custom checker function type
 */
export type CustomCheckerFn = () => Promise<CheckResult> | CheckResult

/**
 * Health checker interface
 */
export interface IHealthChecker {
  /**
   * Register a health check
   * @param check Health check configuration
   */
  register(check: HealthCheck): void

  /**
   * Unregister a health check
   * @param name Name of the check to remove
   */
  unregister(name: string): void

  /**
   * Run all registered health checks
   * @returns Health report
   */
  check(): Promise<HealthReport>

  /**
   * Run a single health check by name
   * @param name Name of the check to run
   * @returns Check result
   */
  checkOne(name: string): Promise<CheckResult>

  /**
   * Get the current overall status without running checks
   * @returns Current status
   */
  getStatus(): HealthStatus

  /**
   * Get a full health report without running checks (uses cached results)
   * @returns Health report
   */
  getReport(): HealthReport

  /**
   * Start background health monitoring
   * @param interval Default interval in milliseconds
   */
  start(interval?: number): void

  /**
   * Stop background health monitoring
   */
  stop(): void

  /**
   * Register a callback for status changes
   * @param callback Function to call when status changes
   */
  onStatusChange(callback: (event: StatusChangeEvent) => void): () => void

  /**
   * Get list of registered check names
   */
  getChecks(): string[]

  /**
   * Check if monitoring is running
   */
  isRunning(): boolean
}

/**
 * Alert manager interface
 */
export interface IAlertManager {
  /**
   * Configure alerts
   * @param config Alert configuration
   */
  configure(config: AlertConfig): void

  /**
   * Process a check result and trigger alerts if needed
   * @param result Check result
   */
  process(result: CheckResult): Promise<void>

  /**
   * Manually trigger an alert
   * @param message Alert message
   * @param details Additional details
   */
  alert(message: string, details?: Record<string, unknown>): Promise<void>

  /**
   * Reset alert state for a check
   * @param name Check name
   */
  reset(name: string): void

  /**
   * Get current failure counts
   */
  getFailureCounts(): Record<string, number>
}

/**
 * History tracker interface
 */
export interface IHistoryTracker {
  /**
   * Record a check result
   * @param result Check result
   */
  record(result: CheckResult): void

  /**
   * Get history for a specific check
   * @param name Check name
   * @param limit Maximum number of results
   */
  getHistory(name: string, limit?: number): CheckResult[]

  /**
   * Get trends for all checks
   */
  getTrends(): HealthTrend[]

  /**
   * Get trend for a specific check
   * @param name Check name
   */
  getTrend(name: string): HealthTrend | null

  /**
   * Get full history with trends
   */
  getFullHistory(): HealthHistory

  /**
   * Clear history for a check
   * @param name Check name
   */
  clear(name: string): void

  /**
   * Clear all history
   */
  clearAll(): void

  /**
   * Set maximum history size per check
   * @param size Maximum number of results to keep
   */
  setMaxSize(size: number): void
}
