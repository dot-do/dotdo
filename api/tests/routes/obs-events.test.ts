/**
 * Observability Events API Route Tests
 *
 * Tests for the /api/obs/events endpoint that queries observability events
 * from storage (Iceberg/R2).
 *
 * TDD: These tests will FAIL until api/routes/obs.ts is implemented.
 *
 * @see types/observability.ts - ObservabilityEvent and ObsFilter types
 * @see api/routes/obs.ts - Route handlers (to be implemented)
 */

import { describe, it, expect, beforeAll, vi } from 'vitest'

// Import the app directly for testing
import { app } from '../../index'

// Import types for type safety
import type { ObservabilityEvent, ObsFilter } from '../../../types/observability'

// ============================================================================
// Test Types
// ============================================================================

interface EventsResponse {
  events: ObservabilityEvent[]
  total?: number
  limit?: number
  offset?: number
}

interface ErrorResponse {
  error: {
    code: string
    message: string
    details?: Array<{ field: string; message: string }>
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

async function get(path: string, headers?: Record<string, string>): Promise<Response> {
  return app.request(path, {
    method: 'GET',
    headers,
  })
}

// ============================================================================
// Sample Test Data
// ============================================================================

const sampleEvents: ObservabilityEvent[] = [
  {
    id: '550e8400-e29b-41d4-a716-446655440001',
    type: 'log',
    level: 'info',
    script: 'api-worker',
    timestamp: Date.now() - 60000,
    requestId: 'req-001',
    message: ['User logged in'],
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440002',
    type: 'exception',
    level: 'error',
    script: 'api-worker',
    timestamp: Date.now() - 30000,
    requestId: 'req-002',
    message: ['Error processing request'],
    stack: 'Error: Something went wrong\n    at processRequest (/src/handler.ts:42:11)',
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440003',
    type: 'request',
    level: 'info',
    script: 'api-worker',
    timestamp: Date.now() - 15000,
    requestId: 'req-003',
    method: 'GET',
    url: '/api/health',
    status: 200,
    duration: 45,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440004',
    type: 'do_method',
    level: 'debug',
    script: 'do-worker',
    timestamp: Date.now() - 5000,
    requestId: 'req-004',
    doName: 'UserDO',
    doId: 'user-123',
    doMethod: 'getProfile',
    duration: 12,
  },
]

// ============================================================================
// 1. GET /api/obs/events - Basic Functionality
// ============================================================================

describe('GET /api/obs/events - Basic Functionality', () => {
  it('should return 200 with events array', async () => {
    const response = await get('/api/obs/events')

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/json')

    const body = (await response.json()) as EventsResponse
    expect(body).toHaveProperty('events')
    expect(Array.isArray(body.events)).toBe(true)
  })

  it('should return events with required fields', async () => {
    const response = await get('/api/obs/events')
    const body = (await response.json()) as EventsResponse

    if (body.events.length > 0) {
      const event = body.events[0]
      expect(event).toHaveProperty('id')
      expect(event).toHaveProperty('type')
      expect(event).toHaveProperty('level')
      expect(event).toHaveProperty('script')
      expect(event).toHaveProperty('timestamp')
    }
  })

  it('should return empty array when no events exist', async () => {
    // This test assumes a fresh/empty state or mocked empty storage
    const response = await get('/api/obs/events?script=nonexistent-script-xyz')
    const body = (await response.json()) as EventsResponse

    expect(body.events).toEqual([])
  })

  it('should return events sorted by timestamp descending (newest first)', async () => {
    const response = await get('/api/obs/events')
    const body = (await response.json()) as EventsResponse

    if (body.events.length > 1) {
      for (let i = 1; i < body.events.length; i++) {
        expect(body.events[i - 1].timestamp).toBeGreaterThanOrEqual(body.events[i].timestamp)
      }
    }
  })
})

// ============================================================================
// 2. Filter by Level (?level=error)
// ============================================================================

describe('GET /api/obs/events - Filter by Level', () => {
  it('should filter events by level=error', async () => {
    const response = await get('/api/obs/events?level=error')

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse

    for (const event of body.events) {
      expect(event.level).toBe('error')
    }
  })

  it('should filter events by level=info', async () => {
    const response = await get('/api/obs/events?level=info')

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse

    for (const event of body.events) {
      expect(event.level).toBe('info')
    }
  })

  it('should filter events by level=warn', async () => {
    const response = await get('/api/obs/events?level=warn')

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse

    for (const event of body.events) {
      expect(event.level).toBe('warn')
    }
  })

  it('should filter events by level=debug', async () => {
    const response = await get('/api/obs/events?level=debug')

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse

    for (const event of body.events) {
      expect(event.level).toBe('debug')
    }
  })

  it('should return 400 for invalid level value', async () => {
    const response = await get('/api/obs/events?level=invalid')

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.code).toBe('BAD_REQUEST')
    expect(body.error.message).toContain('level')
  })
})

// ============================================================================
// 3. Filter by Type (?type=exception)
// ============================================================================

describe('GET /api/obs/events - Filter by Type', () => {
  it('should filter events by type=exception', async () => {
    const response = await get('/api/obs/events?type=exception')

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse

    for (const event of body.events) {
      expect(event.type).toBe('exception')
    }
  })

  it('should filter events by type=log', async () => {
    const response = await get('/api/obs/events?type=log')

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse

    for (const event of body.events) {
      expect(event.type).toBe('log')
    }
  })

  it('should filter events by type=request', async () => {
    const response = await get('/api/obs/events?type=request')

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse

    for (const event of body.events) {
      expect(event.type).toBe('request')
    }
  })

  it('should filter events by type=do_method', async () => {
    const response = await get('/api/obs/events?type=do_method')

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse

    for (const event of body.events) {
      expect(event.type).toBe('do_method')
    }
  })

  it('should return 400 for invalid type value', async () => {
    const response = await get('/api/obs/events?type=invalid')

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.code).toBe('BAD_REQUEST')
    expect(body.error.message).toContain('type')
  })
})

// ============================================================================
// 4. Filter by Script (?script=api-worker)
// ============================================================================

describe('GET /api/obs/events - Filter by Script', () => {
  it('should filter events by script name', async () => {
    const response = await get('/api/obs/events?script=api-worker')

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse

    for (const event of body.events) {
      expect(event.script).toBe('api-worker')
    }
  })

  it('should return empty array for non-matching script', async () => {
    const response = await get('/api/obs/events?script=nonexistent-worker-xyz')

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse
    expect(body.events).toEqual([])
  })

  it('should filter by script with special characters (URL encoded)', async () => {
    const response = await get('/api/obs/events?script=my-api%2Fworker')

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse

    for (const event of body.events) {
      expect(event.script).toBe('my-api/worker')
    }
  })
})

// ============================================================================
// 5. Filter by Time Range (?from=X&to=Y)
// ============================================================================

describe('GET /api/obs/events - Filter by Time Range', () => {
  it('should filter events from a specific timestamp', async () => {
    const from = Date.now() - 3600000 // 1 hour ago
    const response = await get(`/api/obs/events?from=${from}`)

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse

    for (const event of body.events) {
      expect(event.timestamp).toBeGreaterThanOrEqual(from)
    }
  })

  it('should filter events up to a specific timestamp', async () => {
    const to = Date.now() - 1800000 // 30 minutes ago
    const response = await get(`/api/obs/events?to=${to}`)

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse

    for (const event of body.events) {
      expect(event.timestamp).toBeLessThanOrEqual(to)
    }
  })

  it('should filter events within a time range', async () => {
    const from = Date.now() - 3600000 // 1 hour ago
    const to = Date.now() - 1800000 // 30 minutes ago
    const response = await get(`/api/obs/events?from=${from}&to=${to}`)

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse

    for (const event of body.events) {
      expect(event.timestamp).toBeGreaterThanOrEqual(from)
      expect(event.timestamp).toBeLessThanOrEqual(to)
    }
  })

  it('should return 400 when from > to', async () => {
    const from = Date.now()
    const to = Date.now() - 3600000 // 1 hour ago (before from)
    const response = await get(`/api/obs/events?from=${from}&to=${to}`)

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.code).toBe('BAD_REQUEST')
    expect(body.error.message).toContain('from')
  })

  it('should return 400 for invalid from timestamp', async () => {
    const response = await get('/api/obs/events?from=invalid')

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.code).toBe('BAD_REQUEST')
  })

  it('should return 400 for invalid to timestamp', async () => {
    const response = await get('/api/obs/events?to=invalid')

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.code).toBe('BAD_REQUEST')
  })

  it('should return 400 for negative timestamp', async () => {
    const response = await get('/api/obs/events?from=-1000')

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.code).toBe('BAD_REQUEST')
  })
})

// ============================================================================
// 6. Pagination (?limit=100&offset=0)
// ============================================================================

describe('GET /api/obs/events - Pagination', () => {
  it('should limit results with limit parameter', async () => {
    const response = await get('/api/obs/events?limit=5')

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse
    expect(body.events.length).toBeLessThanOrEqual(5)
  })

  it('should skip results with offset parameter', async () => {
    // Get first page
    const firstPage = await get('/api/obs/events?limit=5&offset=0')
    const firstBody = (await firstPage.json()) as EventsResponse

    // Get second page
    const secondPage = await get('/api/obs/events?limit=5&offset=5')
    const secondBody = (await secondPage.json()) as EventsResponse

    // Events should not overlap (assuming enough data)
    if (firstBody.events.length > 0 && secondBody.events.length > 0) {
      const firstIds = new Set(firstBody.events.map((e) => e.id))
      for (const event of secondBody.events) {
        expect(firstIds.has(event.id)).toBe(false)
      }
    }
  })

  it('should return default limit when not specified', async () => {
    const response = await get('/api/obs/events')
    const body = (await response.json()) as EventsResponse

    // Default limit should be reasonable (e.g., 100)
    expect(body.events.length).toBeLessThanOrEqual(100)
  })

  it('should include pagination metadata in response', async () => {
    const response = await get('/api/obs/events?limit=10&offset=0')
    const body = (await response.json()) as EventsResponse

    expect(body).toHaveProperty('limit')
    expect(body).toHaveProperty('offset')
    expect(body.limit).toBe(10)
    expect(body.offset).toBe(0)
  })

  it('should include total count in response', async () => {
    const response = await get('/api/obs/events?limit=5')
    const body = (await response.json()) as EventsResponse

    expect(body).toHaveProperty('total')
    expect(typeof body.total).toBe('number')
    expect(body.total).toBeGreaterThanOrEqual(0)
  })

  it('should return 400 for invalid limit value', async () => {
    const response = await get('/api/obs/events?limit=invalid')

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.code).toBe('BAD_REQUEST')
  })

  it('should return 400 for negative limit', async () => {
    const response = await get('/api/obs/events?limit=-5')

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.code).toBe('BAD_REQUEST')
  })

  it('should return 400 for invalid offset value', async () => {
    const response = await get('/api/obs/events?offset=invalid')

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.code).toBe('BAD_REQUEST')
  })

  it('should return 400 for negative offset', async () => {
    const response = await get('/api/obs/events?offset=-10')

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.code).toBe('BAD_REQUEST')
  })

  it('should cap limit at maximum allowed value', async () => {
    const response = await get('/api/obs/events?limit=10000')

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse
    // Should be capped at max (e.g., 1000)
    expect(body.limit).toBeLessThanOrEqual(1000)
  })
})

// ============================================================================
// 7. Invalid Filter Parameters - 400 Bad Request
// ============================================================================

describe('GET /api/obs/events - Invalid Filters (400)', () => {
  it('should return 400 for unrecognized query parameter', async () => {
    const response = await get('/api/obs/events?unknownParam=value')

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.code).toBe('BAD_REQUEST')
    expect(body.error.message).toContain('unknownParam')
  })

  it('should return 400 with detailed error for invalid level', async () => {
    const response = await get('/api/obs/events?level=critical')

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.code).toBe('BAD_REQUEST')
    expect(body.error.details).toBeDefined()
    expect(body.error.details?.some((d) => d.field === 'level')).toBe(true)
  })

  it('should return 400 with detailed error for invalid type', async () => {
    const response = await get('/api/obs/events?type=trace')

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.code).toBe('BAD_REQUEST')
    expect(body.error.details).toBeDefined()
    expect(body.error.details?.some((d) => d.field === 'type')).toBe(true)
  })

  it('should return 400 for multiple invalid parameters', async () => {
    const response = await get('/api/obs/events?level=invalid&type=invalid&limit=-1')

    expect(response.status).toBe(400)
    const body = (await response.json()) as ErrorResponse
    expect(body.error.code).toBe('BAD_REQUEST')
    // Should report multiple validation errors
    expect(body.error.details?.length).toBeGreaterThanOrEqual(1)
  })

  it('should return JSON content type for error responses', async () => {
    const response = await get('/api/obs/events?level=invalid')

    expect(response.headers.get('Content-Type')).toContain('application/json')
  })
})

// ============================================================================
// 8. Empty Results
// ============================================================================

describe('GET /api/obs/events - Empty Results', () => {
  it('should return empty array when no events match filter', async () => {
    const response = await get('/api/obs/events?script=completely-nonexistent-script-12345')

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse
    expect(body.events).toEqual([])
    expect(body.total).toBe(0)
  })

  it('should return empty array for future time range', async () => {
    const futureTime = Date.now() + 86400000 // 1 day in the future
    const response = await get(`/api/obs/events?from=${futureTime}`)

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse
    expect(body.events).toEqual([])
  })

  it('should return empty array for very old time range', async () => {
    const veryOldTime = Date.now() - 365 * 24 * 60 * 60 * 1000 // 1 year ago
    const response = await get(`/api/obs/events?from=${veryOldTime - 1000}&to=${veryOldTime}`)

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse
    expect(body.events).toEqual([])
  })

  it('should return empty array with valid structure for combined filters with no matches', async () => {
    const response = await get('/api/obs/events?level=error&type=log&script=nonexistent')

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse
    expect(body).toHaveProperty('events')
    expect(body).toHaveProperty('total')
    expect(body.events).toEqual([])
    expect(body.total).toBe(0)
  })
})

// ============================================================================
// 9. Combined Filters (AND Logic)
// ============================================================================

describe('GET /api/obs/events - Combined Filters', () => {
  it('should apply multiple filters with AND logic', async () => {
    const response = await get('/api/obs/events?level=error&type=exception')

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse

    for (const event of body.events) {
      expect(event.level).toBe('error')
      expect(event.type).toBe('exception')
    }
  })

  it('should combine level, type, and script filters', async () => {
    const response = await get('/api/obs/events?level=info&type=request&script=api-worker')

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse

    for (const event of body.events) {
      expect(event.level).toBe('info')
      expect(event.type).toBe('request')
      expect(event.script).toBe('api-worker')
    }
  })

  it('should combine time range with other filters', async () => {
    const from = Date.now() - 3600000 // 1 hour ago
    const response = await get(`/api/obs/events?level=error&from=${from}`)

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse

    for (const event of body.events) {
      expect(event.level).toBe('error')
      expect(event.timestamp).toBeGreaterThanOrEqual(from)
    }
  })

  it('should combine filters with pagination', async () => {
    const response = await get('/api/obs/events?level=info&limit=5&offset=0')

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse

    expect(body.events.length).toBeLessThanOrEqual(5)
    for (const event of body.events) {
      expect(event.level).toBe('info')
    }
  })
})

// ============================================================================
// 10. Additional Filter: requestId
// ============================================================================

describe('GET /api/obs/events - Filter by requestId', () => {
  it('should filter events by requestId', async () => {
    const response = await get('/api/obs/events?requestId=req-001')

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse

    for (const event of body.events) {
      expect(event.requestId).toBe('req-001')
    }
  })

  it('should return empty array for non-matching requestId', async () => {
    const response = await get('/api/obs/events?requestId=nonexistent-request-id-xyz')

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse
    expect(body.events).toEqual([])
  })
})

// ============================================================================
// 11. Additional Filter: doName
// ============================================================================

describe('GET /api/obs/events - Filter by doName', () => {
  it('should filter events by doName', async () => {
    const response = await get('/api/obs/events?doName=UserDO')

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse

    for (const event of body.events) {
      expect(event.doName).toBe('UserDO')
    }
  })

  it('should return empty array for non-matching doName', async () => {
    const response = await get('/api/obs/events?doName=NonExistentDO')

    expect(response.status).toBe(200)
    const body = (await response.json()) as EventsResponse
    expect(body.events).toEqual([])
  })
})

// ============================================================================
// 12. HTTP Method Validation
// ============================================================================

describe('GET /api/obs/events - HTTP Methods', () => {
  it('should return 405 for POST method', async () => {
    const response = await app.request('/api/obs/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(405)
  })

  it('should return 405 for PUT method', async () => {
    const response = await app.request('/api/obs/events', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(405)
  })

  it('should return 405 for DELETE method', async () => {
    const response = await app.request('/api/obs/events', {
      method: 'DELETE',
    })

    expect(response.status).toBe(405)
  })

  it('should return 405 for PATCH method', async () => {
    const response = await app.request('/api/obs/events', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(405)
  })
})

// ============================================================================
// 13. Response Format
// ============================================================================

describe('GET /api/obs/events - Response Format', () => {
  it('should return events with all optional fields when available', async () => {
    const response = await get('/api/obs/events?type=request')
    const body = (await response.json()) as EventsResponse

    if (body.events.length > 0) {
      const event = body.events.find((e) => e.type === 'request')
      if (event) {
        expect(event).toHaveProperty('method')
        expect(event).toHaveProperty('url')
        expect(event).toHaveProperty('status')
        expect(event).toHaveProperty('duration')
      }
    }
  })

  it('should return exception events with stack trace', async () => {
    const response = await get('/api/obs/events?type=exception')
    const body = (await response.json()) as EventsResponse

    if (body.events.length > 0) {
      const exception = body.events[0]
      expect(exception).toHaveProperty('stack')
    }
  })

  it('should return DO method events with DO metadata', async () => {
    const response = await get('/api/obs/events?type=do_method')
    const body = (await response.json()) as EventsResponse

    if (body.events.length > 0) {
      const doEvent = body.events[0]
      expect(doEvent).toHaveProperty('doName')
      expect(doEvent).toHaveProperty('doId')
      expect(doEvent).toHaveProperty('doMethod')
    }
  })

  it('should have valid UUID format for event ids', async () => {
    const response = await get('/api/obs/events')
    const body = (await response.json()) as EventsResponse

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    for (const event of body.events) {
      expect(event.id).toMatch(uuidRegex)
    }
  })

  it('should have valid timestamp values', async () => {
    const response = await get('/api/obs/events')
    const body = (await response.json()) as EventsResponse

    for (const event of body.events) {
      expect(typeof event.timestamp).toBe('number')
      expect(event.timestamp).toBeGreaterThan(0)
      // Timestamp should be a reasonable value (after year 2020)
      expect(event.timestamp).toBeGreaterThan(1577836800000)
    }
  })
})
