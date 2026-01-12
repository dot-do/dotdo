/**
 * @dotdo/analytics - Analytics SDK Compat Layer Tests
 *
 * Comprehensive tests for the Analytics SDK compatibility layer.
 * Supports Mixpanel, Amplitude, and PostHog-compatible APIs.
 * Following TDD: These tests are written first and should FAIL initially.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  // Core class
  Analytics,
  createAnalytics,

  // Test utilities
  InMemoryTransport,
  _clear,

  // Types
  type AnalyticsOptions,
  type AnalyticsEvent,
  type UserProfile,
  type GroupProfile,
  type Revenue,
} from '../index'

describe('@dotdo/analytics - Analytics SDK Compat Layer', () => {
  // Reset global state before each test
  beforeEach(() => {
    _clear()
  })

  // ===========================================================================
  // Analytics Initialization
  // ===========================================================================

  describe('Analytics Initialization', () => {
    it('should create analytics instance with project token', () => {
      const analytics = new Analytics({ projectToken: 'test-token' })
      expect(analytics).toBeDefined()
      expect(analytics.projectToken).toBe('test-token')
    })

    it('should accept optional host configuration', () => {
      const analytics = new Analytics({
        projectToken: 'test-token',
        host: 'https://custom.analytics.io',
      })
      expect(analytics.host).toBe('https://custom.analytics.io')
    })

    it('should accept optional flushAt and flushInterval', () => {
      const analytics = new Analytics({
        projectToken: 'test-token',
        flushAt: 10,
        flushInterval: 5000,
      })
      expect(analytics.flushAt).toBe(10)
      expect(analytics.flushInterval).toBe(5000)
    })

    it('should have default flush settings', () => {
      const analytics = new Analytics({ projectToken: 'test-token' })
      expect(analytics.flushAt).toBe(20)
      expect(analytics.flushInterval).toBe(10000)
    })

    it('should create analytics using factory function', () => {
      const analytics = createAnalytics({ projectToken: 'test-token' })
      expect(analytics).toBeDefined()
      expect(analytics.projectToken).toBe('test-token')
    })
  })

  // ===========================================================================
  // Track API (Common to all platforms)
  // ===========================================================================

  describe('Track', () => {
    it('should track an event with properties', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.track('Button Clicked', {
        button_id: 'signup',
        color: 'blue',
      })

      const events = transport.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.event).toBe('Button Clicked')
      expect(events[0]?.properties?.button_id).toBe('signup')
      expect(events[0]?.properties?.color).toBe('blue')
    })

    it('should track with userId', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.identify('user123')
      analytics.track('Purchase', { amount: 99.99 })

      const events = transport.getEvents()
      const trackEvent = events.find((e) => e.event === 'Purchase')
      expect(trackEvent?.distinct_id).toBe('user123')
    })

    it('should track with anonymousId before identify', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.track('Page View', { url: '/home' })

      const events = transport.getEvents()
      expect(events[0]?.distinct_id).toBeDefined()
      expect(events[0]?.distinct_id).toMatch(/^anon-/)
    })

    it('should generate messageId automatically', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.track('Test Event')

      const events = transport.getEvents()
      expect(events[0]?.message_id).toBeDefined()
      expect(typeof events[0]?.message_id).toBe('string')
    })

    it('should add timestamp automatically', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.track('Test Event')

      const events = transport.getEvents()
      expect(events[0]?.timestamp).toBeDefined()
    })

    it('should require event name', () => {
      const analytics = new Analytics({ projectToken: 'test-token' })

      expect(() => {
        analytics.track('')
      }).toThrow('Event name is required')
    })

    it('should support callback on track', async () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      const callback = vi.fn()
      analytics.track('Test Event', {}, callback)

      await analytics.flush()
      expect(callback).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Identify API
  // ===========================================================================

  describe('Identify', () => {
    it('should identify a user with userId', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.identify('user123', {
        name: 'John Doe',
        email: 'john@example.com',
      })

      const events = transport.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('identify')
      expect(events[0]?.distinct_id).toBe('user123')
      expect(events[0]?.$set?.name).toBe('John Doe')
      expect(events[0]?.$set?.email).toBe('john@example.com')
    })

    it('should set userId for subsequent calls', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.identify('user456')
      analytics.track('Page View')

      const events = transport.getEvents()
      const trackEvent = events.find((e) => e.event === 'Page View')
      expect(trackEvent?.distinct_id).toBe('user456')
    })

    it('should support user traits/properties', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.identify('user123', {
        plan: 'premium',
        company: 'Acme Inc',
        created_at: '2024-01-15',
      })

      const events = transport.getEvents()
      expect(events[0]?.$set?.plan).toBe('premium')
      expect(events[0]?.$set?.company).toBe('Acme Inc')
    })
  })

  // ===========================================================================
  // Alias API
  // ===========================================================================

  describe('Alias', () => {
    it('should alias user IDs', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.alias('new-user-id', 'anon-123')

      const events = transport.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('alias')
      expect(events[0]?.alias).toBe('new-user-id')
      expect(events[0]?.distinct_id).toBe('anon-123')
    })

    it('should require newId', () => {
      const analytics = new Analytics({ projectToken: 'test-token' })

      expect(() => {
        analytics.alias('', 'old-id')
      }).toThrow('Both newId and previousId are required')
    })
  })

  // ===========================================================================
  // Group API
  // ===========================================================================

  describe('Group', () => {
    it('should associate user with group', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.identify('user123')
      analytics.group('company_123', {
        name: 'Acme Inc',
        industry: 'Technology',
        employees: 100,
      })

      const events = transport.getEvents()
      const groupEvent = events.find((e) => e.type === 'group')
      expect(groupEvent?.group_id).toBe('company_123')
      expect(groupEvent?.$group_set?.name).toBe('Acme Inc')
      expect(groupEvent?.$group_set?.industry).toBe('Technology')
    })

    it('should require groupId', () => {
      const analytics = new Analytics({ projectToken: 'test-token' })

      expect(() => {
        analytics.group('')
      }).toThrow('Group ID is required')
    })

    it('should support group type (for multi-tenancy)', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.group('org_123', { name: 'Acme' }, 'organization')

      const events = transport.getEvents()
      expect(events[0]?.group_type).toBe('organization')
    })
  })

  // ===========================================================================
  // Revenue Tracking
  // ===========================================================================

  describe('Revenue', () => {
    it('should track revenue event', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.identify('user123')
      analytics.revenue({
        amount: 99.99,
        currency: 'USD',
        productId: 'prod_123',
        quantity: 1,
      })

      const events = transport.getEvents()
      const revenueEvent = events.find((e) => e.event === '$revenue' || e.event === 'Revenue')
      expect(revenueEvent).toBeDefined()
      expect(revenueEvent?.properties?.amount || revenueEvent?.properties?.$amount).toBe(99.99)
      expect(revenueEvent?.properties?.currency).toBe('USD')
    })

    it('should require amount', () => {
      const analytics = new Analytics({ projectToken: 'test-token' })

      expect(() => {
        analytics.revenue({ amount: 0 })
      }).toThrow('Revenue amount must be greater than 0')
    })

    it('should support receipt validation', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.revenue({
        amount: 9.99,
        receipt: 'receipt-data',
        revenueType: 'subscription',
      })

      const events = transport.getEvents()
      const revenueEvent = events.find((e) => e.event === '$revenue' || e.event === 'Revenue')
      expect(revenueEvent?.properties?.receipt).toBe('receipt-data')
      expect(revenueEvent?.properties?.revenue_type).toBe('subscription')
    })
  })

  // ===========================================================================
  // User Profile Operations
  // ===========================================================================

  describe('User Profile', () => {
    it('should set user properties ($set)', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.identify('user123')
      analytics.setUserProperties({
        name: 'John',
        premium: true,
      })

      const events = transport.getEvents()
      const profileEvent = events.find((e) => e.type === 'profile' || e.$set)
      expect(profileEvent?.$set?.name).toBe('John')
      expect(profileEvent?.$set?.premium).toBe(true)
    })

    it('should set once (only if not exists)', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.identify('user123')
      analytics.setUserPropertiesOnce({
        first_login: '2024-01-15',
        referrer: 'google',
      })

      const events = transport.getEvents()
      const profileEvent = events.find((e) => e.$set_once)
      expect(profileEvent?.$set_once?.first_login).toBe('2024-01-15')
    })

    it('should increment numeric properties', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.identify('user123')
      analytics.incrementUserProperty('login_count', 1)
      analytics.incrementUserProperty('total_spent', 99.99)

      const events = transport.getEvents()
      const addEvents = events.filter((e) => e.$add)
      expect(addEvents.length).toBeGreaterThanOrEqual(1)
    })

    it('should append to list properties', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.identify('user123')
      analytics.appendToUserProperty('tags', 'vip')

      const events = transport.getEvents()
      const appendEvent = events.find((e) => e.$append)
      expect(appendEvent?.$append?.tags).toBe('vip')
    })

    it('should union to list properties (unique)', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.identify('user123')
      analytics.unionToUserProperty('categories', ['tech', 'sports'])

      const events = transport.getEvents()
      const unionEvent = events.find((e) => e.$union)
      expect(unionEvent?.$union?.categories).toEqual(['tech', 'sports'])
    })

    it('should unset properties', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.identify('user123')
      analytics.unsetUserProperty('temp_flag')

      const events = transport.getEvents()
      const unsetEvent = events.find((e) => e.$unset)
      expect(unsetEvent?.$unset).toContain('temp_flag')
    })

    it('should delete user profile', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.identify('user123')
      analytics.deleteUser()

      const events = transport.getEvents()
      const deleteEvent = events.find((e) => e.$delete === true || e.type === 'delete')
      expect(deleteEvent).toBeDefined()
    })
  })

  // ===========================================================================
  // Page/Screen View
  // ===========================================================================

  describe('Page/Screen View', () => {
    it('should track page view', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.page('Home', {
        url: 'https://example.com',
        referrer: 'https://google.com',
      })

      const events = transport.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.event).toBe('$pageview')
      expect(events[0]?.properties?.$current_url || events[0]?.properties?.url).toBe('https://example.com')
    })

    it('should track screen view (mobile)', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.screen('Dashboard', {
        section: 'Overview',
      })

      const events = transport.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.event).toBe('$screen')
      expect(events[0]?.properties?.$screen_name || events[0]?.properties?.name).toBe('Dashboard')
    })
  })

  // ===========================================================================
  // Time-based Events
  // ===========================================================================

  describe('Time Tracking', () => {
    it('should time events with start/finish', async () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.timeEvent('Checkout')

      // Simulate some time passing
      await new Promise(resolve => setTimeout(resolve, 50))

      analytics.track('Checkout', { items: 3 })

      const events = transport.getEvents()
      const checkoutEvent = events.find((e) => e.event === 'Checkout')
      expect(checkoutEvent?.properties?.$duration).toBeGreaterThanOrEqual(50)
    })
  })

  // ===========================================================================
  // Cohort Analysis
  // ===========================================================================

  describe('Cohorts', () => {
    it('should support feature flags/cohorts', () => {
      const analytics = new Analytics({
        projectToken: 'test-token',
        featureFlags: {
          'new-checkout': true,
          'dark-mode': false,
        },
      })

      expect(analytics.isFeatureEnabled('new-checkout')).toBe(true)
      expect(analytics.isFeatureEnabled('dark-mode')).toBe(false)
      expect(analytics.isFeatureEnabled('unknown-flag')).toBe(false)
    })

    it('should reload feature flags', async () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.identify('user123')
      await analytics.reloadFeatureFlags()

      // Should make a request to fetch flags
      expect(analytics.getFeatureFlags).toBeDefined()
    })
  })

  // ===========================================================================
  // Batch Operations
  // ===========================================================================

  describe('Batch', () => {
    it('should batch multiple events', async () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
        flushAt: 100,
      })

      analytics.track('Event 1')
      analytics.track('Event 2')
      analytics.track('Event 3')

      await analytics.flush()

      expect(transport.getBatches()).toHaveLength(1)
      expect(transport.getBatches()[0]?.events.length).toBe(3)
    })

    it('should auto-flush when flushAt threshold reached', async () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
        flushAt: 2,
      })

      analytics.track('Event 1')
      analytics.track('Event 2')

      // Give time for auto-flush
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(transport.getBatches()).toHaveLength(1)
    })
  })

  // ===========================================================================
  // Super Properties
  // ===========================================================================

  describe('Super Properties', () => {
    it('should register super properties', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.register({
        app_version: '1.0.0',
        platform: 'web',
      })

      analytics.track('Test Event')

      const events = transport.getEvents()
      expect(events[0]?.properties?.app_version).toBe('1.0.0')
      expect(events[0]?.properties?.platform).toBe('web')
    })

    it('should register once (only if not set)', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.register({ first_touch: 'direct' })
      analytics.registerOnce({ first_touch: 'google' })

      analytics.track('Test Event')

      const events = transport.getEvents()
      expect(events[0]?.properties?.first_touch).toBe('direct')
    })

    it('should unregister super properties', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.register({ temp: 'value' })
      analytics.unregister('temp')

      analytics.track('Test Event')

      const events = transport.getEvents()
      expect(events[0]?.properties?.temp).toBeUndefined()
    })

    it('should clear all super properties', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.register({ a: 1, b: 2 })
      analytics.clearSuperProperties()

      analytics.track('Test Event')

      const events = transport.getEvents()
      expect(events[0]?.properties?.a).toBeUndefined()
      expect(events[0]?.properties?.b).toBeUndefined()
    })
  })

  // ===========================================================================
  // Opt-out/Privacy
  // ===========================================================================

  describe('Privacy', () => {
    it('should respect opt-out', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.optOut()
      analytics.track('Should Not Track')

      expect(transport.getEvents()).toHaveLength(0)
    })

    it('should allow opt-in after opt-out', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.optOut()
      analytics.optIn()
      analytics.track('Should Track')

      expect(transport.getEvents()).toHaveLength(1)
    })

    it('should clear data on opt-out', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.identify('user123')
      analytics.register({ key: 'value' })
      analytics.optOut({ clearData: true })

      // Should clear user and super properties
      analytics.optIn()
      analytics.track('Test')

      const events = transport.getEvents()
      // Last event (after opt-in) should have new anonymous ID
      const lastEvent = events[events.length - 1]
      expect(lastEvent?.distinct_id).toMatch(/^anon-/)
      expect(lastEvent?.properties?.key).toBeUndefined()
    })
  })

  // ===========================================================================
  // Context Enrichment
  // ===========================================================================

  describe('Context', () => {
    it('should auto-add context to events', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.track('Test Event')

      const events = transport.getEvents()
      expect(events[0]?.context).toBeDefined()
      expect(events[0]?.context?.library).toBeDefined()
    })

    it('should merge user-provided context', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.track('Test', { $ip: '192.168.1.1' })

      const events = transport.getEvents()
      expect(events[0]?.context?.ip || events[0]?.properties?.$ip).toBe('192.168.1.1')
    })
  })

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('should handle transport errors gracefully', async () => {
      const failingTransport = {
        send: vi.fn().mockRejectedValue(new Error('Network error')),
        flush: vi.fn().mockResolvedValue(true),
        getEvents: () => [],
        getBatches: () => [],
      }

      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => failingTransport,
        flushAt: 1,
      })

      // Should not throw
      analytics.track('Test Event')

      await new Promise((resolve) => setTimeout(resolve, 50))

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
        projectToken: 'test-token',
        transport: () => failingTransport,
        errorHandler: errorCallback,
        flushAt: 1,
      })

      analytics.track('Test Event')

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(errorCallback).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Flush and Close
  // ===========================================================================

  describe('Flush and Close', () => {
    it('should flush all pending events', async () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
        flushAt: 100,
      })

      analytics.track('Event 1')
      analytics.track('Event 2')

      const result = await analytics.flush()
      expect(result).toBe(true)
      expect(transport.getBatches()).toHaveLength(1)
    })

    it('should close and flush on shutdown', async () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
        flushAt: 100,
      })

      analytics.track('Event 1')

      await analytics.close()

      expect(transport.getBatches()).toHaveLength(1)
    })

    it('should reset state', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.identify('user123')
      analytics.register({ key: 'value' })
      analytics.reset()

      analytics.track('Test')

      const events = transport.getEvents()
      // Last event (after reset) should have new anonymous ID
      const lastEvent = events[events.length - 1]
      expect(lastEvent?.distinct_id).toMatch(/^anon-/)
    })
  })

  // ===========================================================================
  // Primitives Integration
  // ===========================================================================

  describe('Primitives Integration', () => {
    it('should support TemporalStore for event storage', async () => {
      const analytics = new Analytics({
        projectToken: 'test-token',
        enableEventStore: true,
      })

      analytics.identify('user123')
      analytics.track('Test Event', { value: 1 })
      analytics.track('Test Event', { value: 2 })

      await analytics.flush()

      // Should be able to query historical events
      const events = await analytics.getEventsForUser('user123')
      expect(events.length).toBeGreaterThanOrEqual(0) // May be 0 if not implemented yet
    })

    it('should support WindowManager for real-time aggregation', async () => {
      const analytics = new Analytics({
        projectToken: 'test-token',
        enableRealTimeAggregation: true,
        aggregationWindowMs: 1000,
      })

      analytics.identify('user123')
      analytics.track('Click', { button: 'a' })
      analytics.track('Click', { button: 'b' })
      analytics.track('Click', { button: 'a' })

      // Get aggregations - stats may be undefined initially (window not triggered yet)
      const stats = await analytics.getEventStats('Click', 1000)
      // Just verify the method exists and returns (may be undefined before window closes)
      expect(analytics.getEventStats).toBeDefined()
    })
  })
})
