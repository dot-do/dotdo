/**
 * Experiment Analytics Integration Tests
 *
 * Tests for the unified experiment analytics integration that combines:
 * - Experiment tracking (assignments, conversions, stats)
 * - Analytics (exposure tracking, metrics, time series)
 * - Insights (sample quality, recommendations)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createExperimentTracking,
  type ExperimentTracking,
} from '../experiment-tracking'
import {
  createExperimentAnalytics,
  createDefaultExperimentAnalytics,
  type ExperimentAnalytics,
  type ExperimentAnalyticsReport,
  type ExperimentInsights,
} from '../experiment-analytics'

describe('Experiment Analytics Integration', () => {
  let tracking: ExperimentTracking
  let analytics: ExperimentAnalytics

  beforeEach(async () => {
    tracking = createExperimentTracking({
      minSampleSize: 10, // Lower for testing
      alpha: 0.05,
      power: 0.8,
    })

    analytics = createExperimentAnalytics({
      tracking,
      autoTrackExposures: true,
    })

    // Create and start a test experiment
    await tracking.createExperiment({
      id: 'analytics-test',
      name: 'Analytics Integration Test',
      variants: [
        { key: 'control', name: 'Control', weight: 50, isControl: true },
        { key: 'treatment', name: 'Treatment', weight: 50 },
      ],
      metrics: [
        { id: 'signup', name: 'Sign Up', type: 'conversion', isPrimary: true },
      ],
    })
    await tracking.startExperiment('analytics-test')
  })

  afterEach(async () => {
    await analytics.destroy()
  })

  // ===========================================================================
  // EXPOSURE TRACKING
  // ===========================================================================

  describe('Exposure Tracking', () => {
    it('tracks experiment exposure', () => {
      const exposure = analytics.trackExposure(
        'analytics-test',
        'user-123',
        'control'
      )

      expect(exposure).toBeDefined()
      expect(exposure.experimentId).toBe('analytics-test')
      expect(exposure.userId).toBe('user-123')
      expect(exposure.variant).toBe('control')
    })

    it('includes context in exposure', () => {
      const exposure = analytics.trackExposure(
        'analytics-test',
        'user-456',
        'treatment',
        {
          sessionId: 'session-abc',
          attributes: { plan: 'premium' },
          environment: 'production',
        }
      )

      expect(exposure.sessionId).toBe('session-abc')
      expect(exposure.attributes).toEqual({ plan: 'premium' })
      expect(exposure.environment).toBe('production')
    })

    it('tracks multiple exposures for metrics', () => {
      // Track multiple users
      for (let i = 0; i < 50; i++) {
        const variant = i % 2 === 0 ? 'control' : 'treatment'
        analytics.trackExposure('analytics-test', `user-${i}`, variant)
      }

      const metrics = analytics.getExposureMetrics('analytics-test')

      expect(metrics).not.toBeNull()
      expect(metrics!.totalEvaluations).toBe(50)
      expect(metrics!.uniqueUsers).toBe(50)
      expect(metrics!.variantCounts['control']).toBe(25)
      expect(metrics!.variantCounts['treatment']).toBe(25)
    })
  })

  // ===========================================================================
  // METRICS AND TIME SERIES
  // ===========================================================================

  describe('Metrics and Time Series', () => {
    beforeEach(() => {
      // Generate some exposure data
      for (let i = 0; i < 100; i++) {
        const variant = i % 2 === 0 ? 'control' : 'treatment'
        analytics.trackExposure('analytics-test', `user-${i}`, variant)
      }
    })

    it('returns exposure metrics', () => {
      const metrics = analytics.getExposureMetrics('analytics-test')

      expect(metrics).not.toBeNull()
      expect(metrics!.flagKey).toBe('experiment:analytics-test')
      expect(metrics!.totalEvaluations).toBe(100)
      expect(metrics!.latency).toBeDefined()
      expect(metrics!.latency.avg).toBeDefined()
    })

    it('returns null for non-existent experiment', () => {
      const metrics = analytics.getExposureMetrics('non-existent')
      expect(metrics).toBeNull()
    })

    it('returns time series data', () => {
      const timeSeries = analytics.getTimeSeries('analytics-test', 24)

      expect(timeSeries).toBeInstanceOf(Array)
      expect(timeSeries.length).toBe(24) // 24 hours
      // Most recent hour should have data
      const hasData = timeSeries.some((point) => point.evaluations > 0)
      expect(hasData).toBe(true)
    })

    it('returns empty time series for non-existent experiment', () => {
      const timeSeries = analytics.getTimeSeries('non-existent', 24)
      expect(timeSeries).toBeInstanceOf(Array)
      // Should still have 24 data points, just with zeros
      expect(timeSeries.length).toBe(24)
    })
  })

  // ===========================================================================
  // INSIGHTS
  // ===========================================================================

  describe('Insights', () => {
    it('provides insights for experiment with data', async () => {
      // Generate assignment and conversion data
      for (let i = 0; i < 50; i++) {
        await tracking.trackAssignment('analytics-test', `user-${i}`)
        analytics.trackExposure(
          'analytics-test',
          `user-${i}`,
          i % 2 === 0 ? 'control' : 'treatment'
        )

        // Some conversions
        if (i < 15) {
          await tracking.trackConversion('analytics-test', `user-${i}`, 'signup')
        }
      }

      const insights = await analytics.getInsights('analytics-test')

      expect(insights).not.toBeNull()
      expect(insights!.sampleQuality).toBeDefined()
      expect(['excellent', 'good', 'fair', 'poor']).toContain(
        insights!.sampleQuality
      )
      expect(insights!.dataQualityIssues).toBeInstanceOf(Array)
      expect(insights!.recommendations).toBeInstanceOf(Array)
      expect(typeof insights!.healthScore).toBe('number')
      expect(insights!.healthScore).toBeGreaterThanOrEqual(0)
      expect(insights!.healthScore).toBeLessThanOrEqual(100)
    })

    it('returns null for non-existent experiment', async () => {
      const insights = await analytics.getInsights('non-existent')
      expect(insights).toBeNull()
    })

    it('detects low sample size issue', async () => {
      // Only 5 users - below minimum
      for (let i = 0; i < 5; i++) {
        await tracking.trackAssignment('analytics-test', `user-${i}`)
      }

      const insights = await analytics.getInsights('analytics-test')

      expect(insights).not.toBeNull()
      expect(
        insights!.dataQualityIssues.some((issue) =>
          issue.toLowerCase().includes('sample size')
        )
      ).toBe(true)
    })

    it('provides recommendations based on experiment state', async () => {
      // Generate enough data for recommendations
      for (let i = 0; i < 30; i++) {
        await tracking.trackAssignment('analytics-test', `user-${i}`)
        if (i < 5) {
          await tracking.trackConversion('analytics-test', `user-${i}`, 'signup')
        }
      }

      const insights = await analytics.getInsights('analytics-test')

      expect(insights).not.toBeNull()
      expect(insights!.recommendations.length).toBeGreaterThan(0)
    })
  })

  // ===========================================================================
  // COMBINED REPORTS
  // ===========================================================================

  describe('Combined Reports', () => {
    beforeEach(async () => {
      // Generate comprehensive test data
      for (let i = 0; i < 100; i++) {
        const userId = `user-${i}`
        await tracking.trackAssignment('analytics-test', userId)

        const variant = await tracking.getVariant('analytics-test', userId)
        analytics.trackExposure('analytics-test', userId, variant!)

        // Simulate conversions (treatment converts better)
        const convertChance = variant === 'treatment' ? 0.25 : 0.15
        if (Math.random() < convertChance) {
          await tracking.trackConversion('analytics-test', userId, 'signup')
        }
      }
    })

    it('returns comprehensive report', async () => {
      const report = await analytics.getReport('analytics-test')

      expect(report).not.toBeNull()
      expect(report!.experimentId).toBe('analytics-test')
      expect(report!.name).toBe('Analytics Integration Test')
      expect(report!.status).toBe('running')

      // Experiment stats
      expect(report!.experimentStats).toBeDefined()
      expect(report!.experimentStats.totalSampleSize).toBe(100)
      expect(report!.experimentStats.variants).toBeDefined()

      // Analytics metrics
      expect(report!.analyticsMetrics).toBeDefined()
      expect(report!.analyticsMetrics!.totalEvaluations).toBe(100)

      // Time series
      expect(report!.timeSeries).toBeInstanceOf(Array)

      // Insights
      expect(report!.insights).toBeDefined()
      expect(report!.insights.sampleQuality).toBeDefined()
    })

    it('returns null for non-existent experiment', async () => {
      const report = await analytics.getReport('non-existent')
      expect(report).toBeNull()
    })

    it('includes all variant statistics', async () => {
      const report = await analytics.getReport('analytics-test')

      expect(report!.experimentStats.variants).toHaveProperty('control')
      expect(report!.experimentStats.variants).toHaveProperty('treatment')

      const controlStats = report!.experimentStats.variants['control']
      expect(controlStats.sampleSize).toBeGreaterThan(0)
      expect(typeof controlStats.conversionRate).toBe('number')
    })
  })

  // ===========================================================================
  // FACTORY FUNCTIONS
  // ===========================================================================

  describe('Factory Functions', () => {
    it('creates default experiment analytics', async () => {
      const defaultAnalytics = createDefaultExperimentAnalytics(tracking)

      // Should work the same as manual creation
      const exposure = defaultAnalytics.trackExposure(
        'analytics-test',
        'factory-user',
        'control'
      )
      expect(exposure).toBeDefined()

      await defaultAnalytics.destroy()
    })

    it('supports custom analytics config', async () => {
      const flushEvents: any[] = []

      const customAnalytics = createExperimentAnalytics({
        tracking,
        analyticsConfig: {
          flushAt: 5,
          onFlush: (events) => flushEvents.push(...events),
        },
      })

      // Track enough to trigger flush
      for (let i = 0; i < 10; i++) {
        customAnalytics.trackExposure('analytics-test', `custom-user-${i}`, 'control')
      }
      await customAnalytics.flush()

      expect(flushEvents.length).toBeGreaterThan(0)

      await customAnalytics.destroy()
    })
  })

  // ===========================================================================
  // FLUSH AND CLEANUP
  // ===========================================================================

  describe('Flush and Cleanup', () => {
    it('flushes pending data', async () => {
      // Track some exposures
      for (let i = 0; i < 10; i++) {
        analytics.trackExposure('analytics-test', `flush-user-${i}`, 'control')
      }

      // Should not throw
      await expect(analytics.flush()).resolves.not.toThrow()
    })

    it('destroys cleanly', async () => {
      // Track some data
      analytics.trackExposure('analytics-test', 'destroy-user', 'control')

      // Should not throw
      await expect(analytics.destroy()).resolves.not.toThrow()
    })
  })

  // ===========================================================================
  // SAMPLE QUALITY ASSESSMENT
  // ===========================================================================

  describe('Sample Quality Assessment', () => {
    it('assesses excellent quality with sufficient data', async () => {
      // Create experiment with good data
      for (let i = 0; i < 200; i++) {
        const userId = `quality-user-${i}`
        await tracking.trackAssignment('analytics-test', userId)
        const variant = await tracking.getVariant('analytics-test', userId)
        analytics.trackExposure('analytics-test', userId, variant!)

        // Balanced conversions
        if (i % 5 === 0) {
          await tracking.trackConversion('analytics-test', userId, 'signup')
        }
      }

      const insights = await analytics.getInsights('analytics-test')

      expect(insights).not.toBeNull()
      // With 200 samples and balanced data, should be at least 'good'
      expect(['excellent', 'good']).toContain(insights!.sampleQuality)
      expect(insights!.healthScore).toBeGreaterThan(50)
    })

    it('assesses poor quality with minimal data', async () => {
      // Only 3 users
      for (let i = 0; i < 3; i++) {
        await tracking.trackAssignment('analytics-test', `minimal-user-${i}`)
      }

      const insights = await analytics.getInsights('analytics-test')

      expect(insights).not.toBeNull()
      // With only 3 samples, quality should be low
      expect(['fair', 'poor']).toContain(insights!.sampleQuality)
    })
  })
})
