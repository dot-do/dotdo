/**
 * @dotdo/analytics - Amplitude SDK Compat Layer Tests
 *
 * Tests for Amplitude-compatible API.
 * Following TDD: These tests are written first and should FAIL initially.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  Amplitude,
  createAmplitude,
  InMemoryTransport,
  _clear,
} from '../index'

describe('@dotdo/analytics/amplitude - Amplitude SDK Compat Layer', () => {
  beforeEach(() => {
    _clear()
  })

  // ===========================================================================
  // Amplitude Initialization
  // ===========================================================================

  describe('Initialization', () => {
    it('should create Amplitude instance with API key', () => {
      const amplitude = new Amplitude({ apiKey: 'test-api-key' })
      expect(amplitude).toBeDefined()
      expect(amplitude.apiKey).toBe('test-api-key')
    })

    it('should create using factory function', () => {
      const amplitude = createAmplitude({ apiKey: 'test-api-key' })
      expect(amplitude).toBeDefined()
    })

    it('should support custom server URL', () => {
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        serverUrl: 'https://custom.amplitude.com',
      })
      expect(amplitude.config.serverUrl).toBe('https://custom.amplitude.com')
    })

    it('should support flush configuration', () => {
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        flushIntervalMillis: 5000,
        flushQueueSize: 10,
      })
      expect(amplitude.config.flushIntervalMillis).toBe(5000)
      expect(amplitude.config.flushQueueSize).toBe(10)
    })
  })

  // ===========================================================================
  // Track API
  // ===========================================================================

  describe('Track', () => {
    it('should track events', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      amplitude.track('Button Clicked', {
        button_id: 'signup',
      })

      const events = transport.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.event_type).toBe('Button Clicked')
      expect(events[0]?.event_properties?.button_id).toBe('signup')
    })

    it('should include user_id', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      amplitude.setUserId('user123')
      amplitude.track('Test')

      const events = transport.getEvents()
      expect(events[0]?.user_id).toBe('user123')
    })

    it('should include device_id', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      amplitude.setDeviceId('device123')
      amplitude.track('Test')

      const events = transport.getEvents()
      expect(events[0]?.device_id).toBe('device123')
    })

    it('should include time', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      amplitude.track('Test')

      const events = transport.getEvents()
      expect(events[0]?.time).toBeDefined()
    })

    it('should support event options', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      amplitude.track('Test', { key: 'value' }, {
        insert_id: 'unique-insert-id',
        price: 9.99,
        quantity: 2,
      })

      const events = transport.getEvents()
      expect(events[0]?.insert_id).toBe('unique-insert-id')
      expect(events[0]?.price).toBe(9.99)
      expect(events[0]?.quantity).toBe(2)
    })

    it('should support callback', async () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      const callback = vi.fn()
      amplitude.track('Test', {}, undefined, callback)

      await amplitude.flush()
      expect(callback).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Identify API
  // ===========================================================================

  describe('Identify', () => {
    it('should identify user with Identify object', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      const identify = new amplitude.Identify()
      identify.set('name', 'John Doe')
      identify.set('email', 'john@example.com')

      amplitude.identify(identify)

      const events = transport.getEvents()
      const identifyEvent = events.find((e) => e.event_type === '$identify')
      expect(identifyEvent?.user_properties?.$set?.name).toBe('John Doe')
    })

    it('should set user properties', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      const identify = new amplitude.Identify()
      identify.set('plan', 'premium')

      amplitude.identify(identify)

      const events = transport.getEvents()
      expect(events.find((e) => e.user_properties?.$set?.plan)).toBeDefined()
    })

    it('should setOnce user properties', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      const identify = new amplitude.Identify()
      identify.setOnce('first_login', '2024-01-15')

      amplitude.identify(identify)

      const events = transport.getEvents()
      expect(events.find((e) => e.user_properties?.$setOnce?.first_login)).toBeDefined()
    })

    it('should add to user properties', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      const identify = new amplitude.Identify()
      identify.add('login_count', 1)

      amplitude.identify(identify)

      const events = transport.getEvents()
      expect(events.find((e) => e.user_properties?.$add?.login_count)).toBeDefined()
    })

    it('should append to user properties', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      const identify = new amplitude.Identify()
      identify.append('tags', 'vip')

      amplitude.identify(identify)

      const events = transport.getEvents()
      expect(events.find((e) => e.user_properties?.$append?.tags)).toBeDefined()
    })

    it('should prepend to user properties', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      const identify = new amplitude.Identify()
      identify.prepend('recent_products', 'product_123')

      amplitude.identify(identify)

      const events = transport.getEvents()
      expect(events.find((e) => e.user_properties?.$prepend?.recent_products)).toBeDefined()
    })

    it('should unset user properties', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      const identify = new amplitude.Identify()
      identify.unset('temp_flag')

      amplitude.identify(identify)

      const events = transport.getEvents()
      expect(events.find((e) => e.user_properties?.$unset?.temp_flag)).toBeDefined()
    })

    it('should preInsert to user properties', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      const identify = new amplitude.Identify()
      identify.preInsert('categories', 'new-category')

      amplitude.identify(identify)

      const events = transport.getEvents()
      expect(events.find((e) => e.user_properties?.$preInsert?.categories)).toBeDefined()
    })

    it('should postInsert to user properties', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      const identify = new amplitude.Identify()
      identify.postInsert('categories', 'new-category')

      amplitude.identify(identify)

      const events = transport.getEvents()
      expect(events.find((e) => e.user_properties?.$postInsert?.categories)).toBeDefined()
    })

    it('should remove from user properties', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      const identify = new amplitude.Identify()
      identify.remove('tags', 'old-tag')

      amplitude.identify(identify)

      const events = transport.getEvents()
      expect(events.find((e) => e.user_properties?.$remove?.tags)).toBeDefined()
    })

    it('should clearAll user properties', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      const identify = new amplitude.Identify()
      identify.clearAll()

      amplitude.identify(identify)

      const events = transport.getEvents()
      expect(events.find((e) => e.user_properties?.$clearAll === '-')).toBeDefined()
    })
  })

  // ===========================================================================
  // Group API
  // ===========================================================================

  describe('Group', () => {
    it('should set group', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      amplitude.setGroup('company', 'company_123')
      amplitude.track('Test')

      const events = transport.getEvents()
      expect(events.find((e) => e.groups?.company === 'company_123')).toBeDefined()
    })

    it('should set multiple groups', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      amplitude.setGroup('company', ['company_1', 'company_2'])
      amplitude.track('Test')

      const events = transport.getEvents()
      const trackEvent = events.find((e) => e.event_type === 'Test')
      expect(trackEvent?.groups?.company).toEqual(['company_1', 'company_2'])
    })

    it('should identify group with GroupIdentify', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      const groupIdentify = new amplitude.Identify()
      groupIdentify.set('name', 'Acme Inc')
      groupIdentify.set('employees', 100)

      amplitude.groupIdentify('company', 'company_123', groupIdentify)

      const events = transport.getEvents()
      const groupEvent = events.find((e) => e.event_type === '$groupidentify')
      expect(groupEvent?.group_properties?.$set?.name).toBe('Acme Inc')
    })
  })

  // ===========================================================================
  // Revenue API
  // ===========================================================================

  describe('Revenue', () => {
    it('should track revenue with Revenue object', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      const revenue = new amplitude.Revenue()
      revenue.setProductId('prod_123')
      revenue.setPrice(9.99)
      revenue.setQuantity(2)

      amplitude.revenue(revenue)

      const events = transport.getEvents()
      const revenueEvent = events.find((e) => e.event_type === 'revenue_amount')
      expect(revenueEvent?.event_properties?.$productId).toBe('prod_123')
      expect(revenueEvent?.event_properties?.$price).toBe(9.99)
      expect(revenueEvent?.event_properties?.$quantity).toBe(2)
    })

    it('should set revenue type', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      const revenue = new amplitude.Revenue()
      revenue.setPrice(49.99)
      revenue.setRevenueType('subscription')

      amplitude.revenue(revenue)

      const events = transport.getEvents()
      expect(events.find((e) => e.event_properties?.$revenueType === 'subscription')).toBeDefined()
    })

    it('should set receipt', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      const revenue = new amplitude.Revenue()
      revenue.setPrice(4.99)
      revenue.setReceipt('receipt-data', 'signature')

      amplitude.revenue(revenue)

      const events = transport.getEvents()
      expect(events.find((e) => e.event_properties?.$receipt === 'receipt-data')).toBeDefined()
    })
  })

  // ===========================================================================
  // User Session
  // ===========================================================================

  describe('User Session', () => {
    it('should set session ID', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      amplitude.setSessionId(12345678)
      amplitude.track('Test')

      const events = transport.getEvents()
      expect(events[0]?.session_id).toBe(12345678)
    })

    it('should get session ID', () => {
      const amplitude = new Amplitude({ apiKey: 'test-api-key' })

      amplitude.setSessionId(12345678)
      expect(amplitude.getSessionId()).toBe(12345678)
    })
  })

  // ===========================================================================
  // Device and User Management
  // ===========================================================================

  describe('Device and User Management', () => {
    it('should set and get user ID', () => {
      const amplitude = new Amplitude({ apiKey: 'test-api-key' })

      amplitude.setUserId('user123')
      expect(amplitude.getUserId()).toBe('user123')
    })

    it('should set and get device ID', () => {
      const amplitude = new Amplitude({ apiKey: 'test-api-key' })

      amplitude.setDeviceId('device123')
      expect(amplitude.getDeviceId()).toBe('device123')
    })

    it('should reset', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      amplitude.setUserId('user123')
      amplitude.reset()

      expect(amplitude.getUserId()).toBeUndefined()
    })
  })

  // ===========================================================================
  // Opt Out
  // ===========================================================================

  describe('Opt Out', () => {
    it('should opt out', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      amplitude.setOptOut(true)
      amplitude.track('Should Not Track')

      expect(transport.getEvents()).toHaveLength(0)
    })

    it('should opt in', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      amplitude.setOptOut(true)
      amplitude.setOptOut(false)
      amplitude.track('Should Track')

      expect(transport.getEvents()).toHaveLength(1)
    })
  })

  // ===========================================================================
  // Flush
  // ===========================================================================

  describe('Flush', () => {
    it('should flush events', async () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
        flushQueueSize: 100,
      })

      amplitude.track('Event 1')
      amplitude.track('Event 2')

      await amplitude.flush()

      expect(transport.getBatches().length).toBeGreaterThanOrEqual(1)
    })
  })

  // ===========================================================================
  // Plugins
  // ===========================================================================

  describe('Plugins', () => {
    it('should add plugin', async () => {
      const amplitude = new Amplitude({ apiKey: 'test-api-key' })

      const plugin = {
        name: 'test-plugin',
        type: 'enrichment' as const,
        setup: vi.fn().mockResolvedValue(undefined),
        execute: vi.fn((event) => event),
      }

      await amplitude.add(plugin)

      expect(plugin.setup).toHaveBeenCalled()
    })

    it('should remove plugin', async () => {
      const amplitude = new Amplitude({ apiKey: 'test-api-key' })

      const plugin = {
        name: 'test-plugin',
        type: 'enrichment' as const,
        setup: vi.fn().mockResolvedValue(undefined),
        execute: vi.fn((event) => event),
        teardown: vi.fn(),
      }

      await amplitude.add(plugin)
      await amplitude.remove('test-plugin')

      // Plugin should be removed (cannot easily verify, but teardown should be called)
      expect(plugin.teardown).toHaveBeenCalled()
    })
  })
})
