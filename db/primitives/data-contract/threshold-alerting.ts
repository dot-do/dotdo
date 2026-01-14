/**
 * Threshold-based alerting for data contracts
 *
 * Provides:
 * - Per-expectation warn/fail thresholds
 * - Suite-level default thresholds
 * - Alert routing to channels (Slack, Email, PagerDuty, etc.)
 * - Threshold escalation (after N warnings, escalate)
 * - Rate calculation for partial datasets
 *
 * @example
 * ```typescript
 * import { expectWithThreshold, createThresholdSuite, createAlertRouter } from './threshold-alerting'
 *
 * const router = createAlertRouter()
 * router.registerChannel('slack', async (payload) => {
 *   await slack.send('#data-quality', formatAlert(payload))
 * })
 *
 * const suite = createThresholdSuite({ alertRouter: router })
 *
 * suite.addExpectation(
 *   expectWithThreshold('orders', 'total')
 *     .toBePositive()
 *     .withThreshold({ warn: 0.01, fail: 0.05 })
 *     .alertTo(['slack'])
 *     .onFail(async (report) => {
 *       throw new DataQualityError(report)
 *     })
 *     .build()
 * )
 *
 * const result = await suite.validate(data)
 * ```
 */

// ============================================================================
// TYPES - Threshold
// ============================================================================

/**
 * Threshold level result
 */
export type ThresholdLevel = 'pass' | 'warn' | 'fail'

/**
 * Severity level for alerts (extends ThresholdLevel with more granular levels)
 */
export type AlertSeverity = 'info' | 'warn' | 'error' | 'critical'

/**
 * Threshold mode - percentage or absolute count
 */
export type ThresholdMode = 'percentage' | 'absolute'

/**
 * Threshold configuration
 */
export interface Threshold {
  /** Warn if failure rate exceeds this (0-1) or absolute count */
  warn?: number
  /** Fail if failure rate exceeds this (0-1) or absolute count */
  fail?: number
  /** Mode: 'percentage' (default, 0-1 rate) or 'absolute' (count-based) */
  mode?: ThresholdMode
}

/**
 * Baseline configuration for deviation-based thresholds
 */
export interface BaselineConfig {
  /** Historical baseline value for comparison */
  value: number
  /** Warn if deviation from baseline exceeds this percentage (0-1) */
  warnDeviation?: number
  /** Fail if deviation from baseline exceeds this percentage (0-1) */
  failDeviation?: number
}

/**
 * Validation result for a single expectation
 */
export interface ThresholdResult {
  /** The determined threshold level */
  level: ThresholdLevel
  /** Failure rate (0-1) */
  failureRate: number
  /** Number of failed rows */
  failedCount: number
  /** Total rows evaluated */
  totalCount: number
  /** Number of rows sampled (if sampling enabled) */
  sampledCount?: number
  /** Detailed report */
  report: ThresholdReport
  /** Timing information */
  timing: {
    totalMs: number
  }
  /** Results per expectation (for multi-expectation suites) */
  expectationResults?: ThresholdResult[]
  /** Overall level (worst of all expectations) */
  overallLevel?: ThresholdLevel
}

/**
 * Failure detail for a single row
 */
export interface FailureDetail {
  rowIndex: number
  actualValue: unknown
  constraint: string
  column?: string
}

/**
 * Detailed threshold report
 */
export interface ThresholdReport {
  failures: FailureDetail[]
  summary: {
    table: string
    column?: string
    constraint: string
    threshold: Threshold
    failureRate: number
    failedCount: number
    totalCount: number
    skippedCount?: number
    level: ThresholdLevel
  }
}

// ============================================================================
// TYPES - Alert
// ============================================================================

/**
 * Alert channel type identifier
 */
export type AlertChannelType = string

/**
 * Alert payload sent to handlers
 */
export interface AlertPayload {
  level: ThresholdLevel
  table: string
  column?: string
  constraint: string
  threshold: Threshold
  failureRate: number
  failedCount: number
  totalCount: number
  failedRows?: FailureDetail[]
  runbook?: string
  timestamp: Date
  [key: string]: unknown
}

/**
 * Alert handler function signature
 */
export type AlertHandler = (payload: AlertPayload) => void | Promise<void>

/**
 * Alert channel registration
 */
export interface AlertChannel {
  type: AlertChannelType
  handler: AlertHandler
}

/**
 * Alert configuration for an expectation
 */
export interface AlertConfig {
  /** Channels to alert on any threshold breach */
  channels?: AlertChannelType[]
  /** Channels to alert on warn level only */
  warnChannels?: AlertChannelType[]
  /** Channels to alert on fail level only */
  failChannels?: AlertChannelType[]
  /** Custom payload to merge with alert */
  payload?: Record<string, unknown>
  /** Runbook URL */
  runbook?: string
}

// ============================================================================
// TYPES - Escalation
// ============================================================================

/**
 * Escalation trigger configuration
 */
export interface EscalationTrigger {
  /** Escalate after N consecutive warnings */
  afterWarnings?: number
  /** Escalate after N warnings in time window */
  afterWarningsInWindow?: {
    count: number
    windowMs: number
  }
}

/**
 * Escalation rule
 */
export interface EscalationRule {
  afterWarnings: number
  handler: AlertHandler
}

/**
 * Escalation chain (multiple levels)
 */
export type EscalationChain = EscalationRule[]

// ============================================================================
// TYPES - Constraint
// ============================================================================

/**
 * Constraint type
 */
export type ConstraintType =
  | 'positive'
  | 'not_null'
  | 'unique'
  | 'pattern'
  | 'between'
  | 'in_set'
  | 'greater_than'
  | 'less_than'

/**
 * Constraint definition
 */
export interface Constraint {
  type: ConstraintType
  params?: Record<string, unknown>
}

// ============================================================================
// TYPES - Expectation
// ============================================================================

/**
 * Null handling mode
 */
export type NullHandling = 'skip' | 'fail' | 'count'

/**
 * Built threshold expectation
 */
export interface ThresholdExpectation {
  table: string
  column?: string
  constraint: Constraint
  threshold?: Threshold
  baseline?: BaselineConfig
  onWarnHandler?: AlertHandler
  onFailHandler?: AlertHandler
  alertConfig?: AlertConfig
  nullHandling: NullHandling
  /** Alert severity level override */
  severity?: AlertSeverity
}

// ============================================================================
// TYPES - Suite
// ============================================================================

/**
 * Sampling configuration
 */
export interface SamplingConfig {
  enabled: boolean
  sampleSize: number
  seed?: number
}

/**
 * Alert format configuration
 */
export interface AlertFormatConfig {
  includeFailedRows?: boolean
  maxFailedRows?: number
  includeRunbook?: boolean
}

/**
 * Threshold suite options
 */
export interface ThresholdSuiteOptions {
  /** Default threshold for expectations without explicit thresholds */
  defaultThreshold?: Threshold
  /** How to combine default and explicit thresholds */
  combineMode?: 'override' | 'strict'
  /** Alert router instance */
  alertRouter?: AlertRouter
  /** Escalation configuration */
  escalation?: EscalationTrigger & { escalateTo: AlertHandler; resetOnPass?: boolean }
  /** Escalation chain */
  escalationChain?: EscalationChain
  /** Sampling configuration */
  sampling?: SamplingConfig
  /** Alert format configuration */
  alertFormat?: AlertFormatConfig
}

/**
 * Threshold suite interface
 */
export interface ThresholdSuite {
  addExpectation(expectation: ThresholdExpectation): void
  validate(data: Record<string, unknown>[]): ThresholdResult | Promise<ThresholdResult>
}

// ============================================================================
// ALERT ROUTER
// ============================================================================

/**
 * Alert router for routing alerts to channels
 */
export class AlertRouter {
  private channels = new Map<AlertChannelType, AlertHandler>()

  /**
   * Register an alert channel
   */
  registerChannel(type: AlertChannelType, handler: AlertHandler): void {
    this.channels.set(type, handler)
  }

  /**
   * Route alert to specified channels
   */
  async route(payload: AlertPayload, channelTypes: AlertChannelType[]): Promise<void> {
    const promises: Promise<void>[] = []

    for (const type of channelTypes) {
      const handler = this.channels.get(type)
      if (handler) {
        const result = handler(payload)
        if (result instanceof Promise) {
          promises.push(result)
        }
      }
    }

    await Promise.all(promises)
  }

  /**
   * Get registered channel types
   */
  getChannels(): AlertChannelType[] {
    return Array.from(this.channels.keys())
  }
}

/**
 * Create an alert router
 */
export function createAlertRouter(): AlertRouter {
  return new AlertRouter()
}

// ============================================================================
// EXPECTATION BUILDER
// ============================================================================

/**
 * Builder for threshold expectations
 */
export class ThresholdExpectationBuilder {
  public readonly table: string
  public readonly column?: string
  private _constraint?: Constraint
  private _threshold?: Threshold
  private _baseline?: BaselineConfig
  private _onWarnHandler?: AlertHandler
  private _onFailHandler?: AlertHandler
  private _alertConfig: AlertConfig = {}
  private _nullHandling: NullHandling = 'count'
  private _severity?: AlertSeverity

  constructor(table: string, column?: string) {
    this.table = table
    this.column = column
  }

  // ============================================================================
  // CONSTRAINT METHODS
  // ============================================================================

  /**
   * Expect values to be positive (> 0)
   */
  toBePositive(): this {
    this._constraint = { type: 'positive' }
    return this
  }

  /**
   * Expect values to not be null/undefined
   */
  toBeNotNull(): this {
    this._constraint = { type: 'not_null' }
    return this
  }

  /**
   * Expect values to be unique
   */
  toBeUnique(): this {
    this._constraint = { type: 'unique' }
    return this
  }

  /**
   * Expect values to match a pattern
   */
  toMatch(pattern: RegExp | string): this {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern
    this._constraint = { type: 'pattern', params: { pattern: regex } }
    return this
  }

  /**
   * Expect values to be between min and max
   */
  toBeBetween(min: number, max: number): this {
    this._constraint = { type: 'between', params: { min, max } }
    return this
  }

  /**
   * Expect values to be in a set
   */
  toBeIn(values: (string | number | boolean)[]): this {
    this._constraint = { type: 'in_set', params: { values } }
    return this
  }

  /**
   * Expect values to be greater than threshold
   */
  toBeGreaterThan(value: number): this {
    this._constraint = { type: 'greater_than', params: { value } }
    return this
  }

  /**
   * Expect values to be less than threshold
   */
  toBeLessThan(value: number): this {
    this._constraint = { type: 'less_than', params: { value } }
    return this
  }

  // ============================================================================
  // THRESHOLD CONFIGURATION
  // ============================================================================

  /**
   * Configure warn/fail thresholds (percentage-based by default)
   */
  withThreshold(threshold: Threshold): this {
    this._threshold = threshold
    return this
  }

  /**
   * Configure absolute count-based thresholds
   * @example
   * .withAbsoluteThreshold({ warn: 100, fail: 1000 })
   * // Warn if more than 100 failures, fail if more than 1000
   */
  withAbsoluteThreshold(threshold: { warn?: number; fail?: number }): this {
    this._threshold = { ...threshold, mode: 'absolute' }
    return this
  }

  /**
   * Start configuring warn condition with fluent API
   * @example
   * .warnIf().greaterThan(100).failIf().greaterThan(1000)
   */
  warnIf(): ThresholdConditionBuilder {
    return new ThresholdConditionBuilder(this, 'warn')
  }

  /**
   * Start configuring fail condition with fluent API
   * @example
   * .failIf().greaterThan(1000)
   */
  failIf(): ThresholdConditionBuilder {
    return new ThresholdConditionBuilder(this, 'fail')
  }

  /**
   * Configure baseline for deviation-based thresholds
   * @example
   * .withBaseline({ value: 100, warnDeviation: 0.1, failDeviation: 0.5 })
   * // Warn if value deviates more than 10% from baseline, fail if more than 50%
   */
  withBaseline(config: BaselineConfig): this {
    this._baseline = config
    return this
  }

  /**
   * Compare against a baseline value with deviation thresholds
   * @example
   * .deviatesFromBaseline(100, { warn: 0.1, fail: 0.5 })
   */
  deviatesFromBaseline(baselineValue: number, thresholds: { warn?: number; fail?: number }): this {
    this._baseline = {
      value: baselineValue,
      warnDeviation: thresholds.warn,
      failDeviation: thresholds.fail,
    }
    return this
  }

  /** @internal Set threshold from condition builder */
  _setThreshold(threshold: Threshold): void {
    this._threshold = { ...this._threshold, ...threshold }
  }

  /** @internal Set baseline from condition builder */
  _setBaselineDeviation(level: 'warn' | 'fail', deviation: number): void {
    if (!this._baseline) {
      this._baseline = { value: 0 }
    }
    if (level === 'warn') {
      this._baseline.warnDeviation = deviation
    } else {
      this._baseline.failDeviation = deviation
    }
  }

  /**
   * Set alert severity level
   */
  withSeverity(severity: AlertSeverity): this {
    this._severity = severity
    return this
  }

  // ============================================================================
  // ALERT HANDLERS
  // ============================================================================

  /**
   * Handler called when threshold is at warn level
   */
  onWarn(handler: AlertHandler): this {
    this._onWarnHandler = handler
    return this
  }

  /**
   * Handler called when threshold is at fail level
   */
  onFail(handler: AlertHandler): this {
    this._onFailHandler = handler
    return this
  }

  // ============================================================================
  // ALERT ROUTING
  // ============================================================================

  /**
   * Alert to channels on any threshold breach
   */
  alertTo(channels: AlertChannelType[]): this {
    this._alertConfig.channels = channels
    return this
  }

  /**
   * Alert to channels on warn level only
   */
  alertOnWarn(channels: AlertChannelType[]): this {
    this._alertConfig.warnChannels = channels
    return this
  }

  /**
   * Alert to channels on fail level only
   */
  alertOnFail(channels: AlertChannelType[]): this {
    this._alertConfig.failChannels = channels
    return this
  }

  /**
   * Add custom payload to alerts
   */
  withAlertPayload(payload: Record<string, unknown>): this {
    this._alertConfig.payload = payload
    return this
  }

  /**
   * Add runbook URL to alerts
   */
  withRunbook(url: string): this {
    this._alertConfig.runbook = url
    return this
  }

  // ============================================================================
  // NULL HANDLING
  // ============================================================================

  /**
   * Skip null/undefined values (don't count them)
   */
  skipNulls(): this {
    this._nullHandling = 'skip'
    return this
  }

  /**
   * Treat null/undefined values as failures
   */
  nullsAsFail(): this {
    this._nullHandling = 'fail'
    return this
  }

  // ============================================================================
  // BUILD
  // ============================================================================

  /**
   * Build the threshold expectation
   */
  build(): ThresholdExpectation {
    if (!this._constraint) {
      throw new Error('Constraint must be specified (e.g., toBePositive(), toBeNotNull())')
    }

    // Validate threshold
    if (this._threshold?.warn !== undefined && this._threshold?.fail !== undefined) {
      if (this._threshold.warn >= this._threshold.fail) {
        throw new Error('warn threshold must be less than fail threshold')
      }
    }

    // Validate baseline deviation thresholds
    if (this._baseline?.warnDeviation !== undefined && this._baseline?.failDeviation !== undefined) {
      if (this._baseline.warnDeviation >= this._baseline.failDeviation) {
        throw new Error('warn deviation must be less than fail deviation')
      }
    }

    return {
      table: this.table,
      column: this.column,
      constraint: this._constraint,
      threshold: this._threshold,
      baseline: this._baseline,
      onWarnHandler: this._onWarnHandler,
      onFailHandler: this._onFailHandler,
      alertConfig: this._alertConfig,
      nullHandling: this._nullHandling,
      severity: this._severity,
    }
  }
}

// ============================================================================
// THRESHOLD CONDITION BUILDER (FLUENT API)
// ============================================================================

/**
 * Fluent builder for threshold conditions
 * Allows chaining like: warnIf().greaterThan(100).failIf().greaterThan(1000)
 */
export class ThresholdConditionBuilder {
  private parent: ThresholdExpectationBuilder
  private level: 'warn' | 'fail'

  constructor(parent: ThresholdExpectationBuilder, level: 'warn' | 'fail') {
    this.parent = parent
    this.level = level
  }

  /**
   * Set threshold when count is greater than value (absolute mode)
   */
  greaterThan(value: number): ThresholdExpectationBuilder {
    const threshold: Threshold = { mode: 'absolute' }
    threshold[this.level] = value
    this.parent._setThreshold(threshold)
    return this.parent
  }

  /**
   * Set threshold when count is greater than or equal to value (absolute mode)
   */
  greaterThanOrEqual(value: number): ThresholdExpectationBuilder {
    const threshold: Threshold = { mode: 'absolute' }
    threshold[this.level] = value
    this.parent._setThreshold(threshold)
    return this.parent
  }

  /**
   * Set threshold when rate exceeds percentage (percentage mode)
   */
  exceedsRate(rate: number): ThresholdExpectationBuilder {
    const threshold: Threshold = { mode: 'percentage' }
    threshold[this.level] = rate
    this.parent._setThreshold(threshold)
    return this.parent
  }

  /**
   * Set threshold when value deviates from baseline by percentage
   */
  deviatesFromBaseline(deviation: number): ThresholdExpectationBuilder {
    this.parent._setBaselineDeviation(this.level, deviation)
    return this.parent
  }
}

/**
 * Create a threshold expectation builder
 */
export function expectWithThreshold(table: string, column?: string): ThresholdExpectationBuilder {
  return new ThresholdExpectationBuilder(table, column)
}

// ============================================================================
// THRESHOLD SUITE IMPLEMENTATION
// ============================================================================

/**
 * Implementation of threshold suite
 */
class ThresholdSuiteImpl implements ThresholdSuite {
  private expectations: ThresholdExpectation[] = []
  private options: ThresholdSuiteOptions
  private warningCount = 0
  private warningTimestamps: number[] = []
  private escalationTriggered = new Set<number>()

  constructor(options?: ThresholdSuiteOptions) {
    this.options = options ?? {}
  }

  addExpectation(expectation: ThresholdExpectation): void {
    this.expectations.push(expectation)
  }

  async validate(data: Record<string, unknown>[]): Promise<ThresholdResult> {
    const startTime = performance.now()
    const expectationResults: ThresholdResult[] = []

    // Sample data if configured
    let sampledData = data
    let sampledCount: number | undefined
    if (this.options.sampling?.enabled && data.length > this.options.sampling.sampleSize) {
      sampledData = this.sampleData(data, this.options.sampling.sampleSize, this.options.sampling.seed)
      sampledCount = sampledData.length
    }

    // Validate each expectation
    for (const expectation of this.expectations) {
      const result = this.validateExpectation(expectation, sampledData, data.length)
      expectationResults.push(result)

      // Call handlers based on level
      if (result.level === 'warn' && expectation.onWarnHandler) {
        await this.invokeHandler(expectation.onWarnHandler, result)
      }
      if (result.level === 'fail' && expectation.onFailHandler) {
        await this.invokeHandler(expectation.onFailHandler, result)
      }

      // Route alerts
      await this.routeAlerts(expectation, result)
    }

    // Determine overall level
    const overallLevel = this.determineOverallLevel(expectationResults)

    // Handle escalation
    await this.handleEscalation(overallLevel)

    const endTime = performance.now()

    // For single expectation, return its result directly
    if (this.expectations.length === 1) {
      const singleResult = expectationResults[0]!
      return {
        ...singleResult,
        sampledCount,
        timing: { totalMs: endTime - startTime },
      }
    }

    // For multiple expectations, aggregate
    const aggregateFailedCount = expectationResults.reduce((sum, r) => sum + r.failedCount, 0)
    const aggregateTotalCount = expectationResults.reduce((sum, r) => sum + r.totalCount, 0)
    const aggregateFailureRate = aggregateTotalCount > 0 ? aggregateFailedCount / aggregateTotalCount : 0

    return {
      level: overallLevel,
      failureRate: aggregateFailureRate,
      failedCount: aggregateFailedCount,
      totalCount: data.length,
      sampledCount,
      expectationResults,
      overallLevel,
      report: {
        failures: expectationResults.flatMap(r => r.report.failures),
        summary: {
          table: this.expectations[0]?.table ?? '',
          constraint: 'aggregate',
          threshold: this.options.defaultThreshold ?? {},
          failureRate: aggregateFailureRate,
          failedCount: aggregateFailedCount,
          totalCount: data.length,
          level: overallLevel,
        },
      },
      timing: { totalMs: endTime - startTime },
    }
  }

  private validateExpectation(
    expectation: ThresholdExpectation,
    data: Record<string, unknown>[],
    originalCount: number
  ): ThresholdResult {
    const failures: FailureDetail[] = []
    let validCount = 0
    let skippedCount = 0
    const seenValues = new Set<unknown>()

    for (let i = 0; i < data.length; i++) {
      const row = data[i]!
      const value = expectation.column ? this.getValue(row, expectation.column) : row

      // Handle null values
      if (value === null || value === undefined) {
        if (expectation.nullHandling === 'skip') {
          skippedCount++
          continue
        } else if (expectation.nullHandling === 'fail') {
          failures.push({
            rowIndex: i,
            actualValue: value,
            constraint: expectation.constraint.type,
            column: expectation.column,
          })
          validCount++
          continue
        }
      }

      validCount++

      // Validate constraint
      const isValid = this.validateConstraint(expectation.constraint, value, seenValues)
      if (!isValid) {
        failures.push({
          rowIndex: i,
          actualValue: value,
          constraint: expectation.constraint.type,
          column: expectation.column,
        })
      }
    }

    const failedCount = failures.length
    const totalCount = validCount
    const failureRate = totalCount > 0 ? failedCount / totalCount : 0

    // Calculate aggregate value for baseline comparison if needed
    let aggregateValue: number | undefined
    if (expectation.baseline && expectation.column) {
      const numericValues = data
        .map(row => this.getValue(row, expectation.column!))
        .filter((v): v is number => typeof v === 'number')
      if (numericValues.length > 0) {
        // Use average as the aggregate value for baseline comparison
        aggregateValue = numericValues.reduce((a, b) => a + b, 0) / numericValues.length
      }
    }

    // Determine threshold to use
    const threshold = this.getEffectiveThreshold(expectation)
    const level = this.determineLevel(
      failureRate,
      threshold,
      failedCount,
      expectation.baseline,
      aggregateValue
    )

    return {
      level,
      failureRate,
      failedCount,
      totalCount,
      report: {
        failures,
        summary: {
          table: expectation.table,
          column: expectation.column,
          constraint: expectation.constraint.type,
          threshold,
          failureRate,
          failedCount,
          totalCount,
          skippedCount: skippedCount > 0 ? skippedCount : undefined,
          level,
        },
      },
      timing: { totalMs: 0 },
    }
  }

  private validateConstraint(constraint: Constraint, value: unknown, seenValues: Set<unknown>): boolean {
    switch (constraint.type) {
      case 'positive':
        return typeof value === 'number' && value > 0

      case 'not_null':
        return value !== null && value !== undefined

      case 'unique':
        if (seenValues.has(value)) {
          return false
        }
        seenValues.add(value)
        return true

      case 'pattern': {
        const pattern = constraint.params?.pattern as RegExp
        return typeof value === 'string' && pattern.test(value)
      }

      case 'between': {
        const min = constraint.params?.min as number
        const max = constraint.params?.max as number
        return typeof value === 'number' && value >= min && value <= max
      }

      case 'in_set': {
        const values = constraint.params?.values as (string | number | boolean)[]
        return values.includes(value as string | number | boolean)
      }

      case 'greater_than': {
        const threshold = constraint.params?.value as number
        return typeof value === 'number' && value > threshold
      }

      case 'less_than': {
        const threshold = constraint.params?.value as number
        return typeof value === 'number' && value < threshold
      }

      default:
        return true
    }
  }

  private getValue(row: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = row
    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined
      }
      current = (current as Record<string, unknown>)[part]
    }
    return current
  }

  private getEffectiveThreshold(expectation: ThresholdExpectation): Threshold {
    const explicitThreshold = expectation.threshold
    const defaultThreshold = this.options.defaultThreshold

    if (!explicitThreshold && !defaultThreshold) {
      return {}
    }

    if (!explicitThreshold) {
      return defaultThreshold!
    }

    if (!defaultThreshold || this.options.combineMode === 'override') {
      return explicitThreshold
    }

    // Strict mode: use the more restrictive threshold
    if (this.options.combineMode === 'strict') {
      return {
        warn: Math.min(explicitThreshold.warn ?? Infinity, defaultThreshold.warn ?? Infinity) === Infinity
          ? undefined
          : Math.min(explicitThreshold.warn ?? Infinity, defaultThreshold.warn ?? Infinity),
        fail: Math.min(explicitThreshold.fail ?? Infinity, defaultThreshold.fail ?? Infinity) === Infinity
          ? undefined
          : Math.min(explicitThreshold.fail ?? Infinity, defaultThreshold.fail ?? Infinity),
      }
    }

    return explicitThreshold
  }

  private determineLevel(
    failureRate: number,
    threshold: Threshold,
    failedCount?: number,
    baseline?: BaselineConfig,
    aggregateValue?: number
  ): ThresholdLevel {
    // Check baseline deviation first if configured
    if (baseline && aggregateValue !== undefined) {
      const deviation = baseline.value !== 0
        ? Math.abs(aggregateValue - baseline.value) / Math.abs(baseline.value)
        : aggregateValue !== 0 ? 1 : 0

      if (baseline.failDeviation !== undefined && deviation >= baseline.failDeviation) {
        return 'fail'
      }
      if (baseline.warnDeviation !== undefined && deviation >= baseline.warnDeviation) {
        return 'warn'
      }
    }

    // Check absolute thresholds (count-based)
    if (threshold.mode === 'absolute' && failedCount !== undefined) {
      if (threshold.fail !== undefined && failedCount > threshold.fail) {
        return 'fail'
      }
      if (threshold.warn !== undefined && failedCount > threshold.warn) {
        return 'warn'
      }
      return 'pass'
    }

    // Check percentage thresholds (default mode)
    if (threshold.fail !== undefined && failureRate >= threshold.fail) {
      return 'fail'
    }
    if (threshold.warn !== undefined && failureRate >= threshold.warn) {
      return 'warn'
    }
    return 'pass'
  }

  private determineOverallLevel(results: ThresholdResult[]): ThresholdLevel {
    if (results.some(r => r.level === 'fail')) {
      return 'fail'
    }
    if (results.some(r => r.level === 'warn')) {
      return 'warn'
    }
    return 'pass'
  }

  private async invokeHandler(handler: AlertHandler, result: ThresholdResult): Promise<void> {
    const payload: AlertPayload = {
      level: result.level,
      table: result.report.summary.table,
      column: result.report.summary.column,
      constraint: result.report.summary.constraint,
      threshold: result.report.summary.threshold,
      failureRate: result.failureRate,
      failedCount: result.failedCount,
      totalCount: result.totalCount,
      timestamp: new Date(),
    }

    const maybePromise = handler(payload)
    if (maybePromise instanceof Promise) {
      await maybePromise
    }
  }

  private async routeAlerts(expectation: ThresholdExpectation, result: ThresholdResult): Promise<void> {
    const alertRouter = this.options.alertRouter
    if (!alertRouter) return

    const config = expectation.alertConfig
    if (!config) return

    const payload: AlertPayload = {
      level: result.level,
      table: result.report.summary.table,
      column: result.report.summary.column,
      constraint: result.report.summary.constraint,
      threshold: result.report.summary.threshold,
      failureRate: result.failureRate,
      failedCount: result.failedCount,
      totalCount: result.totalCount,
      timestamp: new Date(),
      ...config.payload,
    }

    if (config.runbook) {
      payload.runbook = config.runbook
    }

    // Add failed rows if configured
    if (this.options.alertFormat?.includeFailedRows) {
      const maxRows = this.options.alertFormat.maxFailedRows ?? 10
      payload.failedRows = result.report.failures.slice(0, maxRows)
    }

    // Route to channels based on level
    if (result.level === 'pass') return

    const channels: AlertChannelType[] = []

    // Add channels for any breach
    if (config.channels) {
      channels.push(...config.channels)
    }

    // Add level-specific channels
    if (result.level === 'warn' && config.warnChannels) {
      channels.push(...config.warnChannels)
    }
    if (result.level === 'fail' && config.failChannels) {
      channels.push(...config.failChannels)
    }

    if (channels.length > 0) {
      await alertRouter.route(payload, channels)
    }
  }

  private async handleEscalation(level: ThresholdLevel): Promise<void> {
    const now = Date.now()

    if (level === 'warn') {
      this.warningCount++
      this.warningTimestamps.push(now)

      // Check simple count-based escalation
      if (this.options.escalation?.afterWarnings) {
        if (this.warningCount >= this.options.escalation.afterWarnings && !this.escalationTriggered.has(-1)) {
          this.escalationTriggered.add(-1) // Use -1 as marker for simple escalation
          const maybePromise = this.options.escalation.escalateTo({
            level: 'fail',
            table: '',
            constraint: 'escalation',
            threshold: {},
            failureRate: 0,
            failedCount: 0,
            totalCount: 0,
            timestamp: new Date(),
          })
          if (maybePromise instanceof Promise) {
            await maybePromise
          }
        }
      }

      // Check time-window based escalation
      if (this.options.escalation?.afterWarningsInWindow) {
        const { count, windowMs } = this.options.escalation.afterWarningsInWindow
        const recentWarnings = this.warningTimestamps.filter(ts => now - ts < windowMs)
        if (recentWarnings.length >= count) {
          const maybePromise = this.options.escalation.escalateTo({
            level: 'fail',
            table: '',
            constraint: 'escalation',
            threshold: {},
            failureRate: 0,
            failedCount: 0,
            totalCount: 0,
            timestamp: new Date(),
          })
          if (maybePromise instanceof Promise) {
            await maybePromise
          }
        }
      }

      // Check escalation chain
      if (this.options.escalationChain) {
        for (const rule of this.options.escalationChain) {
          if (this.warningCount >= rule.afterWarnings && !this.escalationTriggered.has(rule.afterWarnings)) {
            this.escalationTriggered.add(rule.afterWarnings)
            const maybePromise = rule.handler({
              level: 'fail',
              table: '',
              constraint: 'escalation',
              threshold: {},
              failureRate: 0,
              failedCount: 0,
              totalCount: 0,
              timestamp: new Date(),
            })
            if (maybePromise instanceof Promise) {
              await maybePromise
            }
          }
        }
      }
    } else if (level === 'pass' && this.options.escalation?.resetOnPass) {
      this.warningCount = 0
      this.warningTimestamps = []
      this.escalationTriggered.clear()
    }
  }

  private sampleData(data: Record<string, unknown>[], sampleSize: number, seed?: number): Record<string, unknown>[] {
    if (data.length <= sampleSize) {
      return data
    }

    // Simple seeded random for reproducibility
    const random = this.createSeededRandom(seed ?? Date.now())
    const indices = new Set<number>()

    while (indices.size < sampleSize) {
      const index = Math.floor(random() * data.length)
      indices.add(index)
    }

    return Array.from(indices).map(i => data[i]!)
  }

  private createSeededRandom(seed: number): () => number {
    let value = seed
    return () => {
      value = (value * 9301 + 49297) % 233280
      return value / 233280
    }
  }
}

/**
 * Create a threshold suite
 */
export function createThresholdSuite(options?: ThresholdSuiteOptions): ThresholdSuite {
  return new ThresholdSuiteImpl(options)
}

