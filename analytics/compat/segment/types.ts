/**
 * Analytics Compat Layer Types
 *
 * Segment-compatible analytics types for tracking events, identifying users,
 * and managing user traits. This module provides full compatibility with the
 * Segment Spec while adding TypeScript-first type safety.
 *
 * @see {@link https://segment.com/docs/connections/spec/ | Segment Spec}
 * @see {@link https://openfeature.dev/specification/types | OpenFeature Types}
 *
 * @example
 * ```typescript
 * import type { TrackEvent, IdentifyEvent } from '@dotdo/compat/analytics'
 * import { isTrackEvent, createTrackEvent } from '@dotdo/compat/analytics'
 *
 * // Type-safe event creation
 * const event = createTrackEvent('Product Viewed', {
 *   productId: 'prod-123',
 *   price: 99.99
 * }, { anonymousId: 'anon-456' })
 *
 * // Runtime type guards
 * if (isTrackEvent(event)) {
 *   console.log(event.event) // TypeScript knows this is a string
 * }
 * ```
 *
 * @module @dotdo/compat/analytics/types
 */

// ============================================================================
// ANALYTICS EVENT TYPE
// ============================================================================

/**
 * Analytics event types following the Segment Spec.
 *
 * Each event type serves a specific purpose in the analytics lifecycle:
 * - `track` - Record user actions and behaviors
 * - `identify` - Associate user with traits (email, name, etc.)
 * - `page` - Record web page views
 * - `screen` - Record mobile screen views
 * - `group` - Associate user with a group/organization
 * - `alias` - Merge two user identities
 *
 * @see {@link https://segment.com/docs/connections/spec/track/ | Track Spec}
 * @see {@link https://segment.com/docs/connections/spec/identify/ | Identify Spec}
 * @see {@link https://segment.com/docs/connections/spec/page/ | Page Spec}
 * @see {@link https://segment.com/docs/connections/spec/screen/ | Screen Spec}
 * @see {@link https://segment.com/docs/connections/spec/group/ | Group Spec}
 * @see {@link https://segment.com/docs/connections/spec/alias/ | Alias Spec}
 */
export type AnalyticsEventType = 'track' | 'identify' | 'page' | 'screen' | 'group' | 'alias'

// ============================================================================
// NESTED TYPES
// ============================================================================

/**
 * Physical or mailing address structure for UserTraits.
 *
 * @see {@link https://segment.com/docs/connections/spec/identify/#address | Segment Address Trait}
 *
 * @example
 * ```typescript
 * const address: Address = {
 *   street: '123 Main St',
 *   city: 'San Francisco',
 *   state: 'CA',
 *   postalCode: '94102',
 *   country: 'USA'
 * }
 * ```
 */
export interface Address {
  /** Street address including apartment/suite number */
  street?: string
  /** City name */
  city?: string
  /** State, province, or region */
  state?: string
  /** ZIP or postal code */
  postalCode?: string
  /** Country name or ISO 3166-1 alpha-2 code */
  country?: string
}

/**
 * Company/organization information for B2B user traits.
 *
 * @see {@link https://segment.com/docs/connections/spec/identify/#company | Segment Company Trait}
 *
 * @example
 * ```typescript
 * const company: Company = {
 *   id: 'company-123',
 *   name: 'Acme Inc',
 *   industry: 'Technology',
 *   employee_count: 150,
 *   plan: 'enterprise'
 * }
 * ```
 */
export interface Company {
  /** Unique identifier for the company */
  id?: string
  /** Company name */
  name?: string
  /** Industry or sector */
  industry?: string
  /** Number of employees */
  employee_count?: number
  /** Subscription or pricing plan */
  plan?: string
}

/**
 * Application context information.
 *
 * Describes the application generating the analytics event.
 * Particularly useful for mobile and desktop applications.
 *
 * @see {@link https://segment.com/docs/connections/spec/common/#context | Segment Context}
 *
 * @example
 * ```typescript
 * const app: AppContext = {
 *   name: 'MyApp',
 *   version: '2.1.0',
 *   build: '456',
 *   namespace: 'com.example.myapp'
 * }
 * ```
 */
export interface AppContext {
  /** Application name */
  name?: string
  /** Application version (semver recommended) */
  version?: string
  /** Build number or identifier */
  build?: string
  /** Application bundle identifier or namespace */
  namespace?: string
}

/**
 * Marketing campaign attribution context (UTM parameters).
 *
 * Maps directly to Google Analytics UTM parameters for
 * tracking marketing campaign effectiveness.
 *
 * @see {@link https://segment.com/docs/connections/spec/common/#context-fields-automatically-collected | Campaign Context}
 *
 * @example
 * ```typescript
 * const campaign: CampaignContext = {
 *   name: 'spring_sale_2025',
 *   source: 'google',
 *   medium: 'cpc',
 *   term: 'running shoes',
 *   content: 'banner_v2'
 * }
 * ```
 */
export interface CampaignContext {
  /** Campaign name (utm_campaign) */
  name?: string
  /** Traffic source (utm_source) */
  source?: string
  /** Marketing medium (utm_medium) */
  medium?: string
  /** Paid search keywords (utm_term) */
  term?: string
  /** Ad content identifier (utm_content) */
  content?: string
}

/**
 * Device information context.
 *
 * Describes the physical device generating the event.
 * Essential for mobile analytics and cross-device tracking.
 *
 * @see {@link https://segment.com/docs/connections/spec/common/#context-fields-automatically-collected | Device Context}
 *
 * @example
 * ```typescript
 * const device: DeviceContext = {
 *   id: 'B5372DB0-C21E-11E4-8DFC-AA07A5B093DB',
 *   manufacturer: 'Apple',
 *   model: 'iPhone 15 Pro',
 *   type: 'ios'
 * }
 * ```
 */
export interface DeviceContext {
  /** Unique device identifier */
  id?: string
  /** Advertising identifier (IDFA/GAID) */
  advertisingId?: string
  /** Whether ad tracking is enabled */
  adTrackingEnabled?: boolean
  /** Device manufacturer (e.g., 'Apple', 'Samsung') */
  manufacturer?: string
  /** Device model (e.g., 'iPhone 15 Pro') */
  model?: string
  /** User-assigned device name */
  name?: string
  /** Device type (e.g., 'ios', 'android', 'web') */
  type?: string
  /** Push notification token */
  token?: string
}

/**
 * Analytics library context.
 *
 * Identifies the analytics SDK/library sending the event.
 *
 * @see {@link https://segment.com/docs/connections/spec/common/#context-fields-automatically-collected | Library Context}
 */
export interface LibraryContext {
  /** Library name (e.g., 'analytics.js', 'analytics-ios') */
  name?: string
  /** Library version */
  version?: string
}

/**
 * Geographic location context.
 *
 * Provides location information for the event, typically
 * derived from IP geolocation or device GPS.
 *
 * @see {@link https://segment.com/docs/connections/spec/common/#context-fields-automatically-collected | Location Context}
 *
 * @example
 * ```typescript
 * const location: LocationContext = {
 *   city: 'San Francisco',
 *   country: 'United States',
 *   latitude: 37.7749,
 *   longitude: -122.4194,
 *   region: 'California'
 * }
 * ```
 */
export interface LocationContext {
  /** City name */
  city?: string
  /** Country name */
  country?: string
  /** Latitude coordinate */
  latitude?: number
  /** Longitude coordinate */
  longitude?: number
  /** State, province, or region */
  region?: string
  /** Device speed in meters/second */
  speed?: number
}

/**
 * Network connectivity context.
 *
 * Describes the network conditions when the event was generated.
 *
 * @see {@link https://segment.com/docs/connections/spec/common/#context-fields-automatically-collected | Network Context}
 */
export interface NetworkContext {
  /** Bluetooth enabled status */
  bluetooth?: boolean
  /** Mobile carrier name */
  carrier?: string
  /** Cellular data enabled */
  cellular?: boolean
  /** WiFi connected status */
  wifi?: boolean
}

/**
 * Operating system context.
 *
 * @see {@link https://segment.com/docs/connections/spec/common/#context-fields-automatically-collected | OS Context}
 */
export interface OSContext {
  /** OS name (e.g., 'iOS', 'Android', 'Windows') */
  name?: string
  /** OS version */
  version?: string
}

/**
 * Web page context.
 *
 * Describes the current web page where the event originated.
 * Automatically collected by analytics.js.
 *
 * @see {@link https://segment.com/docs/connections/spec/page/#properties | Page Properties}
 *
 * @example
 * ```typescript
 * const page: PageContext = {
 *   path: '/products/shoes',
 *   referrer: 'https://google.com',
 *   search: '?color=blue',
 *   title: 'Running Shoes | MyStore',
 *   url: 'https://mystore.com/products/shoes?color=blue'
 * }
 * ```
 */
export interface PageContext {
  /** URL path */
  path?: string
  /** Full referrer URL */
  referrer?: string
  /** Query string */
  search?: string
  /** Page title */
  title?: string
  /** Full page URL */
  url?: string
}

/**
 * Screen/display context.
 *
 * Describes the device screen characteristics.
 *
 * @see {@link https://segment.com/docs/connections/spec/common/#context-fields-automatically-collected | Screen Context}
 */
export interface ScreenContext {
  /** Screen width in pixels */
  width?: number
  /** Screen height in pixels */
  height?: number
  /** Screen pixel density */
  density?: number
}

// ============================================================================
// USER TRAITS
// ============================================================================

/**
 * User traits for identifying and describing users.
 *
 * Contains Segment's reserved traits plus support for custom traits.
 * Reserved traits have special meaning and may receive special treatment
 * in downstream destinations.
 *
 * @see {@link https://segment.com/docs/connections/spec/identify/#traits | Segment Traits}
 *
 * @example
 * ```typescript
 * const traits: UserTraits = {
 *   // Reserved traits
 *   email: 'john@example.com.ai',
 *   firstName: 'John',
 *   lastName: 'Doe',
 *   company: { name: 'Acme Inc', plan: 'enterprise' },
 *
 *   // Custom traits
 *   tier: 'premium',
 *   loginCount: 42
 * }
 * ```
 */
export interface UserTraits {
  // -------------------------------------------------------------------------
  // Reserved String Traits
  // -------------------------------------------------------------------------

  /** User's email address */
  email?: string
  /** User's full name */
  name?: string
  /** User's first/given name */
  firstName?: string
  /** User's last/family name */
  lastName?: string
  /** User's phone number */
  phone?: string
  /** User's username or handle */
  username?: string
  /** URL to user's avatar image */
  avatar?: string
  /** User's job title */
  title?: string
  /** Free-form description of the user */
  description?: string
  /** User's gender */
  gender?: string
  /** User's personal website URL */
  website?: string

  // -------------------------------------------------------------------------
  // Reserved Number Traits
  // -------------------------------------------------------------------------

  /** User's age in years */
  age?: number

  // -------------------------------------------------------------------------
  // Reserved Date Traits
  // -------------------------------------------------------------------------

  /** User's birthday (ISO 8601 date string or Date object) */
  birthday?: string | Date
  /** When the user was created (ISO 8601 timestamp or Date object) */
  createdAt?: string | Date

  // -------------------------------------------------------------------------
  // Reserved Object Traits
  // -------------------------------------------------------------------------

  /** User's physical or mailing address */
  address?: Address
  /** User's company/organization information */
  company?: Company

  // -------------------------------------------------------------------------
  // Custom Traits
  // -------------------------------------------------------------------------

  /**
   * Custom traits - any additional user properties.
   * Use lowercase snake_case for consistency with Segment conventions.
   */
  [key: string]: unknown
}

// ============================================================================
// EVENT CONTEXT
// ============================================================================

/**
 * Contextual information about where and when an event occurred.
 *
 * Context provides additional metadata that describes the environment
 * and circumstances of an analytics event. Many fields are automatically
 * collected by Segment SDKs.
 *
 * @see {@link https://segment.com/docs/connections/spec/common/#context | Segment Context}
 *
 * @example
 * ```typescript
 * const context: EventContext = {
 *   ip: '192.168.1.1',
 *   locale: 'en-US',
 *   timezone: 'America/Los_Angeles',
 *   userAgent: 'Mozilla/5.0...',
 *   page: {
 *     url: 'https://example.com.ai/products',
 *     title: 'Products'
 *   },
 *   campaign: {
 *     source: 'google',
 *     medium: 'cpc'
 *   }
 * }
 * ```
 */
export interface EventContext {
  /** Application information */
  app?: AppContext
  /** Marketing campaign/UTM attribution */
  campaign?: CampaignContext
  /** Device information */
  device?: DeviceContext
  /** IP address (use '0.0.0.0' to prevent geo-lookup) */
  ip?: string
  /** Analytics library information */
  library?: LibraryContext
  /** Locale string (e.g., 'en-US', 'fr-FR') */
  locale?: string
  /** Geographic location */
  location?: LocationContext
  /** Network connectivity information */
  network?: NetworkContext
  /** Operating system information */
  os?: OSContext
  /** Current web page information */
  page?: PageContext
  /** Screen/display information */
  screen?: ScreenContext
  /** IANA timezone (e.g., 'America/Los_Angeles') */
  timezone?: string
  /** Browser/client user agent string */
  userAgent?: string
  /** Group ID for server-side group context */
  groupId?: string
  /** User traits for server-side enrichment */
  traits?: UserTraits
}

// ============================================================================
// PROPERTY OPERATIONS
// ============================================================================

/**
 * Property operations for updating user profiles.
 *
 * These operations allow atomic updates to user properties without
 * full trait replacement. Compatible with Mixpanel-style profile updates.
 *
 * @see {@link https://segment.com/docs/connections/spec/identify/ | Identify Spec}
 * @see {@link https://help.mixpanel.com/hc/en-us/articles/115004708186 | Mixpanel Profile Updates}
 *
 * @example
 * ```typescript
 * const ops: PropertyOperations = {
 *   $set: { lastLogin: new Date().toISOString() },
 *   $setOnce: { firstLogin: new Date().toISOString() },
 *   $add: { loginCount: 1, totalSpent: 99.99 },
 *   $append: { purchasedProducts: 'prod-123' },
 *   $unset: ['temporaryField']
 * }
 * ```
 */
export interface PropertyOperations {
  /**
   * Set properties, overwriting existing values.
   * Use for properties that should always reflect the latest value.
   */
  $set?: Record<string, unknown>

  /**
   * Set properties only if they don't already exist.
   * Useful for capturing "first time" values like firstLogin.
   */
  $setOnce?: Record<string, unknown>

  /**
   * Increment numeric properties by the specified amount.
   * Creates the property with the given value if it doesn't exist.
   */
  $add?: Record<string, number>

  /**
   * Append values to list properties.
   * Creates an empty list if the property doesn't exist.
   */
  $append?: Record<string, unknown>

  /**
   * Prepend values to list properties.
   * Creates an empty list if the property doesn't exist.
   */
  $prepend?: Record<string, unknown>

  /**
   * Remove properties entirely from the profile.
   * Pass property names as an array of strings.
   */
  $unset?: string[]

  /**
   * Remove specific values from list properties.
   * The value to remove is specified as the property value.
   */
  $remove?: Record<string, unknown>
}

// ============================================================================
// BASE ANALYTICS EVENT
// ============================================================================

/**
 * Base analytics event interface.
 *
 * All analytics events share these common fields. Every event must have
 * either an `anonymousId` or `userId` (or both) to identify the user.
 *
 * @see {@link https://segment.com/docs/connections/spec/common/ | Common Fields}
 *
 * @example
 * ```typescript
 * const event: AnalyticsEvent = {
 *   type: 'track',
 *   anonymousId: 'anon-123',
 *   userId: 'user-456',
 *   timestamp: new Date().toISOString(),
 *   context: { ip: '192.168.1.1' },
 *   integrations: { All: true, Mixpanel: false }
 * }
 * ```
 */
export interface AnalyticsEvent {
  /** Event type - determines how the event is processed */
  type: AnalyticsEventType

  /**
   * Anonymous identifier for users before they're identified.
   * Should persist across sessions until the user is identified.
   */
  anonymousId?: string

  /**
   * Unique identifier for identified users.
   * Should be consistent across all platforms.
   */
  userId?: string

  /**
   * ISO 8601 timestamp of when the event occurred.
   * If not provided, the server will use the current time.
   */
  timestamp?: string

  /**
   * Unique identifier for this specific event.
   * Used for deduplication. Auto-generated if not provided.
   */
  messageId?: string

  /** Contextual information about the event environment */
  context?: EventContext

  /**
   * Control which integrations receive this event.
   * Use `All: false` with specific integrations enabled for fine-grained control.
   */
  integrations?: Record<string, boolean>
}

// ============================================================================
// EVENT-SPECIFIC INTERFACES
// ============================================================================

/**
 * Track event - records user actions and behaviors.
 *
 * Track events are the core of analytics, capturing what users do
 * in your application. Use semantic event names following the
 * Object-Action naming convention (e.g., "Product Viewed", "Order Completed").
 *
 * @see {@link https://segment.com/docs/connections/spec/track/ | Track Spec}
 * @see {@link https://segment.com/docs/connections/spec/ecommerce/v2/ | E-commerce Spec}
 *
 * @example
 * ```typescript
 * const event: TrackEvent = {
 *   type: 'track',
 *   event: 'Product Viewed',
 *   anonymousId: 'anon-123',
 *   properties: {
 *     product_id: 'prod-456',
 *     sku: 'SKU-789',
 *     name: 'Running Shoes',
 *     price: 99.99,
 *     category: 'Footwear'
 *   }
 * }
 * ```
 */
export interface TrackEvent extends AnalyticsEvent {
  /** Discriminant for track events */
  type: 'track'

  /**
   * Name of the action being tracked.
   * Use Object-Action format: "Product Viewed", "Order Completed", etc.
   */
  event: string

  /**
   * Properties describing the event.
   * Include relevant details like product info, quantities, values.
   */
  properties?: Record<string, unknown>
}

/**
 * Identify event - associates a user with their traits.
 *
 * Identify events tie a user to their actions and record traits about them.
 * Call identify when a user signs up, logs in, or updates their info.
 *
 * @see {@link https://segment.com/docs/connections/spec/identify/ | Identify Spec}
 *
 * @example
 * ```typescript
 * const event: IdentifyEvent = {
 *   type: 'identify',
 *   userId: 'user-123',
 *   traits: {
 *     email: 'john@example.com.ai',
 *     name: 'John Doe',
 *     plan: 'premium',
 *     company: { name: 'Acme Inc' }
 *   }
 * }
 * ```
 */
export interface IdentifyEvent extends AnalyticsEvent {
  /** Discriminant for identify events */
  type: 'identify'

  /** User ID is required for identify events */
  userId: string

  /** User traits to record */
  traits?: UserTraits
}

/**
 * Page event - records web page views.
 *
 * Page events let you record whenever a user views a page on your website.
 * Most analytics destinations (like Google Analytics) require page calls.
 *
 * @see {@link https://segment.com/docs/connections/spec/page/ | Page Spec}
 *
 * @example
 * ```typescript
 * const event: PageEvent = {
 *   type: 'page',
 *   anonymousId: 'anon-123',
 *   category: 'Docs',
 *   name: 'Getting Started',
 *   properties: {
 *     url: 'https://example.com.ai/docs/getting-started',
 *     title: 'Getting Started Guide'
 *   }
 * }
 * ```
 */
export interface PageEvent extends AnalyticsEvent {
  /** Discriminant for page events */
  type: 'page'

  /** Category of the page (e.g., 'Docs', 'Pricing') */
  category?: string

  /** Name of the page */
  name?: string

  /** Additional page properties */
  properties?: Record<string, unknown>
}

/**
 * Screen event - records mobile screen views.
 *
 * Screen events are the mobile equivalent of page events.
 * Record a screen event whenever a user views a screen in your mobile app.
 *
 * @see {@link https://segment.com/docs/connections/spec/screen/ | Screen Spec}
 *
 * @example
 * ```typescript
 * const event: ScreenEvent = {
 *   type: 'screen',
 *   anonymousId: 'anon-123',
 *   name: 'Home',
 *   properties: {
 *     screenClass: 'HomeViewController'
 *   }
 * }
 * ```
 */
export interface ScreenEvent extends AnalyticsEvent {
  /** Discriminant for screen events */
  type: 'screen'

  /** Name of the screen viewed */
  name?: string

  /** Additional screen properties */
  properties?: Record<string, unknown>
}

/**
 * Group event - associates a user with a group or organization.
 *
 * Group events let you associate a user with a group (company, team,
 * account, etc.) and record traits about that group.
 *
 * @see {@link https://segment.com/docs/connections/spec/group/ | Group Spec}
 *
 * @example
 * ```typescript
 * const event: GroupEvent = {
 *   type: 'group',
 *   userId: 'user-123',
 *   groupId: 'group-456',
 *   traits: {
 *     name: 'Acme Inc',
 *     industry: 'Technology',
 *     employees: 150,
 *     plan: 'enterprise'
 *   }
 * }
 * ```
 */
export interface GroupEvent extends AnalyticsEvent {
  /** Discriminant for group events */
  type: 'group'

  /** Unique identifier for the group */
  groupId: string

  /** Traits describing the group */
  traits?: Record<string, unknown>
}

/**
 * Alias event - merges two user identities.
 *
 * Alias events link two user identities, typically connecting an
 * anonymous user to a known user after identification.
 *
 * Note: Not all destinations support alias. Check destination docs.
 *
 * @see {@link https://segment.com/docs/connections/spec/alias/ | Alias Spec}
 *
 * @example
 * ```typescript
 * const event: AliasEvent = {
 *   type: 'alias',
 *   userId: 'user-123',        // New known ID
 *   previousId: 'anon-456'     // Old anonymous ID
 * }
 * ```
 */
export interface AliasEvent extends AnalyticsEvent {
  /** Discriminant for alias events */
  type: 'alias'

  /** The new user identifier */
  userId: string

  /** The previous user identifier to merge */
  previousId: string
}

// ============================================================================
// TYPE UNION HELPERS
// ============================================================================

/**
 * Union of all specific event types.
 *
 * Use this type when you need to handle any analytics event
 * with full type narrowing support.
 *
 * @example
 * ```typescript
 * function processEvent(event: AnyAnalyticsEvent) {
 *   switch (event.type) {
 *     case 'track':
 *       console.log(event.event) // TypeScript knows event.event exists
 *       break
 *     case 'identify':
 *       console.log(event.traits) // TypeScript knows event.traits exists
 *       break
 *   }
 * }
 * ```
 */
export type AnyAnalyticsEvent =
  | TrackEvent
  | IdentifyEvent
  | PageEvent
  | ScreenEvent
  | GroupEvent
  | AliasEvent

/**
 * Extract event properties type from a TrackEvent.
 * Useful for creating typed property schemas.
 */
export type EventProperties = NonNullable<TrackEvent['properties']>

/**
 * Extract traits type from an IdentifyEvent.
 */
export type IdentifyTraits = NonNullable<IdentifyEvent['traits']>

/**
 * Extract group traits type from a GroupEvent.
 */
export type GroupTraits = NonNullable<GroupEvent['traits']>

// ============================================================================
// OPENFEATURE COMPATIBILITY
// ============================================================================

/**
 * OpenFeature-compatible evaluation context.
 *
 * Maps analytics context to OpenFeature's EvaluationContext for
 * feature flag evaluation based on user and session data.
 *
 * @see {@link https://openfeature.dev/specification/types#evaluation-context | OpenFeature EvaluationContext}
 *
 * @example
 * ```typescript
 * const context: OpenFeatureContext = {
 *   targetingKey: 'user-123',
 *   email: 'john@example.com.ai',
 *   plan: 'premium',
 *   country: 'US'
 * }
 * ```
 */
export interface OpenFeatureContext {
  /**
   * The targeting key - typically the userId or anonymousId.
   * Used as the primary identifier for flag evaluation.
   */
  targetingKey?: string

  /**
   * Additional context attributes for targeting.
   * Can include user traits, session data, or custom attributes.
   */
  [key: string]: unknown
}

/**
 * Convert an analytics event's context to OpenFeature evaluation context.
 *
 * @param event - Analytics event with user and context information
 * @returns OpenFeature-compatible evaluation context
 *
 * @example
 * ```typescript
 * const analyticsEvent: IdentifyEvent = { ... }
 * const featureContext = analyticsToOpenFeature(analyticsEvent)
 * const isEnabled = await client.getBooleanValue('new-feature', false, featureContext)
 * ```
 */
export function analyticsToOpenFeature(event: AnalyticsEvent): OpenFeatureContext {
  return {
    targetingKey: event.userId || event.anonymousId,
    ...(event.context?.traits || {}),
    anonymousId: event.anonymousId,
    userId: event.userId,
    locale: event.context?.locale,
    timezone: event.context?.timezone,
    country: event.context?.location?.country,
    city: event.context?.location?.city,
  }
}

// ============================================================================
// VALIDATORS
// ============================================================================

/** Valid event types array for runtime validation */
const VALID_EVENT_TYPES: AnalyticsEventType[] = ['track', 'identify', 'page', 'screen', 'group', 'alias']

/**
 * Validates that an unknown value is a valid AnalyticsEvent.
 *
 * Checks that the value is an object with a valid type and
 * has at least one of anonymousId or userId.
 *
 * @param event - Value to validate
 * @returns True if the value is a valid AnalyticsEvent
 *
 * @example
 * ```typescript
 * const data = await request.json()
 * if (isValidAnalyticsEvent(data)) {
 *   // TypeScript knows data is AnalyticsEvent
 *   processEvent(data)
 * }
 * ```
 */
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

/**
 * Validates that an unknown value is a valid UserTraits object.
 *
 * @param traits - Value to validate
 * @returns True if the value is a valid UserTraits object
 *
 * @example
 * ```typescript
 * const traits = await parseTraits(input)
 * if (isValidUserTraits(traits)) {
 *   identify(userId, traits)
 * }
 * ```
 */
export function isValidUserTraits(traits: unknown): traits is UserTraits {
  if (traits === null || traits === undefined) {
    return false
  }

  if (typeof traits !== 'object' || Array.isArray(traits)) {
    return false
  }

  return true
}

/**
 * Validates that an unknown value is a valid EventContext object.
 *
 * @param context - Value to validate
 * @returns True if the value is a valid EventContext object
 *
 * @example
 * ```typescript
 * const context = buildContext(request)
 * if (isValidEventContext(context)) {
 *   event.context = context
 * }
 * ```
 */
export function isValidEventContext(context: unknown): context is EventContext {
  if (context === null || context === undefined) {
    return false
  }

  if (typeof context !== 'object' || Array.isArray(context)) {
    return false
  }

  return true
}

// ============================================================================
// EVENT TYPE GUARDS
// ============================================================================

/**
 * Type guard for TrackEvent.
 *
 * @param event - Analytics event to check
 * @returns True if the event is a TrackEvent
 *
 * @example
 * ```typescript
 * if (isTrackEvent(event)) {
 *   console.log(`Tracked: ${event.event}`)
 *   console.log(`Properties: ${JSON.stringify(event.properties)}`)
 * }
 * ```
 */
export function isTrackEvent(event: AnalyticsEvent): event is TrackEvent {
  return event.type === 'track'
}

/**
 * Type guard for IdentifyEvent.
 *
 * @param event - Analytics event to check
 * @returns True if the event is an IdentifyEvent
 *
 * @example
 * ```typescript
 * if (isIdentifyEvent(event)) {
 *   console.log(`Identified: ${event.userId}`)
 *   console.log(`Traits: ${JSON.stringify(event.traits)}`)
 * }
 * ```
 */
export function isIdentifyEvent(event: AnalyticsEvent): event is IdentifyEvent {
  return event.type === 'identify'
}

/**
 * Type guard for PageEvent.
 *
 * @param event - Analytics event to check
 * @returns True if the event is a PageEvent
 *
 * @example
 * ```typescript
 * if (isPageEvent(event)) {
 *   console.log(`Page viewed: ${event.name}`)
 * }
 * ```
 */
export function isPageEvent(event: AnalyticsEvent): event is PageEvent {
  return event.type === 'page'
}

/**
 * Type guard for ScreenEvent.
 *
 * @param event - Analytics event to check
 * @returns True if the event is a ScreenEvent
 *
 * @example
 * ```typescript
 * if (isScreenEvent(event)) {
 *   console.log(`Screen viewed: ${event.name}`)
 * }
 * ```
 */
export function isScreenEvent(event: AnalyticsEvent): event is ScreenEvent {
  return event.type === 'screen'
}

/**
 * Type guard for GroupEvent.
 *
 * @param event - Analytics event to check
 * @returns True if the event is a GroupEvent
 *
 * @example
 * ```typescript
 * if (isGroupEvent(event)) {
 *   console.log(`User joined group: ${event.groupId}`)
 * }
 * ```
 */
export function isGroupEvent(event: AnalyticsEvent): event is GroupEvent {
  return event.type === 'group'
}

/**
 * Type guard for AliasEvent.
 *
 * @param event - Analytics event to check
 * @returns True if the event is an AliasEvent
 *
 * @example
 * ```typescript
 * if (isAliasEvent(event)) {
 *   console.log(`Aliased ${event.previousId} -> ${event.userId}`)
 * }
 * ```
 */
export function isAliasEvent(event: AnalyticsEvent): event is AliasEvent {
  return event.type === 'alias'
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Base options for creating analytics events.
 * Requires either anonymousId or userId.
 */
export interface EventBaseOptions {
  /** Anonymous identifier */
  anonymousId?: string
  /** User identifier */
  userId?: string
  /** Event context */
  context?: EventContext
  /** Timestamp (ISO 8601) */
  timestamp?: string
  /** Message ID for deduplication */
  messageId?: string
  /** Integration settings */
  integrations?: Record<string, boolean>
}

/**
 * Creates a track event with type safety.
 *
 * @param eventName - Name of the event (Object-Action format recommended)
 * @param properties - Event properties
 * @param options - Base event options (must include anonymousId or userId)
 * @returns A properly typed TrackEvent
 *
 * @example
 * ```typescript
 * const event = createTrackEvent(
 *   'Product Viewed',
 *   { product_id: 'prod-123', price: 99.99 },
 *   { anonymousId: 'anon-456' }
 * )
 * ```
 */
export function createTrackEvent(
  eventName: string,
  properties?: Record<string, unknown>,
  options: EventBaseOptions = {}
): TrackEvent {
  return {
    type: 'track',
    event: eventName,
    properties,
    ...options,
  }
}

/**
 * Creates an identify event with type safety.
 *
 * @param userId - User identifier
 * @param traits - User traits
 * @param options - Additional event options
 * @returns A properly typed IdentifyEvent
 *
 * @example
 * ```typescript
 * const event = createIdentifyEvent(
 *   'user-123',
 *   { email: 'john@example.com.ai', name: 'John' },
 *   { context: { ip: '192.168.1.1' } }
 * )
 * ```
 */
export function createIdentifyEvent(
  userId: string,
  traits?: UserTraits,
  options: Omit<EventBaseOptions, 'userId'> = {}
): IdentifyEvent {
  return {
    type: 'identify',
    userId,
    traits,
    ...options,
  }
}

/**
 * Creates a page event with type safety.
 *
 * @param name - Page name
 * @param category - Page category
 * @param properties - Additional page properties
 * @param options - Base event options
 * @returns A properly typed PageEvent
 *
 * @example
 * ```typescript
 * const event = createPageEvent(
 *   'Getting Started',
 *   'Docs',
 *   { url: 'https://example.com.ai/docs/getting-started' },
 *   { anonymousId: 'anon-123' }
 * )
 * ```
 */
export function createPageEvent(
  name?: string,
  category?: string,
  properties?: Record<string, unknown>,
  options: EventBaseOptions = {}
): PageEvent {
  return {
    type: 'page',
    name,
    category,
    properties,
    ...options,
  }
}

/**
 * Creates a screen event with type safety.
 *
 * @param name - Screen name
 * @param properties - Additional screen properties
 * @param options - Base event options
 * @returns A properly typed ScreenEvent
 *
 * @example
 * ```typescript
 * const event = createScreenEvent(
 *   'Home',
 *   { screenClass: 'HomeViewController' },
 *   { anonymousId: 'anon-123' }
 * )
 * ```
 */
export function createScreenEvent(
  name?: string,
  properties?: Record<string, unknown>,
  options: EventBaseOptions = {}
): ScreenEvent {
  return {
    type: 'screen',
    name,
    properties,
    ...options,
  }
}

/**
 * Creates a group event with type safety.
 *
 * @param groupId - Group identifier
 * @param traits - Group traits
 * @param options - Base event options
 * @returns A properly typed GroupEvent
 *
 * @example
 * ```typescript
 * const event = createGroupEvent(
 *   'group-123',
 *   { name: 'Acme Inc', plan: 'enterprise' },
 *   { userId: 'user-456' }
 * )
 * ```
 */
export function createGroupEvent(
  groupId: string,
  traits?: Record<string, unknown>,
  options: EventBaseOptions = {}
): GroupEvent {
  return {
    type: 'group',
    groupId,
    traits,
    ...options,
  }
}

/**
 * Creates an alias event with type safety.
 *
 * @param userId - New user identifier
 * @param previousId - Previous identifier to alias
 * @param options - Additional event options
 * @returns A properly typed AliasEvent
 *
 * @example
 * ```typescript
 * const event = createAliasEvent(
 *   'user-123',
 *   'anon-456',
 *   { context: { ip: '192.168.1.1' } }
 * )
 * ```
 */
export function createAliasEvent(
  userId: string,
  previousId: string,
  options: Omit<EventBaseOptions, 'userId'> = {}
): AliasEvent {
  return {
    type: 'alias',
    userId,
    previousId,
    ...options,
  }
}
