/**
 * Analytics Compat Layer Types
 *
 * Segment-compatible analytics types for tracking events,
 * identifying users, and managing user traits.
 *
 * @module @dotdo/compat/analytics/types
 */

// ============================================================================
// STUB TYPES - TDD RED PHASE
// These are intentionally incomplete to make tests fail
// ============================================================================

/**
 * Analytics event types (Segment-compatible)
 * TODO: Implement full type union
 */
export type AnalyticsEventType = 'track' // Missing: 'identify' | 'page' | 'screen' | 'group' | 'alias'

/**
 * Base analytics event
 * TODO: Add all required fields
 */
export interface AnalyticsEvent {
  type: AnalyticsEventType
  // Missing: anonymousId, userId, timestamp, messageId, context, etc.
}

/**
 * User traits interface (Segment reserved traits)
 * TODO: Add all reserved traits
 */
export interface UserTraits {
  // Missing all reserved traits: email, name, firstName, lastName, etc.
  [key: string]: unknown
}

/**
 * Event context (Segment context fields)
 * TODO: Add all context fields
 */
export interface EventContext {
  // Missing: app, campaign, device, ip, library, locale, location, etc.
}

/**
 * Property operations for user profiles
 * TODO: Add all operations
 */
export interface PropertyOperations {
  // Missing: $set, $setOnce, $add, $append, $prepend, $unset, $remove
}

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
 * TODO: Implement
 */
export interface IdentifyEvent extends AnalyticsEvent {
  type: 'identify' // This will fail - 'identify' not in AnalyticsEventType
}

/**
 * Page event specific interface
 * TODO: Implement
 */
export interface PageEvent extends AnalyticsEvent {
  type: 'page' // This will fail - 'page' not in AnalyticsEventType
}

/**
 * Screen event specific interface (mobile)
 * TODO: Implement
 */
export interface ScreenEvent extends AnalyticsEvent {
  type: 'screen' // This will fail - 'screen' not in AnalyticsEventType
}

/**
 * Group event specific interface
 * TODO: Implement
 */
export interface GroupEvent extends AnalyticsEvent {
  type: 'group' // This will fail - 'group' not in AnalyticsEventType
}

/**
 * Alias event specific interface
 * TODO: Implement
 */
export interface AliasEvent extends AnalyticsEvent {
  type: 'alias' // This will fail - 'alias' not in AnalyticsEventType
}

// ============================================================================
// VALIDATORS - STUBS
// ============================================================================

export function isValidAnalyticsEvent(_event: unknown): _event is AnalyticsEvent {
  // TODO: Implement validation
  return false
}

export function isValidUserTraits(_traits: unknown): _traits is UserTraits {
  // TODO: Implement validation
  return false
}

export function isValidEventContext(_context: unknown): _context is EventContext {
  // TODO: Implement validation
  return false
}
