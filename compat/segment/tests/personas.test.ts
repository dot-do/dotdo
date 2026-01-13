/**
 * @dotdo/segment - Personas (Computed Traits & Audiences) Tests
 *
 * Tests for Segment Personas compatibility:
 * - Computed traits based on user behavior
 * - Audience membership evaluation
 * - Real-time trait computation
 * - Profile enrichment
 *
 * TDD: RED phase - these tests define the expected behavior
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  // Personas classes
  PersonasEngine,
  ComputedTrait,
  Audience,
  createPersonasEngine,
  createComputedTrait,
  createAudience,

  // Types
  type PersonasEngineOptions,
  type ComputedTraitConfig,
  type AudienceConfig,
  type UserProfile,
  type TraitResult,
  type AudienceResult,
} from '../personas'
import type { SegmentEvent } from '../types'

describe('@dotdo/segment - Personas (Computed Traits & Audiences)', () => {
  // ===========================================================================
  // Computed Traits
  // ===========================================================================

  describe('ComputedTrait', () => {
    it('should create a computed trait with configuration', () => {
      const trait = createComputedTrait({
        name: 'total_orders',
        type: 'count',
        description: 'Total number of orders completed',
        eventName: 'Order Completed',
      })

      expect(trait.name).toBe('total_orders')
      expect(trait.type).toBe('count')
    })

    it('should compute count trait from events', () => {
      const trait = new ComputedTrait({
        name: 'order_count',
        type: 'count',
        eventName: 'Order Completed',
      })

      const events: SegmentEvent[] = [
        createTrackEvent('Order Completed', { orderId: '1' }),
        createTrackEvent('Order Completed', { orderId: '2' }),
        createTrackEvent('Order Completed', { orderId: '3' }),
        createTrackEvent('Product Viewed', { productId: 'p1' }), // Different event
      ]

      const result = trait.compute(events)
      expect(result.value).toBe(3)
    })

    it('should compute sum trait from property values', () => {
      const trait = new ComputedTrait({
        name: 'total_revenue',
        type: 'sum',
        eventName: 'Order Completed',
        property: 'total',
      })

      const events: SegmentEvent[] = [
        createTrackEvent('Order Completed', { total: 100 }),
        createTrackEvent('Order Completed', { total: 50.5 }),
        createTrackEvent('Order Completed', { total: 75.25 }),
      ]

      const result = trait.compute(events)
      expect(result.value).toBe(225.75)
    })

    it('should compute average trait from property values', () => {
      const trait = new ComputedTrait({
        name: 'average_order_value',
        type: 'average',
        eventName: 'Order Completed',
        property: 'total',
      })

      const events: SegmentEvent[] = [
        createTrackEvent('Order Completed', { total: 100 }),
        createTrackEvent('Order Completed', { total: 200 }),
        createTrackEvent('Order Completed', { total: 300 }),
      ]

      const result = trait.compute(events)
      expect(result.value).toBe(200)
    })

    it('should compute min trait from property values', () => {
      const trait = new ComputedTrait({
        name: 'min_order_value',
        type: 'min',
        eventName: 'Order Completed',
        property: 'total',
      })

      const events: SegmentEvent[] = [
        createTrackEvent('Order Completed', { total: 150 }),
        createTrackEvent('Order Completed', { total: 50 }),
        createTrackEvent('Order Completed', { total: 200 }),
      ]

      const result = trait.compute(events)
      expect(result.value).toBe(50)
    })

    it('should compute max trait from property values', () => {
      const trait = new ComputedTrait({
        name: 'max_order_value',
        type: 'max',
        eventName: 'Order Completed',
        property: 'total',
      })

      const events: SegmentEvent[] = [
        createTrackEvent('Order Completed', { total: 150 }),
        createTrackEvent('Order Completed', { total: 50 }),
        createTrackEvent('Order Completed', { total: 200 }),
      ]

      const result = trait.compute(events)
      expect(result.value).toBe(200)
    })

    it('should compute first trait (first occurrence value)', () => {
      const trait = new ComputedTrait({
        name: 'first_product_category',
        type: 'first',
        eventName: 'Product Viewed',
        property: 'category',
      })

      const events: SegmentEvent[] = [
        createTrackEvent('Product Viewed', { category: 'Electronics' }, '2024-01-01'),
        createTrackEvent('Product Viewed', { category: 'Clothing' }, '2024-01-02'),
        createTrackEvent('Product Viewed', { category: 'Books' }, '2024-01-03'),
      ]

      const result = trait.compute(events)
      expect(result.value).toBe('Electronics')
    })

    it('should compute last trait (most recent value)', () => {
      const trait = new ComputedTrait({
        name: 'last_product_category',
        type: 'last',
        eventName: 'Product Viewed',
        property: 'category',
      })

      const events: SegmentEvent[] = [
        createTrackEvent('Product Viewed', { category: 'Electronics' }, '2024-01-01'),
        createTrackEvent('Product Viewed', { category: 'Clothing' }, '2024-01-02'),
        createTrackEvent('Product Viewed', { category: 'Books' }, '2024-01-03'),
      ]

      const result = trait.compute(events)
      expect(result.value).toBe('Books')
    })

    it('should compute unique count trait', () => {
      const trait = new ComputedTrait({
        name: 'unique_products_viewed',
        type: 'unique_count',
        eventName: 'Product Viewed',
        property: 'productId',
      })

      const events: SegmentEvent[] = [
        createTrackEvent('Product Viewed', { productId: 'p1' }),
        createTrackEvent('Product Viewed', { productId: 'p2' }),
        createTrackEvent('Product Viewed', { productId: 'p1' }), // Duplicate
        createTrackEvent('Product Viewed', { productId: 'p3' }),
        createTrackEvent('Product Viewed', { productId: 'p2' }), // Duplicate
      ]

      const result = trait.compute(events)
      expect(result.value).toBe(3) // p1, p2, p3
    })

    it('should compute list trait (unique values)', () => {
      const trait = new ComputedTrait({
        name: 'categories_browsed',
        type: 'list',
        eventName: 'Product Viewed',
        property: 'category',
      })

      const events: SegmentEvent[] = [
        createTrackEvent('Product Viewed', { category: 'Electronics' }),
        createTrackEvent('Product Viewed', { category: 'Clothing' }),
        createTrackEvent('Product Viewed', { category: 'Electronics' }),
        createTrackEvent('Product Viewed', { category: 'Books' }),
      ]

      const result = trait.compute(events)
      expect(result.value).toEqual(['Electronics', 'Clothing', 'Books'])
    })

    it('should support event filter conditions', () => {
      const trait = new ComputedTrait({
        name: 'high_value_orders',
        type: 'count',
        eventName: 'Order Completed',
        filter: (event) => {
          const total = event.properties?.total as number
          return total >= 100
        },
      })

      const events: SegmentEvent[] = [
        createTrackEvent('Order Completed', { total: 50 }),
        createTrackEvent('Order Completed', { total: 150 }),
        createTrackEvent('Order Completed', { total: 75 }),
        createTrackEvent('Order Completed', { total: 200 }),
      ]

      const result = trait.compute(events)
      expect(result.value).toBe(2) // Only 150 and 200
    })

    it('should support time window filtering', () => {
      const trait = new ComputedTrait({
        name: 'orders_last_30_days',
        type: 'count',
        eventName: 'Order Completed',
        timeWindow: 30 * 24 * 60 * 60 * 1000, // 30 days in ms
      })

      const now = Date.now()
      const events: SegmentEvent[] = [
        createTrackEvent('Order Completed', {}, new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString()), // 10 days ago
        createTrackEvent('Order Completed', {}, new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString()), // 20 days ago
        createTrackEvent('Order Completed', {}, new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString()), // 40 days ago - outside window
      ]

      const result = trait.compute(events)
      expect(result.value).toBe(2)
    })
  })

  // ===========================================================================
  // Audiences
  // ===========================================================================

  describe('Audience', () => {
    it('should create an audience with configuration', () => {
      const audience = createAudience({
        name: 'High Value Customers',
        description: 'Customers with lifetime value > $1000',
        condition: (profile) => (profile.computedTraits.total_revenue as number) > 1000,
      })

      expect(audience.name).toBe('High Value Customers')
    })

    it('should evaluate audience membership based on computed traits', () => {
      const audience = new Audience({
        name: 'Active Users',
        condition: (profile) => (profile.computedTraits.order_count as number) >= 3,
      })

      const memberProfile: UserProfile = {
        userId: 'user-1',
        anonymousId: 'anon-1',
        traits: {},
        computedTraits: { order_count: 5 },
        audiences: [],
      }

      const nonMemberProfile: UserProfile = {
        userId: 'user-2',
        anonymousId: 'anon-2',
        traits: {},
        computedTraits: { order_count: 1 },
        audiences: [],
      }

      expect(audience.evaluate(memberProfile).member).toBe(true)
      expect(audience.evaluate(nonMemberProfile).member).toBe(false)
    })

    it('should evaluate audience based on user traits', () => {
      const audience = new Audience({
        name: 'Enterprise Users',
        condition: (profile) => profile.traits.plan === 'enterprise',
      })

      const enterpriseUser: UserProfile = {
        userId: 'user-1',
        traits: { plan: 'enterprise' },
        computedTraits: {},
        audiences: [],
      }

      const freeUser: UserProfile = {
        userId: 'user-2',
        traits: { plan: 'free' },
        computedTraits: {},
        audiences: [],
      }

      expect(audience.evaluate(enterpriseUser).member).toBe(true)
      expect(audience.evaluate(freeUser).member).toBe(false)
    })

    it('should support complex audience conditions', () => {
      const audience = new Audience({
        name: 'Engaged Premium Users',
        condition: (profile) =>
          profile.traits.plan === 'premium' &&
          (profile.computedTraits.login_count as number) >= 10 &&
          (profile.computedTraits.days_since_signup as number) <= 90,
      })

      const matchingProfile: UserProfile = {
        userId: 'user-1',
        traits: { plan: 'premium' },
        computedTraits: { login_count: 15, days_since_signup: 30 },
        audiences: [],
      }

      const nonMatchingProfile: UserProfile = {
        userId: 'user-2',
        traits: { plan: 'premium' },
        computedTraits: { login_count: 5, days_since_signup: 30 }, // Low login count
        audiences: [],
      }

      expect(audience.evaluate(matchingProfile).member).toBe(true)
      expect(audience.evaluate(nonMatchingProfile).member).toBe(false)
    })

    it('should track audience entry timestamp', () => {
      const audience = new Audience({
        name: 'Test Audience',
        condition: (profile) => (profile.computedTraits.score as number) > 50,
      })

      const profile: UserProfile = {
        userId: 'user-1',
        traits: {},
        computedTraits: { score: 75 },
        audiences: [],
      }

      const result = audience.evaluate(profile)
      expect(result.member).toBe(true)
      expect(result.enteredAt).toBeDefined()
    })
  })

  // ===========================================================================
  // Personas Engine
  // ===========================================================================

  describe('PersonasEngine', () => {
    let engine: PersonasEngine

    beforeEach(() => {
      engine = new PersonasEngine()
    })

    it('should register computed traits', () => {
      engine.addComputedTrait({
        name: 'total_orders',
        type: 'count',
        eventName: 'Order Completed',
      })

      expect(engine.hasComputedTrait('total_orders')).toBe(true)
      expect(engine.getComputedTraitNames()).toContain('total_orders')
    })

    it('should register audiences', () => {
      engine.addAudience({
        name: 'Power Users',
        condition: (p) => (p.computedTraits.login_count as number) > 100,
      })

      expect(engine.hasAudience('Power Users')).toBe(true)
      expect(engine.getAudienceNames()).toContain('Power Users')
    })

    it('should process events and update user profile', () => {
      engine.addComputedTrait({
        name: 'page_views',
        type: 'count',
        eventName: 'Page Viewed',
      })

      const events: SegmentEvent[] = [
        createTrackEvent('Page Viewed', { page: '/home' }),
        createTrackEvent('Page Viewed', { page: '/products' }),
        createTrackEvent('Page Viewed', { page: '/checkout' }),
      ]

      const profile = engine.processEvents('user-1', events)

      expect(profile.computedTraits.page_views).toBe(3)
    })

    it('should evaluate all audiences after processing events', () => {
      engine.addComputedTrait({
        name: 'order_count',
        type: 'count',
        eventName: 'Order Completed',
      })

      engine.addAudience({
        name: 'Repeat Buyers',
        condition: (p) => (p.computedTraits.order_count as number) >= 2,
      })

      const events: SegmentEvent[] = [
        createTrackEvent('Order Completed', { orderId: '1' }),
        createTrackEvent('Order Completed', { orderId: '2' }),
        createTrackEvent('Order Completed', { orderId: '3' }),
      ]

      const profile = engine.processEvents('user-1', events)

      expect(profile.audiences).toContain('Repeat Buyers')
    })

    it('should merge identify traits into profile', () => {
      const events: SegmentEvent[] = [
        createIdentifyEvent({ email: 'test@example.com', name: 'Test User' }),
      ]

      const profile = engine.processEvents('user-1', events)

      expect(profile.traits.email).toBe('test@example.com')
      expect(profile.traits.name).toBe('Test User')
    })

    it('should handle incremental event processing', () => {
      engine.addComputedTrait({
        name: 'total_spent',
        type: 'sum',
        eventName: 'Order Completed',
        property: 'total',
      })

      // First batch of events
      engine.processEvents('user-1', [
        createTrackEvent('Order Completed', { total: 100 }),
        createTrackEvent('Order Completed', { total: 50 }),
      ])

      // Second batch of events
      const profile = engine.processEvents('user-1', [
        createTrackEvent('Order Completed', { total: 75 }),
      ])

      expect(profile.computedTraits.total_spent).toBe(225)
    })

    it('should get profile by user ID', () => {
      engine.processEvents('user-1', [createIdentifyEvent({ name: 'Alice' })])
      engine.processEvents('user-2', [createIdentifyEvent({ name: 'Bob' })])

      const profile1 = engine.getProfile('user-1')
      const profile2 = engine.getProfile('user-2')

      expect(profile1?.traits.name).toBe('Alice')
      expect(profile2?.traits.name).toBe('Bob')
    })

    it('should export profile to JSON', () => {
      engine.addComputedTrait({
        name: 'order_count',
        type: 'count',
        eventName: 'Order Completed',
      })

      engine.processEvents('user-1', [
        createIdentifyEvent({ email: 'test@example.com' }),
        createTrackEvent('Order Completed', {}),
      ])

      const exported = engine.exportProfile('user-1')
      expect(exported).toBeDefined()
      expect(exported?.traits.email).toBe('test@example.com')
      expect(exported?.computedTraits.order_count).toBe(1)
    })

    it('should support real-time profile enrichment callback', () => {
      const onProfileUpdated = vi.fn()

      engine = new PersonasEngine({
        onProfileUpdated,
      })

      engine.addComputedTrait({
        name: 'page_count',
        type: 'count',
        eventName: 'Page Viewed',
      })

      engine.processEvents('user-1', [createTrackEvent('Page Viewed', {})])

      expect(onProfileUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          computedTraits: expect.objectContaining({ page_count: 1 }),
        })
      )
    })

    it('should notify on audience entry', () => {
      const onAudienceEnter = vi.fn()

      engine = new PersonasEngine({
        onAudienceEnter,
      })

      engine.addComputedTrait({
        name: 'order_count',
        type: 'count',
        eventName: 'Order Completed',
      })

      engine.addAudience({
        name: 'Buyers',
        condition: (p) => (p.computedTraits.order_count as number) >= 1,
      })

      engine.processEvents('user-1', [createTrackEvent('Order Completed', {})])

      expect(onAudienceEnter).toHaveBeenCalledWith('user-1', 'Buyers')
    })

    it('should notify on audience exit', () => {
      const onAudienceExit = vi.fn()

      engine = new PersonasEngine({
        onAudienceExit,
      })

      engine.addComputedTrait({
        name: 'active_subscription',
        type: 'last',
        eventName: 'Subscription Updated',
        property: 'active',
      })

      engine.addAudience({
        name: 'Active Subscribers',
        condition: (p) => p.computedTraits.active_subscription === true,
      })

      // User enters audience
      engine.processEvents('user-1', [
        createTrackEvent('Subscription Updated', { active: true }),
      ])

      // User exits audience
      engine.processEvents('user-1', [
        createTrackEvent('Subscription Updated', { active: false }),
      ])

      expect(onAudienceExit).toHaveBeenCalledWith('user-1', 'Active Subscribers')
    })
  })

  // ===========================================================================
  // Built-in Computed Traits
  // ===========================================================================

  describe('Built-in Computed Traits', () => {
    let engine: PersonasEngine

    beforeEach(() => {
      engine = new PersonasEngine()
    })

    it('should compute days since first event', () => {
      engine.addComputedTrait({
        name: 'days_since_first_visit',
        type: 'days_since_first',
        eventName: 'Page Viewed',
      })

      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()

      const events: SegmentEvent[] = [
        createTrackEvent('Page Viewed', {}, tenDaysAgo),
        createTrackEvent('Page Viewed', {}, fiveDaysAgo),
      ]

      const profile = engine.processEvents('user-1', events)
      const days = profile.computedTraits.days_since_first_visit as number

      expect(days).toBeGreaterThanOrEqual(9) // Allow for timing variance
      expect(days).toBeLessThanOrEqual(11)
    })

    it('should compute days since last event', () => {
      engine.addComputedTrait({
        name: 'days_since_last_purchase',
        type: 'days_since_last',
        eventName: 'Order Completed',
      })

      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()

      const events: SegmentEvent[] = [
        createTrackEvent('Order Completed', {}, tenDaysAgo),
        createTrackEvent('Order Completed', {}, fiveDaysAgo),
      ]

      const profile = engine.processEvents('user-1', events)
      const days = profile.computedTraits.days_since_last_purchase as number

      expect(days).toBeGreaterThanOrEqual(4)
      expect(days).toBeLessThanOrEqual(6)
    })

    it('should compute most frequent value', () => {
      engine.addComputedTrait({
        name: 'favorite_category',
        type: 'most_frequent',
        eventName: 'Product Viewed',
        property: 'category',
      })

      const events: SegmentEvent[] = [
        createTrackEvent('Product Viewed', { category: 'Electronics' }),
        createTrackEvent('Product Viewed', { category: 'Clothing' }),
        createTrackEvent('Product Viewed', { category: 'Electronics' }),
        createTrackEvent('Product Viewed', { category: 'Electronics' }),
        createTrackEvent('Product Viewed', { category: 'Books' }),
      ]

      const profile = engine.processEvents('user-1', events)
      expect(profile.computedTraits.favorite_category).toBe('Electronics')
    })
  })
})

// =============================================================================
// Helper Functions
// =============================================================================

function createTrackEvent(
  eventName: string,
  properties: Record<string, unknown>,
  timestamp?: string
): SegmentEvent {
  return {
    type: 'track',
    messageId: `msg-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: timestamp || new Date().toISOString(),
    userId: 'test-user',
    event: eventName,
    properties,
  }
}

function createIdentifyEvent(traits: Record<string, unknown>): SegmentEvent {
  return {
    type: 'identify',
    messageId: `msg-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    userId: 'test-user',
    traits,
  }
}
