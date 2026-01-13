/**
 * Event Collector API Types
 *
 * Type definitions for the Segment-compatible event collection API:
 * - track: Record user actions
 * - identify: Associate user with traits
 * - page: Record page views
 * - group: Associate user with a group
 * - alias: Link user identities
 * - batch: Send multiple events at once
 *
 * @module types/events-api
 */

// ============================================================================
// CONTEXT TYPES
// ============================================================================

/**
 * Device information for context enrichment
 */
export interface DeviceInfo {
  type?: 'mobile' | 'tablet' | 'desktop' | 'unknown'
  manufacturer?: string
  model?: string
  name?: string
  id?: string
  advertisingId?: string
  adTrackingEnabled?: boolean
  token?: string
}

/**
 * Operating system information
 */
export interface OSInfo {
  name?: string
  version?: string
}

/**
 * Browser information
 */
export interface BrowserInfo {
  name?: string
  version?: string
}

/**
 * Campaign/UTM tracking information
 */
export interface CampaignInfo {
  source?: string
  medium?: string
  name?: string
  term?: string
  content?: string
}

/**
 * App information for mobile/desktop apps
 */
export interface AppInfo {
  name?: string
  version?: string
  build?: string
  namespace?: string
}

/**
 * Page information for web context
 */
export interface PageInfo {
  url?: string
  path?: string
  referrer?: string
  search?: string
  title?: string
}

/**
 * Screen information for display context
 */
export interface ScreenInfo {
  width?: number
  height?: number
  density?: number
}

/**
 * Network information
 */
export interface NetworkInfo {
  bluetooth?: boolean
  carrier?: string
  cellular?: boolean
  wifi?: boolean
}

/**
 * Location information
 */
export interface LocationInfo {
  city?: string
  country?: string
  latitude?: number
  longitude?: number
  region?: string
  speed?: number
}

/**
 * Library information (SDK that sent the event)
 */
export interface LibraryInfo {
  name: string
  version: string
}

/**
 * Full event context for enrichment
 */
export interface EventContext {
  active?: boolean
  app?: AppInfo
  campaign?: CampaignInfo
  device?: DeviceInfo
  ip?: string
  library?: LibraryInfo
  locale?: string
  location?: LocationInfo
  network?: NetworkInfo
  os?: OSInfo
  page?: PageInfo
  referrer?: {
    id?: string
    type?: string
  }
  screen?: ScreenInfo
  timezone?: string
  groupId?: string
  traits?: Record<string, unknown>
  userAgent?: string
  channel?: string
  [key: string]: unknown
}

// ============================================================================
// INTEGRATION SETTINGS
// ============================================================================

/**
 * Integrations object for controlling destination behavior
 */
export interface Integrations {
  /** Enable/disable all integrations */
  All?: boolean
  /** Per-integration settings */
  [key: string]: boolean | Record<string, unknown> | undefined
}

// ============================================================================
// BASE EVENT TYPES
// ============================================================================

/**
 * Common fields for all event types
 */
export interface BaseEventFields {
  /** Unique message ID (auto-generated if not provided) */
  messageId?: string
  /** Event timestamp (ISO 8601 string or Date, defaults to now) */
  timestamp?: string | Date
  /** Identified user ID */
  userId?: string
  /** Anonymous/device ID (required if no userId) */
  anonymousId?: string
  /** Event context for enrichment */
  context?: EventContext
  /** Integration-specific settings */
  integrations?: Integrations
}

// ============================================================================
// REQUEST TYPES
// ============================================================================

/**
 * Track event request - record a user action
 * POST /v1/track
 */
export interface TrackRequest extends BaseEventFields {
  /** Event name (required) */
  event: string
  /** Event properties */
  properties?: Record<string, unknown>
}

/**
 * Identify event request - associate traits with a user
 * POST /v1/identify
 */
export interface IdentifyRequest extends BaseEventFields {
  /** User traits to store */
  traits?: Record<string, unknown>
}

/**
 * Page event request - record a page view
 * POST /v1/page
 */
export interface PageRequest extends BaseEventFields {
  /** Page name */
  name?: string
  /** Page category */
  category?: string
  /** Page properties */
  properties?: Record<string, unknown>
}

/**
 * Screen event request - record a mobile screen view
 * POST /v1/screen
 */
export interface ScreenRequest extends BaseEventFields {
  /** Screen name (required) */
  name: string
  /** Screen category */
  category?: string
  /** Screen properties */
  properties?: Record<string, unknown>
}

/**
 * Group event request - associate user with a group/company
 * POST /v1/group
 */
export interface GroupRequest extends BaseEventFields {
  /** Group ID (required) */
  groupId: string
  /** Group traits to store */
  traits?: Record<string, unknown>
}

/**
 * Alias event request - link two user identities
 * POST /v1/alias
 */
export interface AliasRequest {
  /** Previous user ID to alias from (required) */
  previousId: string
  /** New user ID to alias to (required) */
  userId: string
  /** Unique message ID */
  messageId?: string
  /** Event timestamp */
  timestamp?: string | Date
  /** Event context */
  context?: EventContext
  /** Integration settings */
  integrations?: Integrations
}

/**
 * Event type discriminator for batch events
 */
export type EventType = 'track' | 'identify' | 'page' | 'screen' | 'group' | 'alias'

/**
 * Single event in a batch (with type discriminator)
 */
export interface BatchEvent extends BaseEventFields {
  /** Event type (required for batch) */
  type: EventType
  /** Event name (for track events) */
  event?: string
  /** Page/screen name */
  name?: string
  /** Page/screen category */
  category?: string
  /** Group ID (for group events) */
  groupId?: string
  /** Previous ID (for alias events) */
  previousId?: string
  /** Event properties */
  properties?: Record<string, unknown>
  /** User/group traits */
  traits?: Record<string, unknown>
}

/**
 * Batch event request - send multiple events
 * POST /v1/batch
 */
export interface BatchRequest {
  /** Array of events to send */
  batch: BatchEvent[]
  /** Shared context for all events */
  context?: EventContext
  /** Shared integration settings */
  integrations?: Integrations
}

// ============================================================================
// RESPONSE TYPES
// ============================================================================

/**
 * Successful event response
 */
export interface EventResponse {
  /** Success indicator */
  success: true
  /** Generated/echoed message ID */
  messageId: string
  /** Timestamp of when event was received */
  receivedAt: string
}

/**
 * Batch response with per-event status
 */
export interface BatchResponse {
  /** Overall success indicator */
  success: boolean
  /** Number of events processed */
  processed: number
  /** Number of events that succeeded */
  succeeded: number
  /** Number of events that failed */
  failed: number
  /** Individual event results (optional) */
  events?: Array<{
    messageId: string
    success: boolean
    error?: string
  }>
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Error codes for event collection API
 */
export type EventErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_EVENT'
  | 'MISSING_IDENTITY'
  | 'INVALID_BATCH'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'

/**
 * Event API error response
 */
export interface EventError {
  code: EventErrorCode
  message: string
  details?: Record<string, unknown>
}

// ============================================================================
// VALIDATION TYPES
// ============================================================================

/**
 * Validation result for event requests
 */
export interface EventValidationResult<T> {
  valid: boolean
  data?: T
  errors?: string[]
}
