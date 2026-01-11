/**
 * RED Phase Tests for Materialized Views API ($.view)
 *
 * These tests define the expected behavior of the $.view materialized views system.
 * They will FAIL until the implementation is created.
 *
 * The view API provides:
 * - $.view.define('name', { from, groupBy, compute }) - Define materialized views
 * - $.view.X.get() - Query full view
 * - $.view.X.get(key) - Query single key
 * - $.view.X.where().limit().get() - Filtered queries
 * - $.view.X.subscribe() - Real-time updates
 * - $.view.X.refresh() - Manual refresh
 *
 * Usage scenarios:
 * - Leaderboards: Top customers by spend
 * - Active users: Currently online users with page counts
 * - Revenue by product: Aggregated sales data
 * - Real-time dashboards: Live updating metrics
 *
 * @module workflows/data/view/tests/view
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Import the view API (will fail - module doesn't exist yet)
import {
  createViewContext,
  type ViewContext,
  type ViewDefinition,
  type ViewQuery,
  type ViewSubscription,
  type ComputeAggregates,
} from '../context'

describe('Materialized Views API ($.view)', () => {
  let $: ViewContext

  beforeEach(() => {
    // Create a fresh view context for each test
    $ = createViewContext()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ============================================================================
  // VIEW DEFINITION - $.view.define()
  // ============================================================================

  describe('$.view.define()', () => {
    describe('basic view definition', () => {
      it('defines a simple aggregation view', async () => {
        await $.view.define('leaderboard', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: {
            totalSpent: $.sum('amount'),
            orderCount: $.count(),
          },
        })

        const view = await $._storage.views.get('leaderboard')

        expect(view).toBeDefined()
        expect(view?.name).toBe('leaderboard')
        expect(view?.groupBy).toBe('userId')
        expect(view?.compute).toHaveProperty('totalSpent')
        expect(view?.compute).toHaveProperty('orderCount')
      })

      it('defines a view with multiple group keys', async () => {
        await $.view.define('revenueByRegionProduct', {
          from: $.track.Purchase,
          groupBy: ['region', 'productId'],
          compute: {
            revenue: $.sum('amount'),
            units: $.sum('quantity'),
          },
        })

        const view = await $._storage.views.get('revenueByRegionProduct')

        expect(view?.groupBy).toEqual(['region', 'productId'])
      })

      it('defines a view with ordering', async () => {
        await $.view.define('topSpenders', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: {
            totalSpent: $.sum('amount'),
          },
          orderBy: { totalSpent: 'desc' },
        })

        const view = await $._storage.views.get('topSpenders')

        expect(view?.orderBy).toEqual({ totalSpent: 'desc' })
      })

      it('defines a view with limit', async () => {
        await $.view.define('top100', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: {
            totalSpent: $.sum('amount'),
          },
          orderBy: { totalSpent: 'desc' },
          limit: 100,
        })

        const view = await $._storage.views.get('top100')

        expect(view?.limit).toBe(100)
      })

      it('defines a view with filter predicate', async () => {
        await $.view.define('activeUsers', {
          from: $.track.PageView,
          where: (event) => event.timestamp > Date.now() - 30 * 60 * 1000,
          groupBy: 'userId',
          compute: {
            pageCount: $.count(),
            lastSeen: $.max('timestamp'),
          },
        })

        const view = await $._storage.views.get('activeUsers')

        expect(view?.where).toBeDefined()
        expect(typeof view?.where).toBe('function')
      })

      it('prevents duplicate view names', async () => {
        await $.view.define('duplicate', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: { count: $.count() },
        })

        await expect(
          $.view.define('duplicate', {
            from: $.track.Purchase,
            groupBy: 'productId',
            compute: { count: $.count() },
          })
        ).rejects.toThrow(/already exists|duplicate/i)
      })

      it('validates required fields', async () => {
        // Missing groupBy
        await expect(
          $.view.define('invalid1', {
            from: $.track.Purchase,
            compute: { count: $.count() },
          } as ViewDefinition)
        ).rejects.toThrow()

        // Missing compute
        await expect(
          $.view.define('invalid2', {
            from: $.track.Purchase,
            groupBy: 'userId',
          } as ViewDefinition)
        ).rejects.toThrow()
      })

      it('validates view name format', async () => {
        await expect(
          $.view.define('', {
            from: $.track.Purchase,
            groupBy: 'userId',
            compute: { count: $.count() },
          })
        ).rejects.toThrow(/empty|name/i)

        await expect(
          $.view.define('invalid name with spaces', {
            from: $.track.Purchase,
            groupBy: 'userId',
            compute: { count: $.count() },
          })
        ).rejects.toThrow(/invalid|name/i)
      })
    })

    describe('compute aggregates', () => {
      it('supports $.sum() aggregate', async () => {
        await $.view.define('sumTest', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: {
            totalAmount: $.sum('amount'),
          },
        })

        // Simulate events
        await $.track.Purchase({ userId: 'u1', amount: 100 })
        await $.track.Purchase({ userId: 'u1', amount: 200 })

        const result = await $.view.sumTest.get('u1')

        expect(result?.totalAmount).toBe(300)
      })

      it('supports $.count() aggregate', async () => {
        await $.view.define('countTest', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: {
            orderCount: $.count(),
          },
        })

        await $.track.Purchase({ userId: 'u1', amount: 100 })
        await $.track.Purchase({ userId: 'u1', amount: 200 })
        await $.track.Purchase({ userId: 'u1', amount: 300 })

        const result = await $.view.countTest.get('u1')

        expect(result?.orderCount).toBe(3)
      })

      it('supports $.avg() aggregate', async () => {
        await $.view.define('avgTest', {
          from: $.track.Purchase,
          groupBy: 'productId',
          compute: {
            avgPrice: $.avg('price'),
          },
        })

        await $.track.Purchase({ productId: 'p1', price: 100 })
        await $.track.Purchase({ productId: 'p1', price: 200 })

        const result = await $.view.avgTest.get('p1')

        expect(result?.avgPrice).toBe(150)
      })

      it('supports $.min() aggregate', async () => {
        await $.view.define('minTest', {
          from: $.track.Purchase,
          groupBy: 'productId',
          compute: {
            lowestPrice: $.min('price'),
          },
        })

        await $.track.Purchase({ productId: 'p1', price: 150 })
        await $.track.Purchase({ productId: 'p1', price: 100 })
        await $.track.Purchase({ productId: 'p1', price: 200 })

        const result = await $.view.minTest.get('p1')

        expect(result?.lowestPrice).toBe(100)
      })

      it('supports $.max() aggregate', async () => {
        await $.view.define('maxTest', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: {
            lastOrder: $.max('timestamp'),
          },
        })

        const timestamps = [1000, 3000, 2000]
        for (const ts of timestamps) {
          await $.track.Purchase({ userId: 'u1', timestamp: ts })
        }

        const result = await $.view.maxTest.get('u1')

        expect(result?.lastOrder).toBe(3000)
      })

      it('supports $.first() aggregate', async () => {
        await $.view.define('firstTest', {
          from: $.track.Signup,
          groupBy: 'userId',
          compute: {
            firstPlan: $.first('plan'),
          },
        })

        await $.track.Signup({ userId: 'u1', plan: 'free', timestamp: 1000 })
        await $.track.Signup({ userId: 'u1', plan: 'pro', timestamp: 2000 })

        const result = await $.view.firstTest.get('u1')

        expect(result?.firstPlan).toBe('free')
      })

      it('supports $.last() aggregate', async () => {
        await $.view.define('lastTest', {
          from: $.track.Signup,
          groupBy: 'userId',
          compute: {
            currentPlan: $.last('plan'),
          },
        })

        await $.track.Signup({ userId: 'u1', plan: 'free', timestamp: 1000 })
        await $.track.Signup({ userId: 'u1', plan: 'pro', timestamp: 2000 })

        const result = await $.view.lastTest.get('u1')

        expect(result?.currentPlan).toBe('pro')
      })

      it('supports $.countDistinct() aggregate', async () => {
        await $.view.define('distinctTest', {
          from: $.track.PageView,
          groupBy: 'userId',
          compute: {
            uniquePages: $.countDistinct('path'),
          },
        })

        await $.track.PageView({ userId: 'u1', path: '/home' })
        await $.track.PageView({ userId: 'u1', path: '/pricing' })
        await $.track.PageView({ userId: 'u1', path: '/home' }) // duplicate

        const result = await $.view.distinctTest.get('u1')

        expect(result?.uniquePages).toBe(2)
      })

      it('supports multiple aggregates in one view', async () => {
        await $.view.define('multiAggregate', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: {
            totalSpent: $.sum('amount'),
            orderCount: $.count(),
            avgOrder: $.avg('amount'),
            firstOrder: $.min('timestamp'),
            lastOrder: $.max('timestamp'),
          },
        })

        await $.track.Purchase({ userId: 'u1', amount: 100, timestamp: 1000 })
        await $.track.Purchase({ userId: 'u1', amount: 200, timestamp: 2000 })
        await $.track.Purchase({ userId: 'u1', amount: 300, timestamp: 3000 })

        const result = await $.view.multiAggregate.get('u1')

        expect(result?.totalSpent).toBe(600)
        expect(result?.orderCount).toBe(3)
        expect(result?.avgOrder).toBe(200)
        expect(result?.firstOrder).toBe(1000)
        expect(result?.lastOrder).toBe(3000)
      })
    })

    describe('incremental views', () => {
      it('defines an incremental view', async () => {
        await $.view.define('incrementalRevenue', {
          from: $.stream.from.Order.created,
          groupBy: 'productId',
          compute: {
            revenue: $.sum('total'),
            units: $.sum('quantity'),
          },
          incremental: true,
        })

        const view = await $._storage.views.get('incrementalRevenue')

        expect(view?.incremental).toBe(true)
      })

      it('updates incrementally on each event', async () => {
        await $.view.define('liveRevenue', {
          from: $.stream.from.Order.created,
          groupBy: 'productId',
          compute: {
            revenue: $.sum('total'),
          },
          incremental: true,
        })

        // First event
        await $.stream.emit('Order.created', { productId: 'p1', total: 100 })

        let result = await $.view.liveRevenue.get('p1')
        expect(result?.revenue).toBe(100)

        // Second event - should update immediately
        await $.stream.emit('Order.created', { productId: 'p1', total: 200 })

        result = await $.view.liveRevenue.get('p1')
        expect(result?.revenue).toBe(300)
      })

      it('handles event retractions for incremental views', async () => {
        await $.view.define('retractable', {
          from: $.stream.from.Order.created,
          groupBy: 'productId',
          compute: {
            total: $.sum('amount'),
          },
          incremental: true,
        })

        await $.stream.emit('Order.created', { eventId: 'e1', productId: 'p1', amount: 100 })
        await $.stream.emit('Order.created', { eventId: 'e2', productId: 'p1', amount: 200 })

        // Retract the first event
        await $.stream.retract('Order.created', 'e1')

        const result = await $.view.retractable.get('p1')
        expect(result?.total).toBe(200)
      })
    })
  })

  // ============================================================================
  // VIEW QUERIES - $.view.X.get()
  // ============================================================================

  describe('$.view.X.get()', () => {
    beforeEach(async () => {
      // Set up a leaderboard view for testing
      await $.view.define('leaderboard', {
        from: $.track.Purchase,
        groupBy: 'userId',
        compute: {
          totalSpent: $.sum('amount'),
          orderCount: $.count(),
          lastOrder: $.max('timestamp'),
        },
        orderBy: { totalSpent: 'desc' },
      })

      // Populate with test data
      await $.track.Purchase({ userId: 'user1', amount: 500, timestamp: 1000 })
      await $.track.Purchase({ userId: 'user1', amount: 300, timestamp: 2000 })
      await $.track.Purchase({ userId: 'user2', amount: 1000, timestamp: 1500 })
      await $.track.Purchase({ userId: 'user3', amount: 200, timestamp: 1200 })
    })

    describe('full view query', () => {
      it('returns all rows from view', async () => {
        const results = await $.view.leaderboard.get()

        expect(results).toHaveLength(3)
        expect(results.map((r: Record<string, unknown>) => r.userId)).toContain('user1')
        expect(results.map((r: Record<string, unknown>) => r.userId)).toContain('user2')
        expect(results.map((r: Record<string, unknown>) => r.userId)).toContain('user3')
      })

      it('returns rows in order specified by orderBy', async () => {
        const results = await $.view.leaderboard.get()

        // user2 has most spent (1000), then user1 (800), then user3 (200)
        expect(results[0].userId).toBe('user2')
        expect(results[0].totalSpent).toBe(1000)
        expect(results[1].userId).toBe('user1')
        expect(results[1].totalSpent).toBe(800)
        expect(results[2].userId).toBe('user3')
        expect(results[2].totalSpent).toBe(200)
      })

      it('returns empty array for empty view', async () => {
        await $.view.define('emptyView', {
          from: $.track.Checkout,
          groupBy: 'sessionId',
          compute: { count: $.count() },
        })

        const results = await $.view.emptyView.get()

        expect(results).toEqual([])
      })

      it('respects view limit', async () => {
        await $.view.define('top2', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: { totalSpent: $.sum('amount') },
          orderBy: { totalSpent: 'desc' },
          limit: 2,
        })

        // Add data
        await $.track.Purchase({ userId: 'u1', amount: 100 })
        await $.track.Purchase({ userId: 'u2', amount: 200 })
        await $.track.Purchase({ userId: 'u3', amount: 300 })

        const results = await $.view.top2.get()

        expect(results).toHaveLength(2)
      })
    })

    describe('single key lookup', () => {
      it('returns single row by key', async () => {
        const result = await $.view.leaderboard.get('user1')

        expect(result).toBeDefined()
        expect(result?.userId).toBe('user1')
        expect(result?.totalSpent).toBe(800)
        expect(result?.orderCount).toBe(2)
      })

      it('returns null for nonexistent key', async () => {
        const result = await $.view.leaderboard.get('nonexistent')

        expect(result).toBeNull()
      })

      it('supports composite key lookup', async () => {
        await $.view.define('compositeView', {
          from: $.track.Purchase,
          groupBy: ['region', 'productId'],
          compute: { revenue: $.sum('amount') },
        })

        await $.track.Purchase({ region: 'us', productId: 'p1', amount: 100 })
        await $.track.Purchase({ region: 'eu', productId: 'p1', amount: 200 })

        const result = await $.view.compositeView.get({ region: 'us', productId: 'p1' })

        expect(result?.revenue).toBe(100)
      })
    })

    describe('view access errors', () => {
      it('throws for undefined view', async () => {
        await expect($.view.nonexistent.get()).rejects.toThrow(/not found|undefined|does not exist/i)
      })
    })
  })

  // ============================================================================
  // VIEW QUERIES - $.view.X.where().limit()
  // ============================================================================

  describe('$.view.X.where().limit()', () => {
    beforeEach(async () => {
      await $.view.define('customers', {
        from: $.track.Purchase,
        groupBy: 'userId',
        compute: {
          totalSpent: $.sum('amount'),
          orderCount: $.count(),
          avgOrder: $.avg('amount'),
        },
        orderBy: { totalSpent: 'desc' },
      })

      // Populate with varied data
      await $.track.Purchase({ userId: 'whale', amount: 5000 })
      await $.track.Purchase({ userId: 'whale', amount: 3000 })
      await $.track.Purchase({ userId: 'medium1', amount: 500 })
      await $.track.Purchase({ userId: 'medium2', amount: 600 })
      await $.track.Purchase({ userId: 'small1', amount: 50 })
      await $.track.Purchase({ userId: 'small2', amount: 75 })
    })

    describe('.where() filters', () => {
      it('filters by equality', async () => {
        const results = await $.view.customers.where({ userId: 'whale' }).get()

        expect(results).toHaveLength(1)
        expect(results[0].userId).toBe('whale')
      })

      it('filters by greater than', async () => {
        const results = await $.view.customers
          .where({ totalSpent: { gt: 500 } })
          .get()

        expect(results.every((r: Record<string, number>) => r.totalSpent > 500)).toBe(true)
      })

      it('filters by greater than or equal', async () => {
        const results = await $.view.customers
          .where({ totalSpent: { gte: 500 } })
          .get()

        expect(results.every((r: Record<string, number>) => r.totalSpent >= 500)).toBe(true)
      })

      it('filters by less than', async () => {
        const results = await $.view.customers
          .where({ totalSpent: { lt: 500 } })
          .get()

        expect(results.every((r: Record<string, number>) => r.totalSpent < 500)).toBe(true)
      })

      it('filters by less than or equal', async () => {
        const results = await $.view.customers
          .where({ totalSpent: { lte: 500 } })
          .get()

        expect(results.every((r: Record<string, number>) => r.totalSpent <= 500)).toBe(true)
      })

      it('filters by range (between)', async () => {
        const results = await $.view.customers
          .where({ totalSpent: { gte: 100, lte: 1000 } })
          .get()

        expect(
          results.every(
            (r: Record<string, number>) => r.totalSpent >= 100 && r.totalSpent <= 1000
          )
        ).toBe(true)
      })

      it('filters by not equal', async () => {
        const results = await $.view.customers
          .where({ userId: { ne: 'whale' } })
          .get()

        expect(results.every((r: Record<string, string>) => r.userId !== 'whale')).toBe(true)
      })

      it('filters by in array', async () => {
        const results = await $.view.customers
          .where({ userId: { in: ['whale', 'medium1'] } })
          .get()

        expect(results).toHaveLength(2)
        expect(results.map((r: Record<string, string>) => r.userId)).toContain('whale')
        expect(results.map((r: Record<string, string>) => r.userId)).toContain('medium1')
      })

      it('supports multiple filter conditions (AND)', async () => {
        const results = await $.view.customers
          .where({
            totalSpent: { gte: 500 },
            orderCount: { gte: 1 },
          })
          .get()

        expect(
          results.every(
            (r: Record<string, number>) => r.totalSpent >= 500 && r.orderCount >= 1
          )
        ).toBe(true)
      })

      it('supports function predicate', async () => {
        const results = await $.view.customers
          .where((row) => row.avgOrder > 100)
          .get()

        expect(results.every((r: Record<string, number>) => r.avgOrder > 100)).toBe(true)
      })
    })

    describe('.limit() pagination', () => {
      it('limits result count', async () => {
        const results = await $.view.customers.limit(2).get()

        expect(results).toHaveLength(2)
      })

      it('returns all when limit exceeds count', async () => {
        const results = await $.view.customers.limit(100).get()

        expect(results.length).toBeLessThanOrEqual(6)
      })

      it('supports offset for pagination', async () => {
        const page1 = await $.view.customers.limit(2).offset(0).get()
        const page2 = await $.view.customers.limit(2).offset(2).get()

        expect(page1).toHaveLength(2)
        expect(page2).toHaveLength(2)
        expect(page1[0].userId).not.toBe(page2[0].userId)
      })

      it('combines where and limit', async () => {
        const results = await $.view.customers
          .where({ totalSpent: { gt: 100 } })
          .limit(2)
          .get()

        expect(results).toHaveLength(2)
        expect(results.every((r: Record<string, number>) => r.totalSpent > 100)).toBe(true)
      })
    })

    describe('.orderBy() override', () => {
      it('overrides default ordering', async () => {
        const results = await $.view.customers.orderBy({ orderCount: 'asc' }).get()

        for (let i = 1; i < results.length; i++) {
          expect(results[i].orderCount).toBeGreaterThanOrEqual(results[i - 1].orderCount)
        }
      })

      it('supports multiple order keys', async () => {
        await $.view.define('multiOrder', {
          from: $.track.Purchase,
          groupBy: ['category', 'userId'],
          compute: {
            total: $.sum('amount'),
            count: $.count(),
          },
        })

        await $.track.Purchase({ category: 'A', userId: 'u1', amount: 100 })
        await $.track.Purchase({ category: 'A', userId: 'u2', amount: 200 })
        await $.track.Purchase({ category: 'B', userId: 'u1', amount: 50 })

        const results = await $.view.multiOrder
          .orderBy({ category: 'asc', total: 'desc' })
          .get()

        expect(results[0].category).toBe('A')
      })
    })
  })

  // ============================================================================
  // SUBSCRIPTIONS - $.view.X.subscribe()
  // ============================================================================

  describe('$.view.X.subscribe()', () => {
    beforeEach(async () => {
      await $.view.define('liveLeaderboard', {
        from: $.track.Purchase,
        groupBy: 'userId',
        compute: {
          totalSpent: $.sum('amount'),
          orderCount: $.count(),
        },
        orderBy: { totalSpent: 'desc' },
        incremental: true,
      })
    })

    describe('simple subscription', () => {
      it('receives updates when view changes', async () => {
        const updates: unknown[] = []

        const subscription = $.view.liveLeaderboard.subscribe((changes) => {
          updates.push(changes)
        })

        await $.track.Purchase({ userId: 'newUser', amount: 100 })

        // Wait for async propagation
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(updates.length).toBeGreaterThan(0)

        subscription.unsubscribe()
      })

      it('can unsubscribe to stop receiving updates', async () => {
        const updates: unknown[] = []

        const subscription = $.view.liveLeaderboard.subscribe((changes) => {
          updates.push(changes)
        })

        await $.track.Purchase({ userId: 'u1', amount: 100 })
        await new Promise((resolve) => setTimeout(resolve, 10))

        const countBefore = updates.length

        subscription.unsubscribe()

        await $.track.Purchase({ userId: 'u1', amount: 200 })
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(updates.length).toBe(countBefore)
      })

      it('returns subscription object with unsubscribe method', async () => {
        const subscription = $.view.liveLeaderboard.subscribe(() => {})

        expect(subscription).toBeDefined()
        expect(typeof subscription.unsubscribe).toBe('function')

        subscription.unsubscribe()
      })
    })

    describe('granular callbacks', () => {
      it('calls onInsert for new rows', async () => {
        const inserts: unknown[] = []

        const subscription = $.view.liveLeaderboard.subscribe({
          onInsert: (row) => inserts.push(row),
        })

        await $.track.Purchase({ userId: 'brandNewUser', amount: 100 })
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(inserts.length).toBe(1)
        expect(inserts[0]).toHaveProperty('userId', 'brandNewUser')

        subscription.unsubscribe()
      })

      it('calls onUpdate for changed rows', async () => {
        // Pre-populate
        await $.track.Purchase({ userId: 'existingUser', amount: 100 })

        const updates: Array<{ before: unknown; after: unknown }> = []

        const subscription = $.view.liveLeaderboard.subscribe({
          onUpdate: (before, after) => updates.push({ before, after }),
        })

        await $.track.Purchase({ userId: 'existingUser', amount: 200 })
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(updates.length).toBe(1)
        expect((updates[0].before as Record<string, number>).totalSpent).toBe(100)
        expect((updates[0].after as Record<string, number>).totalSpent).toBe(300)

        subscription.unsubscribe()
      })

      it('calls onDelete for removed rows', async () => {
        await $.view.define('expiringUsers', {
          from: $.track.PageView,
          where: (event) => event.timestamp > Date.now() - 60000,
          groupBy: 'userId',
          compute: { pageCount: $.count() },
          incremental: true,
        })

        await $.track.PageView({ userId: 'tempUser', timestamp: Date.now() })

        const deletes: unknown[] = []

        const subscription = $.view.expiringUsers.subscribe({
          onDelete: (row) => deletes.push(row),
        })

        // Simulate time passing and row expiring
        await $._internal.simulateTimePass(70000)
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(deletes.length).toBe(1)
        expect(deletes[0]).toHaveProperty('userId', 'tempUser')

        subscription.unsubscribe()
      })

      it('supports all three callbacks together', async () => {
        const events = {
          inserts: [] as unknown[],
          updates: [] as unknown[],
          deletes: [] as unknown[],
        }

        const subscription = $.view.liveLeaderboard.subscribe({
          onInsert: (row) => events.inserts.push(row),
          onUpdate: (before, after) => events.updates.push({ before, after }),
          onDelete: (row) => events.deletes.push(row),
        })

        // Insert
        await $.track.Purchase({ userId: 'subUser', amount: 100 })
        // Update
        await $.track.Purchase({ userId: 'subUser', amount: 200 })

        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(events.inserts.length).toBe(1)
        expect(events.updates.length).toBe(1)

        subscription.unsubscribe()
      })
    })

    describe('filtered subscriptions', () => {
      it('subscribes with filter predicate', async () => {
        const updates: unknown[] = []

        const subscription = $.view.liveLeaderboard.subscribe(
          (changes) => updates.push(changes),
          { where: { totalSpent: { gte: 1000 } } }
        )

        await $.track.Purchase({ userId: 'smallBuyer', amount: 50 })
        await $.track.Purchase({ userId: 'bigBuyer', amount: 1500 })

        await new Promise((resolve) => setTimeout(resolve, 10))

        // Should only receive update for bigBuyer
        expect(
          updates.every((u) =>
            (u as Record<string, number>).totalSpent >= 1000 ||
            (u as Record<string, unknown[]>).changes?.every((c: Record<string, number>) => c.totalSpent >= 1000)
          )
        ).toBe(true)

        subscription.unsubscribe()
      })
    })

    describe('subscription errors', () => {
      it('throws for undefined view', () => {
        expect(() => {
          $.view.nonexistentView.subscribe(() => {})
        }).toThrow(/not found|undefined/i)
      })
    })
  })

  // ============================================================================
  // MANUAL REFRESH - $.view.X.refresh()
  // ============================================================================

  describe('$.view.X.refresh()', () => {
    beforeEach(async () => {
      await $.view.define('batchView', {
        from: $.track.Purchase,
        groupBy: 'userId',
        compute: {
          totalSpent: $.sum('amount'),
        },
        incremental: false, // Batch mode
      })
    })

    describe('full refresh', () => {
      it('rebuilds entire view from source', async () => {
        // Add data
        await $.track.Purchase({ userId: 'u1', amount: 100 })
        await $.track.Purchase({ userId: 'u1', amount: 200 })

        // Manual refresh
        await $.view.batchView.refresh()

        const result = await $.view.batchView.get('u1')

        expect(result?.totalSpent).toBe(300)
      })

      it('returns refresh metadata', async () => {
        await $.track.Purchase({ userId: 'u1', amount: 100 })

        const result = await $.view.batchView.refresh()

        expect(result).toHaveProperty('rowsProcessed')
        expect(result).toHaveProperty('duration')
        expect(result).toHaveProperty('timestamp')
      })

      it('clears and rebuilds view', async () => {
        await $.track.Purchase({ userId: 'u1', amount: 100 })
        await $.view.batchView.refresh()

        // Directly modify underlying data (simulating corruption or data fix)
        await $._internal.directWrite('track.Purchase', { userId: 'u1', amount: -50 })

        // Before refresh, view shows old data
        let result = await $.view.batchView.get('u1')
        expect(result?.totalSpent).toBe(100)

        // After refresh, view reflects corrected data
        await $.view.batchView.refresh()
        result = await $.view.batchView.get('u1')
        expect(result?.totalSpent).toBe(50)
      })
    })

    describe('incremental refresh', () => {
      beforeEach(async () => {
        await $.view.define('incrementalView', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: {
            totalSpent: $.sum('amount'),
          },
          incremental: true,
        })
      })

      it('refreshes only since specified time', async () => {
        const t1 = Date.now()
        await $.track.Purchase({ userId: 'u1', amount: 100, timestamp: t1 })

        const t2 = Date.now() + 1000
        await $.track.Purchase({ userId: 'u1', amount: 200, timestamp: t2 })

        // Simulate partial corruption - only refresh recent data
        const result = await $.view.incrementalView.refresh({
          incremental: true,
          since: t2 - 500,
        })

        expect(result.rowsProcessed).toBe(1) // Only second event
      })

      it('refreshes from last checkpoint by default', async () => {
        await $.track.Purchase({ userId: 'u1', amount: 100 })
        await $.view.incrementalView.refresh()

        // Add more data
        await $.track.Purchase({ userId: 'u1', amount: 200 })

        // Incremental refresh processes only new data
        const result = await $.view.incrementalView.refresh({ incremental: true })

        expect(result.rowsProcessed).toBe(1)
      })
    })

    describe('refresh errors', () => {
      it('throws for undefined view', async () => {
        await expect($.view.nonexistent.refresh()).rejects.toThrow(/not found/i)
      })

      it('handles source unavailable gracefully', async () => {
        // Simulate source being temporarily unavailable
        $._internal.disableSource('track.Purchase')

        await expect($.view.batchView.refresh()).rejects.toThrow(/source.*unavailable/i)

        $._internal.enableSource('track.Purchase')
      })
    })
  })

  // ============================================================================
  // CONSISTENCY OPTIONS
  // ============================================================================

  describe('Consistency options', () => {
    beforeEach(async () => {
      await $.view.define('consistentView', {
        from: $.track.Purchase,
        groupBy: 'userId',
        compute: {
          totalSpent: $.sum('amount'),
        },
        incremental: true,
      })
    })

    describe('read consistency levels', () => {
      it('supports eventual consistency (default)', async () => {
        await $.track.Purchase({ userId: 'u1', amount: 100 })

        // Eventual consistency - may not see latest write
        const result = await $.view.consistentView.get('u1', {
          consistency: 'eventual',
        })

        // Result may or may not include the write
        expect(result === null || result?.totalSpent === 100).toBe(true)
      })

      it('supports strong consistency', async () => {
        await $.track.Purchase({ userId: 'u1', amount: 100 })

        // Strong consistency - must see latest write
        const result = await $.view.consistentView.get('u1', {
          consistency: 'strong',
        })

        expect(result?.totalSpent).toBe(100)
      })

      it('supports bounded staleness', async () => {
        await $.track.Purchase({ userId: 'u1', amount: 100, timestamp: Date.now() - 5000 })

        // Bounded staleness - data within staleness window
        const result = await $.view.consistentView.get('u1', {
          consistency: 'bounded',
          maxStaleness: 10000, // 10 seconds
        })

        expect(result?.totalSpent).toBe(100)
      })

      it('returns stale data indicator', async () => {
        await $.track.Purchase({ userId: 'u1', amount: 100 })

        const result = await $.view.consistentView.get('u1', {
          consistency: 'eventual',
          includeMetadata: true,
        })

        expect(result).toHaveProperty('_metadata')
        expect(result?._metadata).toHaveProperty('staleness')
        expect(typeof result?._metadata.staleness).toBe('number')
      })
    })

    describe('write consistency', () => {
      it('waits for view update confirmation', async () => {
        const writeResult = await $.track.Purchase(
          { userId: 'u1', amount: 100 },
          { awaitViews: ['consistentView'] }
        )

        expect(writeResult.viewsUpdated).toContain('consistentView')

        // View should definitely be updated now
        const viewResult = await $.view.consistentView.get('u1')
        expect(viewResult?.totalSpent).toBe(100)
      })
    })
  })

  // ============================================================================
  // VIEW MANAGEMENT
  // ============================================================================

  describe('View management', () => {
    describe('listing views', () => {
      it('lists all defined views', async () => {
        await $.view.define('view1', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: { count: $.count() },
        })
        await $.view.define('view2', {
          from: $.track.PageView,
          groupBy: 'path',
          compute: { count: $.count() },
        })

        const views = await $.view.list()

        expect(views).toHaveLength(2)
        expect(views.map((v: ViewDefinition) => v.name)).toContain('view1')
        expect(views.map((v: ViewDefinition) => v.name)).toContain('view2')
      })

      it('returns view metadata', async () => {
        await $.view.define('metadataView', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: { count: $.count() },
        })

        const views = await $.view.list()
        const view = views.find((v: ViewDefinition) => v.name === 'metadataView')

        expect(view).toHaveProperty('name')
        expect(view).toHaveProperty('createdAt')
        expect(view).toHaveProperty('lastRefresh')
        expect(view).toHaveProperty('rowCount')
      })
    })

    describe('view info', () => {
      it('gets detailed view information', async () => {
        await $.view.define('infoView', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: {
            totalSpent: $.sum('amount'),
            orderCount: $.count(),
          },
        })

        await $.track.Purchase({ userId: 'u1', amount: 100 })
        await $.view.infoView.refresh()

        const info = await $.view.infoView.info()

        expect(info.name).toBe('infoView')
        expect(info.groupBy).toBe('userId')
        expect(info.computeFields).toContain('totalSpent')
        expect(info.computeFields).toContain('orderCount')
        expect(info.rowCount).toBe(1)
        expect(info.lastRefresh).toBeDefined()
      })
    })

    describe('dropping views', () => {
      it('drops a view', async () => {
        await $.view.define('droppable', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: { count: $.count() },
        })

        await $.view.droppable.drop()

        const views = await $.view.list()
        expect(views.map((v: ViewDefinition) => v.name)).not.toContain('droppable')
      })

      it('clears view data when dropped', async () => {
        await $.view.define('dataClean', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: { count: $.count() },
        })

        await $.track.Purchase({ userId: 'u1', amount: 100 })
        await $.view.dataClean.refresh()

        await $.view.dataClean.drop()

        // Verify data is cleaned up
        const storage = await $._internal.getViewStorage('dataClean')
        expect(storage).toBeNull()
      })

      it('throws when dropping nonexistent view', async () => {
        await expect($.view.nonexistent.drop()).rejects.toThrow(/not found/i)
      })
    })

    describe('updating view definition', () => {
      it('updates view compute fields', async () => {
        await $.view.define('updatable', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: { count: $.count() },
        })

        await $.view.updatable.update({
          compute: {
            count: $.count(),
            total: $.sum('amount'), // Add new field
          },
        })

        const info = await $.view.updatable.info()
        expect(info.computeFields).toContain('total')
      })

      it('triggers refresh after update', async () => {
        await $.view.define('autoRefresh', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: { count: $.count() },
        })

        await $.track.Purchase({ userId: 'u1', amount: 100 })

        const refreshSpy = vi.spyOn($._internal, 'refreshView')

        await $.view.autoRefresh.update({
          compute: { total: $.sum('amount') },
        })

        expect(refreshSpy).toHaveBeenCalledWith('autoRefresh')
      })
    })
  })

  // ============================================================================
  // EDGE CASES AND ERROR HANDLING
  // ============================================================================

  describe('Edge cases', () => {
    describe('null and undefined handling', () => {
      it('handles null values in aggregations', async () => {
        await $.view.define('nullHandling', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: {
            total: $.sum('amount'),
            avg: $.avg('amount'),
          },
        })

        await $.track.Purchase({ userId: 'u1', amount: null })
        await $.track.Purchase({ userId: 'u1', amount: 100 })

        const result = await $.view.nullHandling.get('u1')

        // Nulls should be ignored in aggregations
        expect(result?.total).toBe(100)
        expect(result?.avg).toBe(100)
      })

      it('handles undefined group keys', async () => {
        await $.view.define('undefinedKey', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: { count: $.count() },
        })

        await $.track.Purchase({ amount: 100 }) // No userId

        const result = await $.view.undefinedKey.get(undefined as unknown as string)

        expect(result?.count).toBe(1)
      })
    })

    describe('large dataset handling', () => {
      it('handles large number of groups', async () => {
        await $.view.define('largeGroups', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: { count: $.count() },
        })

        // Add 10000 unique users
        const events = Array.from({ length: 10000 }, (_, i) => ({
          userId: `user-${i}`,
          amount: 100,
        }))

        for (const event of events) {
          await $.track.Purchase(event)
        }

        await $.view.largeGroups.refresh()

        const info = await $.view.largeGroups.info()
        expect(info.rowCount).toBe(10000)
      }, 30000)

      it('handles high cardinality group keys efficiently', async () => {
        await $.view.define('highCardinality', {
          from: $.track.PageView,
          groupBy: ['userId', 'sessionId', 'path'],
          compute: { count: $.count() },
        })

        // Add diverse data
        for (let i = 0; i < 1000; i++) {
          await $.track.PageView({
            userId: `u${i % 100}`,
            sessionId: `s${i}`,
            path: `/page${i % 50}`,
          })
        }

        const start = Date.now()
        await $.view.highCardinality.refresh()
        const duration = Date.now() - start

        // Should complete in reasonable time
        expect(duration).toBeLessThan(5000)
      })
    })

    describe('concurrent operations', () => {
      it('handles concurrent refreshes', async () => {
        await $.view.define('concurrentRefresh', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: { total: $.sum('amount') },
        })

        await $.track.Purchase({ userId: 'u1', amount: 100 })

        // Concurrent refreshes should not corrupt data
        await Promise.all([
          $.view.concurrentRefresh.refresh(),
          $.view.concurrentRefresh.refresh(),
          $.view.concurrentRefresh.refresh(),
        ])

        const result = await $.view.concurrentRefresh.get('u1')
        expect(result?.total).toBe(100)
      })

      it('handles concurrent writes and reads', async () => {
        await $.view.define('concurrentRW', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: { total: $.sum('amount') },
          incremental: true,
        })

        // Start writes
        const writes = Array.from({ length: 100 }, (_, i) =>
          $.track.Purchase({ userId: 'u1', amount: 10 })
        )

        // Start reads concurrently
        const reads = Array.from({ length: 50 }, () =>
          $.view.concurrentRW.get('u1')
        )

        await Promise.all([...writes, ...reads])

        // Final state should be consistent
        const result = await $.view.concurrentRW.get('u1', { consistency: 'strong' })
        expect(result?.total).toBe(1000)
      })
    })

    describe('type coercion', () => {
      it('coerces string numbers in aggregations', async () => {
        await $.view.define('stringCoerce', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: { total: $.sum('amount') },
        })

        await $.track.Purchase({ userId: 'u1', amount: '100' as unknown as number })
        await $.track.Purchase({ userId: 'u1', amount: 200 })

        const result = await $.view.stringCoerce.get('u1')
        expect(result?.total).toBe(300)
      })
    })
  })

  // ============================================================================
  // INTEGRATION WITH OTHER $ APIS
  // ============================================================================

  describe('Integration with other $ APIs', () => {
    describe('with $.track', () => {
      it('view updates when tracked events arrive', async () => {
        await $.view.define('trackIntegration', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: { total: $.sum('amount') },
          incremental: true,
        })

        await $.track.Purchase({ userId: 'u1', amount: 100 })

        const result = await $.view.trackIntegration.get('u1', { consistency: 'strong' })
        expect(result?.total).toBe(100)
      })
    })

    describe('with $.stream', () => {
      it('view updates from stream events', async () => {
        await $.view.define('streamIntegration', {
          from: $.stream.from.Order.created,
          groupBy: 'customerId',
          compute: { orderTotal: $.sum('total') },
          incremental: true,
        })

        await $.stream.emit('Order.created', { customerId: 'c1', total: 500 })

        const result = await $.view.streamIntegration.get('c1', { consistency: 'strong' })
        expect(result?.orderTotal).toBe(500)
      })
    })

    describe('with $.on', () => {
      it('can query views from event handlers', async () => {
        await $.view.define('handlerView', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: { total: $.sum('amount') },
        })

        await $.track.Purchase({ userId: 'u1', amount: 100 })
        await $.view.handlerView.refresh()

        let capturedTotal: number | null = null

        $.on.Customer.signup(async (event) => {
          const stats = await $.view.handlerView.get(event.userId)
          capturedTotal = stats?.total ?? 0
        })

        await $.Customer('u1').signup({ name: 'Test' })

        expect(capturedTotal).toBe(100)
      })
    })

    describe('with $.every', () => {
      it('scheduled view refresh', async () => {
        await $.view.define('scheduledView', {
          from: $.track.Purchase,
          groupBy: 'userId',
          compute: { total: $.sum('amount') },
          incremental: false,
        })

        const refreshSpy = vi.fn()
        vi.spyOn($.view.scheduledView, 'refresh').mockImplementation(refreshSpy)

        $.every.hour(async () => {
          await $.view.scheduledView.refresh()
        })

        // Simulate hour passing
        await $._internal.advanceTime(3600000)

        expect(refreshSpy).toHaveBeenCalled()
      })
    })
  })
})
