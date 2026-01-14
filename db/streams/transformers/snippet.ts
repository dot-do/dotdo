/**
 * Snippet Proxy Transformer
 *
 * Transforms browser PerformanceResourceTiming events captured by the
 * snippet proxy into the UnifiedEvent schema for unified observability.
 *
 * The snippet proxy collects:
 * - Resource timing from the Performance API
 * - Network timing breakdown (DNS, connect, TTFB, download)
 * - Transfer and decoded sizes
 * - Session and request context
 *
 * @module db/streams/transformers/snippet
 */

import { createUnifiedEvent } from '../../../types/unified-event'
import type { UnifiedEvent } from '../../../types/unified-event'

/**
 * Input event from browser snippet proxy.
 * Based on PerformanceResourceTiming with additional context.
 */
export interface SnippetEvent {
  /** Full URL of the resource (from PerformanceResourceTiming.name) */
  name: string
  /** Request initiator type: fetch, xhr, script, css, img, link, etc. */
  initiatorType: string
  /** Time when the resource fetch started (relative to navigation start) */
  startTime: number
  /** Total duration of the resource fetch */
  duration: number

  /** Time before DNS lookup started */
  domainLookupStart: number
  /** Time when DNS lookup completed */
  domainLookupEnd: number
  /** Time when connection establishment started */
  connectStart: number
  /** Time when connection was established (includes TLS for HTTPS) */
  connectEnd: number
  /** Time when request was sent */
  requestStart: number
  /** Time when first byte of response arrived */
  responseStart: number
  /** Time when response was fully received */
  responseEnd: number

  /** Bytes transferred over the network (0 if cached) */
  transferSize: number
  /** Compressed response body size */
  encodedBodySize: number
  /** Uncompressed response body size */
  decodedBodySize: number

  /** User session identifier (from snippet context) */
  sessionId: string
  /** X-Request-ID header value if injected by snippet */
  requestId?: string
  /** URL of the page that initiated the request */
  pageUrl: string
  /** Unix timestamp in milliseconds when event was captured */
  timestamp: number
}

/**
 * Transforms a SnippetEvent from the browser into a UnifiedEvent.
 *
 * Mappings:
 * - name (URL) -> http_url, http_host, http_path, http_query
 * - initiatorType -> snippet_initiator, snippet_resource_type
 * - startTime -> snippet_start_time
 * - Timing calculations for DNS, connect, TTFB, download, blocked
 * - Size mappings for transfer and decoded
 * - Cache detection based on transferSize
 * - Session/request ID correlation
 *
 * @param event - The snippet event from browser
 * @param ns - Namespace for the event
 * @returns Transformed UnifiedEvent
 */
export function transformSnippet(event: SnippetEvent, ns: string): UnifiedEvent {
  // Parse URL for HTTP context
  const url = new URL(event.name)

  // Calculate timing breakdowns
  const dnsTime = event.domainLookupEnd - event.domainLookupStart
  const connectTime = event.connectEnd - event.connectStart
  const ttfb = event.responseStart - event.requestStart
  const downloadTime = event.responseEnd - event.responseStart
  const blockedTime = event.domainLookupStart - event.startTime

  // Detect cache state based on transferSize
  const cacheState = event.transferSize === 0 ? 'local' : 'network'

  // Convert timestamp to ISO string
  const timestamp = new Date(event.timestamp).toISOString()

  return createUnifiedEvent({
    // Core Identity
    id: crypto.randomUUID(),
    event_type: 'snippet',
    event_name: `${event.initiatorType}.request`,
    ns,

    // Causality Chain
    trace_id: event.sessionId,
    session_id: event.sessionId,
    correlation_id: event.requestId ?? null,

    // HTTP Context
    http_url: event.name,
    http_host: url.host,
    http_path: url.pathname,
    http_query: url.search || null,
    http_referrer: event.pageUrl,

    // Timing
    timestamp,
    duration_ms: event.duration,

    // Snippet-specific fields
    snippet_initiator: event.initiatorType,
    snippet_request_id: event.requestId ?? null,
    snippet_start_time: event.startTime,
    snippet_dns_time: dnsTime,
    snippet_connect_time: connectTime,
    snippet_ttfb: ttfb,
    snippet_download_time: downloadTime,
    snippet_blocked_time: blockedTime,
    snippet_resource_type: event.initiatorType,
    snippet_transfer_size: event.transferSize,
    snippet_decoded_size: event.decodedBodySize,
    snippet_cache_state: cacheState,

    // Store page URL in data payload for retrieval
    data: {
      page_url: event.pageUrl,
    },
  })
}
