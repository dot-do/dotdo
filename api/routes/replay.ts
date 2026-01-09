/**
 * Session Replay Routes
 *
 * Handles session event ingestion for replay functionality.
 *
 * Endpoints:
 * - POST /replay/ingest - Accepts batched session events
 *
 * Headers:
 * - X-Session-ID: Session identifier
 * - X-Dotdo-Request: Correlation ID for request tracing
 */
import { vi } from 'vitest'
import {
  SessionEventSchema,
  safeValidateSessionEvent,
  isValidEventType,
  type SessionEvent,
  type SessionEventType,
  SESSION_EVENT_TYPES,
} from '../../types/SessionEvent'

// ============================================================================
// Types
// ============================================================================

export interface Pipeline {
  send(events: unknown[]): Promise<void>
}

export interface IngestRequest {
  events: SessionEvent[]
}

export interface IngestResponse {
  accepted: number
  rejected: number
  errors?: Array<{ index: number; message: string }>
  sessionId?: string
}

interface EnrichedEvent extends SessionEvent {
  sessionId?: string
  ingestedAt: number
}

interface RRWebEvent {
  type: number
  data: unknown
  timestamp: number
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum batch size before chunking */
const MAX_BATCH_SIZE = 1000

/** Maximum concurrent pending requests for backpressure */
const MAX_PENDING_REQUESTS = 10

/** Default rate limit per session */
const RATE_LIMIT_PER_SESSION = 100

/** Rate limit window in milliseconds */
const RATE_LIMIT_WINDOW_MS = 1000

/** Maximum retry attempts for pipeline errors */
const MAX_RETRIES = 3

/** Delay between retries in milliseconds */
const RETRY_DELAY_MS = 50

// ============================================================================
// Rate Limiting State
// ============================================================================

// Simple in-memory rate limiter (per-session tracking)
const sessionRequestCounts = new Map<string, { count: number; resetAt: number }>()
let pendingRequests = 0

/**
 * Check and update rate limit for a session
 */
function checkRateLimit(sessionId: string): { allowed: boolean; limit: number; remaining: number; retryAfter?: number } {
  const now = Date.now()
  const existing = sessionRequestCounts.get(sessionId)

  if (!existing || existing.resetAt <= now) {
    // New window
    sessionRequestCounts.set(sessionId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return { allowed: true, limit: RATE_LIMIT_PER_SESSION, remaining: RATE_LIMIT_PER_SESSION - 1 }
  }

  if (existing.count >= RATE_LIMIT_PER_SESSION) {
    const retryAfter = Math.ceil((existing.resetAt - now) / 1000)
    return { allowed: false, limit: RATE_LIMIT_PER_SESSION, remaining: 0, retryAfter }
  }

  existing.count++
  return { allowed: true, limit: RATE_LIMIT_PER_SESSION, remaining: RATE_LIMIT_PER_SESSION - existing.count }
}

/**
 * Check backpressure - are we overwhelmed?
 */
function checkBackpressure(): boolean {
  return pendingRequests >= MAX_PENDING_REQUESTS
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validates session ID format (prevent XSS/injection)
 */
function isValidSessionId(sessionId: string): boolean {
  // Alphanumeric with dashes and underscores, reasonable length
  return /^[a-zA-Z0-9][a-zA-Z0-9\-_]{0,255}$/.test(sessionId)
}

/**
 * Validates an RRWeb event structure
 */
function isValidRRWebEvent(event: unknown): event is RRWebEvent {
  if (!event || typeof event !== 'object') return false
  const obj = event as Record<string, unknown>
  return (
    typeof obj.type === 'number' &&
    typeof obj.timestamp === 'number' &&
    'data' in obj
  )
}

/**
 * Validates a single event with detailed error messages
 */
function validateEvent(event: unknown, index: number): { valid: boolean; error?: string } {
  if (!event || typeof event !== 'object') {
    return { valid: false, error: `Event at index ${index} must be an object` }
  }

  const obj = event as Record<string, unknown>

  // Check required id field
  if (!obj.id || typeof obj.id !== 'string' || obj.id.length === 0) {
    return { valid: false, error: `Event at index ${index}: id is required and must be a non-empty string` }
  }

  // Check timestamp
  if (typeof obj.timestamp !== 'number') {
    return { valid: false, error: `Event at index ${index}: timestamp must be a number` }
  }
  if (obj.timestamp <= 0) {
    return { valid: false, error: `Event at index ${index}: timestamp must be positive` }
  }

  // Check type
  if (!isValidEventType(obj.type)) {
    return { valid: false, error: `Event at index ${index}: type must be one of ${SESSION_EVENT_TYPES.join(', ')}` }
  }

  // Check data
  if (obj.data === null || obj.data === undefined || typeof obj.data !== 'object' || Array.isArray(obj.data)) {
    return { valid: false, error: `Event at index ${index}: data must be an object` }
  }

  // For custom events with rrweb data, validate rrweb structure
  if (obj.type === 'custom') {
    const data = obj.data as Record<string, unknown>
    if (data.rrweb === true && data.event !== undefined) {
      if (!isValidRRWebEvent(data.event)) {
        return { valid: false, error: `Event at index ${index}: rrweb event has invalid structure` }
      }
    }
  }

  // Check optional sequence
  if (obj.sequence !== undefined) {
    if (typeof obj.sequence !== 'number' || !Number.isInteger(obj.sequence) || obj.sequence < 1) {
      return { valid: false, error: `Event at index ${index}: sequence must be a positive integer` }
    }
  }

  // Check optional source
  if (obj.source !== undefined && obj.source !== 'frontend' && obj.source !== 'backend') {
    return { valid: false, error: `Event at index ${index}: source must be 'frontend' or 'backend'` }
  }

  return { valid: true }
}

// ============================================================================
// Ingest Handler Factory
// ============================================================================

/**
 * Creates an ingest handler that processes session events
 *
 * @param pipeline - The pipeline to send events to
 * @returns Request handler function
 *
 * @example
 * ```typescript
 * const pipeline = createMockPipeline()
 * const handler = createIngestHandler(pipeline)
 *
 * const request = new Request('http://localhost/replay/ingest', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ events: [{ id: 'evt-1', ... }] })
 * })
 *
 * const response = await handler(request)
 * ```
 */
export function createIngestHandler(pipeline: Pipeline): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    // CORS headers for all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Session-ID, X-Dotdo-Request',
    }

    // Handle OPTIONS for CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    // Method validation
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method must be POST' } }),
        {
          status: 405,
          headers: { 'Content-Type': 'application/json', 'Allow': 'POST', ...corsHeaders },
        }
      )
    }

    // Content-Type validation
    const contentType = req.headers.get('Content-Type') || ''
    if (!contentType.includes('application/json')) {
      return new Response(
        JSON.stringify({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json' } }),
        { status: 415, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      )
    }

    // Extract headers
    const sessionId = req.headers.get('X-Session-ID') || ''
    const headerCorrelationId = req.headers.get('X-Dotdo-Request') || ''

    // Validate session ID if provided
    if (sessionId && !isValidSessionId(sessionId)) {
      // Sanitize or return 400
      return new Response(
        JSON.stringify({ error: { code: 'INVALID_SESSION_ID', message: 'Invalid session ID format' } }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      )
    }

    // Rate limiting
    const effectiveSessionId = sessionId || 'anonymous'
    const rateLimit = checkRateLimit(effectiveSessionId)

    const rateLimitHeaders = {
      'X-RateLimit-Limit': String(rateLimit.limit),
      'X-RateLimit-Remaining': String(rateLimit.remaining),
    }

    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(rateLimit.retryAfter),
            ...rateLimitHeaders,
            ...corsHeaders,
          },
        }
      )
    }

    // Backpressure check
    if (checkBackpressure()) {
      return new Response(
        JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Server is overloaded' } }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '1', ...corsHeaders },
        }
      )
    }

    // Parse JSON body
    let body: unknown
    try {
      const text = await req.text()
      body = JSON.parse(text)
    } catch {
      return new Response(
        JSON.stringify({ error: { code: 'INVALID_JSON', message: 'Invalid JSON in request body' } }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...rateLimitHeaders, ...corsHeaders } }
      )
    }

    // Validate body structure
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return new Response(
        JSON.stringify({ error: { code: 'MISSING_EVENTS', message: 'Request body must be an object with events array' } }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...rateLimitHeaders, ...corsHeaders } }
      )
    }

    const bodyObj = body as Record<string, unknown>

    if (!('events' in bodyObj)) {
      return new Response(
        JSON.stringify({ error: { code: 'MISSING_EVENTS', message: 'events field is required' } }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...rateLimitHeaders, ...corsHeaders } }
      )
    }

    if (!Array.isArray(bodyObj.events)) {
      return new Response(
        JSON.stringify({ error: { code: 'INVALID_EVENTS', message: 'events must be an array' } }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...rateLimitHeaders, ...corsHeaders } }
      )
    }

    const events = bodyObj.events as unknown[]

    // Empty events array is valid
    if (events.length === 0) {
      const response: IngestResponse = { accepted: 0, rejected: 0 }
      if (sessionId) response.sessionId = sessionId
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...rateLimitHeaders, ...corsHeaders },
      })
    }

    // Validate and enrich events
    const ingestTime = Date.now()
    const validEvents: EnrichedEvent[] = []
    const errors: Array<{ index: number; message: string }> = []

    for (let i = 0; i < events.length; i++) {
      const event = events[i]
      const validation = validateEvent(event, i)

      if (!validation.valid) {
        errors.push({ index: i, message: validation.error! })
        continue
      }

      const eventObj = event as Record<string, unknown>

      // Determine correlationId: event > header > sessionId > generated
      let correlationId = eventObj.correlationId as string
      if (!correlationId || correlationId.length === 0) {
        if (headerCorrelationId) {
          correlationId = headerCorrelationId
        } else if (sessionId) {
          correlationId = sessionId
        } else {
          correlationId = `gen-${crypto.randomUUID()}`
        }
      }

      // Enrich event
      const enrichedEvent: EnrichedEvent = {
        id: eventObj.id as string,
        correlationId,
        timestamp: eventObj.timestamp as number,
        type: eventObj.type as SessionEventType,
        data: eventObj.data as Record<string, unknown>,
        ingestedAt: ingestTime,
      }

      if (sessionId) {
        enrichedEvent.sessionId = sessionId
      }

      if (eventObj.source) {
        enrichedEvent.source = eventObj.source as 'frontend' | 'backend'
      }

      if (eventObj.sequence) {
        enrichedEvent.sequence = eventObj.sequence as number
      }

      validEvents.push(enrichedEvent)
    }

    // If all events are invalid, return 400
    if (validEvents.length === 0 && errors.length > 0) {
      const response: IngestResponse = { accepted: 0, rejected: errors.length, errors }
      return new Response(JSON.stringify(response), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...rateLimitHeaders, ...corsHeaders },
      })
    }

    // Send events to pipeline with retry logic
    pendingRequests++
    try {
      let lastError: Error | null = null

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          await pipeline.send(validEvents)
          lastError = null
          break
        } catch (err) {
          lastError = err as Error
          console.error(`Pipeline send attempt ${attempt + 1} failed:`, err)
          if (attempt < MAX_RETRIES - 1) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)))
          }
        }
      }

      if (lastError) {
        throw lastError
      }
    } catch (err) {
      console.error('Pipeline error after retries:', err)
      return new Response(
        JSON.stringify({
          error: {
            code: 'PIPELINE_ERROR',
            message: 'Failed to process events',
          },
        }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...rateLimitHeaders, ...corsHeaders } }
      )
    } finally {
      pendingRequests--
    }

    // Build response
    const response: IngestResponse = {
      accepted: validEvents.length,
      rejected: errors.length,
    }

    if (errors.length > 0) {
      response.errors = errors
    }

    if (sessionId) {
      response.sessionId = sessionId
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...rateLimitHeaders, ...corsHeaders },
    })
  }
}

// ============================================================================
// Reset function for testing
// ============================================================================

/**
 * Resets rate limiting state (for testing)
 */
export function resetRateLimitState(): void {
  sessionRequestCounts.clear()
  pendingRequests = 0
}
