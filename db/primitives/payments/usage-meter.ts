/**
 * Usage Meter - Comprehensive usage-based billing and metering
 *
 * Features:
 * - Event ingestion (single and batch)
 * - Multiple aggregation types (sum, max, unique, last_during_period)
 * - Usage tiers (graduated, volume, package)
 * - Usage limits and alerts
 * - Billing cycle management with rollover
 * - Real-time vs batch reporting
 * - Pricing calculations
 * - Invoice line item generation
 *
 * @module db/primitives/payments/usage-meter
 */

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Aggregation period
 */
export type AggregationPeriod = 'hour' | 'day' | 'month' | 'year' | 'billing_cycle'

/**
 * Aggregation type
 */
export type AggregationType = 'sum' | 'max' | 'unique' | 'last_during_period'

/**
 * Tier pricing type
 */
export type TierType = 'graduated' | 'volume' | 'package'

/**
 * Limit action
 */
export type LimitAction = 'block' | 'warn'

/**
 * Usage reporting mode
 */
export type UsageReportingMode = 'real-time' | 'batch'

/**
 * Rounding mode for pricing
 */
export type RoundingMode = 'half_up' | 'floor' | 'ceil'

/**
 * Pricing type
 */
export type PricingType = 'per_unit' | 'overage'

/**
 * Usage event
 */
export interface UsageEvent {
  id: string
  customerId: string
  metricId: string
  quantity: number
  timestamp: Date
  properties: Record<string, unknown>
  idempotencyKey?: string
}

/**
 * Usage event input (for recording)
 */
export interface RecordEventInput {
  customerId: string
  metricId: string
  quantity: number
  timestamp?: Date
  properties?: Record<string, unknown>
  idempotencyKey?: string
  enforceLimit?: boolean
}

/**
 * Usage aggregate
 */
export interface UsageAggregate {
  customerId: string
  metricId: string
  period: AggregationPeriod
  startTime: Date
  endTime: Date
  total: number
  count: number
  aggregation: AggregationType
}

/**
 * Tier definition
 */
export interface UsageTier {
  upTo: number | null
  pricePerUnit: number
  name?: string
}

/**
 * Tier configuration
 */
export interface TierConfig {
  type: TierType
  tiers?: UsageTier[]
  flatFee?: number
  packageSize?: number
  packagePrice?: number
}

/**
 * Usage limit
 */
export interface UsageLimit {
  customerId: string
  metricId: string
  limit: number
  period: AggregationPeriod
  action: LimitAction
}

/**
 * Limit status
 */
export interface LimitStatus {
  withinLimit: boolean
  exceeded: boolean
  currentUsage: number
  limit: number
  remaining: number
  overage: number
  rollover: number
}

/**
 * Usage alert configuration
 */
export interface UsageAlert {
  customerId: string
  metricId: string
  thresholds: number[]
  channels: string[]
  triggeredThresholds: Set<number>
}

/**
 * Alert event data
 */
export interface AlertEvent {
  customerId: string
  metricId: string
  threshold: number
  currentUsage: number
  limit: number
}

/**
 * Billing cycle configuration
 */
export interface BillingCycleConfig {
  anchorDate: Date
  period: AggregationPeriod
}

/**
 * Billing period
 */
export interface BillingPeriod {
  startDate: Date
  endDate: Date
}

/**
 * Rollover policy
 */
export interface UsageRolloverPolicy {
  enabled: boolean
  maxRollover?: number
  expirationPeriods?: number
}

/**
 * Rollover history entry
 */
export interface RolloverHistoryEntry {
  period: Date
  rolledOver: number
  expiresAt?: Date
}

/**
 * Reporting mode config
 */
export interface ReportingModeConfig {
  mode: UsageReportingMode
  flushInterval?: number
  batchSize?: number
  immediateForLimits?: boolean
}

/**
 * Sync status
 */
export interface SyncStatus {
  pendingEvents: number
  lastFlushed: Date
}

/**
 * Pricing configuration
 */
export interface UsagePricingConfig {
  type: PricingType
  pricePerUnit?: number
  minimumCharge?: number
  maximumCharge?: number
  includedUnits?: number
  overagePrice?: number
  currency?: string
  roundingMode?: RoundingMode
  decimalPlaces?: number
  description?: string
}

/**
 * Price calculation result
 */
export interface PriceResult {
  total: number
  breakdown?: TierBreakdownItem[]
  appliedTier?: number
  packages?: number
  flatFee?: number
  usageFee?: number
  minimumApplied?: boolean
  maximumApplied?: boolean
  currency?: string
  includedUnits?: number
  billableUnits?: number
  overage?: number
}

/**
 * Tier breakdown item
 */
export interface TierBreakdownItem {
  tier: number
  quantity: number
  pricePerUnit: number
  amount: number
}

/**
 * Current tier info
 */
export interface CurrentTierInfo {
  name?: string
  tier: number
  usageInTier: number
}

/**
 * Usage summary
 */
export interface UsageSummary {
  customerId: string
  startDate: Date
  endDate: Date
  metrics: MetricSummary[]
  totalPrice: number
}

/**
 * Metric summary
 */
export interface MetricSummary {
  metricId: string
  total: number
  count: number
  price?: number
  breakdown?: DailyBreakdown[]
  tierBreakdown?: TierBreakdownItem[]
  groups?: Record<string, number>
}

/**
 * Daily breakdown
 */
export interface DailyBreakdown {
  date: Date
  total: number
}

/**
 * Invoice line item
 */
export interface InvoiceLineItem {
  description: string
  quantity: number
  unitPrice: number
  amount: number
  metricId: string
}

/**
 * Metric definition
 */
export interface MetricDefinition {
  id: string
  name: string
  description?: string
  unit?: string
  aggregation: AggregationType
}

// =============================================================================
// Helper Functions
// =============================================================================

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${prefix}_${timestamp}${random}`
}

function getStartOfPeriod(date: Date, period: AggregationPeriod): Date {
  const result = new Date(date)
  result.setUTCMilliseconds(0)
  result.setUTCSeconds(0)
  result.setUTCMinutes(0)

  switch (period) {
    case 'hour':
      break
    case 'day':
      result.setUTCHours(0)
      break
    case 'month':
      result.setUTCHours(0)
      result.setUTCDate(1)
      break
    case 'year':
      result.setUTCHours(0)
      result.setUTCDate(1)
      result.setUTCMonth(0)
      break
    default:
      result.setUTCHours(0)
  }

  return result
}

function getEndOfPeriod(date: Date, period: AggregationPeriod): Date {
  const start = getStartOfPeriod(date, period)
  const result = new Date(start)

  switch (period) {
    case 'hour':
      result.setUTCHours(result.getUTCHours() + 1)
      break
    case 'day':
      result.setUTCDate(result.getUTCDate() + 1)
      break
    case 'month':
      result.setUTCMonth(result.getUTCMonth() + 1)
      break
    case 'year':
      result.setUTCFullYear(result.getUTCFullYear() + 1)
      break
    default:
      result.setUTCDate(result.getUTCDate() + 1)
  }

  return result
}

function addPeriod(date: Date, period: AggregationPeriod): Date {
  const result = new Date(date)
  switch (period) {
    case 'hour':
      result.setUTCHours(result.getUTCHours() + 1)
      break
    case 'day':
      result.setUTCDate(result.getUTCDate() + 1)
      break
    case 'month':
      result.setUTCMonth(result.getUTCMonth() + 1)
      break
    case 'year':
      result.setUTCFullYear(result.getUTCFullYear() + 1)
      break
    case 'billing_cycle':
      result.setUTCMonth(result.getUTCMonth() + 1) // Default to monthly
      break
  }
  return result
}

function roundPrice(value: number, decimalPlaces: number = 2, mode: RoundingMode = 'half_up'): number {
  const factor = Math.pow(10, decimalPlaces)
  switch (mode) {
    case 'floor':
      return Math.floor(value * factor) / factor
    case 'ceil':
      return Math.ceil(value * factor) / factor
    case 'half_up':
    default:
      return Math.round(value * factor) / factor
  }
}

// =============================================================================
// UsageMeter Implementation
// =============================================================================

export class UsageMeter {
  // Event storage
  private events: Map<string, UsageEvent> = new Map()
  private eventsByCustomer: Map<string, UsageEvent[]> = new Map()
  private idempotencyKeys: Map<string, string> = new Map()

  // Pending events (for batch mode)
  private pendingEvents: Map<string, UsageEvent[]> = new Map() // customerId:metricId -> events

  // Aggregate cache
  private aggregateCache: Map<string, UsageAggregate> = new Map()

  // Configuration storage
  private tierConfigs: Map<string, TierConfig> = new Map() // customerId:metricId -> config
  private limits: Map<string, UsageLimit> = new Map() // customerId:metricId -> limit
  private alerts: Map<string, UsageAlert> = new Map() // customerId:metricId -> alert
  private billingCycles: Map<string, BillingCycleConfig> = new Map() // customerId -> config
  private rolloverPolicies: Map<string, UsageRolloverPolicy> = new Map() // customerId:metricId -> policy
  private rolloverHistory: Map<string, RolloverHistoryEntry[]> = new Map() // customerId:metricId -> history
  private reportingModes: Map<string, ReportingModeConfig> = new Map() // customerId:metricId -> config
  private pricingConfigs: Map<string, UsagePricingConfig> = new Map() // customerId:metricId -> config
  private metrics: Map<string, MetricDefinition> = new Map()

  // Last flush timestamps
  private lastFlushTimes: Map<string, Date> = new Map()

  // Alert handler
  private alertHandler?: (alert: AlertEvent) => void

  // =============================================================================
  // Event Recording
  // =============================================================================

  /**
   * Record a single usage event
   */
  async recordEvent(input: RecordEventInput): Promise<UsageEvent> {
    // Validation
    if (!input.customerId || input.customerId.trim() === '') {
      throw new Error('Customer ID is required')
    }
    if (!input.metricId || input.metricId.trim() === '') {
      throw new Error('Metric ID is required')
    }
    if (input.quantity < 0) {
      throw new Error('Quantity must be non-negative')
    }

    // Check idempotency
    if (input.idempotencyKey) {
      const existingEventId = this.idempotencyKeys.get(input.idempotencyKey)
      if (existingEventId) {
        return this.events.get(existingEventId)!
      }
    }

    // Check limit enforcement
    if (input.enforceLimit) {
      const limitKey = `${input.customerId}:${input.metricId}`
      const limit = this.limits.get(limitKey)
      if (limit && limit.action === 'block') {
        const status = await this.checkLimit(input.customerId, input.metricId)
        if (status.exceeded || status.remaining < input.quantity) {
          throw new Error('Usage limit exceeded')
        }
      }
    }

    const event: UsageEvent = {
      id: generateId('evt'),
      customerId: input.customerId,
      metricId: input.metricId,
      quantity: input.quantity,
      timestamp: input.timestamp ?? new Date(),
      properties: input.properties ?? {},
      idempotencyKey: input.idempotencyKey,
    }

    // Check reporting mode
    const modeKey = `${input.customerId}:${input.metricId}`
    const reportingConfig = this.reportingModes.get(modeKey)
    const isBatchMode = reportingConfig?.mode === 'batch'

    if (isBatchMode && !reportingConfig.immediateForLimits) {
      // Buffer event
      const pendingKey = `${input.customerId}:${input.metricId}`
      const pending = this.pendingEvents.get(pendingKey) ?? []
      pending.push(event)
      this.pendingEvents.set(pendingKey, pending)

      // Store idempotency key
      if (input.idempotencyKey) {
        this.idempotencyKeys.set(input.idempotencyKey, event.id)
      }

      // Also store event in main storage for idempotency lookup
      this.events.set(event.id, event)

      // Check if we should flush
      if (reportingConfig.batchSize && pending.length >= reportingConfig.batchSize) {
        await this.flushPending(input.customerId, input.metricId)
      }
    } else {
      // Store event immediately
      this.storeEvent(event)

      // Store idempotency key
      if (input.idempotencyKey) {
        this.idempotencyKeys.set(input.idempotencyKey, event.id)
      }
    }

    // Check alerts
    await this.checkAlerts(input.customerId, input.metricId)

    return event
  }

  /**
   * Record batch of events
   */
  async recordEvents(inputs: RecordEventInput[]): Promise<UsageEvent[]> {
    const results: UsageEvent[] = []
    for (const input of inputs) {
      const event = await this.recordEvent(input)
      results.push(event)
    }
    return results
  }

  /**
   * Store event in internal storage
   */
  private storeEvent(event: UsageEvent): void {
    this.events.set(event.id, event)

    const customerEvents = this.eventsByCustomer.get(event.customerId) ?? []
    customerEvents.push(event)
    this.eventsByCustomer.set(event.customerId, customerEvents)
  }

  /**
   * Get event by ID
   */
  async getEvent(eventId: string): Promise<UsageEvent | null> {
    return this.events.get(eventId) ?? null
  }

  /**
   * List events with filters
   */
  async listEvents(filters: {
    customerId: string
    metricId?: string
    startTime?: Date
    endTime?: Date
  }): Promise<UsageEvent[]> {
    let events = this.eventsByCustomer.get(filters.customerId) ?? []

    if (filters.metricId) {
      events = events.filter(e => e.metricId === filters.metricId)
    }

    if (filters.startTime) {
      events = events.filter(e => e.timestamp >= filters.startTime!)
    }

    if (filters.endTime) {
      events = events.filter(e => e.timestamp <= filters.endTime!)
    }

    return events
  }

  // =============================================================================
  // Aggregation
  // =============================================================================

  /**
   * Get aggregate for a specific period
   */
  async getAggregate(params: {
    customerId: string
    metricId: string
    period: AggregationPeriod
    date: Date
    aggregation?: AggregationType
    uniqueKey?: string
  }): Promise<UsageAggregate> {
    const aggregation = params.aggregation ?? 'sum'
    const startTime = getStartOfPeriod(params.date, params.period)
    const endTime = getEndOfPeriod(params.date, params.period)

    const events = await this.listEvents({
      customerId: params.customerId,
      metricId: params.metricId,
      startTime,
      endTime: new Date(endTime.getTime() - 1), // Exclusive end
    })

    let total = 0
    const count = events.length

    switch (aggregation) {
      case 'sum':
        total = events.reduce((sum, e) => sum + e.quantity, 0)
        break
      case 'max':
        total = events.length > 0 ? Math.max(...events.map(e => e.quantity)) : 0
        break
      case 'unique':
        if (params.uniqueKey) {
          const uniqueValues = new Set(
            events.map(e => e.properties[params.uniqueKey!]).filter(v => v !== undefined)
          )
          total = uniqueValues.size
        } else {
          total = count
        }
        break
      case 'last_during_period':
        if (events.length > 0) {
          const sorted = [...events].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
          total = sorted[0].quantity
        }
        break
    }

    return {
      customerId: params.customerId,
      metricId: params.metricId,
      period: params.period,
      startTime,
      endTime,
      total,
      count,
      aggregation,
    }
  }

  /**
   * Get aggregates for a date range
   */
  async getAggregates(params: {
    customerId: string
    metricId: string
    period: AggregationPeriod
    startDate: Date
    endDate: Date
    aggregation?: AggregationType
  }): Promise<UsageAggregate[]> {
    const aggregates: UsageAggregate[] = []
    let currentDate = getStartOfPeriod(params.startDate, params.period)
    const endDateStart = getStartOfPeriod(params.endDate, params.period)

    while (currentDate <= endDateStart) {
      const aggregate = await this.getAggregate({
        customerId: params.customerId,
        metricId: params.metricId,
        period: params.period,
        date: currentDate,
        aggregation: params.aggregation,
      })
      aggregates.push(aggregate)
      currentDate = addPeriod(currentDate, params.period)
    }

    return aggregates
  }

  // =============================================================================
  // Tier Configuration
  // =============================================================================

  /**
   * Configure pricing tiers
   */
  async configureTiers(
    customerId: string,
    metricId: string,
    config: TierConfig
  ): Promise<void> {
    const key = `${customerId}:${metricId}`
    this.tierConfigs.set(key, config)
  }

  /**
   * Get tier configuration
   */
  async getTierConfig(customerId: string, metricId: string): Promise<TierConfig | null> {
    const key = `${customerId}:${metricId}`
    return this.tierConfigs.get(key) ?? null
  }

  /**
   * Calculate price based on tiers
   */
  async calculatePrice(
    customerId: string,
    metricId: string,
    quantity: number
  ): Promise<PriceResult> {
    const config = await this.getTierConfig(customerId, metricId)
    if (!config) {
      return { total: 0 }
    }

    if (config.type === 'package') {
      const packages = Math.ceil(quantity / (config.packageSize ?? 1))
      const total = packages * (config.packagePrice ?? 0)
      return { total, packages }
    }

    if (config.type === 'volume') {
      const tiers = config.tiers ?? []
      let appliedTier = 0
      for (let i = 0; i < tiers.length; i++) {
        const tier = tiers[i]
        if (tier.upTo === null || quantity <= tier.upTo) {
          appliedTier = i
          break
        }
        if (i === tiers.length - 1) {
          appliedTier = i
        }
      }
      const tier = tiers[appliedTier]
      const total = quantity * (tier?.pricePerUnit ?? 0)
      return { total, appliedTier }
    }

    // Graduated pricing
    const tiers = config.tiers ?? []
    const breakdown: TierBreakdownItem[] = []
    let remaining = quantity
    let total = config.flatFee ?? 0
    let previousUpTo = 0

    for (let i = 0; i < tiers.length && remaining > 0; i++) {
      const tier = tiers[i]
      const tierCapacity = tier.upTo === null ? remaining : tier.upTo - previousUpTo
      const tierQuantity = Math.min(remaining, tierCapacity)

      const amount = tierQuantity * tier.pricePerUnit
      breakdown.push({
        tier: i,
        quantity: tierQuantity,
        pricePerUnit: tier.pricePerUnit,
        amount,
      })

      total += amount
      remaining -= tierQuantity
      previousUpTo = tier.upTo ?? previousUpTo + tierQuantity
    }

    const result: PriceResult = { total, breakdown }
    if (config.flatFee) {
      result.flatFee = config.flatFee
      result.usageFee = total - config.flatFee
    }

    return result
  }

  /**
   * Get current tier for customer usage
   */
  async getCurrentTier(customerId: string, metricId: string): Promise<CurrentTierInfo> {
    const config = await this.getTierConfig(customerId, metricId)
    if (!config || !config.tiers) {
      return { tier: 0, usageInTier: 0 }
    }

    const events = await this.listEvents({ customerId, metricId })
    const totalUsage = events.reduce((sum, e) => sum + e.quantity, 0)

    const tiers = config.tiers
    let accumulated = 0
    for (let i = 0; i < tiers.length; i++) {
      const tier = tiers[i]
      const tierCapacity = tier.upTo === null ? Infinity : tier.upTo - accumulated
      if (totalUsage <= accumulated + tierCapacity) {
        return {
          name: tier.name,
          tier: i,
          usageInTier: totalUsage - accumulated,
        }
      }
      accumulated = tier.upTo ?? accumulated
    }

    return { tier: tiers.length - 1, usageInTier: totalUsage - accumulated }
  }

  // =============================================================================
  // Limits and Alerts
  // =============================================================================

  /**
   * Set usage limit
   */
  async setLimit(
    customerId: string,
    metricId: string,
    config: { limit: number; period: AggregationPeriod; action: LimitAction }
  ): Promise<void> {
    const key = `${customerId}:${metricId}`
    this.limits.set(key, {
      customerId,
      metricId,
      limit: config.limit,
      period: config.period,
      action: config.action,
    })
  }

  /**
   * Get usage limit
   */
  async getLimit(customerId: string, metricId: string): Promise<UsageLimit | null> {
    const key = `${customerId}:${metricId}`
    return this.limits.get(key) ?? null
  }

  /**
   * Remove usage limit
   */
  async removeLimit(customerId: string, metricId: string): Promise<void> {
    const key = `${customerId}:${metricId}`
    this.limits.delete(key)
  }

  /**
   * List all limits for customer
   */
  async listLimits(customerId: string): Promise<UsageLimit[]> {
    const results: UsageLimit[] = []
    for (const [key, limit] of this.limits.entries()) {
      if (key.startsWith(`${customerId}:`)) {
        results.push(limit)
      }
    }
    return results
  }

  /**
   * Check limit status
   */
  async checkLimit(customerId: string, metricId: string): Promise<LimitStatus> {
    const limit = await this.getLimit(customerId, metricId)
    if (!limit) {
      return {
        withinLimit: true,
        exceeded: false,
        currentUsage: 0,
        limit: Infinity,
        remaining: Infinity,
        overage: 0,
        rollover: 0,
      }
    }

    let currentUsage: number
    let effectiveLimit = limit.limit

    if (limit.period === 'billing_cycle') {
      currentUsage = await this.getCurrentPeriodUsage(customerId, metricId)
    } else {
      const aggregate = await this.getAggregate({
        customerId,
        metricId,
        period: limit.period,
        date: new Date(),
      })
      currentUsage = aggregate.total
    }

    // Check rollover
    const rollover = await this.calculateCurrentRollover(customerId, metricId)
    effectiveLimit += rollover

    const withinLimit = currentUsage <= effectiveLimit
    const exceeded = currentUsage > effectiveLimit
    const remaining = Math.max(0, effectiveLimit - currentUsage)
    const overage = Math.max(0, currentUsage - effectiveLimit)

    return {
      withinLimit,
      exceeded,
      currentUsage,
      limit: effectiveLimit,
      remaining,
      overage,
      rollover,
    }
  }

  /**
   * Set alert configuration
   */
  async setAlert(
    customerId: string,
    metricId: string,
    config: { thresholds: number[]; channels: string[] }
  ): Promise<void> {
    const key = `${customerId}:${metricId}`
    this.alerts.set(key, {
      customerId,
      metricId,
      thresholds: config.thresholds,
      channels: config.channels,
      triggeredThresholds: new Set(),
    })
  }

  /**
   * Get alert configuration
   */
  async getAlert(customerId: string, metricId: string): Promise<UsageAlert | null> {
    const key = `${customerId}:${metricId}`
    return this.alerts.get(key) ?? null
  }

  /**
   * Register alert handler
   */
  onAlert(handler: (alert: AlertEvent) => void): void {
    this.alertHandler = handler
  }

  /**
   * Check and trigger alerts
   */
  private async checkAlerts(customerId: string, metricId: string): Promise<void> {
    const key = `${customerId}:${metricId}`
    const alert = this.alerts.get(key)
    const limit = this.limits.get(key)

    if (!alert || !limit || !this.alertHandler) return

    const status = await this.checkLimit(customerId, metricId)
    const percentUsed = (status.currentUsage / limit.limit) * 100

    for (const threshold of alert.thresholds) {
      if (percentUsed >= threshold && !alert.triggeredThresholds.has(threshold)) {
        alert.triggeredThresholds.add(threshold)
        this.alertHandler({
          customerId,
          metricId,
          threshold,
          currentUsage: status.currentUsage,
          limit: limit.limit,
        })
      }
    }
  }

  // =============================================================================
  // Billing Cycle Management
  // =============================================================================

  /**
   * Set billing cycle configuration
   */
  async setBillingCycle(
    customerId: string,
    config: { anchorDate: Date; period: AggregationPeriod }
  ): Promise<void> {
    this.billingCycles.set(customerId, {
      anchorDate: config.anchorDate,
      period: config.period,
    })
  }

  /**
   * Get billing cycle configuration
   */
  async getBillingCycle(customerId: string): Promise<BillingCycleConfig | null> {
    return this.billingCycles.get(customerId) ?? null
  }

  /**
   * Get current billing period
   */
  async getCurrentBillingPeriod(customerId: string): Promise<BillingPeriod> {
    const config = await this.getBillingCycle(customerId)
    if (!config) {
      const now = new Date()
      return {
        startDate: getStartOfPeriod(now, 'month'),
        endDate: getEndOfPeriod(now, 'month'),
      }
    }

    const now = new Date()
    const anchor = config.anchorDate
    let startDate = new Date(anchor)
    let endDate: Date

    // Find the current billing period
    while (true) {
      endDate = addPeriod(startDate, config.period)
      if (endDate > now) {
        break
      }
      startDate = endDate
    }

    return { startDate, endDate }
  }

  /**
   * Get usage for current billing period
   */
  async getCurrentPeriodUsage(customerId: string, metricId: string): Promise<number> {
    const period = await this.getCurrentBillingPeriod(customerId)
    const events = await this.listEvents({
      customerId,
      metricId,
      startTime: period.startDate,
      endTime: period.endDate,
    })
    return events.reduce((sum, e) => sum + e.quantity, 0)
  }

  // =============================================================================
  // Rollover Management
  // =============================================================================

  /**
   * Set rollover policy
   */
  async setRolloverPolicy(
    customerId: string,
    metricId: string,
    policy: UsageRolloverPolicy
  ): Promise<void> {
    const key = `${customerId}:${metricId}`
    this.rolloverPolicies.set(key, policy)
  }

  /**
   * Get rollover policy
   */
  async getRolloverPolicy(
    customerId: string,
    metricId: string
  ): Promise<UsageRolloverPolicy | null> {
    const key = `${customerId}:${metricId}`
    return this.rolloverPolicies.get(key) ?? null
  }

  /**
   * Calculate current rollover amount
   */
  private async calculateCurrentRollover(
    customerId: string,
    metricId: string
  ): Promise<number> {
    const policy = await this.getRolloverPolicy(customerId, metricId)
    if (!policy || !policy.enabled) return 0

    const key = `${customerId}:${metricId}`
    let history = this.rolloverHistory.get(key) ?? []
    const now = new Date()

    // Calculate rollover from previous periods
    const billingCycle = await this.getBillingCycle(customerId)
    const limit = await this.getLimit(customerId, metricId)
    if (!billingCycle || !limit) return 0

    const currentPeriod = await this.getCurrentBillingPeriod(customerId)

    // Determine the last period we've processed
    const lastProcessedPeriod = history.length > 0
      ? history[history.length - 1].period
      : null

    // Calculate rollover for all periods from anchor to current period
    let periodStart = new Date(billingCycle.anchorDate)

    // If we have history, start from the period after the last processed one
    if (lastProcessedPeriod) {
      periodStart = addPeriod(lastProcessedPeriod, billingCycle.period)
    }

    // Calculate rollover for each completed period
    while (periodStart < currentPeriod.startDate) {
      const periodEnd = addPeriod(periodStart, billingCycle.period)

      // Check if we already have this period in history
      const alreadyProcessed = history.some(h => h.period.getTime() === periodStart.getTime())

      if (!alreadyProcessed) {
        const periodEvents = await this.listEvents({
          customerId,
          metricId,
          startTime: periodStart,
          endTime: new Date(periodEnd.getTime() - 1),
        })
        const periodUsage = periodEvents.reduce((sum, e) => sum + e.quantity, 0)

        // Only create rollover entry if there was actual usage in the period
        // (don't roll over full limit if nothing was used)
        if (periodUsage > 0) {
          const unused = Math.max(0, limit.limit - periodUsage)
          const rolledOver = Math.min(unused, policy.maxRollover ?? Infinity)

          if (rolledOver > 0) {
            const entry: RolloverHistoryEntry = {
              period: new Date(periodStart),
              rolledOver,
            }
            if (policy.expirationPeriods) {
              const expiresAt = new Date(periodEnd)
              for (let i = 0; i < policy.expirationPeriods; i++) {
                expiresAt.setUTCMonth(expiresAt.getUTCMonth() + 1)
              }
              entry.expiresAt = expiresAt
            }
            history.push(entry)
          }
        }
      }

      periodStart = periodEnd
    }

    // Sort history by period
    history.sort((a, b) => a.period.getTime() - b.period.getTime())
    this.rolloverHistory.set(key, history)

    // Sum up valid rollover amounts
    let totalRollover = 0
    for (const entry of history) {
      if (!entry.expiresAt || entry.expiresAt > now) {
        totalRollover += entry.rolledOver
      }
    }

    return Math.min(totalRollover, policy.maxRollover ?? Infinity)
  }

  /**
   * Get rollover history
   */
  async getRolloverHistory(
    customerId: string,
    metricId: string
  ): Promise<RolloverHistoryEntry[]> {
    // Trigger rollover calculation to update history
    await this.calculateCurrentRollover(customerId, metricId)
    const key = `${customerId}:${metricId}`
    return this.rolloverHistory.get(key) ?? []
  }

  // =============================================================================
  // Reporting Mode
  // =============================================================================

  /**
   * Set reporting mode
   */
  async setReportingMode(
    customerId: string,
    metricId: string,
    config: ReportingModeConfig
  ): Promise<void> {
    const key = `${customerId}:${metricId}`
    this.reportingModes.set(key, config)
    this.lastFlushTimes.set(key, new Date())
  }

  /**
   * Get reporting mode
   */
  async getReportingMode(
    customerId: string,
    metricId: string
  ): Promise<ReportingModeConfig | null> {
    const key = `${customerId}:${metricId}`
    return this.reportingModes.get(key) ?? null
  }

  /**
   * Get pending events
   */
  async getPendingEvents(customerId: string, metricId: string): Promise<UsageEvent[]> {
    const key = `${customerId}:${metricId}`
    return this.pendingEvents.get(key) ?? []
  }

  /**
   * Flush pending events
   */
  async flushPending(customerId: string, metricId: string): Promise<void> {
    const key = `${customerId}:${metricId}`
    const pending = this.pendingEvents.get(key) ?? []

    for (const event of pending) {
      // Add to customer events if not already there
      const customerEvents = this.eventsByCustomer.get(event.customerId) ?? []
      if (!customerEvents.some(e => e.id === event.id)) {
        customerEvents.push(event)
        this.eventsByCustomer.set(event.customerId, customerEvents)
      }
    }

    this.pendingEvents.set(key, [])
    this.lastFlushTimes.set(key, new Date())
  }

  /**
   * Flush all pending events for customer
   */
  async flushAllPending(customerId: string): Promise<void> {
    for (const key of this.pendingEvents.keys()) {
      if (key.startsWith(`${customerId}:`)) {
        const metricId = key.split(':')[1]
        await this.flushPending(customerId, metricId)
      }
    }
  }

  /**
   * Get sync status
   */
  async getSyncStatus(customerId: string, metricId: string): Promise<SyncStatus> {
    const key = `${customerId}:${metricId}`
    const pending = this.pendingEvents.get(key) ?? []
    const lastFlushed = this.lastFlushTimes.get(key) ?? new Date()

    return {
      pendingEvents: pending.length,
      lastFlushed,
    }
  }

  // =============================================================================
  // Pricing Configuration
  // =============================================================================

  /**
   * Set pricing configuration
   */
  async setPricing(
    customerId: string,
    metricId: string,
    config: UsagePricingConfig
  ): Promise<void> {
    const key = `${customerId}:${metricId}`
    this.pricingConfigs.set(key, config)
  }

  /**
   * Get pricing configuration
   */
  async getPricing(
    customerId: string,
    metricId: string
  ): Promise<UsagePricingConfig | null> {
    const key = `${customerId}:${metricId}`
    return this.pricingConfigs.get(key) ?? null
  }

  /**
   * Calculate price for a period
   */
  async calculatePeriodPrice(params: {
    customerId: string
    metricId: string
    period: AggregationPeriod
    date: Date
  }): Promise<PriceResult> {
    const pricingConfig = await this.getPricing(params.customerId, params.metricId)
    const tierConfig = await this.getTierConfig(params.customerId, params.metricId)

    const startTime = getStartOfPeriod(params.date, params.period)
    const endTime = getEndOfPeriod(params.date, params.period)

    const events = await this.listEvents({
      customerId: params.customerId,
      metricId: params.metricId,
      startTime,
      endTime: new Date(endTime.getTime() - 1),
    })

    const totalUsage = events.reduce((sum, e) => sum + e.quantity, 0)

    // If tier config exists, use tier pricing
    if (tierConfig) {
      return this.calculatePrice(params.customerId, params.metricId, totalUsage)
    }

    // Use pricing config
    if (!pricingConfig) {
      return { total: 0 }
    }

    const decimalPlaces = pricingConfig.decimalPlaces ?? 2
    const roundingMode = pricingConfig.roundingMode ?? 'half_up'
    const currency = pricingConfig.currency ?? 'USD'

    let total = 0
    let billableUnits = totalUsage
    let includedUnitsUsed = 0
    let minimumApplied = false
    let maximumApplied = false
    let overage = 0

    if (pricingConfig.type === 'per_unit') {
      // Apply included units
      if (pricingConfig.includedUnits) {
        includedUnitsUsed = Math.min(totalUsage, pricingConfig.includedUnits)
        billableUnits = Math.max(0, totalUsage - pricingConfig.includedUnits)
      }

      total = billableUnits * (pricingConfig.pricePerUnit ?? 0)
      total = roundPrice(total, decimalPlaces, roundingMode)

      // Apply minimum
      if (pricingConfig.minimumCharge && total < pricingConfig.minimumCharge) {
        total = pricingConfig.minimumCharge
        minimumApplied = true
      }

      // Apply maximum
      if (pricingConfig.maximumCharge && total > pricingConfig.maximumCharge) {
        total = pricingConfig.maximumCharge
        maximumApplied = true
      }
    } else if (pricingConfig.type === 'overage') {
      const includedUnits = pricingConfig.includedUnits ?? 0
      overage = Math.max(0, totalUsage - includedUnits)
      total = overage * (pricingConfig.overagePrice ?? 0)
      total = roundPrice(total, decimalPlaces, roundingMode)
    }

    return {
      total,
      currency,
      includedUnits: pricingConfig.includedUnits,
      billableUnits,
      minimumApplied,
      maximumApplied,
      overage,
    }
  }

  /**
   * Calculate total price across all metrics
   */
  async calculateTotalPrice(params: {
    customerId: string
    period: AggregationPeriod
    date: Date
  }): Promise<{ total: number; breakdown: PriceResult[] }> {
    const metricIds = new Set<string>()

    // Find all metrics with pricing configs for this customer
    for (const key of this.pricingConfigs.keys()) {
      if (key.startsWith(`${params.customerId}:`)) {
        metricIds.add(key.split(':')[1])
      }
    }

    const breakdown: PriceResult[] = []
    let total = 0

    for (const metricId of metricIds) {
      const price = await this.calculatePeriodPrice({
        customerId: params.customerId,
        metricId,
        period: params.period,
        date: params.date,
      })
      breakdown.push(price)
      total += price.total
    }

    return { total, breakdown }
  }

  // =============================================================================
  // Usage Summary and Invoice Generation
  // =============================================================================

  /**
   * Generate usage summary
   */
  async generateSummary(params: {
    customerId: string
    startDate: Date
    endDate: Date
    includePricing?: boolean
    includeBreakdown?: boolean
    breakdownPeriod?: AggregationPeriod
    groupBy?: string[]
  }): Promise<UsageSummary> {
    if (params.endDate <= params.startDate) {
      throw new Error('End date must be after start date')
    }

    // Get all events in range
    const allEvents = await this.listEvents({
      customerId: params.customerId,
      startTime: params.startDate,
      endTime: new Date(params.endDate.getTime() - 1),
    })

    // Group by metric
    const eventsByMetric = new Map<string, UsageEvent[]>()
    for (const event of allEvents) {
      const events = eventsByMetric.get(event.metricId) ?? []
      events.push(event)
      eventsByMetric.set(event.metricId, events)
    }

    const metrics: MetricSummary[] = []
    let totalPrice = 0

    for (const [metricId, events] of eventsByMetric) {
      const total = events.reduce((sum, e) => sum + e.quantity, 0)
      const count = events.length

      const metricSummary: MetricSummary = {
        metricId,
        total,
        count,
      }

      // Add breakdown if requested
      if (params.includeBreakdown && params.breakdownPeriod) {
        metricSummary.breakdown = []
        const eventsByDay = new Map<string, number>()
        for (const event of events) {
          const dayKey = getStartOfPeriod(event.timestamp, params.breakdownPeriod).toISOString()
          eventsByDay.set(dayKey, (eventsByDay.get(dayKey) ?? 0) + event.quantity)
        }
        for (const [dateKey, dayTotal] of eventsByDay) {
          metricSummary.breakdown.push({
            date: new Date(dateKey),
            total: dayTotal,
          })
        }
        metricSummary.breakdown.sort((a, b) => a.date.getTime() - b.date.getTime())
      }

      // Add groupBy if requested
      if (params.groupBy && params.groupBy.length > 0) {
        metricSummary.groups = {}
        for (const event of events) {
          for (const groupKey of params.groupBy) {
            const groupValue = event.properties[groupKey] as string | undefined
            if (groupValue) {
              metricSummary.groups[groupValue] = (metricSummary.groups[groupValue] ?? 0) + event.quantity
            }
          }
        }
      }

      // Add pricing if requested
      if (params.includePricing) {
        const tierConfig = await this.getTierConfig(params.customerId, metricId)
        const pricingConfig = await this.getPricing(params.customerId, metricId)

        if (tierConfig) {
          const priceResult = await this.calculatePrice(params.customerId, metricId, total)
          metricSummary.price = priceResult.total
          metricSummary.tierBreakdown = priceResult.breakdown
          totalPrice += priceResult.total
        } else if (pricingConfig) {
          const priceResult = await this.calculatePeriodPrice({
            customerId: params.customerId,
            metricId,
            period: 'month',
            date: params.startDate,
          })
          metricSummary.price = priceResult.total
          totalPrice += priceResult.total
        }
      }

      metrics.push(metricSummary)
    }

    return {
      customerId: params.customerId,
      startDate: params.startDate,
      endDate: params.endDate,
      metrics,
      totalPrice,
    }
  }

  /**
   * Generate invoice line items
   */
  async generateInvoiceLineItems(params: {
    customerId: string
    startDate: Date
    endDate: Date
  }): Promise<InvoiceLineItem[]> {
    const lineItems: InvoiceLineItem[] = []

    const events = await this.listEvents({
      customerId: params.customerId,
      startTime: params.startDate,
      endTime: new Date(params.endDate.getTime() - 1),
    })

    // Group by metric
    const eventsByMetric = new Map<string, UsageEvent[]>()
    for (const event of events) {
      const evts = eventsByMetric.get(event.metricId) ?? []
      evts.push(event)
      eventsByMetric.set(event.metricId, evts)
    }

    for (const [metricId, metricEvents] of eventsByMetric) {
      const quantity = metricEvents.reduce((sum, e) => sum + e.quantity, 0)
      const pricingConfig = await this.getPricing(params.customerId, metricId)
      const tierConfig = await this.getTierConfig(params.customerId, metricId)

      let amount = 0
      let unitPrice = 0
      let description = metricId

      if (tierConfig) {
        const priceResult = await this.calculatePrice(params.customerId, metricId, quantity)
        amount = priceResult.total
        unitPrice = quantity > 0 ? amount / quantity : 0
      } else if (pricingConfig) {
        const priceResult = await this.calculatePeriodPrice({
          customerId: params.customerId,
          metricId,
          period: 'month',
          date: params.startDate,
        })
        amount = priceResult.total
        unitPrice = pricingConfig.pricePerUnit ?? 0
        description = pricingConfig.description ?? metricId
      }

      lineItems.push({
        description,
        quantity,
        unitPrice,
        amount,
        metricId,
      })
    }

    return lineItems
  }

  /**
   * Export summary in different formats
   */
  async exportSummary(summary: UsageSummary, format: 'json' | 'csv'): Promise<string> {
    if (format === 'json') {
      return JSON.stringify(summary, null, 2)
    }

    // CSV format
    let csv = 'metric_id,total,count\n'
    for (const metric of summary.metrics) {
      csv += `${metric.metricId},${metric.total},${metric.count}\n`
    }
    return csv
  }

  // =============================================================================
  // Metric Management
  // =============================================================================

  /**
   * Register a metric
   */
  async registerMetric(metric: MetricDefinition): Promise<void> {
    this.metrics.set(metric.id, metric)
  }

  /**
   * Get metric definition
   */
  async getMetric(metricId: string): Promise<MetricDefinition | null> {
    return this.metrics.get(metricId) ?? null
  }

  /**
   * List all registered metrics
   */
  async listMetrics(): Promise<MetricDefinition[]> {
    return Array.from(this.metrics.values())
  }

  /**
   * Update metric
   */
  async updateMetric(
    metricId: string,
    updates: Partial<Omit<MetricDefinition, 'id'>>
  ): Promise<void> {
    const metric = this.metrics.get(metricId)
    if (!metric) {
      throw new Error('Metric not found')
    }
    this.metrics.set(metricId, { ...metric, ...updates })
  }

  /**
   * Delete metric
   */
  async deleteMetric(metricId: string): Promise<void> {
    this.metrics.delete(metricId)
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new UsageMeter instance
 */
export function createUsageMeter(): UsageMeter {
  return new UsageMeter()
}
