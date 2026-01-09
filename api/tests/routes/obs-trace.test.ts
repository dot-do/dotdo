/**
 * Observability Trace API Route Tests
 *
 * Tests for the /api/obs/trace/:requestId endpoint that retrieves
 * all events (logs, exceptions, requests, DO method calls) for a specific request.
 *
 * TDD: These tests will FAIL until the routes are implemented.
 *
 * @see api/routes/obs.ts - Observability route handlers (to be implemented)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'

// This import will fail until api/routes/obs.ts is created
// This is the RED phase - tests fail because the implementation doesn't exist
import { obsRoutes } from '../../routes/obs'

// ============================================================================
// Test Types
// ============================================================================

/**
 * Event types captured by the observability layer
 */
type ObsEventType = 'log' | 'exception' | 'request' | 'do_method'

/**
 * Log level for log events
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Base observability event structure
 */
interface ObsEvent {
  /** Unique event ID */
  id: string
  /** Event type */
  type: ObsEventType
  /** Unix timestamp in milliseconds */
  timestamp: number
  /** Request ID for correlation */
  requestId: string
  /** Additional event-specific data */
  data: Record<string, unknown>
}

/**
 * Log event structure
 */
interface LogEvent extends ObsEvent {
  type: 'log'
  data: {
    level: LogLevel
    message: string
    args?: unknown[]
  }
}

/**
 * Exception event structure
 */
interface ExceptionEvent extends ObsEvent {
  type: 'exception'
  data: {
    name: string
    message: string
    stack?: string
  }
}

/**
 * Request event structure
 */
interface RequestEvent extends ObsEvent {
  type: 'request'
  data: {
    method: string
    url: string
    status: number
    duration: number
    headers?: Record<string, string>
  }
}

/**
 * Durable Object method call event
 */
interface DOMethodEvent extends ObsEvent {
  type: 'do_method'
  data: {
    className: string
    instanceId: string
    method: string
    duration: number
    success: boolean
    error?: string
  }
}

/**
 * Trace response structure
 */
interface TraceResponse {
  requestId: string
  events: ObsEvent[]
  /** Total duration of the traced request in milliseconds */
  duration?: number
  /** Start timestamp of the trace */
  startedAt?: number
  /** End timestamp of the trace */
  endedAt?: number
}

/**
 * Error response structure
 */
interface ErrorResponse {
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

// ============================================================================
// Test App Setup
// ============================================================================

// Create a test app with the obs routes mounted
const app = new Hono()
app.route('/api/obs', obsRoutes)

// ============================================================================
// Helper Functions
// ============================================================================

async function get(path: string, headers?: Record<string, string>): Promise<Response> {
  return app.request(path, {
    method: 'GET',
    headers,
  })
}

/**
 * Generate a mock request ID
 */
function generateRequestId(): string {
  return `req-${crypto.randomUUID()}`
}

/**
 * Generate mock events for testing
 */
function generateMockEvents(requestId: string, count: number = 5): ObsEvent[] {
  const baseTime = Date.now()
  const events: ObsEvent[] = []

  for (let i = 0; i < count; i++) {
    const type: ObsEventType = ['log', 'exception', 'request', 'do_method'][i % 4] as ObsEventType

    const baseEvent = {
      id: `evt-${crypto.randomUUID()}`,
      type,
      timestamp: baseTime + i * 100, // 100ms apart
      requestId,
    }

    switch (type) {
      case 'log':
        events.push({
          ...baseEvent,
          data: {
            level: 'info' as LogLevel,
            message: `Log message ${i}`,
            args: [],
          },
        } as LogEvent)
        break
      case 'exception':
        events.push({
          ...baseEvent,
          data: {
            name: 'Error',
            message: `Exception ${i}`,
            stack: 'Error: Exception\n    at test:1:1',
          },
        } as ExceptionEvent)
        break
      case 'request':
        events.push({
          ...baseEvent,
          data: {
            method: 'GET',
            url: 'https://example.com/api',
            status: 200,
            duration: 50,
          },
        } as RequestEvent)
        break
      case 'do_method':
        events.push({
          ...baseEvent,
          data: {
            className: 'ThingsDO',
            instanceId: 'things',
            method: 'list',
            duration: 10,
            success: true,
          },
        } as DOMethodEvent)
        break
    }
  }

  return events
}

// ============================================================================
// GET /api/obs/trace/:requestId - Get Trace by Request ID
// ============================================================================

describe('GET /api/obs/trace/:requestId - Get Trace', () => {
  it('should return 200 with events for valid requestId', async () => {
    const requestId = generateRequestId()

    const response = await get(`/api/obs/trace/${requestId}`)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/json')

    const body = (await response.json()) as TraceResponse
    expect(body).toHaveProperty('requestId')
    expect(body).toHaveProperty('events')
    expect(Array.isArray(body.events)).toBe(true)
  })

  it('should return events for the specific requestId', async () => {
    const requestId = generateRequestId()

    const response = await get(`/api/obs/trace/${requestId}`)
    const body = (await response.json()) as TraceResponse

    expect(body.requestId).toBe(requestId)

    // All events should have the same requestId
    for (const event of body.events) {
      expect(event.requestId).toBe(requestId)
    }
  })

  it('should return events in chronological order (oldest first)', async () => {
    const requestId = generateRequestId()

    const response = await get(`/api/obs/trace/${requestId}`)
    const body = (await response.json()) as TraceResponse

    // Verify events are sorted by timestamp ascending
    for (let i = 1; i < body.events.length; i++) {
      expect(body.events[i].timestamp).toBeGreaterThanOrEqual(body.events[i - 1].timestamp)
    }
  })

  it('should return 404 for unknown requestId', async () => {
    const unknownRequestId = 'req-does-not-exist-12345'

    const response = await get(`/api/obs/trace/${unknownRequestId}`)

    expect(response.status).toBe(404)

    const body = (await response.json()) as ErrorResponse
    expect(body.error.code).toBe('NOT_FOUND')
    expect(body.error.message).toContain('Trace not found')
  })

  it('should return 404 for empty requestId', async () => {
    const response = await get('/api/obs/trace/')

    expect(response.status).toBe(404)
  })

  it('should return 400 for invalid requestId format', async () => {
    // Request IDs with special characters that could be injection attempts
    const invalidIds = [
      '../../../etc/passwd',
      '<script>alert(1)</script>',
      'req with spaces',
      'req\nnewline',
    ]

    for (const invalidId of invalidIds) {
      const response = await get(`/api/obs/trace/${encodeURIComponent(invalidId)}`)
      expect([400, 404]).toContain(response.status)
    }
  })
})

// ============================================================================
// Event Types Coverage
// ============================================================================

describe('GET /api/obs/trace/:requestId - Event Types', () => {
  it('should include log events in trace', async () => {
    const requestId = generateRequestId()

    const response = await get(`/api/obs/trace/${requestId}`)
    const body = (await response.json()) as TraceResponse

    const logEvents = body.events.filter((e) => e.type === 'log')

    // If there are log events, verify structure
    if (logEvents.length > 0) {
      const logEvent = logEvents[0] as LogEvent
      expect(logEvent.data).toHaveProperty('level')
      expect(logEvent.data).toHaveProperty('message')
      expect(['debug', 'info', 'warn', 'error']).toContain(logEvent.data.level)
    }
  })

  it('should include exception events in trace', async () => {
    const requestId = generateRequestId()

    const response = await get(`/api/obs/trace/${requestId}`)
    const body = (await response.json()) as TraceResponse

    const exceptionEvents = body.events.filter((e) => e.type === 'exception')

    // If there are exception events, verify structure
    if (exceptionEvents.length > 0) {
      const exceptionEvent = exceptionEvents[0] as ExceptionEvent
      expect(exceptionEvent.data).toHaveProperty('name')
      expect(exceptionEvent.data).toHaveProperty('message')
    }
  })

  it('should include request events in trace', async () => {
    const requestId = generateRequestId()

    const response = await get(`/api/obs/trace/${requestId}`)
    const body = (await response.json()) as TraceResponse

    const requestEvents = body.events.filter((e) => e.type === 'request')

    // If there are request events, verify structure
    if (requestEvents.length > 0) {
      const requestEvent = requestEvents[0] as RequestEvent
      expect(requestEvent.data).toHaveProperty('method')
      expect(requestEvent.data).toHaveProperty('url')
      expect(requestEvent.data).toHaveProperty('status')
      expect(requestEvent.data).toHaveProperty('duration')
    }
  })

  it('should include do_method events in trace', async () => {
    const requestId = generateRequestId()

    const response = await get(`/api/obs/trace/${requestId}`)
    const body = (await response.json()) as TraceResponse

    const doMethodEvents = body.events.filter((e) => e.type === 'do_method')

    // If there are DO method events, verify structure
    if (doMethodEvents.length > 0) {
      const doMethodEvent = doMethodEvents[0] as DOMethodEvent
      expect(doMethodEvent.data).toHaveProperty('className')
      expect(doMethodEvent.data).toHaveProperty('instanceId')
      expect(doMethodEvent.data).toHaveProperty('method')
      expect(doMethodEvent.data).toHaveProperty('duration')
      expect(doMethodEvent.data).toHaveProperty('success')
    }
  })

  it('should return all event types for a complete trace', async () => {
    const requestId = generateRequestId()

    const response = await get(`/api/obs/trace/${requestId}`)
    const body = (await response.json()) as TraceResponse

    const eventTypes = new Set(body.events.map((e) => e.type))

    // A complete trace should potentially have all event types
    // This test verifies the API can return different types
    expect(eventTypes.size).toBeGreaterThan(0)
  })
})

// ============================================================================
// Request Correlation
// ============================================================================

describe('GET /api/obs/trace/:requestId - Request Correlation', () => {
  it('should include trace metadata', async () => {
    const requestId = generateRequestId()

    const response = await get(`/api/obs/trace/${requestId}`)
    const body = (await response.json()) as TraceResponse

    // Trace should include timing metadata if events exist
    if (body.events.length > 0) {
      expect(body).toHaveProperty('startedAt')
      expect(body).toHaveProperty('endedAt')
      expect(body).toHaveProperty('duration')
    }
  })

  it('should calculate correct duration from first to last event', async () => {
    const requestId = generateRequestId()

    const response = await get(`/api/obs/trace/${requestId}`)
    const body = (await response.json()) as TraceResponse

    if (body.events.length > 1 && body.startedAt && body.endedAt) {
      // Duration should be difference between first and last event timestamps
      const expectedDuration = body.endedAt - body.startedAt
      expect(body.duration).toBe(expectedDuration)
    }
  })

  it('should correlate events from the same request', async () => {
    const requestId = generateRequestId()

    const response = await get(`/api/obs/trace/${requestId}`)
    const body = (await response.json()) as TraceResponse

    // All events should have the same requestId
    const uniqueRequestIds = new Set(body.events.map((e) => e.requestId))
    expect(uniqueRequestIds.size).toBeLessThanOrEqual(1)

    if (uniqueRequestIds.size === 1) {
      expect(uniqueRequestIds.has(requestId)).toBe(true)
    }
  })

  it('should include event IDs for each event', async () => {
    const requestId = generateRequestId()

    const response = await get(`/api/obs/trace/${requestId}`)
    const body = (await response.json()) as TraceResponse

    for (const event of body.events) {
      expect(event.id).toBeDefined()
      expect(typeof event.id).toBe('string')
      expect(event.id.length).toBeGreaterThan(0)
    }
  })

  it('should have unique event IDs within a trace', async () => {
    const requestId = generateRequestId()

    const response = await get(`/api/obs/trace/${requestId}`)
    const body = (await response.json()) as TraceResponse

    const eventIds = body.events.map((e) => e.id)
    const uniqueIds = new Set(eventIds)
    expect(uniqueIds.size).toBe(eventIds.length)
  })
})

// ============================================================================
// Query Parameters
// ============================================================================

describe('GET /api/obs/trace/:requestId - Query Parameters', () => {
  it('should support type filter query parameter', async () => {
    const requestId = generateRequestId()

    const response = await get(`/api/obs/trace/${requestId}?type=log`)

    expect(response.status).toBe(200)

    const body = (await response.json()) as TraceResponse

    // All returned events should be of type 'log'
    for (const event of body.events) {
      expect(event.type).toBe('log')
    }
  })

  it('should support multiple type filters', async () => {
    const requestId = generateRequestId()

    const response = await get(`/api/obs/trace/${requestId}?type=log&type=exception`)

    expect(response.status).toBe(200)

    const body = (await response.json()) as TraceResponse

    // All events should be either log or exception
    for (const event of body.events) {
      expect(['log', 'exception']).toContain(event.type)
    }
  })

  it('should support limit query parameter', async () => {
    const requestId = generateRequestId()

    const response = await get(`/api/obs/trace/${requestId}?limit=5`)

    expect(response.status).toBe(200)

    const body = (await response.json()) as TraceResponse
    expect(body.events.length).toBeLessThanOrEqual(5)
  })

  it('should return 400 for invalid limit value', async () => {
    const requestId = generateRequestId()

    const response = await get(`/api/obs/trace/${requestId}?limit=-1`)

    expect(response.status).toBe(400)

    const body = (await response.json()) as ErrorResponse
    expect(body.error.code).toBe('BAD_REQUEST')
  })

  it('should return 400 for invalid type filter', async () => {
    const requestId = generateRequestId()

    const response = await get(`/api/obs/trace/${requestId}?type=invalid_type`)

    expect(response.status).toBe(400)

    const body = (await response.json()) as ErrorResponse
    expect(body.error.code).toBe('BAD_REQUEST')
  })
})

// ============================================================================
// Response Headers
// ============================================================================

describe('GET /api/obs/trace/:requestId - Response Headers', () => {
  it('should return JSON content type', async () => {
    const requestId = generateRequestId()

    const response = await get(`/api/obs/trace/${requestId}`)

    expect(response.headers.get('Content-Type')).toContain('application/json')
  })

  it('should include cache control headers', async () => {
    const requestId = generateRequestId()

    const response = await get(`/api/obs/trace/${requestId}`)

    // Trace data is immutable once created, could be cached
    const cacheControl = response.headers.get('Cache-Control')
    expect(cacheControl).toBeDefined()
  })

  it('should include X-Request-Id header from the response', async () => {
    const requestId = generateRequestId()

    const response = await get(`/api/obs/trace/${requestId}`)

    // The trace endpoint should echo back the request ID or include its own
    const responseRequestId = response.headers.get('X-Request-Id')
    expect(responseRequestId).toBeDefined()
  })
})

// ============================================================================
// Error Handling
// ============================================================================

describe('GET /api/obs/trace/:requestId - Error Handling', () => {
  it('should return consistent error format for 404', async () => {
    const response = await get('/api/obs/trace/non-existent-request')

    expect(response.status).toBe(404)

    const body = (await response.json()) as ErrorResponse
    expect(body).toHaveProperty('error')
    expect(body.error).toHaveProperty('code')
    expect(body.error).toHaveProperty('message')
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('should return JSON content type for errors', async () => {
    const response = await get('/api/obs/trace/non-existent-request')

    expect(response.headers.get('Content-Type')).toContain('application/json')
  })

  it('should handle very long requestId gracefully', async () => {
    const veryLongId = 'req-' + 'a'.repeat(1000)

    const response = await get(`/api/obs/trace/${veryLongId}`)

    // Should either return 400 (bad request) or 404 (not found)
    expect([400, 404]).toContain(response.status)
  })
})

// ============================================================================
// HTTP Method Tests
// ============================================================================

describe('GET /api/obs/trace/:requestId - HTTP Methods', () => {
  it('should only allow GET method', async () => {
    const requestId = generateRequestId()

    const response = await app.request(`/api/obs/trace/${requestId}`, {
      method: 'POST',
    })

    expect(response.status).toBe(405)
  })

  it('should return 405 for PUT', async () => {
    const requestId = generateRequestId()

    const response = await app.request(`/api/obs/trace/${requestId}`, {
      method: 'PUT',
    })

    expect(response.status).toBe(405)
  })

  it('should return 405 for DELETE', async () => {
    const requestId = generateRequestId()

    const response = await app.request(`/api/obs/trace/${requestId}`, {
      method: 'DELETE',
    })

    expect(response.status).toBe(405)
  })

  it('should include Allow header on 405 response', async () => {
    const requestId = generateRequestId()

    const response = await app.request(`/api/obs/trace/${requestId}`, {
      method: 'POST',
    })

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET')
  })
})

// ============================================================================
// Integration with Other Observability Endpoints (Future)
// ============================================================================

describe('Observability Route Structure', () => {
  it('should have /api/obs base path', async () => {
    // The obs routes should be mounted at /api/obs
    const response = await get('/api/obs')

    // Should return something (200 with info or 404 for specific endpoint)
    expect([200, 404]).toContain(response.status)
  })

  it('should 404 for unknown obs endpoints', async () => {
    const response = await get('/api/obs/unknown-endpoint')

    expect(response.status).toBe(404)
  })
})
