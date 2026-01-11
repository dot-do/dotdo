/**
 * Usage Metering System
 *
 * Unified API for tracking usage across all *.do services.
 *
 * Services tracked:
 * - calls.do: minutes, calls count
 * - texts.do: messages sent/received
 * - emails.do: emails sent, opens, clicks
 * - payments.do: transactions, volume
 * - llm.do: tokens consumed, requests
 * - queue.do: messages processed
 *
 * @example
 * ```typescript
 * import { UsageMetering } from '@dotdo/metering'
 *
 * const metering = new UsageMetering(ctx)
 *
 * // Track usage
 * await metering.track('agent-123', 'llm.do', 'tokens', 1500)
 *
 * // Query usage
 * const usage = await metering.query({ agentId: 'agent-123', last: '30d' })
 *
 * // Check limits
 * const allowed = await metering.checkLimit('agent-123', 'emails.do', 'sends')
 * ```
 *
 * @module services/metering
 */

// Re-export types
export * from './types'

// Re-export counter module
export {
  InMemoryCounterStorage,
  SQLiteCounterStorage,
  counterKeyToString,
  stringToCounterKey,
  serviceMetricKey,
  getPeriodStart,
  getPeriodEnd,
  getPeriodDuration,
  COUNTERS_SCHEMA,
} from './counter'

// Re-export aggregator module
export {
  UsageAggregator,
  InMemoryAggregationSink,
  ParquetAggregationSink,
  createDevAggregator,
  createProdAggregator,
  type AggregationSink,
} from './aggregator'

// Re-export limiter module
export {
  UsageLimiter,
  LimitExceededError,
  FREE_TIER_LIMITS,
  PRO_TIER_LIMITS,
  createFreeTierLimiter,
  createProTierLimiter,
  createCustomLimiter,
} from './limiter'

// Import internal dependencies
import type {
  UsageMetric,
  UsageQuery,
  UsageSummary,
  UsageLimit,
  LimitCheckResult,
  MeteringService,
  ServiceUsageSummary,
  UsageEvent,
  UsageEventHandler,
  BillingPeriod,
  CounterKey,
  TimeRange,
} from './types'
import { InMemoryCounterStorage, getPeriodStart, getPeriodEnd } from './counter'
import { UsageLimiter } from './limiter'
import { InMemoryAggregationSink, UsageAggregator } from './aggregator'

// ============================================================================
// Main UsageMetering Class
// ============================================================================

/**
 * Configuration options for UsageMetering
 */
export interface UsageMeteringConfig {
  /** Default billing period for queries */
  defaultPeriod?: BillingPeriod
  /** Enable event emission */
  enableEvents?: boolean
  /** Auto-aggregate interval (ms, 0 to disable) */
  aggregateInterval?: number
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: UsageMeteringConfig = {
  defaultPeriod: 'monthly',
  enableEvents: true,
  aggregateInterval: 0, // Disabled by default
}

/**
 * Usage Metering System
 *
 * Provides a unified API for tracking, querying, and limiting usage
 * across all *.do services.
 */
export class UsageMetering {
  private config: UsageMeteringConfig
  private storage: InMemoryCounterStorage
  private limiter: UsageLimiter
  private aggregator: UsageAggregator
  private sink: InMemoryAggregationSink
  private eventHandlers: UsageEventHandler[] = []
  private aggregateTimer?: ReturnType<typeof setInterval>

  constructor(config?: Partial<UsageMeteringConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }

    // Initialize storage and components
    this.storage = new InMemoryCounterStorage()
    this.limiter = new UsageLimiter(this.storage)
    this.sink = new InMemoryAggregationSink()
    this.aggregator = new UsageAggregator(this.storage, this.sink)

    // Start aggregation timer if configured
    if (this.config.aggregateInterval && this.config.aggregateInterval > 0) {
      this.aggregateTimer = setInterval(
        () => this.runAggregation(),
        this.config.aggregateInterval
      )
    }
  }

  /**
   * Track usage for a service
   */
  async track(
    agentId: string,
    service: MeteringService,
    metric: string,
    value: number,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const period = this.config.defaultPeriod!
    const periodStart = getPeriodStart(period)

    const key: CounterKey = {
      agentId,
      service,
      metric,
      period,
      periodTimestamp: periodStart,
    }

    await this.storage.increment(key, value)

    // Emit event if enabled
    if (this.config.enableEvents) {
      await this.emitEvent({
        type: 'usage.tracked',
        agentId,
        service,
        metric,
        payload: { delta: value },
        timestamp: new Date(),
      })
    }
  }

  /**
   * Query usage data
   */
  async query(query: UsageQuery): Promise<UsageSummary> {
    const { agentId, service, timeRange } = query
    const period = this.config.defaultPeriod!

    // Calculate period bounds from time range
    const { periodStart, periodEnd } = this.parsTimeRange(timeRange)

    // Get all counters for the agent
    const counters = await this.storage.getAll(agentId, period)

    // Build summary
    const byService: Record<MeteringService, ServiceUsageSummary> = {} as Record<
      MeteringService,
      ServiceUsageSummary
    >
    let totalRequests = 0
    let totalCostUnits = 0

    for (const [key, value] of counters) {
      const [svc, metric] = key.split(':')
      const svcKey = svc as MeteringService

      // Filter by service if specified
      if (service && svc !== service) continue

      // Initialize service summary if needed
      if (!byService[svcKey]) {
        byService[svcKey] = {
          service: svcKey,
          metrics: {},
          costUnits: 0,
          requestCount: 0,
        }
      }

      byService[svcKey].metrics[metric] = value
      byService[svcKey].requestCount++
      totalRequests++

      // Calculate cost
      const cost = this.calculateCost(svcKey, metric, value)
      byService[svcKey].costUnits += cost
      totalCostUnits += cost
    }

    return {
      agentId,
      periodStart,
      periodEnd,
      totals: {
        costUnits: totalCostUnits,
        requests: totalRequests,
        apiCalls: totalRequests,
      },
      byService,
    }
  }

  /**
   * Check if an operation is allowed against limits
   */
  async checkLimit(
    agentId: string,
    service: MeteringService,
    metric: string
  ): Promise<LimitCheckResult> {
    return this.limiter.checkLimit(agentId, service, metric)
  }

  /**
   * Set a usage limit for an agent
   */
  setLimit(agentId: string, limit: UsageLimit): void {
    this.limiter.setLimit(agentId, limit)
  }

  /**
   * Get usage summary for an agent
   */
  async getSummary(agentId: string): Promise<UsageSummary> {
    return this.query({ agentId })
  }

  /**
   * Register an event handler
   */
  onEvent(handler: UsageEventHandler): () => void {
    this.eventHandlers.push(handler)
    return () => {
      const idx = this.eventHandlers.indexOf(handler)
      if (idx >= 0) this.eventHandlers.splice(idx, 1)
    }
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this.aggregateTimer) {
      clearInterval(this.aggregateTimer)
      this.aggregateTimer = undefined
    }
  }

  // ============================================================================
  // Internal Methods
  // ============================================================================

  /**
   * Emit a usage event to all handlers
   */
  private async emitEvent(event: UsageEvent): Promise<void> {
    for (const handler of this.eventHandlers) {
      try {
        await handler(event)
      } catch (error) {
        console.error('Event handler error:', error)
      }
    }
  }

  /**
   * Parse time range to period bounds
   */
  private parsTimeRange(timeRange?: TimeRange): { periodStart: Date; periodEnd: Date } {
    const now = new Date()

    if (!timeRange) {
      return {
        periodStart: getPeriodStart(this.config.defaultPeriod!),
        periodEnd: now,
      }
    }

    if ('last' in timeRange) {
      // Parse duration string (e.g., '30d', '24h', '7d')
      const match = timeRange.last.match(/^(\d+)([hdwm])$/)
      if (!match) {
        return {
          periodStart: getPeriodStart(this.config.defaultPeriod!),
          periodEnd: now,
        }
      }

      const amount = parseInt(match[1], 10)
      const unit = match[2]
      const periodStart = new Date(now)

      switch (unit) {
        case 'h':
          periodStart.setHours(periodStart.getHours() - amount)
          break
        case 'd':
          periodStart.setDate(periodStart.getDate() - amount)
          break
        case 'w':
          periodStart.setDate(periodStart.getDate() - amount * 7)
          break
        case 'm':
          periodStart.setMonth(periodStart.getMonth() - amount)
          break
      }

      return { periodStart, periodEnd: now }
    }

    if ('from' in timeRange && 'to' in timeRange) {
      return { periodStart: timeRange.from, periodEnd: timeRange.to }
    }

    if ('from' in timeRange) {
      return { periodStart: timeRange.from, periodEnd: now }
    }

    if ('to' in timeRange) {
      return {
        periodStart: getPeriodStart(this.config.defaultPeriod!),
        periodEnd: timeRange.to,
      }
    }

    return {
      periodStart: getPeriodStart(this.config.defaultPeriod!),
      periodEnd: now,
    }
  }

  /**
   * Calculate cost for a usage metric
   */
  private calculateCost(service: MeteringService, metric: string, value: number): number {
    // Simplified cost calculation
    const costRates: Record<string, Record<string, number>> = {
      'llm.do': {
        tokens: 0.00001,
        requests: 0.001,
      },
      'calls.do': {
        minutes: 0.015,
        calls: 0.01,
      },
      'texts.do': {
        sent: 0.0075,
        received: 0.0075,
      },
      'emails.do': {
        sent: 0.0001,
        opens: 0,
        clicks: 0,
      },
      'payments.do': {
        transactions: 0.30,
        volume: 0.029,
      },
      'queue.do': {
        messages: 0.00001,
        processed: 0,
      },
    }

    const rate = costRates[service]?.[metric] ?? 0
    return value * rate
  }

  /**
   * Run periodic aggregation
   */
  private async runAggregation(): Promise<void> {
    // Get unique agent IDs from storage
    // In production, this would be more sophisticated
    const counters = this.storage.getCounters()
    const agentIds = new Set<string>()

    for (const key of counters.keys()) {
      const agentId = key.split(':')[0]
      agentIds.add(agentId)
    }

    for (const agentId of agentIds) {
      try {
        await this.aggregator.aggregateHourly(agentId)
      } catch (error) {
        console.error(`Aggregation failed for agent ${agentId}:`, error)
      }
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a development metering instance
 */
export function createDevMetering(config?: Partial<UsageMeteringConfig>): UsageMetering {
  return new UsageMetering(config)
}

/**
 * Create a metering instance with DO storage
 */
export function createDOMetering(
  _ctx: { storage: unknown },
  config?: Partial<UsageMeteringConfig>
): UsageMetering {
  // In production, this would use SQLiteCounterStorage with ctx.storage
  return new UsageMetering(config)
}

// ============================================================================
// Default Export
// ============================================================================

export default UsageMetering
