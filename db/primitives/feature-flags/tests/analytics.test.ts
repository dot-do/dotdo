/**
 * Flag Analytics Tests
 *
 * Tests for exposure event tracking, evaluation metrics,
 * and usage dashboard data aggregation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  FlagAnalytics,
  createFlagAnalytics,
  createExposureTracker,
  type ExposureEvent,
  type ExposureReason,
  type FlagMetrics,
  type TimeSeriesPoint,
  type FlagDashboardData,
  type FlagAlert,
} from '../analytics'

// ============================================================================
// TEST HELPERS
// ============================================================================

function createTestExposure(
  overrides?: Partial<Omit<ExposureEvent, 'id' | 'timestamp'>>
): Omit<ExposureEvent, 'id' | 'timestamp'> {
  return {
    flagKey: 'test-flag',
    userId: 'user-123',
    variant: 'control',
    value: true,
    reason: 'MATCH',
    evaluationLatencyMs: 5,
    ...overrides,
  }
}

// ============================================================================
// EXPOSURE TRACKING
// ============================================================================

describe('FlagAnalytics', () => {
  let analytics: FlagAnalytics

  beforeEach(() => {
    analytics = createFlagAnalytics({
      flushInterval: 0, // Disable auto-flush for tests
    })
  })

  afterEach(async () => {
    await analytics.close()
  })

  describe('exposure tracking', () => {
    it('should track an exposure event', () => {
      const exposure = analytics.trackExposure(createTestExposure())

      expect(exposure.id).toBeDefined()
      expect(exposure.flagKey).toBe('test-flag')
      expect(exposure.userId).toBe('user-123')
      expect(exposure.variant).toBe('control')
      expect(exposure.timestamp).toBeInstanceOf(Date)
    })

    it('should generate unique IDs for each exposure', () => {
      const e1 = analytics.trackExposure(createTestExposure())
      const e2 = analytics.trackExposure(createTestExposure({ userId: 'user-456' }))

      expect(e1.id).not.toBe(e2.id)
    })

    it('should track exposure with all fields', () => {
      const exposure = analytics.trackExposure({
        flagKey: 'feature-x',
        userId: 'user-789',
        anonymousId: 'anon-123',
        sessionId: 'session-456',
        variant: 'treatment',
        value: { theme: 'dark' },
        bucket: 42,
        reason: 'VARIANT_SELECTED',
        evaluationLatencyMs: 3.5,
        attributes: { plan: 'enterprise' },
        environment: 'prod',
        metadata: { source: 'sdk' },
      })

      expect(exposure.flagKey).toBe('feature-x')
      expect(exposure.anonymousId).toBe('anon-123')
      expect(exposure.sessionId).toBe('session-456')
      expect(exposure.variant).toBe('treatment')
      expect(exposure.value).toEqual({ theme: 'dark' })
      expect(exposure.bucket).toBe(42)
      expect(exposure.reason).toBe('VARIANT_SELECTED')
      expect(exposure.evaluationLatencyMs).toBe(3.5)
      expect(exposure.attributes).toEqual({ plan: 'enterprise' })
      expect(exposure.environment).toBe('prod')
      expect(exposure.metadata).toEqual({ source: 'sdk' })
    })

    it('should add exposures to buffer', () => {
      analytics.trackExposure(createTestExposure())
      analytics.trackExposure(createTestExposure({ userId: 'user-456' }))

      expect(analytics.bufferSize).toBe(2)
    })

    it('should throw when closed', async () => {
      await analytics.close()

      expect(() => analytics.trackExposure(createTestExposure())).toThrow('FlagAnalytics is closed')
    })
  })

  describe('deduplication', () => {
    it('should deduplicate exposures within window', () => {
      const exposure1 = analytics.trackExposure(createTestExposure())
      const exposure2 = analytics.trackExposure(createTestExposure())

      // Both should return valid exposures
      expect(exposure1.id).toBeDefined()
      expect(exposure2.id).toBeDefined()

      // But only first should be in buffer
      expect(analytics.bufferSize).toBe(1)
    })

    it('should not deduplicate different users', () => {
      analytics.trackExposure(createTestExposure({ userId: 'user-1' }))
      analytics.trackExposure(createTestExposure({ userId: 'user-2' }))

      expect(analytics.bufferSize).toBe(2)
    })

    it('should not deduplicate different variants', () => {
      analytics.trackExposure(createTestExposure({ variant: 'control' }))
      analytics.trackExposure(createTestExposure({ variant: 'treatment' }))

      expect(analytics.bufferSize).toBe(2)
    })

    it('should not deduplicate different flags', () => {
      analytics.trackExposure(createTestExposure({ flagKey: 'flag-a' }))
      analytics.trackExposure(createTestExposure({ flagKey: 'flag-b' }))

      expect(analytics.bufferSize).toBe(2)
    })
  })

  describe('sampling', () => {
    it('should sample exposures based on sampleRate', () => {
      const sampledAnalytics = createFlagAnalytics({
        sampleRate: 0.5,
        flushInterval: 0,
      })

      // Track many exposures
      for (let i = 0; i < 100; i++) {
        sampledAnalytics.trackExposure(createTestExposure({ userId: `user-${i}` }))
      }

      // Should have roughly half in buffer (with some variance)
      expect(sampledAnalytics.bufferSize).toBeGreaterThan(20)
      expect(sampledAnalytics.bufferSize).toBeLessThan(80)

      sampledAnalytics.close()
    })

    it('should not sample when sampleRate is 1', () => {
      for (let i = 0; i < 10; i++) {
        analytics.trackExposure(createTestExposure({ userId: `user-${i}` }))
      }

      expect(analytics.bufferSize).toBe(10)
    })
  })

  describe('flushing', () => {
    it('should flush buffer and call onFlush callback', async () => {
      const flushedEvents: ExposureEvent[] = []
      const flushAnalytics = createFlagAnalytics({
        flushInterval: 0,
        onFlush: (events) => {
          flushedEvents.push(...events)
        },
      })

      flushAnalytics.trackExposure(createTestExposure({ userId: 'user-1' }))
      flushAnalytics.trackExposure(createTestExposure({ userId: 'user-2' }))

      const result = await flushAnalytics.flush()

      expect(result.count).toBe(2)
      expect(result.errors).toBe(0)
      expect(flushedEvents).toHaveLength(2)
      expect(flushAnalytics.bufferSize).toBe(0)

      await flushAnalytics.close()
    })

    it('should auto-flush when flushAt is reached', async () => {
      const flushedEvents: ExposureEvent[] = []
      const flushAnalytics = createFlagAnalytics({
        flushAt: 3,
        flushInterval: 0,
        onFlush: (events) => {
          flushedEvents.push(...events)
        },
      })

      flushAnalytics.trackExposure(createTestExposure({ userId: 'user-1' }))
      flushAnalytics.trackExposure(createTestExposure({ userId: 'user-2' }))
      flushAnalytics.trackExposure(createTestExposure({ userId: 'user-3' }))

      // Give async flush time to complete
      await new Promise((r) => setTimeout(r, 10))

      expect(flushedEvents).toHaveLength(3)

      await flushAnalytics.close()
    })

    it('should handle flush errors', async () => {
      const errors: Error[] = []
      const flushAnalytics = createFlagAnalytics({
        flushInterval: 0,
        onFlush: () => {
          throw new Error('Flush failed')
        },
        onError: (err) => {
          errors.push(err)
        },
      })

      flushAnalytics.trackExposure(createTestExposure())
      const result = await flushAnalytics.flush()

      expect(result.errors).toBe(1)
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toBe('Flush failed')

      await flushAnalytics.close()
    })

    it('should respect maxBufferSize', () => {
      const smallBufferAnalytics = createFlagAnalytics({
        maxBufferSize: 3,
        flushInterval: 0,
      })

      for (let i = 0; i < 5; i++) {
        smallBufferAnalytics.trackExposure(createTestExposure({ userId: `user-${i}` }))
      }

      expect(smallBufferAnalytics.bufferSize).toBe(3)

      smallBufferAnalytics.close()
    })
  })

  // ============================================================================
  // METRICS
  // ============================================================================

  describe('metrics', () => {
    it('should track total evaluations', () => {
      analytics.trackExposure(createTestExposure({ userId: 'user-1' }))
      analytics.trackExposure(createTestExposure({ userId: 'user-2' }))
      analytics.trackExposure(createTestExposure({ userId: 'user-3' }))

      const metrics = analytics.getMetrics('test-flag')

      expect(metrics).not.toBeNull()
      expect(metrics!.totalEvaluations).toBe(3)
    })

    it('should track unique users', () => {
      analytics.trackExposure(createTestExposure({ userId: 'user-1' }))
      analytics.trackExposure(createTestExposure({ userId: 'user-2' }))
      analytics.trackExposure(createTestExposure({ userId: 'user-1' })) // Duplicate user

      const metrics = analytics.getMetrics('test-flag')

      expect(metrics!.uniqueUsers).toBe(2)
    })

    it('should track unique sessions', () => {
      analytics.trackExposure(createTestExposure({ userId: 'user-1', sessionId: 'session-a' }))
      analytics.trackExposure(createTestExposure({ userId: 'user-2', sessionId: 'session-b' }))
      analytics.trackExposure(createTestExposure({ userId: 'user-3', sessionId: 'session-a' })) // Duplicate session

      const metrics = analytics.getMetrics('test-flag')

      expect(metrics!.uniqueSessions).toBe(2)
    })

    it('should count variants', () => {
      analytics.trackExposure(createTestExposure({ userId: 'user-1', variant: 'control' }))
      analytics.trackExposure(createTestExposure({ userId: 'user-2', variant: 'control' }))
      analytics.trackExposure(createTestExposure({ userId: 'user-3', variant: 'treatment' }))

      const metrics = analytics.getMetrics('test-flag')

      expect(metrics!.variantCounts).toEqual({
        control: 2,
        treatment: 1,
      })
    })

    it('should count reasons', () => {
      analytics.trackExposure(createTestExposure({ userId: 'user-1', reason: 'MATCH' }))
      analytics.trackExposure(createTestExposure({ userId: 'user-2', reason: 'MATCH' }))
      analytics.trackExposure(createTestExposure({ userId: 'user-3', reason: 'DEFAULT' }))
      analytics.trackExposure(createTestExposure({ userId: 'user-4', reason: 'ERROR' }))

      const metrics = analytics.getMetrics('test-flag')

      expect(metrics!.reasonCounts.MATCH).toBe(2)
      expect(metrics!.reasonCounts.DEFAULT).toBe(1)
      expect(metrics!.reasonCounts.ERROR).toBe(1)
    })

    it('should track latency statistics', () => {
      analytics.trackExposure(createTestExposure({ userId: 'user-1', evaluationLatencyMs: 5 }))
      analytics.trackExposure(createTestExposure({ userId: 'user-2', evaluationLatencyMs: 10 }))
      analytics.trackExposure(createTestExposure({ userId: 'user-3', evaluationLatencyMs: 15 }))

      const metrics = analytics.getMetrics('test-flag')

      expect(metrics!.latency.min).toBe(5)
      expect(metrics!.latency.max).toBe(15)
      expect(metrics!.latency.avg).toBe(10)
      expect(metrics!.latency.sampleCount).toBe(3)
    })

    it('should track latency percentiles', () => {
      // Add 100 exposures with varying latencies
      for (let i = 1; i <= 100; i++) {
        analytics.trackExposure(
          createTestExposure({
            userId: `user-${i}`,
            evaluationLatencyMs: i,
          })
        )
      }

      const metrics = analytics.getMetrics('test-flag')

      expect(metrics!.latency.p50).toBe(50)
      expect(metrics!.latency.p90).toBe(90)
      expect(metrics!.latency.p95).toBe(95)
      expect(metrics!.latency.p99).toBe(99)
    })

    it('should count errors', () => {
      analytics.trackExposure(createTestExposure({ userId: 'user-1', reason: 'MATCH' }))
      analytics.trackExposure(createTestExposure({ userId: 'user-2', reason: 'ERROR' }))
      analytics.trackExposure(createTestExposure({ userId: 'user-3', reason: 'ERROR' }))

      const metrics = analytics.getMetrics('test-flag')

      expect(metrics!.errorCount).toBe(2)
    })

    it('should track metrics by environment', () => {
      analytics.trackExposure(createTestExposure({ userId: 'user-1', environment: 'prod' }))
      analytics.trackExposure(createTestExposure({ userId: 'user-2', environment: 'prod' }))
      analytics.trackExposure(createTestExposure({ userId: 'user-3', environment: 'staging' }))

      const metrics = analytics.getMetrics('test-flag')

      expect(metrics!.byEnvironment).toBeDefined()
      expect(metrics!.byEnvironment!.prod.totalEvaluations).toBe(2)
      expect(metrics!.byEnvironment!.staging.totalEvaluations).toBe(1)
    })

    it('should track first and last evaluation timestamps', () => {
      analytics.trackExposure(createTestExposure({ userId: 'user-1' }))
      analytics.trackExposure(createTestExposure({ userId: 'user-2' }))

      const metrics = analytics.getMetrics('test-flag')

      expect(metrics!.firstEvaluation).toBeDefined()
      expect(metrics!.lastEvaluation).toBeDefined()
      expect(metrics!.firstEvaluation).toBeInstanceOf(Date)
      expect(metrics!.lastEvaluation).toBeInstanceOf(Date)
      expect(metrics!.lastEvaluation.getTime()).toBeGreaterThanOrEqual(metrics!.firstEvaluation.getTime())
    })

    it('should return null for unknown flags', () => {
      const metrics = analytics.getMetrics('unknown-flag')

      expect(metrics).toBeNull()
    })

    it('should get all metrics', () => {
      analytics.trackExposure(createTestExposure({ userId: 'user-1', flagKey: 'flag-a' }))
      analytics.trackExposure(createTestExposure({ userId: 'user-2', flagKey: 'flag-b' }))
      analytics.trackExposure(createTestExposure({ userId: 'user-3', flagKey: 'flag-a' }))

      const allMetrics = analytics.getAllMetrics()

      expect(allMetrics).toHaveLength(2)
      expect(allMetrics.map((m) => m.flagKey).sort()).toEqual(['flag-a', 'flag-b'])
    })
  })

  // ============================================================================
  // TIME SERIES
  // ============================================================================

  describe('time series', () => {
    it('should return time series data points', () => {
      analytics.trackExposure(createTestExposure({ userId: 'user-1' }))
      analytics.trackExposure(createTestExposure({ userId: 'user-2' }))

      const series = analytics.getTimeSeries('test-flag', 1)

      expect(series).toHaveLength(1)
      expect(series[0].evaluations).toBe(2)
      expect(series[0].uniqueUsers).toBe(2)
    })

    it('should track average latency in time series', () => {
      analytics.trackExposure(createTestExposure({ userId: 'user-1', evaluationLatencyMs: 10 }))
      analytics.trackExposure(createTestExposure({ userId: 'user-2', evaluationLatencyMs: 20 }))

      const series = analytics.getTimeSeries('test-flag', 1)

      expect(series[0].avgLatency).toBe(15)
    })

    it('should track errors in time series', () => {
      analytics.trackExposure(createTestExposure({ userId: 'user-1', reason: 'MATCH' }))
      analytics.trackExposure(createTestExposure({ userId: 'user-2', reason: 'ERROR' }))

      const series = analytics.getTimeSeries('test-flag', 1)

      expect(series[0].errors).toBe(1)
    })

    it('should track variants in time series', () => {
      analytics.trackExposure(createTestExposure({ userId: 'user-1', variant: 'control' }))
      analytics.trackExposure(createTestExposure({ userId: 'user-2', variant: 'treatment' }))

      const series = analytics.getTimeSeries('test-flag', 1)

      expect(series[0].byVariant).toEqual({
        control: 1,
        treatment: 1,
      })
    })

    it('should return zeros for hours with no data', () => {
      const series = analytics.getTimeSeries('test-flag', 24)

      expect(series).toHaveLength(24)
      series.forEach((point) => {
        expect(point.evaluations).toBe(0)
        expect(point.uniqueUsers).toBe(0)
      })
    })
  })

  // ============================================================================
  // DASHBOARD DATA
  // ============================================================================

  describe('dashboard data', () => {
    it('should return dashboard data for a flag', () => {
      analytics.trackExposure(createTestExposure({ userId: 'user-1', variant: 'control' }))
      analytics.trackExposure(createTestExposure({ userId: 'user-2', variant: 'treatment' }))

      const dashboard = analytics.getDashboardData('test-flag')

      expect(dashboard).not.toBeNull()
      expect(dashboard!.flagKey).toBe('test-flag')
      expect(dashboard!.summary.totalEvaluations).toBe(2)
      expect(dashboard!.timeSeries).toHaveLength(24)
      expect(dashboard!.topVariants).toHaveLength(2)
    })

    it('should calculate variant percentages', () => {
      for (let i = 0; i < 70; i++) {
        analytics.trackExposure(createTestExposure({ userId: `user-${i}`, variant: 'control' }))
      }
      for (let i = 70; i < 100; i++) {
        analytics.trackExposure(createTestExposure({ userId: `user-${i}`, variant: 'treatment' }))
      }

      const dashboard = analytics.getDashboardData('test-flag')

      const controlVariant = dashboard!.topVariants.find((v) => v.variant === 'control')
      expect(controlVariant!.percentage).toBe(70)
      expect(controlVariant!.userCount).toBe(70)
    })

    it('should include expected variant percentages when provided', () => {
      analytics.trackExposure(createTestExposure({ userId: 'user-1', variant: 'control' }))
      analytics.trackExposure(createTestExposure({ userId: 'user-2', variant: 'treatment' }))

      const dashboard = analytics.getDashboardData('test-flag', {
        expectedVariantWeights: {
          control: 50,
          treatment: 50,
        },
      })

      expect(dashboard!.topVariants[0].expectedPercentage).toBeDefined()
    })

    it('should determine performance trend as stable', () => {
      analytics.trackExposure(createTestExposure({ userId: 'user-1' }))

      const dashboard = analytics.getDashboardData('test-flag')

      expect(dashboard!.performanceTrend).toBe('stable')
    })

    it('should return null for unknown flags', () => {
      const dashboard = analytics.getDashboardData('unknown-flag')

      expect(dashboard).toBeNull()
    })
  })

  // ============================================================================
  // ALERTS
  // ============================================================================

  describe('alerts', () => {
    it('should generate high latency alert', () => {
      for (let i = 0; i < 100; i++) {
        analytics.trackExposure(
          createTestExposure({
            userId: `user-${i}`,
            evaluationLatencyMs: 200, // Above 100ms threshold
          })
        )
      }

      const dashboard = analytics.getDashboardData('test-flag')
      const latencyAlert = dashboard!.alerts.find((a) => a.type === 'HIGH_LATENCY')

      expect(latencyAlert).toBeDefined()
      expect(latencyAlert!.severity).toBe('warning')
    })

    it('should generate high error rate alert', () => {
      const errorAnalytics = createFlagAnalytics({
        flushInterval: 0,
        alertThresholds: {
          highErrorRate: 0.05, // 5% threshold
        },
      })

      for (let i = 0; i < 100; i++) {
        errorAnalytics.trackExposure(
          createTestExposure({
            userId: `user-${i}`,
            reason: i < 10 ? 'ERROR' : 'MATCH', // 10% error rate
          })
        )
      }

      const dashboard = errorAnalytics.getDashboardData('test-flag')
      const errorAlert = dashboard!.alerts.find((a) => a.type === 'HIGH_ERROR_RATE')

      expect(errorAlert).toBeDefined()
      expect(errorAlert!.severity).toBe('error')

      errorAnalytics.close()
    })

    it('should generate low sample size alert', () => {
      analytics.trackExposure(createTestExposure({ userId: 'user-1' }))

      const dashboard = analytics.getDashboardData('test-flag')
      const sampleAlert = dashboard!.alerts.find((a) => a.type === 'LOW_SAMPLE_SIZE')

      expect(sampleAlert).toBeDefined()
      expect(sampleAlert!.severity).toBe('info')
    })

    it('should generate variant imbalance alert', () => {
      const imbalanceAnalytics = createFlagAnalytics({
        flushInterval: 0,
        alertThresholds: {
          variantImbalanceThreshold: 0.1, // 10% tolerance
          minSampleSize: 10,
        },
      })

      // Create 80/20 distribution when expecting 50/50
      for (let i = 0; i < 80; i++) {
        imbalanceAnalytics.trackExposure(createTestExposure({ userId: `user-${i}`, variant: 'control' }))
      }
      for (let i = 80; i < 100; i++) {
        imbalanceAnalytics.trackExposure(createTestExposure({ userId: `user-${i}`, variant: 'treatment' }))
      }

      const dashboard = imbalanceAnalytics.getDashboardData('test-flag', {
        expectedVariantWeights: {
          control: 50,
          treatment: 50,
        },
      })

      const imbalanceAlert = dashboard!.alerts.find((a) => a.type === 'VARIANT_IMBALANCE')

      expect(imbalanceAlert).toBeDefined()
      expect(imbalanceAlert!.severity).toBe('warning')

      imbalanceAnalytics.close()
    })
  })

  // ============================================================================
  // CONVENIENCE METHODS
  // ============================================================================

  describe('createExposure convenience method', () => {
    it('should create exposure from evaluation result', () => {
      const exposure = analytics.createExposure(
        'feature-flag',
        'user-123',
        {
          value: true,
          variant: 'control',
          reason: 'MATCH',
          bucket: 42,
        },
        {
          sessionId: 'session-456',
          environment: 'prod',
        },
        5
      )

      expect(exposure.flagKey).toBe('feature-flag')
      expect(exposure.userId).toBe('user-123')
      expect(exposure.variant).toBe('control')
      expect(exposure.value).toBe(true)
      expect(exposure.reason).toBe('MATCH')
      expect(exposure.bucket).toBe(42)
      expect(exposure.sessionId).toBe('session-456')
      expect(exposure.environment).toBe('prod')
      expect(exposure.evaluationLatencyMs).toBe(5)
    })

    it('should use default variant when not provided', () => {
      const exposure = analytics.createExposure(
        'feature-flag',
        'user-123',
        {
          value: false,
          reason: 'DEFAULT',
        },
        {},
        1
      )

      expect(exposure.variant).toBe('default')
    })
  })

  // ============================================================================
  // RESET AND CLOSE
  // ============================================================================

  describe('reset and close', () => {
    it('should reset all data', () => {
      analytics.trackExposure(createTestExposure({ userId: 'user-1' }))
      analytics.trackExposure(createTestExposure({ userId: 'user-2' }))

      analytics.reset()

      expect(analytics.bufferSize).toBe(0)
      expect(analytics.getMetrics('test-flag')).toBeNull()
    })

    it('should flush on close', async () => {
      const flushedEvents: ExposureEvent[] = []
      const closeAnalytics = createFlagAnalytics({
        flushInterval: 0,
        onFlush: (events) => {
          flushedEvents.push(...events)
        },
      })

      closeAnalytics.trackExposure(createTestExposure({ userId: 'user-1' }))
      closeAnalytics.trackExposure(createTestExposure({ userId: 'user-2' }))

      await closeAnalytics.close()

      expect(flushedEvents).toHaveLength(2)
    })

    it('should be idempotent on close', async () => {
      await analytics.close()
      await analytics.close() // Should not throw
    })
  })
})

// ============================================================================
// EXPOSURE TRACKER
// ============================================================================

describe('createExposureTracker', () => {
  it('should wrap evaluation and track exposure', async () => {
    const analytics = createFlagAnalytics({ flushInterval: 0 })
    const tracker = createExposureTracker(analytics)

    const result = await tracker('test-flag', 'user-123', async () => ({
      value: true,
      variant: 'control',
      reason: 'MATCH' as ExposureReason,
    }))

    expect(result.value).toBe(true)
    expect(result.variant).toBe('control')
    expect(result.exposure).toBeDefined()
    expect(result.exposure.flagKey).toBe('test-flag')
    expect(result.exposure.userId).toBe('user-123')

    await analytics.close()
  })

  it('should measure evaluation latency', async () => {
    const analytics = createFlagAnalytics({ flushInterval: 0 })
    const tracker = createExposureTracker(analytics)

    const result = await tracker('test-flag', 'user-123', async () => {
      // Simulate some latency
      await new Promise((r) => setTimeout(r, 10))
      return {
        value: true,
        variant: 'control',
        reason: 'MATCH' as ExposureReason,
      }
    })

    expect(result.exposure.evaluationLatencyMs).toBeGreaterThan(0)

    await analytics.close()
  })

  it('should include context when configured', async () => {
    const analytics = createFlagAnalytics({ flushInterval: 0 })
    const tracker = createExposureTracker(analytics, {
      includeAttributes: true,
      defaultEnvironment: 'staging',
    })

    const result = await tracker(
      'test-flag',
      'user-123',
      async () => ({
        value: true,
        variant: 'control',
        reason: 'MATCH' as ExposureReason,
      }),
      {
        attributes: { plan: 'enterprise' },
      }
    )

    expect(result.exposure.attributes).toEqual({ plan: 'enterprise' })
    expect(result.exposure.environment).toBe('staging')

    await analytics.close()
  })
})

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

describe('createFlagAnalytics', () => {
  it('should create a FlagAnalytics instance', () => {
    const analytics = createFlagAnalytics()

    expect(analytics).toBeInstanceOf(FlagAnalytics)

    analytics.close()
  })

  it('should accept configuration', () => {
    const onFlush = vi.fn()
    const analytics = createFlagAnalytics({
      flushAt: 50,
      flushInterval: 5000,
      maxBufferSize: 1000,
      onFlush,
    })

    expect(analytics).toBeDefined()

    analytics.close()
  })
})
