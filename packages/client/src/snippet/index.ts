/**
 * dotdo Client Snippet
 *
 * Client-side snippet for capturing frontend network timing and
 * correlating with backend traces. Integrates with the SnippetProxy
 * transformer in the unified event schema.
 *
 * Features:
 * - Performance Observer for resource timing capture
 * - Fetch and XHR instrumentation for request ID injection
 * - Session ID management for trace correlation
 * - Efficient batching and flushing to backend
 *
 * @module @dotdo/client/snippet
 */

import {
  createPerformanceObserver,
  calculateTimingBreakdown,
  getResourceType,
  type PerformanceObserverConfig,
} from './performance-observer'
import {
  instrumentFetch,
  instrumentXHR,
  instrumentNetwork,
  type InstrumentNetworkOptions,
} from './fetch-interceptor'
import {
  getOrCreateSessionId,
  getSessionId,
  setSessionId,
  clearSessionId,
  hasSessionId,
} from './session'

// Re-export all submodules
export {
  createPerformanceObserver,
  calculateTimingBreakdown,
  getResourceType,
  instrumentFetch,
  instrumentXHR,
  instrumentNetwork,
  getOrCreateSessionId,
  getSessionId,
  setSessionId,
  clearSessionId,
  hasSessionId,
}

export type { PerformanceObserverConfig, InstrumentNetworkOptions }

/**
 * Snippet event matching the SnippetEvent interface from the transformer.
 * This is what gets sent to the backend endpoint.
 */
export interface SnippetEvent {
  /** Full URL of the resource */
  name: string
  /** Request initiator type */
  initiatorType: string
  /** Start time relative to navigation start */
  startTime: number
  /** Total duration */
  duration: number
  /** DNS lookup start */
  domainLookupStart: number
  /** DNS lookup end */
  domainLookupEnd: number
  /** Connection start */
  connectStart: number
  /** Connection end */
  connectEnd: number
  /** Request start */
  requestStart: number
  /** Response start (first byte) */
  responseStart: number
  /** Response end */
  responseEnd: number
  /** Transfer size in bytes */
  transferSize: number
  /** Encoded body size */
  encodedBodySize: number
  /** Decoded body size */
  decodedBodySize: number
  /** Session ID */
  sessionId: string
  /** Request ID (if injected) */
  requestId?: string
  /** Page URL */
  pageUrl: string
  /** Capture timestamp */
  timestamp: number
}

/**
 * Configuration for the snippet.
 */
export interface SnippetConfig {
  /** Backend endpoint URL to send events to */
  endpoint: string
  /** Namespace identifier for events */
  namespace: string
  /** Whether to inject request IDs into fetch/XHR (default: false) */
  injectRequestIds?: boolean
  /** Number of events to batch before flushing (default: 10) */
  batchSize?: number
  /** Milliseconds between automatic flushes (default: 5000) */
  flushInterval?: number
  /** Filter function to include/exclude resources */
  filter?: (entry: PerformanceResourceTiming) => boolean
  /** Callback when batch is flushed */
  onFlush?: (events: SnippetEvent[], response: Response | null) => void
  /** Callback on flush error */
  onError?: (error: Error, events: SnippetEvent[]) => void
  /** Whether to use beacon API for unload events (default: true) */
  useBeacon?: boolean
  /** Additional headers to include in requests */
  headers?: Record<string, string>
}

/**
 * Snippet instance returned by initSnippet.
 */
export interface SnippetInstance {
  /** Manually flush pending events */
  flush: () => Promise<void>
  /** Get the session ID */
  getSessionId: () => string
  /** Get current batch size */
  getPendingCount: () => number
  /** Stop the snippet and cleanup */
  destroy: () => void
}

/**
 * Creates a SnippetEvent from a PerformanceResourceTiming entry.
 */
function createSnippetEvent(
  entry: PerformanceResourceTiming,
  sessionId: string,
  requestId?: string
): SnippetEvent {
  return {
    name: entry.name,
    initiatorType: entry.initiatorType,
    startTime: entry.startTime,
    duration: entry.duration,
    domainLookupStart: entry.domainLookupStart,
    domainLookupEnd: entry.domainLookupEnd,
    connectStart: entry.connectStart,
    connectEnd: entry.connectEnd,
    requestStart: entry.requestStart,
    responseStart: entry.responseStart,
    responseEnd: entry.responseEnd,
    transferSize: entry.transferSize,
    encodedBodySize: entry.encodedBodySize,
    decodedBodySize: entry.decodedBodySize,
    sessionId,
    requestId,
    pageUrl: typeof window !== 'undefined' ? window.location.href : '',
    timestamp: Date.now(),
  }
}

/**
 * Initializes the snippet for capturing frontend network timing.
 *
 * Sets up a PerformanceObserver to capture resource timing entries,
 * optionally instruments fetch/XHR for request ID injection, and
 * batches events for efficient transmission to the backend.
 *
 * @param config - Snippet configuration
 * @returns Snippet instance with control methods
 *
 * @example
 * ```typescript
 * import { initSnippet } from '@dotdo/client/snippet'
 *
 * const snippet = initSnippet({
 *   endpoint: 'https://api.example.com/events',
 *   namespace: 'my-app',
 *   injectRequestIds: true,
 *   batchSize: 10,
 *   flushInterval: 5000,
 *   filter: (entry) => entry.name.includes('api.example.com')
 * })
 *
 * // Get the session ID for other purposes
 * console.log('Session:', snippet.getSessionId())
 *
 * // Check pending events
 * console.log('Pending:', snippet.getPendingCount())
 *
 * // Force a flush
 * await snippet.flush()
 *
 * // Cleanup when done
 * snippet.destroy()
 * ```
 */
export function initSnippet(config: SnippetConfig): SnippetInstance {
  // Get or create session ID
  const sessionId = getOrCreateSessionId()

  // Event batch
  const batch: SnippetEvent[] = []

  // Configuration with defaults
  const batchSize = config.batchSize ?? 10
  const flushInterval = config.flushInterval ?? 5000
  const useBeacon = config.useBeacon ?? true

  // Track destroyed state
  let destroyed = false

  // Flush the current batch to the endpoint
  async function flush(): Promise<void> {
    if (batch.length === 0 || destroyed) {
      return
    }

    // Extract events to send
    const eventsToSend = batch.splice(0, batch.length)

    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId,
          ...(config.headers || {}),
        },
        body: JSON.stringify({
          events: eventsToSend,
          namespace: config.namespace,
        }),
      })

      config.onFlush?.(eventsToSend, response)
    } catch (error) {
      // On error, put events back in the batch for retry
      batch.unshift(...eventsToSend)
      config.onError?.(error as Error, eventsToSend)
    }
  }

  // Check if we should flush based on batch size
  function maybeFlush(): void {
    if (batch.length >= batchSize) {
      // Use void to avoid unhandled promise
      void flush()
    }
  }

  // Set up performance observer
  const observer = createPerformanceObserver({
    sessionId,
    filter: config.filter,
    onEntry: (entry) => {
      // Extract request ID from server timing if available
      // Server can echo back X-Request-ID via Server-Timing header
      let requestId: string | undefined
      if (entry.serverTiming) {
        const requestIdTiming = entry.serverTiming.find(
          (t) => t.name === 'request-id' || t.name === 'rid'
        )
        if (requestIdTiming?.description) {
          requestId = requestIdTiming.description
        }
      }

      const event = createSnippetEvent(entry, sessionId, requestId)
      batch.push(event)
      maybeFlush()
    },
  })

  // Set up network instrumentation if requested
  let restoreNetwork: (() => void) | null = null
  if (config.injectRequestIds) {
    restoreNetwork = instrumentNetwork({ sessionId })
  }

  // Set up periodic flush
  const flushIntervalId = setInterval(() => {
    void flush()
  }, flushInterval)

  // Set up unload handler for final flush
  function handleUnload(): void {
    if (batch.length > 0 && useBeacon && typeof navigator.sendBeacon === 'function') {
      // Use sendBeacon for reliability on page unload
      const data = JSON.stringify({
        events: batch,
        namespace: config.namespace,
      })
      navigator.sendBeacon(config.endpoint, data)
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        handleUnload()
      }
    })
    window.addEventListener('pagehide', handleUnload)
  }

  // Return control interface
  return {
    flush,
    getSessionId: () => sessionId,
    getPendingCount: () => batch.length,
    destroy: () => {
      destroyed = true
      observer.disconnect()
      restoreNetwork?.()
      clearInterval(flushIntervalId)

      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', handleUnload)
      }
    },
  }
}

// Default export for convenience
export default initSnippet
