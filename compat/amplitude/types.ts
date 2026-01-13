/**
 * @dotdo/amplitude - Type Definitions
 *
 * TypeScript types for Amplitude SDK compatibility layer.
 * Matches the official @amplitude/analytics-node API.
 *
 * @module @dotdo/amplitude/types
 */

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Amplitude SDK configuration options.
 */
export interface AmplitudeOptions {
  /** API key for the project */
  apiKey: string
  /** Server URL for ingestion (default: https://api2.amplitude.com/2/httpapi) */
  serverUrl?: string
  /** Minimum log level (default: 'warn') */
  logLevel?: LogLevel
  /** Flush queue size threshold (default: 30) */
  flushQueueSize?: number
  /** Flush interval in milliseconds (default: 10000) */
  flushIntervalMillis?: number
  /** Maximum retry attempts (default: 3) */
  flushMaxRetries?: number
  /** Minimum event ID length for deduplication */
  minIdLength?: number
  /** Custom logger implementation */
  loggerProvider?: Logger
  /** Default tracking options */
  defaultTracking?: DefaultTrackingOptions
  /** Plan configuration for taxonomy */
  plan?: Plan
}

/**
 * Log levels for Amplitude SDK.
 */
export type LogLevel = 'none' | 'error' | 'warn' | 'verbose' | 'debug'

/**
 * Logger interface for custom logging.
 */
export interface Logger {
  enable(): void
  disable(): void
  log(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
  debug(message: string, ...args: unknown[]): void
}

/**
 * Default tracking configuration.
 */
export interface DefaultTrackingOptions {
  /** Track page views */
  pageViews?: boolean
  /** Track sessions */
  sessions?: boolean
  /** Track form interactions */
  formInteractions?: boolean
  /** Track file downloads */
  fileDownloads?: boolean
}

/**
 * Plan configuration for tracking plan.
 */
export interface Plan {
  /** Plan branch */
  branch?: string
  /** Source name */
  source?: string
  /** Version */
  version?: string
  /** Version ID */
  versionId?: string
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Base event structure for Amplitude events.
 */
export interface BaseEvent {
  /** Event type/name */
  event_type: string
  /** User ID */
  user_id?: string
  /** Device ID */
  device_id?: string
  /** Session ID */
  session_id?: number
  /** Event timestamp (milliseconds since epoch) */
  time?: number
  /** Insert ID for deduplication */
  insert_id?: string
  /** Event properties */
  event_properties?: Record<string, unknown>
  /** User properties */
  user_properties?: UserPropertyOperations | Record<string, unknown>
  /** Group properties */
  group_properties?: Record<string, unknown>
  /** Groups for this event */
  groups?: Record<string, string | string[]>
  /** App version */
  app_version?: string
  /** Platform */
  platform?: string
  /** OS name */
  os_name?: string
  /** OS version */
  os_version?: string
  /** Device brand */
  device_brand?: string
  /** Device manufacturer */
  device_manufacturer?: string
  /** Device model */
  device_model?: string
  /** Carrier */
  carrier?: string
  /** Country */
  country?: string
  /** Region */
  region?: string
  /** City */
  city?: string
  /** DMA */
  dma?: string
  /** Language */
  language?: string
  /** Price for revenue events */
  price?: number
  /** Quantity for revenue events */
  quantity?: number
  /** Revenue for revenue events */
  revenue?: number
  /** Product ID for revenue events */
  productId?: string
  /** Revenue type */
  revenueType?: string
  /** Location latitude */
  location_lat?: number
  /** Location longitude */
  location_lng?: number
  /** IP address */
  ip?: string
  /** IDFA (iOS advertising ID) */
  idfa?: string
  /** IDFV (iOS vendor ID) */
  idfv?: string
  /** ADID (Android advertising ID) */
  adid?: string
  /** Android ID */
  android_id?: string
  /** Event ID */
  event_id?: number
  /** Library name and version */
  library?: string
  /** Partner ID */
  partner_id?: string
  /** Plan information */
  plan?: Plan
  /** Ingestion metadata */
  ingestion_metadata?: IngestionMetadata
}

/**
 * Ingestion metadata for server-side events.
 */
export interface IngestionMetadata {
  /** Source name */
  source_name?: string
  /** Source version */
  source_version?: string
}

/**
 * User property operations using Amplitude's special operators.
 */
export interface UserPropertyOperations {
  /** Set properties (overwrite) */
  $set?: Record<string, unknown>
  /** Set properties only if not already set */
  $setOnce?: Record<string, unknown>
  /** Add numeric values */
  $add?: Record<string, number>
  /** Append to array properties */
  $append?: Record<string, unknown>
  /** Prepend to array properties */
  $prepend?: Record<string, unknown>
  /** Remove from array properties */
  $remove?: Record<string, unknown>
  /** Pre-insert unique value to array */
  $preInsert?: Record<string, unknown>
  /** Post-insert unique value to array */
  $postInsert?: Record<string, unknown>
  /** Unset (remove) properties */
  $unset?: Record<string, unknown>
  /** Clear all properties */
  $clearAll?: boolean
}

/**
 * Track event options.
 */
export interface TrackEventOptions {
  /** User ID */
  user_id?: string
  /** Device ID */
  device_id?: string
  /** Session ID */
  session_id?: number
  /** Event timestamp */
  time?: number
  /** Insert ID for deduplication */
  insert_id?: string
  /** Groups */
  groups?: Record<string, string | string[]>
  /** App version */
  app_version?: string
  /** Platform */
  platform?: string
  /** Extra event data */
  extra?: Record<string, unknown>
}

/**
 * Revenue event for tracking purchases.
 */
export interface Revenue {
  /** Product ID */
  productId?: string
  /** Price per unit */
  price: number
  /** Quantity */
  quantity?: number
  /** Revenue type */
  revenueType?: string
  /** Event properties */
  eventProperties?: Record<string, unknown>
}

// =============================================================================
// Identify Types
// =============================================================================

/**
 * Identify object for setting user properties.
 */
export interface Identify {
  /** Set properties */
  set(key: string, value: unknown): Identify
  /** Set property only if not set */
  setOnce(key: string, value: unknown): Identify
  /** Add to numeric property */
  add(key: string, value: number): Identify
  /** Append to array property */
  append(key: string, value: unknown): Identify
  /** Prepend to array property */
  prepend(key: string, value: unknown): Identify
  /** Remove from array property */
  remove(key: string, value: unknown): Identify
  /** Pre-insert unique value */
  preInsert(key: string, value: unknown): Identify
  /** Post-insert unique value */
  postInsert(key: string, value: unknown): Identify
  /** Unset a property */
  unset(key: string): Identify
  /** Clear all properties */
  clearAll(): Identify
  /** Get the operations */
  getUserProperties(): UserPropertyOperations
}

// =============================================================================
// Group Types
// =============================================================================

/**
 * Group identify for setting group properties.
 */
export interface GroupIdentify extends Identify {
  /** Get group properties */
  getGroupProperties(): UserPropertyOperations
}

// =============================================================================
// Cohort Types
// =============================================================================

/**
 * Cohort definition for user segmentation.
 */
export interface CohortDefinition {
  /** Cohort ID */
  id: string
  /** Cohort name */
  name: string
  /** Description */
  description?: string
  /** Definition type */
  type: 'behavioral' | 'property' | 'computed'
  /** Property filter for property-based cohorts */
  propertyFilter?: PropertyFilter
  /** Event filters for behavioral cohorts */
  eventFilters?: EventFilter[]
  /** Time range */
  timeRange?: TimeRange
  /** Created timestamp */
  createdAt?: Date
  /** Last computed timestamp */
  lastComputedAt?: Date
  /** User count */
  userCount?: number
}

/**
 * Property filter for cohort definitions.
 */
export interface PropertyFilter {
  /** Property name */
  property: string
  /** Operator */
  operator: PropertyOperator
  /** Value(s) to compare */
  value: unknown
}

/**
 * Property comparison operators.
 */
export type PropertyOperator =
  | 'is'
  | 'is_not'
  | 'contains'
  | 'does_not_contain'
  | 'greater_than'
  | 'less_than'
  | 'greater_or_equal'
  | 'less_or_equal'
  | 'is_set'
  | 'is_not_set'
  | 'matches'

/**
 * Event filter for behavioral cohorts.
 */
export interface EventFilter {
  /** Event name */
  event: string
  /** Operator */
  operator: 'did' | 'did_not'
  /** Count constraint */
  count?: {
    operator: 'exactly' | 'at_least' | 'at_most' | 'between'
    value: number
    value2?: number
  }
  /** Property filters for the event */
  propertyFilters?: PropertyFilter[]
}

/**
 * Time range for cohort definitions.
 */
export interface TimeRange {
  /** Range type */
  type: 'last_n_days' | 'since' | 'between'
  /** Number of days (for last_n_days) */
  days?: number
  /** Start date (for since/between) */
  start?: Date
  /** End date (for between) */
  end?: Date
}

// =============================================================================
// Analytics Types
// =============================================================================

/**
 * Funnel step definition.
 */
export interface FunnelStep {
  /** Step event name */
  event: string
  /** Optional property filters */
  propertyFilters?: PropertyFilter[]
}

/**
 * Funnel analysis configuration.
 */
export interface FunnelConfig {
  /** Funnel name */
  name: string
  /** Ordered steps */
  steps: FunnelStep[]
  /** Conversion window in days */
  conversionWindowDays?: number
  /** Time range for analysis */
  timeRange?: TimeRange
  /** Group by property */
  groupBy?: string
}

/**
 * Funnel analysis result.
 */
export interface FunnelResult {
  /** Funnel name */
  name: string
  /** Total users who entered the funnel */
  totalUsers: number
  /** Per-step results */
  steps: FunnelStepResult[]
  /** Overall conversion rate */
  overallConversionRate: number
  /** Average time to convert */
  averageTimeToConvert?: number
}

/**
 * Individual funnel step result.
 */
export interface FunnelStepResult {
  /** Step number (1-indexed) */
  step: number
  /** Event name */
  event: string
  /** Users who completed this step */
  users: number
  /** Conversion rate from previous step */
  conversionRate: number
  /** Drop-off count from previous step */
  dropOff: number
  /** Average time to reach this step */
  averageTime?: number
}

/**
 * Retention configuration.
 */
export interface RetentionConfig {
  /** Start event (what triggers retention tracking) */
  startEvent: string
  /** Return event (what counts as retention) */
  returnEvent: string
  /** Time range for analysis */
  timeRange?: TimeRange
  /** Retention period in days */
  retentionPeriodDays?: number
  /** Group by property */
  groupBy?: string
  /** Cohort grouping (day, week, month) */
  cohortGrouping?: 'day' | 'week' | 'month'
}

/**
 * Retention analysis result.
 */
export interface RetentionResult {
  /** Cohorts with retention data */
  cohorts: RetentionCohort[]
  /** Overall retention curve */
  retentionCurve: number[]
  /** Average retention at each period */
  averageRetention: number[]
}

/**
 * Retention cohort data.
 */
export interface RetentionCohort {
  /** Cohort date */
  date: Date
  /** Users in this cohort */
  users: number
  /** Retention by period */
  retention: number[]
}

// =============================================================================
// API Response Types
// =============================================================================

/**
 * API response status.
 */
export interface AmplitudeResponse<T = void> {
  /** HTTP status code */
  code: number
  /** Response message */
  message: string
  /** Response data */
  data?: T
  /** Events processed */
  events_ingested?: number
  /** Payload size */
  payload_size_bytes?: number
  /** Server upload time */
  server_upload_time?: number
}

/**
 * Batch upload response.
 */
export interface BatchResponse {
  /** Events ingested */
  code: number
  events_ingested: number
  payload_size_bytes: number
  server_upload_time: number
}

/**
 * Plugin interface for Amplitude SDK.
 */
export interface Plugin {
  /** Plugin name */
  name: string
  /** Plugin type */
  type: 'before' | 'enrichment' | 'destination'
  /** Setup the plugin */
  setup(config: AmplitudeOptions): Promise<void>
  /** Execute the plugin */
  execute(event: BaseEvent): Promise<BaseEvent | null>
  /** Teardown the plugin */
  teardown?(): Promise<void>
}

/**
 * Transport interface for sending events.
 */
export interface Transport {
  /** Send events to Amplitude */
  send(events: BaseEvent[]): Promise<AmplitudeResponse<BatchResponse>>
}

/**
 * Result callback type.
 */
export type ResultCallback = (result: AmplitudeResponse) => void
