import { describe, it, expect, beforeAll } from 'vitest'

/**
 * Snippet Transformer Tests
 *
 * These tests verify the transformation of browser PerformanceResourceTiming
 * events (captured by snippet proxy) into the UnifiedEvent schema.
 *
 * This is RED phase TDD - tests should FAIL until the snippet transformer
 * is implemented in db/streams/transformers/snippet.ts.
 *
 * The snippet proxy captures:
 * - Resource timing from Performance API (PerformanceResourceTiming)
 * - Session and request context
 * - Network timing breakdown (DNS, connect, TTFB, download)
 *
 * Implementation requirements:
 * - transformSnippet function exported from db/streams/transformers/snippet.ts
 * - SnippetEvent interface exported
 * - Maps PerformanceResourceTiming fields to UnifiedEvent schema
 */

import type { UnifiedEvent } from '../../../../types/unified-event'

// ============================================================================
// Input Types (PerformanceResourceTiming-based)
// ============================================================================

interface SnippetEvent {
  // From PerformanceResourceTiming
  name: string // URL
  initiatorType: string // fetch, xhr, script, css, img, etc.
  startTime: number
  duration: number

  // Timing breakdown
  domainLookupStart: number
  domainLookupEnd: number
  connectStart: number
  connectEnd: number
  requestStart: number
  responseStart: number
  responseEnd: number

  // Size
  transferSize: number
  encodedBodySize: number
  decodedBodySize: number

  // Context (added by snippet)
  sessionId: string
  requestId?: string // X-Request-ID if injected
  pageUrl: string
  timestamp: number
}

// ============================================================================
// Dynamic Import for RED Phase TDD
// ============================================================================

let transformSnippet:
  | ((event: SnippetEvent, ns: string) => UnifiedEvent)
  | undefined

beforeAll(async () => {
  try {
    const module = await import('../snippet')
    transformSnippet = module.transformSnippet
  } catch {
    // Module doesn't exist yet - this is expected in RED phase
  }
})

// ============================================================================
// Helper: Create Test Event
// ============================================================================

function createTestEvent(overrides: Partial<SnippetEvent> = {}): SnippetEvent {
  return {
    name: 'https://api.example.com/users?page=1',
    initiatorType: 'fetch',
    startTime: 100.5,
    duration: 250.3,

    domainLookupStart: 105.0,
    domainLookupEnd: 110.0,
    connectStart: 110.0,
    connectEnd: 130.0,
    requestStart: 130.0,
    responseStart: 180.0,
    responseEnd: 350.8,

    transferSize: 2048,
    encodedBodySize: 1800,
    decodedBodySize: 4096,

    sessionId: 'sess_abc123',
    requestId: 'req_xyz789',
    pageUrl: 'https://app.example.com/dashboard',
    timestamp: 1705329045123,

    ...overrides,
  }
}

// ============================================================================
// Export Tests
// ============================================================================

describe('Snippet Transformer Export', () => {
  it('transformSnippet function is exported', () => {
    expect(
      transformSnippet,
      'transformSnippet should be exported from db/streams/transformers/snippet.ts'
    ).toBeDefined()
    expect(typeof transformSnippet).toBe('function')
  })
})

// ============================================================================
// URL Mapping Tests
// ============================================================================

describe('URL Mapping (name -> http_url, http_host, http_path)', () => {
  it('maps name (URL) to http_url', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent()
    const result = transformSnippet!(event, 'test-ns')

    expect(result.http_url).toBe('https://api.example.com/users?page=1')
  })

  it('maps URL host to http_host', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent()
    const result = transformSnippet!(event, 'test-ns')

    expect(result.http_host).toBe('api.example.com')
  })

  it('maps URL path to http_path', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent()
    const result = transformSnippet!(event, 'test-ns')

    expect(result.http_path).toBe('/users')
  })

  it('maps URL query to http_query', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent()
    const result = transformSnippet!(event, 'test-ns')

    expect(result.http_query).toBe('?page=1')
  })

  it('handles URL without query string', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({ name: 'https://api.example.com/users' })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.http_query).toBeNull()
  })

  it('handles URL with port', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({ name: 'https://api.example.com:8443/users' })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.http_host).toBe('api.example.com:8443')
  })
})

// ============================================================================
// Initiator Type Mapping Tests
// ============================================================================

describe('Initiator Type Mapping', () => {
  it('maps initiatorType to snippet_initiator', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({ initiatorType: 'fetch' })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_initiator).toBe('fetch')
  })

  it('maps initiatorType to snippet_resource_type', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({ initiatorType: 'script' })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_resource_type).toBe('script')
  })

  it('handles xhr initiator type', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({ initiatorType: 'xhr' })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_initiator).toBe('xhr')
    expect(result.snippet_resource_type).toBe('xhr')
  })

  it('handles css initiator type', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({ initiatorType: 'css' })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_initiator).toBe('css')
  })

  it('handles img initiator type', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({ initiatorType: 'img' })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_initiator).toBe('img')
  })
})

// ============================================================================
// Start Time Mapping Tests
// ============================================================================

describe('Start Time Mapping', () => {
  it('maps startTime to snippet_start_time', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({ startTime: 150.75 })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_start_time).toBe(150.75)
  })

  it('preserves decimal precision', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({ startTime: 123.456789 })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_start_time).toBe(123.456789)
  })
})

// ============================================================================
// DNS Time Calculation Tests
// ============================================================================

describe('DNS Time Calculation (domainLookupEnd - domainLookupStart)', () => {
  it('calculates snippet_dns_time correctly', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({
      domainLookupStart: 100.0,
      domainLookupEnd: 125.0,
    })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_dns_time).toBe(25.0)
  })

  it('returns 0 when DNS lookup is cached', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({
      domainLookupStart: 100.0,
      domainLookupEnd: 100.0,
    })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_dns_time).toBe(0)
  })

  it('handles fractional milliseconds', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({
      domainLookupStart: 100.123,
      domainLookupEnd: 105.456,
    })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_dns_time).toBeCloseTo(5.333, 3)
  })
})

// ============================================================================
// Connect Time Calculation Tests
// ============================================================================

describe('Connect Time Calculation (connectEnd - connectStart)', () => {
  it('calculates snippet_connect_time correctly', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({
      connectStart: 110.0,
      connectEnd: 145.0,
    })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_connect_time).toBe(35.0)
  })

  it('returns 0 when connection is reused', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({
      connectStart: 110.0,
      connectEnd: 110.0,
    })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_connect_time).toBe(0)
  })

  it('includes TLS handshake time', () => {
    expect(transformSnippet).toBeDefined()
    // For HTTPS, connectEnd includes secureConnectionStart to end
    const event = createTestEvent({
      connectStart: 100.0,
      connectEnd: 180.0, // Includes TLS negotiation
    })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_connect_time).toBe(80.0)
  })
})

// ============================================================================
// TTFB Calculation Tests
// ============================================================================

describe('TTFB Calculation (responseStart - requestStart)', () => {
  it('calculates snippet_ttfb correctly', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({
      requestStart: 150.0,
      responseStart: 210.0,
    })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_ttfb).toBe(60.0)
  })

  it('handles fast responses', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({
      requestStart: 100.0,
      responseStart: 105.0,
    })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_ttfb).toBe(5.0)
  })

  it('handles slow responses', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({
      requestStart: 100.0,
      responseStart: 2100.0, // 2 second TTFB
    })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_ttfb).toBe(2000.0)
  })
})

// ============================================================================
// Download Time Calculation Tests
// ============================================================================

describe('Download Time Calculation (responseEnd - responseStart)', () => {
  it('calculates snippet_download_time correctly', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({
      responseStart: 200.0,
      responseEnd: 350.0,
    })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_download_time).toBe(150.0)
  })

  it('handles small responses', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({
      responseStart: 200.0,
      responseEnd: 201.0,
    })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_download_time).toBe(1.0)
  })

  it('handles large downloads', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({
      responseStart: 200.0,
      responseEnd: 5200.0, // 5 second download
    })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_download_time).toBe(5000.0)
  })
})

// ============================================================================
// Blocked Time Calculation Tests
// ============================================================================

describe('Blocked Time Calculation (domainLookupStart - startTime)', () => {
  it('calculates snippet_blocked_time correctly', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({
      startTime: 100.0,
      domainLookupStart: 115.0,
    })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_blocked_time).toBe(15.0)
  })

  it('returns 0 when no blocking', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({
      startTime: 100.0,
      domainLookupStart: 100.0,
    })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_blocked_time).toBe(0)
  })

  it('captures connection queue time', () => {
    expect(transformSnippet).toBeDefined()
    // When browser has max connections, requests queue
    const event = createTestEvent({
      startTime: 50.0,
      domainLookupStart: 250.0, // Waited 200ms for connection slot
    })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_blocked_time).toBe(200.0)
  })
})

// ============================================================================
// Size Mapping Tests
// ============================================================================

describe('Size Mapping', () => {
  it('maps transferSize to snippet_transfer_size', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({ transferSize: 4096 })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_transfer_size).toBe(4096)
  })

  it('maps decodedBodySize to snippet_decoded_size', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({ decodedBodySize: 16384 })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_decoded_size).toBe(16384)
  })

  it('handles zero transfer size (cached)', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({ transferSize: 0 })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_transfer_size).toBe(0)
  })
})

// ============================================================================
// Cache Detection Tests
// ============================================================================

describe('Cache Detection (transferSize === 0 -> local)', () => {
  it('detects local cache when transferSize is 0', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({ transferSize: 0 })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_cache_state).toBe('local')
  })

  it('detects network request when transferSize > 0', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({ transferSize: 1024 })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_cache_state).toBe('network')
  })

  it('detects local cache for small cached response', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({
      transferSize: 0,
      decodedBodySize: 5000, // Body exists, but was cached
    })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_cache_state).toBe('local')
  })
})

// ============================================================================
// Session ID Mapping Tests
// ============================================================================

describe('Session ID Mapping', () => {
  it('maps sessionId to session_id', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({ sessionId: 'sess_abc123' })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.session_id).toBe('sess_abc123')
  })

  it('maps sessionId to trace_id', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({ sessionId: 'sess_xyz789' })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.trace_id).toBe('sess_xyz789')
  })
})

// ============================================================================
// Request ID Mapping Tests
// ============================================================================

describe('Request ID Mapping', () => {
  it('maps requestId to correlation_id', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({ requestId: 'req_abc123' })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.correlation_id).toBe('req_abc123')
  })

  it('maps requestId to snippet_request_id', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({ requestId: 'req_xyz789' })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.snippet_request_id).toBe('req_xyz789')
  })

  it('handles missing requestId', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent()
    delete (event as Partial<SnippetEvent>).requestId
    const result = transformSnippet!(event, 'test-ns')

    expect(result.correlation_id).toBeNull()
    expect(result.snippet_request_id).toBeNull()
  })
})

// ============================================================================
// Event Type Tests
// ============================================================================

describe('Event Type', () => {
  it('sets event_type to "snippet"', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent()
    const result = transformSnippet!(event, 'test-ns')

    expect(result.event_type).toBe('snippet')
  })
})

// ============================================================================
// Core Identity Tests
// ============================================================================

describe('Core Identity Fields', () => {
  it('generates unique id', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent()
    const result1 = transformSnippet!(event, 'test-ns')
    const result2 = transformSnippet!(event, 'test-ns')

    expect(result1.id).toBeDefined()
    expect(result2.id).toBeDefined()
    expect(result1.id).not.toBe(result2.id)
  })

  it('sets ns from parameter', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent()
    const result = transformSnippet!(event, 'my-namespace')

    expect(result.ns).toBe('my-namespace')
  })

  it('generates event_name from initiatorType', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({ initiatorType: 'fetch' })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.event_name).toBe('fetch.request')
  })
})

// ============================================================================
// Duration Mapping Tests
// ============================================================================

describe('Duration Mapping', () => {
  it('maps duration to duration_ms', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({ duration: 250.5 })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.duration_ms).toBe(250.5)
  })
})

// ============================================================================
// Timestamp Mapping Tests
// ============================================================================

describe('Timestamp Mapping', () => {
  it('converts timestamp to ISO string', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({ timestamp: 1705329045123 })
    const result = transformSnippet!(event, 'test-ns')

    expect(result.timestamp).toBe('2024-01-15T14:30:45.123Z')
  })
})

// ============================================================================
// Page URL Mapping Tests
// ============================================================================

describe('Page URL Mapping', () => {
  it('maps pageUrl to page_url field', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent({ pageUrl: 'https://app.example.com/dashboard' })
    const result = transformSnippet!(event, 'test-ns')

    // Note: page_url is not in WebMarketing interface but we can use data payload
    // or check if it's mapped elsewhere
    expect(result.http_referrer ?? (result.data as Record<string, unknown>)?.page_url).toBeDefined()
  })
})

// ============================================================================
// Complete Transform Tests
// ============================================================================

describe('Complete Transform', () => {
  it('transforms complete snippet event', () => {
    expect(transformSnippet).toBeDefined()
    const event = createTestEvent()
    const result = transformSnippet!(event, 'production')

    // Core Identity
    expect(result.id).toBeDefined()
    expect(result.event_type).toBe('snippet')
    expect(result.event_name).toBe('fetch.request')
    expect(result.ns).toBe('production')

    // Causality
    expect(result.trace_id).toBe('sess_abc123')
    expect(result.session_id).toBe('sess_abc123')
    expect(result.correlation_id).toBe('req_xyz789')

    // HTTP
    expect(result.http_url).toBe('https://api.example.com/users?page=1')
    expect(result.http_host).toBe('api.example.com')
    expect(result.http_path).toBe('/users')
    expect(result.http_query).toBe('?page=1')

    // Timing
    expect(result.duration_ms).toBe(250.3)
    expect(result.snippet_start_time).toBe(100.5)
    expect(result.snippet_dns_time).toBe(5.0)
    expect(result.snippet_connect_time).toBe(20.0)
    expect(result.snippet_ttfb).toBe(50.0)
    expect(result.snippet_download_time).toBeCloseTo(170.8, 1)
    expect(result.snippet_blocked_time).toBe(4.5)

    // Size
    expect(result.snippet_transfer_size).toBe(2048)
    expect(result.snippet_decoded_size).toBe(4096)
    expect(result.snippet_cache_state).toBe('network')

    // Request ID
    expect(result.snippet_request_id).toBe('req_xyz789')
    expect(result.snippet_initiator).toBe('fetch')
    expect(result.snippet_resource_type).toBe('fetch')
  })

  it('handles minimal event', () => {
    expect(transformSnippet).toBeDefined()
    const event: SnippetEvent = {
      name: 'https://cdn.example.com/image.png',
      initiatorType: 'img',
      startTime: 0,
      duration: 50,
      domainLookupStart: 0,
      domainLookupEnd: 0,
      connectStart: 0,
      connectEnd: 0,
      requestStart: 0,
      responseStart: 25,
      responseEnd: 50,
      transferSize: 0,
      encodedBodySize: 0,
      decodedBodySize: 1024,
      sessionId: 'sess_minimal',
      pageUrl: 'https://example.com',
      timestamp: Date.now(),
    }

    const result = transformSnippet!(event, 'test')

    expect(result.event_type).toBe('snippet')
    expect(result.snippet_cache_state).toBe('local')
    expect(result.correlation_id).toBeNull()
    expect(result.snippet_request_id).toBeNull()
  })
})
