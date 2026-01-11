import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * RED Phase Tests for Goal API ($.goal)
 *
 * These tests define the expected behavior of the $.goal OKR/target tracking system.
 * They will FAIL until the implementation is created.
 *
 * The goal API provides:
 * - $.goal.define(name, { target, by }) - Define OKRs and targets
 * - $.goal(name).progress() - Check progress toward goal
 * - $.goal(name).alert({ when }) - Set up alerts for goal status
 * - $.goal(name).history() - Track progress over time
 *
 * Goals integrate with:
 * - $.measure for target values based on metrics
 * - $.track for target values based on event counts/ratios
 *
 * @module workflows/data/goal/tests/goal
 */

// Import the goal API (will fail - module doesn't exist yet)
import {
  createGoalContext,
  type GoalContext,
  type Goal,
  type GoalProgress,
  type GoalAlert,
  type GoalHistory,
  type TargetExpression,
} from '../context'

describe('Goal API ($.goal)', () => {
  let $: GoalContext

  beforeEach(() => {
    // Create a fresh goal context for each test
    $ = createGoalContext()
  })

  // ============================================================================
  // GOAL DEFINITION - $.goal.define(name, options)
  // ============================================================================

  describe('$.goal.define(name, options)', () => {
    it('defines a goal with a simple target value', async () => {
      await $.goal.define('Q1-revenue', {
        target: $.measure.revenue.sum().reach(100_000),
        by: '2024-03-31',
        owner: 'founder',
      })

      const goal = await $._storage.goals.get('Q1-revenue')

      expect(goal).toBeDefined()
      expect(goal?.name).toBe('Q1-revenue')
      expect(goal?.target.value).toBe(100_000)
      expect(goal?.by).toBe('2024-03-31')
      expect(goal?.owner).toBe('founder')
    })

    it('defines an evergreen goal without deadline', async () => {
      await $.goal.define('activation-rate', {
        target: $.track.ratio('Activate', 'Signup').reach(0.4),
      })

      const goal = await $._storage.goals.get('activation-rate')

      expect(goal).toBeDefined()
      expect(goal?.name).toBe('activation-rate')
      expect(goal?.by).toBeUndefined()
    })

    it('defines a goal with NPS target', async () => {
      await $.goal.define('pmf', {
        target: $.measure.nps.reach(50),
        by: '2024-06-30',
      })

      const goal = await $._storage.goals.get('pmf')

      expect(goal).toBeDefined()
      expect(goal?.target.value).toBe(50)
    })

    it('prevents duplicate goal names', async () => {
      await $.goal.define('unique-goal', {
        target: $.measure.revenue.sum().reach(50_000),
      })

      await expect(
        $.goal.define('unique-goal', {
          target: $.measure.revenue.sum().reach(100_000),
        })
      ).rejects.toThrow()
    })

    it('validates target value is a valid expression', async () => {
      await expect(
        $.goal.define('invalid-goal', {
          // @ts-expect-error - Testing invalid input
          target: 'not a valid target',
        })
      ).rejects.toThrow()
    })

    it('validates deadline is a valid date', async () => {
      await expect(
        $.goal.define('invalid-date', {
          target: $.measure.revenue.sum().reach(100_000),
          by: 'invalid-date',
        })
      ).rejects.toThrow()
    })

    it('accepts quarter format for deadline', async () => {
      await $.goal.define('quarterly-goal', {
        target: $.measure.mrr.reach(50_000),
        by: '2024-Q2',
      })

      const goal = await $._storage.goals.get('quarterly-goal')

      expect(goal).toBeDefined()
      expect(goal?.by).toBe('2024-Q2')
    })

    it('stores creation timestamp', async () => {
      const before = Date.now()
      await $.goal.define('timestamped', {
        target: $.measure.revenue.sum().reach(10_000),
      })
      const after = Date.now()

      const goal = await $._storage.goals.get('timestamped')

      expect(goal?.createdAt).toBeGreaterThanOrEqual(before)
      expect(goal?.createdAt).toBeLessThanOrEqual(after)
    })

    it('sets default status to active', async () => {
      await $.goal.define('default-status', {
        target: $.measure.revenue.sum().reach(10_000),
      })

      const goal = await $._storage.goals.get('default-status')

      expect(goal?.status).toBe('active')
    })
  })

  // ============================================================================
  // TARGET EXPRESSIONS - $.measure.X.reach(value), $.track.ratio()
  // ============================================================================

  describe('Target Expressions', () => {
    describe('$.measure.X.reach(value)', () => {
      it('creates target from measure sum', () => {
        const target = $.measure.revenue.sum().reach(100_000)

        expect(target).toBeDefined()
        expect(target.type).toBe('measure')
        expect(target.metric).toBe('revenue')
        expect(target.aggregation).toBe('sum')
        expect(target.value).toBe(100_000)
        expect(target.direction).toBe('above') // Default
      })

      it('creates target from measure current value', () => {
        const target = $.measure.mrr.reach(50_000)

        expect(target).toBeDefined()
        expect(target.type).toBe('measure')
        expect(target.metric).toBe('mrr')
        expect(target.aggregation).toBe('current')
        expect(target.value).toBe(50_000)
      })

      it('creates target with direction below', () => {
        const target = $.measure.churn.reach(0.02, { direction: 'below' })

        expect(target).toBeDefined()
        expect(target.value).toBe(0.02)
        expect(target.direction).toBe('below')
      })

      it('creates target from measure average', () => {
        const target = $.measure.latency.avg().reach(100)

        expect(target).toBeDefined()
        expect(target.aggregation).toBe('avg')
        expect(target.value).toBe(100)
      })

      it('creates target from measure percentile', () => {
        const target = $.measure.latency.percentile(99).reach(200)

        expect(target).toBeDefined()
        expect(target.aggregation).toBe('p99')
        expect(target.value).toBe(200)
      })
    })

    describe('$.track.ratio(numerator, denominator)', () => {
      it('creates ratio target from track events', () => {
        const target = $.track.ratio('Activate', 'Signup').reach(0.4)

        expect(target).toBeDefined()
        expect(target.type).toBe('ratio')
        expect(target.numerator).toBe('Activate')
        expect(target.denominator).toBe('Signup')
        expect(target.value).toBe(0.4)
      })

      it('creates ratio with filter', () => {
        const target = $.track.ratio('Purchase', 'PageView:/pricing').reach(0.1)

        expect(target).toBeDefined()
        expect(target.denominator).toBe('PageView:/pricing')
      })
    })

    describe('$.track.X.count().reach()', () => {
      it('creates count target from tracked events', () => {
        const target = $.track.Signup.count().reach(1000)

        expect(target).toBeDefined()
        expect(target.type).toBe('count')
        expect(target.event).toBe('Signup')
        expect(target.value).toBe(1000)
      })

      it('creates count target with time range', () => {
        const target = $.track.Purchase.count().since('month').reach(500)

        expect(target).toBeDefined()
        expect(target.timeRange).toBe('month')
        expect(target.value).toBe(500)
      })
    })
  })

  // ============================================================================
  // COMPOUND GOALS - Multiple targets
  // ============================================================================

  describe('Compound Goals', () => {
    it('defines a goal with multiple targets', async () => {
      await $.goal.define('growth', {
        targets: [
          $.measure.mrr.reach(50_000),
          $.track.Signup.count().reach(1000),
          $.measure.churn.reach(0.02, { direction: 'below' }),
        ],
        by: '2024-Q2',
      })

      const goal = await $._storage.goals.get('growth')

      expect(goal).toBeDefined()
      expect(goal?.targets).toHaveLength(3)
      expect(goal?.targets[0].metric).toBe('mrr')
      expect(goal?.targets[1].event).toBe('Signup')
      expect(goal?.targets[2].direction).toBe('below')
    })

    it('reports compound goal progress as aggregate', async () => {
      // Set up mock data
      await $._storage.measures.set('mrr', { current: 40_000 })
      await $._storage.events.set('Signup', { count: 800 })
      await $._storage.measures.set('churn', { current: 0.03 })

      await $.goal.define('compound-progress', {
        targets: [
          $.measure.mrr.reach(50_000),
          $.track.Signup.count().reach(1000),
          $.measure.churn.reach(0.02, { direction: 'below' }),
        ],
      })

      const progress = await $.goal('compound-progress').progress()

      expect(progress.targets).toHaveLength(3)
      expect(progress.targets[0].percent).toBe(80) // 40k/50k
      expect(progress.targets[1].percent).toBe(80) // 800/1000
      expect(progress.targets[2].percent).toBeLessThan(100) // 0.03 not below 0.02
      expect(progress.overallPercent).toBeDefined()
    })

    it('compound goal is achieved only when all targets met', async () => {
      // All targets met
      await $._storage.measures.set('mrr', { current: 55_000 })
      await $._storage.events.set('Signup', { count: 1200 })
      await $._storage.measures.set('churn', { current: 0.015 })

      await $.goal.define('all-met', {
        targets: [
          $.measure.mrr.reach(50_000),
          $.track.Signup.count().reach(1000),
          $.measure.churn.reach(0.02, { direction: 'below' }),
        ],
      })

      const progress = await $.goal('all-met').progress()

      expect(progress.achieved).toBe(true)
    })

    it('compound goal is not achieved if any target not met', async () => {
      // One target not met
      await $._storage.measures.set('mrr', { current: 55_000 })
      await $._storage.events.set('Signup', { count: 800 }) // Below target
      await $._storage.measures.set('churn', { current: 0.015 })

      await $.goal.define('one-missing', {
        targets: [
          $.measure.mrr.reach(50_000),
          $.track.Signup.count().reach(1000),
          $.measure.churn.reach(0.02, { direction: 'below' }),
        ],
      })

      const progress = await $.goal('one-missing').progress()

      expect(progress.achieved).toBe(false)
    })
  })

  // ============================================================================
  // PROGRESS CALCULATION - $.goal(name).progress()
  // ============================================================================

  describe('$.goal(name).progress()', () => {
    it('returns current progress toward target', async () => {
      await $._storage.measures.set('revenue', { sum: 72_000 })

      await $.goal.define('revenue-progress', {
        target: $.measure.revenue.sum().reach(100_000),
        by: '2024-03-31',
      })

      const progress = await $.goal('revenue-progress').progress()

      expect(progress.current).toBe(72_000)
      expect(progress.target).toBe(100_000)
      expect(progress.percent).toBe(72)
      expect(progress.remaining).toBe(28_000)
    })

    it('calculates days left until deadline', async () => {
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 45)
      const deadline = futureDate.toISOString().split('T')[0]

      await $.goal.define('deadline-goal', {
        target: $.measure.revenue.sum().reach(100_000),
        by: deadline,
      })

      const progress = await $.goal('deadline-goal').progress()

      expect(progress.daysLeft).toBe(45)
    })

    it('returns negative days when past deadline', async () => {
      const pastDate = new Date()
      pastDate.setDate(pastDate.getDate() - 10)
      const deadline = pastDate.toISOString().split('T')[0]

      await $.goal.define('past-deadline', {
        target: $.measure.revenue.sum().reach(100_000),
        by: deadline,
      })

      const progress = await $.goal('past-deadline').progress()

      expect(progress.daysLeft).toBe(-10)
    })

    it('returns null daysLeft for evergreen goals', async () => {
      await $.goal.define('evergreen', {
        target: $.track.ratio('Activate', 'Signup').reach(0.4),
      })

      const progress = await $.goal('evergreen').progress()

      expect(progress.daysLeft).toBeNull()
    })

    it('handles zero current value', async () => {
      await $._storage.measures.set('new-metric', { sum: 0 })

      await $.goal.define('zero-progress', {
        target: $.measure['new-metric'].sum().reach(1000),
      })

      const progress = await $.goal('zero-progress').progress()

      expect(progress.current).toBe(0)
      expect(progress.percent).toBe(0)
      expect(progress.remaining).toBe(1000)
    })

    it('caps percent at 100 when exceeded', async () => {
      await $._storage.measures.set('exceeded', { sum: 150_000 })

      await $.goal.define('exceeded-goal', {
        target: $.measure.exceeded.sum().reach(100_000),
      })

      const progress = await $.goal('exceeded-goal').progress()

      expect(progress.current).toBe(150_000)
      expect(progress.percent).toBe(100)
      expect(progress.remaining).toBe(0)
      expect(progress.achieved).toBe(true)
    })

    it('calculates percent correctly for direction: below', async () => {
      await $._storage.measures.set('churn', { current: 0.04 })

      await $.goal.define('reduce-churn', {
        target: $.measure.churn.reach(0.02, { direction: 'below' }),
      })

      const progress = await $.goal('reduce-churn').progress()

      // Starting from 0.04, need to reach 0.02
      // If we assume starting point is higher, progress shows how far we've come
      expect(progress.current).toBe(0.04)
      expect(progress.target).toBe(0.02)
      expect(progress.achieved).toBe(false)
    })

    it('handles ratio target progress', async () => {
      await $._storage.events.set('Activate', { count: 300 })
      await $._storage.events.set('Signup', { count: 1000 })

      await $.goal.define('ratio-goal', {
        target: $.track.ratio('Activate', 'Signup').reach(0.4),
      })

      const progress = await $.goal('ratio-goal').progress()

      expect(progress.current).toBeCloseTo(0.3, 2)
      expect(progress.target).toBe(0.4)
      expect(progress.percent).toBe(75) // 0.3/0.4 = 75%
    })

    it('throws for nonexistent goal', async () => {
      await expect($.goal('nonexistent').progress()).rejects.toThrow()
    })
  })

  // ============================================================================
  // ON-TRACK PROJECTION
  // ============================================================================

  describe('On-track Projection', () => {
    it('calculates projected value at current rate', async () => {
      // Set up historical data for projection
      await $._storage.measures.set('revenue', {
        sum: 72_000,
        history: [
          { date: '2024-01-01', value: 10_000 },
          { date: '2024-01-15', value: 25_000 },
          { date: '2024-02-01', value: 45_000 },
          { date: '2024-02-15', value: 72_000 },
        ],
      })

      await $.goal.define('projected-goal', {
        target: $.measure.revenue.sum().reach(100_000),
        by: '2024-03-31',
      })

      const progress = await $.goal('projected-goal').progress()

      expect(progress.projectedValue).toBeDefined()
      expect(progress.projectedValue).toBeGreaterThan(72_000)
    })

    it('determines onTrack status based on projection', async () => {
      await $._storage.measures.set('on-track-metric', {
        sum: 72_000,
        trend: { slope: 2000, direction: 'up' }, // +2k per day
      })

      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 20)
      const deadline = futureDate.toISOString().split('T')[0]

      await $.goal.define('on-track-goal', {
        target: $.measure['on-track-metric'].sum().reach(100_000),
        by: deadline,
      })

      const progress = await $.goal('on-track-goal').progress()

      // 72k + (20 days * 2k/day) = 112k > 100k target
      expect(progress.onTrack).toBe(true)
    })

    it('marks goal as off-track when projection falls short', async () => {
      await $._storage.measures.set('off-track-metric', {
        sum: 30_000,
        trend: { slope: 500, direction: 'up' }, // +500 per day
      })

      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 30)
      const deadline = futureDate.toISOString().split('T')[0]

      await $.goal.define('off-track-goal', {
        target: $.measure['off-track-metric'].sum().reach(100_000),
        by: deadline,
      })

      const progress = await $.goal('off-track-goal').progress()

      // 30k + (30 days * 500/day) = 45k < 100k target
      expect(progress.onTrack).toBe(false)
    })

    it('returns null projection for evergreen goals', async () => {
      await $.goal.define('evergreen-projection', {
        target: $.measure.nps.reach(50),
      })

      const progress = await $.goal('evergreen-projection').progress()

      expect(progress.projectedValue).toBeNull()
      expect(progress.onTrack).toBeNull()
    })

    it('handles negative trend (direction: below targets)', async () => {
      await $._storage.measures.set('decreasing', {
        current: 0.05,
        trend: { slope: -0.002, direction: 'down' }, // -0.002 per day
      })

      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 15)
      const deadline = futureDate.toISOString().split('T')[0]

      await $.goal.define('decrease-goal', {
        target: $.measure.decreasing.reach(0.02, { direction: 'below' }),
        by: deadline,
      })

      const progress = await $.goal('decrease-goal').progress()

      // 0.05 - (15 * 0.002) = 0.02 = target
      expect(progress.onTrack).toBe(true)
    })
  })

  // ============================================================================
  // ALERTS - $.goal(name).alert({ when })
  // ============================================================================

  describe('$.goal(name).alert({ when })', () => {
    it('sets up off-track alert', async () => {
      const mockNotify = vi.fn()

      await $.goal.define('alert-goal', {
        target: $.measure.revenue.sum().reach(100_000),
        by: '2024-03-31',
      })

      await $.goal('alert-goal').alert({
        when: 'off-track',
        notify: mockNotify,
      })

      const alerts = await $._storage.alerts.get('alert-goal')

      expect(alerts).toBeDefined()
      expect(alerts).toHaveLength(1)
      expect(alerts[0].when).toBe('off-track')
    })

    it('sets up achieved alert', async () => {
      const mockNotify = vi.fn()

      await $.goal.define('achieved-alert', {
        target: $.measure.revenue.sum().reach(100_000),
      })

      await $.goal('achieved-alert').alert({
        when: 'achieved',
        notify: mockNotify,
      })

      const alerts = await $._storage.alerts.get('achieved-alert')

      expect(alerts[0].when).toBe('achieved')
    })

    it('sets up at-risk alert', async () => {
      const mockNotify = vi.fn()

      await $.goal.define('at-risk-alert', {
        target: $.measure.revenue.sum().reach(100_000),
        by: '2024-03-31',
      })

      await $.goal('at-risk-alert').alert({
        when: 'at-risk',
        notify: mockNotify,
      })

      const alerts = await $._storage.alerts.get('at-risk-alert')

      expect(alerts[0].when).toBe('at-risk')
    })

    it('triggers off-track alert when status changes', async () => {
      const mockNotify = vi.fn()

      await $._storage.measures.set('alerting-metric', {
        sum: 30_000,
        trend: { slope: 100, direction: 'up' },
      })

      await $.goal.define('trigger-test', {
        target: $.measure['alerting-metric'].sum().reach(100_000),
        by: '2024-03-31',
      })

      await $.goal('trigger-test').alert({
        when: 'off-track',
        notify: mockNotify,
      })

      // Trigger evaluation
      await $.goal('trigger-test').evaluate()

      expect(mockNotify).toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'trigger-test',
          status: 'off-track',
        })
      )
    })

    it('triggers achieved alert when goal is met', async () => {
      const mockNotify = vi.fn()

      await $._storage.measures.set('success-metric', { sum: 110_000 })

      await $.goal.define('success-alert', {
        target: $.measure['success-metric'].sum().reach(100_000),
      })

      await $.goal('success-alert').alert({
        when: 'achieved',
        notify: mockNotify,
      })

      await $.goal('success-alert').evaluate()

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'success-alert',
          status: 'achieved',
        })
      )
    })

    it('supports multiple alerts on same goal', async () => {
      const offTrackNotify = vi.fn()
      const achievedNotify = vi.fn()

      await $.goal.define('multi-alert', {
        target: $.measure.revenue.sum().reach(100_000),
        by: '2024-03-31',
      })

      await $.goal('multi-alert').alert({
        when: 'off-track',
        notify: offTrackNotify,
      })

      await $.goal('multi-alert').alert({
        when: 'achieved',
        notify: achievedNotify,
      })

      const alerts = await $._storage.alerts.get('multi-alert')

      expect(alerts).toHaveLength(2)
    })

    it('does not trigger alert if status unchanged', async () => {
      const mockNotify = vi.fn()

      await $._storage.measures.set('stable-metric', { sum: 50_000 })

      await $.goal.define('stable-goal', {
        target: $.measure['stable-metric'].sum().reach(100_000),
        by: '2024-03-31',
      })

      await $.goal('stable-goal').alert({
        when: 'off-track',
        notify: mockNotify,
      })

      // Evaluate twice with same status
      await $.goal('stable-goal').evaluate()
      await $.goal('stable-goal').evaluate()

      // Should only trigger once (on initial status determination)
      expect(mockNotify).toHaveBeenCalledTimes(1)
    })

    it('includes goal context in alert payload', async () => {
      const mockNotify = vi.fn()

      await $._storage.measures.set('context-metric', { sum: 40_000 })

      await $.goal.define('context-goal', {
        target: $.measure['context-metric'].sum().reach(100_000),
        by: '2024-03-31',
        owner: 'founder',
      })

      await $.goal('context-goal').alert({
        when: 'off-track',
        notify: mockNotify,
      })

      await $.goal('context-goal').evaluate()

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'context-goal',
          current: 40_000,
          target: 100_000,
          percent: 40,
          owner: 'founder',
        })
      )
    })

    it('removes alert subscription', async () => {
      const mockNotify = vi.fn()

      await $.goal.define('removable-alert', {
        target: $.measure.revenue.sum().reach(100_000),
      })

      const subscription = await $.goal('removable-alert').alert({
        when: 'achieved',
        notify: mockNotify,
      })

      await subscription.unsubscribe()

      const alerts = await $._storage.alerts.get('removable-alert')

      expect(alerts).toHaveLength(0)
    })
  })

  // ============================================================================
  // HISTORY TRACKING - $.goal(name).history()
  // ============================================================================

  describe('$.goal(name).history()', () => {
    it('returns progress history over time', async () => {
      await $.goal.define('history-goal', {
        target: $.measure.revenue.sum().reach(100_000),
      })

      // Simulate history
      await $._storage.goalHistory.set('history-goal', [
        { date: '2024-01-01', value: 10_000, percent: 10 },
        { date: '2024-01-08', value: 25_000, percent: 25 },
        { date: '2024-01-15', value: 42_000, percent: 42 },
        { date: '2024-01-22', value: 58_000, percent: 58 },
      ])

      const history = await $.goal('history-goal').history()

      expect(history).toHaveLength(4)
      expect(history[0].date).toBe('2024-01-01')
      expect(history[0].value).toBe(10_000)
      expect(history[3].percent).toBe(58)
    })

    it('returns empty array for new goal', async () => {
      await $.goal.define('new-goal', {
        target: $.measure.revenue.sum().reach(100_000),
      })

      const history = await $.goal('new-goal').history()

      expect(history).toEqual([])
    })

    it('supports time range filtering', async () => {
      await $.goal.define('filtered-history', {
        target: $.measure.revenue.sum().reach(100_000),
      })

      await $._storage.goalHistory.set('filtered-history', [
        { date: '2024-01-01', value: 10_000 },
        { date: '2024-01-15', value: 25_000 },
        { date: '2024-02-01', value: 42_000 },
        { date: '2024-02-15', value: 58_000 },
      ])

      const history = await $.goal('filtered-history').history({
        since: '2024-02-01',
      })

      expect(history).toHaveLength(2)
      expect(history[0].date).toBe('2024-02-01')
    })

    it('includes status in history entries', async () => {
      await $.goal.define('status-history', {
        target: $.measure.revenue.sum().reach(100_000),
        by: '2024-03-31',
      })

      await $._storage.goalHistory.set('status-history', [
        { date: '2024-01-01', value: 10_000, status: 'on-track' },
        { date: '2024-01-15', value: 15_000, status: 'on-track' },
        { date: '2024-02-01', value: 18_000, status: 'at-risk' },
        { date: '2024-02-15', value: 20_000, status: 'off-track' },
      ])

      const history = await $.goal('status-history').history()

      expect(history[0].status).toBe('on-track')
      expect(history[3].status).toBe('off-track')
    })

    it('records snapshot when progress changes', async () => {
      await $._storage.measures.set('snapshot-metric', { sum: 50_000 })

      await $.goal.define('snapshot-goal', {
        target: $.measure['snapshot-metric'].sum().reach(100_000),
      })

      // Record current state
      await $.goal('snapshot-goal').snapshot()

      const history = await $.goal('snapshot-goal').history()

      expect(history).toHaveLength(1)
      expect(history[0].value).toBe(50_000)
      expect(history[0].date).toBeDefined()
    })

    it('limits history entries', async () => {
      await $.goal.define('limited-history', {
        target: $.measure.revenue.sum().reach(100_000),
      })

      const manyEntries = Array.from({ length: 100 }, (_, i) => ({
        date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        value: i * 1000,
      }))

      await $._storage.goalHistory.set('limited-history', manyEntries)

      const history = await $.goal('limited-history').history({ limit: 10 })

      expect(history).toHaveLength(10)
    })

    it('throws for nonexistent goal', async () => {
      await expect($.goal('nonexistent').history()).rejects.toThrow()
    })
  })

  // ============================================================================
  // GOAL LISTING AND MANAGEMENT
  // ============================================================================

  describe('Goal Listing', () => {
    it('lists all goals', async () => {
      await $.goal.define('goal-1', { target: $.measure.revenue.sum().reach(100_000) })
      await $.goal.define('goal-2', { target: $.measure.mrr.reach(50_000) })
      await $.goal.define('goal-3', { target: $.track.ratio('Activate', 'Signup').reach(0.4) })

      const goals = await $.goal.list()

      expect(goals).toHaveLength(3)
      expect(goals.map((g: Goal) => g.name)).toContain('goal-1')
      expect(goals.map((g: Goal) => g.name)).toContain('goal-2')
      expect(goals.map((g: Goal) => g.name)).toContain('goal-3')
    })

    it('filters goals by status', async () => {
      await $.goal.define('active-goal', { target: $.measure.revenue.sum().reach(100_000) })
      await $.goal.define('achieved-goal', { target: $.measure.mrr.reach(50_000) })

      await $._storage.goals.update('achieved-goal', { status: 'achieved' })

      const activeGoals = await $.goal.list({ status: 'active' })

      expect(activeGoals).toHaveLength(1)
      expect(activeGoals[0].name).toBe('active-goal')
    })

    it('filters goals by owner', async () => {
      await $.goal.define('founder-goal', {
        target: $.measure.revenue.sum().reach(100_000),
        owner: 'founder',
      })
      await $.goal.define('team-goal', {
        target: $.measure.mrr.reach(50_000),
        owner: 'team',
      })

      const founderGoals = await $.goal.list({ owner: 'founder' })

      expect(founderGoals).toHaveLength(1)
      expect(founderGoals[0].name).toBe('founder-goal')
    })

    it('gets progress for all goals', async () => {
      await $._storage.measures.set('metric-1', { sum: 70_000 })
      await $._storage.measures.set('metric-2', { current: 40_000 })

      await $.goal.define('multi-1', { target: $.measure['metric-1'].sum().reach(100_000) })
      await $.goal.define('multi-2', { target: $.measure['metric-2'].reach(50_000) })

      const allProgress = await $.goal.all().progress()

      expect(allProgress).toHaveLength(2)
      expect(allProgress[0].name).toBe('multi-1')
      expect(allProgress[0].percent).toBe(70)
      expect(allProgress[1].name).toBe('multi-2')
      expect(allProgress[1].percent).toBe(80)
    })

    it('gets a specific goal by name', async () => {
      await $.goal.define('specific-goal', {
        target: $.measure.revenue.sum().reach(100_000),
        by: '2024-Q2',
        owner: 'founder',
      })

      const goal = await $.goal('specific-goal').get()

      expect(goal).toBeDefined()
      expect(goal?.name).toBe('specific-goal')
      expect(goal?.target.value).toBe(100_000)
      expect(goal?.by).toBe('2024-Q2')
      expect(goal?.owner).toBe('founder')
    })

    it('returns undefined for nonexistent goal get', async () => {
      const goal = await $.goal('nonexistent').get()

      expect(goal).toBeUndefined()
    })
  })

  // ============================================================================
  // GOAL LIFECYCLE
  // ============================================================================

  describe('Goal Lifecycle', () => {
    it('can archive a goal', async () => {
      await $.goal.define('archivable', {
        target: $.measure.revenue.sum().reach(100_000),
      })

      await $.goal('archivable').archive()

      const goal = await $._storage.goals.get('archivable')

      expect(goal?.status).toBe('archived')
    })

    it('can delete a goal', async () => {
      await $.goal.define('deletable', {
        target: $.measure.revenue.sum().reach(100_000),
      })

      await $.goal('deletable').delete()

      const goal = await $._storage.goals.get('deletable')

      expect(goal).toBeUndefined()
    })

    it('marks goal as achieved when target met', async () => {
      await $._storage.measures.set('achieved-metric', { sum: 110_000 })

      await $.goal.define('auto-achieve', {
        target: $.measure['achieved-metric'].sum().reach(100_000),
      })

      await $.goal('auto-achieve').evaluate()

      const goal = await $._storage.goals.get('auto-achieve')

      expect(goal?.status).toBe('achieved')
    })

    it('can update goal target', async () => {
      await $.goal.define('updatable', {
        target: $.measure.revenue.sum().reach(100_000),
      })

      await $.goal('updatable').update({
        target: $.measure.revenue.sum().reach(150_000),
      })

      const goal = await $._storage.goals.get('updatable')

      expect(goal?.target.value).toBe(150_000)
    })

    it('can update goal deadline', async () => {
      await $.goal.define('deadline-update', {
        target: $.measure.revenue.sum().reach(100_000),
        by: '2024-Q2',
      })

      await $.goal('deadline-update').update({
        by: '2024-Q3',
      })

      const goal = await $._storage.goals.get('deadline-update')

      expect(goal?.by).toBe('2024-Q3')
    })

    it('can reactivate an archived goal', async () => {
      await $.goal.define('reactivatable', {
        target: $.measure.revenue.sum().reach(100_000),
      })

      await $.goal('reactivatable').archive()
      await $.goal('reactivatable').reactivate()

      const goal = await $._storage.goals.get('reactivatable')

      expect(goal?.status).toBe('active')
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('Edge Cases', () => {
    it('handles empty goal name gracefully', async () => {
      await expect(
        $.goal.define('', {
          target: $.measure.revenue.sum().reach(100_000),
        })
      ).rejects.toThrow()
    })

    it('handles special characters in goal name', async () => {
      await $.goal.define('Q1-2024/revenue_goal', {
        target: $.measure.revenue.sum().reach(100_000),
      })

      const goal = await $._storage.goals.get('Q1-2024/revenue_goal')

      expect(goal).toBeDefined()
    })

    it('handles zero target value', async () => {
      // For direction: below, zero might be valid
      await $.goal.define('zero-target', {
        target: $.measure.errors.reach(0, { direction: 'below' }),
      })

      const goal = await $._storage.goals.get('zero-target')

      expect(goal?.target.value).toBe(0)
    })

    it('handles negative target value', async () => {
      // Might be valid for profit/loss metrics
      await $.goal.define('negative-target', {
        target: $.measure['profit-loss'].reach(-1000, { direction: 'below' }),
      })

      const goal = await $._storage.goals.get('negative-target')

      expect(goal?.target.value).toBe(-1000)
    })

    it('handles division by zero in ratio', async () => {
      await $._storage.events.set('Activate', { count: 100 })
      await $._storage.events.set('Signup', { count: 0 })

      await $.goal.define('zero-denominator', {
        target: $.track.ratio('Activate', 'Signup').reach(0.5),
      })

      const progress = await $.goal('zero-denominator').progress()

      // Should handle gracefully - either null, Infinity, or 0
      expect(progress.current).toBeNull()
    })

    it('handles very large numbers', async () => {
      await $._storage.measures.set('large', { sum: 999_999_999_999 })

      await $.goal.define('large-goal', {
        target: $.measure.large.sum().reach(1_000_000_000_000),
      })

      const progress = await $.goal('large-goal').progress()

      expect(progress.percent).toBeCloseTo(99.9999, 2)
    })

    it('handles floating point precision in ratios', async () => {
      await $._storage.events.set('Num', { count: 1 })
      await $._storage.events.set('Denom', { count: 3 })

      await $.goal.define('precision-goal', {
        target: $.track.ratio('Num', 'Denom').reach(0.33333333),
      })

      const progress = await $.goal('precision-goal').progress()

      // 1/3 should approximately equal target
      expect(progress.percent).toBeGreaterThan(99)
    })
  })
})
