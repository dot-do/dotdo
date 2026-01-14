/**
 * @dotdo/segment - Destination Management
 *
 * Provides destination management for analytics events:
 * - Destination registration and lifecycle
 * - Event routing based on integrations settings
 * - Built-in destinations (console, webhook, buffer)
 * - Destination middleware support
 *
 * @module @dotdo/segment/destinations
 */

import type {
  Destination,
  SegmentEvent,
  Integrations,
  DestinationMiddleware,
} from './types.js'

// =============================================================================
// Destination Manager
// =============================================================================

/**
 * Options for destination manager.
 */
export interface DestinationManagerOptions {
  /** Default integrations settings */
  defaultIntegrations?: Integrations
  /** Whether to run destinations in parallel (default: true) */
  parallel?: boolean
  /** Error handler for destination errors */
  onError?: (error: Error, destination: Destination, event: SegmentEvent) => void
}

/**
 * Manages destinations and event routing.
 */
export class DestinationManager {
  private destinations: Map<string, Destination> = new Map()
  private middlewares: DestinationMiddleware[] = []
  private readonly options: DestinationManagerOptions

  constructor(options?: DestinationManagerOptions) {
    this.options = {
      parallel: true,
      ...options,
    }
  }

  /**
   * Register a destination.
   */
  register(destination: Destination): void {
    if (this.destinations.has(destination.name)) {
      throw new Error(`Destination "${destination.name}" is already registered`)
    }
    this.destinations.set(destination.name, destination)
    if (destination.load) {
      destination.load()
    }
  }

  /**
   * Unregister a destination.
   */
  unregister(name: string): boolean {
    const destination = this.destinations.get(name)
    if (destination) {
      if (destination.unload) {
        destination.unload()
      }
      this.destinations.delete(name)
      return true
    }
    return false
  }

  /**
   * Get a destination by name.
   */
  get(name: string): Destination | undefined {
    return this.destinations.get(name)
  }

  /**
   * Get all registered destinations.
   */
  getAll(): Destination[] {
    return Array.from(this.destinations.values())
  }

  /**
   * Get destination names.
   */
  getNames(): string[] {
    return Array.from(this.destinations.keys())
  }

  /**
   * Check if a destination is registered.
   */
  has(name: string): boolean {
    return this.destinations.has(name)
  }

  /**
   * Add a destination middleware.
   */
  addMiddleware(middleware: DestinationMiddleware): void {
    this.middlewares.push(middleware)
  }

  /**
   * Check if a destination is enabled for an event.
   */
  isEnabled(event: SegmentEvent, destination: Destination): boolean {
    const integrations = {
      ...this.options.defaultIntegrations,
      ...event.integrations,
    }

    // Check specific destination setting
    const destinationSetting = integrations[destination.name]
    if (destinationSetting === false) {
      return false
    }

    // Check "All" setting
    if (integrations.All === false && destinationSetting !== true) {
      return false
    }

    return true
  }

  /**
   * Get enabled destinations for an event.
   */
  getEnabledDestinations(event: SegmentEvent): Destination[] {
    return this.getAll().filter(dest => this.isEnabled(event, dest))
  }

  /**
   * Apply middlewares to an event for a destination.
   */
  private applyMiddlewares(event: SegmentEvent, destination: Destination): SegmentEvent | null {
    let result: SegmentEvent | null = event

    for (const middleware of this.middlewares) {
      if (result === null) break
      result = middleware(result, destination)
    }

    return result
  }

  /**
   * Forward an event to a specific destination.
   */
  async forwardToDestination(event: SegmentEvent, destination: Destination): Promise<void> {
    if (!this.isEnabled(event, destination)) {
      return
    }

    // Apply middlewares
    const processedEvent = this.applyMiddlewares(event, destination)
    if (processedEvent === null) {
      return // Event filtered by middleware
    }

    try {
      switch (event.type) {
        case 'track':
          await destination.track(processedEvent)
          break
        case 'identify':
          await destination.identify(processedEvent)
          break
        case 'page':
          await destination.page(processedEvent)
          break
        case 'screen':
          await destination.screen(processedEvent)
          break
        case 'group':
          await destination.group(processedEvent)
          break
        case 'alias':
          await destination.alias(processedEvent)
          break
      }
    } catch (error) {
      if (this.options.onError) {
        this.options.onError(error as Error, destination, event)
      } else {
        throw error
      }
    }
  }

  /**
   * Forward an event to all enabled destinations.
   */
  async forward(event: SegmentEvent): Promise<void> {
    const enabledDestinations = this.getEnabledDestinations(event)

    if (this.options.parallel) {
      await Promise.all(
        enabledDestinations.map(dest => this.forwardToDestination(event, dest))
      )
    } else {
      for (const dest of enabledDestinations) {
        await this.forwardToDestination(event, dest)
      }
    }
  }

  /**
   * Forward multiple events to all enabled destinations.
   */
  async forwardBatch(events: SegmentEvent[]): Promise<void> {
    if (this.options.parallel) {
      await Promise.all(events.map(event => this.forward(event)))
    } else {
      for (const event of events) {
        await this.forward(event)
      }
    }
  }

  /**
   * Close all destinations.
   */
  async close(): Promise<void> {
    for (const destination of Array.from(this.destinations.values())) {
      if (destination.unload) {
        await destination.unload()
      }
    }
    this.destinations.clear()
  }
}

// =============================================================================
// Built-in Destinations
// =============================================================================

/**
 * Console destination for debugging.
 */
export class ConsoleDestination implements Destination {
  readonly name = 'Console'
  private prefix: string

  constructor(options?: { prefix?: string }) {
    this.prefix = options?.prefix ?? '[Segment]'
  }

  track(event: SegmentEvent): void {
    console.log(`${this.prefix} track:`, event.event, event.properties)
  }

  identify(event: SegmentEvent): void {
    console.log(`${this.prefix} identify:`, event.userId || event.anonymousId, event.traits)
  }

  page(event: SegmentEvent): void {
    console.log(`${this.prefix} page:`, event.name, event.properties)
  }

  screen(event: SegmentEvent): void {
    console.log(`${this.prefix} screen:`, event.name, event.properties)
  }

  group(event: SegmentEvent): void {
    console.log(`${this.prefix} group:`, event.groupId, event.traits)
  }

  alias(event: SegmentEvent): void {
    console.log(`${this.prefix} alias:`, event.previousId, '->', event.userId)
  }
}

/**
 * Webhook destination for HTTP forwarding.
 */
export class WebhookDestination implements Destination {
  readonly name: string
  private readonly url: string
  private readonly headers: Record<string, string>
  private readonly method: 'POST' | 'PUT'

  constructor(options: {
    name?: string
    url: string
    headers?: Record<string, string>
    method?: 'POST' | 'PUT'
  }) {
    this.name = options.name ?? 'Webhook'
    this.url = options.url
    this.headers = options.headers ?? {}
    this.method = options.method ?? 'POST'
  }

  private async send(event: SegmentEvent): Promise<void> {
    await fetch(this.url, {
      method: this.method,
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify(event),
    })
  }

  track(event: SegmentEvent): Promise<void> {
    return this.send(event)
  }

  identify(event: SegmentEvent): Promise<void> {
    return this.send(event)
  }

  page(event: SegmentEvent): Promise<void> {
    return this.send(event)
  }

  screen(event: SegmentEvent): Promise<void> {
    return this.send(event)
  }

  group(event: SegmentEvent): Promise<void> {
    return this.send(event)
  }

  alias(event: SegmentEvent): Promise<void> {
    return this.send(event)
  }
}

/**
 * Buffer destination for collecting events in memory.
 */
export class BufferDestination implements Destination {
  readonly name: string
  private readonly maxSize: number
  private events: SegmentEvent[] = []

  constructor(options?: { name?: string; maxSize?: number }) {
    this.name = options?.name ?? 'Buffer'
    this.maxSize = options?.maxSize ?? 1000
  }

  private add(event: SegmentEvent): void {
    this.events.push(event)
    if (this.events.length > this.maxSize) {
      this.events.shift()
    }
  }

  track(event: SegmentEvent): void {
    this.add(event)
  }

  identify(event: SegmentEvent): void {
    this.add(event)
  }

  page(event: SegmentEvent): void {
    this.add(event)
  }

  screen(event: SegmentEvent): void {
    this.add(event)
  }

  group(event: SegmentEvent): void {
    this.add(event)
  }

  alias(event: SegmentEvent): void {
    this.add(event)
  }

  /**
   * Get all buffered events.
   */
  getEvents(): SegmentEvent[] {
    return [...this.events]
  }

  /**
   * Get events filtered by type.
   */
  getEventsByType(type: SegmentEvent['type']): SegmentEvent[] {
    return this.events.filter(e => e.type === type)
  }

  /**
   * Get events for a specific user.
   */
  getEventsForUser(userId: string): SegmentEvent[] {
    return this.events.filter(e => e.userId === userId || e.anonymousId === userId)
  }

  /**
   * Clear all buffered events.
   */
  clear(): void {
    this.events = []
  }

  /**
   * Get the number of buffered events.
   */
  get size(): number {
    return this.events.length
  }
}

/**
 * Callback destination for custom handling.
 */
export class CallbackDestination implements Destination {
  readonly name: string
  private readonly callbacks: {
    track?: (event: SegmentEvent) => void | Promise<void>
    identify?: (event: SegmentEvent) => void | Promise<void>
    page?: (event: SegmentEvent) => void | Promise<void>
    screen?: (event: SegmentEvent) => void | Promise<void>
    group?: (event: SegmentEvent) => void | Promise<void>
    alias?: (event: SegmentEvent) => void | Promise<void>
  }

  constructor(options: {
    name?: string
    track?: (event: SegmentEvent) => void | Promise<void>
    identify?: (event: SegmentEvent) => void | Promise<void>
    page?: (event: SegmentEvent) => void | Promise<void>
    screen?: (event: SegmentEvent) => void | Promise<void>
    group?: (event: SegmentEvent) => void | Promise<void>
    alias?: (event: SegmentEvent) => void | Promise<void>
  }) {
    this.name = options.name ?? 'Callback'
    this.callbacks = options
  }

  async track(event: SegmentEvent): Promise<void> {
    if (this.callbacks.track) {
      await this.callbacks.track(event)
    }
  }

  async identify(event: SegmentEvent): Promise<void> {
    if (this.callbacks.identify) {
      await this.callbacks.identify(event)
    }
  }

  async page(event: SegmentEvent): Promise<void> {
    if (this.callbacks.page) {
      await this.callbacks.page(event)
    }
  }

  async screen(event: SegmentEvent): Promise<void> {
    if (this.callbacks.screen) {
      await this.callbacks.screen(event)
    }
  }

  async group(event: SegmentEvent): Promise<void> {
    if (this.callbacks.group) {
      await this.callbacks.group(event)
    }
  }

  async alias(event: SegmentEvent): Promise<void> {
    if (this.callbacks.alias) {
      await this.callbacks.alias(event)
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a destination manager.
 */
export function createDestinationManager(options?: DestinationManagerOptions): DestinationManager {
  return new DestinationManager(options)
}

/**
 * Create a console destination.
 */
export function createConsoleDestination(options?: { prefix?: string }): ConsoleDestination {
  return new ConsoleDestination(options)
}

/**
 * Create a webhook destination.
 */
export function createWebhookDestination(options: {
  name?: string
  url: string
  headers?: Record<string, string>
  method?: 'POST' | 'PUT'
}): WebhookDestination {
  return new WebhookDestination(options)
}

/**
 * Create a buffer destination.
 */
export function createBufferDestination(options?: { name?: string; maxSize?: number }): BufferDestination {
  return new BufferDestination(options)
}

/**
 * Create a callback destination.
 */
export function createCallbackDestination(options: {
  name?: string
  track?: (event: SegmentEvent) => void | Promise<void>
  identify?: (event: SegmentEvent) => void | Promise<void>
  page?: (event: SegmentEvent) => void | Promise<void>
  screen?: (event: SegmentEvent) => void | Promise<void>
  group?: (event: SegmentEvent) => void | Promise<void>
  alias?: (event: SegmentEvent) => void | Promise<void>
}): CallbackDestination {
  return new CallbackDestination(options)
}

// =============================================================================
// Destination Middleware Helpers
// =============================================================================

/**
 * Create a middleware that filters events for specific destinations.
 */
export function createDestinationFilter(
  predicate: (event: SegmentEvent, destination: Destination) => boolean
): DestinationMiddleware {
  return (event, destination) => {
    return predicate(event, destination) ? event : null
  }
}

/**
 * Create a middleware that enriches events for specific destinations.
 */
export function createDestinationEnricher(
  enricher: (event: SegmentEvent, destination: Destination) => SegmentEvent
): DestinationMiddleware {
  return (event, destination) => {
    return enricher(event, destination)
  }
}

/**
 * Create a middleware that only applies to specific destination names.
 */
export function forDestinations(
  destinationNames: string[],
  middleware: DestinationMiddleware
): DestinationMiddleware {
  const nameSet = new Set(destinationNames)
  return (event, destination) => {
    if (nameSet.has(destination.name)) {
      return middleware(event, destination)
    }
    return event
  }
}
