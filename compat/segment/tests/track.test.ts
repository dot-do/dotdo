/**
 * @dotdo/segment - Event Tracking Tests
 *
 * Tests for event tracking methods.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  buildEvent,
  validateIdentity,
  validateTrackMessage,
  validateGroupMessage,
  validateAliasMessage,
  Tracker,
  createIdentifyEvent,
  createTrackEvent,
  createPageEvent,
  createScreenEvent,
  createGroupEvent,
  createAliasEvent,
  isIdentifyEvent,
  isTrackEvent,
  isPageEvent,
  isScreenEvent,
  isGroupEvent,
  isAliasEvent,
} from '../track'
import type { SegmentEvent } from '../types'

describe('@dotdo/segment/track - Event Tracking', () => {
  describe('buildEvent', () => {
    it('should build a basic event', () => {
      const event = buildEvent('track', { userId: 'user123' }, { event: 'Test Event' })

      expect(event.type).toBe('track')
      expect(event.userId).toBe('user123')
      expect(event.event).toBe('Test Event')
      expect(event.messageId).toBeDefined()
      expect(event.timestamp).toBeDefined()
      expect(event.context?.library?.name).toBe('@dotdo/segment')
    })

    it('should merge global context', () => {
      const event = buildEvent(
        'track',
        { userId: 'user123' },
        { event: 'Test' },
        {
          globalContext: {
            device: { id: 'device-123' },
          },
        }
      )

      expect(event.context?.device?.id).toBe('device-123')
      expect(event.context?.library).toBeDefined()
    })

    it('should merge message context', () => {
      const event = buildEvent(
        'track',
        {
          userId: 'user123',
          context: { ip: '192.168.1.1' },
        },
        { event: 'Test' }
      )

      expect(event.context?.ip).toBe('192.168.1.1')
    })

    it('should apply middlewares', () => {
      const middleware = vi.fn((e: SegmentEvent) => ({
        ...e,
        properties: { ...e.properties, enriched: true },
      }))

      const event = buildEvent(
        'track',
        { userId: 'user123' },
        { event: 'Test', properties: { original: true } },
        { middlewares: [middleware] }
      )

      expect(middleware).toHaveBeenCalled()
      expect(event.properties?.enriched).toBe(true)
      expect(event.properties?.original).toBe(true)
    })

    it('should handle middleware returning null', () => {
      const middleware = vi.fn(() => null)

      const event = buildEvent(
        'track',
        { userId: 'user123' },
        { event: 'Test' },
        { middlewares: [middleware] }
      )

      expect((event as any)._dropped).toBe(true)
    })

    it('should handle Date timestamp', () => {
      const date = new Date('2024-01-15T10:00:00Z')
      const event = buildEvent('track', { userId: 'user123', timestamp: date }, { event: 'Test' })

      expect(event.timestamp).toBe('2024-01-15T10:00:00.000Z')
    })
  })

  describe('Validation Functions', () => {
    describe('validateIdentity', () => {
      it('should pass with userId', () => {
        expect(() => validateIdentity({ userId: 'user123' })).not.toThrow()
      })

      it('should pass with anonymousId', () => {
        expect(() => validateIdentity({ anonymousId: 'anon123' })).not.toThrow()
      })

      it('should throw without userId or anonymousId', () => {
        expect(() => validateIdentity({})).toThrow('Either userId or anonymousId is required')
      })
    })

    describe('validateTrackMessage', () => {
      it('should pass with valid message', () => {
        expect(() => validateTrackMessage({ userId: 'user123', event: 'Test' })).not.toThrow()
      })

      it('should throw without event', () => {
        expect(() => validateTrackMessage({ userId: 'user123', event: '' })).toThrow(
          'Event name is required for track calls'
        )
      })
    })

    describe('validateGroupMessage', () => {
      it('should pass with valid message', () => {
        expect(() =>
          validateGroupMessage({ userId: 'user123', groupId: 'group123' })
        ).not.toThrow()
      })

      it('should throw without groupId', () => {
        expect(() => validateGroupMessage({ userId: 'user123', groupId: '' })).toThrow(
          'groupId is required for group calls'
        )
      })
    })

    describe('validateAliasMessage', () => {
      it('should pass with valid message', () => {
        expect(() =>
          validateAliasMessage({ userId: 'user123', previousId: 'anon123' })
        ).not.toThrow()
      })

      it('should throw without previousId', () => {
        expect(() => validateAliasMessage({ userId: 'user123', previousId: '' })).toThrow(
          'previousId is required for alias calls'
        )
      })
    })
  })

  describe('Tracker Class', () => {
    let events: SegmentEvent[]
    let tracker: Tracker

    beforeEach(() => {
      events = []
      tracker = new Tracker((event) => {
        events.push(event)
      })
    })

    it('should track identify events', () => {
      tracker.identify({ userId: 'user123', traits: { name: 'John' } })

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('identify')
      expect(events[0].userId).toBe('user123')
      expect(events[0].traits?.name).toBe('John')
    })

    it('should track events', () => {
      tracker.track({ userId: 'user123', event: 'Button Clicked', properties: { button: 'signup' } })

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('track')
      expect(events[0].event).toBe('Button Clicked')
      expect(events[0].properties?.button).toBe('signup')
    })

    it('should track page events', () => {
      tracker.page({ userId: 'user123', name: 'Home', properties: { url: 'https://example.com' } })

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('page')
      expect(events[0].name).toBe('Home')
    })

    it('should track screen events', () => {
      tracker.screen({ userId: 'user123', name: 'Dashboard' })

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('screen')
      expect(events[0].name).toBe('Dashboard')
    })

    it('should track group events', () => {
      tracker.group({ userId: 'user123', groupId: 'company123', traits: { name: 'Acme' } })

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('group')
      expect(events[0].groupId).toBe('company123')
    })

    it('should track alias events', () => {
      tracker.alias({ userId: 'newId', previousId: 'oldId' })

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('alias')
      expect(events[0].userId).toBe('newId')
      expect(events[0].previousId).toBe('oldId')
    })

    it('should handle batch events', () => {
      const batchEvents = tracker.batch({
        batch: [
          { type: 'identify', userId: 'u1', traits: { name: 'Alice' } },
          { type: 'track', userId: 'u1', event: 'Signup' },
        ],
      })

      expect(events).toHaveLength(2)
      expect(batchEvents).toHaveLength(2)
    })

    it('should set global context', () => {
      tracker.setGlobalContext({ device: { id: 'device-123' } })
      tracker.track({ userId: 'user123', event: 'Test' })

      expect(events[0].context?.device?.id).toBe('device-123')
    })

    it('should add middleware', () => {
      tracker.addMiddleware((event) => ({
        ...event,
        properties: { ...event.properties, enriched: true },
      }))

      tracker.track({ userId: 'user123', event: 'Test' })

      expect(events[0].properties?.enriched).toBe(true)
    })
  })

  describe('Standalone Functions', () => {
    it('should create identify event', () => {
      const event = createIdentifyEvent({ userId: 'user123', traits: { name: 'John' } })
      expect(event.type).toBe('identify')
    })

    it('should create track event', () => {
      const event = createTrackEvent({ userId: 'user123', event: 'Test' })
      expect(event.type).toBe('track')
    })

    it('should create page event', () => {
      const event = createPageEvent({ userId: 'user123', name: 'Home' })
      expect(event.type).toBe('page')
    })

    it('should create screen event', () => {
      const event = createScreenEvent({ userId: 'user123', name: 'Dashboard' })
      expect(event.type).toBe('screen')
    })

    it('should create group event', () => {
      const event = createGroupEvent({ userId: 'user123', groupId: 'group123' })
      expect(event.type).toBe('group')
    })

    it('should create alias event', () => {
      const event = createAliasEvent({ userId: 'newId', previousId: 'oldId' })
      expect(event.type).toBe('alias')
    })
  })

  describe('Type Guards', () => {
    it('should identify event types correctly', () => {
      const identify = createIdentifyEvent({ userId: 'user123' })
      const track = createTrackEvent({ userId: 'user123', event: 'Test' })
      const page = createPageEvent({ userId: 'user123' })
      const screen = createScreenEvent({ userId: 'user123' })
      const group = createGroupEvent({ userId: 'user123', groupId: 'group123' })
      const alias = createAliasEvent({ userId: 'newId', previousId: 'oldId' })

      expect(isIdentifyEvent(identify)).toBe(true)
      expect(isTrackEvent(track)).toBe(true)
      expect(isPageEvent(page)).toBe(true)
      expect(isScreenEvent(screen)).toBe(true)
      expect(isGroupEvent(group)).toBe(true)
      expect(isAliasEvent(alias)).toBe(true)

      expect(isIdentifyEvent(track)).toBe(false)
      expect(isTrackEvent(identify)).toBe(false)
    })
  })
})
