/**
 * @dotdo/segment - Test Suite
 *
 * RED phase tests for the Segment API compatibility layer.
 * Tests the core Analytics class with in-memory backend.
 *
 * @module @dotdo/segment/tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  Analytics,
  InMemoryBackend,
  createInMemoryTransport,
  type SegmentEvent,
  type Transport,
} from '../src/index.js'

describe('@dotdo/segment', () => {
  let analytics: Analytics
  let backend: InMemoryBackend

  beforeEach(() => {
    backend = new InMemoryBackend()
    analytics = new Analytics({
      writeKey: 'test-write-key',
      transport: () => createInMemoryTransport(backend),
    })
  })

  afterEach(async () => {
    await analytics.close()
    backend.clear()
  })

  describe('Analytics', () => {
    describe('constructor', () => {
      it('should create an instance with writeKey', () => {
        expect(analytics).toBeInstanceOf(Analytics)
        expect(analytics.writeKey).toBe('test-write-key')
      })

      it('should use default options', () => {
        expect(analytics.flushAt).toBe(20)
        expect(analytics.flushInterval).toBe(10000)
      })

      it('should accept custom options', () => {
        const custom = new Analytics({
          writeKey: 'custom-key',
          flushAt: 50,
          flushInterval: 5000,
          transport: () => createInMemoryTransport(backend),
        })
        expect(custom.flushAt).toBe(50)
        expect(custom.flushInterval).toBe(5000)
      })
    })

    describe('identify', () => {
      it('should identify a user with userId', async () => {
        analytics.identify({
          userId: 'user123',
          traits: {
            name: 'John Doe',
            email: 'john@example.com',
          },
        })

        await analytics.flush()
        const events = backend.getEvents()

        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({
          type: 'identify',
          userId: 'user123',
          traits: {
            name: 'John Doe',
            email: 'john@example.com',
          },
        })
      })

      it('should identify a user with anonymousId', async () => {
        analytics.identify({
          anonymousId: 'anon123',
          traits: {
            plan: 'free',
          },
        })

        await analytics.flush()
        const events = backend.getEvents()

        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({
          type: 'identify',
          anonymousId: 'anon123',
          traits: { plan: 'free' },
        })
      })

      it('should throw if neither userId nor anonymousId provided', () => {
        expect(() => analytics.identify({} as any)).toThrow('Either userId or anonymousId is required')
      })

      it('should include messageId and timestamp', async () => {
        analytics.identify({ userId: 'user123' })
        await analytics.flush()
        const events = backend.getEvents()

        expect(events[0]?.messageId).toBeDefined()
        expect(events[0]?.timestamp).toBeDefined()
      })

      it('should include library context', async () => {
        analytics.identify({ userId: 'user123' })
        await analytics.flush()
        const events = backend.getEvents()

        expect(events[0]?.context?.library).toMatchObject({
          name: '@dotdo/segment',
          version: expect.any(String),
        })
      })
    })

    describe('track', () => {
      it('should track an event', async () => {
        analytics.track({
          userId: 'user123',
          event: 'Order Completed',
          properties: {
            orderId: 'order_123',
            total: 99.99,
          },
        })

        await analytics.flush()
        const events = backend.getEvents()

        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({
          type: 'track',
          userId: 'user123',
          event: 'Order Completed',
          properties: {
            orderId: 'order_123',
            total: 99.99,
          },
        })
      })

      it('should track with anonymousId', async () => {
        analytics.track({
          anonymousId: 'anon123',
          event: 'Page Viewed',
        })

        await analytics.flush()
        const events = backend.getEvents()

        expect(events[0]).toMatchObject({
          type: 'track',
          anonymousId: 'anon123',
          event: 'Page Viewed',
        })
      })

      it('should throw if event name is missing', () => {
        expect(() =>
          analytics.track({ userId: 'user123' } as any)
        ).toThrow('Event name is required')
      })

      it('should throw if event name is empty', () => {
        expect(() =>
          analytics.track({ userId: 'user123', event: '' })
        ).toThrow('Event name is required')
      })

      it('should throw if no identity provided', () => {
        expect(() =>
          analytics.track({ event: 'Test Event' } as any)
        ).toThrow('Either userId or anonymousId is required')
      })
    })

    describe('page', () => {
      it('should track a page view', async () => {
        analytics.page({
          userId: 'user123',
          name: 'Home',
          properties: {
            url: 'https://example.com',
            referrer: 'https://google.com',
          },
        })

        await analytics.flush()
        const events = backend.getEvents()

        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({
          type: 'page',
          userId: 'user123',
          name: 'Home',
          properties: {
            url: 'https://example.com',
            referrer: 'https://google.com',
          },
        })
      })

      it('should track page with category', async () => {
        analytics.page({
          userId: 'user123',
          name: 'Pricing',
          category: 'Marketing',
        })

        await analytics.flush()
        const events = backend.getEvents()

        expect(events[0]).toMatchObject({
          type: 'page',
          name: 'Pricing',
          category: 'Marketing',
        })
      })

      it('should throw if no identity provided', () => {
        expect(() =>
          analytics.page({ name: 'Home' } as any)
        ).toThrow('Either userId or anonymousId is required')
      })
    })

    describe('screen', () => {
      it('should track a screen view', async () => {
        analytics.screen({
          userId: 'user123',
          name: 'Dashboard',
          properties: {
            section: 'Overview',
          },
        })

        await analytics.flush()
        const events = backend.getEvents()

        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({
          type: 'screen',
          userId: 'user123',
          name: 'Dashboard',
          properties: { section: 'Overview' },
        })
      })

      it('should track screen with category', async () => {
        analytics.screen({
          userId: 'user123',
          name: 'Settings',
          category: 'Account',
        })

        await analytics.flush()
        const events = backend.getEvents()

        expect(events[0]).toMatchObject({
          type: 'screen',
          name: 'Settings',
          category: 'Account',
        })
      })
    })

    describe('group', () => {
      it('should associate user with a group', async () => {
        analytics.group({
          userId: 'user123',
          groupId: 'company_123',
          traits: {
            name: 'Acme Inc',
            industry: 'Technology',
          },
        })

        await analytics.flush()
        const events = backend.getEvents()

        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({
          type: 'group',
          userId: 'user123',
          groupId: 'company_123',
          traits: {
            name: 'Acme Inc',
            industry: 'Technology',
          },
        })
      })

      it('should throw if groupId is missing', () => {
        expect(() =>
          analytics.group({ userId: 'user123' } as any)
        ).toThrow('groupId is required')
      })

      it('should throw if groupId is empty', () => {
        expect(() =>
          analytics.group({ userId: 'user123', groupId: '' })
        ).toThrow('groupId is required')
      })
    })

    describe('alias', () => {
      it('should alias user IDs', async () => {
        analytics.alias({
          userId: 'new-user-id',
          previousId: 'anon-123',
        })

        await analytics.flush()
        const events = backend.getEvents()

        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({
          type: 'alias',
          userId: 'new-user-id',
          previousId: 'anon-123',
        })
      })

      it('should throw if previousId is missing', () => {
        expect(() =>
          analytics.alias({ userId: 'user123' } as any)
        ).toThrow('previousId is required')
      })

      it('should throw if previousId is empty', () => {
        expect(() =>
          analytics.alias({ userId: 'user123', previousId: '' })
        ).toThrow('previousId is required')
      })
    })

    describe('batch', () => {
      it('should batch multiple events', async () => {
        analytics.batch({
          batch: [
            { type: 'identify', userId: 'u1', traits: { name: 'Alice' } },
            { type: 'track', userId: 'u1', event: 'Signup' },
            { type: 'page', userId: 'u1', name: 'Welcome' },
          ],
        })

        await analytics.flush()
        const events = backend.getEvents()

        expect(events).toHaveLength(3)
        expect(events[0]?.type).toBe('identify')
        expect(events[1]?.type).toBe('track')
        expect(events[2]?.type).toBe('page')
      })
    })

    describe('flush', () => {
      it('should flush all queued events', async () => {
        analytics.identify({ userId: 'user1' })
        analytics.track({ userId: 'user1', event: 'Event 1' })
        analytics.track({ userId: 'user1', event: 'Event 2' })

        await analytics.flush()
        const events = backend.getEvents()

        expect(events).toHaveLength(3)
      })

      it('should clear queue after flush', async () => {
        analytics.identify({ userId: 'user1' })
        await analytics.flush()

        analytics.track({ userId: 'user1', event: 'Event 2' })
        await analytics.flush()

        const events = backend.getEvents()
        expect(events).toHaveLength(2)
      })

      it('should return true on success', async () => {
        analytics.identify({ userId: 'user1' })
        const result = await analytics.flush()
        expect(result).toBe(true)
      })
    })

    describe('context', () => {
      it('should merge global context', async () => {
        analytics.context = {
          app: { name: 'MyApp', version: '1.0.0' },
        }

        analytics.identify({ userId: 'user123' })
        await analytics.flush()
        const events = backend.getEvents()

        expect(events[0]?.context?.app).toMatchObject({
          name: 'MyApp',
          version: '1.0.0',
        })
      })

      it('should merge message context', async () => {
        analytics.identify({
          userId: 'user123',
          context: {
            ip: '192.168.1.1',
            userAgent: 'Mozilla/5.0',
          },
        })

        await analytics.flush()
        const events = backend.getEvents()

        expect(events[0]?.context?.ip).toBe('192.168.1.1')
        expect(events[0]?.context?.userAgent).toBe('Mozilla/5.0')
      })

      it('should deep merge nested context', async () => {
        analytics.context = {
          app: { name: 'MyApp' },
        }

        analytics.identify({
          userId: 'user123',
          context: {
            app: { version: '2.0.0' },
          },
        })

        await analytics.flush()
        const events = backend.getEvents()

        expect(events[0]?.context?.app).toMatchObject({
          name: 'MyApp',
          version: '2.0.0',
        })
      })
    })

    describe('integrations', () => {
      it('should include integrations in events', async () => {
        analytics.identify({
          userId: 'user123',
          integrations: {
            All: true,
            Amplitude: false,
          },
        })

        await analytics.flush()
        const events = backend.getEvents()

        expect(events[0]?.integrations).toMatchObject({
          All: true,
          Amplitude: false,
        })
      })

      it('should merge default integrations', async () => {
        const customAnalytics = new Analytics({
          writeKey: 'test-key',
          integrations: { Mixpanel: true },
          transport: () => createInMemoryTransport(backend),
        })

        customAnalytics.identify({
          userId: 'user123',
          integrations: { Amplitude: false },
        })

        await customAnalytics.flush()
        const events = backend.getEvents()

        expect(events[0]?.integrations).toMatchObject({
          Mixpanel: true,
          Amplitude: false,
        })

        await customAnalytics.close()
      })
    })

    describe('callbacks', () => {
      it('should invoke callback after flush', async () => {
        let callbackCalled = false

        analytics.identify({ userId: 'user123' }, () => {
          callbackCalled = true
        })

        await analytics.flush()
        expect(callbackCalled).toBe(true)
      })
    })

    describe('middleware', () => {
      it('should apply source middleware', async () => {
        analytics.addSourceMiddleware((event) => ({
          ...event,
          properties: {
            ...event.properties,
            enriched: true,
          },
        }))

        analytics.track({
          userId: 'user123',
          event: 'Test',
          properties: { original: true },
        })

        await analytics.flush()
        const events = backend.getEvents()

        expect(events[0]?.properties).toMatchObject({
          original: true,
          enriched: true,
        })
      })

      it('should allow middleware to drop events', async () => {
        analytics.addSourceMiddleware((event) => {
          if (event.event?.startsWith('_internal')) {
            return null
          }
          return event
        })

        analytics.track({ userId: 'user123', event: '_internal_test' })
        analytics.track({ userId: 'user123', event: 'Public Event' })

        await analytics.flush()
        const events = backend.getEvents()

        expect(events).toHaveLength(1)
        expect(events[0]?.event).toBe('Public Event')
      })
    })

    describe('disabled mode', () => {
      it('should not send events when disabled', async () => {
        const disabledAnalytics = new Analytics({
          writeKey: 'test-key',
          disable: true,
          transport: () => createInMemoryTransport(backend),
        })

        disabledAnalytics.identify({ userId: 'user123' })
        await disabledAnalytics.flush()

        expect(backend.getEvents()).toHaveLength(0)
        await disabledAnalytics.close()
      })
    })

    describe('ready', () => {
      it('should resolve when analytics is ready', async () => {
        await expect(analytics.ready()).resolves.toBeUndefined()
      })
    })

    describe('close', () => {
      it('should flush pending events on close', async () => {
        analytics.identify({ userId: 'user123' })
        await analytics.close()

        expect(backend.getEvents()).toHaveLength(1)
      })
    })
  })

  describe('InMemoryBackend', () => {
    it('should store events', () => {
      const event: SegmentEvent = {
        type: 'track',
        messageId: 'msg-1',
        timestamp: new Date().toISOString(),
        userId: 'user1',
        event: 'Test',
      }

      backend.addEvent(event)
      expect(backend.getEvents()).toHaveLength(1)
      expect(backend.getEvents()[0]).toEqual(event)
    })

    it('should store batches', () => {
      const batch = {
        batch: [
          { type: 'track' as const, messageId: 'msg-1', timestamp: new Date().toISOString(), userId: 'user1', event: 'E1' },
          { type: 'track' as const, messageId: 'msg-2', timestamp: new Date().toISOString(), userId: 'user1', event: 'E2' },
        ],
        sentAt: new Date().toISOString(),
      }

      backend.addBatch(batch)
      expect(backend.getBatches()).toHaveLength(1)
    })

    it('should clear all data', () => {
      backend.addEvent({
        type: 'track',
        messageId: 'msg-1',
        timestamp: new Date().toISOString(),
        userId: 'user1',
        event: 'Test',
      })

      backend.clear()
      expect(backend.getEvents()).toHaveLength(0)
      expect(backend.getBatches()).toHaveLength(0)
    })

    it('should filter events by type', () => {
      backend.addEvent({
        type: 'identify',
        messageId: 'msg-1',
        timestamp: new Date().toISOString(),
        userId: 'user1',
      })
      backend.addEvent({
        type: 'track',
        messageId: 'msg-2',
        timestamp: new Date().toISOString(),
        userId: 'user1',
        event: 'Test',
      })

      const identifyEvents = backend.getEventsByType('identify')
      expect(identifyEvents).toHaveLength(1)
      expect(identifyEvents[0]?.type).toBe('identify')
    })

    it('should filter events by user', () => {
      backend.addEvent({
        type: 'track',
        messageId: 'msg-1',
        timestamp: new Date().toISOString(),
        userId: 'user1',
        event: 'E1',
      })
      backend.addEvent({
        type: 'track',
        messageId: 'msg-2',
        timestamp: new Date().toISOString(),
        userId: 'user2',
        event: 'E2',
      })

      const user1Events = backend.getEventsForUser('user1')
      expect(user1Events).toHaveLength(1)
      expect(user1Events[0]?.userId).toBe('user1')
    })
  })
})
