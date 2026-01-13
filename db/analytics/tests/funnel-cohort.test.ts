/**
 * Funnel and Cohort Analysis Tests
 *
 * Tests for:
 * - Funnel analysis with multi-step conversion tracking
 * - Cohort analysis with retention metrics
 * - SQL generation for multiple dialects
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  FunnelBuilder,
  FunnelAnalyzer,
  type FunnelConfig,
  type FunnelResult,
  FunnelValidationError,
} from '../funnel'
import {
  CohortBuilder,
  CohortAnalyzer,
  type CohortConfig,
  type CohortResult,
  CohortValidationError,
} from '../cohort'

describe('FunnelBuilder', () => {
  it('should build a valid funnel configuration', () => {
    const funnel = new FunnelBuilder()
      .addStep('signup', 'User signed up')
      .addStep('onboarding', 'Started onboarding')
      .addStep('purchase', 'Made first purchase')
      .withTimeWindow('7 days')
      .withLookbackPeriod('30 days')
      .withName('Conversion Funnel')
      .build()

    expect(funnel.steps).toHaveLength(3)
    expect(funnel.steps[0].eventType).toBe('signup')
    expect(funnel.timeWindow).toBe('7 days')
    expect(funnel.lookbackPeriod).toBe('30 days')
    expect(funnel.name).toBe('Conversion Funnel')
  })

  it('should throw on funnel with less than 2 steps', () => {
    const builder = new FunnelBuilder().addStep('signup', 'User signed up')

    expect(() => builder.build()).toThrow(FunnelValidationError)
    expect(() => builder.build()).toThrow('at least 2 steps')
  })

  it('should throw on duplicate event types', () => {
    const builder = new FunnelBuilder()
      .addStep('signup', 'First signup')
      .addStep('signup', 'Duplicate signup')

    expect(() => builder.build()).toThrow(FunnelValidationError)
    expect(() => builder.build()).toThrow('Duplicate event type')
  })

  it('should throw on invalid time window format', () => {
    const builder = new FunnelBuilder()
      .addStep('signup', 'User signed up')
      .addStep('purchase', 'Made purchase')
      .withTimeWindow('invalid')

    expect(() => builder.build()).toThrow(FunnelValidationError)
    expect(() => builder.build()).toThrow('Invalid time window')
  })

  it('should support step filters', () => {
    const funnel = new FunnelBuilder()
      .addStep('signup', 'User signed up', [{ property: 'plan', operator: 'eq', value: 'pro' }])
      .addStep('purchase', 'Made purchase', [{ property: 'amount', operator: 'gte', value: 100 }])
      .build()

    expect(funnel.steps[0].filters).toHaveLength(1)
    expect(funnel.steps[0].filters![0].property).toBe('plan')
    expect(funnel.steps[1].filters![0].operator).toBe('gte')
  })

  it('should support strict order configuration', () => {
    const funnel = new FunnelBuilder()
      .addStep('step1', 'Step 1')
      .addStep('step2', 'Step 2')
      .withStrictOrder(false)
      .build()

    expect(funnel.strictOrder).toBe(false)
  })
})

describe('FunnelAnalyzer', () => {
  let analyzer: FunnelAnalyzer
  let funnel: FunnelConfig

  beforeEach(() => {
    analyzer = new FunnelAnalyzer({ dialect: 'postgres' })
    funnel = new FunnelBuilder()
      .addStep('signup', 'User signed up')
      .addStep('activation', 'Activated account')
      .addStep('purchase', 'Made first purchase')
      .withTimeWindow('7 days')
      .withLookbackPeriod('30 days')
      .build()
  })

  describe('SQL Generation', () => {
    it('should generate PostgreSQL query with proper parameterization', () => {
      const { sql, params } = analyzer.generateQuery(funnel)

      expect(sql).toContain('WITH filtered_events')
      expect(sql).toContain('funnel_progress')
      expect(sql).toContain('$1')
      expect(sql).toContain('$2')
      expect(sql).toContain('$3')
      expect(params).toEqual(['signup', 'activation', 'purchase'])
    })

    it('should generate DuckDB query', () => {
      const duckdbAnalyzer = new FunnelAnalyzer({ dialect: 'duckdb' })
      const { sql, params } = duckdbAnalyzer.generateQuery(funnel)

      expect(sql).toContain('WITH filtered_events')
      expect(sql).toContain('NOW()')
      expect(params).toEqual(['signup', 'activation', 'purchase'])
    })

    it('should generate ClickHouse query with windowFunnel', () => {
      const clickhouseAnalyzer = new FunnelAnalyzer({ dialect: 'clickhouse' })
      const { sql } = clickhouseAnalyzer.generateQuery(funnel)

      expect(sql).toContain('windowFunnel')
      expect(sql).toContain('countIf(level >= 1)')
      expect(sql).toContain('countIf(level >= 2)')
    })

    it('should generate SQLite query with julianday', () => {
      const sqliteAnalyzer = new FunnelAnalyzer({ dialect: 'sqlite' })
      const { sql, params } = sqliteAnalyzer.generateQuery(funnel)

      expect(sql).toContain('julianday')
      // SQLite uses ? placeholders and doubles params for CASE statements
      expect(params.length).toBe(6) // 3 for IN, 3 for CASE
    })

    it('should use custom table and column names', () => {
      const customAnalyzer = new FunnelAnalyzer({
        dialect: 'postgres',
        eventsTable: 'user_events',
        userIdColumn: 'uid',
        eventTypeColumn: 'action',
        timestampColumn: 'created_at',
      })
      const { sql } = customAnalyzer.generateQuery(funnel)

      expect(sql).toContain('FROM user_events')
      expect(sql).toContain('uid')
      expect(sql).toContain('action')
      expect(sql).toContain('created_at')
    })
  })

  describe('Result Processing', () => {
    it('should process raw query results into FunnelResult', () => {
      const rawResults = [
        {
          step_1_users: 1000,
          step_2_users: 750,
          step_3_users: 300,
        },
      ]

      const result = analyzer.processResults(rawResults, funnel)

      expect(result.totalUsers).toBe(1000)
      expect(result.steps).toHaveLength(3)
      expect(result.steps[0].users).toBe(1000)
      expect(result.steps[1].users).toBe(750)
      expect(result.steps[2].users).toBe(300)
    })

    it('should calculate conversion rates correctly', () => {
      const rawResults = [
        {
          step_1_users: 1000,
          step_2_users: 800,
          step_3_users: 400,
        },
      ]

      const result = analyzer.processResults(rawResults, funnel)

      // Step 2: 800/1000 = 80% from start, 800/1000 = 80% from previous
      expect(result.steps[1].conversionFromStart).toBe(0.8)
      expect(result.steps[1].conversionFromPrevious).toBe(0.8)

      // Step 3: 400/1000 = 40% from start, 400/800 = 50% from previous
      expect(result.steps[2].conversionFromStart).toBe(0.4)
      expect(result.steps[2].conversionFromPrevious).toBe(0.5)
    })

    it('should calculate drop-off correctly', () => {
      const rawResults = [
        {
          step_1_users: 1000,
          step_2_users: 750,
          step_3_users: 300,
        },
      ]

      const result = analyzer.processResults(rawResults, funnel)

      expect(result.steps[1].dropOff).toBe(250) // 1000 - 750
      expect(result.steps[1].dropOffRate).toBe(0.25) // 250/1000
      expect(result.steps[2].dropOff).toBe(450) // 750 - 300
      expect(result.steps[2].dropOffRate).toBe(0.6) // 450/750
    })

    it('should calculate overall conversion rate', () => {
      const rawResults = [
        {
          step_1_users: 1000,
          step_2_users: 750,
          step_3_users: 300,
        },
      ]

      const result = analyzer.processResults(rawResults, funnel)

      expect(result.overallConversionRate).toBe(0.3) // 300/1000
    })

    it('should handle empty results gracefully', () => {
      const result = analyzer.processResults([], funnel)

      expect(result.totalUsers).toBe(0)
      expect(result.steps.every((s) => s.users === 0)).toBe(true)
      expect(result.overallConversionRate).toBe(0)
    })

    it('should include funnel name and analysis timestamp', () => {
      const namedFunnel = new FunnelBuilder()
        .addStep('a', 'A')
        .addStep('b', 'B')
        .withName('Test Funnel')
        .build()

      const result = analyzer.processResults([{ step_1_users: 100, step_2_users: 50 }], namedFunnel)

      expect(result.name).toBe('Test Funnel')
      expect(result.analyzedAt).toBeInstanceOf(Date)
    })
  })
})

describe('CohortBuilder', () => {
  it('should build a valid cohort configuration', () => {
    const cohort = new CohortBuilder()
      .withCohortEvent('signup')
      .withRetentionEvent('login')
      .withPeriodType('week')
      .withPeriods(12)
      .withLookbackPeriod('90 days')
      .withName('Weekly Retention')
      .build()

    expect(cohort.cohortEvent).toBe('signup')
    expect(cohort.retentionEvent).toBe('login')
    expect(cohort.periodType).toBe('week')
    expect(cohort.periods).toBe(12)
    expect(cohort.name).toBe('Weekly Retention')
  })

  it('should throw without cohort event', () => {
    const builder = new CohortBuilder().withRetentionEvent('login')

    expect(() => builder.build()).toThrow(CohortValidationError)
    expect(() => builder.build()).toThrow('cohort event')
  })

  it('should throw without retention event', () => {
    const builder = new CohortBuilder().withCohortEvent('signup')

    expect(() => builder.build()).toThrow(CohortValidationError)
    expect(() => builder.build()).toThrow('retention event')
  })

  it('should support cohort filters', () => {
    const cohort = new CohortBuilder()
      .withCohortEvent('signup')
      .withRetentionEvent('login')
      .withCohortFilter({ property: 'plan', operator: 'eq', value: 'pro' })
      .build()

    expect(cohort.cohortFilters).toHaveLength(1)
    expect(cohort.cohortFilters![0].property).toBe('plan')
  })

  it('should support multiple retention events', () => {
    const cohort = new CohortBuilder()
      .withCohortEvent('signup')
      .withRetentionEvents(['login', 'page_view', 'feature_use'])
      .build()

    expect(cohort.retentionEvents).toEqual(['login', 'page_view', 'feature_use'])
  })

  it('should default to day period and 30 periods', () => {
    const cohort = new CohortBuilder().withCohortEvent('signup').withRetentionEvent('login').build()

    expect(cohort.periodType).toBe('day')
    expect(cohort.periods).toBe(30)
  })
})

describe('CohortAnalyzer', () => {
  let analyzer: CohortAnalyzer
  let cohort: CohortConfig

  beforeEach(() => {
    analyzer = new CohortAnalyzer({ dialect: 'postgres' })
    cohort = new CohortBuilder()
      .withCohortEvent('signup')
      .withRetentionEvent('login')
      .withPeriodType('week')
      .withPeriods(8)
      .build()
  })

  describe('SQL Generation', () => {
    it('should generate PostgreSQL cohort query', () => {
      const { sql, params } = analyzer.generateQuery(cohort)

      expect(sql).toContain('cohort_users')
      expect(sql).toContain('retention_events')
      expect(sql).toContain('DATE_TRUNC')
      expect(params).toContain('signup')
      expect(params).toContain('login')
    })

    it('should generate DuckDB cohort query', () => {
      const duckdbAnalyzer = new CohortAnalyzer({ dialect: 'duckdb' })
      const { sql } = duckdbAnalyzer.generateQuery(cohort)

      expect(sql).toContain('DATE_TRUNC')
      expect(sql).toContain('cohort_users')
    })

    it('should generate ClickHouse cohort query', () => {
      const clickhouseAnalyzer = new CohortAnalyzer({ dialect: 'clickhouse' })
      const { sql } = clickhouseAnalyzer.generateQuery(cohort)

      expect(sql).toContain('toStartOfWeek')
      expect(sql).toContain('cohort_users')
    })

    it('should generate SQLite cohort query', () => {
      const sqliteAnalyzer = new CohortAnalyzer({ dialect: 'sqlite' })
      const { sql } = sqliteAnalyzer.generateQuery(cohort)

      expect(sql).toContain('strftime')
      expect(sql).toContain('cohort_users')
    })

    it('should use custom table and column names', () => {
      const customAnalyzer = new CohortAnalyzer({
        dialect: 'postgres',
        eventsTable: 'user_events',
        userIdColumn: 'uid',
        eventTypeColumn: 'action',
        timestampColumn: 'created_at',
      })
      const { sql } = customAnalyzer.generateQuery(cohort)

      expect(sql).toContain('FROM user_events')
      expect(sql).toContain('uid')
      expect(sql).toContain('action')
    })
  })

  describe('Result Processing', () => {
    it('should process raw query results into CohortResult', () => {
      const rawResults = [
        { cohort_date: '2024-01-01', period: 0, users: 100, retained: 100 },
        { cohort_date: '2024-01-01', period: 1, users: 100, retained: 80 },
        { cohort_date: '2024-01-01', period: 2, users: 100, retained: 65 },
        { cohort_date: '2024-01-08', period: 0, users: 120, retained: 120 },
        { cohort_date: '2024-01-08', period: 1, users: 120, retained: 90 },
      ]

      const result = analyzer.processResults(rawResults, cohort)

      expect(result.cohorts).toHaveLength(2)
      expect(result.cohorts[0].cohortDate).toBe('2024-01-01')
      expect(result.cohorts[0].initialUsers).toBe(100)
      expect(result.cohorts[0].retention).toHaveLength(3)
    })

    it('should calculate retention rates correctly', () => {
      const rawResults = [
        { cohort_date: '2024-01-01', period: 0, users: 100, retained: 100 },
        { cohort_date: '2024-01-01', period: 1, users: 100, retained: 80 },
        { cohort_date: '2024-01-01', period: 2, users: 100, retained: 60 },
      ]

      const result = analyzer.processResults(rawResults, cohort)

      expect(result.cohorts[0].retention[0].rate).toBe(1) // 100%
      expect(result.cohorts[0].retention[1].rate).toBe(0.8) // 80%
      expect(result.cohorts[0].retention[2].rate).toBe(0.6) // 60%
    })

    it('should calculate average retention across cohorts', () => {
      const rawResults = [
        { cohort_date: '2024-01-01', period: 0, users: 100, retained: 100 },
        { cohort_date: '2024-01-01', period: 1, users: 100, retained: 80 },
        { cohort_date: '2024-01-08', period: 0, users: 100, retained: 100 },
        { cohort_date: '2024-01-08', period: 1, users: 100, retained: 70 },
      ]

      const result = analyzer.processResults(rawResults, cohort)

      expect(result.averageRetention).toBeDefined()
      expect(result.averageRetention[0]).toBe(1) // Period 0: always 100%
      expect(result.averageRetention[1]).toBe(0.75) // Period 1: (0.8 + 0.7) / 2
    })

    it('should handle empty results gracefully', () => {
      const result = analyzer.processResults([], cohort)

      expect(result.cohorts).toHaveLength(0)
      expect(result.averageRetention).toEqual([])
    })

    it('should include analysis metadata', () => {
      const namedCohort = new CohortBuilder()
        .withCohortEvent('signup')
        .withRetentionEvent('login')
        .withName('Test Cohort')
        .build()

      const result = analyzer.processResults([], namedCohort)

      expect(result.name).toBe('Test Cohort')
      expect(result.analyzedAt).toBeInstanceOf(Date)
      expect(result.periodType).toBe('day')
    })
  })

  describe('Retention Curve Generation', () => {
    it('should generate retention curve from results', () => {
      const rawResults = [
        { cohort_date: '2024-01-01', period: 0, users: 100, retained: 100 },
        { cohort_date: '2024-01-01', period: 1, users: 100, retained: 80 },
        { cohort_date: '2024-01-01', period: 2, users: 100, retained: 65 },
        { cohort_date: '2024-01-01', period: 3, users: 100, retained: 55 },
        { cohort_date: '2024-01-01', period: 4, users: 100, retained: 50 },
      ]

      const result = analyzer.processResults(rawResults, cohort)
      const curve = result.cohorts[0].retention.map((r) => r.rate)

      expect(curve).toEqual([1, 0.8, 0.65, 0.55, 0.5])
    })

    it('should calculate churn rate from retention', () => {
      const rawResults = [
        { cohort_date: '2024-01-01', period: 0, users: 100, retained: 100 },
        { cohort_date: '2024-01-01', period: 1, users: 100, retained: 80 },
      ]

      const result = analyzer.processResults(rawResults, cohort)

      // Churn from period 0 to 1: (100 - 80) / 100 = 20%
      expect(result.cohorts[0].retention[1].churn).toBe(0.2)
    })
  })
})

describe('Integration: Funnel + Cohort Combined Analysis', () => {
  it('should support funnel-based cohort definition', () => {
    // Define a cohort based on funnel completion
    const funnel = new FunnelBuilder()
      .addStep('signup', 'User signed up')
      .addStep('onboarding_complete', 'Completed onboarding')
      .build()

    // Users who completed onboarding form a cohort
    const cohort = new CohortBuilder()
      .withCohortEvent('onboarding_complete')
      .withRetentionEvent('feature_use')
      .withPeriodType('week')
      .withPeriods(8)
      .build()

    expect(funnel.steps[1].eventType).toBe('onboarding_complete')
    expect(cohort.cohortEvent).toBe('onboarding_complete')
  })
})
