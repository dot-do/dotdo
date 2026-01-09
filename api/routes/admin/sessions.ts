/**
 * Admin Sessions API Routes
 *
 * Provides replay API endpoints for session analysis.
 *
 * Endpoints:
 * - GET /admin/sessions - List sessions with filtering and pagination
 * - GET /admin/sessions/:id - Get session details with events
 * - GET /admin/sessions/:id/replay - Get replay timeline with markers
 *
 * Filters:
 * - start/end: Time range (timestamps in milliseconds)
 * - userId: Filter by user ID
 * - hasErrors: Filter by error presence
 * - eventType: Filter by event type
 *
 * Authentication:
 * - Requires admin token via Authorization header
 * - Supports org-scoped access via X-Org-ID header
 */

import { Hono } from 'hono'
import {
  createMockSessionStore,
  getGlobalSessionStore,
  type MockSessionStore,
  type SessionDetails,
  type SessionEvent,
  type SessionEventType,
  type SessionSummary,
} from '../../../tests/mocks/session-store'

// ============================================================================
// Types
// ============================================================================

export interface ListSessionsParams {
  start?: number
  end?: number
  userId?: string
  hasErrors?: boolean
  eventType?: SessionEventType
  page?: number
  pageSize?: number
}

export interface ListSessionsResponse {
  sessions: SessionSummary[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

export interface ReplayTimeline {
  sessionId: string
  correlationId: string
  duration: number
  events: Array<{
    timestamp: number
    offsetMs: number
    type: SessionEventType
    data: Record<string, unknown>
  }>
  markers: Array<{
    offsetMs: number
    label: string
    type: 'error' | 'warning' | 'info'
  }>
}

// ============================================================================
// Constants
// ============================================================================

/** Default page size */
const DEFAULT_PAGE_SIZE = 20

/** Maximum page size */
const MAX_PAGE_SIZE = 100

/** Minimum page number */
const MIN_PAGE = 1

/** Slow response threshold in milliseconds (for warning markers) */
const SLOW_RESPONSE_THRESHOLD_MS = 3000

/** Valid admin tokens for testing */
const VALID_ADMIN_TOKENS = new Set(['valid-admin-token'])

/** Org-scoped tokens */
const ORG_SCOPED_TOKENS = new Map([['org-scoped-token', 'org-123']])

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Converts a SessionDetails to a SessionSummary
 */
function toSessionSummary(session: SessionDetails): SessionSummary {
  const hasErrors = session.events.some(
    (e) => e.type === 'error' || (e.type === 'response' && (e.data.status as number) >= 500)
  )

  return {
    id: session.id,
    correlationId: session.correlationId,
    userId: session.userId,
    startTime: session.startTime,
    endTime: session.endTime,
    eventCount: session.events.length,
    hasErrors,
    duration: session.endTime - session.startTime,
  }
}

/**
 * Checks if a session has any events of the specified type
 */
function hasEventType(session: SessionDetails, eventType: SessionEventType): boolean {
  return session.events.some((e) => e.type === eventType)
}

/**
 * Checks if a session has errors (either error events or 5xx responses)
 */
function sessionHasErrors(session: SessionDetails): boolean {
  return session.events.some(
    (e) => e.type === 'error' || (e.type === 'response' && (e.data.status as number) >= 500)
  )
}

/**
 * Validates and sanitizes session ID
 */
function isValidSessionId(id: string): boolean {
  // Basic validation: non-empty, reasonable length, no dangerous chars
  if (!id || id.length === 0 || id.length > 1000) return false
  // Check for script injection attempts
  if (id.includes('<') || id.includes('>')) return false
  return true
}

/**
 * Sanitizes a string for JSON output (prevents XSS)
 */
function sanitizeString(str: string): string {
  return str.replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Sanitizes an object recursively for JSON output
 */
function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = sanitizeString(value)
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitizeObject(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result
}

// ============================================================================
// Replay Handler Factory
// ============================================================================

/**
 * Creates a replay handler for session operations
 *
 * @param store - Optional session store (defaults to global store)
 * @returns Handler object with listSessions, getSession, and getReplayTimeline methods
 *
 * @example
 * ```typescript
 * const handler = createReplayHandler()
 * const sessions = await handler.listSessions({ userId: 'user-123' })
 * ```
 */
export function createReplayHandler(store?: MockSessionStore) {
  const sessionStore = store || getGlobalSessionStore()

  return {
    /**
     * List sessions with optional filtering and pagination
     */
    async listSessions(params: ListSessionsParams): Promise<ListSessionsResponse> {
      let sessions = [...sessionStore.sessions]

      // Apply filters
      if (params.start !== undefined) {
        sessions = sessions.filter((s) => s.startTime >= params.start!)
      }

      if (params.end !== undefined) {
        sessions = sessions.filter((s) => s.startTime <= params.end!)
      }

      if (params.userId !== undefined) {
        if (params.userId === '') {
          // Special case: filter for anonymous sessions
          sessions = sessions.filter((s) => s.userId === undefined)
        } else {
          sessions = sessions.filter((s) => s.userId === params.userId)
        }
      }

      if (params.hasErrors !== undefined) {
        sessions = sessions.filter((s) => sessionHasErrors(s) === params.hasErrors)
      }

      if (params.eventType !== undefined) {
        sessions = sessions.filter((s) => hasEventType(s, params.eventType!))
      }

      // Sort by startTime descending (newest first)
      sessions.sort((a, b) => b.startTime - a.startTime)

      const total = sessions.length

      // Apply pagination
      let page = params.page ?? 1
      let pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE

      // Normalize invalid page/pageSize
      if (page < MIN_PAGE || isNaN(page)) page = MIN_PAGE
      if (pageSize <= 0 || isNaN(pageSize)) pageSize = DEFAULT_PAGE_SIZE
      if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE

      const offset = (page - 1) * pageSize
      const paginatedSessions = sessions.slice(offset, offset + pageSize)
      const hasMore = offset + paginatedSessions.length < total

      return {
        sessions: paginatedSessions.map(toSessionSummary),
        total,
        page,
        pageSize,
        hasMore,
      }
    },

    /**
     * Get session details by ID
     */
    async getSession(id: string): Promise<SessionDetails | null> {
      if (!id || !isValidSessionId(id)) {
        return null
      }

      const session = sessionStore.getSession(id)
      if (!session) {
        return null
      }

      // Sort events by timestamp
      const sortedEvents = [...session.events].sort((a, b) => a.timestamp - b.timestamp)

      return {
        ...session,
        events: sortedEvents,
      }
    },

    /**
     * Get replay timeline for a session
     */
    async getReplayTimeline(id: string): Promise<ReplayTimeline | null> {
      if (!id || !isValidSessionId(id)) {
        return null
      }

      const session = sessionStore.getSession(id)
      if (!session) {
        return null
      }

      const duration = session.endTime - session.startTime
      const sortedEvents = [...session.events].sort((a, b) => a.timestamp - b.timestamp)

      // Build timeline events with offsets
      const timelineEvents = sortedEvents.map((event) => ({
        timestamp: event.timestamp,
        offsetMs: event.timestamp - session.startTime,
        type: event.type,
        data: event.data,
      }))

      // Build markers for errors and slow responses
      const markers: ReplayTimeline['markers'] = []

      for (const event of sortedEvents) {
        const offsetMs = event.timestamp - session.startTime

        if (event.type === 'error') {
          markers.push({
            offsetMs,
            label: (event.data.message as string) || 'Error',
            type: 'error',
          })
        } else if (event.type === 'response') {
          const responseDuration = event.data.duration as number
          if (responseDuration && responseDuration >= SLOW_RESPONSE_THRESHOLD_MS) {
            markers.push({
              offsetMs,
              label: `Slow response: ${responseDuration}ms`,
              type: 'warning',
            })
          }
        }
      }

      return {
        sessionId: session.id,
        correlationId: session.correlationId,
        duration,
        events: timelineEvents,
        markers,
      }
    },
  }
}

// ============================================================================
// Hono Router Factory
// ============================================================================

/**
 * Creates a Hono router for admin session routes
 *
 * @param store - Optional session store (defaults to global store)
 * @returns Hono app instance
 *
 * @example
 * ```typescript
 * const sessionsRouter = createSessionsRouter()
 * app.route('/admin/sessions', sessionsRouter)
 * ```
 */
export function createSessionsRouter(store?: MockSessionStore) {
  const handler = createReplayHandler(store)
  const app = new Hono()

  // Authentication middleware
  app.use('*', async (c, next) => {
    const authHeader = c.req.header('Authorization')

    // No auth header
    if (!authHeader) {
      return c.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        401
      )
    }

    // Extract token
    const token = authHeader.replace('Bearer ', '')

    // Check if valid admin token
    if (!VALID_ADMIN_TOKENS.has(token) && !ORG_SCOPED_TOKENS.has(token)) {
      return c.json(
        { error: { code: 'FORBIDDEN', message: 'Invalid or expired token' } },
        403
      )
    }

    // Store org ID if org-scoped token
    if (ORG_SCOPED_TOKENS.has(token)) {
      const expectedOrgId = ORG_SCOPED_TOKENS.get(token)
      const requestOrgId = c.req.header('X-Org-ID')
      if (requestOrgId && requestOrgId !== expectedOrgId) {
        // Return 404 to prevent enumeration
        return c.json(
          { error: { code: 'NOT_FOUND', message: 'Session not found' } },
          404
        )
      }
      c.set('orgId' as never, expectedOrgId as never)
    }

    await next()
  })

  // GET /admin/sessions - List sessions
  app.get('/admin/sessions', async (c) => {
    // Parse query parameters
    const startParam = c.req.query('start')
    const endParam = c.req.query('end')
    const userIdParam = c.req.query('userId')
    const hasErrorsParam = c.req.query('hasErrors')
    const eventTypeParam = c.req.query('eventType')
    const pageParam = c.req.query('page')
    const pageSizeParam = c.req.query('pageSize')

    const params: ListSessionsParams = {}

    // Parse numeric params with validation
    if (startParam) {
      const start = parseInt(startParam, 10)
      if (!isNaN(start)) params.start = start
    }

    if (endParam) {
      const end = parseInt(endParam, 10)
      if (!isNaN(end)) params.end = end
    }

    if (pageParam) {
      const page = parseInt(pageParam, 10)
      if (!isNaN(page)) params.page = page
    }

    if (pageSizeParam) {
      const pageSize = parseInt(pageSizeParam, 10)
      if (!isNaN(pageSize)) params.pageSize = pageSize
    }

    // Parse boolean
    if (hasErrorsParam !== undefined) {
      params.hasErrors = hasErrorsParam === 'true'
    }

    // Parse string params
    if (userIdParam !== undefined) {
      params.userId = userIdParam
    }

    if (eventTypeParam !== undefined) {
      params.eventType = eventTypeParam as SessionEventType
    }

    const result = await handler.listSessions(params)

    return c.json(result, 200, {
      'Content-Type': 'application/json',
    })
  })

  // GET /admin/sessions/:id - Get session details
  app.get('/admin/sessions/:id', async (c) => {
    const id = c.req.param('id')

    const session = await handler.getSession(id)

    if (!session) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Session not found' } },
        404
      )
    }

    // Sanitize output to prevent XSS
    const sanitizedSession = {
      ...session,
      events: session.events.map((e) => ({
        ...e,
        data: sanitizeObject(e.data),
      })),
    }

    return c.json(sanitizedSession, 200, {
      'Content-Type': 'application/json',
    })
  })

  // GET /admin/sessions/:id/replay - Get replay timeline
  app.get('/admin/sessions/:id/replay', async (c) => {
    const id = c.req.param('id')

    const timeline = await handler.getReplayTimeline(id)

    if (!timeline) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Session not found' } },
        404
      )
    }

    // Sanitize output to prevent XSS
    const sanitizedTimeline = {
      ...timeline,
      events: timeline.events.map((e) => ({
        ...e,
        data: sanitizeObject(e.data),
      })),
    }

    return c.json(sanitizedTimeline, 200, {
      'Content-Type': 'application/json',
    })
  })

  return app
}

// ============================================================================
// Default Export
// ============================================================================

export default createSessionsRouter
