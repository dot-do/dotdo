/**
 * Funnel and Cohort Analysis Tests
 *
 * Tests for funnel, cohort, and retention analysis primitives.
 *
 * @see dotdo-9ctbm
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Funnel Analysis
  funnel,
  createFunnelAnalyzer,
  FunnelAnalyzer,
  FunnelBuilder,
  type FunnelConfig,
  type FunnelResult,
  type FunnelStep,
  // Cohort Analysis
  cohort,
  createCohortAnalyzer,
  CohortAnalyzer,
  CohortBuilder,
  type CohortConfig,
  type CohortResult,
  type CohortGranularity,
  // Retention Analysis
  retention,
  createRetentionAnalyzer,
  RetentionAnalyzer,
  RetentionBuilder,
  type RetentionConfig,
  type RetentionResult,
  // Event Types
  type AnalyticsEvent,
  type StepFilter,
  // Filter Helpers
  eq,
  neq,
  gt,
  lt,
  gte,
  lte,
  inList,
  contains,
  exists,
} from '../funnel-cohort'

// ============================================================================
// Test Fixtures
// ============================================================================

const BASE_TIME = Date.UTC(2024, 0, 1) // 2024-01-01 00:00:00 UTC
const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

function ts(offsetDays: number, offsetHours: number = 0): number {
  return BASE_TIME + offsetDays * DAY + offsetHours * HOUR
}

function createEvent(
  event: string,
  userId: string,
  timestamp: number,
  properties?: Record<string, unknown>
): AnalyticsEvent {
  return { event, userId, timestamp, properties }
}

// ============================================================================
// Funnel Analysis Tests
// ============================================================================

describe('Funnel Analysis', () => {
  describe('createFunnelAnalyzer()', () => {
    it('should create a funnel analyzer with config', () => {
      const analyzer = createFunnelAnalyzer({
        steps: [
          { name: 'Visit', event: 'page_view' },
          { name: 'Signup', event: 'signup' },
        ],
      })

      expect(analyzer).toBeInstanceOf(FunnelAnalyzer)
    })

    it('should use default conversion window of 30 days', () => {
      const events: AnalyticsEvent[] = [
        createEvent('page_view', 'user1', ts(0)),
        createEvent('signup', 'user1', ts(31)), // Beyond 30 days
      ]

      const analyzer = createFunnelAnalyzer({
        steps: [
          { name: 'Visit', event: 'page_view' },
          { name: 'Signup', event: 'signup' },
        ],
      })

      const result = analyzer.analyze(events)

      // User started but didn't convert (beyond window)
      expect(result.steps[0]!.count).toBe(1)
      expect(result.steps[1]!.count).toBe(0)
    })
  })

  describe('FunnelAnalyzer.analyze()', () => {
    it('should calculate basic funnel metrics', () => {
      const events: AnalyticsEvent[] = [
        // User 1: completes full funnel
        createEvent('page_view', 'user1', ts(0)),
        createEvent('signup', 'user1', ts(0, 1)),
        createEvent('purchase', 'user1', ts(0, 2)),
        // User 2: drops off at signup
        createEvent('page_view', 'user2', ts(0)),
        createEvent('signup', 'user2', ts(0, 1)),
        // User 3: drops off at page_view
        createEvent('page_view', 'user3', ts(0)),
      ]

      const result = funnel()
        .step('Visit', 'page_view')
        .step('Signup', 'signup')
        .step('Purchase', 'purchase')
        .analyze(events)

      expect(result.totalUsers).toBe(3)
      expect(result.convertedUsers).toBe(1)
      expect(result.overallConversionRate).toBeCloseTo(33.33, 1)

      expect(result.steps[0]!.count).toBe(3)
      expect(result.steps[0]!.conversionRate).toBe(100)

      expect(result.steps[1]!.count).toBe(2)
      expect(result.steps[1]!.conversionRate).toBeCloseTo(66.67, 1)

      expect(result.steps[2]!.count).toBe(1)
      expect(result.steps[2]!.conversionRate).toBe(50)
    })

    it('should respect conversion window', () => {
      const events: AnalyticsEvent[] = [
        createEvent('page_view', 'user1', ts(0)),
        createEvent('signup', 'user1', ts(10)), // Within 14-day window
        createEvent('page_view', 'user2', ts(0)),
        createEvent('signup', 'user2', ts(20)), // Outside 14-day window
      ]

      const result = funnel()
        .step('Visit', 'page_view')
        .step('Signup', 'signup')
        .windowDays(14)
        .analyze(events)

      expect(result.steps[0]!.count).toBe(2)
      expect(result.steps[1]!.count).toBe(1)
    })

    it('should calculate time between steps', () => {
      const events: AnalyticsEvent[] = [
        createEvent('page_view', 'user1', ts(0)),
        createEvent('signup', 'user1', ts(1)), // 1 day later
        createEvent('page_view', 'user2', ts(0)),
        createEvent('signup', 'user2', ts(3)), // 3 days later
      ]

      const result = funnel()
        .step('Visit', 'page_view')
        .step('Signup', 'signup')
        .analyze(events)

      expect(result.steps[1]!.avgTimeFromPrevious).toBe(2 * DAY) // (1 + 3) / 2 days
      expect(result.steps[1]!.medianTimeFromPrevious).toBe(2 * DAY)
    })

    it('should calculate average conversion time', () => {
      const events: AnalyticsEvent[] = [
        createEvent('page_view', 'user1', ts(0)),
        createEvent('signup', 'user1', ts(0, 1)),
        createEvent('purchase', 'user1', ts(0, 3)), // 3 hours total
        createEvent('page_view', 'user2', ts(0)),
        createEvent('signup', 'user2', ts(0, 2)),
        createEvent('purchase', 'user2', ts(0, 5)), // 5 hours total
      ]

      const result = funnel()
        .step('Visit', 'page_view')
        .step('Signup', 'signup')
        .step('Purchase', 'purchase')
        .analyze(events)

      expect(result.avgConversionTime).toBe(4 * HOUR) // (3 + 5) / 2 hours
    })

    it('should handle empty events', () => {
      const result = funnel()
        .step('Visit', 'page_view')
        .step('Signup', 'signup')
        .analyze([])

      expect(result.totalUsers).toBe(0)
      expect(result.convertedUsers).toBe(0)
      expect(result.overallConversionRate).toBe(0)
    })

    it('should handle empty funnel steps', () => {
      const events: AnalyticsEvent[] = [createEvent('page_view', 'user1', ts(0))]

      const result = createFunnelAnalyzer({ steps: [] }).analyze(events)

      expect(result.steps).toHaveLength(0)
      expect(result.totalUsers).toBe(0)
    })
  })

  describe('Funnel with Filters', () => {
    it('should filter steps by property equality', () => {
      const events: AnalyticsEvent[] = [
        createEvent('page_view', 'user1', ts(0), { source: 'google' }),
        createEvent('signup', 'user1', ts(0, 1)),
        createEvent('page_view', 'user2', ts(0), { source: 'facebook' }),
        createEvent('signup', 'user2', ts(0, 1)),
      ]

      const result = funnel()
        .step('Visit from Google', 'page_view', [eq('source', 'google')])
        .step('Signup', 'signup')
        .analyze(events)

      expect(result.steps[0]!.count).toBe(1)
      expect(result.steps[1]!.count).toBe(1)
    })

    it('should filter steps by numeric comparison', () => {
      const events: AnalyticsEvent[] = [
        createEvent('purchase', 'user1', ts(0), { amount: 100 }),
        createEvent('purchase', 'user2', ts(0), { amount: 50 }),
        createEvent('purchase', 'user3', ts(0), { amount: 200 }),
      ]

      const result = funnel().step('High Value Purchase', 'purchase', [gt('amount', 75)]).analyze(events)

      expect(result.steps[0]!.count).toBe(2) // 100 and 200
    })

    it('should filter steps by in-list', () => {
      const events: AnalyticsEvent[] = [
        createEvent('page_view', 'user1', ts(0), { region: 'US' }),
        createEvent('page_view', 'user2', ts(0), { region: 'EU' }),
        createEvent('page_view', 'user3', ts(0), { region: 'APAC' }),
      ]

      const result = funnel().step('Visit from US/EU', 'page_view', [inList('region', ['US', 'EU'])]).analyze(events)

      expect(result.steps[0]!.count).toBe(2)
    })

    it('should filter steps by string contains', () => {
      const events: AnalyticsEvent[] = [
        createEvent('page_view', 'user1', ts(0), { url: '/pricing/enterprise' }),
        createEvent('page_view', 'user2', ts(0), { url: '/features' }),
        createEvent('page_view', 'user3', ts(0), { url: '/pricing/startup' }),
      ]

      const result = funnel().step('Pricing Page', 'page_view', [contains('url', 'pricing')]).analyze(events)

      expect(result.steps[0]!.count).toBe(2)
    })

    it('should filter steps by property existence', () => {
      const events: AnalyticsEvent[] = [
        createEvent('signup', 'user1', ts(0), { referral_code: 'ABC123' }),
        createEvent('signup', 'user2', ts(0)),
        createEvent('signup', 'user3', ts(0), { referral_code: 'XYZ789' }),
      ]

      const result = funnel().step('Referred Signup', 'signup', [exists('referral_code')]).analyze(events)

      expect(result.steps[0]!.count).toBe(2)
    })
  })

  describe('FunnelBuilder', () => {
    it('should build funnel with fluent API', () => {
      const builder = funnel()
        .step('Step 1', 'event1')
        .step('Step 2', 'event2')
        .windowDays(7)
        .userId('customUserId')
        .timestamp('customTimestamp')
        .strict(false)

      const analyzer = builder.build()
      expect(analyzer).toBeInstanceOf(FunnelAnalyzer)
    })

    it('should analyze directly from builder', () => {
      const events: AnalyticsEvent[] = [
        createEvent('page_view', 'user1', ts(0)),
        createEvent('signup', 'user1', ts(0, 1)),
      ]

      const result = funnel().step('Visit', 'page_view').step('Signup', 'signup').analyze(events)

      expect(result.totalUsers).toBe(1)
      expect(result.convertedUsers).toBe(1)
    })
  })

  describe('Non-strict Order Funnel', () => {
    it('should allow steps in any order when strict=false', () => {
      const events: AnalyticsEvent[] = [
        // User completes steps out of order
        createEvent('signup', 'user1', ts(0)),
        createEvent('page_view', 'user1', ts(0, 1)),
        createEvent('purchase', 'user1', ts(0, 2)),
      ]

      const result = funnel()
        .step('Visit', 'page_view')
        .step('Signup', 'signup')
        .step('Purchase', 'purchase')
        .strict(false)
        .analyze(events)

      // All steps completed despite order
      expect(result.steps[0]!.count).toBe(1)
      expect(result.steps[1]!.count).toBe(1)
      expect(result.steps[2]!.count).toBe(1)
      expect(result.convertedUsers).toBe(1)
    })

    it('should require steps in order when strict=true (default)', () => {
      const events: AnalyticsEvent[] = [
        // User completes steps out of order
        createEvent('signup', 'user1', ts(0)),
        createEvent('page_view', 'user1', ts(0, 1)),
        createEvent('purchase', 'user1', ts(0, 2)),
      ]

      const result = funnel()
        .step('Visit', 'page_view')
        .step('Signup', 'signup')
        .step('Purchase', 'purchase')
        .analyze(events)

      // Only page_view matches (first step)
      expect(result.steps[0]!.count).toBe(1)
      expect(result.steps[1]!.count).toBe(0) // signup came before page_view
      expect(result.convertedUsers).toBe(0)
    })
  })
})

// ============================================================================
// Cohort Analysis Tests
// ============================================================================

describe('Cohort Analysis', () => {
  describe('createCohortAnalyzer()', () => {
    it('should create a cohort analyzer with config', () => {
      const analyzer = createCohortAnalyzer({
        cohortEvent: 'signup',
        returnEvent: 'login',
        granularity: 'month',
        periods: 6,
      })

      expect(analyzer).toBeInstanceOf(CohortAnalyzer)
    })
  })

  describe('CohortAnalyzer.analyze()', () => {
    it('should group users into cohorts by signup date', () => {
      const events: AnalyticsEvent[] = [
        // January cohort
        createEvent('signup', 'user1', ts(0)), // Jan 1
        createEvent('signup', 'user2', ts(15)), // Jan 16
        // February cohort
        createEvent('signup', 'user3', ts(32)), // Feb 2
      ]

      const result = cohort()
        .cohort('signup')
        .returns('login')
        .by('month')
        .trackPeriods(3)
        .analyze(events)

      expect(result.cohorts).toHaveLength(2)
      expect(result.cohorts[0]!.cohortId).toBe('2024-01')
      expect(result.cohorts[0]!.cohortSize).toBe(2)
      expect(result.cohorts[1]!.cohortId).toBe('2024-02')
      expect(result.cohorts[1]!.cohortSize).toBe(1)
    })

    it('should calculate retention rates', () => {
      const events: AnalyticsEvent[] = [
        // January cohort
        createEvent('signup', 'user1', ts(0)),
        createEvent('signup', 'user2', ts(1)),
        // User 1 returns in period 0 (same month)
        createEvent('login', 'user1', ts(5)),
        // User 1 returns in period 1 (next month)
        createEvent('login', 'user1', ts(35)),
        // User 2 returns in period 0
        createEvent('login', 'user2', ts(10)),
      ]

      const result = cohort()
        .cohort('signup')
        .returns('login')
        .by('month')
        .trackPeriods(3)
        .analyze(events)

      const janCohort = result.cohorts[0]!
      expect(janCohort.cohortSize).toBe(2)

      // Period 0: both users returned
      expect(janCohort.retention[0]!.returnedUsers).toBe(2)
      expect(janCohort.retention[0]!.retentionRate).toBe(100)

      // Period 1: only user1 returned
      expect(janCohort.retention[1]!.returnedUsers).toBe(1)
      expect(janCohort.retention[1]!.retentionRate).toBe(50)

      // Period 2: no returns
      expect(janCohort.retention[2]!.returnedUsers).toBe(0)
      expect(janCohort.retention[2]!.retentionRate).toBe(0)
    })

    it('should calculate average retention across cohorts', () => {
      const events: AnalyticsEvent[] = [
        // January cohort (2 users)
        createEvent('signup', 'user1', ts(0)),
        createEvent('signup', 'user2', ts(1)),
        createEvent('login', 'user1', ts(5)), // Period 0
        createEvent('login', 'user2', ts(6)), // Period 0
        // February cohort (2 users)
        createEvent('signup', 'user3', ts(32)),
        createEvent('signup', 'user4', ts(33)),
        createEvent('login', 'user3', ts(35)), // Period 0
        // No user4 return
      ]

      const result = cohort()
        .cohort('signup')
        .returns('login')
        .by('month')
        .trackPeriods(2)
        .analyze(events)

      // Period 0: Jan = 100%, Feb = 50% => avg = 75%
      expect(result.averageRetention[0]).toBe(75)
    })

    it('should handle weekly granularity', () => {
      const events: AnalyticsEvent[] = [
        createEvent('signup', 'user1', ts(0)), // Week 1
        createEvent('signup', 'user2', ts(7)), // Week 2
      ]

      const result = cohort()
        .cohort('signup')
        .returns('login')
        .by('week')
        .trackPeriods(4)
        .analyze(events)

      expect(result.cohorts).toHaveLength(2)
      expect(result.cohorts[0]!.cohortId).toMatch(/2024-W\d+/)
    })

    it('should handle daily granularity', () => {
      const events: AnalyticsEvent[] = [
        createEvent('signup', 'user1', ts(0)),
        createEvent('signup', 'user2', ts(0, 12)), // Same day
        createEvent('signup', 'user3', ts(1)), // Next day
      ]

      const result = cohort()
        .cohort('signup')
        .returns('login')
        .by('day')
        .trackPeriods(7)
        .analyze(events)

      expect(result.cohorts).toHaveLength(2)
      expect(result.cohorts[0]!.cohortId).toBe('2024-01-01')
      expect(result.cohorts[0]!.cohortSize).toBe(2)
      expect(result.cohorts[1]!.cohortId).toBe('2024-01-02')
      expect(result.cohorts[1]!.cohortSize).toBe(1)
    })

    it('should filter cohort and return events', () => {
      const events: AnalyticsEvent[] = [
        createEvent('signup', 'user1', ts(0), { plan: 'premium' }),
        createEvent('signup', 'user2', ts(0), { plan: 'free' }),
        createEvent('login', 'user1', ts(5), { platform: 'mobile' }),
        createEvent('login', 'user2', ts(5), { platform: 'web' }),
      ]

      const result = cohort()
        .cohort('signup', [eq('plan', 'premium')])
        .returns('login', [eq('platform', 'mobile')])
        .by('month')
        .trackPeriods(1)
        .analyze(events)

      expect(result.cohorts).toHaveLength(1)
      expect(result.cohorts[0]!.cohortSize).toBe(1) // Only premium user
      expect(result.cohorts[0]!.retention[0]!.returnedUsers).toBe(1)
    })
  })

  describe('CohortBuilder', () => {
    it('should build cohort analyzer with fluent API', () => {
      const builder = cohort()
        .cohort('signup')
        .returns('login')
        .by('month')
        .trackPeriods(12)
        .userId('customUserId')
        .timestamp('customTimestamp')

      const analyzer = builder.build()
      expect(analyzer).toBeInstanceOf(CohortAnalyzer)
    })

    it('should throw error if cohort event not set', () => {
      expect(() => {
        cohort().returns('login').build()
      }).toThrow('Cohort event is required')
    })

    it('should throw error if return event not set', () => {
      expect(() => {
        cohort().cohort('signup').build()
      }).toThrow('Return event is required')
    })
  })
})

// ============================================================================
// Retention Analysis Tests
// ============================================================================

describe('Retention Analysis', () => {
  describe('createRetentionAnalyzer()', () => {
    it('should create a retention analyzer with config', () => {
      const analyzer = createRetentionAnalyzer({
        activationEvent: 'signup',
        returnEvent: 'login',
        granularity: 'week',
        periods: 8,
      })

      expect(analyzer).toBeInstanceOf(RetentionAnalyzer)
    })
  })

  describe('RetentionAnalyzer.analyze()', () => {
    it('should calculate retention rates by period', () => {
      const events: AnalyticsEvent[] = [
        // User 1: activates and returns in weeks 1 and 2
        createEvent('signup', 'user1', ts(0)),
        createEvent('login', 'user1', ts(7)), // Week 1
        createEvent('login', 'user1', ts(14)), // Week 2
        // User 2: activates and returns only in week 1
        createEvent('signup', 'user2', ts(0)),
        createEvent('login', 'user2', ts(8)), // Week 1
        // User 3: activates but never returns
        createEvent('signup', 'user3', ts(0)),
      ]

      const result = retention()
        .activated('signup')
        .returns('login')
        .by('week')
        .trackPeriods(3)
        .analyze(events)

      expect(result.totalUsers).toBe(3)

      // Week 1: 2 out of 3 users returned
      expect(result.retention[0]!.period).toBe(1)
      expect(result.retention[0]!.returnedUsers).toBe(2)
      expect(result.retention[0]!.retentionRate).toBeCloseTo(66.67, 1)

      // Week 2: 1 out of 3 users returned
      expect(result.retention[1]!.period).toBe(2)
      expect(result.retention[1]!.returnedUsers).toBe(1)
      expect(result.retention[1]!.retentionRate).toBeCloseTo(33.33, 1)

      // Week 3: 0 users returned
      expect(result.retention[2]!.period).toBe(3)
      expect(result.retention[2]!.returnedUsers).toBe(0)
      expect(result.retention[2]!.retentionRate).toBe(0)
    })

    it('should calculate cumulative retention', () => {
      const events: AnalyticsEvent[] = [
        createEvent('signup', 'user1', ts(0)),
        createEvent('signup', 'user2', ts(0)),
        createEvent('signup', 'user3', ts(0)),
        createEvent('signup', 'user4', ts(0)),
        // User 1 returns in week 1
        createEvent('login', 'user1', ts(7)),
        // User 2 returns in week 2
        createEvent('login', 'user2', ts(14)),
        // User 3 returns in week 3
        createEvent('login', 'user3', ts(21)),
      ]

      const result = retention()
        .activated('signup')
        .returns('login')
        .by('week')
        .trackPeriods(3)
        .analyze(events)

      expect(result.retention[0]!.cumulativeReturnedUsers).toBe(1)
      expect(result.retention[0]!.cumulativeRetentionRate).toBe(25)

      expect(result.retention[1]!.cumulativeReturnedUsers).toBe(2)
      expect(result.retention[1]!.cumulativeRetentionRate).toBe(50)

      expect(result.retention[2]!.cumulativeReturnedUsers).toBe(3)
      expect(result.retention[2]!.cumulativeRetentionRate).toBe(75)
    })

    it('should calculate average retention', () => {
      const events: AnalyticsEvent[] = [
        createEvent('signup', 'user1', ts(0)),
        createEvent('signup', 'user2', ts(0)),
        createEvent('login', 'user1', ts(7)), // Week 1
        createEvent('login', 'user2', ts(7)), // Week 1
        createEvent('login', 'user1', ts(14)), // Week 2
      ]

      const result = retention()
        .activated('signup')
        .returns('login')
        .by('week')
        .trackPeriods(2)
        .analyze(events)

      // Week 1: 100%, Week 2: 50% => avg = 75%
      expect(result.averageRetention).toBe(75)
    })

    it('should handle users returning multiple times in same period', () => {
      const events: AnalyticsEvent[] = [
        createEvent('signup', 'user1', ts(0)),
        createEvent('login', 'user1', ts(7)),
        createEvent('login', 'user1', ts(8)), // Same week
        createEvent('login', 'user1', ts(9)), // Same week
      ]

      const result = retention()
        .activated('signup')
        .returns('login')
        .by('week')
        .trackPeriods(2)
        .analyze(events)

      // Only count user once per period
      expect(result.retention[0]!.returnedUsers).toBe(1)
    })

    it('should filter activation and return events', () => {
      const events: AnalyticsEvent[] = [
        createEvent('signup', 'user1', ts(0), { plan: 'premium' }),
        createEvent('signup', 'user2', ts(0), { plan: 'free' }),
        createEvent('login', 'user1', ts(7), { device: 'mobile' }),
        createEvent('login', 'user2', ts(7), { device: 'desktop' }),
      ]

      const result = retention()
        .activated('signup', [eq('plan', 'premium')])
        .returns('login', [eq('device', 'mobile')])
        .by('week')
        .trackPeriods(2)
        .analyze(events)

      expect(result.totalUsers).toBe(1)
      expect(result.retention[0]!.returnedUsers).toBe(1)
      expect(result.retention[0]!.retentionRate).toBe(100)
    })
  })

  describe('RetentionBuilder', () => {
    it('should build retention analyzer with fluent API', () => {
      const builder = retention()
        .activated('signup')
        .returns('login')
        .by('day')
        .trackPeriods(30)
        .userId('customUserId')
        .timestamp('customTimestamp')

      const analyzer = builder.build()
      expect(analyzer).toBeInstanceOf(RetentionAnalyzer)
    })

    it('should throw error if activation event not set', () => {
      expect(() => {
        retention().returns('login').build()
      }).toThrow('Activation event is required')
    })

    it('should throw error if return event not set', () => {
      expect(() => {
        retention().activated('signup').build()
      }).toThrow('Return event is required')
    })
  })
})

// ============================================================================
// Filter Helpers Tests
// ============================================================================

describe('Filter Helpers', () => {
  it('should create equality filter', () => {
    const filter = eq('status', 'active')
    expect(filter).toEqual({ property: 'status', op: '=', value: 'active' })
  })

  it('should create inequality filter', () => {
    const filter = neq('status', 'deleted')
    expect(filter).toEqual({ property: 'status', op: '!=', value: 'deleted' })
  })

  it('should create greater-than filter', () => {
    const filter = gt('amount', 100)
    expect(filter).toEqual({ property: 'amount', op: '>', value: 100 })
  })

  it('should create less-than filter', () => {
    const filter = lt('amount', 50)
    expect(filter).toEqual({ property: 'amount', op: '<', value: 50 })
  })

  it('should create greater-than-or-equal filter', () => {
    const filter = gte('count', 5)
    expect(filter).toEqual({ property: 'count', op: '>=', value: 5 })
  })

  it('should create less-than-or-equal filter', () => {
    const filter = lte('count', 10)
    expect(filter).toEqual({ property: 'count', op: '<=', value: 10 })
  })

  it('should create in-list filter', () => {
    const filter = inList('region', ['US', 'EU', 'APAC'])
    expect(filter).toEqual({ property: 'region', op: 'in', value: ['US', 'EU', 'APAC'] })
  })

  it('should create contains filter', () => {
    const filter = contains('url', '/pricing')
    expect(filter).toEqual({ property: 'url', op: 'contains', value: '/pricing' })
  })

  it('should create exists filter', () => {
    const filter = exists('referral_code')
    expect(filter).toEqual({ property: 'referral_code', op: 'exists', value: true })
  })

  it('should create exists filter with false', () => {
    const filter = exists('deleted_at', false)
    expect(filter).toEqual({ property: 'deleted_at', op: 'exists', value: false })
  })
})

// ============================================================================
// Time Granularity Tests
// ============================================================================

describe('Time Granularity', () => {
  describe('Quarterly cohorts', () => {
    it('should group users into quarters', () => {
      const events: AnalyticsEvent[] = [
        createEvent('signup', 'user1', Date.UTC(2024, 0, 15)), // Q1
        createEvent('signup', 'user2', Date.UTC(2024, 2, 15)), // Q1
        createEvent('signup', 'user3', Date.UTC(2024, 3, 15)), // Q2
        createEvent('signup', 'user4', Date.UTC(2024, 6, 15)), // Q3
      ]

      const result = cohort()
        .cohort('signup')
        .returns('login')
        .by('quarter')
        .trackPeriods(4)
        .analyze(events)

      expect(result.cohorts).toHaveLength(3)
      expect(result.cohorts[0]!.cohortId).toBe('2024-Q1')
      expect(result.cohorts[0]!.cohortSize).toBe(2)
      expect(result.cohorts[1]!.cohortId).toBe('2024-Q2')
      expect(result.cohorts[1]!.cohortSize).toBe(1)
      expect(result.cohorts[2]!.cohortId).toBe('2024-Q3')
      expect(result.cohorts[2]!.cohortSize).toBe(1)
    })
  })

  describe('Yearly cohorts', () => {
    it('should group users into years', () => {
      const events: AnalyticsEvent[] = [
        createEvent('signup', 'user1', Date.UTC(2023, 6, 1)),
        createEvent('signup', 'user2', Date.UTC(2023, 11, 31)),
        createEvent('signup', 'user3', Date.UTC(2024, 0, 1)),
      ]

      const result = cohort()
        .cohort('signup')
        .returns('login')
        .by('year')
        .trackPeriods(2)
        .analyze(events)

      expect(result.cohorts).toHaveLength(2)
      expect(result.cohorts[0]!.cohortId).toBe('2023')
      expect(result.cohorts[0]!.cohortSize).toBe(2)
      expect(result.cohorts[1]!.cohortId).toBe('2024')
      expect(result.cohorts[1]!.cohortSize).toBe(1)
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration: Real-world Scenarios', () => {
  it('should analyze e-commerce conversion funnel', () => {
    const events: AnalyticsEvent[] = [
      // 100 users view product
      ...Array.from({ length: 100 }, (_, i) =>
        createEvent('product_view', `user${i}`, ts(0), { product: 'widget' })
      ),
      // 60 add to cart
      ...Array.from({ length: 60 }, (_, i) =>
        createEvent('add_to_cart', `user${i}`, ts(0, 1), { product: 'widget' })
      ),
      // 40 begin checkout
      ...Array.from({ length: 40 }, (_, i) =>
        createEvent('begin_checkout', `user${i}`, ts(0, 2))
      ),
      // 30 complete purchase
      ...Array.from({ length: 30 }, (_, i) =>
        createEvent('purchase', `user${i}`, ts(0, 3), { amount: 49.99 })
      ),
    ]

    const result = funnel()
      .step('View Product', 'product_view')
      .step('Add to Cart', 'add_to_cart')
      .step('Begin Checkout', 'begin_checkout')
      .step('Purchase', 'purchase')
      .analyze(events)

    expect(result.totalUsers).toBe(100)
    expect(result.convertedUsers).toBe(30)
    expect(result.overallConversionRate).toBe(30)

    expect(result.steps[1]!.conversionRate).toBe(60) // 60% add to cart
    expect(result.steps[2]!.conversionRate).toBeCloseTo(66.67, 1) // 66.67% checkout
    expect(result.steps[3]!.conversionRate).toBe(75) // 75% purchase
  })

  it('should analyze SaaS user retention', () => {
    const users = Array.from({ length: 50 }, (_, i) => `user${i}`)
    const events: AnalyticsEvent[] = []

    // All users sign up in January
    for (const userId of users) {
      events.push(createEvent('signup', userId, ts(0)))
    }

    // 40 users return in week 1
    for (let i = 0; i < 40; i++) {
      events.push(createEvent('login', users[i]!, ts(7)))
    }

    // 30 users return in week 2
    for (let i = 0; i < 30; i++) {
      events.push(createEvent('login', users[i]!, ts(14)))
    }

    // 25 users return in week 3
    for (let i = 0; i < 25; i++) {
      events.push(createEvent('login', users[i]!, ts(21)))
    }

    // 20 users return in week 4
    for (let i = 0; i < 20; i++) {
      events.push(createEvent('login', users[i]!, ts(28)))
    }

    const result = retention()
      .activated('signup')
      .returns('login')
      .by('week')
      .trackPeriods(4)
      .analyze(events)

    expect(result.totalUsers).toBe(50)
    expect(result.retention[0]!.retentionRate).toBe(80) // 40/50
    expect(result.retention[1]!.retentionRate).toBe(60) // 30/50
    expect(result.retention[2]!.retentionRate).toBe(50) // 25/50
    expect(result.retention[3]!.retentionRate).toBe(40) // 20/50
  })

  it('should analyze monthly cohort retention matrix', () => {
    const events: AnalyticsEvent[] = []

    // January cohort: 100 users, decreasing retention
    for (let i = 0; i < 100; i++) {
      events.push(createEvent('signup', `jan-user${i}`, Date.UTC(2024, 0, 15)))
      // 80% return in Feb
      if (i < 80) events.push(createEvent('login', `jan-user${i}`, Date.UTC(2024, 1, 15)))
      // 60% return in March
      if (i < 60) events.push(createEvent('login', `jan-user${i}`, Date.UTC(2024, 2, 15)))
    }

    // February cohort: 80 users
    for (let i = 0; i < 80; i++) {
      events.push(createEvent('signup', `feb-user${i}`, Date.UTC(2024, 1, 15)))
      // 70% return in March
      if (i < 56) events.push(createEvent('login', `feb-user${i}`, Date.UTC(2024, 2, 15)))
    }

    const result = cohort()
      .cohort('signup')
      .returns('login')
      .by('month')
      .trackPeriods(3)
      .analyze(events)

    expect(result.cohorts).toHaveLength(2)

    const janCohort = result.cohorts.find((c) => c.cohortId === '2024-01')!
    expect(janCohort.cohortSize).toBe(100)
    expect(janCohort.retention[1]!.retentionRate).toBe(80) // Feb
    expect(janCohort.retention[2]!.retentionRate).toBe(60) // March

    const febCohort = result.cohorts.find((c) => c.cohortId === '2024-02')!
    expect(febCohort.cohortSize).toBe(80)
    expect(febCohort.retention[1]!.retentionRate).toBe(70) // March
  })
})
