/**
 * @dotdo/clickhouse - Type Definitions
 *
 * Types for the ClickHouse WASM analytics client.
 */

// =============================================================================
// Build Profile
// =============================================================================

/**
 * ClickHouse WASM build profiles with different size/feature tradeoffs
 *
 * - minimal: <5MB raw (~2MB gzipped) - Memory engine, basic functions
 * - standard: <15MB raw (~5-6MB gzipped) - + MergeTree, extended functions
 * - full: <30MB raw (~10-12MB gzipped) - All engines, all formats
 */
export type BuildProfile = 'minimal' | 'standard' | 'full'

// =============================================================================
// Configuration
// =============================================================================

export interface ClickHouseConfig {
  /**
   * Build profile to use
   * @default 'standard'
   */
  profile?: BuildProfile

  /**
   * R2 bucket for MergeTree data storage
   */
  r2?: R2Bucket

  /**
   * DO storage for hot data and metadata
   */
  storage?: DurableObjectStorage

  /**
   * Namespace for data isolation (e.g., tenant ID)
   */
  namespace?: string

  /**
   * Max memory for query execution (bytes)
   * @default 64 * 1024 * 1024 (64MB)
   */
  maxMemory?: number

  /**
   * Read cache size (bytes)
   * @default 16 * 1024 * 1024 (16MB)
   */
  cacheSize?: number

  /**
   * Write buffer threshold before flush (bytes)
   * @default 256 * 1024 (256KB)
   */
  writeBufferSize?: number
}

// =============================================================================
// Analytics Events
// =============================================================================

/**
 * Base analytics event structure
 */
export interface AnalyticsEvent {
  /** Event type (e.g., 'page_view', 'click', 'signup') */
  type: string

  /** Unix timestamp (milliseconds) */
  timestamp: number

  /** Event properties */
  properties: Record<string, unknown>

  /** User/visitor identifier (privacy-safe) */
  visitorId?: string | undefined

  /** Session identifier */
  sessionId?: string | undefined

  /** Device/browser info */
  device?: DeviceInfo | undefined

  /** Geo location (from CF headers) */
  geo?: GeoInfo | undefined
}

export interface AnalyticsEventInput {
  type: string
  properties?: Record<string, unknown>
  visitorId?: string
  sessionId?: string
}

export interface DeviceInfo {
  userAgent?: string
  platform?: string
  mobile?: boolean
  browser?: string
  os?: string
}

export interface GeoInfo {
  country?: string
  region?: string
  city?: string
  latitude?: number
  longitude?: number
  timezone?: string
}

// =============================================================================
// Page View Events
// =============================================================================

export interface PageViewInput {
  /** Page URL */
  url: string

  /** Referrer URL */
  referrer?: string

  /** Page title */
  title?: string

  /** Visitor ID (generated if not provided) */
  visitorId?: string

  /** Session ID */
  sessionId?: string

  /** Additional properties */
  properties?: Record<string, unknown>
}

export interface PageView extends AnalyticsEvent {
  type: 'page_view'
  properties: {
    url: string
    path: string
    referrer?: string
    title?: string
    [key: string]: unknown
  }
}

// =============================================================================
// Query Types
// =============================================================================

export interface QueryOptions {
  /**
   * Output format
   * @default 'JSONEachRow'
   */
  format?: 'JSON' | 'JSONEachRow' | 'JSONCompact' | 'CSV' | 'TSV' | 'Arrow'

  /**
   * Query parameters for parameterized queries
   */
  params?: Record<string, unknown>

  /**
   * Query timeout (milliseconds)
   * @default 30000
   */
  timeout?: number

  /**
   * Max rows to return
   */
  limit?: number
}

export interface QueryResult<T = unknown> {
  /** Result rows */
  data: T[]

  /** Column metadata */
  meta: ColumnMeta[]

  /** Row count */
  rows: number

  /** Query statistics */
  statistics: QueryStatistics

  /** Extensions loaded for this query */
  extensions?: string[]
}

export interface ColumnMeta {
  name: string
  type: string
}

export interface QueryStatistics {
  /** Query execution time (ms) */
  elapsed: number

  /** Rows read */
  rowsRead: number

  /** Bytes read */
  bytesRead: number

  /** Memory used (bytes) */
  memoryUsage?: number
}

// =============================================================================
// Funnel Analysis
// =============================================================================

export interface FunnelStep {
  /** Step name */
  name: string

  /** Event type to match */
  event: string

  /** Additional filters */
  filter?: Record<string, unknown>
}

export interface FunnelResult {
  steps: Array<{
    name: string
    count: number
    conversionRate: number
    dropoffRate: number
  }>
  overallConversionRate: number
}

// =============================================================================
// Date Ranges
// =============================================================================

export interface DateRange {
  start: Date
  end: Date
}

export interface MetricPeriod extends DateRange {
  /** Period type for aggregation */
  granularity?: 'hour' | 'day' | 'week' | 'month'
}

// =============================================================================
// SaaS Metrics
// =============================================================================

export interface SaaSMetrics {
  /** Monthly Recurring Revenue */
  mrr: MRRMetrics

  /** Annual Recurring Revenue */
  arr: number

  /** Churn metrics */
  churn: ChurnMetrics

  /** Customer lifetime value */
  ltv: LTVMetrics

  /** Customer acquisition cost */
  cac?: number

  /** Quick ratio (growth efficiency) */
  quickRatio?: number

  /** Net Revenue Retention */
  nrr?: number

  /** Gross Revenue Retention */
  grr?: number
}

export interface MRRMetrics {
  /** Current MRR */
  current: number

  /** New MRR from new customers */
  new: number

  /** Expansion MRR from upgrades */
  expansion: number

  /** Contraction MRR from downgrades */
  contraction: number

  /** Churned MRR from cancellations */
  churned: number

  /** Net new MRR (new + expansion - contraction - churned) */
  netNew: number

  /** MRR at start of period */
  beginning: number

  /** MRR change percentage */
  growthRate: number
}

export interface ChurnMetrics {
  /** Customer churn rate */
  customerChurnRate: number

  /** Revenue churn rate */
  revenueChurnRate: number

  /** Net revenue churn (can be negative = expansion) */
  netRevenueChurn: number

  /** Number of churned customers */
  churnedCustomers: number

  /** Churned revenue amount */
  churnedRevenue: number
}

export interface LTVMetrics {
  /** Average customer lifetime value */
  average: number

  /** LTV by cohort */
  byCohort?: Record<string, number>

  /** LTV to CAC ratio */
  ltvCacRatio?: number
}

// =============================================================================
// Web Analytics Metrics
// =============================================================================

export interface WebAnalyticsMetrics {
  /** Total page views */
  pageViews: number

  /** Unique visitors */
  uniqueVisitors: number

  /** Sessions */
  sessions: number

  /** Average session duration (seconds) */
  avgSessionDuration: number

  /** Bounce rate (single page sessions) */
  bounceRate: number

  /** Pages per session */
  pagesPerSession: number

  /** Top pages */
  topPages: Array<{ path: string; views: number; uniqueVisitors: number }>

  /** Top referrers */
  topReferrers: Array<{ referrer: string; visits: number }>

  /** Device breakdown */
  devices: { desktop: number; mobile: number; tablet: number }

  /** Country breakdown */
  countries: Array<{ country: string; visitors: number }>
}

// =============================================================================
// Product Analytics
// =============================================================================

export interface ProductAnalytics {
  /** Product ID */
  productId: string

  /** Period */
  period: DateRange

  /** Total events */
  totalEvents: number

  /** Unique users */
  uniqueUsers: number

  /** Conversions (purchases, signups, etc.) */
  conversions: number

  /** Conversion rate */
  conversionRate: number

  /** Revenue generated */
  revenue: number

  /** Daily breakdown */
  daily: Array<{
    date: string
    events: number
    uniqueUsers: number
    conversions: number
    revenue: number
  }>
}

// =============================================================================
// Experiment Types
// =============================================================================

export interface Experiment {
  /** Experiment key */
  key: string

  /** Experiment name */
  name: string

  /** Description */
  description?: string

  /** Status */
  status: 'draft' | 'running' | 'paused' | 'completed'

  /** Start date */
  startDate?: Date

  /** End date */
  endDate?: Date

  /** Variants */
  variants: Variant[]

  /** Target metric */
  targetMetric: string

  /** Minimum sample size */
  minSampleSize?: number
}

export interface Variant {
  /** Variant key */
  key: string

  /** Variant name */
  name: string

  /** Traffic allocation (0-100) */
  weight: number

  /** Whether this is the control */
  isControl?: boolean

  /** Variant configuration */
  config?: Record<string, unknown>
}

export interface ExperimentResults {
  /** Experiment */
  experiment: Experiment

  /** Results per variant */
  variants: Array<{
    variant: Variant
    participants: number
    conversions: number
    conversionRate: number
    /** Improvement over control */
    improvement?: number
    /** Statistical significance */
    pValue?: number
    /** Confidence interval */
    confidenceInterval?: [number, number]
  }>

  /** Whether we have statistical significance */
  isSignificant: boolean

  /** Winning variant (if significant) */
  winner?: string
}

// =============================================================================
// Storage Provider Interface
// =============================================================================

/**
 * Abstract interface for VFS storage backends
 */
export interface VFSStorageProvider {
  /** Get file stats */
  stat(path: string): Promise<FileStat | null>

  /** Read bytes from file at offset */
  read(path: string, offset: number, length: number): Promise<ArrayBuffer>

  /** Read entire file */
  readFile(path: string): Promise<ArrayBuffer>

  /** Write data to file */
  write(path: string, data: ArrayBuffer): Promise<void>

  /** Append data to file */
  append(path: string, data: ArrayBuffer): Promise<void>

  /** Delete file */
  delete(path: string): Promise<void>

  /** List directory contents */
  list(path: string): Promise<DirEntry[]>

  /** Create directory */
  mkdir(path: string): Promise<void>

  /** Rename/move file */
  rename(oldPath: string, newPath: string): Promise<void>

  /** Flush pending writes */
  flush(): Promise<void>
}

export interface FileStat {
  size: number
  mtime: number
  isDirectory: boolean
}

export interface DirEntry {
  name: string
  isDirectory: boolean
}
