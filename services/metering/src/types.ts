/**
 * Usage Metering System Types
 *
 * Type definitions for tracking usage across all *.do services.
 *
 * Services tracked:
 * - calls.do: minutes, calls count
 * - texts.do: messages sent/received
 * - emails.do: emails sent, opens, clicks
 * - payments.do: transactions, volume
 * - llm.do: tokens consumed, requests
 * - queue.do: messages processed
 *
 * @module services/metering/types
 */

// ============================================================================
// Service Types
// ============================================================================

/**
 * All metered *.do services
 */
export type MeteringService =
  | 'calls.do'
  | 'texts.do'
  | 'emails.do'
  | 'payments.do'
  | 'llm.do'
  | 'queue.do'
  | 'observe.do'
  | 'vectors.do'
  | 'storage.do'

/**
 * Metric types by service
 */
export interface ServiceMetrics {
  'calls.do': 'minutes' | 'calls'
  'texts.do': 'sent' | 'received'
  'emails.do': 'sent' | 'opens' | 'clicks' | 'bounces'
  'payments.do': 'transactions' | 'volume' | 'refunds'
  'llm.do': 'tokens' | 'requests' | 'input_tokens' | 'output_tokens'
  'queue.do': 'messages' | 'processed' | 'failed'
  'observe.do': 'events' | 'spans' | 'logs'
  'vectors.do': 'embeddings' | 'searches' | 'dimensions'
  'storage.do': 'reads' | 'writes' | 'bytes'
}

/**
 * Get metric types for a specific service
 */
export type MetricType<S extends MeteringService> = ServiceMetrics[S]

// ============================================================================
// Usage Metric
// ============================================================================

/**
 * A single usage metric record
 */
export interface UsageMetric<S extends MeteringService = MeteringService> {
  /** Unique metric ID */
  id: string
  /** Agent/tenant ID that incurred the usage */
  agentId: string
  /** The service being metered */
  service: S
  /** The specific metric type */
  metric: S extends keyof ServiceMetrics ? ServiceMetrics[S] : string
  /** The metric value (e.g., token count, call minutes) */
  value: number
  /** When the usage occurred */
  timestamp: Date
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

// ============================================================================
// Usage Query
// ============================================================================

/**
 * Time range specification
 */
export type TimeRange =
  | { last: string } // e.g., '30d', '7d', '24h', '1h'
  | { from: Date; to: Date }
  | { from: Date } // from date to now
  | { to: Date } // from beginning to date

/**
 * Query parameters for usage data
 */
export interface UsageQuery {
  /** Agent/tenant ID to query */
  agentId: string
  /** Filter by service (optional) */
  service?: MeteringService
  /** Filter by metric type (optional) */
  metric?: string
  /** Time range filter */
  timeRange?: TimeRange
  /** Group results by period */
  groupBy?: 'hour' | 'day' | 'week' | 'month'
  /** Maximum results to return */
  limit?: number
  /** Offset for pagination */
  offset?: number
}

// ============================================================================
// Usage Summary
// ============================================================================

/**
 * Summary of usage for a service
 */
export interface ServiceUsageSummary {
  /** The service */
  service: MeteringService
  /** Breakdown by metric */
  metrics: Record<string, number>
  /** Total cost units */
  costUnits: number
  /** Request count */
  requestCount: number
}

/**
 * Aggregated usage summary
 */
export interface UsageSummary {
  /** Agent/tenant ID */
  agentId: string
  /** Period start */
  periodStart: Date
  /** Period end */
  periodEnd: Date
  /** Total across all services */
  totals: {
    /** Total cost units */
    costUnits: number
    /** Total requests */
    requests: number
    /** Total API calls */
    apiCalls: number
  }
  /** Breakdown by service */
  byService: Record<MeteringService, ServiceUsageSummary>
}

// ============================================================================
// Usage Limits
// ============================================================================

/**
 * Billing period for quotas
 */
export type BillingPeriod = 'hourly' | 'daily' | 'weekly' | 'monthly'

/**
 * Limit type
 */
export type LimitType = 'soft' | 'hard'

/**
 * Usage limit configuration for a service
 */
export interface UsageLimit {
  /** The service this limit applies to */
  service: MeteringService
  /** The metric being limited */
  metric: string
  /** Maximum allowed value */
  quota: number
  /** Billing period */
  period: BillingPeriod
  /** Type of limit - soft (warn) vs hard (block) */
  type: LimitType
  /** Grace period percentage (0-1) for soft limits before hard enforcement */
  gracePeriod?: number
  /** Alert threshold percentage (0-1) */
  alertThreshold?: number
}

/**
 * Result of checking a usage limit
 */
export interface LimitCheckResult {
  /** Whether the operation is allowed */
  allowed: boolean
  /** Current usage value */
  current: number
  /** Quota limit */
  quota: number
  /** Percentage of quota used (0-1) */
  percentUsed: number
  /** Whether this is a soft or hard limit */
  type: LimitType
  /** Time until quota resets */
  resetsAt: Date
  /** Warning message if approaching limit */
  warning?: string
  /** Block reason if not allowed */
  reason?: string
}

// ============================================================================
// Counter Types
// ============================================================================

/**
 * Counter key components
 */
export interface CounterKey {
  /** Agent/tenant ID */
  agentId: string
  /** Service being metered */
  service: MeteringService
  /** Metric type */
  metric: string
  /** Period for aggregation */
  period: BillingPeriod
  /** Period timestamp (start of period) */
  periodTimestamp: Date
}

/**
 * Counter value stored in DO SQLite
 */
export interface CounterValue {
  /** Current count value */
  value: number
  /** Last updated timestamp */
  updatedAt: Date
  /** Number of increments in this period */
  incrementCount: number
}

/**
 * Counter storage interface
 */
export interface CounterStorage {
  /** Increment a counter atomically */
  increment(key: CounterKey, amount: number): Promise<number>
  /** Get current counter value */
  get(key: CounterKey): Promise<number>
  /** Reset a counter (for new billing period) */
  reset(key: CounterKey): Promise<void>
  /** Get all counters for an agent */
  getAll(agentId: string, period: BillingPeriod): Promise<Map<string, number>>
}

// ============================================================================
// Aggregation Types
// ============================================================================

/**
 * Aggregation job configuration
 */
export interface AggregationConfig {
  /** How often to run aggregation (cron expression) */
  schedule: string
  /** Batch size for processing */
  batchSize: number
  /** Retention period for raw counters */
  retentionDays: number
  /** Target Iceberg table path */
  icebergPath: string
}

/**
 * Aggregation result
 */
export interface AggregationResult {
  /** Number of counters processed */
  countersProcessed: number
  /** Number of rows written to Parquet */
  rowsWritten: number
  /** Parquet file path */
  parquetPath: string
  /** Duration of aggregation job */
  durationMs: number
  /** Any errors encountered */
  errors?: string[]
}

/**
 * Rollup record for Iceberg storage
 */
export interface UsageRollup {
  /** Agent/tenant ID */
  agentId: string
  /** Service */
  service: MeteringService
  /** Metric type */
  metric: string
  /** Aggregation period type */
  periodType: 'hourly' | 'daily'
  /** Period start timestamp */
  periodStart: Date
  /** Period end timestamp */
  periodEnd: Date
  /** Total value for period */
  totalValue: number
  /** Number of individual events */
  eventCount: number
  /** Minimum value in period */
  minValue: number
  /** Maximum value in period */
  maxValue: number
  /** Average value */
  avgValue: number
  /** Cost units for billing */
  costUnits: number
}

// ============================================================================
// Cost Calculation Types
// ============================================================================

/**
 * Cost calculation configuration per service
 */
export interface CostConfig {
  /** Cost per unit (in micro-cents or similar) */
  costPerUnit: number
  /** Unit size (e.g., per 1000 tokens) */
  unitSize: number
  /** Free tier allowance */
  freeTier?: number
  /** Volume discount tiers */
  volumeDiscounts?: Array<{
    threshold: number
    discount: number // 0-1
  }>
}

/**
 * Cost configuration by service
 */
export type ServiceCostConfig = Partial<Record<MeteringService, Record<string, CostConfig>>>

// ============================================================================
// Event Types
// ============================================================================

/**
 * Usage event emitted for real-time tracking
 */
export interface UsageEvent {
  /** Event type */
  type: 'usage.tracked' | 'limit.warning' | 'limit.exceeded' | 'period.reset'
  /** Agent/tenant ID */
  agentId: string
  /** Service */
  service: MeteringService
  /** Metric */
  metric: string
  /** Event payload */
  payload: {
    /** Current value */
    value?: number
    /** Delta (for increment events) */
    delta?: number
    /** Limit info (for limit events) */
    limit?: UsageLimit
    /** Check result (for limit events) */
    result?: LimitCheckResult
  }
  /** Timestamp */
  timestamp: Date
}

/**
 * Event handler type
 */
export type UsageEventHandler = (event: UsageEvent) => void | Promise<void>
