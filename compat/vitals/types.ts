/**
 * @dotdo/vitals - Type Definitions
 *
 * Types for Web Vitals collection and reporting.
 *
 * @module @dotdo/vitals/types
 */

// =============================================================================
// Web Vitals Types
// =============================================================================

/**
 * Web Vital metric names
 */
export type WebVitalName = 'CLS' | 'FCP' | 'FID' | 'INP' | 'LCP' | 'TTFB'

/**
 * Performance rating based on Core Web Vitals thresholds
 */
export type WebVitalRating = 'good' | 'needs-improvement' | 'poor'

/**
 * Web Vital measurement
 */
export interface WebVital {
  /** Metric name (CLS, FCP, FID, INP, LCP, TTFB) */
  name: WebVitalName
  /** Measured value */
  value: number
  /** Rating based on thresholds */
  rating: WebVitalRating
  /** Delta from previous measurement */
  delta: number
  /** Unique ID for this measurement */
  id: string
  /** Navigation type */
  navigationType?: 'navigate' | 'reload' | 'back-forward' | 'back-forward-cache' | 'prerender'
  /** Entries contributing to this metric */
  entries?: PerformanceEntry[]
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Vitals collector configuration
 */
export interface VitalsConfig {
  /** Sample rate (0-1, default 1 = 100%) */
  sampleRate?: number
  /** Debug mode */
  debug?: boolean
  /** Custom thresholds override */
  thresholds?: Partial<VitalsThresholds>
  /** Route pattern for grouping */
  routePattern?: string
  /** Report all metrics or only Core Web Vitals */
  reportAllChanges?: boolean
}

/**
 * Thresholds for rating calculation
 */
export interface VitalsThresholds {
  CLS: [number, number]
  FCP: [number, number]
  FID: [number, number]
  INP: [number, number]
  LCP: [number, number]
  TTFB: [number, number]
}

// =============================================================================
// Analytics Client Interface
// =============================================================================

/**
 * Minimal analytics client interface for vitals reporting
 */
export interface AnalyticsClient {
  track(event: string, properties?: Record<string, unknown>): void
}

// =============================================================================
// Default Thresholds (Core Web Vitals)
// =============================================================================

/**
 * Default thresholds based on Google's Core Web Vitals recommendations
 * Format: [good threshold, needs-improvement threshold]
 * - Values <= good threshold are "good"
 * - Values <= needs-improvement threshold are "needs-improvement"
 * - Values > needs-improvement threshold are "poor"
 */
export const DEFAULT_THRESHOLDS: VitalsThresholds = {
  // Cumulative Layout Shift (unitless, lower is better)
  CLS: [0.1, 0.25],
  // First Contentful Paint (ms)
  FCP: [1800, 3000],
  // First Input Delay (ms)
  FID: [100, 300],
  // Interaction to Next Paint (ms)
  INP: [200, 500],
  // Largest Contentful Paint (ms)
  LCP: [2500, 4000],
  // Time to First Byte (ms)
  TTFB: [800, 1800],
}
