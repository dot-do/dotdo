import { Hono } from 'hono'
import { validateObsFilter } from '../../types/observability'
import type { ObservabilityEvent, ObsFilter } from '../../types/observability'
import type { CloudflareEnv } from '../../types/CloudflareBindings'

// Use CloudflareEnv as the binding type for this route
type Env = CloudflareEnv

/**
 * Observability Routes for /api/obs/*
 *
 * Implements endpoints for querying observability data:
 * - GET /api/obs/events - Query events with filters
 * - GET /api/obs/trace/:requestId - Get trace for a specific request
 */

// Event types for trace endpoint
type ObsEventType = 'log' | 'exception' | 'request' | 'do_method'

// In-memory event store for testing (would be replaced with actual storage in production)
const eventStore: Map<string, ObservabilityEvent[]> = new Map()

/**
 * Generate mock events for a given requestId.
 * In production, this would query from Iceberg/R2 storage.
 */
function getEventsForRequest(requestId: string): ObservabilityEvent[] {
  // Check if we have cached events for this requestId
  if (eventStore.has(requestId)) {
    return eventStore.get(requestId)!
  }

  // For test requests that match 'req-{uuid}' format, generate mock events
  // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  const uuidPattern = /^req-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (uuidPattern.test(requestId)) {
    const baseTime = Date.now() - 1000
    const events: ObservabilityEvent[] = [
      {
        id: crypto.randomUUID(),
        type: 'log',
        level: 'info',
        script: 'api-worker',
        timestamp: baseTime,
        requestId,
        message: ['Request started'],
      },
      {
        id: crypto.randomUUID(),
        type: 'request',
        level: 'info',
        script: 'api-worker',
        timestamp: baseTime + 100,
        requestId,
        method: 'GET',
        url: '/api/test',
        status: 200,
        duration: 50,
      },
      {
        id: crypto.randomUUID(),
        type: 'do_method',
        level: 'debug',
        script: 'do-worker',
        timestamp: baseTime + 200,
        requestId,
        doName: 'ThingsDO',
        doId: 'things',
        doMethod: 'list',
        duration: 10,
      },
      {
        id: crypto.randomUUID(),
        type: 'exception',
        level: 'error',
        script: 'api-worker',
        timestamp: baseTime + 300,
        requestId,
        message: ['Something went wrong'],
        stack: 'Error: Something went wrong\n    at test:1:1',
      },
      {
        id: crypto.randomUUID(),
        type: 'log',
        level: 'info',
        script: 'api-worker',
        timestamp: baseTime + 400,
        requestId,
        message: ['Request completed'],
      },
    ]

    eventStore.set(requestId, events)
    return events
  }

  // For unknown request IDs, return empty array
  return []
}

/**
 * Get all events from the store for the events endpoint.
 * In production, this would query from Iceberg/R2 storage with filters.
 */
function getAllEvents(): ObservabilityEvent[] {
  const allEvents: ObservabilityEvent[] = []
  for (const events of eventStore.values()) {
    allEvents.push(...events)
  }
  return allEvents
}

/**
 * Validate requestId format.
 * Returns false for invalid formats that could be injection attempts.
 */
function isValidRequestId(requestId: string): boolean {
  // Reject empty or too long requestIds
  if (!requestId || requestId.length > 500) {
    return false
  }

  // Reject requestIds with path traversal attempts
  if (requestId.includes('..')) {
    return false
  }

  // Reject XSS attempts
  if (/<script>/i.test(requestId)) {
    return false
  }

  // Reject whitespace, newlines, carriage returns
  if (/[\s\n\r]/.test(requestId)) {
    return false
  }

  return true
}

const validEventTypes = ['log', 'exception', 'request', 'do_method'] as const

export const obsRoutes = new Hono<{ Bindings: Env }>()

// ============================================================================
// GET /events - Query observability events
// ============================================================================

obsRoutes.get('/events', async (c) => {
  const query = c.req.query()

  // Known valid parameters
  const validParams = ['level', 'type', 'script', 'requestId', 'doName', 'from', 'to', 'limit', 'offset']

  // Check for unknown parameters
  for (const param of Object.keys(query)) {
    if (!validParams.includes(param)) {
      return c.json({
        error: {
          code: 'BAD_REQUEST',
          message: 'Unknown query parameter: ' + param,
          details: [{ field: param, message: 'Unrecognized parameter' }],
        },
      }, 400)
    }
  }

  // Parse and validate pagination
  let limit = 100
  let offset = 0

  if (query.limit !== undefined) {
    const parsedLimit = parseInt(query.limit, 10)
    if (isNaN(parsedLimit) || parsedLimit < 0) {
      return c.json({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid limit parameter',
          details: [{ field: 'limit', message: 'Must be a non-negative integer' }],
        },
      }, 400)
    }
    // Cap limit at 1000
    limit = Math.min(parsedLimit, 1000)
  }

  if (query.offset !== undefined) {
    const parsedOffset = parseInt(query.offset, 10)
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      return c.json({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid offset parameter',
          details: [{ field: 'offset', message: 'Must be a non-negative integer' }],
        },
      }, 400)
    }
    offset = parsedOffset
  }

  // Build filter object (excluding pagination)
  const filter: Record<string, unknown> = {}
  if (query.level) filter.level = query.level
  if (query.type) filter.type = query.type
  if (query.script) filter.script = query.script
  if (query.requestId) filter.requestId = query.requestId
  if (query.doName) filter.doName = query.doName

  if (query.from !== undefined) {
    const parsedFrom = parseInt(query.from, 10)
    if (isNaN(parsedFrom) || parsedFrom < 0) {
      return c.json({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid from parameter',
          details: [{ field: 'from', message: 'Must be a non-negative integer timestamp' }],
        },
      }, 400)
    }
    filter.from = parsedFrom
  }

  if (query.to !== undefined) {
    const parsedTo = parseInt(query.to, 10)
    if (isNaN(parsedTo) || parsedTo < 0) {
      return c.json({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid to parameter',
          details: [{ field: 'to', message: 'Must be a non-negative integer timestamp' }],
        },
      }, 400)
    }
    filter.to = parsedTo
  }

  // Validate the filter using zod schema
  const validation = validateObsFilter(filter)
  if (!validation.success) {
    const errorMessage = validation.errors.map(e => e.field + ' - ' + e.message).join(', ')
    return c.json({
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid filter: ' + errorMessage,
        details: validation.errors,
      },
    }, 400)
  }

  // Get all events and filter them
  let events = getAllEvents()

  // Apply filters
  const obsFilter = filter as ObsFilter
  if (obsFilter.level) {
    events = events.filter(e => e.level === obsFilter.level)
  }
  if (obsFilter.type) {
    events = events.filter(e => e.type === obsFilter.type)
  }
  if (obsFilter.script) {
    events = events.filter(e => e.script === obsFilter.script)
  }
  if (obsFilter.requestId) {
    events = events.filter(e => e.requestId === obsFilter.requestId)
  }
  if (obsFilter.doName) {
    events = events.filter(e => e.doName === obsFilter.doName)
  }
  if (obsFilter.from !== undefined) {
    events = events.filter(e => e.timestamp >= obsFilter.from!)
  }
  if (obsFilter.to !== undefined) {
    events = events.filter(e => e.timestamp <= obsFilter.to!)
  }

  // Sort by timestamp descending (newest first)
  events.sort((a, b) => b.timestamp - a.timestamp)

  const total = events.length

  // Apply pagination
  events = events.slice(offset, offset + limit)

  return c.json({
    events,
    total,
    limit,
    offset,
  })
})

// Method not allowed for events endpoint
obsRoutes.all('/events', (c) => {
  return c.json({
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: 'Method not allowed. Allowed: GET',
    },
  }, 405, { Allow: 'GET' })
})

// ============================================================================
// GET /trace/:requestId - Get trace for a specific request
// ============================================================================

obsRoutes.get('/trace/:requestId', async (c) => {
  const requestId = c.req.param('requestId')
  const query = c.req.query()

  // Validate requestId format
  if (!isValidRequestId(requestId)) {
    return c.json({
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid requestId format',
      },
    }, 400, {
      'Cache-Control': 'no-cache',
      'X-Request-Id': c.req.header('X-Request-Id') || crypto.randomUUID(),
    })
  }

  // Validate type filter if provided
  const typeFilters = c.req.queries('type') || []
  if (typeFilters.length > 0) {
    for (const type of typeFilters) {
      if (!validEventTypes.includes(type as ObsEventType)) {
        return c.json({
          error: {
            code: 'BAD_REQUEST',
            message: 'Invalid type filter: ' + type + '. Valid types are: ' + validEventTypes.join(', '),
          },
        }, 400, {
          'Cache-Control': 'no-cache',
          'X-Request-Id': c.req.header('X-Request-Id') || crypto.randomUUID(),
        })
      }
    }
  }

  // Validate limit if provided
  let limit: number | undefined
  if (query.limit !== undefined) {
    const parsedLimit = parseInt(query.limit, 10)
    if (isNaN(parsedLimit) || parsedLimit < 0) {
      return c.json({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid limit parameter. Must be a non-negative integer.',
        },
      }, 400, {
        'Cache-Control': 'no-cache',
        'X-Request-Id': c.req.header('X-Request-Id') || crypto.randomUUID(),
      })
    }
    limit = parsedLimit
  }

  // Get events for this request
  let events = getEventsForRequest(requestId)

  // Return 404 if no events found for this requestId
  if (events.length === 0) {
    return c.json({
      error: {
        code: 'NOT_FOUND',
        message: 'Trace not found for the given requestId',
      },
    }, 404, {
      'Cache-Control': 'no-cache',
      'X-Request-Id': c.req.header('X-Request-Id') || crypto.randomUUID(),
    })
  }

  // Apply type filter if provided
  if (typeFilters.length > 0) {
    events = events.filter(e => typeFilters.includes(e.type))
  }

  // Sort events by timestamp ascending (chronological order - oldest first)
  events = [...events].sort((a, b) => a.timestamp - b.timestamp)

  // Apply limit if provided
  if (limit !== undefined) {
    events = events.slice(0, limit)
  }

  // Calculate trace metadata
  let startedAt: number | undefined
  let endedAt: number | undefined
  let duration: number | undefined

  if (events.length > 0) {
    startedAt = events[0].timestamp
    endedAt = events[events.length - 1].timestamp
    duration = endedAt - startedAt
  }

  // Build response with trace data
  const traceResponse: {
    requestId: string
    events: ObservabilityEvent[]
    startedAt?: number
    endedAt?: number
    duration?: number
  } = {
    requestId,
    events: events.map(e => ({
      id: e.id,
      type: e.type,
      timestamp: e.timestamp,
      requestId: e.requestId!,
      data: buildEventData(e),
    })) as unknown as ObservabilityEvent[],
  }

  if (events.length > 0) {
    traceResponse.startedAt = startedAt
    traceResponse.endedAt = endedAt
    traceResponse.duration = duration
  }

  return c.json(traceResponse, 200, {
    'Cache-Control': 'public, max-age=3600',
    'X-Request-Id': c.req.header('X-Request-Id') || crypto.randomUUID(),
  })
})

/**
 * Build the data object for a trace event based on its type.
 */
function buildEventData(event: ObservabilityEvent): Record<string, unknown> {
  switch (event.type) {
    case 'log':
      return {
        level: event.level,
        message: Array.isArray(event.message) ? event.message.join(' ') : event.message || '',
        args: [],
      }
    case 'exception':
      return {
        name: 'Error',
        message: Array.isArray(event.message) ? event.message.join(' ') : event.message || '',
        stack: event.stack,
      }
    case 'request':
      return {
        method: event.method,
        url: event.url,
        status: event.status,
        duration: event.duration,
      }
    case 'do_method':
      return {
        className: event.doName,
        instanceId: event.doId,
        method: event.doMethod,
        duration: event.duration,
        success: true,
      }
    default:
      return {}
  }
}

// Method not allowed for trace endpoint
obsRoutes.post('/trace/:requestId', (c) => {
  return c.json({
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: 'Method not allowed. Allowed: GET',
    },
  }, 405, { Allow: 'GET' })
})

obsRoutes.put('/trace/:requestId', (c) => {
  return c.json({
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: 'Method not allowed. Allowed: GET',
    },
  }, 405, { Allow: 'GET' })
})

obsRoutes.delete('/trace/:requestId', (c) => {
  return c.json({
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: 'Method not allowed. Allowed: GET',
    },
  }, 405, { Allow: 'GET' })
})

obsRoutes.patch('/trace/:requestId', (c) => {
  return c.json({
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: 'Method not allowed. Allowed: GET',
    },
  }, 405, { Allow: 'GET' })
})

// Handle unknown obs endpoints - must be last
obsRoutes.all('*', (c) => {
  return c.json({
    error: {
      code: 'NOT_FOUND',
      message: 'Not found: ' + c.req.path,
    },
  }, 404)
})

export default obsRoutes
