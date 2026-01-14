/**
 * @dotdo/segment - Segment SDK Compat Layer Tests
 *
 * Comprehensive tests for the Segment SDK compatibility layer.
 * Following TDD: These tests are written first and should FAIL initially.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  // Core class
  Analytics,

  // Test utilities
  InMemoryTransport,
  _clear,

  // Types
  type AnalyticsOptions,
  type IdentifyMessage,
  type TrackMessage,
  type PageMessage,
  type ScreenMessage,
  type GroupMessage,
  type AliasMessage,
  type SegmentEvent,
  type Context,
} from '../index'

describe('@dotdo/segment - Segment SDK Compat Layer', () => {
  // Reset global state before each test
  beforeEach(() => {
    _clear()
  })

  // ===========================================================================
  // Analytics Initialization
  // ===========================================================================

  describe('Analytics Initialization', () => {
    it('should create analytics instance with write key', () => {
      const analytics = new Analytics({ writeKey: 'test-write-key' })
      expect(analytics).toBeDefined()
      expect(analytics.writeKey).toBe('test-write-key')
    })

    it('should accept optional host configuration', () => {
      const analytics = new Analytics({
        writeKey: 'test-key',
        host: 'https://custom.segment.io',
      })
      expect(analytics.host).toBe('https://custom.segment.io')
    })

    it('should accept optional flushAt and flushInterval', () => {
      const analytics = new Analytics({
        writeKey: 'test-key',
        flushAt: 10,
        flushInterval: 5000,
      })
      expect(analytics.flushAt).toBe(10)
      expect(analytics.flushInterval).toBe(5000)
    })

    it('should have default flush settings', () => {
      const analytics = new Analytics({ writeKey: 'test-key' })
      expect(analytics.flushAt).toBe(20) // Default batch size
      expect(analytics.flushInterval).toBe(10000) // Default 10 seconds
    })
  })

  // ===========================================================================
  // Identify API
  // ===========================================================================

  describe('Identify', () => {
    it('should identify a user with userId', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.identify({
        userId: 'user123',
        traits: {
          name: 'John Doe',
          email: 'john@example.com',
        },
      })

      const events = transport.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('identify')
      expect(events[0]?.userId).toBe('user123')
      expect(events[0]?.traits?.name).toBe('John Doe')
      expect(events[0]?.traits?.email).toBe('john@example.com')
    })

    it('should identify with anonymousId', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.identify({
        anonymousId: 'anon-456',
        traits: {
          plan: 'free',
        },
      })

      const events = transport.getEvents()
      expect(events[0]?.anonymousId).toBe('anon-456')
      expect(events[0]?.traits?.plan).toBe('free')
    })

    it('should generate messageId automatically', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.identify({ userId: 'user123' })

      const events = transport.getEvents()
      expect(events[0]?.messageId).toBeDefined()
      expect(typeof events[0]?.messageId).toBe('string')
    })

    it('should add timestamp automatically', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.identify({ userId: 'user123' })

      const events = transport.getEvents()
      expect(events[0]?.timestamp).toBeDefined()
    })

    it('should support callback on identify', async () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      const callback = vi.fn()
      analytics.identify({ userId: 'user123' }, callback)

      await analytics.flush()
      expect(callback).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Track API
  // ===========================================================================

  describe('Track', () => {
    it('should track an event', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.track({
        userId: 'user123',
        event: 'Order Completed',
        properties: {
          orderId: 'order_123',
          total: 99.99,
          products: [{ id: 'prod_1', name: 'Widget' }],
        },
      })

      const events = transport.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('track')
      expect(events[0]?.event).toBe('Order Completed')
      expect(events[0]?.properties?.orderId).toBe('order_123')
      expect(events[0]?.properties?.total).toBe(99.99)
    })

    it('should track with anonymousId', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.track({
        anonymousId: 'anon-789',
        event: 'Button Clicked',
        properties: { button: 'signup' },
      })

      const events = transport.getEvents()
      expect(events[0]?.anonymousId).toBe('anon-789')
      expect(events[0]?.event).toBe('Button Clicked')
    })

    it('should require event name', () => {
      const analytics = new Analytics({ writeKey: 'test-key' })

      expect(() => {
        analytics.track({
          userId: 'user123',
          event: '', // Empty event name
        })
      }).toThrow()
    })
  })

  // ===========================================================================
  // Page API
  // ===========================================================================

  describe('Page', () => {
    it('should track page view', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.page({
        userId: 'user123',
        name: 'Home',
        properties: {
          url: 'https://example.com',
          referrer: 'https://google.com',
          title: 'Home Page',
        },
      })

      const events = transport.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('page')
      expect(events[0]?.name).toBe('Home')
      expect(events[0]?.properties?.url).toBe('https://example.com')
    })

    it('should support category for page', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.page({
        userId: 'user123',
        category: 'Docs',
        name: 'Getting Started',
      })

      const events = transport.getEvents()
      expect(events[0]?.category).toBe('Docs')
      expect(events[0]?.name).toBe('Getting Started')
    })
  })

  // ===========================================================================
  // Screen API
  // ===========================================================================

  describe('Screen', () => {
    it('should track screen view (mobile)', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.screen({
        userId: 'user123',
        name: 'Dashboard',
        properties: {
          section: 'Overview',
        },
      })

      const events = transport.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('screen')
      expect(events[0]?.name).toBe('Dashboard')
      expect(events[0]?.properties?.section).toBe('Overview')
    })
  })

  // ===========================================================================
  // Group API
  // ===========================================================================

  describe('Group', () => {
    it('should associate user with group', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.group({
        userId: 'user123',
        groupId: 'company_123',
        traits: {
          name: 'Acme Inc',
          industry: 'Technology',
          employees: 100,
        },
      })

      const events = transport.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('group')
      expect(events[0]?.groupId).toBe('company_123')
      expect(events[0]?.traits?.name).toBe('Acme Inc')
      expect(events[0]?.traits?.industry).toBe('Technology')
    })

    it('should require groupId', () => {
      const analytics = new Analytics({ writeKey: 'test-key' })

      expect(() => {
        analytics.group({
          userId: 'user123',
          groupId: '', // Empty groupId
        })
      }).toThrow()
    })
  })

  // ===========================================================================
  // Alias API
  // ===========================================================================

  describe('Alias', () => {
    it('should alias user IDs', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.alias({
        userId: 'new-user-id',
        previousId: 'anon-123',
      })

      const events = transport.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('alias')
      expect(events[0]?.userId).toBe('new-user-id')
      expect(events[0]?.previousId).toBe('anon-123')
    })

    it('should require previousId', () => {
      const analytics = new Analytics({ writeKey: 'test-key' })

      expect(() => {
        analytics.alias({
          userId: 'new-id',
          previousId: '', // Empty previousId
        })
      }).toThrow()
    })
  })

  // ===========================================================================
  // Batch API
  // ===========================================================================

  describe('Batch', () => {
    it('should batch multiple events', async () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
        flushAt: 100, // High threshold to prevent auto-flush
      })

      analytics.track({ userId: 'u1', event: 'Event 1' })
      analytics.track({ userId: 'u2', event: 'Event 2' })
      analytics.identify({ userId: 'u3', traits: { name: 'Test' } })

      await analytics.flush()

      // Should have all 3 events batched
      expect(transport.getBatches()).toHaveLength(1)
      expect(transport.getBatches()[0]?.batch).toHaveLength(3)
    })

    it('should auto-flush when flushAt threshold reached', async () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
        flushAt: 2, // Flush after 2 events
      })

      analytics.track({ userId: 'u1', event: 'Event 1' })
      analytics.track({ userId: 'u2', event: 'Event 2' })

      // Give time for auto-flush
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(transport.getBatches()).toHaveLength(1)
    })

    it('should support batch API directly', async () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.batch({
        batch: [
          { type: 'identify', userId: 'u1', traits: { name: 'Alice' } },
          { type: 'track', userId: 'u1', event: 'Signup' },
          { type: 'page', userId: 'u1', name: 'Home' },
        ],
      })

      await analytics.flush()

      expect(transport.getBatches()).toHaveLength(1)
      expect(transport.getBatches()[0]?.batch).toHaveLength(3)
    })
  })

  // ===========================================================================
  // Context Enrichment
  // ===========================================================================

  describe('Context Enrichment', () => {
    it('should auto-add context to events', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.track({
        userId: 'user123',
        event: 'Test Event',
      })

      const events = transport.getEvents()
      expect(events[0]?.context).toBeDefined()
      expect(events[0]?.context?.library).toBeDefined()
      expect(events[0]?.context?.library?.name).toBe('@dotdo/segment')
    })

    it('should include library version in context', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.track({ userId: 'user123', event: 'Test' })

      const events = transport.getEvents()
      expect(events[0]?.context?.library?.version).toBeDefined()
    })

    it('should merge user-provided context', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.track({
        userId: 'user123',
        event: 'Test',
        context: {
          ip: '192.168.1.1',
          userAgent: 'Custom UA',
          app: {
            name: 'MyApp',
            version: '1.0.0',
          },
        },
      })

      const events = transport.getEvents()
      expect(events[0]?.context?.ip).toBe('192.168.1.1')
      expect(events[0]?.context?.userAgent).toBe('Custom UA')
      expect(events[0]?.context?.app?.name).toBe('MyApp')
      expect(events[0]?.context?.library).toBeDefined() // Should still have library
    })

    it('should support global context via analytics.context', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      // Set global context
      analytics.context = {
        device: {
          id: 'device-123',
          type: 'mobile',
        },
      }

      analytics.track({ userId: 'user123', event: 'Test' })

      const events = transport.getEvents()
      expect(events[0]?.context?.device?.id).toBe('device-123')
    })
  })

  // ===========================================================================
  // Integrations
  // ===========================================================================

  describe('Integrations', () => {
    it('should support integrations object', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.track({
        userId: 'user123',
        event: 'Test',
        integrations: {
          All: false,
          Mixpanel: true,
          'Google Analytics': false,
        },
      })

      const events = transport.getEvents()
      expect(events[0]?.integrations?.All).toBe(false)
      expect(events[0]?.integrations?.Mixpanel).toBe(true)
    })

    it('should support default integrations', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
        integrations: {
          Amplitude: false, // Disable Amplitude by default
        },
      })

      analytics.track({ userId: 'user123', event: 'Test' })

      const events = transport.getEvents()
      expect(events[0]?.integrations?.Amplitude).toBe(false)
    })
  })

  // ===========================================================================
  // Destination Forwarding
  // ===========================================================================

  describe('Destinations', () => {
    it('should support registering destinations', () => {
      const analytics = new Analytics({ writeKey: 'test-key' })

      const mockDestination = {
        name: 'MockDestination',
        track: vi.fn(),
        identify: vi.fn(),
        page: vi.fn(),
        screen: vi.fn(),
        group: vi.fn(),
        alias: vi.fn(),
      }

      analytics.register(mockDestination)
      expect(analytics.getDestinations()).toContain(mockDestination)
    })

    it('should forward events to registered destinations', async () => {
      const transport = new InMemoryTransport()
      const mockDestination = {
        name: 'MockDestination',
        track: vi.fn(),
        identify: vi.fn(),
        page: vi.fn(),
        screen: vi.fn(),
        group: vi.fn(),
        alias: vi.fn(),
      }

      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.register(mockDestination)

      analytics.track({
        userId: 'user123',
        event: 'Test Event',
      })

      await analytics.flush()

      expect(mockDestination.track).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user123',
          event: 'Test Event',
        })
      )
    })

    it('should respect integrations settings for destinations', async () => {
      const transport = new InMemoryTransport()
      const mockDestination = {
        name: 'MockDestination',
        track: vi.fn(),
        identify: vi.fn(),
        page: vi.fn(),
        screen: vi.fn(),
        group: vi.fn(),
        alias: vi.fn(),
      }

      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.register(mockDestination)

      analytics.track({
        userId: 'user123',
        event: 'Test Event',
        integrations: {
          MockDestination: false, // Disable for this event
        },
      })

      await analytics.flush()

      expect(mockDestination.track).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Flush and Close
  // ===========================================================================

  describe('Flush and Close', () => {
    it('should flush all pending events', async () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
        flushAt: 100, // High threshold
      })

      analytics.track({ userId: 'u1', event: 'Event 1' })
      analytics.track({ userId: 'u2', event: 'Event 2' })

      const result = await analytics.flush()
      expect(result).toBe(true)
      expect(transport.getBatches()).toHaveLength(1)
    })

    it('should support close to stop processing', async () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
        flushAt: 100,
      })

      analytics.track({ userId: 'u1', event: 'Event 1' })

      await analytics.close()

      // Events should be flushed on close
      expect(transport.getBatches()).toHaveLength(1)
    })
  })

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('should require userId or anonymousId', () => {
      const analytics = new Analytics({ writeKey: 'test-key' })

      expect(() => {
        analytics.track({
          event: 'Test', // Missing both userId and anonymousId
        } as any)
      }).toThrow()
    })

    it('should handle transport errors gracefully', async () => {
      const failingTransport = {
        send: vi.fn().mockRejectedValue(new Error('Network error')),
        flush: vi.fn().mockResolvedValue(true),
        getEvents: () => [],
        getBatches: () => [],
      }

      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => failingTransport,
        flushAt: 1,
      })

      // Should not throw
      analytics.track({ userId: 'u1', event: 'Test' })

      // Wait for flush attempt
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Should have attempted to send
      expect(failingTransport.send).toHaveBeenCalled()
    })

    it('should support error callback', async () => {
      const failingTransport = {
        send: vi.fn().mockRejectedValue(new Error('Network error')),
        flush: vi.fn().mockResolvedValue(true),
        getEvents: () => [],
        getBatches: () => [],
      }

      const errorCallback = vi.fn()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => failingTransport,
        errorHandler: errorCallback,
        flushAt: 1,
      })

      analytics.track({ userId: 'u1', event: 'Test' })

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(errorCallback).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Middleware Support
  // ===========================================================================

  describe('Middleware', () => {
    it('should support source middleware', () => {
      const transport = new InMemoryTransport()
      const middleware = vi.fn((event) => ({
        ...event,
        properties: { ...event.properties, enriched: true },
      }))

      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.addSourceMiddleware(middleware)

      analytics.track({
        userId: 'user123',
        event: 'Test',
        properties: { original: true },
      })

      const events = transport.getEvents()
      expect(events[0]?.properties?.enriched).toBe(true)
      expect(events[0]?.properties?.original).toBe(true)
    })

    it('should allow middleware to drop events', () => {
      const transport = new InMemoryTransport()
      const filterMiddleware = vi.fn((event) => {
        // Drop internal events
        if (event.event?.startsWith('_')) {
          return null
        }
        return event
      })

      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.addSourceMiddleware(filterMiddleware)

      analytics.track({ userId: 'u1', event: '_internal_event' })
      analytics.track({ userId: 'u2', event: 'public_event' })

      const events = transport.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.event).toBe('public_event')
    })
  })

  // ===========================================================================
  // Plugins
  // ===========================================================================

  describe('Plugins', () => {
    it('should support plugin registration', async () => {
      const transport = new InMemoryTransport()
      const plugin = {
        name: 'TestPlugin',
        type: 'enrichment' as const,
        load: vi.fn().mockResolvedValue(undefined),
        unload: vi.fn(),
        isLoaded: vi.fn().mockReturnValue(true),
        track: vi.fn((event) => event),
      }

      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
        plugins: [plugin],
      })

      await analytics.ready()

      expect(plugin.load).toHaveBeenCalled()
    })
  })
})
