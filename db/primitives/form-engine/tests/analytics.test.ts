/**
 * Form Analytics Tests
 *
 * Tests for completion rate, drop-off analysis, time tracking,
 * and submission funnel visualization
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  FormAnalytics,
  createAnalytics,
  AnalyticsCollector,
  AnalyticsReport,
} from '../analytics'
import { createFormSchema } from '../schema'
import type { FormSchema, SubmissionEvent, FieldInteraction } from '../types'

describe('FormAnalytics', () => {
  let schema: FormSchema
  let analytics: FormAnalytics

  beforeEach(() => {
    vi.useFakeTimers()

    schema = createFormSchema({
      id: 'analytics-form',
      title: 'Analytics Form',
      steps: [
        {
          id: 'step1',
          title: 'Step 1',
          fields: [
            { id: 'name', type: 'text', label: 'Name' },
            { id: 'email', type: 'email', label: 'Email' },
          ],
        },
        {
          id: 'step2',
          title: 'Step 2',
          fields: [
            { id: 'phone', type: 'phone', label: 'Phone' },
            { id: 'address', type: 'text', label: 'Address' },
          ],
        },
      ],
    })

    analytics = createAnalytics(schema.id)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('View Tracking', () => {
    it('should track form views', () => {
      analytics.trackView()
      analytics.trackView()
      analytics.trackView()

      const stats = analytics.getStats()
      expect(stats.views).toBe(3)
    })

    it('should track unique views', () => {
      analytics.trackView({ sessionId: 'session-1' })
      analytics.trackView({ sessionId: 'session-1' }) // Same session
      analytics.trackView({ sessionId: 'session-2' })

      const stats = analytics.getStats()
      expect(stats.views).toBe(3)
      expect(stats.uniqueViews).toBe(2)
    })

    it('should record view timestamp', () => {
      const now = new Date('2024-01-15T10:00:00Z')
      vi.setSystemTime(now)

      analytics.trackView()

      const events = analytics.getEvents()
      expect(events[0].type).toBe('view')
      expect(events[0].timestamp).toEqual(now)
    })

    it('should track view metadata', () => {
      analytics.trackView({
        referrer: 'https://google.com',
        device: 'mobile',
        browser: 'chrome',
      })

      const events = analytics.getEvents()
      expect(events[0].metadata?.referrer).toBe('https://google.com')
      expect(events[0].metadata?.device).toBe('mobile')
    })
  })

  describe('Start Tracking', () => {
    it('should track form starts', () => {
      analytics.trackView()
      analytics.trackStart({ submissionId: 'sub-1' })

      const stats = analytics.getStats()
      expect(stats.starts).toBe(1)
    })

    it('should calculate start rate', () => {
      analytics.trackView()
      analytics.trackView()
      analytics.trackView()
      analytics.trackView()
      analytics.trackStart({ submissionId: 'sub-1' })
      analytics.trackStart({ submissionId: 'sub-2' })

      const stats = analytics.getStats()
      expect(stats.startRate).toBe(50) // 2/4 = 50%
    })
  })

  describe('Field Interactions', () => {
    it('should track field focus', () => {
      analytics.trackFieldInteraction({
        field: 'name',
        type: 'focus',
      })

      const interactions = analytics.getFieldInteractions('name')
      expect(interactions).toHaveLength(1)
      expect(interactions[0].type).toBe('focus')
    })

    it('should track field blur', () => {
      analytics.trackFieldInteraction({
        field: 'email',
        type: 'blur',
      })

      const interactions = analytics.getFieldInteractions('email')
      expect(interactions[0].type).toBe('blur')
    })

    it('should track field changes', () => {
      analytics.trackFieldInteraction({
        field: 'phone',
        type: 'change',
        value: '555-1234',
      })

      const interactions = analytics.getFieldInteractions('phone')
      expect(interactions[0].type).toBe('change')
    })

    it('should track field errors', () => {
      analytics.trackFieldInteraction({
        field: 'email',
        type: 'error',
      })

      const stats = analytics.getFieldStats('email')
      expect(stats.errorCount).toBe(1)
    })

    it('should calculate time spent on field', () => {
      const startTime = new Date('2024-01-15T10:00:00Z')
      vi.setSystemTime(startTime)

      analytics.trackFieldInteraction({ field: 'name', type: 'focus' })

      vi.advanceTimersByTime(5000) // 5 seconds

      analytics.trackFieldInteraction({ field: 'name', type: 'blur' })

      const stats = analytics.getFieldStats('name')
      expect(stats.avgTimeMs).toBe(5000)
    })

    it('should calculate average time across multiple interactions', () => {
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))
      analytics.trackFieldInteraction({ field: 'name', type: 'focus' })
      vi.advanceTimersByTime(3000)
      analytics.trackFieldInteraction({ field: 'name', type: 'blur' })

      vi.setSystemTime(new Date('2024-01-15T10:01:00Z'))
      analytics.trackFieldInteraction({ field: 'name', type: 'focus' })
      vi.advanceTimersByTime(7000)
      analytics.trackFieldInteraction({ field: 'name', type: 'blur' })

      const stats = analytics.getFieldStats('name')
      expect(stats.avgTimeMs).toBe(5000) // (3000 + 7000) / 2
    })
  })

  describe('Step Completion Tracking', () => {
    it('should track step completion', () => {
      analytics.trackStepComplete({
        submissionId: 'sub-1',
        stepId: 'step1',
      })

      const stats = analytics.getStepStats('step1')
      expect(stats.completions).toBe(1)
    })

    it('should track time per step', () => {
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))
      analytics.trackStart({ submissionId: 'sub-1' })

      vi.advanceTimersByTime(60000) // 1 minute

      analytics.trackStepComplete({ submissionId: 'sub-1', stepId: 'step1' })

      const stats = analytics.getStepStats('step1')
      expect(stats.avgTimeMs).toBe(60000)
    })
  })

  describe('Drop-off Analysis', () => {
    it('should track abandonment', () => {
      analytics.trackStart({ submissionId: 'sub-1' })
      analytics.trackStart({ submissionId: 'sub-2' })
      analytics.trackStart({ submissionId: 'sub-3' })

      analytics.trackSubmit({ submissionId: 'sub-1' })
      analytics.trackAbandon({ submissionId: 'sub-2', stepId: 'step1' })
      analytics.trackAbandon({ submissionId: 'sub-3', stepId: 'step2' })

      const stats = analytics.getStats()
      expect(stats.abandonments).toBe(2)
    })

    it('should calculate drop-off by step', () => {
      // 10 people start
      for (let i = 0; i < 10; i++) {
        analytics.trackStart({ submissionId: `sub-${i}` })
      }

      // 8 complete step 1
      for (let i = 0; i < 8; i++) {
        analytics.trackStepComplete({ submissionId: `sub-${i}`, stepId: 'step1' })
      }

      // 2 dropped off at step 1
      analytics.trackAbandon({ submissionId: 'sub-8', stepId: 'step1' })
      analytics.trackAbandon({ submissionId: 'sub-9', stepId: 'step1' })

      // 5 complete step 2
      for (let i = 0; i < 5; i++) {
        analytics.trackStepComplete({ submissionId: `sub-${i}`, stepId: 'step2' })
      }

      const dropOff = analytics.getDropOffByStep()
      expect(dropOff.step1).toBe(2) // 2 dropped off
      expect(dropOff.step2).toBe(3) // 3 more dropped off
    })

    it('should calculate drop-off by field', () => {
      for (let i = 0; i < 10; i++) {
        analytics.trackFieldInteraction({ field: 'name', type: 'focus' })
      }

      // 8 people filled it out
      for (let i = 0; i < 8; i++) {
        analytics.trackFieldInteraction({ field: 'name', type: 'change' })
      }

      // 2 abandoned on this field
      analytics.trackAbandon({ submissionId: 'sub-1', fieldId: 'name' })
      analytics.trackAbandon({ submissionId: 'sub-2', fieldId: 'name' })

      const dropOff = analytics.getDropOffByField()
      expect(dropOff.name).toBe(2)
    })

    it('should identify problematic fields', () => {
      // Field with high error rate
      for (let i = 0; i < 10; i++) {
        analytics.trackFieldInteraction({ field: 'email', type: 'error' })
      }
      for (let i = 0; i < 5; i++) {
        analytics.trackFieldInteraction({ field: 'email', type: 'change' })
      }

      // Field with high abandonment
      for (let i = 0; i < 8; i++) {
        analytics.trackAbandon({ submissionId: `sub-${i}`, fieldId: 'phone' })
      }

      const problematic = analytics.getProblematicFields()

      expect(problematic.find((f) => f.field === 'email')?.issue).toBe('high_error_rate')
      expect(problematic.find((f) => f.field === 'phone')?.issue).toBe('high_abandonment')
    })
  })

  describe('Completion Tracking', () => {
    it('should track submissions', () => {
      analytics.trackStart({ submissionId: 'sub-1' })
      analytics.trackSubmit({ submissionId: 'sub-1' })

      const stats = analytics.getStats()
      expect(stats.submissions).toBe(1)
    })

    it('should track completions', () => {
      analytics.trackStart({ submissionId: 'sub-1' })
      analytics.trackSubmit({ submissionId: 'sub-1' })
      analytics.trackComplete({ submissionId: 'sub-1' })

      const stats = analytics.getStats()
      expect(stats.completions).toBe(1)
    })

    it('should calculate completion rate', () => {
      for (let i = 0; i < 10; i++) {
        analytics.trackStart({ submissionId: `sub-${i}` })
      }

      for (let i = 0; i < 7; i++) {
        analytics.trackComplete({ submissionId: `sub-${i}` })
      }

      const stats = analytics.getStats()
      expect(stats.completionRate).toBe(70) // 7/10 = 70%
    })

    it('should calculate average completion time', () => {
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))
      analytics.trackStart({ submissionId: 'sub-1' })
      vi.advanceTimersByTime(120000) // 2 minutes
      analytics.trackComplete({ submissionId: 'sub-1' })

      vi.setSystemTime(new Date('2024-01-15T11:00:00Z'))
      analytics.trackStart({ submissionId: 'sub-2' })
      vi.advanceTimersByTime(180000) // 3 minutes
      analytics.trackComplete({ submissionId: 'sub-2' })

      const stats = analytics.getStats()
      expect(stats.avgCompletionTimeMs).toBe(150000) // (120000 + 180000) / 2
    })
  })

  describe('Funnel Analysis', () => {
    it('should generate submission funnel', () => {
      for (let i = 0; i < 100; i++) analytics.trackView()
      for (let i = 0; i < 80; i++) analytics.trackStart({ submissionId: `sub-${i}` })
      for (let i = 0; i < 60; i++) analytics.trackStepComplete({ submissionId: `sub-${i}`, stepId: 'step1' })
      for (let i = 0; i < 40; i++) analytics.trackStepComplete({ submissionId: `sub-${i}`, stepId: 'step2' })
      for (let i = 0; i < 35; i++) analytics.trackSubmit({ submissionId: `sub-${i}` })
      for (let i = 0; i < 30; i++) analytics.trackComplete({ submissionId: `sub-${i}` })

      const funnel = analytics.getFunnel()

      expect(funnel).toEqual([
        { step: 'view', count: 100, dropOff: 20, conversionRate: 100 },
        { step: 'start', count: 80, dropOff: 20, conversionRate: 80 },
        { step: 'step1', count: 60, dropOff: 20, conversionRate: 60 },
        { step: 'step2', count: 40, dropOff: 5, conversionRate: 40 },
        { step: 'submit', count: 35, dropOff: 5, conversionRate: 35 },
        { step: 'complete', count: 30, dropOff: 0, conversionRate: 30 },
      ])
    })

    it('should calculate funnel conversion rates', () => {
      for (let i = 0; i < 100; i++) analytics.trackView()
      for (let i = 0; i < 50; i++) analytics.trackStart({ submissionId: `sub-${i}` })
      for (let i = 0; i < 25; i++) analytics.trackComplete({ submissionId: `sub-${i}` })

      const funnel = analytics.getFunnel()

      // start/view = 50%
      expect(funnel.find((f) => f.step === 'start')?.conversionRate).toBe(50)
      // complete/view = 25%
      expect(funnel.find((f) => f.step === 'complete')?.conversionRate).toBe(25)
    })
  })

  describe('Time Analysis', () => {
    it('should track average time per field', () => {
      // User 1: 3 seconds on name
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))
      analytics.trackFieldInteraction({ field: 'name', type: 'focus' })
      vi.advanceTimersByTime(3000)
      analytics.trackFieldInteraction({ field: 'name', type: 'blur' })

      // User 2: 5 seconds on name
      vi.setSystemTime(new Date('2024-01-15T10:01:00Z'))
      analytics.trackFieldInteraction({ field: 'name', type: 'focus' })
      vi.advanceTimersByTime(5000)
      analytics.trackFieldInteraction({ field: 'name', type: 'blur' })

      const timePerField = analytics.getTimePerField()
      expect(timePerField.name).toBe(4000) // (3000 + 5000) / 2
    })

    it('should identify slow fields', () => {
      // Email field takes long time
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))
      analytics.trackFieldInteraction({ field: 'email', type: 'focus' })
      vi.advanceTimersByTime(30000) // 30 seconds
      analytics.trackFieldInteraction({ field: 'email', type: 'blur' })

      // Name field is quick
      vi.setSystemTime(new Date('2024-01-15T10:01:00Z'))
      analytics.trackFieldInteraction({ field: 'name', type: 'focus' })
      vi.advanceTimersByTime(2000)
      analytics.trackFieldInteraction({ field: 'name', type: 'blur' })

      const slowFields = analytics.getSlowFields(10000) // Threshold: 10s
      expect(slowFields).toContain('email')
      expect(slowFields).not.toContain('name')
    })
  })

  describe('Error Rate Analysis', () => {
    it('should calculate error rate by field', () => {
      // 10 interactions, 3 errors
      for (let i = 0; i < 10; i++) {
        analytics.trackFieldInteraction({ field: 'email', type: 'change' })
      }
      for (let i = 0; i < 3; i++) {
        analytics.trackFieldInteraction({ field: 'email', type: 'error' })
      }

      const errorRates = analytics.getErrorRateByField()
      expect(errorRates.email).toBe(30) // 3/10 = 30%
    })

    it('should identify high error rate fields', () => {
      // Email: 50% error rate
      for (let i = 0; i < 10; i++) {
        analytics.trackFieldInteraction({ field: 'email', type: 'change' })
      }
      for (let i = 0; i < 5; i++) {
        analytics.trackFieldInteraction({ field: 'email', type: 'error' })
      }

      // Name: 10% error rate
      for (let i = 0; i < 10; i++) {
        analytics.trackFieldInteraction({ field: 'name', type: 'change' })
      }
      for (let i = 0; i < 1; i++) {
        analytics.trackFieldInteraction({ field: 'name', type: 'error' })
      }

      const highErrorFields = analytics.getHighErrorRateFields(20) // Threshold: 20%
      expect(highErrorFields).toContain('email')
      expect(highErrorFields).not.toContain('name')
    })
  })

  describe('Report Generation', () => {
    it('should generate comprehensive report', () => {
      // Seed data
      for (let i = 0; i < 100; i++) analytics.trackView()
      for (let i = 0; i < 50; i++) analytics.trackStart({ submissionId: `sub-${i}` })
      for (let i = 0; i < 30; i++) analytics.trackComplete({ submissionId: `sub-${i}` })

      const report = analytics.generateReport()

      expect(report).toMatchObject({
        formId: 'analytics-form',
        summary: {
          views: 100,
          starts: 50,
          completions: 30,
          completionRate: 60,
        },
        funnel: expect.any(Array),
        fieldStats: expect.any(Object),
        stepStats: expect.any(Object),
      })
    })

    it('should generate report for date range', () => {
      vi.setSystemTime(new Date('2024-01-10T10:00:00Z'))
      analytics.trackView()
      analytics.trackStart({ submissionId: 'old' })

      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))
      analytics.trackView()
      analytics.trackStart({ submissionId: 'new' })

      const report = analytics.generateReport({
        startDate: new Date('2024-01-14T00:00:00Z'),
        endDate: new Date('2024-01-16T00:00:00Z'),
      })

      expect(report.summary.views).toBe(1)
      expect(report.summary.starts).toBe(1)
    })

    it('should export to CSV', () => {
      analytics.trackView()
      analytics.trackStart({ submissionId: 'sub-1' })
      analytics.trackComplete({ submissionId: 'sub-1' })

      const csv = analytics.exportCSV()

      expect(csv).toContain('type,timestamp,submissionId')
      expect(csv).toContain('view')
      expect(csv).toContain('start')
      expect(csv).toContain('complete')
    })

    it('should export to JSON', () => {
      analytics.trackView()
      analytics.trackStart({ submissionId: 'sub-1' })

      const json = analytics.exportJSON()
      const parsed = JSON.parse(json)

      expect(parsed.events).toHaveLength(2)
      expect(parsed.stats).toBeDefined()
    })
  })

  describe('Real-time Updates', () => {
    it('should emit events for real-time updates', () => {
      const onEvent = vi.fn()
      analytics.on('event', onEvent)

      analytics.trackView()

      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'view' })
      )
    })

    it('should emit stats updates', () => {
      const onStatsUpdate = vi.fn()
      analytics.on('statsUpdate', onStatsUpdate)

      analytics.trackView()
      analytics.trackStart({ submissionId: 'sub-1' })

      expect(onStatsUpdate).toHaveBeenCalled()
    })
  })

  describe('Collector Integration', () => {
    it('should create collector for automatic tracking', () => {
      const collector = new AnalyticsCollector(analytics)

      collector.trackFormView()
      collector.trackFormStart('sub-1')
      collector.trackFieldFocus('email')
      collector.trackFieldBlur('email')
      collector.trackFieldChange('email', 'test@example.com')
      collector.trackFormSubmit('sub-1')

      const events = analytics.getEvents()
      expect(events.length).toBe(6)
    })

    it('should batch events', async () => {
      const batchCollector = new AnalyticsCollector(analytics, { batchSize: 5 })

      batchCollector.trackFormView()
      batchCollector.trackFormView()
      batchCollector.trackFormView()

      // Events not flushed yet
      expect(analytics.getEvents()).toHaveLength(0)

      batchCollector.trackFormView()
      batchCollector.trackFormView()

      // Batch full, should flush
      expect(analytics.getEvents()).toHaveLength(5)
    })

    it('should flush on interval', async () => {
      const intervalCollector = new AnalyticsCollector(analytics, {
        flushInterval: 1000,
        batchSize: 100,
      })

      intervalCollector.trackFormView()
      intervalCollector.trackFormView()

      expect(analytics.getEvents()).toHaveLength(0)

      vi.advanceTimersByTime(1000)

      expect(analytics.getEvents()).toHaveLength(2)
    })
  })

  describe('Privacy', () => {
    it('should anonymize data when configured', () => {
      const anonAnalytics = createAnalytics(schema.id, { anonymize: true })

      anonAnalytics.trackFieldInteraction({
        field: 'email',
        type: 'change',
        value: 'test@example.com',
      })

      const interactions = anonAnalytics.getFieldInteractions('email')
      expect(interactions[0].value).toBeUndefined()
    })

    it('should not store PII fields', () => {
      const piiAnalytics = createAnalytics(schema.id, {
        piiFields: ['email', 'phone', 'name'],
      })

      piiAnalytics.trackFieldInteraction({
        field: 'email',
        type: 'change',
        value: 'test@example.com',
      })

      const interactions = piiAnalytics.getFieldInteractions('email')
      expect(interactions[0].value).toBeUndefined()
    })

    it('should respect do not track', () => {
      const dntAnalytics = createAnalytics(schema.id, { respectDNT: true })

      // Simulate DNT header
      dntAnalytics.setDoNotTrack(true)
      dntAnalytics.trackView()

      const stats = dntAnalytics.getStats()
      expect(stats.views).toBe(0)
    })
  })
})

// ============================================================================
// PURE CALCULATION FUNCTION TESTS
// ============================================================================

import {
  calculateMedian,
  calculateAverage,
  calculateRate,
  countEventsByType,
  extractCompletionDurations,
  classifyTimeDropOff,
  inferDropOffReason,
  calculateTimeDistribution,
  generateFieldSuggestion,
} from '../analytics'

describe('Pure Calculation Functions', () => {
  describe('calculateMedian', () => {
    it('should return 0 for empty array', () => {
      expect(calculateMedian([])).toBe(0)
    })

    it('should return the single value for single-element array', () => {
      expect(calculateMedian([42])).toBe(42)
    })

    it('should return middle value for odd-length array', () => {
      expect(calculateMedian([1, 3, 5])).toBe(3)
      expect(calculateMedian([10, 20, 30, 40, 50])).toBe(30)
    })

    it('should return average of two middle values for even-length array', () => {
      expect(calculateMedian([1, 2, 3, 4])).toBe(2.5)
      expect(calculateMedian([10, 20, 30, 40])).toBe(25)
    })

    it('should handle unsorted arrays', () => {
      expect(calculateMedian([5, 1, 3])).toBe(3)
      expect(calculateMedian([40, 10, 30, 20])).toBe(25)
    })
  })

  describe('calculateAverage', () => {
    it('should return 0 for empty array', () => {
      expect(calculateAverage([])).toBe(0)
    })

    it('should return the value for single-element array', () => {
      expect(calculateAverage([100])).toBe(100)
    })

    it('should calculate average correctly', () => {
      expect(calculateAverage([10, 20, 30])).toBe(20)
      expect(calculateAverage([1, 2, 3, 4, 5])).toBe(3)
    })

    it('should handle decimal values', () => {
      expect(calculateAverage([1.5, 2.5, 3.5])).toBe(2.5)
    })
  })

  describe('calculateRate', () => {
    it('should return 0 when denominator is 0', () => {
      expect(calculateRate(10, 0)).toBe(0)
    })

    it('should calculate percentage correctly', () => {
      expect(calculateRate(50, 100)).toBe(50)
      expect(calculateRate(25, 100)).toBe(25)
      expect(calculateRate(100, 100)).toBe(100)
    })

    it('should handle rates over 100%', () => {
      expect(calculateRate(200, 100)).toBe(200)
    })

    it('should handle decimal results', () => {
      expect(calculateRate(1, 3)).toBeCloseTo(33.33, 1)
    })
  })

  describe('countEventsByType', () => {
    it('should return 0 for empty array', () => {
      expect(countEventsByType([], 'view')).toBe(0)
    })

    it('should count events of specific type', () => {
      const events = [
        { type: 'view' },
        { type: 'start' },
        { type: 'view' },
        { type: 'complete' },
      ]
      expect(countEventsByType(events, 'view')).toBe(2)
      expect(countEventsByType(events, 'start')).toBe(1)
      expect(countEventsByType(events, 'abandon')).toBe(0)
    })
  })

  describe('extractCompletionDurations', () => {
    it('should return empty array when no completions', () => {
      const events = [
        { type: 'view', metadata: {} },
        { type: 'start', metadata: {} },
      ]
      expect(extractCompletionDurations(events)).toEqual([])
    })

    it('should extract durations from complete events', () => {
      const events = [
        { type: 'complete', metadata: { duration: 5000 } },
        { type: 'complete', metadata: { duration: 10000 } },
        { type: 'view', metadata: {} },
      ]
      expect(extractCompletionDurations(events)).toEqual([5000, 10000])
    })

    it('should skip completions without duration', () => {
      const events = [
        { type: 'complete', metadata: { duration: 5000 } },
        { type: 'complete', metadata: {} },
        { type: 'complete' },
      ]
      expect(extractCompletionDurations(events)).toEqual([5000])
    })
  })

  describe('classifyTimeDropOff', () => {
    it('should classify times under 30 seconds as early', () => {
      expect(classifyTimeDropOff(0)).toBe('early')
      expect(classifyTimeDropOff(15000)).toBe('early')
      expect(classifyTimeDropOff(29999)).toBe('early')
    })

    it('should classify times between 30s and 2 min as mid', () => {
      expect(classifyTimeDropOff(30000)).toBe('mid')
      expect(classifyTimeDropOff(60000)).toBe('mid')
      expect(classifyTimeDropOff(119999)).toBe('mid')
    })

    it('should classify times over 2 minutes as late', () => {
      expect(classifyTimeDropOff(120000)).toBe('late')
      expect(classifyTimeDropOff(300000)).toBe('late')
    })
  })

  describe('inferDropOffReason', () => {
    it('should return validation_error when hasError is true', () => {
      expect(inferDropOffReason(true, 0, 0)).toBe('validation_error')
      expect(inferDropOffReason(true, 50000, 400000)).toBe('validation_error')
    })

    it('should return slow_field when avg time > 30s and no error', () => {
      expect(inferDropOffReason(false, 31000, 0)).toBe('slow_field')
      expect(inferDropOffReason(false, 60000, 0)).toBe('slow_field')
    })

    it('should return timeout when time before drop-off > 5 min', () => {
      expect(inferDropOffReason(false, 0, 300001)).toBe('timeout')
      expect(inferDropOffReason(false, 0, 600000)).toBe('timeout')
    })

    it('should return abandonment as default', () => {
      expect(inferDropOffReason(false, 0, 0)).toBe('abandonment')
      expect(inferDropOffReason(false, 20000, 100000)).toBe('abandonment')
    })
  })

  describe('calculateTimeDistribution', () => {
    it('should return zeros for empty array', () => {
      expect(calculateTimeDistribution([])).toEqual({
        early: 0,
        mid: 0,
        late: 0,
      })
    })

    it('should categorize times correctly', () => {
      const times = [
        10000,  // early
        25000,  // early
        60000,  // mid
        90000,  // mid
        150000, // late
        200000, // late
      ]
      expect(calculateTimeDistribution(times)).toEqual({
        early: 2,
        mid: 2,
        late: 2,
      })
    })

    it('should handle edge cases at boundaries', () => {
      const times = [29999, 30000, 119999, 120000]
      expect(calculateTimeDistribution(times)).toEqual({
        early: 1,
        mid: 2,
        late: 1,
      })
    })
  })

  describe('generateFieldSuggestion', () => {
    it('should generate suggestion for high error rate', () => {
      const suggestion = generateFieldSuggestion('high_error_rate', 'email')
      expect(suggestion).toContain('email')
      expect(suggestion).toContain('validation')
    })

    it('should generate suggestion for high abandonment', () => {
      const suggestion = generateFieldSuggestion('high_abandonment', 'phone')
      expect(suggestion).toContain('phone')
      expect(suggestion).toContain('autocomplete')
    })

    it('should generate suggestion for slow fields', () => {
      const suggestion = generateFieldSuggestion('slow', 'address')
      expect(suggestion).toContain('address')
      expect(suggestion).toContain('autocomplete')
    })
  })
})

// ============================================================================
// INTEGRATION TESTS - Pure Functions with FormAnalytics
// ============================================================================

describe('FormAnalytics Integration with Pure Functions', () => {
  let analytics: FormAnalytics

  beforeEach(() => {
    analytics = createAnalytics('integration-test-form')
  })

  it('should use calculateRate for start rate calculation', () => {
    // Add views and starts
    analytics.trackView()
    analytics.trackView()
    analytics.trackView()
    analytics.trackView()
    analytics.trackStart({ submissionId: 'sub-1' })
    analytics.trackStart({ submissionId: 'sub-2' })

    const stats = analytics.getStats()
    // 2 starts / 4 views = 50%
    expect(stats.startRate).toBe(calculateRate(2, 4))
  })

  it('should use calculateAverage for completion time', () => {
    vi.useFakeTimers()

    // Complete 3 submissions with different times
    vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))
    analytics.trackStart({ submissionId: 'sub-1' })
    vi.advanceTimersByTime(60000) // 1 min
    analytics.trackComplete({ submissionId: 'sub-1' })

    vi.setSystemTime(new Date('2024-01-15T11:00:00Z'))
    analytics.trackStart({ submissionId: 'sub-2' })
    vi.advanceTimersByTime(180000) // 3 min
    analytics.trackComplete({ submissionId: 'sub-2' })

    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
    analytics.trackStart({ submissionId: 'sub-3' })
    vi.advanceTimersByTime(120000) // 2 min
    analytics.trackComplete({ submissionId: 'sub-3' })

    const stats = analytics.getStats()
    // Average of [60000, 180000, 120000] = 120000
    expect(stats.avgCompletionTimeMs).toBe(calculateAverage([60000, 180000, 120000]))

    vi.useRealTimers()
  })

  it('should include suggestions in problematic fields', () => {
    // Create field with high error rate
    for (let i = 0; i < 10; i++) {
      analytics.trackFieldInteraction({ field: 'email', type: 'change' })
    }
    for (let i = 0; i < 5; i++) {
      analytics.trackFieldInteraction({ field: 'email', type: 'error' })
    }

    const problematic = analytics.getProblematicFields()
    const emailField = problematic.find(f => f.field === 'email')

    expect(emailField).toBeDefined()
    expect(emailField?.suggestion).toBeDefined()
    expect(emailField?.suggestion).toContain('validation')
  })
})
