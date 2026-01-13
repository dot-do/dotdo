/**
 * Funnel and Cohort Analysis Primitive
 *
 * Provides analytics capabilities for:
 * - Funnel Analysis: Define steps, calculate conversion between steps
 * - Cohort Analysis: Group users by signup date/first action
 * - Retention Analysis: Track user return rates over time
 * - Time-based Segmentation: Group by day, week, month
 * - Property Filters: Filter at each step
 *
 * @module db/primitives/analytics/funnel-cohort
 * @see dotdo-9ctbm
 */

// ============================================================================
// Types - Funnel Analysis
// ============================================================================

/**
 * Comparison operators for step filters
 */
export type FilterOp = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'in' | 'contains' | 'exists'

/**
 * A filter condition for funnel/cohort steps
 */
export interface StepFilter {
  property: string
  op: FilterOp
  value: unknown
}

/**
 * A single step in a funnel
 */
export interface FunnelStep {
  /** Name/identifier for this step */
  name: string
  /** Event name to match */
  event: string
  /** Optional filters to apply */
  filters?: StepFilter[]
}

/**
 * Configuration for funnel analysis
 */
export interface FunnelConfig {
  /** Ordered list of steps */
  steps: FunnelStep[]
  /** Maximum time between first and last step (ms) */
  conversionWindow?: number
  /** User identifier property */
  userIdProperty?: string
  /** Timestamp property */
  timestampProperty?: string
  /** Whether steps must occur in order */
  strictOrder?: boolean
}

/**
 * Result for a single step in the funnel
 */
export interface FunnelStepResult {
  /** Step name */
  name: string
  /** Number of users who completed this step */
  count: number
  /** Conversion rate from previous step (%) */
  conversionRate: number
  /** Overall conversion rate from step 1 (%) */
  overallConversion: number
  /** Average time from previous step (ms) */
  avgTimeFromPrevious?: number
  /** Median time from previous step (ms) */
  medianTimeFromPrevious?: number
}

/**
 * Complete funnel analysis result
 */
export interface FunnelResult {
  /** Results for each step */
  steps: FunnelStepResult[]
  /** Total users who entered the funnel */
  totalUsers: number
  /** Users who completed all steps */
  convertedUsers: number
  /** Overall funnel conversion rate (%) */
  overallConversionRate: number
  /** Average conversion time (ms) */
  avgConversionTime?: number
}

// ============================================================================
// Types - Cohort Analysis
// ============================================================================

/**
 * Time granularity for cohort grouping
 */
export type CohortGranularity = 'day' | 'week' | 'month' | 'quarter' | 'year'

/**
 * Configuration for cohort analysis
 */
export interface CohortConfig {
  /** Event that defines cohort membership (e.g., 'signup') */
  cohortEvent: string
  /** Filters for cohort event */
  cohortFilters?: StepFilter[]
  /** Return event to track */
  returnEvent: string
  /** Filters for return event */
  returnFilters?: StepFilter[]
  /** Granularity for cohort grouping */
  granularity: CohortGranularity
  /** Number of periods to track */
  periods: number
  /** User identifier property */
  userIdProperty?: string
  /** Timestamp property */
  timestampProperty?: string
}

/**
 * A single cohort's data
 */
export interface CohortData {
  /** Cohort identifier (e.g., '2024-01', '2024-W01') */
  cohortId: string
  /** Cohort start timestamp */
  startTimestamp: number
  /** Number of users in this cohort */
  cohortSize: number
  /** Retention data by period */
  retention: CohortRetention[]
}

/**
 * Retention data for a single period
 */
export interface CohortRetention {
  /** Period number (0 = same period as signup, 1 = next period, etc.) */
  period: number
  /** Number of users who returned */
  returnedUsers: number
  /** Retention rate (%) */
  retentionRate: number
}

/**
 * Complete cohort analysis result
 */
export interface CohortResult {
  /** Individual cohort data */
  cohorts: CohortData[]
  /** Overall average retention by period */
  averageRetention: number[]
  /** Configuration used */
  config: CohortConfig
}

// ============================================================================
// Types - Retention Analysis
// ============================================================================

/**
 * Configuration for retention analysis
 */
export interface RetentionConfig {
  /** Event that marks user activation */
  activationEvent: string
  /** Filters for activation event */
  activationFilters?: StepFilter[]
  /** Event that marks a return */
  returnEvent: string
  /** Filters for return event */
  returnFilters?: StepFilter[]
  /** Time granularity */
  granularity: CohortGranularity
  /** Number of periods to analyze */
  periods: number
  /** User identifier property */
  userIdProperty?: string
  /** Timestamp property */
  timestampProperty?: string
}

/**
 * Retention analysis result
 */
export interface RetentionResult {
  /** Retention rates by period */
  retention: RetentionPeriodResult[]
  /** Total activated users */
  totalUsers: number
  /** Average retention rate */
  averageRetention: number
}

/**
 * Retention data for a single period
 */
export interface RetentionPeriodResult {
  /** Period number */
  period: number
  /** Users who returned in this period */
  returnedUsers: number
  /** Retention rate (%) */
  retentionRate: number
  /** Cumulative users who have returned by this period */
  cumulativeReturnedUsers: number
  /** Cumulative retention rate */
  cumulativeRetentionRate: number
}

// ============================================================================
// Types - User Events
// ============================================================================

/**
 * A user event for analysis
 */
export interface AnalyticsEvent {
  /** Event name */
  event: string
  /** User identifier */
  userId: string
  /** Event timestamp */
  timestamp: number
  /** Event properties */
  properties?: Record<string, unknown>
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if an event matches the given filters
 */
function matchesFilters(event: AnalyticsEvent, filters?: StepFilter[]): boolean {
  if (!filters || filters.length === 0) return true

  for (const filter of filters) {
    const value = event.properties?.[filter.property]

    switch (filter.op) {
      case '=':
        if (value !== filter.value) return false
        break
      case '!=':
        if (value === filter.value) return false
        break
      case '>':
        if (typeof value !== 'number' || value <= (filter.value as number)) return false
        break
      case '<':
        if (typeof value !== 'number' || value >= (filter.value as number)) return false
        break
      case '>=':
        if (typeof value !== 'number' || value < (filter.value as number)) return false
        break
      case '<=':
        if (typeof value !== 'number' || value > (filter.value as number)) return false
        break
      case 'in':
        if (!Array.isArray(filter.value) || !filter.value.includes(value)) return false
        break
      case 'contains':
        if (typeof value !== 'string' || !value.includes(filter.value as string)) return false
        break
      case 'exists':
        if (filter.value && value === undefined) return false
        if (!filter.value && value !== undefined) return false
        break
    }
  }

  return true
}

/**
 * Get period start timestamp based on granularity
 */
function getPeriodStart(timestamp: number, granularity: CohortGranularity): number {
  const date = new Date(timestamp)

  switch (granularity) {
    case 'day':
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    case 'week': {
      const dayOfWeek = date.getUTCDay()
      const diff = (dayOfWeek + 6) % 7 // Monday is start of week
      const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - diff))
      return monday.getTime()
    }
    case 'month':
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
    case 'quarter': {
      const quarter = Math.floor(date.getUTCMonth() / 3)
      return Date.UTC(date.getUTCFullYear(), quarter * 3, 1)
    }
    case 'year':
      return Date.UTC(date.getUTCFullYear(), 0, 1)
  }
}

/**
 * Get period end timestamp (exclusive)
 */
function getPeriodEnd(periodStart: number, granularity: CohortGranularity): number {
  const date = new Date(periodStart)

  switch (granularity) {
    case 'day':
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)
    case 'week':
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 7)
    case 'month':
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
    case 'quarter':
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 3, 1)
    case 'year':
      return Date.UTC(date.getUTCFullYear() + 1, 0, 1)
  }
}

/**
 * Format period start as cohort ID
 */
function formatCohortId(timestamp: number, granularity: CohortGranularity): string {
  const date = new Date(timestamp)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')

  switch (granularity) {
    case 'day':
      return `${year}-${month}-${day}`
    case 'week': {
      // ISO week number
      const jan1 = new Date(Date.UTC(year, 0, 1))
      const days = Math.floor((timestamp - jan1.getTime()) / (24 * 60 * 60 * 1000))
      const weekNum = Math.ceil((days + jan1.getUTCDay() + 1) / 7)
      return `${year}-W${String(weekNum).padStart(2, '0')}`
    }
    case 'month':
      return `${year}-${month}`
    case 'quarter': {
      const quarter = Math.floor(date.getUTCMonth() / 3) + 1
      return `${year}-Q${quarter}`
    }
    case 'year':
      return `${year}`
  }
}

/**
 * Calculate period number between two timestamps
 */
function getPeriodNumber(baseTimestamp: number, eventTimestamp: number, granularity: CohortGranularity): number {
  const basePeriodStart = getPeriodStart(baseTimestamp, granularity)
  const eventPeriodStart = getPeriodStart(eventTimestamp, granularity)

  let periods = 0
  let current = basePeriodStart

  while (current < eventPeriodStart) {
    current = getPeriodEnd(current, granularity)
    periods++
  }

  return periods
}

/**
 * Calculate median from a sorted array
 */
function median(sortedValues: number[]): number {
  if (sortedValues.length === 0) return 0
  const mid = Math.floor(sortedValues.length / 2)
  return sortedValues.length % 2 !== 0
    ? sortedValues[mid]!
    : (sortedValues[mid - 1]! + sortedValues[mid]!) / 2
}

// ============================================================================
// Funnel Analysis
// ============================================================================

/**
 * Funnel analyzer class
 */
export class FunnelAnalyzer {
  private config: FunnelConfig
  private userIdProp: string
  private timestampProp: string

  constructor(config: FunnelConfig) {
    this.config = {
      conversionWindow: 30 * 24 * 60 * 60 * 1000, // 30 days default
      strictOrder: true,
      ...config,
    }
    this.userIdProp = config.userIdProperty || 'userId'
    this.timestampProp = config.timestampProperty || 'timestamp'
  }

  /**
   * Analyze events and compute funnel results
   */
  analyze(events: AnalyticsEvent[]): FunnelResult {
    const steps = this.config.steps
    if (steps.length === 0) {
      return {
        steps: [],
        totalUsers: 0,
        convertedUsers: 0,
        overallConversionRate: 0,
      }
    }

    // Group events by user
    const eventsByUser = new Map<string, AnalyticsEvent[]>()
    for (const event of events) {
      const userId = event.userId
      if (!eventsByUser.has(userId)) {
        eventsByUser.set(userId, [])
      }
      eventsByUser.get(userId)!.push(event)
    }

    // Sort each user's events by timestamp
    for (const userEvents of eventsByUser.values()) {
      userEvents.sort((a, b) => a.timestamp - b.timestamp)
    }

    // Track users at each step
    const usersAtStep: Set<string>[] = steps.map(() => new Set())
    const timeFromPrevious: number[][] = steps.map(() => [])
    const conversionTimes: number[] = []

    // Process each user
    for (const [userId, userEvents] of eventsByUser) {
      const stepCompletions = this.findStepCompletions(userEvents)

      if (stepCompletions.length > 0) {
        // Check conversion window - only count steps that happen within the window
        const firstStepTime = stepCompletions[0]!.timestamp

        // Find how many steps are within the conversion window
        let stepsWithinWindow = 0
        for (const completion of stepCompletions) {
          if (completion.timestamp - firstStepTime <= this.config.conversionWindow!) {
            stepsWithinWindow++
          } else {
            break // Steps are in order, so all remaining are also outside window
          }
        }

        // Track each step the user completed within the window
        for (let i = 0; i < stepsWithinWindow; i++) {
          usersAtStep[stepCompletions[i]!.stepIndex]!.add(userId)

          // Calculate time from previous step
          if (i > 0) {
            const timeDiff = stepCompletions[i]!.timestamp - stepCompletions[i - 1]!.timestamp
            timeFromPrevious[stepCompletions[i]!.stepIndex]!.push(timeDiff)
          }
        }

        // If user completed all steps within the window, track total conversion time
        if (stepsWithinWindow === steps.length) {
          const lastStepTime = stepCompletions[stepsWithinWindow - 1]!.timestamp
          conversionTimes.push(lastStepTime - firstStepTime)
        }
      }
    }

    // Calculate results
    const totalUsers = usersAtStep[0]!.size
    const convertedUsers = usersAtStep[steps.length - 1]?.size || 0

    const stepResults: FunnelStepResult[] = steps.map((step, i) => {
      const count = usersAtStep[i]!.size
      const previousCount = i === 0 ? totalUsers : usersAtStep[i - 1]!.size

      const conversionRate = previousCount > 0 ? (count / previousCount) * 100 : 0
      const overallConversion = totalUsers > 0 ? (count / totalUsers) * 100 : 0

      const result: FunnelStepResult = {
        name: step.name,
        count,
        conversionRate,
        overallConversion,
      }

      // Add time metrics if available
      if (i > 0 && timeFromPrevious[i]!.length > 0) {
        const times = timeFromPrevious[i]!.sort((a, b) => a - b)
        result.avgTimeFromPrevious = times.reduce((a, b) => a + b, 0) / times.length
        result.medianTimeFromPrevious = median(times)
      }

      return result
    })

    const result: FunnelResult = {
      steps: stepResults,
      totalUsers,
      convertedUsers,
      overallConversionRate: totalUsers > 0 ? (convertedUsers / totalUsers) * 100 : 0,
    }

    if (conversionTimes.length > 0) {
      result.avgConversionTime = conversionTimes.reduce((a, b) => a + b, 0) / conversionTimes.length
    }

    return result
  }

  /**
   * Find step completions for a user's events
   */
  private findStepCompletions(userEvents: AnalyticsEvent[]): Array<{ stepIndex: number; timestamp: number }> {
    const steps = this.config.steps
    const completions: Array<{ stepIndex: number; timestamp: number }> = []
    let nextStepIndex = 0

    for (const event of userEvents) {
      // If strict order, only look for the next step
      if (this.config.strictOrder) {
        if (nextStepIndex >= steps.length) break

        const step = steps[nextStepIndex]!
        if (event.event === step.event && matchesFilters(event, step.filters)) {
          completions.push({ stepIndex: nextStepIndex, timestamp: event.timestamp })
          nextStepIndex++
        }
      } else {
        // Non-strict: find any uncompleted step this event matches
        for (let i = 0; i < steps.length; i++) {
          const alreadyCompleted = completions.some((c) => c.stepIndex === i)
          if (alreadyCompleted) continue

          const step = steps[i]!
          if (event.event === step.event && matchesFilters(event, step.filters)) {
            completions.push({ stepIndex: i, timestamp: event.timestamp })
            break
          }
        }
      }
    }

    // Sort by step index to ensure proper order
    return completions.sort((a, b) => a.stepIndex - b.stepIndex)
  }
}

/**
 * Create a funnel analyzer
 */
export function createFunnelAnalyzer(config: FunnelConfig): FunnelAnalyzer {
  return new FunnelAnalyzer(config)
}

// ============================================================================
// Cohort Analysis
// ============================================================================

/**
 * Cohort analyzer class
 */
export class CohortAnalyzer {
  private config: CohortConfig
  private userIdProp: string
  private timestampProp: string

  constructor(config: CohortConfig) {
    this.config = config
    this.userIdProp = config.userIdProperty || 'userId'
    this.timestampProp = config.timestampProperty || 'timestamp'
  }

  /**
   * Analyze events and compute cohort results
   */
  analyze(events: AnalyticsEvent[]): CohortResult {
    // Group events by user
    const eventsByUser = new Map<string, AnalyticsEvent[]>()
    for (const event of events) {
      const userId = event.userId
      if (!eventsByUser.has(userId)) {
        eventsByUser.set(userId, [])
      }
      eventsByUser.get(userId)!.push(event)
    }

    // Sort each user's events by timestamp
    for (const userEvents of eventsByUser.values()) {
      userEvents.sort((a, b) => a.timestamp - b.timestamp)
    }

    // Find cohort membership and return events for each user
    const userCohorts = new Map<string, { cohortTimestamp: number; returnTimestamps: number[] }>()

    for (const [userId, userEvents] of eventsByUser) {
      // Find first cohort event
      const cohortEvent = userEvents.find(
        (e) => e.event === this.config.cohortEvent && matchesFilters(e, this.config.cohortFilters)
      )

      if (cohortEvent) {
        const returnTimestamps: number[] = []

        // Find all return events after cohort event
        for (const event of userEvents) {
          if (
            event.timestamp > cohortEvent.timestamp &&
            event.event === this.config.returnEvent &&
            matchesFilters(event, this.config.returnFilters)
          ) {
            returnTimestamps.push(event.timestamp)
          }
        }

        userCohorts.set(userId, {
          cohortTimestamp: cohortEvent.timestamp,
          returnTimestamps,
        })
      }
    }

    // Group users into cohorts
    const cohortGroups = new Map<
      string,
      {
        startTimestamp: number
        users: Array<{ userId: string; returnTimestamps: number[] }>
      }
    >()

    for (const [userId, data] of userCohorts) {
      const periodStart = getPeriodStart(data.cohortTimestamp, this.config.granularity)
      const cohortId = formatCohortId(periodStart, this.config.granularity)

      if (!cohortGroups.has(cohortId)) {
        cohortGroups.set(cohortId, {
          startTimestamp: periodStart,
          users: [],
        })
      }

      cohortGroups.get(cohortId)!.users.push({
        userId,
        returnTimestamps: data.returnTimestamps,
      })
    }

    // Calculate retention for each cohort
    const cohorts: CohortData[] = []
    const periodRetentionSums: number[] = Array(this.config.periods).fill(0)
    const periodCohortCounts: number[] = Array(this.config.periods).fill(0)

    // Sort cohorts by start timestamp
    const sortedCohortIds = Array.from(cohortGroups.keys()).sort()

    for (const cohortId of sortedCohortIds) {
      const group = cohortGroups.get(cohortId)!
      const cohortSize = group.users.length

      const retention: CohortRetention[] = []

      for (let period = 0; period < this.config.periods; period++) {
        const periodStart = this.getPeriodStartFromBase(group.startTimestamp, period)
        const periodEnd = getPeriodEnd(periodStart, this.config.granularity)

        // Count users who returned in this period
        let returnedUsers = 0
        for (const user of group.users) {
          const hasReturn = user.returnTimestamps.some((ts) => ts >= periodStart && ts < periodEnd)
          if (hasReturn) {
            returnedUsers++
          }
        }

        const retentionRate = cohortSize > 0 ? (returnedUsers / cohortSize) * 100 : 0

        retention.push({
          period,
          returnedUsers,
          retentionRate,
        })

        // Track for average calculation
        periodRetentionSums[period] += retentionRate
        periodCohortCounts[period]++
      }

      cohorts.push({
        cohortId,
        startTimestamp: group.startTimestamp,
        cohortSize,
        retention,
      })
    }

    // Calculate average retention
    const averageRetention = periodRetentionSums.map((sum, i) =>
      periodCohortCounts[i]! > 0 ? sum / periodCohortCounts[i]! : 0
    )

    return {
      cohorts,
      averageRetention,
      config: this.config,
    }
  }

  /**
   * Get period start from base timestamp and period offset
   */
  private getPeriodStartFromBase(baseTimestamp: number, periodOffset: number): number {
    let current = baseTimestamp
    for (let i = 0; i < periodOffset; i++) {
      current = getPeriodEnd(current, this.config.granularity)
    }
    return current
  }
}

/**
 * Create a cohort analyzer
 */
export function createCohortAnalyzer(config: CohortConfig): CohortAnalyzer {
  return new CohortAnalyzer(config)
}

// ============================================================================
// Retention Analysis
// ============================================================================

/**
 * Retention analyzer class
 */
export class RetentionAnalyzer {
  private config: RetentionConfig
  private userIdProp: string
  private timestampProp: string

  constructor(config: RetentionConfig) {
    this.config = config
    this.userIdProp = config.userIdProperty || 'userId'
    this.timestampProp = config.timestampProperty || 'timestamp'
  }

  /**
   * Analyze events and compute retention results
   */
  analyze(events: AnalyticsEvent[]): RetentionResult {
    // Group events by user
    const eventsByUser = new Map<string, AnalyticsEvent[]>()
    for (const event of events) {
      const userId = event.userId
      if (!eventsByUser.has(userId)) {
        eventsByUser.set(userId, [])
      }
      eventsByUser.get(userId)!.push(event)
    }

    // Sort each user's events by timestamp
    for (const userEvents of eventsByUser.values()) {
      userEvents.sort((a, b) => a.timestamp - b.timestamp)
    }

    // Find activation and return events for each user
    const userActivations = new Map<string, { activationTimestamp: number; returnPeriods: Set<number> }>()

    for (const [userId, userEvents] of eventsByUser) {
      // Find first activation event
      const activationEvent = userEvents.find(
        (e) => e.event === this.config.activationEvent && matchesFilters(e, this.config.activationFilters)
      )

      if (activationEvent) {
        const returnPeriods = new Set<number>()

        // Find all return events after activation
        for (const event of userEvents) {
          if (
            event.timestamp > activationEvent.timestamp &&
            event.event === this.config.returnEvent &&
            matchesFilters(event, this.config.returnFilters)
          ) {
            const period = getPeriodNumber(activationEvent.timestamp, event.timestamp, this.config.granularity)
            if (period > 0 && period <= this.config.periods) {
              returnPeriods.add(period)
            }
          }
        }

        userActivations.set(userId, {
          activationTimestamp: activationEvent.timestamp,
          returnPeriods,
        })
      }
    }

    const totalUsers = userActivations.size
    const retention: RetentionPeriodResult[] = []
    const cumulativeReturned = new Set<string>()

    for (let period = 1; period <= this.config.periods; period++) {
      let returnedUsers = 0

      for (const [userId, data] of userActivations) {
        if (data.returnPeriods.has(period)) {
          returnedUsers++
          cumulativeReturned.add(userId)
        }
      }

      const retentionRate = totalUsers > 0 ? (returnedUsers / totalUsers) * 100 : 0
      const cumulativeRetentionRate = totalUsers > 0 ? (cumulativeReturned.size / totalUsers) * 100 : 0

      retention.push({
        period,
        returnedUsers,
        retentionRate,
        cumulativeReturnedUsers: cumulativeReturned.size,
        cumulativeRetentionRate,
      })
    }

    const averageRetention =
      retention.length > 0 ? retention.reduce((sum, r) => sum + r.retentionRate, 0) / retention.length : 0

    return {
      retention,
      totalUsers,
      averageRetention,
    }
  }
}

/**
 * Create a retention analyzer
 */
export function createRetentionAnalyzer(config: RetentionConfig): RetentionAnalyzer {
  return new RetentionAnalyzer(config)
}

// ============================================================================
// Fluent Builder API
// ============================================================================

/**
 * Fluent builder for funnel analysis
 */
export class FunnelBuilder {
  private steps: FunnelStep[] = []
  private conversionWindow?: number
  private userIdProperty: string = 'userId'
  private timestampProperty: string = 'timestamp'
  private strictOrder: boolean = true

  /**
   * Add a step to the funnel
   */
  step(name: string, event: string, filters?: StepFilter[]): this {
    this.steps.push({ name, event, filters })
    return this
  }

  /**
   * Set the conversion window (max time between first and last step)
   */
  window(ms: number): this {
    this.conversionWindow = ms
    return this
  }

  /**
   * Set conversion window in days
   */
  windowDays(days: number): this {
    this.conversionWindow = days * 24 * 60 * 60 * 1000
    return this
  }

  /**
   * Set the user ID property name
   */
  userId(property: string): this {
    this.userIdProperty = property
    return this
  }

  /**
   * Set the timestamp property name
   */
  timestamp(property: string): this {
    this.timestampProperty = property
    return this
  }

  /**
   * Set whether steps must occur in strict order
   */
  strict(strict: boolean): this {
    this.strictOrder = strict
    return this
  }

  /**
   * Build the funnel analyzer
   */
  build(): FunnelAnalyzer {
    return createFunnelAnalyzer({
      steps: this.steps,
      conversionWindow: this.conversionWindow,
      userIdProperty: this.userIdProperty,
      timestampProperty: this.timestampProperty,
      strictOrder: this.strictOrder,
    })
  }

  /**
   * Analyze events with this funnel configuration
   */
  analyze(events: AnalyticsEvent[]): FunnelResult {
    return this.build().analyze(events)
  }
}

/**
 * Fluent builder for cohort analysis
 */
export class CohortBuilder {
  private cohortEvent: string = ''
  private cohortFilters?: StepFilter[]
  private returnEvent: string = ''
  private returnFilters?: StepFilter[]
  private granularity: CohortGranularity = 'month'
  private periods: number = 12
  private userIdProperty: string = 'userId'
  private timestampProperty: string = 'timestamp'

  /**
   * Set the cohort event (first action that defines cohort membership)
   */
  cohort(event: string, filters?: StepFilter[]): this {
    this.cohortEvent = event
    this.cohortFilters = filters
    return this
  }

  /**
   * Set the return event to track
   */
  returns(event: string, filters?: StepFilter[]): this {
    this.returnEvent = event
    this.returnFilters = filters
    return this
  }

  /**
   * Set the granularity for cohort grouping
   */
  by(granularity: CohortGranularity): this {
    this.granularity = granularity
    return this
  }

  /**
   * Set the number of periods to track
   */
  trackPeriods(periods: number): this {
    this.periods = periods
    return this
  }

  /**
   * Set the user ID property name
   */
  userId(property: string): this {
    this.userIdProperty = property
    return this
  }

  /**
   * Set the timestamp property name
   */
  timestamp(property: string): this {
    this.timestampProperty = property
    return this
  }

  /**
   * Build the cohort analyzer
   */
  build(): CohortAnalyzer {
    if (!this.cohortEvent) {
      throw new Error('Cohort event is required. Call .cohort() first.')
    }
    if (!this.returnEvent) {
      throw new Error('Return event is required. Call .returns() first.')
    }

    return createCohortAnalyzer({
      cohortEvent: this.cohortEvent,
      cohortFilters: this.cohortFilters,
      returnEvent: this.returnEvent,
      returnFilters: this.returnFilters,
      granularity: this.granularity,
      periods: this.periods,
      userIdProperty: this.userIdProperty,
      timestampProperty: this.timestampProperty,
    })
  }

  /**
   * Analyze events with this cohort configuration
   */
  analyze(events: AnalyticsEvent[]): CohortResult {
    return this.build().analyze(events)
  }
}

/**
 * Fluent builder for retention analysis
 */
export class RetentionBuilder {
  private activationEvent: string = ''
  private activationFilters?: StepFilter[]
  private returnEvent: string = ''
  private returnFilters?: StepFilter[]
  private granularity: CohortGranularity = 'week'
  private periods: number = 8
  private userIdProperty: string = 'userId'
  private timestampProperty: string = 'timestamp'

  /**
   * Set the activation event
   */
  activated(event: string, filters?: StepFilter[]): this {
    this.activationEvent = event
    this.activationFilters = filters
    return this
  }

  /**
   * Set the return event
   */
  returns(event: string, filters?: StepFilter[]): this {
    this.returnEvent = event
    this.returnFilters = filters
    return this
  }

  /**
   * Set the granularity
   */
  by(granularity: CohortGranularity): this {
    this.granularity = granularity
    return this
  }

  /**
   * Set the number of periods
   */
  trackPeriods(periods: number): this {
    this.periods = periods
    return this
  }

  /**
   * Set the user ID property name
   */
  userId(property: string): this {
    this.userIdProperty = property
    return this
  }

  /**
   * Set the timestamp property name
   */
  timestamp(property: string): this {
    this.timestampProperty = property
    return this
  }

  /**
   * Build the retention analyzer
   */
  build(): RetentionAnalyzer {
    if (!this.activationEvent) {
      throw new Error('Activation event is required. Call .activated() first.')
    }
    if (!this.returnEvent) {
      throw new Error('Return event is required. Call .returns() first.')
    }

    return createRetentionAnalyzer({
      activationEvent: this.activationEvent,
      activationFilters: this.activationFilters,
      returnEvent: this.returnEvent,
      returnFilters: this.returnFilters,
      granularity: this.granularity,
      periods: this.periods,
      userIdProperty: this.userIdProperty,
      timestampProperty: this.timestampProperty,
    })
  }

  /**
   * Analyze events with this retention configuration
   */
  analyze(events: AnalyticsEvent[]): RetentionResult {
    return this.build().analyze(events)
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new funnel builder
 */
export function funnel(): FunnelBuilder {
  return new FunnelBuilder()
}

/**
 * Create a new cohort builder
 */
export function cohort(): CohortBuilder {
  return new CohortBuilder()
}

/**
 * Create a new retention builder
 */
export function retention(): RetentionBuilder {
  return new RetentionBuilder()
}

// ============================================================================
// Filter Helpers
// ============================================================================

/**
 * Create an equality filter
 */
export function eq(property: string, value: unknown): StepFilter {
  return { property, op: '=', value }
}

/**
 * Create an inequality filter
 */
export function neq(property: string, value: unknown): StepFilter {
  return { property, op: '!=', value }
}

/**
 * Create a greater-than filter
 */
export function gt(property: string, value: number): StepFilter {
  return { property, op: '>', value }
}

/**
 * Create a less-than filter
 */
export function lt(property: string, value: number): StepFilter {
  return { property, op: '<', value }
}

/**
 * Create a greater-than-or-equal filter
 */
export function gte(property: string, value: number): StepFilter {
  return { property, op: '>=', value }
}

/**
 * Create a less-than-or-equal filter
 */
export function lte(property: string, value: number): StepFilter {
  return { property, op: '<=', value }
}

/**
 * Create an in-list filter
 */
export function inList(property: string, values: unknown[]): StepFilter {
  return { property, op: 'in', value: values }
}

/**
 * Create a contains filter (string contains substring)
 */
export function contains(property: string, substring: string): StepFilter {
  return { property, op: 'contains', value: substring }
}

/**
 * Create an exists filter
 */
export function exists(property: string, shouldExist: boolean = true): StepFilter {
  return { property, op: 'exists', value: shouldExist }
}
