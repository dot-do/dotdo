/**
 * @dotdo/segment - Source Definitions
 *
 * Segment Source compatibility layer providing:
 * - Source configuration and management
 * - Write key validation
 * - Source-specific transformations
 * - Source metadata and settings
 *
 * @module @dotdo/segment/sources
 */

import type { SegmentEvent, Context, Traits, Properties } from './types.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Source types
 */
export type SourceType =
  | 'website'
  | 'server'
  | 'mobile'
  | 'cloud'
  | 'warehouse'
  | 'custom'

/**
 * Source platform (for mobile/website)
 */
export type SourcePlatform =
  | 'javascript'
  | 'node'
  | 'python'
  | 'ruby'
  | 'java'
  | 'go'
  | 'php'
  | 'ios'
  | 'android'
  | 'react-native'
  | 'flutter'
  | 'unity'
  | 'other'

/**
 * Source configuration
 */
export interface SourceConfig {
  /** Source name */
  name: string
  /** Source slug (unique identifier) */
  slug: string
  /** Source type */
  type: SourceType
  /** Source platform */
  platform?: SourcePlatform
  /** Write key for this source */
  writeKey: string
  /** Whether the source is enabled */
  enabled?: boolean
  /** Source description */
  description?: string
  /** Schema settings */
  schemaSettings?: SchemaSettings
  /** Event transformations */
  transformations?: EventTransformation[]
  /** Allowed events (if restricted) */
  allowedEvents?: string[]
  /** Blocked events */
  blockedEvents?: string[]
  /** Default context to merge */
  defaultContext?: Partial<Context>
  /** Default traits to merge for identify */
  defaultTraits?: Traits
  /** Default properties to merge for track */
  defaultProperties?: Properties
  /** Created timestamp */
  createdAt?: string
  /** Updated timestamp */
  updatedAt?: string
  /** Custom metadata */
  metadata?: Record<string, unknown>
}

/**
 * Schema settings for a source
 */
export interface SchemaSettings {
  /** Allow track events */
  track?: boolean
  /** Allow identify events */
  identify?: boolean
  /** Allow page events */
  page?: boolean
  /** Allow screen events */
  screen?: boolean
  /** Allow group events */
  group?: boolean
  /** Allow alias events */
  alias?: boolean
  /** Forward anonymousId only */
  forwardAnonymousIdOnly?: boolean
  /** Sanitize data */
  sanitize?: boolean
}

/**
 * Event transformation configuration
 */
export interface EventTransformation {
  /** Transformation name */
  name: string
  /** Event types to apply to */
  eventTypes?: Array<'track' | 'identify' | 'page' | 'screen' | 'group' | 'alias'>
  /** Event names to apply to (for track events) */
  eventNames?: string[]
  /** Transformation function */
  transform: (event: SegmentEvent) => SegmentEvent | null
}

/**
 * Source validation result
 */
export interface SourceValidationResult {
  /** Whether the event is valid for this source */
  valid: boolean
  /** Reason if invalid */
  reason?: string
  /** Warnings (non-blocking) */
  warnings?: string[]
}

/**
 * Source statistics
 */
export interface SourceStats {
  /** Total events received */
  totalEvents: number
  /** Events by type */
  eventsByType: Record<string, number>
  /** Events by name (for track) */
  eventsByName: Record<string, number>
  /** Blocked events count */
  blockedEvents: number
  /** Last event timestamp */
  lastEventAt?: string
}

// =============================================================================
// Source Class
// =============================================================================

/**
 * Source represents a data source configuration.
 */
export class Source {
  readonly name: string
  readonly slug: string
  readonly type: SourceType
  readonly platform?: SourcePlatform
  readonly writeKey: string
  readonly description?: string
  readonly metadata?: Record<string, unknown>

  private enabled: boolean
  private schemaSettings: SchemaSettings
  private transformations: EventTransformation[]
  private allowedEvents: Set<string> | null
  private blockedEvents: Set<string>
  private defaultContext: Partial<Context>
  private defaultTraits: Traits
  private defaultProperties: Properties
  private stats: SourceStats
  private createdAt: string
  private updatedAt: string

  constructor(config: SourceConfig) {
    this.name = config.name
    this.slug = config.slug
    this.type = config.type
    this.platform = config.platform
    this.writeKey = config.writeKey
    this.enabled = config.enabled ?? true
    this.description = config.description
    this.metadata = config.metadata

    this.schemaSettings = {
      track: true,
      identify: true,
      page: true,
      screen: true,
      group: true,
      alias: true,
      ...config.schemaSettings,
    }

    this.transformations = config.transformations || []
    this.allowedEvents = config.allowedEvents ? new Set(config.allowedEvents) : null
    this.blockedEvents = new Set(config.blockedEvents || [])
    this.defaultContext = config.defaultContext || {}
    this.defaultTraits = config.defaultTraits || {}
    this.defaultProperties = config.defaultProperties || {}
    this.createdAt = config.createdAt || new Date().toISOString()
    this.updatedAt = config.updatedAt || this.createdAt

    this.stats = {
      totalEvents: 0,
      eventsByType: {},
      eventsByName: {},
      blockedEvents: 0,
    }
  }

  /**
   * Check if source is enabled.
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Enable the source.
   */
  enable(): void {
    this.enabled = true
    this.updatedAt = new Date().toISOString()
  }

  /**
   * Disable the source.
   */
  disable(): void {
    this.enabled = false
    this.updatedAt = new Date().toISOString()
  }

  /**
   * Validate an event against this source's configuration.
   */
  validate(event: SegmentEvent): SourceValidationResult {
    const warnings: string[] = []

    // Check if source is enabled
    if (!this.enabled) {
      return { valid: false, reason: 'Source is disabled' }
    }

    // Check event type is allowed
    const typeAllowed = this.schemaSettings[event.type as keyof SchemaSettings]
    if (typeAllowed === false) {
      return { valid: false, reason: `Event type "${event.type}" is not allowed for this source` }
    }

    // Check event name for track events
    if (event.type === 'track' && event.event) {
      // Check blocked list
      if (this.blockedEvents.has(event.event)) {
        return { valid: false, reason: `Event "${event.event}" is blocked` }
      }

      // Check allowed list (if defined)
      if (this.allowedEvents && !this.allowedEvents.has(event.event)) {
        return { valid: false, reason: `Event "${event.event}" is not in the allowed list` }
      }
    }

    return { valid: true, warnings: warnings.length > 0 ? warnings : undefined }
  }

  /**
   * Process an event through the source pipeline.
   */
  process(event: SegmentEvent): SegmentEvent | null {
    // Validate
    const validation = this.validate(event)
    if (!validation.valid) {
      this.stats.blockedEvents++
      return null
    }

    // Apply default context
    let processedEvent: SegmentEvent = {
      ...event,
      context: {
        ...this.defaultContext,
        ...event.context,
        source: {
          name: this.name,
          slug: this.slug,
          type: this.type,
          writeKey: this.writeKey.substring(0, 8) + '...', // Redact
        },
      },
    }

    // Apply default traits for identify
    if (processedEvent.type === 'identify' && this.defaultTraits) {
      processedEvent.traits = {
        ...this.defaultTraits,
        ...processedEvent.traits,
      }
    }

    // Apply default properties for track/page/screen
    if (
      (processedEvent.type === 'track' ||
        processedEvent.type === 'page' ||
        processedEvent.type === 'screen') &&
      this.defaultProperties
    ) {
      processedEvent.properties = {
        ...this.defaultProperties,
        ...processedEvent.properties,
      }
    }

    // Apply transformations
    for (const transformation of this.transformations) {
      // Check if transformation applies to this event type
      if (transformation.eventTypes && !transformation.eventTypes.includes(processedEvent.type)) {
        continue
      }

      // Check if transformation applies to this event name
      if (
        processedEvent.type === 'track' &&
        transformation.eventNames &&
        processedEvent.event &&
        !transformation.eventNames.includes(processedEvent.event)
      ) {
        continue
      }

      // Apply transformation
      const result = transformation.transform(processedEvent)
      if (result === null) {
        this.stats.blockedEvents++
        return null
      }
      processedEvent = result
    }

    // Update stats
    this.updateStats(processedEvent)

    return processedEvent
  }

  /**
   * Add a transformation.
   */
  addTransformation(transformation: EventTransformation): void {
    this.transformations.push(transformation)
    this.updatedAt = new Date().toISOString()
  }

  /**
   * Remove a transformation by name.
   */
  removeTransformation(name: string): boolean {
    const index = this.transformations.findIndex((t) => t.name === name)
    if (index >= 0) {
      this.transformations.splice(index, 1)
      this.updatedAt = new Date().toISOString()
      return true
    }
    return false
  }

  /**
   * Get transformations.
   */
  getTransformations(): EventTransformation[] {
    return [...this.transformations]
  }

  /**
   * Block an event name.
   */
  blockEvent(eventName: string): void {
    this.blockedEvents.add(eventName)
    this.updatedAt = new Date().toISOString()
  }

  /**
   * Unblock an event name.
   */
  unblockEvent(eventName: string): void {
    this.blockedEvents.delete(eventName)
    this.updatedAt = new Date().toISOString()
  }

  /**
   * Get blocked events.
   */
  getBlockedEvents(): string[] {
    return Array.from(this.blockedEvents)
  }

  /**
   * Update schema settings.
   */
  updateSchemaSettings(settings: Partial<SchemaSettings>): void {
    this.schemaSettings = { ...this.schemaSettings, ...settings }
    this.updatedAt = new Date().toISOString()
  }

  /**
   * Get schema settings.
   */
  getSchemaSettings(): SchemaSettings {
    return { ...this.schemaSettings }
  }

  /**
   * Get source statistics.
   */
  getStats(): SourceStats {
    return { ...this.stats }
  }

  /**
   * Reset statistics.
   */
  resetStats(): void {
    this.stats = {
      totalEvents: 0,
      eventsByType: {},
      eventsByName: {},
      blockedEvents: 0,
    }
  }

  /**
   * Export source configuration to JSON.
   */
  toJSON(): SourceConfig {
    return {
      name: this.name,
      slug: this.slug,
      type: this.type,
      platform: this.platform,
      writeKey: this.writeKey,
      enabled: this.enabled,
      description: this.description,
      schemaSettings: this.schemaSettings,
      allowedEvents: this.allowedEvents ? Array.from(this.allowedEvents) : undefined,
      blockedEvents: Array.from(this.blockedEvents),
      defaultContext: this.defaultContext,
      defaultTraits: this.defaultTraits,
      defaultProperties: this.defaultProperties,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      metadata: this.metadata,
    }
  }

  private updateStats(event: SegmentEvent): void {
    this.stats.totalEvents++
    this.stats.eventsByType[event.type] = (this.stats.eventsByType[event.type] || 0) + 1

    if (event.type === 'track' && event.event) {
      this.stats.eventsByName[event.event] = (this.stats.eventsByName[event.event] || 0) + 1
    }

    this.stats.lastEventAt = new Date().toISOString()
  }
}

// =============================================================================
// SourceManager Class
// =============================================================================

/**
 * Source Manager manages multiple sources.
 */
export class SourceManager {
  private sources: Map<string, Source> = new Map()
  private writeKeyIndex: Map<string, string> = new Map() // writeKey -> slug

  /**
   * Register a source.
   */
  register(config: SourceConfig): Source {
    if (this.sources.has(config.slug)) {
      throw new Error(`Source with slug "${config.slug}" already exists`)
    }

    if (this.writeKeyIndex.has(config.writeKey)) {
      throw new Error(`Write key is already registered to another source`)
    }

    const source = new Source(config)
    this.sources.set(config.slug, source)
    this.writeKeyIndex.set(config.writeKey, config.slug)

    return source
  }

  /**
   * Unregister a source.
   */
  unregister(slug: string): boolean {
    const source = this.sources.get(slug)
    if (source) {
      this.writeKeyIndex.delete(source.writeKey)
      this.sources.delete(slug)
      return true
    }
    return false
  }

  /**
   * Get a source by slug.
   */
  get(slug: string): Source | undefined {
    return this.sources.get(slug)
  }

  /**
   * Get a source by write key.
   */
  getByWriteKey(writeKey: string): Source | undefined {
    const slug = this.writeKeyIndex.get(writeKey)
    if (slug) {
      return this.sources.get(slug)
    }
    return undefined
  }

  /**
   * Check if a source exists.
   */
  has(slug: string): boolean {
    return this.sources.has(slug)
  }

  /**
   * Get all sources.
   */
  getAll(): Source[] {
    return Array.from(this.sources.values())
  }

  /**
   * Get all source slugs.
   */
  getSlugs(): string[] {
    return Array.from(this.sources.keys())
  }

  /**
   * Get enabled sources.
   */
  getEnabled(): Source[] {
    return this.getAll().filter((s) => s.isEnabled())
  }

  /**
   * Validate a write key.
   */
  validateWriteKey(writeKey: string): boolean {
    return this.writeKeyIndex.has(writeKey)
  }

  /**
   * Process an event through the appropriate source.
   */
  processEvent(writeKey: string, event: SegmentEvent): SegmentEvent | null {
    const source = this.getByWriteKey(writeKey)
    if (!source) {
      return null
    }
    return source.process(event)
  }

  /**
   * Get aggregated statistics across all sources.
   */
  getAggregatedStats(): SourceStats {
    const aggregated: SourceStats = {
      totalEvents: 0,
      eventsByType: {},
      eventsByName: {},
      blockedEvents: 0,
    }

    for (const source of this.sources.values()) {
      const stats = source.getStats()
      aggregated.totalEvents += stats.totalEvents
      aggregated.blockedEvents += stats.blockedEvents

      for (const [type, count] of Object.entries(stats.eventsByType)) {
        aggregated.eventsByType[type] = (aggregated.eventsByType[type] || 0) + count
      }

      for (const [name, count] of Object.entries(stats.eventsByName)) {
        aggregated.eventsByName[name] = (aggregated.eventsByName[name] || 0) + count
      }

      if (stats.lastEventAt) {
        if (!aggregated.lastEventAt || stats.lastEventAt > aggregated.lastEventAt) {
          aggregated.lastEventAt = stats.lastEventAt
        }
      }
    }

    return aggregated
  }

  /**
   * Clear all sources.
   */
  clear(): void {
    this.sources.clear()
    this.writeKeyIndex.clear()
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a source.
 */
export function createSource(config: SourceConfig): Source {
  return new Source(config)
}

/**
 * Create a source manager.
 */
export function createSourceManager(): SourceManager {
  return new SourceManager()
}

// =============================================================================
// Built-in Source Templates
// =============================================================================

/**
 * Create a JavaScript website source config.
 */
export function createWebsiteSource(options: {
  name: string
  slug: string
  writeKey: string
  description?: string
}): SourceConfig {
  return {
    ...options,
    type: 'website',
    platform: 'javascript',
    schemaSettings: {
      track: true,
      identify: true,
      page: true,
      screen: false, // Screen not typically used for web
      group: true,
      alias: true,
    },
  }
}

/**
 * Create a Node.js server source config.
 */
export function createServerSource(options: {
  name: string
  slug: string
  writeKey: string
  description?: string
}): SourceConfig {
  return {
    ...options,
    type: 'server',
    platform: 'node',
    schemaSettings: {
      track: true,
      identify: true,
      page: true,
      screen: true,
      group: true,
      alias: true,
    },
  }
}

/**
 * Create an iOS mobile source config.
 */
export function createIOSSource(options: {
  name: string
  slug: string
  writeKey: string
  description?: string
}): SourceConfig {
  return {
    ...options,
    type: 'mobile',
    platform: 'ios',
    schemaSettings: {
      track: true,
      identify: true,
      page: false, // Page not typically used for mobile
      screen: true,
      group: true,
      alias: true,
    },
  }
}

/**
 * Create an Android mobile source config.
 */
export function createAndroidSource(options: {
  name: string
  slug: string
  writeKey: string
  description?: string
}): SourceConfig {
  return {
    ...options,
    type: 'mobile',
    platform: 'android',
    schemaSettings: {
      track: true,
      identify: true,
      page: false,
      screen: true,
      group: true,
      alias: true,
    },
  }
}

/**
 * Create a cloud source config.
 */
export function createCloudSource(options: {
  name: string
  slug: string
  writeKey: string
  description?: string
}): SourceConfig {
  return {
    ...options,
    type: 'cloud',
    schemaSettings: {
      track: true,
      identify: true,
      page: false,
      screen: false,
      group: true,
      alias: false,
    },
  }
}
