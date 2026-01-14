/**
 * @dotdo/segment - Type Definitions
 *
 * Types for the Segment SDK compatibility layer.
 * Based on @segment/analytics-node interface.
 *
 * @module @dotdo/segment/types
 */

// =============================================================================
// Core Types
// =============================================================================

/**
 * User traits for identify calls.
 */
export interface Traits {
  [key: string]: unknown
  name?: string
  email?: string
  phone?: string
  address?: Address
  avatar?: string
  birthday?: string
  company?: Company
  createdAt?: string | Date
  description?: string
  firstName?: string
  lastName?: string
  gender?: string
  id?: string
  title?: string
  username?: string
  website?: string
  age?: number
  plan?: string
}

/**
 * Address for traits.
 */
export interface Address {
  city?: string
  country?: string
  postalCode?: string
  state?: string
  street?: string
}

/**
 * Company info for traits.
 */
export interface Company {
  id?: string
  name?: string
  industry?: string
  employees?: number
  plan?: string
}

/**
 * Properties for track/page/screen events.
 */
export interface Properties {
  [key: string]: unknown
}

/**
 * Integrations settings.
 */
export interface Integrations {
  [key: string]: boolean | Record<string, unknown>
  All?: boolean
}

/**
 * Context object for enriching events.
 */
export interface Context {
  [key: string]: unknown
  active?: boolean
  app?: {
    name?: string
    version?: string
    build?: string
    namespace?: string
  }
  campaign?: {
    name?: string
    source?: string
    medium?: string
    term?: string
    content?: string
  }
  device?: {
    id?: string
    advertisingId?: string
    adTrackingEnabled?: boolean
    manufacturer?: string
    model?: string
    name?: string
    type?: string
    token?: string
  }
  ip?: string
  library?: {
    name: string
    version: string
  }
  locale?: string
  location?: {
    city?: string
    country?: string
    latitude?: number
    longitude?: number
    region?: string
    speed?: number
  }
  network?: {
    bluetooth?: boolean
    carrier?: string
    cellular?: boolean
    wifi?: boolean
  }
  os?: {
    name?: string
    version?: string
  }
  page?: {
    path?: string
    referrer?: string
    search?: string
    title?: string
    url?: string
  }
  referrer?: {
    id?: string
    type?: string
  }
  screen?: {
    width?: number
    height?: number
    density?: number
  }
  timezone?: string
  groupId?: string
  traits?: Traits
  userAgent?: string
  channel?: string
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Base message fields common to all events.
 */
export interface BaseMessage {
  messageId?: string
  timestamp?: string | Date
  context?: Context
  integrations?: Integrations
}

/**
 * Identify message.
 */
export interface IdentifyMessage extends BaseMessage {
  userId?: string
  anonymousId?: string
  traits?: Traits
}

/**
 * Track message.
 */
export interface TrackMessage extends BaseMessage {
  userId?: string
  anonymousId?: string
  event: string
  properties?: Properties
}

/**
 * Page message.
 */
export interface PageMessage extends BaseMessage {
  userId?: string
  anonymousId?: string
  name?: string
  category?: string
  properties?: Properties
}

/**
 * Screen message.
 */
export interface ScreenMessage extends BaseMessage {
  userId?: string
  anonymousId?: string
  name?: string
  category?: string
  properties?: Properties
}

/**
 * Group message.
 */
export interface GroupMessage extends BaseMessage {
  userId?: string
  anonymousId?: string
  groupId: string
  traits?: Traits
}

/**
 * Alias message.
 */
export interface AliasMessage extends BaseMessage {
  userId: string
  previousId: string
}

/**
 * Union of all message types.
 */
export type Message =
  | IdentifyMessage
  | TrackMessage
  | PageMessage
  | ScreenMessage
  | GroupMessage
  | AliasMessage

/**
 * Event type discriminator.
 */
export type EventType = 'identify' | 'track' | 'page' | 'screen' | 'group' | 'alias'

/**
 * Complete segment event with type discriminator.
 */
export interface SegmentEvent {
  type: EventType
  messageId: string
  timestamp: string
  userId?: string
  anonymousId?: string
  event?: string
  name?: string
  category?: string
  previousId?: string
  groupId?: string
  traits?: Traits
  properties?: Properties
  context?: Context
  integrations?: Integrations
}

// =============================================================================
// Batch Types
// =============================================================================

/**
 * Batch message for bulk API.
 */
export interface BatchMessage {
  batch: Array<Partial<SegmentEvent>>
  context?: Context
  integrations?: Integrations
}

/**
 * Batch payload sent to API.
 */
export interface BatchPayload {
  batch: SegmentEvent[]
  sentAt: string
  writeKey?: string
}

// =============================================================================
// Transport Types
// =============================================================================

/**
 * Transport result.
 */
export interface TransportResult {
  statusCode: number
  headers?: Record<string, string>
}

/**
 * Transport interface.
 */
export interface Transport {
  send(payload: BatchPayload): Promise<TransportResult>
  flush(timeout?: number): Promise<boolean>
  getEvents(): SegmentEvent[]
  getBatches(): BatchPayload[]
}

/**
 * Transport factory.
 */
export type TransportFactory = (options: { writeKey: string }) => Transport

// =============================================================================
// Destination Types
// =============================================================================

/**
 * Destination interface for event forwarding.
 */
export interface Destination {
  name: string
  track(event: SegmentEvent): void | Promise<void>
  identify(event: SegmentEvent): void | Promise<void>
  page(event: SegmentEvent): void | Promise<void>
  screen(event: SegmentEvent): void | Promise<void>
  group(event: SegmentEvent): void | Promise<void>
  alias(event: SegmentEvent): void | Promise<void>
  load?(): void | Promise<void>
  unload?(): void | Promise<void>
}

// =============================================================================
// Plugin Types
// =============================================================================

/**
 * Plugin type.
 */
export type PluginType = 'before' | 'enrichment' | 'destination' | 'after'

/**
 * Plugin interface.
 */
export interface Plugin {
  name: string
  type: PluginType
  load(analytics: unknown): void | Promise<void>
  unload?(): void | Promise<void>
  isLoaded(): boolean
  track?(event: SegmentEvent): SegmentEvent | null | Promise<SegmentEvent | null>
  identify?(event: SegmentEvent): SegmentEvent | null | Promise<SegmentEvent | null>
  page?(event: SegmentEvent): SegmentEvent | null | Promise<SegmentEvent | null>
  screen?(event: SegmentEvent): SegmentEvent | null | Promise<SegmentEvent | null>
  group?(event: SegmentEvent): SegmentEvent | null | Promise<SegmentEvent | null>
  alias?(event: SegmentEvent): SegmentEvent | null | Promise<SegmentEvent | null>
}

// =============================================================================
// Middleware Types
// =============================================================================

/**
 * Source middleware function.
 */
export type SourceMiddleware = (event: SegmentEvent) => SegmentEvent | null

/**
 * Destination middleware function.
 */
export type DestinationMiddleware = (
  event: SegmentEvent,
  destination: Destination
) => SegmentEvent | null

// =============================================================================
// Options Types
// =============================================================================

/**
 * Analytics options.
 */
export interface AnalyticsOptions {
  writeKey: string
  host?: string
  path?: string
  flushAt?: number
  flushInterval?: number
  maxEventsInBatch?: number
  maxRetries?: number
  transport?: TransportFactory
  integrations?: Integrations
  plugins?: Plugin[]
  errorHandler?: (error: Error) => void
  disable?: boolean
}

/**
 * Callback type for async operations.
 */
export type Callback = (error?: Error) => void
