/**
 * Web Vitals Transformer
 *
 * Transforms metrics from the web-vitals library (https://github.com/GoogleChrome/web-vitals)
 * into the UnifiedEvent schema used by dotdo's observability pipeline.
 *
 * @module db/streams/transformers/web-vital
 */

import { createUnifiedEvent, type UnifiedEvent } from '../../../types/unified-event'

// ============================================================================
// Input Types (web-vitals library format)
// ============================================================================

/**
 * Web Vital metric names as defined by web-vitals library.
 *
 * - LCP: Largest Contentful Paint (timing, ms)
 * - FID: First Input Delay (timing, ms)
 * - CLS: Cumulative Layout Shift (score, unitless)
 * - TTFB: Time to First Byte (timing, ms)
 * - INP: Interaction to Next Paint (timing, ms)
 * - FCP: First Contentful Paint (timing, ms)
 */
export type WebVitalName = 'LCP' | 'FID' | 'CLS' | 'TTFB' | 'INP' | 'FCP'

/**
 * Web Vital rating thresholds as defined by Google.
 */
export type WebVitalRating = 'good' | 'needs-improvement' | 'poor'

/**
 * Navigation type when the metric was captured.
 */
export type NavigationType = 'navigate' | 'reload' | 'back_forward' | 'prerender'

/**
 * Input metric format from web-vitals library.
 * See: https://github.com/GoogleChrome/web-vitals#metric
 */
export interface WebVitalMetric {
  /** Metric name (LCP, FID, CLS, TTFB, INP, FCP) */
  name: WebVitalName
  /** Metric value (ms for timing vitals, score for CLS) */
  value: number
  /** Rating based on Core Web Vitals thresholds */
  rating: WebVitalRating
  /** Change in value since last report */
  delta: number
  /** Unique identifier for this metric instance */
  id: string
  /** How the page was navigated to */
  navigationType: NavigationType
  /** Performance entries used to calculate the metric */
  entries: PerformanceEntry[]
}

/**
 * Context required for transformation.
 */
export interface TransformContext {
  /** Current page URL */
  pageUrl: string
  /** Session identifier (optional) */
  sessionId?: string
  /** Namespace for the event */
  ns: string
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Timing vitals are measured in milliseconds and represent duration.
 * CLS is the only non-timing vital (it's a unitless score).
 */
const TIMING_VITALS: ReadonlySet<WebVitalName> = new Set([
  'LCP',
  'FID',
  'TTFB',
  'INP',
  'FCP',
])

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extracts the element tagName from LCP performance entry.
 * LCP entries have an `element` property pointing to the DOM element.
 *
 * @param entries - Performance entries from the metric
 * @returns Element tagName or null if not available
 */
function extractElementTagName(entries: PerformanceEntry[]): string | null {
  if (entries.length === 0) {
    return null
  }

  const firstEntry = entries[0] as PerformanceEntry & {
    element?: { tagName?: string }
  }

  return firstEntry.element?.tagName ?? null
}

// ============================================================================
// Transform Function
// ============================================================================

/**
 * Transforms a web-vitals library metric into a UnifiedEvent.
 *
 * Field mappings:
 * - name → vital_name, event_name
 * - value → vital_value, duration_ms (for timing vitals)
 * - rating → vital_rating
 * - delta → vital_delta
 * - id → span_id
 * - navigationType → nav_type
 * - entries[0].element.tagName → vital_element
 * - context.pageUrl → http_url
 * - context.sessionId → session_id
 * - context.ns → ns
 *
 * @param vital - Web vital metric from web-vitals library
 * @param context - Transformation context with page URL and namespace
 * @returns UnifiedEvent with all fields properly mapped
 *
 * @example
 * ```typescript
 * import { onLCP } from 'web-vitals'
 * import { transformWebVital } from './transformers/web-vital'
 *
 * onLCP((metric) => {
 *   const event = transformWebVital(metric, {
 *     pageUrl: window.location.href,
 *     sessionId: getSessionId(),
 *     ns: 'my-app',
 *   })
 *   // Send event to observability pipeline
 * })
 * ```
 */
export function transformWebVital(
  vital: WebVitalMetric,
  context: TransformContext
): UnifiedEvent {
  const isTimingVital = TIMING_VITALS.has(vital.name)

  return createUnifiedEvent({
    // Generate unique ID for this event
    id: crypto.randomUUID(),

    // Core identity
    event_type: 'vital',
    event_name: vital.name,
    ns: context.ns,

    // Causality chain
    span_id: vital.id,
    session_id: context.sessionId ?? null,

    // Web Vitals fields
    vital_name: vital.name,
    vital_value: vital.value,
    vital_rating: vital.rating,
    vital_delta: vital.delta,
    vital_element: extractElementTagName(vital.entries),
    nav_type: vital.navigationType,

    // Timing - only set duration_ms for timing vitals (not CLS)
    duration_ms: isTimingVital ? vital.value : null,
    timestamp: new Date().toISOString(),

    // HTTP context
    http_url: context.pageUrl,
  })
}
