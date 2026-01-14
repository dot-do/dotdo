/**
 * @dotdo/segment - Event Tracking
 *
 * Event tracking methods: track, identify, page, screen, group, alias.
 * Provides both standalone functions and a Tracker class.
 *
 * @module @dotdo/segment/track
 */

import type {
  IdentifyMessage,
  TrackMessage,
  PageMessage,
  ScreenMessage,
  GroupMessage,
  AliasMessage,
  BatchMessage,
  SegmentEvent,
  EventType,
  Context,
  Integrations,
  Callback,
  SourceMiddleware,
} from './types.js'
import {
  generateMessageId,
  getTimestamp,
  buildLibraryContext,
  deepMerge,
} from './client.js'

// =============================================================================
// Event Builder
// =============================================================================

/**
 * Options for building events.
 */
export interface EventBuilderOptions {
  /** Default integrations to merge */
  defaultIntegrations?: Integrations
  /** Global context to merge */
  globalContext?: Partial<Context>
  /** Source middlewares to apply */
  middlewares?: SourceMiddleware[]
}

/**
 * Build a segment event from a message.
 */
export function buildEvent(
  type: EventType,
  message: {
    userId?: string
    anonymousId?: string
    timestamp?: string | Date
    context?: Context
    integrations?: Integrations
  },
  extra: Partial<SegmentEvent>,
  options?: EventBuilderOptions
): SegmentEvent {
  // Build base context
  let context = buildLibraryContext()

  // Merge global context
  if (options?.globalContext && Object.keys(options.globalContext).length > 0) {
    context = deepMerge(context, options.globalContext)
  }

  // Merge message context
  if (message.context) {
    context = deepMerge(context, message.context)
  }

  // Build integrations
  const integrations = {
    ...options?.defaultIntegrations,
    ...message.integrations,
  }

  // Build timestamp
  const timestamp =
    message.timestamp instanceof Date
      ? message.timestamp.toISOString()
      : message.timestamp || getTimestamp()

  // Build the event
  let event: SegmentEvent = {
    type,
    messageId: generateMessageId(),
    timestamp,
    userId: message.userId,
    anonymousId: message.anonymousId,
    context,
    integrations,
    ...extra,
  }

  // Apply source middlewares
  if (options?.middlewares) {
    for (const middleware of options.middlewares) {
      const result = middleware(event)
      if (result === null) {
        // Event dropped by middleware
        return { ...event, _dropped: true } as SegmentEvent
      }
      event = result
    }
  }

  return event
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate that message has userId or anonymousId.
 */
export function validateIdentity(message: { userId?: string; anonymousId?: string }): void {
  if (!message.userId && !message.anonymousId) {
    throw new Error('Either userId or anonymousId is required')
  }
}

/**
 * Validate track message.
 */
export function validateTrackMessage(message: TrackMessage): void {
  validateIdentity(message)
  if (!message.event || message.event.trim() === '') {
    throw new Error('Event name is required for track calls')
  }
}

/**
 * Validate group message.
 */
export function validateGroupMessage(message: GroupMessage): void {
  validateIdentity(message)
  if (!message.groupId || message.groupId.trim() === '') {
    throw new Error('groupId is required for group calls')
  }
}

/**
 * Validate alias message.
 */
export function validateAliasMessage(message: AliasMessage): void {
  if (!message.previousId || message.previousId.trim() === '') {
    throw new Error('previousId is required for alias calls')
  }
}

// =============================================================================
// Tracker Class
// =============================================================================

/**
 * Event enqueue function type.
 */
export type EnqueueFn = (event: SegmentEvent, callback?: Callback) => void

/**
 * Tracker provides event tracking methods.
 */
export class Tracker {
  private readonly enqueue: EnqueueFn
  private readonly options: EventBuilderOptions

  constructor(enqueue: EnqueueFn, options?: EventBuilderOptions) {
    this.enqueue = enqueue
    this.options = options || {}
  }

  /**
   * Update options (e.g., to add middlewares).
   */
  updateOptions(updates: Partial<EventBuilderOptions>): void {
    Object.assign(this.options, updates)
  }

  /**
   * Set global context.
   */
  setGlobalContext(context: Partial<Context>): void {
    this.options.globalContext = context
  }

  /**
   * Add a source middleware.
   */
  addMiddleware(middleware: SourceMiddleware): void {
    if (!this.options.middlewares) {
      this.options.middlewares = []
    }
    this.options.middlewares.push(middleware)
  }

  /**
   * Identify a user.
   */
  identify(message: IdentifyMessage, callback?: Callback): void {
    validateIdentity(message)

    const event = buildEvent('identify', message, {
      traits: message.traits,
    }, this.options)

    this.enqueue(event, callback)
  }

  /**
   * Track an event.
   */
  track(message: TrackMessage, callback?: Callback): void {
    validateTrackMessage(message)

    const event = buildEvent('track', message, {
      event: message.event,
      properties: message.properties,
    }, this.options)

    this.enqueue(event, callback)
  }

  /**
   * Track a page view.
   */
  page(message: PageMessage, callback?: Callback): void {
    validateIdentity(message)

    const event = buildEvent('page', message, {
      name: message.name,
      category: message.category,
      properties: message.properties,
    }, this.options)

    this.enqueue(event, callback)
  }

  /**
   * Track a screen view (mobile).
   */
  screen(message: ScreenMessage, callback?: Callback): void {
    validateIdentity(message)

    const event = buildEvent('screen', message, {
      name: message.name,
      category: message.category,
      properties: message.properties,
    }, this.options)

    this.enqueue(event, callback)
  }

  /**
   * Associate user with a group.
   */
  group(message: GroupMessage, callback?: Callback): void {
    validateGroupMessage(message)

    const event = buildEvent('group', message, {
      groupId: message.groupId,
      traits: message.traits,
    }, this.options)

    this.enqueue(event, callback)
  }

  /**
   * Alias user IDs.
   */
  alias(message: AliasMessage, callback?: Callback): void {
    validateAliasMessage(message)

    const event = buildEvent('alias', message, {
      userId: message.userId,
      previousId: message.previousId,
    }, this.options)

    this.enqueue(event, callback)
  }

  /**
   * Batch multiple events.
   */
  batch(message: BatchMessage, callback?: Callback): SegmentEvent[] {
    const events: SegmentEvent[] = []

    for (const item of message.batch) {
      const type = item.type || 'track'
      const enriched = buildEvent(type, item, item, this.options)
      events.push(enriched)
      this.enqueue(enriched)
    }

    if (callback) {
      // Callback will be invoked on flush
      callback()
    }

    return events
  }
}

// =============================================================================
// Standalone Functions
// =============================================================================

/**
 * Create an identify event.
 */
export function createIdentifyEvent(
  message: IdentifyMessage,
  options?: EventBuilderOptions
): SegmentEvent {
  validateIdentity(message)
  return buildEvent('identify', message, { traits: message.traits }, options)
}

/**
 * Create a track event.
 */
export function createTrackEvent(
  message: TrackMessage,
  options?: EventBuilderOptions
): SegmentEvent {
  validateTrackMessage(message)
  return buildEvent('track', message, {
    event: message.event,
    properties: message.properties,
  }, options)
}

/**
 * Create a page event.
 */
export function createPageEvent(
  message: PageMessage,
  options?: EventBuilderOptions
): SegmentEvent {
  validateIdentity(message)
  return buildEvent('page', message, {
    name: message.name,
    category: message.category,
    properties: message.properties,
  }, options)
}

/**
 * Create a screen event.
 */
export function createScreenEvent(
  message: ScreenMessage,
  options?: EventBuilderOptions
): SegmentEvent {
  validateIdentity(message)
  return buildEvent('screen', message, {
    name: message.name,
    category: message.category,
    properties: message.properties,
  }, options)
}

/**
 * Create a group event.
 */
export function createGroupEvent(
  message: GroupMessage,
  options?: EventBuilderOptions
): SegmentEvent {
  validateGroupMessage(message)
  return buildEvent('group', message, {
    groupId: message.groupId,
    traits: message.traits,
  }, options)
}

/**
 * Create an alias event.
 */
export function createAliasEvent(
  message: AliasMessage,
  options?: EventBuilderOptions
): SegmentEvent {
  validateAliasMessage(message)
  return buildEvent('alias', message, {
    userId: message.userId,
    previousId: message.previousId,
  }, options)
}

// =============================================================================
// Event Type Guards
// =============================================================================

/**
 * Check if event is an identify event.
 */
export function isIdentifyEvent(event: SegmentEvent): boolean {
  return event.type === 'identify'
}

/**
 * Check if event is a track event.
 */
export function isTrackEvent(event: SegmentEvent): boolean {
  return event.type === 'track'
}

/**
 * Check if event is a page event.
 */
export function isPageEvent(event: SegmentEvent): boolean {
  return event.type === 'page'
}

/**
 * Check if event is a screen event.
 */
export function isScreenEvent(event: SegmentEvent): boolean {
  return event.type === 'screen'
}

/**
 * Check if event is a group event.
 */
export function isGroupEvent(event: SegmentEvent): boolean {
  return event.type === 'group'
}

/**
 * Check if event is an alias event.
 */
export function isAliasEvent(event: SegmentEvent): boolean {
  return event.type === 'alias'
}
