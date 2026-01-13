/**
 * Experiment Analytics Integration
 *
 * Bridges A/B experiment tracking with the analytics system for:
 * - Automatic exposure tracking when users are assigned to variants
 * - Conversion event correlation with experiment assignments
 * - Unified reporting combining experiment stats with analytics data
 *
 * This module provides the integration layer between:
 * - ExperimentTracking (experiment management, assignment, conversions)
 * - FlagAnalytics (exposure tracking, evaluation metrics, dashboards)
 *
 * @module db/primitives/feature-flags/experiment-analytics
 */

import {
  FlagAnalytics,
  createFlagAnalytics,
  type FlagAnalyticsConfig,
  type ExposureEvent,
  type ExposureReason,
  type FlagMetrics,
  type TimeSeriesPoint,
} from './analytics'
import type { ExperimentTracking, ExperimentStats, VariantStats } from './experiment-tracking'
import type { Assignment } from './experiment-tracker'
import type { ConversionEvent } from './conversion-tracker'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Configuration for experiment analytics integration
 */
export interface ExperimentAnalyticsConfig {
  /** Underlying experiment tracking instance */
  tracking: ExperimentTracking
  /** Analytics configuration (optional, will create default if not provided) */
  analyticsConfig?: FlagAnalyticsConfig
  /** Whether to auto-track exposures on variant assignment */
  autoTrackExposures?: boolean
  /** Whether to correlate analytics events with experiment assignments */
  correlateEvents?: boolean
  /** Custom event transformer for exposure events */
  transformExposure?: (
    assignment: Assignment,
    experimentId: string
  ) => Partial<ExposureEvent>
}

/**
 * Combined experiment and analytics metrics
 */
export interface ExperimentAnalyticsReport {
  /** Experiment ID */
  experimentId: string
  /** Experiment name */
  name: string
  /** Current status */
  status: 'draft' | 'running' | 'paused' | 'completed'
  /** Experiment statistics (conversion rates, significance, etc.) */
  experimentStats: ExperimentStats
  /** Analytics metrics (exposure tracking, latency, etc.) */
  analyticsMetrics: FlagMetrics | null
  /** Time series data for visualization */
  timeSeries: TimeSeriesPoint[]
  /** Combined insights */
  insights: ExperimentInsights
}

/**
 * Derived insights from combined experiment and analytics data
 */
export interface ExperimentInsights {
  /** Sample quality assessment */
  sampleQuality: 'excellent' | 'good' | 'fair' | 'poor'
  /** Data quality issues detected */
  dataQualityIssues: string[]
  /** Recommendations based on data */
  recommendations: string[]
  /** Estimated completion based on current velocity */
  estimatedCompletionDays?: number
  /** Health score (0-100) */
  healthScore: number
}

/**
 * Exposure event specific to experiments
 */
export interface ExperimentExposure extends ExposureEvent {
  /** The experiment ID */
  experimentId: string
  /** The assignment that triggered this exposure */
  assignmentId?: string
  /** Time since experiment started */
  timeSinceStart?: number
}

/**
 * Experiment analytics interface
 */
export interface ExperimentAnalytics {
  /** Track an experiment exposure */
  trackExposure(
    experimentId: string,
    userId: string,
    variant: string,
    context?: ExposureContext
  ): ExperimentExposure

  /** Get combined report for an experiment */
  getReport(experimentId: string): Promise<ExperimentAnalyticsReport | null>

  /** Get exposure metrics for an experiment */
  getExposureMetrics(experimentId: string): FlagMetrics | null

  /** Get time series data for an experiment */
  getTimeSeries(experimentId: string, hours?: number): TimeSeriesPoint[]

  /** Get insights for an experiment */
  getInsights(experimentId: string): Promise<ExperimentInsights | null>

  /** Flush pending analytics data */
  flush(): Promise<void>

  /** Cleanup resources */
  destroy(): Promise<void>
}

/**
 * Context for exposure tracking
 */
export interface ExposureContext {
  /** Session ID */
  sessionId?: string
  /** User attributes */
  attributes?: Record<string, unknown>
  /** Environment */
  environment?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * Create experiment analytics integration
 */
export function createExperimentAnalytics(
  config: ExperimentAnalyticsConfig
): ExperimentAnalytics {
  const { tracking, analyticsConfig, autoTrackExposures = true } = config

  // Create analytics instance
  const analytics = createFlagAnalytics({
    ...analyticsConfig,
    // Ensure we track all exposures for experiments (no sampling)
    sampleRate: analyticsConfig?.sampleRate ?? 1.0,
  })

  // Track experiment start times for insights
  const experimentStartTimes = new Map<string, Date>()

  /**
   * Track an experiment exposure
   */
  function trackExposure(
    experimentId: string,
    userId: string,
    variant: string,
    context?: ExposureContext
  ): ExperimentExposure {
    const startTime = experimentStartTimes.get(experimentId)
    const timeSinceStart = startTime
      ? Date.now() - startTime.getTime()
      : undefined

    // Map experiment exposure to flag exposure format
    const exposure = analytics.trackExposure({
      flagKey: `experiment:${experimentId}`,
      userId,
      variant,
      value: variant,
      reason: 'VARIANT_SELECTED' as ExposureReason,
      evaluationLatencyMs: 0,
      sessionId: context?.sessionId,
      attributes: context?.attributes,
      environment: context?.environment,
      metadata: {
        ...context?.metadata,
        experimentId,
        timeSinceStart,
      },
    })

    return {
      ...exposure,
      experimentId,
      timeSinceStart,
    }
  }

  /**
   * Get exposure metrics for an experiment
   */
  function getExposureMetrics(experimentId: string): FlagMetrics | null {
    return analytics.getMetrics(`experiment:${experimentId}`)
  }

  /**
   * Get time series data for an experiment
   */
  function getTimeSeries(experimentId: string, hours = 24): TimeSeriesPoint[] {
    return analytics.getTimeSeries(`experiment:${experimentId}`, hours)
  }

  /**
   * Calculate sample quality based on various factors
   */
  function assessSampleQuality(
    stats: ExperimentStats,
    metrics: FlagMetrics | null
  ): 'excellent' | 'good' | 'fair' | 'poor' {
    let score = 0
    const maxScore = 100

    // Factor 1: Minimum sample size (30 points)
    if (stats.hasMinimumSample) {
      score += 30
    } else if (stats.totalSampleSize > 50) {
      score += 15
    }

    // Factor 2: Statistical power (25 points)
    if (stats.power >= 0.8) {
      score += 25
    } else if (stats.power >= 0.6) {
      score += 15
    } else if (stats.power >= 0.4) {
      score += 8
    }

    // Factor 3: Variant balance (20 points)
    const variantCounts = Object.values(stats.variants).map((v) => v.sampleSize)
    if (variantCounts.length >= 2) {
      const max = Math.max(...variantCounts)
      const min = Math.min(...variantCounts)
      const balance = min / max
      if (balance >= 0.8) {
        score += 20
      } else if (balance >= 0.6) {
        score += 12
      } else if (balance >= 0.4) {
        score += 6
      }
    }

    // Factor 4: Error rate from analytics (15 points)
    if (metrics) {
      const errorRate = metrics.errorCount / Math.max(1, metrics.totalEvaluations)
      if (errorRate === 0) {
        score += 15
      } else if (errorRate < 0.01) {
        score += 10
      } else if (errorRate < 0.05) {
        score += 5
      }
    } else {
      score += 10 // Default if no analytics
    }

    // Factor 5: Data consistency (10 points)
    if (metrics && stats.totalSampleSize > 0) {
      // Check if analytics unique users roughly matches experiment sample size
      const ratio = metrics.uniqueUsers / stats.totalSampleSize
      if (ratio >= 0.9 && ratio <= 1.1) {
        score += 10
      } else if (ratio >= 0.7 && ratio <= 1.3) {
        score += 5
      }
    } else {
      score += 5 // Default
    }

    const percentage = (score / maxScore) * 100

    if (percentage >= 80) return 'excellent'
    if (percentage >= 60) return 'good'
    if (percentage >= 40) return 'fair'
    return 'poor'
  }

  /**
   * Detect data quality issues
   */
  function detectDataQualityIssues(
    stats: ExperimentStats,
    metrics: FlagMetrics | null
  ): string[] {
    const issues: string[] = []

    // Check for severe variant imbalance
    const variantCounts = Object.values(stats.variants).map((v) => v.sampleSize)
    if (variantCounts.length >= 2) {
      const max = Math.max(...variantCounts)
      const min = Math.min(...variantCounts)
      if (min > 0 && max / min > 2) {
        issues.push(
          `Significant variant imbalance detected (${max}:${min} ratio)`
        )
      }
    }

    // Check for low sample size
    if (!stats.hasMinimumSample) {
      issues.push(
        `Sample size (${stats.totalSampleSize}) below minimum for statistical significance`
      )
    }

    // Check for low power
    if (stats.power < 0.5) {
      issues.push(
        `Low statistical power (${(stats.power * 100).toFixed(1)}%) - results may be unreliable`
      )
    }

    // Check analytics for issues
    if (metrics) {
      const errorRate = metrics.errorCount / Math.max(1, metrics.totalEvaluations)
      if (errorRate > 0.05) {
        issues.push(
          `High error rate (${(errorRate * 100).toFixed(1)}%) in variant assignment`
        )
      }

      if (metrics.latency.p95 > 100) {
        issues.push(
          `High evaluation latency (P95: ${metrics.latency.p95.toFixed(0)}ms)`
        )
      }
    }

    // Check for zero conversions in any variant
    for (const [variant, variantStats] of Object.entries(stats.variants)) {
      if (variantStats.sampleSize > 50 && variantStats.conversions === 0) {
        issues.push(`Zero conversions detected in variant "${variant}"`)
      }
    }

    return issues
  }

  /**
   * Generate recommendations based on experiment data
   */
  function generateRecommendations(
    stats: ExperimentStats,
    issues: string[]
  ): string[] {
    const recommendations: string[] = []

    // Based on recommendation from stats
    switch (stats.recommendation) {
      case 'significant_winner':
        if (stats.winner) {
          recommendations.push(
            `Consider concluding experiment - "${stats.winner}" shows statistically significant improvement`
          )
        }
        break

      case 'no_difference':
        recommendations.push(
          `No significant difference detected. Consider stopping experiment or testing larger effect size`
        )
        break

      case 'need_more_data':
        if (stats.estimatedDaysToSignificance) {
          recommendations.push(
            `Continue running for approximately ${stats.estimatedDaysToSignificance} more days to reach significance`
          )
        } else {
          recommendations.push(`Continue running to collect more data`)
        }
        break
    }

    // Add issue-based recommendations
    if (issues.some((i) => i.includes('imbalance'))) {
      recommendations.push(
        `Investigate traffic allocation - variant distribution may need adjustment`
      )
    }

    if (issues.some((i) => i.includes('error rate'))) {
      recommendations.push(
        `Review experiment configuration for assignment errors`
      )
    }

    if (issues.some((i) => i.includes('Zero conversions'))) {
      recommendations.push(
        `Verify conversion tracking is working correctly for all variants`
      )
    }

    return recommendations
  }

  /**
   * Get insights for an experiment
   */
  async function getInsights(
    experimentId: string
  ): Promise<ExperimentInsights | null> {
    const stats = await tracking.getExperimentStats(experimentId)
    if (!stats) return null

    const metrics = getExposureMetrics(experimentId)
    const sampleQuality = assessSampleQuality(stats, metrics)
    const dataQualityIssues = detectDataQualityIssues(stats, metrics)
    const recommendations = generateRecommendations(stats, dataQualityIssues)

    // Calculate health score
    let healthScore = 100
    healthScore -= dataQualityIssues.length * 15
    if (sampleQuality === 'fair') healthScore -= 10
    if (sampleQuality === 'poor') healthScore -= 25
    healthScore = Math.max(0, Math.min(100, healthScore))

    return {
      sampleQuality,
      dataQualityIssues,
      recommendations,
      estimatedCompletionDays: stats.estimatedDaysToSignificance,
      healthScore,
    }
  }

  /**
   * Get combined report for an experiment
   */
  async function getReport(
    experimentId: string
  ): Promise<ExperimentAnalyticsReport | null> {
    const stats = await tracking.getExperimentStats(experimentId)
    if (!stats) return null

    const metrics = getExposureMetrics(experimentId)
    const timeSeries = getTimeSeries(experimentId)
    const insights = await getInsights(experimentId)

    return {
      experimentId,
      name: stats.name,
      status: stats.status,
      experimentStats: stats,
      analyticsMetrics: metrics,
      timeSeries,
      insights: insights!,
    }
  }

  /**
   * Flush pending analytics data
   */
  async function flush(): Promise<void> {
    await analytics.flush()
    await tracking.flush()
  }

  /**
   * Cleanup resources
   */
  async function destroy(): Promise<void> {
    await analytics.close()
    tracking.destroy()
  }

  return {
    trackExposure,
    getReport,
    getExposureMetrics,
    getTimeSeries,
    getInsights,
    flush,
    destroy,
  }
}

// =============================================================================
// CONVENIENCE FACTORIES
// =============================================================================

/**
 * Create experiment analytics with default configuration
 */
export function createDefaultExperimentAnalytics(
  tracking: ExperimentTracking
): ExperimentAnalytics {
  return createExperimentAnalytics({ tracking })
}
