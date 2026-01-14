/**
 * @dotdo/segment - Source Definitions Tests
 *
 * Tests for Segment Source compatibility:
 * - Source configuration and management
 * - Write key validation
 * - Source-specific transformations
 * - Event filtering and blocking
 *
 * TDD approach: Tests define expected behavior
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  Source,
  SourceManager,
  createSource,
  createSourceManager,
  createWebsiteSource,
  createServerSource,
  createIOSSource,
  createAndroidSource,
  createCloudSource,
  type SourceConfig,
  type EventTransformation,
} from '../sources'
import type { SegmentEvent } from '../types'

describe('@dotdo/segment - Source Definitions', () => {
  // ===========================================================================
  // Source Creation
  // ===========================================================================

  describe('Source Creation', () => {
    it('should create a source with basic configuration', () => {
      const source = createSource({
        name: 'My Website',
        slug: 'my-website',
        type: 'website',
        platform: 'javascript',
        writeKey: 'wk_test123',
      })

      expect(source.name).toBe('My Website')
      expect(source.slug).toBe('my-website')
      expect(source.type).toBe('website')
      expect(source.platform).toBe('javascript')
      expect(source.writeKey).toBe('wk_test123')
    })

    it('should be enabled by default', () => {
      const source = createSource({
        name: 'Test Source',
        slug: 'test',
        type: 'server',
        writeKey: 'wk_123',
      })

      expect(source.isEnabled()).toBe(true)
    })

    it('should support disabled state on creation', () => {
      const source = createSource({
        name: 'Test Source',
        slug: 'test',
        type: 'server',
        writeKey: 'wk_123',
        enabled: false,
      })

      expect(source.isEnabled()).toBe(false)
    })

    it('should allow enabling and disabling', () => {
      const source = createSource({
        name: 'Test',
        slug: 'test',
        type: 'server',
        writeKey: 'wk_123',
      })

      source.disable()
      expect(source.isEnabled()).toBe(false)

      source.enable()
      expect(source.isEnabled()).toBe(true)
    })

    it('should export configuration to JSON', () => {
      const config: SourceConfig = {
        name: 'My Source',
        slug: 'my-source',
        type: 'website',
        platform: 'javascript',
        writeKey: 'wk_123',
        description: 'A test source',
      }

      const source = createSource(config)
      const exported = source.toJSON()

      expect(exported.name).toBe('My Source')
      expect(exported.slug).toBe('my-source')
      expect(exported.type).toBe('website')
      expect(exported.writeKey).toBe('wk_123')
    })
  })

  // ===========================================================================
  // Source Templates
  // ===========================================================================

  describe('Source Templates', () => {
    it('should create website source with correct defaults', () => {
      const config = createWebsiteSource({
        name: 'My Website',
        slug: 'my-website',
        writeKey: 'wk_123',
      })

      expect(config.type).toBe('website')
      expect(config.platform).toBe('javascript')
      expect(config.schemaSettings?.page).toBe(true)
      expect(config.schemaSettings?.screen).toBe(false) // Screen not for web
    })

    it('should create server source with correct defaults', () => {
      const config = createServerSource({
        name: 'My Server',
        slug: 'my-server',
        writeKey: 'wk_123',
      })

      expect(config.type).toBe('server')
      expect(config.platform).toBe('node')
      expect(config.schemaSettings?.track).toBe(true)
      expect(config.schemaSettings?.identify).toBe(true)
    })

    it('should create iOS source with correct defaults', () => {
      const config = createIOSSource({
        name: 'My iOS App',
        slug: 'my-ios-app',
        writeKey: 'wk_123',
      })

      expect(config.type).toBe('mobile')
      expect(config.platform).toBe('ios')
      expect(config.schemaSettings?.screen).toBe(true)
      expect(config.schemaSettings?.page).toBe(false) // Page not for mobile
    })

    it('should create Android source with correct defaults', () => {
      const config = createAndroidSource({
        name: 'My Android App',
        slug: 'my-android-app',
        writeKey: 'wk_123',
      })

      expect(config.type).toBe('mobile')
      expect(config.platform).toBe('android')
      expect(config.schemaSettings?.screen).toBe(true)
      expect(config.schemaSettings?.page).toBe(false)
    })

    it('should create cloud source with correct defaults', () => {
      const config = createCloudSource({
        name: 'My Cloud Source',
        slug: 'my-cloud-source',
        writeKey: 'wk_123',
      })

      expect(config.type).toBe('cloud')
      expect(config.schemaSettings?.track).toBe(true)
      expect(config.schemaSettings?.alias).toBe(false) // Alias not for cloud
    })
  })

  // ===========================================================================
  // Event Validation
  // ===========================================================================

  describe('Event Validation', () => {
    let source: Source

    beforeEach(() => {
      source = createSource({
        name: 'Test',
        slug: 'test',
        type: 'website',
        writeKey: 'wk_123',
      })
    })

    it('should validate enabled events', () => {
      const event = createTrackEvent('Test Event', {})
      const result = source.validate(event)

      expect(result.valid).toBe(true)
    })

    it('should reject events when source is disabled', () => {
      source.disable()

      const event = createTrackEvent('Test Event', {})
      const result = source.validate(event)

      expect(result.valid).toBe(false)
      expect(result.reason).toContain('disabled')
    })

    it('should reject blocked event types', () => {
      source.updateSchemaSettings({ screen: false })

      const event: SegmentEvent = {
        type: 'screen',
        messageId: 'msg-1',
        timestamp: new Date().toISOString(),
        userId: 'user-123',
        name: 'Dashboard',
      }

      const result = source.validate(event)

      expect(result.valid).toBe(false)
      expect(result.reason).toContain('not allowed')
    })

    it('should reject blocked event names', () => {
      source.blockEvent('Internal Event')

      const event = createTrackEvent('Internal Event', {})
      const result = source.validate(event)

      expect(result.valid).toBe(false)
      expect(result.reason).toContain('blocked')
    })

    it('should support allowed events list', () => {
      const restrictedSource = createSource({
        name: 'Restricted',
        slug: 'restricted',
        type: 'server',
        writeKey: 'wk_123',
        allowedEvents: ['Page Viewed', 'Button Clicked'],
      })

      const allowedEvent = createTrackEvent('Page Viewed', {})
      const blockedEvent = createTrackEvent('Secret Event', {})

      expect(restrictedSource.validate(allowedEvent).valid).toBe(true)
      expect(restrictedSource.validate(blockedEvent).valid).toBe(false)
    })
  })

  // ===========================================================================
  // Event Processing
  // ===========================================================================

  describe('Event Processing', () => {
    let source: Source

    beforeEach(() => {
      source = createSource({
        name: 'Test',
        slug: 'test',
        type: 'website',
        writeKey: 'wk_123',
      })
    })

    it('should process valid events', () => {
      const event = createTrackEvent('Test Event', { value: 42 })
      const processed = source.process(event)

      expect(processed).not.toBeNull()
      expect(processed!.event).toBe('Test Event')
      expect(processed!.properties?.value).toBe(42)
    })

    it('should return null for invalid events', () => {
      source.disable()

      const event = createTrackEvent('Test Event', {})
      const processed = source.process(event)

      expect(processed).toBeNull()
    })

    it('should add source context', () => {
      const event = createTrackEvent('Test Event', {})
      const processed = source.process(event)

      expect(processed!.context?.source).toBeDefined()
      expect(processed!.context?.source.name).toBe('Test')
      expect(processed!.context?.source.slug).toBe('test')
    })

    it('should merge default context', () => {
      const sourceWithContext = createSource({
        name: 'Test',
        slug: 'test',
        type: 'website',
        writeKey: 'wk_123',
        defaultContext: {
          app: { name: 'MyApp', version: '1.0.0' },
        },
      })

      const event = createTrackEvent('Test Event', {})
      const processed = sourceWithContext.process(event)

      expect(processed!.context?.app?.name).toBe('MyApp')
    })

    it('should merge default traits for identify', () => {
      const sourceWithTraits = createSource({
        name: 'Test',
        slug: 'test',
        type: 'website',
        writeKey: 'wk_123',
        defaultTraits: { source: 'website' },
      })

      const event = createIdentifyEvent('user-123', { name: 'Alice' })
      const processed = sourceWithTraits.process(event)

      expect(processed!.traits?.source).toBe('website')
      expect(processed!.traits?.name).toBe('Alice')
    })

    it('should merge default properties for track', () => {
      const sourceWithProps = createSource({
        name: 'Test',
        slug: 'test',
        type: 'website',
        writeKey: 'wk_123',
        defaultProperties: { env: 'production' },
      })

      const event = createTrackEvent('Test Event', { value: 42 })
      const processed = sourceWithProps.process(event)

      expect(processed!.properties?.env).toBe('production')
      expect(processed!.properties?.value).toBe(42)
    })
  })

  // ===========================================================================
  // Transformations
  // ===========================================================================

  describe('Transformations', () => {
    let source: Source

    beforeEach(() => {
      source = createSource({
        name: 'Test',
        slug: 'test',
        type: 'website',
        writeKey: 'wk_123',
      })
    })

    it('should apply transformations to events', () => {
      source.addTransformation({
        name: 'enrich',
        transform: (event) => ({
          ...event,
          properties: { ...event.properties, enriched: true },
        }),
      })

      const event = createTrackEvent('Test Event', { value: 42 })
      const processed = source.process(event)

      expect(processed!.properties?.enriched).toBe(true)
      expect(processed!.properties?.value).toBe(42)
    })

    it('should apply transformations in order', () => {
      source.addTransformation({
        name: 'first',
        transform: (event) => ({
          ...event,
          properties: { ...event.properties, order: 'first' },
        }),
      })

      source.addTransformation({
        name: 'second',
        transform: (event) => ({
          ...event,
          properties: { ...event.properties, order: 'second' },
        }),
      })

      const event = createTrackEvent('Test Event', {})
      const processed = source.process(event)

      expect(processed!.properties?.order).toBe('second')
    })

    it('should filter transformations by event type', () => {
      source.addTransformation({
        name: 'track-only',
        eventTypes: ['track'],
        transform: (event) => ({
          ...event,
          properties: { ...event.properties, trackOnly: true },
        }),
      })

      const trackEvent = createTrackEvent('Test', {})
      const identifyEvent = createIdentifyEvent('user-123', {})

      const processedTrack = source.process(trackEvent)
      const processedIdentify = source.process(identifyEvent)

      expect(processedTrack!.properties?.trackOnly).toBe(true)
      expect(processedIdentify!.traits?.trackOnly).toBeUndefined()
    })

    it('should filter transformations by event name', () => {
      source.addTransformation({
        name: 'purchase-only',
        eventNames: ['Purchase'],
        transform: (event) => ({
          ...event,
          properties: { ...event.properties, isPurchase: true },
        }),
      })

      const purchaseEvent = createTrackEvent('Purchase', {})
      const otherEvent = createTrackEvent('Page View', {})

      const processedPurchase = source.process(purchaseEvent)
      const processedOther = source.process(otherEvent)

      expect(processedPurchase!.properties?.isPurchase).toBe(true)
      expect(processedOther!.properties?.isPurchase).toBeUndefined()
    })

    it('should allow transformations to drop events', () => {
      source.addTransformation({
        name: 'filter',
        transform: (event) => {
          if (event.event === 'Internal') {
            return null
          }
          return event
        },
      })

      const internalEvent = createTrackEvent('Internal', {})
      const normalEvent = createTrackEvent('Normal', {})

      expect(source.process(internalEvent)).toBeNull()
      expect(source.process(normalEvent)).not.toBeNull()
    })

    it('should remove transformations by name', () => {
      source.addTransformation({
        name: 'test-transform',
        transform: (event) => ({
          ...event,
          properties: { ...event.properties, transformed: true },
        }),
      })

      const removed = source.removeTransformation('test-transform')
      expect(removed).toBe(true)

      const event = createTrackEvent('Test', {})
      const processed = source.process(event)

      expect(processed!.properties?.transformed).toBeUndefined()
    })

    it('should get list of transformations', () => {
      source.addTransformation({ name: 'first', transform: (e) => e })
      source.addTransformation({ name: 'second', transform: (e) => e })

      const transformations = source.getTransformations()

      expect(transformations).toHaveLength(2)
      expect(transformations.map((t) => t.name)).toContain('first')
      expect(transformations.map((t) => t.name)).toContain('second')
    })
  })

  // ===========================================================================
  // Event Blocking
  // ===========================================================================

  describe('Event Blocking', () => {
    let source: Source

    beforeEach(() => {
      source = createSource({
        name: 'Test',
        slug: 'test',
        type: 'website',
        writeKey: 'wk_123',
      })
    })

    it('should block events by name', () => {
      source.blockEvent('Secret Event')

      const event = createTrackEvent('Secret Event', {})
      const processed = source.process(event)

      expect(processed).toBeNull()
    })

    it('should unblock events', () => {
      source.blockEvent('Blocked Event')
      source.unblockEvent('Blocked Event')

      const event = createTrackEvent('Blocked Event', {})
      const processed = source.process(event)

      expect(processed).not.toBeNull()
    })

    it('should get list of blocked events', () => {
      source.blockEvent('Event A')
      source.blockEvent('Event B')

      const blocked = source.getBlockedEvents()

      expect(blocked).toContain('Event A')
      expect(blocked).toContain('Event B')
    })
  })

  // ===========================================================================
  // Schema Settings
  // ===========================================================================

  describe('Schema Settings', () => {
    it('should allow updating schema settings', () => {
      const source = createSource({
        name: 'Test',
        slug: 'test',
        type: 'website',
        writeKey: 'wk_123',
      })

      source.updateSchemaSettings({ screen: false, alias: false })

      const settings = source.getSchemaSettings()

      expect(settings.screen).toBe(false)
      expect(settings.alias).toBe(false)
      expect(settings.track).toBe(true) // Unchanged
    })

    it('should get current schema settings', () => {
      const source = createSource({
        name: 'Test',
        slug: 'test',
        type: 'website',
        writeKey: 'wk_123',
        schemaSettings: {
          track: true,
          identify: true,
          page: true,
          screen: false,
          group: true,
          alias: true,
        },
      })

      const settings = source.getSchemaSettings()

      expect(settings.screen).toBe(false)
      expect(settings.page).toBe(true)
    })
  })

  // ===========================================================================
  // Statistics
  // ===========================================================================

  describe('Statistics', () => {
    let source: Source

    beforeEach(() => {
      source = createSource({
        name: 'Test',
        slug: 'test',
        type: 'website',
        writeKey: 'wk_123',
      })
    })

    it('should track total events processed', () => {
      source.process(createTrackEvent('Event 1', {}))
      source.process(createTrackEvent('Event 2', {}))
      source.process(createTrackEvent('Event 3', {}))

      const stats = source.getStats()

      expect(stats.totalEvents).toBe(3)
    })

    it('should track events by type', () => {
      source.process(createTrackEvent('Event', {}))
      source.process(createTrackEvent('Event', {}))
      source.process(createIdentifyEvent('user-1', {}))

      const stats = source.getStats()

      expect(stats.eventsByType.track).toBe(2)
      expect(stats.eventsByType.identify).toBe(1)
    })

    it('should track events by name', () => {
      source.process(createTrackEvent('Page Viewed', {}))
      source.process(createTrackEvent('Page Viewed', {}))
      source.process(createTrackEvent('Button Clicked', {}))

      const stats = source.getStats()

      expect(stats.eventsByName['Page Viewed']).toBe(2)
      expect(stats.eventsByName['Button Clicked']).toBe(1)
    })

    it('should track blocked events', () => {
      source.blockEvent('Blocked Event')

      source.process(createTrackEvent('Normal Event', {}))
      source.process(createTrackEvent('Blocked Event', {}))
      source.process(createTrackEvent('Blocked Event', {}))

      const stats = source.getStats()

      expect(stats.totalEvents).toBe(1)
      expect(stats.blockedEvents).toBe(2)
    })

    it('should track last event timestamp', () => {
      source.process(createTrackEvent('Event', {}))

      const stats = source.getStats()

      expect(stats.lastEventAt).toBeDefined()
      expect(new Date(stats.lastEventAt!).getTime()).toBeLessThanOrEqual(Date.now())
    })

    it('should reset statistics', () => {
      source.process(createTrackEvent('Event', {}))
      source.resetStats()

      const stats = source.getStats()

      expect(stats.totalEvents).toBe(0)
      expect(stats.blockedEvents).toBe(0)
    })
  })

  // ===========================================================================
  // Source Manager
  // ===========================================================================

  describe('SourceManager', () => {
    let manager: SourceManager

    beforeEach(() => {
      manager = createSourceManager()
    })

    it('should register sources', () => {
      const source = manager.register({
        name: 'My Source',
        slug: 'my-source',
        type: 'website',
        writeKey: 'wk_123',
      })

      expect(source.name).toBe('My Source')
      expect(manager.has('my-source')).toBe(true)
    })

    it('should prevent duplicate slugs', () => {
      manager.register({
        name: 'Source 1',
        slug: 'same-slug',
        type: 'website',
        writeKey: 'wk_1',
      })

      expect(() => {
        manager.register({
          name: 'Source 2',
          slug: 'same-slug',
          type: 'server',
          writeKey: 'wk_2',
        })
      }).toThrow(/already exists/)
    })

    it('should prevent duplicate write keys', () => {
      manager.register({
        name: 'Source 1',
        slug: 'source-1',
        type: 'website',
        writeKey: 'wk_same',
      })

      expect(() => {
        manager.register({
          name: 'Source 2',
          slug: 'source-2',
          type: 'server',
          writeKey: 'wk_same',
        })
      }).toThrow(/already registered/)
    })

    it('should unregister sources', () => {
      manager.register({
        name: 'Test',
        slug: 'test',
        type: 'website',
        writeKey: 'wk_123',
      })

      const removed = manager.unregister('test')

      expect(removed).toBe(true)
      expect(manager.has('test')).toBe(false)
    })

    it('should get source by slug', () => {
      manager.register({
        name: 'My Source',
        slug: 'my-source',
        type: 'website',
        writeKey: 'wk_123',
      })

      const source = manager.get('my-source')

      expect(source).toBeDefined()
      expect(source!.name).toBe('My Source')
    })

    it('should get source by write key', () => {
      manager.register({
        name: 'My Source',
        slug: 'my-source',
        type: 'website',
        writeKey: 'wk_abc123',
      })

      const source = manager.getByWriteKey('wk_abc123')

      expect(source).toBeDefined()
      expect(source!.slug).toBe('my-source')
    })

    it('should validate write keys', () => {
      manager.register({
        name: 'Test',
        slug: 'test',
        type: 'website',
        writeKey: 'wk_valid',
      })

      expect(manager.validateWriteKey('wk_valid')).toBe(true)
      expect(manager.validateWriteKey('wk_invalid')).toBe(false)
    })

    it('should get all sources', () => {
      manager.register({ name: 'S1', slug: 's1', type: 'website', writeKey: 'wk_1' })
      manager.register({ name: 'S2', slug: 's2', type: 'server', writeKey: 'wk_2' })

      const sources = manager.getAll()

      expect(sources).toHaveLength(2)
    })

    it('should get enabled sources only', () => {
      manager.register({ name: 'Enabled', slug: 'enabled', type: 'website', writeKey: 'wk_1' })
      manager.register({
        name: 'Disabled',
        slug: 'disabled',
        type: 'server',
        writeKey: 'wk_2',
        enabled: false,
      })

      const enabled = manager.getEnabled()

      expect(enabled).toHaveLength(1)
      expect(enabled[0]!.slug).toBe('enabled')
    })

    it('should get all slugs', () => {
      manager.register({ name: 'S1', slug: 'slug-1', type: 'website', writeKey: 'wk_1' })
      manager.register({ name: 'S2', slug: 'slug-2', type: 'server', writeKey: 'wk_2' })

      const slugs = manager.getSlugs()

      expect(slugs).toContain('slug-1')
      expect(slugs).toContain('slug-2')
    })

    it('should process events through correct source', () => {
      manager.register({
        name: 'Website',
        slug: 'website',
        type: 'website',
        writeKey: 'wk_website',
        defaultProperties: { source: 'website' },
      })

      manager.register({
        name: 'Server',
        slug: 'server',
        type: 'server',
        writeKey: 'wk_server',
        defaultProperties: { source: 'server' },
      })

      const event = createTrackEvent('Test', { value: 42 })

      const processed = manager.processEvent('wk_website', event)

      expect(processed).not.toBeNull()
      expect(processed!.properties?.source).toBe('website')
    })

    it('should return null for unknown write key', () => {
      const event = createTrackEvent('Test', {})
      const processed = manager.processEvent('wk_unknown', event)

      expect(processed).toBeNull()
    })

    it('should get aggregated statistics', () => {
      const website = manager.register({
        name: 'Website',
        slug: 'website',
        type: 'website',
        writeKey: 'wk_1',
      })
      const server = manager.register({
        name: 'Server',
        slug: 'server',
        type: 'server',
        writeKey: 'wk_2',
      })

      website.process(createTrackEvent('Page Viewed', {}))
      website.process(createTrackEvent('Page Viewed', {}))
      server.process(createTrackEvent('API Called', {}))

      const stats = manager.getAggregatedStats()

      expect(stats.totalEvents).toBe(3)
      expect(stats.eventsByType.track).toBe(3)
    })

    it('should clear all sources', () => {
      manager.register({ name: 'S1', slug: 's1', type: 'website', writeKey: 'wk_1' })
      manager.register({ name: 'S2', slug: 's2', type: 'server', writeKey: 'wk_2' })

      manager.clear()

      expect(manager.getAll()).toHaveLength(0)
    })
  })
})

// =============================================================================
// Helper Functions
// =============================================================================

function createTrackEvent(eventName: string, properties: Record<string, unknown>): SegmentEvent {
  return {
    type: 'track',
    messageId: `msg-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    userId: 'user-123',
    event: eventName,
    properties,
  }
}

function createIdentifyEvent(userId: string, traits: Record<string, unknown>): SegmentEvent {
  return {
    type: 'identify',
    messageId: `msg-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    userId,
    traits,
  }
}
