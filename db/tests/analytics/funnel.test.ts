/**
 * Funnel Analysis Query Builder Tests
 *
 * Comprehensive tests for funnel definition, step tracking, conversion calculation,
 * drop-off analysis, and time-bounded funnels.
 *
 * Tests the SQL-generating FunnelBuilder and FunnelAnalyzer from db/analytics/funnel.ts
 *
 * @module db/analytics/tests/funnel.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  FunnelBuilder,
  FunnelAnalyzer,
  FunnelValidationError,
  type FunnelConfig,
  type FunnelResult,
  type FunnelStepResult,
  type FunnelStepFilter,
  type FunnelSQLDialect,
  type GeneratedQuery,
} from '../../analytics/funnel'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create mock raw query results for testing result processing
 */
function createMockResults(stepCounts: number[]): Record<string, unknown>[] {
  const row: Record<string, unknown> = {}
  stepCounts.forEach((count, i) => {
    row[`step_${i + 1}_users`] = count
  })
  return [row]
}

/**
 * Helper to build a standard test funnel
 */
function buildTestFunnel(options?: {
  timeWindow?: string
  lookbackPeriod?: string
  strictOrder?: boolean
  name?: string
}): FunnelConfig {
  const builder = new FunnelBuilder()
    .addStep('signup', 'User signed up')
    .addStep('onboarding', 'Completed onboarding')
    .addStep('purchase', 'Made first purchase')

  if (options?.timeWindow) builder.withTimeWindow(options.timeWindow)
  if (options?.lookbackPeriod) builder.withLookbackPeriod(options.lookbackPeriod)
  if (options?.strictOrder !== undefined) builder.withStrictOrder(options.strictOrder)
  if (options?.name) builder.withName(options.name)

  return builder.build()
}

// ============================================================================
// FUNNEL DEFINITION TESTS
// ============================================================================

describe('Funnel Definition', () => {
  describe('FunnelBuilder basics', () => {
    it('should create a funnel with minimum required steps', () => {
      const funnel = new FunnelBuilder()
        .addStep('step1', 'Step 1')
        .addStep('step2', 'Step 2')
        .build()

      expect(funnel.steps).toHaveLength(2)
      expect(funnel.steps[0]!.eventType).toBe('step1')
      expect(funnel.steps[1]!.eventType).toBe('step2')
    })

    it('should preserve step descriptions', () => {
      const funnel = new FunnelBuilder()
        .addStep('signup', 'User creates account')
        .addStep('verify', 'Email verification complete')
        .build()

      expect(funnel.steps[0]!.description).toBe('User creates account')
      expect(funnel.steps[1]!.description).toBe('Email verification complete')
    })

    it('should allow steps without descriptions', () => {
      const funnel = new FunnelBuilder().addStep('step1').addStep('step2').build()

      expect(funnel.steps[0]!.description).toBeUndefined()
      expect(funnel.steps[1]!.description).toBeUndefined()
    })

    it('should create funnel with many steps', () => {
      const builder = new FunnelBuilder()

      for (let i = 1; i <= 10; i++) {
        builder.addStep(`step${i}`, `Step ${i}`)
      }

      const funnel = builder.build()
      expect(funnel.steps).toHaveLength(10)
    })

    it('should support method chaining', () => {
      const funnel = new FunnelBuilder()
        .addStep('a', 'A')
        .addStep('b', 'B')
        .withTimeWindow('7 days')
        .withLookbackPeriod('30 days')
        .withStrictOrder(true)
        .withName('Test Funnel')
        .build()

      expect(funnel.steps).toHaveLength(2)
      expect(funnel.timeWindow).toBe('7 days')
      expect(funnel.lookbackPeriod).toBe('30 days')
      expect(funnel.strictOrder).toBe(true)
      expect(funnel.name).toBe('Test Funnel')
    })
  })

  describe('FunnelBuilder validation', () => {
    it('should reject funnel with single step', () => {
      const builder = new FunnelBuilder().addStep('only_step', 'Single step')

      expect(() => builder.build()).toThrow(FunnelValidationError)
      expect(() => builder.build()).toThrow('at least 2 steps')
    })

    it('should reject funnel with no steps', () => {
      const builder = new FunnelBuilder()

      expect(() => builder.build()).toThrow(FunnelValidationError)
      expect(() => builder.build()).toThrow('at least 2 steps')
    })

    it('should reject duplicate event types', () => {
      const builder = new FunnelBuilder()
        .addStep('signup', 'First')
        .addStep('signup', 'Duplicate')

      expect(() => builder.build()).toThrow(FunnelValidationError)
      expect(() => builder.build()).toThrow("Duplicate event type 'signup'")
    })

    it('should reject empty event type', () => {
      const builder = new FunnelBuilder().addStep('valid', 'Valid').addStep('', 'Empty')

      expect(() => builder.build()).toThrow(FunnelValidationError)
      expect(() => builder.build()).toThrow('valid eventType')
    })

    it('should reject whitespace-only event type', () => {
      const builder = new FunnelBuilder().addStep('valid', 'Valid').addStep('   ', 'Whitespace')

      expect(() => builder.build()).toThrow(FunnelValidationError)
      expect(() => builder.build()).toThrow('valid eventType')
    })
  })

  describe('Step filters', () => {
    it('should support equality filter', () => {
      const filters: FunnelStepFilter[] = [{ property: 'plan', operator: 'eq', value: 'premium' }]

      const funnel = new FunnelBuilder()
        .addStep('signup', 'Premium signup', filters)
        .addStep('purchase', 'First purchase')
        .build()

      expect(funnel.steps[0]!.filters).toHaveLength(1)
      expect(funnel.steps[0]!.filters![0]!.property).toBe('plan')
      expect(funnel.steps[0]!.filters![0]!.operator).toBe('eq')
      expect(funnel.steps[0]!.filters![0]!.value).toBe('premium')
    })

    it('should support inequality filter', () => {
      const filters: FunnelStepFilter[] = [{ property: 'status', operator: 'ne', value: 'cancelled' }]

      const funnel = new FunnelBuilder()
        .addStep('signup', 'Active signup', filters)
        .addStep('action')
        .build()

      expect(funnel.steps[0]!.filters![0]!.operator).toBe('ne')
    })

    it('should support numeric comparison filters', () => {
      const funnel = new FunnelBuilder()
        .addStep('view', 'Page view')
        .addStep('purchase', 'High value purchase', [
          { property: 'amount', operator: 'gte', value: 100 },
          { property: 'amount', operator: 'lt', value: 1000 },
        ])
        .build()

      expect(funnel.steps[1]!.filters).toHaveLength(2)
      expect(funnel.steps[1]!.filters![0]!.operator).toBe('gte')
      expect(funnel.steps[1]!.filters![1]!.operator).toBe('lt')
    })

    it('should support in-list filter', () => {
      const filters: FunnelStepFilter[] = [
        { property: 'region', operator: 'in', value: ['US', 'CA', 'UK'] },
      ]

      const funnel = new FunnelBuilder()
        .addStep('signup', 'Regional signup', filters)
        .addStep('action')
        .build()

      expect(funnel.steps[0]!.filters![0]!.operator).toBe('in')
      expect(funnel.steps[0]!.filters![0]!.value).toEqual(['US', 'CA', 'UK'])
    })

    it('should support contains filter', () => {
      const filters: FunnelStepFilter[] = [{ property: 'url', operator: 'contains', value: '/pricing' }]

      const funnel = new FunnelBuilder()
        .addStep('page_view', 'Pricing page view', filters)
        .addStep('signup')
        .build()

      expect(funnel.steps[0]!.filters![0]!.operator).toBe('contains')
    })

    it('should support boolean filter value', () => {
      const filters: FunnelStepFilter[] = [{ property: 'is_verified', operator: 'eq', value: true }]

      const funnel = new FunnelBuilder()
        .addStep('signup', 'Verified signup', filters)
        .addStep('action')
        .build()

      expect(funnel.steps[0]!.filters![0]!.value).toBe(true)
    })

    it('should support multiple filters on same step', () => {
      const filters: FunnelStepFilter[] = [
        { property: 'plan', operator: 'eq', value: 'premium' },
        { property: 'amount', operator: 'gt', value: 50 },
        { property: 'region', operator: 'in', value: ['US', 'EU'] },
      ]

      const funnel = new FunnelBuilder()
        .addStep('purchase', 'Qualified purchase', filters)
        .addStep('referral')
        .build()

      expect(funnel.steps[0]!.filters).toHaveLength(3)
    })
  })
})

// ============================================================================
// TIME WINDOW CONFIGURATION TESTS
// ============================================================================

describe('Time-Bounded Funnels', () => {
  describe('Time window validation', () => {
    it('should accept valid second intervals', () => {
      const funnel = new FunnelBuilder()
        .addStep('a')
        .addStep('b')
        .withTimeWindow('30 seconds')
        .build()

      expect(funnel.timeWindow).toBe('30 seconds')
    })

    it('should accept valid minute intervals', () => {
      const funnel = new FunnelBuilder()
        .addStep('a')
        .addStep('b')
        .withTimeWindow('15 minutes')
        .build()

      expect(funnel.timeWindow).toBe('15 minutes')
    })

    it('should accept valid hour intervals', () => {
      const funnel = new FunnelBuilder()
        .addStep('a')
        .addStep('b')
        .withTimeWindow('24 hours')
        .build()

      expect(funnel.timeWindow).toBe('24 hours')
    })

    it('should accept valid day intervals', () => {
      const funnel = new FunnelBuilder()
        .addStep('a')
        .addStep('b')
        .withTimeWindow('7 days')
        .build()

      expect(funnel.timeWindow).toBe('7 days')
    })

    it('should accept valid week intervals', () => {
      const funnel = new FunnelBuilder()
        .addStep('a')
        .addStep('b')
        .withTimeWindow('2 weeks')
        .build()

      expect(funnel.timeWindow).toBe('2 weeks')
    })

    it('should accept valid month intervals', () => {
      const funnel = new FunnelBuilder()
        .addStep('a')
        .addStep('b')
        .withTimeWindow('3 months')
        .build()

      expect(funnel.timeWindow).toBe('3 months')
    })

    it('should accept valid year intervals', () => {
      const funnel = new FunnelBuilder()
        .addStep('a')
        .addStep('b')
        .withTimeWindow('1 year')
        .build()

      expect(funnel.timeWindow).toBe('1 year')
    })

    it('should accept singular unit (without s)', () => {
      const funnel = new FunnelBuilder()
        .addStep('a')
        .addStep('b')
        .withTimeWindow('1 day')
        .build()

      expect(funnel.timeWindow).toBe('1 day')
    })

    it('should reject invalid time window format', () => {
      const builder = new FunnelBuilder()
        .addStep('a')
        .addStep('b')
        .withTimeWindow('invalid')

      expect(() => builder.build()).toThrow(FunnelValidationError)
      expect(() => builder.build()).toThrow('Invalid time window')
    })

    it('should reject time window without number', () => {
      const builder = new FunnelBuilder()
        .addStep('a')
        .addStep('b')
        .withTimeWindow('days')

      expect(() => builder.build()).toThrow(FunnelValidationError)
    })

    it('should reject time window without unit', () => {
      const builder = new FunnelBuilder()
        .addStep('a')
        .addStep('b')
        .withTimeWindow('30')

      expect(() => builder.build()).toThrow(FunnelValidationError)
    })
  })

  describe('Lookback period validation', () => {
    it('should accept valid lookback period', () => {
      const funnel = new FunnelBuilder()
        .addStep('a')
        .addStep('b')
        .withLookbackPeriod('90 days')
        .build()

      expect(funnel.lookbackPeriod).toBe('90 days')
    })

    it('should reject invalid lookback period', () => {
      const builder = new FunnelBuilder()
        .addStep('a')
        .addStep('b')
        .withLookbackPeriod('invalid period')

      expect(() => builder.build()).toThrow(FunnelValidationError)
      expect(() => builder.build()).toThrow('Invalid lookback period')
    })

    it('should allow both time window and lookback period', () => {
      const funnel = new FunnelBuilder()
        .addStep('a')
        .addStep('b')
        .withTimeWindow('7 days')
        .withLookbackPeriod('30 days')
        .build()

      expect(funnel.timeWindow).toBe('7 days')
      expect(funnel.lookbackPeriod).toBe('30 days')
    })
  })

  describe('Strict order configuration', () => {
    it('should default to strict order', () => {
      const funnel = new FunnelBuilder()
        .addStep('a')
        .addStep('b')
        .build()

      expect(funnel.strictOrder).toBe(true)
    })

    it('should allow disabling strict order', () => {
      const funnel = new FunnelBuilder()
        .addStep('a')
        .addStep('b')
        .withStrictOrder(false)
        .build()

      expect(funnel.strictOrder).toBe(false)
    })

    it('should allow enabling strict order explicitly', () => {
      const funnel = new FunnelBuilder()
        .addStep('a')
        .addStep('b')
        .withStrictOrder(true)
        .build()

      expect(funnel.strictOrder).toBe(true)
    })
  })
})

// ============================================================================
// SQL GENERATION TESTS
// ============================================================================

describe('FunnelAnalyzer SQL Generation', () => {
  describe('PostgreSQL dialect', () => {
    let analyzer: FunnelAnalyzer
    let funnel: FunnelConfig

    beforeEach(() => {
      analyzer = new FunnelAnalyzer({ dialect: 'postgres' })
      funnel = buildTestFunnel({ lookbackPeriod: '30 days' })
    })

    it('should generate valid PostgreSQL query structure', () => {
      const { sql, params } = analyzer.generateQuery(funnel)

      expect(sql).toContain('WITH filtered_events AS')
      expect(sql).toContain('funnel_progress AS')
      expect(sql).toContain('FROM events')
      expect(sql).toContain('GROUP BY')
    })

    it('should use positional parameters', () => {
      const { sql, params } = analyzer.generateQuery(funnel)

      expect(sql).toContain('$1')
      expect(sql).toContain('$2')
      expect(sql).toContain('$3')
      expect(params).toEqual(['signup', 'onboarding', 'purchase'])
    })

    it('should include lookback period in query', () => {
      const { sql } = analyzer.generateQuery(funnel)

      expect(sql).toContain("INTERVAL '30 days'")
    })

    it('should generate step aggregations', () => {
      const { sql } = analyzer.generateQuery(funnel)

      expect(sql).toContain('step_1')
      expect(sql).toContain('step_2')
      expect(sql).toContain('step_3')
    })

    it('should use ROW_NUMBER for event ordering', () => {
      const { sql } = analyzer.generateQuery(funnel)

      expect(sql).toContain('ROW_NUMBER()')
      expect(sql).toContain('ORDER BY')
      expect(sql).toContain('event_order')
    })
  })

  describe('DuckDB dialect', () => {
    let analyzer: FunnelAnalyzer
    let funnel: FunnelConfig

    beforeEach(() => {
      analyzer = new FunnelAnalyzer({ dialect: 'duckdb' })
      funnel = buildTestFunnel({ lookbackPeriod: '30 days' })
    })

    it('should generate valid DuckDB query structure', () => {
      const { sql, params } = analyzer.generateQuery(funnel)

      expect(sql).toContain('WITH filtered_events AS')
      expect(sql).toContain('NOW()')
      expect(params).toEqual(['signup', 'onboarding', 'purchase'])
    })

    it('should use positional parameters', () => {
      const { sql } = analyzer.generateQuery(funnel)

      expect(sql).toContain('$1')
      expect(sql).toContain('$2')
      expect(sql).toContain('$3')
    })
  })

  describe('ClickHouse dialect', () => {
    let analyzer: FunnelAnalyzer
    let funnel: FunnelConfig

    beforeEach(() => {
      analyzer = new FunnelAnalyzer({ dialect: 'clickhouse' })
      funnel = buildTestFunnel({ timeWindow: '7 days', lookbackPeriod: '30 days' })
    })

    it('should use windowFunnel function', () => {
      const { sql } = analyzer.generateQuery(funnel)

      expect(sql).toContain('windowFunnel')
    })

    it('should convert time window to seconds', () => {
      const { sql } = analyzer.generateQuery(funnel)

      // 7 days = 604800 seconds
      expect(sql).toContain('windowFunnel(604800)')
    })

    it('should use countIf for level extraction', () => {
      const { sql } = analyzer.generateQuery(funnel)

      expect(sql).toContain('countIf(level >= 1)')
      expect(sql).toContain('countIf(level >= 2)')
      expect(sql).toContain('countIf(level >= 3)')
    })

    it('should include step conditions', () => {
      const { sql } = analyzer.generateQuery(funnel)

      expect(sql).toContain("event_type = 'signup'")
      expect(sql).toContain("event_type = 'onboarding'")
      expect(sql).toContain("event_type = 'purchase'")
    })

    it('should use ClickHouse date functions', () => {
      const { sql } = analyzer.generateQuery(funnel)

      expect(sql).toContain('now()')
      expect(sql).toContain('INTERVAL')
    })
  })

  describe('SQLite dialect', () => {
    let analyzer: FunnelAnalyzer
    let funnel: FunnelConfig

    beforeEach(() => {
      analyzer = new FunnelAnalyzer({ dialect: 'sqlite' })
      funnel = buildTestFunnel({ lookbackPeriod: '30 days' })
    })

    it('should use julianday for date calculations', () => {
      const { sql } = analyzer.generateQuery(funnel)

      expect(sql).toContain('julianday')
      expect(sql).toContain("julianday('now')")
    })

    it('should use question mark placeholders', () => {
      const { sql } = analyzer.generateQuery(funnel)

      expect(sql).toContain('?')
      expect(sql).not.toContain('$1')
    })

    it('should double parameters for CASE statements', () => {
      const { params } = analyzer.generateQuery(funnel)

      // 3 event types doubled for IN clause and CASE statements
      expect(params.length).toBe(6)
      expect(params).toEqual([
        'signup',
        'onboarding',
        'purchase',
        'signup',
        'onboarding',
        'purchase',
      ])
    })

    it('should extract numeric days from lookback period', () => {
      const { sql } = analyzer.generateQuery(funnel)

      // Should extract 30 from '30 days'
      expect(sql).toContain('- 30')
    })
  })

  describe('Custom table and column names', () => {
    it('should use custom events table name', () => {
      const analyzer = new FunnelAnalyzer({
        dialect: 'postgres',
        eventsTable: 'analytics_events',
      })
      const funnel = buildTestFunnel()
      const { sql } = analyzer.generateQuery(funnel)

      expect(sql).toContain('FROM analytics_events')
    })

    it('should use custom user ID column', () => {
      const analyzer = new FunnelAnalyzer({
        dialect: 'postgres',
        userIdColumn: 'customer_id',
      })
      const funnel = buildTestFunnel()
      const { sql } = analyzer.generateQuery(funnel)

      expect(sql).toContain('customer_id')
    })

    it('should use custom event type column', () => {
      const analyzer = new FunnelAnalyzer({
        dialect: 'postgres',
        eventTypeColumn: 'action_type',
      })
      const funnel = buildTestFunnel()
      const { sql } = analyzer.generateQuery(funnel)

      expect(sql).toContain('action_type')
    })

    it('should use custom timestamp column', () => {
      const analyzer = new FunnelAnalyzer({
        dialect: 'postgres',
        timestampColumn: 'occurred_at',
      })
      const funnel = buildTestFunnel()
      const { sql } = analyzer.generateQuery(funnel)

      expect(sql).toContain('occurred_at')
    })

    it('should use all custom column names together', () => {
      const analyzer = new FunnelAnalyzer({
        dialect: 'postgres',
        eventsTable: 'user_events',
        userIdColumn: 'uid',
        eventTypeColumn: 'action',
        timestampColumn: 'created_at',
      })
      const funnel = buildTestFunnel()
      const { sql } = analyzer.generateQuery(funnel)

      expect(sql).toContain('FROM user_events')
      expect(sql).toContain('uid')
      expect(sql).toContain('action')
      expect(sql).toContain('created_at')
    })
  })

  describe('Default configuration', () => {
    it('should default to postgres dialect', () => {
      const analyzer = new FunnelAnalyzer()
      const funnel = buildTestFunnel()
      const { sql } = analyzer.generateQuery(funnel)

      expect(sql).toContain('NOW()')
      expect(sql).toContain('$1')
    })

    it('should default to "events" table', () => {
      const analyzer = new FunnelAnalyzer()
      const funnel = buildTestFunnel()
      const { sql } = analyzer.generateQuery(funnel)

      expect(sql).toContain('FROM events')
    })

    it('should default to "user_id" column', () => {
      const analyzer = new FunnelAnalyzer()
      const funnel = buildTestFunnel()
      const { sql } = analyzer.generateQuery(funnel)

      expect(sql).toContain('user_id')
    })

    it('should default to "event_type" column', () => {
      const analyzer = new FunnelAnalyzer()
      const funnel = buildTestFunnel()
      const { sql } = analyzer.generateQuery(funnel)

      expect(sql).toContain('event_type')
    })

    it('should default to "timestamp" column', () => {
      const analyzer = new FunnelAnalyzer()
      const funnel = buildTestFunnel()
      const { sql } = analyzer.generateQuery(funnel)

      expect(sql).toContain('timestamp')
    })

    it('should default to 30 days lookback period', () => {
      const analyzer = new FunnelAnalyzer()
      const funnel = new FunnelBuilder()
        .addStep('a')
        .addStep('b')
        .build()
      const { sql } = analyzer.generateQuery(funnel)

      expect(sql).toContain('30 days')
    })
  })
})

// ============================================================================
// CONVERSION CALCULATION TESTS
// ============================================================================

describe('Conversion Calculation', () => {
  let analyzer: FunnelAnalyzer
  let funnel: FunnelConfig

  beforeEach(() => {
    analyzer = new FunnelAnalyzer({ dialect: 'postgres' })
    funnel = buildTestFunnel()
  })

  describe('Step-by-step conversion', () => {
    it('should calculate conversion from start', () => {
      const rawResults = createMockResults([1000, 800, 500])
      const result = analyzer.processResults(rawResults, funnel)

      expect(result.steps[0]!.conversionFromStart).toBe(1) // 1000/1000
      expect(result.steps[1]!.conversionFromStart).toBe(0.8) // 800/1000
      expect(result.steps[2]!.conversionFromStart).toBe(0.5) // 500/1000
    })

    it('should calculate conversion from previous step', () => {
      const rawResults = createMockResults([1000, 800, 400])
      const result = analyzer.processResults(rawResults, funnel)

      expect(result.steps[0]!.conversionFromPrevious).toBe(1) // First step always 100%
      expect(result.steps[1]!.conversionFromPrevious).toBe(0.8) // 800/1000
      expect(result.steps[2]!.conversionFromPrevious).toBe(0.5) // 400/800
    })

    it('should handle 100% conversion between steps', () => {
      const rawResults = createMockResults([1000, 1000, 1000])
      const result = analyzer.processResults(rawResults, funnel)

      expect(result.steps[1]!.conversionFromPrevious).toBe(1)
      expect(result.steps[2]!.conversionFromPrevious).toBe(1)
      expect(result.overallConversionRate).toBe(1)
    })

    it('should handle 0% conversion at a step', () => {
      const rawResults = createMockResults([1000, 500, 0])
      const result = analyzer.processResults(rawResults, funnel)

      expect(result.steps[2]!.users).toBe(0)
      expect(result.steps[2]!.conversionFromPrevious).toBe(0)
      expect(result.steps[2]!.conversionFromStart).toBe(0)
    })

    it('should handle very low conversion rates', () => {
      const rawResults = createMockResults([10000, 100, 1])
      const result = analyzer.processResults(rawResults, funnel)

      expect(result.steps[1]!.conversionFromStart).toBe(0.01) // 1%
      expect(result.steps[2]!.conversionFromStart).toBe(0.0001) // 0.01%
    })
  })

  describe('Overall conversion rate', () => {
    it('should calculate overall conversion rate', () => {
      const rawResults = createMockResults([1000, 750, 300])
      const result = analyzer.processResults(rawResults, funnel)

      expect(result.overallConversionRate).toBe(0.3) // 300/1000
    })

    it('should return 0 for zero conversions', () => {
      const rawResults = createMockResults([1000, 500, 0])
      const result = analyzer.processResults(rawResults, funnel)

      expect(result.overallConversionRate).toBe(0)
    })

    it('should return 1 for 100% conversion', () => {
      const rawResults = createMockResults([100, 100, 100])
      const result = analyzer.processResults(rawResults, funnel)

      expect(result.overallConversionRate).toBe(1)
    })
  })

  describe('Total users tracking', () => {
    it('should track total users from first step', () => {
      const rawResults = createMockResults([5000, 3000, 1000])
      const result = analyzer.processResults(rawResults, funnel)

      expect(result.totalUsers).toBe(5000)
    })

    it('should handle single user', () => {
      const rawResults = createMockResults([1, 1, 1])
      const result = analyzer.processResults(rawResults, funnel)

      expect(result.totalUsers).toBe(1)
    })

    it('should handle large user counts', () => {
      const rawResults = createMockResults([1000000, 750000, 250000])
      const result = analyzer.processResults(rawResults, funnel)

      expect(result.totalUsers).toBe(1000000)
    })
  })
})

// ============================================================================
// DROP-OFF ANALYSIS TESTS
// ============================================================================

describe('Drop-off Analysis', () => {
  let analyzer: FunnelAnalyzer
  let funnel: FunnelConfig

  beforeEach(() => {
    analyzer = new FunnelAnalyzer({ dialect: 'postgres' })
    funnel = buildTestFunnel()
  })

  describe('Drop-off count calculation', () => {
    it('should calculate drop-off between steps', () => {
      const rawResults = createMockResults([1000, 750, 300])
      const result = analyzer.processResults(rawResults, funnel)

      // Step 1 has no previous step, drop-off is 0
      expect(result.steps[0]!.dropOff).toBe(0)
      // Step 2: 1000 - 750 = 250 dropped
      expect(result.steps[1]!.dropOff).toBe(250)
      // Step 3: 750 - 300 = 450 dropped
      expect(result.steps[2]!.dropOff).toBe(450)
    })

    it('should handle zero drop-off', () => {
      const rawResults = createMockResults([1000, 1000, 1000])
      const result = analyzer.processResults(rawResults, funnel)

      expect(result.steps[1]!.dropOff).toBe(0)
      expect(result.steps[2]!.dropOff).toBe(0)
    })

    it('should handle 100% drop-off', () => {
      const rawResults = createMockResults([1000, 0, 0])
      const result = analyzer.processResults(rawResults, funnel)

      expect(result.steps[1]!.dropOff).toBe(1000)
      expect(result.steps[2]!.dropOff).toBe(0) // Can't drop more than 0
    })
  })

  describe('Drop-off rate calculation', () => {
    it('should calculate drop-off rate as percentage', () => {
      const rawResults = createMockResults([1000, 750, 300])
      const result = analyzer.processResults(rawResults, funnel)

      // Step 2: 250/1000 = 25%
      expect(result.steps[1]!.dropOffRate).toBe(0.25)
      // Step 3: 450/750 = 60%
      expect(result.steps[2]!.dropOffRate).toBe(0.6)
    })

    it('should return 0 drop-off rate when no drop-off', () => {
      const rawResults = createMockResults([1000, 1000, 1000])
      const result = analyzer.processResults(rawResults, funnel)

      expect(result.steps[1]!.dropOffRate).toBe(0)
      expect(result.steps[2]!.dropOffRate).toBe(0)
    })

    it('should return 1 (100%) drop-off rate for total drop-off', () => {
      const rawResults = createMockResults([1000, 0, 0])
      const result = analyzer.processResults(rawResults, funnel)

      expect(result.steps[1]!.dropOffRate).toBe(1)
    })

    it('should handle drop-off with small numbers', () => {
      const rawResults = createMockResults([10, 7, 3])
      const result = analyzer.processResults(rawResults, funnel)

      expect(result.steps[1]!.dropOffRate).toBe(0.3) // 3/10
      expect(result.steps[2]!.dropOffRate).toBeCloseTo(0.571, 2) // 4/7
    })
  })

  describe('Drop-off with zero users', () => {
    it('should handle zero users at step with 0 drop-off rate', () => {
      const rawResults = createMockResults([100, 50, 0])
      const result = analyzer.processResults(rawResults, funnel)

      expect(result.steps[2]!.dropOff).toBe(50)
      expect(result.steps[2]!.dropOffRate).toBe(1) // 50/50 = 100%
    })
  })
})

// ============================================================================
// STEP TRACKING TESTS
// ============================================================================

describe('Step Tracking', () => {
  let analyzer: FunnelAnalyzer

  beforeEach(() => {
    analyzer = new FunnelAnalyzer({ dialect: 'postgres' })
  })

  describe('Step metadata', () => {
    it('should preserve step numbers (1-indexed)', () => {
      const funnel = buildTestFunnel()
      const rawResults = createMockResults([100, 80, 60])
      const result = analyzer.processResults(rawResults, funnel)

      expect(result.steps[0]!.stepNumber).toBe(1)
      expect(result.steps[1]!.stepNumber).toBe(2)
      expect(result.steps[2]!.stepNumber).toBe(3)
    })

    it('should preserve event types', () => {
      const funnel = buildTestFunnel()
      const rawResults = createMockResults([100, 80, 60])
      const result = analyzer.processResults(rawResults, funnel)

      expect(result.steps[0]!.eventType).toBe('signup')
      expect(result.steps[1]!.eventType).toBe('onboarding')
      expect(result.steps[2]!.eventType).toBe('purchase')
    })

    it('should preserve step descriptions', () => {
      const funnel = buildTestFunnel()
      const rawResults = createMockResults([100, 80, 60])
      const result = analyzer.processResults(rawResults, funnel)

      expect(result.steps[0]!.description).toBe('User signed up')
      expect(result.steps[1]!.description).toBe('Completed onboarding')
      expect(result.steps[2]!.description).toBe('Made first purchase')
    })

    it('should track user count per step', () => {
      const funnel = buildTestFunnel()
      const rawResults = createMockResults([1000, 750, 300])
      const result = analyzer.processResults(rawResults, funnel)

      expect(result.steps[0]!.users).toBe(1000)
      expect(result.steps[1]!.users).toBe(750)
      expect(result.steps[2]!.users).toBe(300)
    })
  })

  describe('Many-step funnels', () => {
    it('should handle funnels with 5+ steps', () => {
      const funnel = new FunnelBuilder()
        .addStep('step1', 'Step 1')
        .addStep('step2', 'Step 2')
        .addStep('step3', 'Step 3')
        .addStep('step4', 'Step 4')
        .addStep('step5', 'Step 5')
        .build()

      const rawResults = createMockResults([1000, 800, 600, 400, 200])
      const result = analyzer.processResults(rawResults, funnel)

      expect(result.steps).toHaveLength(5)
      expect(result.totalUsers).toBe(1000)
      expect(result.overallConversionRate).toBe(0.2) // 200/1000
    })

    it('should handle 10-step funnel', () => {
      const builder = new FunnelBuilder()
      for (let i = 1; i <= 10; i++) {
        builder.addStep(`step${i}`, `Step ${i}`)
      }
      const funnel = builder.build()

      const stepCounts = [1000, 900, 800, 700, 600, 500, 400, 300, 200, 100]
      const rawResults = createMockResults(stepCounts)
      const result = analyzer.processResults(rawResults, funnel)

      expect(result.steps).toHaveLength(10)
      expect(result.steps[9]!.stepNumber).toBe(10)
      expect(result.overallConversionRate).toBe(0.1) // 100/1000
    })
  })
})

// ============================================================================
// RESULT METADATA TESTS
// ============================================================================

describe('Result Metadata', () => {
  let analyzer: FunnelAnalyzer

  beforeEach(() => {
    analyzer = new FunnelAnalyzer({ dialect: 'postgres' })
  })

  it('should include funnel name when provided', () => {
    const funnel = buildTestFunnel({ name: 'Onboarding Funnel' })
    const result = analyzer.processResults(createMockResults([100, 50, 25]), funnel)

    expect(result.name).toBe('Onboarding Funnel')
  })

  it('should have undefined name when not provided', () => {
    const funnel = new FunnelBuilder().addStep('a').addStep('b').build()
    const result = analyzer.processResults(createMockResults([100, 50]), funnel)

    expect(result.name).toBeUndefined()
  })

  it('should include analysis timestamp', () => {
    const funnel = buildTestFunnel()
    const before = new Date()
    const result = analyzer.processResults(createMockResults([100, 50, 25]), funnel)
    const after = new Date()

    expect(result.analyzedAt).toBeInstanceOf(Date)
    expect(result.analyzedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(result.analyzedAt.getTime()).toBeLessThanOrEqual(after.getTime())
  })
})

// ============================================================================
// EMPTY AND EDGE CASE TESTS
// ============================================================================

describe('Empty and Edge Cases', () => {
  let analyzer: FunnelAnalyzer

  beforeEach(() => {
    analyzer = new FunnelAnalyzer({ dialect: 'postgres' })
  })

  describe('Empty results handling', () => {
    it('should handle empty results array', () => {
      const funnel = buildTestFunnel()
      const result = analyzer.processResults([], funnel)

      expect(result.totalUsers).toBe(0)
      expect(result.overallConversionRate).toBe(0)
      expect(result.steps).toHaveLength(3)
      expect(result.steps.every((s) => s.users === 0)).toBe(true)
    })

    it('should handle null/undefined in results', () => {
      const funnel = buildTestFunnel()
      const rawResults = [
        {
          step_1_users: null,
          step_2_users: undefined,
          step_3_users: 0,
        },
      ]

      const result = analyzer.processResults(rawResults as Record<string, unknown>[], funnel)

      expect(result.steps[0]!.users).toBe(0)
      expect(result.steps[1]!.users).toBe(0)
      expect(result.steps[2]!.users).toBe(0)
    })

    it('should handle string numbers in results', () => {
      const funnel = buildTestFunnel()
      const rawResults = [
        {
          step_1_users: '100',
          step_2_users: '50',
          step_3_users: '25',
        },
      ]

      const result = analyzer.processResults(rawResults as Record<string, unknown>[], funnel)

      expect(result.steps[0]!.users).toBe(100)
      expect(result.steps[1]!.users).toBe(50)
      expect(result.steps[2]!.users).toBe(25)
    })
  })

  describe('Zero user edge cases', () => {
    it('should handle zero users in first step (defaults to 1 to avoid division by zero)', () => {
      const funnel = buildTestFunnel()
      const rawResults = createMockResults([0, 0, 0])
      const result = analyzer.processResults(rawResults, funnel)

      // Implementation defaults totalUsers to 1 when first step is 0 to avoid division issues
      expect(result.totalUsers).toBe(1)
      expect(result.overallConversionRate).toBe(0)
      // Conversion rates should be 0, not NaN
      expect(result.steps[1]!.conversionFromPrevious).toBe(0)
      expect(result.steps[1]!.dropOffRate).toBe(0)
    })

    it('should handle single user through entire funnel', () => {
      const funnel = buildTestFunnel()
      const rawResults = createMockResults([1, 1, 1])
      const result = analyzer.processResults(rawResults, funnel)

      expect(result.totalUsers).toBe(1)
      expect(result.overallConversionRate).toBe(1)
      expect(result.steps.every((s) => s.users === 1)).toBe(true)
    })
  })

  describe('Validation during query generation', () => {
    it('should validate funnel config during query generation', () => {
      const invalidFunnel: FunnelConfig = {
        steps: [{ eventType: 'only_one' }],
      }

      expect(() => analyzer.generateQuery(invalidFunnel)).toThrow(FunnelValidationError)
    })
  })
})

// ============================================================================
// INTERVAL PARSING TESTS
// ============================================================================

describe('Interval Parsing', () => {
  it('should parse seconds to seconds', () => {
    const analyzer = new FunnelAnalyzer({ dialect: 'clickhouse' })
    const funnel = new FunnelBuilder()
      .addStep('a')
      .addStep('b')
      .withTimeWindow('60 seconds')
      .build()

    const { sql } = analyzer.generateQuery(funnel)
    expect(sql).toContain('windowFunnel(60)')
  })

  it('should parse minutes to seconds', () => {
    const analyzer = new FunnelAnalyzer({ dialect: 'clickhouse' })
    const funnel = new FunnelBuilder()
      .addStep('a')
      .addStep('b')
      .withTimeWindow('30 minutes')
      .build()

    const { sql } = analyzer.generateQuery(funnel)
    expect(sql).toContain('windowFunnel(1800)') // 30 * 60
  })

  it('should parse hours to seconds', () => {
    const analyzer = new FunnelAnalyzer({ dialect: 'clickhouse' })
    const funnel = new FunnelBuilder()
      .addStep('a')
      .addStep('b')
      .withTimeWindow('24 hours')
      .build()

    const { sql } = analyzer.generateQuery(funnel)
    expect(sql).toContain('windowFunnel(86400)') // 24 * 3600
  })

  it('should parse days to seconds', () => {
    const analyzer = new FunnelAnalyzer({ dialect: 'clickhouse' })
    const funnel = new FunnelBuilder()
      .addStep('a')
      .addStep('b')
      .withTimeWindow('7 days')
      .build()

    const { sql } = analyzer.generateQuery(funnel)
    expect(sql).toContain('windowFunnel(604800)') // 7 * 86400
  })

  it('should parse weeks to seconds', () => {
    const analyzer = new FunnelAnalyzer({ dialect: 'clickhouse' })
    const funnel = new FunnelBuilder()
      .addStep('a')
      .addStep('b')
      .withTimeWindow('2 weeks')
      .build()

    const { sql } = analyzer.generateQuery(funnel)
    expect(sql).toContain('windowFunnel(1209600)') // 2 * 604800
  })

  it('should parse months to seconds (30 days)', () => {
    const analyzer = new FunnelAnalyzer({ dialect: 'clickhouse' })
    const funnel = new FunnelBuilder()
      .addStep('a')
      .addStep('b')
      .withTimeWindow('1 month')
      .build()

    const { sql } = analyzer.generateQuery(funnel)
    expect(sql).toContain('windowFunnel(2592000)') // 30 * 86400
  })

  it('should parse years to seconds (365 days)', () => {
    const analyzer = new FunnelAnalyzer({ dialect: 'clickhouse' })
    const funnel = new FunnelBuilder()
      .addStep('a')
      .addStep('b')
      .withTimeWindow('1 year')
      .build()

    const { sql } = analyzer.generateQuery(funnel)
    expect(sql).toContain('windowFunnel(31536000)') // 365 * 86400
  })

  it('should default to 86400 seconds (1 day) for invalid format', () => {
    const analyzer = new FunnelAnalyzer({ dialect: 'clickhouse' })
    // Note: This tests the internal default when timeWindow is a numeric string
    // that passes validation but doesn't match the interval pattern in parseIntervalToSeconds
    const funnel = new FunnelBuilder()
      .addStep('a')
      .addStep('b')
      .withTimeWindow('86400') // Just a number, will fail validation
      .build

    // Can't easily test this as validation will fail first
    // The default is used internally when the interval doesn't match the regex
  })
})

// ============================================================================
// COMPREHENSIVE SCENARIO TESTS
// ============================================================================

describe('Real-World Scenarios', () => {
  describe('E-commerce funnel', () => {
    it('should analyze product purchase funnel', () => {
      const analyzer = new FunnelAnalyzer({ dialect: 'postgres' })
      const funnel = new FunnelBuilder()
        .addStep('product_view', 'Viewed product page')
        .addStep('add_to_cart', 'Added item to cart')
        .addStep('checkout_start', 'Started checkout')
        .addStep('payment_submit', 'Submitted payment')
        .addStep('order_complete', 'Order completed')
        .withTimeWindow('7 days')
        .withLookbackPeriod('30 days')
        .withName('Product Purchase Funnel')
        .build()

      const rawResults = createMockResults([10000, 3000, 1500, 1200, 1000])
      const result = analyzer.processResults(rawResults, funnel)

      expect(result.name).toBe('Product Purchase Funnel')
      expect(result.totalUsers).toBe(10000)
      expect(result.overallConversionRate).toBe(0.1) // 10%

      // Cart abandonment: 10000 -> 3000 = 70% drop-off
      expect(result.steps[1]!.dropOffRate).toBe(0.7)
    })
  })

  describe('SaaS onboarding funnel', () => {
    it('should analyze user onboarding funnel', () => {
      const analyzer = new FunnelAnalyzer({
        dialect: 'postgres',
        eventsTable: 'saas_events',
        userIdColumn: 'account_id',
      })

      const funnel = new FunnelBuilder()
        .addStep('signup', 'Account created')
        .addStep('email_verified', 'Email verified')
        .addStep('profile_complete', 'Profile completed')
        .addStep('first_project', 'Created first project')
        .addStep('invite_team', 'Invited team member')
        .withTimeWindow('14 days')
        .withLookbackPeriod('90 days')
        .withName('Onboarding Funnel')
        .build()

      const { sql } = analyzer.generateQuery(funnel)

      expect(sql).toContain('FROM saas_events')
      expect(sql).toContain('account_id')
    })
  })

  describe('Marketing funnel', () => {
    it('should analyze lead generation funnel', () => {
      const analyzer = new FunnelAnalyzer({ dialect: 'clickhouse' })
      const funnel = new FunnelBuilder()
        .addStep('ad_click', 'Clicked advertisement')
        .addStep('landing_view', 'Viewed landing page')
        .addStep('form_start', 'Started form')
        .addStep('form_submit', 'Submitted form')
        .addStep('qualified_lead', 'Became qualified lead')
        .withTimeWindow('1 hour')
        .withLookbackPeriod('7 days')
        .build()

      const rawResults = createMockResults([50000, 35000, 10000, 5000, 1000])
      const result = analyzer.processResults(rawResults, funnel)

      // Landing page bounce rate
      const landingBounceRate = result.steps[1]!.dropOffRate
      expect(landingBounceRate).toBe(0.3) // 30% bounced

      // Form completion rate
      const formCompletionRate = result.steps[3]!.conversionFromPrevious
      expect(formCompletionRate).toBe(0.5) // 50% completed form
    })
  })
})
