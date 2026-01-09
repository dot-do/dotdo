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
 * Middleware function type for beforeSend callbacks.
 * Return the event to continue, null/undefined to drop, or a modified event.
 */
export type MiddlewareFunction = (
  event: MiddlewareEvent
) => MiddlewareEvent | null | undefined | Promise<MiddlewareEvent | null | undefined>

/**
 * Event passed to middleware functions
 */
export interface MiddlewareEvent {
  type: string
  event?: string
  userId?: string
  anonymousId?: string
  properties?: Record<string, unknown>
  traits?: Record<string, unknown>
  context?: Partial<EventContext>
  integrations?: Record<string, boolean>
  timestamp?: string
  [key: string]: unknown
}

/**
 * Extended analytics configuration with middleware support
 */
export interface ExtendedAnalyticsConfig extends AnalyticsConfig {
  /** Middleware functions called before sending events */
  middleware?: MiddlewareFunction[]
  /** Enable automatic context enrichment */
  autoContext?: boolean
}

/**
 * Validation error class for analytics input validation
 */
export class AnalyticsValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AnalyticsValidationError'
  }
}

// ============================================================================
// INPUT VALIDATION
// ============================================================================

/**
 * Reserved event names that should not be used
 */
const RESERVED_EVENT_NAMES = new Set([
  'Application Installed',
  'Application Updated',
  'Application Opened',
  'Application Backgrounded',
  'Deep Link Opened',
  'Push Notification Received',
  'Push Notification Tapped',
])

/**
 * Valid property value types
 */
type ValidPropertyValue = string | number | boolean | null | undefined | Date | ValidPropertyValue[] | { [key: string]: ValidPropertyValue }

/**
 * Validate an event name.
 *
 * @param eventName - The event name to validate
 * @throws {AnalyticsValidationError} If the event name is invalid
 *
 * @example
 * ```typescript
 * validateEventName('Product Viewed') // OK
 * validateEventName('') // throws AnalyticsValidationError
 * ```
 */
export function validateEventName(eventName: string): void {
  if (typeof eventName !== 'string') {
    throw new AnalyticsValidationError('Event name must be a string')
  }

  if (eventName.trim() === '') {
    throw new AnalyticsValidationError('Event name cannot be empty')
  }

  if (eventName.length > 200) {
    throw new AnalyticsValidationError('Event name cannot exceed 200 characters')
  }

  // Warn about reserved names (but don't throw)
  if (RESERVED_EVENT_NAMES.has(eventName)) {
    console.warn(`[Analytics] Warning: "${eventName}" is a reserved event name`)
  }
}

/**
 * Validate a property value recursively.
 *
 * @param value - The value to validate
 * @param path - The property path (for error messages)
 * @throws {AnalyticsValidationError} If the value type is invalid
 */
export function validatePropertyValue(value: unknown, path: string = ''): void {
  if (value === null || value === undefined) {
    return
  }

  const type = typeof value

  // Allow primitives
  if (type === 'string' || type === 'number' || type === 'boolean') {
    // Check for NaN and Infinity
    if (type === 'number' && (!Number.isFinite(value as number))) {
      throw new AnalyticsValidationError(
        `Property ${path ? `"${path}" ` : ''}contains invalid number (NaN or Infinity)`
      )
    }
    return
  }

  // Allow Date objects
  if (value instanceof Date) {
    if (isNaN(value.getTime())) {
      throw new AnalyticsValidationError(
        `Property ${path ? `"${path}" ` : ''}contains invalid Date`
      )
    }
    return
  }

  // Allow arrays
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      validatePropertyValue(item, path ? `${path}[${index}]` : `[${index}]`)
    })
    return
  }

  // Allow plain objects
  if (type === 'object') {
    const obj = value as Record<string, unknown>
    for (const key of Object.keys(obj)) {
      validatePropertyValue(obj[key], path ? `${path}.${key}` : key)
    }
    return
  }

  // Reject functions, symbols, etc.
  throw new AnalyticsValidationError(
    `Property ${path ? `"${path}" ` : ''}has invalid type: ${type}`
  )
}

/**
 * Validate properties object.
 *
 * @param properties - The properties to validate
 * @throws {AnalyticsValidationError} If properties are invalid
 *
 * @example
 * ```typescript
 * validateProperties({ price: 99.99, name: 'Product' }) // OK
 * validateProperties({ fn: () => {} }) // throws AnalyticsValidationError
 * ```
 */
export function validateProperties(properties: unknown): void {
  if (properties === null || properties === undefined) {
    return
  }

  if (typeof properties !== 'object' || Array.isArray(properties)) {
    throw new AnalyticsValidationError('Properties must be a plain object')
  }

  for (const [key, value] of Object.entries(properties)) {
    if (typeof key !== 'string') {
      throw new AnalyticsValidationError('Property keys must be strings')
    }
    validatePropertyValue(value, key)
  }
}

/**
 * Validate a user ID.
 *
 * @param userId - The user ID to validate
 * @throws {AnalyticsValidationError} If the user ID is invalid
 */
export function validateUserId(userId: string): void {
  if (typeof userId !== 'string') {
    throw new AnalyticsValidationError('User ID must be a string')
  }

  if (userId.trim() === '') {
    throw new AnalyticsValidationError('User ID cannot be empty')
  }

  if (userId.length > 512) {
    throw new AnalyticsValidationError('User ID cannot exceed 512 characters')
  }
}

/**
 * Validate a group ID.
 *
 * @param groupId - The group ID to validate
 * @throws {AnalyticsValidationError} If the group ID is invalid
 */
export function validateGroupId(groupId: string): void {
  if (typeof groupId !== 'string') {
    throw new AnalyticsValidationError('Group ID must be a string')
  }

  if (groupId.trim() === '') {
    throw new AnalyticsValidationError('Group ID cannot be empty')
  }

  if (groupId.length > 512) {
    throw new AnalyticsValidationError('Group ID cannot exceed 512 characters')
  }
}

/**
 * Singleton analytics client instance
 */
let _client: AnalyticsClient | null = null

/**
 * Middleware functions
 */
let _middleware: MiddlewareFunction[] = []

/**
 * Auto context enabled flag
 */
let _autoContext = false

/**
 * Deduplication cache for trackOnce/pageOnce
 */
const _dedupeCache = new Set<string>()

/**
 * Session ID for pageOnce
 */
let _sessionId: string | null = null

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the analytics client
 *
 * @param config - Analytics configuration (supports extended config with middleware)
 * @returns The analytics client instance
 *
 * @example
 * ```typescript
 * import { init, track } from '@dotdo/compat/analytics'
 *
 * // Basic initialization
 * init({ writeKey: 'your-write-key' })
 *
 * // With middleware
 * init({
 *   writeKey: 'your-write-key',
 *   middleware: [
 *     (event) => {
 *       // Filter out internal events
 *       if (event.properties?.internal) return null
 *       return event
 *     }
 *   ],
 *   autoContext: true
 * })
 *
 * track('Button Clicked', { buttonId: 'submit' })
 * ```
 */
export function init(config: ExtendedAnalyticsConfig): AnalyticsClient {
  // Destroy existing client if any
  if (_client) {
    _client.destroy()
  }

  // Store middleware
  _middleware = config.middleware || []

  // Store auto context setting
  _autoContext = config.autoContext ?? false

  // Generate new session ID
  _sessionId = crypto.randomUUID()

  // Clear dedupe cache on init
  _dedupeCache.clear()

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
  _middleware = []
  _autoContext = false
  _dedupeCache.clear()
  _sessionId = null
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

/**
 * Generate a simple hash for deduplication
 */
function hashEvent(eventName: string, properties?: Record<string, unknown>): string {
  const data = JSON.stringify({ event: eventName, properties: properties || {} })
  // Simple hash using reduce
  let hash = 0
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return `${eventName}:${hash.toString(36)}`
}

/**
 * Get auto-enriched context
 */
function getAutoContext(): Partial<EventContext> {
  if (!_autoContext) {
    return {}
  }

  const context: Partial<EventContext> = {
    library: {
      name: '@dotdo/compat/analytics',
      version: '1.0.0',
    },
  }

  // Detect runtime environment
  if (typeof navigator !== 'undefined') {
    // Browser environment
    context.userAgent = navigator.userAgent
    context.locale = navigator.language

    if (typeof screen !== 'undefined') {
      context.screen = {
        width: screen.width,
        height: screen.height,
        density: window.devicePixelRatio || 1,
      }
    }

    if (typeof location !== 'undefined') {
      context.page = {
        path: location.pathname,
        url: location.href,
        search: location.search,
        title: typeof document !== 'undefined' ? document.title : undefined,
        referrer: typeof document !== 'undefined' ? document.referrer : undefined,
      }
    }

    // Try to get timezone
    try {
      context.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      // Ignore timezone detection errors
    }
  }

  return context
}

/**
 * Merge contexts (base context gets auto context merged in)
 */
function mergeContext(baseContext?: Partial<EventContext>): Partial<EventContext> | undefined {
  const autoContext = getAutoContext()

  if (Object.keys(autoContext).length === 0 && !baseContext) {
    return undefined
  }

  return {
    ...autoContext,
    ...baseContext,
  }
}

/**
 * Process event through middleware chain
 */
async function processMiddleware(event: MiddlewareEvent): Promise<MiddlewareEvent | null> {
  let currentEvent: MiddlewareEvent | null | undefined = event

  for (const middleware of _middleware) {
    if (!currentEvent) break

    try {
      currentEvent = await middleware(currentEvent)
    } catch (error) {
      console.error('[Analytics] Middleware error:', error)
      // Continue with unmodified event on middleware error
    }
  }

  return currentEvent || null
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
 * Track an event with optional properties and routing options.
 *
 * Validates the event name and properties before sending to ensure
 * data quality and prevent common errors.
 *
 * @param event - The event name (max 200 chars, cannot be empty)
 * @param properties - Event properties (must be JSON-serializable)
 * @param options - Additional options for routing and context
 * @throws {AnalyticsValidationError} If event name or properties are invalid
 *
 * @example
 * ```typescript
 * // Basic tracking
 * track('Product Viewed', {
 *   productId: 'prod-123',
 *   price: 99.99,
 *   category: 'Electronics'
 * })
 *
 * // With routing options
 * track('Purchase Completed', { orderId: 'ord-123' }, {
 *   integrations: { Mixpanel: true },
 *   context: { campaign: { name: 'summer-sale' } }
 * })
 * ```
 */
export function track(
  event: string,
  properties?: Record<string, unknown>,
  options?: SegmentOptions
): void {
  // Validate inputs
  validateEventName(event)
  if (properties !== undefined) {
    validateProperties(properties)
  }

  const client = getClient()
  const contextWithAuto = mergeContext(options?.context)
  const eventBase = buildEventBase(options)

  // Apply merged context if available
  if (contextWithAuto) {
    eventBase.context = contextWithAuto
  }

  client.track({
    event,
    properties,
    ...eventBase,
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
