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
export function init(config: AnalyticsConfig): AnalyticsClient {
  // Destroy existing client if any
  if (_client) {
    _client.destroy()
  }
  _client = new AnalyticsClient(config)
  return _client
}

/**
 * Get the current analytics client instance
 *
 * @throws If init() hasn't been called
 */
export function getClient(): AnalyticsClient {
  if (!_client) {
    throw new Error('Analytics client not initialized. Call init() first.')
  }
  return _client
}

/**
 * Reset the client (useful for testing)
 */
export function reset(): void {
  if (_client) {
    _client.destroy()
    _client = null
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if a value is a SegmentOptions object
 */
function isSegmentOptions(value: unknown): value is SegmentOptions {
  if (!value || typeof value !== 'object') return false
  const keys = Object.keys(value)
  const optionKeys = ['anonymousId', 'context', 'integrations', 'timestamp']
  return keys.some(k => optionKeys.includes(k))
}

/**
 * Build event base from options
 */
function buildEventBase(options?: SegmentOptions): Record<string, unknown> {
  const base: Record<string, unknown> = {}
  if (options?.anonymousId) base.anonymousId = options.anonymousId
  if (options?.context) base.context = options.context
  if (options?.integrations) base.integrations = options.integrations
  if (options?.timestamp) base.timestamp = options.timestamp
  return base
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
  userIdOrTraits: string | UserTraits,
  traitsOrOptions?: UserTraits | SegmentOptions,
  options?: SegmentOptions
): void {
  const client = getClient()

  // Determine call signature
  if (typeof userIdOrTraits === 'string') {
    // identify(userId, traits?, options?)
    const userId = userIdOrTraits
    const traits = traitsOrOptions && !isSegmentOptions(traitsOrOptions)
      ? traitsOrOptions as UserTraits
      : undefined
    const opts = isSegmentOptions(traitsOrOptions)
      ? traitsOrOptions as SegmentOptions
      : options

    client.identify({
      userId,
      traits,
      ...buildEventBase(opts),
    } as any)
  } else {
    // identify(traits, options?)
    const traits = userIdOrTraits
    const opts = traitsOrOptions as SegmentOptions | undefined

    client.identify({
      traits,
      ...buildEventBase(opts),
    } as any)
  }
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
  event: string,
  properties?: Record<string, unknown>,
  options?: SegmentOptions
): void {
  const client = getClient()
  client.track({
    event,
    properties,
    ...buildEventBase(options),
  })
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
  categoryOrName?: string,
  nameOrProperties?: string | Record<string, unknown>,
  propertiesOrOptions?: Record<string, unknown> | SegmentOptions,
  options?: SegmentOptions
): void {
  const client = getClient()

  // Determine call signature
  if (categoryOrName === undefined) {
    // page() - anonymous page view
    client.page()
    return
  }

  if (typeof nameOrProperties === 'string') {
    // page(category, name, properties?, options?)
    const category = categoryOrName
    const name = nameOrProperties
    const properties = propertiesOrOptions && !isSegmentOptions(propertiesOrOptions)
      ? propertiesOrOptions as Record<string, unknown>
      : undefined
    const opts = isSegmentOptions(propertiesOrOptions)
      ? propertiesOrOptions as SegmentOptions
      : options

    client.page({
      category,
      name,
      properties,
      ...buildEventBase(opts),
    } as any)
  } else {
    // page(name, properties?, options?)
    const name = categoryOrName
    const properties = nameOrProperties as Record<string, unknown> | undefined
    const opts = propertiesOrOptions as SegmentOptions | undefined

    client.page({
      name,
      properties,
      ...buildEventBase(opts),
    } as any)
  }
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
  name: string,
  properties?: Record<string, unknown>,
  options?: SegmentOptions
): void {
  const client = getClient()
  client.screen({
    name,
    properties,
    ...buildEventBase(options),
  } as any)
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
  groupId: string,
  traits?: Record<string, unknown>,
  options?: SegmentOptions
): void {
  const client = getClient()
  client.group({
    groupId,
    traits,
    ...buildEventBase(options),
  } as any)
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
  userId: string,
  previousId: string,
  options?: SegmentOptions
): void {
  const client = getClient()
  client.alias({
    userId,
    previousId,
    ...buildEventBase(options),
  } as any)
}

/**
 * Flush buffered events
 *
 * @returns Promise that resolves when flush completes
 */
export async function flush(): Promise<void> {
  const client = getClient()
  await client.flush()
}
