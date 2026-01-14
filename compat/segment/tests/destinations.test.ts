/**
 * @dotdo/segment - Destination Management Tests
 *
 * Tests for destination management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  DestinationManager,
  createDestinationManager,
  ConsoleDestination,
  createConsoleDestination,
  WebhookDestination,
  createWebhookDestination,
  BufferDestination,
  createBufferDestination,
  CallbackDestination,
  createCallbackDestination,
  createDestinationFilter,
  createDestinationEnricher,
  forDestinations,
} from '../destinations'
import type { SegmentEvent, Destination } from '../types'

describe('@dotdo/segment/destinations - Destination Management', () => {
  const createMockEvent = (type: SegmentEvent['type'], overrides?: Partial<SegmentEvent>): SegmentEvent => ({
    type,
    messageId: 'msg-123',
    timestamp: '2024-01-15T10:00:00.000Z',
    userId: 'user123',
    ...overrides,
  })

  const createMockDestination = (name: string): Destination => ({
    name,
    track: vi.fn(),
    identify: vi.fn(),
    page: vi.fn(),
    screen: vi.fn(),
    group: vi.fn(),
    alias: vi.fn(),
  })

  describe('DestinationManager', () => {
    let manager: DestinationManager

    beforeEach(() => {
      manager = new DestinationManager()
    })

    it('should register destinations', () => {
      const dest = createMockDestination('TestDest')
      manager.register(dest)

      expect(manager.has('TestDest')).toBe(true)
      expect(manager.get('TestDest')).toBe(dest)
    })

    it('should throw on duplicate registration', () => {
      const dest = createMockDestination('TestDest')
      manager.register(dest)

      expect(() => manager.register(dest)).toThrow('Destination "TestDest" is already registered')
    })

    it('should unregister destinations', () => {
      const dest = createMockDestination('TestDest')
      dest.unload = vi.fn()
      manager.register(dest)

      const result = manager.unregister('TestDest')

      expect(result).toBe(true)
      expect(manager.has('TestDest')).toBe(false)
      expect(dest.unload).toHaveBeenCalled()
    })

    it('should return false when unregistering non-existent destination', () => {
      const result = manager.unregister('NonExistent')
      expect(result).toBe(false)
    })

    it('should get all destinations', () => {
      const dest1 = createMockDestination('Dest1')
      const dest2 = createMockDestination('Dest2')
      manager.register(dest1)
      manager.register(dest2)

      const all = manager.getAll()
      expect(all).toHaveLength(2)
    })

    it('should get destination names', () => {
      manager.register(createMockDestination('Dest1'))
      manager.register(createMockDestination('Dest2'))

      const names = manager.getNames()
      expect(names).toContain('Dest1')
      expect(names).toContain('Dest2')
    })

    describe('isEnabled', () => {
      it('should enable destinations by default', () => {
        const dest = createMockDestination('TestDest')
        const event = createMockEvent('track')

        expect(manager.isEnabled(event, dest)).toBe(true)
      })

      it('should respect specific destination disable', () => {
        const dest = createMockDestination('TestDest')
        const event = createMockEvent('track', {
          integrations: { TestDest: false },
        })

        expect(manager.isEnabled(event, dest)).toBe(false)
      })

      it('should respect All: false', () => {
        const dest = createMockDestination('TestDest')
        const event = createMockEvent('track', {
          integrations: { All: false },
        })

        expect(manager.isEnabled(event, dest)).toBe(false)
      })

      it('should override All: false with specific enable', () => {
        const dest = createMockDestination('TestDest')
        const event = createMockEvent('track', {
          integrations: { All: false, TestDest: true },
        })

        expect(manager.isEnabled(event, dest)).toBe(true)
      })

      it('should use default integrations', () => {
        const managerWithDefaults = new DestinationManager({
          defaultIntegrations: { TestDest: false },
        })
        const dest = createMockDestination('TestDest')
        const event = createMockEvent('track')

        expect(managerWithDefaults.isEnabled(event, dest)).toBe(false)
      })
    })

    describe('forward', () => {
      it('should forward events to enabled destinations', async () => {
        const dest = createMockDestination('TestDest')
        manager.register(dest)

        const event = createMockEvent('track', { event: 'Test Event' })
        await manager.forward(event)

        expect(dest.track).toHaveBeenCalledWith(event)
      })

      it('should not forward to disabled destinations', async () => {
        const dest = createMockDestination('TestDest')
        manager.register(dest)

        const event = createMockEvent('track', {
          event: 'Test Event',
          integrations: { TestDest: false },
        })
        await manager.forward(event)

        expect(dest.track).not.toHaveBeenCalled()
      })

      it('should forward different event types correctly', async () => {
        const dest = createMockDestination('TestDest')
        manager.register(dest)

        await manager.forward(createMockEvent('identify', { traits: { name: 'John' } }))
        await manager.forward(createMockEvent('page', { name: 'Home' }))
        await manager.forward(createMockEvent('screen', { name: 'Dashboard' }))
        await manager.forward(createMockEvent('group', { groupId: 'group123' }))
        await manager.forward(createMockEvent('alias', { previousId: 'oldId' }))

        expect(dest.identify).toHaveBeenCalled()
        expect(dest.page).toHaveBeenCalled()
        expect(dest.screen).toHaveBeenCalled()
        expect(dest.group).toHaveBeenCalled()
        expect(dest.alias).toHaveBeenCalled()
      })

      it('should apply middlewares', async () => {
        const dest = createMockDestination('TestDest')
        manager.register(dest)

        manager.addMiddleware((event, _dest) => ({
          ...event,
          properties: { ...event.properties, enriched: true },
        }))

        const event = createMockEvent('track', { event: 'Test' })
        await manager.forward(event)

        expect(dest.track).toHaveBeenCalledWith(
          expect.objectContaining({
            properties: { enriched: true },
          })
        )
      })

      it('should filter events via middleware', async () => {
        const dest = createMockDestination('TestDest')
        manager.register(dest)

        manager.addMiddleware(() => null) // Filter all

        const event = createMockEvent('track', { event: 'Test' })
        await manager.forward(event)

        expect(dest.track).not.toHaveBeenCalled()
      })

      it('should handle errors with onError callback', async () => {
        const onError = vi.fn()
        const managerWithError = new DestinationManager({ onError })

        const dest = createMockDestination('TestDest')
        dest.track = vi.fn().mockRejectedValue(new Error('Network error'))
        managerWithError.register(dest)

        const event = createMockEvent('track', { event: 'Test' })
        await managerWithError.forward(event)

        expect(onError).toHaveBeenCalledWith(
          expect.any(Error),
          dest,
          event
        )
      })
    })

    describe('forwardBatch', () => {
      it('should forward multiple events', async () => {
        const dest = createMockDestination('TestDest')
        manager.register(dest)

        const events = [
          createMockEvent('track', { event: 'Event1' }),
          createMockEvent('track', { event: 'Event2' }),
        ]

        await manager.forwardBatch(events)

        expect(dest.track).toHaveBeenCalledTimes(2)
      })
    })

    describe('close', () => {
      it('should unload all destinations', async () => {
        const dest1 = createMockDestination('Dest1')
        const dest2 = createMockDestination('Dest2')
        dest1.unload = vi.fn()
        dest2.unload = vi.fn()

        manager.register(dest1)
        manager.register(dest2)

        await manager.close()

        expect(dest1.unload).toHaveBeenCalled()
        expect(dest2.unload).toHaveBeenCalled()
        expect(manager.getAll()).toHaveLength(0)
      })
    })
  })

  describe('ConsoleDestination', () => {
    it('should log events to console', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const dest = new ConsoleDestination()

      dest.track(createMockEvent('track', { event: 'Test', properties: { key: 'value' } }))

      expect(consoleSpy).toHaveBeenCalledWith('[Segment] track:', 'Test', { key: 'value' })
      consoleSpy.mockRestore()
    })

    it('should use custom prefix', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const dest = new ConsoleDestination({ prefix: '[MyApp]' })

      dest.identify(createMockEvent('identify', { traits: { name: 'John' } }))

      expect(consoleSpy).toHaveBeenCalledWith('[MyApp] identify:', 'user123', { name: 'John' })
      consoleSpy.mockRestore()
    })
  })

  describe('BufferDestination', () => {
    it('should buffer events', () => {
      const dest = new BufferDestination()

      dest.track(createMockEvent('track', { event: 'Event1' }))
      dest.track(createMockEvent('track', { event: 'Event2' }))

      expect(dest.getEvents()).toHaveLength(2)
      expect(dest.size).toBe(2)
    })

    it('should respect maxSize', () => {
      const dest = new BufferDestination({ maxSize: 2 })

      dest.track(createMockEvent('track', { event: 'Event1' }))
      dest.track(createMockEvent('track', { event: 'Event2' }))
      dest.track(createMockEvent('track', { event: 'Event3' }))

      expect(dest.size).toBe(2)
      expect(dest.getEvents()[0].event).toBe('Event2')
    })

    it('should filter by type', () => {
      const dest = new BufferDestination()

      dest.track(createMockEvent('track', { event: 'Test' }))
      dest.identify(createMockEvent('identify', { traits: {} }))

      expect(dest.getEventsByType('track')).toHaveLength(1)
      expect(dest.getEventsByType('identify')).toHaveLength(1)
    })

    it('should filter by user', () => {
      const dest = new BufferDestination()

      dest.track(createMockEvent('track', { userId: 'user1', event: 'Test' }))
      dest.track(createMockEvent('track', { userId: 'user2', event: 'Test' }))

      expect(dest.getEventsForUser('user1')).toHaveLength(1)
    })

    it('should clear buffer', () => {
      const dest = new BufferDestination()

      dest.track(createMockEvent('track', { event: 'Test' }))
      dest.clear()

      expect(dest.size).toBe(0)
    })
  })

  describe('CallbackDestination', () => {
    it('should call custom callbacks', async () => {
      const trackCb = vi.fn()
      const identifyCb = vi.fn()

      const dest = new CallbackDestination({
        track: trackCb,
        identify: identifyCb,
      })

      await dest.track(createMockEvent('track', { event: 'Test' }))
      await dest.identify(createMockEvent('identify'))

      expect(trackCb).toHaveBeenCalled()
      expect(identifyCb).toHaveBeenCalled()
    })

    it('should handle async callbacks', async () => {
      const asyncCb = vi.fn().mockResolvedValue(undefined)

      const dest = new CallbackDestination({ track: asyncCb })

      await dest.track(createMockEvent('track', { event: 'Test' }))

      expect(asyncCb).toHaveBeenCalled()
    })
  })

  describe('Middleware Helpers', () => {
    describe('createDestinationFilter', () => {
      it('should filter events', () => {
        const filter = createDestinationFilter((event) => event.event !== '_internal')
        const dest = createMockDestination('TestDest')

        expect(filter(createMockEvent('track', { event: 'Public' }), dest)).not.toBeNull()
        expect(filter(createMockEvent('track', { event: '_internal' }), dest)).toBeNull()
      })
    })

    describe('createDestinationEnricher', () => {
      it('should enrich events', () => {
        const enricher = createDestinationEnricher((event) => ({
          ...event,
          properties: { ...event.properties, destination: 'enriched' },
        }))
        const dest = createMockDestination('TestDest')

        const result = enricher(createMockEvent('track', { event: 'Test' }), dest)
        expect(result?.properties?.destination).toBe('enriched')
      })
    })

    describe('forDestinations', () => {
      it('should only apply to specified destinations', () => {
        const middleware = vi.fn((event) => ({
          ...event,
          properties: { ...event.properties, modified: true },
        }))

        const wrapped = forDestinations(['TargetDest'], middleware)

        const targetDest = createMockDestination('TargetDest')
        const otherDest = createMockDestination('OtherDest')

        const event = createMockEvent('track', { event: 'Test' })

        const result1 = wrapped(event, targetDest)
        expect(result1?.properties?.modified).toBe(true)
        expect(middleware).toHaveBeenCalledTimes(1)

        const result2 = wrapped(event, otherDest)
        expect(result2?.properties?.modified).toBeUndefined()
      })
    })
  })

  describe('Factory Functions', () => {
    it('should create destination manager', () => {
      const manager = createDestinationManager()
      expect(manager).toBeInstanceOf(DestinationManager)
    })

    it('should create console destination', () => {
      const dest = createConsoleDestination({ prefix: '[Test]' })
      expect(dest).toBeInstanceOf(ConsoleDestination)
      expect(dest.name).toBe('Console')
    })

    it('should create buffer destination', () => {
      const dest = createBufferDestination({ maxSize: 100 })
      expect(dest).toBeInstanceOf(BufferDestination)
    })

    it('should create callback destination', () => {
      const dest = createCallbackDestination({
        name: 'CustomCallback',
        track: vi.fn(),
      })
      expect(dest).toBeInstanceOf(CallbackDestination)
      expect(dest.name).toBe('CustomCallback')
    })
  })
})
