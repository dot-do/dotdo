/**
 * Threshold-based alerting tests - Warn/fail thresholds for data contracts
 *
 * Tests for threshold-based alerting with:
 * - Per-expectation thresholds (warn/fail)
 * - Suite-level default thresholds
 * - Alert routing to channels
 * - Threshold escalation
 * - Rate calculation for partial datasets
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  // Threshold types
  type Threshold,
  type ThresholdResult,
  type ThresholdLevel,
  type ThresholdReport,
  // Alert channel types
  type AlertChannel,
  type AlertChannelType,
  type AlertHandler,
  type AlertPayload,
  type AlertConfig,
  // Suite types
  type ThresholdSuite,
  type ThresholdSuiteOptions,
  // Escalation types
  type EscalationRule,
  type EscalationChain,
  type EscalationTrigger,
  // Builder and factories
  ThresholdExpectationBuilder,
  createThresholdSuite,
  createAlertRouter,
  // Entry point
  expectWithThreshold,
} from '../threshold-alerting'

// ============================================================================
// BASIC THRESHOLD EXPECTATIONS
// ============================================================================

describe('Threshold Alerting', () => {
  describe('expectWithThreshold() entry point', () => {
    it('should create a threshold expectation builder', () => {
      const builder = expectWithThreshold('orders', 'total')

      expect(builder).toBeInstanceOf(ThresholdExpectationBuilder)
      expect(builder.table).toBe('orders')
      expect(builder.column).toBe('total')
    })

    it('should support table-only expectations', () => {
      const builder = expectWithThreshold('orders')

      expect(builder.table).toBe('orders')
      expect(builder.column).toBeUndefined()
    })
  })

  // ============================================================================
  // THRESHOLD CONFIGURATION
  // ============================================================================

  describe('withThreshold()', () => {
    it('should configure warn and fail thresholds', () => {
      const expectation = expectWithThreshold('orders', 'total')
        .toBePositive()
        .withThreshold({ warn: 0.01, fail: 0.05 })
        .build()

      expect(expectation.threshold).toEqual({ warn: 0.01, fail: 0.05 })
    })

    it('should accept warn-only threshold', () => {
      const expectation = expectWithThreshold('orders', 'total')
        .toBePositive()
        .withThreshold({ warn: 0.01 })
        .build()

      expect(expectation.threshold).toEqual({ warn: 0.01 })
    })

    it('should accept fail-only threshold', () => {
      const expectation = expectWithThreshold('orders', 'total')
        .toBePositive()
        .withThreshold({ fail: 0.05 })
        .build()

      expect(expectation.threshold).toEqual({ fail: 0.05 })
    })

    it('should throw if warn >= fail', () => {
      expect(() => {
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.05, fail: 0.01 })
          .build()
      }).toThrow(/warn.*fail/)
    })
  })

  // ============================================================================
  // CONSTRAINT METHODS
  // ============================================================================

  describe('constraint methods', () => {
    it('toBePositive() should validate positive values', () => {
      const expectation = expectWithThreshold('orders', 'total')
        .toBePositive()
        .withThreshold({ warn: 0.01, fail: 0.05 })
        .build()

      expect(expectation.constraint.type).toBe('positive')
    })

    it('toBeNotNull() should validate non-null values', () => {
      const expectation = expectWithThreshold('orders', 'customer_id')
        .toBeNotNull()
        .withThreshold({ warn: 0.001, fail: 0.01 })
        .build()

      expect(expectation.constraint.type).toBe('not_null')
    })

    it('toBeUnique() should validate unique values', () => {
      const expectation = expectWithThreshold('orders', 'order_id')
        .toBeUnique()
        .withThreshold({ fail: 0.0001 })
        .build()

      expect(expectation.constraint.type).toBe('unique')
    })

    it('toMatch() should validate pattern matching', () => {
      const expectation = expectWithThreshold('orders', 'email')
        .toMatch(/^.+@.+\..+$/)
        .withThreshold({ warn: 0.01, fail: 0.05 })
        .build()

      expect(expectation.constraint.type).toBe('pattern')
      expect(expectation.constraint.params?.pattern).toEqual(/^.+@.+\..+$/)
    })

    it('toBeBetween() should validate range', () => {
      const expectation = expectWithThreshold('orders', 'total')
        .toBeBetween(0, 10000)
        .withThreshold({ warn: 0.01, fail: 0.05 })
        .build()

      expect(expectation.constraint.type).toBe('between')
      expect(expectation.constraint.params).toEqual({ min: 0, max: 10000 })
    })

    it('toBeIn() should validate set membership', () => {
      const expectation = expectWithThreshold('orders', 'status')
        .toBeIn(['pending', 'completed', 'cancelled'])
        .withThreshold({ warn: 0.01, fail: 0.05 })
        .build()

      expect(expectation.constraint.type).toBe('in_set')
      expect(expectation.constraint.params?.values).toEqual(['pending', 'completed', 'cancelled'])
    })
  })

  // ============================================================================
  // THRESHOLD VALIDATION
  // ============================================================================

  describe('threshold validation', () => {
    it('should pass when failure rate is below warn threshold', async () => {
      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.1, fail: 0.2 })
          .build()
      )

      // 5% failure rate (5 out of 100)
      const data = [
        ...Array(95).fill({ total: 100 }),
        ...Array(5).fill({ total: -10 }),
      ]

      const result = await suite.validate(data)

      expect(result.level).toBe('pass')
      expect(result.failureRate).toBeCloseTo(0.05, 2)
    })

    it('should warn when failure rate exceeds warn but below fail', async () => {
      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.01, fail: 0.1 })
          .build()
      )

      // 5% failure rate (5 out of 100)
      const data = [
        ...Array(95).fill({ total: 100 }),
        ...Array(5).fill({ total: -10 }),
      ]

      const result = await suite.validate(data)

      expect(result.level).toBe('warn')
      expect(result.failureRate).toBeCloseTo(0.05, 2)
    })

    it('should fail when failure rate exceeds fail threshold', async () => {
      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.01, fail: 0.05 })
          .build()
      )

      // 10% failure rate (10 out of 100)
      const data = [
        ...Array(90).fill({ total: 100 }),
        ...Array(10).fill({ total: -10 }),
      ]

      const result = await suite.validate(data)

      expect(result.level).toBe('fail')
      expect(result.failureRate).toBeCloseTo(0.10, 2)
    })

    it('should handle zero failures correctly', async () => {
      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.01, fail: 0.05 })
          .build()
      )

      const data = Array(100).fill({ total: 100 })
      const result = await suite.validate(data)

      expect(result.level).toBe('pass')
      expect(result.failureRate).toBe(0)
    })

    it('should handle 100% failure correctly', async () => {
      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.01, fail: 0.05 })
          .build()
      )

      const data = Array(100).fill({ total: -10 })
      const result = await suite.validate(data)

      expect(result.level).toBe('fail')
      expect(result.failureRate).toBe(1)
    })
  })

  // ============================================================================
  // SUITE-LEVEL DEFAULT THRESHOLDS
  // ============================================================================

  describe('suite default thresholds', () => {
    it('should apply default thresholds when expectation has none', async () => {
      const suite = createThresholdSuite({
        defaultThreshold: { warn: 0.01, fail: 0.1 },
      })

      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .build() // No threshold specified
      )

      // 5% failure rate - should warn with default threshold
      const data = [
        ...Array(95).fill({ total: 100 }),
        ...Array(5).fill({ total: -10 }),
      ]

      const result = await suite.validate(data)

      expect(result.level).toBe('warn')
    })

    it('should allow expectation to override default threshold', async () => {
      const suite = createThresholdSuite({
        defaultThreshold: { warn: 0.01, fail: 0.1 },
      })

      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.1, fail: 0.2 }) // Override
          .build()
      )

      // 5% failure rate - should pass with custom threshold
      const data = [
        ...Array(95).fill({ total: 100 }),
        ...Array(5).fill({ total: -10 }),
      ]

      const result = await suite.validate(data)

      expect(result.level).toBe('pass')
    })

    it('should use strictest threshold when combining', async () => {
      const suite = createThresholdSuite({
        defaultThreshold: { warn: 0.05, fail: 0.15 },
        combineMode: 'strict',
      })

      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.1, fail: 0.2 })
          .build()
      )

      // 6% failure rate - should warn because default warn is 0.05
      const data = [
        ...Array(94).fill({ total: 100 }),
        ...Array(6).fill({ total: -10 }),
      ]

      const result = await suite.validate(data)

      expect(result.level).toBe('warn')
    })
  })

  // ============================================================================
  // ALERT HANDLERS
  // ============================================================================

  describe('alert handlers', () => {
    it('onWarn() should be called when threshold is warn', async () => {
      const warnHandler = vi.fn()

      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.01, fail: 0.1 })
          .onWarn(warnHandler)
          .build()
      )

      // 5% failure rate
      const data = [
        ...Array(95).fill({ total: 100 }),
        ...Array(5).fill({ total: -10 }),
      ]

      await suite.validate(data)

      expect(warnHandler).toHaveBeenCalledTimes(1)
      expect(warnHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warn',
          failureRate: expect.any(Number),
          failedCount: 5,
          totalCount: 100,
        })
      )
    })

    it('onFail() should be called when threshold is fail', async () => {
      const failHandler = vi.fn()

      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.01, fail: 0.05 })
          .onFail(failHandler)
          .build()
      )

      // 10% failure rate
      const data = [
        ...Array(90).fill({ total: 100 }),
        ...Array(10).fill({ total: -10 }),
      ]

      await suite.validate(data)

      expect(failHandler).toHaveBeenCalledTimes(1)
    })

    it('onWarn() should NOT be called when level is pass', async () => {
      const warnHandler = vi.fn()

      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.1, fail: 0.2 })
          .onWarn(warnHandler)
          .build()
      )

      // 1% failure rate
      const data = [
        ...Array(99).fill({ total: 100 }),
        ...Array(1).fill({ total: -10 }),
      ]

      await suite.validate(data)

      expect(warnHandler).not.toHaveBeenCalled()
    })

    it('onFail() should NOT be called when level is warn', async () => {
      const failHandler = vi.fn()

      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.01, fail: 0.2 })
          .onFail(failHandler)
          .build()
      )

      // 5% failure rate
      const data = [
        ...Array(95).fill({ total: 100 }),
        ...Array(5).fill({ total: -10 }),
      ]

      await suite.validate(data)

      expect(failHandler).not.toHaveBeenCalled()
    })

    it('should support async handlers', async () => {
      const asyncHandler = vi.fn().mockResolvedValue(undefined)

      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.01, fail: 0.05 })
          .onFail(asyncHandler)
          .build()
      )

      const data = Array(100).fill({ total: -10 })
      await suite.validate(data)

      expect(asyncHandler).toHaveBeenCalledTimes(1)
    })
  })

  // ============================================================================
  // ALERT ROUTING TO CHANNELS
  // ============================================================================

  describe('alert routing', () => {
    it('should route alerts to configured channels', async () => {
      const slackHandler = vi.fn()
      const emailHandler = vi.fn()

      const router = createAlertRouter()
      router.registerChannel('slack', slackHandler)
      router.registerChannel('email', emailHandler)

      const suite = createThresholdSuite({ alertRouter: router })
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.01, fail: 0.05 })
          .alertTo(['slack', 'email'])
          .build()
      )

      const data = Array(100).fill({ total: -10 })
      await suite.validate(data)

      expect(slackHandler).toHaveBeenCalledTimes(1)
      expect(emailHandler).toHaveBeenCalledTimes(1)
    })

    it('should route warn alerts to warn channels only', async () => {
      const warnChannel = vi.fn()
      const failChannel = vi.fn()

      const router = createAlertRouter()
      router.registerChannel('warn-slack', warnChannel)
      router.registerChannel('fail-pagerduty', failChannel)

      const suite = createThresholdSuite({ alertRouter: router })
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.01, fail: 0.1 })
          .alertOnWarn(['warn-slack'])
          .alertOnFail(['fail-pagerduty'])
          .build()
      )

      // 5% failure rate - warn level
      const data = [
        ...Array(95).fill({ total: 100 }),
        ...Array(5).fill({ total: -10 }),
      ]
      await suite.validate(data)

      expect(warnChannel).toHaveBeenCalledTimes(1)
      expect(failChannel).not.toHaveBeenCalled()
    })

    it('should support alert payload customization', async () => {
      const slackHandler = vi.fn()
      const router = createAlertRouter()
      router.registerChannel('slack', slackHandler)

      const suite = createThresholdSuite({ alertRouter: router })
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.01, fail: 0.05 })
          .alertTo(['slack'])
          .withAlertPayload({
            severity: 'high',
            team: 'data-engineering',
            runbook: 'https://wiki/runbooks/data-quality',
          })
          .build()
      )

      const data = Array(100).fill({ total: -10 })
      await suite.validate(data)

      expect(slackHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'high',
          team: 'data-engineering',
          runbook: 'https://wiki/runbooks/data-quality',
        })
      )
    })
  })

  // ============================================================================
  // THRESHOLD ESCALATION
  // ============================================================================

  describe('threshold escalation', () => {
    it('should escalate after repeated warnings', async () => {
      const warnHandler = vi.fn()
      const escalateHandler = vi.fn()

      const suite = createThresholdSuite({
        escalation: {
          afterWarnings: 3,
          escalateTo: escalateHandler,
        },
      })

      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.01, fail: 0.5 })
          .onWarn(warnHandler)
          .build()
      )

      // 5% failure rate - warn level
      const data = [
        ...Array(95).fill({ total: 100 }),
        ...Array(5).fill({ total: -10 }),
      ]

      // Run validation 4 times
      for (let i = 0; i < 4; i++) {
        await suite.validate(data)
      }

      expect(warnHandler).toHaveBeenCalledTimes(4)
      expect(escalateHandler).toHaveBeenCalledTimes(1)
    })

    it('should escalate based on time window', async () => {
      vi.useFakeTimers()
      const escalateHandler = vi.fn()

      const suite = createThresholdSuite({
        escalation: {
          afterWarningsInWindow: {
            count: 2,
            windowMs: 60 * 60 * 1000, // 1 hour
          },
          escalateTo: escalateHandler,
        },
      })

      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.01, fail: 0.5 })
          .build()
      )

      const data = [
        ...Array(95).fill({ total: 100 }),
        ...Array(5).fill({ total: -10 }),
      ]

      // First warning
      await suite.validate(data)
      expect(escalateHandler).not.toHaveBeenCalled()

      // Second warning within window
      await suite.validate(data)
      expect(escalateHandler).toHaveBeenCalledTimes(1)

      vi.useRealTimers()
    })

    it('should reset escalation counter on pass', async () => {
      const escalateHandler = vi.fn()

      const suite = createThresholdSuite({
        escalation: {
          afterWarnings: 3,
          escalateTo: escalateHandler,
          resetOnPass: true,
        },
      })

      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.01, fail: 0.5 })
          .build()
      )

      const warnData = [
        ...Array(95).fill({ total: 100 }),
        ...Array(5).fill({ total: -10 }),
      ]
      const passData = Array(100).fill({ total: 100 })

      // 2 warnings, then pass, then 2 more warnings
      await suite.validate(warnData)
      await suite.validate(warnData)
      await suite.validate(passData) // Reset
      await suite.validate(warnData)
      await suite.validate(warnData)

      expect(escalateHandler).not.toHaveBeenCalled()
    })

    it('should support escalation chain', async () => {
      const level1Handler = vi.fn()
      const level2Handler = vi.fn()
      const level3Handler = vi.fn()

      const suite = createThresholdSuite({
        escalationChain: [
          { afterWarnings: 2, handler: level1Handler },
          { afterWarnings: 4, handler: level2Handler },
          { afterWarnings: 6, handler: level3Handler },
        ],
      })

      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.01, fail: 0.5 })
          .build()
      )

      const data = [
        ...Array(95).fill({ total: 100 }),
        ...Array(5).fill({ total: -10 }),
      ]

      // Run 7 times
      for (let i = 0; i < 7; i++) {
        await suite.validate(data)
      }

      expect(level1Handler).toHaveBeenCalledTimes(1) // After 2nd
      expect(level2Handler).toHaveBeenCalledTimes(1) // After 4th
      expect(level3Handler).toHaveBeenCalledTimes(1) // After 6th
    })
  })

  // ============================================================================
  // THRESHOLD REPORT
  // ============================================================================

  describe('threshold report', () => {
    it('should include detailed failure information', async () => {
      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.01, fail: 0.05 })
          .build()
      )

      const data = [
        { total: 100, id: 1 },
        { total: -10, id: 2 },
        { total: 200, id: 3 },
        { total: -5, id: 4 },
      ]

      const result = await suite.validate(data)

      expect(result.report).toBeDefined()
      expect(result.report.failures).toHaveLength(2)
      expect(result.report.failures[0]).toMatchObject({
        rowIndex: 1,
        actualValue: -10,
        constraint: 'positive',
      })
    })

    it('should include threshold summary', async () => {
      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.01, fail: 0.05 })
          .build()
      )

      const data = [
        ...Array(90).fill({ total: 100 }),
        ...Array(10).fill({ total: -10 }),
      ]

      const result = await suite.validate(data)

      expect(result.report.summary).toMatchObject({
        table: 'orders',
        column: 'total',
        constraint: 'positive',
        threshold: { warn: 0.01, fail: 0.05 },
        failureRate: 0.1,
        failedCount: 10,
        totalCount: 100,
        level: 'fail',
      })
    })

    it('should include timing information', async () => {
      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.01, fail: 0.05 })
          .build()
      )

      const data = Array(100).fill({ total: 100 })
      const result = await suite.validate(data)

      expect(result.timing).toBeDefined()
      expect(result.timing.totalMs).toBeGreaterThanOrEqual(0)
    })
  })

  // ============================================================================
  // MULTIPLE EXPECTATIONS
  // ============================================================================

  describe('multiple expectations', () => {
    it('should validate multiple expectations independently', async () => {
      const suite = createThresholdSuite()

      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.4, fail: 0.5 })
          .build()
      )

      suite.addExpectation(
        expectWithThreshold('orders', 'status')
          .toBeIn(['pending', 'completed'])
          .withThreshold({ warn: 0.4, fail: 0.5 })
          .build()
      )

      const data = [
        { total: 100, status: 'pending' },
        { total: -10, status: 'pending' },    // total fails
        { total: 200, status: 'invalid' },    // status fails
      ]

      const result = await suite.validate(data)

      expect(result.expectationResults).toHaveLength(2)
      expect(result.expectationResults![0].level).toBe('pass') // 1/3 = 33%, below warn of 40%
      expect(result.expectationResults![1].level).toBe('pass') // 1/3 = 33%, below warn of 40%
    })

    it('should determine overall level from worst expectation', async () => {
      const suite = createThresholdSuite()

      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.1, fail: 0.2 })
          .build()
      )

      suite.addExpectation(
        expectWithThreshold('orders', 'status')
          .toBeIn(['pending', 'completed'])
          .withThreshold({ warn: 0.01, fail: 0.05 })
          .build()
      )

      // 10% total failures (warn), 50% status failures (fail)
      const data = [
        ...Array(9).fill({ total: 100, status: 'pending' }),
        { total: -10, status: 'invalid' }, // both fail
        ...Array(4).fill({ total: 100, status: 'invalid' }), // status fails
        ...Array(6).fill({ total: 100, status: 'pending' }),
      ]

      const result = await suite.validate(data)

      expect(result.overallLevel).toBe('fail')
    })
  })

  // ============================================================================
  // PARTIAL DATASET HANDLING
  // ============================================================================

  describe('partial dataset handling', () => {
    it('should calculate rate based on non-null values only', async () => {
      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.1, fail: 0.5 })
          .skipNulls()
          .build()
      )

      const data = [
        { total: 100 },
        { total: null },  // Should be skipped
        { total: -10 },   // Fails
        { total: undefined }, // Should be skipped
        { total: 200 },
      ]

      const result = await suite.validate(data)

      // Only 3 valid rows (100, -10, 200), 1 failure = 33%
      expect(result.failureRate).toBeCloseTo(0.333, 2)
      expect(result.totalCount).toBe(3) // Only non-null values
    })

    it('should report skipped count separately', async () => {
      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.1, fail: 0.2 })
          .skipNulls()
          .build()
      )

      const data = [
        { total: 100 },
        { total: null },
        { total: 200 },
      ]

      const result = await suite.validate(data)

      expect(result.report.summary.skippedCount).toBe(1)
      expect(result.report.summary.totalCount).toBe(2)
    })

    it('should optionally treat nulls as failures', async () => {
      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.1, fail: 0.5 })
          .nullsAsFail()
          .build()
      )

      const data = [
        { total: 100 },
        { total: null },  // Counted as failure
        { total: 200 },
      ]

      const result = await suite.validate(data)

      expect(result.failureRate).toBeCloseTo(0.333, 2)
      expect(result.failedCount).toBe(1) // null counted as failure
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('should handle empty dataset', async () => {
      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.01, fail: 0.05 })
          .build()
      )

      const result = await suite.validate([])

      expect(result.level).toBe('pass')
      expect(result.failureRate).toBe(0)
      expect(result.totalCount).toBe(0)
    })

    it('should handle missing column gracefully', async () => {
      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'nonexistent')
          .toBePositive()
          .withThreshold({ warn: 0.01, fail: 0.05 })
          .build()
      )

      const data = [{ total: 100 }, { total: 200 }]

      // By default, missing column values are treated as null
      const result = await suite.validate(data)

      expect(result.totalCount).toBe(2)
    })

    it('should handle very small thresholds', async () => {
      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.0001, fail: 0.001 })
          .build()
      )

      // 1 failure in 10000 = 0.0001 = exactly at warn
      const data = [
        ...Array(9999).fill({ total: 100 }),
        { total: -10 },
      ]

      const result = await suite.validate(data)

      expect(result.level).toBe('warn')
    })

    it('should handle sampling for large datasets', async () => {
      const suite = createThresholdSuite({
        sampling: { enabled: true, sampleSize: 1000, seed: 42 },
      })

      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.01, fail: 0.05 })
          .build()
      )

      // Large dataset
      const data = Array(100000).fill({ total: 100 })
      const result = await suite.validate(data)

      // sampledCount indicates how many rows were sampled
      expect(result.sampledCount).toBe(1000)
      // totalCount reflects the number of rows actually validated (the sample)
      expect(result.totalCount).toBe(1000)
    })
  })

  // ============================================================================
  // INTEGRATION WITH NOTIFICATION ROUTER
  // ============================================================================

  describe('notification router integration', () => {
    it('should send alerts to slack channel', async () => {
      const slackMessages: AlertPayload[] = []
      const mockSlackSend = async (payload: AlertPayload) => {
        slackMessages.push(payload)
      }

      const router = createAlertRouter()
      router.registerChannel('slack', mockSlackSend)

      const suite = createThresholdSuite({ alertRouter: router })
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.01, fail: 0.05 })
          .alertTo(['slack'])
          .build()
      )

      const data = Array(100).fill({ total: -10 })
      await suite.validate(data)

      expect(slackMessages).toHaveLength(1)
      expect(slackMessages[0]).toMatchObject({
        level: 'fail',
        table: 'orders',
        column: 'total',
        constraint: 'positive',
        failureRate: 1,
      })
    })

    it('should format alert messages', async () => {
      const messages: AlertPayload[] = []

      const router = createAlertRouter()
      router.registerChannel('email', async (payload) => {
        messages.push(payload)
      })

      const suite = createThresholdSuite({
        alertRouter: router,
        alertFormat: {
          includeFailedRows: true,
          maxFailedRows: 5,
          includeRunbook: true,
        },
      })

      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withThreshold({ warn: 0.01, fail: 0.05 })
          .alertTo(['email'])
          .withRunbook('https://wiki/data-quality/positive-totals')
          .build()
      )

      const data = [
        ...Array(90).fill({ total: 100 }),
        ...Array(10).fill({ total: -10 }),
      ]
      await suite.validate(data)

      expect(messages[0].failedRows).toHaveLength(5)
      expect(messages[0].runbook).toBe('https://wiki/data-quality/positive-totals')
    })
  })

  // ============================================================================
  // ABSOLUTE THRESHOLDS (COUNT-BASED)
  // ============================================================================

  describe('absolute thresholds', () => {
    it('should warn when failure count exceeds absolute threshold', async () => {
      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withAbsoluteThreshold({ warn: 5, fail: 20 })
          .build()
      )

      // 10 failures - above warn (5), below fail (20)
      const data = [
        ...Array(90).fill({ total: 100 }),
        ...Array(10).fill({ total: -10 }),
      ]

      const result = await suite.validate(data)

      expect(result.level).toBe('warn')
      expect(result.failedCount).toBe(10)
    })

    it('should fail when failure count exceeds absolute fail threshold', async () => {
      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withAbsoluteThreshold({ warn: 5, fail: 15 })
          .build()
      )

      // 20 failures - above fail (15)
      const data = [
        ...Array(80).fill({ total: 100 }),
        ...Array(20).fill({ total: -10 }),
      ]

      const result = await suite.validate(data)

      expect(result.level).toBe('fail')
      expect(result.failedCount).toBe(20)
    })

    it('should pass when failure count is below absolute warn threshold', async () => {
      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .withAbsoluteThreshold({ warn: 10, fail: 20 })
          .build()
      )

      // 5 failures - below warn (10)
      const data = [
        ...Array(95).fill({ total: 100 }),
        ...Array(5).fill({ total: -10 }),
      ]

      const result = await suite.validate(data)

      expect(result.level).toBe('pass')
      expect(result.failedCount).toBe(5)
    })
  })

  // ============================================================================
  // FLUENT WARNIF/FAILIF API
  // ============================================================================

  describe('warnIf/failIf fluent API', () => {
    it('should support warnIf().greaterThan() syntax', async () => {
      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .warnIf().greaterThan(5)
          .failIf().greaterThan(15)
          .build()
      )

      // 10 failures - warn level
      const data = [
        ...Array(90).fill({ total: 100 }),
        ...Array(10).fill({ total: -10 }),
      ]

      const result = await suite.validate(data)

      expect(result.level).toBe('warn')
    })

    it('should chain warnIf and failIf correctly', async () => {
      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .warnIf().greaterThan(100)
          .failIf().greaterThan(1000)
          .build()
      )

      // 500 failures - warn level (>100 but <1000)
      const data = [
        ...Array(500).fill({ total: 100 }),
        ...Array(500).fill({ total: -10 }),
      ]

      const result = await suite.validate(data)

      expect(result.level).toBe('warn')
    })

    it('should support exceedsRate() for percentage thresholds', async () => {
      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'total')
          .toBePositive()
          .warnIf().exceedsRate(0.01)
          .failIf().exceedsRate(0.1)
          .build()
      )

      // 5% failure rate - warn level
      const data = [
        ...Array(95).fill({ total: 100 }),
        ...Array(5).fill({ total: -10 }),
      ]

      const result = await suite.validate(data)

      expect(result.level).toBe('warn')
    })
  })

  // ============================================================================
  // BASELINE DEVIATION
  // ============================================================================

  describe('baseline deviation', () => {
    it('should warn when value deviates from baseline by warn threshold', async () => {
      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'amount')
          .toBePositive()
          .withBaseline({ value: 100, warnDeviation: 0.1, failDeviation: 0.5 })
          .build()
      )

      // Average is 115 - 15% deviation from baseline of 100
      const data = [
        { amount: 115 },
        { amount: 115 },
        { amount: 115 },
      ]

      const result = await suite.validate(data)

      expect(result.level).toBe('warn')
    })

    it('should fail when value deviates from baseline by fail threshold', async () => {
      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'amount')
          .toBePositive()
          .withBaseline({ value: 100, warnDeviation: 0.1, failDeviation: 0.5 })
          .build()
      )

      // Average is 160 - 60% deviation from baseline of 100
      const data = [
        { amount: 160 },
        { amount: 160 },
        { amount: 160 },
      ]

      const result = await suite.validate(data)

      expect(result.level).toBe('fail')
    })

    it('should pass when value is within baseline tolerance', async () => {
      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'amount')
          .toBePositive()
          .withBaseline({ value: 100, warnDeviation: 0.1, failDeviation: 0.5 })
          .build()
      )

      // Average is 105 - 5% deviation from baseline of 100
      const data = [
        { amount: 105 },
        { amount: 105 },
        { amount: 105 },
      ]

      const result = await suite.validate(data)

      expect(result.level).toBe('pass')
    })

    it('should support deviatesFromBaseline() method', async () => {
      const suite = createThresholdSuite()
      suite.addExpectation(
        expectWithThreshold('orders', 'amount')
          .toBePositive()
          .deviatesFromBaseline(100, { warn: 0.1, fail: 0.5 })
          .build()
      )

      // Average is 120 - 20% deviation
      const data = [
        { amount: 120 },
        { amount: 120 },
        { amount: 120 },
      ]

      const result = await suite.validate(data)

      expect(result.level).toBe('warn')
    })
  })

  // ============================================================================
  // ALERT SEVERITY LEVELS
  // ============================================================================

  describe('alert severity levels', () => {
    it('should support custom severity levels', () => {
      const expectation = expectWithThreshold('orders', 'total')
        .toBePositive()
        .withThreshold({ warn: 0.01, fail: 0.05 })
        .withSeverity('critical')
        .build()

      expect(expectation.severity).toBe('critical')
    })

    it('should support info severity', () => {
      const expectation = expectWithThreshold('orders', 'total')
        .toBePositive()
        .withThreshold({ warn: 0.01, fail: 0.05 })
        .withSeverity('info')
        .build()

      expect(expectation.severity).toBe('info')
    })

    it('should support error severity', () => {
      const expectation = expectWithThreshold('orders', 'total')
        .toBePositive()
        .withThreshold({ warn: 0.01, fail: 0.05 })
        .withSeverity('error')
        .build()

      expect(expectation.severity).toBe('error')
    })
  })

  // ============================================================================
  // VALIDATION OF NEW THRESHOLD CONFIGURATIONS
  // ============================================================================

  describe('threshold validation', () => {
    it('should throw if warn deviation >= fail deviation', () => {
      expect(() => {
        expectWithThreshold('orders', 'amount')
          .toBePositive()
          .withBaseline({ value: 100, warnDeviation: 0.5, failDeviation: 0.1 })
          .build()
      }).toThrow(/warn.*deviation.*fail.*deviation/i)
    })

    it('should allow baseline without deviation thresholds', () => {
      const expectation = expectWithThreshold('orders', 'amount')
        .toBePositive()
        .withBaseline({ value: 100 })
        .build()

      expect(expectation.baseline?.value).toBe(100)
    })
  })
})
