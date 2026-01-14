/**
 * @dotdo/analytics - Type Definitions
 *
 * Types for the Analytics SDK compatibility layer.
 * Supports Mixpanel, Amplitude, and PostHog-compatible APIs.
 *
 * @module @dotdo/analytics/types
 */

// =============================================================================
// Core Types
// =============================================================================

/**
 * Properties for events (any key-value pairs)
 */
export interface Properties {
  [key: string]: unknown
}

/**
 * User traits/properties
 */
export interface UserTraits extends Properties {
  $name?: string
  $email?: string
  $phone?: string
  $avatar?: string
  $created?: string | Date
  name?: string
  email?: string
  phone?: string
  avatar?: string
  created_at?: string | Date
}

/**
 * Group traits/properties
 */
export interface GroupTraits extends Properties {
  name?: string
  industry?: string
  employees?: number
  plan?: string
  created_at?: string | Date
}

/**
 * Context object for enriching events
 */
export interface Context {
  [key: string]: unknown
  library?: {
    name: string
    version: string
  }
  app?: {
    name?: string
    version?: string
    build?: string
    namespace?: string
  }
  device?: {
    id?: string
    manufacturer?: string
    model?: string
    name?: string
    type?: string
  }
  os?: {
    name?: string
    version?: string
  }
  screen?: {
    width?: number
    height?: number
    density?: number
  }
  ip?: string
  locale?: string
  timezone?: string
  userAgent?: string
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Base analytics event
 */
export interface AnalyticsEvent {
  /** Event name */
  event?: string
  /** Event type (identify, track, page, screen, group, alias) */
  type?: string
  /** Unique message ID */
  message_id?: string
  /** ISO timestamp */
  timestamp?: string
  /** User ID (after identify) */
  distinct_id?: string
  /** Anonymous ID (before identify) */
  anonymous_id?: string
  /** Event properties */
  properties?: Properties
  /** User properties to set */
  $set?: Properties
  /** User properties to set once */
  $set_once?: Properties
  /** User properties to add (increment) */
  $add?: Properties
  /** User properties to append */
  $append?: Properties
  /** User properties to union (unique list append) */
  $union?: Properties
  /** User properties to remove */
  $remove?: Properties
  /** User properties to unset */
  $unset?: string[]
  /** Delete user flag */
  $delete?: boolean
  /** Group ID */
  group_id?: string
  /** Group type */
  group_type?: string
  /** Group properties to set */
  $group_set?: Properties
  /** Alias target */
  alias?: string
  /** Previous ID for alias */
  previousId?: string
  /** Context information */
  context?: Context
  /** Project token (Mixpanel) */
  token?: string
}

/**
 * Revenue tracking
 */
export interface Revenue {
  /** Revenue amount (required) */
  amount: number
  /** Currency code (ISO 4217) */
  currency?: string
  /** Product ID */
  productId?: string
  /** Quantity */
  quantity?: number
  /** Revenue type (e.g., 'subscription', 'one-time') */
  revenueType?: string
  /** Receipt data for validation */
  receipt?: string
  /** Receipt signature */
  receiptSignature?: string
  /** Additional properties */
  properties?: Properties
}

/**
 * User profile update
 */
export interface UserProfile {
  /** User ID */
  userId: string
  /** Properties to set */
  $set?: Properties
  /** Properties to set once */
  $set_once?: Properties
  /** Properties to increment */
  $add?: Properties
  /** Properties to append to list */
  $append?: Properties
  /** Properties to union to list */
  $union?: Properties
  /** Properties to unset */
  $unset?: string[]
  /** Delete user */
  $delete?: boolean
}

/**
 * Group profile update
 */
export interface GroupProfile {
  /** Group type */
  groupType: string
  /** Group ID */
  groupId: string
  /** Properties to set */
  $set?: Properties
  /** Properties to set once */
  $set_once?: Properties
}

// =============================================================================
// Batch Types
// =============================================================================

/**
 * Batch of events
 */
export interface BatchPayload {
  /** Array of events */
  events: AnalyticsEvent[]
  /** Sent at timestamp */
  sentAt?: string
  /** API key/token */
  apiKey?: string
}

// =============================================================================
// Transport Types
// =============================================================================

/**
 * Transport result
 */
export interface TransportResult {
  statusCode: number
  headers?: Record<string, string>
  body?: unknown
}

/**
 * Transport interface
 */
export interface Transport {
  send(payload: BatchPayload): Promise<TransportResult>
  flush(timeout?: number): Promise<boolean>
  getEvents(): AnalyticsEvent[]
  getBatches(): BatchPayload[]
}

/**
 * Transport factory
 */
export type TransportFactory = (options: { apiKey: string }) => Transport

// =============================================================================
// Options Types
// =============================================================================

/**
 * Base analytics options
 */
export interface BaseAnalyticsOptions {
  /** Flush at this many events */
  flushAt?: number
  /** Flush interval in milliseconds */
  flushInterval?: number
  /** Maximum retries for failed requests */
  maxRetries?: number
  /** Custom transport */
  transport?: TransportFactory
  /** Error handler */
  errorHandler?: (error: Error) => void
  /** Enable debug mode */
  debug?: boolean
  /** Disable tracking entirely */
  disabled?: boolean
}

/**
 * Analytics options (unified API)
 */
export interface AnalyticsOptions extends BaseAnalyticsOptions {
  /** Project token */
  projectToken: string
  /** API host */
  host?: string
  /** Feature flags bootstrap */
  featureFlags?: Record<string, boolean | string>
  /** Enable event storage (TemporalStore) */
  enableEventStore?: boolean
  /** Enable real-time aggregation (WindowManager) */
  enableRealTimeAggregation?: boolean
  /** Aggregation window in milliseconds */
  aggregationWindowMs?: number
}

/**
 * Mixpanel options
 */
export interface MixpanelOptions extends BaseAnalyticsOptions {
  /** Mixpanel token */
  token: string
  /** API host */
  api_host?: string
  /** Batch size (alias for flushAt) */
  batch_size?: number
  /** Batch flush interval (alias for flushInterval) */
  batch_flush_interval_ms?: number
}

/**
 * Amplitude options
 */
export interface AmplitudeOptions extends BaseAnalyticsOptions {
  /** Amplitude API key */
  apiKey: string
  /** Server URL */
  serverUrl?: string
  /** Flush interval in milliseconds */
  flushIntervalMillis?: number
  /** Flush queue size (alias for flushAt) */
  flushQueueSize?: number
  /** Minimum ID length */
  minIdLength?: number
  /** App version */
  appVersion?: string
}

/**
 * PostHog options
 */
export interface PostHogOptions extends BaseAnalyticsOptions {
  /** PostHog API key */
  apiKey: string
  /** API host */
  host?: string
  /** Persistence type */
  persistence?: 'localStorage' | 'sessionStorage' | 'cookie' | 'memory'
  /** Bootstrap data */
  bootstrap?: {
    distinctID?: string
    isIdentifiedID?: boolean
    featureFlags?: Record<string, boolean | string>
    featureFlagPayloads?: Record<string, unknown>
  }
  /** Auto capture pageviews */
  autocapture?: boolean
  /** Capture page leave */
  capture_pageview?: boolean
  /** Capture page leave */
  capture_pageleave?: boolean
}

// =============================================================================
// Plugin Types
// =============================================================================

/**
 * Plugin type
 */
export type PluginType = 'before' | 'enrichment' | 'destination' | 'after'

/**
 * Plugin interface
 */
export interface Plugin<E = AnalyticsEvent> {
  name: string
  type: PluginType
  setup?(analytics: unknown): void | Promise<void>
  execute?(event: E): E | null | Promise<E | null>
  teardown?(): void | Promise<void>
}

// =============================================================================
// Callback Types
// =============================================================================

/**
 * Callback for async operations
 */
export type Callback = (error?: Error, result?: unknown) => void

/**
 * Feature flag callback
 */
export type FeatureFlagCallback = (flags: Record<string, boolean | string>) => void

// =============================================================================
// Amplitude-specific Types
// =============================================================================

/**
 * Amplitude event options
 */
export interface AmplitudeEventOptions {
  insert_id?: string
  user_id?: string
  device_id?: string
  time?: number
  session_id?: number
  price?: number
  quantity?: number
  revenue?: number
  productId?: string
  revenueType?: string
  receipt?: string
  receiptSig?: string
  event_id?: number
  partner_id?: string
  ip?: string
  location_lat?: number
  location_lng?: number
}

/**
 * Amplitude event (specific format)
 */
export interface AmplitudeEvent {
  event_type: string
  user_id?: string
  device_id?: string
  time?: number
  event_properties?: Properties
  user_properties?: {
    $set?: Properties
    $setOnce?: Properties
    $add?: Properties
    $append?: Properties
    $prepend?: Properties
    $unset?: Properties
    $preInsert?: Properties
    $postInsert?: Properties
    $remove?: Properties
    $clearAll?: string
  }
  groups?: Record<string, string | string[]>
  group_properties?: {
    $set?: Properties
    $setOnce?: Properties
  }
  session_id?: number
  insert_id?: string
  price?: number
  quantity?: number
  revenue?: number
}

// =============================================================================
// Mixpanel-specific Types
// =============================================================================

/**
 * Mixpanel event (specific format)
 */
export interface MixpanelEvent extends AnalyticsEvent {
  properties?: Properties & {
    token?: string
    distinct_id?: string
    time?: number
    $insert_id?: string
    mp_lib?: string
  }
}

// =============================================================================
// PostHog-specific Types
// =============================================================================

/**
 * PostHog event (specific format)
 */
export interface PostHogEvent extends AnalyticsEvent {
  $lib?: string
  $lib_version?: string
  $current_url?: string
  $referrer?: string
  $screen_name?: string
  $group_type?: string
  $group_key?: string
}

/**
 * Survey definition
 */
export interface Survey {
  id: string
  name: string
  type: 'popup' | 'api'
  questions: SurveyQuestion[]
  conditions?: Record<string, unknown>
}

/**
 * Survey question
 */
export interface SurveyQuestion {
  type: 'open' | 'multiple_choice' | 'single_choice' | 'rating' | 'nps'
  question: string
  choices?: string[]
  required?: boolean
}

// =============================================================================
// Event Stats (for WindowManager integration)
// =============================================================================

/**
 * Event statistics from real-time aggregation
 */
export interface EventStats {
  event: string
  count: number
  uniqueUsers: number
  properties: Record<string, PropertyStats>
  windowStart: number
  windowEnd: number
}

/**
 * Property statistics
 */
export interface PropertyStats {
  count: number
  values: Map<string, number>
}
