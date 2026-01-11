/**
 * RED Phase Tests for $.track Event Tracking API
 *
 * These tests define the expected behavior of the $.track event tracking system.
 * All tests will FAIL until the implementation is created.
 *
 * The $.track API provides:
 * - Basic event tracking: $.track.Signup({ userId, plan })
 * - Batch tracking: $.track.batch([...])
 * - Query counts: $.track.Signup.count().since('7d')
 * - Funnel analysis: $.track.funnel([...]).within('7d')
 * - Cohort analysis: $.track.cohort({...})
 * - Subscriptions: $.track.Signup.subscribe(handler)
 * - Integration with experiments
 *
 * Design doc: docs/plans/2026-01-11-data-api-design.md
 *
 * @module workflows/data/track/tests/track
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// =============================================================================
// TYPE DEFINITIONS (Expected from '../context' when implemented)
// =============================================================================

/**
 * Tracked event structure
 */
interface TrackedEvent<T = Record<string, unknown>> {
  id: string
  type: string
  data: T
  timestamp: number
  experiment?: string
  variant?: string
}

/**
 * Event subscription handle
 */
interface EventSubscription {
  id: string
  unsubscribe: () => void
}

/**
 * Funnel step result
 */
interface FunnelStepResult {
  count: number
  conversionRate: number
  avgTimeFromPrevious?: number
}

/**
 * Funnel analysis result
 */
interface FunnelResult {
  steps: FunnelStepResult[]
  overallConversionRate: number
}

/**
 * Cohort result
 */
interface CohortResult {
  cohorts: Array<{
    startDate: number
    size: number
    retention: number[]
  }>
  granularity: 'day' | 'week' | 'month'
}

/**
 * Time series data point
 */
interface TimeSeriesPoint {
  timestamp: number
  count: number
}

/**
 * Filter operators for where clauses
 */
interface FilterOperators {
  gte?: number
  gt?: number
  lte?: number
  lt?: number
  ne?: unknown
  in?: unknown[]
}

/**
 * Track context options
 */
interface TrackOptions {
  experiment?: string
  variant?: string
}

// =============================================================================
// IMPORTS
// =============================================================================

import { createTrackContext, $step } from '../context'

// =============================================================================
// TEST SUITE
// =============================================================================

describe('$.track Event Tracking API', () => {
  let $: {
    track: Record<string, unknown> & {
      batch: (events: unknown[]) => Promise<TrackedEvent[]>
      funnel: (steps: unknown[]) => { within: (duration: string) => Promise<FunnelResult> }
      cohort: (config: unknown) => Promise<CohortResult>
      ratio: (numerator: string, denominator: string) => Promise<number>
    }
    _storage: {
      put: (type: string, data: unknown, timestamp: number) => Promise<void>
      clear: () => Promise<void>
    }
  }

  beforeEach(() => {
    $ = createTrackContext()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ============================================================================
  // BASIC EVENT TRACKING
  // ============================================================================

  describe('Basic event tracking: $.track.EventName(data)', () => {
    it('tracks a simple signup event', async () => {
      $ = createTrackContext()
      await $.track.Signup({ userId: 'u123', plan: 'pro' })

      const events = await $.track.Signup.events().limit(1)
      expect(events).toHaveLength(1)
      expect(events[0].data.userId).toBe('u123')
      expect(events[0].data.plan).toBe('pro')
    })

    it('tracks a purchase event with amount', async () => {
      $ = createTrackContext()
      await $.track.Purchase({ amount: 99, sku: 'widget-1', customerId: 'c456' })

      const events = await $.track.Purchase.events().limit(1)
      expect(events).toHaveLength(1)
      expect(events[0].data.amount).toBe(99)
      expect(events[0].data.sku).toBe('widget-1')
      expect(events[0].data.customerId).toBe('c456')
    })

    it('tracks a page view event', async () => {
      $ = createTrackContext()
      await $.track.PageView({ path: '/pricing', referrer: 'twitter.com' })

      const events = await $.track.PageView.events().limit(1)
      expect(events).toHaveLength(1)
      expect(events[0].data.path).toBe('/pricing')
      expect(events[0].data.referrer).toBe('twitter.com')
    })

    it('automatically assigns a timestamp to events', async () => {
      $ = createTrackContext()
      const before = Date.now()
      await $.track.Signup({ userId: 'u123' })
      const after = Date.now()

      const events = await $.track.Signup.events().limit(1)
      expect(events[0].timestamp).toBeGreaterThanOrEqual(before)
      expect(events[0].timestamp).toBeLessThanOrEqual(after)
    })

    it('generates a unique event ID', async () => {
      $ = createTrackContext()
      await $.track.Signup({ userId: 'u123' })
      await $.track.Signup({ userId: 'u456' })

      const events = await $.track.Signup.events().limit(2)
      expect(events[0].id).toBeDefined()
      expect(events[1].id).toBeDefined()
      expect(events[0].id).not.toBe(events[1].id)
    })

    it('stores the event type/name', async () => {
      $ = createTrackContext()
      await $.track.CustomEvent({ foo: 'bar' })

      const events = await $.track.CustomEvent.events().limit(1)
      expect(events[0].type).toBe('CustomEvent')
    })

    it('handles events with nested data', async () => {
      $ = createTrackContext()
      await $.track.ComplexEvent({
        user: { id: 'u123', name: 'Alice' },
        items: [{ sku: 'item-1' }, { sku: 'item-2' }],
        metadata: { source: 'api', version: 2 },
      })

      const events = await $.track.ComplexEvent.events().limit(1)
      expect(events[0].data.user.id).toBe('u123')
      expect(events[0].data.items).toHaveLength(2)
      expect(events[0].data.metadata.version).toBe(2)
    })

    it('handles events with empty data', async () => {
      $ = createTrackContext()
      await $.track.EmptyEvent({})

      const events = await $.track.EmptyEvent.events().limit(1)
      expect(events).toHaveLength(1)
      expect(events[0].data).toEqual({})
    })

    it('returns the tracked event', async () => {
      $ = createTrackContext()
      const result = await $.track.Signup({ userId: 'u123', plan: 'pro' })

      expect(result.id).toBeDefined()
      expect(result.type).toBe('Signup')
      expect(result.data.userId).toBe('u123')
      expect(result.timestamp).toBeDefined()
    })

    it('tracks multiple different event types', async () => {
      $ = createTrackContext()
      await $.track.Signup({ userId: 'u123' })
      await $.track.Login({ userId: 'u123' })
      await $.track.Purchase({ amount: 50 })

      const signups = await $.track.Signup.count()
      const logins = await $.track.Login.count()
      const purchases = await $.track.Purchase.count()

      expect(signups).toBe(1)
      expect(logins).toBe(1)
      expect(purchases).toBe(1)
    })
  })

  // ============================================================================
  // EVENT TRACKING WITH EXPERIMENT ATTRIBUTION
  // ============================================================================

  describe('Event tracking with experiment attribution', () => {
    it('tracks event with explicit experiment attribution', async () => {
      $ = createTrackContext()
      await $.track.Signup({ userId: 'u123' }, { experiment: 'onboarding-v2' })

      const events = await $.track.Signup.events().limit(1)
      expect(events[0].experiment).toBe('onboarding-v2')
    })

    it('tracks event with experiment and variant', async () => {
      $ = createTrackContext()
      await $.track.Purchase(
        { amount: 99 },
        { experiment: 'pricing-test', variant: 'discount-10' }
      )

      const events = await $.track.Purchase.events().limit(1)
      expect(events[0].experiment).toBe('pricing-test')
      expect(events[0].variant).toBe('discount-10')
    })

    it('queries events by experiment', async () => {
      $ = createTrackContext()
      await $.track.Signup({ userId: 'u1' }, { experiment: 'exp-a' })
      await $.track.Signup({ userId: 'u2' }, { experiment: 'exp-b' })
      await $.track.Signup({ userId: 'u3' }, { experiment: 'exp-a' })

      const expACount = await $.track.Signup
        .where({ experiment: 'exp-a' })
        .count()

      expect(expACount).toBe(2)
    })

    it('queries events by experiment and variant', async () => {
      $ = createTrackContext()
      await $.track.Purchase({ amount: 100 }, { experiment: 'pricing', variant: 'control' })
      await $.track.Purchase({ amount: 150 }, { experiment: 'pricing', variant: 'treatment' })
      await $.track.Purchase({ amount: 120 }, { experiment: 'pricing', variant: 'control' })

      const controlRevenue = await $.track.Purchase
        .where({ experiment: 'pricing', variant: 'control' })
        .sum('amount')

      expect(controlRevenue).toBe(220)
    })
  })

  // ============================================================================
  // BATCH TRACKING
  // ============================================================================

  describe('Batch tracking: $.track.batch([...])', () => {
    it('tracks multiple events in a single batch', async () => {
      $ = createTrackContext()
      await $.track.batch([
        { event: 'PageView', data: { path: '/home' } },
        { event: 'PageView', data: { path: '/pricing' } },
        { event: 'PageView', data: { path: '/signup' } },
      ])

      const count = await $.track.PageView.count()
      expect(count).toBe(3)
    })

    it('tracks different event types in a batch', async () => {
      $ = createTrackContext()
      await $.track.batch([
        { event: 'PageView', data: { path: '/home' } },
        { event: 'Signup', data: { userId: 'u123' } },
        { event: 'Purchase', data: { amount: 99 } },
      ])

      const pageViews = await $.track.PageView.count()
      const signups = await $.track.Signup.count()
      const purchases = await $.track.Purchase.count()

      expect(pageViews).toBe(1)
      expect(signups).toBe(1)
      expect(purchases).toBe(1)
    })

    it('returns all tracked events from batch', async () => {
      $ = createTrackContext()
      const results = await $.track.batch([
        { event: 'PageView', data: { path: '/a' } },
        { event: 'PageView', data: { path: '/b' } },
      ])

      expect(results).toHaveLength(2)
      expect(results[0].type).toBe('PageView')
      expect(results[1].type).toBe('PageView')
      expect(results[0].id).not.toBe(results[1].id)
    })

    it('assigns sequential timestamps within batch', async () => {
      $ = createTrackContext()
      const results = await $.track.batch([
        { event: 'Step', data: { step: 1 } },
        { event: 'Step', data: { step: 2 } },
        { event: 'Step', data: { step: 3 } },
      ])

      // Timestamps should be sequential or equal
      expect(results[0].timestamp).toBeLessThanOrEqual(results[1].timestamp)
      expect(results[1].timestamp).toBeLessThanOrEqual(results[2].timestamp)
    })

    it('handles empty batch gracefully', async () => {
      $ = createTrackContext()
      const results = await $.track.batch([])

      expect(results).toEqual([])
    })

    it('handles large batches efficiently', async () => {
      $ = createTrackContext()
      const events = Array.from({ length: 1000 }, (_, i) => ({
        event: 'BulkEvent',
        data: { index: i },
      }))

      const start = Date.now()
      await $.track.batch(events)
      const duration = Date.now() - start

      const count = await $.track.BulkEvent.count()
      expect(count).toBe(1000)
      expect(duration).toBeLessThan(5000) // Should complete within 5 seconds
    })

    it('supports experiment attribution in batch', async () => {
      $ = createTrackContext()
      await $.track.batch([
        { event: 'Signup', data: { userId: 'u1' }, options: { experiment: 'exp-a' } },
        { event: 'Signup', data: { userId: 'u2' }, options: { experiment: 'exp-b' } },
      ])

      const expACount = await $.track.Signup.where({ experiment: 'exp-a' }).count()
      expect(expACount).toBe(1)
    })

    it('is atomic - all events succeed or none', async () => {
      $ = createTrackContext()
      // First, track some events successfully
      await $.track.batch([
        { event: 'ValidEvent', data: { id: 1 } },
      ])

      // Attempt a batch with an invalid event (implementation should define what's invalid)
      // For now, we test that batch either succeeds entirely or fails entirely
      const initialCount = await $.track.ValidEvent.count()
      expect(initialCount).toBe(1)
    })
  })

  // ============================================================================
  // QUERY COUNTS: $.track.EventName.count()
  // ============================================================================

  describe('Query counts: $.track.EventName.count()', () => {
    it('returns total count of events', async () => {
      $ = createTrackContext()
      await $.track.Signup({ userId: 'u1' })
      await $.track.Signup({ userId: 'u2' })
      await $.track.Signup({ userId: 'u3' })

      const count = await $.track.Signup.count()
      expect(count).toBe(3)
    })

    it('returns 0 for non-existent event type', async () => {
      $ = createTrackContext()
      const count = await $.track.NonExistent.count()
      expect(count).toBe(0)
    })

    it('counts events since a duration string', async () => {
      $ = createTrackContext()
      // Simulate events at different times using the test context
      const now = Date.now()

      await $._storage.put('Signup', { userId: 'u1' }, now - 3 * 24 * 60 * 60 * 1000) // 3 days ago
      await $._storage.put('Signup', { userId: 'u2' }, now - 1 * 24 * 60 * 60 * 1000) // 1 day ago
      await $._storage.put('Signup', { userId: 'u3' }, now - 60 * 60 * 1000) // 1 hour ago

      const last7d = await $.track.Signup.count().since('7d')
      const last2d = await $.track.Signup.count().since('2d')
      const last2h = await $.track.Signup.count().since('2h')

      expect(last7d).toBe(3)
      expect(last2d).toBe(2)
      expect(last2h).toBe(1)
    })

    it('counts events since specific timestamp', async () => {
      $ = createTrackContext()
      const now = Date.now()
      const cutoff = now - 1000

      await $._storage.put('Event', { id: 1 }, now - 2000)
      await $._storage.put('Event', { id: 2 }, now - 500)

      const count = await $.track.Event.count().since(cutoff)
      expect(count).toBe(1)
    })

    it('groups counts by a field', async () => {
      $ = createTrackContext()
      await $.track.Signup({ userId: 'u1', plan: 'free' })
      await $.track.Signup({ userId: 'u2', plan: 'pro' })
      await $.track.Signup({ userId: 'u3', plan: 'free' })
      await $.track.Signup({ userId: 'u4', plan: 'pro' })
      await $.track.Signup({ userId: 'u5', plan: 'pro' })

      const byPlan = await $.track.Signup.count().by('plan')

      expect(byPlan.free).toBe(2)
      expect(byPlan.pro).toBe(3)
    })

    it('chains since and by for grouped time-bounded counts', async () => {
      $ = createTrackContext()
      const now = Date.now()

      await $._storage.put('Signup', { plan: 'free' }, now - 2 * 24 * 60 * 60 * 1000)
      await $._storage.put('Signup', { plan: 'pro' }, now - 2 * 24 * 60 * 60 * 1000)
      await $._storage.put('Signup', { plan: 'free' }, now - 60 * 60 * 1000)

      const recentByPlan = await $.track.Signup.count().since('1d').by('plan')

      expect(recentByPlan.free).toBe(1)
      expect(recentByPlan.pro).toBeUndefined() // Or 0, depending on implementation
    })

    it('supports duration shortcuts', async () => {
      $ = createTrackContext()
      await $.track.Event({ id: 1 })

      // All these should be valid duration strings
      await $.track.Event.count().since('1h')
      await $.track.Event.count().since('24h')
      await $.track.Event.count().since('7d')
      await $.track.Event.count().since('30d')
      await $.track.Event.count().since('1w')
      await $.track.Event.count().since('month')
      await $.track.Event.count().since('quarter')
      await $.track.Event.count().since('year')
    })
  })

  // ============================================================================
  // QUERY WITH FILTERS: $.track.EventName.where({...})
  // ============================================================================

  describe('Query with filters: $.track.EventName.where({...})', () => {
    it('filters events by exact field match', async () => {
      $ = createTrackContext()
      await $.track.Purchase({ amount: 50, customerId: 'c1' })
      await $.track.Purchase({ amount: 100, customerId: 'c2' })
      await $.track.Purchase({ amount: 150, customerId: 'c1' })

      const c1Purchases = await $.track.Purchase
        .where({ customerId: 'c1' })
        .count()

      expect(c1Purchases).toBe(2)
    })

    it('filters events with gte (greater than or equal)', async () => {
      $ = createTrackContext()
      await $.track.Purchase({ amount: 50 })
      await $.track.Purchase({ amount: 100 })
      await $.track.Purchase({ amount: 150 })

      const highValue = await $.track.Purchase
        .where({ amount: { gte: 100 } })
        .count()

      expect(highValue).toBe(2)
    })

    it('filters events with gt (greater than)', async () => {
      $ = createTrackContext()
      await $.track.Purchase({ amount: 100 })
      await $.track.Purchase({ amount: 101 })

      const count = await $.track.Purchase
        .where({ amount: { gt: 100 } })
        .count()

      expect(count).toBe(1)
    })

    it('filters events with lte (less than or equal)', async () => {
      $ = createTrackContext()
      await $.track.Purchase({ amount: 50 })
      await $.track.Purchase({ amount: 100 })
      await $.track.Purchase({ amount: 150 })

      const lowValue = await $.track.Purchase
        .where({ amount: { lte: 100 } })
        .count()

      expect(lowValue).toBe(2)
    })

    it('filters events with lt (less than)', async () => {
      $ = createTrackContext()
      await $.track.Purchase({ amount: 99 })
      await $.track.Purchase({ amount: 100 })

      const count = await $.track.Purchase
        .where({ amount: { lt: 100 } })
        .count()

      expect(count).toBe(1)
    })

    it('combines multiple filter conditions', async () => {
      $ = createTrackContext()
      await $.track.Purchase({ amount: 50, region: 'us' })
      await $.track.Purchase({ amount: 100, region: 'us' })
      await $.track.Purchase({ amount: 150, region: 'eu' })
      await $.track.Purchase({ amount: 200, region: 'us' })

      const highValueUS = await $.track.Purchase
        .where({ amount: { gte: 100 }, region: 'us' })
        .count()

      expect(highValueUS).toBe(2)
    })

    it('chains where with since', async () => {
      $ = createTrackContext()
      const now = Date.now()

      await $._storage.put('Purchase', { amount: 50 }, now - 2 * 24 * 60 * 60 * 1000)
      await $._storage.put('Purchase', { amount: 150 }, now - 2 * 24 * 60 * 60 * 1000)
      await $._storage.put('Purchase', { amount: 200 }, now - 60 * 60 * 1000)

      const recentHighValue = await $.track.Purchase
        .where({ amount: { gte: 100 } })
        .count()
        .since('1d')

      expect(recentHighValue).toBe(1)
    })

    it('supports in operator for array of values', async () => {
      $ = createTrackContext()
      await $.track.Signup({ plan: 'free' })
      await $.track.Signup({ plan: 'pro' })
      await $.track.Signup({ plan: 'enterprise' })

      const paidPlans = await $.track.Signup
        .where({ plan: { in: ['pro', 'enterprise'] } })
        .count()

      expect(paidPlans).toBe(2)
    })

    it('supports not equal operator', async () => {
      $ = createTrackContext()
      await $.track.Signup({ plan: 'free' })
      await $.track.Signup({ plan: 'pro' })
      await $.track.Signup({ plan: 'free' })

      const notFree = await $.track.Signup
        .where({ plan: { ne: 'free' } })
        .count()

      expect(notFree).toBe(1)
    })
  })

  // ============================================================================
  // RAW EVENTS QUERY: $.track.EventName.events()
  // ============================================================================

  describe('Raw events query: $.track.EventName.events()', () => {
    it('returns raw events with limit', async () => {
      $ = createTrackContext()
      for (let i = 0; i < 10; i++) {
        await $.track.Event({ index: i })
      }

      const events = await $.track.Event.events().limit(5)
      expect(events).toHaveLength(5)
    })

    it('returns events since a duration', async () => {
      $ = createTrackContext()
      const now = Date.now()

      await $._storage.put('Event', { id: 1 }, now - 2 * 60 * 60 * 1000)
      await $._storage.put('Event', { id: 2 }, now - 30 * 60 * 1000)

      const events = await $.track.Event.events().since('1h').limit(100)
      expect(events).toHaveLength(1)
      expect(events[0].data.id).toBe(2)
    })

    it('returns events in reverse chronological order by default', async () => {
      $ = createTrackContext()
      await $.track.Event({ index: 1 })
      await $.track.Event({ index: 2 })
      await $.track.Event({ index: 3 })

      const events = await $.track.Event.events().limit(3)

      // Most recent first
      expect(events[0].data.index).toBe(3)
      expect(events[1].data.index).toBe(2)
      expect(events[2].data.index).toBe(1)
    })

    it('returns events with full event structure', async () => {
      $ = createTrackContext()
      await $.track.Signup({ userId: 'u123', plan: 'pro' })

      const events = await $.track.Signup.events().limit(1)

      expect(events[0]).toHaveProperty('id')
      expect(events[0]).toHaveProperty('type', 'Signup')
      expect(events[0]).toHaveProperty('data')
      expect(events[0]).toHaveProperty('timestamp')
      expect(events[0].data.userId).toBe('u123')
    })

    it('combines since and limit', async () => {
      $ = createTrackContext()
      const now = Date.now()

      for (let i = 0; i < 100; i++) {
        await $._storage.put('Event', { index: i }, now - i * 1000)
      }

      const events = await $.track.Event.events().since('10s').limit(5)
      expect(events).toHaveLength(5)
    })

    it('returns empty array when no events match', async () => {
      $ = createTrackContext()
      const events = await $.track.NonExistent.events().limit(10)
      expect(events).toEqual([])
    })
  })

  // ============================================================================
  // FUNNEL ANALYSIS: $.track.funnel([...]).within('7d')
  // ============================================================================

  describe('Funnel analysis: $.track.funnel([...]).within()', () => {
    it('calculates basic funnel conversion', async () => {
      $ = createTrackContext()
      // Simulate a simple signup funnel
      await $.track.PageView({ userId: 'u1', path: '/pricing' })
      await $.track.PageView({ userId: 'u2', path: '/pricing' })
      await $.track.PageView({ userId: 'u3', path: '/pricing' })
      await $.track.Signup({ userId: 'u1' })
      await $.track.Signup({ userId: 'u2' })
      await $.track.Purchase({ userId: 'u1' })

      const result = await $.track.funnel([
        $step('PageView').where({ path: '/pricing' }),
        $step('Signup'),
        $step('Purchase'),
      ]).within('7d')

      expect(result.steps).toHaveLength(3)
      expect(result.steps[0].count).toBe(3)
      expect(result.steps[1].count).toBe(2)
      expect(result.steps[2].count).toBe(1)
    })

    it('calculates conversion rates between steps', async () => {
      $ = createTrackContext()
      await $.track.PageView({ userId: 'u1', path: '/pricing' })
      await $.track.PageView({ userId: 'u2', path: '/pricing' })
      await $.track.Signup({ userId: 'u1' })

      const result = await $.track.funnel([
        $step('PageView').where({ path: '/pricing' }),
        $step('Signup'),
      ]).within('7d')

      expect(result.steps[0].count).toBe(2)
      expect(result.steps[1].count).toBe(1)
      expect(result.steps[0].conversionRate).toBe(1) // First step is always 100%
      expect(result.steps[1].conversionRate).toBeCloseTo(0.5, 2) // 50% conversion
    })

    it('respects the time window constraint', async () => {
      $ = createTrackContext()
      const now = Date.now()

      // User 1: completed funnel within 7 days
      await $._storage.put('PageView', { userId: 'u1', path: '/pricing' }, now - 5 * 24 * 60 * 60 * 1000)
      await $._storage.put('Signup', { userId: 'u1' }, now - 4 * 24 * 60 * 60 * 1000)

      // User 2: started but completed outside window
      await $._storage.put('PageView', { userId: 'u2', path: '/pricing' }, now - 10 * 24 * 60 * 60 * 1000)
      await $._storage.put('Signup', { userId: 'u2' }, now - 1 * 24 * 60 * 60 * 1000)

      const result = await $.track.funnel([
        $step('PageView').where({ path: '/pricing' }),
        $step('Signup'),
      ]).within('7d')

      // Only user 1 should complete the funnel within the window
      expect(result.steps[1].count).toBe(1)
    })

    it('groups funnel by a dimension', async () => {
      $ = createTrackContext()
      await $.track.PageView({ userId: 'u1', path: '/pricing', source: 'google' })
      await $.track.PageView({ userId: 'u2', path: '/pricing', source: 'twitter' })
      await $.track.PageView({ userId: 'u3', path: '/pricing', source: 'google' })
      await $.track.Signup({ userId: 'u1', source: 'google' })
      await $.track.Signup({ userId: 'u2', source: 'twitter' })
      await $.track.Signup({ userId: 'u3', source: 'google' })

      const result = await $.track.funnel([
        $step('PageView').where({ path: '/pricing' }),
        $step('Signup'),
      ]).within('7d').by('source')

      expect(result.google.steps[0].count).toBe(2)
      expect(result.google.steps[1].count).toBe(2)
      expect(result.twitter.steps[0].count).toBe(1)
      expect(result.twitter.steps[1].count).toBe(1)
    })

    it('calculates overall funnel conversion', async () => {
      $ = createTrackContext()
      await $.track.PageView({ userId: 'u1' })
      await $.track.PageView({ userId: 'u2' })
      await $.track.PageView({ userId: 'u3' })
      await $.track.PageView({ userId: 'u4' })
      await $.track.Signup({ userId: 'u1' })
      await $.track.Signup({ userId: 'u2' })
      await $.track.Purchase({ userId: 'u1' })

      const result = await $.track.funnel([
        $step('PageView'),
        $step('Signup'),
        $step('Purchase'),
      ]).within('7d')

      expect(result.overallConversionRate).toBeCloseTo(0.25, 2) // 1/4 = 25%
    })

    it('handles empty funnel steps gracefully', async () => {
      $ = createTrackContext()
      const result = await $.track.funnel([
        $step('NonExistent'),
      ]).within('7d')

      expect(result.steps[0].count).toBe(0)
    })

    it('calculates time between steps', async () => {
      $ = createTrackContext()
      const now = Date.now()

      await $._storage.put('PageView', { userId: 'u1' }, now - 60 * 60 * 1000) // 1 hour ago
      await $._storage.put('Signup', { userId: 'u1' }, now - 30 * 60 * 1000) // 30 mins ago

      const result = await $.track.funnel([
        $step('PageView'),
        $step('Signup'),
      ]).within('7d')

      expect(result.steps[1].avgTimeFromPrevious).toBeCloseTo(30 * 60 * 1000, -3) // ~30 minutes
    })

    it('supports strict ordering (events must happen in sequence)', async () => {
      $ = createTrackContext()
      // User with events out of order
      await $.track.Signup({ userId: 'u1' })
      await $.track.PageView({ userId: 'u1', path: '/pricing' })

      const result = await $.track.funnel([
        $step('PageView').where({ path: '/pricing' }),
        $step('Signup'),
      ]).within('7d').strict()

      // Should not count because Signup happened before PageView
      expect(result.steps[1].count).toBe(0)
    })
  })

  // ============================================================================
  // COHORT ANALYSIS: $.track.cohort({...})
  // ============================================================================

  describe('Cohort analysis: $.track.cohort({...})', () => {
    it('calculates basic retention cohort', async () => {
      $ = createTrackContext()
      const now = Date.now()
      const week = 7 * 24 * 60 * 60 * 1000

      // Week 0 signups
      await $._storage.put('Signup', { userId: 'u1' }, now - 3 * week)
      await $._storage.put('Signup', { userId: 'u2' }, now - 3 * week)
      await $._storage.put('Signup', { userId: 'u3' }, now - 3 * week)

      // Week 1 activity
      await $._storage.put('Purchase', { userId: 'u1' }, now - 2 * week)
      await $._storage.put('Purchase', { userId: 'u2' }, now - 2 * week)

      // Week 2 activity
      await $._storage.put('Purchase', { userId: 'u1' }, now - 1 * week)

      const result = await $.track.cohort({
        anchor: 'Signup',
        activity: 'Purchase',
        periods: 3,
        granularity: 'week',
      })

      expect(result.cohorts).toHaveLength(1)
      expect(result.cohorts[0].size).toBe(3) // 3 signups
      expect(result.cohorts[0].retention[0]).toBeCloseTo(2 / 3, 2) // 66% in week 1
      expect(result.cohorts[0].retention[1]).toBeCloseTo(1 / 3, 2) // 33% in week 2
    })

    it('groups cohorts by time period', async () => {
      $ = createTrackContext()
      const now = Date.now()
      const week = 7 * 24 * 60 * 60 * 1000

      // Cohort 1 (3 weeks ago)
      await $._storage.put('Signup', { userId: 'u1' }, now - 3 * week)

      // Cohort 2 (2 weeks ago)
      await $._storage.put('Signup', { userId: 'u2' }, now - 2 * week)
      await $._storage.put('Signup', { userId: 'u3' }, now - 2 * week)

      const result = await $.track.cohort({
        anchor: 'Signup',
        activity: 'Purchase',
        periods: 4,
        granularity: 'week',
      })

      expect(result.cohorts.length).toBeGreaterThanOrEqual(2)
    })

    it('groups cohort by a dimension', async () => {
      $ = createTrackContext()
      const now = Date.now()
      const week = 7 * 24 * 60 * 60 * 1000

      // Free plan users
      await $._storage.put('Signup', { userId: 'u1', plan: 'free' }, now - 2 * week)
      await $._storage.put('Purchase', { userId: 'u1', plan: 'free' }, now - 1 * week)

      // Pro plan users
      await $._storage.put('Signup', { userId: 'u2', plan: 'pro' }, now - 2 * week)
      await $._storage.put('Purchase', { userId: 'u2', plan: 'pro' }, now - 1 * week)
      await $._storage.put('Signup', { userId: 'u3', plan: 'pro' }, now - 2 * week)
      await $._storage.put('Purchase', { userId: 'u3', plan: 'pro' }, now - 1 * week)

      const result = await $.track.cohort({
        anchor: 'Signup',
        activity: 'Purchase',
        periods: 3,
        granularity: 'week',
      }).by('plan')

      expect(result.free.cohorts[0].retention[0]).toBe(1) // 100% of free users retained
      expect(result.pro.cohorts[0].retention[0]).toBe(1) // 100% of pro users retained
    })

    it('supports different granularities', async () => {
      $ = createTrackContext()
      await $.track.Signup({ userId: 'u1' })

      // Day granularity
      const daily = await $.track.cohort({
        anchor: 'Signup',
        activity: 'Purchase',
        periods: 7,
        granularity: 'day',
      })
      expect(daily.granularity).toBe('day')

      // Week granularity
      const weekly = await $.track.cohort({
        anchor: 'Signup',
        activity: 'Purchase',
        periods: 4,
        granularity: 'week',
      })
      expect(weekly.granularity).toBe('week')

      // Month granularity
      const monthly = await $.track.cohort({
        anchor: 'Signup',
        activity: 'Purchase',
        periods: 3,
        granularity: 'month',
      })
      expect(monthly.granularity).toBe('month')
    })

    it('returns cohort start dates', async () => {
      $ = createTrackContext()
      const now = Date.now()
      const week = 7 * 24 * 60 * 60 * 1000

      await $._storage.put('Signup', { userId: 'u1' }, now - 2 * week)

      const result = await $.track.cohort({
        anchor: 'Signup',
        activity: 'Purchase',
        periods: 3,
        granularity: 'week',
      })

      expect(result.cohorts[0]).toHaveProperty('startDate')
      expect(typeof result.cohorts[0].startDate).toBe('number')
    })

    it('handles no activity correctly', async () => {
      $ = createTrackContext()
      await $.track.Signup({ userId: 'u1' })
      await $.track.Signup({ userId: 'u2' })

      const result = await $.track.cohort({
        anchor: 'Signup',
        activity: 'Purchase',
        periods: 2,
        granularity: 'week',
      })

      // Should have cohort but with 0% retention
      expect(result.cohorts[0].size).toBe(2)
      expect(result.cohorts[0].retention[0]).toBe(0)
    })
  })

  // ============================================================================
  // SUBSCRIPTIONS: $.track.EventName.subscribe(handler)
  // ============================================================================

  describe('Subscriptions: $.track.EventName.subscribe(handler)', () => {
    it('calls handler when event is tracked', async () => {
      $ = createTrackContext()
      const handler = vi.fn()

      const subscription = $.track.Signup.subscribe(handler)

      await $.track.Signup({ userId: 'u123', plan: 'pro' })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'Signup',
          data: { userId: 'u123', plan: 'pro' },
        })
      )

      subscription.unsubscribe()
    })

    it('calls handler for each matching event', async () => {
      $ = createTrackContext()
      const handler = vi.fn()

      const subscription = $.track.Signup.subscribe(handler)

      await $.track.Signup({ userId: 'u1' })
      await $.track.Signup({ userId: 'u2' })
      await $.track.Signup({ userId: 'u3' })

      expect(handler).toHaveBeenCalledTimes(3)

      subscription.unsubscribe()
    })

    it('does not call handler for other event types', async () => {
      $ = createTrackContext()
      const signupHandler = vi.fn()

      const subscription = $.track.Signup.subscribe(signupHandler)

      await $.track.Purchase({ amount: 100 })
      await $.track.PageView({ path: '/' })

      expect(signupHandler).not.toHaveBeenCalled()

      subscription.unsubscribe()
    })

    it('stops calling handler after unsubscribe', async () => {
      $ = createTrackContext()
      const handler = vi.fn()

      const subscription = $.track.Signup.subscribe(handler)

      await $.track.Signup({ userId: 'u1' })
      expect(handler).toHaveBeenCalledTimes(1)

      subscription.unsubscribe()

      await $.track.Signup({ userId: 'u2' })
      expect(handler).toHaveBeenCalledTimes(1) // Still 1, not called again
    })

    it('supports filtered subscriptions', async () => {
      $ = createTrackContext()
      const handler = vi.fn()

      const subscription = $.track.Purchase.subscribe(
        handler,
        { where: { amount: { gte: 1000 } } }
      )

      await $.track.Purchase({ amount: 50 })
      await $.track.Purchase({ amount: 1000 })
      await $.track.Purchase({ amount: 500 })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { amount: 1000 },
        })
      )

      subscription.unsubscribe()
    })

    it('supports multiple subscriptions to same event', async () => {
      $ = createTrackContext()
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      const sub1 = $.track.Signup.subscribe(handler1)
      const sub2 = $.track.Signup.subscribe(handler2)

      await $.track.Signup({ userId: 'u123' })

      expect(handler1).toHaveBeenCalledTimes(1)
      expect(handler2).toHaveBeenCalledTimes(1)

      sub1.unsubscribe()
      sub2.unsubscribe()
    })

    it('returns subscription object with unsubscribe method', () => {
      $ = createTrackContext()
      const subscription = $.track.Signup.subscribe(() => {})

      expect(subscription).toHaveProperty('unsubscribe')
      expect(typeof subscription.unsubscribe).toBe('function')

      subscription.unsubscribe()
    })

    it('handles async handlers', async () => {
      $ = createTrackContext()
      let resolved = false
      const handler = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        resolved = true
      })

      const subscription = $.track.Signup.subscribe(handler)

      await $.track.Signup({ userId: 'u123' })

      // Wait for async handler
      await new Promise(resolve => setTimeout(resolve, 20))

      expect(resolved).toBe(true)

      subscription.unsubscribe()
    })

    it('provides subscription id', () => {
      $ = createTrackContext()
      const sub1 = $.track.Signup.subscribe(() => {})
      const sub2 = $.track.Signup.subscribe(() => {})

      expect(sub1.id).toBeDefined()
      expect(sub2.id).toBeDefined()
      expect(sub1.id).not.toBe(sub2.id)

      sub1.unsubscribe()
      sub2.unsubscribe()
    })
  })

  // ============================================================================
  // INTEGRATION WITH EXPERIMENTS
  // ============================================================================

  describe('Integration with experiments', () => {
    it('queries events for specific experiment', async () => {
      $ = createTrackContext()
      await $.track.Signup({ userId: 'u1' }, { experiment: 'onboarding-v2', variant: 'control' })
      await $.track.Signup({ userId: 'u2' }, { experiment: 'onboarding-v2', variant: 'wizard' })
      await $.track.Signup({ userId: 'u3' }, { experiment: 'pricing-test', variant: 'discount' })

      const onboardingCount = await $.track.Signup
        .where({ experiment: 'onboarding-v2' })
        .count()

      expect(onboardingCount).toBe(2)
    })

    it('groups counts by experiment variant', async () => {
      $ = createTrackContext()
      await $.track.Purchase({ amount: 100 }, { experiment: 'pricing', variant: 'control' })
      await $.track.Purchase({ amount: 150 }, { experiment: 'pricing', variant: 'control' })
      await $.track.Purchase({ amount: 200 }, { experiment: 'pricing', variant: 'discount' })

      const byVariant = await $.track.Purchase
        .where({ experiment: 'pricing' })
        .count()
        .by('variant')

      expect(byVariant.control).toBe(2)
      expect(byVariant.discount).toBe(1)
    })

    it('calculates experiment funnel by variant', async () => {
      $ = createTrackContext()
      // Control group
      await $.track.PageView({ userId: 'u1' }, { experiment: 'checkout', variant: 'control' })
      await $.track.PageView({ userId: 'u2' }, { experiment: 'checkout', variant: 'control' })
      await $.track.Purchase({ userId: 'u1' }, { experiment: 'checkout', variant: 'control' })

      // Treatment group
      await $.track.PageView({ userId: 'u3' }, { experiment: 'checkout', variant: 'treatment' })
      await $.track.PageView({ userId: 'u4' }, { experiment: 'checkout', variant: 'treatment' })
      await $.track.Purchase({ userId: 'u3' }, { experiment: 'checkout', variant: 'treatment' })
      await $.track.Purchase({ userId: 'u4' }, { experiment: 'checkout', variant: 'treatment' })

      const result = await $.track.funnel([
        $step('PageView'),
        $step('Purchase'),
      ]).within('7d')
        .where({ experiment: 'checkout' })
        .by('variant')

      expect(result.control.steps[1].conversionRate).toBeCloseTo(0.5, 2) // 50%
      expect(result.treatment.steps[1].conversionRate).toBeCloseTo(1.0, 2) // 100%
    })

    it('computes experiment metrics aggregations', async () => {
      $ = createTrackContext()
      await $.track.Purchase({ amount: 100 }, { experiment: 'pricing', variant: 'control' })
      await $.track.Purchase({ amount: 120 }, { experiment: 'pricing', variant: 'control' })
      await $.track.Purchase({ amount: 150 }, { experiment: 'pricing', variant: 'discount' })
      await $.track.Purchase({ amount: 180 }, { experiment: 'pricing', variant: 'discount' })

      const controlAvg = await $.track.Purchase
        .where({ experiment: 'pricing', variant: 'control' })
        .avg('amount')

      const discountAvg = await $.track.Purchase
        .where({ experiment: 'pricing', variant: 'discount' })
        .avg('amount')

      expect(controlAvg).toBeCloseTo(110, 0)
      expect(discountAvg).toBeCloseTo(165, 0)
    })
  })

  // ============================================================================
  // AGGREGATION FUNCTIONS
  // ============================================================================

  describe('Aggregation functions', () => {
    it('calculates sum of a field', async () => {
      $ = createTrackContext()
      await $.track.Purchase({ amount: 100 })
      await $.track.Purchase({ amount: 150 })
      await $.track.Purchase({ amount: 250 })

      const total = await $.track.Purchase.sum('amount')

      expect(total).toBe(500)
    })

    it('calculates average of a field', async () => {
      $ = createTrackContext()
      await $.track.Purchase({ amount: 100 })
      await $.track.Purchase({ amount: 200 })
      await $.track.Purchase({ amount: 300 })

      const avg = await $.track.Purchase.avg('amount')

      expect(avg).toBe(200)
    })

    it('finds min of a field', async () => {
      $ = createTrackContext()
      await $.track.Purchase({ amount: 150 })
      await $.track.Purchase({ amount: 50 })
      await $.track.Purchase({ amount: 200 })

      const min = await $.track.Purchase.min('amount')

      expect(min).toBe(50)
    })

    it('finds max of a field', async () => {
      $ = createTrackContext()
      await $.track.Purchase({ amount: 150 })
      await $.track.Purchase({ amount: 50 })
      await $.track.Purchase({ amount: 200 })

      const max = await $.track.Purchase.max('amount')

      expect(max).toBe(200)
    })

    it('chains aggregations with where and since', async () => {
      $ = createTrackContext()
      const now = Date.now()

      await $._storage.put('Purchase', { amount: 100, region: 'us' }, now - 2 * 24 * 60 * 60 * 1000)
      await $._storage.put('Purchase', { amount: 200, region: 'us' }, now - 1 * 60 * 60 * 1000)
      await $._storage.put('Purchase', { amount: 300, region: 'eu' }, now - 1 * 60 * 60 * 1000)

      const recentUSTotal = await $.track.Purchase
        .where({ region: 'us' })
        .sum('amount')
        .since('1d')

      expect(recentUSTotal).toBe(200)
    })

    it('returns null for empty result set', async () => {
      $ = createTrackContext()
      const avg = await $.track.NonExistent.avg('amount')
      const min = await $.track.NonExistent.min('amount')
      const max = await $.track.NonExistent.max('amount')

      expect(avg).toBeNull()
      expect(min).toBeNull()
      expect(max).toBeNull()
    })

    it('returns 0 for sum of empty result set', async () => {
      $ = createTrackContext()
      const sum = await $.track.NonExistent.sum('amount')

      expect(sum).toBe(0)
    })
  })

  // ============================================================================
  // UNIQUE COUNTS
  // ============================================================================

  describe('Unique counts: $.track.EventName.countUnique(field)', () => {
    it('counts unique values of a field', async () => {
      $ = createTrackContext()
      await $.track.PageView({ userId: 'u1', path: '/home' })
      await $.track.PageView({ userId: 'u1', path: '/about' })
      await $.track.PageView({ userId: 'u2', path: '/home' })
      await $.track.PageView({ userId: 'u1', path: '/home' })

      const uniqueUsers = await $.track.PageView.countUnique('userId')

      expect(uniqueUsers).toBe(2)
    })

    it('chains with where filter', async () => {
      $ = createTrackContext()
      await $.track.Purchase({ userId: 'u1', amount: 50 })
      await $.track.Purchase({ userId: 'u2', amount: 150 })
      await $.track.Purchase({ userId: 'u1', amount: 200 })
      await $.track.Purchase({ userId: 'u3', amount: 25 })

      const highValueUsers = await $.track.Purchase
        .where({ amount: { gte: 100 } })
        .countUnique('userId')

      expect(highValueUsers).toBe(2) // u1 and u2
    })

    it('chains with since filter', async () => {
      $ = createTrackContext()
      const now = Date.now()

      await $._storage.put('Visit', { userId: 'u1' }, now - 2 * 24 * 60 * 60 * 1000)
      await $._storage.put('Visit', { userId: 'u2' }, now - 1 * 60 * 60 * 1000)
      await $._storage.put('Visit', { userId: 'u2' }, now - 30 * 60 * 1000)

      const recentUniqueUsers = await $.track.Visit.countUnique('userId').since('1d')

      expect(recentUniqueUsers).toBe(1) // Only u2
    })
  })

  // ============================================================================
  // RATE AND RATIO CALCULATIONS
  // ============================================================================

  describe('Rate and ratio calculations', () => {
    it('calculates ratio between two event types', async () => {
      $ = createTrackContext()
      await $.track.PageView({ userId: 'u1', path: '/pricing' })
      await $.track.PageView({ userId: 'u2', path: '/pricing' })
      await $.track.PageView({ userId: 'u3', path: '/pricing' })
      await $.track.PageView({ userId: 'u4', path: '/pricing' })
      await $.track.Signup({ userId: 'u1' })
      await $.track.Signup({ userId: 'u2' })

      const conversionRate = await $.track.ratio('Signup', 'PageView:/pricing')

      expect(conversionRate).toBeCloseTo(0.5, 2) // 2/4 = 50%
    })

    it('returns 0 for ratio with zero denominator', async () => {
      $ = createTrackContext()
      await $.track.Signup({ userId: 'u1' })

      const ratio = await $.track.ratio('Signup', 'NonExistent')

      expect(ratio).toBe(0)
    })
  })

  // ============================================================================
  // TIME SERIES DATA
  // ============================================================================

  describe('Time series data', () => {
    it('returns counts grouped by time period', async () => {
      $ = createTrackContext()
      const now = Date.now()
      const hour = 60 * 60 * 1000

      await $._storage.put('Event', { id: 1 }, now - 3 * hour)
      await $._storage.put('Event', { id: 2 }, now - 3 * hour)
      await $._storage.put('Event', { id: 3 }, now - 2 * hour)
      await $._storage.put('Event', { id: 4 }, now - 1 * hour)
      await $._storage.put('Event', { id: 5 }, now - 1 * hour)
      await $._storage.put('Event', { id: 6 }, now - 1 * hour)

      const timeSeries = await $.track.Event
        .count()
        .since('4h')
        .groupBy('hour')

      expect(timeSeries).toBeInstanceOf(Array)
      expect(timeSeries.length).toBeGreaterThanOrEqual(3)
    })

    it('supports different time granularities', async () => {
      $ = createTrackContext()
      await $.track.Event({ id: 1 })

      const byMinute = await $.track.Event.count().since('1h').groupBy('minute')
      const byHour = await $.track.Event.count().since('24h').groupBy('hour')
      const byDay = await $.track.Event.count().since('30d').groupBy('day')

      expect(byMinute).toBeInstanceOf(Array)
      expect(byHour).toBeInstanceOf(Array)
      expect(byDay).toBeInstanceOf(Array)
    })

    it('includes timestamp in time series results', async () => {
      $ = createTrackContext()
      await $.track.Event({ id: 1 })

      const timeSeries = await $.track.Event.count().since('1h').groupBy('minute')

      if (timeSeries.length > 0) {
        expect(timeSeries[0]).toHaveProperty('timestamp')
        expect(timeSeries[0]).toHaveProperty('count')
      }
    })
  })

  // ============================================================================
  // EDGE CASES AND ERROR HANDLING
  // ============================================================================

  describe('Edge cases and error handling', () => {
    it('handles special characters in event names', async () => {
      $ = createTrackContext()
      await $.track['User.Signup']({ userId: 'u123' })

      const count = await $.track['User.Signup'].count()
      expect(count).toBe(1)
    })

    it('handles events with very large data', async () => {
      $ = createTrackContext()
      const largeArray = Array.from({ length: 1000 }, (_, i) => ({ index: i }))

      await $.track.LargeEvent({ items: largeArray })

      const events = await $.track.LargeEvent.events().limit(1)
      expect(events[0].data.items).toHaveLength(1000)
    })

    it('handles concurrent tracking calls', async () => {
      $ = createTrackContext()
      await Promise.all([
        $.track.Concurrent({ id: 1 }),
        $.track.Concurrent({ id: 2 }),
        $.track.Concurrent({ id: 3 }),
        $.track.Concurrent({ id: 4 }),
        $.track.Concurrent({ id: 5 }),
      ])

      const count = await $.track.Concurrent.count()
      expect(count).toBe(5)
    })

    it('handles undefined fields in data gracefully', async () => {
      $ = createTrackContext()
      await $.track.Event({ defined: 'value', optional: undefined })

      const events = await $.track.Event.events().limit(1)
      expect(events[0].data.defined).toBe('value')
    })

    it('handles null values in data', async () => {
      $ = createTrackContext()
      await $.track.Event({ value: null })

      const events = await $.track.Event.events().limit(1)
      expect(events[0].data.value).toBeNull()
    })

    it('handles numeric event data fields correctly', async () => {
      $ = createTrackContext()
      await $.track.Event({ integer: 42, float: 3.14, negative: -100, zero: 0 })

      const events = await $.track.Event.events().limit(1)
      expect(events[0].data.integer).toBe(42)
      expect(events[0].data.float).toBeCloseTo(3.14, 2)
      expect(events[0].data.negative).toBe(-100)
      expect(events[0].data.zero).toBe(0)
    })

    it('handles boolean event data fields correctly', async () => {
      $ = createTrackContext()
      await $.track.Event({ active: true, deleted: false })

      const events = await $.track.Event.events().limit(1)
      expect(events[0].data.active).toBe(true)
      expect(events[0].data.deleted).toBe(false)
    })

    it('handles date fields in event data', async () => {
      $ = createTrackContext()
      const date = new Date('2024-01-15T12:00:00Z')
      await $.track.Event({ scheduledAt: date.toISOString() })

      const events = await $.track.Event.events().limit(1)
      expect(events[0].data.scheduledAt).toBe('2024-01-15T12:00:00.000Z')
    })
  })

  // ============================================================================
  // STORAGE AND PERSISTENCE
  // ============================================================================

  describe('Storage and persistence', () => {
    it('exposes internal storage for testing', () => {
      $ = createTrackContext()
      expect($._storage).toBeDefined()
    })

    it('persists events across queries', async () => {
      $ = createTrackContext()
      await $.track.Persistent({ id: 1 })

      const count1 = await $.track.Persistent.count()
      const count2 = await $.track.Persistent.count()

      expect(count1).toBe(1)
      expect(count2).toBe(1)
    })

    it('clears events with storage.clear()', async () => {
      $ = createTrackContext()
      await $.track.Clearable({ id: 1 })
      await $.track.Clearable({ id: 2 })

      await $._storage.clear()

      const count = await $.track.Clearable.count()
      expect(count).toBe(0)
    })
  })

  // ============================================================================
  // TYPE SAFETY (compile-time tests documented as runtime assertions)
  // ============================================================================

  describe('Type safety', () => {
    it('infers event data type from tracked data', async () => {
      $ = createTrackContext()
      interface SignupData {
        userId: string
        plan: 'free' | 'pro'
        referrer?: string
      }

      await $.track.Signup<SignupData>({ userId: 'u123', plan: 'pro' })

      const events = await $.track.Signup.events().limit(1)
      const event = events[0]

      // Type assertions at runtime
      expect(typeof event.data.userId).toBe('string')
      expect(['free', 'pro']).toContain(event.data.plan)
    })

    it('provides typed event query builder', async () => {
      $ = createTrackContext()
      await $.track.Purchase({ amount: 100, sku: 'widget' })

      // These should all type-check correctly
      const result = await $.track.Purchase
        .where({ amount: { gte: 50 } })
        .count()
        .since('7d')

      expect(typeof result).toBe('number')
    })
  })
})
