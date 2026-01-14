/**
 * @dotdo/vitals - Vitals Collector
 *
 * Collects and reports Web Vitals metrics via an analytics client.
 *
 * @module @dotdo/vitals/vitals
 */

import type {
  AnalyticsClient,
  VitalsConfig,
  WebVital,
  WebVitalName,
  WebVitalRating,
  VitalsThresholds,
} from './types.js'
import { DEFAULT_THRESHOLDS } from './types.js'

// =============================================================================
// Vitals Collector
// =============================================================================

/**
 * Collects and reports Web Vitals metrics.
 *
 * @example
 * ```typescript
 * const analytics = new Analytics({ projectToken: 'xxx' })
 * const collector = new VitalsCollector(analytics)
 *
 * // Report a vital
 * collector.reportVital({
 *   name: 'LCP',
 *   value: 2100,
 *   rating: 'good',
 *   delta: 2100,
 *   id: 'v1-1234567890'
 * })
 * ```
 */
export class VitalsCollector {
  private readonly client: AnalyticsClient
  private readonly config: VitalsConfig
  private readonly thresholds: VitalsThresholds
  private readonly random: () => number

  /**
   * Create a VitalsCollector instance.
   *
   * @param client - Analytics client for tracking events
   * @param config - Optional configuration
   * @param randomFn - Optional random function for testing (defaults to Math.random)
   */
  constructor(
    client: AnalyticsClient,
    config?: VitalsConfig,
    randomFn?: () => number
  ) {
    this.client = client
    this.config = config ?? {}
    this.random = randomFn ?? Math.random

    // Merge custom thresholds with defaults
    this.thresholds = {
      ...DEFAULT_THRESHOLDS,
      ...config?.thresholds,
    }
  }

  /**
   * Report a Web Vital measurement.
   *
   * @param vital - The Web Vital measurement to report
   */
  reportVital(vital: WebVital): void {
    // Check sampling rate
    const sampleRate = this.config.sampleRate ?? 1
    if (sampleRate < 1 && this.random() > sampleRate) {
      return
    }

    // Track the vital as an analytics event
    this.client.track('Web Vital', {
      metric: vital.name,
      value: vital.value,
      rating: vital.rating,
      delta: vital.delta,
      id: vital.id,
      navigationType: vital.navigationType,
      routePattern: this.config.routePattern,
    })

    if (this.config.debug) {
      console.log(`[Vitals] ${vital.name}: ${vital.value} (${vital.rating})`)
    }
  }

  /**
   * Calculate rating for a metric value.
   *
   * @param name - The metric name
   * @param value - The measured value
   * @returns The rating ('good', 'needs-improvement', or 'poor')
   */
  static getRating(name: WebVitalName, value: number): WebVitalRating {
    const thresholds = DEFAULT_THRESHOLDS[name]
    if (!thresholds) {
      return 'good'
    }

    const [goodThreshold, poorThreshold] = thresholds

    if (value <= goodThreshold) {
      return 'good'
    }

    if (value <= poorThreshold) {
      return 'needs-improvement'
    }

    return 'poor'
  }

  /**
   * Get rating using instance thresholds (allows custom thresholds).
   *
   * @param name - The metric name
   * @param value - The measured value
   * @returns The rating ('good', 'needs-improvement', or 'poor')
   */
  getRating(name: WebVitalName, value: number): WebVitalRating {
    const thresholds = this.thresholds[name]
    if (!thresholds) {
      return 'good'
    }

    const [goodThreshold, poorThreshold] = thresholds

    if (value <= goodThreshold) {
      return 'good'
    }

    if (value <= poorThreshold) {
      return 'needs-improvement'
    }

    return 'poor'
  }

  /**
   * Get the current configuration.
   */
  getConfig(): VitalsConfig {
    return { ...this.config }
  }

  /**
   * Get the current thresholds.
   */
  getThresholds(): VitalsThresholds {
    return { ...this.thresholds }
  }
}
