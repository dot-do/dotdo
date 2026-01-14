/**
 * API Request Analytics Transformer
 *
 * Transforms API request/response analytics to the unified event schema.
 *
 * Field mappings:
 * - method -> http_method
 * - url -> http_url, http_host, http_path, http_query
 * - status -> http_status, status_code
 * - status -> outcome (2xx=success, 4xx=client_error, 5xx=server_error)
 * - requestSize -> http_request_size
 * - responseSize -> http_response_size
 * - duration -> duration_ms
 * - ttfb -> snippet_ttfb (reuse column)
 * - protocol -> http_protocol
 * - cache status -> snippet_cache_state (reuse column)
 * - requestId -> correlation_id
 * - Sets event_type to 'trace'
 * - Sets event_name to '{method} {path}'
 *
 * @module db/streams/transformers/api-request
 */

import { createUnifiedEvent } from '../../../types/unified-event'
import type { UnifiedEvent } from '../../../types/unified-event'

// ============================================================================
// Input Interface
// ============================================================================

/**
 * API request event input format.
 * Represents raw API request/response analytics data.
 */
export interface ApiRequestEvent {
  /** HTTP method (GET, POST, PUT, DELETE, etc.) */
  method: string
  /** Full request URL including query string */
  url: string
  /** HTTP response status code */
  status: number
  /** Request body size in bytes */
  requestSize?: number
  /** Response body size in bytes */
  responseSize?: number
  /** Total request duration in milliseconds */
  duration: number
  /** Time to first byte in milliseconds */
  ttfb?: number
  /** HTTP protocol version (HTTP/1.1, HTTP/2, etc.) */
  protocol?: string
  /** Cache status */
  cache?: 'HIT' | 'MISS' | 'BYPASS' | 'STALE'
  /** Request identifier for correlation */
  requestId?: string
  /** Timestamp when the request occurred */
  timestamp?: Date
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Maps HTTP status code to outcome classification.
 *
 * @param status - HTTP status code
 * @returns Outcome classification: 'success', 'client_error', 'server_error', or 'unknown'
 *
 * @example
 * ```typescript
 * statusToOutcome(200)  // 'success'
 * statusToOutcome(404)  // 'client_error'
 * statusToOutcome(500)  // 'server_error'
 * statusToOutcome(301)  // 'unknown'
 * ```
 */
export function statusToOutcome(status: number): string {
  if (status >= 200 && status < 300) return 'success'
  if (status >= 400 && status < 500) return 'client_error'
  if (status >= 500) return 'server_error'
  return 'unknown'
}

// ============================================================================
// Main Transformer
// ============================================================================

/**
 * Transforms an API request event to a UnifiedEvent.
 *
 * @param req - API request event to transform
 * @param ns - Namespace identifier for the event
 * @returns UnifiedEvent with all fields populated
 *
 * @example
 * ```typescript
 * const event = transformApiRequest({
 *   method: 'GET',
 *   url: 'https://api.example.com/users?page=1',
 *   status: 200,
 *   duration: 150,
 *   ttfb: 50,
 *   cache: 'HIT',
 * }, 'production')
 *
 * // Result:
 * // {
 * //   event_type: 'trace',
 * //   event_name: 'GET /users',
 * //   http_method: 'GET',
 * //   http_url: 'https://api.example.com/users?page=1',
 * //   http_host: 'api.example.com',
 * //   http_path: '/users',
 * //   http_query: '?page=1',
 * //   http_status: 200,
 * //   outcome: 'success',
 * //   duration_ms: 150,
 * //   snippet_ttfb: 50,
 * //   snippet_cache_state: 'hit',
 * //   ...
 * // }
 * ```
 */
export function transformApiRequest(req: ApiRequestEvent, ns: string): UnifiedEvent {
  const url = new URL(req.url)
  const timestamp = req.timestamp ?? new Date()

  return createUnifiedEvent({
    // Core identity
    id: crypto.randomUUID(),
    event_type: 'trace',
    event_name: `${req.method} ${url.pathname}`,
    ns,

    // Causality chain
    correlation_id: req.requestId ?? null,

    // HTTP context
    http_method: req.method,
    http_url: req.url,
    http_host: url.host,
    http_path: url.pathname,
    http_query: url.search || null,
    http_status: req.status,
    http_protocol: req.protocol ?? null,
    http_request_size: req.requestSize ?? null,
    http_response_size: req.responseSize ?? null,

    // Outcome
    outcome: statusToOutcome(req.status),
    status_code: req.status,

    // Timing
    duration_ms: req.duration,
    timestamp: timestamp.toISOString(),

    // Reused columns (SnippetProxy)
    snippet_ttfb: req.ttfb ?? null,
    snippet_cache_state: req.cache?.toLowerCase() ?? null,
  })
}
