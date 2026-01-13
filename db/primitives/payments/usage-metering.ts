/**
 * Usage Metering - Type Definitions
 *
 * TDD RED Phase: Types only, no implementation.
 * Implementation will be added in GREEN phase.
 */

// =============================================================================
// Usage Event Types
// =============================================================================

export interface UsageEvent {
  id: string
  customerId: string
  metricId: string
  quantity: number
  timestamp: Date
  properties: Record<string, unknown>
  idempotencyKey?: string
}

export interface RecordEventInput {
  customerId: string
  metricId: string
  quantity: number
  timestamp?: Date
  properties?: Record<string, unknown>
  idempotencyKey?: string
  enforceLimit?: boolean
}

export interface ListEventsFilter {
  customerId: string
  metricId?: string
  startTime?: Date
  endTime?: Date
}

// =============================================================================
// Aggregation Types
// =============================================================================

export type AggregationPeriod = 'hour' | 'day' | 'week' | 'month' | 'year' | 'billing_cycle'
export type AggregationType = 'sum' | 'max' | 'min' | 'avg' | 'unique' | 'count'

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

export interface GetAggregateInput {
  customerId: string
  metricId: string
  period: AggregationPeriod
  date: Date
  aggregation?: AggregationType
  uniqueKey?: string
}

export interface GetAggregatesInput {
  customerId: string
  metricId: string
  period: AggregationPeriod
  startDate: Date
  endDate: Date
  aggregation?: AggregationType
}

// =============================================================================
// Tier Types
// =============================================================================

export type TierType = 'graduated' | 'volume' | 'package' | 'flat'

export interface UsageTier {
  upTo: number | null
  pricePerUnit: number
  name?: string
}

export interface TierConfig {
  type: TierType
  tiers?: UsageTier[]
  flatFee?: number
  packageSize?: number
  packagePrice?: number
}

export interface TierPriceResult {
  total: number
  breakdown?: Array<{
    tier: number
    quantity: number
    pricePerUnit: number
    amount: number
  }>
  appliedTier?: number
  packages?: number
  flatFee?: number
  usageFee?: number
}

export interface CurrentTierInfo {
  name?: string
  tierIndex: number
  usageInTier: number
  tierLimit: number | null
}

// =============================================================================
// Limit and Alert Types
// =============================================================================

export type LimitAction = 'block' | 'warn' | 'throttle'

export interface UsageLimit {
  limit: number
  period: AggregationPeriod
  action: LimitAction
}

export interface LimitStatus {
  withinLimit: boolean
  exceeded: boolean
  currentUsage: number
  limit: number
  remaining: number
  overage: number
  rollover?: number
}

export interface UsageAlert {
  thresholds: number[]
  channels: string[]
}

export interface AlertEvent {
  customerId: string
  metricId: string
  threshold: number
  currentUsage: number
  limit: number
}

// =============================================================================
// Billing Cycle Types
// =============================================================================

export interface BillingCycleConfig {
  anchorDate: Date
  period: 'month' | 'year' | 'week'
}

export interface BillingPeriod {
  startDate: Date
  endDate: Date
}

// =============================================================================
// Rollover Types
// =============================================================================

export interface UsageRolloverPolicy {
  enabled: boolean
  maxRollover?: number
  expirationPeriods?: number
}

export interface RolloverHistoryEntry {
  period: Date
  rolledOver: number
  expired: number
}

// =============================================================================
// Reporting Mode Types
// =============================================================================

export type UsageReportingMode = 'real-time' | 'batch'

export interface ReportingModeConfig {
  mode: UsageReportingMode
  flushInterval?: number
  batchSize?: number
  immediateForLimits?: boolean
}

export interface SyncStatus {
  pendingEvents: number
  lastFlushed: Date
}

// =============================================================================
// Pricing Types
// =============================================================================

export interface UsagePricingConfig {
  type: 'per_unit' | 'overage' | 'tiered'
  pricePerUnit?: number
  minimumCharge?: number
  maximumCharge?: number
  includedUnits?: number
  overagePrice?: number
  currency?: string
  description?: string
  roundingMode?: 'half_up' | 'half_down' | 'floor' | 'ceil'
  decimalPlaces?: number
}

export interface PeriodPriceResult {
  total: number
  currency?: string
  minimumApplied?: boolean
  maximumApplied?: boolean
  includedUnits?: number
  billableUnits?: number
  overage?: number
}

export interface TotalPriceResult {
  total: number
  currency?: string
  breakdown: Array<{
    metricId: string
    total: number
  }>
}

// =============================================================================
// Summary Types
// =============================================================================

export interface UsageSummary {
  customerId: string
  startDate: Date
  endDate: Date
  metrics: Array<{
    metricId: string
    total: number
    count: number
    price?: number
    breakdown?: Array<{
      date: Date
      total: number
    }>
    tierBreakdown?: Array<{
      tier: number
      quantity: number
      amount: number
    }>
    groups?: Record<string, number>
  }>
  totalPrice: number
}

export interface GenerateSummaryInput {
  customerId: string
  startDate: Date
  endDate: Date
  includeBreakdown?: boolean
  breakdownPeriod?: AggregationPeriod
  includePricing?: boolean
  groupBy?: string[]
}

export interface UsageMeterInvoiceLineItem {
  description: string
  quantity: number
  unitPrice: number
  amount: number
  metricId: string
}

// =============================================================================
// Metric Types
// =============================================================================

export interface MetricDefinition {
  id: string
  name: string
  description?: string
  unit?: string
  aggregation: AggregationType
}

// =============================================================================
// Usage Meter Interface
// =============================================================================

export interface UsageMeter {
  // Event recording
  recordEvent(input: RecordEventInput): Promise<UsageEvent>
  recordEvents(inputs: RecordEventInput[]): Promise<UsageEvent[]>
  getEvent(id: string): Promise<UsageEvent | null>
  listEvents(filter: ListEventsFilter): Promise<UsageEvent[]>

  // Aggregation
  getAggregate(input: GetAggregateInput): Promise<UsageAggregate>
  getAggregates(input: GetAggregatesInput): Promise<UsageAggregate[]>

  // Tiers
  configureTiers(customerId: string, metricId: string, config: TierConfig): Promise<void>
  getTierConfig(customerId: string, metricId: string): Promise<TierConfig | null>
  calculatePrice(customerId: string, metricId: string, quantity: number): Promise<TierPriceResult>
  getCurrentTier(customerId: string, metricId: string): Promise<CurrentTierInfo>

  // Limits
  setLimit(customerId: string, metricId: string, limit: UsageLimit): Promise<void>
  getLimit(customerId: string, metricId: string): Promise<UsageLimit | null>
  removeLimit(customerId: string, metricId: string): Promise<void>
  listLimits(customerId: string): Promise<Array<{ metricId: string; limit: UsageLimit }>>
  checkLimit(customerId: string, metricId: string): Promise<LimitStatus>

  // Alerts
  setAlert(customerId: string, metricId: string, alert: UsageAlert): Promise<void>
  getAlert(customerId: string, metricId: string): Promise<UsageAlert | null>
  onAlert(handler: (event: AlertEvent) => void): void

  // Billing cycle
  setBillingCycle(customerId: string, config: BillingCycleConfig): Promise<void>
  getBillingCycle(customerId: string): Promise<BillingCycleConfig | null>
  getCurrentBillingPeriod(customerId: string): Promise<BillingPeriod>
  getCurrentPeriodUsage(customerId: string, metricId: string): Promise<number>

  // Rollover
  setRolloverPolicy(customerId: string, metricId: string, policy: UsageRolloverPolicy): Promise<void>
  getRolloverPolicy(customerId: string, metricId: string): Promise<UsageRolloverPolicy | null>
  getRolloverHistory(
    customerId: string,
    metricId: string
  ): Promise<RolloverHistoryEntry[]>

  // Reporting mode
  setReportingMode(
    customerId: string,
    metricId: string,
    config: ReportingModeConfig
  ): Promise<void>
  getReportingMode(
    customerId: string,
    metricId: string
  ): Promise<ReportingModeConfig | null>
  getPendingEvents(customerId: string, metricId: string): Promise<UsageEvent[]>
  flushPending(customerId: string, metricId: string): Promise<void>
  flushAllPending(customerId: string): Promise<void>
  getSyncStatus(customerId: string, metricId: string): Promise<SyncStatus>

  // Pricing
  setPricing(
    customerId: string,
    metricId: string,
    config: UsagePricingConfig
  ): Promise<void>
  calculatePeriodPrice(input: {
    customerId: string
    metricId: string
    period: AggregationPeriod
    date: Date
  }): Promise<PeriodPriceResult>
  calculateTotalPrice(input: {
    customerId: string
    period: AggregationPeriod
    date: Date
  }): Promise<TotalPriceResult>

  // Summary
  generateSummary(input: GenerateSummaryInput): Promise<UsageSummary>
  generateInvoiceLineItems(input: {
    customerId: string
    startDate: Date
    endDate: Date
  }): Promise<UsageMeterInvoiceLineItem[]>
  exportSummary(summary: UsageSummary, format: 'json' | 'csv'): Promise<string>

  // Metrics
  registerMetric(metric: MetricDefinition): Promise<void>
  getMetric(id: string): Promise<MetricDefinition | null>
  listMetrics(): Promise<MetricDefinition[]>
  updateMetric(id: string, updates: Partial<MetricDefinition>): Promise<void>
  deleteMetric(id: string): Promise<void>
}

// =============================================================================
// Factory Function (Stub - will fail tests)
// =============================================================================

export function createUsageMeter(): UsageMeter {
  throw new Error('UsageMeter not implemented - TDD RED phase')
}
