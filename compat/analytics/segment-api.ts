/**
 * Segment-Compatible API Methods
 *
 * Provides the familiar Segment API (identify, track, page, screen, group, alias)
 * as standalone functions that can be used without instantiating a client.
 *
 * @module @dotdo/compat/analytics/segment-api
 */

import type { UserTraits, EventContext } from './types'
import { AnalyticsClient, type AnalyticsConfig } from './analytics'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Common options for all API methods
 */
export interface SegmentOptions {
  /** Override anonymous ID */
  anonymousId?: string
  /** Additional context */
  context?: Partial<EventContext>
  /** Integration routing */
  integrations?: Record<string, boolean>
  /** Override timestamp */
  timestamp?: string
}

/**
 * Singleton analytics client instance
 */
let _client: AnalyticsClient | null = null

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the analytics client
 *
 * @param config - Analytics configuration
 * @returns The analytics client instance
 *
 * @example
 * ```typescript
 * import { init, track } from '@dotdo/compat/analytics'
 *
 * init({ writeKey: 'your-write-key' })
 *
 * track('Button Clicked', { buttonId: 'submit' })
 * ```
 */
export function init(_config: AnalyticsConfig): AnalyticsClient {
  // TODO: Implement
  throw new Error('Not implemented')
}

/**
 * Get the current analytics client instance
 *
 * @throws If init() hasn't been called
 */
export function getClient(): AnalyticsClient {
  // TODO: Implement
  throw new Error('Not implemented')
}

/**
 * Reset the client (useful for testing)
 */
export function reset(): void {
  // TODO: Implement
  throw new Error('Not implemented')
}

// ============================================================================
// API METHODS
// ============================================================================

/**
 * Identify a user with traits
 *
 * @param userId - The user ID to identify (optional if only updating traits)
 * @param traits - User traits to set
 * @param options - Additional options
 *
 * @example
 * ```typescript
 * // Identify with user ID and traits
 * identify('user-123', {
 *   email: 'user@example.com',
 *   name: 'John Doe'
 * })
 *
 * // Update traits for anonymous user
 * identify({ plan: 'premium' })
 * ```
 */
export function identify(
  _userIdOrTraits: string | UserTraits,
  _traitsOrOptions?: UserTraits | SegmentOptions,
  _options?: SegmentOptions
): void {
  // TODO: Implement
  throw new Error('Not implemented')
}

/**
 * Track an event
 *
 * @param event - The event name
 * @param properties - Event properties
 * @param options - Additional options
 *
 * @example
 * ```typescript
 * track('Product Viewed', {
 *   productId: 'prod-123',
 *   price: 99.99,
 *   category: 'Electronics'
 * })
 * ```
 */
export function track(
  _event: string,
  _properties?: Record<string, unknown>,
  _options?: SegmentOptions
): void {
  // TODO: Implement
  throw new Error('Not implemented')
}

/**
 * Track a page view
 *
 * @param category - The page category (optional)
 * @param name - The page name (optional)
 * @param properties - Page properties
 * @param options - Additional options
 *
 * @example
 * ```typescript
 * // Track with category and name
 * page('Docs', 'Getting Started', { author: 'John' })
 *
 * // Track anonymous page view
 * page()
 *
 * // Track with just name
 * page('Home')
 * ```
 */
export function page(
  _categoryOrName?: string,
  _nameOrProperties?: string | Record<string, unknown>,
  _propertiesOrOptions?: Record<string, unknown> | SegmentOptions,
  _options?: SegmentOptions
): void {
  // TODO: Implement
  throw new Error('Not implemented')
}

/**
 * Track a screen view (mobile)
 *
 * @param name - The screen name
 * @param properties - Screen properties
 * @param options - Additional options
 *
 * @example
 * ```typescript
 * screen('Home Screen', {
 *   screenClass: 'HomeViewController'
 * })
 * ```
 */
export function screen(
  _name: string,
  _properties?: Record<string, unknown>,
  _options?: SegmentOptions
): void {
  // TODO: Implement
  throw new Error('Not implemented')
}

/**
 * Associate a user with a group
 *
 * @param groupId - The group ID
 * @param traits - Group traits
 * @param options - Additional options
 *
 * @example
 * ```typescript
 * group('company-123', {
 *   name: 'Acme Inc',
 *   industry: 'Technology',
 *   employees: 100
 * })
 * ```
 */
export function group(
  _groupId: string,
  _traits?: Record<string, unknown>,
  _options?: SegmentOptions
): void {
  // TODO: Implement
  throw new Error('Not implemented')
}

/**
 * Alias a user ID to another
 *
 * @param userId - The new user ID
 * @param previousId - The previous ID (anonymous or old user ID)
 * @param options - Additional options
 *
 * @example
 * ```typescript
 * // Link anonymous user to registered user
 * alias('user-123', 'anon-456')
 * ```
 */
export function alias(
  _userId: string,
  _previousId: string,
  _options?: SegmentOptions
): void {
  // TODO: Implement
  throw new Error('Not implemented')
}

/**
 * Flush buffered events
 *
 * @returns Promise that resolves when flush completes
 */
export async function flush(): Promise<void> {
  // TODO: Implement
  throw new Error('Not implemented')
}
