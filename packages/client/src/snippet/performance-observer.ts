/**
 * Performance Observer
 *
 * Creates a PerformanceObserver to capture resource timing entries
 * for frontend network timing instrumentation.
 *
 * @module @dotdo/client/snippet/performance-observer
 */

/**
 * Configuration for creating a performance observer.
 */
export interface PerformanceObserverConfig {
  /** Session ID for correlating entries */
  sessionId: string
  /** Callback invoked for each resource timing entry */
  onEntry: (entry: PerformanceResourceTiming) => void
  /** Optional filter to include/exclude specific entries */
  filter?: (entry: PerformanceResourceTiming) => boolean
}

/**
 * Creates a PerformanceObserver that monitors resource timing entries.
 *
 * Uses the Resource Timing API to capture detailed network timing information
 * for all resources loaded by the page. Supports filtering and provides
 * access to the full PerformanceResourceTiming interface.
 *
 * @param config - Observer configuration
 * @returns The created PerformanceObserver instance
 *
 * @example
 * ```typescript
 * const observer = createPerformanceObserver({
 *   sessionId: 'session-123',
 *   onEntry: (entry) => {
 *     console.log(`Loaded: ${entry.name} in ${entry.duration}ms`)
 *   },
 *   filter: (entry) => entry.name.includes('api.example.com')
 * })
 *
 * // Later, disconnect when done
 * observer.disconnect()
 * ```
 */
export function createPerformanceObserver(
  config: PerformanceObserverConfig
): PerformanceObserver {
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.entryType === 'resource') {
        const resourceEntry = entry as PerformanceResourceTiming
        // Apply filter if provided, otherwise include all entries
        if (!config.filter || config.filter(resourceEntry)) {
          config.onEntry(resourceEntry)
        }
      }
    }
  })

  // Observe resource timing entries, including buffered (historical) entries
  observer.observe({ type: 'resource', buffered: true })

  return observer
}

/**
 * Gets the resource type from an initiator type.
 *
 * Maps PerformanceResourceTiming.initiatorType to a normalized resource type.
 *
 * @param initiatorType - The initiator type from the resource timing entry
 * @returns Normalized resource type string
 */
export function getResourceType(initiatorType: string): string {
  switch (initiatorType) {
    case 'link':
    case 'css':
      return 'stylesheet'
    case 'script':
      return 'script'
    case 'img':
    case 'image':
      return 'image'
    case 'xmlhttprequest':
    case 'fetch':
      return 'xhr'
    case 'video':
    case 'audio':
      return 'media'
    case 'font':
      return 'font'
    case 'iframe':
      return 'document'
    case 'beacon':
      return 'beacon'
    default:
      return 'other'
  }
}

/**
 * Calculates timing breakdown from a PerformanceResourceTiming entry.
 *
 * Provides a structured breakdown of DNS, connect, TTFB, and download times.
 *
 * @param entry - The resource timing entry
 * @returns Object with timing breakdowns in milliseconds
 */
export function calculateTimingBreakdown(entry: PerformanceResourceTiming): {
  dnsTime: number
  connectTime: number
  tlsTime: number
  ttfb: number
  downloadTime: number
  blockedTime: number
  totalTime: number
} {
  return {
    dnsTime: entry.domainLookupEnd - entry.domainLookupStart,
    connectTime: entry.connectEnd - entry.connectStart,
    tlsTime: entry.secureConnectionStart > 0
      ? entry.connectEnd - entry.secureConnectionStart
      : 0,
    ttfb: entry.responseStart - entry.requestStart,
    downloadTime: entry.responseEnd - entry.responseStart,
    blockedTime: entry.domainLookupStart - entry.startTime,
    totalTime: entry.duration,
  }
}
