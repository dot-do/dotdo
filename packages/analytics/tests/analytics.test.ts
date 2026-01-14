/**
 * @dotdo/analytics - Analytics SDK Tests
 *
 * Comprehensive tests for the Analytics SDK.
 * Supports Mixpanel, Amplitude, and PostHog-compatible APIs.
 * Following TDD: RED phase - tests written first.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  // Core class
  Analytics,
  createAnalytics,

  // Test utilities
  InMemoryTransport,
  _clear,

  // Platform-specific APIs
  Mixpanel,
  createMixpanel,
  Amplitude,
  createAmplitude,
  Identify,
  Revenue,
  PostHog,
  createPostHog,

  // Types
  type AnalyticsOptions,
  type AnalyticsEvent,
} from '../src/index'

describe('@dotdo/analytics - Analytics SDK', () => {
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
  // Track API
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

    it('should increment numeric properties', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        projectToken: 'test-token',
        transport: () => transport,
      })

      analytics.identify('user123')
      analytics.incrementUserProperty('login_count', 1)

      const events = transport.getEvents()
      const addEvents = events.filter((e) => e.$add)
      expect(addEvents.length).toBeGreaterThanOrEqual(1)
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
  })

  // ===========================================================================
  // Privacy
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
  })

  // ===========================================================================
  // Mixpanel-compatible API
  // ===========================================================================

  describe('Mixpanel', () => {
    it('should create Mixpanel instance with token', () => {
      const mixpanel = new Mixpanel({ token: 'test-token' })
      expect(mixpanel).toBeDefined()
      expect(mixpanel.token).toBe('test-token')
    })

    it('should create Mixpanel using factory function', () => {
      const mixpanel = createMixpanel({ token: 'test-token' })
      expect(mixpanel).toBeDefined()
      expect(mixpanel.token).toBe('test-token')
    })

    it('should track events', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.track('Button Clicked', { button_id: 'signup' })

      const events = transport.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.event).toBe('Button Clicked')
    })

    it('should identify users', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.identify('user123')
      expect(mixpanel.get_distinct_id()).toBe('user123')
    })

    it('should support people API', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.identify('user123')
      mixpanel.people.set({ name: 'John', plan: 'premium' })

      const events = transport.getEvents()
      const setEvent = events.find((e) => e.$set)
      expect(setEvent?.$set?.name).toBe('John')
    })

    it('should register super properties', () => {
      const transport = new InMemoryTransport()
      const mixpanel = new Mixpanel({
        token: 'test-token',
        transport: () => transport,
      })

      mixpanel.register({ version: '1.0' })
      mixpanel.track('Test')

      const events = transport.getEvents()
      expect(events[0]?.properties?.version).toBe('1.0')
    })
  })

  // ===========================================================================
  // Amplitude-compatible API
  // ===========================================================================

  describe('Amplitude', () => {
    it('should create Amplitude instance with apiKey', () => {
      const amplitude = new Amplitude({ apiKey: 'test-api-key' })
      expect(amplitude).toBeDefined()
      expect(amplitude.apiKey).toBe('test-api-key')
    })

    it('should create Amplitude using factory function', () => {
      const amplitude = createAmplitude({ apiKey: 'test-api-key' })
      expect(amplitude).toBeDefined()
      expect(amplitude.apiKey).toBe('test-api-key')
    })

    it('should track events', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      amplitude.track('Purchase', { product_id: 'prod_123' })

      const events = transport.getEvents()
      expect(events).toHaveLength(1)
      expect((events[0] as any)?.event_type).toBe('Purchase')
    })

    it('should set user ID', () => {
      const amplitude = new Amplitude({ apiKey: 'test-api-key' })

      amplitude.setUserId('user123')
      expect(amplitude.getUserId()).toBe('user123')
    })

    it('should support Identify class', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      const identify = new Identify()
      identify.set('plan', 'premium')
      identify.setOnce('signup_date', '2024-01-15')

      amplitude.identify(identify)

      const events = transport.getEvents()
      expect(events).toHaveLength(1)
      expect((events[0] as any)?.event_type).toBe('$identify')
    })

    it('should support Revenue class', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      const revenue = new Revenue()
      revenue.setProductId('prod_123').setPrice(9.99).setQuantity(2)

      amplitude.revenue(revenue)

      const events = transport.getEvents()
      expect(events).toHaveLength(1)
      expect((events[0] as any)?.event_type).toBe('revenue_amount')
    })

    it('should set groups', () => {
      const transport = new InMemoryTransport()
      const amplitude = new Amplitude({
        apiKey: 'test-api-key',
        transport: () => transport,
      })

      amplitude.setGroup('company', 'acme-inc')
      amplitude.track('Test')

      const events = transport.getEvents()
      expect((events[0] as any)?.groups?.company).toBe('acme-inc')
    })
  })

  // ===========================================================================
  // PostHog-compatible API
  // ===========================================================================

  describe('PostHog', () => {
    it('should create PostHog instance with apiKey', () => {
      const posthog = new PostHog({ apiKey: 'phc_test_key' })
      expect(posthog).toBeDefined()
      expect(posthog.apiKey).toBe('phc_test_key')
    })

    it('should create PostHog using factory function', () => {
      const posthog = createPostHog({ apiKey: 'phc_test_key' })
      expect(posthog).toBeDefined()
      expect(posthog.apiKey).toBe('phc_test_key')
    })

    it('should capture events', () => {
      const transport = new InMemoryTransport()
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        transport: () => transport,
      })

      posthog.capture('Button Clicked', { button_id: 'signup' })

      const events = transport.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.event).toBe('Button Clicked')
    })

    it('should identify users', () => {
      const transport = new InMemoryTransport()
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        transport: () => transport,
      })

      posthog.identify('user123', { name: 'John' })

      const events = transport.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.distinct_id).toBe('user123')
    })

    it('should support feature flags', () => {
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        bootstrap: {
          featureFlags: {
            'new-checkout': true,
            'dark-mode': false,
          },
        },
      })

      expect(posthog.isFeatureEnabled('new-checkout')).toBe(true)
      expect(posthog.isFeatureEnabled('dark-mode')).toBe(false)
      expect(posthog.isFeatureEnabled('unknown-flag')).toBe(false)
    })

    it('should support groups', () => {
      const transport = new InMemoryTransport()
      const posthog = new PostHog({
        apiKey: 'phc_test_key',
        transport: () => transport,
      })

      posthog.group('company', 'acme-inc', { name: 'Acme Inc' })

      const events = transport.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.event).toBe('$groupidentify')
    })
  })
})
