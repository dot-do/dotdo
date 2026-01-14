/**
 * Conversion Tracker - Event-based Conversion Tracking for Experiments
 *
 * Tracks conversion events for A/B experiments with:
 * - Event collection with timestamps and values
 * - Attribution to experiment variants
 * - Aggregated metrics per variant
 * - Time-windowed analysis
 * - Multiple goal tracking
 *
 * @module db/primitives/feature-flags/conversion-tracker
 */

import type { ExperimentTracker, Assignment } from './experiment-tracker'
import type { ExperimentGoal, MetricAggregation } from './experiment'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * A conversion event
 */
export interface ConversionEvent {
  /** Unique event ID */
  id: string
  /** Experiment ID */
  experimentId: string
  /** Goal ID that was converted */
  goalId: string
  /** User ID */
  userId: string
  /** Assigned variant at time of conversion */
  variant: string
  /** Event name (matches goal eventName) */
  eventName: string
  /** Numeric value (for revenue/count metrics) */
  value?: number
  /** When the conversion occurred */
  timestamp: Date
  /** Time since assignment (in milliseconds) */
  timeSinceAssignment?: number
  /** Additional event properties */
  properties?: Record<string, unknown>
}

/**
 * Options for tracking a conversion
 */
export interface TrackConversionOptions {
  /** Numeric value for the conversion */
  value?: number
  /** Additional event properties */
  properties?: Record<string, unknown>
  /** Override timestamp (for historical data) */
  timestamp?: Date
  /** Deduplicate by this key (e.g., order ID) */
  deduplicationKey?: string
}

/**
 * Aggregated metrics for a variant
 */
export interface VariantMetrics {
  /** Variant key */
  variant: string
  /** Number of users assigned to this variant */
  sampleSize: number
  /** Number of conversions */
  conversions: number
  /** Conversion rate (conversions / sampleSize) */
  conversionRate: number
  /** Total value (for revenue metrics) */
  totalValue: number
  /** Mean value per conversion */
  meanValue: number
  /** Mean value per user */
  meanValuePerUser: number
  /** All recorded values (for statistical analysis) */
  values: number[]
  /** Standard deviation of values */
  standardDeviation: number
  /** Median value */
  medianValue: number
  /** 95th percentile value */
  p95Value: number
}

/**
 * Metrics summary for an experiment goal
 */
export interface GoalMetrics {
  /** Experiment ID */
  experimentId: string
  /** Goal ID */
  goalId: string
  /** Goal name */
  goalName: string
  /** Total sample size across all variants */
  totalSampleSize: number
  /** Total conversions across all variants */
  totalConversions: number
  /** Overall conversion rate */
  overallConversionRate: number
  /** Metrics per variant */
  variants: Record<string, VariantMetrics>
  /** Best performing variant (by conversion rate) */
  bestVariant?: string
  /** Control variant (for comparison) */
  controlVariant?: string
  /** Relative lift of best variant vs control */
  relativeLift?: number
}

/**
 * Filters for querying conversions
 */
export interface ConversionFilters {
  /** Filter by experiment ID */
  experimentId?: string
  /** Filter by goal ID */
  goalId?: string
  /** Filter by user ID */
  userId?: string
  /** Filter by variant */
  variant?: string
  /** Filter by event name */
  eventName?: string
  /** Filter conversions after this date */
  after?: Date
  /** Filter conversions before this date */
  before?: Date
  /** Pagination limit */
  limit?: number
  /** Pagination offset */
  offset?: number
}

/**
 * Configuration for the conversion tracker
 */
export interface ConversionTrackerConfig {
  /** Experiment tracker for assignment lookup */
  tracker: ExperimentTracker
  /** Goals to track (mapped by experiment ID) */
  goals?: Map<string, ExperimentGoal[]>
  /** Enable deduplication */
  deduplication?: boolean
  /** Callback when conversion is recorded */
  onConversion?: (event: ConversionEvent) => void | Promise<void>
  /** Callback for batch conversions */
  onBatchFlush?: (events: ConversionEvent[]) => void | Promise<void>
  /** Batch size before auto-flush */
  batchSize?: number
  /** Flush interval in milliseconds */
  flushInterval?: number
}

/**
 * Conversion tracker interface
 */
export interface ConversionTracker {
  /** Track a conversion event */
  track(
    experimentId: string,
    goalId: string,
    userId: string,
    options?: TrackConversionOptions
  ): Promise<ConversionEvent | null>
  /** Track a conversion by event name (auto-matches goals) */
  trackEvent(
    eventName: string,
    userId: string,
    options?: TrackConversionOptions
  ): Promise<ConversionEvent[]>
  /** Register goals for an experiment */
  registerGoals(experimentId: string, goals: ExperimentGoal[]): void
  /** Get conversion events */
  getConversions(filters: ConversionFilters): Promise<ConversionEvent[]>
  /** Get aggregated metrics for a goal */
  getGoalMetrics(experimentId: string, goalId: string): Promise<GoalMetrics | null>
  /** Get aggregated metrics for all goals in an experiment */
  getExperimentMetrics(experimentId: string): Promise<GoalMetrics[]>
  /** Get conversion count for a user in an experiment */
  getUserConversionCount(experimentId: string, userId: string): Promise<number>
  /** Check if a user has converted for a specific goal */
  hasConverted(experimentId: string, goalId: string, userId: string): Promise<boolean>
  /** Clear conversions for testing */
  clearConversions(experimentId?: string): Promise<void>
  /** Flush pending batch */
  flush(): Promise<void>
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Generate a unique event ID
 */
function generateEventId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `cvn_${timestamp}_${random}`
}

/**
 * Calculate standard deviation
 */
function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2))
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length
  return Math.sqrt(avgSquaredDiff)
}

/**
 * Calculate median
 */
function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Calculate percentile
 */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))]
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * In-memory conversion tracker implementation
 */
class InMemoryConversionTracker implements ConversionTracker {
  private tracker: ExperimentTracker
  private conversions: Map<string, ConversionEvent> = new Map()
  private experimentIndex: Map<string, Set<string>> = new Map() // experimentId -> Set<eventIds>
  private goalIndex: Map<string, Set<string>> = new Map() // experimentId:goalId -> Set<eventIds>
  private userIndex: Map<string, Set<string>> = new Map() // userId -> Set<eventIds>
  private deduplicationIndex: Map<string, string> = new Map() // deduplicationKey -> eventId
  private goals: Map<string, ExperimentGoal[]> = new Map() // experimentId -> goals
  private eventNameIndex: Map<string, string[]> = new Map() // eventName -> [experimentId:goalId]
  private batchQueue: ConversionEvent[] = []
  private config: Required<Omit<ConversionTrackerConfig, 'tracker' | 'goals' | 'onConversion' | 'onBatchFlush'>> & {
    tracker: ExperimentTracker
    onConversion?: (event: ConversionEvent) => void | Promise<void>
    onBatchFlush?: (events: ConversionEvent[]) => void | Promise<void>
  }
  private flushTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: ConversionTrackerConfig) {
    this.tracker = config.tracker
    this.config = {
      tracker: config.tracker,
      deduplication: config.deduplication ?? true,
      batchSize: config.batchSize ?? 100,
      flushInterval: config.flushInterval ?? 5000,
      onConversion: config.onConversion,
      onBatchFlush: config.onBatchFlush,
    }

    // Register initial goals
    if (config.goals) {
      for (const [experimentId, experimentGoals] of config.goals) {
        this.registerGoals(experimentId, experimentGoals)
      }
    }

    // Start flush timer
    if (this.config.flushInterval > 0 && this.config.onBatchFlush) {
      this.flushTimer = setInterval(() => {
        this.flush().catch(() => {})
      }, this.config.flushInterval)
    }
  }

  registerGoals(experimentId: string, goals: ExperimentGoal[]): void {
    this.goals.set(experimentId, goals)

    // Update event name index for fast lookup
    for (const goal of goals) {
      const key = `${experimentId}:${goal.id}`
      const existing = this.eventNameIndex.get(goal.eventName) ?? []
      if (!existing.includes(key)) {
        existing.push(key)
        this.eventNameIndex.set(goal.eventName, existing)
      }
    }
  }

  async track(
    experimentId: string,
    goalId: string,
    userId: string,
    options?: TrackConversionOptions
  ): Promise<ConversionEvent | null> {
    // Get user's assignment
    const assignment = await this.tracker.getAssignment(experimentId, userId)
    if (!assignment) {
      // User not assigned to this experiment
      return null
    }

    // Check deduplication
    if (options?.deduplicationKey && this.config.deduplication) {
      const dedupKey = `${experimentId}:${goalId}:${options.deduplicationKey}`
      if (this.deduplicationIndex.has(dedupKey)) {
        return null
      }
    }

    // Get goal info
    const experimentGoals = this.goals.get(experimentId)
    const goal = experimentGoals?.find(g => g.id === goalId)

    const now = options?.timestamp ?? new Date()
    const timeSinceAssignment = now.getTime() - assignment.assignedAt.getTime()

    // Create conversion event
    const event: ConversionEvent = {
      id: generateEventId(),
      experimentId,
      goalId,
      userId,
      variant: assignment.variant,
      eventName: goal?.eventName ?? goalId,
      value: options?.value ?? (goal?.aggregation === 'count' ? 1 : undefined),
      timestamp: now,
      timeSinceAssignment,
      properties: options?.properties,
    }

    // Store event
    this.conversions.set(event.id, event)

    // Update indices
    if (!this.experimentIndex.has(experimentId)) {
      this.experimentIndex.set(experimentId, new Set())
    }
    this.experimentIndex.get(experimentId)!.add(event.id)

    const goalKey = `${experimentId}:${goalId}`
    if (!this.goalIndex.has(goalKey)) {
      this.goalIndex.set(goalKey, new Set())
    }
    this.goalIndex.get(goalKey)!.add(event.id)

    if (!this.userIndex.has(userId)) {
      this.userIndex.set(userId, new Set())
    }
    this.userIndex.get(userId)!.add(event.id)

    if (options?.deduplicationKey && this.config.deduplication) {
      const dedupKey = `${experimentId}:${goalId}:${options.deduplicationKey}`
      this.deduplicationIndex.set(dedupKey, event.id)
    }

    // Add to batch queue
    this.batchQueue.push(event)

    // Trigger callback
    if (this.config.onConversion) {
      await Promise.resolve(this.config.onConversion(event))
    }

    // Auto-flush if batch size reached
    if (this.batchQueue.length >= this.config.batchSize) {
      await this.flush()
    }

    return event
  }

  async trackEvent(
    eventName: string,
    userId: string,
    options?: TrackConversionOptions
  ): Promise<ConversionEvent[]> {
    // Find all goals that match this event name
    const goalKeys = this.eventNameIndex.get(eventName) ?? []
    const events: ConversionEvent[] = []

    for (const key of goalKeys) {
      const [experimentId, goalId] = key.split(':')
      const event = await this.track(experimentId, goalId, userId, options)
      if (event) {
        events.push(event)
      }
    }

    return events
  }

  async getConversions(filters: ConversionFilters): Promise<ConversionEvent[]> {
    let eventIds: Set<string>

    // Start with the most specific filter
    if (filters.experimentId && filters.goalId) {
      const goalKey = `${filters.experimentId}:${filters.goalId}`
      eventIds = new Set(this.goalIndex.get(goalKey) ?? [])
    } else if (filters.experimentId) {
      eventIds = new Set(this.experimentIndex.get(filters.experimentId) ?? [])
    } else if (filters.userId) {
      eventIds = new Set(this.userIndex.get(filters.userId) ?? [])
    } else {
      eventIds = new Set(this.conversions.keys())
    }

    let events = Array.from(eventIds)
      .map(id => this.conversions.get(id)!)
      .filter(Boolean)

    // Apply additional filters
    if (filters.userId && filters.experimentId) {
      events = events.filter(e => e.userId === filters.userId)
    }

    if (filters.variant) {
      events = events.filter(e => e.variant === filters.variant)
    }

    if (filters.eventName) {
      events = events.filter(e => e.eventName === filters.eventName)
    }

    if (filters.after) {
      events = events.filter(e => e.timestamp >= filters.after!)
    }

    if (filters.before) {
      events = events.filter(e => e.timestamp <= filters.before!)
    }

    // Sort by timestamp (newest first)
    events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

    // Pagination
    const offset = filters.offset ?? 0
    const limit = filters.limit ?? events.length
    events = events.slice(offset, offset + limit)

    return events.map(e => ({ ...e }))
  }

  async getGoalMetrics(experimentId: string, goalId: string): Promise<GoalMetrics | null> {
    const experimentGoals = this.goals.get(experimentId)
    const goal = experimentGoals?.find(g => g.id === goalId)

    if (!goal) {
      return null
    }

    const goalKey = `${experimentId}:${goalId}`
    const eventIds = this.goalIndex.get(goalKey) ?? new Set()

    // Get assignment summary for sample sizes
    const assignmentSummary = await this.tracker.getSummary(experimentId)

    // Group conversions by variant
    const variantConversions: Record<string, ConversionEvent[]> = {}
    const uniqueConverters: Record<string, Set<string>> = {}

    for (const eventId of eventIds) {
      const event = this.conversions.get(eventId)
      if (event) {
        if (!variantConversions[event.variant]) {
          variantConversions[event.variant] = []
          uniqueConverters[event.variant] = new Set()
        }
        variantConversions[event.variant].push(event)
        uniqueConverters[event.variant].add(event.userId)
      }
    }

    // Calculate metrics per variant
    const variants: Record<string, VariantMetrics> = {}
    let bestVariant: string | undefined
    let bestRate = -1
    let controlVariant: string | undefined

    for (const [variant, sampleSize] of Object.entries(assignmentSummary.variantCounts)) {
      const conversions = variantConversions[variant] ?? []
      const uniqueUsers = uniqueConverters[variant]?.size ?? 0
      const values = conversions.map(e => e.value ?? 1)
      const totalValue = values.reduce((a, b) => a + b, 0)

      const conversionRate = sampleSize > 0 ? uniqueUsers / sampleSize : 0

      variants[variant] = {
        variant,
        sampleSize,
        conversions: uniqueUsers, // Count unique converters
        conversionRate,
        totalValue,
        meanValue: values.length > 0 ? totalValue / values.length : 0,
        meanValuePerUser: sampleSize > 0 ? totalValue / sampleSize : 0,
        values,
        standardDeviation: standardDeviation(values),
        medianValue: median(values),
        p95Value: percentile(values, 95),
      }

      if (conversionRate > bestRate) {
        bestRate = conversionRate
        bestVariant = variant
      }

      // Check if this is the control (we need to get experiment to know)
      // For now, assume first variant or one marked as control
      if (!controlVariant) {
        controlVariant = variant
      }
    }

    // Calculate overall metrics
    const totalSampleSize = Object.values(variants).reduce((a, v) => a + v.sampleSize, 0)
    const totalConversions = Object.values(variants).reduce((a, v) => a + v.conversions, 0)
    const overallConversionRate = totalSampleSize > 0 ? totalConversions / totalSampleSize : 0

    // Calculate relative lift
    let relativeLift: number | undefined
    if (bestVariant && controlVariant && bestVariant !== controlVariant) {
      const controlRate = variants[controlVariant]?.conversionRate ?? 0
      if (controlRate > 0) {
        relativeLift = ((variants[bestVariant]?.conversionRate ?? 0) - controlRate) / controlRate
      }
    }

    return {
      experimentId,
      goalId,
      goalName: goal.name,
      totalSampleSize,
      totalConversions,
      overallConversionRate,
      variants,
      bestVariant,
      controlVariant,
      relativeLift,
    }
  }

  async getExperimentMetrics(experimentId: string): Promise<GoalMetrics[]> {
    const experimentGoals = this.goals.get(experimentId)
    if (!experimentGoals) {
      return []
    }

    const metrics: GoalMetrics[] = []
    for (const goal of experimentGoals) {
      const goalMetrics = await this.getGoalMetrics(experimentId, goal.id)
      if (goalMetrics) {
        metrics.push(goalMetrics)
      }
    }

    return metrics
  }

  async getUserConversionCount(experimentId: string, userId: string): Promise<number> {
    const userEventIds = this.userIndex.get(userId) ?? new Set()
    let count = 0

    for (const eventId of userEventIds) {
      const event = this.conversions.get(eventId)
      if (event && event.experimentId === experimentId) {
        count++
      }
    }

    return count
  }

  async hasConverted(experimentId: string, goalId: string, userId: string): Promise<boolean> {
    const goalKey = `${experimentId}:${goalId}`
    const goalEventIds = this.goalIndex.get(goalKey) ?? new Set()

    for (const eventId of goalEventIds) {
      const event = this.conversions.get(eventId)
      if (event && event.userId === userId) {
        return true
      }
    }

    return false
  }

  async clearConversions(experimentId?: string): Promise<void> {
    if (experimentId) {
      const eventIds = this.experimentIndex.get(experimentId)
      if (eventIds) {
        for (const eventId of eventIds) {
          const event = this.conversions.get(eventId)
          if (event) {
            // Remove from user index
            this.userIndex.get(event.userId)?.delete(eventId)
            // Remove from goal index
            const goalKey = `${event.experimentId}:${event.goalId}`
            this.goalIndex.get(goalKey)?.delete(eventId)
            // Remove from conversions
            this.conversions.delete(eventId)
          }
        }
        this.experimentIndex.delete(experimentId)
      }
    } else {
      this.conversions.clear()
      this.experimentIndex.clear()
      this.goalIndex.clear()
      this.userIndex.clear()
      this.deduplicationIndex.clear()
    }
  }

  async flush(): Promise<void> {
    if (this.batchQueue.length === 0) {
      return
    }

    const events = [...this.batchQueue]
    this.batchQueue = []

    if (this.config.onBatchFlush) {
      await Promise.resolve(this.config.onBatchFlush(events))
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a new conversion tracker
 */
export function createConversionTracker(
  config: ConversionTrackerConfig
): ConversionTracker & { destroy: () => void } {
  return new InMemoryConversionTracker(config)
}
