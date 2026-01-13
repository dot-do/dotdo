/**
 * Funnel Analysis Query Builder
 *
 * Type-safe funnel analysis with configurable conversion windows,
 * proper SQL parameterization, and support for multiple SQL dialects.
 *
 * @example
 * ```typescript
 * import { FunnelBuilder, FunnelAnalyzer } from 'db/analytics/funnel'
 *
 * const funnel = new FunnelBuilder()
 *   .addStep('signup', 'User signed up')
 *   .addStep('onboarding_start', 'Started onboarding')
 *   .addStep('onboarding_complete', 'Completed onboarding')
 *   .addStep('first_purchase', 'Made first purchase')
 *   .withTimeWindow('7 days')
 *   .withLookbackPeriod('30 days')
 *   .build()
 *
 * const analyzer = new FunnelAnalyzer({ dialect: 'duckdb' })
 * const { sql, params } = analyzer.generateQuery(funnel)
 * ```
 *
 * @module db/analytics/funnel
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Supported SQL dialects for funnel queries
 */
export type FunnelSQLDialect = 'postgres' | 'clickhouse' | 'duckdb' | 'sqlite'

/**
 * A single step in the conversion funnel
 */
export interface FunnelStep {
  /** Event type identifier */
  eventType: string
  /** Human-readable description of the step */
  description?: string
  /** Optional filter conditions for this step */
  filters?: FunnelStepFilter[]
}

/**
 * Filter condition for a funnel step
 */
export interface FunnelStepFilter {
  /** Property name to filter on */
  property: string
  /** Comparison operator */
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains'
  /** Value to compare against */
  value: string | number | boolean | string[]
}

/**
 * Funnel configuration
 */
export interface FunnelConfig {
  /** Ordered list of funnel steps */
  steps: FunnelStep[]
  /** Maximum time between steps for conversion (e.g., '24 hours', '7 days') */
  timeWindow?: string
  /** Lookback period for the analysis (e.g., '30 days') */
  lookbackPeriod?: string
  /** Whether steps must occur in strict order */
  strictOrder?: boolean
  /** Optional name for the funnel */
  name?: string
}

/**
 * Result for a single funnel step
 */
export interface FunnelStepResult {
  /** Step number (1-indexed) */
  stepNumber: number
  /** Event type for this step */
  eventType: string
  /** Description of the step */
  description?: string
  /** Number of users who reached this step */
  users: number
  /** Conversion rate from previous step (0-1) */
  conversionFromPrevious: number
  /** Conversion rate from first step (0-1) */
  conversionFromStart: number
  /** Drop-off count from previous step */
  dropOff: number
  /** Drop-off rate from previous step (0-1) */
  dropOffRate: number
}

/**
 * Complete funnel analysis result
 */
export interface FunnelResult {
  /** Funnel name if provided */
  name?: string
  /** Analysis timestamp */
  analyzedAt: Date
  /** Total unique users who entered the funnel */
  totalUsers: number
  /** Step-by-step results */
  steps: FunnelStepResult[]
  /** Overall conversion rate (first to last step) */
  overallConversionRate: number
  /** Median time to convert (if available) */
  medianTimeToConvert?: number
}

/**
 * Generated SQL query with parameters
 */
export interface GeneratedQuery {
  /** SQL query string with parameter placeholders */
  sql: string
  /** Parameter values in order */
  params: unknown[]
}

/**
 * Funnel analyzer configuration
 */
export interface FunnelAnalyzerConfig {
  /** SQL dialect to use */
  dialect?: FunnelSQLDialect
  /** Events table name */
  eventsTable?: string
  /** User ID column name */
  userIdColumn?: string
  /** Event type column name */
  eventTypeColumn?: string
  /** Timestamp column name */
  timestampColumn?: string
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Error thrown when funnel configuration is invalid
 */
export class FunnelValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FunnelValidationError'
  }
}

/**
 * Validate funnel configuration
 */
function validateFunnelConfig(config: FunnelConfig): void {
  if (!config.steps || config.steps.length < 2) {
    throw new FunnelValidationError('Funnel must have at least 2 steps')
  }

  const eventTypes = new Set<string>()
  for (let i = 0; i < config.steps.length; i++) {
    const step = config.steps[i]!

    if (!step.eventType || step.eventType.trim() === '') {
      throw new FunnelValidationError(`Step ${i + 1} must have a valid eventType`)
    }

    if (eventTypes.has(step.eventType)) {
      throw new FunnelValidationError(`Duplicate event type '${step.eventType}' at step ${i + 1}`)
    }
    eventTypes.add(step.eventType)
  }

  // Validate time window format if provided
  if (config.timeWindow && !isValidInterval(config.timeWindow)) {
    throw new FunnelValidationError(`Invalid time window format: ${config.timeWindow}`)
  }

  if (config.lookbackPeriod && !isValidInterval(config.lookbackPeriod)) {
    throw new FunnelValidationError(`Invalid lookback period format: ${config.lookbackPeriod}`)
  }
}

/**
 * Check if a string is a valid interval format
 */
function isValidInterval(interval: string): boolean {
  return /^\d+\s*(second|minute|hour|day|week|month|year)s?$/i.test(interval)
}

// ============================================================================
// FUNNEL BUILDER
// ============================================================================

/**
 * Fluent builder for creating funnel configurations
 */
export class FunnelBuilder {
  private steps: FunnelStep[] = []
  private timeWindow?: string
  private lookbackPeriod?: string
  private strictOrder = true
  private name?: string

  /**
   * Add a step to the funnel
   */
  addStep(eventType: string, description?: string, filters?: FunnelStepFilter[]): this {
    this.steps.push({ eventType, description, filters })
    return this
  }

  /**
   * Set the maximum time window between steps
   */
  withTimeWindow(window: string): this {
    this.timeWindow = window
    return this
  }

  /**
   * Set the lookback period for analysis
   */
  withLookbackPeriod(period: string): this {
    this.lookbackPeriod = period
    return this
  }

  /**
   * Set whether steps must occur in strict order
   */
  withStrictOrder(strict: boolean): this {
    this.strictOrder = strict
    return this
  }

  /**
   * Set the funnel name
   */
  withName(name: string): this {
    this.name = name
    return this
  }

  /**
   * Build and validate the funnel configuration
   */
  build(): FunnelConfig {
    const config: FunnelConfig = {
      steps: [...this.steps],
      timeWindow: this.timeWindow,
      lookbackPeriod: this.lookbackPeriod,
      strictOrder: this.strictOrder,
      name: this.name,
    }

    validateFunnelConfig(config)
    return config
  }
}

// ============================================================================
// SQL GENERATION
// ============================================================================

/**
 * Generates funnel analysis SQL queries for different dialects
 */
export class FunnelAnalyzer {
  private readonly config: Required<FunnelAnalyzerConfig>

  constructor(config: FunnelAnalyzerConfig = {}) {
    this.config = {
      dialect: config.dialect ?? 'postgres',
      eventsTable: config.eventsTable ?? 'events',
      userIdColumn: config.userIdColumn ?? 'user_id',
      eventTypeColumn: config.eventTypeColumn ?? 'event_type',
      timestampColumn: config.timestampColumn ?? 'timestamp',
    }
  }

  /**
   * Generate SQL query for funnel analysis
   */
  generateQuery(funnel: FunnelConfig): GeneratedQuery {
    validateFunnelConfig(funnel)

    switch (this.config.dialect) {
      case 'clickhouse':
        return this.generateClickHouseQuery(funnel)
      case 'duckdb':
        return this.generateDuckDBQuery(funnel)
      case 'sqlite':
        return this.generateSQLiteQuery(funnel)
      case 'postgres':
      default:
        return this.generatePostgresQuery(funnel)
    }
  }

  /**
   * Generate PostgreSQL-compatible funnel query
   */
  private generatePostgresQuery(funnel: FunnelConfig): GeneratedQuery {
    const { steps, lookbackPeriod = '30 days' } = funnel
    const { eventsTable, userIdColumn, eventTypeColumn, timestampColumn } = this.config

    const params: unknown[] = [...steps.map((s) => s.eventType)]
    const placeholders = steps.map((_, i) => `$${i + 1}`).join(', ')

    // Build step CASE expressions for MAX aggregation
    const stepCases = steps
      .map((_, i) => `MAX(CASE WHEN ${eventTypeColumn} = $${i + 1} THEN 1 ELSE 0 END) as step_${i + 1}`)
      .join(',\n        ')

    // Build SUM expressions for final aggregation
    const stepSums = steps.map((_, i) => `SUM(step_${i + 1}) as step_${i + 1}_users`).join(',\n        ')

    const sql = `
WITH filtered_events AS (
  SELECT
    ${userIdColumn},
    ${eventTypeColumn},
    ${timestampColumn},
    ROW_NUMBER() OVER (PARTITION BY ${userIdColumn} ORDER BY ${timestampColumn}) as event_order
  FROM ${eventsTable}
  WHERE ${eventTypeColumn} IN (${placeholders})
    AND ${timestampColumn} > NOW() - INTERVAL '${lookbackPeriod}'
),
funnel_progress AS (
  SELECT
    ${userIdColumn},
    ${stepCases}
  FROM filtered_events
  GROUP BY ${userIdColumn}
)
SELECT
  ${stepSums}
FROM funnel_progress`

    return { sql: sql.trim(), params }
  }

  /**
   * Generate DuckDB-compatible funnel query
   */
  private generateDuckDBQuery(funnel: FunnelConfig): GeneratedQuery {
    const { steps, lookbackPeriod = '30 days' } = funnel
    const { eventsTable, userIdColumn, eventTypeColumn, timestampColumn } = this.config

    const params: unknown[] = [...steps.map((s) => s.eventType)]
    const placeholders = steps.map((_, i) => `$${i + 1}`).join(', ')

    const stepCases = steps
      .map((_, i) => `MAX(CASE WHEN ${eventTypeColumn} = $${i + 1} THEN 1 ELSE 0 END) as step_${i + 1}`)
      .join(',\n        ')

    const stepSums = steps.map((_, i) => `SUM(step_${i + 1}) as step_${i + 1}_users`).join(',\n        ')

    const sql = `
WITH filtered_events AS (
  SELECT
    ${userIdColumn},
    ${eventTypeColumn},
    ${timestampColumn},
    ROW_NUMBER() OVER (PARTITION BY ${userIdColumn} ORDER BY ${timestampColumn}) as event_order
  FROM ${eventsTable}
  WHERE ${eventTypeColumn} IN (${placeholders})
    AND ${timestampColumn} > NOW() - INTERVAL '${lookbackPeriod}'
),
funnel_progress AS (
  SELECT
    ${userIdColumn},
    ${stepCases}
  FROM filtered_events
  GROUP BY ${userIdColumn}
)
SELECT
  ${stepSums}
FROM funnel_progress`

    return { sql: sql.trim(), params }
  }

  /**
   * Generate ClickHouse-compatible funnel query
   * Uses ClickHouse's native windowFunnel function for optimal performance
   */
  private generateClickHouseQuery(funnel: FunnelConfig): GeneratedQuery {
    const { steps, timeWindow = '86400', lookbackPeriod = '30 days' } = funnel
    const { eventsTable, userIdColumn, eventTypeColumn, timestampColumn } = this.config

    const params: unknown[] = []

    // Parse time window to seconds for ClickHouse windowFunnel
    const windowSeconds = this.parseIntervalToSeconds(timeWindow)

    // Build step conditions for windowFunnel
    const stepConditions = steps.map((s) => `${eventTypeColumn} = '${s.eventType}'`).join(', ')

    // Build level extraction for results
    const levelCases = steps
      .map((_, i) => `countIf(level >= ${i + 1}) as step_${i + 1}_users`)
      .join(',\n        ')

    const sql = `
WITH funnel_data AS (
  SELECT
    ${userIdColumn},
    windowFunnel(${windowSeconds})(${timestampColumn}, ${stepConditions}) as level
  FROM ${eventsTable}
  WHERE ${timestampColumn} > now() - INTERVAL ${lookbackPeriod}
  GROUP BY ${userIdColumn}
)
SELECT
  ${levelCases}
FROM funnel_data`

    return { sql: sql.trim(), params }
  }

  /**
   * Generate SQLite-compatible funnel query
   */
  private generateSQLiteQuery(funnel: FunnelConfig): GeneratedQuery {
    const { steps, lookbackPeriod = '30' } = funnel
    const { eventsTable, userIdColumn, eventTypeColumn, timestampColumn } = this.config

    const params: unknown[] = [...steps.map((s) => s.eventType)]
    const placeholders = steps.map((_, i) => `?`).join(', ')

    const stepCases = steps
      .map((_, i) => `MAX(CASE WHEN ${eventTypeColumn} = ? THEN 1 ELSE 0 END) as step_${i + 1}`)
      .join(',\n        ')

    const stepSums = steps.map((_, i) => `SUM(step_${i + 1}) as step_${i + 1}_users`).join(',\n        ')

    // SQLite uses julianday for date math
    const lookbackDays = parseInt(lookbackPeriod.replace(/\D/g, ''), 10) || 30

    const sql = `
WITH filtered_events AS (
  SELECT
    ${userIdColumn},
    ${eventTypeColumn},
    ${timestampColumn}
  FROM ${eventsTable}
  WHERE ${eventTypeColumn} IN (${placeholders})
    AND julianday(${timestampColumn}) > julianday('now') - ${lookbackDays}
),
funnel_progress AS (
  SELECT
    ${userIdColumn},
    ${stepCases}
  FROM filtered_events
  GROUP BY ${userIdColumn}
)
SELECT
  ${stepSums}
FROM funnel_progress`

    // SQLite needs doubled params for the CASE statements
    const sqliteParams = [...params, ...params]
    return { sql: sql.trim(), params: sqliteParams }
  }

  /**
   * Parse interval string to seconds
   */
  private parseIntervalToSeconds(interval: string): number {
    const match = interval.match(/^(\d+)\s*(second|minute|hour|day|week|month|year)s?$/i)
    if (!match) {
      return 86400 // Default to 1 day
    }

    const value = parseInt(match[1]!, 10)
    const unit = match[2]!.toLowerCase()

    const multipliers: Record<string, number> = {
      second: 1,
      minute: 60,
      hour: 3600,
      day: 86400,
      week: 604800,
      month: 2592000, // 30 days
      year: 31536000, // 365 days
    }

    return value * (multipliers[unit] ?? 86400)
  }

  /**
   * Process raw query results into FunnelResult
   */
  processResults(rawResults: Record<string, unknown>[], funnel: FunnelConfig): FunnelResult {
    const row = rawResults[0]
    if (!row) {
      return {
        name: funnel.name,
        analyzedAt: new Date(),
        totalUsers: 0,
        steps: funnel.steps.map((step, i) => ({
          stepNumber: i + 1,
          eventType: step.eventType,
          description: step.description,
          users: 0,
          conversionFromPrevious: 0,
          conversionFromStart: 0,
          dropOff: 0,
          dropOffRate: 0,
        })),
        overallConversionRate: 0,
      }
    }

    const stepUsers: number[] = funnel.steps.map((_, i) => {
      const key = `step_${i + 1}_users`
      return Number(row[key]) || 0
    })

    const totalUsers = stepUsers[0] || 1

    const steps: FunnelStepResult[] = funnel.steps.map((step, i) => {
      const users = stepUsers[i]!
      const previousUsers = i > 0 ? stepUsers[i - 1]! : users

      return {
        stepNumber: i + 1,
        eventType: step.eventType,
        description: step.description,
        users,
        conversionFromPrevious: previousUsers > 0 ? users / previousUsers : 0,
        conversionFromStart: totalUsers > 0 ? users / totalUsers : 0,
        dropOff: previousUsers - users,
        dropOffRate: previousUsers > 0 ? (previousUsers - users) / previousUsers : 0,
      }
    })

    const lastStepUsers = stepUsers[stepUsers.length - 1] || 0

    return {
      name: funnel.name,
      analyzedAt: new Date(),
      totalUsers,
      steps,
      overallConversionRate: totalUsers > 0 ? lastStepUsers / totalUsers : 0,
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default FunnelAnalyzer
