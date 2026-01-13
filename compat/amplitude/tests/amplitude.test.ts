/**
 * @dotdo/amplitude - Amplitude SDK Compat Layer Tests
 *
 * Comprehensive tests for the Amplitude SDK compatibility layer.
 * Following TDD RED-GREEN-REFACTOR: These tests are written first.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  // Core classes
  Amplitude,
  createAmplitudeClient,

  // Identify helper
  Identify,
  createIdentify,

  // Revenue helper
  Revenue,
  createRevenue,

  // InMemory transport for testing
  InMemoryTransport,

  // Types
  type AmplitudeOptions,
  type BaseEvent,
  type TrackEventOptions,
} from '../index'

describe('@dotdo/amplitude - Amplitude SDK Compat Layer', () => {
  // ===========================================================================
  // Initialization
  // ===========================================================================

  describe('Initialization', () => {
    it('should create client with API key', () => {
      const client = createAmplitudeClient({ apiKey: 'test-api-key' })
      expect(client).toBeDefined()
      expect(client.apiKey).toBe('test-api-key')
    })

    it('should accept optional configuration', () => {
      const client = new Amplitude({
        apiKey: 'test-key',
        serverUrl: 'https://custom.amplitude.com',
        flushQueueSize: 50,
        flushIntervalMillis: 5000,
      })
      expect(client.config.serverUrl).toBe('https://custom.amplitude.com')
      expect(client.config.flushQueueSize).toBe(50)
      expect(client.config.flushIntervalMillis).toBe(5000)
    })

    it('should have default configuration values', () => {
      const client = new Amplitude({ apiKey: 'test-key' })
      expect(client.config.flushQueueSize).toBe(30)
      expect(client.config.flushIntervalMillis).toBe(10000)
      expect(client.config.flushMaxRetries).toBe(3)
    })

    it('should require API key', () => {
      expect(() => new Amplitude({ apiKey: '' })).toThrow()
    })
  })

  // ===========================================================================
  // Track Events
  // ===========================================================================

  describe('Track', () => {
    it('should track an event with user_id', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      await client.track('Button Clicked', { button_name: 'signup' }, { user_id: 'user123' })

      const events = transport.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.event_type).toBe('Button Clicked')
      expect(events[0]?.user_id).toBe('user123')
      expect(events[0]?.event_properties?.button_name).toBe('signup')
    })

    it('should track an event with device_id', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      await client.track('Page View', { page: '/home' }, { device_id: 'device-456' })

      const events = transport.getEvents()
      expect(events[0]?.device_id).toBe('device-456')
    })

    it('should auto-generate insert_id for deduplication', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      await client.track('Test Event', {}, { user_id: 'u1' })

      const events = transport.getEvents()
      expect(events[0]?.insert_id).toBeDefined()
      expect(typeof events[0]?.insert_id).toBe('string')
    })

    it('should auto-generate timestamp', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      const before = Date.now()
      await client.track('Test Event', {}, { user_id: 'u1' })
      const after = Date.now()

      const events = transport.getEvents()
      expect(events[0]?.time).toBeDefined()
      expect(events[0]?.time).toBeGreaterThanOrEqual(before)
      expect(events[0]?.time).toBeLessThanOrEqual(after)
    })

    it('should track with BaseEvent object', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      await client.track({
        event_type: 'Order Completed',
        user_id: 'user789',
        event_properties: {
          order_id: 'order_123',
          total: 99.99,
        },
      })

      const events = transport.getEvents()
      expect(events[0]?.event_type).toBe('Order Completed')
      expect(events[0]?.event_properties?.order_id).toBe('order_123')
    })

    it('should require user_id or device_id', async () => {
      const client = new Amplitude({ apiKey: 'test-key' })

      await expect(client.track('Test', {})).rejects.toThrow()
    })
  })

  // ===========================================================================
  // Identify (User Properties)
  // ===========================================================================

  describe('Identify', () => {
    it('should set user properties with $set', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      const identify = createIdentify()
        .set('name', 'John Doe')
        .set('email', 'john@example.com')
        .set('plan', 'premium')

      await client.identify(identify, { user_id: 'user123' })

      const events = transport.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.event_type).toBe('$identify')
      expect(events[0]?.user_properties?.$set?.name).toBe('John Doe')
      expect(events[0]?.user_properties?.$set?.email).toBe('john@example.com')
    })

    it('should support $setOnce', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      const identify = createIdentify()
        .setOnce('first_seen', '2026-01-01')
        .setOnce('signup_source', 'organic')

      await client.identify(identify, { user_id: 'user123' })

      const events = transport.getEvents()
      expect(events[0]?.user_properties?.$setOnce?.first_seen).toBe('2026-01-01')
    })

    it('should support $add for numeric properties', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      const identify = createIdentify()
        .add('login_count', 1)
        .add('points', 100)

      await client.identify(identify, { user_id: 'user123' })

      const events = transport.getEvents()
      expect(events[0]?.user_properties?.$add?.login_count).toBe(1)
      expect(events[0]?.user_properties?.$add?.points).toBe(100)
    })

    it('should support $append for array properties', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      const identify = createIdentify()
        .append('tags', 'vip')
        .append('viewed_products', 'prod_123')

      await client.identify(identify, { user_id: 'user123' })

      const events = transport.getEvents()
      expect(events[0]?.user_properties?.$append?.tags).toBe('vip')
    })

    it('should support $prepend for array properties', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      const identify = createIdentify().prepend('recent_items', 'item_abc')

      await client.identify(identify, { user_id: 'user123' })

      const events = transport.getEvents()
      expect(events[0]?.user_properties?.$prepend?.recent_items).toBe('item_abc')
    })

    it('should support $unset', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      const identify = createIdentify()
        .unset('temporary_flag')
        .unset('old_property')

      await client.identify(identify, { user_id: 'user123' })

      const events = transport.getEvents()
      expect(events[0]?.user_properties?.$unset?.temporary_flag).toBe('-')
      expect(events[0]?.user_properties?.$unset?.old_property).toBe('-')
    })

    it('should support $clearAll', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      const identify = createIdentify().clearAll()

      await client.identify(identify, { user_id: 'user123' })

      const events = transport.getEvents()
      expect(events[0]?.user_properties?.$clearAll).toBe(true)
    })

    it('should chain multiple operations', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      const identify = createIdentify()
        .set('name', 'Alice')
        .setOnce('signup_date', '2026-01-13')
        .add('session_count', 1)
        .append('visited_pages', '/pricing')

      await client.identify(identify, { user_id: 'user123' })

      const events = transport.getEvents()
      const props = events[0]?.user_properties
      expect(props?.$set?.name).toBe('Alice')
      expect(props?.$setOnce?.signup_date).toBe('2026-01-13')
      expect(props?.$add?.session_count).toBe(1)
      expect(props?.$append?.visited_pages).toBe('/pricing')
    })
  })

  // ===========================================================================
  // Revenue Tracking
  // ===========================================================================

  describe('Revenue', () => {
    it('should track revenue with required price', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      const revenue = createRevenue().setPrice(29.99)

      await client.revenue(revenue, { user_id: 'user123' })

      const events = transport.getEvents()
      expect(events[0]?.event_type).toBe('revenue_amount')
      expect(events[0]?.price).toBe(29.99)
    })

    it('should track revenue with quantity', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      const revenue = createRevenue()
        .setPrice(9.99)
        .setQuantity(3)

      await client.revenue(revenue, { user_id: 'user123' })

      const events = transport.getEvents()
      expect(events[0]?.price).toBe(9.99)
      expect(events[0]?.quantity).toBe(3)
      expect(events[0]?.revenue).toBe(29.97) // 9.99 * 3
    })

    it('should track revenue with product ID', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      const revenue = createRevenue()
        .setPrice(99.00)
        .setProductId('prod_premium_annual')

      await client.revenue(revenue, { user_id: 'user123' })

      const events = transport.getEvents()
      expect(events[0]?.productId).toBe('prod_premium_annual')
    })

    it('should track revenue with revenue type', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      const revenue = createRevenue()
        .setPrice(49.99)
        .setRevenueType('subscription')

      await client.revenue(revenue, { user_id: 'user123' })

      const events = transport.getEvents()
      expect(events[0]?.revenueType).toBe('subscription')
    })

    it('should include event properties in revenue event', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      const revenue = createRevenue()
        .setPrice(199.99)
        .setEventProperties({
          coupon_code: 'SAVE20',
          payment_method: 'credit_card',
        })

      await client.revenue(revenue, { user_id: 'user123' })

      const events = transport.getEvents()
      expect(events[0]?.event_properties?.coupon_code).toBe('SAVE20')
      expect(events[0]?.event_properties?.payment_method).toBe('credit_card')
    })

    it('should require price to be set', async () => {
      const client = new Amplitude({ apiKey: 'test-key' })
      const revenue = createRevenue() // No price set

      await expect(client.revenue(revenue, { user_id: 'user123' })).rejects.toThrow()
    })
  })

  // ===========================================================================
  // Group Analytics
  // ===========================================================================

  describe('Groups', () => {
    it('should set group membership', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      await client.setGroup('company', 'acme-inc', { user_id: 'user123' })

      const events = transport.getEvents()
      expect(events[0]?.event_type).toBe('$identify')
      expect(events[0]?.groups?.company).toBe('acme-inc')
    })

    it('should support multiple group values', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      await client.setGroup('team', ['engineering', 'platform'], { user_id: 'user123' })

      const events = transport.getEvents()
      expect(events[0]?.groups?.team).toEqual(['engineering', 'platform'])
    })

    it('should identify group properties', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      const groupIdentify = createIdentify()
        .set('name', 'Acme Inc')
        .set('industry', 'Technology')
        .set('employees', 500)

      await client.groupIdentify('company', 'acme-inc', groupIdentify)

      const events = transport.getEvents()
      expect(events[0]?.event_type).toBe('$groupidentify')
      expect(events[0]?.groups?.company).toBe('acme-inc')
      expect(events[0]?.group_properties?.$set?.name).toBe('Acme Inc')
    })

    it('should track events with group context', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      await client.track('Feature Used', { feature: 'export' }, {
        user_id: 'user123',
        groups: { company: 'acme-inc' },
      })

      const events = transport.getEvents()
      expect(events[0]?.groups?.company).toBe('acme-inc')
    })
  })

  // ===========================================================================
  // Batching and Flush
  // ===========================================================================

  describe('Batching', () => {
    it('should batch events before sending', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
        flushQueueSize: 100, // High threshold
        flushIntervalMillis: 60000, // Long interval
      })

      // Track multiple events
      await client.track('Event 1', {}, { user_id: 'u1' })
      await client.track('Event 2', {}, { user_id: 'u2' })
      await client.track('Event 3', {}, { user_id: 'u3' })

      // Events should be queued
      expect(client.queueSize).toBe(3)

      // Manually flush
      await client.flush()

      // Transport should receive all events
      expect(transport.getBatches()).toHaveLength(1)
      expect(transport.getBatches()[0]).toHaveLength(3)
    })

    it('should auto-flush when queue size threshold reached', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
        flushQueueSize: 2, // Low threshold
        flushIntervalMillis: 60000,
      })

      await client.track('Event 1', {}, { user_id: 'u1' })
      await client.track('Event 2', {}, { user_id: 'u2' })

      // Should have auto-flushed
      await new Promise((r) => setTimeout(r, 50))
      expect(transport.getBatches()).toHaveLength(1)
    })

    it('should flush on shutdown', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
        flushQueueSize: 100,
      })

      await client.track('Event 1', {}, { user_id: 'u1' })

      await client.shutdown()

      expect(transport.getBatches()).toHaveLength(1)
    })
  })

  // ===========================================================================
  // Session Management
  // ===========================================================================

  describe('Sessions', () => {
    it('should set session ID', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      const sessionId = Date.now()
      client.setSessionId(sessionId)

      await client.track('Test Event', {}, { user_id: 'u1' })

      const events = transport.getEvents()
      expect(events[0]?.session_id).toBe(sessionId)
    })

    it('should get current session ID', () => {
      const client = new Amplitude({ apiKey: 'test-key' })

      const sessionId = 1705123456789
      client.setSessionId(sessionId)

      expect(client.getSessionId()).toBe(sessionId)
    })
  })

  // ===========================================================================
  // User/Device ID Management
  // ===========================================================================

  describe('User and Device ID', () => {
    it('should set user ID globally', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      client.setUserId('global-user-123')

      await client.track('Test Event', {})

      const events = transport.getEvents()
      expect(events[0]?.user_id).toBe('global-user-123')
    })

    it('should set device ID globally', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      client.setDeviceId('global-device-456')

      await client.track('Test Event', {})

      const events = transport.getEvents()
      expect(events[0]?.device_id).toBe('global-device-456')
    })

    it('should get current user ID', () => {
      const client = new Amplitude({ apiKey: 'test-key' })

      client.setUserId('user-abc')

      expect(client.getUserId()).toBe('user-abc')
    })

    it('should get current device ID', () => {
      const client = new Amplitude({ apiKey: 'test-key' })

      client.setDeviceId('device-xyz')

      expect(client.getDeviceId()).toBe('device-xyz')
    })

    it('should reset user state', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      client.setUserId('user-123')
      client.setDeviceId('device-456')

      client.reset()

      expect(client.getUserId()).toBeUndefined()
      // Device ID should get a new value or be undefined
    })
  })

  // ===========================================================================
  // Plugins
  // ===========================================================================

  describe('Plugins', () => {
    it('should add plugin', async () => {
      const client = new Amplitude({ apiKey: 'test-key' })

      const plugin = {
        name: 'TestPlugin',
        type: 'enrichment' as const,
        setup: vi.fn().mockResolvedValue(undefined),
        execute: vi.fn().mockImplementation((e) => Promise.resolve(e)),
      }

      await client.add(plugin)

      expect(plugin.setup).toHaveBeenCalled()
    })

    it('should execute enrichment plugins', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      const enrichPlugin = {
        name: 'Enricher',
        type: 'enrichment' as const,
        setup: vi.fn().mockResolvedValue(undefined),
        execute: vi.fn().mockImplementation((event: BaseEvent) =>
          Promise.resolve({
            ...event,
            event_properties: {
              ...event.event_properties,
              enriched: true,
            },
          })
        ),
      }

      await client.add(enrichPlugin)
      await client.track('Test', {}, { user_id: 'u1' })

      const events = transport.getEvents()
      expect(events[0]?.event_properties?.enriched).toBe(true)
    })

    it('should remove plugin', async () => {
      const client = new Amplitude({ apiKey: 'test-key' })

      const plugin = {
        name: 'Removable',
        type: 'enrichment' as const,
        setup: vi.fn().mockResolvedValue(undefined),
        execute: vi.fn().mockImplementation((e) => Promise.resolve(e)),
        teardown: vi.fn().mockResolvedValue(undefined),
      }

      await client.add(plugin)
      await client.remove(plugin.name)

      expect(plugin.teardown).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('should handle transport errors gracefully', async () => {
      const failingTransport = {
        send: vi.fn().mockRejectedValue(new Error('Network error')),
        getEvents: () => [],
        getBatches: () => [],
      }

      const client = new Amplitude({
        apiKey: 'test-key',
        transport: failingTransport as any,
        flushQueueSize: 1,
      })

      // Should not throw
      await expect(
        client.track('Test', {}, { user_id: 'u1' })
      ).resolves.not.toThrow()
    })

    it('should retry on transient errors', async () => {
      let attempts = 0
      const retryingTransport = {
        send: vi.fn().mockImplementation(() => {
          attempts++
          if (attempts < 3) {
            return Promise.reject(new Error('Temporary error'))
          }
          return Promise.resolve({ code: 200, events_ingested: 1 })
        }),
        getEvents: () => [],
        getBatches: () => [],
      }

      const client = new Amplitude({
        apiKey: 'test-key',
        transport: retryingTransport as any,
        flushQueueSize: 100, // High threshold to prevent auto-flush
        flushMaxRetries: 5,
      })

      await client.track('Test', {}, { user_id: 'u1' })
      await client.flush()

      // Wait for retry backoff to complete
      await new Promise((r) => setTimeout(r, 500))

      expect(attempts).toBeGreaterThanOrEqual(3)
    })
  })

  // ===========================================================================
  // Library Context
  // ===========================================================================

  describe('Library Context', () => {
    it('should include library info in events', async () => {
      const transport = new InMemoryTransport()
      const client = new Amplitude({
        apiKey: 'test-key',
        transport,
      })

      await client.track('Test', {}, { user_id: 'u1' })

      const events = transport.getEvents()
      expect(events[0]?.library).toContain('@dotdo/amplitude')
    })
  })
})
