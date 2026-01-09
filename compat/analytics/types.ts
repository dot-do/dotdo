/**
 * Analytics Compat Layer Types
 *
 * Segment-compatible analytics types for tracking events,
 * identifying users, and managing user traits.
 *
 * @module @dotdo/compat/analytics/types
 */

// ============================================================================
// ANALYTICS EVENT TYPE
// ============================================================================

/**
 * Analytics event types (Segment-compatible)
 */
export type AnalyticsEventType = 'track' | 'identify' | 'page' | 'screen' | 'group' | 'alias'

// ============================================================================
// NESTED TYPES
// ============================================================================

/**
 * Address structure for UserTraits
 */
export interface Address {
  street?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
}

/**
 * Company structure for UserTraits
 */
export interface Company {
  id?: string
  name?: string
  industry?: string
  employee_count?: number
  plan?: string
}

/**
 * App context
 */
export interface AppContext {
  name?: string
  version?: string
  build?: string
  namespace?: string
}

/**
 * Campaign context (UTM params)
 */
export interface CampaignContext {
  name?: string
  source?: string
  medium?: string
  term?: string
  content?: string
}

/**
 * Device context
 */
export interface DeviceContext {
  id?: string
  advertisingId?: string
  adTrackingEnabled?: boolean
  manufacturer?: string
  model?: string
  name?: string
  type?: string
  token?: string
}

/**
 * Library context
 */
export interface LibraryContext {
  name?: string
  version?: string
}

/**
 * Location context
 */
export interface LocationContext {
  city?: string
  country?: string
  latitude?: number
  longitude?: number
  region?: string
  speed?: number
}

/**
 * Network context
 */
export interface NetworkContext {
  bluetooth?: boolean
  carrier?: string
  cellular?: boolean
  wifi?: boolean
}

/**
 * OS context
 */
export interface OSContext {
  name?: string
  version?: string
}

/**
 * Page context
 */
export interface PageContext {
  path?: string
  referrer?: string
  search?: string
  title?: string
  url?: string
}

/**
 * Screen context
 */
export interface ScreenContext {
  width?: number
  height?: number
  density?: number
}

// ============================================================================
// USER TRAITS
// ============================================================================

/**
 * User traits interface (Segment reserved traits)
 */
export interface UserTraits {
  // Reserved string traits
  email?: string
  name?: string
  firstName?: string
  lastName?: string
  phone?: string
  username?: string
  avatar?: string
  title?: string
  description?: string
  gender?: string
  website?: string

  // Reserved number traits
  age?: number

  // Reserved date traits
  birthday?: string | Date
  createdAt?: string | Date

  // Nested object traits
  address?: Address
  company?: Company

  // Allow custom traits
  [key: string]: unknown
}

// ============================================================================
// EVENT CONTEXT
// ============================================================================

/**
 * Event context (Segment context fields)
 */
export interface EventContext {
  app?: AppContext
  campaign?: CampaignContext
  device?: DeviceContext
  ip?: string
  library?: LibraryContext
  locale?: string
  location?: LocationContext
  network?: NetworkContext
  os?: OSContext
  page?: PageContext
  screen?: ScreenContext
  timezone?: string
  userAgent?: string
  groupId?: string
  traits?: UserTraits
}

// ============================================================================
// PROPERTY OPERATIONS
// ============================================================================

/**
 * Property operations for user profiles
 */
export interface PropertyOperations {
  $set?: Record<string, unknown>
  $setOnce?: Record<string, unknown>
  $add?: Record<string, number>
  $append?: Record<string, unknown>
  $prepend?: Record<string, unknown>
  $unset?: string[]
  $remove?: Record<string, unknown>
}

// ============================================================================
// BASE ANALYTICS EVENT
// ============================================================================

/**
 * Base analytics event
 */
export interface AnalyticsEvent {
  type: AnalyticsEventType
  anonymousId?: string
  userId?: string
  timestamp?: string
  messageId?: string
  context?: EventContext
  integrations?: Record<string, boolean>
}

// ============================================================================
// EVENT-SPECIFIC INTERFACES
// ============================================================================

/**
 * Track event specific interface
 */
export interface TrackEvent extends AnalyticsEvent {
  type: 'track'
  event: string
  properties?: Record<string, unknown>
}

/**
 * Identify event specific interface
 */
export interface IdentifyEvent extends AnalyticsEvent {
  type: 'identify'
  userId: string
  traits?: UserTraits
}

/**
 * Page event specific interface
 */
export interface PageEvent extends AnalyticsEvent {
  type: 'page'
  category?: string
  name?: string
  properties?: Record<string, unknown>
}

/**
 * Screen event specific interface (mobile)
 */
export interface ScreenEvent extends AnalyticsEvent {
  type: 'screen'
  name?: string
  properties?: Record<string, unknown>
}

/**
 * Group event specific interface
 */
export interface GroupEvent extends AnalyticsEvent {
  type: 'group'
  groupId: string
  traits?: Record<string, unknown>
}

/**
 * Alias event specific interface
 */
export interface AliasEvent extends AnalyticsEvent {
  type: 'alias'
  userId: string
  previousId: string
}

// ============================================================================
// VALIDATORS
// ============================================================================

const VALID_EVENT_TYPES: AnalyticsEventType[] = ['track', 'identify', 'page', 'screen', 'group', 'alias']

export function isValidAnalyticsEvent(event: unknown): event is AnalyticsEvent {
  if (event === null || event === undefined || typeof event !== 'object') {
    return false
  }

  const e = event as Record<string, unknown>

  // Check type is valid
  if (typeof e.type !== 'string' || !VALID_EVENT_TYPES.includes(e.type as AnalyticsEventType)) {
    return false
  }

  // Must have anonymousId or userId
  if (typeof e.anonymousId !== 'string' && typeof e.userId !== 'string') {
    return false
  }

  return true
}

export function isValidUserTraits(traits: unknown): traits is UserTraits {
  if (traits === null || traits === undefined) {
    return false
  }

  if (typeof traits !== 'object' || Array.isArray(traits)) {
    return false
  }

  return true
}

export function isValidEventContext(context: unknown): context is EventContext {
  if (context === null || context === undefined) {
    return false
  }

  if (typeof context !== 'object' || Array.isArray(context)) {
    return false
  }

  return true
}
