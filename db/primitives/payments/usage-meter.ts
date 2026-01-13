/**
 * Usage Meter - Usage event ingestion and aggregation for metered billing
 *
 * Features:
 * - Usage event ingestion (single and batch)
 * - Multiple aggregation types: sum, max, unique, last_during_period
 * - Billing period boundaries and rollups
 * - Invoice line item generation
 *
 * @module db/primitives/payments/usage-meter
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Aggregation types supported by the usage meter
 */
export type AggregationType = 'sum' | 'max' | 'unique' | 'last_during_period'

/**
 * Billing interval types
 */
export type BillingIntervalType = 'day' | 'week' | 'month' | 'year'

/**
 * Usage event record
 */
export interface UsageEvent {
  id: string
  customerId: string
  metricId: string
  value: number
  timestamp: Date
  idempotencyKey?: string
  metadata?: Record<string, unknown>
}

/**
 * Usage event input for ingestion
 */
export interface UsageEventInput {
  customerId: string
  metricId: string
  value: number
  timestamp?: Date
  idempotencyKey?: string
  metadata?: Record<string, unknown>
}

/**
 * Aggregation query options
 */
export interface AggregateOptions {
  customerId: string
  metricId: string
  aggregation: AggregationType
  startTime: Date
  endTime: Date
  uniqueProperty?: string
}

/**
 * Aggregation result
 */
export interface AggregateResult {
  customerId: string
  metricId: string
  aggregation: AggregationType
  value: number | null
  eventCount: number
  startTime: Date
  endTime: Date
}

/**
 * Billing period definition input
 */
export interface BillingPeriodInput {
  customerId: string
  anchorDate: Date
  intervalType: BillingIntervalType
}

/**
 * Billing period
 */
export interface BillingPeriod {
  customerId: string
  startDate: Date
  endDate: Date
  intervalType: BillingIntervalType
}

/**
 * Query events options
 */
export interface QueryEventsOptions {
  customerId: string
  metricId?: string
  startTime?: Date
  endTime?: Date
}

/**
 * Aggregate for billing period options
 */
export interface AggregateForBillingPeriodOptions {
  customerId: string
  metricId: string
  aggregation: AggregationType
  periodIndex: number
  uniqueProperty?: string
}

/**
 * Usage rollup
 */
export interface UsageRollup {
  id: string
  customerId: string
  periodStart: Date
  periodEnd: Date
  metrics: Array<{
    metricId: string
    value: number
    eventCount: number
  }>
  finalized: boolean
  finalizedAt?: Date
  createdAt: Date
}

/**
 * Generate rollup options
 */
export interface GenerateRollupOptions {
  customerId: string
  startTime: Date
  endTime: Date
}

/**
 * Pricing tier
 */
export interface PricingTier {
  upTo: number | null
  pricePerUnit: number
}

/**
 * Metric pricing configuration
 */
export interface MetricPricingConfig {
  metricId: string
  aggregation: AggregationType
  pricePerUnit?: number
  includedUnits?: number
  tiers?: PricingTier[]
  displayName?: string
  unit?: string
}

/**
 * Invoice line item
 */
export interface InvoiceLineItem {
  metricId: string
  description: string
  quantity: number
  billableQuantity: number
  unitPrice: number
  amount: number
  unit?: string
  tierBreakdown?: Array<{
    tier: number
    quantity: number
    pricePerUnit: number
    amount: number
  }>
}

/**
 * Generate invoice line items options
 */
export interface GenerateInvoiceLineItemsOptions {
  customerId: string
  startTime: Date
  endTime: Date
}

/**
 * Usage meter interface
 */
export interface UsageMeter {
  // Event ingestion
  ingest(input: UsageEventInput): Promise<UsageEvent>
  ingestBatch(inputs: UsageEventInput[]): Promise<UsageEvent[]>
  queryEvents(options: QueryEventsOptions): Promise<UsageEvent[]>

  // Aggregation
  aggregate(options: AggregateOptions): Promise<AggregateResult>

  // Billing periods
  defineBillingPeriod(input: BillingPeriodInput): Promise<void>
  getCurrentBillingPeriod(customerId: string): Promise<BillingPeriod>
  getBillingPeriod(customerId: string, offset: number): Promise<BillingPeriod>
  aggregateForBillingPeriod(options: AggregateForBillingPeriodOptions): Promise<AggregateResult>

  // Rollups
  generateRollup(options: GenerateRollupOptions): Promise<UsageRollup>
  getRollup(rollupId: string): Promise<UsageRollup | null>
  finalizeRollup(rollupId: string): Promise<void>

  // Pricing
  configureMetricPricing(config: MetricPricingConfig): Promise<void>
  generateInvoiceLineItems(options: GenerateInvoiceLineItemsOptions): Promise<InvoiceLineItem[]>
}

// =============================================================================
// Factory - Stub Implementation (Not Yet Implemented)
// =============================================================================

/**
 * Create a UsageMeter instance
 *
 * TODO: Implement the actual UsageMeter
 */
export function createUsageMeter(): UsageMeter {
  throw new Error('UsageMeter not yet implemented - TDD RED phase')
}
